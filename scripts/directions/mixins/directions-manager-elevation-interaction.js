import {
  MAX_ELEVATION_POINTS,
  turfApi
} from '../constants/directions-constants.js';


export class DirectionsManagerElevationInteractionMixin {

  findProfileIntervalIndex(distanceKm) {
    const profile = this.routeProfile;
    const distances = profile?.cumulativeDistances;
    if (!profile || !Array.isArray(distances) || distances.length < 2) {
      return null;
    }
    if (!Number.isFinite(distanceKm)) {
      return null;
    }

    const lastIndex = distances.length - 1;
    if (distanceKm <= (distances[0] ?? 0)) {
      return 0;
    }
    if (distanceKm >= (distances[lastIndex] ?? 0)) {
      return Math.max(0, lastIndex - 1);
    }

    let low = 0;
    let high = lastIndex;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const value = distances[mid];
      if (!Number.isFinite(value)) {
        break;
      }
      if (value <= distanceKm) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const index = Math.max(0, Math.min(low - 1, lastIndex - 1));
    return index;
  }


  getElevationAtDistance(distanceKm) {
    if (!this.routeProfile || !Number.isFinite(distanceKm)) {
      return null;
    }

    const distances = this.routeProfile.cumulativeDistances ?? [];
    const elevations = this.routeProfile.elevations ?? [];
    if (!Array.isArray(distances) || !Array.isArray(elevations) || distances.length !== elevations.length) {
      return null;
    }

    const lastIndex = distances.length - 1;
    if (lastIndex < 0) {
      return null;
    }

    const findPrev = (startIndex) => {
      for (let index = Math.min(startIndex, lastIndex); index >= 0; index -= 1) {
        const distance = distances[index];
        const elevation = elevations[index];
        if (!Number.isFinite(distance) || distance > distanceKm) {
          continue;
        }
        if (Number.isFinite(elevation)) {
          return { distance, elevation };
        }
      }
      return null;
    };

    const findNext = (startIndex) => {
      for (let index = Math.max(startIndex, 0); index <= lastIndex; index += 1) {
        const distance = distances[index];
        const elevation = elevations[index];
        if (!Number.isFinite(distance) || distance < distanceKm) {
          continue;
        }
        if (Number.isFinite(elevation)) {
          return { distance, elevation };
        }
      }
      return null;
    };

    if (distanceKm <= (distances[0] ?? 0)) {
      const next = findNext(0);
      return next?.elevation ?? null;
    }

    if (distanceKm >= (distances[lastIndex] ?? 0)) {
      const prev = findPrev(lastIndex);
      return prev?.elevation ?? null;
    }

    const intervalIndex = this.findProfileIntervalIndex(distanceKm);
    if (intervalIndex === null) {
      return null;
    }

    const previous = findPrev(Math.min(intervalIndex + 1, lastIndex));
    const next = findNext(Math.max(intervalIndex, 0));

    if (previous && next && Number.isFinite(previous.distance) && Number.isFinite(next.distance)
      && next.distance > previous.distance) {
      const span = next.distance - previous.distance;
      const ratio = span > 0 ? (distanceKm - previous.distance) / span : 0;
      const clampedRatio = Math.max(0, Math.min(1, ratio));
      return previous.elevation + (next.elevation - previous.elevation) * clampedRatio;
    }

    if (previous) {
      return previous.elevation;
    }
    if (next) {
      return next.elevation;
    }

    return null;
  }


  computeGradeAtDistance(distanceKm, windowMeters = 30) {
    if (!this.routeProfile || !Number.isFinite(distanceKm)) {
      return null;
    }

    const totalDistance = Number(this.routeProfile.totalDistanceKm);
    if (!Number.isFinite(totalDistance) || totalDistance <= 0) {
      return null;
    }

    const minimumWindowKm = Math.max(windowMeters / 1000, Math.min(totalDistance, 0.01));
    const dynamicWindowKm = Math.max(minimumWindowKm, totalDistance * 0.015);
    const windowKm = Math.min(dynamicWindowKm, totalDistance);

    let startDistance = Math.max(0, distanceKm - windowKm / 2);
    let endDistance = Math.min(totalDistance, distanceKm + windowKm / 2);

    if (endDistance - startDistance < minimumWindowKm) {
      const padding = (minimumWindowKm - (endDistance - startDistance)) / 2;
      startDistance = Math.max(0, startDistance - padding);
      endDistance = Math.min(totalDistance, endDistance + padding);
    }

    const span = endDistance - startDistance;
    if (!Number.isFinite(span) || span <= 0.002) {
      return null;
    }

    const startElevation = this.getElevationAtDistance(startDistance);
    const endElevation = this.getElevationAtDistance(endDistance);
    if (!Number.isFinite(startElevation) || !Number.isFinite(endElevation)) {
      return null;
    }

    const horizontalMeters = Math.max(span * 1000, 1);
    const grade = ((endElevation - startElevation) / horizontalMeters) * 100;
    if (!Number.isFinite(grade)) {
      return null;
    }

    const clamped = Math.max(Math.min(grade, 100), -100);
    return clamped;
  }


  computeDistanceKm(startCoord, endCoord) {
    if (!startCoord || !endCoord) return 0;
    if (turfApi) {
      try {
        return turfApi.distance(turfApi.point(startCoord), turfApi.point(endCoord), { units: 'kilometers' });
      } catch (error) {
        console.warn('Failed to measure distance with turf', error);
      }
    }

    const toRadians = (value) => (value * Math.PI) / 180;
    const [lng1, lat1] = startCoord;
    const [lng2, lat2] = endCoord;
    const earthRadiusKm = 6371;
    const dLat = toRadians((lat2 ?? 0) - (lat1 ?? 0));
    const dLng = toRadians((lng2 ?? 0) - (lng1 ?? 0));
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(toRadians(lat1 ?? 0)) * Math.cos(toRadians(lat2 ?? 0)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
    return earthRadiusKm * c;
  }


  canQueryTerrainElevation() {
    if (!this.map || typeof this.map.queryTerrainElevation !== 'function') {
      return false;
    }

    // If 3D Terrain is active and valid, we're good
    if (typeof this.map.getTerrain === 'function') {
      const terrain = this.map.getTerrain();
      if (terrain && terrain.source && (!Number.isFinite(terrain.exaggeration) || terrain.exaggeration > 0)) {
        return true;
      }
    }

    // Robust Fallback: Check if we have raster-dem sources available even in 2D mode
    // The MapLibre engine (Map class) ahora handles querying these sources in 2D.
    const style = this.map.getStyle();
    if (style && style.sources) {
      return Object.values(style.sources).some((s) => s?.type === 'raster-dem');
    }

    return false;
  }


  queryTerrainElevationValue(coord) {
    if (!Array.isArray(coord) || coord.length < 2) {
      return null;
    }
    const lng = Number(coord[0]);
    const lat = Number(coord[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return null;
    }
    if (!this.map || typeof this.map.queryTerrainElevation !== 'function') {
      return null;
    }
    if (!this.canQueryTerrainElevation()) {
      return null;
    }
    try {
      const elevation = this.map.queryTerrainElevation([lng, lat]);
      return Number.isFinite(elevation) ? elevation : null;
    } catch (error) {
      if (!this.terrainElevationErrorLogged) {
        console.warn('Failed to query terrain elevation', error);
        this.terrainElevationErrorLogged = true;
      }
      return null;
    }
  }


  buildRouteProfile(coordinates = []) {
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      return null;
    }

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
      const rawElevation = coord.length > 2 ? Number(coord[2]) : null;
      const normalizedElevation = Number.isFinite(rawElevation) ? rawElevation : null;
      sanitized.push([lng, lat, normalizedElevation]);
    }

    if (sanitized.length < 2) {
      return null;
    }

    // Densify coordinates if they are too far apart to ensure intermediate terrain sampling.
    // This is particularly important for manual segments which are often just straight lines between waypoints,
    // ensuring we capture mountains and valleys in between.
    const MAX_SAMPLING_DIST_KM = 0.05; // Sample every 50m for high accuracy
    const densified = [];
    for (let i = 0; i < sanitized.length; i++) {
      const current = sanitized[i];
      densified.push(current);
      if (i < sanitized.length - 1) {
        const next = sanitized[i + 1];
        const dist = this.computeDistanceKm(current, next);
        if (dist > MAX_SAMPLING_DIST_KM) {
          const numIntervals = Math.ceil(dist / MAX_SAMPLING_DIST_KM);
          for (let j = 1; j < numIntervals; j++) {
            const ratio = j / numIntervals;
            // Interpolate coordinates; elevation will be sampled below
            densified.push([
              current[0] + (next[0] - current[0]) * ratio,
              current[1] + (next[1] - current[1]) * ratio,
              null
            ]);
          }
        }
      }
    }

    const canQueryTerrain = this.canQueryTerrainElevation();
    if (canQueryTerrain) {
      this.terrainElevationErrorLogged = false;
    }

    // Use densified sequence for elevation sampling and metric computation
    const processingSequence = densified;

    let terrainSampleCount = 0;
    for (let index = 0; index < processingSequence.length; index += 1) {
      const coord = processingSequence[index];
      let elevation = Number.isFinite(coord[2]) ? coord[2] : null;
      if (canQueryTerrain) {
        const terrainElevation = this.queryTerrainElevationValue(coord);
        // Only count as valid terrain sample if we get a non-zero value
        // MapLibre returns 0 when terrain tiles haven't loaded yet
        if (Number.isFinite(terrainElevation) && terrainElevation !== 0) {
          elevation = terrainElevation;
          terrainSampleCount++;
        } else if (Number.isFinite(terrainElevation)) {
          // Got 0 from terrain - use it but don't count as valid sample
          elevation = terrainElevation;
        }
      }
      coord[2] = elevation;
    }

    // Pass 2: Linearly interpolate any remaining holes (points where terrain query failed AND no original elevation)
    let firstValidIdx = -1;
    for (let i = 0; i < processingSequence.length; i++) {
      if (Number.isFinite(processingSequence[i][2])) {
        if (firstValidIdx === -1) {
          // Fill start with the first valid elevation found
          for (let j = 0; j < i; j++) processingSequence[j][2] = processingSequence[i][2];
        } else if (i > firstValidIdx + 1) {
          // Interpolate gap between firstValidIdx and i
          const startEle = processingSequence[firstValidIdx][2];
          const endEle = processingSequence[i][2];
          const count = i - firstValidIdx;
          for (let j = firstValidIdx + 1; j < i; j++) {
            processingSequence[j][2] = startEle + (endEle - startEle) * ((j - firstValidIdx) / count);
          }
        }
        firstValidIdx = i;
      }
    }
    // Fill trailing holes with last valid elevation
    if (firstValidIdx !== -1 && firstValidIdx < processingSequence.length - 1) {
      const lastEle = processingSequence[firstValidIdx][2];
      for (let i = firstValidIdx + 1; i < processingSequence.length; i++) {
        processingSequence[i][2] = lastEle;
      }
    }
    // If NO valid elevations were found at all, leave as null to avoid breaking 
    // metric fallbacks (calculateRouteMetrics ignores nulls but would count 0s as stable ground)
    if (firstValidIdx === -1) {
      for (let i = 0; i < processingSequence.length; i++) processingSequence[i][2] = null;
    }

    const cumulativeDistances = new Array(processingSequence.length).fill(0);
    let totalDistance = 0;

    for (let index = 1; index < processingSequence.length; index += 1) {
      const segmentDistance = this.computeDistanceKm(processingSequence[index - 1], processingSequence[index]);
      totalDistance += Number.isFinite(segmentDistance) ? segmentDistance : 0;
      cumulativeDistances[index] = totalDistance;
    }

    const elevations = processingSequence.map((coord) => {
      const elevation = coord?.[2];
      return Number.isFinite(elevation) ? elevation : null;
    });

    return {
      coordinates: processingSequence,
      cumulativeDistances,
      totalDistanceKm: totalDistance,
      elevations,
      terrainSampleCount
    };
  }


  generateElevationSamples(coordinates) {
    if (!this.routeProfile) return [];
    const profile = this.routeProfile;
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
      const samples = points.map((point, index) => ({
        elevation: point.elevation,
        startDistanceKm: index === 0 ? 0 : points[index - 1].distanceKm,
        endDistanceKm: point.distanceKm
      }));
      if (samples.length) {
        const lastSample = samples[samples.length - 1];
        if (Number.isFinite(profile.totalDistanceKm) && lastSample.endDistanceKm < profile.totalDistanceKm) {
          lastSample.endDistanceKm = profile.totalDistanceKm;
        }
      }
      return samples;
    }

    const samples = [];
    const bucketSize = points.length / MAX_ELEVATION_POINTS;

    for (let bucketIndex = 0; bucketIndex < MAX_ELEVATION_POINTS; bucketIndex += 1) {
      const start = Math.floor(bucketIndex * bucketSize);
      const end = bucketIndex === MAX_ELEVATION_POINTS - 1
        ? points.length
        : Math.max(start + 1, Math.floor((bucketIndex + 1) * bucketSize));

      let elevationSum = 0;
      let count = 0;
      for (let index = start; index < end; index += 1) {
        elevationSum += points[index].elevation;
        count += 1;
      }

      const firstPoint = points[start];
      const lastPoint = points[Math.min(end - 1, points.length - 1)];
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


  buildElevationAreaPaths(samples, yAxis, domain) {
    const distances = Array.isArray(this.routeProfile?.cumulativeDistances)
      ? this.routeProfile.cumulativeDistances
      : [];
    const elevations = Array.isArray(this.routeProfile?.elevations)
      ? this.routeProfile.elevations
      : [];
    const range = Math.max(Number.EPSILON, yAxis.max - yAxis.min);
    const points = [];

    const domainMin = Number.isFinite(domain?.min) ? domain.min : 0;
    const domainMax = Number.isFinite(domain?.max) ? domain.max : domainMin;
    const domainSpan = domainMax - domainMin;
    const safeSpan = domainSpan === 0 ? 1 : domainSpan;

    const pushPoint = (distance, elevation) => {
      if (!Number.isFinite(elevation)) {
        return;
      }
      let ratio = 0;
      if (domainSpan !== 0 && Number.isFinite(distance)) {
        ratio = (distance - domainMin) / safeSpan;
      }
      const clampedRatio = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
      const clampedElevation = Math.min(yAxis.max, Math.max(yAxis.min, elevation));
      const normalized = range > 0 ? (clampedElevation - yAxis.min) / range : 0;
      const x = clampedRatio * 100;
      const y = 100 - normalized * 100;
      if (points.length && Math.abs(points[points.length - 1].x - x) < 0.01) {
        points[points.length - 1] = { x, y };
      } else {
        points.push({ x, y });
      }
    };

    if (distances.length && distances.length === elevations.length) {
      const lastIndex = distances.length - 1;
      for (let index = 0; index < distances.length; index += 1) {
        const distanceKm = Number(distances[index]);
        const elevation = Number(elevations[index]);
        if (!Number.isFinite(elevation)) {
          continue;
        }
        if (Number.isFinite(distanceKm)) {
          pushPoint(distanceKm, elevation);
        } else if (lastIndex > 0) {
          const fallbackDistance = domainMin + (domainSpan * index) / lastIndex;
          pushPoint(fallbackDistance, elevation);
        } else {
          pushPoint(domainMin, elevation);
        }
      }
    }

    if (points.length < 2 && Array.isArray(samples) && samples.length) {
      samples.forEach((sample, index) => {
        const elevation = Number(sample.elevation);
        if (!Number.isFinite(elevation)) {
          return;
        }
        const start = Number(sample.startDistanceKm);
        const end = Number(sample.endDistanceKm);
        if (Number.isFinite(start)) {
          pushPoint(start, elevation);
        } else {
          const fallbackStart = domainMin + (domainSpan * index) / Math.max(1, samples.length - 1);
          pushPoint(fallbackStart, elevation);
        }
        if (Number.isFinite(end)) {
          pushPoint(end, elevation);
        } else {
          const fallbackEnd = domainMin + (domainSpan * (index + 1)) / Math.max(1, samples.length);
          pushPoint(fallbackEnd, elevation);
        }
      });
    }

    if (points.length < 2) {
      return { fill: '', stroke: '' };
    }

    points.sort((a, b) => a.x - b.x);

    const normalized = [];
    points.forEach((point) => {
      const last = normalized[normalized.length - 1];
      if (!last || Math.abs(last.x - point.x) > 0.01) {
        normalized.push(point);
      } else {
        normalized[normalized.length - 1] = point;
      }
    });

    if (!normalized.length) {
      return { fill: '', stroke: '' };
    }

    if (normalized[0].x > 0.01) {
      normalized.unshift({ x: 0, y: normalized[0].y });
    }
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


  ensureRouteHoverTooltip() {
    if (this.routeHoverTooltip && this.routeHoverTooltip.parentElement) {
      return this.routeHoverTooltip;
    }
    const tooltip = document.createElement('div');
    tooltip.className = 'directions-route-tooltip';
    tooltip.setAttribute('role', 'presentation');
    tooltip.style.display = 'none';
    (this.mapContainer ?? document.body).appendChild(tooltip);
    this.routeHoverTooltip = tooltip;
    return tooltip;
  }


  formatGrade(value) {
    if (!Number.isFinite(value)) return '—';
    const rounded = Math.round(value * 10) / 10;
    const formatted = Math.abs(rounded) < 0.05 ? 0 : rounded;
    const sign = formatted > 0 ? '+' : '';
    return `${sign}${formatted.toFixed(1)}%`;
  }


  highlightElevationAt(distanceKm) {
    if (!this.elevationChartContainer) {
      return;
    }

    if (this.highlightedElevationBar) {
      this.highlightedElevationBar.classList.remove('highlighted');
      this.highlightedElevationBar = null;
    }

    if (!this.elevationHoverIndicator || !this.elevationHoverLine) {
      return;
    }

    if (!Number.isFinite(distanceKm)) {
      this.elevationHoverIndicator.setAttribute('aria-hidden', 'true');
      return;
    }

    let domainMin = Number(this.elevationDomain?.min);
    let domainMax = Number(this.elevationDomain?.max);
    if (!Number.isFinite(domainMin) || !Number.isFinite(domainMax)) {
      const totalDistance = Number(this.routeProfile?.totalDistanceKm);
      if (Number.isFinite(totalDistance) && totalDistance > 0) {
        domainMin = 0;
        domainMax = totalDistance;
      }
    }
    if (!Number.isFinite(domainMin) || !Number.isFinite(domainMax)) {
      this.elevationHoverIndicator.setAttribute('aria-hidden', 'true');
      return;
    }
    const span = domainMax - domainMin;
    if (!(span > 0)) {
      this.elevationHoverIndicator.setAttribute('aria-hidden', 'true');
      return;
    }

    const ratio = (distanceKm - domainMin) / span;
    const clampedRatio = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
    const percent = clampedRatio * 100;
    this.elevationHoverLine.style.left = `${percent}%`;
    this.elevationHoverIndicator.setAttribute('aria-hidden', 'false');
  }


  detachElevationChartEvents() {
    if (!this.elevationChartContainer) {
      return;
    }
    this.elevationChartContainer.removeEventListener('pointermove', this.handleElevationPointerMove);
    this.elevationChartContainer.removeEventListener('pointerleave', this.handleElevationPointerLeave);
    this.elevationChartContainer.removeEventListener('contextmenu', this.handleElevationContextMenu);
  }


  attachElevationChartEvents() {
    if (!this.elevationChartContainer) {
      return;
    }
    this.elevationChartContainer.addEventListener('pointermove', this.handleElevationPointerMove);
    this.elevationChartContainer.addEventListener('pointerleave', this.handleElevationPointerLeave);
    this.elevationChartContainer.addEventListener('contextmenu', this.handleElevationContextMenu);
  }


  onElevationPointerMove(event) {
    if (!this.elevationChartContainer) {
      return;
    }

    // Throttle elevation hover to ~60fps max for performance
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this._lastElevationPointerMoveTime && now - this._lastElevationPointerMoveTime < 16) {
      return;
    }
    this._lastElevationPointerMoveTime = now;

    const rect = this.elevationChartContainer.getBoundingClientRect();
    const width = Number(rect?.width) || 0;
    if (!(width > 0)) {
      return;
    }

    let domainMin = Number(this.elevationDomain?.min);
    let domainMax = Number(this.elevationDomain?.max);
    if (!Number.isFinite(domainMin) || !Number.isFinite(domainMax)) {
      const totalDistance = Number(this.routeProfile?.totalDistanceKm);
      if (Number.isFinite(totalDistance) && totalDistance > 0) {
        domainMin = 0;
        domainMax = totalDistance;
      }
    }
    if (!Number.isFinite(domainMin) || !Number.isFinite(domainMax)) {
      return;
    }

    const span = domainMax - domainMin;
    if (!(span > 0)) {
      return;
    }

    const relativeX = (event.clientX - rect.left) / width;
    const clampedRatio = Math.max(0, Math.min(1, Number.isFinite(relativeX) ? relativeX : 0));
    const rawDistance = domainMin + span * clampedRatio;
    const totalDistance = Number(this.routeProfile?.totalDistanceKm);
    const distanceKm = Number.isFinite(totalDistance) && totalDistance > 0
      ? Math.max(0, Math.min(totalDistance, rawDistance))
      : Math.max(0, rawDistance);

    if (this.activeHoverSource === 'chart' && this.lastElevationHoverDistance !== null
      && Math.abs(this.lastElevationHoverDistance - distanceKm) < 1e-4) {
      this.highlightElevationAt(distanceKm);
      return;
    }

    this.lastElevationHoverDistance = distanceKm;
    this.highlightElevationAt(distanceKm);
    this.showRouteHoverAtDistance(distanceKm, { source: 'chart' });
  }


  onElevationPointerLeave() {
    this.lastElevationHoverDistance = null;
    this.resetSegmentHover('chart');
    this.highlightElevationAt(null);
    this.updateElevationHoverReadout(null);
  }


  onElevationContextMenu(event) {
    // Right-click on elevation chart to add a bivouac at that distance
    if (!this.elevationChartContainer) {
      return;
    }

    event.preventDefault();

    const rect = this.elevationChartContainer.getBoundingClientRect();
    const width = Number(rect?.width) || 0;
    if (!(width > 0)) {
      return;
    }

    // Calculate distance from click position
    let domainMin = Number(this.elevationDomain?.min);
    let domainMax = Number(this.elevationDomain?.max);
    if (!Number.isFinite(domainMin) || !Number.isFinite(domainMax)) {
      const totalDistance = Number(this.routeProfile?.totalDistanceKm);
      if (Number.isFinite(totalDistance) && totalDistance > 0) {
        domainMin = 0;
        domainMax = totalDistance;
      }
    }

    if (!Number.isFinite(domainMin) || !Number.isFinite(domainMax)) {
      return;
    }

    const span = domainMax - domainMin;
    if (!(span > 0)) {
      return;
    }

    const clientX = event.clientX ?? event.pageX ?? 0;
    const relativeX = clientX - rect.left;
    const ratio = relativeX / width;
    const rawDistance = domainMin + ratio * span;

    const totalDistance = Number(this.routeProfile?.totalDistanceKm);
    const distanceKm = Number.isFinite(totalDistance) && totalDistance > 0
      ? Math.max(0, Math.min(totalDistance, rawDistance))
      : Math.max(0, rawDistance);

    if (!Number.isFinite(distanceKm)) {
      return;
    }

    // Add bivouac at this distance
    this.addRouteCut(distanceKm);
  }

}
