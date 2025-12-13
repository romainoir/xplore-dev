/**
 * RouteDisplayManager - Handles route line rendering on the map.
 * 
 * This manager encapsulates:
 * - Route line source/layer updates
 * - Line gradient expression generation
 * - Route hover effects
 * - Distance marker management
 * - Overlap offset handling
 */

import {
    COORD_EPSILON,
    EMPTY_COLLECTION,
    MAX_DISTANCE_MARKERS
} from '../constants.js';
import { SEGMENT_COLOR_PALETTE } from '../visual-constants.js';

export class RouteDisplayManager {
    /**
     * @param {Object} options
     * @param {Object} options.map - MapLibre GL map instance
     * @param {Function} options.getRouteGeojson - Returns route GeoJSON
     * @param {Function} options.getCutSegments - Returns cut segments
     * @param {Function} options.getProfileSegments - Returns profile segments
     * @param {Function} options.getCurrentMode - Returns current mode
     * @param {Function} options.getModeColors - Returns mode colors
     * @param {Object} options.callbacks - Callbacks
     */
    constructor(options = {}) {
        const {
            map,
            getRouteGeojson,
            getCutSegments,
            getProfileSegments,
            getCurrentMode,
            getModeColors,
            callbacks = {}
        } = options;

        this.map = map;
        this.getRouteGeojson = getRouteGeojson || (() => null);
        this.getCutSegments = getCutSegments || (() => []);
        this.getProfileSegments = getProfileSegments || (() => []);
        this.getCurrentMode = getCurrentMode || (() => 'foot-hiking');
        this.getModeColors = getModeColors || (() => ({}));

        // Callbacks
        this.callbacks = {
            onHoverChange: callbacks.onHoverChange || (() => { }),
            computeRouteOverlapOffsets: callbacks.computeRouteOverlapOffsets || (() => ({ offsets: [], isOverlap: [] })),
            geometricOffsetCoordinates: callbacks.geometricOffsetCoordinates || ((coords) => coords)
        };

        // State
        this.lineGradientExpression = null;
        this.lineGradientSupported = true;
        this.hoveredSegmentIndex = null;
        this.lastRouteLineUpdateKey = null;
    }

    /**
     * Get segment color by index
     * @param {number} index - Segment index
     * @returns {string} Color hex code
     */
    getSegmentColor(index) {
        const paletteIndex = index % SEGMENT_COLOR_PALETTE.length;
        return SEGMENT_COLOR_PALETTE[paletteIndex];
    }

    /**
     * Generate route line gradient expression for day segments
     * @param {Array} segments - Cut segments
     * @returns {Array|string} MapLibre gradient expression or fallback color
     */
    generateRouteLineGradientExpression(segments) {
        if (!Array.isArray(segments) || segments.length === 0) {
            const mode = this.getCurrentMode();
            const colors = this.getModeColors();
            return colors[mode] || '#f8b40b';
        }

        if (segments.length === 1) {
            return segments[0].color || this.getSegmentColor(0);
        }

        const profile = this.getRouteGeojson();
        const totalDistance = profile?.properties?.summary?.distance || 0;
        if (totalDistance <= 0) {
            return segments[0]?.color || this.getSegmentColor(0);
        }

        const totalKm = totalDistance / 1000;
        const stops = ['interpolate', ['linear'], ['line-progress']];

        const clamp01 = (value) => Math.max(0, Math.min(1, value));

        segments.forEach((segment, index) => {
            const startRatio = clamp01(segment.startKm / totalKm);
            const endRatio = clamp01(segment.endKm / totalKm);
            const color = segment.color || this.getSegmentColor(index);

            if (index === 0 || startRatio > 0) {
                stops.push(startRatio, color);
            }

            if (index < segments.length - 1) {
                const transitionRatio = clamp01(endRatio - 0.001);
                stops.push(transitionRatio, color);
            } else {
                stops.push(endRatio, color);
            }
        });

        if (stops.length < 5) {
            return segments[0]?.color || this.getSegmentColor(0);
        }

        return stops;
    }

    /**
     * Get current gradient expression
     * @returns {Array|string|null} Gradient expression
     */
    getRouteLineGradientExpression() {
        return this.lineGradientExpression;
    }

    /**
     * Set route line gradient on the map
     */
    setRouteLineGradient() {
        if (!this.map || !this.lineGradientSupported) {
            return;
        }

        const segments = this.getCutSegments();
        this.lineGradientExpression = this.generateRouteLineGradientExpression(segments);

        try {
            if (this.map.getLayer('route-line')) {
                this.map.setPaintProperty('route-line', 'line-gradient', this.lineGradientExpression);
            }
        } catch (error) {
            console.warn('Failed to set route line gradient', error);
        }
    }

    /**
     * Update route line source with current data
     */
    updateRouteLineSource() {
        if (!this.map) return;

        const source = this.map.getSource('route-directions');
        if (!source) return;

        const routeGeojson = this.getRouteGeojson();
        if (!routeGeojson || !routeGeojson.geometry?.coordinates?.length) {
            source.setData(EMPTY_COLLECTION);
            return;
        }

        const coordinates = routeGeojson.geometry.coordinates;
        const { offsets, isOverlap } = this.callbacks.computeRouteOverlapOffsets(coordinates);

        let displayCoordinates = coordinates;
        if (offsets.length && offsets.some(o => o !== 0)) {
            displayCoordinates = this.callbacks.geometricOffsetCoordinates(coordinates, offsets, 1.5);
        }

        const feature = {
            type: 'Feature',
            properties: {
                ...routeGeojson.properties,
                hasOverlap: isOverlap.some(Boolean)
            },
            geometry: {
                type: 'LineString',
                coordinates: displayCoordinates
            }
        };

        source.setData({
            type: 'FeatureCollection',
            features: [feature]
        });

        this.setRouteLineGradient();
    }

    /**
     * Show hover effect on route segment
     * @param {Object} options - Hover options
     */
    showRouteHoverOnSegment(options = {}) {
        const { segmentIndex, coordinates, color } = options;

        if (!this.map) return;
        const source = this.map.getSource('route-hover');
        if (!source) return;

        if (!Array.isArray(coordinates) || coordinates.length < 2) {
            this.hideRouteHover();
            return;
        }

        this.hoveredSegmentIndex = segmentIndex;

        source.setData({
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties: { segmentIndex, color: color || '#ffffff' },
                geometry: { type: 'LineString', coordinates }
            }]
        });
    }

    /**
     * Hide route hover effect
     */
    hideRouteHover() {
        if (!this.map) return;
        const source = this.map.getSource('route-hover');
        if (!source) return;

        this.hoveredSegmentIndex = null;
        source.setData(EMPTY_COLLECTION);
    }

    /**
     * Clear all route display
     */
    clearRouteDisplay() {
        this.lineGradientExpression = null;
        this.hoveredSegmentIndex = null;

        if (!this.map) return;

        const sources = ['route-directions', 'route-hover', 'distance-markers'];
        sources.forEach(sourceId => {
            const source = this.map.getSource(sourceId);
            if (source) {
                source.setData(EMPTY_COLLECTION);
            }
        });
    }
}
