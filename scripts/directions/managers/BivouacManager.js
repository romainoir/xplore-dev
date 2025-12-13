/**
 * BivouacManager - Handles route cuts (bivouacs/day segments) and segment markers.
 * 
 * This manager encapsulates:
 * - Route cut (bivouac) CRUD operations
 * - Cut segment computation and boundaries
 * - Segment marker generation and updates
 * - Bivouac dragging state
 */

import { ROUTE_CUT_EPSILON_KM, EMPTY_COLLECTION, COORD_EPSILON } from '../constants.js';
import { SEGMENT_MARKER_SOURCE_ID, SEGMENT_COLOR_PALETTE, SEGMENT_MARKER_ICONS } from '../visual-constants.js';

export class BivouacManager {
    /**
     * @param {Object} options
     * @param {Object} options.map - MapLibre GL map instance
     * @param {Function} options.getRouteProfile - Returns route profile
     * @param {Function} options.getCoordinateAtDistance - Gets coordinate at distance
     * @param {Function} options.extractCoordinatesBetween - Extracts coords between distances
     * @param {Object} options.callbacks - Callbacks for state changes
     */
    constructor(options = {}) {
        const {
            map,
            getRouteProfile,
            getCoordinateAtDistance,
            extractCoordinatesBetween,
            callbacks = {}
        } = options;

        this.map = map;
        this.getRouteProfile = getRouteProfile || (() => null);
        this.getCoordinateAtDistance = getCoordinateAtDistance || (() => null);
        this.extractCoordinatesBetween = extractCoordinatesBetween || (() => []);

        // Callbacks
        this.callbacks = {
            onCutSegmentsChanged: callbacks.onCutSegmentsChanged || (() => { }),
            onMarkersChanged: callbacks.onMarkersChanged || (() => { }),
            recordState: callbacks.recordState || (() => { }),
            getOrCreateBivouacIcon: callbacks.getOrCreateBivouacIcon || ((color) => 'segment-marker-bivouac')
        };

        // State
        this.routeCutDistances = [];
        this.cutSegments = [];
        this.draggedBivouacIndex = null;
        this.draggedBivouacLngLat = null;
    }

    /**
     * Get route cut distances
     * @returns {Array} Cut distances array
     */
    getRouteCutDistances() {
        return this.routeCutDistances;
    }

    /**
     * Get cut segments
     * @returns {Array} Cut segments array
     */
    getCutSegments() {
        return this.cutSegments;
    }

    /**
     * Get segment count (number of days)
     * @returns {number} Number of segments
     */
    getSegmentCount() {
        return this.cutSegments.length;
    }

    /**
     * Normalize a route cut entry
     * @param {Object} entry - Cut entry
     * @returns {Object|null} Normalized entry
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
     * Set route cut distances
     * @param {Array} cuts - Array of cut entries
     */
    setRouteCutDistances(cuts) {
        if (!Array.isArray(cuts) || !cuts.length) {
            this.routeCutDistances = [];
            return;
        }

        const normalized = cuts
            .map((entry) => this.normalizeRouteCutEntry(entry))
            .filter((entry) => entry && Number.isFinite(entry.distanceKm))
            .sort((a, b) => a.distanceKm - b.distanceKm)
            .map((entry) => ({ ...entry }));

        this.routeCutDistances = normalized;
    }

    /**
     * Add a route cut (bivouac) at a specific distance
     * @param {number} distanceKm - Distance in km
     * @param {Array} coordinates - Optional [lng, lat]
     */
    addRouteCut(distanceKm, coordinates = null) {
        const profile = this.getRouteProfile();
        if (!profile) {
            return;
        }

        const totalDistance = Number(profile.totalDistanceKm) || 0;
        if (!Number.isFinite(distanceKm) || !Number.isFinite(totalDistance) || totalDistance <= ROUTE_CUT_EPSILON_KM) {
            return;
        }

        const clamped = Math.max(0, Math.min(totalDistance, distanceKm));
        if (clamped <= ROUTE_CUT_EPSILON_KM || totalDistance - clamped <= ROUTE_CUT_EPSILON_KM) {
            return;
        }

        // Check if already exists
        const exists = this.routeCutDistances.some((cut) => {
            const cutDist = Number(cut?.distanceKm ?? cut);
            return Number.isFinite(cutDist) && Math.abs(cutDist - clamped) <= ROUTE_CUT_EPSILON_KM;
        });

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
        this.callbacks.onCutSegmentsChanged();
    }

    /**
     * Remove a bivouac cut at a specific index
     * @param {number} index - Cut index to remove
     */
    removeBivouacCut(index) {
        if (!this.routeCutDistances.length) {
            return;
        }

        if (!Number.isInteger(index) || index < 0 || index >= this.routeCutDistances.length) {
            return;
        }

        this.callbacks.recordState();
        const nextCuts = [...this.routeCutDistances];
        nextCuts.splice(index, 1);
        this.setRouteCutDistances(nextCuts);
        this.callbacks.onCutSegmentsChanged();
    }

    /**
     * Reset all route cuts
     */
    resetRouteCuts() {
        this.routeCutDistances = [];
        this.cutSegments = [];
        this.draggedBivouacIndex = null;
        this.draggedBivouacLngLat = null;
    }

    /**
     * Compute cut boundaries from current cuts
     * @returns {Array} Array of boundary distances [0, cut1, cut2, ..., totalDistance]
     */
    computeCutBoundaries() {
        const profile = this.getRouteProfile();
        const totalDistance = Number(profile?.totalDistanceKm) || 0;
        if (!Number.isFinite(totalDistance) || totalDistance <= 0) {
            return [];
        }

        const rawCuts = this.routeCutDistances
            .map((entry) => Number(entry?.distanceKm ?? entry))
            .filter((value) => Number.isFinite(value));

        const interiorCuts = rawCuts
            .filter((value) => value > ROUTE_CUT_EPSILON_KM && value < totalDistance - ROUTE_CUT_EPSILON_KM)
            .sort((a, b) => a - b);

        const uniqueCuts = [];
        interiorCuts.forEach((value) => {
            if (!uniqueCuts.some((existing) => Math.abs(existing - value) <= ROUTE_CUT_EPSILON_KM / 2)) {
                uniqueCuts.push(value);
            }
        });

        return [0, ...uniqueCuts, totalDistance];
    }

    /**
     * Update cut segments based on current cuts
     */
    updateCutSegments() {
        const profile = this.getRouteProfile();
        if (!profile || !Array.isArray(profile.coordinates) || profile.coordinates.length < 2) {
            this.cutSegments = [];
            this.callbacks.onCutSegmentsChanged();
            return;
        }

        const boundaries = this.computeCutBoundaries();
        if (boundaries.length < 2) {
            this.cutSegments = [];
            this.callbacks.onCutSegmentsChanged();
            return;
        }

        const segments = [];
        for (let index = 0; index < boundaries.length - 1; index++) {
            const startKm = boundaries[index];
            const endKm = boundaries[index + 1];
            const coordinates = this.extractCoordinatesBetween(startKm, endKm);
            const distanceKm = endKm - startKm;
            const color = this.getSegmentColor(index);

            segments.push({
                index,
                startKm,
                endKm,
                distanceKm,
                coordinates,
                color,
                name: `Jour ${index + 1}`
            });
        }

        this.cutSegments = segments;
        this.assignSegmentNames();
        this.callbacks.onCutSegmentsChanged();
    }

    /**
     * Get color for a segment index
     * @param {number} index - Segment index
     * @returns {string} Color hex code
     */
    getSegmentColor(index) {
        const paletteIndex = index % SEGMENT_COLOR_PALETTE.length;
        return SEGMENT_COLOR_PALETTE[paletteIndex];
    }

    /**
     * Assign names to segments
     */
    assignSegmentNames() {
        this.cutSegments.forEach((segment, index) => {
            segment.name = `Jour ${index + 1}`;
        });
    }

    /**
     * Compute segment markers for map display
     * @returns {Array} Array of marker objects
     */
    computeSegmentMarkers() {
        const profile = this.getRouteProfile();
        if (!profile || !Array.isArray(profile.coordinates) || profile.coordinates.length < 2) {
            return [];
        }

        const markers = [];
        const segments = this.cutSegments;

        // Start marker
        const startCoord = profile.coordinates[0];
        if (Array.isArray(startCoord) && startCoord.length >= 2) {
            markers.push({
                type: 'start',
                title: 'Départ',
                name: 'Départ',
                coordinates: startCoord.slice(),
                icon: SEGMENT_MARKER_ICONS.start,
                labelColor: this.getSegmentColor(0),
                order: 0,
                segmentIndex: 0
            });
        }

        // Bivouac markers
        this.routeCutDistances.forEach((cut, index) => {
            const coord = this.getCoordinateAtDistance(cut.distanceKm);
            if (Array.isArray(coord) && coord.length >= 2) {
                const segmentIndex = index + 1;
                const color = this.getSegmentColor(segmentIndex);
                markers.push({
                    type: 'bivouac',
                    title: `Bivouac ${index + 1}`,
                    name: cut.name || `Bivouac ${index + 1}`,
                    coordinates: coord.slice(),
                    icon: this.callbacks.getOrCreateBivouacIcon(color),
                    labelColor: color,
                    order: index + 1,
                    segmentIndex,
                    cutIndex: index
                });
            }
        });

        // End marker
        const endCoord = profile.coordinates[profile.coordinates.length - 1];
        if (Array.isArray(endCoord) && endCoord.length >= 2) {
            const lastSegmentIndex = Math.max(0, segments.length - 1);
            markers.push({
                type: 'end',
                title: 'Arrivée',
                name: 'Arrivée',
                coordinates: endCoord.slice(),
                icon: SEGMENT_MARKER_ICONS.end,
                labelColor: this.getSegmentColor(lastSegmentIndex),
                order: markers.length,
                segmentIndex: lastSegmentIndex
            });
        }

        return markers;
    }

    /**
     * Update segment markers on the map
     */
    updateSegmentMarkers() {
        if (!this.map) return;
        const source = this.map.getSource(SEGMENT_MARKER_SOURCE_ID);
        if (!source) return;

        const markers = this.computeSegmentMarkers();
        if (!markers.length) {
            source.setData(EMPTY_COLLECTION);
            return;
        }

        const features = markers
            .map((marker, index) => {
                const coords = Array.isArray(marker.coordinates) ? marker.coordinates.slice() : null;
                if (!coords || coords.length < 2) {
                    return null;
                }

                return {
                    type: 'Feature',
                    properties: {
                        type: marker.type,
                        title: marker.title,
                        name: marker.name,
                        labelColor: marker.labelColor,
                        icon: marker.icon,
                        order: marker.order ?? index,
                        segmentIndex: marker.segmentIndex ?? index,
                        cutIndex: marker.cutIndex
                    },
                    geometry: {
                        type: 'Point',
                        coordinates: coords
                    }
                };
            })
            .filter(Boolean);

        if (!features.length) {
            source.setData(EMPTY_COLLECTION);
            return;
        }

        source.setData({
            type: 'FeatureCollection',
            features
        });
    }

    /**
     * Start bivouac drag
     * @param {number} cutIndex - Index of the cut being dragged
     * @param {Array} lngLat - Starting position [lng, lat]
     */
    startBivouacDrag(cutIndex, lngLat) {
        this.draggedBivouacIndex = cutIndex;
        this.draggedBivouacLngLat = Array.isArray(lngLat) ? lngLat.slice() : null;
    }

    /**
     * Update dragged bivouac position
     * @param {number} distanceKm - New distance
     * @param {Array} coordinates - Optional coordinates
     */
    updateDraggedBivouac(distanceKm, coordinates = null) {
        if (this.draggedBivouacIndex === null) {
            return;
        }
        if (!this.routeCutDistances.length) {
            return;
        }

        const index = this.draggedBivouacIndex;
        if (index < 0 || index >= this.routeCutDistances.length) {
            return;
        }

        const profile = this.getRouteProfile();
        const totalDistance = Number(profile?.totalDistanceKm) || 0;
        if (!Number.isFinite(totalDistance) || totalDistance <= ROUTE_CUT_EPSILON_KM) {
            return;
        }

        // Clamp between neighbors
        const prevEntry = index > 0 ? this.routeCutDistances[index - 1] : null;
        const nextEntry = index < this.routeCutDistances.length - 1 ? this.routeCutDistances[index + 1] : null;
        const minDist = prevEntry ? Number(prevEntry.distanceKm) + ROUTE_CUT_EPSILON_KM : ROUTE_CUT_EPSILON_KM;
        const maxDist = nextEntry ? Number(nextEntry.distanceKm) - ROUTE_CUT_EPSILON_KM : totalDistance - ROUTE_CUT_EPSILON_KM;

        const clamped = Math.max(minDist, Math.min(maxDist, distanceKm));
        if (Math.abs(clamped - this.routeCutDistances[index].distanceKm) < ROUTE_CUT_EPSILON_KM / 10) {
            return;
        }

        let targetCoordinates = coordinates;
        if (!Array.isArray(targetCoordinates) || targetCoordinates.length < 2) {
            targetCoordinates = this.getCoordinateAtDistance(clamped);
        }

        const lng = Number(targetCoordinates?.[0]);
        const lat = Number(targetCoordinates?.[1]);

        const nextCuts = [...this.routeCutDistances];
        nextCuts[index] = {
            distanceKm: clamped,
            lng: Number.isFinite(lng) ? lng : null,
            lat: Number.isFinite(lat) ? lat : null
        };

        this.setRouteCutDistances(nextCuts);
        this.callbacks.onCutSegmentsChanged();
    }

    /**
     * Finish bivouac drag
     */
    finishBivouacDrag() {
        this.draggedBivouacIndex = null;
        this.draggedBivouacLngLat = null;
    }

    /**
     * Check if currently dragging a bivouac
     * @returns {boolean} True if dragging
     */
    isDraggingBivouac() {
        return this.draggedBivouacIndex !== null;
    }
}
