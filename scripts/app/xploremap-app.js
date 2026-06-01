/**
 * xploremap-app.js — Slim orchestrator.
 *
 * Imports the modular subsystems and wires them together.
 * Keeps inline: DirectionsManager wiring, GPX import/export with segment
 * exports, imagery-panel DOM rendering, toolbox open/close, FOV/LOD controls.
 */

// ─── Module imports ───
import { createMap, getBaseStyleLayerBuckets, parseAndCacheBaseStyleLayers } from './map-init.js?v=20260525-relief-match';
import { createImageryManager, IMAGERY_OPTIONS, LAYER_GROUP_BY_MEMBER_ID, SUN_DURATION_ADDON_IDS } from './imagery-manager.js?v=20260525-relief-match';
import { applyOverlays, applyHillshadeAppearance, injectOverlaysIntoStyle } from './overlay-manager.js?v=20260525-relief-match';
import { createRoutingOrchestrator } from './routing-orchestrator.js';
import { createShadowController } from './shadow-controller.js';
import { initShadowV3DebugOverlay } from './shadow-v3-debug-overlay.js?v=20260521-daylight-normal-z-relief';
import {
  initTerrainAnalysisConfig,
  setupTerrainHoverInfo,
  updateAnalyticalLegends as renderAnalyticalLegends,
} from './terrain-analysis-controller.js';

// ─── External module imports ───
import { createViewModeController } from '../map/map-view-mode-controller.js?v=20260522-outdoor-no-forced-3d';
import { DirectionsManager } from '../directions/core/directions-manager.js';
import { RouteLibraryManager } from '../storage/route-library-manager.js';
import { RouteLibraryUI } from '../ui/route-library-ui.js';
import { ensureGpxLayers, zoomToGeojson, parseGpxToGeoJson, geojsonToGpx } from '../gpx/gpx-io.js';
import { initializeWikimediaPhotos, restoreWikimediaLayers } from '../map/wikimedia-photos.js';
import { initPeakLabelMarkers } from '../map/peak-label-markers.js?v=20260523-dom-depth-peaks';
import { initContours } from '../map/contour-2d.js';
import '../map/pmtiles-protocol.js';
import { Modal } from '../ui/modal.js';
import { Toast } from '../ui/toast.js';

// ─── Config imports ───
import {
  SKY_SETTINGS,
  VIEW_MODES,
  DEFAULT_3D_ORIENTATION,
} from '../config/map-config.js';

const TRANSPARENT_IMAGE = Object.freeze({ width: 1, height: 1, data: new Uint8Array([0, 0, 0, 0]) });
const CARTES_SPRITE_URL = new URL('../../data/cartes-sprite/sprite', import.meta.url).href;
const OPENFREEMAP_GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const CARTES_ICON_URLS = new Map([
  ['cartesapp-arete', new URL('../../data/cartes-icons/arete.svg', import.meta.url).href],
  ['cartesapp-bare_rock', new URL('../../data/cartes-icons/bare_rock.svg', import.meta.url).href],
  ['cartesapp-cliff', new URL('../../data/cartes-icons/cliff.svg', import.meta.url).href],
  ['cartesapp-scree', new URL('../../data/cartes-icons/scree.svg', import.meta.url).href],
  ['cartesapp-stone', new URL('../../data/cartes-icons/stone.svg', import.meta.url).href],
  ['cartesapp-triangle', new URL('../../data/cartes-icons/triangle.svg', import.meta.url).href],
]);
const CARTES_STYLE_IDS = new Set(['xplore-outdoor-hybrid', 'xplore-outdoor-hybrid-2']);
const CARTES_ICON_SIZE_OVERRIDES = new Map([
  ['cartesapp-arete', 16],
  ['cartesapp-bare_rock', 24],
  ['cartesapp-bollard', 16],
  ['cartesapp-broadleaved', 20],
  ['cartesapp-cliff', 16],
  ['cartesapp-cycle_barrier', 16],
  ['cartesapp-entrance', 16],
  ['cartesapp-gate', 16],
  ['cartesapp-lift-gate', 16],
  ['cartesapp-mixed', 20],
  ['cartesapp-needleleaved', 20],
  ['cartesapp-oneway', 16],
  ['cartesapp-scree', 20],
  ['cartesapp-shelter', 16],
  ['cartesapp-stone', 30],
  ['cartesapp-triangle', 16],
  ['cartesapp-unknown_leaf', 20],
  ['cartesapp-waste_basket', 16],
]);
const CARTES_PATTERN_IMAGE_IDS = new Set([
  'cartesapp-bare_rock',
  'cartesapp-broadleaved',
  'cartesapp-mixed',
  'cartesapp-needleleaved',
  'cartesapp-scree',
  'cartesapp-unknown_leaf',
]);
const CARTES_RASTER_PIXEL_RATIO = 2;

function getCartesIconUrl(id) {
  if (CARTES_ICON_URLS.has(id)) return CARTES_ICON_URLS.get(id);
  if (!id.startsWith('cartesapp-')) return '';
  const iconName = id.slice('cartesapp-'.length);
  if (!/^[a-z0-9_-]+$/i.test(iconName)) return '';
  return new URL(`../../data/cartes-icons/${iconName}.svg`, import.meta.url).href;
}

function getCartesIconSize(id) {
  if (CARTES_PATTERN_IMAGE_IDS.has(id)) {
    return CARTES_ICON_SIZE_OVERRIDES.get(id) || 40;
  }
  return CARTES_ICON_SIZE_OVERRIDES.get(id) || 32;
}

function rasterizeCartesSvg(url, id, sizeOverride = null) {
  const displaySize = sizeOverride || getCartesIconSize(id);
  const pixelRatio = CARTES_RASTER_PIXEL_RATIO;
  const rasterSize = Math.max(1, Math.round(displaySize * pixelRatio));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = rasterSize;
      canvas.height = rasterSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error(`No canvas context for ${id}`));
        return;
      }
      ctx.clearRect(0, 0, rasterSize, rasterSize);
      ctx.drawImage(img, 0, 0, rasterSize, rasterSize);
      resolve({
        data: ctx.getImageData(0, 0, rasterSize, rasterSize),
        options: { pixelRatio }
      });
    };
    img.onerror = (event) => reject(new Error(`Failed to load Cartes SVG ${id}: ${event?.message || 'unknown error'}`));
    img.src = url;
  });
}

function makeCanvasImage(size, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return TRANSPARENT_IMAGE;
  ctx.clearRect(0, 0, size, size);
  draw(ctx, size);
  return ctx.getImageData(0, 0, size, size);
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function createStretchablePillImage({ fill, stroke = null, shadow = null }) {
  const pixelRatio = 2;
  const width = 128;
  const height = 48;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, width, height);
  const pad = 5;
  const radius = 18;
  if (shadow) {
    ctx.save();
    ctx.shadowColor = shadow.color;
    ctx.shadowBlur = shadow.blur;
    ctx.shadowOffsetY = shadow.offsetY;
    ctx.fillStyle = fill;
    roundedRectPath(ctx, pad + 1, pad + 1, width - pad * 2 - 2, height - pad * 2 - 2, radius);
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = fill;
  roundedRectPath(ctx, pad, pad, width - pad * 2, height - pad * 2, radius);
  ctx.fill();

  if (stroke) {
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    roundedRectPath(ctx, pad + stroke.width / 2, pad + stroke.width / 2, width - pad * 2 - stroke.width, height - pad * 2 - stroke.width, radius);
    ctx.stroke();
  }

  return {
    data: ctx.getImageData(0, 0, width, height),
    options: {
      pixelRatio,
      stretchX: [[30, width - 30]],
      stretchY: [[20, height - 20]],
      content: [24, 12, width - 24, height - 12],
    },
  };
}

function createPeakLabelFrameImage() {
  const pixelRatio = 2;
  const width = 292;
  const height = 52;
  const elevationStart = width - 154;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, width, height);

  ctx.save();
  ctx.shadowColor = 'rgba(20, 30, 38, 0.18)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.97)';
  roundedRectPath(ctx, 5, 7, width - 10, height - 14, 18);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.97)';
  roundedRectPath(ctx, 5, 7, width - 10, height - 14, 18);
  ctx.fill();

  ctx.fillStyle = 'rgba(53, 188, 207, 0.98)';
  roundedRectPath(ctx, elevationStart, 7, width - elevationStart - 5, height - 14, 18);
  ctx.fill();

  ctx.fillStyle = 'rgba(53, 188, 207, 0.98)';
  ctx.fillRect(elevationStart, 7, 36, height - 14);

  ctx.strokeStyle = 'rgba(33, 45, 55, 0.15)';
  ctx.lineWidth = 1.5;
  roundedRectPath(ctx, 5.75, 7.75, width - 11.5, height - 15.5, 17);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.62)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(elevationStart, 10);
  ctx.lineTo(elevationStart, height - 10);
  ctx.stroke();

  return {
    data: ctx.getImageData(0, 0, width, height),
    options: {
      pixelRatio,
      stretchX: [[28, elevationStart - 14]],
      stretchY: [[22, height - 22]],
      content: [16, 10, width - 14, height - 10],
    },
  };
}

function createPeakLeaderImage() {
  const pixelRatio = 2;
  const width = 36;
  const height = 108;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const centerX = width / 2;
  const dotY = height - 13;

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(centerX, 8);
  ctx.lineTo(centerX, dotY);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(37, 54, 64, 0.2)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(centerX, 8);
  ctx.lineTo(centerX, dotY);
  ctx.stroke();

  ctx.fillStyle = '#e6007e';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(centerX, dotY, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  return {
    data: ctx.getImageData(0, 0, width, height),
    options: { pixelRatio },
  };
}

function createPeakRedMountainIcon() {
  const pixelRatio = 2;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#ff3f55';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.98)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(32, 34, 23, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(16, 45);
  ctx.lineTo(29, 23);
  ctx.lineTo(36, 33);
  ctx.lineTo(40, 28);
  ctx.lineTo(49, 45);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#ff3f55';
  ctx.beginPath();
  ctx.moveTo(25, 29);
  ctx.lineTo(29, 23);
  ctx.lineTo(34, 31);
  ctx.lineTo(30, 29);
  ctx.lineTo(27, 32);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(49, 4);
  ctx.lineTo(52, 14);
  ctx.lineTo(62, 17);
  ctx.lineTo(52, 20);
  ctx.lineTo(49, 30);
  ctx.lineTo(46, 20);
  ctx.lineTo(36, 17);
  ctx.lineTo(46, 14);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(93, 108, 118, 0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();

  return {
    data: ctx.getImageData(0, 0, size, size),
    options: { pixelRatio },
  };
}

function createPeakStarIcon() {
  const pixelRatio = 2;
  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const center = size / 2;
  const outer = 18;
  const inner = 8.2;
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + i * Math.PI / 5;
    const x = center + Math.cos(angle) * radius;
    const y = center + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(93, 108, 118, 0.75)';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.fill();
  ctx.stroke();

  return {
    data: ctx.getImageData(0, 0, size, size),
    options: { pixelRatio },
  };
}

function createGeneratedStyleImage(id) {
  if (id === 'xplore-peak-red-mountain') return createPeakRedMountainIcon();
  if (id === 'xplore-peak-star') return createPeakStarIcon();
  if (id === 'xplore-peak-label-frame') return createPeakLabelFrameImage();
  if (id === 'xplore-peak-name-pill') {
    return createStretchablePillImage({
      fill: 'rgba(255, 255, 255, 0.96)',
      stroke: { color: 'rgba(33, 45, 55, 0.16)', width: 2 },
      shadow: { color: 'rgba(0, 0, 0, 0.16)', blur: 8, offsetY: 2 },
    });
  }
  if (id === 'xplore-peak-elevation-pill') {
    return createStretchablePillImage({
      fill: 'rgba(53, 188, 207, 0.96)',
      stroke: { color: 'rgba(255, 255, 255, 0.58)', width: 1.5 },
      shadow: { color: 'rgba(0, 0, 0, 0.14)', blur: 7, offsetY: 2 },
    });
  }
  if (id === 'xplore-peak-leader') return createPeakLeaderImage();
  return null;
}

function createCartesFallbackImage(id) {
  if (id === 'cartesapp-triangle') {
    return makeCanvasImage(32, (ctx, size) => {
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.moveTo(size * 0.5, size * 0.12);
      ctx.lineTo(size * 0.88, size * 0.84);
      ctx.lineTo(size * 0.12, size * 0.84);
      ctx.closePath();
      ctx.fill();
    });
  }
  if (id === 'cartesapp-cliff' || id === 'cartesapp-arete') {
    return makeCanvasImage(32, (ctx, size) => {
      ctx.strokeStyle = id === 'cartesapp-cliff' ? '#5b6472' : '#7c6f64';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(size * 0.2, size * 0.74);
      ctx.lineTo(size * 0.44, size * 0.24);
      ctx.lineTo(size * 0.8, size * 0.74);
      ctx.stroke();
    });
  }
  if (id === 'cartesapp-stone') {
    return makeCanvasImage(24, (ctx, size) => {
      ctx.fillStyle = '#827a70';
      ctx.beginPath();
      ctx.moveTo(size * 0.5, size * 0.14);
      ctx.lineTo(size * 0.86, size * 0.5);
      ctx.lineTo(size * 0.5, size * 0.86);
      ctx.lineTo(size * 0.14, size * 0.5);
      ctx.closePath();
      ctx.fill();
    });
  }
  if (id === 'cartesapp-oneway') {
    return makeCanvasImage(24, (ctx, size) => {
      ctx.fillStyle = '#4f88c7';
      ctx.beginPath();
      ctx.moveTo(size * 0.18, size * 0.38);
      ctx.lineTo(size * 0.62, size * 0.38);
      ctx.lineTo(size * 0.62, size * 0.22);
      ctx.lineTo(size * 0.88, size * 0.5);
      ctx.lineTo(size * 0.62, size * 0.78);
      ctx.lineTo(size * 0.62, size * 0.62);
      ctx.lineTo(size * 0.18, size * 0.62);
      ctx.closePath();
      ctx.fill();
    });
  }
  if (id === 'bicycle') {
    return makeCanvasImage(28, (ctx, size) => {
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(size * 0.28, size * 0.68, size * 0.17, 0, Math.PI * 2);
      ctx.arc(size * 0.72, size * 0.68, size * 0.17, 0, Math.PI * 2);
      ctx.moveTo(size * 0.28, size * 0.68);
      ctx.lineTo(size * 0.46, size * 0.42);
      ctx.lineTo(size * 0.58, size * 0.68);
      ctx.lineTo(size * 0.4, size * 0.68);
      ctx.lineTo(size * 0.72, size * 0.68);
      ctx.stroke();
    });
  }
  if (/^(road|exit|[a-z]+_road|[a-z]+)_[0-9]+$/.test(id)) {
    return makeCanvasImage(32, (ctx, size) => {
      const x = size * 0.12, y = size * 0.25, w = size * 0.76, h = size * 0.5, r = 5;
      ctx.fillStyle = '#f8fafc';
      ctx.strokeStyle = '#6b7280';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });
  }
  return null;
}

function addAsyncStyleImage(map, id, url, pendingImages, options = {}) {
  if (!url || pendingImages.has(id) || map.hasImage(id)) return true;
  pendingImages.add(id);
  rasterizeCartesSvg(url, id, options.size)
    .then(({ data, options: imageOptions }) => {
      pendingImages.delete(id);
      if (map.hasImage(id)) return;
      try {
        map.addImage(id, data, imageOptions);
        if (typeof map.triggerRepaint === 'function') map.triggerRepaint();
      } catch (error) {
        console.warn(`[Basemap] Failed to add style image ${id}:`, error);
      }
    })
    .catch(() => {
      pendingImages.delete(id);
      if (map.hasImage(id)) return;
      try {
        map.addImage(id, createCartesFallbackImage(id) || TRANSPARENT_IMAGE, { pixelRatio: CARTES_RASTER_PIXEL_RATIO });
      } catch (error) {
        console.warn(`[Basemap] Failed to add fallback style image ${id}:`, error);
      }
    });
  return true;
}

function styleUsesNotoFonts(style) {
  const layers = Array.isArray(style?.layers) ? style.layers : [];
  const hasNoto = (value) => {
    if (typeof value === 'string') return value.includes('Noto Sans');
    if (Array.isArray(value)) return value.some(hasNoto);
    if (value && typeof value === 'object') return Object.values(value).some(hasNoto);
    return false;
  };
  return layers.some((layer) => hasNoto(layer?.layout?.['text-font']));
}

// ═══════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════

async function init() {
  // ── 1. Create Map ──
  const { map } = await createMap();
  const shadowV3DebugOverlay = initShadowV3DebugOverlay(map);
  window.ShadowV3DebugOverlay = shadowV3DebugOverlay;

  // ── 2. Contours are shader-based (terrain_program.ts reads window.imageryState) ──

  // ── 3. Terrain analysis defaults ──
  initTerrainAnalysisConfig();

  // ── 4. View-mode controller & Shadow controller ──
  const vignetteEl = document.querySelector('.vignette');
  const viewToggleBtn = document.getElementById('toggle3D');

  const viewModeController = createViewModeController(map, {
    toggleButton: viewToggleBtn,
    vignetteElement: vignetteEl,
    skySettings: SKY_SETTINGS,
    defaultMode: VIEW_MODES.TWOD,
    defaultOrientation: DEFAULT_3D_ORIENTATION,
    terrainSourceId: 'terrainSource',
    hdSources: ['terrainSource', 'hillshadeSource', 'reliefDem'],
  });

  window.viewModeController = viewModeController;

  const shadowCtrl = createShadowController(map, { viewModeController });

  // ── 5. Imagery manager ──
  const { overlay: baseStyleOverlayLayerIds, fills: baseStyleFillLayerIds, underlay: baseStyleUnderlayLayerIds } = getBaseStyleLayerBuckets();

  const imagery = createImageryManager(map, {
    baseStyleOverlayLayerIds,
    baseStyleUnderlayLayerIds,
    baseStyleFillLayerIds,
    viewModeController,
    shadowController: shadowCtrl,
    updateAnalyticalLegends: () => renderAnalyticalLegends(map, imagery.imageryState, shadowCtrl.updateShadowTime),
  });

  // ── 5b. Wikimedia Photos ──
  initializeWikimediaPhotos(map, { enabled: false });
  window.xplorePeakLabelMarkers = initPeakLabelMarkers(map);

  // ── 6. Routing orchestrator ──
  const routing = createRoutingOrchestrator(map);

  // ── 7. GPX state ──
  const EMPTY_COLLECTION = { type: 'FeatureCollection', features: [] };
  let currentGpxData = EMPTY_COLLECTION;
  let directionsExportData = EMPTY_COLLECTION;
  let directionsSegmentExports = [];

  const ensureFeatureCollection = (geojson) => {
    if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) return EMPTY_COLLECTION;
    return { type: 'FeatureCollection', features: geojson.features.filter(Boolean) };
  };

  const buildCombinedExportData = () => {
    const features = [];
    [currentGpxData, directionsExportData].forEach(c => {
      if (!c || c.type !== 'FeatureCollection') return;
      (c.features || []).forEach(f => { if (f) features.push(f); });
    });
    return { type: 'FeatureCollection', features };
  };

  const cloneFeature = (feature) => {
    if (!feature) return null;
    try { if (typeof structuredClone === 'function') return structuredClone(feature); } catch (_) { }
    try { return JSON.parse(JSON.stringify(feature)); } catch (_) { return null; }
  };

  const slugify = (value) => {
    if (typeof value !== 'string') return 'segment';
    const s = value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s || 'segment';
  };

  const applyGpxData = (geojson, { fitBounds = false } = {}) => {
    currentGpxData = ensureFeatureCollection(geojson);
    const apply = () => {
      ensureGpxLayers(map, currentGpxData);
      if (fitBounds && currentGpxData.features.length) zoomToGeojson(map, currentGpxData);
    };
    if (typeof map.isStyleLoaded === 'function' && !map.isStyleLoaded()) map.once('style.load', apply);
    else apply();
  };
  applyGpxData(EMPTY_COLLECTION);

  // ── 8. Style image missing handler ──
  const pendingStyleImages = new Set();
  map.on('styleimagemissing', (e) => {
    if (map.hasImage(e.id)) return;
    const generatedImage = createGeneratedStyleImage(e.id);
    if (generatedImage) {
      map.addImage(e.id, generatedImage.data, generatedImage.options);
      return;
    }
    const cartesIconUrl = getCartesIconUrl(e.id);
    if (cartesIconUrl) {
      addAsyncStyleImage(map, e.id, cartesIconUrl, pendingStyleImages);
      return;
    }
    map.addImage(e.id, createCartesFallbackImage(e.id) || TRANSPARENT_IMAGE, { pixelRatio: 2 });
  });

  // ── 9. Overlay wiring ──
  const getOverlayDeps = () => ({
    imageryState: imagery.imageryState,

    applyImageryState: imagery.applyImageryState,
    updateImageryControlStates: imagery.updateImageryControlStates,
    applyImageryLayerOrder: imagery.applyImageryLayerOrder,
    ensureGpxLayers,
    currentGpxData,
    debugNetworkVisible: routing.debugNetworkVisible,
    bringDebugNetworkToFront: routing.bringDebugNetworkToFront,
    viewModeController,
  });

  map.on('style.load', () => {
    applyOverlays(map, getOverlayDeps());
    // Re-apply contour state after overlays create the layers
    const contState = imagery.imageryState.get('contours');
    if (contState) {
      imagery.applyImageryState();
    }
    // Restore layers destroyed by setStyle
    restoreWikimediaLayers();
    initContours(map);
    // Ensure route layers stay above imagery after overlays are rebuilt
    if (directionsManager && typeof directionsManager.markRouteLayersDirty === 'function') {
      directionsManager.markRouteLayersDirty();
      directionsManager.moveRouteLayersToTop();
    }
  });
  map.once('style.load', () => applyHillshadeAppearance(map));
  map.once('style.load', () => {
    initContours(map);
  });
  map.once('style.load', () => {
    if (viewModeController && typeof viewModeController.applyCurrentMode === 'function') {
      viewModeController.applyCurrentMode({ animate: false });
    }
  });

  // ── 10. DOM references for DirectionsManager ──
  const directionsToggle = document.getElementById('directionsToggle');
  const directionsDock = document.getElementById('directionsDock');
  const directionsControl = document.getElementById('directionsControl');
  const transportModes = document.querySelectorAll('.route-mode-btn');
  const swapButton = document.getElementById('swapDirectionsButton');
  const undoButton = document.getElementById('undoDirectionsButton');
  const redoButton = document.getElementById('redoDirectionsButton');
  const clearButton = document.getElementById('clearDirectionsButton');
  const routeStats = document.getElementById('routeStats');
  const routeTimeline = document.getElementById('routeTimeline');
  const elevationCard = document.getElementById('elevationCard');
  const elevationChartBody = document.getElementById('elevationChartBody');
  const elevationChart = document.getElementById('elevationChart');
  const elevationCollapseToggle = document.getElementById('elevationCollapseToggle');
  const profileModeToggle = document.getElementById('profileModeToggle');
  const profileModeMenu = document.getElementById('profileModeMenu');
  const profileLegend = document.getElementById('profileLegend');

  // ── 11. DirectionsManager setup (on map load) ──
  let directionsManager = null;

  map.on('load', async () => {
    // Terrain hover readout
    setupTerrainHoverInfo(map, imagery.imageryState);

    try {
      directionsManager = new DirectionsManager(map, [
        directionsToggle, directionsDock, directionsControl, transportModes,
        swapButton, undoButton, redoButton, clearButton,
        routeStats, routeTimeline, elevationCard, elevationChartBody,
        elevationChart, elevationCollapseToggle, profileModeToggle,
        profileModeMenu, profileLegend,
      ], {
        router: routing.offlineRouter,
        deferRouterInitialization: true,
      });

      routing.directionsManager = directionsManager;

      // Route Library
      const routeLibraryManager = new RouteLibraryManager();
      const routeLibraryUI = new RouteLibraryUI(routeLibraryManager, directionsManager);
      directionsManager.routeLibraryManager = routeLibraryManager;

      console.log('[App] DirectionsManager initialized:', directionsManager);

      // Set initial router
      const initialRouter = routing.routers[routing.activeRouterKey] ?? routing.offlineRouter;
      if (typeof directionsManager.setRouter === 'function') {
        const deferEnsureReady = initialRouter === routing.offlineRouter
          && (!Array.isArray(directionsManager.waypoints) || directionsManager.waypoints.length === 0);
        directionsManager.setRouter(initialRouter, { deferEnsureReady });
      }
      if (typeof directionsManager.setOfflinePointsOfInterest === 'function') {
        directionsManager.setOfflinePointsOfInterest(routing.offlineNetworkPois);
      }

      // Route segment listener
      directionsManager.setRouteSegmentsListener((payload) => {
        const isObject = payload && typeof payload === 'object';
        const dataset = isObject && payload.full ? payload.full : payload;
        directionsExportData = ensureFeatureCollection(dataset);
        const segments = isObject && Array.isArray(payload.segments) ? payload.segments : [];
        directionsSegmentExports = segments
          .map((entry) => {
            const collection = ensureFeatureCollection(entry?.collection);
            if (!collection.features?.length) return null;
            const name = typeof entry?.name === 'string' && entry.name.trim().length ? entry.name.trim() : null;
            return { name, index: Number.isInteger(entry?.index) ? entry.index : null, collection };
          })
          .filter(Boolean);
      });

      // Clear directions → clear GPX layer
      directionsManager.setClearDirectionsListener(() => {
        currentGpxData = EMPTY_COLLECTION;
        ensureGpxLayers(map, currentGpxData);
      });

      // Network preparation callback
      directionsManager.setNetworkPreparationCallback(async ({ waypoints }) => {
        if (routing.activeRouterKey !== 'offline') return;
        const coords = Array.isArray(waypoints) ? waypoints : [];
        if (coords.length) {
          try { await routing.offlineRouter.ensureReady(); } catch (e) {
            console.warn('Offline router init failed', e);
          }
        }
        const bounds = routing.computeCoordinateBounds(coords);

        const lacksWaypointCoverage = () => {
          if (!coords.length) return false;
          return routing.shouldRefreshOfflineNetwork();
        };
        const lacksMapCoverage = () => {
          if (coords.length) return false;
          return routing.shouldRefreshOfflineNetwork();
        };

        if (lacksWaypointCoverage() || lacksMapCoverage()) {
          try { await routing.refreshOfflineNetwork({ waypointBounds: bounds }); }
          catch (e) { console.warn('Deferred offline network refresh failed', e); }
        }
      });
    } catch (error) {
      console.error('Failed to initialize directions manager', error);
    }
  });

  // ── 12. Routing toggle click handlers ──
  const routingModeToggle = document.getElementById('routingModeToggle');
  const routingModeIcon = routingModeToggle?.querySelector('.routing-mode-toggle__icon');

  const setActiveRouter = async (targetKey, { reroute = false } = {}) => {
    if (!routing.routers[targetKey]) {
      console.warn(`Router "${targetKey}" unavailable; keeping ${routing.activeRouterKey}`);
      routing.updateRoutingModeToggle();
      routing.updateDebugNetworkAvailability();
      return;
    }
    if (targetKey === routing.activeRouterKey) {
      routing.updateRoutingModeToggle();
      routing.updateDebugNetworkAvailability();
      if (reroute && directionsManager?.waypoints?.length >= 2) {
        directionsManager.getRoute();
      }
      return;
    }
    if (routingModeToggle) routingModeToggle.disabled = true;
    routing.activeRouterKey = targetKey;
    routing.updateRoutingModeToggle();
    routing.updateDebugNetworkAvailability();
    try {
      if (targetKey !== 'offline') {
        if (routing.debugNetworkVisible) {
          routing.hideDebugNetworkLayer();
          routing.debugNetworkVisible = false;
        }
        routing.updateDebugNetworkControlState(false);
      }
      if (directionsManager && typeof directionsManager.setRouter === 'function') {
        const waypointCount = Array.isArray(directionsManager.waypoints) ? directionsManager.waypoints.length : 0;
        const deferEnsureReady = targetKey === 'offline' && waypointCount === 0;
        directionsManager.setRouter(routing.routers[targetKey], { reroute, deferEnsureReady });
      }
    } finally {
      if (routingModeToggle) routingModeToggle.disabled = false;
      routing.updateRoutingModeToggle();
      routing.updateDebugNetworkAvailability();
    }
  };

  const switchRoutingMode = (key, { reroute = true } = {}) =>
    setActiveRouter(key, { reroute }).catch(e => console.error('Failed to switch routing mode', e));

  if (routingModeToggle) {
    routingModeToggle.addEventListener('click', () => {
      switchRoutingMode(routing.activeRouterKey === 'offline' ? 'online' : 'offline');
    });
  }
  if (routingModeIcon) {
    routingModeIcon.addEventListener('click', (e) => {
      if (routing.activeRouterKey !== 'offline') return;
      e.stopPropagation();
      switchRoutingMode('online');
    });
  }

  // ── 13. Debug network checkbox ──
  const debugNetworkCheckbox = document.getElementById('debugNetworkCheckbox');
  if (debugNetworkCheckbox) {
    routing.updateDebugNetworkControlState(false);
    debugNetworkCheckbox.addEventListener('change', async () => {
      if (routing.activeRouterKey !== 'offline') { routing.updateDebugNetworkControlState(false); return; }
      const target = debugNetworkCheckbox.checked;
      debugNetworkCheckbox.disabled = true;
      try {
        if (target) {
          let applied = await routing.applyDebugNetworkLayer();
          if (!applied) { await routing.refreshOfflineNetwork(); applied = await routing.applyDebugNetworkLayer(); }
          if (!applied) Toast.error('Unable to display routing network.');
          routing.debugNetworkVisible = applied;
        } else {
          routing.hideDebugNetworkLayer();
          routing.debugNetworkVisible = false;
        }
      } catch (e) { console.error('Failed to toggle routing network overlay', e); }
      finally {
        debugNetworkCheckbox.disabled = false;
        routing.updateDebugNetworkControlState(routing.debugNetworkVisible);
      }
    });
  }

  // ── 14. GPX import / export (inline — segment-aware) ──
  const gpxImportButton = document.getElementById('gpxImportButton');
  const gpxFileInput = document.getElementById('gpxFileInput');
  const gpxExportButton = document.getElementById('gpxExportButton');

  if (gpxImportButton && gpxFileInput) {
    gpxImportButton.addEventListener('click', () => {
      gpxFileInput.click();
    });
    gpxFileInput.addEventListener('change', async () => {
      const file = gpxFileInput.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const geojson = parseGpxToGeoJson(text);
        if (!geojson?.features?.length) {
          Toast.info('No GPX features found.');
        } else {
          applyGpxData(geojson, { fitBounds: true });
          if (directionsManager?.importRouteFromGeojson) {
            if (!directionsManager.importRouteFromGeojson(geojson)) {
              console.warn('Unable to init routing from imported GPX');
            }
          }
        }
      } catch (e) {
        console.error('Failed to import GPX', e);
        Toast.error('Unable to load GPX file.');
      } finally { gpxFileInput.value = ''; }
    });
  }

  if (gpxExportButton) {
    gpxExportButton.addEventListener('click', () => {
      const dataset = buildCombinedExportData();
      if (!dataset.features?.length) { Toast.info('No GPX data to export.'); return; }
      try {
        const downloadGpx = (content, filename) => {
          const blob = new Blob([content], { type: 'application/gpx+xml' });
          const url = URL.createObjectURL(blob);
          const a = Object.assign(document.createElement('a'), { href: url, download: filename });
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 0);
        };
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const base = `xploremap-${ts}`;
        const segs = (directionsSegmentExports || []).filter(e => e?.collection?.features?.length);
        if (segs.length) {
          segs.forEach((entry, i) => {
            try {
              const feats = [];
              (currentGpxData.features || []).forEach(f => { const c = cloneFeature(f); if (c) feats.push(c); });
              (entry.collection.features || []).forEach(f => { const c = cloneFeature(f); if (c) feats.push(c); });
              if (!feats.length) return;
              const label = entry.name ? slugify(entry.name) : `segment-${String(i + 1).padStart(2, '0')}`;
              downloadGpx(geojsonToGpx({ type: 'FeatureCollection', features: feats }), `${base}-${String(i + 1).padStart(2, '0')}-${label}.gpx`);
            } catch (e) { console.error('Segment GPX export failed', e); }
          });
          return;
        }
        downloadGpx(geojsonToGpx(dataset), `${base}.gpx`);
      } catch (e) { console.error('GPX export failed', e); Toast.error('Unable to export GPX data.'); }
    });
  }

  // ── 15. Settings panel (cog button) ──
  const settingsToggle = document.getElementById('settingsToggle');
  const settingsPanel = document.getElementById('settingsPanel');
  const settingsPanelClose = document.getElementById('settingsPanelClose');

  const setSettingsPanelOpen = (open) => {
    if (!settingsPanel || !settingsToggle) return;
    settingsPanel.classList.toggle('settings-panel--open', open);
    settingsPanel.setAttribute('aria-hidden', String(!open));
    settingsToggle.setAttribute('aria-expanded', String(open));
  };

  if (settingsToggle && settingsPanel) {
    settingsToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = settingsPanel.classList.contains('settings-panel--open');
      setSettingsPanelOpen(!isOpen);
    });
    if (settingsPanelClose) settingsPanelClose.addEventListener('click', () => setSettingsPanelOpen(false));
    document.addEventListener('click', (e) => {
      if (!settingsPanel.classList.contains('settings-panel--open')) return;
      if (settingsPanel.contains(e.target) || settingsToggle.contains(e.target)) return;
      setSettingsPanelOpen(false);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setSettingsPanelOpen(false); });
  }

  // ── Settings: Performance controls ──
  const fovSlider = document.getElementById('fovSlider');
  const fovLabel = document.getElementById('fovLabel');
  const lodMaxZoomSlider = document.getElementById('lodMaxZoomSlider');
  const lodMaxZoomLabel = document.getElementById('lodMaxZoomLabel');
  const lodTileRatioSlider = document.getElementById('lodTileRatioSlider');
  const lodTileRatioLabel = document.getElementById('lodTileRatioLabel');
  const dprToggle = document.getElementById('dprToggle');

  if (dprToggle) {
    dprToggle.checked = localStorage.getItem('xplore_dpr_enabled') !== 'false';
    dprToggle.addEventListener('change', async () => {
      localStorage.setItem('xplore_dpr_enabled', dprToggle.checked);
      const confirmed = await Modal.confirm({
        title: 'Reload Required',
        message: 'Changing resolution requires a reload. Reload now?',
        confirmText: 'Reload',
        confirmClass: 'modal-btn--primary'
      });
      if (confirmed) window.location.reload();
    });
  }

  if (fovSlider && fovLabel) {
    const updateFov = () => {
      const deg = parseInt(fovSlider.value, 10);
      fovLabel.textContent = `${deg}°`;
      if (map && typeof map.setVerticalFieldOfView === 'function') map.setVerticalFieldOfView(deg);
    };
    fovSlider.addEventListener('input', updateFov);
    updateFov();
  }

  const terrainDemSourceIds = new Set(['terrainSource', 'hillshadeSource', 'reliefDem']);
  const clearTerrainDemLodOverrides = () => {
    const tileManagers = map?.style?.tileManagers;
    if (!tileManagers) return;
    terrainDemSourceIds.forEach(sourceId => {
      const source = tileManagers[sourceId]?.getSource?.();
      if (source && Object.prototype.hasOwnProperty.call(source, 'calculateTileZoom')) {
        delete source.calculateTileZoom;
      }
    });
  };

  const updateLodParams = () => {
    if (!map || typeof map.setSourceTileLodParams !== 'function') return;
    const maxZoom = lodMaxZoomSlider ? parseInt(lodMaxZoomSlider.value, 10) : 5;
    const tileRatio = lodTileRatioSlider ? parseFloat(lodTileRatioSlider.value) : 1;
    const tileManagers = map.style?.tileManagers;
    if (tileManagers) {
      Object.keys(tileManagers).forEach(sourceId => {
        if (terrainDemSourceIds.has(sourceId)) return;
        try { map.setSourceTileLodParams(maxZoom, tileRatio, sourceId); } catch (_) { }
      });
    }
    clearTerrainDemLodOverrides();
    if (lodMaxZoomLabel) lodMaxZoomLabel.textContent = String(maxZoom);
    if (lodTileRatioLabel) lodTileRatioLabel.textContent = tileRatio.toFixed(1);
  };

  if (lodMaxZoomSlider) lodMaxZoomSlider.addEventListener('input', updateLodParams);
  if (lodTileRatioSlider) lodTileRatioSlider.addEventListener('input', updateLodParams);
  updateLodParams();
  map.on('style.load', () => window.requestAnimationFrame(updateLodParams));

  // ── Settings: Debug controls ──
  const debugModeToggle = document.getElementById('debugModeToggle');
  const debugOptions = document.getElementById('debugOptions');
  const debugLayersToggle = document.getElementById('debugLayersToggle');
  const debugNetworkToggle = document.getElementById('debugNetworkToggle');
  const debugShadowTunerToggle = document.getElementById('debugShadowTunerToggle');
  const debugShadowV3AtlasToggle = document.getElementById('debugShadowV3AtlasToggle');
  const debugTileBordersToggle = document.getElementById('debugTileBordersToggle');

  const setDebugOptionsOpen = (open) => {
    if (!debugOptions) return;
    debugOptions.classList.toggle('settings-panel__debug-options--open', open);
    debugOptions.setAttribute('aria-hidden', String(!open));
  };

  if (debugModeToggle) {
    debugModeToggle.checked = Boolean(window.XploreDebug);
    setDebugOptionsOpen(debugModeToggle.checked);
    debugModeToggle.addEventListener('change', () => {
      window.XploreDebug = debugModeToggle.checked;
      localStorage.setItem('xplore_debug', debugModeToggle.checked ? '1' : '0');
      setDebugOptionsOpen(debugModeToggle.checked);
      // When debug mode is turned off, also disable all debug sub-options
      if (!debugModeToggle.checked) {
        if (debugLayersToggle?.checked) { debugLayersToggle.checked = false; debugLayersToggle.dispatchEvent(new Event('change')); }
        if (debugTileBordersToggle?.checked) { debugTileBordersToggle.checked = false; debugTileBordersToggle.dispatchEvent(new Event('change')); }
        if (debugNetworkToggle?.checked) { debugNetworkToggle.checked = false; debugNetworkToggle.dispatchEvent(new Event('change')); }
        if (debugShadowTunerToggle?.checked) { debugShadowTunerToggle.checked = false; debugShadowTunerToggle.dispatchEvent(new Event('change')); }
        if (debugShadowV3AtlasToggle?.checked) { debugShadowV3AtlasToggle.checked = false; debugShadowV3AtlasToggle.dispatchEvent(new Event('change')); }
      }
      console.log(`[Settings] Debug mode ${debugModeToggle.checked ? 'enabled' : 'disabled'}`);
    });
  }

  // Debug sub-option: Debug Tiles overlay (self-contained, bypasses imagery system)
  if (debugLayersToggle) {
    debugLayersToggle.addEventListener('change', () => {
      if (!map) return;
      if (debugLayersToggle.checked) {
        // Create source + layer on first use
        if (!map.getSource('debug-tiles')) {
          map.addSource('debug-tiles', {
            type: 'raster',
            url: 'https://demotiles.maplibre.org/debug-tiles/number/tiles.json',
            tileSize: 256,
            maxzoom: 19
          });
        }
        if (!map.getLayer('debug-tiles')) {
          map.addLayer({ id: 'debug-tiles', type: 'raster', source: 'debug-tiles', paint: { 'raster-opacity': 0.7 } });
        }
        map.setLayoutProperty('debug-tiles', 'visibility', 'visible');
      } else {
        if (map.getLayer('debug-tiles')) {
          map.setLayoutProperty('debug-tiles', 'visibility', 'none');
        }
      }
    });
  }

  // Debug sub-option: Network Visualization
  if (debugNetworkToggle) {
    debugNetworkToggle.addEventListener('change', () => {
      const checkbox = document.getElementById('debugNetworkCheckbox');
      if (checkbox) {
        checkbox.checked = debugNetworkToggle.checked;
        checkbox.dispatchEvent(new Event('change'));
      }
    });
  }

  // Debug sub-option: Shadow Tuner
  if (debugShadowTunerToggle) {
    debugShadowTunerToggle.addEventListener('change', () => {
      if (debugShadowTunerToggle.checked && typeof window.ShadowTuner !== 'undefined') {
        try { new window.ShadowTuner(map); } catch (e) { console.warn('[Settings] ShadowTuner init failed:', e); }
      }
    });
  }

  // Debug sub-option: Tile Borders
  if (debugTileBordersToggle) {
    debugTileBordersToggle.addEventListener('change', () => {
      if (map) {
        map.showTileBoundaries = debugTileBordersToggle.checked;
      }
    });
  }


  // ═════════════════════════════════════════════════════════════════════
  // IMAGERY PANEL DOM RENDERING (inline per user request)
  // ═════════════════════════════════════════════════════════════════════
  // 14. TOOLBOX-BASED LAYER PANEL
  // ═════════════════════════════════════════════════════════════════════

  // ── Toolbox DOM references ──
  const toolboxes = {
    shadow: { toggle: document.getElementById('shadowToolboxToggle'), box: document.getElementById('shadowToolbox') },
    terrain: { toggle: document.getElementById('terrainToolboxToggle'), box: document.getElementById('terrainToolbox') },
    snow: { toggle: document.getElementById('snowToolboxToggle'), box: document.getElementById('snowToolbox') },
    basemap: { toggle: document.getElementById('basemapToolboxToggle'), box: document.getElementById('basemapToolbox') },
    pathway: { toggle: document.getElementById('pathwayToolboxToggle'), box: document.getElementById('pathwayToolbox') },
    photos: { toggle: document.getElementById('photosToolboxToggle'), box: null },
  };

  // ── Generic toolbox open/close helper ──
  const setToolboxOpen = (name, open) => {
    const tb = toolboxes[name];
    if (!tb?.toggle || !tb?.box) return;
    tb.box.classList.toggle('visible', open);
    tb.box.setAttribute('aria-hidden', String(!open));
    tb.toggle.setAttribute('aria-expanded', String(open));
    tb.toggle.classList.toggle('active', open);
    // Close all OTHER toolboxes when opening one
    if (open) {
      Object.keys(toolboxes).forEach(k => { if (k !== name) setToolboxOpen(k, false); });
      setSettingsPanelOpen(false);
    }
  };

  // Wire click + outside-click for each toolbox
  if (toolboxes.shadow.toggle && toolboxes.shadow.box) {
    toolboxes.shadow.toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      setToolboxOpen('shadow', toolboxes.shadow.box.getAttribute('aria-hidden') === 'true');
    });
  }
  if (toolboxes.terrain.toggle && toolboxes.terrain.box) {
    toolboxes.terrain.toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      setToolboxOpen('terrain', toolboxes.terrain.box.getAttribute('aria-hidden') === 'true');
    });
  }
  if (toolboxes.snow.toggle && toolboxes.snow.box) {
    toolboxes.snow.toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      setToolboxOpen('snow', toolboxes.snow.box.getAttribute('aria-hidden') === 'true');
    });
  }
  // Wire click + outside-click for basemap toolbox
  if (toolboxes.basemap.toggle && toolboxes.basemap.box) {
    toolboxes.basemap.toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      setToolboxOpen('basemap', !toolboxes.basemap.box.classList.contains('visible'));
    });
    document.addEventListener('click', (e) => {
      if (!toolboxes.basemap.box.classList.contains('visible')) return;
      if (toolboxes.basemap.toggle.contains(e.target) || toolboxes.basemap.box.contains(e.target)) return;
      setToolboxOpen('basemap', false);
    });
  }
  // Wire click + outside-click for pathway toolbox
  if (toolboxes.pathway.toggle && toolboxes.pathway.box) {
    toolboxes.pathway.toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      setToolboxOpen('pathway', !toolboxes.pathway.box.classList.contains('visible'));
    });
    document.addEventListener('click', (e) => {
      if (!toolboxes.pathway.box.classList.contains('visible')) return;
      if (toolboxes.pathway.toggle.contains(e.target) || toolboxes.pathway.box.contains(e.target)) return;
      setToolboxOpen('pathway', false);
    });
  }

  // Wire toolbox handlers into imagery manager (shadow/terrain/snow still use this)
  imagery.setToolboxHandlers({
    setShadowToolboxOpen: (open) => setToolboxOpen('shadow', open),
    setTerrainToolboxOpen: (open) => setToolboxOpen('terrain', open),
    setSnowToolboxOpen: (open) => setToolboxOpen('snow', open),
  });

  // ── Directions sidebar bar ──
  const directionsActionsBar = document.getElementById('directionsActionsBar');
  const updateActionsBarVisibility = () => {
    if (!directionsActionsBar || !directionsControl) return;
    const isControlVisible = directionsControl.classList.contains('visible');
    const isSilent = directionsManager?.isSilentMode;
    const shouldShowBar = isControlVisible && !isSilent;

    directionsActionsBar.classList.toggle('visible', shouldShowBar);
    directionsActionsBar.setAttribute('aria-hidden', String(!shouldShowBar));
  };
  if (directionsDock && directionsActionsBar) {
    if (directionsControl) {
      new MutationObserver((mutations) => {
        mutations.forEach(m => { if (m.attributeName === 'class') updateActionsBarVisibility(); });
      }).observe(directionsControl, { attributes: true, attributeFilter: ['class'] });
    }
    if (directionsToggle) directionsToggle.addEventListener('click', () => setTimeout(updateActionsBarVisibility, 10));
    updateActionsBarVisibility();
  }

  // ═════════════════════════════════════════════════════════════════════
  // 14a. POPULATE EXISTING TOOLBOXES (shadow, terrain, snow)
  // ═════════════════════════════════════════════════════════════════════

  {
    const { SHADOW_TOOLBOX_IDS, TERRAIN_TOOLBOX_IDS, SNOW_TOOLBOX_IDS } = imagery;
    if (toolboxes.shadow.box) toolboxes.shadow.box.textContent = '';
    if (toolboxes.terrain.box) toolboxes.terrain.box.textContent = '';
    if (toolboxes.snow.box) toolboxes.snow.box.textContent = '';

    const SHADOW_MODE_IDS = ['shadow-v3'];
    const disableShadowModes = () => {
      SHADOW_MODE_IDS.forEach((id) => {
        const state = imagery.imageryState.get(id);
        if (state) state.enabled = false;
      });
    };
    const disableSunDurationAddons = () => {
      SUN_DURATION_ADDON_IDS.forEach((id) => {
        const state = imagery.imageryState.get(id);
        if (state) state.enabled = false;
      });
    };
    const enableSunDurationBase = () => {
      const daylightOption = IMAGERY_OPTIONS.find(o => o.id === 'daylight');
      const daylightState = imagery.imageryState.get('daylight');
      disableSunDurationAddons();
      if (daylightState) {
        daylightState.enabled = true;
        if (daylightState.opacity <= 0) daylightState.opacity = typeof daylightOption?.defaultOpacity === 'number' ? daylightOption.defaultOpacity : 1.0;
      }
      disableShadowModes();
    };
    const enableSunDurationAddon = (addonOption, enabled) => {
      const daylightState = imagery.imageryState.get('daylight');
      if (daylightState) daylightState.enabled = false;
      SUN_DURATION_ADDON_IDS.forEach((id) => {
        const state = imagery.imageryState.get(id);
        if (state) state.enabled = false;
      });
      disableShadowModes();
      const addonState = imagery.imageryState.get(addonOption.id);
      if (!addonState) return;
      addonState.enabled = enabled;
      if (enabled && addonState.opacity <= 0) {
        addonState.opacity = typeof addonOption.defaultOpacity === 'number' ? addonOption.defaultOpacity : 1.0;
      }
    };
    const refreshImageryAfterToolboxChange = () => {
      imagery.applyImageryState();
      imagery.updateImageryControlStates();
      imagery.applyImageryLayerOrder();
    };

    IMAGERY_OPTIONS.forEach((option) => {
      if (option.hiddenControl) return;
      const isTerrainToolboxMember = TERRAIN_TOOLBOX_IDS.includes(option.id);
      const isSnowToolboxMember = SNOW_TOOLBOX_IDS.includes(option.id);
      const isShadowToolboxMember = SHADOW_TOOLBOX_IDS.includes(option.id);
      if (!isTerrainToolboxMember && !isSnowToolboxMember && !isShadowToolboxMember) return;
      if (SUN_DURATION_ADDON_IDS.includes(option.id)) return;

      const group = LAYER_GROUP_BY_MEMBER_ID.get(option.id);

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
        ? option.previewImage : imagery.createTilePreviewUrl(option.tileTemplate);
      if (previewUrl) {
        const img = document.createElement('img');
        img.src = previewUrl; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.draggable = false;
        toggleButton.appendChild(img);
      }
      const srLabel = document.createElement('span');
      srLabel.className = 'sr-only'; srLabel.textContent = option.label;
      toggleButton.appendChild(srLabel);

      toggleButton.addEventListener('click', () => {
        toggleButton.blur();
        const cur = imagery.imageryState.get(option.id);
        if (!cur) return;
        const active = Boolean(cur.enabled && cur.opacity > 0);
        const nextEnabled = !active;
        if (group?.exclusive && nextEnabled) {
          group.members.forEach(id => { if (id !== option.id) { const s = imagery.imageryState.get(id); if (s) s.enabled = false; } });
        }
        cur.enabled = nextEnabled;
        if (nextEnabled && cur.opacity <= 0) cur.opacity = typeof option.defaultOpacity === 'number' ? option.defaultOpacity : 1.0;
        if (SHADOW_MODE_IDS.includes(option.id) && nextEnabled) disableSunDurationAddons();
        if (option.id === 'daylight' && nextEnabled) enableSunDurationBase();
        if (option.id === 'daylight' && !nextEnabled) disableSunDurationAddons();
        refreshImageryAfterToolboxChange();
        if (isTerrainToolboxMember) setToolboxOpen('terrain', false);
        if (isSnowToolboxMember) setToolboxOpen('snow', false);
        if (isShadowToolboxMember && option.id !== 'daylight') setToolboxOpen('shadow', false);
      });

      let targetToolbox = toolboxes.terrain.box;
      if (isSnowToolboxMember) targetToolbox = toolboxes.snow.box;
      if (isShadowToolboxMember) targetToolbox = toolboxes.shadow.box;
      let controlContainer = toggleButton;
      if (targetToolbox && option.id === 'daylight') {
        const row = document.createElement('div');
        row.className = 'toolbox-option-row';
        row.appendChild(toggleButton);

        const subMenu = document.createElement('div');
        subMenu.className = 'shadow-sub-menu';
        subMenu.dataset.parentId = option.id;
        SUN_DURATION_ADDON_IDS.forEach((addonId) => {
          const addonOption = IMAGERY_OPTIONS.find(o => o.id === addonId);
          if (!addonOption) return;

          const subButton = document.createElement('button');
          subButton.type = 'button';
          subButton.className = 'shadow-sub-option sub-thumb-btn';
          subButton.dataset.imageryId = addonOption.id;
          subButton.setAttribute('aria-pressed', 'false');
          subButton.setAttribute('title', addonOption.label);
          subButton.setAttribute('aria-label', addonOption.label);

          const label = document.createElement('span');
          label.textContent = addonId === 'sunrise-window' ? 'Sunrise' : 'Sunset';
          subButton.appendChild(label);

          subButton.addEventListener('click', (event) => {
            event.stopPropagation();
            subButton.blur();
            const addonState = imagery.imageryState.get(addonOption.id);
            if (!addonState) return;
            const active = Boolean(addonState.enabled && addonState.opacity > 0);
            enableSunDurationAddon(addonOption, !active);
            refreshImageryAfterToolboxChange();
          });

          subMenu.appendChild(subButton);
          imagery.imageryControls.set(addonOption.id, { container: subButton, button: subButton, slider: null, sliderWrapper: null, isGroupMember: false });
        });
        row.appendChild(subMenu);
        targetToolbox.appendChild(row);
        controlContainer = row;
      } else if (targetToolbox) {
        targetToolbox.appendChild(toggleButton);
      }

      imagery.imageryControls.set(option.id, { container: controlContainer, button: toggleButton, slider: null, sliderWrapper: null, isGroupMember: false });
    });

    imagery.updateImageryControlStates();

    // ─── Shadow Physics (always-on, tied to 3D mode) ───
    // Initialize neighbor flag (always enabled by default for correct geometry)
    window.__shadowUseNeighbors = true;

    // Connect the time slider directly to the modern shadow controller instance
    window.addEventListener('sunTimeChanged', (e) => {
      if (e.detail && e.detail.date) {
        shadowCtrl.updateShadowTime(e.detail.date);
      }
    });
    window._shadowUpdateHook = shadowCtrl.updateShadowTime;
  }

  // ═════════════════════════════════════════════════════════════════════
  // 14b. BASEMAP TOOLBOX (exclusive selection)
  // ═════════════════════════════════════════════════════════════════════

  // Forward reference — assigned in pathway section so basemap can re-apply pathway state
  let reapplyAllPathways = null;

  {
    const basemapBox = toolboxes.basemap.box;
    const basemapToggle = toolboxes.basemap.toggle;

    // Basemap definitions — order matters for display
    // Style cache to avoid re-fetching on repeated switches
    const styleCache = new Map();
    const injectStyleDefaults = (style, sub = null) => {
      style.projection = { type: 'mercator' };
      style.sky = { 'sky-color': '#bcd0e6', 'horizon-color': '#e6effa', 'sky-horizon-blend': 0.5 };
      style.light = { 'anchor': 'map', 'position': [1.5, 90, 80] };
      if (CARTES_STYLE_IDS.has(sub?.id)) {
        style.sprite = CARTES_SPRITE_URL;
      }
      if (CARTES_STYLE_IDS.has(sub?.id) || (/cartes\.app\/fonts\/glyphs/i.test(style.glyphs || '') && styleUsesNotoFonts(style))) {
        style.glyphs = OPENFREEMAP_GLYPHS_URL;
      }
      return style;
    };

    const BASEMAP_OPTIONS = [
      {
        id: 'none',
        label: 'None',
        noBasemap: true,
      },
      {
        id: 'color-relief-only',
        label: 'Color Relief',
        colorReliefOnly: true,
      },
      {
        id: 'vector', label: 'Xplore Outdoor',
        isStyleSwap: true,
        subOptions: [
          { id: 'xplore-outdoor-hybrid-2', label: 'Outdoor Relief WIP', styleUrl: './xplore_outdoor_hybrid-2.json?v=20260525-relief-wip', previewImage: './data/vector-map.svg' },
          { id: 'xplore-outdoor-hybrid', label: 'Xplore Outdoor', styleUrl: './xplore_outdoor_hybrid.json?v=20260523-color-relief-strong', previewImage: './data/vector-map.svg' },
        ],
        previewImage: './data/vector-map.svg',
      },
      {
        id: 'satellite', label: 'Satellite',
        previewImage: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/10/364/526',
        subOptions: [
          { id: 'satellite-ign', label: 'IGN Ortho', layerId: 'ign-orthophotos', previewImage: './data/france.png' },
          { id: 'satellite-eox', label: 'EOX S2', layerId: 'eox-s2', previewImage: './data/worldwide.png' },
        ],
      },
      {
        id: 'lidar-hd', label: 'Lidar HD',
        // Custom handling: tree switches MNT/MNS, leaf toggles forest overlay
        isLidar: true,
      },
      {
        id: 'ign-scan', label: 'IGN Scan',
        layerId: 'ign-scan',
        previewImage: null,
      },
    ];

    // Track active basemap
    let activeBasemapId = 'vector';
    let activeSubOptionId = null;
    let initialStyleLoaded = false;  // Skip setStyle on first activation

    // Lidar HD specific state
    let lidarMode = 'mnt';      // 'mnt' or 'mns'
    let lidarForestOverlay = false;

    // IDs that belong to basemap system (so we can turn them all off)
    const ALL_BASEMAP_LAYER_IDS = [
      'vector-fills',
      'ign-orthophotos', 'eox-s2',
      'ign-cosia', 'ign-lidar-hd-mnt-shadow', 'ign-lidar-hd-mns-shadow',
      'ign-scan', 'ign-forest-inventory',
    ];

    // Activate Lidar HD layers based on current lidar state
    const activateLidarLayers = () => {
      // Enable COSIA base at 0.3 opacity
      const cosiaState = imagery.imageryState.get('ign-cosia');
      if (cosiaState) { cosiaState.enabled = true; cosiaState.opacity = 0.3; }
      // Enable the active variant
      const mntId = 'ign-lidar-hd-mnt-shadow';
      const mnsId = 'ign-lidar-hd-mns-shadow';
      const mntState = imagery.imageryState.get(mntId);
      const mnsState = imagery.imageryState.get(mnsId);
      if (lidarMode === 'mnt') {
        if (mntState) { mntState.enabled = true; mntState.opacity = 1; }
        if (mnsState) { mnsState.enabled = false; }
      } else {
        if (mntState) { mntState.enabled = false; }
        if (mnsState) { mnsState.enabled = true; mnsState.opacity = 1; }
      }
      // Forest overlay
      const forestState = imagery.imageryState.get('ign-forest-inventory');
      if (forestState) {
        forestState.enabled = lidarForestOverlay;
        if (lidarForestOverlay) forestState.opacity = 0.6;
      }
    };

    const deactivateAllBasemapLayers = () => {
      ALL_BASEMAP_LAYER_IDS.forEach(id => {
        const s = imagery.imageryState.get(id);
        if (s) s.enabled = false;
      });
    };

    const setNeutralBackgroundVisible = (visible) => {
      if (!visible) return;
      const vis = 'visible';
      (map.getStyle()?.layers || []).forEach((layer) => {
        if (layer?.type !== 'background') return;
        try { map.setLayoutProperty(layer.id, 'visibility', layer.id === 'terrain-bg' ? vis : 'none'); } catch (_) { }
      });
      if (map.getLayer('terrain-bg')) {
        try {
          map.setPaintProperty('terrain-bg', 'background-color', '#ffffff');
          map.setPaintProperty('terrain-bg', 'background-opacity', 1);
          map.setLayoutProperty('terrain-bg', 'visibility', vis);
        } catch (_) { }
      }
    };

    // Hide/show hillshade + terrain background + all non-overlay vector layers
    const TERRAIN_BG_LAYERS = ['color-relief', 'hillshade', 'hillshade2', 'terrain-bg', 'terrain'];
    const setVectorBaseVisible = (visible, reliefOptions = {}) => {
      const colorReliefVisible = reliefOptions.colorReliefVisible ?? visible;
      const hillshadeVisible = reliefOptions.hillshadeVisible ?? visible;
      const terrainBgVisible = reliefOptions.terrainBgVisible ?? (visible || colorReliefVisible);
      const terrainRasterVisible = reliefOptions.terrainRasterVisible ?? visible;
      window._xploreVectorBaseVisible = Boolean(visible);
      window._xploreColorReliefVisible = Boolean(colorReliefVisible);
      window._xploreColorReliefSolo = Boolean(reliefOptions.colorReliefSolo);
      window.dispatchEvent(new CustomEvent('xplore-vector-base-visible-change', { detail: { visible: Boolean(visible) } }));
      // Hillshade and terrain raster
      TERRAIN_BG_LAYERS.forEach(id => {
        if (map.getLayer(id)) {
          const visibleLayer =
            (id === 'color-relief' && colorReliefVisible) ||
            (id === 'hillshade' && hillshadeVisible) ||
            (id === 'hillshade2' && hillshadeVisible) ||
            (id === 'terrain-bg' && terrainBgVisible) ||
            (id === 'terrain' && terrainRasterVisible);
          try { map.setLayoutProperty(id, 'visibility', visibleLayer ? 'visible' : 'none'); } catch (_) { }
        }
      });
      // All non-overlay base style layers (fills + underlay: water, waterways, parks, etc.)
      const { fills = [], underlay = [] } = getBaseStyleLayerBuckets();
      [...fills, ...underlay].forEach(id => {
        if (map.getLayer(id)) {
          try { map.setLayoutProperty(id, 'visibility', vis); } catch (_) { }
        }
      });
    };

    const activateBasemap = async (basemapId, subOptionId) => {
      deactivateAllBasemapLayers();
      const bm = BASEMAP_OPTIONS.find(b => b.id === basemapId);
      if (!bm) return;

      // Show terrain background + vector fills only for vector basemap
      const colorReliefOnly = Boolean(bm.colorReliefOnly);
      setVectorBaseVisible(basemapId === 'vector', {
        colorReliefVisible: basemapId === 'vector' || colorReliefOnly,
        colorReliefSolo: colorReliefOnly,
        hillshadeVisible: basemapId === 'vector',
        terrainBgVisible: basemapId === 'vector' || colorReliefOnly,
        terrainRasterVisible: basemapId === 'vector',
      });
      setNeutralBackgroundVisible(Boolean(bm.noBasemap));

      if (bm.isStyleSwap && bm.subOptions) {
        // ── Style swap (vector basemap sub-options) ──
        const sub = subOptionId
          ? bm.subOptions.find(s => s.id === subOptionId)
          : bm.subOptions[0];
        if (!subOptionId) subOptionId = sub?.id;

        // Skip style swap on first load — map already has this style from createMap()
        if (initialStyleLoaded) {
          if (sub && sub.styleUrl) {
            try {
              let style = styleCache.get(sub.styleUrl);
              if (!style) {
                style = await fetch(sub.styleUrl, { cache: 'no-store' }).then(r => r.json());
                styleCache.set(sub.styleUrl, style);
              }
              // Deep clone to avoid mutating the cache
              const liveStyle = JSON.parse(JSON.stringify(style));
              injectStyleDefaults(liveStyle, sub);
              parseAndCacheBaseStyleLayers(liveStyle);
              // Inject overlay defs so diff engine keeps DEM/terrain/hillshade intact
              injectOverlaysIntoStyle(liveStyle);
              map.setStyle(liveStyle);
              console.log(`[Basemap] Switched vector style to: ${sub.label}`);
            } catch (err) {
              console.error(`[Basemap] Failed to load style ${sub.styleUrl}:`, err);
            }
          }
        } else {
          initialStyleLoaded = true;
        }

        // Re-enable vector fills + osm features (deactivateAllBasemapLayers turned them off)
        const fillsState = imagery.imageryState.get('vector-fills');
        if (fillsState) { fillsState.enabled = true; fillsState.opacity = 1; }
        const osmState = imagery.imageryState.get('osm-features');
        if (osmState) { osmState.enabled = true; osmState.opacity = 1; }
      } else if (bm.activate) {
        bm.activate();
      } else if (colorReliefOnly) {
        const reliefState = imagery.imageryState.get('color-relief');
        if (reliefState) reliefState.enabled = true;
        const osmState = imagery.imageryState.get('osm-features');
        if (osmState) { osmState.enabled = false; osmState.opacity = 0; }
        const fillsState = imagery.imageryState.get('vector-fills');
        if (fillsState) { fillsState.enabled = false; fillsState.opacity = 0; }
      } else if (bm.isLidar) {
        activateLidarLayers();
      } else if (bm.subOptions && subOptionId) {
        const sub = bm.subOptions.find(s => s.id === subOptionId);
        if (sub) {
          if (sub.layerId) {
            const ls = imagery.imageryState.get(sub.layerId);
            if (ls) { ls.enabled = true; ls.opacity = 1; }
          }
          if (sub.layers) {
            sub.layers.forEach(l => {
              const ls = imagery.imageryState.get(l.id);
              if (ls) { ls.enabled = true; ls.opacity = l.opacity; }
            });
          }
        }
      } else if (bm.layerId) {
        const ls = imagery.imageryState.get(bm.layerId);
        if (ls) { ls.enabled = true; ls.opacity = 1; }
      }

      activeBasemapId = basemapId;
      activeSubOptionId = subOptionId || null;

      // Contours: enabled on Vector and Lidar basemaps only
      const showContours = (basemapId === 'vector' || basemapId === 'lidar-hd');
      const contState = imagery.imageryState.get('contours');
      if (contState) { contState.enabled = showContours; contState.opacity = 1; }

      imagery.applyImageryState();
      imagery.updateImageryControlStates();
      imagery.applyImageryLayerOrder();
      updateBasemapUI();

      // Re-apply pathway state so Routes persist across non-vector basemap switches
      // On Vector basemap, overlay is always shown (part of the full map)
      if (basemapId !== 'vector' && !colorReliefOnly && typeof reapplyAllPathways === 'function') reapplyAllPathways();
    };

    const updateBasemapUI = () => {
      if (!basemapBox) return;
      basemapBox.querySelectorAll('.btn.basemap-toolbox__toggle').forEach(btn => {
        const isActive = btn.dataset.basemapId === activeBasemapId;
        btn.classList.toggle('active', isActive);
      });
      // Update sub-menus (satellite text sub-options + lidar icon actions)
      basemapBox.querySelectorAll('.basemap-sub-menu').forEach(sub => {
        sub.classList.toggle('visible', sub.dataset.parentId === activeBasemapId);
      });
      basemapBox.querySelectorAll('.basemap-sub-option:not(.lidar-action-btn)').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.subId === activeSubOptionId);
      });
      // Lidar action button states
      basemapBox.querySelectorAll('.lidar-tree-btn').forEach(btn => {
        btn.classList.toggle('active', lidarMode === 'mns');
        btn.setAttribute('title', lidarMode === 'mnt' ? 'Switch to MNS (surface)' : 'Switch to MNT (terrain)');
      });
      basemapBox.querySelectorAll('.lidar-leaf-btn').forEach(btn => {
        btn.classList.toggle('active', lidarForestOverlay);
      });
      // Update main toggle thumbnail
      if (basemapToggle) {
        const isNonDefault = activeBasemapId !== 'vector' && activeBasemapId !== 'none';
        basemapToggle.classList.toggle('has-active-layer', isNonDefault);
        let thumb = basemapToggle.querySelector('.map-action-btn__thumb');
        if (!thumb) { thumb = document.createElement('div'); thumb.className = 'map-action-btn__thumb'; basemapToggle.prepend(thumb); }
        if (isNonDefault) {
          const bm = BASEMAP_OPTIONS.find(b => b.id === activeBasemapId);
          let previewUrl = bm?.previewImage || null;
          if (!previewUrl && bm?.layerId) {
            const opt = IMAGERY_OPTIONS.find(o => o.id === bm.layerId);
            previewUrl = opt?.previewImage || (opt?.tileTemplate ? imagery.createTilePreviewUrl(opt.tileTemplate) : null);
          }
          if (!previewUrl && bm?.isLidar) {
            // Show the active lidar variant's preview
            const lidarId = lidarMode === 'mnt' ? 'ign-lidar-hd-mnt-shadow' : 'ign-lidar-hd-mns-shadow';
            const opt = IMAGERY_OPTIONS.find(o => o.id === lidarId);
            previewUrl = opt?.previewImage || (opt?.tileTemplate ? imagery.createTilePreviewUrl(opt.tileTemplate) : null);
          }
          if (!previewUrl && bm?.subOptions) {
            const sub = bm.subOptions.find(s => s.id === activeSubOptionId) || bm.subOptions[0];
            const sid = sub.layerId || (sub.layers ? sub.layers[sub.layers.length - 1].id : null);
            const opt = sid ? IMAGERY_OPTIONS.find(o => o.id === sid) : null;
            previewUrl = opt?.previewImage || (opt?.tileTemplate ? imagery.createTilePreviewUrl(opt.tileTemplate) : null);
          }
          if (previewUrl) { thumb.style.backgroundImage = `url(${previewUrl})`; }
          else { thumb.style.backgroundImage = ''; }
        } else {
          thumb.style.backgroundImage = '';
        }
      }
    };

    // Populate basemap toolbox
    if (basemapBox) {
      basemapBox.textContent = '';
      BASEMAP_OPTIONS.forEach(bm => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn basemap-toolbox__toggle';
        btn.dataset.basemapId = bm.id;
        btn.setAttribute('title', bm.label);
        btn.setAttribute('aria-label', bm.label);

        // Try to get a preview image
        const option = bm.layerId ? IMAGERY_OPTIONS.find(o => o.id === bm.layerId) : null;
        const previewUrl = bm.previewImage || option?.previewImage || (option?.tileTemplate ? imagery.createTilePreviewUrl(option.tileTemplate) : null);
        if (previewUrl) {
          const img = document.createElement('img');
          img.src = previewUrl; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.draggable = false;
          btn.appendChild(img);
        } else {
          // For Lidar HD, try the MNT shadow layer preview
          if (bm.isLidar) {
            const so = IMAGERY_OPTIONS.find(o => o.id === 'ign-lidar-hd-mnt-shadow');
            const url = so?.previewImage || (so?.tileTemplate ? imagery.createTilePreviewUrl(so.tileTemplate) : null);
            if (url) {
              const img = document.createElement('img');
              img.src = url; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.draggable = false;
              btn.appendChild(img);
            }
          }
          // For sub-option groups, try first sub-option's layer
          if (bm.subOptions && !btn.querySelector('img')) {
            const firstSub = bm.subOptions[0];
            const sid = firstSub.layerId || (firstSub.layers ? firstSub.layers[firstSub.layers.length - 1].id : null);
            const so = sid ? IMAGERY_OPTIONS.find(o => o.id === sid) : null;
            const url = so?.previewImage || (so?.tileTemplate ? imagery.createTilePreviewUrl(so.tileTemplate) : null);
            if (url) {
              const img = document.createElement('img');
              img.src = url; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.draggable = false;
              btn.appendChild(img);
            }
          }
          // Fallback: text label
          if (!btn.querySelector('img')) {
            const span = document.createElement('span');
            span.style.cssText = 'font-size:11px;font-weight:600;color:#fff;text-align:center;line-height:1.1;';
            span.textContent = bm.label;
            btn.appendChild(span);
          }
        }

        btn.addEventListener('click', () => {
          if (bm.isLidar) {
            activateBasemap(bm.id, null);
          } else if (bm.subOptions) {
            // If clicking a group with sub-options, activate first sub-option by default
            const defaultSub = bm.subOptions[0];
            activateBasemap(bm.id, defaultSub.id);
          } else {
            activateBasemap(bm.id, null);
            setToolboxOpen('basemap', false);
          }
        });

        // Wrap button + its sub-controls in a horizontal row
        const row = document.createElement('div');
        row.className = 'toolbox-option-row';
        row.appendChild(btn);

        // Create Lidar HD action buttons (tree = MNT/MNS toggle, leaf = forest overlay)
        if (bm.isLidar) {
          const actionsRow = document.createElement('div');
          actionsRow.className = 'basemap-sub-menu lidar-actions';
          actionsRow.dataset.parentId = bm.id;

          // Tree button — toggles MNT ↔ MNS
          const treeBtn = document.createElement('button');
          treeBtn.type = 'button';
          treeBtn.className = 'basemap-sub-option lidar-action-btn lidar-tree-btn';
          treeBtn.setAttribute('title', 'Switch MNT / MNS');
          const treeImg = document.createElement('img');
          treeImg.src = './data/tree.png'; treeImg.alt = 'MNT/MNS'; treeImg.draggable = false;
          treeBtn.appendChild(treeImg);
          treeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            lidarMode = lidarMode === 'mnt' ? 'mns' : 'mnt';
            activateLidarLayers();
            imagery.applyImageryState();
            imagery.updateImageryControlStates();
            updateBasemapUI();
          });
          actionsRow.appendChild(treeBtn);

          // Leaf button — toggles forest inventory overlay
          const leafBtn = document.createElement('button');
          leafBtn.type = 'button';
          leafBtn.className = 'basemap-sub-option lidar-action-btn lidar-leaf-btn';
          leafBtn.setAttribute('title', 'Toggle Forest Inventory');
          const leafImg = document.createElement('img');
          leafImg.src = './data/leaf.png'; leafImg.alt = 'Forest'; leafImg.draggable = false;
          leafBtn.appendChild(leafImg);
          leafBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            lidarForestOverlay = !lidarForestOverlay;
            activateLidarLayers();
            imagery.applyImageryState();
            imagery.updateImageryControlStates();
            updateBasemapUI();
          });
          actionsRow.appendChild(leafBtn);

          row.appendChild(actionsRow);
        }

        // Create sub-option buttons (horizontal) for non-lidar groups
        if (bm.subOptions) {
          const subMenu = document.createElement('div');
          subMenu.className = 'basemap-sub-menu';
          subMenu.dataset.parentId = bm.id;

          bm.subOptions.forEach(sub => {
            const subBtn = document.createElement('button');
            subBtn.type = 'button';
            subBtn.className = 'basemap-sub-option sub-thumb-btn';
            subBtn.dataset.subId = sub.id;
            subBtn.setAttribute('title', sub.label);
            // Resolve preview image from the sub-option's layer
            const sid = sub.layerId || (sub.layers ? sub.layers[sub.layers.length - 1].id : null);
            const subOpt = sid ? IMAGERY_OPTIONS.find(o => o.id === sid) : null;
            const subPreview = subOpt?.previewImage || (subOpt?.tileTemplate ? imagery.createTilePreviewUrl(subOpt.tileTemplate) : null);
            if (subPreview) {
              const img = document.createElement('img');
              img.src = subPreview; img.alt = sub.label; img.loading = 'lazy'; img.decoding = 'async'; img.draggable = false;
              subBtn.appendChild(img);
            } else {
              const span = document.createElement('span');
              span.textContent = sub.label;
              subBtn.appendChild(span);
            }
            subBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              activateBasemap(bm.id, sub.id);
              // Update badge on parent button showing active sub-option
              const parentBtn = basemapBox.querySelector(`[data-basemap-id="${bm.id}"]`);
              const badgeUrl = sub.previewImage || subOpt?.previewImage || null;
              if (parentBtn && badgeUrl) {
                let badge = parentBtn.querySelector('.basemap-badge');
                if (!badge) {
                  badge = document.createElement('img');
                  badge.className = 'basemap-badge';
                  parentBtn.appendChild(badge);
                }
                badge.src = badgeUrl;
                badge.alt = sub.label;
              }
              subMenu.classList.remove('visible');
            });
            subMenu.appendChild(subBtn);
          });

          row.appendChild(subMenu);
        }

        basemapBox.appendChild(row);
      });

      // Initialize: the tuned outdoor relief style is the default vector basemap.
      activateBasemap('vector', 'xplore-outdoor-hybrid-2');
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // 14c. PATHWAY TOOLBOX (independent toggles)
  // ═════════════════════════════════════════════════════════════════════

  {
    const pathwayBox = toolboxes.pathway.box;
    const pathwayToggle = toolboxes.pathway.toggle;

    const PATHWAY_OPTIONS = [
      {
        id: 'routes', label: 'Routes',
        type: 'osm-overlay',
        previewImage: './data/OSM_vector.png',
      },
      {
        id: 'heatmap', label: 'Heatmap', previewImage: './data/fire.png',
        subOptions: [
          { id: 'strava-backcountry-ski', label: 'Backcountry Ski', layerId: 'strava-backcountry-ski', previewImage: './data/ski.png' },
          { id: 'strava-cycling', label: 'Cycling', layerId: 'strava-cycling', previewImage: './data/bike.png' },
          { id: 'strava-run', label: 'Run', layerId: 'strava-run', previewImage: './data/running.png' },
        ],
      },
      {
        id: 'ski-rando', label: 'Ski Rando',
        layerId: 'ign-traces-hivernales',
        previewImage: './data/ski.png',
      },
    ];

    // Track pathway toggle states (routes enabled by default)
    const pathwayState = new Map();
    PATHWAY_OPTIONS.forEach(p => pathwayState.set(p.id, { enabled: p.id === 'routes', activeSubId: null }));

    const applyPathwayOption = (optionId) => {
      const opt = PATHWAY_OPTIONS.find(p => p.id === optionId);
      const state = pathwayState.get(optionId);
      if (!opt || !state) return;

      if (opt.type === 'osm-overlay') {
        // Toggle OSM overlay (routes/paths)
        const osmState = imagery.imageryState.get('osm-features');
        if (osmState) { osmState.enabled = state.enabled; osmState.opacity = state.enabled ? 1 : 0; }
      } else if (opt.subOptions) {
        // Turn off all sub-option layers first
        opt.subOptions.forEach(sub => {
          const ls = imagery.imageryState.get(sub.layerId);
          if (ls) ls.enabled = false;
        });
        if (state.enabled && state.activeSubId) {
          const sub = opt.subOptions.find(s => s.id === state.activeSubId);
          if (sub) {
            const ls = imagery.imageryState.get(sub.layerId);
            if (ls) { ls.enabled = true; ls.opacity = 1; }
          }
        }
      } else if (opt.layerId) {
        const ls = imagery.imageryState.get(opt.layerId);
        if (ls) { ls.enabled = state.enabled; if (state.enabled) ls.opacity = 1; }
      }

      imagery.applyImageryState();
      imagery.updateImageryControlStates();
      imagery.applyImageryLayerOrder();
      updatePathwayUI();
    };

    // Allow basemap switching to re-apply pathway state (Routes persist across basemap changes)
    reapplyAllPathways = () => {
      for (const [id] of pathwayState) {
        applyPathwayOption(id);
      }
    };

    const updatePathwayUI = () => {
      if (!pathwayBox) return;
      pathwayBox.querySelectorAll('.btn.pathway-toolbox__toggle').forEach(btn => {
        const state = pathwayState.get(btn.dataset.pathwayId);
        btn.classList.toggle('active', state?.enabled ?? false);
      });
      // Update sub-menus visibility
      pathwayBox.querySelectorAll('.pathway-sub-menu').forEach(sub => {
        const state = pathwayState.get(sub.dataset.parentId);
        sub.classList.toggle('visible', state?.enabled ?? false);
      });
      pathwayBox.querySelectorAll('.pathway-sub-option').forEach(btn => {
        const parentState = pathwayState.get(btn.dataset.parentId);
        btn.classList.toggle('active', btn.dataset.subId === parentState?.activeSubId);
      });
      // Main toggle thumbnail
      const anyActive = [...pathwayState.values()].some(s => s.enabled);
      if (pathwayToggle) {
        pathwayToggle.classList.toggle('has-active-layer', anyActive);
        let thumb = pathwayToggle.querySelector('.map-action-btn__thumb');
        if (!thumb) { thumb = document.createElement('div'); thumb.className = 'map-action-btn__thumb'; pathwayToggle.prepend(thumb); }
        if (anyActive) {
          // Find first active pathway option's preview
          let previewUrl = null;
          for (const [id, st] of pathwayState.entries()) {
            if (!st.enabled) continue;
            const opt = PATHWAY_OPTIONS.find(p => p.id === id);
            if (opt?.previewImage) { previewUrl = opt.previewImage; break; }
            if (opt?.subOptions && st.activeSubId) {
              const sub = opt.subOptions.find(s => s.id === st.activeSubId);
              const layerOpt = sub?.layerId ? IMAGERY_OPTIONS.find(o => o.id === sub.layerId) : null;
              previewUrl = layerOpt?.previewImage || (layerOpt?.tileTemplate ? imagery.createTilePreviewUrl(layerOpt.tileTemplate) : null);
              if (previewUrl) break;
            }
            if (opt?.layerId) {
              const layerOpt = IMAGERY_OPTIONS.find(o => o.id === opt.layerId);
              previewUrl = layerOpt?.previewImage || (layerOpt?.tileTemplate ? imagery.createTilePreviewUrl(layerOpt.tileTemplate) : null);
              if (previewUrl) break;
            }
          }
          if (previewUrl) { thumb.style.backgroundImage = `url(${previewUrl})`; }
          else { thumb.style.backgroundImage = ''; }
        } else {
          thumb.style.backgroundImage = '';
        }
      }
    };

    if (pathwayBox) {
      pathwayBox.textContent = '';
      PATHWAY_OPTIONS.forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn pathway-toolbox__toggle';
        btn.dataset.pathwayId = opt.id;
        btn.setAttribute('title', opt.label);
        btn.setAttribute('aria-label', opt.label);

        if (opt.previewImage) {
          const img = document.createElement('img');
          img.src = opt.previewImage; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.draggable = false;
          btn.appendChild(img);
        } else {
          const span = document.createElement('span');
          span.style.cssText = 'font-size:11px;font-weight:600;color:#fff;text-align:center;line-height:1.1;';
          span.textContent = opt.label;
          btn.appendChild(span);
        }

        btn.addEventListener('click', () => {
          const state = pathwayState.get(opt.id);
          if (!state) return;
          state.enabled = !state.enabled;
          if (state.enabled && opt.subOptions && !state.activeSubId) {
            state.activeSubId = opt.subOptions[0].id;
          }
          if (!state.enabled) {
            state.activeSubId = null;
            // Remove badge when disabled
            const badge = btn.querySelector('.pathway-badge');
            if (badge) badge.remove();
          }
          applyPathwayOption(opt.id);
        });

        const row = document.createElement('div');
        row.className = 'toolbox-option-row';
        row.appendChild(btn);

        // Sub-options
        if (opt.subOptions) {
          const subMenu = document.createElement('div');
          subMenu.className = 'pathway-sub-menu';
          subMenu.dataset.parentId = opt.id;

          opt.subOptions.forEach(sub => {
            const subBtn = document.createElement('button');
            subBtn.type = 'button';
            subBtn.className = 'pathway-sub-option sub-thumb-btn';
            subBtn.dataset.subId = sub.id;
            subBtn.dataset.parentId = opt.id;
            subBtn.setAttribute('title', sub.label);
            // Resolve preview image: use sub-option's own previewImage first, then fall back to layer lookup
            const subOpt = sub.layerId ? IMAGERY_OPTIONS.find(o => o.id === sub.layerId) : null;
            const subPreview = sub.previewImage || subOpt?.previewImage || (subOpt?.tileTemplate ? imagery.createTilePreviewUrl(subOpt.tileTemplate) : null);
            if (subPreview) {
              const img = document.createElement('img');
              img.src = subPreview; img.alt = sub.label; img.loading = 'lazy'; img.decoding = 'async'; img.draggable = false;
              subBtn.appendChild(img);
            } else {
              const span = document.createElement('span');
              span.textContent = sub.label;
              subBtn.appendChild(span);
            }
            subBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              const parentState = pathwayState.get(opt.id);
              if (!parentState) return;
              parentState.enabled = true;
              parentState.activeSubId = sub.id;
              applyPathwayOption(opt.id);
              // Update badge on parent button
              const parentBtn = pathwayBox.querySelector(`[data-pathway-id="${opt.id}"]`);
              if (parentBtn && sub.previewImage) {
                let badge = parentBtn.querySelector('.pathway-badge');
                if (!badge) {
                  badge = document.createElement('img');
                  badge.className = 'pathway-badge';
                  parentBtn.appendChild(badge);
                }
                badge.src = sub.previewImage;
                badge.alt = sub.label;
              }
              // Close the sub-menu after selection
              subMenu.classList.remove('visible');
            });
            subMenu.appendChild(subBtn);
          });

          row.appendChild(subMenu);
        }

        pathwayBox.appendChild(row);
      });

      updatePathwayUI();
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // 14d. PHOTOS TOOLBOX
  // ═════════════════════════════════════════════════════════════════════

  {
    const photosToggle = toolboxes.photos.toggle;
    const opt = IMAGERY_OPTIONS.find(o => o.id === 'wikimedia-photos');

    if (photosToggle && opt) {
      let photosEnabled = false;

      photosToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        photosEnabled = !photosEnabled;
        const cur = imagery.imageryState.get(opt.id);
        if (cur) {
          cur.enabled = photosEnabled;
          if (photosEnabled && cur.opacity <= 0) cur.opacity = 1;
        }
        photosToggle.classList.toggle('active', photosEnabled);
        imagery.applyImageryState();
        imagery.updateImageryControlStates();
      });
    }
  }

  // ── 16. Shadow Debug Tuner ──
  if (window.XploreDebug && typeof window.ShadowTuner !== 'undefined') {
    window.shadowTuner = new window.ShadowTuner(map);
    window.shadowTuner.toggleUI();
  }
}

// ╔═══════════════════════════════════════════════════════════════════════╗
// ║                          ENTRY POINT                                ║
// ╚═══════════════════════════════════════════════════════════════════════╝
init().catch((error) => {
  console.error('Failed to initialise the map', error);
});
