/**
 * StatsManager - Handles route statistics calculation and display.
 * 
 * This manager encapsulates:
 * - Route metrics calculation (distance, elevation, time)
 * - Stats display rendering
 * - Multi-day timeline rendering
 * - Weather display coordination
 */

import {
    HIKING_BASE_SPEED_KMPH,
    ASCENT_METERS_PER_HOUR,
    DESCENT_METERS_PER_HOUR
} from '../constants.js';

export class StatsManager {
    /**
     * @param {Object} options
     * @param {HTMLElement} options.statsPanel - Stats panel container
     * @param {Function} options.getRouteProfile - Returns route profile
     * @param {Function} options.getCutSegments - Returns cut segments
     * @param {Function} options.getRoutePointsOfInterest - Returns POIs
     * @param {Object} options.callbacks - Callbacks for actions
     */
    constructor(options = {}) {
        const {
            statsPanel,
            getRouteProfile,
            getCutSegments,
            getRoutePointsOfInterest,
            callbacks = {}
        } = options;

        this.statsPanel = statsPanel;
        this.getRouteProfile = getRouteProfile || (() => null);
        this.getCutSegments = getCutSegments || (() => []);
        this.getRoutePointsOfInterest = getRoutePointsOfInterest || (() => []);

        // Callbacks
        this.callbacks = {
            onDaySelected: callbacks.onDaySelected || (() => { }),
            formatDistance: callbacks.formatDistance || this.formatDistance.bind(this),
            formatDuration: callbacks.formatDuration || this.formatDurationHours.bind(this)
        };

        // State
        this.latestMetrics = null;
        this.selectedDayIndex = null;
    }

    /**
     * Calculate route metrics from route object
     * @param {Object} route - Route with geometry
     * @returns {Object|null} Metrics object
     */
    calculateRouteMetrics(route) {
        const coordinates = route?.geometry?.coordinates ?? [];
        if (!Array.isArray(coordinates) || coordinates.length < 2) {
            return null;
        }

        let distanceKm = 0;
        let ascentMeters = 0;
        let descentMeters = 0;
        let maxElevation = -Infinity;
        let minElevation = Infinity;
        let prevElevation = null;

        for (let i = 0; i < coordinates.length; i++) {
            const coord = coordinates[i];
            const elevation = coord?.[2];

            if (Number.isFinite(elevation)) {
                maxElevation = Math.max(maxElevation, elevation);
                minElevation = Math.min(minElevation, elevation);

                if (prevElevation !== null) {
                    const diff = elevation - prevElevation;
                    if (diff > 0) {
                        ascentMeters += diff;
                    } else {
                        descentMeters += Math.abs(diff);
                    }
                }
                prevElevation = elevation;
            }

            if (i > 0) {
                const prev = coordinates[i - 1];
                const segmentDist = this.computeDistanceKm(prev, coord);
                distanceKm += segmentDist;
            }
        }

        // Use summary if available
        const summary = route?.properties?.summary;
        if (summary) {
            if (Number.isFinite(summary.distance)) {
                distanceKm = summary.distance / 1000;
            }
            if (Number.isFinite(summary.ascent)) {
                ascentMeters = summary.ascent;
            }
            if (Number.isFinite(summary.descent)) {
                descentMeters = summary.descent;
            }
        }

        const estimatedHours = this.estimateTravelTimeHours(distanceKm, ascentMeters, descentMeters);

        return {
            distanceKm,
            ascentMeters: Math.round(ascentMeters),
            descentMeters: Math.round(descentMeters),
            maxElevation: Number.isFinite(maxElevation) ? Math.round(maxElevation) : null,
            minElevation: Number.isFinite(minElevation) ? Math.round(minElevation) : null,
            estimatedHours
        };
    }

    /**
     * Compute distance between two coordinates
     * @param {Array} a - First coordinate [lng, lat]
     * @param {Array} b - Second coordinate [lng, lat]
     * @returns {number} Distance in km
     */
    computeDistanceKm(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) {
            return 0;
        }

        const R = 6371; // Earth radius in km
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
     * Estimate travel time using hiking formula
     * @param {number} distanceKm - Distance in km
     * @param {number} ascentMeters - Total ascent
     * @param {number} descentMeters - Total descent
     * @returns {number} Estimated hours
     */
    estimateTravelTimeHours(distanceKm, ascentMeters = 0, descentMeters = 0) {
        const baseSpeed = HIKING_BASE_SPEED_KMPH || 4;
        const ascentRate = ASCENT_METERS_PER_HOUR || 400;
        const descentRate = DESCENT_METERS_PER_HOUR || 600;

        const horizontalHours = distanceKm / baseSpeed;
        const ascentHours = ascentMeters / ascentRate;
        const descentHours = descentMeters / descentRate;

        // Use Swiss hiking formula: larger of horizontal/vertical + half of smaller
        const verticalHours = ascentHours + descentHours;
        return Math.max(horizontalHours, verticalHours) + Math.min(horizontalHours, verticalHours) / 2;
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
     * Format duration in hours
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
     * Format time as range
     * @param {number} hours - Duration in hours
     * @returns {string} Formatted range
     */
    formatEstimatedTimeRange(hours) {
        if (!Number.isFinite(hours) || hours <= 0) {
            return '~0 h';
        }
        const minHours = Math.floor(hours);
        const maxHours = Math.ceil(hours);
        if (minHours === maxHours || maxHours - minHours < 0.5) {
            return `~${minHours} h`;
        }
        return `${minHours}-${maxHours} h`;
    }

    /**
     * Format elevation value
     * @param {number} meters - Elevation in meters
     * @returns {string} Formatted elevation
     */
    formatElevation(meters) {
        if (!Number.isFinite(meters)) {
            return '—';
        }
        return `${Math.round(meters).toLocaleString()} m`;
    }

    /**
     * Compute segment metrics
     * @param {Object} segment - Segment with startKm, endKm
     * @returns {Object} Segment metrics
     */
    computeSegmentMetrics(segment) {
        const profile = this.getRouteProfile();
        if (!profile || !segment) {
            return null;
        }

        const { startKm, endKm } = segment;
        const distanceKm = endKm - startKm;

        // Calculate elevation change for segment
        const distances = profile.cumulativeDistances || [];
        const elevations = profile.elevations || [];

        let ascentMeters = 0;
        let descentMeters = 0;
        let prevElev = null;

        for (let i = 0; i < distances.length; i++) {
            const dist = distances[i];
            const elev = elevations[i];

            if (dist >= startKm && dist <= endKm && Number.isFinite(elev)) {
                if (prevElev !== null) {
                    const diff = elev - prevElev;
                    if (diff > 0) ascentMeters += diff;
                    else descentMeters += Math.abs(diff);
                }
                prevElev = elev;
            }
        }

        const estimatedHours = this.estimateTravelTimeHours(distanceKm, ascentMeters, descentMeters);

        return {
            distanceKm,
            ascentMeters: Math.round(ascentMeters),
            descentMeters: Math.round(descentMeters),
            estimatedHours
        };
    }

    /**
     * Build stats summary HTML
     * @param {Object} metrics - Route metrics
     * @returns {string} HTML string
     */
    buildStatsSummary(metrics) {
        if (!metrics) {
            return '';
        }

        const distance = this.formatDistance(metrics.distanceKm);
        const time = this.formatEstimatedTimeRange(metrics.estimatedHours);
        const ascent = `+${metrics.ascentMeters || 0} m`;
        const descent = `-${metrics.descentMeters || 0} m`;

        return `
      <div class="stats-summary">
        <div class="stats-item stats-item--distance">
          <span class="stats-value">${distance}</span>
        </div>
        <div class="stats-item stats-item--time">
          <span class="stats-value">${time}</span>
        </div>
        <div class="stats-item stats-item--ascent">
          <span class="stats-value">${ascent}</span>
        </div>
        <div class="stats-item stats-item--descent">
          <span class="stats-value">${descent}</span>
        </div>
      </div>
    `;
    }

    /**
     * Update stats display
     * @param {Object} route - Route object
     */
    updateStats(route) {
        const metrics = route ? this.calculateRouteMetrics(route) : null;
        this.latestMetrics = metrics;
        return metrics;
    }

    /**
     * Get latest metrics
     * @returns {Object|null} Latest metrics
     */
    getLatestMetrics() {
        return this.latestMetrics;
    }

    /**
     * Select a day for detailed view
     * @param {number} dayIndex - Day index (0-based)
     */
    selectDay(dayIndex) {
        this.selectedDayIndex = dayIndex;
        this.callbacks.onDaySelected(dayIndex);
    }

    /**
     * Get selected day index
     * @returns {number|null} Selected day index
     */
    getSelectedDayIndex() {
        return this.selectedDayIndex;
    }

    /**
     * Clear selection
     */
    clearSelection() {
        this.selectedDayIndex = null;
    }
}
