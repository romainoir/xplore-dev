/**
 * routing-orchestrator.js — Routing mode toggle, offline/online router management,
 * offline network loading/refresh, debug network layer, directions manager setup.
 */

import { DEFAULT_NODE_CONNECTION_TOLERANCE_METERS, OfflineRouter } from '../routing/offline-path-router.js';
import { ROUTING_ICON_OFFLINE, ROUTING_ICON_ONLINE } from './map-init.js';
import { extractOverpassNetwork } from '../routing/overpass-network-fetcher.js';
import { extractOpenFreeMapNetwork } from '../routing/openfreemap-network-builder.js';
import { OrsRouter } from '../routing/openrouteservice-directions-client.js';
import { MaplibreDirectionsRouter } from '../routing/maplibre-directions-client.js';
import { Toast } from '../ui/toast.js';

function ensureFeatureCollection(maybeFc) {
    if (maybeFc && Array.isArray(maybeFc.features)) return maybeFc;
    return { type: 'FeatureCollection', features: [] };
}

// ─── Debug network constants ───
const DEBUG_NETWORK_SOURCE_ID = 'offline-router-network-debug';
const DEBUG_NETWORK_LAYER_ID = 'offline-router-network-debug';
const DEBUG_NETWORK_INTERSECTIONS_LAYER_ID = 'offline-router-network-debug-intersections';
const DEBUG_NETWORK_POIS_SOURCE_ID = 'offline-router-network-pois';
const DEBUG_NETWORK_POIS_LAYER_ID = 'offline-router-network-pois';
const DEBUG_NETWORK_POIS_LABEL_LAYER_ID = 'offline-router-network-pois-labels';

const DEBUG_NETWORK_SAC_SCALE_COLOR_EXPRESSION = Object.freeze([
    'let', 'sacScale',
    ['coalesce', ['get', 'sacScale', ['get', 'hiking']], ['get', 'sac_scale', ['get', 'hiking']], ['get', 'sacScale'], ['get', 'sac_scale']],
    ['match', ['var', 'sacScale'],
        'difficult_alpine_hiking', '#4a0404', 'demanding_alpine_hiking', '#4a0404',
        'alpine_hiking', '#e67e22', 'demanding_mountain_hiking', '#f7d774',
        'mountain_hiking', '#27ae60', 'hiking', '#a8f0c5', '#d0d4db']
]);

const DEBUG_NETWORK_POI_COLOR_EXPRESSION = Object.freeze([
    'match', ['coalesce', ['get', 'subclass'], ['get', 'class'], ''],
    'peak', '#2d7bd6', 'volcano', '#2d7bd6', 'mountain_pass', '#4a6d8c', 'saddle', '#4a6d8c',
    'viewpoint', '#35a3ad', 'restaurant', '#d97706', 'fast_food', '#d97706', 'cafe', '#d97706',
    'bar', '#b45309', 'pub', '#b45309',
    'parking', '#4b5563', 'parking_underground', '#4b5563', 'parking_multi-storey', '#4b5563',
    'parking_multistorey', '#4b5563', 'parking_multi_storey', '#4b5563',
    'alpine_hut', '#68b723', 'wilderness_hut', '#68b723', 'cabin', '#68b723',
    'shelter', '#68b723', 'hostel', '#68b723', 'guest_house', '#68b723', 'hotel', '#68b723',
    '#2d7bd6'
]);

const DEBUG_NETWORK_POI_LABEL_TEXT_EXPRESSION = Object.freeze([
    'let', 'rawNameCandidate',
    ['coalesce', ['get', 'name:fr'], ['get', 'name'], ['get', 'name:en'], ['get', 'ref'], ''],
    ['let', 'rawCategoryCandidate',
        ['coalesce', ['get', 'subclass'], ['get', 'class'], ''],
        ['let', 'labelName',
            ['case', ['==', ['typeof', ['var', 'rawNameCandidate']], 'string'], ['var', 'rawNameCandidate'],
                ['==', ['typeof', ['var', 'rawNameCandidate']], 'number'], ['to-string', ['var', 'rawNameCandidate']], ''],
            ['let', 'labelCategory',
                ['case', ['==', ['typeof', ['var', 'rawCategoryCandidate']], 'string'], ['var', 'rawCategoryCandidate'],
                    ['==', ['typeof', ['var', 'rawCategoryCandidate']], 'number'], ['to-string', ['var', 'rawCategoryCandidate']], ''],
                ['case', ['!=', ['var', 'labelName'], ''], ['var', 'labelName'],
                    ['match', ['var', 'labelCategory'],
                        'peak', 'Sommet', 'volcano', 'Volcan', 'mountain_pass', 'Col', 'saddle', 'Col',
                        'viewpoint', 'Point de vue', 'restaurant', 'Restaurant', 'fast_food', 'Restauration rapide',
                        'cafe', 'Café', 'bar', 'Bar', 'pub', 'Pub',
                        'parking', 'Parking', 'parking_underground', 'Parking', 'parking_multi-storey', 'Parking',
                        'parking_multistorey', 'Parking', 'parking_multi_storey', 'Parking',
                        'alpine_hut', 'Refuge', 'wilderness_hut', 'Cabane', 'cabin', 'Cabane', 'shelter', 'Abri',
                        'hostel', 'Auberge', 'guest_house', "Maison d'hôtes", 'hotel', 'Hôtel',
                        'spring', 'Source', 'water', 'Eau', 'drinking_water', 'Eau potable', ''
                    ]
                ]
            ]
        ]
    ]
]);

/**
 * Create the routing orchestrator.
 * @param {maplibregl.Map} map
 * @param {object} deps
 * @returns {object} routing API
 */
export function createRoutingOrchestrator(map, deps = {}) {
    const { preferOpenFreeMapNetwork = false } = deps;

    // ─── DOM references ───
    const routingModeToggle = document.getElementById('routingModeToggle');
    const routingModeIcon = routingModeToggle?.querySelector('.routing-mode-toggle__icon');
    const routingModeLabel = routingModeToggle?.querySelector('.routing-mode-toggle__text');
    const routingModeSpinner = routingModeToggle?.querySelector('.routing-mode-toggle__spinner');
    const routingModeLoadingText = routingModeToggle?.querySelector('.routing-mode-toggle__loading-text');
    const debugNetworkCheckbox = document.getElementById('debugNetworkCheckbox');
    const debugNetworkControl = document.getElementById('debugNetworkControl');

    // ─── Router setup ───
    const offlineRouter = new OfflineRouter({ networkUrl: './data/offline-network.geojson' });
    if (typeof offlineRouter.setNodeConnectionToleranceMeters === 'function') {
        offlineRouter.setNodeConnectionToleranceMeters(DEFAULT_NODE_CONNECTION_TOLERANCE_METERS);
    }

    const searchParams = new URLSearchParams(window.location.search);
    const maplibreDirectionsOptions = { fallbackRouter: offlineRouter };

    // Resolve online routing service config
    const globalDirectionsServiceUrl = typeof window !== 'undefined' && typeof window.MAPLIBRE_DIRECTIONS_SERVICE_URL === 'string' ? window.MAPLIBRE_DIRECTIONS_SERVICE_URL : null;
    const directionsServiceUrlParam = searchParams.get('directionsUrl');
    const resolvedServiceUrl = (directionsServiceUrlParam?.trim().length) ? directionsServiceUrlParam.trim() : (globalDirectionsServiceUrl?.trim().length ? globalDirectionsServiceUrl.trim() : null);

    const globalDirectionsApiKey = typeof window !== 'undefined' && typeof window.MAPLIBRE_DIRECTIONS_API_KEY === 'string' ? window.MAPLIBRE_DIRECTIONS_API_KEY : null;
    const directionsApiKeyParam = searchParams.get('directionsKey');
    const resolvedApiKey = (directionsApiKeyParam?.trim().length) ? directionsApiKeyParam.trim() : (globalDirectionsApiKey?.trim().length ? globalDirectionsApiKey.trim() : null);

    const globalDirectionsApiKeyParam = typeof window !== 'undefined' && typeof window.MAPLIBRE_DIRECTIONS_API_KEY_PARAM === 'string' ? window.MAPLIBRE_DIRECTIONS_API_KEY_PARAM : null;
    const directionsApiKeyNameParam = searchParams.get('directionsKeyParam');
    const resolvedApiKeyParam = (directionsApiKeyNameParam?.trim().length) ? directionsApiKeyNameParam.trim() : (globalDirectionsApiKeyParam?.trim().length ? globalDirectionsApiKeyParam.trim() : null);

    const maplibreRoutingConfigured = Boolean((resolvedServiceUrl?.trim().length) || (resolvedApiKey?.trim().length) || (resolvedApiKeyParam?.trim().length));

    if (resolvedServiceUrl) maplibreDirectionsOptions.serviceUrl = resolvedServiceUrl;
    if (resolvedApiKey) maplibreDirectionsOptions.apiKey = resolvedApiKey;
    if (resolvedApiKeyParam) maplibreDirectionsOptions.apiKeyParam = resolvedApiKeyParam;

    const maplibreRouter = maplibreRoutingConfigured ? new MaplibreDirectionsRouter(maplibreDirectionsOptions) : null;
    const orsRouter = new OrsRouter({ fallbackRouter: offlineRouter });
    const onlineRouter = maplibreRouter || orsRouter;

    // Sanitize sensitive params from URL
    const sensitiveParams = ['directionsKey', 'directionsKeyParam'];
    const sanitizedParams = sensitiveParams.filter(p => searchParams.has(p));
    if (sanitizedParams.length && window.history?.replaceState) {
        sanitizedParams.forEach(p => searchParams.delete(p));
        const newSearch = searchParams.toString();
        const newUrl = `${window.location.pathname}${newSearch ? `?${newSearch}` : ''}${window.location.hash || ''}`;
        window.history.replaceState({}, document.title, newUrl);
    }

    const routers = { offline: offlineRouter, ...(onlineRouter ? { online: onlineRouter } : {}) };
    const hasOnlineRouter = Boolean(onlineRouter);
    let activeRouterKey = 'offline'; // Default to offline as per user request
    let offlineNetworkCoverage = null;
    let offlineNetworkRefreshPromise = null;
    let offlineNetworkLoadingCount = 0;
    let offlineNetworkPois = null;
    let debugNetworkVisible = false;
    let debugNetworkData = null;
    let directionsManager = null;

    // ─── Routing mode UI ───
    const updateRoutingModeToggle = () => {
        if (!routingModeToggle) return;
        const offlineActive = activeRouterKey === 'offline';
        const isLoadingOffline = offlineNetworkLoadingCount > 0;
        const onlineAvailable = Boolean(routers.online);

        // Update persistent loading toast
        if (isLoadingOffline && offlineActive) {
            Toast.show('Loading offline routing data...', 'info', 'ℹ', { persistent: true });
        } else if (offlineNetworkLoadingCount === 0) {
            // Only hide if we were the one showing it (implicit check via loading state)
            // If another toast was shown manually, it might be overwritten, but that's okay for now
            Toast.hide();
        }

        routingModeToggle.classList.toggle('active', offlineActive);
        routingModeToggle.classList.toggle('is-offline', offlineActive);
        routingModeToggle.classList.toggle('is-online', !offlineActive);
        routingModeToggle.classList.toggle('is-loading', isLoadingOffline);
        routingModeToggle.classList.toggle('is-disabled', !onlineAvailable);
        routingModeToggle.disabled = !onlineAvailable;
        routingModeToggle.setAttribute('aria-pressed', offlineActive ? 'true' : 'false');
        routingModeToggle.dataset.routingMode = offlineActive ? 'offline' : 'online';
        if (routingModeLabel) routingModeLabel.textContent = offlineActive ? 'Offline routing' : 'Online routing';
        if (routingModeIcon) routingModeIcon.src = offlineActive ? ROUTING_ICON_OFFLINE : ROUTING_ICON_ONLINE;
        if (routingModeLoadingText) routingModeLoadingText.setAttribute('aria-hidden', isLoadingOffline ? 'false' : 'true');
        let titleText, ariaLabel;
        if (!onlineAvailable) {
            routingModeToggle.setAttribute('aria-busy', 'false');
            titleText = 'Online routing unavailable';
            ariaLabel = 'Online routing is unavailable because no online service is configured.';
        } else if (isLoadingOffline) {
            routingModeToggle.setAttribute('aria-busy', 'true');
            titleText = ariaLabel = 'Loading offline routing network…';
        } else {
            routingModeToggle.setAttribute('aria-busy', 'false');
            titleText = offlineActive ? 'Switch to online routing' : 'Switch to offline routing';
            ariaLabel = offlineActive ? 'Offline routing enabled. Activate to switch to online routing.' : 'Online routing enabled. Activate to switch to offline routing.';
        }
        routingModeToggle.title = titleText;
        routingModeToggle.setAttribute('aria-label', ariaLabel);
    };

    const beginOfflineNetworkLoading = () => { offlineNetworkLoadingCount++; updateRoutingModeToggle(); };
    const endOfflineNetworkLoading = () => { if (offlineNetworkLoadingCount > 0) offlineNetworkLoadingCount--; updateRoutingModeToggle(); };
    const trackOfflineNetworkLoading = async (promise) => { beginOfflineNetworkLoading(); try { return await promise; } finally { endOfflineNetworkLoading(); } };

    // ─── Debug network control ───
    const updateDebugNetworkControlState = (active) => {
        if (!debugNetworkCheckbox) return;
        const isActive = Boolean(active && activeRouterKey === 'offline');
        debugNetworkCheckbox.checked = isActive;
        if (debugNetworkControl) {
            debugNetworkControl.classList.toggle('is-active', isActive);
            debugNetworkControl.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        }
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
                if (debugNetworkVisible) hideDebugNetworkLayer();
                debugNetworkVisible = false;
                updateDebugNetworkControlState(false);
            } else {
                updateDebugNetworkControlState(debugNetworkVisible);
            }
        }
    };

    // ─── Debug network layers ───
    const ensureMapStyleReady = () => {
        if (!map || typeof map.isStyleLoaded !== 'function') return Promise.resolve();
        if (map.isStyleLoaded()) return Promise.resolve();
        return new Promise(resolve => map.once('style.load', resolve));
    };

    const loadDebugNetworkData = async () => {
        if (activeRouterKey !== 'offline') return null;
        if (debugNetworkData) return debugNetworkData;
        try {
            await trackOfflineNetworkLoading(offlineRouter.ensureReady());
            const dataset = typeof offlineRouter.getNetworkDebugGeoJSON === 'function' ? offlineRouter.getNetworkDebugGeoJSON({ intersectionsOnly: true }) : offlineRouter.getNetworkGeoJSON();
            if (dataset && Array.isArray(dataset?.features) && dataset.features.length > 0) { debugNetworkData = dataset; return debugNetworkData; }
        } catch (e) { console.warn('Failed to access cached offline network data', e); }
        try {
            const response = await trackOfflineNetworkLoading(fetch('./data/offline-network.geojson', { cache: 'no-store' }));
            if (!response.ok) throw new Error(`Debug network request failed (${response.status})`);
            const fallback = await response.json();
            if (Array.isArray(fallback?.features) && fallback.features.length > 0) { debugNetworkData = fallback; return debugNetworkData; }
            console.warn('Offline routing network debug dataset is empty');
            return null;
        } catch (e) { console.error('Failed to load offline routing network for debugging', e); return null; }
    };

    const applyDebugNetworkLayer = async () => {
        if (activeRouterKey !== 'offline') return false;
        const data = await loadDebugNetworkData();
        if (!data) return false;
        await ensureMapStyleReady();
        if (!map.getSource(DEBUG_NETWORK_SOURCE_ID)) map.addSource(DEBUG_NETWORK_SOURCE_ID, { type: 'geojson', data });
        else map.getSource(DEBUG_NETWORK_SOURCE_ID).setData(data);
        if (!map.getLayer(DEBUG_NETWORK_LAYER_ID)) {
            map.addLayer({ id: DEBUG_NETWORK_LAYER_ID, type: 'line', source: DEBUG_NETWORK_SOURCE_ID, paint: { 'line-color': DEBUG_NETWORK_SAC_SCALE_COLOR_EXPRESSION, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.1, 13, 1.8, 16, 3.2], 'line-opacity': 0.65 } });
        }
        map.setLayoutProperty(DEBUG_NETWORK_LAYER_ID, 'visibility', 'visible');
        if (!map.getLayer(DEBUG_NETWORK_INTERSECTIONS_LAYER_ID)) {
            map.addLayer({ id: DEBUG_NETWORK_INTERSECTIONS_LAYER_ID, type: 'circle', source: DEBUG_NETWORK_SOURCE_ID, filter: ['all', ['==', ['geometry-type'], 'Point'], ['>=', ['coalesce', ['get', 'nodeDegree'], 0], 3]], paint: { 'circle-radius': ['interpolate', ['exponential', 1.4], ['zoom'], 8, 0.6, 12, 1.4, 16, 2.6], 'circle-color': '#2ca25f', 'circle-stroke-color': '#0b4222', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, 0.4, 16, 0.9], 'circle-opacity': 0.85 } });
        }
        if (map.getLayer(DEBUG_NETWORK_INTERSECTIONS_LAYER_ID)) map.setLayoutProperty(DEBUG_NETWORK_INTERSECTIONS_LAYER_ID, 'visibility', 'visible');

        // POIs
        const poiCollection = offlineNetworkPois;
        const emptyCollection = { type: 'FeatureCollection', features: [] };
        const hasPois = Array.isArray(poiCollection?.features) && poiCollection.features.length > 0;
        if (!map.getSource(DEBUG_NETWORK_POIS_SOURCE_ID)) map.addSource(DEBUG_NETWORK_POIS_SOURCE_ID, { type: 'geojson', data: hasPois ? poiCollection : emptyCollection });
        else map.getSource(DEBUG_NETWORK_POIS_SOURCE_ID).setData(hasPois ? poiCollection : emptyCollection);
        if (hasPois) {
            if (!map.getLayer(DEBUG_NETWORK_POIS_LAYER_ID)) {
                map.addLayer({ id: DEBUG_NETWORK_POIS_LAYER_ID, type: 'circle', source: DEBUG_NETWORK_POIS_SOURCE_ID, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2.2, 12, 3.4, 15, 5.4], 'circle-color': DEBUG_NETWORK_POI_COLOR_EXPRESSION, 'circle-stroke-color': '#0f172a', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, 0.4, 15, 1.1], 'circle-opacity': 0.9, 'circle-stroke-opacity': 0.95 } });
            }
            map.setLayoutProperty(DEBUG_NETWORK_POIS_LAYER_ID, 'visibility', 'visible');
            if (!map.getLayer(DEBUG_NETWORK_POIS_LABEL_LAYER_ID)) {
                map.addLayer({ id: DEBUG_NETWORK_POIS_LABEL_LAYER_ID, type: 'symbol', source: DEBUG_NETWORK_POIS_SOURCE_ID, filter: ['==', ['geometry-type'], 'Point'], layout: { 'text-field': DEBUG_NETWORK_POI_LABEL_TEXT_EXPRESSION, 'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 13, 13, 16, 16], 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-variable-anchor': ['top', 'right', 'left', 'bottom'], 'text-radial-offset': 0.6, 'text-max-width': 8, 'text-justify': 'center', 'text-line-height': 1.2, 'text-padding': 2 }, paint: { 'text-color': DEBUG_NETWORK_POI_COLOR_EXPRESSION, 'text-halo-color': 'rgba(255, 255, 255, 0.94)', 'text-halo-width': 1.2, 'text-halo-blur': 0.2 } });
            }
            map.setLayoutProperty(DEBUG_NETWORK_POIS_LABEL_LAYER_ID, 'visibility', 'visible');
        } else {
            if (map.getLayer(DEBUG_NETWORK_POIS_LAYER_ID)) map.setLayoutProperty(DEBUG_NETWORK_POIS_LAYER_ID, 'visibility', 'none');
            if (map.getLayer(DEBUG_NETWORK_POIS_LABEL_LAYER_ID)) map.setLayoutProperty(DEBUG_NETWORK_POIS_LABEL_LAYER_ID, 'visibility', 'none');
        }
        bringDebugNetworkToFront();
        return true;
    };

    const hideDebugNetworkLayer = () => {
        [DEBUG_NETWORK_LAYER_ID, DEBUG_NETWORK_INTERSECTIONS_LAYER_ID, DEBUG_NETWORK_POIS_LAYER_ID, DEBUG_NETWORK_POIS_LABEL_LAYER_ID].forEach(id => {
            if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
        });
    };

    const bringDebugNetworkToFront = () => {
        if (!map || typeof map.moveLayer !== 'function') return;
        [DEBUG_NETWORK_LAYER_ID, DEBUG_NETWORK_INTERSECTIONS_LAYER_ID, DEBUG_NETWORK_POIS_LAYER_ID, DEBUG_NETWORK_POIS_LABEL_LAYER_ID].forEach(id => {
            if (map.getLayer(id)) map.moveLayer(id);
        });
    };

    // ─── Bounds helpers ───
    const boundsToPlain = (bounds) => {
        if (!bounds) return null;
        if (typeof bounds.getWest === 'function') return { west: bounds.getWest(), east: bounds.getEast(), south: bounds.getSouth(), north: bounds.getNorth() };
        const w = Number(bounds.west), e = Number(bounds.east), s = Number(bounds.south), n = Number(bounds.north);
        if ([w, e, s, n].some(v => !Number.isFinite(v))) return null;
        return { west: w, east: e, south: s, north: n };
    };
    const boundsContains = (outer, inner, epsilon = 1e-6) => {
        if (!outer || !inner) return false;
        return inner.west >= outer.west - epsilon && inner.east <= outer.east + epsilon && inner.south >= outer.south - epsilon && inner.north <= outer.north + epsilon;
    };
    const mergeBounds = (...boundsList) => {
        let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
        boundsList.forEach(entry => { const p = boundsToPlain(entry); if (!p) return; if (p.west < w) w = p.west; if (p.east > e) e = p.east; if (p.south < s) s = p.south; if (p.north > n) n = p.north; });
        if (![w, e, s, n].every(v => Number.isFinite(v))) return null;
        return { west: w, east: e, south: s, north: n };
    };
    const deriveOverpassCenter = (bounds) => {
        const p = boundsToPlain(bounds); if (!p) return null;
        const lat = (p.north + p.south) / 2; const lon = (p.east + p.west) / 2;
        if (![lat, lon].every(v => Number.isFinite(v))) return null;
        return { lat, lon };
    };
    const computeCoordinateBounds = (coordinates) => {
        if (!Array.isArray(coordinates) || !coordinates.length) return null;
        let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
        coordinates.forEach(coord => {
            if (!Array.isArray(coord) || coord.length < 2) return;
            const lng = Number(coord[0]), lat = Number(coord[1]);
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
            if (lng < w) w = lng; if (lng > e) e = lng; if (lat < s) s = lat; if (lat > n) n = lat;
        });
        if (!Number.isFinite(w)) return null;
        const expand = (min, max) => min === max ? [min - 1e-6, max + 1e-6] : [min, max];
        const [nw, ne] = expand(w, e); const [ns, nn] = expand(s, n);
        return { west: nw, east: ne, south: ns, north: nn };
    };
    const shouldRefreshOfflineNetwork = () => {
        if (!map || typeof map.getBounds !== 'function') return false;
        const current = boundsToPlain(map.getBounds()); if (!current) return false;
        if (!offlineNetworkCoverage) return true;
        return !boundsContains(offlineNetworkCoverage, current);
    };

    // ─── Refresh offline network ───
    const refreshOfflineNetwork = async (options = {}) => {
        if (!map || activeRouterKey !== 'offline' || offlineNetworkRefreshPromise) return offlineNetworkRefreshPromise;
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
                    networkResult = { network: await extractOpenFreeMapNetwork(map, { targetBounds }), coverageBounds: null, pois: null };
                } else {
                    let overpassCenter = Number.isFinite(centerLat) && Number.isFinite(centerLon) ? { lat: centerLat, lon: centerLon } : null;
                    if (!overpassCenter) { const fc = deriveOverpassCenter(targetBounds ?? fallbackBounds); if (fc) overpassCenter = fc; }
                    if (!overpassCenter) throw new Error('Unable to determine center coordinate for Overpass network extraction');
                    networkResult = await extractOverpassNetwork(overpassCenter);
                }
                const { network, coverageBounds } = networkResult;
                if (network && Array.isArray(network.features) && network.features.length) {
                    await offlineRouter.setNetworkGeoJSON(network);
                    const debugDataset = typeof offlineRouter.getNetworkDebugGeoJSON === 'function' ? offlineRouter.getNetworkDebugGeoJSON({ intersectionsOnly: true }) : network;
                    debugNetworkData = debugDataset || network;
                    offlineNetworkCoverage = coverageBounds ?? boundsToPlain(targetBounds ?? fallbackBounds);
                    offlineNetworkPois = ensureFeatureCollection(networkResult.pois);
                    if (directionsManager?.setOfflinePointsOfInterest) directionsManager.setOfflinePointsOfInterest(offlineNetworkPois);
                    const poiCoords = (offlineNetworkPois.features || []).map(f => f?.geometry?.coordinates).filter(c => Array.isArray(c) && c.length >= 2);
                    if (debugNetworkVisible) await applyDebugNetworkLayer();
                } else {
                    console.warn(`${preferOpenFreeMapNetwork ? 'OpenFreeMap' : 'Overpass'} network extraction returned no features`);
                }
            } catch (e) {
                console.error(`Failed to rebuild offline routing network`, e);
            } finally {
                offlineNetworkRefreshPromise = null;
                endOfflineNetworkLoading();
            }
        })();
        return offlineNetworkRefreshPromise;
    };

    // Initialize routing mode toggle
    updateRoutingModeToggle();
    updateDebugNetworkAvailability();

    return {
        offlineRouter,
        onlineRouter,
        routers,
        get activeRouterKey() { return activeRouterKey; },
        set activeRouterKey(v) { activeRouterKey = v; },
        get directionsManager() { return directionsManager; },
        set directionsManager(v) { directionsManager = v; },
        get debugNetworkVisible() { return debugNetworkVisible; },
        set debugNetworkVisible(v) { debugNetworkVisible = v; },
        get debugNetworkData() { return debugNetworkData; },
        set debugNetworkData(v) { debugNetworkData = v; },
        get offlineNetworkPois() { return offlineNetworkPois; },
        bringDebugNetworkToFront,
        applyDebugNetworkLayer,
        hideDebugNetworkLayer,
        updateRoutingModeToggle,
        updateDebugNetworkControlState,
        updateDebugNetworkAvailability,
        refreshOfflineNetwork,
        shouldRefreshOfflineNetwork,
        computeCoordinateBounds,
        hasOnlineRouter,
        maplibreRoutingConfigured,
    };
}
