/**
 * imagery-manager.js — Imagery layer panel: option definitions, state, UI rendering,
 * drag-and-drop reordering, group toggles, opacity sliders, toolbox open/close, analytical legends.
 */

import {
    S2C_URL,
    S2_FADE_DURATION,
    S2_OPACITY,
    TILE_FADE_DURATION,
} from '../config/map-config.js';
import { setWikimediaPhotosEnabled } from '../map/wikimedia-photos.js';

// ─── Attribution constants ───
const IGN_ATTRIBUTION = '<a href="https://www.ign.fr/">© IGN</a>';
const EOX_ATTRIBUTION = '<a href="https://www.eox.at/">© EOX</a>';
const WMTS_PREVIEW_COORDS = Object.freeze({ z: 14, x: 8508, y: 5911 });
export const DEM_SOURCE_MAX_ZOOM = 17;
export const SHADOW_DEM_MAX_ZOOM = 11;

function createIgnTileTemplate(layerName, format = 'image/png') {
    const encodedFormat = encodeURIComponent(format);
    const encodedLayer = encodeURIComponent(layerName);
    return `https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=${encodedLayer}&STYLE=normal&FORMAT=${encodedFormat}&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;
}

function createTilePreviewUrl(template, coords = WMTS_PREVIEW_COORDS) {
    if (typeof template !== 'string' || !template.length) return null;
    const replacements = [
        { token: /\{z\}/gi, value: coords?.z ?? WMTS_PREVIEW_COORDS.z },
        { token: /\{x\}/gi, value: coords?.x ?? WMTS_PREVIEW_COORDS.x },
        { token: /\{y\}/gi, value: coords?.y ?? WMTS_PREVIEW_COORDS.y }
    ];
    return replacements.reduce((acc, entry) => acc.replace(entry.token, entry.value), template);
}

// ─── IMAGERY_OPTIONS ───
export const IMAGERY_OPTIONS = Object.freeze([
    { id: 'shadow', label: 'Shadow', type: 'native-layer', layerId: 'shadow-native', previewImage: './data/icons_Xmap/shadow.png', defaultOpacity: 1.0, defaultVisible: false },
    {
        id: 'contours',
        label: 'Contours',
        type: 'native-layer',
        layerId: 'contours-native',
        previewImage: './data/contour.png',
        defaultVisible: true,
        defaultOpacity: 1.0,
        multiplier: 1.0,
        thresholds: {
            0: [10, 10],
            7: [10, 10],
            10: [10, 10],
            12: [10, 10],
            14: [10, 10]
        }
    },
    { id: 'osm-features', label: 'OSM Features', type: 'osm-overlay', previewImage: './data/OSM_vector.png', defaultOpacity: 1, defaultVisible: true },
    { id: 'wikimedia-photos', label: 'Wikimedia Photos', type: 'wikimedia', previewImage: './data/icons_Xmap/camera.png', defaultVisible: false, defaultOpacity: 1, linkedLayerIds: ['wikimedia-photos-layer', 'wikimedia-photos-clusters', 'wikimedia-photos-cluster-count', 'wikimedia-photos-large-clusters', 'wikimedia-thumbnails-cluster', 'wikimedia-thumbnails-single'] },
    { id: 'strava-heatmap-all', label: 'Strava Heatmap (All)', sourceId: 'strava-heatmap-all', layerId: 'strava-heatmap-all', tileTemplate: 'https://atlas.hartakji.com/strava-heatmap-all/{z}/{x}/{y}', tileSize: 256, minZoom: 0, maxZoom: 15, attribution: '<a href="https://www.strava.com">© Strava</a>', defaultVisible: false, defaultOpacity: 1 },
    { id: 'strava-winter', label: 'Strava Winter', sourceId: 'strava-winter', layerId: 'strava-winter', tileTemplate: 'https://atlas.hartakji.com/strava-winter/{z}/{x}/{y}', tileSize: 256, minZoom: 0, maxZoom: 15, attribution: '<a href="https://www.strava.com">© Strava</a>', defaultVisible: false, defaultOpacity: 1 },
    { id: 'strava-backcountry-ski', label: 'Strava Backcountry Ski', sourceId: 'strava-backcountry-ski', layerId: 'strava-backcountry-ski', tileTemplate: 'https://atlas.hartakji.com/strava-backcountry-ski/{z}/{x}/{y}', tileSize: 256, minZoom: 0, maxZoom: 15, attribution: '<a href="https://www.strava.com">© Strava</a>', defaultVisible: false, defaultOpacity: 1 },
    { id: 'strava-cycling', label: 'Strava Cycling', sourceId: 'strava-cycling', layerId: 'strava-cycling', tileTemplate: 'https://atlas.hartakji.com/strava-cycling/{z}/{x}/{y}', tileSize: 256, minZoom: 0, maxZoom: 15, attribution: '<a href="https://www.strava.com">© Strava</a>', defaultVisible: false, defaultOpacity: 1 },
    { id: 'strava-run', label: 'Strava Run', sourceId: 'strava-run', layerId: 'strava-run', tileTemplate: 'https://atlas.hartakji.com/strava-run/{z}/{x}/{y}', tileSize: 256, minZoom: 0, maxZoom: 15, attribution: '<a href="https://www.strava.com">© Strava</a>', defaultVisible: false, defaultOpacity: 1 },
    { id: 'ign-traces-hivernales', label: 'Traces Rando Hivernales', sourceId: 'ign-traces-hivernales', layerId: 'ign-traces-hivernales', tileTemplate: 'https://data.geopf.fr/wmts?layer=TRACES.RANDO.HIVERNALE&style=normal&tilematrixset=PM&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image%2Fpng&TileMatrix={z}&TileCol={x}&TileRow={y}', tileSize: 256, minZoom: 0, maxZoom: 15, attribution: IGN_ATTRIBUTION, defaultVisible: false, defaultOpacity: 1 },
    { id: 'detail-shading', label: 'Detail Shading', type: 'native-layer', layerId: 'detail-native', previewImage: './data/icons_Xmap/normal.png', defaultOpacity: 1.0, defaultVisible: false },
    { id: 'aspect', label: 'Aspect (Orientation)', type: 'native-layer', layerId: 'aspect-native', previewImage: './data/icons_Xmap/aspect.png', defaultOpacity: 1.0, defaultVisible: false },
    { id: 'slope', label: 'Slope', type: 'native-layer', layerId: 'slope-native', previewImage: './data/icons_Xmap/slope.png', defaultOpacity: 1.0, defaultVisible: false },
    { id: 'avalanche', label: 'Avalanche Zones', type: 'native-layer', layerId: 'avalanche-native', previewImage: './data/icons_Xmap/avalanche.png', defaultOpacity: 1.0, defaultVisible: false },
    { id: 'snow', label: 'Snow', type: 'native-layer', layerId: 'snow-native', previewImage: './data/icons_Xmap/snow.png', defaultOpacity: 1.0, defaultVisible: false },
    { id: 'snow-depth', label: 'Snow Depth (Alps)', sourceId: 'snow-depth', layerId: 'snow-depth', tileTemplate: 'https://p20.cosmos-project.ch/BfOlLXvmGpviW0YojaYiRqsT9NHEYdn88fpHZlr_map/gmaps/sd20alps@epsg3857/{z}/{x}/{y}.png', tileSize: 256, minZoom: 0, maxZoom: 12, attribution: '© Data from Exolab', defaultVisible: false, defaultOpacity: 1 },
    { id: 'ign-scan', label: 'IGN Scan (Topo)', sourceId: 'ign-scan', layerId: 'ign-scan', tileTemplate: 'https://data.geopf.fr/private/wmts?apikey=ign_scan_ws&layer=GEOGRAPHICALGRIDSYSTEMS.MAPS&style=normal&tilematrixset=PM&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image%2Fjpeg&TileMatrix={z}&TileCol={x}&TileRow={y}', tileSize: 256, minZoom: 0, maxZoom: 15, attribution: IGN_ATTRIBUTION, defaultVisible: false, defaultOpacity: 1 },
    { id: 'ign-cosia', label: 'IGN Kosia 2021-2023', sourceId: 'ign-cosia', layerId: 'ign-cosia', tileTemplate: createIgnTileTemplate('IGNF_COSIA_2021-2023', 'image/png'), tileSize: 256, attribution: IGN_ATTRIBUTION, defaultVisible: false, defaultOpacity: 1 },
    { id: 'ign-forest-inventory', label: 'IGN Forest Inventory', sourceId: 'ign-forest-inventory', layerId: 'ign-forest-inventory', tileTemplate: createIgnTileTemplate('LANDCOVER.FORESTINVENTORY.V2', 'image/png'), tileSize: 256, attribution: IGN_ATTRIBUTION, defaultVisible: false, defaultOpacity: 1 },
    { id: 'ign-orthophotos', label: 'IGN Orthophotos', sourceId: 'ign-orthophotos', layerId: 'ign-orthophotos', tileTemplate: createIgnTileTemplate('ORTHOIMAGERY.ORTHOPHOTOS.BDORTHO', 'image/jpeg'), tileSize: 256, attribution: IGN_ATTRIBUTION, defaultVisible: false, defaultOpacity: 1, previewImage: './data/france.png' },
    // { id: 'eox-s2', label: 'EOX Satellite', sourceId: 's2cloudless', layerId: 's2cloudless', tileTemplate: S2C_URL, tileSize: 256, attribution: EOX_ATTRIBUTION, defaultVisible: false, defaultOpacity: 1, paint: { 'raster-opacity': S2_OPACITY, 'raster-fade-duration': S2_FADE_DURATION } },
    { id: 'eox-s2', label: 'World Imagery', sourceId: 'world-imagery', layerId: 'world-imagery', tileTemplate: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', tileSize: 256, attribution: '© Esri', defaultVisible: false, defaultOpacity: 1, previewImage: './data/worldwide.png' },
    { id: 'ign-lidar-hd-mns-shadow', label: 'MNS', sourceId: 'ign-lidar-hd-mns-shadow', layerId: 'ign-lidar-hd-mns-shadow', tileTemplate: createIgnTileTemplate('IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW', 'image/png'), tileSize: 256, attribution: IGN_ATTRIBUTION, defaultVisible: false, defaultOpacity: 1 },
    { id: 'ign-lidar-hd-mnt-shadow', label: 'MNT', sourceId: 'ign-lidar-hd-mnt-shadow', layerId: 'ign-lidar-hd-mnt-shadow', tileTemplate: createIgnTileTemplate('IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW', 'image/png'), tileSize: 256, attribution: IGN_ATTRIBUTION, defaultVisible: false, defaultOpacity: 1 },
    { id: 'white-background', label: 'White Background', type: 'background', layerId: 'background', hiddenControl: true, defaultVisible: false, paint: { 'background-color': '#ffffff' } },
    { id: 'vector-fills', label: 'Vector Fills', type: 'vector-fills', hiddenControl: true, defaultVisible: true, defaultOpacity: 1 },
]);

// ─── LAYER_GROUPS ───
export const LAYER_GROUPS = Object.freeze([
    { id: 'sun-analysis', label: 'Sun Analysis', exclusive: true, members: ['shadow'] },
    { id: 'vector', label: 'Vector', exclusive: false, members: ['contours', 'osm-features'] },
    { id: 'wikimedia-photos', label: 'Wikimedia Photos', exclusive: true, members: ['wikimedia-photos'] },
    { id: 'heatmap', label: 'Heatmap', exclusive: true, members: ['strava-heatmap-all', 'strava-winter', 'strava-backcountry-ski', 'strava-cycling', 'strava-run', 'ign-traces-hivernales'] },
    { id: 'terrain-analysis', label: 'Terrain Analysis', exclusive: true, members: ['aspect', 'slope', 'avalanche'] },
    { id: 'snow', label: 'Snow Analysis', exclusive: false, members: ['snow', 'snow-depth'] },
    { id: 'ign-scan', label: 'IGN Scan (Topo)', exclusive: true, members: ['ign-scan'] },
    { id: 'land-cover', label: 'Land Cover', exclusive: true, members: ['ign-cosia', 'ign-forest-inventory'] },
    { id: 'satellite', label: 'Satellite', exclusive: true, members: ['ign-orthophotos', 'eox-s2'], previewImage: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/10/364/526' },
    { id: 'lidar-hd', label: 'Lidar HD', exclusive: true, members: ['ign-lidar-hd-mns-shadow', 'ign-lidar-hd-mnt-shadow'] },
]);

// ─── Derived lookups ───
export const LAYER_GROUP_BY_MEMBER_ID = new Map();
LAYER_GROUPS.forEach(group => {
    group.members.forEach(memberId => LAYER_GROUP_BY_MEMBER_ID.set(memberId, group));
});

export const IMAGERY_LAYER_IDS = new Set(
    IMAGERY_OPTIONS.flatMap(option => {
        const ids = [];
        if (typeof option.layerId === 'string') ids.push(option.layerId);
        if (Array.isArray(option.linkedLayerIds)) option.linkedLayerIds.forEach(id => { if (typeof id === 'string') ids.push(id); });
        return ids;
    })
);

export const ROUTE_LAYER_IDS = new Set([
    'route-line', 'route-line-casing', 'route-segment-hover', 'distance-markers',
    'waypoints', 'waypoints-hit-area', 'waypoint-hover-drag', 'route-hover-point', 'segment-markers'
]);

export const ROUTE_LAYER_ORDER_TOP_TO_BOTTOM = Object.freeze([
    'route-hover-point', 'waypoint-hover-drag', 'waypoints', 'segment-markers',
    'waypoints-hit-area', 'distance-markers', 'route-segment-hover', 'route-line', 'route-line-casing'
]);

export const IMAGERY_OPTIONS_BY_ID = new Map(IMAGERY_OPTIONS.map(o => [o.id, o]));
export const HILLSHADE_OPTION_ID = 'hillshade';

// ─── Expression utilities ───
export const CONTOUR_LINE_BASE_OPACITY = Object.freeze([
    'interpolate', ['linear'], ['zoom'], 13.4, 0, 13.5, 0.45, 15, 0.85, 17, 1
]);

export const CONTOUR_TEXT_BASE_OPACITY = Object.freeze([
    'interpolate', ['linear'], ['zoom'], 13.4, 0, 13.6, 0.5, 14.2, 0.9
]);

export function cloneExpression(expression) {
    if (Array.isArray(expression)) return expression.map(item => cloneExpression(item));
    if (expression && typeof expression === 'object') {
        return Object.fromEntries(Object.entries(expression).map(([k, v]) => [k, cloneExpression(v)]));
    }
    return expression;
}

export function scaleExpression(expression, factor) {
    if (typeof expression === 'number') return expression * factor;
    if (!Array.isArray(expression) || expression.length === 0) return ['*', cloneExpression(expression), factor];
    const [operator, ...rest] = expression;
    if (operator === 'interpolate') {
        if (rest.length < 2) return ['*', cloneExpression(expression), factor];
        const [curve, input, ...stops] = rest;
        const scaledStops = stops.map((value, index) => index % 2 === 0 ? cloneExpression(value) : scaleExpression(value, factor));
        return ['interpolate', cloneExpression(curve), cloneExpression(input), ...scaledStops];
    }
    if (operator === 'step') {
        if (rest.length < 1) return ['*', cloneExpression(expression), factor];
        const [input, ...stops] = rest;
        if (!stops.length) return ['*', cloneExpression(expression), factor];
        const [baseOutput, ...remaining] = stops;
        const scaledStops = [scaleExpression(baseOutput, factor)];
        for (let i = 0; i < remaining.length; i += 2) {
            if (typeof remaining[i] === 'undefined' || typeof remaining[i + 1] === 'undefined') break;
            scaledStops.push(cloneExpression(remaining[i]));
            scaledStops.push(scaleExpression(remaining[i + 1], factor));
        }
        return ['step', cloneExpression(input), ...scaledStops];
    }
    return ['*', cloneExpression(expression), factor];
}

export function clampOpacity(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) return 0;
    return Math.min(Math.max(value, 0), 1);
}

export function setLayerSequenceOpacity(map, layerIds, alpha) {
    if (!map || !Array.isArray(layerIds)) return;
    const isVisible = alpha > 0;
    const visibility = isVisible ? 'visible' : 'none';
    layerIds.forEach((id) => {
        if (!map.getLayer(id)) return;
        try { map.setLayoutProperty(id, 'visibility', visibility); } catch (_) { }
        if (!isVisible) return;
        const layer = map.getLayer(id);
        const type = layer.type;
        const setIf = (prop, value) => {
            try { const cur = map.getPaintProperty(id, prop); if (cur !== undefined) map.setPaintProperty(id, prop, value); } catch (_) { }
        };
        const setForce = (prop, value) => {
            try { map.setPaintProperty(id, prop, value); } catch (_) { }
        };
        switch (type) {
            case 'background': setIf('background-opacity', alpha); break;
            case 'fill': setForce('fill-opacity', alpha); break;
            case 'line': setIf('line-opacity', alpha); break;
            case 'symbol': setIf('text-opacity', alpha); setIf('icon-opacity', alpha); break;
            case 'circle': setIf('circle-opacity', alpha); break;
            case 'fill-extrusion': setIf('fill-extrusion-opacity', alpha); break;
            case 'heatmap': setIf('heatmap-opacity', alpha); break;
            case 'raster': setIf('raster-opacity', alpha); break;
        }
    });
}

// ─── Hillshade method support ───
export function getAvailableHillshadeMethods() {
    const styleSpec = typeof maplibregl !== 'undefined' ? maplibregl?.styleSpec : null;
    const methodDefinition = styleSpec?.paint_hillshade?.['hillshade-method'];
    const { values } = methodDefinition ?? {};
    if (!values) return [];
    if (Array.isArray(values)) {
        return values.map(entry => {
            if (typeof entry === 'string') return entry;
            if (entry && typeof entry === 'object' && 'value' in entry) return entry.value;
            return null;
        }).filter(v => typeof v === 'string' && v.length);
    }
    if (typeof values === 'object') return Object.keys(values).filter(k => typeof k === 'string' && k.length);
    return [];
}

export function formatHillshadeMethodName(method) {
    if (typeof method !== 'string' || !method.length) return '';
    const overrides = { standard: 'Standard', basic: 'Basic', combined: 'Combined', igor: 'Igor', multidirectional: 'Multi-directional', 'multi-directional': 'Multi-directional', mapbox: 'Mapbox', default: 'Default' };
    if (overrides[method.toLowerCase()]) return overrides[method.toLowerCase()];
    return method.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Create the imagery manager — call after map is created.
 * @param {maplibregl.Map} map
 * @param {object} deps - shared dependencies
 * @returns {object} imagery manager API
 */
export function createImageryManager(map, deps = {}) {
    const {
        baseStyleOverlayLayerIds = [],
        baseStyleUnderlayLayerIds = [],
        baseStyleFillLayerIds = [],
        bringDebugNetworkToFront = () => { },
        updateAnalyticalLegends = () => { },
    } = deps;

    // ─── State ───
    const imageryState = new Map();
    const imageryControls = new Map();

    IMAGERY_OPTIONS.forEach((option, index) => {
        const paintOpacity = option?.paint && typeof option.paint['raster-opacity'] === 'number' ? clampOpacity(option.paint['raster-opacity']) : 1;
        const defaultOpacity = typeof option.defaultOpacity === 'number' ? clampOpacity(option.defaultOpacity) : paintOpacity;
        imageryState.set(option.id, { enabled: option.defaultVisible ?? index === 0, opacity: defaultOpacity });
    });

    // Expose globals for the terrain shader to read contour state
    window.imageryState = imageryState;
    const contourOption = IMAGERY_OPTIONS.find(o => o.id === 'contours');
    if (contourOption?.thresholds) window.contourThresholds = contourOption.thresholds;
    window.contourConfig = {
        color: 'rgba(139, 90, 43, 0.2)',   // brown, 20% opacity
    };

    const SHADOW_TOOLBOX_IDS = ['shadow', 'detail-shading'];
    const TERRAIN_TOOLBOX_IDS = ['aspect', 'slope', 'avalanche'];
    const SNOW_TOOLBOX_IDS = ['snow', 'snow-depth'];

    // Build imageryOrder with group members kept contiguous
    let imageryOrder = [];
    const processedIds = new Set();
    IMAGERY_OPTIONS.forEach((option) => {
        if (processedIds.has(option.id)) return;
        if (TERRAIN_TOOLBOX_IDS.includes(option.id)) return;
        if (SNOW_TOOLBOX_IDS.includes(option.id)) return;
        if (SHADOW_TOOLBOX_IDS.includes(option.id)) return;
        const group = LAYER_GROUP_BY_MEMBER_ID.get(option.id);
        // Debug groups are always included; visibility handled by settings panel
        if (group) {
            group.members.forEach(memberId => {
                if (!processedIds.has(memberId) && !TERRAIN_TOOLBOX_IDS.includes(memberId) && !SNOW_TOOLBOX_IDS.includes(memberId) && !SHADOW_TOOLBOX_IDS.includes(memberId)) {
                    imageryOrder.push(memberId);
                    processedIds.add(memberId);
                }
            });
        } else {
            imageryOrder.push(option.id);
            processedIds.add(option.id);
        }
    });



    // ─── Contour state (shader-based, no map layers needed) ───
    // Contours are rendered by the terrain shader. Toggle updates window.imageryState
    // which is read by terrain_program.ts on every frame.

    // ─── Vector toggle ───
    const vectorToggle = document.getElementById('vectorToggle');
    if (vectorToggle) {
        const vectorVisible = localStorage.getItem('xplore_vector_visible') !== 'false';
        vectorToggle.checked = vectorVisible;
        const applyVectorVisibility = (visible) => {
            const style = map.getStyle();
            if (!style) return;
            const vectorSourceIds = new Set();
            for (const [id, src] of Object.entries(style.sources || {})) {
                if (src.type === 'vector') vectorSourceIds.add(id);
            }
            (style.layers || []).forEach((layer) => {
                if (layer.source && vectorSourceIds.has(layer.source)) {
                    map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
                }
            });
        };
        if (!vectorVisible) map.once('style.load', () => applyVectorVisibility(false));
        vectorToggle.addEventListener('change', () => {
            const visible = vectorToggle.checked;
            localStorage.setItem('xplore_vector_visible', String(visible));
            applyVectorVisibility(visible);
        });
    }

    // ─── Core functions ───

    function applyImageryLayerOrder() {
        if (!map || typeof map.moveLayer !== 'function') return;
        const style = typeof map.getStyle === 'function' ? map.getStyle() : null;
        const layers = style?.layers;
        if (!Array.isArray(layers)) return;
        let topLabelId = null;
        for (let i = layers.length - 1; i >= 0; i--) {
            if (layers[i]?.type === 'symbol') { topLabelId = layers[i].id; break; }
        }
        // Basemap imagery IDs that should render BELOW terrain analysis
        const basemapIds = new Set([
            'osm-background', 'vector-fills', 'white-background',
            'ign-scan', 'ign-cosia', 'ign-forest-inventory', 'ign-orthophotos', 'eox-s2',
            'ign-lidar-hd-mns-shadow', 'ign-lidar-hd-mnt-shadow'
        ]);

        const basemapEntries = [];
        const overlayEntries = [];
        imageryOrder.forEach((id) => {
            let layerSequence = [];
            if (id === 'osm-features') {
                layerSequence = baseStyleOverlayLayerIds.filter(l => { const layer = map.getLayer(l); return layer && layer.type !== 'symbol'; });
            } else if (id === 'osm-background') {
                layerSequence = baseStyleUnderlayLayerIds.filter(l => map.getLayer(l));
            } else {
                const option = IMAGERY_OPTIONS_BY_ID.get(id);
                if (option) {
                    if (typeof option.layerId === 'string' && map.getLayer(option.layerId)) layerSequence.push(option.layerId);
                    if (Array.isArray(option.linkedLayerIds)) {
                        option.linkedLayerIds.forEach(linkedId => { if (typeof linkedId === 'string' && map.getLayer(linkedId)) layerSequence.push(linkedId); });
                    }
                }
            }
            if (layerSequence.length) {
                if (basemapIds.has(id)) basemapEntries.push({ layerSequence });
                else overlayEntries.push({ layerSequence });
            }
        });

        // 1. Basemap imagery (ortho, satellite, IGN scan, etc.) — lowest
        for (let i = basemapEntries.length - 1; i >= 0; i--) {
            const seq = basemapEntries[i].layerSequence;
            for (let j = 0; j < seq.length; j++) {
                if (seq[j] && seq[j] !== topLabelId) map.moveLayer(seq[j], topLabelId);
            }
        }

        // 2. Terrain analysis & snow layers — above basemaps
        const terrainNativeLayers = ['normalmap', 'snow-native', 'snow-depth', 'aspect-native', 'slope-native', 'avalanche-native', 'detail-native', 'shadow-native'];
        if (topLabelId) {
            terrainNativeLayers.forEach(layerId => { if (map.getLayer(layerId)) map.moveLayer(layerId, topLabelId); });
        }

        // 3. Footpath overlays (OSM features, contours, heatmaps, wikimedia) — above terrain
        for (let i = overlayEntries.length - 1; i >= 0; i--) {
            const seq = overlayEntries[i].layerSequence;
            for (let j = 0; j < seq.length; j++) {
                if (seq[j] && seq[j] !== topLabelId) map.moveLayer(seq[j], topLabelId);
            }
        }


        const routeLayers = ROUTE_LAYER_ORDER_TOP_TO_BOTTOM.filter(layerId => map.getLayer(layerId));
        let previousTopLayerId = null;
        for (let i = 0; i < routeLayers.length; i++) {
            if (!routeLayers[i]) continue;
            if (!previousTopLayerId) { map.moveLayer(routeLayers[i]); }
            else if (routeLayers[i] !== previousTopLayerId) { map.moveLayer(routeLayers[i], previousTopLayerId); }
            previousTopLayerId = routeLayers[i];
        }

        bringDebugNetworkToFront();

        // Move base map symbol layers (OSM labels etc.) to top — but NOT contour or wikimedia layers
        const contourAndPhotoLayers = new Set([
            'contour-line-minor', 'contour-line-major', 'contour-label',
            'wikimedia-photos-cluster', 'wikimedia-photos', 'wikimedia-cluster-count',
            'wikimedia-thumbnails-cluster', 'wikimedia-thumbnails-single'
        ]);
        (map.getStyle().layers || []).filter(l => l.type === 'symbol' && !contourAndPhotoLayers.has(l.id)).forEach(l => {
            if (map.getLayer(l.id)) map.moveLayer(l.id);
        });

        // Contour labels: move right after contour lines so they stay together
        ['contour-line-minor', 'contour-line-major', 'contour-label'].forEach(id => {
            if (map.getLayer(id)) map.moveLayer(id);
        });

        // Wikimedia photos: always on top of everything
        ['wikimedia-photos-cluster', 'wikimedia-photos', 'wikimedia-cluster-count',
            'wikimedia-thumbnails-cluster', 'wikimedia-thumbnails-single'].forEach(id => {
                if (map.getLayer(id)) map.moveLayer(id);
            });
    }

    // ─── Toolbox open/close ───
    let setTerrainToolboxOpen, setSnowToolboxOpen, setShadowToolboxOpen;

    function updateImageryControlStates() {
        const activeGroupIds = new Set();
        imageryControls.forEach((control, id) => {
            const state = imageryState.get(id);
            const isActive = Boolean(state?.enabled && state.opacity > 0);
            if (control.button) {
                control.button.classList.toggle('active', isActive);
                control.button.setAttribute('aria-pressed', String(isActive));
            }
            if (control.isGroupMember) {
                if (isActive) { const group = LAYER_GROUP_BY_MEMBER_ID.get(id); if (group) activeGroupIds.add(group.id); }
            } else {
                if (control.container) control.container.classList.toggle('active', isActive);
            }
            if (control.slider && state) control.slider.value = String(state.opacity);
            if (control.sliderWrapper) control.sliderWrapper.classList.toggle('active', isActive);
        });

        // Dynamic background for Analysis Toggles
        [
            { btnId: 'terrainToolboxToggle', layerIds: ['aspect', 'slope', 'avalanche'] },
            { btnId: 'shadowToolboxToggle', layerIds: ['shadow', 'detail-shading'] },
            { btnId: 'snowToolboxToggle', layerIds: ['snow', 'snow-depth'] }
        ].forEach(config => {
            const btn = document.getElementById(config.btnId);
            if (!btn) return;
            const activeId = config.layerIds.find(id => { const s = imageryState.get(id); return Boolean(s?.enabled && s.opacity > 0); });
            let thumb = btn.querySelector('.map-action-btn__thumb');
            if (!thumb) { thumb = document.createElement('div'); thumb.className = 'map-action-btn__thumb'; btn.prepend(thumb); }
            if (activeId) {
                const option = IMAGERY_OPTIONS_BY_ID.get(activeId);
                if (option?.previewImage) { thumb.style.backgroundImage = `url(${option.previewImage})`; btn.classList.add('has-active-layer'); }
                else { thumb.style.backgroundImage = ''; btn.classList.remove('has-active-layer'); }
            } else { thumb.style.backgroundImage = ''; btn.classList.remove('has-active-layer'); }
        });
    }

    function applyImageryState() {
        IMAGERY_OPTIONS.forEach((option) => {
            const state = imageryState.get(option.id);
            const opacity = clampOpacity(state?.opacity ?? 0);
            const visible = Boolean(state?.enabled && opacity > 0);
            if (option.type === 'osm-overlay') { setLayerSequenceOpacity(map, baseStyleOverlayLayerIds, visible ? opacity : 0); return; }
            if (option.type === 'osm-background') { setLayerSequenceOpacity(map, baseStyleUnderlayLayerIds, visible ? opacity : 0); return; }
            if (option.type === 'vector-fills') { setLayerSequenceOpacity(map, baseStyleFillLayerIds, visible ? opacity : 0); return; }
            // Shader-based contours: state is read directly from window.imageryState by terra_program.ts
            if (option.type === 'hillshade') return;
            if (option.type === 'wikimedia') { setWikimediaPhotosEnabled(visible); return; }
            if (option.type === 'native-layer') {
                if (map.getLayer(option.layerId)) {
                    try {
                        map.setLayoutProperty(option.layerId, 'visibility', visible ? 'visible' : 'none');
                        map.setPaintProperty(option.layerId, 'hillshade-exaggeration', visible ? Math.min(opacity, 1.0) : 0);
                    } catch (_) { }
                }
                return;
            }
            if (!option.layerId || !map.getLayer(option.layerId)) return;
            map.setPaintProperty(option.layerId, 'raster-opacity', opacity);
            map.setLayoutProperty(option.layerId, 'visibility', visible ? 'visible' : 'none');
        });
        updateAnalyticalLegends();
    }

    // ─── Public API ───
    return {
        imageryState,
        imageryControls,
        imageryOrder,
        SHADOW_TOOLBOX_IDS,
        TERRAIN_TOOLBOX_IDS,
        SNOW_TOOLBOX_IDS,
        applyImageryState,
        applyImageryLayerOrder,
        updateImageryControlStates,
        clampOpacity,
        createTilePreviewUrl,

        setToolboxHandlers(handlers) {
            setTerrainToolboxOpen = handlers.setTerrainToolboxOpen;
            setSnowToolboxOpen = handlers.setSnowToolboxOpen;
            setShadowToolboxOpen = handlers.setShadowToolboxOpen;
        }
    };
}
