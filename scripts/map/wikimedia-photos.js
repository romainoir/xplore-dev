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
const WIKIMEDIA_LARGE_CLUSTER_LAYER_ID = 'wikimedia-photos-large-clusters';  // For querying 10+ clusters
const WIKIMEDIA_PHOTO_ICON_ID = 'wikimedia-photo-marker';

/** Minimum zoom level to display and fetch photos */
/** Minimum zoom level to display and fetch photos */
const MIN_ZOOM_FOR_PHOTOS = 14;

/** Minimum zoom level to show photo thumbnails for large clusters */
const MIN_ZOOM_FOR_THUMBNAILS = 14;

/** All layer IDs for Wikimedia photos */
const WIKIMEDIA_LAYERS = [
    WIKIMEDIA_LAYER_ID,
    WIKIMEDIA_CLUSTER_LAYER_ID,
    WIKIMEDIA_CLUSTER_COUNT_LAYER_ID,
    WIKIMEDIA_LARGE_CLUSTER_LAYER_ID,
    'wikimedia-thumbnails-cluster',
    'wikimedia-thumbnails-single'
];


/** Maximum number of photos to fetch per request */
const FETCH_LIMIT = 500;

/** Debounce delay for map move events (ms) */
const FETCH_DEBOUNCE_MS = 400;

/** Photo marker styling */
const PHOTO_MARKER_SIZE = 24;
const PHOTO_MARKER_COLOR = '#e74c3c';
const PHOTO_MARKER_HOVER_COLOR = '#c0392b';

/** Thumbnail marker size (diameter in pixels) */
const THUMBNAIL_MARKER_SIZE = 56;

/** Distance threshold to show thumbnails near POIs (meters) */
const POI_PROXIMITY_THRESHOLD_METERS = 50;

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

let map = null;
let isInitialized = false;
let fetchDebounceTimer = null;
let activePopup = null;

/** Map of coordinateKey -> maplibregl.Marker for thumbnail markers */
const thumbnailMarkers = new Map();

/** POI coordinates from offline network for proximity checks */
let networkPoiCoordinates = [];

// ─────────────────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────────────────

function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2)
        ;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; // Distance in km
    return d * 1000;
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

function isCloseToAnyPoi(photoLat, photoLon) {
    if (!networkPoiCoordinates || networkPoiCoordinates.length === 0) return false;
    // Optimization: Check bounds first if we had sorted data, but for now linear scan
    // Assuming POI list isn't massive (usually < 1000 for local view)
    for (const poi of networkPoiCoordinates) {
        if (getDistanceFromLatLonInMeters(photoLat, photoLon, poi[1], poi[0]) <= POI_PROXIMITY_THRESHOLD_METERS) {
            return true;
        }
    }
    return false;
}

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

const loadedImages = new Set();

/**
 * Scans the map for photos that need thumbnails, fetches them, and adds to sprite.
 * Also toggles feature-state for single photos to show/hide thumbnails.
 */
async function updateThumbnailImages(mapInstance) {
    const currentZoom = mapInstance.getZoom();
    if (currentZoom < MIN_ZOOM_FOR_THUMBNAILS || !isWikimediaPhotosVisible()) {
        return;
    }

    const source = mapInstance.getSource(WIKIMEDIA_SOURCE_ID);
    if (!source) return;

    // Query features from our thumbnail layers to see what's on screen
    const layersToQuery = [
        'wikimedia-thumbnails-cluster',
        'wikimedia-thumbnails-single',
        WIKIMEDIA_CLUSTER_LAYER_ID,
        WIKIMEDIA_LAYER_ID
    ].filter(id => mapInstance.getLayer(id));

    if (layersToQuery.length === 0) return;

    const width = mapInstance.getCanvas().width;
    const height = mapInstance.getCanvas().height;
    const margin = 100;

    const features = mapInstance.queryRenderedFeatures([
        [-margin, -margin],
        [width + margin, height + margin]
    ], { layers: layersToQuery });

    // Determine global sparsity
    const totalVisible = features.length;
    const isSparse = totalVisible < 25;

    // Process features
    const processedIds = new Set();

    features.forEach(async (f) => {
        const isCluster = !!f.properties.cluster;
        const id = f.id;

        // Skip duplicates in this pass
        if (id !== undefined && processedIds.has(id)) return;
        if (id !== undefined) processedIds.add(id);

        // Identify the Image ID we need
        const pageId = isCluster ? f.properties.coverId : f.properties.pageId;

        if (!pageId) return;

        const imageId = 'thumb-' + pageId;

        let shouldShow = true;

        // Logic for Singles: Only show if Sparse or POI
        if (!isCluster) {
            const coords = f.geometry.coordinates;
            const isNearPoi = networkPoiCoordinates.length > 0 && isCloseToAnyPoi(coords[1], coords[0]);
            shouldShow = isSparse || isNearPoi;

            // Update GL State
            if (f.id) {
                const state = mapInstance.getFeatureState({ source: WIKIMEDIA_SOURCE_ID, id: f.id });
                if (state.show_thumbnail !== shouldShow) {
                    mapInstance.setFeatureState({ source: WIKIMEDIA_SOURCE_ID, id: f.id }, { show_thumbnail: shouldShow });
                }
            }
        }
        // Clusters always try to show thumbnail

        if (!shouldShow) return;

        // Load Image if not in sprite
        if (!mapInstance.hasImage(imageId) && !loadedImages.has(imageId)) {
            loadedImages.add(imageId); // Mark pending

            try {
                let fileName = null;
                if (isCluster) {
                    const leaves = await source.getClusterLeaves(f.properties.cluster_id, 20, 0);
                    const match = leaves.find(l => l.properties.pageId === pageId);
                    if (match) fileName = match.properties.fileName;
                } else {
                    fileName = f.properties.fileName;
                }

                if (fileName) {
                    const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}?width=100`;
                    const imageData = await createCircularThumbnailImage(url);
                    if (!mapInstance.hasImage(imageId)) {
                        mapInstance.addImage(imageId, imageData);
                    }
                }
            } catch (err) {
                loadedImages.delete(imageId);
            }
        }
    });
}

function clearThumbnailImages() {
    loadedImages.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Wikimedia API
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchWikimediaPhotosInBounds(bounds) {
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('list', 'geosearch');
    url.searchParams.set('gsbbox', `${bounds.getNorth()}|${bounds.getWest()}|${bounds.getSouth()}|${bounds.getEast()}`);
    url.searchParams.set('gsnamespace', '6');
    url.searchParams.set('gslimit', String(FETCH_LIMIT));
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');

    try {
        const response = await fetch(url.toString());
        const data = await response.json();
        if (!data.query?.geosearch) return { type: 'FeatureCollection', features: [] };
        const features = data.query.geosearch.map(item => ({
            type: 'Feature',
            id: String(item.pageid), // Required for setFeatureState
            geometry: { type: 'Point', coordinates: [item.lon, item.lat] },
            properties: {
                title: item.title,
                pageId: item.pageid,
                fileName: item.title.includes(':') ? item.title.split(':').slice(1).join(':') : item.title
            }
        }));
        return { type: 'FeatureCollection', features };
    } catch (e) {
        return { type: 'FeatureCollection', features: [] };
    }
}

async function fetchPhotoMetadata(title) {
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
        return {
            author: meta.Artist?.value || info.user || 'Unknown',
            description: meta.ImageDescription?.value || '',
            license: meta.License?.value || 'Unknown'
        };
    } catch (e) { return null; }
}

export function getPhotoThumbnailUrl(fileName, width = 400) {
    if (!fileName) return '';
    // Remove common prefixes if they exist (File:, Fichier:, etc.)
    const cleanName = fileName.replace(/^(File|Fichier|Image|Schermata|Datei|Archivio|Archivo|Imagem|Файл):/i, '');
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(cleanName)}?width=${width}`;
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
            clusterRadius: 30,
            // Aggregate the 'pageId' to choose a cover photo for the cluster (using min as a deterministic pick)
            clusterProperties: {
                'coverId': ['min', ['get', 'pageId']]
            }
        });
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
            }
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
                'icon-padding': 2
            }
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
                'text-offset': [1.2, 0], // Offset to right of icon
                'text-anchor': 'left',
                'text-allow-overlap': true
            },
            paint: {
                'text-color': '#ffffff',
                'text-halo-color': 'rgba(0, 0, 0, 0.7)',
                'text-halo-width': 1.5
            }
        });
    }

    // 4. GL Thumbnails (Clusters)
    // Uses the aggregated 'coverId' to construct image name 'thumb-{coverId}'
    if (!mapInstance.getLayer('wikimedia-thumbnails-cluster')) {
        mapInstance.addLayer({
            id: 'wikimedia-thumbnails-cluster',
            type: 'symbol',
            source: WIKIMEDIA_SOURCE_ID,
            minzoom: MIN_ZOOM_FOR_PHOTOS,
            filter: ['all', ['has', 'point_count'], ['>=', ['get', 'point_count'], 10]],
            layout: {
                'icon-image': ['concat', 'thumb-', ['get', 'coverId']],
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'icon-size': 1 // Thumbnails are generated at correct size (56px)
            },
            paint: {
                // Fade in or default to 1. If image missing, nothing renders.
                'icon-opacity': 1
            }
        });
    }

    // 5. GL Thumbnails (Singles)
    // Uses 'pageId' and 'feature-state' to conditionally show
    if (!mapInstance.getLayer('wikimedia-thumbnails-single')) {
        mapInstance.addLayer({
            id: 'wikimedia-thumbnails-single',
            type: 'symbol',
            source: WIKIMEDIA_SOURCE_ID,
            minzoom: MIN_ZOOM_FOR_PHOTOS,
            filter: ['!', ['has', 'point_count']],
            layout: {
                'icon-image': ['concat', 'thumb-', ['get', 'pageId']],
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'icon-size': 1
            },
            paint: {
                'icon-opacity': ['case', ['boolean', ['feature-state', 'show_thumbnail'], false], 1, 0]
            }
        });
    }

    // 6. Cluster Count Badge (for Large Clusters with Thumbnail)
    // We can't put text ON the thumbnail efficiently without overlap issues, 
    // but the thumbnail implies "Many".
    // We'll skip specific badge logic for now, or rely on count layer (filtered <10).
    // Large clusters (>=10) won't have text. This is consistent with previous logic.
}

function setupWikimediaEventListeners(mapInstance) {
    const layers = [
        WIKIMEDIA_LAYER_ID,
        WIKIMEDIA_CLUSTER_LAYER_ID,
        'wikimedia-thumbnails-cluster',
        'wikimedia-thumbnails-single'
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
        img.src = getPhotoThumbnailUrl(p.properties.fileName, 600);
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
        if (enabled && map.getZoom() >= MIN_ZOOM_FOR_PHOTOS) refreshPhotos();
        isInitialized = true;
        setWikimediaPhotosEnabled(enabled);
    };

    if (map.isStyleLoaded()) initialize();
    else map.once('style.load', initialize);
}

async function refreshPhotos() {
    if (!map || map.getZoom() < MIN_ZOOM_FOR_PHOTOS) return;
    // Don't fetch if layer is disabled
    if (!isWikimediaPhotosVisible()) return;

    const data = await fetchWikimediaPhotosInBounds(map.getBounds());
    const source = map.getSource(WIKIMEDIA_SOURCE_ID);
    if (source) source.setData(data);
    updateThumbnailImages(map);
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
        // Clear data to prevent any background processing
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

export function setNetworkPoiCoordinates(poiCoords) {
    if (Array.isArray(poiCoords)) networkPoiCoordinates = poiCoords.filter(c => Array.isArray(c) && c.length >= 2);
    else networkPoiCoordinates = [];
    if (map && isInitialized) updateThumbnailImages(map);
}

export function destroyWikimediaPhotos() {
    if (!map) return;
    map.off('moveend', onMapMoveEnd);
    [WIKIMEDIA_LAYER_ID, WIKIMEDIA_CLUSTER_LAYER_ID, WIKIMEDIA_CLUSTER_COUNT_LAYER_ID, WIKIMEDIA_LARGE_CLUSTER_LAYER_ID].forEach(id => {
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

        const img = document.createElement('img');
        img.className = 'photo-lightbox__image';
        img.loading = i === 0 ? 'eager' : 'lazy';
        const fileName = p.fileName || (p.thumbnailUrl ? decodeURIComponent(p.thumbnailUrl.split('/').pop().split('?')[0]) : '');
        img.src = getPhotoThumbnailUrl(fileName, 1200); // Large size for lightbox
        img.alt = p.title || 'Photo';

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
        lightbox.querySelectorAll('.photo-lightbox__dot').forEach((d, i) =>
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
        meta.innerHTML = '<span class="photo-lightbox__loading">Loading info...</span>';
        const title = p.title || `File:${p.fileName}`;
        const m = await fetchPhotoMetadata(title);
        if (m) {
            meta.innerHTML = `
                ${m.description ? `<div class="photo-lightbox__meta-description">${stripHtmlTags(m.description).slice(0, 250)}</div>` : ''}
                <div class="photo-lightbox__meta-author">© ${stripHtmlTags(m.author)}</div>
            `;
        } else {
            meta.innerHTML = '';
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
    setNetworkPoiCoordinates,
    destroyWikimediaPhotos,
    showElevationChartPhotoPopup
};
