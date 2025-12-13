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
} from './constants.js';
import {
  ensureGpxLayers,
  geojsonToGpx,
  parseGpxToGeoJson,
  zoomToGeojson
} from './gpx.js';
import { DirectionsManager } from './directions/DirectionsManager.js';
import './pmtiles.js';
import { OfflineRouter, DEFAULT_NODE_CONNECTION_TOLERANCE_METERS } from './offline-router.js';
import { MaplibreDirectionsRouter } from './maplibre-directions-router.js';
import { OrsRouter } from './openrouteservice-router.js';
import { extractOverpassNetwork } from './overpass-network.js';
import { extractOpenFreeMapNetwork } from './openfreemap-network.js';
import { createViewModeController } from './view-mode-controller.js';

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
const DEM_SOURCE_MAX_ZOOM = 14;

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

const BASE_STYLE_OPTION_ID = 'vector-map';

const IMAGERY_OPTIONS = Object.freeze([
  {
    id: BASE_STYLE_OPTION_ID,
    label: 'Vector OSM',
    type: 'base-style',
    previewImage: './data/OSM_vector.png',
    defaultOpacity: BASE_STYLE_RELIEF_OPACITY,
    defaultVisible: true
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
    defaultOpacity: 0.5
  },
  {
    id: 'contours',
    label: 'Contours',
    type: 'contours',
    sourceId: 'contours',
    layerId: 'contours',
    linkedLayerIds: ['contour-text'],
    previewImage: './data/contour.png',
    defaultVisible: true,
    defaultOpacity: 0.5
  },
  {
    id: 'ign-cosia',
    label: 'IGN Kosia 2021-2023',
    sourceId: 'ign-cosia',
    layerId: 'ign-cosia',
    tileTemplate: createIgnTileTemplate('IGNF_COSIA_2021-2023', 'image/png'),
    tileSize: 256,
    attribution: IGN_ATTRIBUTION,
    defaultVisible: true,
    defaultOpacity: 0.3
  },
  {
    id: 'ign-orthophotos',
    label: 'IGN Orthophotos',
    sourceId: 'ign-orthophotos',
    layerId: 'ign-orthophotos',
    tileTemplate: createIgnTileTemplate('ORTHOIMAGERY.ORTHOPHOTOS.BDORTHO', 'image/jpeg'),
    tileSize: 256,
    attribution: IGN_ATTRIBUTION,
    defaultVisible: false,
    defaultOpacity: 0.4
  },
  {
    id: 'ign-lidar-hd-mns-shadow',
    label: 'MNS',
    sourceId: 'ign-lidar-hd-mns-shadow',
    layerId: 'ign-lidar-hd-mns-shadow',
    tileTemplate: createIgnTileTemplate('IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW', 'image/png'),
    tileSize: 256,
    attribution: IGN_ATTRIBUTION,
    defaultVisible: true,
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
  {
    id: 'hillshade',
    label: 'Hillshade (MapLibre)',
    type: 'hillshade',
    sourceId: 'hillshadeSource',
    layerId: 'hillshade',
    previewImage: './data/style.png',
    hiddenControl: true,
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
  }
]);

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
    igor: 'Igor',
    combined: 'Combined',
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

function setBaseStyleOpacity(map, alpha) {
  const style = map.getStyle();
  if (!style || !style.layers) return;
  for (const layer of style.layers) {
    const id = layer.id;
    const type = layer.type;

    if (
      IMAGERY_LAYER_IDS.has(id) ||
      ROUTE_LAYER_IDS.has(id) ||
      ['color-relief', 'hillshade', 'contours', 'contour-text'].includes(id)
    ) continue;

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
  }
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

  const map = new maplibregl.Map({
    container: 'map',
    hash: true,
    center: [7.6586, 45.9763],
    zoom: 11.7,
    pitch: DEFAULT_3D_ORIENTATION.pitch,
    bearing: DEFAULT_3D_ORIENTATION.bearing,
    style: versaStyle,
    maxZoom: 18,
    maxPitch: 50,
    antialias: true,
    fadeDuration: TILE_FADE_DURATION
  });

  maplibrePreload(map, {
    text: 'Xplore',
    logoSrc: './data/logos/Xplore.png',
    logoAlt: 'Xplore',
    minDuration: 5000,
    background: '#05090f'
  });

  const gpxFileInput = document.getElementById('gpxFileInput');
  const gpxImportButton = document.getElementById('gpxImportButton');
  const gpxExportButton = document.getElementById('gpxExportButton');
  const directionsToggle = document.getElementById('directionsToggle');
  const directionsDock = document.getElementById('directionsDock');
  const directionsControl = document.getElementById('directionsControl');
  const transportModes = directionsControl?.querySelectorAll('[data-mode]') ?? [];
  const swapButton = document.getElementById('swapDirectionsButton');
  const undoButton = document.getElementById('undoDirectionsButton');
  const redoButton = document.getElementById('redoDirectionsButton');
  const clearButton = document.getElementById('clearDirectionsButton');
  const routeStats = document.getElementById('routeStats');
  const elevationCard = document.getElementById('elevationCard');
  const elevationChartBody = document.getElementById('elevationChartBody');
  const elevationChart = document.getElementById('elevationChart');
  const elevationCollapseToggle = document.getElementById('toggleElevationButton');
  const directionsInfoButton = document.getElementById('directionsInfoButton');
  const directionsHint = document.getElementById('directionsHint');
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
      debugNetworkControl.hidden = !offlineActive;
      debugNetworkControl.setAttribute('aria-hidden', offlineActive ? 'false' : 'true');
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

        const { network } = networkResult;
        let { coverageBounds } = networkResult;
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

  map.on('load', async () => {
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
        elevationCard,
        elevationChartBody,
        elevationChart,
        elevationCollapseToggle,
        directionsInfoButton,
        directionsHint,
        profileModeToggle,
        profileModeMenu,
        profileLegend
      ], {
        router: offlineRouter,
        deferRouterInitialization: true
      });
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
  const terrainHdToggle = document.getElementById('terrainHdToggle');

  const viewModeController = createViewModeController(map, {
    toggleButton: viewToggleBtn,
    hdToggle: terrainHdToggle,
    vignetteElement: vignetteEl,
    skySettings: SKY_SETTINGS,
    defaultMode: VIEW_MODES.THREED,
    defaultOrientation: DEFAULT_3D_ORIENTATION,
    terrainSourceId: 'terrainSource',
    hdSources: ['terrainSource', 'hillshadeSource', 'reliefDem', 'color-relief']
  });

  const imageryPanel = document.getElementById('imageryPanel');
  const imageryPanelToggle = document.getElementById('imageryPanelToggle');
  const imageryPanelDrawer = document.getElementById('imageryPanelDrawer');
  const imageryToggle = document.getElementById('imageryToggle');
  const imageryControls = new Map();
  let imageryOrder = IMAGERY_OPTIONS.map((option) => option.id);
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
    imageryOrder.forEach((id) => {
      const control = imageryControls.get(id);
      if (!control?.container) return;
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

    const overlaySequence = baseStyleOverlayLayerIds
      .filter((layerId) => typeof layerId === 'string' && map.getLayer(layerId));
    if (overlaySequence.length) {
      orderedEntries.push({ layerSequence: overlaySequence });
    }

    let baseUnderlayAdded = false;

    imageryOrder.forEach((id) => {
      if (id === BASE_STYLE_OPTION_ID) {
        const layerSequence = baseStyleUnderlayLayerIds
          .filter((layerId) => typeof layerId === 'string' && map.getLayer(layerId));
        if (layerSequence.length) {
          orderedEntries.push({ layerSequence });
          baseUnderlayAdded = true;
        }
        return;
      }

      const option = IMAGERY_OPTIONS_BY_ID.get(id);
      if (!option) return;
      const layerSequence = [];
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
      if (layerSequence.length) {
        orderedEntries.push({ layerSequence });
      }
    });

    if (!baseUnderlayAdded && baseStyleUnderlayLayerIds.length) {
      const layerSequence = baseStyleUnderlayLayerIds
        .filter((layerId) => typeof layerId === 'string' && map.getLayer(layerId));
      if (layerSequence.length) {
        orderedEntries.push({ layerSequence });
      }
    }

    let beforeId = topLabelId ?? undefined;
    for (let i = 0; i < orderedEntries.length; i += 1) {
      const entry = orderedEntries[i];
      if (!entry) continue;
      const { layerSequence } = entry;
      for (let j = layerSequence.length - 1; j >= 0; j -= 1) {
        const layerId = layerSequence[j];
        if (!layerId || !map.getLayer(layerId)) continue;
        if (beforeId) {
          if (beforeId !== layerId) {
            map.moveLayer(layerId, beforeId);
          }
        } else {
          map.moveLayer(layerId);
        }
        beforeId = layerId;
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
  }

  function moveImageryOption(sourceId, targetId, placeBeforeTarget) {
    if (sourceId === targetId) {
      return;
    }
    const sourceIndex = imageryOrder.indexOf(sourceId);
    const targetIndex = imageryOrder.indexOf(targetId);
    if (sourceIndex === -1 || targetIndex === -1) {
      return;
    }
    imageryOrder.splice(sourceIndex, 1);
    const updatedTargetIndex = imageryOrder.indexOf(targetId);
    if (updatedTargetIndex === -1) {
      return;
    }
    const insertionIndex = placeBeforeTarget ? updatedTargetIndex : updatedTargetIndex + 1;
    imageryOrder.splice(insertionIndex, 0, sourceId);
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
    imageryPanelDrawer.classList.toggle('imagery-panel__drawer--open', open);
    if (open) {
      imageryPanelDrawer.removeAttribute('hidden');
    } else {
      imageryPanelDrawer.setAttribute('hidden', 'true');
    }
    imageryPanelDrawer.setAttribute('aria-hidden', String(!open));
    imageryPanelToggle?.setAttribute('aria-expanded', String(open));
  }

  function updateImageryControlStates() {
    imageryControls.forEach((control, id) => {
      const state = imageryState.get(id);
      const isActive = Boolean(state?.enabled && state.opacity > 0);
      if (control.button) {
        control.button.classList.toggle('active', isActive);
        control.button.setAttribute('aria-pressed', String(isActive));
      }
      if (control.container) {
        control.container.classList.toggle('active', isActive);
      }
      if (control.slider && state) {
        control.slider.value = String(state.opacity);
      }
      if (control.sliderWrapper) {
        control.sliderWrapper.classList.toggle('active', isActive);
      }
    });
  }

  function applyImageryState() {
    IMAGERY_OPTIONS.forEach((option) => {
      const state = imageryState.get(option.id);
      const opacity = clampOpacity(state?.opacity ?? 0);
      const visible = Boolean(state?.enabled && opacity > 0);
      if (option.type === 'base-style') {
        setBaseStyleOpacity(map, visible ? opacity : 0);
        return;
      }
      if (option.type === 'contours') {
        applyContourLayersState(opacity, visible);
        return;
      }
      if (option.type === 'hillshade') {
        applyHillshadeAppearance();
        return;
      }
      if (!option.layerId || !map.getLayer(option.layerId)) return;
      map.setPaintProperty(option.layerId, 'raster-opacity', opacity);
      map.setLayoutProperty(option.layerId, 'visibility', visible ? 'visible' : 'none');
    });

    updateHillshadeControl(currentHillshadeMethod);
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

  if (imageryToggle) {
    imageryToggle.textContent = '';
    if (!IMAGERY_OPTIONS.length) {
      imageryToggle.setAttribute('hidden', 'true');
      imageryToggle.setAttribute('aria-hidden', 'true');
      imageryPanel?.setAttribute('hidden', 'true');
    } else {
      imageryToggle.removeAttribute('hidden');
      imageryToggle.setAttribute('aria-hidden', 'false');
      imageryPanel?.removeAttribute('hidden');
      IMAGERY_OPTIONS.forEach((option) => {
        if (option.hiddenControl) {
          return;
        }
        const state = imageryState.get(option.id) ?? { enabled: false, opacity: 0 };
        const container = document.createElement('div');
        container.className = 'imagery-option';
        container.dataset.imageryId = option.id;

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

        const preview = document.createElement('div');
        preview.className = 'imagery-option__preview';

        const toggleButton = document.createElement('button');
        toggleButton.type = 'button';
        toggleButton.className = 'imagery-option__toggle';
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
          img.className = 'imagery-option__thumb';
          toggleButton.appendChild(img);
        }

        const srLabel = document.createElement('span');
        srLabel.className = 'sr-only';
        srLabel.textContent = option.label;
        toggleButton.appendChild(srLabel);

        toggleButton.addEventListener('click', () => {
          const current = imageryState.get(option.id);
          if (!current) return;
          const currentlyActive = Boolean(current.enabled && current.opacity > 0);
          const nextEnabled = !currentlyActive;
          current.enabled = nextEnabled;
          if (nextEnabled && current.opacity <= 0) {
            const fallbackOpacity = typeof option.defaultOpacity === 'number'
              ? clampOpacity(option.defaultOpacity)
              : 1;
            current.opacity = fallbackOpacity > 0 ? fallbackOpacity : 1;
          }
          applyImageryState();
          updateImageryControlStates();
          applyImageryLayerOrder();
        });

        preview.appendChild(toggleButton);

        const sliderWrapper = document.createElement('div');
        sliderWrapper.className = 'imagery-option__opacity-wrapper';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '1';
        slider.step = '0.05';
        slider.value = String(state.opacity);
        slider.className = 'imagery-option__opacity';
        slider.setAttribute('aria-label', `${option.label} opacity`);

        const restoreContainerDrag = () => {
          if (container.dataset.dragDisabled === 'true') {
            delete container.dataset.dragDisabled;
            container.draggable = true;
          }
        };

        const handlePointerEnd = (event) => {
          if (event) {
            event.stopPropagation();
          }
          restoreContainerDrag();
          document.removeEventListener('pointerup', handlePointerEnd);
          document.removeEventListener('pointercancel', handlePointerEnd);
        };

        slider.addEventListener('pointerdown', (event) => {
          event.stopPropagation();
          container.dataset.dragDisabled = 'true';
          container.draggable = false;
          document.addEventListener('pointerup', handlePointerEnd);
          document.addEventListener('pointercancel', handlePointerEnd);
        });

        slider.addEventListener('click', (event) => {
          event.stopPropagation();
        });

        slider.addEventListener('dragstart', (event) => {
          event.preventDefault();
          event.stopPropagation();
        });

        slider.addEventListener('blur', restoreContainerDrag);

        slider.addEventListener('input', () => {
          const current = imageryState.get(option.id);
          if (!current) return;
          const value = clampOpacity(Number.parseFloat(slider.value));
          current.opacity = value;
          current.enabled = value > 0;
          applyImageryState();
          updateImageryControlStates();
          applyImageryLayerOrder();
        });

        sliderWrapper.appendChild(slider);
        preview.appendChild(sliderWrapper);
        container.appendChild(preview);

        imageryControls.set(option.id, { container, button: toggleButton, slider, sliderWrapper });
        imageryToggle.appendChild(container);
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
    combined: Object.freeze({
      highlightColor: 'rgba(255,255,255,0.88)',
      shadowColor: 'rgba(0,0,0,0.58)',
      exaggeration: 0.23
    }),
    igor: Object.freeze({
      highlightColor: 'rgba(255,255,255,0.9)',
      shadowColor: 'rgba(0,0,0,0.6)',
      exaggeration: 0.24
    })
  });

  const DEFAULT_HILLSHADE_STYLE = HILLSHADE_METHOD_STYLES.igor ?? Object.freeze({
    highlightColor: 'rgba(255,255,255,0.9)',
    shadowColor: 'rgba(0,0,0,0.6)',
    exaggeration: 0.24
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
    const { opacity, enabled } = getHillshadeImageryState();
    const method = currentHillshadeMethod ?? 'combined';
    const style = getHillshadeMethodStyle(method);
    const baseExaggeration = Number.isFinite(style?.exaggeration) ? style.exaggeration : 0;
    const effectiveOpacity = enabled ? opacity : 0;

    map.setPaintProperty('hillshade', 'hillshade-illumination-anchor', 'map');
    map.setPaintProperty('hillshade', 'hillshade-illumination-direction', [270, 315, 0, 45]);
    map.setPaintProperty('hillshade', 'hillshade-illumination-altitude', [30, 30, 30, 30]);
    map.setPaintProperty('hillshade', 'hillshade-method', method);
    map.setPaintProperty('hillshade', 'hillshade-highlight-color', style.highlightColor);
    map.setPaintProperty('hillshade', 'hillshade-shadow-color', style.shadowColor);
    map.setPaintProperty('hillshade', 'hillshade-exaggeration', baseExaggeration * effectiveOpacity);
    map.setLayoutProperty('hillshade', 'visibility', effectiveOpacity > 0 ? 'visible' : 'none');
  }

  const hillshadeMethodButton = document.getElementById('cycleHillshadeMethod');
  const hillshadeMethodLabel = hillshadeMethodButton?.querySelector('.hillshade-method-button__label') ?? null;
  const hillshadeMethods = (() => {
    const available = Array.from(new Set(getAvailableHillshadeMethods()));
    if (!available.length) {
      return ['igor', 'combined'];
    }
    ['igor', 'combined'].forEach((method) => {
      if (!available.includes(method)) {
        available.push(method);
      }
    });
    return available;
  })();

  let currentHillshadeMethod = hillshadeMethods.includes('igor')
    ? 'igor'
    : (hillshadeMethods[0] ?? 'combined');
  let hillshadeMethodIndex = Math.max(0, hillshadeMethods.indexOf(currentHillshadeMethod));

  function updateHillshadeControl(method) {
    if (!hillshadeMethodButton || !hillshadeMethodLabel) return;
    const readable = formatHillshadeMethodName(method);
    const hillshadeState = getHillshadeState();
    const isActive = Boolean(hillshadeState?.enabled);
    const hasAlternateMethods = hillshadeMethods.length > 1;
    const hint = hasAlternateMethods
      ? `Click to toggle hillshade. Shift-click to change method (current: ${readable})`
      : `Click to toggle hillshade (current: ${readable})`;

    hillshadeMethodLabel.textContent = `Method: ${readable}`;
    hillshadeMethodButton.classList.toggle('active', isActive);
    hillshadeMethodButton.setAttribute('aria-pressed', String(isActive));
    hillshadeMethodButton.setAttribute('aria-label', hint);
    hillshadeMethodButton.setAttribute('title', hint);
  }

  function applyHillshadeMethod(method) {
    currentHillshadeMethod = method;
    hillshadeMethodIndex = Math.max(0, hillshadeMethods.indexOf(method));
    updateHillshadeControl(method);
    applyHillshadeAppearance();
  }

  function cycleHillshadeMethod() {
    if (hillshadeMethods.length <= 1) {
      return currentHillshadeMethod;
    }
    hillshadeMethodIndex = (hillshadeMethodIndex + 1) % hillshadeMethods.length;
    const nextMethod = hillshadeMethods[hillshadeMethodIndex];
    applyHillshadeMethod(nextMethod);
    return nextMethod;
  }

  if (hillshadeMethodButton) {
    hillshadeMethodButton.disabled = false;
    updateHillshadeControl(currentHillshadeMethod);
    hillshadeMethodButton.addEventListener('click', (event) => {
      const wantsMethodCycle = (event?.shiftKey || event?.altKey || event?.metaKey || event?.ctrlKey)
        && hillshadeMethods.length > 1;
      if (wantsMethodCycle) {
        if (!getHillshadeState()?.enabled) {
          setHillshadeEnabled(true);
        }
        cycleHillshadeMethod();
        return;
      }

      const hillshadeState = getHillshadeState();
      const nextEnabled = !(hillshadeState?.enabled);
      setHillshadeEnabled(nextEnabled);
    });
  }

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
        const state = imageryState.get(option.id);
        const opacity = clampOpacity(state?.opacity ?? option.defaultOpacity ?? 1);
        const visible = Boolean(state?.enabled && opacity > 0);

        map.addSource(option.sourceId, {
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
          source: option.sourceId,
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
          source: option.sourceId,
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

        return;
      }

      if (option.type === 'hillshade') {
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
        maxzoom: option.maxzoom ?? 19
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
    applyImageryState();
    updateImageryControlStates();

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

    applyHillshadeMethod(currentHillshadeMethod);

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
  map.once('style.load', () => applyHillshadeMethod(currentHillshadeMethod));

  map.once('style.load', () => viewModeController.applyCurrentMode({ animate: false }));
}

init().catch((error) => {
  console.error('Failed to initialise the map', error);
});
