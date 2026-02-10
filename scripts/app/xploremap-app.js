import {
  COLOR_RELIEF_COLOR_RAMP,
  BASE_STYLE_RELIEF_OPACITY,
  DEFAULT_3D_ORIENTATION,
  RELIEF_OPACITY,
  MAPLIBRE_SPRITE_URL,
  S2C_URL,
  S2_FADE_DURATION,
  S2_OPACITY,
  SKY_SETTINGS,
  TILE_FADE_DURATION,
  VIEW_MODES,
  VERSATILES_LOCAL_JSON,
  MAPTERHORN_TILE_URL,
  MAPTERHORN_ATTRIBUTION
} from '../config/map-config.js';
import {
  ensureGpxLayers,
  geojsonToGpx,
  parseGpxToGeoJson,
  zoomToGeojson
} from '../gpx/gpx-io.js';
import { DirectionsManager } from '../directions/core/directions-manager.js';
import { RouteLibraryManager } from '../storage/route-library-manager.js';
import { RouteLibraryUI } from '../ui/route-library-ui.js';
import '../map/pmtiles-protocol.js';
import { OfflineRouter, DEFAULT_NODE_CONNECTION_TOLERANCE_METERS } from '../routing/offline-path-router.js';
import { MaplibreDirectionsRouter } from '../routing/maplibre-directions-client.js';
import { OrsRouter } from '../routing/openrouteservice-directions-client.js';
import { extractOverpassNetwork } from '../routing/overpass-network-fetcher.js';
import { extractOpenFreeMapNetwork } from '../routing/openfreemap-network-builder.js';
import { createViewModeController } from '../map/map-view-mode-controller.js';
import { initializeGeocoder } from '../map/geocoder-control.js';
import { initializeWikimediaPhotos, setNetworkPoiCoordinates, setWikimediaPhotosEnabled } from '../map/wikimedia-photos.js';

// Initialize Global Debug Flag
window.XploreDebug = new URLSearchParams(window.location.search).has('debug') || window.XploreDebug === true;
window.setXploreDebug = (enabled) => {
  window.XploreDebug = !!enabled;
  console.log(`[Xplore] Debug mode ${window.XploreDebug ? 'ENABLED' : 'DISABLED'}`);
  // Force update UI dependencies
  if (typeof updateImageryControlStates === 'function') updateImageryControlStates();

  const shadowDebugBtn = document.getElementById('shadowDebugToggle');
  if (shadowDebugBtn) shadowDebugBtn.parentElement.style.display = window.XploreDebug ? 'flex' : 'none';

  const debugNetworkControlWrapper = document.getElementById('debugNetworkControlWrapper');
  if (debugNetworkControlWrapper) {
    const offlineActive = document.getElementById('routingModeToggle')?.dataset.routingMode === 'offline';
    const isVisible = offlineActive && window.XploreDebug;
    debugNetworkControlWrapper.style.display = isVisible ? 'flex' : 'none';
    debugNetworkControlWrapper.setAttribute('aria-hidden', !isVisible ? 'true' : 'false');
  }
};

const UI_ICON_SOURCES = Object.freeze({
  'view-toggle': './data/2d_3d.png',
  'gpx-import': './data/upload.png',
  'gpx-export': './data/downloads.png',
  'routing-offline': './data/no-wifi.png',
  'routing-online': './data/wifi.png',
  'debug-network': './data/debugg.png'
});

const ROUTING_ICON_OFFLINE = UI_ICON_SOURCES['routing-offline'];
const ROUTING_ICON_ONLINE = UI_ICON_SOURCES['routing-online'];

const IGN_ATTRIBUTION = '<a href="https://www.ign.fr/">© IGN</a>';
const EOX_ATTRIBUTION = '<a href="https://www.eox.at/">© EOX</a>';
const WMTS_PREVIEW_COORDS = Object.freeze({ z: 14, x: 8508, y: 5911 });
const DEM_SOURCE_MAX_ZOOM = 17;
const SHADOW_DEM_MAX_ZOOM = 11; // Lower maxzoom for shadow layer - ensures coarse tiles for long-distance shadows

function createIgnTileTemplate(layerName, format = 'image/png') {
  const encodedFormat = encodeURIComponent(format);
  const encodedLayer = encodeURIComponent(layerName);
  return `https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=${encodedLayer}&STYLE=normal&FORMAT=${encodedFormat}&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;
}

function createTilePreviewUrl(template, coords = WMTS_PREVIEW_COORDS) {
  if (typeof template !== 'string' || !template.length) {
    return null;
  }
  const replacements = [
    { token: /\{z\}/gi, value: coords?.z ?? WMTS_PREVIEW_COORDS.z },
    { token: /\{x\}/gi, value: coords?.x ?? WMTS_PREVIEW_COORDS.x },
    { token: /\{y\}/gi, value: coords?.y ?? WMTS_PREVIEW_COORDS.y }
  ];
  return replacements.reduce((acc, entry) => acc.replace(entry.token, entry.value), template);
}


const COLOR_RELIEF_OPTION_ID = 'color-relief';

const IMAGERY_OPTIONS = Object.freeze([
  // 1. Sun Analysis
  {
    id: 'shadow',
    label: 'Shadow',
    type: 'native-layer',
    layerId: 'shadow-native',
    previewImage: './data/icons_Xmap/shadow.png',
    defaultOpacity: 1.0,
    defaultVisible: false
  },
  // 2. Vector group
  {
    id: 'contours',
    label: 'Contours',
    type: 'contours',
    sourceId: 'contours',
    layerId: 'contours',
    linkedLayerIds: ['contour-text'],
    previewImage: './data/contour.png',
    defaultVisible: true,
    defaultOpacity: 1
  },
  {
    id: 'osm-features',
    label: 'OSM Features',
    type: 'osm-overlay',
    previewImage: './data/OSM_vector.png',
    defaultOpacity: 1,
    defaultVisible: true
  },
  // 3. Wikimedia Photos
  {
    id: 'wikimedia-photos',
    label: 'Wikimedia Photos',
    type: 'wikimedia',
    previewImage: './data/icons_Xmap/camera.png',
    defaultVisible: false,
    defaultOpacity: 1,
    linkedLayerIds: [
      'wikimedia-photos-layer',
      'wikimedia-photos-clusters',
      'wikimedia-photos-cluster-count',
      'wikimedia-photos-large-clusters'
    ]
  },
  // 4. Heatmap group
  {
    id: 'strava-heatmap-all',
    label: 'Strava Heatmap (All)',
    sourceId: 'strava-heatmap-all',
    layerId: 'strava-heatmap-all',
    tileTemplate: 'https://atlas.hartakji.com/strava-heatmap-all/{z}/{x}/{y}',
    tileSize: 256,
    minZoom: 0,
    maxZoom: 15,
    attribution: '<a href="https://www.strava.com">© Strava</a>',
    defaultVisible: false,
    defaultOpacity: 1
  },
  {
    id: 'strava-winter',
    label: 'Strava Winter',
    sourceId: 'strava-winter',
    layerId: 'strava-winter',
    tileTemplate: 'https://atlas.hartakji.com/strava-winter/{z}/{x}/{y}',
    tileSize: 256,
    minZoom: 0,
    maxZoom: 15,
    attribution: '<a href="https://www.strava.com">© Strava</a>',
    defaultVisible: false,
    defaultOpacity: 1
  },
  {
    id: 'ign-traces-hivernales',
    label: 'Traces Rando Hivernales',
    sourceId: 'ign-traces-hivernales',
    layerId: 'ign-traces-hivernales',
    tileTemplate: 'https://data.geopf.fr/wmts?layer=TRACES.RANDO.HIVERNALE&style=normal&tilematrixset=PM&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image%2Fpng&TileMatrix={z}&TileCol={x}&TileRow={y}',
    tileSize: 256,
    minZoom: 0,
    maxZoom: 15,
    attribution: IGN_ATTRIBUTION,
    defaultVisible: false,
    defaultOpacity: 1
  },

  // 5. Terrain Analysis group
  {
    id: 'detail-shading',
    label: 'Detail Shading',
    type: 'native-layer',
    layerId: 'detail-native',
    previewImage: './data/icons_Xmap/normal.png',
    defaultOpacity: 1.0,
    defaultVisible: false
  },
  {
    id: 'aspect',
    label: 'Aspect (Orientation)',
    type: 'native-layer',
    layerId: 'aspect-native',
    previewImage: './data/icons_Xmap/aspect.png',
    defaultOpacity: 1.0,
    defaultVisible: false
  },
  {
    id: 'slope',
    label: 'Slope',
    type: 'native-layer',
    layerId: 'slope-native',
    previewImage: './data/icons_Xmap/slope.png',
    defaultOpacity: 1.0,
    defaultVisible: false
  },
  {
    id: 'avalanche',
    label: 'Avalanche Zones',
    type: 'native-layer',
    layerId: 'avalanche-native',
    previewImage: './data/icons_Xmap/avalanche.png',
    defaultOpacity: 1.0,
    defaultVisible: false
  },
  // 6. Snow Analysis group
  {
    id: 'snow',
    label: 'Snow',
    type: 'native-layer',
    layerId: 'snow-native',
    previewImage: './data/icons_Xmap/snow.png',
    defaultOpacity: 1.0,
    defaultVisible: false
  },
  {
    id: 'snow-depth',
    label: 'Snow Depth (Alps)',
    sourceId: 'snow-depth',
    layerId: 'snow-depth',
    tileTemplate: 'https://p20.cosmos-project.ch/BfOlLXvmGpviW0YojaYiRqsT9NHEYdn88fpHZlr_map/gmaps/sd20alps@epsg3857/{z}/{x}/{y}.png',
    tileSize: 256,
    minZoom: 0,
    maxZoom: 22,
    attribution: '© Data from Exolab',
    defaultVisible: false,
    defaultOpacity: 1
  },
  // 7. IGN Scan (Topo)
  {
    id: 'ign-scan',
    label: 'IGN Scan (Topo)',
    sourceId: 'ign-scan',
    layerId: 'ign-scan',
    tileTemplate: 'https://data.geopf.fr/private/wmts?apikey=ign_scan_ws&layer=GEOGRAPHICALGRIDSYSTEMS.MAPS&style=normal&tilematrixset=PM&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image%2Fjpeg&TileMatrix={z}&TileCol={x}&TileRow={y}',
    tileSize: 256,
    minZoom: 0,
    maxZoom: 15,
    attribution: IGN_ATTRIBUTION,
    defaultVisible: false,
    defaultOpacity: 1
  },
  // 8. Land Cover group
  {
    id: 'ign-cosia',
    label: 'IGN Kosia 2021-2023',
    sourceId: 'ign-cosia',
    layerId: 'ign-cosia',
    tileTemplate: createIgnTileTemplate('IGNF_COSIA_2021-2023', 'image/png'),
    tileSize: 256,
    attribution: IGN_ATTRIBUTION,
    defaultVisible: false,
    defaultOpacity: 1
  },
  {
    id: 'ign-forest-inventory',
    label: 'IGN Forest Inventory',
    sourceId: 'ign-forest-inventory',
    layerId: 'ign-forest-inventory',
    tileTemplate: createIgnTileTemplate('LANDCOVER.FORESTINVENTORY.V2', 'image/png'),
    tileSize: 256,
    attribution: IGN_ATTRIBUTION,
    defaultVisible: false,
    defaultOpacity: 1
  },
  // 9. Satellite group
  {
    id: 'ign-orthophotos',
    label: 'IGN Orthophotos',
    sourceId: 'ign-orthophotos',
    layerId: 'ign-orthophotos',
    tileTemplate: createIgnTileTemplate('ORTHOIMAGERY.ORTHOPHOTOS.BDORTHO', 'image/jpeg'),
    tileSize: 256,
    attribution: IGN_ATTRIBUTION,
    defaultVisible: false,
    defaultOpacity: 1
  },
  {
    id: 'eox-s2',
    label: 'EOX Satellite',
    sourceId: 's2cloudless',
    layerId: 's2cloudless',
    tileTemplate: S2C_URL,
    tileSize: 256,
    attribution: EOX_ATTRIBUTION,
    defaultVisible: false,
    defaultOpacity: 1,
    paint: {
      'raster-opacity': S2_OPACITY,
      'raster-fade-duration': S2_FADE_DURATION
    }
  },
  // 10. Lidar HD group
  {
    id: 'ign-lidar-hd-mns-shadow',
    label: 'MNS',
    sourceId: 'ign-lidar-hd-mns-shadow',
    layerId: 'ign-lidar-hd-mns-shadow',
    tileTemplate: createIgnTileTemplate('IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW', 'image/png'),
    tileSize: 256,
    attribution: IGN_ATTRIBUTION,
    defaultVisible: false,
    defaultOpacity: 1
  },
  {
    id: 'ign-lidar-hd-mnt-shadow',
    label: 'MNT',
    sourceId: 'ign-lidar-hd-mnt-shadow',
    layerId: 'ign-lidar-hd-mnt-shadow',
    tileTemplate: createIgnTileTemplate('IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW', 'image/png'),
    tileSize: 256,
    attribution: IGN_ATTRIBUTION,
    defaultVisible: false,
    defaultOpacity: 1
  },
  // Hidden layers
  {
    id: 'white-background',
    label: 'White Background',
    type: 'background',
    layerId: 'background',
    hiddenControl: true,
    defaultVisible: false,
    paint: {
      'background-color': '#ffffff'
    }
  },
  // Debug layer for tile visualization - uses same maxzoom as shadow source for tile alignment
  {
    id: 'debug-tiles',
    label: 'Debug Tiles',
    sourceId: 'debug-tiles',
    layerId: 'debug-tiles',
    type: 'debug-tiles',
    tilesUrl: 'https://demotiles.maplibre.org/debug-tiles/number/tiles.json',
    tileSize: 256,
    maxzoom: SHADOW_DEM_MAX_ZOOM, // Match shadow source for aligned tile visualization
    attribution: '© MapLibre Debug Tiles',
    defaultVisible: false,
    defaultOpacity: 0.7
  }
]);

/**
 * Layer groups for grouped toggle UI.
 * Layers within a group act like radio buttons - only one can be active at a time.
 * Set exclusive: false to allow multiple layers to be active simultaneously.
 */
const LAYER_GROUPS = Object.freeze([
  {
    id: 'sun-analysis',
    label: 'Sun Analysis',
    exclusive: true,
    members: ['shadow']
  },
  {
    id: 'vector',
    label: 'Vector',
    exclusive: false,
    members: ['contours', 'osm-features']
  },
  {
    id: 'wikimedia-photos',
    label: 'Wikimedia Photos',
    exclusive: true,
    members: ['wikimedia-photos']
  },
  {
    id: 'heatmap',
    label: 'Heatmap',
    exclusive: true,
    members: ['strava-heatmap-all', 'strava-winter', 'ign-traces-hivernales']
  },
  {
    id: 'terrain-analysis',
    label: 'Terrain Analysis',
    exclusive: true,
    members: ['aspect', 'slope', 'avalanche']
  },
  {
    id: 'snow',
    label: 'Snow Analysis',
    exclusive: false,
    members: ['snow', 'snow-depth']
  },
  {
    id: 'ign-scan',
    label: 'IGN Scan (Topo)',
    exclusive: true,
    members: ['ign-scan']
  },
  {
    id: 'land-cover',
    label: 'Land Cover',
    exclusive: true,
    members: ['ign-cosia', 'ign-forest-inventory']
  },
  {
    id: 'satellite',
    label: 'Satellite',
    exclusive: true,
    members: ['ign-orthophotos', 'eox-s2']
  },
  {
    id: 'lidar-hd',
    label: 'Lidar HD',
    exclusive: true,
    members: ['ign-lidar-hd-mns-shadow', 'ign-lidar-hd-mnt-shadow']
  },
  {
    id: 'debug',
    label: 'Debug',
    exclusive: false,
    members: ['debug-tiles']
  }
]);

// Build lookup maps for layer groups
const LAYER_GROUP_BY_MEMBER_ID = new Map();
LAYER_GROUPS.forEach(group => {
  group.members.forEach(memberId => {
    LAYER_GROUP_BY_MEMBER_ID.set(memberId, group);
  });
});

const IMAGERY_LAYER_IDS = new Set(
  IMAGERY_OPTIONS.flatMap((option) => {
    const ids = [];
    if (typeof option.layerId === 'string') ids.push(option.layerId);
    if (Array.isArray(option.linkedLayerIds)) {
      option.linkedLayerIds.forEach((linkedId) => {
        if (typeof linkedId === 'string') ids.push(linkedId);
      });
    }
    return ids;
  })
);

const ROUTE_LAYER_IDS = new Set([
  'route-line',
  'route-line-casing',
  'route-segment-hover',
  'distance-markers',
  'waypoints',
  'waypoints-hit-area',
  'waypoint-hover-drag',
  'route-hover-point',
  'segment-markers'
]);

const ROUTE_LAYER_ORDER_TOP_TO_BOTTOM = Object.freeze([
  'route-hover-point',
  'waypoint-hover-drag',
  'waypoints',
  'segment-markers',
  'waypoints-hit-area',
  'distance-markers',
  'route-segment-hover',
  'route-line',
  'route-line-casing'
]);

const CONTOUR_LINE_BASE_OPACITY = Object.freeze([
  'interpolate', ['linear'], ['zoom'],
  13.4, 0,
  13.5, 0.45,
  15, 0.85,
  17, 1
]);

const CONTOUR_TEXT_BASE_OPACITY = Object.freeze([
  'interpolate', ['linear'], ['zoom'],
  13.4, 0,
  13.6, 0.5,
  14.2, 0.9
]);

function cloneExpression(expression) {
  if (Array.isArray(expression)) {
    return expression.map((item) => cloneExpression(item));
  }
  if (expression && typeof expression === 'object') {
    const entries = Object.entries(expression).map(([key, value]) => [key, cloneExpression(value)]);
    return Object.fromEntries(entries);
  }
  return expression;
}

function scaleExpression(expression, factor) {
  if (typeof expression === 'number') {
    return expression * factor;
  }

  if (!Array.isArray(expression) || expression.length === 0) {
    return ['*', cloneExpression(expression), factor];
  }

  const [operator, ...rest] = expression;

  if (operator === 'interpolate') {
    if (rest.length < 2) {
      return ['*', cloneExpression(expression), factor];
    }

    const [curve, input, ...stops] = rest;
    const scaledStops = stops.map((value, index) => {
      if (index % 2 === 0) {
        return cloneExpression(value);
      }
      return scaleExpression(value, factor);
    });

    return ['interpolate', cloneExpression(curve), cloneExpression(input), ...scaledStops];
  }

  if (operator === 'step') {
    if (rest.length < 1) {
      return ['*', cloneExpression(expression), factor];
    }

    const [input, ...stops] = rest;
    if (!stops.length) {
      return ['*', cloneExpression(expression), factor];
    }

    const [baseOutput, ...remaining] = stops;
    const scaledStops = [scaleExpression(baseOutput, factor)];

    for (let i = 0; i < remaining.length; i += 2) {
      const stopInput = remaining[i];
      const stopOutput = remaining[i + 1];
      if (typeof stopInput === 'undefined' || typeof stopOutput === 'undefined') {
        break;
      }
      scaledStops.push(cloneExpression(stopInput));
      scaledStops.push(scaleExpression(stopOutput, factor));
    }

    return ['step', cloneExpression(input), ...scaledStops];
  }

  return ['*', cloneExpression(expression), factor];
}

const IMAGERY_OPTIONS_BY_ID = new Map(IMAGERY_OPTIONS.map((option) => [option.id, option]));
const HILLSHADE_OPTION_ID = 'hillshade';

let baseStyleContentLayerIds = [];
const baseStyleLayerMetadata = new Map();
let baseStyleOverlayLayerIds = [];
let baseStyleUnderlayLayerIds = [];

function rebuildBaseStyleLayerBuckets() {
  const overlay = [];
  const underlay = [];

  baseStyleContentLayerIds.forEach((layerId) => {
    if (typeof layerId !== 'string') {
      return;
    }
    const meta = baseStyleLayerMetadata.get(layerId) || {};
    const type = meta.type ?? '';
    const sourceLayer = (meta.sourceLayer || '').toString().toLowerCase();
    const idLower = layerId.toLowerCase();
    const isRoadLike = sourceLayer.includes('road')
      || sourceLayer.includes('highway')
      || sourceLayer.includes('transport')
      || sourceLayer.includes('cycle')
      || sourceLayer.includes('rail')
      || idLower.includes('road')
      || idLower.includes('path')
      || idLower.includes('track')
      || idLower.includes('rail');
    const isBuilding = sourceLayer.includes('building') || idLower.includes('building');
    const isOverlayType = type === 'symbol' || type === 'fill-extrusion' || isRoadLike || isBuilding;

    if (isOverlayType) {
      overlay.push(layerId);
    } else {
      underlay.push(layerId);
    }
  });

  baseStyleOverlayLayerIds = overlay;
  baseStyleUnderlayLayerIds = underlay;
}

function getAvailableHillshadeMethods() {
  const styleSpec = typeof maplibregl !== 'undefined' ? maplibregl?.styleSpec : null;
  const methodDefinition = styleSpec?.paint_hillshade?.['hillshade-method'];
  const { values } = methodDefinition ?? {};
  if (!values) {
    return [];
  }
  if (Array.isArray(values)) {
    return values
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object' && 'value' in entry) return entry.value;
        return null;
      })
      .filter((value) => typeof value === 'string' && value.length);
  }
  if (typeof values === 'object') {
    return Object.keys(values).filter((key) => typeof key === 'string' && key.length);
  }
  return [];
}

function formatHillshadeMethodName(method) {
  if (typeof method !== 'string' || !method.length) {
    return '';
  }
  const normalized = method.toLowerCase();
  const overrides = {
    standard: 'Standard',
    basic: 'Basic',
    combined: 'Combined',
    igor: 'Igor',
    multidirectional: 'Multi-directional',
    traditional: 'Traditional',
    'multi-directional': 'Multi-directional',
    mapbox: 'Mapbox',
    default: 'Default'
  };
  if (overrides[normalized]) {
    return overrides[normalized];
  }
  return method
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function applyUiIconSources(root = document) {
  if (!root || typeof root.querySelectorAll !== 'function') {
    return;
  }
  const iconNodes = root.querySelectorAll('img[data-icon-id]');
  iconNodes.forEach((img) => {
    const hasNativeImageClass = typeof HTMLImageElement !== 'undefined'
      ? img instanceof HTMLImageElement
      : img?.tagName?.toLowerCase() === 'img';
    if (!hasNativeImageClass) {
      return;
    }
    const { iconId } = img.dataset;
    if (!iconId) {
      return;
    }
    const src = UI_ICON_SOURCES[iconId];
    if (!src || img.src === src) {
      return;
    }
    img.src = src;
  });
}

const PEAK_POINTER_ID = 'peak-pointer';

function createPeakPointerImage(color = '#3ab7c6') {
  const width = 48;
  const height = 96;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  const centerX = width / 2;
  const topOffset = 8;
  const stemWidth = width * 0.16;
  ctx.strokeStyle = color;
  ctx.lineWidth = stemWidth;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(centerX, topOffset);
  ctx.lineTo(centerX, height - width * 0.28);
  ctx.stroke();

  ctx.fillStyle = color;
  const tipRadius = width * 0.24;
  ctx.beginPath();
  ctx.arc(centerX, height - tipRadius, tipRadius, 0, Math.PI * 2);
  ctx.fill();

  return ctx.getImageData(0, 0, width, height);
}

function ensurePeakPointerImage(map) {
  if (map.hasImage(PEAK_POINTER_ID)) return;
  const pointerImage = createPeakPointerImage();
  map.addImage(PEAK_POINTER_ID, pointerImage, { pixelRatio: 2 });
}

function updatePeakLabelLayer(map, layerId) {
  if (!map.getLayer(layerId)) return;
  ensurePeakPointerImage(map);

  const textField = [
    'format',
    ['coalesce', ['get', 'name:en'], ['get', 'name']],
    { 'font-scale': 1 },
    '\n',
    {},
    ['concat', ['number-format', ['get', 'ele'], { 'maximumFractionDigits': 0 }], ' m'],
    { 'font-scale': 0.85 }
  ];

  map.setLayoutProperty(layerId, 'icon-image', PEAK_POINTER_ID);
  map.setLayoutProperty(layerId, 'icon-size', 0.42);
  map.setLayoutProperty(layerId, 'icon-anchor', 'top');
  map.setLayoutProperty(layerId, 'icon-offset', [0, 0]);
  map.setLayoutProperty(layerId, 'text-anchor', 'bottom');
  map.setLayoutProperty(layerId, 'text-offset', [0, -1.4]);
  map.setLayoutProperty(layerId, 'text-field', textField);
  map.setLayoutProperty(layerId, 'text-font', ['Noto Sans Bold']);
  map.setLayoutProperty(layerId, 'text-line-height', 1.15);
  map.setLayoutProperty(layerId, 'symbol-spacing', 250);
  map.setLayoutProperty(layerId, 'text-max-width', 6);

  map.setPaintProperty(layerId, 'icon-opacity', 0.9);
  map.setPaintProperty(layerId, 'text-color', '#133540');
  map.setPaintProperty(layerId, 'text-halo-color', 'rgba(255,255,255,0.95)');
  map.setPaintProperty(layerId, 'text-halo-width', 2.2);
  map.setPaintProperty(layerId, 'text-halo-blur', 0.4);
}

function updatePeakLabels(map) {
  updatePeakLabelLayer(map, 'Mountain peak labels');
  updatePeakLabelLayer(map, 'Volcano peak labels');
}

function setLayerSequenceOpacity(map, layerIds, alpha) {
  if (!map || !Array.isArray(layerIds)) return;

  const isVisible = alpha > 0;
  const visibility = isVisible ? 'visible' : 'none';

  layerIds.forEach((id) => {
    if (!map.getLayer(id)) return;

    // Set visibility
    try {
      map.setLayoutProperty(id, 'visibility', visibility);
    } catch (_) { }

    // If not visible, we can skip opacity (optimization)
    if (!isVisible) return;

    const layer = map.getLayer(id);
    const type = layer.type;

    const setIf = (prop, value) => {
      try {
        const cur = map.getPaintProperty(id, prop);
        if (cur !== undefined) map.setPaintProperty(id, prop, value);
      } catch (_) { }
    };

    switch (type) {
      case 'background': setIf('background-opacity', alpha); break;
      case 'fill': setIf('fill-opacity', alpha); break;
      case 'line': setIf('line-opacity', alpha); break;
      case 'symbol': setIf('text-opacity', alpha); setIf('icon-opacity', alpha); break;
      case 'circle': setIf('circle-opacity', alpha); break;
      case 'fill-extrusion': setIf('fill-extrusion-opacity', alpha); break;
      case 'heatmap': setIf('heatmap-opacity', alpha); break;
      case 'raster': setIf('raster-opacity', alpha); break;
      default: break;
    }
  });
}

async function unregisterLegacyServiceWorker() {
  if (!('serviceWorker' in navigator) ||
    typeof navigator.serviceWorker.getRegistrations !== 'function') {
    return;
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(async (registration) => {
      const candidates = [registration.active, registration.waiting, registration.installing]
        .filter(Boolean)
        .map((worker) => worker.scriptURL);
      if (candidates.some((url) => typeof url === 'string' && url.endsWith('/sw.js'))) {
        try {
          await registration.unregister();
        } catch (error) {
          console.warn('Unable to unregister legacy service worker', error);
        }
      }
    }));
  } catch (error) {
    console.warn('Legacy service worker cleanup failed', error);
  }
}

async function init() {
  await unregisterLegacyServiceWorker();

  const searchParams = new URLSearchParams(window.location.search);
  const networkSourceParam = searchParams.get('networkSource');
  const preferOpenFreeMapNetwork = networkSourceParam === 'openfreemap'
    || (!networkSourceParam && searchParams.has('openfreemapNetwork'));

  const versaStyle = await fetch(VERSATILES_LOCAL_JSON, { cache: 'no-store' }).then(r => r.json());
  versaStyle.glyphs = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';
  versaStyle.sprite = MAPLIBRE_SPRITE_URL;

  // Use Mercator projection (flat map) - faster performance than globe
  versaStyle.projection = { type: 'mercator' };
  versaStyle.sky = {
    'sky-color': '#bcd0e6',
    'horizon-color': '#e6effa',
    'sky-horizon-blend': 0.5
  };
  versaStyle.light = {
    'anchor': 'map',
    'position': [1.5, 90, 80]
  };

  const landcoverSourcePrefixes = ['landcover'];
  if (Array.isArray(versaStyle.layers)) {
    baseStyleLayerMetadata.clear();
    versaStyle.layers.forEach((layer) => {
      if (!layer || typeof layer.id !== 'string') return;
      baseStyleLayerMetadata.set(layer.id, {
        type: layer.type,
        sourceLayer: layer['source-layer']
      });
    });

    baseStyleContentLayerIds = versaStyle.layers
      .filter((layer) => {
        if (!layer || typeof layer.id !== 'string') {
          return false;
        }
        if (layer.type === 'background') {
          return false;
        }
        const sourceLayer = typeof layer['source-layer'] === 'string'
          ? layer['source-layer'].toLowerCase()
          : '';
        if (landcoverSourcePrefixes.some((prefix) => sourceLayer.startsWith(prefix))) {
          return false;
        }
        return true;
      })
      .map((layer) => layer.id);
    rebuildBaseStyleLayerBuckets();
  } else {
    baseStyleContentLayerIds = [];
    baseStyleLayerMetadata.clear();
    baseStyleOverlayLayerIds = [];
    baseStyleUnderlayLayerIds = [];
  }

  const dprEnabled = localStorage.getItem('xplore_dpr_enabled') !== 'false';
  const map = new maplibregl.Map({
    container: 'map',
    pixelRatio: dprEnabled ? window.devicePixelRatio : 1.0,
    hash: true,
    center: [7.6586, 45.9763],
    zoom: 11.7,
    pitch: DEFAULT_3D_ORIENTATION.pitch,
    bearing: DEFAULT_3D_ORIENTATION.bearing,
    style: versaStyle,
    minZoom: 6,
    maxZoom: 18,
    maxPitch: 85,
    antialias: dprEnabled, // Performance: Disable MSAA if HD is off
    fadeDuration: TILE_FADE_DURATION,
    maxTileCacheSize: 1000, // Performance: Large cache for Omni-Lookup neighbors
    refreshExpiredTiles: false, // Performance: Prevent cyclical reloads for short TTL tiles
    attributionControl: false
  });

  // Store map globally for access from UI controls
  window.xploreMap = map;

  maplibrePreload(map, {
    text: 'Xplore',
    logoSrc: './data/logos/xplore.mp4',
    logoAlt: 'Xplore',
    minDuration: 7000,
    background: '#05090f'
  });
  // Initialize geocoder control (top-center for visibility)
  initializeGeocoder(map, { position: 'top-center' });

  // Add Geolocate Control
  map.addControl(new maplibregl.GeolocateControl({
    positionOptions: {
      enableHighAccuracy: true
    },
    trackUserLocation: true,
    showUserHeading: true
  }), 'top-right');

  // Add standard Navigation Control (zoom/compass)
  map.addControl(new maplibregl.NavigationControl({
    showCompass: true,
    showZoom: false,
    visualizePitch: true
  }), 'top-right');

  // Add FPS control
  map.addControl(new MapboxFPS.FPSControl(), 'bottom-left');


  // Initialize Wikimedia Commons geotagged photos layer
  const wikimediaConfig = IMAGERY_OPTIONS.find(o => o.id === 'wikimedia-photos');
  initializeWikimediaPhotos(map, { enabled: wikimediaConfig?.defaultVisible ?? false });

  const gpxFileInput = document.getElementById('gpxFileInput');
  const gpxImportButton = document.getElementById('gpxImportButton');
  const gpxExportButton = document.getElementById('gpxExportButton');
  const directionsToggle = document.getElementById('directionsToggle');
  const directionsDock = document.getElementById('directionsDock');
  const directionsControl = document.getElementById('directionsControl');
  const transportModes = document.querySelectorAll('.directions-actions-bar .route-mode-btn');
  const swapButton = document.getElementById('swapDirectionsButton');
  const undoButton = document.getElementById('undoDirectionsButton');
  const redoButton = document.getElementById('redoDirectionsButton');
  const clearButton = document.getElementById('clearDirectionsButton');
  const routeStats = document.getElementById('routeStats');
  const routeTimeline = document.getElementById('routeTimeline');
  const elevationCard = document.getElementById('elevationCard');
  const elevationChartBody = document.getElementById('elevationChartBody');
  const elevationChart = document.getElementById('elevationChart');
  const elevationCollapseToggle = document.getElementById('toggleElevationButton');
  const routingModeToggle = document.getElementById('routingModeToggle');
  const routingModeIcon = routingModeToggle?.querySelector('.routing-mode-toggle__icon');
  const routingModeLabel = routingModeToggle?.querySelector('.routing-mode-toggle__text');
  const routingModeSpinner = routingModeToggle?.querySelector('.routing-mode-toggle__spinner');
  const routingModeLoadingText = routingModeToggle?.querySelector('.routing-mode-toggle__loading-text');
  const debugNetworkCheckbox = document.getElementById('debugNetworkCheckbox');
  const debugNetworkControl = document.getElementById('debugNetworkControl');
  const profileModeToggle = document.getElementById('profileModeToggle');
  const profileModeMenu = document.getElementById('profileModeMenuList');
  const profileLegend = document.getElementById('profileLegend');

  applyUiIconSources();

  const offlineRouter = new OfflineRouter({
    networkUrl: './data/offline-network.geojson'
  });
  if (typeof offlineRouter.setNodeConnectionToleranceMeters === 'function') {
    offlineRouter.setNodeConnectionToleranceMeters(DEFAULT_NODE_CONNECTION_TOLERANCE_METERS);
  }
  const maplibreDirectionsOptions = { fallbackRouter: offlineRouter };
  const globalDirectionsServiceUrl = typeof window !== 'undefined'
    && typeof window.MAPLIBRE_DIRECTIONS_SERVICE_URL === 'string'
    ? window.MAPLIBRE_DIRECTIONS_SERVICE_URL
    : null;
  const directionsServiceUrlParam = searchParams.get('directionsUrl');
  const resolvedServiceUrl = (directionsServiceUrlParam && directionsServiceUrlParam.trim().length)
    ? directionsServiceUrlParam.trim()
    : (globalDirectionsServiceUrl && globalDirectionsServiceUrl.trim().length
      ? globalDirectionsServiceUrl.trim()
      : null);

  const globalDirectionsApiKey = typeof window !== 'undefined'
    && typeof window.MAPLIBRE_DIRECTIONS_API_KEY === 'string'
    ? window.MAPLIBRE_DIRECTIONS_API_KEY
    : null;
  const directionsApiKeyParam = searchParams.get('directionsKey');
  const resolvedApiKey = (directionsApiKeyParam && directionsApiKeyParam.trim().length)
    ? directionsApiKeyParam.trim()
    : (globalDirectionsApiKey && globalDirectionsApiKey.trim().length
      ? globalDirectionsApiKey.trim()
      : null);

  const globalDirectionsApiKeyParam = typeof window !== 'undefined'
    && typeof window.MAPLIBRE_DIRECTIONS_API_KEY_PARAM === 'string'
    ? window.MAPLIBRE_DIRECTIONS_API_KEY_PARAM
    : null;
  const directionsApiKeyNameParam = searchParams.get('directionsKeyParam');
  const resolvedApiKeyParam = (directionsApiKeyNameParam && directionsApiKeyNameParam.trim().length)
    ? directionsApiKeyNameParam.trim()
    : (globalDirectionsApiKeyParam && globalDirectionsApiKeyParam.trim().length
      ? globalDirectionsApiKeyParam.trim()
      : null);

  const maplibreRoutingConfigured = Boolean(
    (resolvedServiceUrl && resolvedServiceUrl.trim().length)
    || (resolvedApiKey && resolvedApiKey.trim().length)
    || (resolvedApiKeyParam && resolvedApiKeyParam.trim().length)
  );

  if (resolvedServiceUrl) {
    maplibreDirectionsOptions.serviceUrl = resolvedServiceUrl;
  }
  if (resolvedApiKey) {
    maplibreDirectionsOptions.apiKey = resolvedApiKey;
  }
  if (resolvedApiKeyParam) {
    maplibreDirectionsOptions.apiKeyParam = resolvedApiKeyParam;
  }

  const maplibreRouter = maplibreRoutingConfigured
    ? new MaplibreDirectionsRouter(maplibreDirectionsOptions)
    : null;

  const orsRouterOptions = { fallbackRouter: offlineRouter };

  const sensitiveParams = ['directionsKey', 'directionsKeyParam'];
  const sanitizedParams = sensitiveParams.filter((param) => searchParams.has(param));
  if (sanitizedParams.length && typeof window !== 'undefined' && window.history?.replaceState) {
    sanitizedParams.forEach((param) => searchParams.delete(param));
    const newSearch = searchParams.toString();
    const newUrl = `${window.location.pathname}${newSearch ? `?${newSearch}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, document.title, newUrl);
  }

  const orsRouter = new OrsRouter(orsRouterOptions);

  const onlineRouter = maplibreRouter || orsRouter;

  const routers = {
    offline: offlineRouter,
    ...(onlineRouter ? { online: onlineRouter } : {})
  };

  const hasOnlineRouter = Boolean(onlineRouter);
  let activeRouterKey = hasOnlineRouter ? 'online' : 'offline';

  let offlineNetworkCoverage = null;
  let offlineNetworkRefreshPromise = null;
  let offlineNetworkLoadingCount = 0;
  let offlineNetworkPois = null;

  const DEBUG_NETWORK_SOURCE_ID = 'offline-router-network-debug';
  const DEBUG_NETWORK_LAYER_ID = 'offline-router-network-debug';
  const DEBUG_NETWORK_INTERSECTIONS_LAYER_ID = 'offline-router-network-debug-intersections';
  const DEBUG_NETWORK_POIS_SOURCE_ID = 'offline-router-network-pois';
  const DEBUG_NETWORK_POIS_LAYER_ID = 'offline-router-network-pois';
  const DEBUG_NETWORK_POIS_LABEL_LAYER_ID = 'offline-router-network-pois-labels';
  const DEBUG_NETWORK_SAC_SCALE_COLOR_EXPRESSION = Object.freeze([
    'let',
    'sacScale',
    [
      'coalesce',
      ['get', 'sacScale', ['get', 'hiking']],
      ['get', 'sac_scale', ['get', 'hiking']],
      ['get', 'sacScale'],
      ['get', 'sac_scale']
    ],
    [
      'match',
      ['var', 'sacScale'],
      'difficult_alpine_hiking', '#4a0404',
      'demanding_alpine_hiking', '#4a0404',
      'alpine_hiking', '#e67e22',
      'demanding_mountain_hiking', '#f7d774',
      'mountain_hiking', '#27ae60',
      'hiking', '#a8f0c5',
      '#d0d4db'
    ]
  ]);
  const DEBUG_NETWORK_POI_COLOR_EXPRESSION = Object.freeze([
    'match',
    [
      'coalesce',
      ['get', 'subclass'],
      ['get', 'class'],
      ''
    ],
    'peak', '#2d7bd6',
    'volcano', '#2d7bd6',
    'mountain_pass', '#4a6d8c',
    'saddle', '#4a6d8c',
    'viewpoint', '#35a3ad',
    'restaurant', '#d97706',
    'fast_food', '#d97706',
    'cafe', '#d97706',
    'bar', '#b45309',
    'pub', '#b45309',
    'parking', '#4b5563',
    'parking_underground', '#4b5563',
    'parking_multi-storey', '#4b5563',
    'parking_multistorey', '#4b5563',
    'parking_multi_storey', '#4b5563',
    'alpine_hut', '#68b723',
    'wilderness_hut', '#68b723',
    'cabin', '#68b723',
    'shelter', '#68b723',
    'hostel', '#68b723',
    'guest_house', '#68b723',
    'hotel', '#68b723',
    '#2d7bd6'
  ]);
  const DEBUG_NETWORK_POI_LABEL_TEXT_EXPRESSION = Object.freeze([
    'let',
    'rawNameCandidate',
    [
      'coalesce',
      ['get', 'name:fr'],
      ['get', 'name'],
      ['get', 'name:en'],
      ['get', 'ref'],
      ''
    ],
    [
      'let',
      'rawCategoryCandidate',
      [
        'coalesce',
        ['get', 'subclass'],
        ['get', 'class'],
        ''
      ],
      [
        'let',
        'labelName',
        [
          'case',
          ['==', ['typeof', ['var', 'rawNameCandidate']], 'string'],
          ['var', 'rawNameCandidate'],
          ['==', ['typeof', ['var', 'rawNameCandidate']], 'number'],
          ['to-string', ['var', 'rawNameCandidate']],
          ''
        ],
        [
          'let',
          'labelCategory',
          [
            'case',
            ['==', ['typeof', ['var', 'rawCategoryCandidate']], 'string'],
            ['var', 'rawCategoryCandidate'],
            ['==', ['typeof', ['var', 'rawCategoryCandidate']], 'number'],
            ['to-string', ['var', 'rawCategoryCandidate']],
            ''
          ],
          [
            'case',
            ['!=', ['var', 'labelName'], ''],
            ['var', 'labelName'],
            [
              'match',
              ['var', 'labelCategory'],
              'peak', 'Sommet',
              'volcano', 'Volcan',
              'mountain_pass', 'Col',
              'saddle', 'Col',
              'viewpoint', 'Point de vue',
              'restaurant', 'Restaurant',
              'fast_food', 'Restauration rapide',
              'cafe', 'Café',
              'bar', 'Bar',
              'pub', 'Pub',
              'parking', 'Parking',
              'parking_underground', 'Parking',
              'parking_multi-storey', 'Parking',
              'parking_multistorey', 'Parking',
              'parking_multi_storey', 'Parking',
              'alpine_hut', 'Refuge',
              'wilderness_hut', 'Cabane',
              'cabin', 'Cabane',
              'shelter', 'Abri',
              'hostel', 'Auberge',
              'guest_house', "Maison d'hôtes",
              'hotel', 'Hôtel',
              'spring', 'Source',
              'water', 'Eau',
              'drinking_water', 'Eau potable',
              ''
            ]
          ]
        ]
      ]
    ]
  ]);
  let debugNetworkVisible = false;
  let debugNetworkData = null;
  let directionsManager = null;

  const bringDebugNetworkToFront = () => {
    if (!map || typeof map.moveLayer !== 'function') {
      return;
    }
    if (map.getLayer(DEBUG_NETWORK_LAYER_ID)) {
      map.moveLayer(DEBUG_NETWORK_LAYER_ID);
    }
    if (map.getLayer(DEBUG_NETWORK_INTERSECTIONS_LAYER_ID)) {
      map.moveLayer(DEBUG_NETWORK_INTERSECTIONS_LAYER_ID);
    }
    if (map.getLayer(DEBUG_NETWORK_POIS_LAYER_ID)) {
      map.moveLayer(DEBUG_NETWORK_POIS_LAYER_ID);
    }
    if (map.getLayer(DEBUG_NETWORK_POIS_LABEL_LAYER_ID)) {
      map.moveLayer(DEBUG_NETWORK_POIS_LABEL_LAYER_ID);
    }
  };

  const ensureMapStyleReady = () => {
    if (!map || typeof map.isStyleLoaded !== 'function') {
      return Promise.resolve();
    }
    if (map.isStyleLoaded()) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      map.once('style.load', resolve);
    });
  };

  const updateDebugNetworkControlState = (active) => {
    if (!debugNetworkCheckbox) return;
    const isActive = Boolean(active && activeRouterKey === 'offline');
    debugNetworkCheckbox.checked = isActive;
    if (debugNetworkControl) {
      debugNetworkControl.classList.toggle('is-active', isActive);
      debugNetworkControl.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }
  };

  const updateRoutingModeToggle = () => {
    if (!routingModeToggle) return;
    const offlineActive = activeRouterKey === 'offline';
    const isLoadingOffline = offlineNetworkLoadingCount > 0;
    const onlineAvailable = Boolean(routers.online);
    routingModeToggle.classList.toggle('active', offlineActive);
    routingModeToggle.classList.toggle('is-offline', offlineActive);
    routingModeToggle.classList.toggle('is-online', !offlineActive);
    routingModeToggle.classList.toggle('is-loading', isLoadingOffline);
    routingModeToggle.classList.toggle('is-disabled', !onlineAvailable);
    routingModeToggle.disabled = !onlineAvailable;
    routingModeToggle.setAttribute('aria-pressed', offlineActive ? 'true' : 'false');
    routingModeToggle.dataset.routingMode = offlineActive ? 'offline' : 'online';
    const labelText = offlineActive ? 'Offline routing' : 'Online routing';
    if (routingModeLabel) routingModeLabel.textContent = labelText;
    if (routingModeIcon) {
      routingModeIcon.src = offlineActive ? ROUTING_ICON_OFFLINE : ROUTING_ICON_ONLINE;
    }
    if (routingModeLoadingText) {
      routingModeLoadingText.setAttribute('aria-hidden', isLoadingOffline ? 'false' : 'true');
    }
    let titleText;
    let ariaLabel;
    if (!onlineAvailable) {
      routingModeToggle.setAttribute('aria-busy', 'false');
      titleText = 'Online routing unavailable';
      ariaLabel = 'Online routing is unavailable because no online service is configured.';
    } else if (isLoadingOffline) {
      routingModeToggle.setAttribute('aria-busy', 'true');
      titleText = 'Loading offline routing network…';
      ariaLabel = 'Loading offline routing network…';
    } else {
      routingModeToggle.setAttribute('aria-busy', 'false');
      titleText = offlineActive
        ? 'Switch to online routing'
        : 'Switch to offline routing';
      ariaLabel = offlineActive
        ? 'Offline routing enabled. Activate to switch to online routing.'
        : 'Online routing enabled. Activate to switch to offline routing.';
    }
    routingModeToggle.title = titleText;
    routingModeToggle.setAttribute('aria-label', ariaLabel);
  };

  const updateDebugNetworkAvailability = () => {
    const offlineActive = activeRouterKey === 'offline';
    if (debugNetworkControl) {
      const isVisible = offlineActive && window.XploreDebug;
      debugNetworkControl.style.display = isVisible ? 'inline-flex' : 'none';
      debugNetworkControl.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
    }
    if (debugNetworkCheckbox) {
      debugNetworkCheckbox.disabled = !offlineActive;
      if (!offlineActive) {
        if (debugNetworkVisible) {
          hideDebugNetworkLayer();
        }
        debugNetworkVisible = false;
        updateDebugNetworkControlState(false);
      } else {
        updateDebugNetworkControlState(debugNetworkVisible);
      }
    }
  };

  const beginOfflineNetworkLoading = () => {
    offlineNetworkLoadingCount += 1;
    updateRoutingModeToggle();
  };

  const endOfflineNetworkLoading = () => {
    if (offlineNetworkLoadingCount > 0) {
      offlineNetworkLoadingCount -= 1;
    }
    updateRoutingModeToggle();
  };

  const trackOfflineNetworkLoading = async (promise) => {
    beginOfflineNetworkLoading();
    try {
      return await promise;
    } finally {
      endOfflineNetworkLoading();
    }
  };

  const loadDebugNetworkData = async () => {
    if (activeRouterKey !== 'offline') {
      return null;
    }
    if (debugNetworkData) {
      return debugNetworkData;
    }
    try {
      await trackOfflineNetworkLoading(offlineRouter.ensureReady());
      const dataset = typeof offlineRouter.getNetworkDebugGeoJSON === 'function'
        ? offlineRouter.getNetworkDebugGeoJSON({ intersectionsOnly: true })
        : offlineRouter.getNetworkGeoJSON();
      const hasFeatures = Array.isArray(dataset?.features) && dataset.features.length > 0;
      if (dataset && typeof dataset === 'object' && hasFeatures) {
        debugNetworkData = dataset;
        return debugNetworkData;
      }
    } catch (error) {
      console.warn('Failed to access cached offline network data', error);
    }
    try {
      const response = await trackOfflineNetworkLoading(fetch('./data/offline-network.geojson', { cache: 'no-store' }));
      if (!response.ok) {
        throw new Error(`Debug network request failed (${response.status})`);
      }
      const fallback = await response.json();
      const hasFallbackFeatures = Array.isArray(fallback?.features) && fallback.features.length > 0;
      if (!hasFallbackFeatures) {
        console.warn('Offline routing network debug dataset is empty');
        return null;
      }
      debugNetworkData = fallback;
      return debugNetworkData;
    } catch (error) {
      console.error('Failed to load offline routing network for debugging', error);
      return null;
    }
  };

  const applyDebugNetworkLayer = async () => {
    if (activeRouterKey !== 'offline') {
      return false;
    }
    const data = await loadDebugNetworkData();
    if (!data) {
      return false;
    }
    await ensureMapStyleReady();
    if (!map.getSource(DEBUG_NETWORK_SOURCE_ID)) {
      map.addSource(DEBUG_NETWORK_SOURCE_ID, { type: 'geojson', data });
    } else {
      map.getSource(DEBUG_NETWORK_SOURCE_ID).setData(data);
    }
    if (!map.getLayer(DEBUG_NETWORK_LAYER_ID)) {
      map.addLayer({
        id: DEBUG_NETWORK_LAYER_ID,
        type: 'line',
        source: DEBUG_NETWORK_SOURCE_ID,
        paint: {
          'line-color': DEBUG_NETWORK_SAC_SCALE_COLOR_EXPRESSION,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10,
            1.1,
            13,
            1.8,
            16,
            3.2
          ],
          'line-opacity': 0.65
        }
      });
    }
    map.setLayoutProperty(DEBUG_NETWORK_LAYER_ID, 'visibility', 'visible');
    if (!map.getLayer(DEBUG_NETWORK_INTERSECTIONS_LAYER_ID)) {
      map.addLayer({
        id: DEBUG_NETWORK_INTERSECTIONS_LAYER_ID,
        type: 'circle',
        source: DEBUG_NETWORK_SOURCE_ID,
        filter: [
          'all',
          ['==', ['geometry-type'], 'Point'],
          ['>=', ['coalesce', ['get', 'nodeDegree'], 0], 3]
        ],
        paint: {
          'circle-radius': [
            'interpolate',
            ['exponential', 1.4],
            ['zoom'],
            8,
            0.6,
            12,
            1.4,
            16,
            2.6
          ],
          'circle-color': '#2ca25f',
          'circle-stroke-color': '#0b4222',
          'circle-stroke-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            8,
            0.4,
            16,
            0.9
          ],
          'circle-opacity': 0.85
        }
      });
    }
    if (map.getLayer(DEBUG_NETWORK_INTERSECTIONS_LAYER_ID)) {
      map.setLayoutProperty(DEBUG_NETWORK_INTERSECTIONS_LAYER_ID, 'visibility', 'visible');
    }
    const poiCollection = offlineNetworkPois;
    const emptyCollection = { type: 'FeatureCollection', features: [] };
    const hasPois = Array.isArray(poiCollection?.features) && poiCollection.features.length > 0;
    if (!map.getSource(DEBUG_NETWORK_POIS_SOURCE_ID)) {
      map.addSource(DEBUG_NETWORK_POIS_SOURCE_ID, {
        type: 'geojson',
        data: hasPois ? poiCollection : emptyCollection
      });
    } else {
      map.getSource(DEBUG_NETWORK_POIS_SOURCE_ID).setData(hasPois ? poiCollection : emptyCollection);
    }
    if (hasPois) {
      if (!map.getLayer(DEBUG_NETWORK_POIS_LAYER_ID)) {
        map.addLayer({
          id: DEBUG_NETWORK_POIS_LAYER_ID,
          type: 'circle',
          source: DEBUG_NETWORK_POIS_SOURCE_ID,
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-radius': [
              'interpolate',
              ['linear'],
              ['zoom'],
              8,
              2.2,
              12,
              3.4,
              15,
              5.4
            ],
            'circle-color': DEBUG_NETWORK_POI_COLOR_EXPRESSION,
            'circle-stroke-color': '#0f172a',
            'circle-stroke-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              8,
              0.4,
              15,
              1.1
            ],
            'circle-opacity': 0.9,
            'circle-stroke-opacity': 0.95
          }
        });
      }
      map.setLayoutProperty(DEBUG_NETWORK_POIS_LAYER_ID, 'visibility', 'visible');
      if (!map.getLayer(DEBUG_NETWORK_POIS_LABEL_LAYER_ID)) {
        map.addLayer({
          id: DEBUG_NETWORK_POIS_LABEL_LAYER_ID,
          type: 'symbol',
          source: DEBUG_NETWORK_POIS_SOURCE_ID,
          filter: ['==', ['geometry-type'], 'Point'],
          layout: {
            'text-field': DEBUG_NETWORK_POI_LABEL_TEXT_EXPRESSION,
            'text-size': [
              'interpolate',
              ['linear'],
              ['zoom'],
              10,
              11,
              13,
              13,
              16,
              16
            ],
            'text-offset': [0, 1.1],
            'text-anchor': 'top',
            'text-variable-anchor': ['top', 'right', 'left', 'bottom'],
            'text-radial-offset': 0.6,
            'text-max-width': 8,
            'text-justify': 'center',
            'text-line-height': 1.2,
            'text-padding': 2
          },
          paint: {
            'text-color': DEBUG_NETWORK_POI_COLOR_EXPRESSION,
            'text-halo-color': 'rgba(255, 255, 255, 0.94)',
            'text-halo-width': 1.2,
            'text-halo-blur': 0.2
          }
        });
      }
      map.setLayoutProperty(DEBUG_NETWORK_POIS_LABEL_LAYER_ID, 'visibility', 'visible');
    } else {
      if (map.getLayer(DEBUG_NETWORK_POIS_LAYER_ID)) {
        map.setLayoutProperty(DEBUG_NETWORK_POIS_LAYER_ID, 'visibility', 'none');
      }
      if (map.getLayer(DEBUG_NETWORK_POIS_LABEL_LAYER_ID)) {
        map.setLayoutProperty(DEBUG_NETWORK_POIS_LABEL_LAYER_ID, 'visibility', 'none');
      }
    }
    bringDebugNetworkToFront();
    return true;
  };

  const hideDebugNetworkLayer = () => {
    if (map.getLayer(DEBUG_NETWORK_LAYER_ID)) {
      map.setLayoutProperty(DEBUG_NETWORK_LAYER_ID, 'visibility', 'none');
    }
    if (map.getLayer(DEBUG_NETWORK_INTERSECTIONS_LAYER_ID)) {
      map.setLayoutProperty(DEBUG_NETWORK_INTERSECTIONS_LAYER_ID, 'visibility', 'none');
    }
    if (map.getLayer(DEBUG_NETWORK_POIS_LAYER_ID)) {
      map.setLayoutProperty(DEBUG_NETWORK_POIS_LAYER_ID, 'visibility', 'none');
    }
    if (map.getLayer(DEBUG_NETWORK_POIS_LABEL_LAYER_ID)) {
      map.setLayoutProperty(DEBUG_NETWORK_POIS_LABEL_LAYER_ID, 'visibility', 'none');
    }
  };

  const boundsToPlain = (bounds) => {
    if (!bounds) {
      return null;
    }
    if (typeof bounds.getWest === 'function') {
      return {
        west: bounds.getWest(),
        east: bounds.getEast(),
        south: bounds.getSouth(),
        north: bounds.getNorth()
      };
    }
    const west = Number(bounds.west);
    const east = Number(bounds.east);
    const south = Number(bounds.south);
    const north = Number(bounds.north);
    if ([west, east, south, north].some((value) => !Number.isFinite(value))) {
      return null;
    }
    return { west, east, south, north };
  };

  const boundsContains = (outer, inner, epsilon = 1e-6) => {
    if (!outer || !inner) {
      return false;
    }
    return inner.west >= outer.west - epsilon
      && inner.east <= outer.east + epsilon
      && inner.south >= outer.south - epsilon
      && inner.north <= outer.north + epsilon;
  };

  const mergeBounds = (...boundsList) => {
    let west = Infinity;
    let east = -Infinity;
    let south = Infinity;
    let north = -Infinity;

    boundsList.forEach((entry) => {
      const plain = boundsToPlain(entry);
      if (!plain) {
        return;
      }
      if (plain.west < west) west = plain.west;
      if (plain.east > east) east = plain.east;
      if (plain.south < south) south = plain.south;
      if (plain.north > north) north = plain.north;
    });

    if (![west, east, south, north].every((value) => Number.isFinite(value))) {
      return null;
    }

    return { west, east, south, north };
  };

  const deriveOverpassCenter = (bounds) => {
    const plain = boundsToPlain(bounds);
    if (!plain) {
      return null;
    }
    const lat = (plain.north + plain.south) / 2;
    const lon = (plain.east + plain.west) / 2;
    if (![lat, lon].every((value) => Number.isFinite(value))) {
      return null;
    }
    return { lat, lon };
  };

  const computeCoordinateBounds = (coordinates) => {
    if (!Array.isArray(coordinates) || !coordinates.length) {
      return null;
    }

    let west = Infinity;
    let east = -Infinity;
    let south = Infinity;
    let north = -Infinity;

    coordinates.forEach((coord) => {
      if (!Array.isArray(coord) || coord.length < 2) {
        return;
      }
      const lng = Number(coord[0]);
      const lat = Number(coord[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return;
      }
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    });

    if (!Number.isFinite(west) || !Number.isFinite(east) || !Number.isFinite(south) || !Number.isFinite(north)) {
      return null;
    }

    const expandIfZeroSpan = (min, max) => {
      if (min === max) {
        const delta = 1e-6;
        return [min - delta, max + delta];
      }
      return [min, max];
    };

    const [normWest, normEast] = expandIfZeroSpan(west, east);
    const [normSouth, normNorth] = expandIfZeroSpan(south, north);

    return {
      west: normWest,
      east: normEast,
      south: normSouth,
      north: normNorth
    };
  };

  const shouldRefreshOfflineNetwork = () => {
    if (!map || typeof map.getBounds !== 'function') {
      return false;
    }
    const current = boundsToPlain(map.getBounds());
    if (!current) {
      return false;
    }
    if (!offlineNetworkCoverage) {
      return true;
    }
    return !boundsContains(offlineNetworkCoverage, current);
  };

  const refreshOfflineNetwork = async (options = {}) => {
    if (!map) {
      return null;
    }
    if (activeRouterKey !== 'offline') {
      return null;
    }
    if (offlineNetworkRefreshPromise) {
      return offlineNetworkRefreshPromise;
    }
    const { waypointBounds = null } = options || {};
    offlineNetworkRefreshPromise = (async () => {
      beginOfflineNetworkLoading();
      try {
        const mapBounds = typeof map.getBounds === 'function' ? map.getBounds() : null;
        const combinedBounds = mergeBounds(mapBounds, waypointBounds);
        const fallbackBounds = boundsToPlain(mapBounds) ?? boundsToPlain(waypointBounds);
        const targetBounds = combinedBounds ?? fallbackBounds;
        const mapCenter = typeof map.getCenter === 'function' ? map.getCenter() : null;
        const centerLat = Number(mapCenter?.lat ?? mapCenter?.latitude ?? mapCenter?.[1]);
        const centerLon = Number(mapCenter?.lng ?? mapCenter?.lon ?? mapCenter?.longitude ?? mapCenter?.[0]);

        let networkResult = { network: null, coverageBounds: null, pois: null };

        if (preferOpenFreeMapNetwork) {
          const network = await extractOpenFreeMapNetwork(map, { targetBounds });
          networkResult = { network, coverageBounds: null, pois: null };
        } else {
          let overpassCenter = Number.isFinite(centerLat) && Number.isFinite(centerLon)
            ? { lat: centerLat, lon: centerLon }
            : null;
          if (!overpassCenter) {
            const fallbackCenter = deriveOverpassCenter(targetBounds ?? fallbackBounds);
            if (fallbackCenter) {
              overpassCenter = fallbackCenter;
            }
          }
          if (!overpassCenter) {
            throw new Error('Unable to determine center coordinate for Overpass network extraction');
          }
          networkResult = await extractOverpassNetwork(overpassCenter);
        }

        const { network, coverageBounds } = networkResult;

        if (network && Array.isArray(network.features) && network.features.length) {
          await offlineRouter.setNetworkGeoJSON(network);
          const debugDataset = typeof offlineRouter.getNetworkDebugGeoJSON === 'function'
            ? offlineRouter.getNetworkDebugGeoJSON({ intersectionsOnly: true })
            : network;
          debugNetworkData = debugDataset || network;
          const fallbackCoverage = boundsToPlain(targetBounds ?? fallbackBounds);
          offlineNetworkCoverage = coverageBounds ?? fallbackCoverage;
          offlineNetworkPois = ensureFeatureCollection(networkResult.pois);
          if (directionsManager && typeof directionsManager.setOfflinePointsOfInterest === 'function') {
            directionsManager.setOfflinePointsOfInterest(offlineNetworkPois);
          }

          // Extract POI coordinates for Wikimedia photo thumbnails
          const poiCoords = (offlineNetworkPois.features || [])
            .map((f) => f?.geometry?.coordinates)
            .filter((c) => Array.isArray(c) && c.length >= 2);
          setNetworkPoiCoordinates(poiCoords);

          if (debugNetworkVisible) {
            await applyDebugNetworkLayer();
          }
        } else {
          const sourceLabel = preferOpenFreeMapNetwork ? 'OpenFreeMap' : 'Overpass';
          console.warn(`${sourceLabel} network extraction returned no features for offline routing`);
        }
      } catch (error) {
        const sourceLabel = preferOpenFreeMapNetwork ? 'OpenFreeMap' : 'Overpass';
        console.error(`Failed to rebuild offline routing network from ${sourceLabel} data`, error);
      } finally {
        offlineNetworkRefreshPromise = null;
        endOfflineNetworkLoading();
      }
    })();
    return offlineNetworkRefreshPromise;
  };

  const setActiveRouter = async (targetKey, { reroute = false } = {}) => {
    if (!routers[targetKey]) {
      console.warn(`Router "${targetKey}" is unavailable; keeping ${activeRouterKey} active.`);
      updateRoutingModeToggle();
      updateDebugNetworkAvailability();
      return;
    }

    if (targetKey === activeRouterKey) {
      updateRoutingModeToggle();
      updateDebugNetworkAvailability();
      if (
        reroute
        && directionsManager
        && typeof directionsManager.getRoute === 'function'
        && Array.isArray(directionsManager.waypoints)
        && directionsManager.waypoints.length >= 2
      ) {
        directionsManager.getRoute();
      }
      return;
    }

    if (routingModeToggle) {
      routingModeToggle.disabled = true;
    }

    activeRouterKey = targetKey;
    updateRoutingModeToggle();
    updateDebugNetworkAvailability();

    try {
      if (targetKey !== 'offline') {
        if (debugNetworkVisible) {
          hideDebugNetworkLayer();
          debugNetworkVisible = false;
        }
        updateDebugNetworkControlState(false);
        // Clear POI coordinates when leaving offline mode
        // POI coordinates are preserved to allow photo thumbnails to work in online mode
        // setNetworkPoiCoordinates([]);
      }

      if (directionsManager && typeof directionsManager.setRouter === 'function') {
        const waypointCount = Array.isArray(directionsManager.waypoints)
          ? directionsManager.waypoints.length
          : 0;
        const deferEnsureReady = targetKey === 'offline' && waypointCount === 0;
        directionsManager.setRouter(routers[targetKey], { reroute, deferEnsureReady });
      }
    } finally {
      if (routingModeToggle) {
        routingModeToggle.disabled = false;
      }
      updateRoutingModeToggle();
      updateDebugNetworkAvailability();
    }
  };

  const switchRoutingMode = (targetKey, { reroute = true } = {}) => {
    return setActiveRouter(targetKey, { reroute })
      .catch((error) => {
        console.error('Failed to switch routing mode', error);
      });
  };

  const EMPTY_COLLECTION = { type: 'FeatureCollection', features: [] };

  let currentGpxData = EMPTY_COLLECTION;
  let directionsExportData = EMPTY_COLLECTION;
  let directionsSegmentExports = [];

  const ensureFeatureCollection = (geojson) => {
    if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
      return EMPTY_COLLECTION;
    }
    return {
      type: 'FeatureCollection',
      features: geojson.features.filter(feature => Boolean(feature))
    };
  };

  const buildCombinedExportData = () => {
    const collections = [currentGpxData, directionsExportData];
    const features = [];
    collections.forEach((collection) => {
      if (!collection || collection.type !== 'FeatureCollection') return;
      (collection.features || []).forEach((feature) => {
        if (feature) features.push(feature);
      });
    });
    return { type: 'FeatureCollection', features };
  };

  const cloneFeature = (feature) => {
    if (!feature) return null;
    try {
      if (typeof structuredClone === 'function') {
        return structuredClone(feature);
      }
    } catch (_) { }
    try {
      return JSON.parse(JSON.stringify(feature));
    } catch (_) {
      return null;
    }
  };

  const slugify = (value) => {
    if (typeof value !== 'string') return 'segment';
    const normalized = value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return normalized || 'segment';
  };

  const applyGpxData = (geojson, { fitBounds = false } = {}) => {
    currentGpxData = ensureFeatureCollection(geojson);

    const applyLayers = () => {
      ensureGpxLayers(map, currentGpxData);
      if (fitBounds && currentGpxData.features.length) {
        zoomToGeojson(map, currentGpxData);
      }
    };

    if (typeof map.isStyleLoaded === 'function' && !map.isStyleLoaded()) {
      map.once('style.load', applyLayers);
    } else {
      applyLayers();
    }
  };

  applyGpxData(EMPTY_COLLECTION);

  // --- Routing Panel Utilities (DEPRECATED) ---
  // Functions removed as they are no longer needed for the consolidated bar

  map.on('load', async () => {
    // Terrain Analysis Hover Readout
    const terrainHoverInfo = document.getElementById('terrainHoverInfo');

    map.on('mousemove', (e) => {
      const isAspect = imageryState.get('aspect')?.enabled;
      const isSlope = imageryState.get('slope')?.enabled;
      const isAvalanche = imageryState.get('avalanche')?.enabled;

      if (!terrainHoverInfo) return;

      if (!(isAspect || isSlope || isAvalanche)) {
        terrainHoverInfo.style.display = 'none';
        return;
      }

      const terrain = calculateTerrainAnalysis(e.lngLat);
      if (!terrain) {
        terrainHoverInfo.style.display = 'none';
        return;
      }

      let content = '';

      // Slope Filtering
      if (isSlope) {
        const min = window.slopeConfig?.min ?? 0;
        const max = window.slopeConfig?.max ?? 90;
        if (terrain.slope >= min && terrain.slope <= max) {
          content += `<span style="color: #2ecc71">Slope:</span> ${terrain.slope.toFixed(1)}° `;
        }
      }

      // Avalanche Filtering
      if (isAvalanche) {
        if (terrain.slope >= 30) {
          const color = terrain.slope >= 30 && terrain.slope <= 50 ? '#ff6b6b' : '#2ecc71';
          content += `<span style="color: ${color}">Slope:</span> ${terrain.slope.toFixed(1)}° `;
          if (terrain.slope <= 50) {
            content += `<div style="color: #e74c3c; font-weight: 800; font-size: 10px; margin-top: 2px">⚠️ AVALANCHE DANGER ZONE</div>`;
          }
        }
      }

      // Aspect (Always visible when active)
      if (isAspect) {
        content += `<span style="color: #3498db">Aspect:</span> ${terrain.aspectName} `;
      }

      if (content) {
        terrainHoverInfo.innerHTML = content;
        terrainHoverInfo.style.display = 'block';
        terrainHoverInfo.style.left = `${e.originalEvent.clientX}px`;
        terrainHoverInfo.style.top = `${e.originalEvent.clientY}px`;
      } else {
        terrainHoverInfo.style.display = 'none';
      }
    });

    map.on('mouseleave', () => {
      if (terrainHoverInfo) terrainHoverInfo.style.display = 'none';
    });

    // Manually add AttributionControl in compact mode after load
    map.addControl(new maplibregl.AttributionControl({ compact: true }));
    try {
      directionsManager = new DirectionsManager(map, [
        directionsToggle,
        directionsDock,
        directionsControl,
        transportModes,
        swapButton,
        undoButton,
        redoButton,
        clearButton,
        routeStats,
        routeTimeline,
        elevationCard,
        elevationChartBody,
        elevationChart,
        elevationCollapseToggle,
        profileModeToggle,
        profileModeMenu,
        profileLegend
      ], {
        router: offlineRouter,
        deferRouterInitialization: true
      });

      // Initialize Route Library
      const routeLibraryManager = new RouteLibraryManager();
      const routeLibraryUI = new RouteLibraryUI(routeLibraryManager, directionsManager);
      directionsManager.routeLibraryManager = routeLibraryManager; // Inject into DirectionsManager

      console.log('[App] DirectionsManager initialized:', directionsManager);

      const initialRouter = routers[activeRouterKey] ?? offlineRouter;
      if (typeof directionsManager.setRouter === 'function') {
        const deferEnsureReady = initialRouter === offlineRouter
          && (!Array.isArray(directionsManager.waypoints) || directionsManager.waypoints.length === 0);
        directionsManager.setRouter(initialRouter, { deferEnsureReady });
      }
      if (typeof directionsManager.setOfflinePointsOfInterest === 'function') {
        directionsManager.setOfflinePointsOfInterest(offlineNetworkPois);
      }
      directionsManager.setRouteSegmentsListener((payload) => {
        const isObject = payload && typeof payload === 'object';
        const dataset = isObject && payload.full ? payload.full : payload;
        directionsExportData = ensureFeatureCollection(dataset);
        const segments = isObject && Array.isArray(payload.segments) ? payload.segments : [];
        directionsSegmentExports = segments
          .map((entry) => {
            const collection = ensureFeatureCollection(entry?.collection);
            if (!collection.features || !collection.features.length) {
              return null;
            }
            const name = typeof entry?.name === 'string' && entry.name.trim().length
              ? entry.name.trim()
              : null;
            return {
              name,
              index: Number.isInteger(entry?.index) ? entry.index : null,
              collection
            };
          })
          .filter(Boolean);
      });

      // Clear the imported GPX layer when directions are cleared
      directionsManager.setClearDirectionsListener(() => {
        currentGpxData = EMPTY_COLLECTION;
        ensureGpxLayers(map, currentGpxData);
      });

      directionsManager.setNetworkPreparationCallback(async ({ waypoints }) => {
        if (activeRouterKey !== 'offline') {
          return;
        }
        const coords = Array.isArray(waypoints) ? waypoints : [];
        if (coords.length) {
          try {
            await trackOfflineNetworkLoading(offlineRouter.ensureReady());
          } catch (error) {
            console.warn('Offline router initialization deferred until waypoint placement failed', error);
          }
        }
        const bounds = computeCoordinateBounds(coords);

        const lacksWaypointCoverage = () => {
          if (!coords.length) {
            return false;
          }
          if (!offlineNetworkCoverage) {
            return true;
          }
          if (!bounds) {
            return !offlineNetworkCoverage;
          }
          return !boundsContains(offlineNetworkCoverage, bounds, 1e-5);
        };

        const lacksMapCoverage = () => {
          if (coords.length) {
            return false;
          }
          if (!offlineNetworkCoverage) {
            return true;
          }
          return shouldRefreshOfflineNetwork();
        };

        if (lacksWaypointCoverage() || lacksMapCoverage()) {
          try {
            await refreshOfflineNetwork({ waypointBounds: bounds });
          } catch (error) {
            console.warn('Deferred offline routing network refresh failed', error);
          }
        }
      });
    } catch (error) {
      console.error('Failed to initialize directions manager', error);
    }
  });

  map.on('style.load', () => {
    offlineNetworkCoverage = null;
    offlineNetworkRefreshPromise = null;
    debugNetworkData = null;
    if (!debugNetworkVisible) {
      return;
    }
    applyDebugNetworkLayer().catch((error) => {
      console.error('Failed to reapply routing network debug layer', error);
    });
  });

  if (debugNetworkCheckbox) {
    updateDebugNetworkControlState(false);
    debugNetworkCheckbox.addEventListener('change', async () => {
      if (activeRouterKey !== 'offline') {
        updateDebugNetworkControlState(false);
        return;
      }
      const targetState = debugNetworkCheckbox.checked;
      debugNetworkCheckbox.disabled = true;
      try {
        if (targetState) {
          let applied = await applyDebugNetworkLayer();
          if (!applied) {
            await refreshOfflineNetwork();
            applied = await applyDebugNetworkLayer();
          }
          if (!applied) {
            window.alert('Unable to display the routing network. Check the console for details.');
          }
          debugNetworkVisible = applied;
        } else {
          hideDebugNetworkLayer();
          debugNetworkVisible = false;
        }
      } catch (error) {
        console.error('Failed to toggle routing network overlay', error);
      } finally {
        debugNetworkCheckbox.disabled = false;
        updateDebugNetworkControlState(debugNetworkVisible);
      }
    });
  }


  if (routingModeToggle) {
    routingModeToggle.addEventListener('click', (event) => {
      const targetKey = activeRouterKey === 'offline' ? 'online' : 'offline';
      switchRoutingMode(targetKey);
    });
  }

  if (routingModeIcon) {
    routingModeIcon.addEventListener('click', (event) => {
      if (activeRouterKey !== 'offline') {
        return;
      }
      event.stopPropagation();
      switchRoutingMode('online');
    });
  }

  updateRoutingModeToggle();
  updateDebugNetworkAvailability();

  if (gpxImportButton && gpxFileInput) {
    gpxImportButton.addEventListener('click', () => {
      gpxFileInput.click();
    });

    gpxFileInput.addEventListener('change', async () => {
      const file = gpxFileInput.files && gpxFileInput.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const geojson = parseGpxToGeoJson(text);
        if (!geojson || !geojson.features || geojson.features.length === 0) {
          window.alert('No GPX features were found in the selected file.');
        } else {
          applyGpxData(geojson, { fitBounds: true });
          if (directionsManager && typeof directionsManager.importRouteFromGeojson === 'function') {
            const imported = directionsManager.importRouteFromGeojson(geojson);
            if (!imported) {
              console.warn('Unable to initialize routing from the imported GPX data');
            }
          }
        }
      } catch (error) {
        console.error('Failed to import GPX file', error);
        window.alert('Unable to load the selected GPX file. Please ensure it is valid.');
      } finally {
        gpxFileInput.value = '';
      }
    });
  }

  if (gpxExportButton) {
    gpxExportButton.addEventListener('click', () => {
      const dataset = buildCombinedExportData();
      if (!dataset.features || dataset.features.length === 0) {
        window.alert('There is no GPX data to export yet.');
        return;
      }
      try {
        const downloadGpx = (content, filename) => {
          const blob = new Blob([content], { type: 'application/gpx+xml' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(url), 0);
        };

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const baseName = `xploremap-${timestamp}`;
        const segmentCollections = Array.isArray(directionsSegmentExports)
          ? directionsSegmentExports.filter((entry) => entry && entry.collection?.features?.length)
          : [];

        if (segmentCollections.length) {
          segmentCollections.forEach((entry, index) => {
            try {
              const combinedFeatures = [];
              (currentGpxData.features || []).forEach((feature) => {
                const clone = cloneFeature(feature);
                if (clone) combinedFeatures.push(clone);
              });
              (entry.collection.features || []).forEach((feature) => {
                const clone = cloneFeature(feature);
                if (clone) combinedFeatures.push(clone);
              });
              if (!combinedFeatures.length) {
                return;
              }
              const segmentDataset = { type: 'FeatureCollection', features: combinedFeatures };
              const segmentLabel = entry.name ? slugify(entry.name) : `segment-${String(index + 1).padStart(2, '0')}`;
              const filename = `${baseName}-${String(index + 1).padStart(2, '0')}-${segmentLabel}.gpx`;
              const gpxContent = geojsonToGpx(segmentDataset);
              downloadGpx(gpxContent, filename);
            } catch (segmentError) {
              console.error('Failed to export segmented GPX data', segmentError);
            }
          });
          return;
        }

        const gpxContent = geojsonToGpx(dataset);
        downloadGpx(gpxContent, `${baseName}.gpx`);
      } catch (error) {
        console.error('Failed to export GPX data', error);
        window.alert('Unable to export GPX data.');
      }
    });
  }

  map.on('styleimagemissing', (e) => {
    if (map.hasImage(e.id)) return;
    const data = new Uint8Array([0, 0, 0, 0]);
    map.addImage(e.id, { width: 1, height: 1, data });
  });

  const demSource = new mlcontour.DemSource({
    url: MAPTERHORN_TILE_URL,
    encoding: 'terrarium',
    maxzoom: DEM_SOURCE_MAX_ZOOM,
    worker: true,
    tileSize: 512
  });
  demSource.setupMaplibre(maplibregl);

  const vignetteEl = document.querySelector('.vignette');
  const viewToggleBtn = document.getElementById('toggle3D');

  const viewModeController = createViewModeController(map, {
    toggleButton: viewToggleBtn,
    vignetteElement: vignetteEl,
    skySettings: SKY_SETTINGS,
    defaultMode: VIEW_MODES.THREED,
    defaultOrientation: DEFAULT_3D_ORIENTATION,
    terrainSourceId: 'terrainSource',
    hdSources: ['terrainSource', 'hillshadeSource', 'reliefDem', 'color-relief']
  });



  // Initialize Shadow & Time Controls for native layers
  const initShadowTimeControl = () => {
    const control = document.getElementById('shadowTimeControl');
    const dateInput = document.getElementById('shadowDate');
    const timeSlider = document.getElementById('shadowTime');
    const timeLabel = document.getElementById('shadowTimeLabel');
    const nowBtn = document.getElementById('shadowTimeNow');
    const closeBtn = document.getElementById('shadowTimeClose');

    if (!control || !dateInput || !timeSlider || !timeLabel) return;

    const formatTime = (mins) => {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    };

    const updateShadowTime = () => {
      const dateParts = dateInput.value.split('-');
      const mins = parseInt(timeSlider.value, 10);
      const h = Math.floor(mins / 60);
      const m = mins % 60;

      const date = new Date(
        parseInt(dateParts[0], 10),
        parseInt(dateParts[1], 10) - 1,
        parseInt(dateParts[2], 10),
        h, m, 0, 0
      );

      // Store in window for shaders to pick up
      window.skySimulationDate = date.getTime();

      // Update native shadow layer's hillshade illumination
      if (map) {
        try {
          const center = map.getCenter();
          const sunPos = SunCalc.getPosition(date, center.lat, center.lng);
          const moonPos = SunCalc.getMoonPosition(date, center.lat, center.lng);

          const sunAzi = (sunPos.azimuth * 180 / Math.PI + 180) % 360;
          const sunAlt = sunPos.altitude * 180 / Math.PI;
          const moonAzi = (moonPos.azimuth * 180 / Math.PI + 180) % 360;
          const moonAlt = moonPos.altitude * 180 / Math.PI;

          // Decide which light source is primary
          const isNight = sunAlt <= 0;
          const azi = isNight ? moonAzi : sunAzi;
          const alt = isNight ? Math.max(0.01, moonAlt) : Math.max(0.01, sunAlt);

          // Update window.sunConfig for hillshade_prepare shadow computation
          window.sunConfig = { azimuth: azi, altitude: alt };

          // Force DEM tiles to re-render with new light position
          if (map.style && map.style.sourceCaches) {
            Object.values(map.style.sourceCaches).forEach((cache) => {
              if (cache._source && cache._source.type === 'raster-dem') {
                cache.clearTiles();
                cache.update(map.transform);
              }
            });
          }

          // Update hillshade illumination for shadow layer and detail layer
          if (map.getLayer('shadow-native')) {
            map.setPaintProperty('shadow-native', 'hillshade-illumination-direction', azi);
            map.setPaintProperty('shadow-native', 'hillshade-illumination-altitude', [alt, alt, alt, alt]);
          }
          if (map.getLayer('detail-native')) {
            map.setPaintProperty('detail-native', 'hillshade-illumination-direction', azi);
            map.setPaintProperty('detail-native', 'hillshade-illumination-altitude', [alt, alt, alt, alt]);
          }

          // For the main Relief Hillshade: Make it "rotate" by following the light source
          if (map.getLayer('hillshade')) {
            map.setPaintProperty('hillshade', 'hillshade-illumination-direction', [azi, (azi + 45) % 360, (azi - 45 + 360) % 360, (azi + 180) % 360]);
            map.setPaintProperty('hillshade', 'hillshade-illumination-altitude', [alt, alt, alt, alt]);
          }
        } catch (e) {
          console.warn('Could not update light orientation:', e);
        }
      }

      // Update sky preset based on simulation time
      if (viewModeController && viewModeController.updateSkyForTime) {
        viewModeController.updateSkyForTime(date);
      }
    };

    // Initial State
    const currentNow = new Date();
    dateInput.value = currentNow.toISOString().slice(0, 10);
    const initialMinutes = currentNow.getHours() * 60 + currentNow.getMinutes();
    timeSlider.value = initialMinutes;
    timeLabel.textContent = formatTime(initialMinutes);

    // Event Listeners
    dateInput.addEventListener('change', updateShadowTime);

    timeSlider.addEventListener('input', () => {
      const mins = parseInt(timeSlider.value, 10);
      timeLabel.textContent = formatTime(mins);
      updateShadowTime();
    });

    if (nowBtn) {
      nowBtn.addEventListener('click', () => {
        const n = new Date();
        dateInput.value = n.toISOString().slice(0, 10);
        const mins = n.getHours() * 60 + n.getMinutes();
        timeSlider.value = mins;
        timeLabel.textContent = formatTime(mins);
        updateShadowTime();
      });
    }

    // SKY TOGGLE: Disable heavy atmospheric effects for performance testing
    const skyBtn = document.getElementById('shadowSkyToggle');
    if (skyBtn) {
      window._skyDisabled = window._skyDisabled || false;
      const updateSkyBtn = () => {
        skyBtn.dataset.enabled = window._skyDisabled ? 'false' : 'true';
        skyBtn.textContent = window._skyDisabled ? 'Sky OFF' : 'Sky ON';
        skyBtn.style.background = window._skyDisabled ? '#555' : '#e67e22';
        // Show fog controls when Sky is ON, hide when OFF
        const fogControls = document.getElementById('fogDebugControls');
        if (fogControls) {
          fogControls.style.display = window._skyDisabled ? 'none' : 'block';
        }
      };
      updateSkyBtn();

      skyBtn.addEventListener('click', () => {
        window._skyDisabled = !window._skyDisabled;
        updateSkyBtn();
        if (map) map.triggerRepaint();
      });
    }

    // DEBUG: Toggle neighbor visualization mode
    const debugBtn = document.getElementById('shadowDebugToggle');
    if (debugBtn) {
      // Hide debug button container if not in debug mode
      debugBtn.parentElement.style.display = window.XploreDebug ? 'flex' : 'none';

      window._shadowDebugMode = window._shadowDebugMode || false;
      const updateDebugBtn = () => {
        debugBtn.dataset.debug = window._shadowDebugMode ? 'true' : 'false';
        debugBtn.textContent = window._shadowDebugMode ? 'Debug ON' : 'Debug';
        debugBtn.style.background = window._shadowDebugMode ? '#ff6b6b' : '';
      };
      updateDebugBtn();

      debugBtn.addEventListener('click', () => {
        window._shadowDebugMode = !window._shadowDebugMode;
        updateDebugBtn();

        if (map) {
          map.triggerRepaint();
        }
        console.log('[Shadow] Debug mode:', window._shadowDebugMode);
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        control.style.display = 'none';
      });
    }

    updateShadowTime();
  };

  initShadowTimeControl();

  // CSS Fog overlay - toggle based on camera pitch
  const cssFogOverlay = document.getElementById('fogOverlay');
  if (cssFogOverlay) {
    const updateCssFogOverlay = () => {
      const pitch = map.getPitch();
      if (pitch > 20) {
        cssFogOverlay.classList.add('fog-overlay--active');
        const intensity = Math.min(1, (pitch - 20) / 40);
        cssFogOverlay.style.opacity = intensity;

        if (typeof window !== 'undefined' && window._currentSkyPreset) {
          const preset = window._currentSkyPreset;
          const fogHex = preset['fog-color'] || preset['horizon-color'] || '#e8e8e0';
          const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fogHex);
          if (result) {
            const r = parseInt(result[1], 16);
            const g = parseInt(result[2], 16);
            const b = parseInt(result[3], 16);
            cssFogOverlay.style.background = `linear-gradient(
              to top,
              transparent 0%,
              transparent 35%,
              rgba(${r}, ${g}, ${b}, 0.3) 55%,
              rgba(${r}, ${g}, ${b}, 0.7) 75%,
              rgba(${r}, ${g}, ${b}, 0.95) 100%
            )`;
          }
        }
      } else {
        cssFogOverlay.classList.remove('fog-overlay--active');
        cssFogOverlay.style.opacity = 0;
      }
    };

    map.on('pitch', updateCssFogOverlay);
    map.on('move', updateCssFogOverlay);
    updateCssFogOverlay();
  }

  // Initialize Fog Controls (independent of TerrainShadingPlugin)
  const initFogControls = () => {
    const fogGroundBlendSlider = document.getElementById('fogGroundBlendSlider');
    const horizonFogBlendSlider = document.getElementById('horizonFogBlendSlider');
    const skyHorizonBlendSlider = document.getElementById('skyHorizonBlendSlider');
    const fogAutoBtn = document.getElementById('fogAutoBtn');

    if (!fogGroundBlendSlider) {
      console.log('[Fog] Fog controls not found in DOM');
      return;
    }

    console.log('[Fog] Initializing fog controls, setSky:', typeof map?.setSky);

    // Track manual fog override state
    window._fogManualOverride = false;

    // Store current sky settings for modification
    let currentSkySettings = null;

    const applyFogFromSliders = () => {
      // Enable manual override when user touches sliders
      window._fogManualOverride = true;
      if (fogAutoBtn) fogAutoBtn.style.background = '#666';

      const fogGroundBlendLabel = document.getElementById('fogGroundBlendLabel');
      const horizonFogBlendLabel = document.getElementById('horizonFogBlendLabel');
      const skyHorizonBlendLabel = document.getElementById('skyHorizonBlendLabel');

      const fogGroundBlend = parseFloat(fogGroundBlendSlider.value);
      const horizonFogBlend = parseFloat(horizonFogBlendSlider.value);
      const skyHorizonBlend = parseFloat(skyHorizonBlendSlider.value);

      // Update labels
      if (fogGroundBlendLabel) fogGroundBlendLabel.textContent = fogGroundBlend.toFixed(2);
      if (horizonFogBlendLabel) horizonFogBlendLabel.textContent = horizonFogBlend.toFixed(2);
      if (skyHorizonBlendLabel) skyHorizonBlendLabel.textContent = skyHorizonBlend.toFixed(2);

      // Apply fog via setSky
      if (map && typeof map.setSky === 'function') {
        // Get current sky settings to preserve colors
        const existingSky = map.getSky ? map.getSky() : {};

        map.setSky({
          'sky-color': existingSky['sky-color'] || '#87CEEB',
          'horizon-color': existingSky['horizon-color'] || '#f0e6d3',
          'fog-color': existingSky['fog-color'] || '#d8cfc0',
          'sky-horizon-blend': skyHorizonBlend,
          'horizon-fog-blend': horizonFogBlend,
          'fog-ground-blend': fogGroundBlend
        }, { validate: false });

        console.log('[Fog] Applied via setSky:', { fogGroundBlend, horizonFogBlend, skyHorizonBlend });
      } else {
        console.warn('[Fog] setSky not available');
      }
    };

    fogGroundBlendSlider.addEventListener('input', applyFogFromSliders);
    horizonFogBlendSlider.addEventListener('input', applyFogFromSliders);
    skyHorizonBlendSlider.addEventListener('input', applyFogFromSliders);

    if (fogAutoBtn) {
      fogAutoBtn.addEventListener('click', () => {
        window._fogManualOverride = false;
        fogAutoBtn.style.background = '#4a6';
        // Re-apply automatic sky settings
        if (typeof updateShadowTime === 'function') {
          updateShadowTime();
        }
        console.log('[Fog] Auto mode enabled');
      });
    }

    console.log('[Fog] Fog controls initialized');
  };

  // Initialize fog controls when map is ready
  map.once('idle', initFogControls);

  // 5. Initialize Snow Control Logic
  const initSnowControls = () => {
    const snowUI = document.getElementById('snowControls');
    const altSlider = document.getElementById('snowAltitude');
    const slopeSlider = document.getElementById('snowSlope');
    const altLabel = document.getElementById('snowAltitudeLabel');
    const slopeLabel = document.getElementById('snowSlopeLabel');
    const closeBtn = document.getElementById('snowControlsClose');

    if (!snowUI || !altSlider || !slopeSlider) return;

    const updateSnowSettings = () => {
      const altitude = parseInt(altSlider.value, 10);
      const maxSlope = parseInt(slopeSlider.value, 10);

      // Update for native snow layer (hillshade-based)
      window.snowConfig = {
        altitude: altitude,
        maxSlope: maxSlope
      };

      if (map) {
        // Force immediate redraw pass
        map.triggerRepaint();

        // Target specific layers that depend on snowConfig to force state invalidation
        const hillLayers = ['snow-native', 'avalanche-native', 'slope-native', 'aspect-native', 'hillshade', 'shadow-native'];
        hillLayers.forEach(layerId => {
          if (map.getLayer(layerId)) {
            // Nudging a paint property forces the painter to re-evaluate uniforms for this layer.
            // We use a safe, microscopic toggle to ensure MapLibre detects a state change.
            const currentExag = map.getPaintProperty(layerId, 'hillshade-exaggeration') || 1.0;
            const nudge = (altitude % 2 === 0) ? 0 : 0.00001;
            map.setPaintProperty(layerId, 'hillshade-exaggeration', currentExag + nudge);
          }
        });
      }
    };

    const sliderHandler = () => {
      altLabel.textContent = `${altSlider.value}m`;
      slopeLabel.textContent = `${slopeSlider.value}°`; // Ensure both labels verify? No, separate.
      updateSnowSettings();
    };

    altSlider.addEventListener('input', () => {
      altLabel.textContent = `${altSlider.value}m`;
      updateSnowSettings();
    });
    altSlider.addEventListener('change', updateSnowSettings);

    slopeSlider.addEventListener('input', () => {
      slopeLabel.textContent = `${slopeSlider.value}°`;
      updateSnowSettings();
    });
    slopeSlider.addEventListener('change', updateSnowSettings);

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        snowUI.style.display = 'none';
      });
    }
  };

  initSnowControls();

  // 6. Initialize FOV & LOD Control Logic (performance tuning)
  const initFovControls = () => {
    const fovUI = document.getElementById('fovControls');
    const fovSlider = document.getElementById('fovSlider');
    const fovLabel = document.getElementById('fovLabel');
    const lodMaxZoomSlider = document.getElementById('lodMaxZoomSlider');
    const lodMaxZoomLabel = document.getElementById('lodMaxZoomLabel');
    const lodTileRatioSlider = document.getElementById('lodTileRatioSlider');
    const lodTileRatioLabel = document.getElementById('lodTileRatioLabel');
    const dprToggle = document.getElementById('dprToggle');
    const closeBtn = document.getElementById('fovControlsClose');

    if (!fovUI || !fovSlider || !fovLabel) return;

    // Sync DPR checkbox with storage
    if (dprToggle) {
      dprToggle.checked = localStorage.getItem('xplore_dpr_enabled') !== 'false';
      dprToggle.addEventListener('change', () => {
        localStorage.setItem('xplore_dpr_enabled', dprToggle.checked);
        if (confirm('Changer la résolution (Retina) nécessite de recharger la page. Recharger maintenant ?')) {
          window.location.reload();
        }
      });
    }

    const updateFov = () => {
      const fovDegrees = parseInt(fovSlider.value, 10);
      fovLabel.textContent = `${fovDegrees}°`;

      if (map && typeof map.setVerticalFieldOfView === 'function') {
        map.setVerticalFieldOfView(fovDegrees);
        console.log(`[Performance] FOV: ${fovDegrees}°`);
      }
    };

    const updateLod = () => {
      if (!lodMaxZoomSlider || !lodTileRatioSlider) return;

      const maxZoomLevels = parseInt(lodMaxZoomSlider.value, 10);
      const tileRatio = parseFloat(lodTileRatioSlider.value);

      if (lodMaxZoomLabel) lodMaxZoomLabel.textContent = `${maxZoomLevels}`;
      if (lodTileRatioLabel) lodTileRatioLabel.textContent = tileRatio.toFixed(1);

      if (map && typeof map.setSourceTileLodParams === 'function') {
        // Apply to all raster sources
        map.setSourceTileLodParams(maxZoomLevels, tileRatio);
        console.log(`[Performance] LOD: maxZoomLevels=${maxZoomLevels}, tileRatio=${tileRatio}`);
      }
    };

    fovSlider.addEventListener('input', updateFov);
    fovSlider.addEventListener('change', updateFov);

    if (lodMaxZoomSlider) {
      lodMaxZoomSlider.addEventListener('input', updateLod);
      lodMaxZoomSlider.addEventListener('change', updateLod);
    }
    if (lodTileRatioSlider) {
      lodTileRatioSlider.addEventListener('input', updateLod);
      lodTileRatioSlider.addEventListener('change', updateLod);
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        fovUI.style.display = 'none';
      });
    }

    // Apply initial LOD settings when map loads
    if (map) {
      map.once('load', () => {
        updateLod();
      });
    }
  };

  initFovControls();

  const imageryPanel = document.getElementById('imageryPanel');
  const imageryPanelToggle = document.getElementById('imageryPanelToggle');
  const imageryPanelDrawer = document.getElementById('imageryPanelDrawer');
  const imageryToggle = document.getElementById('imageryToggle');
  const imageryControls = new Map();

  // Build imageryOrder with group members kept contiguous
  // When we encounter a group member, insert all members of that group together
  let imageryOrder = [];
  const processedIds = new Set();

  const SHADOW_TOOLBOX_IDS = ['shadow', 'detail-shading'];
  const TERRAIN_TOOLBOX_IDS = ['aspect', 'slope', 'avalanche'];
  const SNOW_TOOLBOX_IDS = ['snow', 'snow-depth'];

  IMAGERY_OPTIONS.forEach((option) => {
    if (processedIds.has(option.id)) return; // Already added via group expansion
    if (TERRAIN_TOOLBOX_IDS.includes(option.id)) return; // Skip toolbox members in main panel order
    if (SNOW_TOOLBOX_IDS.includes(option.id)) return;
    if (SHADOW_TOOLBOX_IDS.includes(option.id)) return;

    // Filter out debug layers if not in debug mode
    const group = LAYER_GROUP_BY_MEMBER_ID.get(option.id);
    if (group && group.id === 'debug' && !window.XploreDebug) {
      return;
    }

    if (group) {
      // This is a group member - add all group members together
      group.members.forEach(memberId => {
        if (!processedIds.has(memberId) && !TERRAIN_TOOLBOX_IDS.includes(memberId) && !SNOW_TOOLBOX_IDS.includes(memberId) && !SHADOW_TOOLBOX_IDS.includes(memberId)) {
          imageryOrder.push(memberId);
          processedIds.add(memberId);
        }
      });
    } else {
      // Standalone layer
      imageryOrder.push(option.id);
      processedIds.add(option.id);
    }
  });
  let dragSourceImageryId = null;

  function clampOpacity(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return 0;
    }
    return Math.min(Math.max(value, 0), 1);
  }

  function applyContourLayersState(opacity, visible) {
    const effectiveOpacity = visible ? opacity : 0;
    if (map.getLayer('contours')) {
      map.setPaintProperty('contours', 'line-opacity', scaleExpression(CONTOUR_LINE_BASE_OPACITY, effectiveOpacity));
      map.setLayoutProperty('contours', 'visibility', visible ? 'visible' : 'none');
    }
    if (map.getLayer('contour-text')) {
      map.setPaintProperty('contour-text', 'text-opacity', scaleExpression(CONTOUR_TEXT_BASE_OPACITY, effectiveOpacity));
      map.setLayoutProperty('contour-text', 'visibility', visible ? 'visible' : 'none');
    }
  }

  const imageryState = new Map();
  const groupContainers = new Map(); // Hoisted to module scope for updateImageryControlStates access
  IMAGERY_OPTIONS.forEach((option, index) => {
    const paintOpacity = option?.paint && typeof option.paint['raster-opacity'] === 'number'
      ? clampOpacity(option.paint['raster-opacity'])
      : 1;
    const defaultOpacity = typeof option.defaultOpacity === 'number'
      ? clampOpacity(option.defaultOpacity)
      : paintOpacity;
    imageryState.set(option.id, {
      enabled: option.defaultVisible ?? index === 0,
      opacity: defaultOpacity
    });
  });

  function updateImageryDomOrder() {
    if (!imageryToggle) return;

    // Track which group containers we've already appended to avoid duplicates
    const appendedGroupContainers = new Set();

    imageryOrder.forEach((id) => {
      const control = imageryControls.get(id);
      if (!control?.container) return;

      // For group members, only append the group container once (on first member)
      if (control.isGroupMember) {
        if (appendedGroupContainers.has(control.container)) {
          return; // Already appended this group
        }
        appendedGroupContainers.add(control.container);
      }

      imageryToggle.appendChild(control.container);
    });
  }

  function applyImageryLayerOrder() {
    if (!map || typeof map.moveLayer !== 'function') return;
    const style = typeof map.getStyle === 'function' ? map.getStyle() : null;
    const layers = style?.layers;
    if (!Array.isArray(layers)) {
      return;
    }
    let topLabelId = null;
    for (let i = layers.length - 1; i >= 0; i -= 1) {
      const layer = layers[i];
      if (!layer) continue;
      if (layer.type === 'symbol') {
        topLabelId = layer.id;
        break;
      }
    }

    const orderedEntries = [];

    imageryOrder.forEach((id) => {
      let layerSequence = [];

      if (id === 'osm-features') {
        // Exclude symbols (labels) from reordering so they stay floating on top (Sandwich support)
        layerSequence = baseStyleOverlayLayerIds.filter(l => {
          const layer = map.getLayer(l);
          return layer && layer.type !== 'symbol';
        });
      }
      else if (id === 'osm-background') {
        layerSequence = baseStyleUnderlayLayerIds.filter(l => map.getLayer(l));
      }
      else {
        const option = IMAGERY_OPTIONS_BY_ID.get(id);
        if (option) {
          // Get the current state for this layer
          const state = imageryState.get(id);

          // Distinct Layers (Raster/Vector): Always move to maintain correct Z-index
          const shouldMove = true;

          if (shouldMove) {
            if (typeof option.layerId === 'string' && map.getLayer(option.layerId)) {
              layerSequence.push(option.layerId);
            }
            if (Array.isArray(option.linkedLayerIds)) {
              option.linkedLayerIds.forEach((linkedId) => {
                if (typeof linkedId === 'string' && map.getLayer(linkedId)) {
                  layerSequence.push(linkedId);
                }
              });
            }
          }
        }
      }

      if (layerSequence.length) {
        orderedEntries.push({ layerSequence });
      }
    });

    // Fix: Stack layers using a fixed anchor (topLabelId).
    // Iterate from Bottom to Top of the UI list.
    // Insert each layer just below the Top Labels. 
    // This pushes previously inserted (Bottom) layers down.
    // Result: The Last processed item (Top of UI) stays just below Labels (Top of Stack).

    // Reverse iterate orderedEntries (Bottom items first)
    for (let i = orderedEntries.length - 1; i >= 0; i -= 1) {
      const entry = orderedEntries[i];
      const seq = entry.layerSequence;

      // Iterate sequence Bottom-to-Top (Standard Style Order)
      // Process: Bot -> Top.
      // Move Bot under Labels.
      // Move ...
      // Move Top under Labels.
      // Final Stack: Labels -> Top -> ... -> Bot.
      // This preserves internal sequence order.
      for (let j = 0; j < seq.length; j += 1) {
        const layerId = seq[j];
        if (layerId && layerId !== topLabelId) {
          map.moveLayer(layerId, topLabelId);
        }
      }
    }

    const routeLayers = ROUTE_LAYER_ORDER_TOP_TO_BOTTOM.filter((layerId) => map.getLayer(layerId));
    let previousTopLayerId = null;
    for (let i = 0; i < routeLayers.length; i += 1) {
      const layerId = routeLayers[i];
      if (!layerId) continue;
      if (!previousTopLayerId) {
        map.moveLayer(layerId);
      } else if (layerId !== previousTopLayerId) {
        map.moveLayer(layerId, previousTopLayerId);
      }
      previousTopLayerId = layerId;
    }

    bringDebugNetworkToFront();

    // IMPORTANT: Ensure all symbol layers (labels) stay on top of everything
    // This runs after all other layer moves to guarantee labels are above roads, paths, etc.
    const allSymbolLayers = (map.getStyle().layers || [])
      .filter(l => l.type === 'symbol')
      .map(l => l.id);
    allSymbolLayers.forEach(layerId => {
      if (map.getLayer(layerId)) {
        map.moveLayer(layerId);
      }
    });
  }

  function moveImageryOption(sourceId, targetId, placeBeforeTarget) {
    if (sourceId === targetId) return;

    // Helper: Get all members if ID belongs to a group, else just the ID
    const getIds = (id) => {
      const group = LAYER_GROUP_BY_MEMBER_ID.get(id);
      if (group) {
        // Return all members currently in the order (to preserve validity)
        return group.members.filter(m => imageryOrder.includes(m));
      }
      return [id];
    };

    const sourceIds = getIds(sourceId);

    // Safety: If dragging a group onto itself (target is one of its members), do nothing
    if (sourceIds.includes(targetId)) return;

    // 1. Remove Source IDs from the list
    const remainingOrder = imageryOrder.filter(id => !sourceIds.includes(id));

    // 2. Determine Insertion Index
    // If target is in a group, we treat the drop as relative to the GROUP block
    // (Top of Group or Bottom of Group)
    const targetGroup = LAYER_GROUP_BY_MEMBER_ID.get(targetId);
    let effectiveTargetIndex = -1;

    if (targetGroup) {
      // Find the group's members in the remaining list
      const groupMembers = targetGroup.members.filter(m => remainingOrder.includes(m));
      if (groupMembers.length > 0) {
        if (placeBeforeTarget) {
          // Insert Before the First Member
          effectiveTargetIndex = remainingOrder.indexOf(groupMembers[0]);
        } else {
          // Insert After the Last Member
          const lastMember = groupMembers[groupMembers.length - 1];
          effectiveTargetIndex = remainingOrder.indexOf(lastMember); // We will add +1 later
        }
      }
    } else {
      // Standard Target
      effectiveTargetIndex = remainingOrder.indexOf(targetId);
    }

    if (effectiveTargetIndex === -1) return;

    const insertionIndex = placeBeforeTarget ? effectiveTargetIndex : effectiveTargetIndex + 1;

    // 3. Insert Source IDs
    remainingOrder.splice(insertionIndex, 0, ...sourceIds);

    // 4. Update the global array in place
    imageryOrder.splice(0, imageryOrder.length, ...remainingOrder);

    updateImageryDomOrder();
    applyImageryLayerOrder();
  }

  function moveImageryOptionToBoundary(sourceId, toStart) {
    const index = imageryOrder.indexOf(sourceId);
    if (index === -1) {
      return;
    }
    imageryOrder.splice(index, 1);
    if (toStart) {
      imageryOrder.unshift(sourceId);
    } else {
      imageryOrder.push(sourceId);
    }
    updateImageryDomOrder();
    applyImageryLayerOrder();
  }

  function resetDragIndicators() {
    if (!imageryToggle) return;
    const dragNodes = imageryToggle.querySelectorAll('.imagery-option--dragging, .imagery-option--drag-over-before, .imagery-option--drag-over-after');
    dragNodes.forEach((node) => {
      node.classList.remove('imagery-option--dragging', 'imagery-option--drag-over-before', 'imagery-option--drag-over-after');
    });
  }

  function setImageryPanelOpen(isOpen) {
    if (!imageryPanelDrawer) return;
    const open = Boolean(isOpen);

    // If opening imagery panel, close toolboxes
    if (open) {
      if (typeof setTerrainToolboxOpen === 'function') setTerrainToolboxOpen(false);
      if (typeof setSnowToolboxOpen === 'function') setSnowToolboxOpen(false);
      if (typeof setShadowToolboxOpen === 'function') setShadowToolboxOpen(false);
    }

    imageryPanelDrawer.classList.toggle('imagery-panel__drawer--open', open);
    if (imageryPanelToggle) {
      imageryPanelToggle.classList.toggle('active', open);
      imageryPanelToggle.setAttribute('aria-expanded', String(open));
    }
    if (open) {
      imageryPanelDrawer.removeAttribute('hidden');
    } else {
      imageryPanelDrawer.setAttribute('hidden', 'true');
    }
    imageryPanelDrawer.setAttribute('aria-hidden', String(!open));
  }

  function updateImageryControlStates() {
    if (!imageryToggle && !terrainToolbox) return;
    // Track which groups have at least one active member
    const activeGroupIds = new Set();

    imageryControls.forEach((control, id) => {
      const state = imageryState.get(id);
      const isActive = Boolean(state?.enabled && state.opacity > 0);

      if (control.button) {
        control.button.classList.toggle('active', isActive);
        control.button.setAttribute('aria-pressed', String(isActive));
      }

      if (control.isGroupMember) {
        // Defer group container update
        if (isActive) {
          const group = LAYER_GROUP_BY_MEMBER_ID.get(id);
          if (group) activeGroupIds.add(group.id);
        }
      } else {
        // Interactive updates for non-grouped containers
        if (control.container) {
          control.container.classList.toggle('active', isActive);
        }
      }

      if (control.slider && state) {
        control.slider.value = String(state.opacity);
      }
      if (control.sliderWrapper) {
        control.sliderWrapper.classList.toggle('active', isActive);
      }
    });

    // Update Group Containers based on aggregated activity
    if (typeof groupContainers !== 'undefined') {
      groupContainers.forEach((data, groupId) => {
        if (data.container) {
          // Determine if group is active (any member active)
          const isGroupActive = activeGroupIds.has(groupId);
          data.container.classList.toggle('active', isGroupActive);

          // Also update preview? If styles depend on preview having .active
          if (data.preview) {
            data.preview.classList.toggle('active', isGroupActive);
          }
        }
      });
    }

    // Dynamic background for Terrain Toolbox Toggle
    const terrainToolboxToggle = document.getElementById('terrainToolboxToggle');
    if (terrainToolboxToggle) {
      const TERRAIN_IDS = ['aspect', 'slope', 'avalanche'];
      const activeTerrainId = TERRAIN_IDS.find(id => {
        const state = imageryState.get(id);
        return Boolean(state?.enabled && state.opacity > 0);
      });

      // Ensure we have a thumbnail element
      let thumb = terrainToolboxToggle.querySelector('.terrain-toolbox-toggle__thumb');
      if (!thumb) {
        thumb = document.createElement('div');
        thumb.className = 'terrain-toolbox-toggle__thumb';
        terrainToolboxToggle.prepend(thumb); // Put it behind the icon
      }

      if (activeTerrainId) {
        const option = IMAGERY_OPTIONS_BY_ID.get(activeTerrainId);
        if (option && option.previewImage) {
          thumb.style.backgroundImage = `url(${option.previewImage})`;
          terrainToolboxToggle.classList.add('has-active-layer');
        }
      } else {
        thumb.style.backgroundImage = '';
        terrainToolboxToggle.classList.remove('has-active-layer');
      }
    }
  }

  function applyImageryState() {
    let shouldShowTimeControl = false;

    IMAGERY_OPTIONS.forEach((option) => {
      const state = imageryState.get(option.id);
      const opacity = clampOpacity(state?.opacity ?? 0);
      const visible = Boolean(state?.enabled && opacity > 0);
      if (option.type === 'osm-overlay') {
        setLayerSequenceOpacity(map, baseStyleOverlayLayerIds, visible ? opacity : 0);
        return;
      }
      if (option.type === 'osm-background') {
        setLayerSequenceOpacity(map, baseStyleUnderlayLayerIds, visible ? opacity : 0);
        return;
      }
      if (option.type === 'contours') {
        applyContourLayersState(opacity, visible);
        return;
      }
      if (option.type === 'hillshade') {
        // Hillshade is always on, handled by applyHillshadeAppearance
        return;
      }
      if (option.type === 'wikimedia') {
        setWikimediaPhotosEnabled(visible);
        return;
      }
      if (option.type === 'native-layer') {
        if (map.getLayer(option.layerId)) {
          try {
            map.setLayoutProperty(option.layerId, 'visibility', visible ? 'visible' : 'none');
            // Set exaggeration for terrain analysis layers (max 1.0)
            map.setPaintProperty(option.layerId, 'hillshade-exaggeration', visible ? Math.min(opacity, 1.0) : 0);
          } catch (_) { }
        }

        // Show Snow Controls for native snow layer
        if (option.layerId === 'snow-native') {
          const snowControls = document.getElementById('snowControls');
          if (snowControls) {
            snowControls.style.display = visible ? 'block' : 'none';
          }
        }

        // Show Time Control (shadow settings) for native shadow layer
        if (option.layerId === 'shadow-native') {
          if (visible) shouldShowTimeControl = true;
        }

        return;
      }

      if (!option.layerId || !map.getLayer(option.layerId)) return;
      map.setPaintProperty(option.layerId, 'raster-opacity', opacity);
      map.setLayoutProperty(option.layerId, 'visibility', visible ? 'visible' : 'none');
    });

    // Update global Time Control visibility once after checking all layers
    const timeControl = document.getElementById('shadowTimeControl');
    if (timeControl) {
      // Toggle logic
      if (shouldShowTimeControl) {
        timeControl.style.display = 'block';
        // Force update sun position for current map center
        const dateInput = document.getElementById('shadowDate');
        if (dateInput) dateInput.dispatchEvent(new Event('change'));
      } else {
        timeControl.style.display = 'none';
      }
    }

    // Hillshade appearance is handled by applyHillshadeAppearance() called after applyImageryState()

    // Update analytical legends
    if (typeof updateAnalyticalLegends === 'function') {
      updateAnalyticalLegends();
    }
  }

  function calculateTerrainAnalysis(lngLat) {
    if (!map || typeof map.queryTerrainElevation !== 'function') return null;

    const ele = map.queryTerrainElevation([lngLat.lng, lngLat.lat]);
    if (ele === null || ele === undefined) return null;

    // Use a small offset for neighbor sampling (approx 10-20m)
    const d = 0.0001;
    const zN = map.queryTerrainElevation([lngLat.lng, lngLat.lat + d]);
    const zS = map.queryTerrainElevation([lngLat.lng, lngLat.lat - d]);
    const zE = map.queryTerrainElevation([lngLat.lng + d, lngLat.lat]);
    const zW = map.queryTerrainElevation([lngLat.lng - d, lngLat.lat]);

    // If all are exactly 0, it's likely terrain is not loaded at this point
    if (ele === 0 && zN === 0 && zS === 0 && zE === 0 && zW === 0) return null;

    const latRad = lngLat.lat * Math.PI / 180;
    const dy = 2 * d * 111320;
    const dx = 2 * d * 111320 * Math.cos(latRad);

    const dzdx = (zE - zW) / dx;
    const dzdy = (zN - zS) / dy;

    // Slope
    const slopeRad = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
    const slopeDeg = slopeRad * 180 / Math.PI;

    // Negate derivatives to match shader (deriv = -deriv)
    const dx_shader = -dzdx;
    const dy_shader = -dzdy;

    // Shader uses mod(degrees(atan(deriv.x, deriv.y)) + 180, 360)
    // In JS atan2(y, x) is atan(y, x). So atan(deriv.x, deriv.y) is atan2(dx_shader, dy_shader).
    let aspectDeg = (Math.atan2(dx_shader, dy_shader) * 180 / Math.PI + 180) % 360;
    if (aspectDeg < 0) aspectDeg += 360;

    const aspects = ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West', 'North'];
    const aspectName = aspects[Math.round(aspectDeg / 45)];

    return { ele, slope: slopeDeg, aspect: aspectDeg, aspectName };
  }

  // Initialize slope config for shader wiring
  if (!window.slopeConfig) {
    window.slopeConfig = { min: 0, max: 90 };
  }

  function updateAnalyticalLegends() {
    const container = document.getElementById('analyticalLegendContainer');
    if (!container) return;
    container.innerHTML = '';

    const activeAnalyzers = [];
    if (imageryState.get('aspect')?.enabled) activeAnalyzers.push('aspect');
    if (imageryState.get('slope')?.enabled) activeAnalyzers.push('slope');
    if (imageryState.get('avalanche')?.enabled) activeAnalyzers.push('avalanche');

    if (activeAnalyzers.length === 0) {
      container.style.opacity = '0';
      container.style.pointerEvents = 'none';
      return;
    }

    container.style.opacity = '1';
    container.style.pointerEvents = 'auto';

    activeAnalyzers.forEach(type => {
      const legend = document.createElement('div');
      legend.className = 'analytical-legend';
      // Titles removed for minimalist look

      if (type === 'aspect') {
        const content = document.createElement('div');
        content.className = 'analytical-legend__content';
        // Colors exactly matching hillshade.fragment.glsl (Method 6: ASPECT)
        // N: #78FFFF, NE: #7AC2FF, E: #FFFFFF, SE: #FFB285, S: #FF4D00, SW: #7A2400, W: #292929, NW: #003678
        content.innerHTML = `
          <svg viewBox="0 0 100 100" width="105" height="105" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3))">
            <circle cx="50" cy="50" r="38" fill="rgba(12, 24, 36, 0.4)" stroke="rgba(255,255,255,0.2)" stroke-width="1.5" />
            <!-- Sectors (rotated -90 to start North at top in SVG) -->
            <g transform="rotate(-90, 50, 50)">
              <path d="M50,50 L85.1,35.5 A38,38 0 0,1 85.1,64.5 Z" fill="#78FFFF" opacity="0.8" /> <!-- N -->
              <path d="M50,50 L85.1,64.5 A38,38 0 0,1 64.5,85.1 Z" fill="#7AC2FF" opacity="0.8" /> <!-- NE -->
              <path d="M50,50 L64.5,85.1 A38,38 0 0,1 35.5,85.1 Z" fill="#FFFFFF" opacity="0.8" /> <!-- E -->
              <path d="M50,50 L35.5,85.1 A38,38 0 0,1 14.9,64.5 Z" fill="#FFB285" opacity="0.8" /> <!-- SE -->
              <path d="M50,50 L14.9,64.5 A38,38 0 0,1 14.9,35.5 Z" fill="#FF4C00" opacity="0.8" /> <!-- S -->
              <path d="M50,50 L14.9,35.5 A38,38 0 0,1 35.5,14.9 Z" fill="#7A2400" opacity="0.8" /> <!-- SW -->
              <path d="M50,50 L35.5,14.9 A38,38 0 0,1 64.5,14.9 Z" fill="#292929" opacity="0.8" /> <!-- W -->
              <path d="M50,50 L64.5,14.9 A38,38 0 0,1 85.1,35.5 Z" fill="#003678" opacity="0.8" /> <!-- NW -->
            </g>
            <circle cx="50" cy="50" r="3" fill="#fff" />
            <text x="50" y="8" text-anchor="middle" fill="#fff" font-size="9" font-weight="900" style="text-shadow: 0 1px 2px #000">N</text>
            <text x="50" y="98" text-anchor="middle" fill="#fff" font-size="9" font-weight="900" style="text-shadow: 0 1px 2px #000">S</text>
            <text x="94" y="53" text-anchor="middle" fill="#fff" font-size="9" font-weight="900" style="text-shadow: 0 1px 2px #000">E</text>
            <text x="6" y="53" text-anchor="middle" fill="#fff" font-size="9" font-weight="900" style="text-shadow: 0 1px 2px #000">W</text>
          </svg>
        `;
        legend.appendChild(content);
      } else if (type === 'slope') {
        const content = document.createElement('div');
        content.className = 'slope-legend__content';

        const barWrapper = document.createElement('div');
        barWrapper.className = 'slope-bar-wrapper';

        barWrapper.innerHTML = `
          <div class="slope-gradient-bar"></div>
          <div class="slope-labels">
            <span>90°</span>
            <span>45°</span>
            <span>30°</span>
            <span>0°</span>
          </div>
          <div class="slope-range-inputs">
            <input type="range" id="slopeMinSlider" min="0" max="90" step="1" value="${window.slopeConfig.min}">
            <input type="range" id="slopeMaxSlider" min="0" max="90" step="1" value="${window.slopeConfig.max}">
          </div>
        `;

        content.appendChild(barWrapper);
        legend.appendChild(content);

        // Wiring handles to shader
        const minS = barWrapper.querySelector('#slopeMinSlider');
        const maxS = barWrapper.querySelector('#slopeMaxSlider');

        const updateSlope = (e) => {
          // Bring the active slider to front
          if (e) {
            minS.style.zIndex = (e.target === minS) ? '3' : '2';
            maxS.style.zIndex = (e.target === maxS) ? '3' : '2';
          }

          let min = parseInt(minS.value);
          let max = parseInt(maxS.value);
          if (min > max) [min, max] = [max, min];

          window.slopeConfig.min = min;
          window.slopeConfig.max = max;

          if (map) {
            map.triggerRepaint();
            // Force nudge as in snow logic to re-evaluate uniforms
            const hillLayers = ['slope-native', 'avalanche-native'];
            hillLayers.forEach(l => {
              if (map.getLayer(l)) {
                const ex = map.getPaintProperty(l, 'hillshade-exaggeration') || 1.0;
                map.setPaintProperty(l, 'hillshade-exaggeration', ex === 1.0 ? 1.00001 : 1.0);
              }
            });
          }
        };

        minS.addEventListener('input', updateSlope);
        maxS.addEventListener('input', updateSlope);
        // Stop propagation so map doesn't drag
        minS.addEventListener('mousedown', e => e.stopPropagation());
        maxS.addEventListener('mousedown', e => e.stopPropagation());
        minS.addEventListener('touchstart', e => e.stopPropagation());
        maxS.addEventListener('touchstart', e => e.stopPropagation());

      } else if (type === 'avalanche') {
        const content = document.createElement('div');
        content.className = 'avalanche-legend-content';
        // Colors from avalanche_hillshade in hillshade.fragment.glsl
        // 30-35: #E2BE1B (Yellow), 35-40: #D8721B (Orange), 40-45: #E21B1B (Red), 45+: #B882AD (Purple)
        content.innerHTML = `
          <div class="avalanche-bar">
            <div class="avalanche-bar__segment" style="background: #E2BE1B"></div>
            <div class="avalanche-bar__segment" style="background: #D8721B"></div>
            <div class="avalanche-bar__segment" style="background: #E21B1B"></div>
            <div class="avalanche-bar__segment" style="background: #B882AD"></div>
          </div>
          <div class="avalanche-labels">
            <span>30°</span>
            <span>35°</span>
            <span>40°</span>
            <span>45°+</span>
          </div>
        `;
        legend.appendChild(content);
      }

      container.appendChild(legend);
    });
  }

  if (imageryPanelToggle && imageryPanelDrawer) {
    setImageryPanelOpen(false);
    imageryPanelToggle.addEventListener('click', () => {
      const nextState = !imageryPanelDrawer.classList.contains('imagery-panel__drawer--open');
      setImageryPanelOpen(nextState);
    });
    document.addEventListener('click', (event) => {
      if (!imageryPanelDrawer.classList.contains('imagery-panel__drawer--open')) return;
      if (!imageryPanel) return;
      if (imageryPanel.contains(event.target)) return;
      setImageryPanelOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        setImageryPanelOpen(false);
      }
    });
  }

  // 7. Directions Sidebar Bar Logic
  const directionsActionsBar = document.getElementById('directionsActionsBar');

  const updateActionsBarVisibility = () => {
    if (!directionsActionsBar || !directionsControl) return;
    const isDirectionsOpen = directionsControl.classList.contains('visible');
    directionsActionsBar.classList.toggle('visible', isDirectionsOpen);
    directionsActionsBar.setAttribute('aria-hidden', String(!isDirectionsOpen));
  };

  if (directionsDock && directionsActionsBar) {
    // Observe visibility changes on directionsControl to sync toolbox
    // Using MutationObserver on classList is more reliable for internal state changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          updateActionsBarVisibility();
        }
      });
    });
    if (directionsControl) {
      observer.observe(directionsControl, { attributes: true, attributeFilter: ['class'] });
    }

    // Handle toggle click specifically as well for immediate feel if needed
    if (directionsToggle) {
      directionsToggle.addEventListener('click', () => {
        setTimeout(updateActionsBarVisibility, 10);
      });
    }
    // Initial sync
    updateActionsBarVisibility();
  }

  // 8. Terrain Toolbox Logic
  const terrainToolboxToggle = document.getElementById('terrainToolboxToggle');
  const terrainToolbox = document.getElementById('terrainToolbox');

  const setTerrainToolboxOpen = (open) => {
    if (!terrainToolbox || !terrainToolboxToggle) return;
    terrainToolbox.classList.toggle('visible', open);
    terrainToolbox.setAttribute('aria-hidden', String(!open));
    terrainToolboxToggle.setAttribute('aria-expanded', String(open));
    terrainToolboxToggle.classList.toggle('active', open);
    if (open) {
      if (typeof setSnowToolboxOpen === 'function') setSnowToolboxOpen(false);
      if (typeof setShadowToolboxOpen === 'function') setShadowToolboxOpen(false);
    }
  };

  if (terrainToolboxToggle && terrainToolbox) {
    terrainToolboxToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = terrainToolbox.classList.contains('visible');
      // Close imagery panel if open
      if (!isOpen) setImageryPanelOpen(false);
      setTerrainToolboxOpen(!isOpen);
    });

    // Close on outside click
    document.addEventListener('click', (event) => {
      if (!terrainToolbox.classList.contains('visible')) return;
      if (terrainToolboxToggle.contains(event.target) || terrainToolbox.contains(event.target)) return;
      setTerrainToolboxOpen(false);
    });
  }

  // 9. Snow Toolbox Logic
  const snowToolboxToggle = document.getElementById('snowToolboxToggle');
  const snowToolbox = document.getElementById('snowToolbox');

  const setSnowToolboxOpen = (open) => {
    if (!snowToolbox || !snowToolboxToggle) return;
    snowToolbox.classList.toggle('visible', open);
    snowToolbox.setAttribute('aria-hidden', String(!open));
    snowToolboxToggle.setAttribute('aria-expanded', String(open));
    snowToolboxToggle.classList.toggle('active', open);
    if (open) {
      if (typeof setTerrainToolboxOpen === 'function') setTerrainToolboxOpen(false);
      if (typeof setShadowToolboxOpen === 'function') setShadowToolboxOpen(false);
    }
  };

  if (snowToolboxToggle && snowToolbox) {
    snowToolboxToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = snowToolbox.classList.contains('visible');
      // Close imagery panel if open
      if (!isOpen) setImageryPanelOpen(false);
      setSnowToolboxOpen(!isOpen);
    });

    // Close on outside click
    document.addEventListener('click', (event) => {
      if (!snowToolbox.classList.contains('visible')) return;
      if (snowToolboxToggle.contains(event.target) || snowToolbox.contains(event.target)) return;
      setSnowToolboxOpen(false);
    });
  }

  // 10. Shadow Toolbox Logic
  const shadowToolboxToggle = document.getElementById('shadowToolboxToggle');
  const shadowToolbox = document.getElementById('shadowToolbox');

  const setShadowToolboxOpen = (open) => {
    if (!shadowToolbox || !shadowToolboxToggle) return;
    shadowToolbox.classList.toggle('visible', open);
    shadowToolbox.setAttribute('aria-hidden', String(!open));
    shadowToolboxToggle.setAttribute('aria-expanded', String(open));
    shadowToolboxToggle.classList.toggle('active', open);
    if (open) {
      if (typeof setTerrainToolboxOpen === 'function') setTerrainToolboxOpen(false);
      if (typeof setSnowToolboxOpen === 'function') setSnowToolboxOpen(false);
    }
  };

  if (shadowToolboxToggle && shadowToolbox) {
    shadowToolboxToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = shadowToolbox.classList.contains('visible');
      // Close imagery panel if open
      if (!isOpen) setImageryPanelOpen(false);
      setShadowToolboxOpen(!isOpen);
    });

    // Close on outside click
    document.addEventListener('click', (event) => {
      if (!shadowToolbox.classList.contains('visible')) return;
      if (shadowToolboxToggle.contains(event.target) || shadowToolbox.contains(event.target)) return;
      setShadowToolboxOpen(false);
    });
  }

  // Sync with DirectionsManager mode
  if (directionsManager) {
    // Initial sync of active state handled by DirectionsManager.setTransportMode
  }

  if (imageryToggle) {
    const SHADOW_TOOLBOX_IDS = ['shadow', 'detail-shading'];
    const TERRAIN_TOOLBOX_IDS = ['aspect', 'slope', 'avalanche'];
    const SNOW_TOOLBOX_IDS = ['snow', 'snow-depth'];
    if (terrainToolbox) terrainToolbox.textContent = '';
    if (snowToolbox) snowToolbox.textContent = '';
    if (shadowToolbox) shadowToolbox.textContent = '';

    if (!IMAGERY_OPTIONS.length) {
      imageryToggle.setAttribute('hidden', 'true');
      imageryToggle.setAttribute('aria-hidden', 'true');
      imageryPanel?.setAttribute('hidden', 'true');
    } else {
      imageryToggle.removeAttribute('hidden');
      imageryToggle.setAttribute('aria-hidden', 'false');
      imageryPanel?.removeAttribute('hidden');

      // Track which groups have been rendered to avoid duplicates
      const renderedGroups = new Set();

      IMAGERY_OPTIONS.forEach((option) => {
        if (option.hiddenControl) {
          return;
        }

        const isTerrainToolboxMember = TERRAIN_TOOLBOX_IDS.includes(option.id);
        const isSnowToolboxMember = SNOW_TOOLBOX_IDS.includes(option.id);
        const isShadowToolboxMember = SHADOW_TOOLBOX_IDS.includes(option.id);
        const state = imageryState.get(option.id) ?? { enabled: false, opacity: 0 };
        const group = LAYER_GROUP_BY_MEMBER_ID.get(option.id);

        if (isTerrainToolboxMember || isSnowToolboxMember || isShadowToolboxMember) {
          // Special rendering for Toolboxes: Streamlined circular buttons
          const toggleButton = document.createElement('button');
          toggleButton.type = 'button';
          let btnClass = 'btn terrain-toolbox__toggle';
          if (isSnowToolboxMember) btnClass = 'btn snow-toolbox__toggle';
          if (isShadowToolboxMember) btnClass = 'btn shadow-toolbox__toggle';
          toggleButton.className = btnClass;
          toggleButton.dataset.imageryId = option.id;
          toggleButton.setAttribute('aria-pressed', 'false');
          toggleButton.setAttribute('title', option.label);
          toggleButton.setAttribute('aria-label', option.label);

          const previewUrl = typeof option.previewImage === 'string' && option.previewImage.length
            ? option.previewImage
            : createTilePreviewUrl(option.tileTemplate);

          if (previewUrl) {
            const img = document.createElement('img');
            img.src = previewUrl;
            img.alt = '';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.draggable = false;
            toggleButton.appendChild(img);
          }

          const srLabel = document.createElement('span');
          srLabel.className = 'sr-only';
          srLabel.textContent = option.label;
          toggleButton.appendChild(srLabel);

          toggleButton.addEventListener('click', () => {
            toggleButton.blur();
            const current = imageryState.get(option.id);
            if (!current) return;
            const currentlyActive = Boolean(current.enabled && current.opacity > 0);
            const nextEnabled = !currentlyActive;

            // Handle exclusive group behavior
            if (group && group.exclusive && nextEnabled) {
              group.members.forEach(memberId => {
                if (memberId !== option.id) {
                  const memberState = imageryState.get(memberId);
                  if (memberState) memberState.enabled = false;
                }
              });
            }

            current.enabled = nextEnabled;
            if (nextEnabled && current.opacity <= 0) {
              current.opacity = typeof option.defaultOpacity === 'number' ? option.defaultOpacity : 1.0;
            }

            applyImageryState();
            updateImageryControlStates();
            applyImageryLayerOrder();

            // Close toolbox after selection if it's a toolbox member
            if (isTerrainToolboxMember) setTerrainToolboxOpen(false);
            if (isSnowToolboxMember) setSnowToolboxOpen(false);
            if (isShadowToolboxMember) setShadowToolboxOpen(false);
          });

          let targetToolbox = terrainToolbox;
          if (isSnowToolboxMember) targetToolbox = snowToolbox;
          if (isShadowToolboxMember) targetToolbox = shadowToolbox;
          if (targetToolbox) targetToolbox.appendChild(toggleButton);

          imageryControls.set(option.id, {
            container: toggleButton,
            button: toggleButton,
            slider: null,
            sliderWrapper: null,
            isGroupMember: false
          });
          return; // Skip standard rendering
        }

        // Filter out debug layers if not in debug mode
        if (group && group.id === 'debug' && !window.XploreDebug) {
          return;
        }

        // For grouped layers, create a shared group container
        let container;
        let isGroupMember = false;

        if (group) {
          isGroupMember = true;
          // Check if group container already exists
          if (!groupContainers.has(group.id)) {
            // Create new group container
            const groupContainer = document.createElement('div');
            groupContainer.className = 'imagery-group';
            groupContainer.dataset.groupId = group.id;

            // Row 1: Preview (thumbnails) + Label
            const row = document.createElement('div');
            row.className = 'imagery-group__row';

            // Group preview area holds all the thumbnails side by side
            const groupPreview = document.createElement('div');
            groupPreview.className = 'imagery-group__preview';

            // Group label
            const groupLabel = document.createElement('span');
            groupLabel.className = 'imagery-group__label';
            groupLabel.textContent = group.label;

            row.appendChild(groupPreview);
            row.appendChild(groupLabel);
            groupContainer.appendChild(row);

            // Row 2: Shared opacity slider for the group
            const sliderWrapper = document.createElement('div');
            sliderWrapper.className = 'imagery-group__opacity-wrapper';

            const isNoSliderGroup = ['terrain-analysis', 'sun-analysis', 'snow'].includes(group.id);
            let groupSlider = null;

            if (!isNoSliderGroup) {
              groupSlider = document.createElement('input');
              groupSlider.type = 'range';
              groupSlider.min = '0';
              groupSlider.max = '1';
              groupSlider.step = '0.05';
              groupSlider.className = 'imagery-group__opacity';
              groupSlider.setAttribute('aria-label', `${group.label} opacity`);

              // Find the first enabled member's opacity for initial value
              const firstEnabledMember = group.members.find(id => imageryState.get(id)?.enabled);
              groupSlider.value = String(firstEnabledMember ? imageryState.get(firstEnabledMember).opacity : 0.8);

              groupSlider.addEventListener('input', () => {
                const value = clampOpacity(Number.parseFloat(groupSlider.value));
                // Apply to ALL members of the group (so newly enabled ones have correct opacity)
                group.members.forEach(memberId => {
                  const memberState = imageryState.get(memberId);
                  if (memberState) {
                    memberState.opacity = value;
                  }
                });
                applyImageryState();
                updateImageryControlStates();
              });

              // Fix: Stop propagation to prevent dragging the row when using slider
              const stopDrag = (e) => e.stopPropagation();
              groupSlider.addEventListener('mousedown', stopDrag);
              groupSlider.addEventListener('touchstart', stopDrag, { passive: true });

              sliderWrapper.appendChild(groupSlider);
              groupContainer.appendChild(sliderWrapper);
            }

            // Add drag handlers for group containers
            const firstMemberId = group.members[0];
            groupContainer.setAttribute('draggable', 'true');
            groupContainer.dataset.imageryId = firstMemberId; // Use first member for drag operations

            groupContainer.addEventListener('dragstart', (event) => {
              dragSourceImageryId = firstMemberId;
              resetDragIndicators();
              groupContainer.classList.add('imagery-group--dragging');
              if (event?.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', firstMemberId);
              }
            });

            groupContainer.addEventListener('dragend', () => {
              dragSourceImageryId = null;
              resetDragIndicators();
              groupContainer.classList.remove('imagery-group--dragging');
            });

            groupContainer.addEventListener('dragover', (event) => {
              if (!dragSourceImageryId) return;
              // Don't allow drop on itself
              if (group.members.includes(dragSourceImageryId)) return;
              event.preventDefault();
              if (event?.dataTransfer) {
                event.dataTransfer.dropEffect = 'move';
              }
              const rect = groupContainer.getBoundingClientRect();
              const before = event.clientY < rect.top + (rect.height / 2);
              groupContainer.classList.toggle('imagery-group--drag-over-before', before);
              groupContainer.classList.toggle('imagery-group--drag-over-after', !before);
            });

            groupContainer.addEventListener('dragleave', () => {
              groupContainer.classList.remove('imagery-group--drag-over-before', 'imagery-group--drag-over-after');
            });

            groupContainer.addEventListener('drop', (event) => {
              if (!dragSourceImageryId) return;
              if (group.members.includes(dragSourceImageryId)) return;
              event.preventDefault();
              const rect = groupContainer.getBoundingClientRect();
              const before = event.clientY < rect.top + (rect.height / 2);
              moveImageryOption(dragSourceImageryId, firstMemberId, before);
              dragSourceImageryId = null;
              resetDragIndicators();
              groupContainer.classList.remove('imagery-group--drag-over-before', 'imagery-group--drag-over-after');
            });

            groupContainers.set(group.id, { container: groupContainer, preview: groupPreview, slider: groupSlider });
            imageryToggle.appendChild(groupContainer);
          }

          // Use the group's preview area as the container for this layer's toggle
          container = groupContainers.get(group.id).preview;
        } else {
          // Non-grouped layer - create individual container
          container = document.createElement('div');
          container.className = 'imagery-option';
          container.dataset.imageryId = option.id;

          // Add drag handlers for non-grouped layers
          container.setAttribute('draggable', 'true');

          container.addEventListener('dragstart', (event) => {
            dragSourceImageryId = option.id;
            resetDragIndicators();
            container.classList.add('imagery-option--dragging');
            if (event?.dataTransfer) {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', option.id);
            }
          });

          container.addEventListener('dragend', () => {
            dragSourceImageryId = null;
            resetDragIndicators();
          });

          container.addEventListener('dragover', (event) => {
            if (!dragSourceImageryId || dragSourceImageryId === option.id) return;
            event.preventDefault();
            if (event?.dataTransfer) {
              event.dataTransfer.dropEffect = 'move';
            }
            const rect = container.getBoundingClientRect();
            const before = event.clientY < rect.top + (rect.height / 2);
            container.classList.toggle('imagery-option--drag-over-before', before);
            container.classList.toggle('imagery-option--drag-over-after', !before);
          });

          container.addEventListener('dragleave', () => {
            container.classList.remove('imagery-option--drag-over-before', 'imagery-option--drag-over-after');
          });

          container.addEventListener('drop', (event) => {
            if (!dragSourceImageryId || dragSourceImageryId === option.id) return;
            event.preventDefault();
            const rect = container.getBoundingClientRect();
            const before = event.clientY < rect.top + (rect.height / 2);
            moveImageryOption(dragSourceImageryId, option.id, before);
            dragSourceImageryId = null;
            resetDragIndicators();
          });
        }

        // Create the toggle button (same for grouped and non-grouped)
        const toggleButton = document.createElement('button');
        toggleButton.type = 'button';
        toggleButton.className = isGroupMember ? 'imagery-group__toggle' : 'imagery-option__toggle';
        toggleButton.dataset.imageryId = option.id;
        toggleButton.setAttribute('aria-pressed', 'false');
        toggleButton.setAttribute('title', option.label);
        toggleButton.setAttribute('aria-label', option.label);

        const previewUrl = typeof option.previewImage === 'string' && option.previewImage.length
          ? option.previewImage
          : createTilePreviewUrl(option.tileTemplate);
        if (previewUrl) {
          const img = document.createElement('img');
          img.src = previewUrl;
          img.alt = '';
          img.loading = 'lazy';
          img.decoding = 'async';
          img.draggable = false;
          img.className = isGroupMember ? 'imagery-group__thumb' : 'imagery-option__thumb';
          toggleButton.appendChild(img);
        }

        const srLabel = document.createElement('span');
        srLabel.className = 'sr-only';
        srLabel.textContent = option.label;
        toggleButton.appendChild(srLabel);

        toggleButton.addEventListener('click', () => {
          toggleButton.blur(); // Remove focus ring to prevent visual confusion with active state
          const current = imageryState.get(option.id);
          if (!current) return;
          const currentlyActive = Boolean(current.enabled && current.opacity > 0);
          const nextEnabled = !currentlyActive;

          // Handle exclusive group behavior
          const clickGroup = LAYER_GROUP_BY_MEMBER_ID.get(option.id);
          if (clickGroup && clickGroup.exclusive && nextEnabled) {
            // Disable all other members of this exclusive group
            clickGroup.members.forEach(memberId => {
              if (memberId !== option.id) {
                const memberState = imageryState.get(memberId);
                if (memberState) {
                  memberState.enabled = false;
                }
              }
            });
          }

          current.enabled = nextEnabled;

          if (nextEnabled) {
            // Always try to sync with group slider if it exists
            let usedGroupSlider = false;

            if (clickGroup && groupContainers.has(clickGroup.id)) {
              const groupData = groupContainers.get(clickGroup.id);
              if (groupData && groupData.slider) {
                current.opacity = clampOpacity(Number.parseFloat(groupData.slider.value));
                usedGroupSlider = true;
              }
            }

            // If no group slider used, and opacity is unset/zero, use default
            if (!usedGroupSlider && current.opacity <= 0) {
              const fallbackOpacity = typeof option.defaultOpacity === 'number'
                ? clampOpacity(option.defaultOpacity)
                : 1;
              current.opacity = fallbackOpacity > 0 ? fallbackOpacity : 1;
            }
          }
          applyImageryState();
          updateImageryControlStates();
          applyImageryLayerOrder();
        });

        // Different appending logic for grouped vs non-grouped layers
        if (isGroupMember) {
          // For grouped layers, just append the toggle button to the group preview
          container.appendChild(toggleButton);

          // Store reference for state updates
          const groupData = groupContainers.get(group.id);
          imageryControls.set(option.id, {
            container: groupData.container,
            button: toggleButton,
            slider: groupData.slider,
            sliderWrapper: null,
            isGroupMember: true
          });
        } else {
          // For non-grouped layers, create the full individual control
          // Row 1: Preview (thumbnail) + Label
          const row = document.createElement('div');
          row.className = 'imagery-option__row';

          const preview = document.createElement('div');
          preview.className = 'imagery-option__preview';
          preview.appendChild(toggleButton);

          const label = document.createElement('span');
          label.className = 'imagery-option__label';
          label.textContent = option.label;

          row.appendChild(preview);
          row.appendChild(label);
          container.appendChild(row);

          // Row 2: Slider (if applicable)
          // Hide slider for: Hillshade, Terrain Overlays, and Wikimedia Photos
          const noSliderTypes = ['hillshade', 'native-layer', 'wikimedia'];
          const hideSlider = noSliderTypes.includes(option.type);

          let slider = null;
          let sliderWrapper = null;

          if (!hideSlider) {
            sliderWrapper = document.createElement('div');
            sliderWrapper.className = 'imagery-option__opacity-wrapper';

            slider = document.createElement('input');
            slider.type = 'range';
            slider.min = '0';
            slider.max = '1';
            slider.step = '0.05';
            slider.value = String(state.opacity);
            slider.className = 'imagery-option__opacity';
            slider.setAttribute('aria-label', `${option.label} opacity`);

            slider.addEventListener('input', () => {
              const sliderCurrent = imageryState.get(option.id);
              if (!sliderCurrent) return;
              const value = clampOpacity(Number.parseFloat(slider.value));
              sliderCurrent.opacity = value;
              sliderCurrent.enabled = value > 0;
              applyImageryState();
              updateImageryControlStates();
              applyImageryLayerOrder();
            });

            // Fix: Stop propagation
            const stopDrag = (e) => e.stopPropagation();
            slider.addEventListener('mousedown', stopDrag);
            slider.addEventListener('touchstart', stopDrag, { passive: true });

            sliderWrapper.appendChild(slider);
            container.appendChild(sliderWrapper);
          }

          imageryControls.set(option.id, { container, button: toggleButton, slider, sliderWrapper, isGroupMember: false });
          imageryToggle.appendChild(container);
        }
      });
      updateImageryControlStates();
      updateImageryDomOrder();
      if (!imageryToggle.dataset.dragHandlersBound) {
        imageryToggle.addEventListener('dragover', (event) => {
          if (!dragSourceImageryId) return;
          const targetOption = event.target?.closest?.('.imagery-option');
          if (targetOption) {
            return;
          }
          event.preventDefault();
          if (event?.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
          }
        });

        imageryToggle.addEventListener('drop', (event) => {
          if (!dragSourceImageryId) return;
          const targetOption = event.target?.closest?.('.imagery-option');
          if (targetOption) {
            return;
          }
          event.preventDefault();
          const rect = imageryToggle.getBoundingClientRect();
          const toStart = event.clientY < rect.top + (rect.height / 2);
          moveImageryOptionToBoundary(dragSourceImageryId, toStart);
          dragSourceImageryId = null;
          resetDragIndicators();
        });

        imageryToggle.dataset.dragHandlersBound = 'true';
      }
    }
  }

  const HILLSHADE_METHOD_STYLES = Object.freeze({
    standard: Object.freeze({
      highlightColor: 'rgba(255,255,255,0.85)',
      shadowColor: 'rgba(0,0,0,0.5)',
      exaggeration: 0.40
    }),
    basic: Object.freeze({
      highlightColor: 'rgba(255,255,255,0.8)',
      shadowColor: 'rgba(0,0,0,0.45)',
      exaggeration: 0.35
    }),
    combined: Object.freeze({
      highlightColor: 'rgba(255,255,255,0.98)',
      shadowColor: 'rgba(0,0,0,0.85)',
      accentColor: 'rgba(0,0,0,0.8)',
      exaggeration: ['interpolate', ['linear'], ['zoom'], 6, 2.0, 12, 1.4, 16, 0.8]
    }),
    igor: Object.freeze({
      highlightColor: 'rgba(255,255,255,0.9)',
      shadowColor: 'rgba(0,0,0,0.6)',
      exaggeration: 0.38
    }),
    multidirectional: Object.freeze({
      highlightColor: 'rgba(255,255,255,0.75)',
      shadowColor: 'rgba(0,0,0,0.4)',
      exaggeration: 0.28
    })
  });

  const DEFAULT_HILLSHADE_STYLE = HILLSHADE_METHOD_STYLES.standard ?? Object.freeze({
    highlightColor: 'rgba(255,255,255,0.85)',
    shadowColor: 'rgba(0,0,0,0.5)',
    exaggeration: 0.3
  });

  function getHillshadeMethodStyle(method) {
    return HILLSHADE_METHOD_STYLES[method] ?? DEFAULT_HILLSHADE_STYLE;
  }

  function getHillshadeState() {
    const option = IMAGERY_OPTIONS_BY_ID.get(HILLSHADE_OPTION_ID);
    const state = imageryState.get(HILLSHADE_OPTION_ID);
    if (!state) {
      return null;
    }
    const opacity = clampOpacity(state.opacity ?? option?.defaultOpacity ?? 1);
    const enabled = Boolean(state.enabled && opacity > 0);
    return { option, state, opacity, enabled };
  }

  function getHillshadeImageryState() {
    const resolved = getHillshadeState();
    if (!resolved) {
      return { opacity: 0, enabled: false };
    }
    return { opacity: resolved.opacity, enabled: resolved.enabled };
  }

  function setHillshadeEnabled(enabled) {
    const resolved = getHillshadeState();
    if (!resolved) return;
    resolved.state.enabled = enabled;
    if (enabled && resolved.state.opacity <= 0) {
      const fallback = typeof resolved.option?.defaultOpacity === 'number'
        ? resolved.option.defaultOpacity
        : 1;
      resolved.state.opacity = clampOpacity(fallback) || 1;
    }
    applyImageryState();
    updateImageryControlStates();
  }

  function applyHillshadeAppearance() {
    if (!map.getLayer('hillshade')) return;

    // Hillshade is ALWAYS ON (part of base background, not UI controlled)
    const style = HILLSHADE_METHOD_STYLES.combined;
    const baseExaggeration = style.exaggeration;

    map.setPaintProperty('hillshade', 'hillshade-illumination-anchor', 'map');
    map.setPaintProperty('hillshade', 'hillshade-illumination-direction', [270, 315, 0, 45]);
    map.setPaintProperty('hillshade', 'hillshade-illumination-altitude', [30, 30, 30, 30]);
    map.setPaintProperty('hillshade', 'hillshade-method', 'combined');
    map.setPaintProperty('hillshade', 'hillshade-highlight-color', style.highlightColor);
    map.setPaintProperty('hillshade', 'hillshade-shadow-color', style.shadowColor);
    map.setPaintProperty('hillshade', 'hillshade-accent-color', style.accentColor || style.shadowColor);
    map.setPaintProperty('hillshade', 'hillshade-exaggeration', baseExaggeration);
    map.setLayoutProperty('hillshade', 'visibility', 'visible');
  }

  // Hillshade uses 'combined' method only (no cycling)

  async function applyOverlays() {
    const rmL = id => { if (map.getLayer(id)) map.removeLayer(id); };
    const rmS = id => { if (map.getSource(id)) map.removeSource(id); };

    const liveLayers = map.getStyle().layers || [];
    let topLabelId = null;
    for (let i = liveLayers.length - 1; i >= 0; i--) {
      if (liveLayers[i].type === 'symbol') { topLabelId = liveLayers[i].id; break; }
    }

    rmL('hillshade');
    rmL('color-relief');
    IMAGERY_OPTIONS.forEach((option) => {
      const layerIds = [];
      if (typeof option.layerId === 'string') layerIds.push(option.layerId);
      if (Array.isArray(option.linkedLayerIds)) {
        option.linkedLayerIds.forEach((linkedId) => {
          if (typeof linkedId === 'string') layerIds.push(linkedId);
        });
      }
      layerIds.forEach((layerId) => rmL(layerId));
    });
    rmS('contours');
    rmS('hillshadeSource');
    rmS('reliefDem');
    rmS('terrainSource');
    IMAGERY_OPTIONS.forEach((option) => {
      const sourceIds = [];
      if (typeof option.sourceId === 'string') sourceIds.push(option.sourceId);
      if (Array.isArray(option.sourceIds)) {
        option.sourceIds.forEach((id) => {
          if (typeof id === 'string') sourceIds.push(id);
        });
      }
      sourceIds.forEach((sourceId) => rmS(sourceId));
    });

    map.addSource('terrainSource', {
      type: 'raster-dem',
      tiles: [MAPTERHORN_TILE_URL],
      encoding: 'terrarium',
      tileSize: 512,
      maxzoom: DEM_SOURCE_MAX_ZOOM,
      attribution: MAPTERHORN_ATTRIBUTION
    });
    map.addSource('hillshadeSource', {
      type: 'raster-dem',
      tiles: [MAPTERHORN_TILE_URL],
      encoding: 'terrarium',
      tileSize: 512,
      maxzoom: DEM_SOURCE_MAX_ZOOM,
      attribution: MAPTERHORN_ATTRIBUTION
    });
    // Dedicated Shadow DEM Source with tileZoomOffset for long-distance shadow coverage
    // tileZoomOffset: -1 means use tiles from one zoom level lower (Z-1)
    map.addSource('shadowDemSource', {
      type: 'raster-dem',
      tiles: [MAPTERHORN_TILE_URL],
      encoding: 'terrarium',
      tileSize: 512,
      maxzoom: SHADOW_DEM_MAX_ZOOM,
      tileZoomOffset: 0, // Reverted to 0 per user request
      attribution: MAPTERHORN_ATTRIBUTION
    });
    map.addSource('reliefDem', {
      type: 'raster-dem',
      tiles: [MAPTERHORN_TILE_URL],
      encoding: 'terrarium',
      tileSize: 512,
      maxzoom: DEM_SOURCE_MAX_ZOOM,
      attribution: MAPTERHORN_ATTRIBUTION
    });

    map.addSource('color-relief', {
      type: 'raster-dem',
      tiles: [MAPTERHORN_TILE_URL],
      encoding: 'terrarium',
      tileSize: 512,
      maxzoom: DEM_SOURCE_MAX_ZOOM,
      attribution: MAPTERHORN_ATTRIBUTION
    });

    map.addLayer({
      id: 'terrain',
      type: 'raster',
      source: 'terrainSource'
    });

    map.addLayer({
      id: 'color-relief',
      type: 'color-relief',
      source: 'color-relief',
      paint: {
        'color-relief-color': COLOR_RELIEF_COLOR_RAMP,
        'color-relief-opacity': RELIEF_OPACITY
      }
    }, topLabelId || undefined);

    IMAGERY_OPTIONS.forEach((option) => {
      if (option.type === 'base-style') {
        return;
      }

      if (option.type === 'contours') {
        // Create contour layers
        const state = imageryState.get(option.id);
        const opacity = clampOpacity(state?.opacity ?? option.defaultOpacity ?? 1);
        const visible = Boolean(state?.enabled && opacity > 0);

        // Only create if not already present
        if (!map.getSource('contours')) {
          map.addSource('contours', {
            type: 'vector',
            tiles: [
              demSource.contourProtocolUrl({
                multiplier: 1,
                thresholds: { 11: [60, 300], 12: [30, 150], 13: [30, 150], 14: [15, 60], 15: [6, 30] },
                elevationKey: 'ele',
                levelKey: 'level',
                contourLayer: 'contours'
              })
            ],
            maxzoom: 16
          });

          map.addLayer({
            id: 'contours',
            type: 'line',
            source: 'contours',
            'source-layer': 'contours',
            layout: {
              'line-join': 'round',
              visibility: visible ? 'visible' : 'none'
            },
            paint: {
              'line-color': 'rgba(0,0,0,0.55)',
              'line-width': ['match', ['get', 'level'], 1, 1, 0.5],
              'line-opacity': scaleExpression(CONTOUR_LINE_BASE_OPACITY, opacity)
            }
          }, topLabelId || undefined);

          map.addLayer({
            id: 'contour-text',
            type: 'symbol',
            source: 'contours',
            'source-layer': 'contours',
            filter: ['>', ['get', 'level'], 0],
            layout: {
              'symbol-placement': 'line',
              'text-anchor': 'center',
              'text-size': 10,
              'text-field': ['concat', ['number-format', ['get', 'ele'], { 'maximumFractionDigits': 0 }], ' m'],
              'text-font': ['Noto Sans Bold'],
              visibility: visible ? 'visible' : 'none'
            },
            paint: {
              'text-halo-color': 'white',
              'text-halo-width': 1,
              'text-opacity': scaleExpression(CONTOUR_TEXT_BASE_OPACITY, opacity)
            }
          }, topLabelId || undefined);
        }

        return;
      }

      if (option.type === 'hillshade') {
        return;
      }

      // Handle debug-tiles with tilesUrl (uses tiles.json endpoint)
      if (option.type === 'debug-tiles' && option.tilesUrl) {
        const state = imageryState.get(option.id);
        const opacity = clampOpacity(state?.opacity ?? option.defaultOpacity ?? 1);
        const visible = Boolean(state?.enabled && opacity > 0);

        if (!map.getSource(option.sourceId)) {
          const sourceConfig = {
            type: 'raster',
            url: option.tilesUrl,
            tileSize: option.tileSize ?? 256,
            attribution: option.attribution
          };
          // Add maxzoom if specified to align with shadow layer tiles
          if (option.maxzoom !== undefined) {
            sourceConfig.maxzoom = option.maxzoom;
          }
          map.addSource(option.sourceId, sourceConfig);

          map.addLayer({
            id: option.layerId,
            type: 'raster',
            source: option.sourceId,
            layout: { visibility: visible ? 'visible' : 'none' },
            paint: { 'raster-opacity': opacity }
          });
        }
        return;
      }

      if (!option.sourceId || !option.layerId || !option.tileTemplate) {
        return;
      }

      map.addSource(option.sourceId, {
        type: 'raster',
        tiles: [option.tileTemplate],
        tileSize: option.tileSize ?? 256,
        attribution: option.attribution,
        minzoom: option.minZoom ?? 0,
        maxzoom: option.maxZoom ?? 19
      });

      const paint = {
        'raster-fade-duration': TILE_FADE_DURATION
      };
      if (option.paint && typeof option.paint === 'object') {
        Object.assign(paint, option.paint);
      }
      const state = imageryState.get(option.id);
      paint['raster-opacity'] = clampOpacity(state?.opacity ?? paint['raster-opacity'] ?? 1);
      if (!Number.isFinite(paint['raster-opacity'])) {
        paint['raster-opacity'] = 1;
      }

      map.addLayer({
        id: option.layerId,
        type: 'raster',
        source: option.sourceId,
        paint,
        layout: {
          visibility: state?.enabled && state.opacity > 0 ? 'visible' : 'none'
        }
      }, topLabelId || undefined);
    });

    applyImageryLayerOrder();

    // Add hillshade layer first (before applyImageryState so it gets initial state)
    map.addLayer({
      id: 'hillshade',
      type: 'hillshade',
      source: 'hillshadeSource',
      paint: {
        'hillshade-highlight-color': 'rgba(255,255,255,0.9)',
        'hillshade-accent-color': 'rgba(0,0,0,0.55)',
        'hillshade-exaggeration': 0.23,
        'hillshade-shadow-color': 'rgba(0,0,0,0.55)'
      }
    }, topLabelId || undefined);

    // Add normalmap layer (hillshade layer with method='normalmap')
    // Uses the same hillshadeSource but displays terrain normals as RGB
    map.addLayer({
      id: 'normalmap',
      type: 'hillshade',  // Uses hillshade type but with normalmap rendering method
      source: 'hillshadeSource',
      layout: {
        'visibility': 'none'  // Start hidden
      },
      paint: {
        'hillshade-exaggeration': 1.0
      }
    }, topLabelId || undefined);

    // Create helper to force normalmap method (bypasses style-spec)
    // No longer needed - method is forced by layer.id in hillshade_program.ts
    console.log('[App] Native terrain layers added (normalmap, aspect, slope, avalanche)');

    // Add Aspect layer (native)
    map.addLayer({
      id: 'aspect-native',
      type: 'hillshade',
      source: 'hillshadeSource',
      layout: { 'visibility': 'none' },
      paint: { 'hillshade-exaggeration': 1.0 }
    }, topLabelId || undefined);

    // Add Slope layer (native)
    map.addLayer({
      id: 'slope-native',
      type: 'hillshade',
      source: 'hillshadeSource',
      layout: { 'visibility': 'none' },
      paint: { 'hillshade-exaggeration': 1.0 }
    }, topLabelId || undefined);

    // Add Avalanche layer (native)
    map.addLayer({
      id: 'avalanche-native',
      type: 'hillshade',
      source: 'hillshadeSource',
      layout: { 'visibility': 'none' },
      paint: { 'hillshade-exaggeration': 1.0 }
    }, topLabelId || undefined);

    // Add Snow layer (native)
    map.addLayer({
      id: 'snow-native',
      type: 'hillshade',
      source: 'hillshadeSource',
      layout: { 'visibility': 'none' },
      paint: { 'hillshade-exaggeration': 1.0 }
    }, topLabelId || undefined);

    // Add Detail/Self-Shadow layer (native) - High Res, No Raymarching
    // Uses Green Accent (#00ff00) as shader flag
    map.addLayer({
      id: 'detail-native',
      type: 'hillshade',
      source: 'hillshadeSource',
      layout: { 'visibility': 'none' },
      paint: {
        'hillshade-exaggeration': 1.0,
        'hillshade-illumination-anchor': 'map',
        'hillshade-accent-color': '#00ff00'
      }
    }, topLabelId || undefined);

    // Add Shadow layer (native) - uses dedicated low-zoom DEM source for full coverage
    map.addLayer({
      id: 'shadow-native',
      type: 'hillshade',
      source: 'shadowDemSource',
      layout: { 'visibility': 'none' },
      paint: {
        'hillshade-exaggeration': 1.0,
        'hillshade-illumination-anchor': 'map'
      }
    }, topLabelId || undefined);

    // Now apply state (contours exist, hillshade exists)
    applyImageryState();
    updateImageryControlStates();
    applyHillshadeAppearance();

    ensureGpxLayers(map, currentGpxData, topLabelId);

    const symbolLayers = (map.getStyle().layers || []).filter(l => l.type === 'symbol');
    symbolLayers.forEach(l => map.moveLayer(l.id));

    if (debugNetworkVisible) {
      bringDebugNetworkToFront();
    }

    viewModeController.onTerrainSourcesUpdated();

    updatePeakLabels(map);
  }

  map.on('style.load', applyOverlays);
  map.once('style.load', () => applyHillshadeAppearance());

  map.once('style.load', () => viewModeController.applyCurrentMode({ animate: false }));

  // Initialize Shadow Debug Tuner
  if (window.XploreDebug && typeof window.ShadowTuner !== 'undefined') {
    window.shadowTuner = new window.ShadowTuner(map);
    // Auto-open for convenience during development
    window.shadowTuner.toggleUI();
  }
}

init().catch((error) => {
  console.error('Failed to initialise the map', error);
});
