/**
 * contour-labels.js — Native contour labels from MapLibre's internal DEM.
 *
 * Reads DEM tile pixel buffers directly (same data the GPU shader uses).
 * Bulk-reads the raw Uint8Array → unpacks elevation in one pass → runs
 * marching squares at 256×256 per tile for shader-matching resolution.
 *
 * Perf: only recomputes when visible tile set changes.
 * Processing: one tile per requestIdleCallback to stay off the main thread.
 */

const SOURCE_ID = 'contour-labels-src';
const LAYER_ID = 'contour-labels-text';
const LINE_ID = 'contour-labels-line';

const STEP = 2;                // Subsample: 512/2 = 256×256 grid per tile
const MIN_VERTICES = 4;

const tileCache = new Map();
let lastTileSetKey = '';
let updateScheduled = false;

// ── Interval from app thresholds ──
function getMajorInterval(zoom) {
    const t = window.contourThresholds;
    if (!t) return 500;
    let best = -1;
    for (const z in t) { const pz = parseInt(z); if (pz <= zoom && pz > best) best = pz; }
    return best === -1 ? 500 : t[best][0] * 10;
}

// ── Tile ↔ lnglat ──
function tile2lng(x, z) { return (x / (1 << z)) * 360 - 180; }
function tile2lat(y, z) {
    const n = Math.PI - 2 * Math.PI * y / (1 << z);
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

// ── Get deduplicated DEM tiles from MapLibre internals ──
function getDEMTiles(map) {
    const style = map.style;
    if (!style || !style.tileManagers) return [];

    for (const id in style.tileManagers) {
        const tm = style.tileManagers[id];
        try {
            if (tm.getSource && tm.getSource().type === 'raster-dem') {
                const allTiles = tm._inViewTiles?.getAllTiles?.() || [];
                const valid = allTiles.filter(t => t && t.dem && t.dem.dim > 0);
                if (!valid.length) return [];

                // Find the highest canonical zoom level available
                let maxZ = 0;
                for (const t of valid) {
                    if (t.tileID.canonical.z > maxZ) maxZ = t.tileID.canonical.z;
                }

                // Only keep tiles at that zoom level, dedup by x/y
                const seen = new Map();
                for (const t of valid) {
                    const c = t.tileID.canonical;
                    if (c.z !== maxZ) continue;
                    const k = `${c.x}/${c.y}`;
                    if (!seen.has(k)) seen.set(k, t);
                }
                return [...seen.values()];
            }
        } catch (e) { continue; }
    }
    return [];
}

// ── Marching squares edges ──
const EDGES = {
    1: [[2, 3]], 2: [[1, 2]], 3: [[1, 3]], 4: [[0, 1]],
    5: [[0, 3], [1, 2]], 6: [[0, 2]], 7: [[0, 3]], 8: [[0, 3]],
    9: [[0, 2]], 10: [[0, 1], [2, 3]], 11: [[0, 1]], 12: [[1, 3]],
    13: [[1, 2]], 14: [[2, 3]],
};

// ── Bulk-read DEM tile into elevation grid ──
function readDEMGrid(dem) {
    const dim = dem.dim;
    const stride = dem.stride;
    const N = Math.floor(dim / STEP);
    const grid = new Float32Array(N * N);
    const pixels = new Uint8Array(dem.data.buffer);
    const rF = dem.redFactor, gF = dem.greenFactor, bF = dem.blueFactor, base = dem.baseShift;

    let minE = Infinity, maxE = -Infinity;
    for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
            // DEM has 1px padding, so pixel (x,y) → index (y+1)*stride + (x+1)
            const px = c * STEP, py = r * STEP;
            const idx = ((py + 1) * stride + (px + 1)) * 4;
            const e = pixels[idx] * rF + pixels[idx + 1] * gF + pixels[idx + 2] * bF - base;
            grid[r * N + c] = e;
            if (e < minE) minE = e;
            if (e > maxE) maxE = e;
        }
    }
    return { grid, N, minE, maxE };
}

// ── Trace contours from a DEM tile ──
function traceTile(dem, tx, ty, tz, interval) {
    const { grid, N, minE, maxE } = readDEMGrid(dem);
    if (minE >= maxE) return [];

    const lng0 = tile2lng(tx, tz), lng1 = tile2lng(tx + 1, tz);
    const lat0 = tile2lat(ty, tz), lat1 = tile2lat(ty + 1, tz);
    const dim = dem.dim;

    // Pre-compute lng/lat arrays
    const lngs = new Float64Array(N);
    const lats = new Float64Array(N);
    for (let c = 0; c < N; c++) lngs[c] = lng0 + (lng1 - lng0) * (c * STEP) / (dim - 1);
    for (let r = 0; r < N; r++) lats[r] = lat0 + (lat1 - lat0) * (r * STEP) / (dim - 1);

    const startLvl = Math.ceil(minE / interval) * interval;
    const endLvl = Math.floor(maxE / interval) * interval;
    const features = [];

    for (let lvl = startLvl; lvl <= endLvl; lvl += interval) {
        const segs = [];
        for (let r = 0; r < N - 1; r++) {
            for (let c = 0; c < N - 1; c++) {
                const v00 = grid[r * N + c], v10 = grid[r * N + c + 1];
                const v01 = grid[(r + 1) * N + c], v11 = grid[(r + 1) * N + c + 1];
                const idx = (v00 >= lvl ? 8 : 0) | (v10 >= lvl ? 4 : 0) | (v11 >= lvl ? 2 : 0) | (v01 >= lvl ? 1 : 0);
                if (idx === 0 || idx === 15) continue;
                const l0 = lngs[c], l1 = lngs[c + 1], a0 = lats[r], a1 = lats[r + 1];
                const lerp = (a, b, va, vb) => a + (b - a) * (lvl - va) / (vb - va);
                const ep = [
                    () => [lerp(l0, l1, v00, v10), a0],
                    () => [l1, lerp(a0, a1, v10, v11)],
                    () => [lerp(l0, l1, v01, v11), a1],
                    () => [l0, lerp(a0, a1, v00, v01)]
                ];
                const edges = EDGES[idx];
                if (edges) for (const [e1, e2] of edges) segs.push([ep[e1](), ep[e2]()]);
            }
        }
        if (!segs.length) continue;

        // Merge segments into polylines
        const key = p => `${p[0].toFixed(9)},${p[1].toFixed(9)}`;
        const adj = new Map();
        for (let i = 0; i < segs.length; i++) {
            const [p1, p2] = segs[i];
            const k1 = key(p1), k2 = key(p2);
            if (!adj.has(k1)) adj.set(k1, []);
            if (!adj.has(k2)) adj.set(k2, []);
            adj.get(k1).push({ pt: p2, idx: i, k: k2 });
            adj.get(k2).push({ pt: p1, idx: i, k: k1 });
        }
        const used = new Set();
        for (let i = 0; i < segs.length; i++) {
            if (used.has(i)) continue;
            used.add(i);
            const line = [segs[i][0], segs[i][1]];
            let ek = key(line[line.length - 1]);
            while (true) { const nb = adj.get(ek); if (!nb) break; const nx = nb.find(n => !used.has(n.idx)); if (!nx) break; used.add(nx.idx); line.push(nx.pt); ek = nx.k; }
            let sk = key(line[0]);
            while (true) { const nb = adj.get(sk); if (!nb) break; const pr = nb.find(n => !used.has(n.idx)); if (!pr) break; used.add(pr.idx); line.unshift(pr.pt); sk = pr.k; }
            if (line.length >= MIN_VERTICES) {
                features.push({ type: 'Feature', properties: { elevation: lvl }, geometry: { type: 'LineString', coordinates: line } });
            }
        }
    }
    return features;
}

// ── Main update — chunked via requestIdleCallback ──
function updateContourLabels(map) {
    if (updateScheduled) return;

    if (window.imageryState) {
        const cs = window.imageryState.get('contours');
        if (cs && cs.enabled === false) {
            const src = map.getSource(SOURCE_ID);
            if (src) src.setData({ type: 'FeatureCollection', features: [] });
            return;
        }
    }

    const zoom = map.getZoom();
    if (zoom < 11) return;
    if (!map.terrain) return;

    const interval = getMajorInterval(zoom);
    const demTiles = getDEMTiles(map);
    if (!demTiles.length) return;

    const tileSetKey = demTiles.map(t => {
        const c = t.tileID.canonical;
        return `${c.z}/${c.x}/${c.y}`;
    }).sort().join('|') + `@${interval}`;

    if (tileSetKey === lastTileSetKey) return;
    lastTileSetKey = tileSetKey;

    const cached = [];
    const toCompute = [];
    for (const t of demTiles) {
        const c = t.tileID.canonical;
        const k = `${c.z}/${c.x}/${c.y}/${interval}`;
        if (tileCache.has(k)) cached.push(...tileCache.get(k));
        else toCompute.push({ tile: t, cacheKey: k });
    }

    if (toCompute.length === 0) {
        const src = map.getSource(SOURCE_ID);
        if (src) src.setData({ type: 'FeatureCollection', features: cached });
        return;
    }

    updateScheduled = true;
    let idx = 0;

    function processNext() {
        if (idx >= toCompute.length) {
            const all = [...cached];
            for (const item of toCompute) {
                if (tileCache.has(item.cacheKey)) all.push(...tileCache.get(item.cacheKey));
            }
            const src = map.getSource(SOURCE_ID);
            if (src) src.setData({ type: 'FeatureCollection', features: all });
            updateScheduled = false;
            if (tileCache.size > 200) {
                const keys = [...tileCache.keys()];
                for (let i = 0; i < keys.length - 150; i++) tileCache.delete(keys[i]);
            }
            return;
        }

        const item = toCompute[idx++];
        const t = item.tile;
        const c = t.tileID.canonical;
        try {
            const features = traceTile(t.dem, c.x, c.y, c.z, interval);
            tileCache.set(item.cacheKey, features);
        } catch (e) {
            tileCache.set(item.cacheKey, []);
        }

        if (typeof requestIdleCallback === 'function') requestIdleCallback(processNext);
        else setTimeout(processNext, 0);
    }

    if (typeof requestIdleCallback === 'function') requestIdleCallback(processNext);
    else setTimeout(processNext, 0);
}

// ── Init ──
export function initContourLabels(map) {
    let debounceTimer = null;

    map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });


    map.addLayer({
        id: LAYER_ID,
        type: 'symbol',
        source: SOURCE_ID,
        layout: {
            'symbol-placement': 'line',
            'text-field': ['concat', ['to-string', ['get', 'elevation']], ' m'],
            'text-size': 10,
            'text-font': ['Noto Sans Bold'],
            'text-anchor': 'center',
            'text-offset': [0, -0.8],
            'symbol-spacing': 250,
            'text-max-angle': 30,
            'text-allow-overlap': false,
            'text-ignore-placement': false,
            'text-rotation-alignment': 'map',
            'text-pitch-alignment': 'viewport',
        },
        paint: {
            'text-color': 'rgba(60, 40, 20, 0.85)',
            'text-halo-color': 'rgba(255, 255, 255, 0.95)',
            'text-halo-width': 2.5,
        },
        minzoom: 11,
    });

    const doUpdate = () => {
        try { updateContourLabels(map); }
        catch (e) { console.warn('[ContourLabels]', e); }
    };

    // Debounced — only fires 500ms after the LAST moveend/zoomend
    const debouncedUpdate = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(doUpdate, 500);
    };

    map.on('moveend', debouncedUpdate);

    // Initial render after first load
    map.once('idle', () => setTimeout(doUpdate, 1000));

    console.log('[ContourLabels] Initialized (native DEM, STEP=2, 256×256/tile)');
}
