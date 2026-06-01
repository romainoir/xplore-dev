/**
 * map-init.js — Map creation, style loading, basic controls, preload screen.
 */

import {
    TILE_FADE_DURATION,
} from '../config/map-config.js';
import { initializeGeocoder } from '../map/geocoder-control.js';

const XPLORE_OUTDOOR_STYLE_URL = './xplore_outdoor_hybrid-2.json?v=20260525-relief-wip';
const CARTES_SPRITE_URL = new URL('../../data/cartes-sprite/sprite', import.meta.url).href;

// ─── UI icon images data-icon-id → src ───
const UI_ICON_SOURCES = Object.freeze({
    'view-toggle': './data/2d_3d.png',
    'gpx-import': './data/upload.png',
    'gpx-export': './data/downloads.png',
    'routing-offline': './data/no-wifi.png',
    'routing-online': './data/wifi.png',
    'debug-network': './data/debugg.png'
});

export const ROUTING_ICON_OFFLINE = UI_ICON_SOURCES['routing-offline'];
export const ROUTING_ICON_ONLINE = UI_ICON_SOURCES['routing-online'];

export function applyUiIconSources(root = document) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('img[data-icon-id]').forEach((img) => {
        const hasNativeImageClass = typeof HTMLImageElement !== 'undefined'
            ? img instanceof HTMLImageElement
            : img?.tagName?.toLowerCase() === 'img';
        if (!hasNativeImageClass) return;
        const { iconId } = img.dataset;
        if (!iconId) return;
        const src = UI_ICON_SOURCES[iconId];
        if (!src || img.src === src) return;
        img.src = src;
    });
}

// ─── Peak pointer image ───
const PEAK_POINTER_ID = 'peak-pointer';

function createPeakPointerImage(color = '#3ab7c6') {
    const width = 48, height = 96;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    const centerX = width / 2, topOffset = 8, stemWidth = width * 0.16;
    ctx.strokeStyle = color; ctx.lineWidth = stemWidth; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(centerX, topOffset); ctx.lineTo(centerX, height - width * 0.28); ctx.stroke();
    ctx.fillStyle = color;
    const tipRadius = width * 0.24;
    ctx.beginPath(); ctx.arc(centerX, height - tipRadius, tipRadius, 0, Math.PI * 2); ctx.fill();
    return ctx.getImageData(0, 0, width, height);
}

function ensurePeakPointerImage(map) {
    if (map.hasImage(PEAK_POINTER_ID)) return;
    map.addImage(PEAK_POINTER_ID, createPeakPointerImage(), { pixelRatio: 2 });
}

function updatePeakLabelLayer(map, layerId) {
    if (!map.getLayer(layerId)) return;
    ensurePeakPointerImage(map);
    const textField = [
        'format',
        ['coalesce', ['get', 'name:en'], ['get', 'name']], { 'font-scale': 1 },
        '\n', {},
        ['concat', ['number-format', ['get', 'ele'], { 'max-fraction-digits': 0 }], ' m'], { 'font-scale': 0.85 }
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

export function updatePeakLabels(map) {
    updatePeakLabelLayer(map, 'Mountain peak labels');
    updatePeakLabelLayer(map, 'Volcano peak labels');
}

// ─── Base style layer bucketing ───
let baseStyleContentLayerIds = [];
const baseStyleLayerMetadata = new Map();
let baseStyleOverlayLayerIds = [];
let baseStyleFillLayerIds = [];
let baseStyleUnderlayLayerIds = [];

// Source-layers that should go into the fills bucket (visible only when Vector basemap is active)
const FILL_SOURCE_LAYERS = ['park', 'landuse', 'landcover', 'water', 'aeroway'];

export function rebuildBaseStyleLayerBuckets() {
    const overlay = [], fills = [], underlay = [];
    baseStyleContentLayerIds.forEach((layerId) => {
        if (typeof layerId !== 'string') return;
        const meta = baseStyleLayerMetadata.get(layerId) || {};
        const type = meta.type ?? '';
        const sourceLayer = (meta.sourceLayer || '').toString().toLowerCase();
        const idLower = layerId.toLowerCase();
        const isRoadLike = sourceLayer.includes('road') || sourceLayer.includes('highway')
            || sourceLayer.includes('transport') || sourceLayer.includes('cycle')
            || sourceLayer.includes('route')
            || sourceLayer.includes('rail') || idLower.includes('road')
            || idLower.includes('path') || idLower.includes('track') || idLower.includes('rail')
            || idLower.includes('cycle') || idLower.includes('route');
        const isBuilding = sourceLayer.includes('building') || idLower.includes('building');
        const isBoundary = sourceLayer.includes('boundary') || idLower.includes('boundary');
        const isWaterway = sourceLayer.includes('waterway') || idLower.includes('river')
            || idLower.includes('stream') || idLower.includes('canal') || idLower.includes('waterway');
        const isFillLayer = (type === 'fill') && FILL_SOURCE_LAYERS.some(sl => sourceLayer.startsWith(sl));

        if (type === 'symbol' || type === 'fill-extrusion' || isRoadLike || isBuilding || isBoundary || isWaterway) {
            overlay.push(layerId);
        } else if (isFillLayer) {
            fills.push(layerId);
        } else {
            underlay.push(layerId);
        }
    });
    baseStyleOverlayLayerIds = overlay;
    baseStyleFillLayerIds = fills;
    baseStyleUnderlayLayerIds = underlay;
}

export function getBaseStyleLayerBuckets() {
    return { overlay: baseStyleOverlayLayerIds, fills: baseStyleFillLayerIds, underlay: baseStyleUnderlayLayerIds, content: baseStyleContentLayerIds };
}

// ─── Legacy service worker cleanup ───
async function unregisterLegacyServiceWorker() {
    if (!('serviceWorker' in navigator) || typeof navigator.serviceWorker.getRegistrations !== 'function') return;
    try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(async (reg) => {
            const candidates = [reg.active, reg.waiting, reg.installing].filter(Boolean).map(w => w.scriptURL);
            if (candidates.some(url => typeof url === 'string' && url.endsWith('/sw.js'))) {
                try { await reg.unregister(); } catch (e) { console.warn('Unable to unregister legacy SW', e); }
            }
        }));
    } catch (_) { }
}

/**
 * Create the map and attach basic controls.
 * @returns {Promise<{map: maplibregl.Map}>}
 */
/**
 * Parse a MapLibre style's layers and cache them into base-style layer buckets.
 * Call this after setStyle() to rebuild fill/overlay/underlay categorisation.
 * @param {object} style - A MapLibre style JSON object
 */
export function parseAndCacheBaseStyleLayers(style) {
    if (Array.isArray(style.layers)) {
        baseStyleLayerMetadata.clear();
        style.layers.forEach((layer) => {
            if (!layer || typeof layer.id !== 'string') return;
            baseStyleLayerMetadata.set(layer.id, { type: layer.type, sourceLayer: layer['source-layer'] || '' });
        });
        baseStyleContentLayerIds = style.layers
            .filter((layer) => {
                if (!layer || typeof layer.id !== 'string') return false;
                if (layer.type === 'background') return false;
                return true;
            })
            .map(l => l.id);
        rebuildBaseStyleLayerBuckets();
    } else {
        baseStyleContentLayerIds = [];
        baseStyleLayerMetadata.clear();
        baseStyleOverlayLayerIds = [];
        baseStyleUnderlayLayerIds = [];
    }
}

export async function createMap() {
    unregisterLegacyServiceWorker();

    // Fetch the local vector style used by the app.
    const versaStyle = await fetch(XPLORE_OUTDOOR_STYLE_URL, { cache: 'no-store' }).then(r => r.json());
    versaStyle.projection = { type: 'mercator' };
    versaStyle.sprite = CARTES_SPRITE_URL;
    versaStyle.sky = { 'sky-color': '#bcd0e6', 'horizon-color': '#e6effa', 'sky-horizon-blend': 0.5 };
    versaStyle.light = { 'anchor': 'map', 'position': [1.5, 90, 80] };

    // Parse base style layers
    parseAndCacheBaseStyleLayers(versaStyle);

    const map = new maplibregl.Map({
        container: 'map',
        pixelRatio: window.devicePixelRatio,
        hash: true,
        center: [7.6586, 45.9763],
        zoom: 11.7,
        pitch: 0,
        bearing: 0,
        style: versaStyle,
        minZoom: 6,
        maxZoom: 18,
        maxPitch: 85,
        antialias: true,
        fadeDuration: TILE_FADE_DURATION,
        maxTileCacheSize: 500,
        refreshExpiredTiles: false,
        attributionControl: false
    });

    window.xploreMap = map;

    // Preload splash
    maplibrePreload(map, {
        text: 'Xplore',
        logoSrc: './data/logos/xplore.mp4',
        logoAlt: 'Xplore',
        minDuration: 7000,
        background: '#05090f'
    });

    // Geocoder
    initializeGeocoder(map, { position: 'top-center' });

    // Controls
    map.addControl(new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserHeading: true
    }), 'top-right');
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: false, visualizePitch: true }), 'top-right');

    // Move 3D toggle below the compass
    const toggle3DBtn = document.getElementById('toggle3D');
    const topRightCtrl = document.querySelector('.maplibregl-ctrl-top-right');
    if (toggle3DBtn && topRightCtrl) {
        topRightCtrl.appendChild(toggle3DBtn);
    }

    map.addControl(new MapboxFPS.FPSControl(), 'bottom-left');

    // Attribution
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    // Apply UI icon sources
    applyUiIconSources();

    return { map };
}
