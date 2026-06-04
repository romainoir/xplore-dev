/**
 * layer-stack-manager.js
 *
 * Single ordering policy for basemaps, terrain analysis, contours, routes,
 * labels, photos, and debug overlays. Keep this file independent from the
 * imagery manager so style rebuilds and overlay injection can both reuse it.
 */

export const COLOR_RELIEF_LAYER_ID = 'color-relief';
export const TERRAIN_BACKGROUND_LAYER_ID = 'terrain-bg';

export const CONTOUR_LAYER_IDS = Object.freeze([
    'contour-line-minor',
    'contour-line-major',
    'contour-label'
]);

export const PHOTO_LAYER_IDS = Object.freeze([
    'wikimedia-photos-base',
    'wikimedia-thumbnails-small',
    'wikimedia-thumbnails-large'
]);

export const TERRAIN_NATIVE_LAYER_IDS = Object.freeze([
    'normalmap',
    'snow-native',
    'snow-depth',
    'aspect-native',
    'slope-native',
    'avalanche-native',
    'shadow-v3-coarse',
    'daylight-native',
    'sunrise-window-native',
    'sunset-window-native'
]);

export const ROUTE_LAYER_ORDER_TOP_TO_BOTTOM = Object.freeze([
    'route-pois-labels',
    'route-pois-icons',
    'route-hover-point',
    'waypoint-hover-drag',
    'waypoints',
    'segment-markers',
    'waypoints-hit-area',
    'distance-markers',
    'drag-preview-line',
    'route-line-manual',
    'route-line-manual-bg',
    'route-segment-hover',
    'route-line',
    'route-line-casing',
    'route-pois'
]);

export const BASEMAP_IMAGERY_OPTION_IDS = Object.freeze([
    'osm-background',
    'vector-fills',
    'white-background',
    'ign-scan',
    'ign-cosia',
    'ign-forest-inventory',
    'ign-orthophotos',
    'eox-s2',
    'ign-lidar-hd-mns-shadow',
    'ign-lidar-hd-mnt-shadow'
]);

function uniqueStrings(values = []) {
    const seen = new Set();
    const out = [];
    values.forEach((value) => {
        if (typeof value !== 'string' || !value || seen.has(value)) return;
        seen.add(value);
        out.push(value);
    });
    return out;
}

function currentStyleLayers(map) {
    const layers = map?.getStyle?.()?.layers;
    return Array.isArray(layers) ? layers : [];
}

function layerExists(map, id) {
    return Boolean(id && map?.getLayer?.(id));
}

function safeMoveLayer(map, id, beforeId = null) {
    if (!layerExists(map, id)) return false;
    if (beforeId && (!layerExists(map, beforeId) || beforeId === id)) return false;
    try {
        if (beforeId) map.moveLayer(id, beforeId);
        else map.moveLayer(id);
        return true;
    } catch (_) {
        return false;
    }
}

function moveSequenceBefore(map, layerIds = [], beforeId = null) {
    let moved = 0;
    uniqueStrings(layerIds).forEach((id) => {
        if (safeMoveLayer(map, id, beforeId)) moved += 1;
    });
    return moved;
}

function moveTopToBottom(map, layerIds = []) {
    const existing = uniqueStrings(layerIds).filter(id => layerExists(map, id));
    let previousTopLayerId = null;
    let moved = 0;
    existing.forEach((id) => {
        if (!previousTopLayerId) {
            if (safeMoveLayer(map, id)) moved += 1;
        } else if (safeMoveLayer(map, id, previousTopLayerId)) {
            moved += 1;
        }
        previousTopLayerId = id;
    });
    return moved;
}

function existingLayerIds(map, layerIds = []) {
    return uniqueStrings(layerIds).filter(id => layerExists(map, id));
}

function moveTerrainBackgroundBelowBasemap(map, basemapLayerSequences = []) {
    if (!layerExists(map, TERRAIN_BACKGROUND_LAYER_ID)) return 0;
    const layerOrder = currentStyleLayers(map).map(layer => layer.id);
    const lowestExistingId = (layerIds = []) => existingLayerIds(map, layerIds)
        .map(id => ({ id, index: layerOrder.indexOf(id) }))
        .filter(entry => entry.index >= 0)
        .sort((a, b) => a.index - b.index)[0]?.id || null;
    const anchor = lowestExistingId([
        ...basemapLayerSequences.flat(),
        COLOR_RELIEF_LAYER_ID,
        'hillshade2',
        'hillshade',
        'terrain-derivative-cache',
        ...TERRAIN_NATIVE_LAYER_IDS,
    ]);
    if (!anchor || anchor === TERRAIN_BACKGROUND_LAYER_ID) return 0;
    return safeMoveLayer(map, TERRAIN_BACKGROUND_LAYER_ID, anchor) ? 1 : 0;
}

function getLayerSourceLayer(layer) {
    return String(layer?.sourceLayer || layer?.['source-layer'] || '').toLowerCase();
}

function isReliefBaseLayer(layer) {
    if (!layer || layer.type === 'symbol' || layer.type === 'background') return false;
    const sourceLayer = getLayerSourceLayer(layer);
    if (sourceLayer.includes('route') || sourceLayer.includes('transport') || sourceLayer.includes('road')) return false;
    if (sourceLayer.includes('building') || sourceLayer.includes('boundary')) return false;
    return ['landcover', 'landuse', 'water', 'park', 'aeroway', 'mountain_peak']
        .some(prefix => sourceLayer.startsWith(prefix));
}

export function moveBaseReliefBelowHillshade(map, layerIds = []) {
    const reliefOverlayAnchor = layerExists(map, COLOR_RELIEF_LAYER_ID) ? COLOR_RELIEF_LAYER_ID : null;
    const hillshadeAnchor = layerExists(map, 'hillshade2') ? 'hillshade2' : (layerExists(map, 'hillshade') ? 'hillshade' : null);
    const baseAnchor = reliefOverlayAnchor || hillshadeAnchor;
    if (!baseAnchor) return 0;

    let moved = 0;
    uniqueStrings(layerIds).forEach((id) => {
        if (id === baseAnchor || id === hillshadeAnchor || !layerExists(map, id)) return;
        if (!isReliefBaseLayer(map.getLayer(id))) return;
        if (safeMoveLayer(map, id, baseAnchor)) moved += 1;
    });

    if (reliefOverlayAnchor && layerExists(map, 'hillshade2')) safeMoveLayer(map, reliefOverlayAnchor, 'hillshade2');
    if (layerExists(map, 'hillshade2') && layerExists(map, 'hillshade')) safeMoveLayer(map, 'hillshade2', 'hillshade');
    return moved;
}

export function getTopSymbolLayerId(map, excludedLayerIds = new Set()) {
    const layers = currentStyleLayers(map);
    for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];
        if (layer?.type === 'symbol' && !excludedLayerIds.has(layer.id)) return layer.id;
    }
    return null;
}

export function positionContourLayers(map, aboveLayerIds = null) {
    const layers = currentStyleLayers(map);
    const contourIds = new Set(CONTOUR_LAYER_IDS);
    const configuredAboveIds = Array.isArray(aboveLayerIds)
        ? aboveLayerIds
        : (typeof window !== 'undefined' && Array.isArray(window._xploreContourAboveLayerIds) ? window._xploreContourAboveLayerIds : []);
    const fallbackAboveIds = [
        ...ROUTE_LAYER_ORDER_TOP_TO_BOTTOM,
        ...layers.filter(layer => layer.type === 'symbol' && !contourIds.has(layer.id)).map(layer => layer.id),
        ...PHOTO_LAYER_IDS,
    ];
    const orderedAboveIds = uniqueStrings([...configuredAboveIds, ...fallbackAboveIds])
        .filter(id => layerExists(map, id) && !contourIds.has(id));
    const layerOrder = currentStyleLayers(map).map(layer => layer.id);
    const anchor = orderedAboveIds
        .map(id => ({ id, index: layerOrder.indexOf(id) }))
        .filter(entry => entry.index >= 0)
        .sort((a, b) => a.index - b.index)[0]?.id || null;

    let moved = 0;
    CONTOUR_LAYER_IDS.forEach((id) => {
        if (!layerExists(map, id)) return;
        if (anchor && anchor !== id) {
            if (safeMoveLayer(map, id, anchor)) moved += 1;
        } else if (safeMoveLayer(map, id)) {
            moved += 1;
        }
    });
    return moved;
}

export function applyLayerStackOrder(map, config = {}) {
    if (!map || typeof map.moveLayer !== 'function') return { moved: 0 };

    const {
        basemapLayerSequences = [],
        overlayLayerSequences = [],
        baseStyleOverlayLayerIds = [],
        baseStyleUnderlayLayerIds = [],
        baseStyleFillLayerIds = [],
        bringDebugNetworkToFront = () => { },
    } = config;

    let moved = 0;
    const contourAndPhotoLayers = new Set([...CONTOUR_LAYER_IDS, ...PHOTO_LAYER_IDS]);
    const topLabelId = getTopSymbolLayerId(map, contourAndPhotoLayers);

    for (let i = basemapLayerSequences.length - 1; i >= 0; i--) {
        moved += moveSequenceBefore(map, basemapLayerSequences[i], topLabelId);
    }

    moved += moveTerrainBackgroundBelowBasemap(map, basemapLayerSequences);

    moved += moveSequenceBefore(map, TERRAIN_NATIVE_LAYER_IDS, topLabelId);

    for (let i = overlayLayerSequences.length - 1; i >= 0; i--) {
        moved += moveSequenceBefore(map, overlayLayerSequences[i], topLabelId);
    }

    moved += moveBaseReliefBelowHillshade(map, [
        ...baseStyleFillLayerIds,
        ...baseStyleUnderlayLayerIds,
        ...baseStyleOverlayLayerIds,
    ]);

    moved += moveTopToBottom(map, ROUTE_LAYER_ORDER_TOP_TO_BOTTOM);
    bringDebugNetworkToFront();

    currentStyleLayers(map)
        .filter(layer => layer.type === 'symbol' && !contourAndPhotoLayers.has(layer.id))
        .forEach(layer => {
            if (safeMoveLayer(map, layer.id)) moved += 1;
        });

    PHOTO_LAYER_IDS.forEach((id) => {
        if (safeMoveLayer(map, id)) moved += 1;
    });

    const orderedLayerIds = currentStyleLayers(map).map(layer => layer.id);
    const symbolLayerIds = currentStyleLayers(map)
        .filter(layer => layer.type === 'symbol' && !contourAndPhotoLayers.has(layer.id))
        .map(layer => layer.id);
    const contourAboveLayerIds = uniqueStrings([
        ...TERRAIN_NATIVE_LAYER_IDS,
        ...baseStyleOverlayLayerIds,
        ...ROUTE_LAYER_ORDER_TOP_TO_BOTTOM,
        ...symbolLayerIds,
        ...PHOTO_LAYER_IDS,
    ]);
    if (typeof window !== 'undefined') window._xploreContourAboveLayerIds = contourAboveLayerIds;

    const contourAnchor = contourAboveLayerIds
        .filter(id => layerExists(map, id))
        .map(id => ({ id, index: orderedLayerIds.indexOf(id) }))
        .filter(entry => entry.index >= 0)
        .sort((a, b) => a.index - b.index)[0]?.id || null;
    moved += positionContourLayers(map, contourAnchor ? [contourAnchor] : contourAboveLayerIds);

    PHOTO_LAYER_IDS.forEach((id) => {
        if (safeMoveLayer(map, id)) moved += 1;
    });

    return { moved };
}
