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

/** Minimum zoom level to fetch photos and show thumbnails */
const MIN_ZOOM_FOR_PHOTOS = 12;
const MIN_ZOOM_FOR_THUMBNAILS = 12;

/** All layer IDs for Wikimedia photos */
const WIKIMEDIA_LAYERS = [
    'wikimedia-photos-base',
    'wikimedia-thumbnails-small',
    'wikimedia-thumbnails-large'
];


/** Maximum number of photos to fetch per request */
const FETCH_LIMIT = 100;

/** Debounce delay for map move events (ms) */
const FETCH_DEBOUNCE_MS = 200;

/** Thumbnail marker size (diameter in pixels) */
const THUMBNAIL_MARKER_SIZE = 56;



// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

let map = null;
let isInitialized = false;
let fetchDebounceTimer = null;
let activePopup = null;

let activeFilterIds = new Set();
let moveEndDebounceTimer = null;
let moveDebounceTimer = null;
let idleDebounceTimer = null;

let thumbnailGeneration = 0;
let lastSelectedIds = new Set();
const loadedImages = new Set();

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
const FETCH_BOUNDS_PADDING = 0.5; // Load 50% wider area to prevent popping

/** Prune cache when it exceeds this many features */
const MAX_CACHED_FEATURES = 500; // Keep fewer features in memory

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

/**
 * Scans the map for photos that need thumbnails, fetches them, and adds to sprite.
 * Uses hysteresis: previously shown thumbnails stay visible while on-screen.
 */
async function updateThumbnailImages(mapInstance) {
    const gen = ++thumbnailGeneration;
    try {
        const zoom = mapInstance.getZoom();
        if (zoom < MIN_ZOOM_FOR_THUMBNAILS || !isWikimediaPhotosVisible()) return;

        const layersToQuery = ['wikimedia-photos-base'].filter(id => {
            const l = mapInstance.getLayer(id);
            return l && mapInstance.getLayoutProperty(id, 'visibility') !== 'none';
        });
        if (layersToQuery.length === 0) return;

        const container = mapInstance.getContainer();
        const width = container.clientWidth;
        const height = container.clientHeight;
        const margin = 100;
        const bbox = [[-margin, -margin], [width + margin, height + margin]];

        // ── Step 1: Gather nature POI screen positions from map labels ──
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

                    if (NATURE_LAYER_PATTERNS.some(p => layerId.includes(p)) || NATURE_CLASSES.has(cls) || NATURE_SUBCLASSES.has(sub)) {
                        poiScreenPoints.push(mapInstance.project(coords));
                    }
                } catch (e) { }
            }
        }

        // ── Step 2: Query photo features (full screen viewport) ──
        const features = mapInstance.queryRenderedFeatures(bbox, { layers: layersToQuery });

        const featureMap = new Map();
        for (const f of features) {
            try {
                const props = f.properties || {};
                const isCluster = props.point_count !== undefined;
                const pid = String(isCluster ? props.coverId : props.pageId);
                if (!pid || pid === 'undefined') continue;
                if (!featureMap.has(pid)) {
                    featureMap.set(pid, {
                        featureId: f.id,
                        screenPt: mapInstance.project(f.geometry.coordinates),
                        isCluster
                    });
                }
            } catch (e) { }
        }

        // ── Step 3: Find single closest feature for each POI ──
        const targetLarge = new Set();
        const targetSmall = new Set();
        const keptIds = new Set();

        const closestFeaturesToPOIs = new Set();
        for (const poi of poiScreenPoints) {
            let closestDistSq = POI_PROXIMITY_SQ;
            let closestPid = null;

            for (const [pid, entry] of featureMap) {
                const dx = poi.x - entry.screenPt.x;
                const dy = poi.y - entry.screenPt.y;
                const distSq = dx * dx + dy * dy;
                if (distSq <= closestDistSq) {
                    closestDistSq = distSq;
                    closestPid = pid;
                }
            }
            if (closestPid) closestFeaturesToPOIs.add(closestPid);
        }

        for (const pid of lastSelectedIds) {
            keptIds.add(pid);
        }

        for (const [pid, entry] of featureMap) {
            keptIds.add(pid);
            if (closestFeaturesToPOIs.has(pid)) targetLarge.add(pid);
            else targetSmall.add(pid);
        }

        if (gen !== thumbnailGeneration) return;

        const selectedIds = keptIds;
        lastSelectedIds = new Set(selectedIds);

        // 2. Load & Sprite Management
        const queue = [];
        const stillActiveLarge = new Set();
        const stillActiveSmall = new Set();

        for (const pid of selectedIds) {
            const imageId = 'thumb-' + pid;
            const hasInMap = mapInstance.hasImage(imageId);

            if (hasInMap) {
                if (targetLarge.has(pid)) stillActiveLarge.add(pid);
                else stillActiveSmall.add(pid);
            } else {
                const hasInQueue = loadedImages.has(imageId);
                if (!hasInQueue) {
                    const cached = cachedFeatures.get(Number(pid)) || cachedFeatures.get(String(pid));
                    let url = cached?.properties?.thumbnailUrl;
                    if (!url) {
                        const title = cached?.properties?.title;
                        if (title) url = getPhotoThumbnailUrl(title, 200);
                    }
                    if (url) {
                        queue.push({ imageId, url, pid });
                    }
                }
            }
        }

        // 3. Update Thumbnail Layer Filters
        if (mapInstance.getLayer('wikimedia-thumbnails-large')) {
            mapInstance.setFilter('wikimedia-thumbnails-large', ['in',
                ['to-string', ['case', ['has', 'point_count'], ['get', 'coverId'], ['get', 'pageId']]],
                ['literal', Array.from(stillActiveLarge)]
            ]);
            try { mapInstance.moveLayer('wikimedia-thumbnails-large'); } catch (e) { }
        }
        if (mapInstance.getLayer('wikimedia-thumbnails-small')) {
            mapInstance.setFilter('wikimedia-thumbnails-small', ['in',
                ['to-string', ['case', ['has', 'point_count'], ['get', 'coverId'], ['get', 'pageId']]],
                ['literal', Array.from(stillActiveSmall)]
            ]);
            try { mapInstance.moveLayer('wikimedia-thumbnails-small'); } catch (e) { }
        }

        // 4. Load new images in PARALLEL
        if (queue.length > 0) {
            const batch = queue.slice(0, 15);
            batch.forEach(item => {
                if (loadedImages.has(item.imageId)) return;
                loadedImages.add(item.imageId);
                createCircularThumbnailImage(item.url)
                    .then(imgData => {
                        if (imgData && mapInstance.getStyle()) {
                            mapInstance.addImage(item.imageId, imgData);
                            // Ensure the map re-runs the logic to update filters with the new image
                            if (lastSelectedIds.has(item.pid)) {
                                scheduleThumbnailUpdate(mapInstance);
                            }
                        }
                    })
                    .catch(err => {
                        loadedImages.delete(item.imageId);
                    });
            });
        }
    } catch (e) {
        console.error('[WikimediaPhotos] simple update fail:', e);
    }
}

let updateThumbnailsTimer = null;
function scheduleThumbnailUpdate(mapInstance) {
    if (updateThumbnailsTimer) return;
    updateThumbnailsTimer = setTimeout(() => {
        updateThumbnailsTimer = null;
        if (mapInstance && isWikimediaPhotosVisible()) {
            requestAnimationFrame(() => updateThumbnailImages(mapInstance));
        }
    }, 150);
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
    const cleanName = (nameStr.includes(':') ? nameStr.split(':').slice(1).join(':') : nameStr).replace(/ /g, '_');
    // Use Wikimedia thumbnail API (Special:FilePath) — this is the reliable way
    // Note: This URL does a 302 redirect. When used in <img> tags (popups, previews)
    // this works fine. For canvas-based thumbnail generation we use resolveThumbUrls() instead.
    return `https://commons.wikimedia.org/w/index.php?title=Special:FilePath&file=${encodeURIComponent(cleanName)}&width=${width}`;
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
            clusterRadius: 48,
            clusterProperties: {
                'coverId': ['min', ['get', 'pageId']]
            }
        });
        console.log('[WikimediaPhotos] Source added:', WIKIMEDIA_SOURCE_ID);
    }

    // 1. Invisible base layer to anchor queryRenderedFeatures
    if (!mapInstance.getLayer('wikimedia-photos-base')) {
        mapInstance.addLayer({
            id: 'wikimedia-photos-base',
            type: 'circle',
            source: WIKIMEDIA_SOURCE_ID,
            minzoom: MIN_ZOOM_FOR_THUMBNAILS,
            paint: {
                // Large enough to be queried reliably, but fully transparent
                'circle-radius': 10,
                'circle-color': 'rgba(0,0,0,0.01)',
                'circle-opacity': 0.01,
                'circle-stroke-width': 0
            }
        });
    }

    // 2. Unified GL Thumbnails
    if (!mapInstance.getLayer('wikimedia-thumbnails-small')) {
        mapInstance.addLayer({
            id: 'wikimedia-thumbnails-small',
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
                'icon-size': 0.65 // ~36px
            },
            paint: { 'icon-opacity': 1 }
        });
    }

    if (!mapInstance.getLayer('wikimedia-thumbnails-large')) {
        mapInstance.addLayer({
            id: 'wikimedia-thumbnails-large',
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
                'icon-size': 1.15 // ~64px
            },
            paint: { 'icon-opacity': 1 }
        });
    }

    try {
        if (mapInstance.getLayer('wikimedia-thumbnails-small')) mapInstance.moveLayer('wikimedia-thumbnails-small');
        if (mapInstance.getLayer('wikimedia-thumbnails-large')) mapInstance.moveLayer('wikimedia-thumbnails-large');
    } catch (e) { }
}

function setupWikimediaEventListeners(mapInstance) {
    const layers = [
        'wikimedia-thumbnails-small',
        'wikimedia-thumbnails-large'
    ];
    layers.forEach(layerId => {
        mapInstance.on('click', layerId, (e) => {
            const f = e.features[0];
            if (f.properties.cluster) {
                mapInstance.getSource(WIKIMEDIA_SOURCE_ID).getClusterExpansionZoom(f.properties.cluster_id, (err, zoom) => {
                    if (!err) mapInstance.easeTo({ center: f.geometry.coordinates, zoom: zoom + 1 });
                });
            } else showPhotoPopup(mapInstance, f, layerId);
        });

        let hoverTimer = null;
        mapInstance.on('mouseenter', layerId, (e) => {
            mapInstance.getCanvas().style.cursor = 'pointer';
            if (hoverTimer) clearTimeout(hoverTimer);
            if (activePopup && activePopup.isOpen()) return;
            showPhotoPopup(mapInstance, e.features[0], layerId);
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

async function showPhotoPopup(mapInstance, feature, layerId) {
    const coordinates = feature.geometry.coordinates.slice();
    const { cluster, cluster_id } = feature.properties;

    // 1. Fetch photo data (handle clusters)
    let photos = [];
    if (cluster) {
        try {
            photos = await mapInstance.getSource(WIKIMEDIA_SOURCE_ID).getClusterLeaves(cluster_id, 10, 0);
        } catch (e) { photos = [feature]; }
    } else {
        photos = [feature];
    }

    if (!photos || photos.length === 0) return;

    const mainPhoto = photos[0];
    const cached = cachedFeatures.get(Number(mainPhoto.properties.pageId)) || cachedFeatures.get(String(mainPhoto.properties.pageId));
    let fastThumbUrl = cached?.properties?.thumbnailUrl || mainPhoto.properties.thumbnailUrl;

    const title = mainPhoto.properties.title || mainPhoto.properties.fileName;
    if (!fastThumbUrl && title) {
        fastThumbUrl = getPhotoThumbnailUrl(title, 200);
    }

    if (!fastThumbUrl) return;

    if (activePopup) activePopup.remove();

    const popupId = `wikimedia-popup-${Date.now()}`;
    const isSmall = layerId === 'wikimedia-thumbnails-small';
    const initSize = isSmall ? 36 : 64; // Match the underlying GL label size
    const initRadius = initSize / 2;

    activePopup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: true,
        className: 'wikimedia-photo-hover-popup',
        offset: [0, 0], // Center exactly over coordinate
        anchor: 'center'
    })
        .setLngLat(coordinates)
        .setHTML(`
        <div class="photo-hover-bubble" id="${popupId}" style="--initial-width: ${initSize}px; --initial-height: ${initSize}px; --initial-radius: ${initRadius}px; background-image: url('${fastThumbUrl}'); background-size: cover; background-position: center;">
            <div class="photo-hover-bubble__loader" style="display: none;"></div>
            <img class="photo-hover-bubble__image" aria-hidden="true" />
            <div class="photo-hover-bubble__count-badge" style="display:none;"></div>
        </div>
    `)
        .addTo(mapInstance);

    const container = document.getElementById(popupId);
    if (!container) return;

    const imgEl = container.querySelector('.photo-hover-bubble__image');
    const loaderEl = container.querySelector('.photo-hover-bubble__loader');
    const badgeEl = container.querySelector('.photo-hover-bubble__count-badge');

    if (photos.length > 1) {
        badgeEl.textContent = `+${photos.length - 1}`;
        badgeEl.style.display = 'flex';
    }

    // High res URL to load
    let sharpUrl = fastThumbUrl;
    if (title) sharpUrl = getPhotoThumbnailUrl(title, 600);

    // 2. Setup Aspect Ratio Morph
    const expandTimeout = setTimeout(() => {
        // If image is taking too long to load, show loader
        loaderEl.style.display = 'block';
    }, 500);

    const loader = new Image();
    loader.onload = () => {
        clearTimeout(expandTimeout);
        loaderEl.style.display = 'none';

        const aspect = loader.naturalWidth / loader.naturalHeight;
        const EXPANDED_MAX_WIDTH = 280;
        const EXPANDED_MAX_HEIGHT = 220;

        let finalWidth, finalHeight;
        if (aspect > 1) {
            finalWidth = EXPANDED_MAX_WIDTH;
            finalHeight = Math.max(120, EXPANDED_MAX_WIDTH / aspect);
        } else {
            finalHeight = EXPANDED_MAX_HEIGHT;
            finalWidth = Math.max(120, EXPANDED_MAX_HEIGHT * aspect);
        }

        container.style.setProperty('--expanded-width', `${finalWidth}px`);
        container.style.setProperty('--expanded-height', `${finalHeight}px`);

        // Wait for CSS variable application
        void container.offsetWidth;
        container.classList.add('expanded');

        imgEl.src = sharpUrl;

        // Wait for the expansion animation to start before fading in the sharp image over the blurred background
        setTimeout(() => {
            imgEl.style.opacity = '1';
        }, 50);
    };

    loader.onerror = () => {
        clearTimeout(expandTimeout);
        activePopup.remove();
    };

    loader.src = sharpUrl;

    container.addEventListener('click', (e) => {
        e.stopPropagation();
        activePopup.remove();
        showElevationChartPhotoPopup(mapInstance, mainPhoto, photos);
    });

    container.addEventListener('mouseleave', () => {
        if (activePopup) {
            activePopup.remove();
            activePopup = null;
        }
    });
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
        map.on('movestart', onMapMoveStart);
        map.on('moveend', onMapMoveEnd);
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
    // Check the last known state by trying the base layer
    const layer = map.getLayer('wikimedia-photos-base');
    if (layer) {
        // Refresh photos if zoom is sufficient
        if (map.getZoom() >= MIN_ZOOM_FOR_PHOTOS) refreshPhotos();
    }
}

// ── Spatial cache helpers ──

/**
 * Compute a LngLatBounds centered on the map center with a zoom-dependent radius.
 * This avoids fetching huge areas in 3D tilted view where getBounds() extends to the horizon.
 */
function getCenterBounds(mapInstance) {
    const center = mapInstance.getCenter();
    const zoom = mapInstance.getZoom();
    // Radius in degrees: ~0.15° at zoom 12, halving per zoom level
    const radius = 0.15 * Math.pow(2, 12 - zoom);
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

        // Short delay for MapLibre to process the new source data, then update thumbnails
        setTimeout(() => {
            if (map && isWikimediaPhotosVisible()) updateThumbnailImages(map);
        }, 100);
    } catch (e) {
        if (e.name === 'AbortError') return; // Pan cancelled this request, no problem
        console.warn('[WikimediaPhotos] Fetch failed:', e);
    }
}

/** Abort any in-flight fetch when the user starts panning/zooming */
function onMapMoveStart() {
    if (fetchAbortController) {
        fetchAbortController.abort();
        fetchAbortController = null;
    }
}

/** Only fetch when the map finishes moving completely */
function onMapMoveEnd() {
    if (!map || map.getZoom() < MIN_ZOOM_FOR_PHOTOS) return;
    if (!isWikimediaPhotosVisible()) return;

    if (idleDebounceTimer) clearTimeout(idleDebounceTimer);
    idleDebounceTimer = setTimeout(() => {
        refreshPhotos();
        requestAnimationFrame(() => updateThumbnailImages(map));
    }, 150);
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
    const layer = map.getLayer('wikimedia-photos-base');
    return layer && map.getLayoutProperty('wikimedia-photos-base', 'visibility') !== 'none';
}

export function forceRefreshWikimediaPhotos() {
    if (map && isInitialized) refreshPhotos();
}




export function destroyWikimediaPhotos() {
    if (!map) return;
    map.off('movestart', onMapMoveStart);
    map.off('moveend', onMapMoveEnd);
    resetSpatialCache();
    WIKIMEDIA_LAYERS.forEach(id => {
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

        const props = p.properties || p;
        const fileName = props.title || props.fileName || '';
        const thumbUrl = props.thumbnailUrl || (fileName ? getPhotoThumbnailUrl(fileName, 400) : '');

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
        img.src = getPhotoThumbnailUrl(fileName, 1024);
        img.alt = fileName || 'Photo';

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
        const props = p.properties || p;
        let title = props.title || props.fileName || 'Photo';
        title = String(title).replace('File:', '');

        // Show title immediately so it's snappy
        meta.innerHTML = `<div class="photo-lightbox__meta-title">${title}</div><span class="photo-lightbox__loading">Loading info...</span>`;

        const m = await fetchPhotoMetadata(props.title || props.fileName);
        if (m) {
            meta.innerHTML = `
                ${m.description ? `<div class="photo-lightbox__meta-description">${stripHtmlTags(m.description).slice(0, 250)}</div>` : ''}
                <div class="photo-lightbox__meta-author">© ${stripHtmlTags(m.author)}</div>
            `;
        } else {
            meta.innerHTML = `<div class="photo-lightbox__meta-title">${title}</div>`;
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
