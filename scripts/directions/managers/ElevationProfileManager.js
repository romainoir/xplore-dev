/**
 * ElevationProfileManager - Handles elevation chart rendering and interactions.
 * 
 * This manager encapsulates:
 * - Elevation chart SVG rendering
 * - Y-axis and X-axis label generation
 * - Gradient rendering for day segments
 * - Marker positioning (bivouacs, POIs)
 * - Chart zooming to specific day segments
 * - Tooltip management
 */

import { escapeHtml, adjustHexColor } from '../utils.js';
import { MAX_ELEVATION_POINTS, COORD_EPSILON } from '../constants.js';

export class ElevationProfileManager {
    /**
     * @param {Object} options
     * @param {HTMLElement} options.elevationChart - The elevation chart container element
     * @param {HTMLElement} options.elevationChartBody - The chart body element
     * @param {Function} options.getRouteProfile - Returns the route profile data
     * @param {Function} options.getCutSegments - Returns cut segments (day segments)
     * @param {Function} options.getProfileSegments - Returns profile segments for coloring
     * @param {Function} options.getCurrentMode - Returns current transport mode
     * @param {Function} options.getModeColors - Returns mode colors object
     * @param {Function} options.getRouteGeojson - Returns the route geojson
     * @param {Object} options.callbacks - Callback functions for state changes
     */
    constructor(options) {
        const {
            elevationChart,
            elevationChartBody,
            getRouteProfile,
            getCutSegments,
            getProfileSegments,
            getCurrentMode,
            getModeColors,
            getRouteGeojson,
            callbacks = {}
        } = options;

        this.elevationChart = elevationChart;
        this.elevationChartBody = elevationChartBody;
        this.getRouteProfile = getRouteProfile;
        this.getCutSegments = getCutSegments;
        this.getProfileSegments = getProfileSegments;
        this.getCurrentMode = getCurrentMode;
        this.getModeColors = getModeColors;
        this.getRouteGeojson = getRouteGeojson;

        // Callbacks for state changes
        this.callbacks = {
            onHover: callbacks.onHover || (() => { }),
            onZoom: callbacks.onZoom || (() => { }),
            onContextMenu: callbacks.onContextMenu || (() => { }),
            addRouteCut: callbacks.addRouteCut || (() => { })
        };

        // Internal state
        this.elevationSamples = [];
        this.elevationDomain = null;
        this.elevationYAxis = null;
        this.elevationChartContainer = null;
        this.elevationChartTooltip = null;
        this.lastElevationHoverDistance = null;
        this.elevationResizeObserver = null;
    }

    /**
     * Generate elevation samples from route coordinates
     * @param {Array} coordinates - Route coordinates with elevation
     * @returns {Array} Sampled elevation data
     */
    generateElevationSamples(coordinates) {
        const profile = this.getRouteProfile();
        if (!profile) return [];

        const points = (coordinates ?? [])
            .map((coord, index) => ({
                elevation: Number.isFinite(coord?.[2]) ? coord[2] : null,
                distanceKm: profile.cumulativeDistances[index] ?? 0
            }))
            .filter((point) => Number.isFinite(point.elevation));

        if (points.length < 2) {
            return [];
        }

        if (points.length <= MAX_ELEVATION_POINTS) {
            return points.map((point, index) => ({
                elevation: point.elevation,
                startDistanceKm: index === 0 ? 0 : points[index - 1].distanceKm,
                endDistanceKm: point.distanceKm
            }));
        }

        // Downsample for large routes
        const samples = [];
        const bucketSize = Math.ceil(points.length / MAX_ELEVATION_POINTS);

        for (let i = 0; i < points.length; i += bucketSize) {
            const bucket = points.slice(i, i + bucketSize);
            let elevationSum = 0;
            let count = 0;
            bucket.forEach((point) => {
                if (Number.isFinite(point.elevation)) {
                    elevationSum += point.elevation;
                    count += 1;
                }
            });
            const firstPoint = bucket[0];
            const lastPoint = bucket[bucket.length - 1];
            const startDistanceKm = firstPoint?.distanceKm ?? 0;
            const endDistanceKm = lastPoint?.distanceKm ?? startDistanceKm;
            samples.push({
                elevation: count ? elevationSum / count : firstPoint?.elevation ?? 0,
                startDistanceKm,
                endDistanceKm
            });
        }

        if (samples.length) {
            const lastSample = samples[samples.length - 1];
            if (Number.isFinite(profile.totalDistanceKm) && lastSample.endDistanceKm < profile.totalDistanceKm) {
                lastSample.endDistanceKm = profile.totalDistanceKm;
            }
        }

        return samples;
    }

    /**
     * Build SVG path strings for elevation area fill and stroke
     * @param {Array} samples - Elevation samples
     * @param {Object} yAxis - Y-axis min/max bounds
     * @param {Object} domain - X-axis domain (distance min/max)
     * @returns {Object} { fill: string, stroke: string }
     */
    buildElevationAreaPaths(samples, yAxis, domain) {
        const profile = this.getRouteProfile();
        const distances = Array.isArray(profile?.cumulativeDistances)
            ? profile.cumulativeDistances
            : [];
        const elevations = Array.isArray(profile?.elevations)
            ? profile.elevations
            : [];
        const range = Math.max(Number.EPSILON, yAxis.max - yAxis.min);
        const points = [];

        const domainMin = Number.isFinite(domain?.min) ? domain.min : 0;
        const domainMax = Number.isFinite(domain?.max) ? domain.max : domainMin;
        const domainSpan = domainMax - domainMin;

        // Use raw profile data for higher fidelity when zoomed
        const useRawData = distances.length <= 2000;

        if (useRawData && distances.length >= 2) {
            for (let i = 0; i < distances.length; i++) {
                const dist = distances[i];
                const elev = elevations[i];
                if (!Number.isFinite(dist) || !Number.isFinite(elev)) continue;
                if (dist < domainMin || dist > domainMax) continue;

                const xPercent = domainSpan > 0 ? ((dist - domainMin) / domainSpan) * 100 : 0;
                const yPercent = 100 - ((elev - yAxis.min) / range) * 100;
                points.push({ x: Math.max(0, Math.min(100, xPercent)), y: Math.max(0, Math.min(100, yPercent)) });
            }
        } else {
            // Use samples for very long routes
            samples.forEach((sample) => {
                const distanceKm = sample.endDistanceKm ?? sample.startDistanceKm ?? 0;
                if (distanceKm < domainMin || distanceKm > domainMax) return;

                const xPercent = domainSpan > 0 ? ((distanceKm - domainMin) / domainSpan) * 100 : 0;
                const yPercent = 100 - ((sample.elevation - yAxis.min) / range) * 100;
                points.push({ x: Math.max(0, Math.min(100, xPercent)), y: Math.max(0, Math.min(100, yPercent)) });
            });
        }

        if (!points.length) {
            return { fill: '', stroke: '' };
        }

        // Normalize points
        const normalized = [];
        const firstPoint = points[0];
        if (firstPoint.x > 0.01) {
            normalized.push({ x: 0, y: firstPoint.y });
        }
        normalized.push(...points);
        const lastPoint = normalized[normalized.length - 1];
        if (lastPoint.x < 99.99) {
            normalized.push({ x: 100, y: lastPoint.y });
        }

        const strokePath = normalized
            .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(3)} ${point.y.toFixed(3)}`)
            .join(' ');

        const fillParts = ['M 0 100'];
        if (normalized[0].x > 0) {
            fillParts.push(`L ${normalized[0].x.toFixed(3)} 100`);
        }
        normalized.forEach((point) => {
            fillParts.push(`L ${point.x.toFixed(3)} ${point.y.toFixed(3)}`);
        });
        fillParts.push('L 100 100', 'Z');

        return {
            fill: fillParts.join(' '),
            stroke: strokePath
        };
    }

    /**
     * Compute Y-axis ticks for elevation display
     * @param {number} minValue - Minimum value
     * @param {number} maxValue - Maximum value
     * @param {number} maxTicks - Maximum number of ticks
     * @returns {Object} { min, max, ticks: number[] }
     */
    computeAxisTicks(minValue, maxValue, maxTicks = 6) {
        if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || minValue >= maxValue) {
            return { min: 0, max: 1, ticks: [0, 1] };
        }

        const range = maxValue - minValue;
        const roughStep = range / (maxTicks - 1);

        // Find a nice step value
        const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
        const residual = roughStep / magnitude;
        let niceStep;
        if (residual <= 1) niceStep = magnitude;
        else if (residual <= 2) niceStep = 2 * magnitude;
        else if (residual <= 5) niceStep = 5 * magnitude;
        else niceStep = 10 * magnitude;

        const niceMin = Math.floor(minValue / niceStep) * niceStep;
        const niceMax = Math.ceil(maxValue / niceStep) * niceStep;

        const ticks = [];
        for (let tick = niceMin; tick <= niceMax; tick += niceStep) {
            ticks.push(tick);
        }

        return { min: niceMin, max: niceMax, ticks };
    }

    /**
     * Update Y-axis labels in the elevation chart
     */
    updateElevationYAxisLabels() {
        const yAxisLabels = document.getElementById('elevationYAxisLabels');
        if (!yAxisLabels) return;

        const yAxis = this.elevationYAxis;
        if (!yAxis || !Number.isFinite(yAxis.min) || !Number.isFinite(yAxis.max)) {
            yAxisLabels.innerHTML = '';
            return;
        }

        const yMin = yAxis.min;
        const yMax = yAxis.max;
        const ySpan = yMax - yMin;

        if (ySpan <= 0) {
            yAxisLabels.innerHTML = '';
            return;
        }

        const ticks = [];
        ticks.push({ value: yMin, percent: 0, isEdge: true, isMax: false });

        // Add intermediate ticks
        const step = ySpan / 4;
        for (let i = 1; i < 4; i++) {
            const value = yMin + step * i;
            const percent = (i / 4) * 100;
            ticks.push({ value, percent, isEdge: false, isMax: false });
        }

        ticks.push({ value: yMax, percent: 100, isEdge: true, isMax: true });

        const labelsHtml = ticks.map(tick => {
            const label = Math.round(tick.value).toLocaleString();
            const className = tick.isEdge
                ? (tick.isMax ? 'chart-card__y-max' : 'chart-card__y-min')
                : 'chart-card__y-mid';
            return `<span class="${className}" style="bottom: ${tick.percent.toFixed(2)}%">${label}</span>`;
        }).join('');

        yAxisLabels.innerHTML = labelsHtml;
    }

    /**
     * Update X-axis labels in the elevation chart
     */
    updateElevationXAxis() {
        if (!this.elevationChart) return;

        const xAxisContainer = this.elevationChart.querySelector('.elevation-x-axis');
        if (!xAxisContainer) return;

        const domainMin = this.elevationDomain?.min ?? 0;
        const domainMax = this.elevationDomain?.max ?? domainMin;
        const xAxis = this.computeAxisTicks(domainMin, domainMax, 5);

        xAxisContainer.innerHTML = '';
        const span = xAxis.max - xAxis.min || 1;

        xAxis.ticks.forEach((tick) => {
            const ratio = (tick - xAxis.min) / span;
            const percent = Math.max(0, Math.min(100, ratio * 100));
            const label = document.createElement('span');
            label.textContent = `${this.formatAxisDistance(tick)} km`;
            label.style.left = `${percent}%`;
            xAxisContainer.appendChild(label);
        });
    }

    /**
     * Format distance for axis label with 0.5 km discretization
     */
    formatAxisDistance(distanceKm) {
        const value = Number(distanceKm);
        if (!Number.isFinite(value)) return '0';
        const rounded = Math.round(value * 2) / 2;
        return rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1);
    }

    /**
     * Update elevation grid lines
     */
    updateElevationGridLines() {
        if (!this.elevationChartContainer) return;

        const svgElement = this.elevationChartContainer.querySelector('.elevation-area');
        if (!svgElement) return;

        // Remove existing grid lines
        const existingLines = svgElement.querySelectorAll('.elevation-grid-line');
        existingLines.forEach(line => line.remove());

        const yAxis = this.elevationYAxis;
        if (!yAxis || !Number.isFinite(yAxis.min) || !Number.isFinite(yAxis.max)) return;

        const yMin = yAxis.min;
        const yMax = yAxis.max;
        const ySpan = yMax - yMin;
        if (ySpan <= 0) return;

        // Add grid lines at intermediate positions
        const positions = [0.25, 0.5, 0.75];
        positions.forEach(ratio => {
            const yValue = yMin + ySpan * ratio;
            const yPercent = (1 - ratio) * 100;

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('class', 'elevation-grid-line');
            line.setAttribute('x1', '0');
            line.setAttribute('y1', yPercent.toFixed(2));
            line.setAttribute('x2', '100');
            line.setAttribute('y2', yPercent.toFixed(2));

            const fillPath = svgElement.querySelector('.elevation-area-fill');
            if (fillPath) {
                svgElement.insertBefore(line, fillPath);
            } else {
                svgElement.appendChild(line);
            }
        });
    }

    /**
     * Create or get the elevation chart tooltip element
     * @returns {HTMLElement} The tooltip element
     */
    ensureElevationChartTooltip() {
        if (this.elevationChartTooltip) {
            return this.elevationChartTooltip;
        }

        const tooltip = document.createElement('div');
        tooltip.className = 'elevation-chart-tooltip';
        tooltip.setAttribute('role', 'tooltip');
        tooltip.setAttribute('aria-hidden', 'true');
        tooltip.style.display = 'none';

        if (this.elevationChartContainer) {
            this.elevationChartContainer.appendChild(tooltip);
        } else if (this.elevationChart) {
            this.elevationChart.appendChild(tooltip);
        }

        this.elevationChartTooltip = tooltip;
        return tooltip;
    }

    /**
     * Hide the elevation chart tooltip
     */
    hideElevationChartTooltip() {
        if (this.elevationChartTooltip) {
            this.elevationChartTooltip.style.display = 'none';
            this.elevationChartTooltip.setAttribute('aria-hidden', 'true');
        }
    }

    /**
     * Get elevation at a specific distance along the route
     * @param {number} distanceKm - Distance in kilometers
     * @returns {number|null} Elevation at that distance
     */
    getElevationAtDistance(distanceKm) {
        const profile = this.getRouteProfile();
        if (!profile || !Number.isFinite(distanceKm)) {
            return null;
        }

        const distances = profile.cumulativeDistances ?? [];
        const elevations = profile.elevations ?? [];
        if (!Array.isArray(distances) || !Array.isArray(elevations) || distances.length !== elevations.length) {
            return null;
        }

        const lastIndex = distances.length - 1;
        if (lastIndex < 0) {
            return null;
        }

        // Binary search for the interval
        let low = 0;
        let high = lastIndex;
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (distances[mid] <= distanceKm) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        const prevIdx = Math.max(0, high);
        const nextIdx = Math.min(lastIndex, prevIdx + 1);

        const prevDist = distances[prevIdx];
        const nextDist = distances[nextIdx];
        const prevElev = elevations[prevIdx];
        const nextElev = elevations[nextIdx];

        if (!Number.isFinite(prevDist) || !Number.isFinite(prevElev)) {
            return null;
        }

        if (prevIdx === nextIdx || !Number.isFinite(nextDist) || !Number.isFinite(nextElev)) {
            return prevElev;
        }

        // Linear interpolation
        const span = nextDist - prevDist;
        if (span <= 0) {
            return prevElev;
        }

        const ratio = (distanceKm - prevDist) / span;
        const clampedRatio = Math.max(0, Math.min(1, ratio));
        return prevElev + (nextElev - prevElev) * clampedRatio;
    }

    /**
     * Cleanup resources
     */
    destroy() {
        if (this.elevationResizeObserver) {
            this.elevationResizeObserver.disconnect();
            this.elevationResizeObserver = null;
        }
        if (this.elevationChartTooltip?.parentNode) {
            this.elevationChartTooltip.parentNode.removeChild(this.elevationChartTooltip);
        }
        this.elevationChartTooltip = null;
    }
}
