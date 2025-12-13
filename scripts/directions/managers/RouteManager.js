/**
 * RouteManager - Handles route calculation, profile building, and segment management.
 * 
 * This manager encapsulates:
 * - Route profile building (coordinates, distances, elevations)
 * - Route metrics computation (distance, ascent, descent, time)
 * - Cut segment management (multi-day splits)
 * - Coordinate utilities (distance at point, interpolation)
 */

import { haversineDistanceMeters, turfApi } from '../utils.js';
import { COORD_EPSILON, ROUTE_CUT_EPSILON_KM } from '../constants.js';

export class RouteManager {
    /**
     * @param {Object} options
     * @param {Function} options.getWaypoints - Returns current waypoints
     * @param {Object} options.callbacks - Callback functions
     */
    constructor(options = {}) {
        const {
            getWaypoints,
            callbacks = {}
        } = options;

        this.getWaypoints = getWaypoints || (() => []);

        // Callbacks
        this.callbacks = {
            onRouteUpdated: callbacks.onRouteUpdated || (() => { }),
            onSegmentsUpdated: callbacks.onSegmentsUpdated || (() => { })
        };

        // Internal state
        this.routeProfile = null;
        this.routeSegments = [];
        this.cutSegments = [];
        this.routeCutDistances = [];
    }

    /**
     * Build a route profile from coordinates
     * @param {Array} coordinates - Route coordinates [lng, lat, elevation?]
     * @param {Object} options - Options
     * @param {Function} [options.elevationProvider] - Optional function to query terrain elevation
     * @returns {Object|null} Route profile with distances and elevations
     */
    buildRouteProfile(coordinates = [], options = {}) {
        if (!Array.isArray(coordinates) || coordinates.length < 2) {
            return null;
        }

        const { elevationProvider } = options;
        const sanitized = [];

        for (const coord of coordinates) {
            if (!Array.isArray(coord) || coord.length < 2) {
                continue;
            }
            const lng = Number(coord[0]);
            const lat = Number(coord[1]);
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
                continue;
            }

            let elevation = coord.length > 2 ? Number(coord[2]) : null;

            // Query terrain elevation if provider is available
            if (typeof elevationProvider === 'function') {
                const terrainElev = elevationProvider([lng, lat]);
                if (Number.isFinite(terrainElev)) {
                    elevation = terrainElev;
                }
            }

            const normalizedElevation = Number.isFinite(elevation) ? elevation : null;
            const entry = normalizedElevation !== null
                ? [lng, lat, normalizedElevation]
                : [lng, lat];
            sanitized.push(entry);
        }

        if (sanitized.length < 2) {
            return null;
        }

        const cumulativeDistances = new Array(sanitized.length);
        cumulativeDistances[0] = 0;
        let totalDistance = 0;

        for (let index = 1; index < sanitized.length; index += 1) {
            const segmentDistance = this.computeDistanceKm(sanitized[index - 1], sanitized[index]);
            totalDistance += Number.isFinite(segmentDistance) ? segmentDistance : 0;
            cumulativeDistances[index] = totalDistance;
        }

        const elevations = sanitized.map((coord) => {
            const elevation = coord?.[2];
            return Number.isFinite(elevation) ? elevation : null;
        });

        return {
            coordinates: sanitized,
            cumulativeDistances,
            totalDistanceKm: totalDistance,
            elevations
        };
    }

    /**
     * Compute distance between two coordinates in kilometers
     * @param {Array} source - [lng, lat]
     * @param {Array} target - [lng, lat]
     * @returns {number} Distance in km
     */
    computeDistanceKm(source, target) {
        if (!Array.isArray(source) || !Array.isArray(target)) {
            return 0;
        }
        const meters = haversineDistanceMeters(source, target);
        return Number.isFinite(meters) ? meters / 1000 : 0;
    }

    /**
     * Compute route metrics from route geometry
     * @param {Object} route - Route with geometry.coordinates
     * @returns {Object} Metrics { distanceKm, ascentMeters, descentMeters, maxElevation, minElevation }
     */
    calculateRouteMetrics(route) {
        const metrics = {
            distanceKm: 0,
            ascentMeters: 0,
            descentMeters: 0,
            maxElevation: null,
            minElevation: null
        };

        const coordinates = route?.geometry?.coordinates ?? [];
        if (!Array.isArray(coordinates) || coordinates.length < 2) {
            return metrics;
        }

        // 1. Calculate Distance
        // Try Turf.js first (most accurate for complex geometries)
        if (turfApi) {
            try {
                const line = turfApi.lineString(coordinates);
                metrics.distanceKm = Number(turfApi.length(line, { units: 'kilometers' })) || 0;
            } catch (error) {
                console.warn('Error computing route length with Turf', error);
            }
        }

        // Fallback to summary properties if Turf failed or unavailable
        if (!metrics.distanceKm) {
            const summaryDistance = Number(route.properties?.summary?.distance);
            if (Number.isFinite(summaryDistance) && summaryDistance > 0) {
                metrics.distanceKm = summaryDistance / 1000;
            } else if (Array.isArray(route.properties?.segments)) {
                const totalMeters = route.properties.segments
                    .map((segment) => Number(segment.distance) || 0)
                    .reduce((total, value) => total + value, 0);
                metrics.distanceKm = totalMeters / 1000;
            }
        }

        // Fallback to manual calculation
        if (!metrics.distanceKm) {
            let dist = 0;
            for (let i = 1; i < coordinates.length; i++) {
                dist += this.computeDistanceKm(coordinates[i - 1], coordinates[i]);
            }
            metrics.distanceKm = dist;
        }

        // 2. Calculate Elevation Metrics
        let maxElevation = -Infinity;
        let minElevation = Infinity;
        let ascent = 0;
        let descent = 0;
        let prevElevation = null;

        for (const coord of coordinates) {
            const elevation = coord?.[2];
            if (Number.isFinite(elevation)) {
                maxElevation = Math.max(maxElevation, elevation);
                minElevation = Math.min(minElevation, elevation);

                if (prevElevation !== null) {
                    const diff = elevation - prevElevation;
                    if (diff > 0) {
                        ascent += diff;
                    } else {
                        descent += Math.abs(diff);
                    }
                }
                prevElevation = elevation;
            }
        }

        // Fallback to segment properties for ascent/descent if manual calculation yielded nothing
        if (ascent === 0 && descent === 0 && Array.isArray(route.properties?.segments)) {
            ascent = route.properties.segments
                .map((segment) => Number(segment.ascent) || 0)
                .reduce((total, value) => total + value, 0);
            descent = route.properties.segments
                .map((segment) => Number(segment.descent) || 0)
                .reduce((total, value) => total + value, 0);
        }

        metrics.ascentMeters = Math.round(ascent);
        metrics.descentMeters = Math.round(descent);
        metrics.maxElevation = Number.isFinite(maxElevation) && maxElevation !== -Infinity ? Math.round(maxElevation) : null;
        metrics.minElevation = Number.isFinite(minElevation) && minElevation !== Infinity ? Math.round(minElevation) : null;

        return metrics;
    }

    /**
     * Estimate travel time in hours using hiking formula
     * @param {number} distanceKm - Distance in km
     * @param {number} ascentMeters - Total ascent in meters
     * @param {number} descentMeters - Total descent in meters
     * @returns {number} Estimated hours
     */
    estimateTravelTimeHours(distanceKm, ascentMeters = 0, descentMeters = 0) {
        // Base speed: ~4 km/h on flat ground
        // Add time for elevation: ~400m/h ascent, ~600m/h descent
        const baseHours = distanceKm / 4;
        const ascentHours = (ascentMeters || 0) / 400;
        const descentHours = (descentMeters || 0) / 600;

        // Use the larger of horizontal or vertical time, plus half the smaller
        const horizontalTime = baseHours;
        const verticalTime = ascentHours + descentHours;
        const totalHours = Math.max(horizontalTime, verticalTime) + Math.min(horizontalTime, verticalTime) / 2;

        return totalHours;
    }

    /**
     * Format duration as human-readable string
     * @param {number} hours - Duration in hours
     * @returns {string} Formatted duration
     */
    formatDurationHours(hours) {
        if (!Number.isFinite(hours) || hours <= 0) {
            return '0 min';
        }
        const totalMinutes = Math.max(1, Math.round(hours * 60));
        const wholeHours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        if (wholeHours && minutes) {
            return `${wholeHours} h ${minutes} min`;
        }
        if (wholeHours) {
            return `${wholeHours} h`;
        }
        return `${minutes} min`;
    }

    /**
     * Format distance for display
     * @param {number} distanceKm - Distance in km
     * @returns {string} Formatted distance
     */
    formatDistance(distanceKm) {
        const value = Number(distanceKm);
        if (!Number.isFinite(value) || value <= 0) {
            return '0 km';
        }
        if (value < 1) {
            return `${Math.round(value * 1000)} m`;
        }
        if (value < 10) {
            return `${value.toFixed(1)} km`;
        }
        return `${Math.round(value)} km`;
    }

    /**
     * Get coordinate at a specific distance along the route
     * @param {number} distanceKm - Distance in km
     * @returns {Array|null} [lng, lat, elevation?] or null
     */
    getCoordinateAtDistance(distanceKm) {
        if (!this.routeProfile || !Number.isFinite(distanceKm)) {
            return null;
        }

        const { coordinates, cumulativeDistances } = this.routeProfile;
        if (!Array.isArray(coordinates) || !Array.isArray(cumulativeDistances)) {
            return null;
        }

        if (distanceKm <= 0) {
            return coordinates[0]?.slice() ?? null;
        }

        const totalDistance = this.routeProfile.totalDistanceKm || 0;
        if (distanceKm >= totalDistance) {
            return coordinates[coordinates.length - 1]?.slice() ?? null;
        }

        // Binary search for the segment
        let low = 0;
        let high = cumulativeDistances.length - 1;
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (cumulativeDistances[mid] < distanceKm) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }

        const segmentEnd = low;
        const segmentStart = Math.max(0, segmentEnd - 1);

        const startDist = cumulativeDistances[segmentStart];
        const endDist = cumulativeDistances[segmentEnd];
        const segmentLength = endDist - startDist;

        if (segmentLength <= 0) {
            return coordinates[segmentStart]?.slice() ?? null;
        }

        const ratio = (distanceKm - startDist) / segmentLength;
        const clampedRatio = Math.max(0, Math.min(1, ratio));

        const startCoord = coordinates[segmentStart];
        const endCoord = coordinates[segmentEnd];

        // Interpolate
        const lng = startCoord[0] + (endCoord[0] - startCoord[0]) * clampedRatio;
        const lat = startCoord[1] + (endCoord[1] - startCoord[1]) * clampedRatio;

        // Interpolate elevation if available
        if (startCoord.length > 2 && endCoord.length > 2) {
            const elev = startCoord[2] + (endCoord[2] - startCoord[2]) * clampedRatio;
            return [lng, lat, elev];
        }

        return [lng, lat];
    }

    /**
     * Normalize a route cut entry
     * @param {Object} entry - Cut entry with distanceKm, lng, lat
     * @returns {Object|null} Normalized cut entry
     */
    normalizeRouteCutEntry(entry) {
        if (!entry || typeof entry !== 'object') {
            return null;
        }
        const distanceKm = Number(entry.distanceKm);
        if (!Number.isFinite(distanceKm) || distanceKm < 0) {
            return null;
        }
        const lng = Number.isFinite(entry.lng) ? entry.lng : null;
        const lat = Number.isFinite(entry.lat) ? entry.lat : null;
        return {
            distanceKm,
            lng,
            lat,
            ...(entry.name ? { name: entry.name } : {})
        };
    }

    /**
     * Set route cut distances (bivouac points)
     * @param {Array} cuts - Array of cut entries
     */
    setRouteCutDistances(cuts) {
        if (!Array.isArray(cuts)) {
            this.routeCutDistances = [];
            return;
        }
        const normalized = cuts
            .map(entry => this.normalizeRouteCutEntry(entry))
            .filter(Boolean)
            .sort((a, b) => a.distanceKm - b.distanceKm);

        // Remove duplicates
        const unique = [];
        normalized.forEach(entry => {
            const exists = unique.some(
                existing => Math.abs(existing.distanceKm - entry.distanceKm) <= ROUTE_CUT_EPSILON_KM
            );
            if (!exists) {
                unique.push(entry);
            }
        });

        this.routeCutDistances = unique;
    }

    /**
     * Add a route cut at a specific distance
     * @param {number} distanceKm - Distance in km
     * @param {Array} coordinates - Optional [lng, lat] coordinates
     */
    addRouteCut(distanceKm, coordinates = null) {
        if (!this.routeProfile) {
            return;
        }

        const totalDistance = this.routeProfile.totalDistanceKm || 0;
        if (!Number.isFinite(distanceKm) || !Number.isFinite(totalDistance) || totalDistance <= ROUTE_CUT_EPSILON_KM) {
            return;
        }

        const clamped = Math.max(0, Math.min(totalDistance, distanceKm));
        if (clamped <= ROUTE_CUT_EPSILON_KM || totalDistance - clamped <= ROUTE_CUT_EPSILON_KM) {
            return;
        }

        // Check if already exists
        const exists = this.routeCutDistances.some(
            cut => Math.abs(cut.distanceKm - clamped) <= ROUTE_CUT_EPSILON_KM
        );
        if (exists) {
            return;
        }

        let targetCoordinates = null;
        if (Array.isArray(coordinates) && coordinates.length >= 2) {
            targetCoordinates = coordinates;
        } else {
            targetCoordinates = this.getCoordinateAtDistance(clamped);
        }

        const lng = Number(targetCoordinates?.[0]);
        const lat = Number(targetCoordinates?.[1]);

        const nextCuts = [...this.routeCutDistances];
        nextCuts.push({
            distanceKm: clamped,
            lng: Number.isFinite(lng) ? lng : null,
            lat: Number.isFinite(lat) ? lat : null
        });

        this.setRouteCutDistances(nextCuts);
    }

    /**
     * Remove a route cut at a specific index
     * @param {number} index - Index of the cut to remove
     */
    removeBivouacCut(index) {
        if (!Array.isArray(this.routeCutDistances)) {
            return;
        }
        if (index < 0 || index >= this.routeCutDistances.length) {
            return;
        }
        this.routeCutDistances.splice(index, 1);
    }

    /**
     * Clear all route cuts
     */
    resetRouteCuts() {
        this.routeCutDistances = [];
        this.cutSegments = [];
    }

    /**
     * Set the route profile
     * @param {Object} profile - Route profile from buildRouteProfile
     */
    setRouteProfile(profile) {
        this.routeProfile = profile;
    }

    /**
     * Get the route profile
     * @returns {Object|null} Current route profile
     */
    getRouteProfile() {
        return this.routeProfile;
    }

    /**
     * Clear route data
     */
    clearRoute() {
        this.routeProfile = null;
        this.routeSegments = [];
        this.cutSegments = [];
        this.routeCutDistances = [];
    }
}
