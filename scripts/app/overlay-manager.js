/**
 * overlay-manager.js — Map layer and source setup: DEM sources, hillshade,
 * contours, raster tiles, native terrain analysis layers.
 *
 * Exports:
 *   applyOverlays(map, deps) — Removes old layers/sources, adds all DEM + imagery layers,
 *                                applies initial state & hillshade appearance.
 *   applyHillshadeAppearance(map) — Sets hillshade to 'combined' method with optimal styling.
 */

import {
    MAPTERHORN_TILE_URL,
    MAPTERHORN_ATTRIBUTION,
    TILE_FADE_DURATION,
} from '../config/map-config.js';

import {
    IMAGERY_OPTIONS,
    DEM_SOURCE_MAX_ZOOM,
    SHADOW_DEM_MAX_ZOOM,
    clampOpacity,
    scaleExpression,

} from './imagery-manager.js';

import { updatePeakLabels, getBaseStyleLayerBuckets } from './map-init.js';

// ─── Hillshade method style presets ───
const HILLSHADE_METHOD_STYLES = Object.freeze({
    standard: Object.freeze({ highlightColor: 'rgba(255,255,255,0.85)', shadowColor: 'rgba(0,0,0,0.5)', exaggeration: 0.40 }),
    basic: Object.freeze({ highlightColor: 'rgba(255,255,255,0.8)', shadowColor: 'rgba(0,0,0,0.45)', exaggeration: 0.35 }),
    combined: Object.freeze({ highlightColor: 'rgba(255,255,255,0.98)', shadowColor: 'rgba(0,0,0,0.85)', accentColor: 'rgba(0,0,0,0.8)', exaggeration: ['interpolate', ['linear'], ['zoom'], 6, 2.0, 12, 1.4, 16, 0.8] }),
    igor: Object.freeze({ highlightColor: 'rgba(255,255,255,0.9)', shadowColor: 'rgba(0,0,0,0.6)', exaggeration: 0.7 }),
    multidirectional: Object.freeze({ highlightColor: 'rgba(255,255,255,0.75)', shadowColor: 'rgba(0,0,0,0.4)', exaggeration: 0.28 })
});

/**
 * Apply hillshade appearance (combined method, always on).
 * @param {maplibregl.Map} map
 */
export function applyHillshadeAppearance(map) {
    if (!map.getLayer('hillshade')) return;
    const style = HILLSHADE_METHOD_STYLES.igor;
    map.setPaintProperty('hillshade', 'hillshade-illumination-anchor', 'map');
    map.setPaintProperty('hillshade', 'hillshade-method', 'igor');
    map.setPaintProperty('hillshade', 'hillshade-highlight-color', style.highlightColor);
    map.setPaintProperty('hillshade', 'hillshade-shadow-color', style.shadowColor);
    map.setPaintProperty('hillshade', 'hillshade-accent-color', style.accentColor || style.shadowColor);
    map.setPaintProperty('hillshade', 'hillshade-exaggeration', style.exaggeration);
    map.setLayoutProperty('hillshade', 'visibility', 'visible');
}

/**
 * Return overlay source and layer definitions as plain JSON.
 * Used to inject into style JSON before setStyle.
 */
export function getOverlayDefinitions() {
    const demConfig = { type: 'raster-dem', tiles: [MAPTERHORN_TILE_URL], encoding: 'terrarium', tileSize: 512, attribution: MAPTERHORN_ATTRIBUTION };
    const sources = {
        terrainSource: { ...demConfig, maxzoom: DEM_SOURCE_MAX_ZOOM },
        hillshadeSource: { ...demConfig, maxzoom: DEM_SOURCE_MAX_ZOOM },
        shadowDemSource: { ...demConfig, maxzoom: SHADOW_DEM_MAX_ZOOM },
        reliefDem: { ...demConfig, maxzoom: DEM_SOURCE_MAX_ZOOM },
    };

    const nativeConfig = { type: 'hillshade', source: 'hillshadeSource', layout: { visibility: 'none' }, paint: { 'hillshade-exaggeration': 1.0 } };
    const layers = [
        { id: 'terrain-bg', type: 'background', paint: { 'background-color': '#e8e8e8', 'background-opacity': 1 } },
        { id: 'hillshade2', type: 'hillshade', source: 'reliefDem', paint: { 'hillshade-highlight-color': 'rgba(255,255,255,0.6)', 'hillshade-accent-color': 'rgba(0,0,0,0.3)', 'hillshade-exaggeration': 0.15, 'hillshade-shadow-color': 'rgba(0,0,0,0.4)' } },
        { id: 'hillshade', type: 'hillshade', source: 'hillshadeSource', paint: { 'hillshade-highlight-color': 'rgba(255,255,255,0.9)', 'hillshade-accent-color': 'rgba(0,0,0,0.55)', 'hillshade-exaggeration': 0.23, 'hillshade-shadow-color': 'rgba(0,0,0,0.55)' } },
        { id: 'normalmap', ...nativeConfig },
        { id: 'snow-native', ...nativeConfig },
        { id: 'aspect-native', ...nativeConfig },
        { id: 'slope-native', ...nativeConfig },
        { id: 'avalanche-native', ...nativeConfig },
        { id: 'detail-native', type: 'hillshade', source: 'hillshadeSource', layout: { visibility: 'none' }, paint: { 'hillshade-exaggeration': 1.0, 'hillshade-illumination-anchor': 'map', 'hillshade-accent-color': '#00ff00' } },
        { id: 'shadow-native', type: 'hillshade', source: 'shadowDemSource', layout: { visibility: 'none' }, paint: { 'hillshade-exaggeration': 1.0, 'hillshade-illumination-anchor': 'map' } },
    ];

    return { sources, layers };
}

/**
 * Inject overlay definitions into a style JSON so MapLibre's diff engine
 * preserves DEM tiles, hillshade, and terrain across basemap switches.
 */
export function injectOverlaysIntoStyle(style) {
    const { sources, layers } = getOverlayDefinitions();
    style.sources = style.sources || {};
    Object.assign(style.sources, sources);
    style.layers = style.layers || [];
    // Strip incoming style's own background layers — our terrain-bg replaces them
    style.layers = style.layers.filter(l => l.type !== 'background');
    const existing = new Set(style.layers.map(l => l.id));
    // Prepend overlays at the BOTTOM so terrain-bg/hillshade sit below vector layers
    const toInsert = layers.filter(l => !existing.has(l.id));
    style.layers = [...toInsert, ...style.layers];
    style.terrain = { source: 'terrainSource', exaggeration: 1 };
}

/**
 * Apply all overlays: DEM sources, terrain layers, contours, raster imagery, native analysis layers.
 * Called on style.load. Uses try/catch and ensure* helpers to handle sources/layers
 * that may already exist from style injection.
 * @param {maplibregl.Map} map
 * @param {object} deps - shared dependencies
 */
export function applyOverlays(map, deps = {}) {
    const {
        imageryState,

        applyImageryState,
        updateImageryControlStates,
        applyImageryLayerOrder,
        ensureGpxLayers,
        currentGpxData,
        debugNetworkVisible,
        bringDebugNetworkToFront,
        viewModeController,
    } = deps;

    const rmL = id => { try { if (map.getLayer(id)) map.removeLayer(id); } catch (_) { } };
    const rmS = id => { try { if (map.getSource(id)) map.removeSource(id); } catch (_) { } };
    const ensureS = (id, config) => { if (!map.getSource(id)) map.addSource(id, config); };
    const ensureL = (config, before) => { if (!map.getLayer(config.id)) map.addLayer(config, before); };

    // Find top symbol layer for insertion
    const liveLayers = map.getStyle().layers || [];
    let topLabelId = null;
    for (let i = liveLayers.length - 1; i >= 0; i--) {
        if (liveLayers[i].type === 'symbol') { topLabelId = liveLayers[i].id; break; }
    }

    // Remove existing imagery layers (but NOT DEM/hillshade — those are preserved by style injection)
    IMAGERY_OPTIONS.forEach(option => {
        const layerIds = [];
        if (typeof option.layerId === 'string') layerIds.push(option.layerId);
        if (Array.isArray(option.linkedLayerIds)) option.linkedLayerIds.forEach(id => { if (typeof id === 'string') layerIds.push(id); });
        layerIds.forEach(rmL);
    });

    // Remove existing imagery sources (but NOT DEM sources — preserved by injection)
    IMAGERY_OPTIONS.forEach(option => {
        const sourceIds = [];
        if (typeof option.sourceId === 'string') sourceIds.push(option.sourceId);
        if (Array.isArray(option.sourceIds)) option.sourceIds.forEach(id => { if (typeof id === 'string') sourceIds.push(id); });
        sourceIds.forEach(rmS);
    });

    // ─── Add DEM sources (skip if already present from style injection) ───
    const demConfig = { type: 'raster-dem', tiles: [MAPTERHORN_TILE_URL], encoding: 'terrarium', tileSize: 512, attribution: MAPTERHORN_ATTRIBUTION };
    ensureS('terrainSource', { ...demConfig, maxzoom: DEM_SOURCE_MAX_ZOOM });
    ensureS('hillshadeSource', { ...demConfig, maxzoom: DEM_SOURCE_MAX_ZOOM });
    ensureS('shadowDemSource', { ...demConfig, maxzoom: SHADOW_DEM_MAX_ZOOM, tileZoomOffset: 0 });
    ensureS('reliefDem', { ...demConfig, maxzoom: DEM_SOURCE_MAX_ZOOM });

    // Background (covers hillshade tile gaps)
    ensureL({ id: 'terrain-bg', type: 'background', paint: { 'background-color': '#e8e8e8', 'background-opacity': 1 } });
    ensureL({ id: 'terrain', type: 'raster', source: 'terrainSource' });
    ensureL({ id: 'hillshade2', type: 'hillshade', source: 'reliefDem', paint: { 'hillshade-highlight-color': 'rgba(255,255,255,0.6)', 'hillshade-accent-color': 'rgba(0,0,0,0.3)', 'hillshade-exaggeration': 0.15, 'hillshade-shadow-color': 'rgba(0,0,0,0.4)' } }, topLabelId || undefined);

    // ─── Add imagery layers ───
    IMAGERY_OPTIONS.forEach(option => {
        if (option.type === 'base-style') return;

        // Contours are rendered by the terrain shader (no map layers needed)
        if (option.id === 'contours') return;
        if (option.type === 'hillshade') return;

        // Standard raster tile layers
        if (!option.sourceId || !option.layerId || !option.tileTemplate) return;
        map.addSource(option.sourceId, { type: 'raster', tiles: [option.tileTemplate], tileSize: option.tileSize ?? 256, attribution: option.attribution, minzoom: option.minZoom ?? 0, maxzoom: option.maxZoom ?? 19 });
        const paint = { 'raster-fade-duration': TILE_FADE_DURATION };
        if (option.paint && typeof option.paint === 'object') Object.assign(paint, option.paint);
        const state = imageryState.get(option.id);
        paint['raster-opacity'] = clampOpacity(state?.opacity ?? paint['raster-opacity'] ?? 1);
        if (!Number.isFinite(paint['raster-opacity'])) paint['raster-opacity'] = 1;
        map.addLayer({ id: option.layerId, type: 'raster', source: option.sourceId, paint, layout: { visibility: state?.enabled && state.opacity > 0 ? 'visible' : 'none' } }, topLabelId || undefined);
    });

    applyImageryLayerOrder();

    // ─── Add hillshade (skip if already present from style injection) ───
    ensureL({ id: 'hillshade', type: 'hillshade', source: 'hillshadeSource', paint: { 'hillshade-highlight-color': 'rgba(255,255,255,0.9)', 'hillshade-accent-color': 'rgba(0,0,0,0.55)', 'hillshade-exaggeration': 0.23, 'hillshade-shadow-color': 'rgba(0,0,0,0.55)' } }, topLabelId || undefined);

    // ─── Add native terrain analysis layers (skip if already present) ───
    const nativeConfig = { type: 'hillshade', source: 'hillshadeSource', layout: { 'visibility': 'none' }, paint: { 'hillshade-exaggeration': 1.0 } };
    ensureL({ id: 'normalmap', ...nativeConfig }, topLabelId || undefined);
    ensureL({ id: 'snow-native', ...nativeConfig }, topLabelId || undefined);
    ensureL({ id: 'aspect-native', ...nativeConfig }, topLabelId || undefined);
    ensureL({ id: 'slope-native', ...nativeConfig }, topLabelId || undefined);
    ensureL({ id: 'avalanche-native', ...nativeConfig }, topLabelId || undefined);
    ensureL({ id: 'detail-native', type: 'hillshade', source: 'hillshadeSource', layout: { 'visibility': 'none' }, paint: { 'hillshade-exaggeration': 1.0, 'hillshade-illumination-anchor': 'map', 'hillshade-accent-color': '#00ff00' } }, topLabelId || undefined);
    ensureL({ id: 'shadow-native', type: 'hillshade', source: 'shadowDemSource', layout: { 'visibility': 'none' }, paint: { 'hillshade-exaggeration': 1.0, 'hillshade-illumination-anchor': 'map' } }, topLabelId || undefined);

    console.log('[App] Overlays applied');

    // ─── Move vector fill layers above terrain DEM but below hillshade ───
    // Fills (parks, water, forests) sit between terrain raster and hillshade,
    // so hillshade composites relief shading on top of the colored fills.
    const { fills: fillLayerIds, overlay: overlayLayerIds } = getBaseStyleLayerBuckets();
    if (Array.isArray(fillLayerIds)) {
        const hillshadeId = map.getLayer('hillshade') ? 'hillshade' : (topLabelId || undefined);
        fillLayerIds.forEach(id => {
            if (map.getLayer(id)) map.moveLayer(id, hillshadeId);
        });
        console.log(`[App] Repositioned ${fillLayerIds.length} vector fill layers below hillshade`);
    }

    // Contour layers are shader-based (no map layers to reorder)

    // ─── Move overlay LINE layers (roads, waterways, buildings) above contours ───
    // These need to be above hillshade + contours so they're visible on all basemaps.
    // Symbols will be moved to the very top separately (line below).
    if (Array.isArray(overlayLayerIds)) {
        overlayLayerIds.forEach(id => {
            if (map.getLayer(id)) map.moveLayer(id);
        });
        console.log(`[App] Repositioned ${overlayLayerIds.length} overlay layers above contours`);
    }

    // Apply states
    applyImageryState();
    updateImageryControlStates();
    applyHillshadeAppearance(map);

    // GPX layers
    if (ensureGpxLayers) ensureGpxLayers(map, currentGpxData, topLabelId);

    // Move symbols to very top (labels, icons above everything)
    (map.getStyle().layers || []).filter(l => l.type === 'symbol').forEach(l => map.moveLayer(l.id));

    // Debug network
    if (debugNetworkVisible && bringDebugNetworkToFront) bringDebugNetworkToFront();

    // Notify view mode controller
    if (viewModeController?.onTerrainSourcesUpdated) viewModeController.onTerrainSourcesUpdated();

    // Peak labels
    updatePeakLabels(map);
}
