/**
 * ImportExportManager - Handles route import and export operations.
 * 
 * This manager encapsulates:
 * - GeoJSON/GPX import parsing
 * - Route export to GeoJSON
 * - Segment-based export
 * - Coordinate normalization
 */

import { COORD_EPSILON } from '../constants.js';

export class ImportExportManager {
    /**
     * @param {Object} options
     * @param {Function} options.getRouteGeojson - Returns route GeoJSON
     * @param {Function} options.getCutSegments - Returns cut segments
     * @param {Function} options.getWaypoints - Returns waypoints
     * @param {Function} options.getRouteProfile - Returns route profile
     * @param {Function} options.computeSegmentMarkers - Computes segment markers
     * @param {Object} options.callbacks - Callbacks for import actions
     */
    constructor(options = {}) {
        const {
            getRouteGeojson,
            getCutSegments,
            getWaypoints,
            getRouteProfile,
            computeSegmentMarkers,
            callbacks = {}
        } = options;

        this.getRouteGeojson = getRouteGeojson || (() => null);
        this.getCutSegments = getCutSegments || (() => []);
        this.getWaypoints = getWaypoints || (() => []);
        this.getRouteProfile = getRouteProfile || (() => null);
        this.computeSegmentMarkers = computeSegmentMarkers || (() => []);

        // Callbacks
        this.callbacks = {
            onImport: callbacks.onImport || (() => { }),
            onExport: callbacks.onExport || (() => { })
        };
    }

    /**
     * Import route from GeoJSON
     * @param {Object} geojson - GeoJSON FeatureCollection or Feature
     * @param {Object} options - Import options
     * @returns {Object|null} Extracted route data
     */
    importFromGeojson(geojson, options = {}) {
        const candidate = this.extractRouteFromGeojson(geojson);
        if (!candidate || !Array.isArray(candidate.coordinates) || candidate.coordinates.length < 2) {
            console.warn('No route geometry found in imported data');
            return null;
        }

        const waypoints = this.deriveWaypointsFromSequence(candidate.coordinates, options);
        if (!waypoints || waypoints.length < 2) {
            console.warn('Imported route did not contain enough distinct coordinates');
            return null;
        }

        return {
            coordinates: candidate.coordinates,
            waypoints,
            properties: candidate.properties || {},
            name: candidate.properties?.name || options.name || null
        };
    }

    /**
     * Extract route from GeoJSON
     * @param {Object} geojson - GeoJSON data
     * @returns {Object|null} Route candidate
     */
    extractRouteFromGeojson(geojson) {
        if (!geojson || typeof geojson !== 'object') {
            return null;
        }

        const candidates = [];

        const pushCandidate = (coordinates, properties = {}) => {
            const sequence = this.normalizeSequence(coordinates);
            if (sequence.length < 2) {
                return;
            }
            const distanceKm = this.estimateSequenceDistanceKm(sequence);
            const source = typeof properties.source === 'string' ? properties.source : null;
            let priority = 1;
            if (source === 'track') priority = 3;
            else if (source === 'route') priority = 2;

            candidates.push({
                coordinates: sequence.map((coord) => coord.slice()),
                properties: { ...properties },
                distanceKm,
                priority
            });
        };

        // Handle FeatureCollection
        if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
            geojson.features.forEach((feature) => {
                if (!feature || !feature.geometry) return;

                const geomType = feature.geometry.type;
                const coords = feature.geometry.coordinates;
                const props = feature.properties || {};

                if (geomType === 'LineString') {
                    pushCandidate(coords, { ...props, source: 'route' });
                } else if (geomType === 'MultiLineString') {
                    const merged = this.mergeCoordinateSegments(coords);
                    pushCandidate(merged, { ...props, source: 'track' });
                }
            });
        }

        // Handle single Feature
        if (geojson.type === 'Feature' && geojson.geometry) {
            const geomType = geojson.geometry.type;
            const coords = geojson.geometry.coordinates;
            const props = geojson.properties || {};

            if (geomType === 'LineString') {
                pushCandidate(coords, { ...props, source: 'route' });
            } else if (geomType === 'MultiLineString') {
                const merged = this.mergeCoordinateSegments(coords);
                pushCandidate(merged, { ...props, source: 'track' });
            }
        }

        // Handle direct LineString
        if (geojson.type === 'LineString' && Array.isArray(geojson.coordinates)) {
            pushCandidate(geojson.coordinates, { source: 'route' });
        }

        if (!candidates.length) {
            return null;
        }

        // Sort by priority, then by distance (prefer longer routes)
        candidates.sort((a, b) => {
            if (b.priority !== a.priority) return b.priority - a.priority;
            return b.distanceKm - a.distanceKm;
        });

        return candidates[0];
    }

    /**
     * Normalize coordinate sequence
     * @param {Array} coords - Raw coordinates
     * @returns {Array} Normalized coordinates
     */
    normalizeSequence(coords) {
        if (!Array.isArray(coords)) {
            return [];
        }
        const sequence = [];
        coords.forEach((coord) => {
            const normalized = this.normalizeCoordinate(coord);
            if (!normalized) return;
            if (sequence.length && this.coordinatesMatch(sequence[sequence.length - 1], normalized)) {
                return;
            }
            sequence.push(normalized);
        });
        return sequence;
    }

    /**
     * Normalize a single coordinate
     * @param {Array} coord - Raw coordinate
     * @returns {Array|null} Normalized [lng, lat, elev?]
     */
    normalizeCoordinate(coord) {
        if (!Array.isArray(coord) || coord.length < 2) {
            return null;
        }
        const lng = Number(coord[0]);
        const lat = Number(coord[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
            return null;
        }
        if (Math.abs(lng) > 180 || Math.abs(lat) > 90) {
            return null;
        }
        if (coord.length > 2 && Number.isFinite(coord[2])) {
            return [lng, lat, coord[2]];
        }
        return [lng, lat];
    }

    /**
     * Check if two coordinates match
     * @param {Array} a - First coordinate
     * @param {Array} b - Second coordinate
     * @returns {boolean} True if match
     */
    coordinatesMatch(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) {
            return false;
        }
        return Math.abs(a[0] - b[0]) < COORD_EPSILON && Math.abs(a[1] - b[1]) < COORD_EPSILON;
    }

    /**
     * Merge coordinate segments (MultiLineString)
     * @param {Array} segments - Array of coordinate arrays
     * @returns {Array} Merged coordinates
     */
    mergeCoordinateSegments(segments) {
        if (!Array.isArray(segments)) {
            return [];
        }
        const merged = [];
        segments.forEach((segment) => {
            const sequence = this.normalizeSequence(segment);
            if (!sequence.length) return;

            if (!merged.length) {
                sequence.forEach((coord) => merged.push(coord));
                return;
            }

            const last = merged[merged.length - 1];
            const startIndex = this.coordinatesMatch(last, sequence[0]) ? 1 : 0;
            for (let i = startIndex; i < sequence.length; i++) {
                if (!this.coordinatesMatch(merged[merged.length - 1], sequence[i])) {
                    merged.push(sequence[i]);
                }
            }
        });
        return merged;
    }

    /**
     * Estimate sequence distance in km
     * @param {Array} sequence - Coordinate sequence
     * @returns {number} Distance in km
     */
    estimateSequenceDistanceKm(sequence) {
        if (!Array.isArray(sequence) || sequence.length < 2) {
            return 0;
        }
        let distance = 0;
        for (let i = 1; i < sequence.length; i++) {
            distance += this.haversineDistanceKm(sequence[i - 1], sequence[i]);
        }
        return distance;
    }

    /**
     * Haversine distance between two points
     * @param {Array} a - First coordinate
     * @param {Array} b - Second coordinate
     * @returns {number} Distance in km
     */
    haversineDistanceKm(a, b) {
        const R = 6371;
        const lat1 = a[1] * Math.PI / 180;
        const lat2 = b[1] * Math.PI / 180;
        const dLat = (b[1] - a[1]) * Math.PI / 180;
        const dLon = (b[0] - a[0]) * Math.PI / 180;

        const sinHalfLat = Math.sin(dLat / 2);
        const sinHalfLon = Math.sin(dLon / 2);
        const h = sinHalfLat * sinHalfLat + Math.cos(lat1) * Math.cos(lat2) * sinHalfLon * sinHalfLon;

        return 2 * R * Math.asin(Math.sqrt(h));
    }

    /**
     * Derive waypoints from imported sequence
     * @param {Array} coordinates - Full coordinate sequence
     * @param {Object} options - Options
     * @returns {Array} Waypoints (start, end, and optionally vias)
     */
    deriveWaypointsFromSequence(coordinates, options = {}) {
        if (!Array.isArray(coordinates) || coordinates.length < 2) {
            return [];
        }

        const waypoints = [];

        // Start waypoint
        waypoints.push(coordinates[0].slice());

        // End waypoint
        waypoints.push(coordinates[coordinates.length - 1].slice());

        return waypoints;
    }

    /**
     * Build export FeatureCollection
     * @returns {Object} GeoJSON FeatureCollection
     */
    buildExportFeatureCollection() {
        const routeGeojson = this.getRouteGeojson();
        if (!routeGeojson || !routeGeojson.geometry) {
            return { type: 'FeatureCollection', features: [] };
        }

        const features = [];

        // Route line feature
        const routeFeature = {
            type: 'Feature',
            properties: {
                type: 'route',
                name: routeGeojson.properties?.name || 'Route',
                ...(routeGeojson.properties || {})
            },
            geometry: {
                type: 'LineString',
                coordinates: routeGeojson.geometry.coordinates.map(c => c.slice())
            }
        };
        features.push(routeFeature);

        // Waypoint features
        const waypoints = this.getWaypoints();
        waypoints.forEach((wp, index) => {
            if (!Array.isArray(wp) || wp.length < 2) return;
            const isStart = index === 0;
            const isEnd = index === waypoints.length - 1;
            features.push({
                type: 'Feature',
                properties: {
                    type: 'waypoint',
                    role: isStart ? 'start' : isEnd ? 'end' : 'via',
                    index
                },
                geometry: {
                    type: 'Point',
                    coordinates: wp.slice()
                }
            });
        });

        return { type: 'FeatureCollection', features };
    }

    /**
     * Build segment export collections
     * @returns {Array} Array of segment collections
     */
    buildSegmentExportCollections() {
        const cutSegments = this.getCutSegments();
        if (!cutSegments.length) {
            return [];
        }

        const markers = this.computeSegmentMarkers();

        return cutSegments.map((segment, index) => {
            if (!segment || !Array.isArray(segment.coordinates) || segment.coordinates.length < 2) {
                return null;
            }

            const features = [];

            // Route segment line
            features.push({
                type: 'Feature',
                properties: {
                    type: 'route-segment',
                    segmentIndex: index,
                    name: segment.name || `Jour ${index + 1}`,
                    distanceKm: segment.distanceKm
                },
                geometry: {
                    type: 'LineString',
                    coordinates: segment.coordinates.map(c => c.slice())
                }
            });

            // Start/end markers for this segment
            const segmentMarkers = markers.filter(m =>
                m.segmentIndex === index ||
                (m.type === 'start' && index === 0) ||
                (m.type === 'end' && index === cutSegments.length - 1)
            );

            segmentMarkers.forEach((marker) => {
                if (!marker.coordinates || marker.coordinates.length < 2) return;
                features.push({
                    type: 'Feature',
                    properties: {
                        type: marker.type,
                        name: marker.name || marker.title,
                        segmentIndex: marker.segmentIndex
                    },
                    geometry: {
                        type: 'Point',
                        coordinates: marker.coordinates.slice()
                    }
                });
            });

            return {
                name: segment.name || `Jour ${index + 1}`,
                index,
                collection: { type: 'FeatureCollection', features }
            };
        }).filter(Boolean);
    }

    /**
     * Export to GeoJSON string
     * @param {Object} options - Export options
     * @returns {string} GeoJSON string
     */
    exportToGeoJSON(options = {}) {
        const collection = options.bySegment
            ? this.buildSegmentExportCollections()
            : this.buildExportFeatureCollection();
        return JSON.stringify(collection, null, 2);
    }
}
