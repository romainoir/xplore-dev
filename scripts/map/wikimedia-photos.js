/**
 * @file wikimedia-photos.js
 * @description Wikimedia Commons geotagged photos layer for XploreMap.
 * Displays small photo markers on the map that show location of Wikimedia photos.
 * Photos are fetched when zoom >= 12 and displayed as interactive markers.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Configuration Constants
// ─────────────────────────────────────────────────────────────────────────────

const WIKIMEDIA_SOURCE_ID = 'wikimedia-photos';
const WIKIMEDIA_LAYER_ID = 'wikimedia-photos-layer';
const WIKIMEDIA_CLUSTER_LAYER_ID = 'wikimedia-photos-clusters';
const WIKIMEDIA_CLUSTER_COUNT_LAYER_ID = 'wikimedia-photos-cluster-count';
const WIKIMEDIA_PHOTO_ICON_ID = 'wikimedia-photo-marker';

/** Minimum zoom level to display and fetch photos */
/** Minimum zoom level to display and fetch photos */
const MIN_ZOOM_FOR_PHOTOS = 12;

/** Minimum zoom level to show photo thumbnails for large clusters */
const MIN_ZOOM_FOR_THUMBNAILS = 12.0;

/** All layer IDs for Wikimedia photos */
const WIKIMEDIA_LAYERS = [
    WIKIMEDIA_LAYER_ID,
    WIKIMEDIA_CLUSTER_LAYER_ID,
    WIKIMEDIA_CLUSTER_COUNT_LAYER_ID,
    'wikimedia-thumbnails'
];


/** Maximum number of photos to fetch per request */
const FETCH_LIMIT = 500;

/** Debounce delay for map move events (ms) */
const FETCH_DEBOUNCE_MS = 200;

/** Photo marker styling */
const PHOTO_MARKER_SIZE = 24;
const PHOTO_MARKER_COLOR = '#e74c3c';
const PHOTO_MARKER_HOVER_COLOR = '#c0392b';

/** Thumbnail marker size (diameter in pixels) */
const THUMBNAIL_MARKER_SIZE = 56;



// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

let map = null;
let isInitialized = false;
let fetchDebounceTimer = null;
let activePopup = null;

/** Map of coordinateKey -> maplibregl.Marker for thumbnail markers */
const thumbnailMarkers = new Map();

// ── Spatial Cache State ──
/** Accumulated photo features keyed by pageId — never refetched */
const cachedFeatures = new Map();

/** The expanded LngLatBounds of the last successful fetch */
let lastFetchBounds = null;

/** AbortController for the in-flight API request */
let fetchAbortController = null;

/** How much to expand the viewport bounds when fetching (0.5 = 50% on each side) */
const FETCH_BOUNDS_PADDING = 0.5;

/** Prune cache when it exceeds this many features */
const MAX_CACHED_FEATURES = 2000;

/** Max concurrent thumbnail image loads */
const MAX_CONCURRENT_THUMB_LOADS = 6;





// ─────────────────────────────────────────────────────────────────────────────
// Photo Marker Icon
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a camera icon for photo markers
 */
function createPhotoMarkerIcon(color = PHOTO_MARKER_COLOR) {
    const size = 48;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);

    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size * 0.38;

    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    const innerRadius = radius - 3;
    ctx.beginPath();
    ctx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    const iconSize = innerRadius * 0.7;
    const iconX = centerX - iconSize / 2;
    const iconY = centerY - iconSize / 2;

    const bodyWidth = iconSize;
    const bodyHeight = iconSize * 0.68;
    const bodyY = iconY + iconSize * 0.22;
    const bodyRadius = 2;

    ctx.beginPath();
    ctx.roundRect(iconX, bodyY, bodyWidth, bodyHeight, bodyRadius);
    ctx.fill();

    const bumpWidth = iconSize * 0.38;
    const bumpHeight = iconSize * 0.16;
    ctx.beginPath();
    ctx.roundRect(centerX - bumpWidth / 2, iconY + iconSize * 0.08, bumpWidth, bumpHeight, 1);
    ctx.fill();

    ctx.fillStyle = color;
    const lensRadius = iconSize * 0.22;
    ctx.beginPath();
    ctx.arc(centerX, bodyY + bodyHeight / 2, lensRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(centerX - lensRadius * 0.25, bodyY + bodyHeight / 2 - lensRadius * 0.2, lensRadius * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    return ctx.getImageData(0, 0, size, size);
}

function ensurePhotoMarkerIcon(mapInstance) {
    if (mapInstance.hasImage(WIKIMEDIA_PHOTO_ICON_ID)) return;
    const iconData = createPhotoMarkerIcon();
    mapInstance.addImage(WIKIMEDIA_PHOTO_ICON_ID, iconData, { pixelRatio: 2 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Thumbnail Markers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a circular thumbnail image with a border using Canvas.
 * Returns ImageData suitable for map.addImage()
 */
function createCircularThumbnailImage(url) {
    return new Promise((resolve, reject) => {
        const size = THUMBNAIL_MARKER_SIZE; // 56px defined in constants
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');

            // 1. Draw Circular Clip Path
            ctx.beginPath();
            ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();

            // 2. Draw Image (Cover Fit)
            const aspect = img.width / img.height;
            let drawWidth = size;
            let drawHeight = size;
            let offsetX = 0;
            let offsetY = 0;

            if (aspect > 1) {
                drawWidth = size * aspect;
                offsetX = -(drawWidth - size) / 2;
            } else {
                drawHeight = size / aspect;
                offsetY = -(drawHeight - size) / 2;
            }
            ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

            // 3. Draw White Border (Inside)
            ctx.beginPath();
            ctx.arc(size / 2, size / 2, (size / 2) - 1.5, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
            ctx.lineWidth = 3;
            ctx.stroke();

            // 4. Return Data
            resolve(ctx.getImageData(0, 0, size, size));
        };
        img.onerror = () => reject(new Error('Image fetch failed'));
        img.src = url;
    });
}
/** Max screen distance (px) from a POI for a photo to earn a thumbnail */
const POI_PROXIMITY_PX = 150;
const POI_PROXIMITY_SQ = POI_PROXIMITY_PX * POI_PROXIMITY_PX;

/** Landscape-photography POI filter (OpenMapTiles schema) */
const NATURE_LAYER_PATTERNS = ['mountain_peak', 'water_name', 'waterway'];
const NATURE_CLASSES = new Set([
    // Scenic viewpoints & orientation
    'viewpoint',
    // Mountain shelters (often at scenic locations)
    'alpine_hut', 'wilderness_hut', 'shelter',
    // Water features
    'lake', 'glacier', 'spring', 'waterfall',
    // Scenic landmarks
    'castle', 'ruins', 'lighthouse', 'dam', 'bridge',
    'monastery', 'place_of_worship',
]);
const NATURE_SUBCLASSES = new Set([
    // Peaks & ridgelines
    'peak', 'volcano', 'saddle', 'ridge',
    // Viewpoints & trail orientation
    'viewpoint', 'guidepost',
    // Mountain shelters
    'alpine_hut', 'wilderness_hut', 'shelter', 'bivouac',
    // Water features
    'waterfall', 'spring', 'hot_spring', 'glacier', 'lake',
    // Gorges & natural formations
    'gorge', 'cave_entrance', 'cliff', 'arch',
    // Scenic landmarks
    'castle', 'ruins', 'lighthouse', 'dam', 'bridge',
    'monastery', 'chapel',
]);

const loadedImages = new Set();

/** Persistent set of thumbnail IDs from the last update — provides hysteresis */
let lastSelectedIds = new Set();
let thumbnailGeneration = 0;

/**
 * Scans the map for photos near POIs that need thumbnails, fetches them, and adds to sprite.
 * Uses hysteresis: previously shown thumbnails stay visible while on-screen.
 */
async function updateThumbnailImages(mapInstance) {
    const gen = ++thumbnailGeneration;
    try {
        const zoom = mapInstance.getZoom();
        if (zoom < MIN_ZOOM_FOR_THUMBNAILS || !isWikimediaPhotosVisible()) return;

        const layersToQuery = [WIKIMEDIA_CLUSTER_LAYER_ID, WIKIMEDIA_LAYER_ID].filter(id => {
            const l = mapInstance.getLayer(id);
            return l && mapInstance.getLayoutProperty(id, 'visibility') !== 'none';
        });
        if (layersToQuery.length === 0) return;

        const container = mapInstance.getContainer();
        const width = container.clientWidth;
        const height = container.clientHeight;
        const margin = 100;
        const bbox = [[-margin, -margin], [width + margin, height + margin]];

        // ── Step 1: Gather nature POI screen positions ──
        const allLayers = (mapInstance.getStyle()?.layers || []);
        const symbolLayerIds = allLayers
            .filter(l => l.type === 'symbol'
                && !l.id.startsWith('wikimedia')
                && !l.id.startsWith('contour')
                && !l.id.startsWith('route')
                && !l.id.startsWith('distance')
                && !l.id.startsWith('waypoint')
                && !l.id.startsWith('segment'))
            .map(l => l.id)
            .filter(id => mapInstance.getLayer(id));

        const poiScreenPoints = [];
        if (symbolLayerIds.length > 0) {
            const poiFeatures = mapInstance.queryRenderedFeatures(bbox, { layers: symbolLayerIds });
            for (const pf of poiFeatures) {
                try {
                    const coords = pf.geometry?.type === 'Point' ? pf.geometry.coordinates : null;
                    if (!coords) continue;
                    const layerId = pf.layer?.id || '';
                    const props = pf.properties || {};
                    const cls = (props.class || '').toLowerCase();
                    const sub = (props.subclass || '').toLowerCase();
                    if (NATURE_LAYER_PATTERNS.some(p => layerId.includes(p))
                        || NATURE_CLASSES.has(cls)
                        || NATURE_SUBCLASSES.has(sub)) {
                        poiScreenPoints.push(mapInstance.project(coords));
                    }
                } catch (e) { }
            }
        }

        // ── Step 2: Query photo features (center area) ──
        const inset = Math.min(width, height) * 0.2;
        const centerBbox = [[inset, inset], [width - inset, height - inset]];
        const features = mapInstance.queryRenderedFeatures(centerBbox, { layers: layersToQuery });

        // Build a map of pid → screenPt for all visible features
        const featureMap = new Map(); // pid → { screenPt, isCluster }
        for (const f of features) {
            try {
                const props = f.properties || {};
                const isCluster = props.point_count !== undefined;
                const pid = String(isCluster ? props.coverId : props.pageId);
                if (!pid || pid === 'undefined') continue;
                if (!featureMap.has(pid)) {
                    featureMap.set(pid, { screenPt: mapInstance.project(f.geometry.coordinates), isCluster });
                }
            } catch (e) { }
        }

        // ── Step 3: Hysteresis — keep previously selected IDs that are still on-screen ──
        const keptIds = new Set();
        const placedPoints = [];
        const spacing = 80;
        const spacingSq = spacing * spacing;

        for (const pid of lastSelectedIds) {
            const entry = featureMap.get(pid);
            if (entry) {
                keptIds.add(pid);
                placedPoints.push(entry.screenPt);
            }
        }

        // ── Step 4: Score NEW candidates by POI distance ──
        if (poiScreenPoints.length > 0) {
            const scored = [];
            for (const [pid, entry] of featureMap) {
                if (keptIds.has(pid)) continue; // Already kept via hysteresis
                let minDistSq = Infinity;
                for (const poi of poiScreenPoints) {
                    const dx = poi.x - entry.screenPt.x;
                    const dy = poi.y - entry.screenPt.y;
                    const dSq = dx * dx + dy * dy;
                    if (dSq < minDistSq) minDistSq = dSq;
                }
                if (minDistSq <= POI_PROXIMITY_SQ) {
                    scored.push({ pid, screenPt: entry.screenPt, distSq: minDistSq, isCluster: entry.isCluster });
                }
            }

            // Sort: clusters first, then closest to POI
            scored.sort((a, b) => {
                if (a.isCluster && !b.isCluster) return -1;
                if (!a.isCluster && b.isCluster) return 1;
                return a.distSq - b.distSq;
            });

            // Apply spacing against already-placed points
            for (const item of scored) {
                const tooClose = placedPoints.some(p => {
                    const dx = p.x - item.screenPt.x;
                    const dy = p.y - item.screenPt.y;
                    return (dx * dx + dy * dy) < spacingSq;
                });
                if (!tooClose) {
                    keptIds.add(item.pid);
                    placedPoints.push(item.screenPt);
                }
            }
        }

        // Abort if a newer update started while we were computing
        if (gen !== thumbnailGeneration) return;

        const selectedIds = keptIds;
        lastSelectedIds = new Set(selectedIds);

        console.log(`[WikimediaPhotos] ${featureMap.size} visible, ${poiScreenPoints.length} POIs, ${selectedIds.size} thumbnails`);
        // 2. Load & Sprite Management
        const queue = [];
        for (const pid of selectedIds) {
            const imageId = 'thumb-' + pid;
            const hasInMap = mapInstance.hasImage(imageId);
            const hasInQueue = loadedImages.has(imageId);

            if (!hasInMap && !hasInQueue) {
                const cached = cachedFeatures.get(Number(pid)) || cachedFeatures.get(String(pid));
                let url = cached?.properties?.thumbnailUrl;
                if (!url) {
                    const title = cached?.properties?.title;
                    if (title) url = getPhotoThumbnailUrl(title, 200);
                }

                if (url) {
                    queue.push({ imageId, url });
                } else {
                    console.warn(`[WikimediaPhotos] No URL found for selected ID: ${pid}`);
                }
            }
        }

        if (queue.length > 0) {
            console.log(`[WikimediaPhotos] Queueing ${queue.length} new thumbnails for map...`);
            for (const item of queue.slice(0, 15)) {
                if (loadedImages.has(item.imageId)) continue;
                loadedImages.add(item.imageId);
                try {
                    const imgData = await createCircularThumbnailImage(item.url);
                    if (imgData && mapInstance.getStyle()) {
                        mapInstance.addImage(item.imageId, imgData);
                        console.log(`[WikimediaPhotos] Thumbnail ADDED to sprite: ${item.imageId}`);
                    }
                } catch (err) {
                    console.warn(`[WikimediaPhotos] Load FAILED for ${item.imageId}:`, err);
                    loadedImages.delete(item.imageId);
                }
            }
        }

        // 3. Update Thumbnail Layer Filter & Z-Order
        if (mapInstance.getLayer('wikimedia-thumbnails')) {
            const filter = ['in',
                ['to-string', ['case', ['has', 'point_count'], ['get', 'coverId'], ['get', 'pageId']]],
                ['literal', Array.from(selectedIds)]
            ];
            mapInstance.setFilter('wikimedia-thumbnails', filter);
            try {
                mapInstance.moveLayer('wikimedia-thumbnails');
            } catch (e) { }
            console.log(`[WikimediaPhotos] Updated thumbnail filter with ${selectedIds.size} IDs`);
        }

    } catch (e) {
        console.error('[WikimediaPhotos] simple update fail:', e);
    }
}



function clearThumbnailImages() {
    loadedImages.clear();
    lastSelectedIds.clear();
}
// ─────────────────────────────────────────────────────────────────────────────
// Wikimedia API
// ─────────────────────────────────────────────────────────────────────────────

const photoMetadataCache = new Map();


/**
 * Hybrid fetch: uses list=geosearch for 100% coordinate coverage,
 * then parallel imageinfo calls for thumbnail URLs.
 */
export async function fetchWikimediaPhotosInBounds(bounds, signal) {
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    const baseUrl = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*';
    // Use list=geosearch to get all titles/coords in bounds
    // gsbbox = top|left|bottom|right
    const searchUrl = `${baseUrl}&list=geosearch&gsbbox=${ne.lat}|${sw.lng}|${sw.lat}|${ne.lng}&gsnamespace=6&gslimit=${FETCH_LIMIT}`;

    try {
        console.log(`[WikimediaPhotos] Fetching: ${searchUrl} (Bounding Box: ${ne.lat},${sw.lng} to ${sw.lat},${ne.lng})`);
        const searchRes = await fetch(searchUrl, { signal });
        const text = await searchRes.text();
        let searchData;
        try {
            searchData = JSON.parse(text);
        } catch (err) {
            console.error('[WikimediaPhotos] JSON Parse error. Raw response:', text.substring(0, 500));
            return { type: 'FeatureCollection', features: [] };
        }

        if (searchData.error) {
            console.error('[WikimediaPhotos] API Error:', searchData.error);
            return { type: 'FeatureCollection', features: [] };
        }

        if (!searchData.query || !searchData.query.geosearch) {
            console.warn('[WikimediaPhotos] No geosearch results or query missing. Full Response:', JSON.stringify(searchData));
            return { type: 'FeatureCollection', features: [] };
        }

        const photos = searchData.query.geosearch;
        console.log(`[WikimediaPhotos] Found ${photos.length} photos in geosearch`);
        // Batch process imageinfo for thumbnails (max 50 per call)
        const batchSize = 50;
        const thumbnailData = new Map();

        const fetchBatch = async (batch) => {
            const titles = batch.map(p => p.title).join('|');
            const infoUrl = `${baseUrl}&prop=imageinfo&iiprop=url&iiurlwidth=200&titles=${encodeURIComponent(titles)}`;
            const infoRes = await fetch(infoUrl, { signal });
            const infoData = await infoRes.json();
            if (infoData.query && infoData.query.pages) {
                Object.values(infoData.query.pages).forEach(page => {
                    if (page.imageinfo && page.imageinfo[0]) {
                        thumbnailData.set(page.title, page.imageinfo[0].thumburl);
                    }
                });
            }
        };

        const batches = [];
        for (let i = 0; i < photos.length; i += batchSize) {
            batches.push(fetchBatch(photos.slice(i, i + batchSize)));
        }

        await Promise.all(batches);

        const features = photos.map(p => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
            properties: {
                pageId: p.pageid,
                title: p.title,
                thumbnailUrl: thumbnailData.get(p.title) || ''
            }
        }));

        return { type: 'FeatureCollection', features };
    } catch (e) {
        if (e.name === 'AbortError') throw e;
        console.warn('[WikimediaPhotos] Fetch failed:', e);
        return { type: 'FeatureCollection', features: [] };
    }
}

async function fetchPhotoMetadata(title) {
    if (photoMetadataCache.has(title)) return photoMetadataCache.get(title);

    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('prop', 'imageinfo');
    url.searchParams.set('iiprop', 'user|timestamp|extmetadata');
    url.searchParams.set('titles', title);
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');

    try {
        const response = await fetch(url.toString());
        const data = await response.json();
        const page = Object.values(data.query.pages)[0];
        const info = page.imageinfo?.[0];
        if (!info) return null;
        const meta = info.extmetadata || {};
        const result = {
            author: meta.Artist?.value || info.user || 'Unknown',
            description: meta.ImageDescription?.value || '',
            license: meta.License?.value || 'Unknown'
        };
        photoMetadataCache.set(title, result);
        return result;
    } catch (e) {
        return null;
    }
}

export function getPhotoThumbnailUrl(fileName, width = 400) {
    if (!fileName) return '';
    const nameStr = String(fileName);
    // Strip "File:" prefix, replace spaces with underscores
    let cleanName = (nameStr.includes(':') ? nameStr.split(':').slice(1).join(':') : nameStr)
        .trim()
        .replace(/ /g, '_');
    // Capitalize first letter (Wikimedia convention)
    if (cleanName.length > 0) {
        cleanName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
    }
    // Use Special:FilePath with double-encoded filename for robust handling
    // of special characters (apostrophes, accents, spaces, etc.)
    const encoded = encodeURIComponent(cleanName)
        .replace(/'/g, '%27')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29');
    return `https://commons.wikimedia.org/w/index.php?title=Special:FilePath&file=${encoded}&width=${width}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Map Layers & Events
// ─────────────────────────────────────────────────────────────────────────────

function addWikimediaLayers(mapInstance) {
    if (!mapInstance.getSource(WIKIMEDIA_SOURCE_ID)) {
        mapInstance.addSource(WIKIMEDIA_SOURCE_ID, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            cluster: true,
            clusterMaxZoom: 18,
            clusterRadius: 32,
            clusterProperties: {
                'coverId': ['min', ['get', 'pageId']]
            }
        });
        console.log('[WikimediaPhotos] Source added:', WIKIMEDIA_SOURCE_ID);
    }

    ensurePhotoMarkerIcon(mapInstance);

    // 1. Base Camera Icons (Clusters)
    if (!mapInstance.getLayer(WIKIMEDIA_CLUSTER_LAYER_ID)) {
        mapInstance.addLayer({
            id: WIKIMEDIA_CLUSTER_LAYER_ID,
            type: 'symbol',
            source: WIKIMEDIA_SOURCE_ID,
            minzoom: MIN_ZOOM_FOR_PHOTOS,
            filter: ['has', 'point_count'],
            layout: {
                'icon-image': WIKIMEDIA_PHOTO_ICON_ID,
                'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.7, 16, 0.9, 18, 1.1],
                'icon-allow-overlap': true,
                'icon-ignore-placement': true
            },
            paint: { 'icon-opacity': 1 }
        });
    }

    // 2. Base Camera Icons (Singles)
    if (!mapInstance.getLayer(WIKIMEDIA_LAYER_ID)) {
        mapInstance.addLayer({
            id: WIKIMEDIA_LAYER_ID,
            type: 'symbol',
            source: WIKIMEDIA_SOURCE_ID,
            minzoom: MIN_ZOOM_FOR_PHOTOS,
            filter: ['!', ['has', 'point_count']],
            layout: {
                'icon-image': WIKIMEDIA_PHOTO_ICON_ID,
                'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.6, 16, 0.8, 18, 1],
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'icon-padding': 2
            },
            paint: { 'icon-opacity': 1 }
        });
    }

    // 3. Cluster Count Text
    if (!mapInstance.getLayer(WIKIMEDIA_CLUSTER_COUNT_LAYER_ID)) {
        mapInstance.addLayer({
            id: WIKIMEDIA_CLUSTER_COUNT_LAYER_ID,
            type: 'symbol',
            source: WIKIMEDIA_SOURCE_ID,
            minzoom: MIN_ZOOM_FOR_PHOTOS,
            filter: ['all', ['has', 'point_count'], ['<', ['get', 'point_count'], 10]],
            layout: {
                'text-field': '{point_count_abbreviated}',
                'text-font': ['Noto Sans Bold'],
                'text-size': 11,
                'text-offset': [1.2, 0],
                'text-anchor': 'left',
                'text-allow-overlap': true,
                'text-ignore-placement': true
            },
            paint: {
                'text-color': '#ffffff',
                'text-halo-color': 'rgba(0, 0, 0, 0.7)',
                'text-halo-width': 1.5
            }
        });
    }

    // 4. Unified GL Thumbnails
    if (!mapInstance.getLayer('wikimedia-thumbnails')) {
        mapInstance.addLayer({
            id: 'wikimedia-thumbnails',
            type: 'symbol',
            source: WIKIMEDIA_SOURCE_ID,
            minzoom: MIN_ZOOM_FOR_PHOTOS,
            layout: {
                'icon-image': [
                    'concat', 'thumb-',
                    ['to-string', ['case', ['has', 'point_count'], ['get', 'coverId'], ['get', 'pageId']]]
                ],
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'icon-size': 1.12
            },
            paint: { 'icon-opacity': 1 }
        });
    }

    try {
        if (mapInstance.getLayer('wikimedia-thumbnails')) mapInstance.moveLayer('wikimedia-thumbnails');
    } catch (e) { }
}

function setupWikimediaEventListeners(mapInstance) {
    const layers = [
        WIKIMEDIA_LAYER_ID,
        WIKIMEDIA_CLUSTER_LAYER_ID,
        'wikimedia-thumbnails'
    ];
    layers.forEach(layerId => {
        mapInstance.on('click', layerId, (e) => {
            const f = e.features[0];
            if (f.properties.cluster) {
                mapInstance.getSource(WIKIMEDIA_SOURCE_ID).getClusterExpansionZoom(f.properties.cluster_id, (err, zoom) => {
                    if (!err) mapInstance.easeTo({ center: f.geometry.coordinates, zoom: zoom + 1 });
                });
            } else showPhotoPopup(mapInstance, f);
        });

        let hoverTimer = null;
        mapInstance.on('mouseenter', layerId, (e) => {
            mapInstance.getCanvas().style.cursor = 'pointer';
            if (hoverTimer) clearTimeout(hoverTimer);
            if (activePopup && activePopup.isOpen()) return;
            showPhotoPopup(mapInstance, e.features[0]);
        });

        mapInstance.on('mouseleave', layerId, () => {
            mapInstance.getCanvas().style.cursor = '';
            hoverTimer = setTimeout(() => {
                if (activePopup && !activePopup.getElement().matches(':hover')) {
                    activePopup.remove();
                    activePopup = null;
                }
            }, 100);
        });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Popup & Carousel
// ─────────────────────────────────────────────────────────────────────────────

function stripHtmlTags(html) {
    if (!html) return '';
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || '';
}

async function showPhotoPopup(mapInstance, feature) {
    const coordinates = feature.geometry.coordinates.slice();
    const { cluster, cluster_id } = feature.properties;

    if (activePopup) activePopup.remove();

    const popupId = `wikimedia-popup-${Date.now()}`;

    activePopup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: true,
        maxWidth: '320px',
        className: 'wikimedia-photo-popup',
        offset: [0, -10]
    })
        .setLngLat(coordinates)
        .setHTML(`
        <div class="wikimedia-popup-content" id="${popupId}">
            <div class="wikimedia-popup-image-container">
                <div class="wikimedia-popup-carousel">
                    <div class="wikimedia-popup-carousel__track"></div>
                    <div class="wikimedia-popup-carousel__dots"></div>
                    <button class="wikimedia-popup-carousel__nav wikimedia-popup-carousel__nav--prev">←</button>
                    <button class="wikimedia-popup-carousel__nav wikimedia-popup-carousel__nav--next">→</button>
                </div>
                <button class="wikimedia-popup-info-btn">i</button>
                <div class="wikimedia-popup-info-overlay" aria-hidden="true">
                    <div class="wikimedia-popup-info-content">
                        <div class="wikimedia-popup-meta"></div>
                    </div>
                </div>
            </div>
        </div>
    `)
        .addTo(mapInstance);

    const container = document.getElementById(popupId);
    if (!container) return;

    const track = container.querySelector('.wikimedia-popup-carousel__track');
    const dotsContainer = container.querySelector('.wikimedia-popup-carousel__dots');
    const meta = container.querySelector('.wikimedia-popup-meta');
    const imageContainer = container.querySelector('.wikimedia-popup-image-container');

    const updateContainerHeight = (img) => {
        if (!img || !img.complete || !img.naturalHeight) return;
        const aspect = img.naturalWidth / img.naturalHeight;
        const width = imageContainer.offsetWidth;
        const height = width / aspect;
        imageContainer.style.height = `${height}px`;
    };

    let photos = [];
    if (cluster) {
        try {
            photos = await mapInstance.getSource(WIKIMEDIA_SOURCE_ID).getClusterLeaves(cluster_id, 10, 0);
        } catch (e) { photos = [feature]; }
    } else {
        photos = [feature];
    }

    if (!photos || photos.length === 0) {
        meta.innerHTML = 'No photos found.';
        return;
    }

    photos.forEach((p, i) => {
        const slide = document.createElement('div');
        slide.className = 'wikimedia-popup-carousel__slide';

        const img = document.createElement('img');
        img.className = 'wikimedia-popup-carousel__image';
        img.loading = 'lazy';
        img.src = getPhotoThumbnailUrl(p.properties.title || p.properties.fileName, 600);
        img.onload = () => {
            if (currentIndex === i) updateContainerHeight(img);
        };

        slide.appendChild(img);
        track.appendChild(slide);

        if (photos.length > 1) {
            const dot = document.createElement('div');
            dot.className = `wikimedia-popup-carousel__dot ${i === 0 ? 'wikimedia-popup-carousel__dot--active' : ''}`;
            dot.onclick = () => goToSlide(i);
            dotsContainer.appendChild(dot);
        }
    });

    if (photos.length <= 1) container.querySelectorAll('.wikimedia-popup-carousel__nav').forEach(n => n.style.display = 'none');

    let currentIndex = 0;
    const goToSlide = (index) => {
        currentIndex = index;
        track.style.transform = `translateX(-${index * 100}%)`;
        container.querySelectorAll('.wikimedia-popup-carousel__dot').forEach((d, i) => d.classList.toggle('wikimedia-popup-carousel__dot--active', i === index));
        updateMetadata(photos[index]);

        // Update height for the new slide
        const currentSlide = track.children[index];
        if (currentSlide) {
            const img = currentSlide.querySelector('img');
            updateContainerHeight(img);
        }
    };

    container.querySelector('.wikimedia-popup-carousel__nav--prev').onclick = (e) => { e.stopPropagation(); goToSlide((currentIndex - 1 + photos.length) % photos.length); };
    container.querySelector('.wikimedia-popup-carousel__nav--next').onclick = (e) => { e.stopPropagation(); goToSlide((currentIndex + 1) % photos.length); };

    const updateMetadata = async (p) => {
        meta.innerHTML = '';
        const m = await fetchPhotoMetadata(p.properties.title);
        if (m) meta.innerHTML = `<p>${stripHtmlTags(m.description).slice(0, 180)}</p><p>By: ${stripHtmlTags(m.author)}</p>`;
    };

    updateMetadata(photos[0]);

    const infoBtn = container.querySelector('.wikimedia-popup-info-btn');
    const overlay = container.querySelector('.wikimedia-popup-info-overlay');
    infoBtn.onclick = (e) => {
        e.stopPropagation();
        const h = overlay.getAttribute('aria-hidden') === 'true';
        overlay.setAttribute('aria-hidden', !h);
        infoBtn.classList.toggle('active', !h);
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function initializeWikimediaPhotos(mapInstance, options = {}) {
    if (isInitialized) return;
    map = mapInstance;
    const { enabled = true } = options;

    const initialize = () => {
        addWikimediaLayers(map);
        setupWikimediaEventListeners(map);
        map.on('moveend', onMapMoveEnd);
        if (enabled && map.getZoom() >= MIN_ZOOM_FOR_PHOTOS) refreshPhotos();
        isInitialized = true;
        setWikimediaPhotosEnabled(enabled);
    };

    if (map.isStyleLoaded()) initialize();
    else map.once('style.load', initialize);
}

/**
 * Re-add wikimedia layers after a style swap (setStyle destroys all layers).
 * Call from the `style.load` handler.
 */
export function restoreWikimediaLayers() {
    if (!map || !isInitialized) return;
    // Layers were destroyed by setStyle — re-add them
    if (map.getSource(WIKIMEDIA_SOURCE_ID)) return; // already restored
    addWikimediaLayers(map);
    setupWikimediaEventListeners(map);
    // Re-apply current visibility state
    const wasEnabled = isWikimediaPhotosVisible !== undefined;
    // Check the last known state by trying the layer
    const layer = map.getLayer(WIKIMEDIA_LAYER_ID);
    if (layer) {
        // Refresh photos if zoom is sufficient
        if (map.getZoom() >= MIN_ZOOM_FOR_PHOTOS) refreshPhotos();
    }
}

// ── Spatial cache helpers ──

/**
 * Compute a LngLatBounds centered on the map center with a zoom-dependent radius.
 * This avoids fetching huge areas in 3D tilted view where getBounds() extends to the horizon.
 * Radius is capped at 0.15° to stay within Wikimedia API limits.
 */
function getCenterBounds(mapInstance) {
    const center = mapInstance.getCenter();
    const zoom = mapInstance.getZoom();
    // Radius in degrees: ~0.15° at zoom 12, halving per zoom level, capped at 0.15°
    const radius = Math.min(0.15, 0.15 * Math.pow(2, 12 - zoom));
    return new maplibregl.LngLatBounds(
        [center.lng - radius, center.lat - radius],
        [center.lng + radius, center.lat + radius]
    );
}

/** Expand a LngLatBounds by a padding factor on each side */
function expandBounds(bounds, padding) {
    const n = bounds.getNorth(), s = bounds.getSouth();
    const e = bounds.getEast(), w = bounds.getWest();
    const latPad = (n - s) * padding;
    const lngPad = (e - w) * padding;
    return new maplibregl.LngLatBounds(
        [w - lngPad, s - latPad],
        [e + lngPad, n + latPad]
    );
}

/** Returns true if the viewport is entirely within the last fetched bounds */
function isViewportCovered(viewportBounds) {
    if (!lastFetchBounds) return false;
    const ne = viewportBounds.getNorthEast();
    const sw = viewportBounds.getSouthWest();
    return lastFetchBounds.contains(ne) && lastFetchBounds.contains(sw);
}

/** Remove features far from the current viewport to keep memory bounded */
function pruneDistantFeatures(viewportBounds) {
    const center = viewportBounds.getCenter();
    const entries = Array.from(cachedFeatures.entries()).map(([id, f]) => {
        const [lng, lat] = f.geometry.coordinates;
        const dist = Math.abs(lat - center.lat) + Math.abs(lng - center.lng);
        return { id, dist };
    });
    entries.sort((a, b) => b.dist - a.dist);
    const toRemove = entries.slice(0, entries.length - MAX_CACHED_FEATURES);
    toRemove.forEach(e => cachedFeatures.delete(e.id));
}

/** Reset the spatial cache (e.g. when disabling photos or destroying) */
function resetSpatialCache() {
    console.log('[WikimediaPhotos] resetSpatialCache called. Clearing cache...');
    cachedFeatures.clear();
    lastFetchBounds = null;
    if (fetchAbortController) {
        fetchAbortController.abort();
        fetchAbortController = null;
    }
}

async function refreshPhotos() {
    if (!map || map.getZoom() < MIN_ZOOM_FOR_PHOTOS) return;
    if (!isWikimediaPhotosVisible()) return;

    // Use center-based bounds instead of map.getBounds() to avoid huge 3D tilt areas
    const viewportBounds = getCenterBounds(map);

    // Skip fetch if the current center area is fully within the last fetched area
    if (isViewportCovered(viewportBounds)) {
        requestAnimationFrame(() => updateThumbnailImages(map));
        return;
    }

    // Cancel any in-flight request
    if (fetchAbortController) fetchAbortController.abort();
    fetchAbortController = new AbortController();

    const expandedBounds = expandBounds(viewportBounds, FETCH_BOUNDS_PADDING);

    try {
        const data = await fetchWikimediaPhotosInBounds(expandedBounds, fetchAbortController.signal);

        // Merge new features into the persistent cache
        let newCount = 0;
        data.features.forEach(f => {
            const key = f.properties.pageId;
            if (!cachedFeatures.has(key)) {
                cachedFeatures.set(key, f);
                newCount++;
            }
        });

        // Prune if the cache is too large
        if (cachedFeatures.size > MAX_CACHED_FEATURES) {
            pruneDistantFeatures(viewportBounds);
        }

        // Only update the source if new features were actually added
        if (newCount > 0 || !lastFetchBounds) {
            const allFeatures = {
                type: 'FeatureCollection',
                features: Array.from(cachedFeatures.values())
            };
            const source = map.getSource(WIKIMEDIA_SOURCE_ID);
            if (source) source.setData(allFeatures);
        }

        lastFetchBounds = expandedBounds;

        console.log(`[WikimediaPhotos] refreshPhotos: Fetched ${data.features.length} features, cache now ${cachedFeatures.size}. New features: ${newCount}.`);

        // Wait for MapLibre to finish rendering the new/cached data before querying
        map.once('idle', () => {
            console.log('[WikimediaPhotos] Map Idle, triggering thumbnail update...');
            updateThumbnailImages(map);
        });
    } catch (e) {
        if (e.name === 'AbortError') return; // Pan cancelled this request, no problem
        console.warn('[WikimediaPhotos] Fetch failed:', e);
    }
}

function onMapMoveEnd() {
    if (fetchDebounceTimer) clearTimeout(fetchDebounceTimer);
    fetchDebounceTimer = setTimeout(refreshPhotos, FETCH_DEBOUNCE_MS);
}

export function setWikimediaPhotosEnabled(enabled) {
    if (!map || !isInitialized) return;
    const visibility = enabled ? 'visible' : 'none';
    WIKIMEDIA_LAYERS.forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
    });
    if (enabled && map.getZoom() >= MIN_ZOOM_FOR_PHOTOS) refreshPhotos();
    else if (!enabled) {
        // Clear data and spatial cache
        resetSpatialCache();
        const source = map.getSource(WIKIMEDIA_SOURCE_ID);
        if (source) source.setData({ type: 'FeatureCollection', features: [] });
        clearThumbnailImages();
    }
}

export function isWikimediaPhotosVisible() {
    if (!map || !isInitialized) return false;
    const layer = map.getLayer(WIKIMEDIA_LAYER_ID);
    return layer && map.getLayoutProperty(WIKIMEDIA_LAYER_ID, 'visibility') !== 'none';
}

export function forceRefreshWikimediaPhotos() {
    if (map && isInitialized) refreshPhotos();
}




export function destroyWikimediaPhotos() {
    if (!map) return;
    map.off('moveend', onMapMoveEnd);
    resetSpatialCache();
    [WIKIMEDIA_LAYER_ID, WIKIMEDIA_CLUSTER_LAYER_ID, WIKIMEDIA_CLUSTER_COUNT_LAYER_ID, 'wikimedia-thumbnails'].forEach(id => {
        if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource(WIKIMEDIA_SOURCE_ID)) map.removeSource(WIKIMEDIA_SOURCE_ID);
    if (map.hasImage(WIKIMEDIA_PHOTO_ICON_ID)) map.removeImage(WIKIMEDIA_PHOTO_ICON_ID);
    if (activePopup) activePopup.remove();
    clearThumbnailImages();
    map = null;
    isInitialized = false;
}

/**
 * Shows a full-screen lightbox photo viewer for photos clicked in the elevation chart.
 * @param {Object} mapInstance - The map instance (not used for positioning, just for reference)
 * @param {Object} photoData - Photo data from elevation chart
 * @param {Array} clusterPhotos - Array of all photos in the cluster (for carousel)
 */
export async function showElevationChartPhotoPopup(mapInstance, photoData, clusterPhotos = null) {
    const photos = clusterPhotos || [photoData];

    // Remove any existing lightbox
    const existingLightbox = document.getElementById('photo-lightbox');
    if (existingLightbox) existingLightbox.remove();

    // Create lightbox overlay
    const lightbox = document.createElement('div');
    lightbox.id = 'photo-lightbox';
    lightbox.className = 'photo-lightbox';
    lightbox.innerHTML = `
        <div class="photo-lightbox__backdrop"></div>
        <div class="photo-lightbox__container">
            <button class="photo-lightbox__close" aria-label="Close">&times;</button>
            <div class="photo-lightbox__content">
                <div class="photo-lightbox__carousel">
                    <div class="photo-lightbox__carousel-track"></div>
                    <button class="photo-lightbox__nav photo-lightbox__nav--prev" aria-label="Previous">
                        <svg viewBox="0 0 24 24" width="32" height="32"><path fill="currentColor" d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
                    </button>
                    <button class="photo-lightbox__nav photo-lightbox__nav--next" aria-label="Next">
                        <svg viewBox="0 0 24 24" width="32" height="32"><path fill="currentColor" d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
                    </button>
                </div>
                <div class="photo-lightbox__dots"></div>
                <div class="photo-lightbox__info">
                    <div class="photo-lightbox__meta"></div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(lightbox);

    const track = lightbox.querySelector('.photo-lightbox__carousel-track');
    const dotsContainer = lightbox.querySelector('.photo-lightbox__dots');
    const meta = lightbox.querySelector('.photo-lightbox__meta');
    const prevBtn = lightbox.querySelector('.photo-lightbox__nav--prev');
    const nextBtn = lightbox.querySelector('.photo-lightbox__nav--next');
    const closeBtn = lightbox.querySelector('.photo-lightbox__close');
    const backdrop = lightbox.querySelector('.photo-lightbox__backdrop');

    let currentIndex = 0;

    // Create slides
    photos.forEach((p, i) => {
        const slide = document.createElement('div');
        slide.className = 'photo-lightbox__slide';

        const thumbUrl = p.thumbnailUrl || (p.fileName ? getPhotoThumbnailUrl(p.fileName, 400) : '');

        // 1. Placeholder Image (Low-res)
        if (thumbUrl) {
            const placeholder = document.createElement('img');
            placeholder.className = 'photo-lightbox__image photo-lightbox__image--placeholder';
            placeholder.src = thumbUrl;
            placeholder.alt = '';
            slide.appendChild(placeholder);
        }

        // 2. Main Image (High-res)
        const img = document.createElement('img');
        img.className = 'photo-lightbox__image';
        img.loading = i === 0 ? 'eager' : 'lazy';
        const fileName = p.fileName || (p.thumbnailUrl ? decodeURIComponent(p.thumbnailUrl.split('/').pop().split('?')[0]) : '');
        img.src = getPhotoThumbnailUrl(fileName, 1024);
        img.alt = p.title || 'Photo';

        img.onload = () => {
            requestAnimationFrame(() => {
                img.classList.add('loaded');
                const ph = slide.querySelector('.photo-lightbox__image--placeholder');
                if (ph) ph.style.opacity = '0';
            });
        };

        if (img.complete) {
            img.onload();
        }

        slide.appendChild(img);
        track.appendChild(slide);

        // Create dots for navigation
        if (photos.length > 1) {
            const dot = document.createElement('button');
            dot.className = `photo-lightbox__dot ${i === 0 ? 'photo-lightbox__dot--active' : ''}`;
            dot.onclick = () => goToSlide(i);
            dotsContainer.appendChild(dot);
        }
    });

    // Hide nav buttons if single photo
    if (photos.length <= 1) {
        prevBtn.style.display = 'none';
        nextBtn.style.display = 'none';
    }

    const goToSlide = (index) => {
        currentIndex = index;
        track.style.transform = `translateX(-${index * 100}%)`;
        const dots = lightbox.querySelectorAll('.photo-lightbox__dot');
        dots.forEach((d, i) =>
            d.classList.toggle('photo-lightbox__dot--active', i === index)
        );
        updateMetadata(photos[index]);
    };

    prevBtn.onclick = () => goToSlide((currentIndex - 1 + photos.length) % photos.length);
    nextBtn.onclick = () => goToSlide((currentIndex + 1) % photos.length);

    // Keyboard navigation
    const handleKeydown = (e) => {
        if (e.key === 'Escape') closeLightbox();
        else if (e.key === 'ArrowLeft' && photos.length > 1) goToSlide((currentIndex - 1 + photos.length) % photos.length);
        else if (e.key === 'ArrowRight' && photos.length > 1) goToSlide((currentIndex + 1) % photos.length);
    };
    document.addEventListener('keydown', handleKeydown);

    const closeLightbox = () => {
        lightbox.classList.add('photo-lightbox--closing');
        document.removeEventListener('keydown', handleKeydown);
        setTimeout(() => lightbox.remove(), 200);
    };

    closeBtn.onclick = closeLightbox;
    backdrop.onclick = closeLightbox;

    const updateMetadata = async (p) => {
        const title = p.title || `File:${p.fileName}`;
        // Show title immediately so it's snappy
        meta.innerHTML = `<div class="photo-lightbox__meta-title">${title.replace('File:', '')}</div><span class="photo-lightbox__loading">Loading info...</span>`;

        const m = await fetchPhotoMetadata(title);
        if (m) {
            meta.innerHTML = `
                ${m.description ? `<div class="photo-lightbox__meta-description">${stripHtmlTags(m.description).slice(0, 250)}</div>` : ''}
                <div class="photo-lightbox__meta-author">© ${stripHtmlTags(m.author)}</div>
            `;
        } else {
            meta.innerHTML = `<div class="photo-lightbox__meta-title">${title.replace('File:', '')}</div>`;
        }
    };

    // Load first photo metadata
    updateMetadata(photos[0]);

    // Trigger entrance animation
    requestAnimationFrame(() => lightbox.classList.add('photo-lightbox--open'));
}

export default {
    initializeWikimediaPhotos,
    setWikimediaPhotosEnabled,
    isWikimediaPhotosVisible,
    forceRefreshWikimediaPhotos,
    destroyWikimediaPhotos,
    showElevationChartPhotoPopup
};
