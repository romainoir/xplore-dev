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

import {
    CONTOUR_LAYER_IDS,
    positionContourLayers,
} from '../app/layer-stack-manager.js';

const CONTOUR_SRC = 'contour-plugin-src';
const LINE_MINOR = 'contour-line-minor';
const LINE_MAJOR = 'contour-line-major';
const LABEL_ID = 'contour-label';
const LABEL_NEAR_FADE_METERS = 500;
const LABEL_FAR_FADE_METERS = 3000;
const LABEL_FADE_SYNC_INTERVAL_MS = 120;

let pluginLoaded = false;
const terrainListenerMaps = new WeakSet();
const syncTimerMaps = new WeakMap();

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

function contoursEnabled() {
    const state = window.imageryState?.get?.('contours');
    if (!state) return true;
    return state.enabled !== false && (state.opacity ?? 1) > 0;
}

function contourLabelBaseFilter() {
    return ['>', ['get', 'level'], 0];
}

function centerPoint(map) {
    const center = map.getCenter();
    return {
        type: 'Point',
        coordinates: [center.lng, center.lat],
    };
}

function labelZoomOpacity() {
    return [
        'interpolate', ['linear'], ['zoom'],
        11, 0,
        13, 1,
        16, 1,
    ];
}

function applyLabelFade(map, hasRaisedTerrain) {
    if (!map.getLayer(LABEL_ID)) return;

    if (!hasRaisedTerrain) {
        map.setFilter(LABEL_ID, contourLabelBaseFilter());
        map.setPaintProperty(LABEL_ID, 'text-opacity', labelZoomOpacity());
        map.setPaintProperty(LABEL_ID, 'text-halo-color', 'rgba(255, 255, 255, 0)');
        map.setPaintProperty(LABEL_ID, 'text-halo-width', 0);
        map.setPaintProperty(LABEL_ID, 'text-halo-blur', 0);
        return;
    }

    const point = centerPoint(map);
    try {
        map.setPaintProperty(LABEL_ID, 'text-halo-color', 'rgba(255, 255, 255, 0)');
        map.setPaintProperty(LABEL_ID, 'text-halo-width', 0);
        map.setPaintProperty(LABEL_ID, 'text-halo-blur', 0);
        map.setFilter(LABEL_ID, [
            'all',
            contourLabelBaseFilter(),
            ['<=', ['distance', point], LABEL_FAR_FADE_METERS],
        ]);
        map.setPaintProperty(LABEL_ID, 'text-opacity', labelZoomOpacity());
    } catch (err) {
        console.warn('[Contours] Distance-based label opacity unavailable, using distance filter only:', err);
        map.setPaintProperty(LABEL_ID, 'text-opacity', labelZoomOpacity());
    }
}

function bringContoursForward(map) {
    try {
        positionContourLayers(map);
    } catch (_) { }
}

/** Toggle plugin lines/labels based on app contour state and terrain mode. */
function syncVisibility(map) {
    const mode = window.viewModeController?.getMode?.();
    const hasRaisedTerrain = mode === '3d';
    const enabled = contoursEnabled();
    const lineVis = enabled && !hasRaisedTerrain ? 'visible' : 'none';
    const labelVis = enabled ? 'visible' : 'none';
    // Lines: visible only in flat 2D. In 3D, the terrain shader draws the lines.
    [LINE_MINOR, LINE_MAJOR].forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', lineVis);
    });
    // Labels: vector text from maplibre-contour. Keep them as labels-only over the shader.
    if (map.getLayer(LABEL_ID)) {
        map.setLayoutProperty(LABEL_ID, 'visibility', labelVis);
        applyLabelFade(map, hasRaisedTerrain);
    }
    bringContoursForward(map);
}

function scheduleSyncVisibility(map) {
    if (syncTimerMaps.has(map)) return;
    const timer = window.setTimeout(() => {
        syncTimerMaps.delete(map);
        syncVisibility(map);
    }, LABEL_FADE_SYNC_INTERVAL_MS);
    syncTimerMaps.set(map, timer);
}

function bindSyncListeners(map) {
    if (terrainListenerMaps.has(map)) return;
    map.on('terrain', () => syncVisibility(map));
    map.on('move', () => {
        if (window.viewModeController?.getMode?.() === '3d') scheduleSyncVisibility(map);
    });
    window.addEventListener('xplore-contours-state-change', () => {
        syncVisibility(map);
        map.triggerRepaint?.();
    });
    terrainListenerMaps.add(map);
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
    const contourColor = cfg.color || 'rgba(72, 46, 24, 0.5)';

    // Parse the rgba to derive a darker major-line color (shader does mix(color, black, 0.35)).
    const majorColor = darkenColor(contourColor, 0.35);

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
                'line-width': 1.8,
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

    // ── Labels on major contours — visible in both 2D and 3D when contours are enabled ──
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
                'text-size': 7,
                'text-font': ['Noto Sans Bold'],
                'text-anchor': 'center',
                'symbol-spacing': 250,
                'text-max-angle': 30,
                'text-allow-overlap': true,
                'text-ignore-placement': true,
                'text-rotation-alignment': 'viewport',
                'text-pitch-alignment': 'viewport',
                'symbol-z-order': 'viewport-y',
            },
            paint: {
                'text-color': 'rgba(60, 40, 20, 0.85)',
                'text-halo-color': 'rgba(255, 255, 255, 0)',
                'text-halo-width': 0,
                'text-halo-blur': 0,
                'text-opacity': [
                    'interpolate', ['linear'], ['zoom'],
                    11, 0,
                    13, 1,
                    16, 1,
                ],
            },
            minzoom: 11,
        });
    }

    // Initial sync + listen for 2D ↔ 3D switches. Register only once per map;
    // style swaps re-run initContours but should not stack terrain listeners.
    syncVisibility(map);
    bindSyncListeners(map);

    console.log('[Contours] Initialized (plugin, minor=10m, major=100m)');
}
