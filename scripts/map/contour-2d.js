/**
 * contour-2d.js — Unified contour lines & labels via maplibre-contour plugin.
 *
 * Works in BOTH 2D and 3D modes:
 *   - 2D mode: plugin provides contour lines + labels (shader is off)
 *   - 3D mode: shader provides contour lines, plugin provides labels only
 *
 * Loads maplibre-contour from CDN on first init.
 * Uses the same DEM tile URL as the terrain source (Mapterhorn, terrarium).
 */

const CONTOUR_SRC = 'contour-plugin-src';
const LINE_MINOR = 'contour-line-minor';
const LINE_MAJOR = 'contour-line-major';
const LABEL_ID = 'contour-label';

let pluginLoaded = false;

/** Darken an rgba color string by mixing toward black (matches shader's mix(color, black, f)) */
function darkenColor(rgba, fraction) {
    const m = rgba.match(/[\d.]+/g);
    if (!m || m.length < 3) return rgba;
    const r = Math.round(parseFloat(m[0]) * (1 - fraction));
    const g = Math.round(parseFloat(m[1]) * (1 - fraction));
    const b = Math.round(parseFloat(m[2]) * (1 - fraction));
    const a = m[3] !== undefined ? parseFloat(m[3]) : 1;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Dynamically load maplibre-contour from CDN */
function loadPlugin() {
    return new Promise((resolve, reject) => {
        if (pluginLoaded && window.mlcontour) { resolve(); return; }
        const s = document.createElement('script');
        s.src = 'https://unpkg.com/maplibre-contour@0.1.0/dist/index.min.js';
        s.onload = () => { pluginLoaded = true; resolve(); };
        s.onerror = () => reject(new Error('Failed to load maplibre-contour'));
        document.head.appendChild(s);
    });
}

/** Toggle line layers based on terrain state */
function syncVisibility(map) {
    const hasTerrain = !!map.getTerrain();
    const lineVis = hasTerrain ? 'none' : 'visible';
    // Lines: hidden in 3D (shader draws them), visible in 2D
    [LINE_MINOR, LINE_MAJOR].forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', lineVis);
    });
    // Labels: always visible
    if (map.getLayer(LABEL_ID)) {
        map.setLayoutProperty(LABEL_ID, 'visibility', 'visible');
    }
}

/**
 * Initialize contour source + layers.
 * Call AFTER the map style is loaded.
 */
export async function initContours(map) {
    try {
        await loadPlugin();
    } catch (e) {
        console.warn('[Contours] Plugin failed to load:', e);
        return;
    }

    const mlcontour = window.mlcontour;
    if (!mlcontour || !mlcontour.DemSource) {
        console.warn('[Contours] mlcontour.DemSource not available');
        return;
    }

    // Create DEM source for the contour plugin
    const demSource = new mlcontour.DemSource({
        url: 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp',
        encoding: 'terrarium',
        maxzoom: 12,
        worker: true,
    });
    demSource.setupMaplibre(mlcontour.maplibregl || window.maplibregl);

    // Add contour vector source — minor=10m, major=100m
    if (!map.getSource(CONTOUR_SRC)) {
        map.addSource(CONTOUR_SRC, {
            type: 'vector',
            tiles: [
                demSource.contourProtocolUrl({
                    multiplier: 1,
                    thresholds: {
                        11: [10, 100],
                        12: [10, 100],
                        13: [10, 100],
                        14: [10, 100],
                        15: [10, 100],
                    },
                    elevationKey: 'ele',
                    levelKey: 'level',
                    contourLayer: 'contours',
                    overzoom: 1,
                }),
            ],
            maxzoom: 16,
        });
    }

    // Read contour color from shared config (same source as the 3D shader)
    const cfg = window.contourConfig || {};
    const contourColor = cfg.color || 'rgba(139, 90, 43, 0.2)';

    // Parse the rgba to derive a darker major-line color (shader does mix(color, black, 0.3))
    const majorColor = darkenColor(contourColor, 0.3);

    // ── Minor contour lines (every 10m) — visible in 2D only ──
    if (!map.getLayer(LINE_MINOR)) {
        map.addLayer({
            id: LINE_MINOR,
            type: 'line',
            source: CONTOUR_SRC,
            'source-layer': 'contours',
            filter: ['==', ['get', 'level'], 0],
            paint: {
                'line-color': contourColor,
                'line-width': 1,
                'line-opacity': [
                    'interpolate', ['linear'], ['zoom'],
                    11, 0,
                    13, 0.6,   // shader minor alpha is 0.6
                ],
            },
            layout: { 'line-join': 'round' },
            minzoom: 11,
        });
    }

    // ── Major contour lines (every 100m) — visible in 2D only ──
    if (!map.getLayer(LINE_MAJOR)) {
        map.addLayer({
            id: LINE_MAJOR,
            type: 'line',
            source: CONTOUR_SRC,
            'source-layer': 'contours',
            filter: ['>', ['get', 'level'], 0],
            paint: {
                'line-color': majorColor,
                'line-width': 1.5,
                'line-opacity': [
                    'interpolate', ['linear'], ['zoom'],
                    11, 0,
                    13, 1,
                ],
            },
            layout: { 'line-join': 'round' },
            minzoom: 11,
        });
    }

    // ── Labels on major contours — always visible (both 2D & 3D) ──
    if (!map.getLayer(LABEL_ID)) {
        map.addLayer({
            id: LABEL_ID,
            type: 'symbol',
            source: CONTOUR_SRC,
            'source-layer': 'contours',
            filter: ['>', ['get', 'level'], 0],
            layout: {
                'symbol-placement': 'line',
                'text-field': ['concat', ['to-string', ['get', 'ele']], ' m'],
                'text-size': 5,
                'text-font': ['Noto Sans Bold'],
                'text-anchor': 'center',
                'symbol-spacing': 250,
                'text-max-angle': 30,
                'text-allow-overlap': false,
                'text-ignore-placement': false,
                'text-rotation-alignment': 'auto',
                'text-pitch-alignment': 'viewport',
            },
            paint: {
                'text-color': 'rgba(60, 40, 20, 0.85)',
                'text-halo-color': 'rgba(255, 255, 255, 0.95)',
                'text-halo-width': 2.5,
                'text-opacity': [
                    'interpolate', ['linear'], ['zoom'],
                    11, 0,
                    13, 0.85,
                    16, 1,
                ],
            },
            minzoom: 11,
        });
    }

    // Initial sync + listen for 2D ↔ 3D switches
    syncVisibility(map);
    map.on('terrain', () => syncVisibility(map));

    console.log('[Contours] Initialized (plugin, minor=10m, major=100m)');
}
