import {
  EMPTY_COLLECTION,
  COORD_EPSILON,
  WAYPOINT_MATCH_TOLERANCE_METERS,
  MAX_DISTANCE_MARKERS,
  ROUTE_CUT_EPSILON_KM,
  turfApi,
  HIKING_BASE_SPEED_KMPH,
  ASCENT_METERS_PER_HOUR,
  DESCENT_METERS_PER_HOUR
} from '../constants/directions-constants.js';

import {
  escapeHtml,
  isConnectorMetadataSource,
  haversineDistanceMeters,
  bearingBetween
} from '../utils/directions-utils.js';

import {
  updateBivouacMarkerColor,
  ensureDistanceMarkerImage,
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

  normalizeImportedCoordinate(coord) {
    if (!Array.isArray(coord) || coord.length < 2) {
      return null;
    }
    const lng = Number(coord[0]);
    const lat = Number(coord[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return null;
    }
    const normalized = [lng, lat];
    if (coord.length > 2) {
      const elevation = Number(coord[2]);
      if (Number.isFinite(elevation)) {
        normalized.push(elevation);
      }
    }
    return normalized;
  }

  normalizeImportedSequence(coords) {
    if (!Array.isArray(coords)) {
      return [];
    }
    const sequence = [];
    coords.forEach((coord) => {
      const normalized = this.normalizeImportedCoordinate(coord);
      if (!normalized) {
        return;
      }
      if (sequence.length && this.coordinatesMatch(sequence[sequence.length - 1], normalized)) {
        return;
      }
      sequence.push(normalized);
    });
    return sequence;
  }

  mergeImportedCoordinateSegments(segments) {
    if (!Array.isArray(segments)) {
      return [];
    }
    const merged = [];
    segments.forEach((segment) => {
      const sequence = this.normalizeImportedSequence(segment);
      if (!sequence.length) {
        return;
      }
      if (!merged.length) {
        sequence.forEach((coord) => merged.push(coord));
        return;
      }
      const last = merged[merged.length - 1];
      const startIndex = this.coordinatesMatch(last, sequence[0]) ? 1 : 0;
      for (let index = startIndex; index < sequence.length; index += 1) {
        const coord = sequence[index];
        if (merged.length && this.coordinatesMatch(merged[merged.length - 1], coord)) {
          continue;
        }
        merged.push(coord);
      }
    });
    return merged;
  }

  estimateSequenceDistanceKm(coords) {
    if (!Array.isArray(coords) || coords.length < 2) {
      return 0;
    }
    let totalMeters = 0;
    for (let index = 0; index < coords.length - 1; index += 1) {
      const distance = this.computeCoordinateDistanceMeters(coords[index], coords[index + 1]);
      if (Number.isFinite(distance)) {
        totalMeters += distance;
      }
    }
    return totalMeters / 1000;
  }

  deriveWaypointsFromImportedSequence(coords, options = {}) {
    const sequence = this.normalizeImportedSequence(coords);
    if (sequence.length < 2) {
      return sequence;
    }

    const totalDistanceKm = this.estimateSequenceDistanceKm(sequence);
    const maxWaypoints = Number.isInteger(options.maxWaypoints) && options.maxWaypoints >= 2
      ? options.maxWaypoints
      : 60;
    const desiredSpacing = maxWaypoints > 1 && totalDistanceKm > 0
      ? (totalDistanceKm * 1000) / (maxWaypoints - 1)
      : 0;
    const minSpacingMeters = Math.max(120, Math.min(800, desiredSpacing || 250));
    const angleThreshold = Number.isFinite(options.angleThresholdDegrees)
      ? options.angleThresholdDegrees
      : 28;

    const waypoints = [];
    const pushWaypoint = (coord) => {
      if (!Array.isArray(coord) || coord.length < 2) {
        return;
      }
      const waypoint = coord.length > 2
        ? [coord[0], coord[1], coord[2]]
        : [coord[0], coord[1]];
      if (waypoints.length && this.coordinatesMatch(waypoints[waypoints.length - 1], waypoint)) {
        return;
      }
      waypoints.push(waypoint);
    };

    pushWaypoint(sequence[0]);
    let lastIndex = 0;
    let accumulatedDistance = 0;

    for (let index = 1; index < sequence.length - 1; index += 1) {
      const current = sequence[index];
      const previous = sequence[lastIndex];
      const next = sequence[index + 1];
      const segmentDistance = this.computeCoordinateDistanceMeters(previous, current)
        || haversineDistanceMeters(previous, current)
        || 0;
      accumulatedDistance += segmentDistance;

      let include = accumulatedDistance >= minSpacingMeters;

      if (!include && previous && next) {
        const bearingPrev = bearingBetween(previous, current);
        const bearingNext = bearingBetween(current, next);
        if (Number.isFinite(bearingPrev) && Number.isFinite(bearingNext)) {
          let delta = Math.abs(bearingNext - bearingPrev);
          if (delta > 180) {
            delta = 360 - delta;
          }
          if (delta >= angleThreshold) {
            include = true;
          }
        }
      }

      if (!include && previous && next) {
        const nextDistance = this.computeCoordinateDistanceMeters(current, next)
          || haversineDistanceMeters(current, next)
          || 0;
        if (nextDistance >= minSpacingMeters * 1.5) {
          include = true;
        }
      }

      if (include) {
        pushWaypoint(current);
        lastIndex = index;
        accumulatedDistance = 0;
      }
    }

    pushWaypoint(sequence[sequence.length - 1]);

    if (waypoints.length > maxWaypoints) {
      const step = (waypoints.length - 1) / (maxWaypoints - 1);
      const reduced = [];
      for (let i = 0; i < maxWaypoints; i += 1) {
        const targetIndex = Math.min(waypoints.length - 1, Math.round(i * step));
        const coord = waypoints[targetIndex];
        if (!reduced.length || !this.coordinatesMatch(reduced[reduced.length - 1], coord)) {
          reduced.push(coord.slice());
        }
      }
      if (!this.coordinatesMatch(reduced[reduced.length - 1], waypoints[waypoints.length - 1])) {
        reduced.push(waypoints[waypoints.length - 1].slice());
      }
      return reduced;
    }

    return waypoints;
  }

  extractRouteFromGeojson(geojson) {
    if (!geojson) {
      return null;
    }

    // New logic: First attempt to detect a partitioned route (multiple segments)
    // that should be joined together.
    const segments = [];
    const points = [];

    const collectFeatures = (geometry, properties = {}) => {
      if (!geometry) return;
      if (geometry.type === 'LineString') {
        segments.push({
          coordinates: geometry.coordinates,
          properties,
          segmentIndex: properties.segmentIndex ?? -1
        });
      } else if (geometry.type === 'MultiLineString') {
        // Treat MultiLineString as a single coherent segment if possible, 
        // or split if needed. For now, pushing as one segment usually works 
        // for basic GPX, but if we exported segments, they are usually separate features.
        // We'll flatten it.
        this.mergeImportedCoordinateSegments(geometry.coordinates).forEach(chain => {
          segments.push({
            coordinates: chain,
            properties,
            segmentIndex: properties.segmentIndex ?? -1
          });
        });
      } else if (geometry.type === 'Point') {
        points.push({
          coordinates: geometry.coordinates,
          properties
        });
      } else if (geometry.type === 'GeometryCollection' && Array.isArray(geometry.geometries)) {
        geometry.geometries.forEach(g => collectFeatures(g, properties));
      }
    };

    if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
      geojson.features.forEach(f => collectFeatures(f.geometry, f.properties || {}));
    } else if (geojson.type === 'Feature') {
      collectFeatures(geojson.geometry, geojson.properties || {});
    } else {
      collectFeatures(geojson, {});
    }

    if (segments.length === 0) return null;

    // Check if we have multiple segments that look like a split route
    // If we have explicit segmentIndices, use them.
    const hasIndices = segments.some(s => s.segmentIndex !== -1);

    let mergedCoordinates = [];
    let primaryProperties = {};

    if (hasIndices) {
      // Sort by index
      segments.sort((a, b) => {
        const idxA = a.segmentIndex !== -1 ? a.segmentIndex : 9999;
        const idxB = b.segmentIndex !== -1 ? b.segmentIndex : 9999;
        return idxA - idxB;
      });

      let segmentModes = [];
      let coordinateMetadata = [];
      let segmentColors = [];
      let totalMergedDist = 0;

      const autoCuts = [];
      segments.forEach((seg, i) => {
        const segmentDist = this.estimateSequenceDistanceKm(seg.coordinates);

        if (i > 0) {
          const prevSeg = segments[i - 1];
          const prevLast = prevSeg.coordinates[prevSeg.coordinates.length - 1];
          const currFirst = seg.coordinates[0];
          if (prevLast && currFirst && this.computeDistanceKm(prevLast, currFirst) < 0.1) {
            autoCuts.push({
              distanceKm: totalMergedDist,
              lng: prevLast[0],
              lat: prevLast[1]
            });
          }
        }

        this.appendCoordinates(mergedCoordinates, seg.coordinates);
        totalMergedDist += segmentDist;

        if (Array.isArray(seg.properties?.segment_modes)) {
          segmentModes = [...segmentModes, ...seg.properties.segment_modes];
        }
        if (Array.isArray(seg.properties?.coordinate_metadata)) {
          coordinateMetadata = [...coordinateMetadata, ...seg.properties.coordinate_metadata];
        }
        segmentColors.push(seg.properties?.color || null);
      });

      // Inject automatic bivouacs if no explicit ones were found at those locations
      autoCuts.forEach((cut, i) => {
        const isDuplicate = points.some(p => p.properties?.marker_type === 'bivouac' && this.computeDistanceKm(p.coordinates, [cut.lng, cut.lat]) < 0.05);
        if (!isDuplicate) {
          points.push({
            coordinates: [cut.lng, cut.lat],
            properties: { marker_type: 'bivouac', source: 'auto-split', segmentIndex: i + 1 }
          });
        }
      });

      primaryProperties = {
        ...segments[0].properties,
        segment_modes: segmentModes,
        coordinate_metadata: coordinateMetadata,
        segment_colors: segmentColors
      };

    } else if (segments.length > 1) {
      // No indices, but multiple segments. 
      // Heuristic: if they are geographically continuous, merge them.
      // Otherwise, fallback to "Best Candidate" approach (existing behavior) 
      // OR just merge everything in order (dangerous if random order).

      // For now, let's look for the single longest continuous chain we can build, 
      // or just default to the longest individual segment if they are disjoint.

      // Simple approach for XploreMap exported routes (which usually have segmentIndex anyway):
      // If no indices, we default to the legacy logic of picking the "best" one,
      // UNLESS they form a chain.
      // But for "Direct Save" routes, we KNOW we write segmentIndex.
      // So legacy GPX files are the main concern here.

      // Let's use the legacy logic for "best candidate" if no explicit structure is found,
      // to avoid breaking random GPX imports that contain noise.

      const candidates = segments.map(s => {
        const seq = this.normalizeImportedSequence(s.coordinates);
        return {
          coordinates: seq,
          properties: s.properties,
          distanceKm: this.estimateSequenceDistanceKm(seq),
          priority: s.properties.source === 'track' ? 3 : (s.properties.source === 'route' ? 2 : 1)
        };
      });

      candidates.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        if (b.distanceKm !== a.distanceKm) return b.distanceKm - a.distanceKm;
        return b.coordinates.length - a.coordinates.length;
      });

      // However, if the user explicitly Selected multiple files in the Library, 
      // they are treated as separate routes. Here we are inside ONE geojson.
      // If a single GPX contains multiple tracks, they typically want them all.
      // But `importRouteFromGeojson` is designed to load A SINGLE route context.
      // So we MUST merge them or pick one.
      // Heuristic: if they are geographically continuous, merge them.
      // And if they were separate tracks, they might represent days!
      mergedCoordinates = candidates[0].coordinates.slice();
      let totalMergedDist = candidates[0].distanceKm;
      const autoCuts = [];

      let segmentModes = candidates[0].properties.segment_modes || [];
      let coordinateMetadata = candidates[0].properties.coordinate_metadata || [];
      let segmentColors = [candidates[0].properties.color || null];

      for (let i = 1; i < candidates.length; i++) {
        const prev = mergedCoordinates[mergedCoordinates.length - 1];
        const curr = candidates[i].coordinates;
        if (!prev || !curr.length) continue;

        const distToPrev = this.computeDistanceKm(prev, curr[0]);
        if (distToPrev < 0.1) { // within 100m
          autoCuts.push({
            distanceKm: totalMergedDist,
            lng: prev[0],
            lat: prev[1]
          });
          this.appendCoordinates(mergedCoordinates, curr);
          totalMergedDist += candidates[i].distanceKm;

          // Concatenate metadata/modes if matching the segment structure
          if (Array.isArray(candidates[i].properties.segment_modes)) {
            segmentModes = [...segmentModes, ...candidates[i].properties.segment_modes];
          }
          if (Array.isArray(candidates[i].properties.coordinate_metadata)) {
            coordinateMetadata = [...coordinateMetadata, ...candidates[i].properties.coordinate_metadata];
          }
          segmentColors.push(candidates[i].properties.color || null);
        } else {
          // Not continuous, we stop merging
          break;
        }
      }

      primaryProperties = {
        ...candidates[0].properties,
        segment_modes: segmentModes,
        coordinate_metadata: coordinateMetadata,
        segment_colors: segmentColors
      };

      // If we detected automatic cuts (from separate tracks) and no explicit bivouacs were found,
      // we add them to the points array so importRouteFromGeojson can restore segments.
      // Filter out duplicates if they are extremely close.
      autoCuts.forEach((cut, i) => {
        const isDuplicate = points.some(p => p.properties?.marker_type === 'bivouac' && this.computeDistanceKm(p.geometry.coordinates, [cut.lng, cut.lat]) < 0.05);
        if (!isDuplicate) {
          points.push({
            geometry: { type: 'Point', coordinates: [cut.lng, cut.lat] },
            properties: { marker_type: 'bivouac', source: 'auto-split', segmentIndex: i + 1 }
          });
        }
      });
    } else {
      // Single segment
      mergedCoordinates = this.normalizeImportedSequence(segments[0].coordinates);
      primaryProperties = segments[0].properties;
    }

    return {
      coordinates: mergedCoordinates,
      properties: primaryProperties,
      distanceKm: this.estimateSequenceDistanceKm(mergedCoordinates),
      points: points // extract potential checkpoints/bivouacs
    };
  }

  appendCoordinates(target, source) {
    if (!source || source.length === 0) return;
    if (target.length === 0) {
      source.forEach(c => target.push(c));
      return;
    }

    const last = target[target.length - 1];
    const first = source[0];

    // If identically same coordinates (floating point tol), skip first
    // Using a slightly wider tolerance (1e-5 ~ 1 meter) to handle GPX rounding/jitter at junctions
    const isSame = Math.abs(last[0] - first[0]) < 1e-5 && Math.abs(last[1] - first[1]) < 1e-5;

    for (let i = (isSame ? 1 : 0); i < source.length; i++) {
      target.push(source[i]);
    }
  }

  importRouteFromGeojson(geojson, options = {}) {
    const candidate = this.extractRouteFromGeojson(geojson);
    if (!candidate || !Array.isArray(candidate.coordinates) || candidate.coordinates.length < 2) {
      console.warn('No route geometry found in imported data');
      return false;
    }

    this.currentRouteId = options.id || null;

    let waypoints = [];
    const explicitWaypoints = (candidate.points || [])
      .filter(p => p.properties?.source === 'waypoint')
      .map(p => p.coordinates);

    if (explicitWaypoints.length >= 2) {
      waypoints = explicitWaypoints;
    } else {
      waypoints = this.deriveWaypointsFromImportedSequence(candidate.coordinates, options);
    }
    if (!Array.isArray(waypoints) || waypoints.length < 2) {
      console.warn('Imported route did not contain enough distinct coordinates');
      return false;
    }

    this.clearDirections();
    this.ensurePanelVisible();
    this.waypoints = waypoints.map((coord) => coord.slice());

    // 1. Prepare Bivouacs/Cuts BEFORE applying the route
    // This allows applyRoute to preserve and project them onto the new geometry correctly
    if (candidate.points && candidate.points.length > 0) {
      const bivouacs = candidate.points.filter(p => p.properties && p.properties.marker_type === 'bivouac');
      if (bivouacs.length > 0) {
        const cuts = [];
        const line = turfApi.lineString(candidate.coordinates);

        bivouacs.forEach(b => {
          const pt = turfApi.point(b.coordinates);
          const snapped = turfApi.nearestPointOnLine(line, pt, { units: 'kilometers' });
          let distKm = snapped?.properties?.location;

          // Robust fallback if turf snapping doesn't provide a location
          if (!Number.isFinite(distKm)) {
            const idx = candidate.coordinates.findIndex(c => this.coordinatesMatch(c, b.coordinates));
            if (idx !== -1) {
              distKm = this.estimateSequenceDistanceKm(candidate.coordinates.slice(0, idx + 1));
            }
          }

          if (Number.isFinite(distKm)) {
            cuts.push({
              distanceKm: distKm,
              lng: b.coordinates[0],
              lat: b.coordinates[1],
              source: 'imported-bivouac'
            });
          }
        });

        if (cuts.length > 0) {
          this.setRouteCutDistances(cuts);
        }
      }
    }

    const routeFeature = {
      type: 'Feature',
      properties: {
        ...(candidate.properties || {}),
        source: candidate.properties?.source || 'imported-route',
        name: candidate.properties?.name || options.name || null
      },
      geometry: {
        type: 'LineString',
        coordinates: candidate.coordinates.map((coord) => coord.slice())
      }
    };

    // 2. Apply the route - this now sees the restored cuts and projects them
    this.applyRoute(routeFeature);

    // updateWaypoints triggers updateSegmentMarkers
    this.updateWaypoints();
    this.updateModeAvailability();

    this.prepareNetwork({ reason: 'imported-route' }).catch(() => { });
    return true;
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

