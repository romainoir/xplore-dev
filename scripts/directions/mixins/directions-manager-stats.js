import {
  EMPTY_COLLECTION,
  COORD_EPSILON,
  WAYPOINT_MATCH_TOLERANCE_METERS,
  ROUTE_CUT_EPSILON_KM,
  turfApi
} from '../constants/directions-constants.js';

import {
  isConnectorMetadataSource,
  haversineDistanceMeters
} from '../utils/directions-utils.js';

import {
  updateBivouacMarkerColor,
  toLngLat
} from '../markers/directions-markers.js';

import {
  normalizeSacScale,
  resolveSacScale
} from '../utils/directions-profile-utils.js';


export class DirectionsManagerStatsMixin {
  clearRoute() {
    this.routeGeojson = null;
    this.routeSegments = [];
    this.segmentLegLookup = [];
    this.cachedLegSegments = new Map();
    this.latestMetrics = null;
    this.routeProfile = null;
    this.routeCoordinateMetadata = [];
    this.elevationSamples = [];
    this.elevationDomain = null;
    this.fullRouteDomain = null;
    this.selectedDayIndex = null;
    this.elevationYAxis = null;
    this.setRoutePointsOfInterest([]);
    this.routePhotos = [];
    this.showElevationPhotos = false;
    this.pendingPoiRequest = null;
    this.resetRouteCuts();
    this.detachElevationChartEvents();
    this.elevationChartContainer = null;
    this.elevationChartTooltip = null;
    this.highlightedElevationBar = null;
    this.lastElevationHoverDistance = null;
    this.draggedBivouacIndex = null;
    this.draggedBivouacLngLat = null;

    this.profileSegments = [];
    this.updateRouteLineSource();
    this.map.getSource('distance-markers-source')?.setData(EMPTY_COLLECTION);
    this.map.getSource('route-segments-source')?.setData(EMPTY_COLLECTION);
    this.clearHover();
    this.updateWaypoints();
    this.notifyRouteSegmentsUpdated();
  }

  clearDirections() {
    this.waypoints = [];
    this.draggedBivouacLngLat = null;
    this.updateWaypoints();
    this.clearRoute();
    this.currentRouteId = null;
    this.updateStats(null);
    this.updateElevationProfile([]);
    this.routeCoordinateMetadata = [];
    this.profileSegments = [];
    this.updateRouteLineSource();
    this.updateManualRouteSource();
    this.draggedWaypointIndex = null;
    this.draggedBivouacIndex = null;
    this.setHoveredWaypointIndex(null);
    this.waypointHistory = [];
    this.waypointRedoHistory = [];
    this.updateUndoAvailability();
    // Collapse the elevation chart when clearing the route
    this.setElevationCollapsed(true);
    // Notify listener that directions were cleared (e.g., to clear imported GPX layer)
    if (typeof this.clearDirectionsListener === 'function') {
      try {
        this.clearDirectionsListener();
      } catch (error) {
        console.error('Clear directions listener failed', error);
      }
    }
  }
  setTransportMode(mode) {
    if (!this.modeColors[mode]) return;
    if (this.router && typeof this.router.supportsMode === 'function' && !this.router.supportsMode(mode)) {
      return;
    }
    const previousMode = this.currentMode;
    this.currentMode = mode;
    this.transportModes.forEach((button) => {
      button.classList.toggle('active', button.dataset.mode === mode);
    });
    if (this.map.getLayer('route-line')) {
      this.map.setPaintProperty(
        'route-line',
        'line-color',
        ['coalesce', ['get', 'color'], this.modeColors[this.currentMode]]
      );
      this.setRouteLineGradient();
    }
    if (this.map.getLayer('route-hover-point')) {
      this.map.setPaintProperty('route-hover-point', 'circle-stroke-color', this.modeColors[this.currentMode]);
    }
    if (this.map.getLayer('drag-preview-line')) {
      // Use expression to get color from feature properties, with fallback to mode color
      this.map.setPaintProperty('drag-preview-line', 'line-color',
        ['coalesce', ['get', 'color'], this.modeColors[this.currentMode]]);
    }
    // Update bivouac marker icon to match route color
    updateBivouacMarkerColor(this.map, this.modeColors[this.currentMode]);
    if (this.cutSegments.length) {
      this.updateCutSegmentColors();
      this.updateRouteLineSource();
      if (Array.isArray(this.routeGeojson?.geometry?.coordinates) && this.routeGeojson.geometry.coordinates.length >= 2) {
        this.updateElevationProfile(this.routeGeojson.geometry.coordinates);
      }
      this.notifyRouteSegmentsUpdated();
    }
    this.updateWaypoints();
    // Mode switching should NOT recalculate existing route segments
    // The mode only affects how NEW segments are created when adding waypoints
    // Existing segments (whether snapped or manual) should be preserved
  }

  cacheRouteLegSegments() {
    const routeCoordinates = this.routeGeojson?.geometry?.coordinates;
    if (!Array.isArray(routeCoordinates) || routeCoordinates.length < 2) {
      this.cachedLegSegments = new Map();
      return;
    }
    if (!Array.isArray(this.waypoints) || this.waypoints.length < 2) {
      this.cachedLegSegments = new Map();
      return;
    }

    const coords = routeCoordinates;
    const normalizedWaypoints = this.waypoints.map((coord) => {
      if (!Array.isArray(coord) || coord.length < 2) {
        return null;
      }
      const lng = Number(coord[0]);
      const lat = Number(coord[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return null;
      }
      const elevation = coord.length > 2 && Number.isFinite(coord[2]) ? coord[2] : 0;
      return [lng, lat, elevation];
    });

    const findWaypointIndex = (target, startIndex) => {
      if (!Array.isArray(target) || target.length < 2) {
        return -1;
      }
      for (let index = Math.max(0, startIndex); index < coords.length; index += 1) {
        if (this.coordinatesMatch(coords[index], target)) {
          return index;
        }
      }
      return -1;
    };

    const segments = new Map();
    let searchStart = 0;
    const segmentMetrics = Array.isArray(this.routeGeojson?.properties?.segments)
      ? this.routeGeojson.properties.segments
      : [];
    const segmentMetadataSource = Array.isArray(this.routeGeojson?.properties?.segment_metadata)
      ? this.routeGeojson.properties.segment_metadata
      : [];
    const segmentModes = Array.isArray(this.routeGeojson?.properties?.segment_modes)
      ? this.routeGeojson.properties.segment_modes
      : [];

    for (let waypointIndex = 0; waypointIndex < normalizedWaypoints.length - 1; waypointIndex += 1) {
      const startWaypoint = normalizedWaypoints[waypointIndex];
      const endWaypoint = normalizedWaypoints[waypointIndex + 1];
      if (!startWaypoint || !endWaypoint) {
        continue;
      }

      const startIndex = findWaypointIndex(startWaypoint, searchStart);
      if (startIndex === -1) {
        continue;
      }
      const endIndex = findWaypointIndex(endWaypoint, Math.max(startIndex, searchStart));
      if (endIndex === -1 || endIndex <= startIndex) {
        continue;
      }

      const rawSegment = coords
        .slice(startIndex, endIndex + 1)
        .map((coord) => {
          if (!Array.isArray(coord) || coord.length < 2) {
            return null;
          }
          const lng = Number(coord[0]);
          const lat = Number(coord[1]);
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
            return null;
          }
          const elevation = coord.length > 2 && Number.isFinite(coord[2]) ? coord[2] : 0;
          return [lng, lat, elevation];
        })
        .filter(Boolean);

      if (!rawSegment.length) {
        continue;
      }

      if (!this.coordinatesMatch(rawSegment[0], startWaypoint)) {
        rawSegment.unshift([...startWaypoint]);
      }
      if (!this.coordinatesMatch(rawSegment[rawSegment.length - 1], endWaypoint)) {
        rawSegment.push([...endWaypoint]);
      }

      const segmentCoordinates = rawSegment;

      if (segmentCoordinates.length < 2) {
        continue;
      }

      segmentCoordinates[0] = [...startWaypoint];
      segmentCoordinates[segmentCoordinates.length - 1] = [...endWaypoint];

      const metrics = segmentMetrics[waypointIndex] || {};
      const distance = Number.isFinite(metrics?.distance) ? Number(metrics.distance) : null;
      const duration = Number.isFinite(metrics?.duration) ? Number(metrics.duration) : null;
      const ascent = Number.isFinite(metrics?.ascent) ? Number(metrics.ascent) : null;
      const descent = Number.isFinite(metrics?.descent) ? Number(metrics.descent) : null;

      const metadataEntries = Array.isArray(segmentMetadataSource[waypointIndex])
        ? segmentMetadataSource[waypointIndex]
          .map((entry) => (entry && typeof entry === 'object' ? { ...entry } : null))
          .filter((entry) => entry && !isConnectorMetadataSource(entry.source))
        : [];

      // Store the routing mode used for this segment
      // Use segment_modes array if available, otherwise default to foot-hiking (snap mode)
      // The segment_modes array from the router is the authoritative source
      const segmentMode = segmentModes[waypointIndex] || 'foot-hiking';

      segments.set(waypointIndex, {
        startIndex: waypointIndex,
        endIndex: waypointIndex + 1,
        coordinates: segmentCoordinates,
        distance,
        duration,
        ascent,
        descent,
        metadata: metadataEntries,
        routingMode: segmentMode
      });

      searchStart = endIndex;
    }

    this.cachedLegSegments = segments;
    this.updateManualRouteSource();
  }

  updateManualRouteSource() {
    const source = this.map.getSource('route-manual-source');
    if (!source) {
      return;
    }

    const features = [];
    source.setData({ type: 'FeatureCollection', features }); // Clear first if needed

    // Move layers to top to ensure visibility over custom terrain layers
    if (typeof this.moveRouteLayersToTop === 'function') {
      this.moveRouteLayersToTop();
    }

    if (!(this.cachedLegSegments instanceof Map) || !this.cachedLegSegments.size) {
      return;
    }
    const fallbackColor = this.modeColors[this.currentMode] || '#f8b40b';

    // Build cumulative distances for legs from routeGeojson segments
    // We compute distances manually instead of relying on seg.distance to avoid drift
    // between router's distance and our densified routeProfile distance.
    const legCumulativeDistances = [0];
    let cumulativeLegDist = 0;
    for (const segment of this.cachedLegSegments.values()) {
      const coords = Array.isArray(segment.coordinates) ? segment.coordinates : [];
      let dist = 0;
      for (let i = 1; i < coords.length; i++) {
        dist += this.computeDistanceKm(coords[i - 1], coords[i]);
      }
      cumulativeLegDist += dist;
      legCumulativeDistances.push(cumulativeLegDist);
    }

    // Helper to compute distance for a coordinate array
    const computeSegmentDistances = (coords) => {
      const distances = [0];
      for (let i = 1; i < coords.length; i++) {
        const prev = coords[i - 1];
        const curr = coords[i];
        const segDist = this.computeDistanceKm(prev, curr);
        distances.push(distances[distances.length - 1] + (Number.isFinite(segDist) ? segDist : 0));
      }
      return distances;
    };

    // Helper to interpolate a point on a segment
    const interpolatePoint = (p1, p2, t) => {
      const lng = p1[0] + (p2[0] - p1[0]) * t;
      const lat = p1[1] + (p2[1] - p1[1]) * t;
      if (p1.length > 2 && p2.length > 2 && Number.isFinite(p1[2]) && Number.isFinite(p2[2])) {
        return [lng, lat, p1[2] + (p2[2] - p1[2]) * t];
      }
      return [lng, lat];
    };

    // Helper to extract coordinates from startDist to endDist
    const extractCoordsInRange = (coords, cumulativeDists, rangeStart, rangeEnd) => {
      const result = [];
      const totalDist = cumulativeDists[cumulativeDists.length - 1] || 0;

      // Clamp range to valid values
      const clampedStart = Math.max(0, rangeStart);
      const clampedEnd = Math.min(totalDist, rangeEnd);

      if (clampedStart >= clampedEnd || coords.length < 2) {
        return result;
      }

      // Find the segment containing the start point and add interpolated start
      let startAdded = false;
      for (let i = 0; i < coords.length - 1; i++) {
        const d1 = cumulativeDists[i];
        const d2 = cumulativeDists[i + 1];

        if (d1 <= clampedStart && clampedStart <= d2) {
          const segLen = d2 - d1;
          if (segLen > 0) {
            const t = (clampedStart - d1) / segLen;
            result.push(interpolatePoint(coords[i], coords[i + 1], t));
          } else {
            result.push(coords[i].slice());
          }
          startAdded = true;
          break;
        }
      }

      // If start wasn't added (edge case), add the first coord
      if (!startAdded && clampedStart <= 0) {
        result.push(coords[0].slice());
      }

      // Add all intermediate vertices that fall strictly within the range
      for (let i = 1; i < coords.length - 1; i++) {
        const d = cumulativeDists[i];
        if (d > clampedStart && d < clampedEnd) {
          result.push(coords[i].slice());
        }
      }

      // Find the segment containing the end point and add interpolated end
      for (let i = 0; i < coords.length - 1; i++) {
        const d1 = cumulativeDists[i];
        const d2 = cumulativeDists[i + 1];

        if (d1 <= clampedEnd && clampedEnd <= d2) {
          const segLen = d2 - d1;
          if (segLen > 0) {
            const t = (clampedEnd - d1) / segLen;
            const endPoint = interpolatePoint(coords[i], coords[i + 1], t);
            // Avoid duplicate if end point is same as last added
            const last = result[result.length - 1];
            if (!last || Math.abs(last[0] - endPoint[0]) > 1e-8 || Math.abs(last[1] - endPoint[1]) > 1e-8) {
              result.push(endPoint);
            }
          }
          break;
        }
      }

      // If end wasn't added (edge case at total distance), add the last coord
      if (result.length > 0 && clampedEnd >= totalDist) {
        const lastCoord = coords[coords.length - 1];
        const last = result[result.length - 1];
        if (!last || Math.abs(last[0] - lastCoord[0]) > 1e-8 || Math.abs(last[1] - lastCoord[1]) > 1e-8) {
          result.push(lastCoord.slice());
        }
      }

      return result;
    };

    for (const segment of this.cachedLegSegments.values()) {
      if (!segment || segment.routingMode !== 'manual') {
        continue;
      }
      const coordinates = Array.isArray(segment.coordinates)
        ? segment.coordinates.filter((coord) => Array.isArray(coord) && coord.length >= 2)
        : [];
      if (coordinates.length < 2) {
        continue;
      }

      // Get the cumulative distance range for this leg
      const legIndex = segment.startIndex;
      const legStartKm = legCumulativeDistances[legIndex] || 0;
      const legEndKm = legCumulativeDistances[legIndex + 1] || legStartKm;

      // Build cumulative distances within this leg's coordinates
      const localDistances = computeSegmentDistances(coordinates);
      const legLength = localDistances[localDistances.length - 1] || 0;

      // If no cut segments or leg has no length, use color based on distance
      if (!Array.isArray(this.cutSegments) || this.cutSegments.length === 0 || legLength <= 0) {
        // Use getColorForDistance which respects profile mode (slope, difficulty, etc.)
        const midpointKm = (legStartKm + legEndKm) / 2;
        const segmentColor = this.getColorForDistance(midpointKm) || fallbackColor;
        features.push({
          type: 'Feature',
          properties: { legIndex, color: segmentColor },
          geometry: { type: 'LineString', coordinates }
        });
        continue;
      }

      // Find which cut segments overlap this leg
      const overlappingCuts = this.cutSegments.filter((cut) => {
        const cutStart = Number(cut.startKm ?? 0);
        const cutEnd = Number(cut.endKm ?? cutStart);
        return cutEnd > legStartKm && cutStart < legEndKm;
      });

      if (overlappingCuts.length === 0) {
        // No overlaps, use color based on distance (respects profile mode)
        const midpointKm = (legStartKm + legEndKm) / 2;
        const segmentColor = this.getColorForDistance(midpointKm) || fallbackColor;
        features.push({
          type: 'Feature',
          properties: { legIndex, color: segmentColor },
          geometry: { type: 'LineString', coordinates }
        });
        continue;
      }

      // Split the leg at each cut boundary
      // We need to scale because local distances may not exactly match global leg distance
      const globalLegLength = legEndKm - legStartKm;
      const scaleFactor = globalLegLength > 0 && legLength > 0 ? legLength / globalLegLength : 1;

      overlappingCuts.forEach((cut) => {
        const cutStart = Math.max(legStartKm, Number(cut.startKm ?? 0));
        const cutEnd = Math.min(legEndKm, Number(cut.endKm ?? legEndKm));

        // Convert global distances to local distances within the leg, scaled appropriately
        const localStart = (cutStart - legStartKm) * scaleFactor;
        const localEnd = (cutEnd - legStartKm) * scaleFactor;

        // Extract the coordinates for this portion
        let portionCoords = extractCoordsInRange(coordinates, localDistances, localStart, localEnd);

        // Fallback: if extraction failed but we have a valid range, interpolate directly
        if (portionCoords.length < 2 && localEnd > localStart && legLength > 0) {
          const tStart = localStart / legLength;
          const tEnd = localEnd / legLength;
          // For a simple 2-point leg, interpolate the points
          if (coordinates.length === 2) {
            const startPt = interpolatePoint(coordinates[0], coordinates[1], tStart);
            const endPt = interpolatePoint(coordinates[0], coordinates[1], tEnd);
            portionCoords = [startPt, endPt];
          } else {
            // For multi-point legs, try to get at least start and end
            const startPt = interpolatePoint(coordinates[0], coordinates[coordinates.length - 1], tStart);
            const endPt = interpolatePoint(coordinates[0], coordinates[coordinates.length - 1], tEnd);
            portionCoords = [startPt, endPt];
          }
        }

        if (portionCoords.length >= 2) {
          // Use getColorForDistance to respect profile mode (slope, difficulty, etc.)
          const midpointKm = (cutStart + cutEnd) / 2;
          const portionColor = this.getColorForDistance(midpointKm) || cut.color || fallbackColor;
          features.push({
            type: 'Feature',
            properties: { legIndex, color: portionColor },
            geometry: { type: 'LineString', coordinates: portionCoords }
          });
        }
      });
    }

    if (!features.length) {
      source.setData(EMPTY_COLLECTION);
      return;
    }

    source.setData({
      type: 'FeatureCollection',
      features
    });
  }

  invalidateCachedLegSegments(options = null) {
    if (!(this.cachedLegSegments instanceof Map)) {
      this.cachedLegSegments = new Map();
      this.updateManualRouteSource();
      return;
    }

    if (!options) {
      this.cachedLegSegments.clear();
      this.updateManualRouteSource();
      return;
    }

    const { startIndex, endIndex } = options;
    if (!Number.isInteger(startIndex) && !Number.isInteger(endIndex)) {
      this.cachedLegSegments.clear();
      this.updateManualRouteSource();
      return;
    }

    const start = Number.isInteger(startIndex) ? startIndex : Number.isInteger(endIndex) ? endIndex : 0;
    const finish = Number.isInteger(endIndex) ? endIndex : start;
    for (let index = start; index <= finish; index += 1) {
      this.cachedLegSegments.delete(index);
    }
    this.updateManualRouteSource();
  }

  shiftCachedLegSegments(startIndex, delta) {
    if (!(this.cachedLegSegments instanceof Map)) {
      this.cachedLegSegments = new Map();
      return;
    }
    if (!Number.isInteger(startIndex) || !Number.isInteger(delta) || delta === 0) {
      return;
    }

    const updated = new Map();
    for (const [index, segment] of this.cachedLegSegments.entries()) {
      if (index < startIndex) {
        updated.set(index, segment);
        continue;
      }

      const newIndex = index + delta;
      if (newIndex < 0) {
        continue;
      }

      const adjusted = {
        ...segment,
        startIndex: newIndex,
        endIndex: newIndex + 1
      };
      updated.set(newIndex, adjusted);
    }

    this.cachedLegSegments = updated;
  }

  buildPreservedSegments() {
    if (!(this.cachedLegSegments instanceof Map) || !this.cachedLegSegments.size) {
      return [];
    }
    if (!Array.isArray(this.waypoints) || this.waypoints.length < 2) {
      return [];
    }

    const preserved = [];
    for (const segment of this.cachedLegSegments.values()) {
      if (!segment) {
        continue;
      }
      const startIndex = Number(segment.startIndex);
      const endIndex = Number(segment.endIndex);
      if (!Number.isInteger(startIndex) || endIndex !== startIndex + 1) {
        continue;
      }
      if (startIndex < 0 || endIndex >= this.waypoints.length) {
        continue;
      }
      const coordinates = Array.isArray(segment.coordinates)
        ? segment.coordinates
          .map((coord) => {
            if (!Array.isArray(coord) || coord.length < 2) {
              return null;
            }
            const lng = Number(coord[0]);
            const lat = Number(coord[1]);
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
              return null;
            }
            const elevation = coord.length > 2 && Number.isFinite(coord[2]) ? coord[2] : 0;
            return [lng, lat, elevation];
          })
          .filter(Boolean)
        : null;
      if (!coordinates || coordinates.length < 2) {
        continue;
      }
      const startWaypoint = this.waypoints[startIndex];
      const endWaypoint = this.waypoints[endIndex];
      const startMatch = this.coordinatesMatch(coordinates[0], startWaypoint);
      const endMatch = this.coordinatesMatch(coordinates[coordinates.length - 1], endWaypoint);
      if (!startMatch || !endMatch) {
        continue;
      }
      const distance = Number.isFinite(segment.distance) ? Number(segment.distance) : null;
      const duration = Number.isFinite(segment.duration) ? Number(segment.duration) : null;
      const ascent = Number.isFinite(segment.ascent) ? Number(segment.ascent) : null;
      const descent = Number.isFinite(segment.descent) ? Number(segment.descent) : null;
      const metadata = Array.isArray(segment.metadata)
        ? segment.metadata
          .map((entry) => (entry && typeof entry === 'object' ? { ...entry } : null))
          .filter((entry) => entry && !isConnectorMetadataSource(entry.source))
        : [];

      preserved.push({
        startIndex,
        endIndex,
        coordinates,
        distance,
        duration,
        ascent,
        descent,
        metadata,
        routingMode: segment.routingMode || null
      });
    }

    return preserved;
  }

  rebuildSegmentData() {
    const coords = this.routeGeojson?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) {
      this.routeSegments = [];
      this.segmentLegLookup = [];
      this.map.getSource('route-segments-source')?.setData(EMPTY_COLLECTION);
      this.resetSegmentHover();
      this.routeCoordinateMetadata = [];
      this.profileSegments = [];
      this.updateRouteLineSource();
      return;
    }

    const profile = this.routeProfile;
    const cumulative = profile?.cumulativeDistances ?? [];
    const elevations = profile?.elevations ?? [];
    const coordinateMetadata = Array.isArray(this.routeCoordinateMetadata)
      ? this.routeCoordinateMetadata.map((entry) => (entry && typeof entry === 'object' ? entry : null))
      : [];

    const metadataDistanceEntries = coordinateMetadata
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        const startKm = Number(entry.startDistanceKm ?? entry.cumulativeStartKm);
        const endKm = Number(entry.endDistanceKm ?? entry.cumulativeEndKm ?? startKm);
        if (!Number.isFinite(startKm) || !Number.isFinite(endKm)) {
          return null;
        }
        return { entry, startKm, endKm };
      })
      .filter(Boolean)
      .sort((a, b) => a.startKm - b.startKm);

    const METADATA_DISTANCE_EPSILON = 1e-5;

    const deriveMetadataCategory = (metadataEntry) => {
      if (!metadataEntry || typeof metadataEntry !== 'object') {
        return null;
      }

      const hikingData = metadataEntry.hiking && typeof metadataEntry.hiking === 'object'
        ? metadataEntry.hiking
        : null;

      const sacScale = resolveSacScale(
        metadataEntry.sacScale,
        hikingData?.sacScale,
        metadataEntry.category,
        hikingData?.category,
        metadataEntry.difficulty,
        hikingData?.difficulty
      );

      const category = typeof metadataEntry.category === 'string' && metadataEntry.category
        ? metadataEntry.category
        : (typeof hikingData?.category === 'string' && hikingData.category ? hikingData.category : sacScale);

      if (typeof category === 'string' && category) {
        return normalizeSacScale(category) ?? category;
      }

      return null;
    };

    const findNeighborCategory = (metadataEntry) => {
      if (!metadataEntry) {
        return null;
      }

      const index = metadataDistanceEntries.findIndex((candidate) => candidate?.entry === metadataEntry);
      if (index === -1) {
        return null;
      }

      for (let previous = index - 1; previous >= 0; previous -= 1) {
        const candidate = metadataDistanceEntries[previous]?.entry;
        const category = deriveMetadataCategory(candidate);
        if (category) {
          return category;
        }
      }

      for (let next = index + 1; next < metadataDistanceEntries.length; next += 1) {
        const candidate = metadataDistanceEntries[next]?.entry;
        const category = deriveMetadataCategory(candidate);
        if (category) {
          return category;
        }
      }

      return null;
    };

    const resolveMetadataEntry = (segment, metadataIndex) => {
      if (!segment) {
        return null;
      }

      if (Number.isInteger(metadataIndex)
        && metadataIndex >= 0
        && metadataIndex < coordinateMetadata.length) {
        const direct = coordinateMetadata[metadataIndex];
        if (direct) {
          return direct;
        }
      }

      const segmentStartKm = Number(segment.startDistanceKm);
      const segmentEndKm = Number(segment.endDistanceKm);
      if (Number.isFinite(segmentStartKm) && Number.isFinite(segmentEndKm) && metadataDistanceEntries.length) {
        for (let index = 0; index < metadataDistanceEntries.length; index += 1) {
          const candidate = metadataDistanceEntries[index];
          if (!candidate) {
            continue;
          }
          if (segmentEndKm < candidate.startKm - METADATA_DISTANCE_EPSILON) {
            break;
          }
          if (segmentStartKm > candidate.endKm + METADATA_DISTANCE_EPSILON) {
            continue;
          }
          if (segmentStartKm >= candidate.startKm - METADATA_DISTANCE_EPSILON
            && segmentEndKm <= candidate.endKm + METADATA_DISTANCE_EPSILON) {
            return candidate.entry;
          }
        }
      }

      if (coordinateMetadata.length) {
        for (let index = 0; index < coordinateMetadata.length; index += 1) {
          const entry = coordinateMetadata[index];
          if (!entry) {
            continue;
          }
          const startMatch = this.coordinatesMatch(entry.start, segment.start);
          const endMatch = this.coordinatesMatch(entry.end, segment.end);
          if (startMatch && endMatch) {
            return entry;
          }
        }
      }

      return null;
    };

    this.routeSegments = coords.slice(0, -1).map((coord, index) => {
      const startDistanceKm = cumulative[index] ?? 0;
      const endDistanceKm = cumulative[index + 1] ?? startDistanceKm;
      const distanceKm = Math.max(0, endDistanceKm - startDistanceKm);

      const baseSegment = {
        start: coord,
        end: coords[index + 1],
        index,
        startDistanceKm,
        endDistanceKm,
        distanceKm,
        startElevation: elevations[index],
        endElevation: elevations[index + 1],
        metadata: null
      };

      const metadataEntry = resolveMetadataEntry(baseSegment, index);
      if (metadataEntry && typeof metadataEntry === 'object') {
        const distance = Number(metadataEntry.distanceKm);
        const startKm = Number(metadataEntry.startDistanceKm ?? metadataEntry.cumulativeStartKm);
        const endKm = Number(metadataEntry.endDistanceKm ?? metadataEntry.cumulativeEndKm);
        const ascent = Number(metadataEntry.ascent);
        const descent = Number(metadataEntry.descent);
        const costMultiplier = Number(metadataEntry.costMultiplier);
        const hiking = metadataEntry.hiking && typeof metadataEntry.hiking === 'object'
          ? { ...metadataEntry.hiking }
          : null;
        let sacScaleValue = resolveSacScale(
          metadataEntry.sacScale,
          hiking?.sacScale,
          metadataEntry.category,
          hiking?.category,
          metadataEntry.difficulty,
          hiking?.difficulty
        );
        const surfaceValue = typeof metadataEntry.surface === 'string'
          ? metadataEntry.surface
          : hiking?.surface;
        const trailValue = typeof metadataEntry.trailVisibility === 'string'
          ? metadataEntry.trailVisibility
          : hiking?.trailVisibility;
        const smoothnessValue = typeof metadataEntry.smoothness === 'string'
          ? metadataEntry.smoothness
          : hiking?.smoothness;
        const trackTypeValue = typeof metadataEntry.trackType === 'string'
          ? metadataEntry.trackType
          : hiking?.trackType;

        let categoryValue = typeof metadataEntry.category === 'string'
          ? metadataEntry.category
          : typeof hiking?.category === 'string'
            ? hiking.category
            : sacScaleValue;

        if ((!categoryValue || typeof categoryValue !== 'string')
          && isConnectorMetadataSource(metadataEntry.source)) {
          const neighborCategory = findNeighborCategory(metadataEntry);
          if (neighborCategory) {
            categoryValue = neighborCategory;
            if (!sacScaleValue) {
              sacScaleValue = neighborCategory;
            }
          }
        }

        const segmentMetadata = {
          distanceKm: Number.isFinite(distance) ? distance : distanceKm,
          startDistanceKm: Number.isFinite(startKm) ? startKm : startDistanceKm,
          endDistanceKm: Number.isFinite(endKm) ? endKm : endDistanceKm,
          ascent: Number.isFinite(ascent) ? ascent : 0,
          descent: Number.isFinite(descent) ? descent : 0,
          costMultiplier: Number.isFinite(costMultiplier) && costMultiplier > 0 ? costMultiplier : 1,
          source: metadataEntry.source ?? 'network'
        };
        if (hiking) {
          segmentMetadata.hiking = hiking;
        }
        if (typeof sacScaleValue === 'string' && sacScaleValue) {
          segmentMetadata.sacScale = sacScaleValue;
        }
        if (typeof categoryValue === 'string' && categoryValue) {
          segmentMetadata.category = normalizeSacScale(categoryValue) ?? categoryValue;
        }
        if (typeof surfaceValue === 'string' && surfaceValue) {
          segmentMetadata.surface = surfaceValue;
        }
        if (typeof trailValue === 'string' && trailValue) {
          segmentMetadata.trailVisibility = trailValue;
        }
        if (typeof smoothnessValue === 'string' && smoothnessValue) {
          segmentMetadata.smoothness = smoothnessValue;
        }
        if (typeof trackTypeValue === 'string' && trackTypeValue) {
          segmentMetadata.trackType = trackTypeValue;
        }

        baseSegment.metadata = segmentMetadata;
      }

      return baseSegment;
    });

    this.segmentLegLookup = this.computeSegmentLegLookup(coords);

    const segmentFeatures = this.routeSegments.map((segment) => ({
      type: 'Feature',
      properties: { segmentIndex: segment.index },
      geometry: {
        type: 'LineString',
        coordinates: [segment.start, segment.end]
      }
    }));

    this.map.getSource('route-segments-source')?.setData({
      type: 'FeatureCollection',
      features: segmentFeatures
    });

    this.resetSegmentHover();
    this.updateProfileSegments();
  }

  computeSegmentLegLookup(coords) {
    if (this.waypoints.length < 2) return [];
    const lookup = new Array(coords.length - 1).fill(0);
    let currentLeg = 0;
    let nextWaypointIndex = 1;

    for (let i = 0; i < coords.length - 1; i += 1) {
      lookup[i] = currentLeg;
      const nextWaypoint = this.waypoints[nextWaypointIndex];
      if (nextWaypoint && this.coordinatesMatch(coords[i + 1], nextWaypoint)) {
        currentLeg = Math.min(currentLeg + 1, this.waypoints.length - 2);
        nextWaypointIndex += 1;
      }
    }

    return lookup;
  }

  coordinatesMatch(a, b) {
    if (!a || !b) return false;
    if (Math.abs(a[0] - b[0]) <= COORD_EPSILON && Math.abs(a[1] - b[1]) <= COORD_EPSILON) {
      return true;
    }
    if (!turfApi) return false;
    try {
      const distance = turfApi.distance(turfApi.point(a), turfApi.point(b), { units: 'meters' });
      return Number.isFinite(distance) && distance <= WAYPOINT_MATCH_TOLERANCE_METERS;
    } catch (error) {
      console.warn('Failed to compare waypoint coordinates', error);
      return false;
    }
  }

  computeCoordinateDistanceMeters(source, target) {
    if (!Array.isArray(source) || !Array.isArray(target)) {
      return null;
    }

    if (turfApi) {
      try {
        const distance = turfApi.distance(turfApi.point(source), turfApi.point(target), { units: 'meters' });
        if (Number.isFinite(distance)) {
          return distance;
        }
      } catch (error) {
        console.warn('Failed to compute waypoint snap distance', error);
      }
    }

    const fallback = haversineDistanceMeters(source, target);
    return Number.isFinite(fallback) ? fallback : null;
  }
  applyRoute(route, routeVersion) {
    this.hideRouteHover();
    const previousCuts = this.cloneRouteCuts();
    if (previousCuts.length && this.routeProfile && Array.isArray(this.routeProfile.coordinates)) {
      previousCuts.forEach((entry) => {
        if (!entry || Number.isFinite(entry.lng) && Number.isFinite(entry.lat)) {
          return;
        }
        const coord = this.getCoordinateAtDistance(entry.distanceKm);
        if (Array.isArray(coord) && coord.length >= 2) {
          const [lng, lat] = coord;
          entry.lng = Number.isFinite(lng) ? lng : null;
          entry.lat = Number.isFinite(lat) ? lat : null;
        }
      });
    }
    const coordinates = route?.geometry?.coordinates ?? [];
    this.routeProfile = this.buildRouteProfile(coordinates);
    this.renderElevationSparkline();
    this.setRoutePointsOfInterest([]);
    this.pendingPoiRequest = null;

    // Use densified coordinates from the profile as the source of truth for the route line
    const profileCoords = Array.isArray(this.routeProfile?.coordinates) ? this.routeProfile.coordinates : [];
    const routeCoordinates = profileCoords.map((coord) => (Array.isArray(coord) ? coord.slice() : coord));

    let resolvedRoute = route;
    if (routeCoordinates.length) {
      resolvedRoute = {
        ...route,
        geometry: {
          ...(route.geometry ?? { type: 'LineString' }),
          coordinates: routeCoordinates
        }
      };
    }
    this.routeGeojson = resolvedRoute;

    // Track if we need an elevation refresh when tiles load
    const canQuery = typeof this.canQueryTerrainElevation === 'function' && this.canQueryTerrainElevation();
    const terrainSamples = this.routeProfile?.terrainSampleCount ?? 0;
    const totalPoints = this.routeProfile?.coordinates?.length ?? 1;

    this._elevationRefreshPending = canQuery && terrainSamples < totalPoints * 0.9;

    const coordinateMetadata = Array.isArray(resolvedRoute?.properties?.coordinate_metadata)
      ? resolvedRoute.properties.coordinate_metadata
        .map((entry) => (entry && typeof entry === 'object' ? { ...entry } : null))
        .filter(Boolean)
      : [];
    this.routeCoordinateMetadata = coordinateMetadata;
    this.latestMetrics = this.calculateRouteMetrics(resolvedRoute);
    this.rebuildSegmentData();
    const snapped = this.snapWaypointsToRoute();
    if (snapped) {
      this.rebuildSegmentData();
    }
    this.cacheRouteLegSegments();
    const newTotalDistance = Number(this.routeProfile?.totalDistanceKm) || 0;
    let restoredCuts = [];
    if (previousCuts.length && newTotalDistance > ROUTE_CUT_EPSILON_KM) {
      restoredCuts = previousCuts
        .map((entry) => {
          if (!entry || !Number.isFinite(entry.distanceKm)) {
            return null;
          }

          const hasStoredCoords = Number.isFinite(entry.lng) && Number.isFinite(entry.lat);
          let projectedDistance = null;
          let projectedCoords = hasStoredCoords ? [entry.lng, entry.lat] : null;

          if (hasStoredCoords) {
            try {
              const projection = this.projectOntoRoute(toLngLat([entry.lng, entry.lat]), Number.MAX_SAFE_INTEGER);
              if (projection && Number.isFinite(projection.distanceKm)) {
                projectedDistance = projection.distanceKm;
                if (Array.isArray(projection.projection?.coordinates)) {
                  projectedCoords = projection.projection.coordinates;
                }
              }
            } catch (error) {
              console.warn('Failed to project bivouac onto updated route', error);
            }
          }

          if (!Number.isFinite(projectedDistance)) {
            projectedDistance = entry.distanceKm;
            if (!projectedCoords) {
              projectedCoords = this.getCoordinateAtDistance(projectedDistance);
            }
          }

          if (!Number.isFinite(projectedDistance)) {
            return null;
          }

          const clampedDistance = Math.max(0, Math.min(newTotalDistance, projectedDistance));
          if (clampedDistance <= ROUTE_CUT_EPSILON_KM || newTotalDistance - clampedDistance <= ROUTE_CUT_EPSILON_KM) {
            return null;
          }

          const resolvedCoords = Array.isArray(projectedCoords) && projectedCoords.length >= 2
            ? projectedCoords
            : this.getCoordinateAtDistance(clampedDistance);
          const lng = Number(resolvedCoords?.[0]);
          const lat = Number(resolvedCoords?.[1]);

          return {
            distanceKm: clampedDistance,
            lng: Number.isFinite(lng) ? lng : null,
            lat: Number.isFinite(lat) ? lat : null
          };
        })
        .filter((entry) => entry && Number.isFinite(entry.distanceKm))
        .sort((a, b) => a.distanceKm - b.distanceKm);
    }

    this.resetRouteCuts();
    if (restoredCuts.length) {
      const uniqueCuts = [];
      restoredCuts.forEach((entry) => {
        if (!entry) {
          return;
        }
        const existingIndex = uniqueCuts.findIndex((candidate) => Math.abs(candidate.distanceKm - entry.distanceKm) <= ROUTE_CUT_EPSILON_KM / 2);
        if (existingIndex === -1) {
          uniqueCuts.push(entry);
        } else {
          uniqueCuts[existingIndex] = entry;
        }
      });
      this.setRouteCutDistances(uniqueCuts);
    }

    // Phase 1: Critical path - update route display immediately
    // This shows the route line on the map as fast as possible
    this.updateRouteCutSegments();
    this.updateRouteLineSource();
    this.updateWaypoints();
    this.notifyRouteSegmentsUpdated();

    // Phase 2: Defer secondary UI updates to next frame
    // This allows the browser to render the route line first
    const deferredUpdates = () => {
      // Discard deferred updates if a newer route has been applied
      if (typeof routeVersion === 'number' && this._routeVersion !== routeVersion) return;

      const coordinates = this.routeGeojson?.geometry?.coordinates ?? [];

      // Update elevation chart
      try { this.updateElevationProfile(coordinates); } catch (e) { console.warn('Elevation profile update failed', e); }

      // Update distance markers on map
      try { this.updateDistanceMarkers(this.routeGeojson); } catch (e) { console.warn('Distance markers update failed', e); }

      // Update stats panel
      try {
        this._lastSummaryStatsKey = null;
        if (this.routeGeojson) {
          this.updateStats(this.routeGeojson);
        }
      } catch (e) { console.warn('Stats update failed', e); }

      // Update POI day colors
      try { this.updatePoiDayColors(); } catch (e) { console.warn('POI day colors update failed', e); }

      // Phase 3: Fetch POIs (network request - lowest priority)
      this.refreshRoutePointsOfInterest().catch((error) => {
        console.warn('Failed to refresh route points of interest', error);
      });
      this.refreshRoutePhotos().catch((error) => {
        console.warn('Failed to refresh route photos', error);
      });
    };

    // Use requestIdleCallback if available, otherwise setTimeout
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(deferredUpdates, { timeout: 100 });
    } else {
      setTimeout(deferredUpdates, 0);
    }
  }

  async getRoute() {
    if (this.waypoints.length < 2) return;

    this._routeVersion = (this._routeVersion || 0) + 1;
    const version = this._routeVersion;

    try {
      if (!this.router || typeof this.router.getRoute !== 'function') {
        throw new Error('No routing engine is configured');
      }

      await this.prepareNetwork({ reason: 'route-request' });

      // Discard if a newer route request was issued while we were waiting
      if (this._routeVersion !== version) return;

      const preservedSegments = this.buildPreservedSegments();
      const route = await this.router.getRoute(this.waypoints, {
        mode: this.currentMode,
        preservedSegments
      });

      // Discard if a newer route request was issued while we were computing
      if (this._routeVersion !== version) return;

      if (!route || !route.geometry) {
        throw new Error('No route returned from the offline router');
      }

      this.applyRoute(route, version);
    } catch (error) {
      console.error('Failed to compute route', error);
    }
  }


}

