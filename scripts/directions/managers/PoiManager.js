/**
 * PoiManager - Manages Points of Interest along a route
 * 
 * Responsibilities:
 * - Fetching POIs (from offline collection or Overpass API)
 * - Processing, clustering, and filtering POIs
 * - Managing POI state and visibility
 * - Updating map layer data for POIs
 */

import {
    EMPTY_COLLECTION,
    turfApi,
    POI_SEARCH_RADIUS_METERS,
    POI_CATEGORY_DISTANCE_OVERRIDES,
    POI_MAX_SEARCH_RADIUS_METERS,
    DEFAULT_POI_COLOR,
    DEFAULT_POI_TITLE,
    WATER_CATEGORY_SET,
    WATER_HOST_CATEGORY_SET,
    WATER_MERGE_PROXIMITY_KM,
    ROUTE_POI_SOURCE_ID,
    ROUTE_POI_LAYER_ID,
    ROUTE_POI_ICON_LAYER_ID,
    ROUTE_POI_LABEL_LAYER_ID
} from '../constants.js';

import {
    resolveRoutePoiIconKey,
    computePoiIconDisplayMetrics,
    clusterRoutePointsOfInterest,
    markElevationProfileLabelLeaders,
    shouldShowPoiLabel,
    resolvePoiName,
    parsePoiElevation,
    computePeakImportanceScore,
    fetchOverpassRoutePois,
    resolvePoiDefinition,
    buildPoiIdentifier
} from '../utils.js';

import {
    ensurePoiIconImages,
    getPoiIconImageId,
    getPoiIconImageIdForDay,
    getPoiIconMetadata,
    getPoiIconSvgContent
} from '../../xmap-poi-icons.js';

export class PoiManager {
    /**
     * @param {object} options
     * @param {object} options.map - MapLibre GL JS map instance
     * @param {function} options.getRouteProfile - Function that returns the current route profile
     * @param {function} options.getOfflinePoiCollection - Function that returns offline POI collection
     * @param {function} options.getCutSegments - Function that returns current cut segments
     * @param {function} options.getCurrentMode - Function that returns current routing mode
     * @param {function} options.getModeColors - Function that returns mode color mapping
     * @param {function} options.getProfileMode - Function that returns current profile mode ('poi', 'slope', etc.)
     * @param {function} options.onPoisUpdated - Callback when POIs are updated
     */
    constructor(options = {}) {
        this.map = options.map;
        this.getRouteProfile = options.getRouteProfile || (() => null);
        this.getOfflinePoiCollection = options.getOfflinePoiCollection || (() => null);
        this.getCutSegments = options.getCutSegments || (() => []);
        this.getCurrentMode = options.getCurrentMode || (() => 'foot-hiking');
        this.getModeColors = options.getModeColors || (() => ({}));
        this.getProfileMode = options.getProfileMode || (() => 'slope');
        this.onPoisUpdated = options.onPoisUpdated || (() => { });

        // State
        this.routePointsOfInterest = [];
        this.pendingPoiRequest = null;
        this.pendingPoiAbortController = null;
    }

    /**
     * Set the map instance (for delayed initialization)
     * @param {object} map - MapLibre GL JS map instance
     */
    setMap(map) {
        this.map = map;
    }

    /**
     * Get the current POIs
     * @returns {Array} Array of POI objects
     */
    getPois() {
        return this.routePointsOfInterest;
    }

    /**
     * Set POIs and trigger map update
     * @param {Array} pois - Array of POI objects
     */
    setRoutePointsOfInterest(pois) {
        this.routePointsOfInterest = Array.isArray(pois) ? pois : [];
        this.updateRoutePoiData();
        this.updateRoutePoiLayerVisibility();
        this.onPoisUpdated(this.routePointsOfInterest);
    }

    /**
     * Update map source data with current POIs
     */
    updateRoutePoiData() {
        if (!this.map || typeof this.map.getSource !== 'function') {
            return;
        }
        const source = this.map.getSource(ROUTE_POI_SOURCE_ID);
        if (!source || typeof source.setData !== 'function') {
            return;
        }
        const pois = Array.isArray(this.routePointsOfInterest) ? this.routePointsOfInterest : [];
        if (!pois.length) {
            source.setData(EMPTY_COLLECTION);
            return;
        }

        // Collect all unique icon keys
        const iconKeys = new Set();
        pois.forEach((poi) => {
            const iconKey = typeof poi?.iconKey === 'string' ? poi.iconKey.trim() : '';
            if (iconKey) {
                iconKeys.add(iconKey);
            }
        });

        // Build features - trust that icons are already loaded or will be soon
        const buildFeatures = () => {
            return pois
                .map((poi) => {
                    if (!poi) {
                        return null;
                    }
                    const coords = Array.isArray(poi.coordinates) ? poi.coordinates : null;
                    if (!coords || coords.length < 2) {
                        return null;
                    }
                    const lng = Number(coords[0]);
                    const lat = Number(coords[1]);
                    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
                        return null;
                    }
                    const name = typeof poi.name === 'string' ? poi.name.trim() : '';
                    const title = typeof poi.title === 'string' ? poi.title : name;
                    const iconImageId = typeof poi.iconImageId === 'string' ? poi.iconImageId.trim() : '';
                    const iconDisplayScale = Number(poi.iconDisplayScale);

                    // Check if the image is registered
                    const hasIcon = Boolean(iconImageId && this.map.hasImage(iconImageId));

                    return {
                        type: 'Feature',
                        properties: {
                            id: poi.id ?? null,
                            title: title || '',
                            name,
                            categoryKey: poi.categoryKey ?? '',
                            color: typeof poi.color === 'string' && poi.color.trim() ? poi.color.trim() : DEFAULT_POI_COLOR,
                            showLabel: Boolean(poi.showLabel && name),
                            iconImageId: hasIcon ? iconImageId : '',
                            iconDisplayScale: hasIcon && Number.isFinite(iconDisplayScale) && iconDisplayScale > 0
                                ? iconDisplayScale
                                : 1,
                            hasIcon
                        },
                        geometry: {
                            type: 'Point',
                            coordinates: [lng, lat]
                        }
                    };
                })
                .filter(Boolean);
        };

        // Set data immediately (icons may show as circles if not yet loaded)
        const features = buildFeatures();
        source.setData(features.length ? { type: 'FeatureCollection', features } : EMPTY_COLLECTION);

        // If we have icon keys, load them in background and refresh when done
        if (iconKeys.size) {
            ensurePoiIconImages(this.map, Array.from(iconKeys)).then(() => {
                // Re-build features now that icons are loaded
                const updatedFeatures = buildFeatures();
                source.setData(updatedFeatures.length ? { type: 'FeatureCollection', features: updatedFeatures } : EMPTY_COLLECTION);
            }).catch((error) => {
                console.warn('[POI Layer] Icon loading failed:', error);
            });
        }
    }

    /**
     * Update POI layer visibility based on profile mode
     */
    updateRoutePoiLayerVisibility() {
        if (!this.map || typeof this.map.getLayer !== 'function' || typeof this.map.setLayoutProperty !== 'function') {
            return;
        }
        const hasPois = Array.isArray(this.routePointsOfInterest) && this.routePointsOfInterest.length > 0;
        const profileMode = this.getProfileMode();
        const shouldShow = profileMode === 'poi' && hasPois;
        const visibility = shouldShow ? 'visible' : 'none';

        [ROUTE_POI_LAYER_ID, ROUTE_POI_ICON_LAYER_ID, ROUTE_POI_LABEL_LAYER_ID].forEach((layerId) => {
            if (this.map.getLayer(layerId)) {
                try {
                    this.map.setLayoutProperty(layerId, 'visibility', visibility);
                } catch (error) {
                    console.warn('Failed to set POI layer visibility', layerId, error);
                }
            }
        });
    }

    /**
     * Update POI colors and icons to match current day segments.
     * Called when bivouacs are added/removed/moved.
     */
    updatePoiDayColors() {
        if (!Array.isArray(this.routePointsOfInterest) || !this.routePointsOfInterest.length) {
            return;
        }

        const segments = this.getCutSegments();
        const modeColors = this.getModeColors();
        const currentMode = this.getCurrentMode();
        const defaultColor = modeColors?.[currentMode] || '#f8b40b';

        // Re-assign day colors and icon IDs
        this.routePointsOfInterest.forEach((poi) => {
            if (!poi || !Number.isFinite(poi.distanceKm)) return;

            // Find which day segment this POI belongs to
            let dayIndex = 0;
            const segment = segments.find((seg, idx) => {
                const start = Number(seg.startKm ?? seg.startDistanceKm ?? 0);
                const end = Number(seg.endKm ?? seg.endDistanceKm ?? start);
                if (poi.distanceKm >= start && poi.distanceKm <= end) {
                    dayIndex = idx;
                    return true;
                }
                return false;
            });

            // Update color
            poi.color = segment?.color || defaultColor;

            // Update icon image ID
            const iconKey = typeof poi.iconKey === 'string' ? poi.iconKey.trim() : '';
            if (iconKey) {
                poi.iconImageId = getPoiIconImageIdForDay(iconKey, dayIndex);
            }
        });

        // Refresh the map layer data
        this.updateRoutePoiData();
    }

    /**
     * Abort any pending POI fetch request
     */
    abortPendingRequest() {
        if (this.pendingPoiAbortController && typeof this.pendingPoiAbortController.abort === 'function') {
            try {
                this.pendingPoiAbortController.abort();
            } catch (error) {
                console.warn('Failed to abort pending POI fallback request', error);
            }
        }
        this.pendingPoiAbortController = null;
        this.pendingPoiRequest = null;
    }

    /**
     * Fetch and process POIs for the current route
     * @returns {Promise<void>}
     */
    async refreshRoutePointsOfInterest() {
        const profile = this.getRouteProfile();
        const coordinates = Array.isArray(profile?.coordinates) ? profile.coordinates : [];
        if (!this.map || coordinates.length < 2 || !turfApi || typeof turfApi.lineString !== 'function'
            || typeof turfApi.nearestPointOnLine !== 'function') {
            this.setRoutePointsOfInterest([]);
            return;
        }

        this.abortPendingRequest();

        const requestToken = Symbol('poi-request');
        this.pendingPoiRequest = requestToken;
        const line = turfApi.lineString(coordinates.map((coord) => [coord[0], coord[1]]));
        const totalDistanceKm = Number(profile?.totalDistanceKm);

        const sourceCollection = this.getOfflinePoiCollection();
        let sourceFeatures = Array.isArray(sourceCollection?.features) ? sourceCollection.features : [];

        if (!sourceFeatures.length) {
            let abortController = null;
            if (typeof AbortController === 'function') {
                abortController = new AbortController();
                this.pendingPoiAbortController = abortController;
            }
            try {
                const fallbackFeatures = await fetchOverpassRoutePois(line, {
                    bufferMeters: POI_MAX_SEARCH_RADIUS_METERS,
                    signal: abortController?.signal
                });
                if (this.pendingPoiRequest !== requestToken) {
                    return;
                }
                sourceFeatures = fallbackFeatures;
            } catch (error) {
                if (!(abortController?.signal?.aborted)) {
                    console.warn('Failed to fetch POIs from Overpass fallback', error);
                }
            } finally {
                if (this.pendingPoiAbortController === abortController) {
                    this.pendingPoiAbortController = null;
                }
            }
        }

        if (!sourceFeatures.length) {
            this.setRoutePointsOfInterest([]);
            this.pendingPoiRequest = null;
            return;
        }

        const collected = this._processSourceFeatures(sourceFeatures, line, totalDistanceKm);
        collected.sort((a, b) => a.distanceKm - b.distanceKm);

        const clustered = clusterRoutePointsOfInterest(collected, totalDistanceKm);
        const mergedPois = this._mergeWaterSources(clustered);

        const resolved = await this._resolvePoiIcons(mergedPois, requestToken);
        if (!resolved) {
            return; // Request was superseded
        }

        if (this.pendingPoiRequest !== requestToken) {
            return;
        }

        markElevationProfileLabelLeaders(resolved, totalDistanceKm);
        this._assignDayColors(resolved);

        this.setRoutePointsOfInterest(resolved);
        this.pendingPoiRequest = null;
        this.pendingPoiAbortController = null;
    }

    /**
     * Process source features and filter by distance
     * @private
     */
    _processSourceFeatures(sourceFeatures, line, totalDistanceKm) {
        const seen = new Set();
        const collected = [];

        sourceFeatures.forEach((feature) => {
            if (!feature || typeof feature !== 'object') {
                return;
            }
            const geometry = feature.geometry;
            if (!geometry || !Array.isArray(geometry.coordinates)) {
                return;
            }

            // Extract coordinates based on geometry type
            let lng, lat;
            if (geometry.type === 'Point') {
                [lng, lat] = geometry.coordinates;
            } else if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates[0])) {
                // Calculate centroid of first ring (outer boundary)
                const ring = geometry.coordinates[0];
                if (ring.length < 3) return;
                let sumLng = 0, sumLat = 0;
                ring.forEach(coord => {
                    if (Array.isArray(coord) && coord.length >= 2) {
                        sumLng += coord[0];
                        sumLat += coord[1];
                    }
                });
                lng = sumLng / ring.length;
                lat = sumLat / ring.length;
            } else {
                return;
            }

            if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
                return;
            }
            const definition = resolvePoiDefinition(feature.properties || {});
            if (!definition) {
                return;
            }
            let nearest = null;
            try {
                nearest = turfApi.nearestPointOnLine(line, turfApi.point([lng, lat]), { units: 'kilometers' });
            } catch (error) {
                return;
            }
            const distanceKm = Number(nearest?.properties?.location);
            const distanceToLineKm = Number(nearest?.properties?.dist ?? nearest?.properties?.distance);
            if (!Number.isFinite(distanceKm) || !Number.isFinite(distanceToLineKm)) {
                return;
            }
            const categoryKey = typeof definition?.key === 'string' ? definition.key : '';
            const maxDistanceMeters = Number.isFinite(POI_CATEGORY_DISTANCE_OVERRIDES[categoryKey])
                ? Math.max(0, POI_CATEGORY_DISTANCE_OVERRIDES[categoryKey])
                : POI_SEARCH_RADIUS_METERS;
            const distanceMeters = distanceToLineKm * 1000;
            if (!Number.isFinite(distanceMeters) || distanceMeters > maxDistanceMeters) {
                return;
            }
            const rawId = feature?.properties?.id
                ?? feature?.properties?.osm_id
                ?? feature?.properties?.['@id']
                ?? feature?.id
                ?? feature?.properties?.ref;
            const identifier = buildPoiIdentifier(definition.key, [lng, lat], rawId);
            if (seen.has(identifier)) {
                return;
            }
            seen.add(identifier);

            const name = resolvePoiName(feature.properties || {});
            if (!name && definition.key === 'peak') {
                return;
            }
            const categoryLabel = definition.definition.label ?? DEFAULT_POI_TITLE;
            const tooltip = name
                ? (categoryLabel && categoryLabel !== name ? `${name} · ${categoryLabel}` : name)
                : categoryLabel || DEFAULT_POI_TITLE;
            const clampedDistanceKm = Number.isFinite(totalDistanceKm)
                ? Math.max(0, Math.min(totalDistanceKm, distanceKm))
                : Math.max(0, distanceKm);

            const coordsArray = Array.isArray(feature.geometry?.coordinates)
                ? feature.geometry.coordinates
                : [];
            const coordinateElevation = coordsArray.length >= 3 ? Number(coordsArray[2]) : null;
            let elevation = parsePoiElevation(feature.properties || {});
            if (!Number.isFinite(elevation) && Number.isFinite(coordinateElevation)) {
                elevation = coordinateElevation;
            }
            const peakImportance = computePeakImportanceScore(feature.properties || {}, elevation);
            const peakImportanceScore = Number.isFinite(peakImportance?.score) ? peakImportance.score : 0;

            const baseIconKey = definition.definition.icon ?? definition.key;
            const iconKey = resolveRoutePoiIconKey(definition.key, baseIconKey, peakImportanceScore);
            const iconImageId = getPoiIconImageId(iconKey);

            collected.push({
                id: identifier,
                name,
                title: tooltip,
                categoryLabel,
                categoryKey: definition.key,
                iconKey,
                iconImageId,
                color: definition.definition.color ?? DEFAULT_POI_COLOR,
                distanceKm: clampedDistanceKm,
                coordinates: [lng, lat],
                elevation,
                peakImportanceScore
            });
        });

        return collected;
    }

    /**
     * Merge water sources with nearby host POIs
     * @private
     */
    _mergeWaterSources(clustered) {
        if (!clustered.length) return [];

        const waterSources = [];
        const potentialHosts = [];
        const others = [];

        clustered.forEach(poi => {
            if (WATER_CATEGORY_SET.has(poi.categoryKey)) {
                waterSources.push(poi);
            } else if (WATER_HOST_CATEGORY_SET.has(poi.categoryKey)) {
                potentialHosts.push(poi);
            } else {
                others.push(poi);
            }
        });

        const usedWaterIndices = new Set();

        const enrichedHosts = potentialHosts.map(host => {
            let bestWaterIdx = -1;
            let minDist = Infinity;

            waterSources.forEach((water, idx) => {
                if (usedWaterIndices.has(idx)) return;

                const dist = Math.abs(host.distanceKm - water.distanceKm);
                if (dist <= WATER_MERGE_PROXIMITY_KM && dist < minDist) {
                    minDist = dist;
                    bestWaterIdx = idx;
                }
            });

            if (bestWaterIdx !== -1) {
                usedWaterIndices.add(bestWaterIdx);
                return { ...host, hasWater: true };
            }
            return host;
        });

        const remainingWater = waterSources.filter((_, idx) => !usedWaterIndices.has(idx));

        const result = [...others, ...enrichedHosts, ...remainingWater];
        result.sort((a, b) => a.distanceKm - b.distanceKm);
        return result;
    }

    /**
     * Resolve icon metadata and SVG content for POIs
     * @private
     * @returns {Array|null} Resolved POIs or null if request was superseded
     */
    async _resolvePoiIcons(mergedPois, requestToken) {
        const resolved = [];
        for (const entry of mergedPois) {
            if (!entry) {
                continue;
            }
            let iconMetadata = null;
            let iconSvgContent = null;
            const iconKey = typeof entry.iconKey === 'string' ? entry.iconKey.trim() : '';
            if (iconKey) {
                try {
                    [iconMetadata, iconSvgContent] = await Promise.all([
                        getPoiIconMetadata(iconKey),
                        getPoiIconSvgContent(iconKey)
                    ]);
                } catch (error) {
                    console.warn('Failed to load POI icon data', iconKey, error);
                }
                if (this.pendingPoiRequest !== requestToken) {
                    return null;
                }
            }
            const decorated = { ...entry };
            if (iconSvgContent) {
                decorated.iconSvgContent = iconSvgContent;
            }
            if (iconMetadata) {
                const metrics = computePoiIconDisplayMetrics(iconMetadata);
                decorated.icon = {
                    ...iconMetadata,
                    displayWidth: metrics?.displayWidth ?? null,
                    displayHeight: metrics?.displayHeight ?? null
                };
                decorated.iconDisplayWidth = metrics?.displayWidth ?? null;
                decorated.iconDisplayHeight = metrics?.displayHeight ?? null;
                decorated.iconDisplayScale = metrics?.mapScale ?? 1;
                decorated.iconImageId = entry.iconImageId ?? getPoiIconImageId(iconKey);
            } else {
                decorated.icon = null;
                decorated.iconDisplayWidth = null;
                decorated.iconDisplayHeight = null;
                decorated.iconDisplayScale = 1;
                decorated.iconImageId = null;
            }
            decorated.showLabel = shouldShowPoiLabel(decorated);
            resolved.push(decorated);
            if (this.pendingPoiRequest !== requestToken) {
                return null;
            }
        }
        return resolved;
    }

    /**
     * Assign day segment colors to POIs
     * @private
     */
    _assignDayColors(resolved) {
        const segments = this.getCutSegments();
        const modeColors = this.getModeColors();
        const currentMode = this.getCurrentMode();
        const defaultColor = modeColors?.[currentMode] || '#f8b40b';

        resolved.forEach((poi) => {
            if (!poi || !Number.isFinite(poi.distanceKm)) return;

            let dayIndex = 0;
            const segment = segments.find((seg, idx) => {
                const start = Number(seg.startKm ?? seg.startDistanceKm ?? 0);
                const end = Number(seg.endKm ?? seg.endDistanceKm ?? start);
                if (poi.distanceKm >= start && poi.distanceKm <= end) {
                    dayIndex = idx;
                    return true;
                }
                return false;
            });

            poi.color = segment?.color || defaultColor;

            const iconKey = typeof poi.iconKey === 'string' ? poi.iconKey.trim() : '';
            if (iconKey) {
                poi.iconImageId = getPoiIconImageIdForDay(iconKey, dayIndex);
            }
        });
    }

    /**
     * Destroy and cleanup
     */
    destroy() {
        this.abortPendingRequest();
        this.routePointsOfInterest = [];
        this.map = null;
    }
}
