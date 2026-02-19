import {
  ELEVATION_TICK_TARGET,
  DISTANCE_TICK_TARGET,
  DEFAULT_POI_COLOR,
  DEFAULT_POI_TITLE,
  POI_CATEGORY_PRIORITY
} from '../constants/directions-constants.js';

import { BIVOUAC_ELEVATION_ICON } from '../constants/directions-visual-constants.js';

import {
  adjustHexColor,
  escapeHtml
} from '../utils/directions-utils.js';

import { isProfileGradientMode } from '../utils/directions-profile-utils.js';


export class DirectionsManagerElevationMixin {
  /**
   * Get coordinate [lon, lat] at a given distance along the route
   */
  getCoordinateAtDistance(distanceKm) {
    const coords = this.routeGeojson?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) {
      return null;
    }

    let accumulatedKm = 0;
    for (let i = 1; i < coords.length; i++) {
      const prev = coords[i - 1];
      const curr = coords[i];
      if (!Array.isArray(prev) || !Array.isArray(curr)) continue;

      const segmentLengthKm = this.haversineDistance(prev[1], prev[0], curr[1], curr[0]);

      if (accumulatedKm + segmentLengthKm >= distanceKm) {
        // Interpolate position within this segment
        const ratio = segmentLengthKm > 0
          ? (distanceKm - accumulatedKm) / segmentLengthKm
          : 0;
        const lon = prev[0] + (curr[0] - prev[0]) * ratio;
        const lat = prev[1] + (curr[1] - prev[1]) * ratio;
        return [lon, lat];
      }

      accumulatedKm += segmentLengthKm;
    }

    // If distance exceeds route length, return last coordinate
    return coords[coords.length - 1];
  }

  zoomElevationChartToDay(dayIndex) {
    if (!this.routeGeojson?.geometry?.coordinates) return;

    // Store full route domain if not already stored
    if (!this.fullRouteDomain && this.elevationDomain) {
      this.fullRouteDomain = { ...this.elevationDomain };
    }
    // Store full route Y-axis if not already stored
    if (!this.fullRouteYAxis && this.elevationYAxis) {
      this.fullRouteYAxis = { ...this.elevationYAxis };
    }

    if (dayIndex === null || dayIndex === undefined) {
      // Restore full route view
      if (this.fullRouteDomain) {
        this.elevationDomain = { ...this.fullRouteDomain };
      }
      if (this.fullRouteYAxis) {
        this.elevationYAxis = { ...this.fullRouteYAxis };
      }
      this.updateElevationChartView();
      this.updateElevationYAxisLabels();
      return;
    }

    // Get the selected segment's range
    const segment = this.cutSegments?.[dayIndex];
    if (!segment) {
      // Restore full view if segment not found
      if (this.fullRouteDomain) {
        this.elevationDomain = { ...this.fullRouteDomain };
      }
      if (this.fullRouteYAxis) {
        this.elevationYAxis = { ...this.fullRouteYAxis };
      }
      this.updateElevationChartView();
      this.updateElevationYAxisLabels();
      return;
    }

    const startKm = Number(segment.startKm ?? segment.startDistanceKm ?? 0);
    const endKm = Number(segment.endKm ?? segment.endDistanceKm ?? startKm);

    // Add small padding (5% on each side)
    const segmentSpan = endKm - startKm;
    const padding = segmentSpan * 0.05;
    const paddedStart = Math.max(0, startKm - padding);
    const paddedEnd = endKm + padding;

    this.elevationDomain = {
      min: paddedStart,
      max: paddedEnd,
      span: paddedEnd - paddedStart
    };

    // Recalculate Y-axis for selected day segment
    const distances = this.routeProfile?.cumulativeDistances;
    const elevations = this.routeProfile?.elevations;
    if (Array.isArray(distances) && Array.isArray(elevations) && distances.length === elevations.length) {
      let minElevation = Infinity;
      let maxElevation = -Infinity;

      for (let i = 0; i < distances.length; i++) {
        const distKm = Number(distances[i]);
        const elevation = Number(elevations[i]);
        if (!Number.isFinite(distKm) || !Number.isFinite(elevation)) continue;

        // Only consider points within the segment range
        if (distKm >= startKm && distKm <= endKm) {
          if (elevation < minElevation) minElevation = elevation;
          if (elevation > maxElevation) maxElevation = elevation;
        }
      }

      // Apply padding to Y-axis (10%)
      if (Number.isFinite(minElevation) && Number.isFinite(maxElevation)) {
        const ySpan = maxElevation - minElevation;
        const yPadding = Math.max(ySpan * 0.1, 20); // At least 20m padding
        this.elevationYAxis = {
          min: Math.floor(minElevation - yPadding),
          max: Math.ceil(maxElevation + yPadding)
        };
      }
    }

    this.updateElevationChartView();
    this.updateElevationYAxisLabels();
  }

  updateElevationChartView() {
    // Re-render the elevation chart with the current domain
    if (!this.routeGeojson?.geometry?.coordinates) return;

    // Instead of full re-render, just update the SVG paths and markers
    const coordinates = this.routeGeojson.geometry.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return;

    // Update sparkline preview (always shows full route)
    this.renderElevationSparkline();

    // Rebuild the area paths for the new domain
    if (this.elevationChartContainer && this.elevationSamples?.length && this.elevationYAxis) {
      const paths = this.buildElevationAreaPaths(this.elevationSamples, this.elevationYAxis, this.elevationDomain);

      // Update SVG paths
      const fillPath = this.elevationChartContainer.querySelector('.elevation-area-fill');
      const strokePath = this.elevationChartContainer.querySelector('.elevation-area-stroke');
      if (fillPath && paths.fill) {
        fillPath.setAttribute('d', paths.fill);
      }
      if (strokePath && paths.stroke) {
        strokePath.setAttribute('d', paths.stroke);
      }

      // Regenerate and update the gradient for the new domain
      this.updateElevationGradient();

      // Update X-axis labels
      this.updateElevationXAxis();

      // Update Y-axis labels with altitude min/max
      this.updateElevationYAxisLabels();

      // Update grid lines to match Y-axis labels
      this.updateElevationGridLines();

      // Update marker positions and visibility
      this.updateElevationMarkerPositions();

      // Delay visibility update to ensure DOM is fully updated
      requestAnimationFrame(() => {
        this.updateElevationMarkerVisibility();
      });
    }
  }

  updateElevationMarkerVisibility() {
    if (!this.elevationChartContainer) return;

    const markers = this.elevationChartContainer.querySelectorAll('.elevation-marker.bivouac');
    if (!markers.length) return;

    const domainMin = this.elevationDomain?.min ?? 0;
    const domainMax = this.elevationDomain?.max ?? domainMin;
    const tolerance = Math.max(0.1, (domainMax - domainMin) * 0.05); // 5% tolerance, min 0.1km

    markers.forEach((marker) => {
      const distanceKm = Number(marker.dataset.distanceKm);

      if (!Number.isFinite(distanceKm)) {
        marker.style.display = 'none';
        return;
      }

      // When zoomed to a day, show bivouacs at boundaries of the selected day
      if (this.selectedDayIndex !== null && this.selectedDayIndex !== undefined) {
        const segment = this.cutSegments?.[this.selectedDayIndex];
        const totalSegments = Array.isArray(this.cutSegments) ? this.cutSegments.length : 0;
        const isLastDay = this.selectedDayIndex === totalSegments - 1;
        const isFirstDay = this.selectedDayIndex === 0;

        if (segment) {
          const startKm = Number(segment.startKm ?? segment.startDistanceKm ?? 0);
          const endKm = Number(segment.endKm ?? segment.endDistanceKm ?? 0);

          // Show bivouac at the END of the day (if not the last day)
          const isEndBivouac = !isLastDay && Math.abs(distanceKm - endKm) <= tolerance;
          // Show bivouac at the START of the day (if not the first day)
          const isStartBivouac = !isFirstDay && Math.abs(distanceKm - startKm) <= tolerance;

          // Show if it's either the start or end bivouac of this day segment
          marker.style.display = (isEndBivouac || isStartBivouac) ? '' : 'none';
        } else {
          marker.style.display = 'none';
        }
      } else {
        // Full route view - show all markers
        marker.style.display = '';
      }
    });
  }

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

    // Always include min (at bottom)
    ticks.push({ value: yMin, percent: 0, isEdge: true, isMax: false });

    // Add ONE intermediate tick at a nice round number near the middle
    // Round to 100m, 50m, or 25m depending on elevation span
    const midValue = (yMin + yMax) / 2;
    let step;
    if (ySpan >= 100) {
      step = 100;
    } else if (ySpan >= 50) {
      step = 50;
    } else {
      step = 25;
    }

    // Round midValue to nearest step
    const roundedMid = Math.round(midValue / step) * step;

    // Only add if not too close to min or max (within 20% of span from edges)
    const minDistance = ySpan * 0.2;
    if (roundedMid - yMin > minDistance && yMax - roundedMid > minDistance) {
      const percent = ((roundedMid - yMin) / ySpan) * 100;
      ticks.push({ value: roundedMid, percent, isEdge: false, isMax: false });
    }

    // Always include max (at top)
    ticks.push({ value: yMax, percent: 100, isEdge: true, isMax: true });

    // Generate HTML - labels positioned using bottom percentage
    const labelsHtml = ticks.map(tick => {
      const label = Math.round(tick.value).toLocaleString();
      const className = tick.isEdge
        ? (tick.isMax ? 'chart-card__y-max' : 'chart-card__y-min')
        : 'chart-card__y-mid';
      return `<span class="${className}" style="bottom: ${tick.percent.toFixed(2)}%">${label}</span>`;
    }).join('');

    yAxisLabels.innerHTML = labelsHtml;
  }

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

    // Round to 100m, 50m, or 25m depending on elevation span
    const midValue = (yMin + yMax) / 2;
    let step;
    if (ySpan >= 100) {
      step = 100;
    } else if (ySpan >= 50) {
      step = 50;
    } else {
      step = 25;
    }

    // Round midValue to nearest step
    const roundedMid = Math.round(midValue / step) * step;

    // Only add if not too close to min or max (within 20% of span from edges)
    const minDistance = ySpan * 0.2;
    if (roundedMid - yMin > minDistance && yMax - roundedMid > minDistance) {
      const yPercent = 100 - ((roundedMid - yMin) / ySpan) * 100;

      // Create and insert the grid line
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('class', 'elevation-grid-line');
      line.setAttribute('x1', '0');
      line.setAttribute('y1', yPercent.toFixed(2));
      line.setAttribute('x2', '100');
      line.setAttribute('y2', yPercent.toFixed(2));

      // Insert before the fill path
      const fillPath = svgElement.querySelector('.elevation-area-fill');
      if (fillPath) {
        svgElement.insertBefore(line, fillPath);
      } else {
        svgElement.appendChild(line);
      }
    }
  }

  updateElevationGradient() {
    if (!this.elevationChartContainer) return;

    const gradientEl = this.elevationChartContainer.querySelector('linearGradient#elevation-area-gradient');
    if (!gradientEl) return;

    const domainMin = this.elevationDomain?.min ?? 0;
    const domainMax = this.elevationDomain?.max ?? domainMin;
    const domainSpan = domainMax - domainMin;
    if (domainSpan <= 0) return;

    const fallbackColor = this.modeColors[this.currentMode];
    const gradientStops = [];

    const useProfileGradient = isProfileGradientMode(this.profileMode)
      && Array.isArray(this.profileSegments)
      && this.profileSegments.length > 0;

    if (useProfileGradient) {
      // PRIORITY 1: Terrain Profile (Slopes, Surface, etc.)
      const segmentInfos = this.profileSegments
        .map((segment) => {
          if (!segment) return null;
          const segmentColor = typeof segment.color === 'string' ? segment.color.trim() : '';
          if (!segmentColor) return null;
          let startKm = Number(segment.startKm ?? segment.startDistanceKm ?? 0);
          let endKm = Number(segment.endKm ?? segment.endDistanceKm ?? startKm);
          return { startKm, endKm, color: segmentColor };
        })
        .filter(Boolean);

      const kmToRatio = (km) => Math.max(0, Math.min(1, (km - domainMin) / domainSpan));
      const TRANSITION_RATIO = 0.25;

      segmentInfos.forEach((info, index) => {
        const { startKm, endKm, color } = info;
        const segmentLength = endKm - startKm;
        const prevInfo = index > 0 ? segmentInfos[index - 1] : null;
        const nextInfo = segmentInfos[index + 1];

        if (segmentLength <= 0) {
          gradientStops.push({ offset: kmToRatio(startKm), color });
          return;
        }

        const transitionSize = segmentLength * TRANSITION_RATIO;
        const transitionInEnd = startKm + transitionSize;
        const transitionOutStart = endKm - transitionSize;

        if (prevInfo && prevInfo.color !== color) {
          gradientStops.push({ offset: kmToRatio(startKm), color: prevInfo.color });
          if (transitionInEnd < transitionOutStart) {
            gradientStops.push({ offset: kmToRatio(transitionInEnd), color });
          }
        } else {
          gradientStops.push({ offset: kmToRatio(startKm), color });
        }

        if (nextInfo && nextInfo.color !== color) {
          if (transitionOutStart > transitionInEnd) {
            gradientStops.push({ offset: kmToRatio(transitionOutStart), color });
          }
        } else {
          gradientStops.push({ offset: kmToRatio(endKm), color });
        }
      });
    } else if (Array.isArray(this.cutSegments) && this.cutSegments.length > 1) {
      // PRIORITY 2: Multi-day hike colors (Jour 1, Jour 2, etc.)
      // This logic works both in full route view and zoomed day view
      const cutSegs = this.cutSegments;
      for (let i = 0; i < cutSegs.length; i += 1) {
        const segment = cutSegs[i];
        if (!segment) continue;

        const segmentColor = typeof segment.color === 'string' ? segment.color.trim() : fallbackColor;
        let startKm = Number(segment.startKm ?? segment.startDistanceKm ?? 0);
        let endKm = Number(segment.endKm ?? segment.endDistanceKm ?? startKm);

        const startRatio = Math.max(0, Math.min(1, (startKm - domainMin) / domainSpan));
        const endRatio = Math.max(0, Math.min(1, (endKm - domainMin) / domainSpan));

        // Skip segments entirely outside the visible domain
        if (endKm < domainMin - 0.001 || startKm > domainMax + 0.001) {
          continue;
        }

        gradientStops.push({ offset: startRatio, color: segmentColor });

        if (i < cutSegs.length - 1) {
          const nextSegment = cutSegs[i + 1];
          if (nextSegment) {
            const nextColor = typeof nextSegment.color === 'string' ? nextSegment.color.trim() : fallbackColor;
            gradientStops.push({ offset: Math.max(0, endRatio - 0.0001), color: segmentColor });
            gradientStops.push({ offset: endRatio, color: nextColor });
          }
        } else {
          gradientStops.push({ offset: endRatio, color: segmentColor });
        }
      }
    } else {
      // PRIORITY 3: Fallback monochrome
      const baseColor = this.cutSegments?.[0]?.color ?? fallbackColor;
      gradientStops.push({ offset: 0, color: baseColor });
      gradientStops.push({ offset: 1, color: baseColor });
    }

    // Sort stops by offset to ensure valid SVG gradient
    gradientStops.sort((a, b) => a.offset - b.offset);

    // Boundary stops
    if (gradientStops.length > 0 && gradientStops[0].offset > 0.001) {
      gradientStops.unshift({ offset: 0, color: gradientStops[0].color });
    }
    if (gradientStops.length > 0 && gradientStops[gradientStops.length - 1].offset < 0.999) {
      gradientStops.push({ offset: 1, color: gradientStops[gradientStops.length - 1].color });
    }

    // Update DOM
    gradientEl.innerHTML = '';
    if (gradientStops.length === 0) {
      const stopEl = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stopEl.setAttribute('offset', '0%');
      stopEl.setAttribute('stop-color', fallbackColor);
      gradientEl.appendChild(stopEl);
    } else {
      gradientStops.forEach((stop) => {
        const stopEl = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stopEl.setAttribute('offset', `${(stop.offset * 100).toFixed(4)}%`);
        stopEl.setAttribute('stop-color', stop.color);
        gradientEl.appendChild(stopEl);
      });
    }
  }

  updateElevationXAxis() {
    if (!this.elevationChart) return;

    const xAxisContainer = this.elevationChart.querySelector('.elevation-x-axis');
    if (!xAxisContainer) return;

    const domainMin = this.elevationDomain?.min ?? 0;
    const domainMax = this.elevationDomain?.max ?? domainMin;
    const xAxis = this.computeAxisTicks(domainMin, domainMax, 5);

    // Clear and rebuild X-axis labels
    xAxisContainer.innerHTML = '';
    const span = xAxis.max - xAxis.min || 1;

    // Filter out intermediate ticks that are too close to the start or end to prevent label overlap
    const minProximity = span * 0.12;
    const finalTicks = xAxis.ticks.filter((tick, idx) => {
      if (idx === 0 || idx === xAxis.ticks.length - 1) return true;
      return Math.abs(tick - xAxis.min) > minProximity && Math.abs(tick - xAxis.max) > minProximity;
    });

    finalTicks.forEach((tick, idx) => {
      const ratio = (tick - xAxis.min) / span;
      const percent = Math.max(0, Math.min(100, ratio * 100));
      const label = document.createElement('span');
      // Show "km" on all ticks, use 0.5 discretization
      label.textContent = `${this.formatAxisDistance(tick)} km`;
      label.style.left = `${percent}%`;

      // Justify first and last labels to stay within the chart area
      if (idx === 0) {
        label.style.transform = 'none';
      } else if (idx === finalTicks.length - 1) {
        label.style.transform = 'translateX(-100%)';
      }

      xAxisContainer.appendChild(label);
    });
  }

  updateRouteStatsHover(distanceKm) {
    // Instead of updating the route stats panel, show a tooltip on the chart
    // This prevents layout shifts and keeps the day details visible

    if (!Number.isFinite(distanceKm)) {
      // Hide chart tooltip when not hovering
      this.hideElevationChartTooltip();
      return;
    }

    if (!this.routeProfile || !Array.isArray(this.routeProfile.coordinates)
      || this.routeProfile.coordinates.length < 2) {
      this.hideElevationChartTooltip();
      return;
    }

    // Get elevation and grade at this distance
    const elevation = this.getElevationAtDistance(distanceKm);
    const grade = this.computeGradeAtDistance(distanceKm);
    const totalDistance = Number(this.routeProfile?.totalDistanceKm) || 0;

    // Find the current day segment (from last bivouac)
    // On multiday routes, compute from day segment start, not route start
    let segmentStartKm = 0;
    if (Array.isArray(this.cutSegments) && this.cutSegments.length > 1) {
      const currentSegment = this.getCutSegmentForDistance(distanceKm);
      if (currentSegment) {
        const startKm = Number(currentSegment.startKm ?? currentSegment.startDistanceKm);
        if (Number.isFinite(startKm)) {
          segmentStartKm = startKm;
        }
      }
    }

    // Calculate distance from segment start (day distance)
    const dayDistanceKm = distanceKm - segmentStartKm;

    // Calculate cumulative metrics from segment start to current position
    const cumulativeMetrics = this.computeCumulativeMetrics(distanceKm, segmentStartKm);
    const ascent = Math.max(0, Math.round(cumulativeMetrics?.ascent ?? 0));
    const descent = Math.max(0, Math.round(cumulativeMetrics?.descent ?? 0));
    const durationHours = this.estimateTravelTimeHours(dayDistanceKm, ascent, descent);

    // Find nearby POI (within 0.3km threshold)
    const nearbyPoi = this.findNearbyPoi(distanceKm, 0.3);

    // Show tooltip on the elevation chart with day-relative values
    // Pass both display distance (day-relative) and position distance (absolute)
    this.showElevationChartTooltip(dayDistanceKm, elevation, grade, durationHours, ascent, distanceKm, totalDistance, nearbyPoi);
  }

  findNearbyPoi(distanceKm, thresholdKm = 0.3) {
    if (!Array.isArray(this.routePointsOfInterest) || !this.routePointsOfInterest.length) {
      return null;
    }

    let closestPoi = null;
    let closestDistance = thresholdKm;

    for (const poi of this.routePointsOfInterest) {
      const poiDistance = Number(poi?.distanceKm);
      if (!Number.isFinite(poiDistance)) continue;

      const delta = Math.abs(poiDistance - distanceKm);
      if (delta < closestDistance) {
        closestDistance = delta;
        closestPoi = poi;
      }
    }

    return closestPoi;
  }

  ensureElevationChartTooltip() {
    if (this.elevationChartTooltip) {
      return this.elevationChartTooltip;
    }

    const tooltip = document.createElement('div');
    tooltip.className = 'elevation-chart-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.setAttribute('aria-hidden', 'true');
    tooltip.style.display = 'none';

    // Append to elevation chart container if available, otherwise to body
    if (this.elevationChartContainer) {
      this.elevationChartContainer.appendChild(tooltip);
    } else if (this.elevationChart) {
      this.elevationChart.appendChild(tooltip);
    }

    this.elevationChartTooltip = tooltip;
    return tooltip;
  }

  showElevationChartTooltip(displayDistanceKm, elevation, grade, durationHours, cumulativeAscent, positionDistanceKm, totalDistance, nearbyPoi = null) {
    if (!this.elevationChartContainer) {
      return;
    }

    const tooltip = this.ensureElevationChartTooltip();

    // Calculate horizontal position based on absolute position distance
    let domainMin = Number(this.elevationDomain?.min);
    let domainMax = Number(this.elevationDomain?.max);
    if (!Number.isFinite(domainMin) || !Number.isFinite(domainMax)) {
      domainMin = 0;
      domainMax = totalDistance;
    }

    const span = domainMax - domainMin;
    if (!(span > 0)) {
      return;
    }

    const ratio = (positionDistanceKm - domainMin) / span;
    const clampedRatio = Math.max(0, Math.min(1, ratio));
    const percent = clampedRatio * 100;

    // Format labels - use display distance (from day start on multiday routes)
    const distanceLabel = this.formatDistance(displayDistanceKm);
    const elevationLabel = Number.isFinite(elevation) ? `${Math.round(elevation)} m` : '—';
    const gradeLabel = Number.isFinite(grade) ? `${grade > 0 ? '+' : ''}${grade.toFixed(1)}% ` : '—';
    const durationLabel = Number.isFinite(durationHours) ? this.formatDurationHours(durationHours) : '—';
    const ascentLabel = Number.isFinite(cumulativeAscent) && cumulativeAscent > 0 ? `+ ${cumulativeAscent} m` : '—';

    // Build POI section if nearby
    let poiMarkup = '';
    if (nearbyPoi) {
      const poiName = nearbyPoi.name || nearbyPoi.title || '';
      const poiCategory = nearbyPoi.categoryLabel || '';
      const poiElevation = Number.isFinite(nearbyPoi.elevation) ? Math.round(nearbyPoi.elevation) : null;

      if (poiName || poiCategory) {
        const nameHtml = poiName ? `<strong>${escapeHtml(poiName)}</strong>` : '';
        const categoryHtml = poiCategory && poiCategory !== poiName ? `<span class="elevation-chart-tooltip__poi-category">${escapeHtml(poiCategory)}</span>` : '';
        const elevHtml = poiElevation !== null ? `<span class="elevation-chart-tooltip__poi-elev">${poiElevation} m</span>` : '';

        poiMarkup = `
          <div class="elevation-chart-tooltip__poi">
            ${nameHtml}
            ${categoryHtml}
            ${elevHtml}
          </div>
        `;
      }
    }

    tooltip.innerHTML = `
      ${poiMarkup}
      <div class="elevation-chart-tooltip__distance">${escapeHtml(distanceLabel)} km</div>
      <div class="elevation-chart-tooltip__details">
        <span class="elevation-chart-tooltip__elevation">Alt. ${escapeHtml(elevationLabel)}</span>
        <span class="elevation-chart-tooltip__ascent">↗ ${escapeHtml(ascentLabel)}</span>
        <span class="elevation-chart-tooltip__grade">${escapeHtml(gradeLabel)}</span>
        <span class="elevation-chart-tooltip__duration">${escapeHtml(durationLabel)}</span>
      </div>
      `;

    // Position tooltip - centered on the hover line, above the chart
    tooltip.style.left = `${percent}% `;
    tooltip.style.display = 'block';
    tooltip.setAttribute('aria-hidden', 'false');
  }

  hideElevationChartTooltip() {
    if (this.elevationChartTooltip) {
      this.elevationChartTooltip.style.display = 'none';
      this.elevationChartTooltip.setAttribute('aria-hidden', 'true');
    }
  }

  updateElevationProfile(coordinates) {
    if (!this.elevationChart) {
      this.updateProfileLegend(false);
      return;
    }
    this.detachElevationChartEvents();
    this.lastElevationHoverDistance = null;
    this.elevationChartTooltip = null; // Clear tooltip so it's recreated for new container
    if (this.elevationResizeObserver) {
      this.elevationResizeObserver.disconnect();
      this.elevationResizeObserver = null;
    }
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      this.elevationChart.innerHTML = '';
      this.elevationSamples = [];
      this.elevationDomain = null;
      this.fullRouteDomain = null;
      this.fullRouteYAxis = null;
      this.elevationYAxis = null;
      this.elevationChartContainer = null;
      this.elevationChartTooltip = null;
      this.elevationHoverIndicator = null;
      this.elevationHoverLine = null;
      this.highlightedElevationBar = null;
      this.updateProfileLegend(false);
      this.updateElevationVisibilityState();
      return;
    }

    // Use densified coordinates from the route profile for more accurate sampling if available.
    const sourceCoords = (Array.isArray(this.routeProfile?.coordinates) &&
      this.routeProfile.coordinates.length >= coordinates.length)
      ? this.routeProfile.coordinates
      : coordinates;

    const samples = this.generateElevationSamples(sourceCoords);

    if (!samples.length) {
      this.elevationChart.innerHTML = '';
      this.elevationSamples = [];
      this.elevationDomain = null;
      this.fullRouteDomain = null;
      this.fullRouteYAxis = null;
      this.elevationYAxis = null;
      this.elevationChartContainer = null;
      this.elevationChartTooltip = null;
      this.elevationHoverIndicator = null;
      this.elevationHoverLine = null;
      this.highlightedElevationBar = null;
      this.lastElevationHoverDistance = null;
      this.updateProfileLegend(false);
      this.updateElevationVisibilityState();
      this.renderElevationSparkline();
      return;
    }

    const metrics = this.latestMetrics ?? this.calculateRouteMetrics({ geometry: { coordinates } });
    const totalDistance = Number(metrics.distanceKm) || 0;

    this.elevationSamples = samples;

    const elevations = samples.map((sample) => sample.elevation);
    const maxElevation = Math.max(...elevations);
    const minElevation = Math.min(...elevations);
    const elevationSpan = maxElevation - minElevation;
    const computedMargin = Math.min(
      10,
      Math.max(5, Number.isFinite(elevationSpan) ? elevationSpan * 0.05 : 0)
    );
    const margin = Number.isFinite(computedMargin) ? computedMargin : 5;
    const yMin = minElevation - margin;
    const yMax = maxElevation + margin;
    const yAxis = this.computeAxisTicks(yMin, yMax, ELEVATION_TICK_TARGET);
    const range = Math.max(Number.EPSILON, yAxis.max - yAxis.min);
    this.elevationYAxis = { min: yAxis.min, max: yAxis.max };
    this.fullRouteYAxis = { min: yAxis.min, max: yAxis.max };

    const distanceSeries = Array.isArray(this.routeProfile?.cumulativeDistances)
      ? this.routeProfile.cumulativeDistances.filter((value) => Number.isFinite(value))
      : [];
    let domainStart = distanceSeries.length ? Number(distanceSeries[0]) : Number(samples[0]?.startDistanceKm);
    let domainEnd = distanceSeries.length
      ? Number(distanceSeries[distanceSeries.length - 1])
      : Number(samples[samples.length - 1]?.endDistanceKm);
    if (!Number.isFinite(domainStart)) {
      domainStart = 0;
    }
    if (!Number.isFinite(domainEnd)) {
      domainEnd = domainStart;
    }
    if (domainEnd < domainStart) {
      [domainStart, domainEnd] = [domainEnd, domainStart];
    }
    const xAxis = this.computeAxisTicks(domainStart, domainEnd, DISTANCE_TICK_TARGET);
    const xMin = xAxis.min;
    const xMax = xAxis.max;
    const rawXSpan = xMax - xMin;
    const safeXSpan = rawXSpan === 0 ? 1 : rawXSpan;
    const xBoundaryTolerance = Math.max(1e-6, Math.abs(rawXSpan) * 1e-4);
    this.elevationDomain = { min: xMin, max: xMax, span: rawXSpan };
    this.fullRouteDomain = { min: xMin, max: xMax, span: rawXSpan };

    const fallbackColor = this.modeColors[this.currentMode];
    const gradientEnabled = isProfileGradientMode(this.profileMode);
    const gradientStops = [];
    const addGradientStop = (distanceKm, color) => {
      if (!Number.isFinite(distanceKm) || typeof color !== 'string') {
        return;
      }
      if (!(rawXSpan > 0)) {
        return;
      }
      const trimmed = color.trim();
      if (!trimmed) {
        return;
      }
      const clampedDistance = Math.min(xMax, Math.max(xMin, distanceKm));
      const ratio = Math.max(0, Math.min(1, (clampedDistance - xMin) / safeXSpan));
      gradientStops.push({ offset: ratio, color: trimmed });
    };

    if (gradientEnabled) {
      // Build BIDIRECTIONAL CENTERED gradients from profile segments
      // Pure color is centered in each segment, with smooth transitions towards neighbors
      const gradientSegments = (() => {
        if (Array.isArray(this.profileSegments) && this.profileSegments.length) {
          return this.profileSegments;
        }
        if (Array.isArray(this.cutSegments) && this.cutSegments.length) {
          return this.cutSegments;
        }
        return [];
      })();

      // Build segment info with km ranges
      const segmentInfos = gradientSegments
        .map((segment) => {
          if (!segment) return null;
          const segmentColor = typeof segment.color === 'string' ? segment.color.trim() : '';
          if (!segmentColor) return null;
          let startKm = Number(segment.startKm);
          if (!Number.isFinite(startKm)) startKm = Number(segment.startDistanceKm);
          if (!Number.isFinite(startKm)) startKm = 0;
          let endKm = Number(segment.endKm);
          if (!Number.isFinite(endKm)) endKm = Number(segment.endDistanceKm);
          if (!Number.isFinite(endKm)) endKm = startKm;
          return { startKm, endKm, color: segmentColor };
        })
        .filter(Boolean);

      // Create BIDIRECTIONAL centered gradient:
      // - Pure color is at the CENTER (50%) of each segment
      // - Transition zone at the START (0-25%) blends from previous color
      // - Transition zone at the END (75-100%) blends towards next color
      const TRANSITION_RATIO = 0.25; // 25% transition zone on each side

      segmentInfos.forEach((info, index) => {
        const { startKm, endKm, color } = info;
        const segmentLength = endKm - startKm;
        const prevInfo = index > 0 ? segmentInfos[index - 1] : null;
        const nextInfo = segmentInfos[index + 1];

        if (segmentLength <= 0) {
          addGradientStop(startKm, color);
          return;
        }

        const transitionSize = segmentLength * TRANSITION_RATIO;

        // Calculate transition points
        const transitionInEnd = startKm + transitionSize; // End of transition from prev
        const transitionOutStart = endKm - transitionSize; // Start of transition to next

        // Start of segment - blend from previous color
        if (prevInfo && prevInfo.color !== color) {
          // Previous color ends at segment start
          addGradientStop(startKm, prevInfo.color);
          // Current color fully established after transition zone
          if (transitionInEnd < transitionOutStart) {
            addGradientStop(transitionInEnd, color);
          }
        } else {
          // No transition needed, start with current color
          addGradientStop(startKm, color);
        }

        // End of segment - blend towards next color
        if (nextInfo && nextInfo.color !== color) {
          // Current color until transition zone starts
          if (transitionOutStart > transitionInEnd) {
            addGradientStop(transitionOutStart, color);
          }
          // Next color will be added at segment end by the next iteration
        } else {
          // No transition needed, end with current color
          addGradientStop(endKm, color);
        }
      });
    }

    // Add sharp transitions at cutSegment boundaries (for bivouac day splits)
    // This ensures day segments have crisp color changes, not gradients
    // Only apply day colors when NOT in a profile gradient mode (slope/surface/category)
    if (!gradientEnabled && Array.isArray(this.cutSegments) && this.cutSegments.length > 1) {
      const cutSegs = this.cutSegments;
      for (let i = 0; i < cutSegs.length; i += 1) {
        const segment = cutSegs[i];
        if (!segment) continue;

        const segmentColor = typeof segment.color === 'string' ? segment.color.trim() : fallbackColor;
        let startKm = Number(segment.startKm);
        if (!Number.isFinite(startKm)) startKm = Number(segment.startDistanceKm);
        if (!Number.isFinite(startKm)) startKm = 0;

        let endKm = Number(segment.endKm);
        if (!Number.isFinite(endKm)) endKm = Number(segment.endDistanceKm);
        if (!Number.isFinite(endKm)) endKm = startKm;

        // Calculate ratios for this segment
        const clampedStart = Math.min(xMax, Math.max(xMin, startKm));
        const clampedEnd = Math.min(xMax, Math.max(xMin, endKm));
        const startRatio = Math.max(0, Math.min(1, (clampedStart - xMin) / safeXSpan));
        const endRatio = Math.max(0, Math.min(1, (clampedEnd - xMin) / safeXSpan));

        // Add segment start color
        gradientStops.push({ offset: startRatio, color: segmentColor });

        // For sharp transitions: add current color just BEFORE boundary, next color AT boundary
        if (i < cutSegs.length - 1) {
          const nextSegment = cutSegs[i + 1];
          if (nextSegment) {
            const nextColor = typeof nextSegment.color === 'string'
              ? nextSegment.color.trim()
              : fallbackColor;
            // Current color just before boundary (tiny offset difference creates hard edge)
            gradientStops.push({ offset: Math.max(0, endRatio - 0.0001), color: segmentColor });
            // Next color at boundary
            gradientStops.push({ offset: endRatio, color: nextColor });
          }
        } else {
          // Last segment - add end stop
          gradientStops.push({ offset: endRatio, color: segmentColor });
        }
      }
    }

    const hitTargetsHtml = samples
      .map((sample) => {
        const midDistance = (sample.startDistanceKm + sample.endDistanceKm) / 2;
        const profileSegment = this.profileMode !== 'none'
          ? this.getProfileSegmentForDistance(midDistance)
          : null;
        const cutSegment = this.getCutSegmentForDistance(midDistance);
        const baseSegment = profileSegment ?? cutSegment;
        const baseColor = typeof baseSegment?.color === 'string' && baseSegment.color.trim()
          ? baseSegment.color.trim()
          : fallbackColor;
        const resolveSegmentColor = (distanceKm) => {
          const color = this.getColorForDistance(distanceKm);
          if (typeof color === 'string') {
            const trimmed = color.trim();
            if (trimmed) {
              return trimmed;
            }
          }
          return fallbackColor;
        };
        const startColor = resolveSegmentColor(sample.startDistanceKm);
        const endColor = resolveSegmentColor(sample.endDistanceKm);
        // Only add sample-based gradient stops if we don't have cut segments
        // Cut segments handle their own gradient stops with sharp transitions
        if (!Array.isArray(this.cutSegments) || this.cutSegments.length <= 1) {
          addGradientStop(sample.startDistanceKm, startColor);
          addGradientStop(sample.endDistanceKm, endColor);
        }
        const segment = baseSegment;
        const accentColor = adjustHexColor(baseColor, 0.18);
        const spanKm = Math.max(0, sample.endDistanceKm - sample.startDistanceKm);
        const fallbackSpan = samples.length
          ? Math.max(totalDistance / (samples.length * 2), 0.0005)
          : 0.0005;
        const flexGrow = spanKm > 0 ? spanKm : fallbackSpan;
        const titleParts = [];
        if (Number.isFinite(sample.elevation)) {
          titleParts.push(`${Math.round(sample.elevation)} m`);
        }
        if (profileSegment?.name) {
          titleParts.push(profileSegment.name);
        } else if (cutSegment?.name) {
          titleParts.push(cutSegment.name);
        }
        const title = titleParts.join(' · ');
        const style = [
          `--bar-flex-grow:${flexGrow.toFixed(6)}`,
          `--bar-highlight:${accentColor}`
        ].join(';');
        return `
        <div
          class="elevation-bar"
          data-start-km="${sample.startDistanceKm.toFixed(6)}"
          data-end-km="${sample.endDistanceKm.toFixed(6)}"
          data-mid-km="${((sample.startDistanceKm + sample.endDistanceKm) / 2).toFixed(6)}"
          data-segment-index="${segment ? segment.index : -1}"
          style="${style}"
        ></div>
        `;
      })
      .join('');

    const xTickValues = Array.isArray(xAxis.ticks)
      ? xAxis.ticks.filter((value) => Number.isFinite(value))
      : [];
    const ensureTick = (value) => {
      if (!Number.isFinite(value)) {
        return;
      }
      const exists = xTickValues.some((tick) => Math.abs(tick - value) < 1e-6);
      if (!exists) {
        xTickValues.push(value);
      }
    };
    ensureTick(xMin);
    ensureTick(xMax);
    xTickValues.sort((a, b) => a - b);

    // Filter out intermediate ticks that are too close to the start or end to prevent label overlap
    // Use a 12% of total span threshold as a safe buffer for label width
    const minProximity = safeXSpan * 0.12;
    const finalTicks = xTickValues.filter((tick, idx) => {
      if (idx === 0 || idx === xTickValues.length - 1) return true; // Always keep absolute min/max
      const distToStart = Math.abs(tick - xMin);
      const distToEnd = Math.abs(tick - xMax);
      return distToStart > minProximity && distToEnd > minProximity;
    });

    const xAxisLabels = finalTicks
      .map((value) => {
        const clampedValue = Math.min(xMax, Math.max(xMin, value));
        const ratio = rawXSpan === 0
          ? 0
          : Math.max(0, Math.min(1, (clampedValue - xMin) / safeXSpan));
        const position = (ratio * 100).toFixed(3);
        let transform = 'translateX(-50%)';
        if (ratio <= 0.001) {
          transform = 'translateX(0)';
        } else if (ratio >= 0.999) {
          transform = 'translateX(-100%)';
        }
        const style = `left:${position}%; transform:${transform}`;
        return `<span style="${style}">${this.formatDistanceTick(clampedValue)}</span>`;
      })
      .join('');

    const gradientId = 'elevation-area-gradient';
    const gradientMarkup = (() => {
      if (!gradientStops.length) {
        return '';
      }
      // Sort by offset
      const sorted = gradientStops
        .map((stop) => ({
          offset: Math.max(0, Math.min(1, stop.offset ?? 0)),
          color: stop.color
        }))
        .sort((a, b) => a.offset - b.offset);

      if (sorted.length < 2) {
        return '';
      }

      // Ensure we have stops at boundaries
      if (sorted[0].offset > 0.001) {
        sorted.unshift({ offset: 0, color: sorted[0].color });
      }
      if (sorted[sorted.length - 1].offset < 0.999) {
        sorted.push({ offset: 1, color: sorted[sorted.length - 1].color });
      }

      // Use raw stops directly (no additional processing)
      const stopsMarkup = sorted
        .map((stop) => `<stop offset="${(stop.offset * 100).toFixed(4)}%" stop-color="${stop.color}" />`)
        .join('');
      // Force horizontal gradient with x1/y1/x2/y2 (left to right, no vertical component)
      return `<defs><linearGradient id="${gradientId}" x1="0%" y1="50%" x2="100%" y2="50%" gradientUnits="objectBoundingBox">${stopsMarkup}</linearGradient></defs>`;
    })();

    const areaPaths = this.buildElevationAreaPaths(samples, yAxis, { min: xMin, max: xMax });
    const areaFillColor = adjustHexColor(fallbackColor, 0.08);

    // Generate horizontal grid lines at nice elevation intervals
    const gridLinesMarkup = (() => {
      const yMin = yAxis.min;
      const yMax = yAxis.max;
      const ySpan = yMax - yMin;
      if (ySpan <= 0) return '';

      // Round to 100m, 50m, or 25m depending on elevation span
      const midValue = (yMin + yMax) / 2;
      let step;
      if (ySpan >= 100) {
        step = 100;
      } else if (ySpan >= 50) {
        step = 50;
      } else {
        step = 25;
      }

      // Round midValue to nearest step
      const roundedMid = Math.round(midValue / step) * step;

      // Only add if not too close to min or max (within 20% of span from edges)
      const minDistance = ySpan * 0.2;
      if (roundedMid - yMin > minDistance && yMax - roundedMid > minDistance) {
        const yPercent = 100 - ((roundedMid - yMin) / ySpan) * 100;
        return `<line class="elevation-grid-line" x1="0" y1="${yPercent.toFixed(2)}" x2="100" y2="${yPercent.toFixed(2)}" />`;
      }
      return '';
    })();

    const areaSvg = areaPaths.fill
      ? `
        <svg class="elevation-area" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            ${gradientMarkup}
            <linearGradient id="elevation-fade-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="white" stop-opacity="1.0" />
              <stop offset="100%" stop-color="white" stop-opacity="0.1" />
            </linearGradient>
            <mask id="elevation-fade-mask">
              <rect x="0" y="0" width="100" height="100" fill="url(#elevation-fade-gradient)" />
            </mask>
          </defs>
          ${gridLinesMarkup}
          <path class="elevation-area-fill" d="${areaPaths.fill}" 
                fill="${gradientMarkup ? `url(#${gradientId})` : areaFillColor}"
                mask="url(#elevation-fade-mask)" />
          <path class="elevation-area-stroke" d="${areaPaths.stroke}" 
                stroke="${gradientMarkup ? `url(#${gradientId})` : areaFillColor}" />
        </svg>
        `
      : '';

    const markerOverlay = (() => {
      if (!(rawXSpan > 0)) {
        return '';
      }
      const markerElements = [];

      // 1. Gather all markers (Bivouacs + POIs)
      const allMarkers = [];

      // Add Bivouacs
      const bivouacMarkers = this.computeSegmentMarkers();
      if (Array.isArray(bivouacMarkers)) {
        bivouacMarkers
          .filter(m => m?.type === 'bivouac')
          .forEach(m => {
            const dist = this.getMarkerDistance(m);
            if (Number.isFinite(dist) && dist >= xMin - xBoundaryTolerance && dist <= xMax + xBoundaryTolerance) {
              allMarkers.push({
                type: 'bivouac',
                categoryKey: 'bivouac',
                distanceKm: dist,
                data: m,
                name: m.name || m.title || 'Bivouac'
              });
            }
          });
      }

      // Add POIs
      const poiMarkers = Array.isArray(this.routePointsOfInterest) ? this.routePointsOfInterest : [];
      if (this.profileMode === 'poi') {
        poiMarkers.forEach(poi => {
          const dist = Number(poi?.distanceKm);
          if (Number.isFinite(dist) && dist >= xMin - xBoundaryTolerance && dist <= xMax + xBoundaryTolerance) {
            allMarkers.push({
              categoryKey: poi.category || poi.categoryKey || '',
              distanceKm: dist,
              data: poi,
              name: poi.name || poi.title || DEFAULT_POI_TITLE
            });
          }
        });
      }

      // Add Photos with smart clustering (always populate, visibility handled by CSS)
      const photoMarkers = Array.isArray(this.routePhotos) ? this.routePhotos : [];
      if (this.showElevationPhotos) {
        console.log(`[updateElevationProfile] Photo markers enabled: ${photoMarkers.length} candidates.`, {
          hasRoutePhotos: Array.isArray(this.routePhotos),
          routePhotosCount: this.routePhotos?.length,
          showElevationPhotos: this.showElevationPhotos
        });
      }

      if (photoMarkers.length > 0) {
        // Smart photo clustering:
        // 1. Cluster photos that are close together (within 1km max or dynamic scale)
        // 2. Limit total clusters displayed to MAX_PHOTO_CLUSTERS
        // 3. Create consolidated cluster items with count badges

        const totalDistance = Number(this.routeProfile?.totalDistanceKm) || 0;
        const PHOTO_CLUSTER_PROXIMITY_KM = Math.min(1.0, totalDistance / 15); // Dynamic: ~15 clusters max, but max 1km gap
        const MAX_PHOTO_CLUSTERS = 12;

        // Sort photos by distance
        const sortedPhotos = [...photoMarkers]
          .filter(photo => {
            const dist = Number(photo.distanceKm);
            return Number.isFinite(dist) && dist >= xMin - xBoundaryTolerance && dist <= xMax + xBoundaryTolerance;
          })
          .sort((a, b) => a.distanceKm - b.distanceKm);

        // Cluster photos
        const photoClusters = [];
        let currentCluster = [];

        for (const photo of sortedPhotos) {
          if (currentCluster.length === 0) {
            currentCluster.push(photo);
          } else {
            const clusterCenter = currentCluster[0].distanceKm;
            if (Math.abs(photo.distanceKm - clusterCenter) < PHOTO_CLUSTER_PROXIMITY_KM) {
              currentCluster.push(photo);
            } else {
              photoClusters.push(currentCluster);
              currentCluster = [photo];
            }
          }
        }
        if (currentCluster.length > 0) {
          photoClusters.push(currentCluster);
        }

        // If too many clusters, merge adjacent ones
        while (photoClusters.length > MAX_PHOTO_CLUSTERS && photoClusters.length > 1) {
          // Find the two closest adjacent clusters and merge them
          let minGap = Infinity;
          let mergeIndex = 0;

          for (let i = 0; i < photoClusters.length - 1; i++) {
            const cluster1Center = photoClusters[i][0].distanceKm;
            const cluster2Center = photoClusters[i + 1][0].distanceKm;
            const gap = Math.abs(cluster2Center - cluster1Center);
            if (gap < minGap) {
              minGap = gap;
              mergeIndex = i;
            }
          }

          // Merge clusters at mergeIndex and mergeIndex + 1
          photoClusters[mergeIndex] = [...photoClusters[mergeIndex], ...photoClusters[mergeIndex + 1]];
          photoClusters.splice(mergeIndex + 1, 1);
        }

        // Create consolidated photo cluster items
        // Important: We always add these to allMarkers to populate the DOM, 
        // regardless of showElevationPhotos. Visibility is managed via CSS in updateElevationMarkerPositions.
        for (const cluster of photoClusters) {
          const mainPhoto = cluster[0];
          const clusterCount = cluster.length;

          allMarkers.push({
            type: 'photo',
            categoryKey: 'photo', // Match BAK key
            distanceKm: mainPhoto.distanceKm,
            data: {
              ...mainPhoto,
              clusterCount: clusterCount,
              clusterItems: clusterCount > 1 ? cluster.slice(1, 3) : [], // Max 2 for visual stack effect
              allClusterPhotos: cluster // Store all photos for carousel
            },
            name: clusterCount > 1 ? `${clusterCount} photos` : (mainPhoto.title || 'Photo'),
            isPhotoStack: clusterCount > 1,
            stackItems: clusterCount > 1 ? cluster.slice(1, 3).map(p => ({ data: p })) : []
          });
        }
        console.log(`[updateElevationProfile] Added ${photoClusters.length} photo clusters to allMarkers.`);
      }

      // 2. Sort all markers by distance
      allMarkers.sort((a, b) => a.distanceKm - b.distanceKm);

      if (allMarkers.length > 0) {
        // 3. Group nearby markers
        const STACK_PROXIMITY_KM = 0.5;
        const groups = [];
        let currentGroup = [];

        for (let i = 0; i < allMarkers.length; i++) {
          const current = allMarkers[i];
          if (currentGroup.length === 0) {
            currentGroup.push(current);
          } else {
            const groupCenter = currentGroup[0].distanceKm;
            if (Math.abs(current.distanceKm - groupCenter) < STACK_PROXIMITY_KM) {
              currentGroup.push(current);
            } else {
              groups.push(currentGroup);
              currentGroup = [current];
            }
          }
        }
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
        }

        // 4. Calculate stacking metadata
        const markersWithMeta = [];
        const FLOATING_CATEGORIES = new Set(['bivouac', 'peak', 'peak_principal', 'peak_minor', 'saddle', 'pass']);

        for (const group of groups) {
          // Sort by priority (Bivouac -> Peak -> ... -> Parking)
          // Separate Bivouacs (always top) from Standard POIs
          const bivouacs = [];
          const standardPois = [];

          group.forEach(item => {
            if (item.type === 'bivouac' || item.categoryKey === 'bivouac') {
              bivouacs.push(item);
            } else {
              standardPois.push(item);
            }
          });

          // Sort Standard POIs by priority descending (Highest priority = On Line)
          standardPois.sort((a, b) => {
            const pA = POI_CATEGORY_PRIORITY[a.categoryKey] ?? 0;
            const pB = POI_CATEGORY_PRIORITY[b.categoryKey] ?? 0;
            return pB - pA;
          });

          // 1. Place Standard POIs
          // The highest priority item stays on the line.
          // Others are distributed internally below (in the chart area).
          if (standardPois.length > 0) {
            // Check if we have multiple photos in this group
            const photos = standardPois.filter(p => p.type === 'photo');
            const nonPhotos = standardPois.filter(p => p.type !== 'photo');

            if (photos.length > 1) {
              // Consolidate photos into a single "photo stack" item
              // Use the first photo as the main one, but attach the others as stack items
              const mainPhoto = photos[0];
              const stackItems = photos.slice(1);

              // Add the consolidated photo stack to the list
              // It competes with non-photos based on priority (photos have low priority, so likely last)
              // But if only photos are present, it will be the "standard" item

              // If there are non-photos, they likely have higher priority (e.g. peaks)
              // So the photo stack might end up as 'internal' or 'standard' depending on sort

              // Let's re-merge but with the consolidated photo item
              const consolidatedPhoto = {
                ...mainPhoto,
                isPhotoStack: true,
                stackItems: stackItems
              };

              const merged = [...nonPhotos, consolidatedPhoto];
              merged.sort((a, b) => {
                const pA = POI_CATEGORY_PRIORITY[a.categoryKey] ?? 0;
                const pB = POI_CATEGORY_PRIORITY[b.categoryKey] ?? 0;
                return pB - pA;
              });

              // Now process the merged list
              markersWithMeta.push({
                ...merged[0],
                stackType: 'standard',
                verticalOffset: 0
              });

              const remaining = merged.slice(1);
              const totalRemaining = remaining.length;
              remaining.forEach((item, index) => {
                markersWithMeta.push({
                  ...item,
                  stackType: 'internal',
                  stackIndex: index,
                  stackTotal: totalRemaining
                });
              });

            } else {
              // Standard behavior
              // Top priority item -> On the line
              markersWithMeta.push({
                ...standardPois[0],
                stackType: 'standard',
                verticalOffset: 0
              });

              // Remaining items -> Distributed internally
              const remaining = standardPois.slice(1);
              const totalRemaining = remaining.length;
              remaining.forEach((item, index) => {
                markersWithMeta.push({
                  ...item,
                  stackType: 'internal',
                  stackIndex: index,
                  stackTotal: totalRemaining
                });
              });
            }
          }

          // 2. Place Bivouacs
          // Always ABOVE the line.
          // Base offset to clear the "on-line" icon (approx 24px).
          // Then stack upwards if multiple bivouacs.
          const BIVOUAC_BASE_OFFSET = 24;
          bivouacs.forEach((item, index) => {
            markersWithMeta.push({
              ...item,
              stackType: 'bivouac',
              verticalOffset: BIVOUAC_BASE_OFFSET + (index * 12)
            });
          });
        }

        // 5. Generate HTML
        const segments = Array.isArray(this.profileSegments) && this.profileSegments.length
          ? this.profileSegments
          : (this.cutSegments || []);

        const getRouteColorAtDistance = (dist) => {
          const defaultColor = this.modeColors[this.currentMode] || '#f8b40b';
          if (!segments.length) return defaultColor;

          const segment = segments.find(seg => {
            const start = Number(seg.startKm ?? seg.startDistanceKm ?? 0);
            const end = Number(seg.endKm ?? seg.endDistanceKm ?? start);
            return dist >= start && dist <= end;
          });
          return segment?.color || defaultColor;
        };

        const elements = markersWithMeta.map(item => {
          // Filter out items that are outside the current view range to prevent agglomeration on edges
          // Use domainStart/domainEnd (actual segment bounds) instead of xMin/xMax (axis bounds with padding)
          if (item.distanceKm < domainStart || item.distanceKm > domainEnd) {
            return null;
          }

          const isBivouac = item.type === 'bivouac';
          const isPhoto = item.type === 'photo';
          const poi = item.data;
          const safeTitle = escapeHtml(item.name);

          let iconMarkup = '';
          let styleParts = [];
          let datasetAttributes = [
            `data-distance-km="${item.distanceKm.toFixed(6)}"`,
            `data-stack-type="${item.stackType}"`
          ];

          if (item.stackType === 'internal') {
            datasetAttributes.push(`data-stack-index="${item.stackIndex}"`);
            datasetAttributes.push(`data-stack-total="${item.stackTotal}"`);
          } else {
            datasetAttributes.push(`data-bottom-offset="${item.verticalOffset}"`);
          }

          if (isBivouac) {
            // Bivouac specific rendering
            const colorValue = typeof poi?.labelColor === 'string' ? poi.labelColor.trim() : '';
            styleParts.push('--elevation-marker-icon-width:26px');
            styleParts.push('--elevation-marker-icon-height:26px');
            if (colorValue) styleParts.push(`--bivouac-marker-color:${colorValue}`);

            iconMarkup = BIVOUAC_ELEVATION_ICON;
            datasetAttributes.push(`data-poi-category="Bivouac"`);
          } else if (isPhoto) {
            // Photo specific rendering
            // Use fixed width but allow natural height for aspect ratio
            const PHOTO_WIDTH = 40;
            const clusterCount = poi.clusterCount || 1;
            styleParts.push(`--elevation-marker-icon-width:${PHOTO_WIDTH}px`);
            styleParts.push('z-index: 20'); // High z-index to ensure visibility

            if (poi.thumbnailUrl) {
              let stackMarkup = '';

              // Only show stack effect if there are multiple photos in cluster
              if (clusterCount > 1 && item.isPhotoStack && Array.isArray(item.stackItems)) {
                // Generate stack items (max 2 extra for visual effect)
                item.stackItems.slice(0, 2).forEach((stackItem, idx) => {
                  const rotation = idx === 0 ? -8 : 8; // Subtle tilt
                  const offsetX = idx === 0 ? -3 : 3;
                  const offsetY = 3;
                  const zIndex = 10 - (idx + 1);

                  if (stackItem.data && stackItem.data.thumbnailUrl) {
                    stackMarkup += `<div class="elevation-marker__icon elevation-marker__icon--photo-stack" aria-hidden="true" style="position: absolute; top: 0; left: 0; z-index: ${zIndex}; transform: translate(${offsetX}px, ${offsetY}px) rotate(${rotation}deg); background-image: url('${stackItem.data.thumbnailUrl}');"></div>`;
                  }
                });
              }

              const mainImg = `<div class="elevation-marker__icon elevation-marker__icon--photo" style="position: relative; z-index: 20; background-image: url('${poi.thumbnailUrl}');"></div>`;

              // Count badge for clusters
              const countBadge = clusterCount > 1
                ? `<span class="elevation-marker__count-badge" style="position: absolute; top: -4px; right: -4px; min-width: 16px; height: 16px; background: #1a73e8; color: white; font-size: 10px; font-weight: 700; border-radius: 8px; display: flex; align-items: center; justify-content: center; padding: 0 4px; z-index: 25; box-shadow: 0 1px 3px rgba(0,0,0,0.3); border: 1px solid white;">${clusterCount}</span>`
                : '';

              iconMarkup = stackMarkup + mainImg + countBadge;
            } else {
              iconMarkup = '<span class="elevation-marker__icon elevation-marker__icon--fallback" aria-hidden="true" style="background: #e74c3c;"></span>';
            }
            datasetAttributes.push(`data-poi-category="Photo"`);
            if (clusterCount > 1) {
              datasetAttributes.push(`data-cluster-count="${clusterCount}"`);
            }
          } else {
            // POI specific rendering
            const colorValue = typeof poi?.color === 'string' && poi.color.trim() ? poi.color.trim() : DEFAULT_POI_COLOR;
            const poiCategory = typeof poi?.categoryLabel === 'string' ? poi.categoryLabel.trim() : '';

            // Icon sizing logic
            const icon = poi?.icon ?? null;
            let w = 16, h = 16;
            if (Number.isFinite(poi?.iconDisplayWidth)) w = Number(poi.iconDisplayWidth);
            else if (Number.isFinite(icon?.displayWidth)) w = Number(icon.displayWidth);
            else if (Number.isFinite(icon?.width)) w = Number(icon.width) / (Number(icon?.pixelRatio) || 1);

            if (Number.isFinite(poi?.iconDisplayHeight)) h = Number(poi.iconDisplayHeight);
            else if (Number.isFinite(icon?.displayHeight)) h = Number(icon.displayHeight);
            else if (Number.isFinite(icon?.height)) h = Number(icon.height) / (Number(icon?.pixelRatio) || 1);

            styleParts.push(`color:${colorValue}`);
            styleParts.push(`--poi-marker-color:${colorValue}`);
            styleParts.push(`--elevation-marker-icon-width:${w.toFixed(2)}px`);
            styleParts.push(`--elevation-marker-icon-height:${h.toFixed(2)}px`);

            const hasIconImage = icon && typeof icon.url === 'string' && icon.url;
            const iconSvgContent = poi?.iconSvgContent;

            if (iconSvgContent) {
              // Inline SVG for dynamic filling
              const fillColor = getRouteColorAtDistance(item.distanceKm);
              // Remove style attribute from the SVG tag to prevent overriding our CSS variables
              // This is necessary because some SVGs have inline styles setting --icon-fill to a fixed color
              const cleanSvgContent = iconSvgContent.replace(/(<svg[^>]*?)\s*style="[^"]*"/i, '$1');

              iconMarkup = `<div class="elevation-marker__icon elevation-marker__icon--svg" style="--icon-fill: ${fillColor}; --icon-stroke: #ffffff;" aria-hidden="true">${cleanSvgContent}</div>`;
            } else if (hasIconImage) {
              iconMarkup = `<div class="elevation-marker__icon elevation-marker__icon--mask" style="-webkit-mask-image: url('${icon.url}'); mask-image: url('${icon.url}');" aria-hidden="true"></div>`;
            } else {
              iconMarkup = '<span class="elevation-marker__icon elevation-marker__icon--fallback" aria-hidden="true"></span>';
            }

            datasetAttributes.push(`data-poi-name="${escapeHtml(item.name)}"`);
            datasetAttributes.push(`data-poi-category="${escapeHtml(poiCategory)}"`);

            const elev = Number(poi?.elevation);
            if (Number.isFinite(elev)) datasetAttributes.push(`data-elevation="${elev.toFixed(2)}"`);
          }

          // Water indicator for POIs with nearby water source
          const hasWater = poi?.hasWater === true;
          const waterIndicator = hasWater
            ? `<span class="elevation-marker__water-indicator" title="Eau à proximité" aria-label="Eau à proximité">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 2c-5.33 4.55-8 8.48-8 11.8 0 4.98 3.8 8.2 8 8.2s8-3.22 8-8.2c0-3.32-2.67-7.25-8-11.8zm0 18c-3.35 0-6-2.57-6-6.2 0-2.34 1.95-5.44 6-9.14 4.05 3.7 6 6.79 6 9.14 0 3.63-2.65 6.2-6 6.2z" />
        </svg>
              </span>`
            : '';

          const className = isBivouac ? 'elevation-marker bivouac' : (isPhoto ? 'elevation-marker photo' : `elevation-marker poi${hasWater ? ' has-water' : ''}`);

          return `
        <div
      class="${className}"
              ${datasetAttributes.join(' ')}
      style="${styleParts.join(';')}"
      title="${safeTitle}"
      aria-label="${safeTitle}"
        >
        ${iconMarkup}
              ${waterIndicator}
            </div>
        `;
        });

        markerElements.push(...elements);
      }

      if (!markerElements.length) {
        return '';
      }
      return `<div class="elevation-marker-layer" aria-hidden="true">${markerElements.join('')}</div>`;
    })();

    this.elevationChart.innerHTML = `
        <div class="elevation-plot">
          <div class="elevation-plot-area">
            <div class="elevation-chart-container" role="presentation">
              ${areaSvg}
              <div class="elevation-hover-indicator" aria-hidden="true">
                <div class="elevation-hover-line"></div>
              </div>
              <div class="elevation-hit-targets">${hitTargetsHtml}</div>
              ${markerOverlay}
            </div>
            <div class="elevation-x-axis">${xAxisLabels}</div>
          </div>
      </div>
        `;

    this.updateProfileLegend(true);

    this.elevationChartContainer = this.elevationChart.querySelector('.elevation-chart-container');
    this.elevationHoverIndicator = this.elevationChart.querySelector('.elevation-hover-indicator');
    this.elevationHoverLine = this.elevationChart.querySelector('.elevation-hover-line');
    this.highlightedElevationBar = null;
    if (this.elevationHoverIndicator) {
      this.elevationHoverIndicator.setAttribute('aria-hidden', 'true');
    }
    this.attachElevationChartEvents();
    this.updateElevationMarkerPositions();
    this.attachPhotoMarkerClickHandlers();
    if (this.elevationChartContainer && typeof ResizeObserver !== 'undefined') {
      this.elevationResizeObserver = new ResizeObserver(() => {
        this.updateElevationMarkerPositions();
      });
      this.elevationResizeObserver.observe(this.elevationChartContainer);
    }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => this.updateElevationMarkerPositions());
    }
    this.updateElevationHoverReadout(null);
    this.updateElevationVisibilityState();
    this.updateElevationYAxisLabels();
    this.renderElevationSparkline();
  }
}

