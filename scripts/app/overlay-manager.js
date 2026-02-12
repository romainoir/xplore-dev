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
    CONTOUR_LINE_BASE_OPACITY,
    CONTOUR_TEXT_BASE_OPACITY,
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
 * Apply all overlays: DEM sources, terrain layers, contours, raster imagery, native analysis layers.
 * Called on style.load.
 * @param {maplibregl.Map} map
 * @param {object} deps - shared dependencies
 */
export function applyOverlays(map, deps = {}) {
    const {
        imageryState,
        demSource,
        applyImageryState,
        updateImageryControlStates,
        applyImageryLayerOrder,
        ensureGpxLayers,
        currentGpxData,
        debugNetworkVisible,
        bringDebugNetworkToFront,
        viewModeController,
    } = deps;

    const rmL = id => { if (map.getLayer(id)) map.removeLayer(id); };
    const rmS = id => { if (map.getSource(id)) map.removeSource(id); };

    // Find top symbol layer for insertion
    const liveLayers = map.getStyle().layers || [];
    let topLabelId = null;
    for (let i = liveLayers.length - 1; i >= 0; i--) {
        if (liveLayers[i].type === 'symbol') { topLabelId = liveLayers[i].id; break; }
    }

    // Remove existing overlay layers
    rmL('hillshade'); rmL('hillshade2'); rmL('terrain-bg');
    IMAGERY_OPTIONS.forEach(option => {
        const layerIds = [];
        if (typeof option.layerId === 'string') layerIds.push(option.layerId);
        if (Array.isArray(option.linkedLayerIds)) option.linkedLayerIds.forEach(id => { if (typeof id === 'string') layerIds.push(id); });
        layerIds.forEach(rmL);
    });

    // Remove existing sources
    rmS('contours'); rmS('hillshadeSource'); rmS('reliefDem'); rmS('terrainSource');
    IMAGERY_OPTIONS.forEach(option => {
        const sourceIds = [];
        if (typeof option.sourceId === 'string') sourceIds.push(option.sourceId);
        if (Array.isArray(option.sourceIds)) option.sourceIds.forEach(id => { if (typeof id === 'string') sourceIds.push(id); });
        sourceIds.forEach(rmS);
    });

    // ─── Add DEM sources ───
    const demConfig = { type: 'raster-dem', tiles: [MAPTERHORN_TILE_URL], encoding: 'terrarium', tileSize: 512, attribution: MAPTERHORN_ATTRIBUTION };
    map.addSource('terrainSource', { ...demConfig, maxzoom: DEM_SOURCE_MAX_ZOOM });
    map.addSource('hillshadeSource', { ...demConfig, maxzoom: DEM_SOURCE_MAX_ZOOM });
    map.addSource('shadowDemSource', { ...demConfig, maxzoom: SHADOW_DEM_MAX_ZOOM, tileZoomOffset: 0 });
    map.addSource('reliefDem', { ...demConfig, maxzoom: DEM_SOURCE_MAX_ZOOM });

    // Background (covers hillshade tile gaps)
    map.addLayer({ id: 'terrain-bg', type: 'background', paint: { 'background-color': '#e8e8e8', 'background-opacity': 1 } });
    map.addLayer({ id: 'terrain', type: 'raster', source: 'terrainSource' });
    map.addLayer({ id: 'hillshade2', type: 'hillshade', source: 'reliefDem', paint: { 'hillshade-highlight-color': 'rgba(255,255,255,0.6)', 'hillshade-accent-color': 'rgba(0,0,0,0.3)', 'hillshade-exaggeration': 0.15, 'hillshade-shadow-color': 'rgba(0,0,0,0.4)' } }, topLabelId || undefined);

    // ─── Add imagery layers ───
    IMAGERY_OPTIONS.forEach(option => {
        if (option.type === 'base-style') return;

        if (option.type === 'contours') {
            const state = imageryState.get(option.id);
            const opacity = clampOpacity(state?.opacity ?? option.defaultOpacity ?? 1);
            const visible = Boolean(state?.enabled && opacity > 0);
            if (!map.getSource('contours')) {
                map.addSource('contours', { type: 'vector', tiles: [demSource.contourProtocolUrl({ multiplier: 1, thresholds: { 11: [60, 300], 12: [30, 150], 13: [30, 150], 14: [15, 60], 15: [6, 30] }, elevationKey: 'ele', levelKey: 'level', contourLayer: 'contours' })], maxzoom: 16 });
                map.addLayer({ id: 'contours', type: 'line', source: 'contours', 'source-layer': 'contours', layout: { 'line-join': 'round', visibility: visible ? 'visible' : 'none' }, paint: { 'line-color': 'rgba(0,0,0,0.55)', 'line-width': ['match', ['get', 'level'], 1, 1, 0.5], 'line-opacity': scaleExpression(CONTOUR_LINE_BASE_OPACITY, opacity) } }, topLabelId || undefined);
                map.addLayer({ id: 'contour-text', type: 'symbol', source: 'contours', 'source-layer': 'contours', filter: ['>', ['get', 'level'], 0], layout: { 'symbol-placement': 'line', 'text-anchor': 'center', 'text-size': 10, 'text-field': ['concat', ['number-format', ['get', 'ele'], { 'maximumFractionDigits': 0 }], ' m'], 'text-font': ['Noto Sans Bold'], visibility: visible ? 'visible' : 'none' }, paint: { 'text-halo-color': 'white', 'text-halo-width': 1, 'text-opacity': scaleExpression(CONTOUR_TEXT_BASE_OPACITY, opacity) } }, topLabelId || undefined);
            }
            return;
        }
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

    // ─── Add hillshade ───
    map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'hillshadeSource', paint: { 'hillshade-highlight-color': 'rgba(255,255,255,0.9)', 'hillshade-accent-color': 'rgba(0,0,0,0.55)', 'hillshade-exaggeration': 0.23, 'hillshade-shadow-color': 'rgba(0,0,0,0.55)' } }, topLabelId || undefined);

    // ─── Add native terrain analysis layers ───
    const nativeConfig = { type: 'hillshade', source: 'hillshadeSource', layout: { 'visibility': 'none' }, paint: { 'hillshade-exaggeration': 1.0 } };
    map.addLayer({ id: 'normalmap', ...nativeConfig }, topLabelId || undefined);
    map.addLayer({ id: 'snow-native', ...nativeConfig }, topLabelId || undefined);
    map.addLayer({ id: 'aspect-native', ...nativeConfig }, topLabelId || undefined);
    map.addLayer({ id: 'slope-native', ...nativeConfig }, topLabelId || undefined);
    map.addLayer({ id: 'avalanche-native', ...nativeConfig }, topLabelId || undefined);
    map.addLayer({ id: 'detail-native', type: 'hillshade', source: 'hillshadeSource', layout: { 'visibility': 'none' }, paint: { 'hillshade-exaggeration': 1.0, 'hillshade-illumination-anchor': 'map', 'hillshade-accent-color': '#00ff00' } }, topLabelId || undefined);
    map.addLayer({ id: 'shadow-native', type: 'hillshade', source: 'shadowDemSource', layout: { 'visibility': 'none' }, paint: { 'hillshade-exaggeration': 1.0, 'hillshade-illumination-anchor': 'map' } }, topLabelId || undefined);

    console.log('[App] Native terrain layers added (normalmap, aspect, slope, avalanche)');

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

    // ─── Move contour layers above hillshade ───
    if (map.getLayer('contours')) map.moveLayer('contours');
    if (map.getLayer('contour-text')) map.moveLayer('contour-text');

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
