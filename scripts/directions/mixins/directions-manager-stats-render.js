import {
  EMPTY_COLLECTION,
  MAX_DISTANCE_MARKERS,
  turfApi,
  HIKING_BASE_SPEED_KMPH,
  ASCENT_METERS_PER_HOUR,
  DESCENT_METERS_PER_HOUR
} from '../constants/directions-constants.js';

import { escapeHtml } from '../utils/directions-utils.js';

import { ensureDistanceMarkerImage } from '../markers/directions-markers.js';


export class DirectionsManagerStatsRenderMixin {

  formatDistance(distanceKm) {
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
      return '0';
    }
    if (distanceKm >= 100) {
      return Math.round(distanceKm).toString();
    }
    if (distanceKm >= 10) {
      return distanceKm.toFixed(1);
    }
    return parseFloat(distanceKm.toFixed(2)).toString();
  }


  // Format distance for chart axis with 0.5 km discretization
  formatAxisDistance(distanceKm) {
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
      return '0';
    }
    // Round to nearest 0.5
    const rounded = Math.round(distanceKm * 2) / 2;
    // Format: show .5 when needed, otherwise whole number
    if (rounded % 1 === 0.5) {
      return rounded.toFixed(1);
    }
    return Math.round(rounded).toString();
  }


  computeAxisTicks(minValue, maxValue, maxTicks = 6) {
    let min = Number.isFinite(minValue) ? minValue : 0;
    let max = Number.isFinite(maxValue) ? maxValue : min;

    if (max < min) {
      [min, max] = [max, min];
    }

    if (max === min) {
      const value = Number(min.toFixed(6));
      return { ticks: [value], min: value, max: value, step: 0 };
    }

    const tickTarget = Math.max(2, Math.round(maxTicks));
    const span = max - min;

    // Calculate a nice step size (0.5, 1, 2, 5, 10, 20, 50, etc.)
    const rawStep = span / (tickTarget - 1);
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalized = rawStep / magnitude;

    let niceStep;
    if (normalized <= 0.5) {
      niceStep = 0.5 * magnitude;
    } else if (normalized <= 1) {
      niceStep = 1 * magnitude;
    } else if (normalized <= 2) {
      niceStep = 2 * magnitude;
    } else if (normalized <= 5) {
      niceStep = 5 * magnitude;
    } else {
      niceStep = 10 * magnitude;
    }

    // Round min down and max up to nice step boundaries
    const niceMin = Math.floor(min / niceStep) * niceStep;
    const niceMax = Math.ceil(max / niceStep) * niceStep;

    const ticks = [];
    for (let value = niceMin; value <= niceMax + niceStep * 0.001; value += niceStep) {
      // Only include ticks within or close to the actual range
      if (value >= min - niceStep * 0.001 && value <= max + niceStep * 0.001) {
        const rounded = Math.round(value * 1000) / 1000;
        ticks.push(rounded);
      }
    }

    // Always include exact min and max
    if (ticks.length && Math.abs(ticks[0] - min) > niceStep * 0.1) {
      ticks[0] = Number(min.toFixed(6));
    }
    if (ticks.length && Math.abs(ticks[ticks.length - 1] - max) > niceStep * 0.1) {
      ticks[ticks.length - 1] = Number(max.toFixed(6));
    }

    return { ticks, min, max, step: niceStep };
  }


  formatElevationLabel(value) {
    if (!Number.isFinite(value)) return '0 m';
    return `${Math.round(value)} m`;
  }


  formatDistanceTick(value) {
    if (!Number.isFinite(value) || Math.abs(value) < 1e-6) {
      return '0 km';
    }
    return `${this.formatDistance(value)} km`;
  }


  calculateRouteMetrics(route) {
    const metrics = { distanceKm: 0, ascent: 0, descent: 0 };
    if (!route || !route.geometry?.coordinates) {
      return metrics;
    }

    const coords = route.geometry.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) {
      return metrics;
    }

    if (turfApi) {
      try {
        const line = turfApi.lineString(coords);
        metrics.distanceKm = Number(turfApi.length(line, { units: 'kilometers' })) || 0;
      } catch (error) {
        console.error('Error computing route length', error);
      }
    }

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

    let currentAscent = 0;
    let currentDescent = 0;
    let lastStableElevation = null;
    const VERTICAL_THRESHOLD = 2.5; // ignore fluctuations under 2.5m (standard for hiking apps)

    coords.forEach((coord) => {
      const elevation = coord?.[2];
      if (!Number.isFinite(elevation)) return;

      if (lastStableElevation === null) {
        lastStableElevation = elevation;
        return;
      }

      const diff = elevation - lastStableElevation;
      if (Math.abs(diff) >= VERTICAL_THRESHOLD) {
        if (diff > 0) {
          currentAscent += diff;
        } else {
          currentDescent += Math.abs(diff);
        }
        lastStableElevation = elevation;
      }
    });

    metrics.ascent = currentAscent;
    metrics.descent = currentDescent;

    if (metrics.ascent === 0 && metrics.descent === 0 && Array.isArray(route.properties?.segments)) {
      metrics.ascent = route.properties.segments
        .map((segment) => Number(segment.ascent) || 0)
        .reduce((total, value) => total + value, 0);
      metrics.descent = route.properties.segments
        .map((segment) => Number(segment.descent) || 0)
        .reduce((total, value) => total + value, 0);
    }

    return metrics;
  }


  computeCumulativeMetrics(distanceKm, startDistanceKm = 0) {
    const normalizedEnd = Number(distanceKm);
    const normalizedStart = Number(startDistanceKm);
    const result = { distanceKm: 0, ascent: 0, descent: 0 };

    const totalDistance = Math.max(0, Number(this.routeProfile?.totalDistanceKm) || 0);
    const endKm = Number.isFinite(normalizedEnd)
      ? Math.max(0, Math.min(totalDistance || normalizedEnd, normalizedEnd))
      : 0;
    const startKm = Number.isFinite(normalizedStart)
      ? Math.max(0, Math.min(endKm, normalizedStart))
      : 0;

    result.distanceKm = Math.max(0, endKm - startKm);

    const distances = Array.isArray(this.routeProfile?.cumulativeDistances)
      ? this.routeProfile.cumulativeDistances
      : [];

    if (!Array.isArray(distances) || distances.length < 2) {
      return result;
    }

    const points = [];
    points.push(startKm, endKm);
    distances.forEach((value) => {
      if (!Number.isFinite(value)) {
        return;
      }
      if (value <= startKm || value >= endKm) {
        return;
      }
      points.push(value);
    });

    points.sort((a, b) => a - b);
    const uniquePoints = [];
    points.forEach((value) => {
      if (!Number.isFinite(value)) {
        return;
      }
      if (!uniquePoints.length || Math.abs(uniquePoints[uniquePoints.length - 1] - value) > 1e-6) {
        uniquePoints.push(value);
      }
    });

    if (uniquePoints.length < 2) {
      return result;
    }

    let ascent = 0;
    let descent = 0;
    for (let index = 1; index < uniquePoints.length; index += 1) {
      const previousDistance = uniquePoints[index - 1];
      const nextDistance = uniquePoints[index];
      if (nextDistance <= previousDistance) {
        continue;
      }
      const startElevation = this.getElevationAtDistance(previousDistance);
      const endElevation = this.getElevationAtDistance(nextDistance);
      if (!Number.isFinite(startElevation) || !Number.isFinite(endElevation)) {
        continue;
      }
      const delta = endElevation - startElevation;
      if (delta > 0) {
        ascent += delta;
      } else if (delta < 0) {
        descent += Math.abs(delta);
      }
    }

    result.ascent = ascent;
    result.descent = descent;
    return result;
  }


  estimateTravelTimeHours(distanceKm, ascentMeters = 0, descentMeters = 0) {
    const distance = Math.max(0, Number(distanceKm) || 0);
    const ascent = Math.max(0, Number(ascentMeters) || 0);
    const descent = Math.max(0, Number(descentMeters) || 0);

    const horizontalHours = distance / Math.max(HIKING_BASE_SPEED_KMPH, 0.1);
    const ascentHours = ascent / Math.max(ASCENT_METERS_PER_HOUR, 0.1);
    const descentHours = descent / Math.max(DESCENT_METERS_PER_HOUR, 0.1);
    const total = horizontalHours + ascentHours + descentHours;
    return Number.isFinite(total) && total > 0 ? total : 0;
  }


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
   * Format time estimate as a range (e.g., "5-6 heures")
   */
  formatEstimatedTimeRange(hours) {
    if (!Number.isFinite(hours) || hours <= 0) {
      return '< 1 heure';
    }
    // Round to nearest half hour for the lower bound
    const lowerHours = Math.floor(hours);
    const upperHours = Math.ceil(hours + 0.5);

    if (lowerHours === upperHours || upperHours - lowerHours < 1) {
      return `~${lowerHours} heure${lowerHours !== 1 ? 's' : ''}`;
    }
    return `${lowerHours}-${upperHours} heures`;
  }


  /**
   * Compute difficulty rating for a day segment based on distance, elevation, and way types
   * Returns: { level: 'Easy'|'Moderate'|'Challenging'|'Difficult'|'Expert', score: 1-5 }
   */
  computeDayDifficulty(distanceKm, ascentM, descentM, startKm, endKm) {
    // Base difficulty from distance and elevation
    let score = 0;

    // Distance scoring (0-2 points)
    if (distanceKm <= 8) score += 0;
    else if (distanceKm <= 15) score += 0.5;
    else if (distanceKm <= 20) score += 1;
    else if (distanceKm <= 25) score += 1.5;
    else score += 2;

    // Elevation gain scoring (0-2 points)
    const totalElevation = (ascentM || 0) + (descentM || 0);
    if (totalElevation <= 300) score += 0;
    else if (totalElevation <= 600) score += 0.5;
    else if (totalElevation <= 1000) score += 1;
    else if (totalElevation <= 1500) score += 1.5;
    else score += 2;

    // Average gradient scoring (0-1 point)
    const avgGradient = distanceKm > 0 ? (ascentM / (distanceKm * 1000)) * 100 : 0;
    if (avgGradient <= 5) score += 0;
    else if (avgGradient <= 10) score += 0.3;
    else if (avgGradient <= 15) score += 0.6;
    else score += 1;

    // Clamp to 1-5
    const finalScore = Math.max(1, Math.min(5, Math.round(score + 1)));

    const levels = ['Facile', 'Modéré', 'Exigeant', 'Difficile', 'Expert'];
    return {
      level: levels[finalScore - 1] || 'Modéré',
      score: finalScore
    };
  }


  /**
   * Get key waypoints (POIs) for a specific day segment
   */
  getKeyWaypointsForDay(startKm, endKm) {
    const pois = this.routePointsOfInterest || [];
    if (!Array.isArray(pois) || !pois.length) {
      return [];
    }

    return pois.filter((poi) => {
      const poiDistance = Number(poi.distanceKm ?? poi.distance);
      return Number.isFinite(poiDistance) && poiDistance >= startKm && poiDistance <= endKm;
    }).slice(0, 3).map((poi) => {
      return poi.name || poi.title || 'Waypoint';
    });
  }


  getRouteSummaryLabel() {
    const markers = this.computeSegmentMarkers();
    if (Array.isArray(markers) && markers.length >= 2) {
      const startMarker = markers[0];
      const endMarker = markers[markers.length - 1];
      const startTitle = typeof startMarker?.title === 'string' ? startMarker.title.trim() : '';
      const endTitle = typeof endMarker?.title === 'string' ? endMarker.title.trim() : '';
      if (startTitle && endTitle) {
        return `${startTitle} → ${endTitle}`;
      }
      if (endTitle) {
        return endTitle;
      }
      if (startTitle) {
        return startTitle;
      }
    }

    if (Array.isArray(this.cutSegments) && this.cutSegments.length) {
      const firstSegmentName = this.cutSegments[0]?.name;
      if (typeof firstSegmentName === 'string' && firstSegmentName.trim()) {
        return firstSegmentName.trim();
      }
    }

    if (Array.isArray(this.waypoints) && this.waypoints.length >= 2) {
      const first = this.waypoints[0];
      const last = this.waypoints[this.waypoints.length - 1];
      const firstName = typeof first?.name === 'string' ? first.name.trim() : '';
      const lastName = typeof last?.name === 'string' ? last.name.trim() : '';
      if (firstName && lastName) {
        return `${firstName} → ${lastName}`;
      }
      if (lastName) {
        return lastName;
      }
      if (firstName) {
        return firstName;
      }
    }

    return '';
  }


  renderRouteStatsSummary(metrics) {
    if (!this.routeStats) {
      return;
    }

    if (!metrics) {
      // Clear the summary cache when clearing stats
      this._lastSummaryStatsKey = null;
      this.routeStats.innerHTML = '';
      if (this.routeTimeline) this.routeTimeline.innerHTML = '';
      this.routeStats.classList.remove('has-stats', 'is-hover');
      this.routeStats.removeAttribute('data-mode');
      this.isRouteStatsHoverActive = false;
      this.selectedDayIndex = null;
      return;
    }

    const distanceLabel = this.formatDistance(metrics.distanceKm);
    const ascent = Math.max(0, Math.round(metrics.ascent));
    const descent = Math.max(0, Math.round(metrics.descent));
    const timeLabel = this.formatDurationHours(
      this.estimateTravelTimeHours(metrics.distanceKm, ascent, descent)
    );

    // Check if we have multiple day segments (bivouac splits)
    const hasMultipleDays = Array.isArray(this.cutSegments) && this.cutSegments.length > 1;
    const cutSegmentCount = hasMultipleDays ? this.cutSegments.length : 0;

    // Build a unique key from the display values to skip redundant re-renders
    // Include POI count to ensure re-render when POIs are loaded asynchronously
    const poiCount = Array.isArray(this.routePointsOfInterest) ? this.routePointsOfInterest.length : 0;
    const summaryStatsKey = `summary|${distanceLabel}|${ascent}|${descent}|${timeLabel}|${cutSegmentCount}|${this.selectedDayIndex ?? 'all'}|poi:${poiCount}`;
    if (this._lastSummaryStatsKey === summaryStatsKey && this.routeStats.getAttribute('data-mode') === 'summary') {
      // Skip re-render if already showing summary with same values
      return;
    }
    this._lastSummaryStatsKey = summaryStatsKey;

    if (hasMultipleDays) {
      this.renderMultiDayTimeline(metrics);
    } else {
      if (this.routeTimeline) this.routeTimeline.innerHTML = '';
      this.renderSimpleStats(metrics, distanceLabel, ascent, descent, timeLabel);
    }

    this.routeStats.classList.add('has-stats');
    this.routeStats.classList.remove('is-hover');
    this.routeStats.setAttribute('data-mode', 'summary');
    this.isRouteStatsHoverActive = false;

    // Update sparkline preview
    this.renderElevationSparkline();
  }


  renderSimpleStats(metrics, distanceLabel, ascent, descent, timeLabel) {
    // Calculate additional data
    const totalDistanceKm = metrics.distanceKm || 0;
    const timeHours = this.estimateTravelTimeHours(totalDistanceKm, ascent, descent);
    const timeRange = this.formatEstimatedTimeRange(timeHours);
    const difficulty = this.computeDayDifficulty(totalDistanceKm, ascent, descent, 0, totalDistanceKm);
    const keyWaypoints = this.getKeyWaypointsForDay(0, totalDistanceKm);
    const waypointsText = keyWaypoints.length > 0 ? keyWaypoints.join(', ') : 'Aucun point d\'intérêt';

    // Build difficulty indicator bars
    const difficultyBars = Array.from({ length: 5 }, (_, i) =>
      `<span class="difficulty-bar${i < difficulty.score ? ' filled' : ''}"></span>`
    ).join('');

    const isExpanded = !this.isElevationCollapsed;
    const expandIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>';
    const retractIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="10" y1="14" x2="3" y2="21"></line></svg>';
    const toggleIcon = isExpanded ? retractIcon : expandIcon;

    // Use same format as multi-day for consistency
    this.routeStats.classList.toggle('is-expanded', isExpanded);
    this.routeStats.classList.toggle('is-collapsed', !isExpanded);

    this.routeStats.innerHTML = `
      <div class="route-stats__sparkline"></div>
      <div class="route-stats__content">
        <div class="day-details is-visible is-compact">
          <div class="day-details__grid">
            <div class="day-details__item">
              <span class="day-details__item-label">Distance :</span>
              <span class="day-details__item-value">${escapeHtml(distanceLabel)} km</span>
            </div>
            <div class="day-details__item">
              <span class="day-details__item-label">Dénivelé :</span>
              <span class="day-details__item-value">+${ascent} m / -${descent} m</span>
            </div>
            <div class="day-details__item">
              <span class="day-details__item-label">Temps :</span>
              <span class="day-details__item-value">${timeRange}</span>
            </div>
            <div class="day-details__item">
              <span class="day-details__item-label">Difficulté :</span>
              <span class="day-details__item-value">
                <span class="difficulty-indicator">${difficultyBars}</span>
                ${difficulty.level}
              </span>
            </div>
            <div class="day-details__item">
              <span class="day-details__item-label">Météo :</span>
              <span class="day-details__item-value weather-container" data-weather-target="route">
                <span class="weather-loading">...</span>
              </span>
            </div>
          </div>
          <div class="day-details__poi-row">
            <span class="day-details__item-label">Points d'intérêt :</span>
            <span class="day-details__item-value">${escapeHtml(waypointsText)}</span>
          </div>
        </div>
      </div>
      <button id="routeStatsToggle" class="route-stats__toggle${isExpanded ? ' is-active' : ''}" type="button" aria-expanded="${isExpanded}" title="${isExpanded ? 'Réduire' : 'Développer'}">
        ${toggleIcon}
      </button>
    `;

    this.attachRouteStatsToggleHandler();
    // Fetch and display weather data asynchronously
    this.updateWeatherDisplay();
  }


  renderMultiDayTimeline(metrics) {
    const segments = this.cutSegments;
    const totalDays = segments.length;

    // Calculate metrics for each day segment
    const dayMetrics = segments.map((segment, index) => {
      const startKm = Number(segment?.startKm ?? segment?.startDistanceKm ?? 0);
      const endKm = Number(segment?.endKm ?? segment?.endDistanceKm ?? startKm);
      const distanceKm = Math.max(0, endKm - startKm);

      // Calculate ascent for this segment
      const segmentMetrics = this.computeCumulativeMetrics(endKm, startKm);
      const segmentAscent = Math.max(0, Math.round(segmentMetrics?.ascent ?? 0));
      const segmentDescent = Math.max(0, Math.round(segmentMetrics?.descent ?? 0));
      const segmentTime = this.estimateTravelTimeHours(distanceKm, segmentAscent, segmentDescent);

      // Get bivouac name if exists
      const markers = this.computeSegmentMarkers(segments);
      const endMarker = markers[index + 1];
      const bivouacName = endMarker?.name ?? endMarker?.title ?? null;

      return {
        index,
        dayNumber: index + 1,
        distanceKm,
        ascent: segmentAscent,
        descent: segmentDescent,
        timeHours: segmentTime,
        bivouacName,
        color: segment?.color ?? null,
        startKm,
        endKm
      };
    });

    // Total summary
    const totalDistance = this.formatDistance(metrics.distanceKm);
    const totalAscent = Math.max(0, Math.round(metrics.ascent));
    const totalTime = this.formatDurationHours(
      this.estimateTravelTimeHours(metrics.distanceKm, totalAscent, metrics.descent)
    );

    // Arrow SVG
    const arrowSvg = `<svg viewBox="0 0 24 24"><path d="M10 6L16 12L10 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    // Build day tabs - arrow/chevron style
    const hasSelection = this.selectedDayIndex !== null && this.selectedDayIndex !== undefined;
    const dayTabsHtml = dayMetrics.map((day, i) => {
      const isSelected = this.selectedDayIndex === i;
      const isLast = i === dayMetrics.length - 1;
      const bgColor = day.color || this.modeColors[this.currentMode];

      return `
        <div class="day-tab-wrapper${isSelected ? ' is-selected' : ''}${isLast ? ' is-last' : ''}" data-day-index="${i}">
          <button 
            type="button"
            class="day-tab${isSelected ? ' is-selected' : ''}" 
            data-day-index="${i}"
            style="--day-color: ${bgColor}"
          >
            <div class="day-tab__content">
              <span class="day-tab__title">Jour ${day.dayNumber}</span>
            </div>
          </button>
          <svg class="day-tab__arrow" viewBox="0 0 20 60" preserveAspectRatio="none">
            <path d="M0 0 L15 30 L0 60 L0 0" fill="var(--day-color)" style="--day-color: ${bgColor}"/>
          </svg>
        </div>
      `;
    }).join('');

    // Add container class to indicate selection state
    const timelineClass = `day-timeline${hasSelection ? ' has-selection' : ''}`;

    // Selected day details - or full route if no day selected
    const selectedDay = this.selectedDayIndex !== null && this.selectedDayIndex !== undefined
      ? dayMetrics[this.selectedDayIndex]
      : null;

    // Build details HTML - either for selected day or for entire route
    let dayDetailsHtml = '<div class="day-details"></div>';

    if (selectedDay) {
      // Compute additional data for selected day
      const dayDistLabel = this.formatDistance(selectedDay.distanceKm);
      const timeRange = this.formatEstimatedTimeRange(selectedDay.timeHours);
      const difficulty = this.computeDayDifficulty(
        selectedDay.distanceKm,
        selectedDay.ascent,
        selectedDay.descent,
        selectedDay.startKm,
        selectedDay.endKm
      );
      const keyWaypoints = this.getKeyWaypointsForDay(selectedDay.startKm, selectedDay.endKm);
      const waypointsText = keyWaypoints.length > 0
        ? keyWaypoints.join(', ')
        : 'Aucun point d\'intérêt';

      // Build difficulty indicator bars
      const difficultyBars = Array.from({ length: 5 }, (_, i) =>
        `<span class="difficulty-bar${i < difficulty.score ? ' filled' : ''}"></span>`
      ).join('');

      dayDetailsHtml = `
        <div class="day-details is-visible is-compact">
          <div class="day-details__grid">
            <div class="day-details__item">
              <span class="day-details__item-label">Distance :</span>
              <span class="day-details__item-value">${dayDistLabel} km</span>
            </div>
            <div class="day-details__item">
              <span class="day-details__item-label">Dénivelé :</span>
              <span class="day-details__item-value">+${selectedDay.ascent} m / -${selectedDay.descent} m</span>
            </div>
            <div class="day-details__item">
              <span class="day-details__item-label">Durée estimée :</span>
              <span class="day-details__item-value">${timeRange}</span>
            </div>
            <div class="day-details__item">
              <span class="day-details__item-label">Difficulté :</span>
              <span class="day-details__item-value">
                <span class="difficulty-indicator">${difficultyBars}</span>
                ${difficulty.level}
              </span>
            </div>
            <div class="day-details__item">
              <span class="day-details__item-label">Météo :</span>
              <span class="day-details__item-value weather-container" data-weather-target="day">
                <span class="weather-loading">Chargement...</span>
              </span>
            </div>
          </div>
          <div class="day-details__poi-row">
            <span class="day-details__item-label">Points d'intérêt :</span>
            <span class="day-details__item-value">${escapeHtml(waypointsText)}</span>
          </div>
        </div>
      `;
    } else {
      // No day selected - show full route details (unified with single-day style)
      const totalDescent = Math.max(0, Math.round(metrics.descent ?? 0));
      const timeRange = this.formatEstimatedTimeRange(
        this.estimateTravelTimeHours(metrics.distanceKm, totalAscent, totalDescent)
      );

      // Calculate overall difficulty based on total metrics
      const difficulty = this.computeDayDifficulty(
        metrics.distanceKm,
        totalAscent,
        totalDescent,
        0,
        metrics.distanceKm
      );

      // Get all key waypoints for entire route
      const keyWaypoints = this.getKeyWaypointsForDay(0, metrics.distanceKm);
      const waypointsText = keyWaypoints.length > 0
        ? keyWaypoints.join(', ')
        : 'Aucun point d\'intérêt';

      const difficultyBars = Array.from({ length: 5 }, (_, i) =>
        `<span class="difficulty-bar${i < difficulty.score ? ' filled' : ''}"></span>`
      ).join('');

      dayDetailsHtml = `
        <div class="day-details is-visible is-compact">
          <div class="day-details__grid">
            <div class="day-details__item">
              <span class="day-details__item-label">Distance :</span>
              <span class="day-details__item-value">${totalDistance} km</span>
            </div>
            <div class="day-details__item">
              <span class="day-details__item-label">Dénivelé :</span>
              <span class="day-details__item-value">+${totalAscent} m / -${totalDescent} m</span>
            </div>
            <div class="day-details__item">
              <span class="day-details__item-label">Durée estimée :</span>
              <span class="day-details__item-value">${timeRange}</span>
            </div>
            <div class="day-details__item">
              <span class="day-details__item-label">Difficulté :</span>
              <span class="day-details__item-value">
                <span class="difficulty-indicator">${difficultyBars}</span>
                ${difficulty.level}
              </span>
            </div>
            <div class="day-details__item">
              <span class="day-details__item-label">Météo :</span>
              <span class="day-details__item-value weather-container" data-weather-target="route">
                <span class="weather-loading">Chargement...</span>
              </span>
            </div>
          </div>
          <div class="day-details__poi-row">
            <span class="day-details__item-label">Points d'intérêt :</span>
            <span class="day-details__item-value">${escapeHtml(waypointsText)}</span>
          </div>
        </div>
      `;
    }

    if (this.routeTimeline) {
      this.routeTimeline.innerHTML = `<div class="${timelineClass}">${dayTabsHtml}</div>`;
    }

    const isExpanded = !this.isElevationCollapsed;
    const expandIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>';
    const retractIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="10" y1="14" x2="3" y2="21"></line></svg>';
    const toggleIcon = isExpanded ? retractIcon : expandIcon;

    this.routeStats.classList.toggle('is-expanded', isExpanded);
    this.routeStats.classList.toggle('is-collapsed', !isExpanded);

    this.routeStats.innerHTML = `
      <div class="route-stats__sparkline"></div>
      <div class="route-stats__content">
        ${dayDetailsHtml}
      </div>
      <button id="routeStatsToggle" class="route-stats__toggle${isExpanded ? ' is-active' : ''}" type="button" aria-expanded="${isExpanded}" title="${isExpanded ? 'Réduire' : 'Développer'}">
        ${toggleIcon}
      </button>
    `;

    // Attach click handlers to day tabs
    this.attachDayTabHandlers();
    this.attachRouteStatsToggleHandler();

    // Fetch and display weather data asynchronously
    this.updateWeatherDisplay();
  }


  attachRouteStatsToggleHandler() {
    if (!this.routeStats) return;
    const toggle = this.routeStats.querySelector('#routeStatsToggle');
    if (toggle) {
      this.elevationCollapseToggle = toggle;
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setElevationCollapsed(!this.isElevationCollapsed);
      });
    }
  }


  attachDayTabHandlers() {
    const container = this.routeTimeline || this.routeStats;
    if (!container) return;

    const dayTabs = container.querySelectorAll('.day-tab');
    dayTabs.forEach((tab) => {
      tab.addEventListener('click', (event) => {
        const index = Number(tab.dataset.dayIndex);
        if (!Number.isFinite(index)) return;

        // Toggle selection
        if (this.selectedDayIndex === index) {
          this.selectedDayIndex = null;
        } else {
          this.selectedDayIndex = index;
        }

        // Re-render stats UI
        this.renderRouteStatsSummary(this.latestMetrics);

        // Zoom elevation chart to selected day or restore full view
        this.zoomElevationChartToDay(this.selectedDayIndex);
      });
    });
  }



  updateStats(route) {
    if (!this.routeStats) {
      return;
    }
    if (!route || !Array.isArray(route.geometry?.coordinates) || route.geometry.coordinates.length < 2) {
      this.latestMetrics = null;
      this.renderRouteStatsSummary(null);
      return;
    }

    const metrics = this.latestMetrics ?? this.calculateRouteMetrics(route);
    this.latestMetrics = metrics;
    this.renderRouteStatsSummary(metrics);

    if (this.isRouteStatsHoverActive && Number.isFinite(this.lastElevationHoverDistance)) {
      this.updateRouteStatsHover(this.lastElevationHoverDistance);
    }
  }



  updateDistanceMarkers(route) {
    const source = this.map.getSource('distance-markers-source');
    if (!source) return;

    const targetRoute = route ?? this.routeGeojson;

    if (!targetRoute || !targetRoute.geometry?.coordinates || !turfApi) {
      source.setData(EMPTY_COLLECTION);
      return;
    }

    try {
      const coordinates = targetRoute.geometry.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length < 2) {
        source.setData(EMPTY_COLLECTION);
        return;
      }

      const metrics = this.latestMetrics ?? this.calculateRouteMetrics(targetRoute);
      const totalDistance = Number(metrics.distanceKm) || 0;
      if (totalDistance <= 0) {
        source.setData(EMPTY_COLLECTION);
        return;
      }

      const line = turfApi.lineString(coordinates);
      const markerInterval = totalDistance > MAX_DISTANCE_MARKERS
        ? Math.ceil(totalDistance / MAX_DISTANCE_MARKERS)
        : 1;

      const formatMarkerLabel = (value) => {
        if (!Number.isFinite(value)) return '';
        if (value === 0) return '0';
        if (value >= 100) return `${Math.round(value)} `;
        if (value >= 10) return `${parseFloat(value.toFixed(1))} `;
        if (value >= 1) return `${parseFloat(value.toFixed(1))} `;
        const precise = parseFloat(value.toFixed(2));
        return Number.isFinite(precise) ? `${precise} ` : '';
      };

      const features = [];

      const addMarker = (distanceKm, labelValue = distanceKm) => {
        const clamped = Math.min(distanceKm, totalDistance);
        const point = turfApi.along(line, clamped, { units: 'kilometers' });
        const label = formatMarkerLabel(labelValue);
        if (!label) return;
        const color = this.getColorForDistance(clamped);
        const imageId = ensureDistanceMarkerImage(this.map, label, { fill: color });
        if (!imageId) return;
        features.push({
          type: 'Feature',
          properties: { label, imageId, color },
          geometry: { type: 'Point', coordinates: point.geometry.coordinates }
        });
      };

      for (let km = markerInterval; km < totalDistance; km += markerInterval) {
        addMarker(km, km);
      }

      source.setData({ type: 'FeatureCollection', features });
    } catch (error) {
      console.error('Error updating distance markers', error);
      source.setData(EMPTY_COLLECTION);
    }
  }

}
