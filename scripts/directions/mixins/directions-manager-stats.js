import {
  EMPTY_COLLECTION,
  MODE_COLORS,
  HOVER_PIXEL_TOLERANCE,
  COORD_EPSILON,
  WAYPOINT_MATCH_TOLERANCE_METERS,
  MAX_ELEVATION_POINTS,
  MAX_DISTANCE_MARKERS,
  WAYPOINT_HISTORY_LIMIT,
  ELEVATION_TICK_TARGET,
  DISTANCE_TICK_TARGET,
  ROUTE_CUT_EPSILON_KM,
  ROUTE_CLICK_PIXEL_TOLERANCE,
  ROUTE_GRADIENT_BLEND_DISTANCE_KM,
  OVERLAP_DETECTION_TOLERANCE_METERS,
  OVERLAP_LINE_OFFSET_PX,
  turfApi,
  POI_SEARCH_RADIUS_METERS,
  POI_CATEGORY_DISTANCE_OVERRIDES,
  POI_MAX_SEARCH_RADIUS_METERS,
  DEFAULT_POI_COLOR,
  POI_FLOATING_STACK_SPACING_PX,
  POI_INTERNAL_STACK_SPACING_PX,
  POI_CATEGORY_PRIORITY,
  POI_CATEGORY_DEFAULT_PRIORITY,
  WATER_CATEGORY_KEYS,
  WATER_CATEGORY_SET,
  WATER_HOST_CATEGORIES,
  WATER_HOST_CATEGORY_SET,
  WATER_MERGE_PROXIMITY_KM,
  ELEVATION_MARKER_LABEL_VERTICAL_GAP_PX,
  ELEVATION_MARKER_LABEL_HORIZONTAL_PADDING_PX,
  ELEVATION_MARKER_LABEL_TOP_PADDING_PX,
  DEFAULT_POI_TITLE,
  POI_NAME_PROPERTIES,
  POI_ADDITIONAL_PROPERTY_TAGS,
  POI_FALLBACK_MAX_BOUND_SPAN_DEGREES,
  POI_FALLBACK_TIMEOUT_SECONDS,
  POI_FALLBACK_ENDPOINT,
  POI_ICON_TARGET_DISPLAY_SIZE_PX,
  PEAK_PRINCIPAL_ICON_THRESHOLD,
  ROUTE_POI_ICON_LAYER_ID,
  POI_ICON_DEFINITIONS,
  PARKING_CATEGORY_KEYS,
  PARKING_CATEGORY_SET,
  PARKING_CLUSTER_MIN_SPACING_KM,
  ELEVATION_PROFILE_POI_CATEGORY_KEYS,
  ELEVATION_PROFILE_POI_CATEGORY_SET,
  ROUTE_POI_SOURCE_ID,
  ROUTE_POI_LAYER_ID,
  ROUTE_POI_LABEL_LAYER_ID,
  POI_CLUSTER_MIN_SPACING_KM,
  POI_CLUSTER_MAX_SPACING_KM,
  POI_CLUSTER_DISTANCE_SCALE,
  HIKING_BASE_SPEED_KMPH,
  ASCENT_METERS_PER_HOUR,
  DESCENT_METERS_PER_HOUR,
  ELEVATION_PROFILE_POI_CLUSTER_MIN_WINDOW_KM,
  ELEVATION_PROFILE_POI_CLUSTER_MAX_WINDOW_KM,
  ELEVATION_PROFILE_POI_CLUSTER_DISTANCE_SCALE
} from '../constants/directions-constants.js';

import {
  fetchMeteoFrance,
  getWeatherForDay,
  getCurrentHourWeather,
  renderWeatherWidget,
  resolveRoutePoiIconKey,
  computePoiIconDisplayMetrics,
  isElevationProfilePoiCategory,
  normalizePoiValue,
  parseNumericValue,
  parsePoiElevation,
  computePeakImportanceScore,
  computePoiClusterSpacing,
  selectClusterRepresentative,
  clusterRoutePointsOfInterest,
  computeElevationProfilePoiClusterWindow,
  selectElevationProfileLabelLeader,
  markElevationProfileLabelLeaders,
  shouldShowPoiLabel,
  resolvePoiName,
  adjustHexColor,
  escapeHtml,
  isConnectorMetadataSource,
  computeRouteOverlapOffsets,
  geometricOffsetCoordinates,
  haversineDistanceMeters,
  fetchOverpassRoutePois,
  resolvePoiDefinition,
  buildPoiIdentifier,
  bearingBetween
} from '../utils/directions-utils.js';

import {
  ASCENT_ICON,
  DESCENT_ICON,
  DISTANCE_ICON,
  ELEVATION_ICON,
  SLOPE_ICON,
  TIME_ICON,
  ROUTE_ICON,
  SUMMARY_ICONS,
  BIVOUAC_ELEVATION_ICON,
  DISTANCE_MARKER_PREFIX,
  DEFAULT_DISTANCE_MARKER_COLOR,
  SEGMENT_MARKER_SOURCE_ID,
  SEGMENT_MARKER_LAYER_ID,
  SEGMENT_MARKER_COLORS,
  START_MARKER_ICON_ID,
  BIVOUAC_MARKER_ICON_ID,
  END_MARKER_ICON_ID,
  SEGMENT_MARKER_ICONS,
  SEGMENT_COLOR_PALETTE
} from '../constants/directions-visual-constants.js';

import {
  createMarkerCanvas,
  finalizeMarkerImage,
  createFlagMarkerImage,
  createTentMarkerImage,
  ensureSegmentMarkerImages,
  updateBivouacMarkerColor,
  getOrCreateBivouacIcon,
  createDistanceMarkerImage,
  buildDistanceMarkerId,
  ensureDistanceMarkerImage,
  createWaypointFeature,
  toLngLat
} from '../markers/directions-markers.js';

import {
  SAC_SCALE_RANK,
  TRAIL_VISIBILITY_RANK,
  SURFACE_SEVERITY_RANK,
  TRAIL_VISIBILITY_VALUES,
  SLOPE_CLASSIFICATIONS,
  SURFACE_CLASSIFICATIONS,
  SURFACE_LABELS,
  UNKNOWN_CATEGORY_CLASSIFICATION,
  CATEGORY_CLASSIFICATIONS,
  SAC_SCALE_LABELS,
  PROFILE_MODE_DEFINITIONS,
  PROFILE_GRADIENT_MODES,
  PROFILE_LEGEND_SHOW_DELAY_MS,
  SLOPE_GRADIENT_LABELS,
  PROFILE_MODE_LEGENDS,
  DEFAULT_PROFILE_MODE,
  MIN_PROFILE_SEGMENT_DISTANCE_KM,
  MULTIPLIER_TOLERANCE,
  GRADE_TOLERANCE,
  HEX_COLOR_PATTERN
} from '../constants/directions-profile-constants.js';

import {
  normalizeTagString,
  normalizeSacScale,
  resolveSacScale,
  normalizeTrailVisibility,
  normalizeSurfaceType,
  normalizeCoordinatePair,
  formatTagLabel,
  formatSacScaleLabel,
  formatSurfaceLabel,
  formatTrailVisibilityLabel,
  isProfileGradientMode,
  cloneClassificationEntry,
  isUnknownCategoryClassification
} from '../utils/directions-profile-utils.js';

import {
  ensurePoiIconImages,
  getPoiIconImageId,
  getPoiIconImageIdForDay,
  getPoiIconMetadata,
  getPoiIconSvgContent
} from '../../poi/poi-icon-catalog.js';

import {
  OVERPASS_ENDPOINT,
  OVERPASS_ENDPOINT as OVERPASS_INTERPRETER_ENDPOINT
} from '../../routing/overpass-network-fetcher.js';

import {
  fetchWikimediaPhotosInBounds,
  isWikimediaPhotosVisible,
  getPhotoThumbnailUrl,
  showElevationChartPhotoPopup
} from '../../map/wikimedia-photos.js';


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

      // Merge
      segments.forEach(seg => {
        // TODO: Smart merge to avoid duplicate points at junctions
        this.appendCoordinates(mergedCoordinates, seg.coordinates);
      });
      primaryProperties = segments[0].properties;

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
        } else {
          // Not continuous, we stop merging
          break;
        }
      }

      primaryProperties = candidates[0].properties;

      // If we detected automatic cuts (from separate tracks) and no explicit bivouacs were found,
      // we add them to the points array so importRouteFromGeojson can restore segments.
      if (autoCuts.length > 0 && !points.some(p => p.properties?.marker_type === 'bivouac')) {
        autoCuts.forEach(cut => {
          points.push({
            geometry: { type: 'Point', coordinates: [cut.lng, cut.lat] },
            properties: { marker_type: 'bivouac', source: 'auto-split' }
          });
        });
      }
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
    const isSame = Math.abs(last[0] - first[0]) < 1e-6 && Math.abs(last[1] - first[1]) < 1e-6;

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

    const waypoints = this.deriveWaypointsFromImportedSequence(candidate.coordinates, options);
    if (!Array.isArray(waypoints) || waypoints.length < 2) {
      console.warn('Imported route did not contain enough distinct coordinates');
      return false;
    }

    this.clearDirections();
    this.ensurePanelVisible();
    this.waypoints = waypoints.map((coord) => coord.slice());

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

    this.applyRoute(routeFeature);
    this.updateWaypoints();
    this.updateModeAvailability();

    // Explicitly update Elevation Profile and Stats immediately 
    // to ensure UI is populated even if prepareNetwork is delayed/skipped
    if (candidate.coordinates && candidate.coordinates.length > 0) {
      this.updateElevationProfile(candidate.coordinates);
      this.updateStats(routeFeature);
    }

    // Restore Bivouacs (Segments) if available
    if (candidate.points && candidate.points.length > 0) {
      const bivouacs = candidate.points.filter(p => p.properties && p.properties.marker_type === 'bivouac');
      if (bivouacs.length > 0) {
        const cuts = [];
        // We need to map these points to distances on the new route
        const line = turfApi.lineString(candidate.coordinates);

        bivouacs.forEach(b => {
          const pt = turfApi.point(b.coordinates);
          const snapped = turfApi.nearestPointOnLine(line, pt);
          if (snapped && snapped.properties && snapped.properties.location) {
            // location is in km for turf
            cuts.push({
              distanceKm: snapped.properties.location,
              lng: b.coordinates[0],
              lat: b.coordinates[1]
            });
          }
        });

        if (cuts.length > 0) {
          this.setRouteCutDistances(cuts);
          // Force update of cuts
          setTimeout(() => this.updateCutDisplays(), 100);
        }
      }
    }

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

    let previousElevation = null;
    coords.forEach((coord) => {
      const elevation = coord?.[2];
      if (!Number.isFinite(elevation)) return;
      if (previousElevation === null) {
        previousElevation = elevation;
        return;
      }
      const delta = elevation - previousElevation;
      if (delta > 0) {
        metrics.ascent += delta;
      } else if (delta < 0) {
        metrics.descent += Math.abs(delta);
      }
      previousElevation = elevation;
    });

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

  /**
   * Fetch and display weather data for the current route
   */
  async updateWeatherDisplay() {
    if (!this.routeStats) return;

    const weatherContainers = this.routeStats.querySelectorAll('.weather-container');
    if (!weatherContainers.length) return;

    // Get coordinates based on current view (selected day or full route)
    let targetCoordinates = null;
    // Day offset for forecast: Jour 1 = today (0), Jour 2 = tomorrow (1), etc.
    let dayOffset = this.selectedDayIndex !== null && this.selectedDayIndex !== undefined
      ? this.selectedDayIndex
      : 0;

    if (this.selectedDayIndex !== null && this.selectedDayIndex !== undefined) {
      // Get midpoint of selected day segment
      const segment = this.cutSegments?.[this.selectedDayIndex];
      if (segment) {
        const startKm = Number(segment.startKm ?? segment.startDistanceKm ?? 0);
        const endKm = Number(segment.endKm ?? segment.endDistanceKm ?? startKm);
        const midKm = (startKm + endKm) / 2;
        targetCoordinates = this.getCoordinateAtDistance(midKm);
      }
    }

    // Fallback to route midpoint
    if (!targetCoordinates) {
      const coords = this.routeGeojson?.geometry?.coordinates;
      if (Array.isArray(coords) && coords.length >= 2) {
        const midIndex = Math.floor(coords.length / 2);
        targetCoordinates = coords[midIndex];
      }
    }

    if (!targetCoordinates || !Array.isArray(targetCoordinates) || targetCoordinates.length < 2) {
      weatherContainers.forEach((container) => {
        container.innerHTML = '<span class="weather-unavailable">Coordonnées non disponibles</span>';
      });
      return;
    }

    const [lon, lat] = targetCoordinates;

    try {
      const weatherData = await fetchMeteoFrance(lon, lat);
      // Use day-specific forecast based on selected day
      const weather = getWeatherForDay(weatherData, dayOffset);

      if (weather) {
        const weatherHtml = renderWeatherWidget(weather);
        weatherContainers.forEach((container) => {
          container.innerHTML = weatherHtml;
        });
      } else {
        weatherContainers.forEach((container) => {
          container.innerHTML = '<span class="weather-unavailable">Données non disponibles</span>';
        });
      }
    } catch (error) {
      console.warn('Weather update failed:', error);
      weatherContainers.forEach((container) => {
        container.innerHTML = '<span class="weather-unavailable">Erreur de chargement</span>';
      });
    }
  }

  /**
   * Fetch and display weather for a specific bivouac popup
   * @param {number} lon - Longitude
   * @param {number} lat - Latitude  
   * @param {number} dayNumber - Day number (1 = today, 2 = tomorrow, etc.)
   */
  async updateBivouacWeather(lon, lat, dayNumber) {
    // Find the weather container in the popup
    const popupEl = this.bivouacPopup?.getElement?.();
    if (!popupEl) return;

    const weatherContainer = popupEl.querySelector('.weather-container');
    if (!weatherContainer) return;

    // Day offset: day 1 = today (offset 0), day 2 = tomorrow (offset 1)
    const dayOffset = dayNumber - 1;

    try {
      const weatherData = await fetchMeteoFrance(lon, lat);
      const weather = getWeatherForDay(weatherData, dayOffset);

      if (weather) {
        weatherContainer.innerHTML = renderWeatherWidget(weather);
      } else {
        weatherContainer.innerHTML = '<span class="weather-unavailable">Non disponible</span>';
      }
    } catch (error) {
      console.warn('Bivouac weather update failed:', error);
      weatherContainer.innerHTML = '<span class="weather-unavailable">Erreur</span>';
    }
  }

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

    finalTicks.forEach((tick) => {
      const ratio = (tick - xAxis.min) / span;
      const percent = Math.max(0, Math.min(100, ratio * 100));
      const label = document.createElement('span');
      // Show "km" on all ticks, use 0.5 discretization
      label.textContent = `${this.formatAxisDistance(tick)} km`;
      label.style.left = `${percent}% `;
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

  async refreshRoutePointsOfInterest() {
    const poiRefreshStart = performance.now();
    const profile = this.routeProfile;
    const coordinates = Array.isArray(profile?.coordinates) ? profile.coordinates : [];
    if (!this.map || coordinates.length < 2 || !turfApi || typeof turfApi.lineString !== 'function'
      || typeof turfApi.nearestPointOnLine !== 'function') {
      this.setRoutePointsOfInterest([]);
      return;
    }

    if (this.pendingPoiAbortController && typeof this.pendingPoiAbortController.abort === 'function') {
      try {
        this.pendingPoiAbortController.abort();
      } catch (error) {
        console.warn('Failed to abort pending POI fallback request', error);
      }
    }
    this.pendingPoiAbortController = null;

    const requestToken = Symbol('poi-request');
    this.pendingPoiRequest = requestToken;
    const line = turfApi.lineString(coordinates.map((coord) => [coord[0], coord[1]]));
    const totalDistanceKm = Number(profile?.totalDistanceKm);


    const sourceCollection = this.offlinePoiCollection;
    let sourceFeatures = Array.isArray(sourceCollection?.features) ? sourceCollection.features : [];
    const shouldRetry = false;
    const poiTimings = { overpassFetch: 0 };

    if ((!Array.isArray(sourceFeatures) || !sourceFeatures.length) && !shouldRetry) {
      let abortController = null;
      if (typeof AbortController === 'function') {
        abortController = new AbortController();
        this.pendingPoiAbortController = abortController;
      }
      try {
        const overpassStart = performance.now();
        const fallbackFeatures = await fetchOverpassRoutePois(line, {
          bufferMeters: POI_MAX_SEARCH_RADIUS_METERS,
          signal: abortController?.signal
        });
        poiTimings.overpassFetch = performance.now() - overpassStart;
        if (this.pendingPoiRequest !== requestToken) {
          return;
        }
        sourceFeatures = fallbackFeatures;
        console.log('%c[POI Overpass Fetch]', 'color: #FF9800; font-weight: bold', {
          'fetchTime': `${poiTimings.overpassFetch.toFixed(1)} ms`,
          'featuresFound': fallbackFeatures?.length || 0
        });
      } catch (error) {
        if (!(abortController?.signal?.aborted)) {
          console.warn('Failed to fetch POIs from Overpass fallback', error);
        }
      } finally {
        if (this.pendingPoiAbortController === abortController) {
          this.pendingPoiAbortController = null;
        }
      }
    }

    if (!Array.isArray(sourceFeatures) || !sourceFeatures.length) {
      this.setRoutePointsOfInterest([]);
      if (Array.isArray(this.routeGeojson?.geometry?.coordinates)
        && this.routeGeojson.geometry.coordinates.length >= 2) {
        this.updateElevationProfile(this.routeGeojson.geometry.coordinates);
      }
      this.pendingPoiRequest = null;
      return;
    }

    const seen = new Set();
    const collected = [];



    // OPTIMIZATION: Compute route bounding box to pre-filter POIs
    // This avoids expensive nearestPointOnLine for POIs far from the route
    const BBOX_BUFFER_DEG = 0.02; // ~2km buffer in degrees (rough approximation)
    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;
    coordinates.forEach(coord => {
      if (Array.isArray(coord) && coord.length >= 2) {
        const [lng, lat] = coord;
        if (Number.isFinite(lng) && Number.isFinite(lat)) {
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
        }
      }
    });
    // Expand bbox by buffer
    minLng -= BBOX_BUFFER_DEG;
    maxLng += BBOX_BUFFER_DEG;
    minLat -= BBOX_BUFFER_DEG;
    maxLat += BBOX_BUFFER_DEG;

    let skippedByBbox = 0;

    sourceFeatures.forEach((feature) => {
      if (!feature || typeof feature !== 'object') {
        return;
      }
      const geometry = feature.geometry;
      if (!geometry || !Array.isArray(geometry.coordinates)) {
        return;
      }

      // Extract coordinates based on geometry type
      let lng, lat;
      if (geometry.type === 'Point') {
        [lng, lat] = geometry.coordinates;
      } else if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates[0])) {
        // Calculate centroid of first ring (outer boundary)
        const ring = geometry.coordinates[0];
        if (ring.length < 3) return;
        let sumLng = 0, sumLat = 0;
        ring.forEach(coord => {
          if (Array.isArray(coord) && coord.length >= 2) {
            sumLng += coord[0];
            sumLat += coord[1];
          }
        });
        lng = sumLng / ring.length;
        lat = sumLat / ring.length;
      } else {
        // Unsupported geometry type
        return;
      }

      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return;
      }

      // OPTIMIZATION: Skip POIs outside route bounding box (fast O(1) check)
      if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) {
        skippedByBbox++;
        return;
      }

      const definition = resolvePoiDefinition(feature.properties || {});
      if (!definition) {
        return;
      }
      let nearest = null;
      try {
        nearest = turfApi.nearestPointOnLine(line, turfApi.point([lng, lat]), { units: 'kilometers' });
      } catch (error) {
        return;
      }
      const distanceKm = Number(nearest?.properties?.location);
      const distanceToLineKm = Number(nearest?.properties?.dist ?? nearest?.properties?.distance);
      if (!Number.isFinite(distanceKm) || !Number.isFinite(distanceToLineKm)) {
        return;
      }
      const categoryKey = typeof definition?.key === 'string' ? definition.key : '';
      const maxDistanceMeters = Number.isFinite(POI_CATEGORY_DISTANCE_OVERRIDES[categoryKey])
        ? Math.max(0, POI_CATEGORY_DISTANCE_OVERRIDES[categoryKey])
        : POI_SEARCH_RADIUS_METERS;
      const distanceMeters = distanceToLineKm * 1000;
      if (!Number.isFinite(distanceMeters) || distanceMeters > maxDistanceMeters) {
        return;
      }
      const rawId = feature?.properties?.id
        ?? feature?.properties?.osm_id
        ?? feature?.properties?.['@id']
        ?? feature?.id
        ?? feature?.properties?.ref;
      const identifier = buildPoiIdentifier(definition.key, [lng, lat], rawId);
      if (seen.has(identifier)) {
        return;
      }
      seen.add(identifier);

      const name = resolvePoiName(feature.properties || {});
      if (!name && definition.key === 'peak') {
        return;
      }
      const categoryLabel = definition.definition.label ?? DEFAULT_POI_TITLE;
      const tooltip = name
        ? (categoryLabel && categoryLabel !== name ? `${name} · ${categoryLabel} ` : name)
        : categoryLabel || DEFAULT_POI_TITLE;
      const clampedDistanceKm = Number.isFinite(totalDistanceKm)
        ? Math.max(0, Math.min(totalDistanceKm, distanceKm))
        : Math.max(0, distanceKm);

      const coordsArray = Array.isArray(feature.geometry?.coordinates)
        ? feature.geometry.coordinates
        : [];
      const coordinateElevation = coordsArray.length >= 3 ? Number(coordsArray[2]) : null;
      let elevation = parsePoiElevation(feature.properties || {});
      if (!Number.isFinite(elevation) && Number.isFinite(coordinateElevation)) {
        elevation = coordinateElevation;
      }
      const peakImportance = computePeakImportanceScore(feature.properties || {}, elevation);
      const peakImportanceScore = Number.isFinite(peakImportance?.score) ? peakImportance.score : 0;

      const baseIconKey = definition.definition.icon ?? definition.key;
      const iconKey = resolveRoutePoiIconKey(definition.key, baseIconKey, peakImportanceScore);
      const iconImageId = getPoiIconImageId(iconKey);

      collected.push({
        id: identifier,
        name,
        title: tooltip,
        categoryLabel,
        categoryKey: definition.key,
        iconKey,
        iconImageId,
        color: definition.definition.color ?? DEFAULT_POI_COLOR,
        distanceKm: clampedDistanceKm,
        coordinates: [lng, lat],
        elevation,
        peakImportanceScore
      });
    });



    collected.sort((a, b) => a.distanceKm - b.distanceKm);

    const clustered = clusterRoutePointsOfInterest(collected, totalDistanceKm);

    // Merge water sources with nearby host POIs (cabins, parking, etc.)
    const mergedPois = (() => {
      if (!clustered.length) return [];

      // Separate water sources from others
      const waterSources = [];
      const potentialHosts = [];
      const others = [];

      clustered.forEach(poi => {
        if (WATER_CATEGORY_SET.has(poi.categoryKey)) {
          waterSources.push(poi);
        } else if (WATER_HOST_CATEGORY_SET.has(poi.categoryKey)) {
          potentialHosts.push(poi);
        } else {
          others.push(poi);
        }
      });

      const usedWaterIndices = new Set();

      const enrichedHosts = potentialHosts.map(host => {
        // Find closest unused water source within range
        let bestWaterIdx = -1;
        let minDist = Infinity;

        waterSources.forEach((water, idx) => {
          if (usedWaterIndices.has(idx)) return;

          const dist = Math.abs(host.distanceKm - water.distanceKm);
          if (dist <= WATER_MERGE_PROXIMITY_KM && dist < minDist) {
            minDist = dist;
            bestWaterIdx = idx;
          }
        });

        if (bestWaterIdx !== -1) {
          usedWaterIndices.add(bestWaterIdx);
          return { ...host, hasWater: true };
        }
        return host;
      });

      const remainingWater = waterSources.filter((_, idx) => !usedWaterIndices.has(idx));

      const result = [...others, ...enrichedHosts, ...remainingWater];
      result.sort((a, b) => a.distanceKm - b.distanceKm);
      return result;
    })();

    // OPTIMIZATION: Load all unique icons in parallel instead of sequentially
    // This reduces O(n × latency) to O(latency) for icon loading
    const uniqueIconKeys = new Set();
    mergedPois.forEach(entry => {
      if (entry?.iconKey) {
        uniqueIconKeys.add(entry.iconKey.trim());
      }
    });

    // Parallel fetch all unique icons
    const iconDataMap = new Map();
    if (uniqueIconKeys.size > 0) {
      const iconPromises = Array.from(uniqueIconKeys).map(async (iconKey) => {
        try {
          const [metadata, svgContent] = await Promise.all([
            getPoiIconMetadata(iconKey),
            getPoiIconSvgContent(iconKey)
          ]);
          return { iconKey, metadata, svgContent };
        } catch (error) {
          console.warn('Failed to load POI icon data', iconKey, error);
          return { iconKey, metadata: null, svgContent: null };
        }
      });

      const results = await Promise.all(iconPromises);
      results.forEach(({ iconKey, metadata, svgContent }) => {
        iconDataMap.set(iconKey, { metadata, svgContent });
      });
    }

    if (this.pendingPoiRequest !== requestToken) {
      return;
    }



    // Now process POIs using cached icon data (synchronous, fast)
    const resolved = [];
    for (const entry of mergedPois) {
      if (!entry) {
        continue;
      }
      const iconKey = typeof entry.iconKey === 'string' ? entry.iconKey.trim() : '';
      const iconData = iconKey ? iconDataMap.get(iconKey) : null;
      const iconMetadata = iconData?.metadata || null;
      const iconSvgContent = iconData?.svgContent || null;

      const decorated = { ...entry };
      if (iconSvgContent) {
        decorated.iconSvgContent = iconSvgContent;
      }
      if (iconMetadata) {
        const metrics = computePoiIconDisplayMetrics(iconMetadata);
        decorated.icon = {
          ...iconMetadata,
          displayWidth: metrics?.displayWidth ?? null,
          displayHeight: metrics?.displayHeight ?? null
        };
        decorated.iconDisplayWidth = metrics?.displayWidth ?? null;
        decorated.iconDisplayHeight = metrics?.displayHeight ?? null;
        decorated.iconDisplayScale = metrics?.mapScale ?? 1;
        decorated.iconImageId = entry.iconImageId ?? getPoiIconImageId(iconKey);
      } else {
        decorated.icon = null;
        decorated.iconDisplayWidth = null;
        decorated.iconDisplayHeight = null;
        decorated.iconDisplayScale = 1;
        decorated.iconImageId = null;
      }
      decorated.showLabel = shouldShowPoiLabel(decorated);
      resolved.push(decorated);
    }

    if (this.pendingPoiRequest !== requestToken) {
      return;
    }

    markElevationProfileLabelLeaders(resolved, totalDistanceKm);

    // Assign day segment colors and icon variants to POIs based on their distance
    const segments = Array.isArray(this.cutSegments) ? this.cutSegments : [];
    const defaultColor = this.modeColors?.[this.currentMode] || '#f8b40b';

    resolved.forEach((poi) => {
      if (!poi || !Number.isFinite(poi.distanceKm)) return;

      // Find which day segment this POI belongs to
      let dayIndex = 0; // Default to day 0 (single-day or first segment)
      const segment = segments.find((seg, idx) => {
        const start = Number(seg.startKm ?? seg.startDistanceKm ?? 0);
        const end = Number(seg.endKm ?? seg.endDistanceKm ?? start);
        if (poi.distanceKm >= start && poi.distanceKm <= end) {
          dayIndex = idx; // Segment index directly maps to day color index
          return true;
        }
        return false;
      });

      // Use segment color if found, otherwise use default route color
      poi.color = segment?.color || defaultColor;

      // Assign day-specific icon image ID for map rendering
      const iconKey = typeof poi.iconKey === 'string' ? poi.iconKey.trim() : '';
      if (iconKey) {
        poi.iconImageId = getPoiIconImageIdForDay(iconKey, dayIndex);
      }
    });

    this.setRoutePointsOfInterest(resolved);

    if (Array.isArray(this.routeGeojson?.geometry?.coordinates)
      && this.routeGeojson.geometry.coordinates.length >= 2) {
      this.updateElevationProfile(this.routeGeojson.geometry.coordinates);
    } else if (coordinates.length >= 2) {
      this.updateElevationProfile(coordinates);
    }
    this.pendingPoiRequest = null;
    this.pendingPoiAbortController = null;

    // Log POI refresh timing
    const poiRefreshTotal = performance.now() - poiRefreshStart;
    console.log('%c[POI Refresh]', 'color: #00BCD4; font-weight: bold', {
      'total': `${poiRefreshTotal.toFixed(1)} ms`,
      'poisFound': resolved.length,
      'routeCoords': coordinates.length
    });
  }

  async refreshRoutePhotos() {
    // Phase 1: Preparation (Coordinates & Bounds)
    const coordinates = this.routeGeojson?.geometry?.coordinates;
    if (!coordinates || coordinates.length < 2) {
      this.routePhotos = [];
      return;
    }

    // Always fetch photos regardless of map layer state to ensure they are ready 
    // when the user toggles the elevation sidebar. This matches working BAK behavior.

    // Calculate bounds manually
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    coordinates.forEach(coord => {
      if (Array.isArray(coord) && coord.length >= 2) {
        if (coord[0] < minLng) minLng = coord[0];
        if (coord[0] > maxLng) maxLng = coord[0];
        if (coord[1] < minLat) minLat = coord[1];
        if (coord[1] > maxLat) maxLat = coord[1];
      }
    });

    const padding = 0.01;
    const bounds = {
      getNorth: () => maxLat + padding,
      getSouth: () => minLat - padding,
      getEast: () => maxLng + padding,
      getWest: () => minLng - padding
    };

    try {
      console.log(`[refreshRoutePhotos] Fetching photos for bounds: N=${bounds.getNorth().toFixed(4)}, S=${bounds.getSouth().toFixed(4)}, E=${bounds.getEast().toFixed(4)}, W=${bounds.getWest().toFixed(4)}`);
      const collection = await fetchWikimediaPhotosInBounds(bounds);
      if (!collection || !collection.features) {
        this.routePhotos = [];
        return;
      }

      const line = turfApi.lineString(coordinates);
      const photos = [];
      const seen = new Set();
      const MAX_DIST_KM = 0.3; // 300m - very relaxed threshold to ensure mountain photos appear

      // Performance Optimization: Downsample coordinates for distance matching 
      // Turf.nearestPointOnLine is O(N) where N is number of coordinates.
      // Increased resolution to 1000 points for better accuracy.
      const downsampleFactor = Math.max(1, Math.ceil(coordinates.length / 1000));
      const simplifiedCoords = coordinates.filter((_, i) => i % downsampleFactor === 0);
      if (simplifiedCoords[simplifiedCoords.length - 1] !== coordinates[coordinates.length - 1]) {
        simplifiedCoords.push(coordinates[coordinates.length - 1]);
      }
      const simplifiedLine = turfApi.lineString(simplifiedCoords);

      console.log(`[refreshRoutePhotos] Fetched ${collection.features.length} photos. Processing with ${simplifiedCoords.length} route points...`);

      for (const feature of collection.features) {
        const [lng, lat] = feature.geometry.coordinates;
        // Simple bounding box check first
        if (lng < minLng - 0.01 || lng > maxLng + 0.01 || lat < minLat - 0.01 || lat > maxLat + 0.01) continue;

        const point = turfApi.point([lng, lat]);
        // Use simplified line for distance check
        const nearest = turfApi.nearestPointOnLine(simplifiedLine, point, { units: 'kilometers' });
        const distKm = nearest.properties.dist;

        if (distKm <= MAX_DIST_KM) {
          const id = feature.properties.pageId;
          if (seen.has(id)) continue;
          seen.add(id);

          photos.push({
            id: feature.properties.pageId,
            title: feature.properties.title,
            fileName: feature.properties.fileName,
            lng,
            lat,
            distanceKm: nearest.properties.location,
            distanceToRouteKm: distKm,
            thumbnailUrl: getPhotoThumbnailUrl(feature.properties.fileName, 200)
          });
        }
      }

      this.routePhotos = photos.sort((a, b) => a.distanceKm - b.distanceKm);
      console.log(`[refreshRoutePhotos] Success: ${this.routePhotos.length} photos assigned to route. Samples:`, this.routePhotos.slice(0, 3));

      // Trigger chart update if we have photos and the chart is already rendered
      if (this.routePhotos.length > 0 && this.elevationChartContainer) {
        // Redraw with current coordinates to preserve focus/day selection
        const coords = this.selectedDayIndex !== null
          ? this.routeGeojson?.geometry?.coordinates
          : this.routeGeojson?.geometry?.coordinates;
        // The above is slightly redundant, the key is updateElevationProfile 
        // will preserve selectedDayIndex logic if called correctly.
        // Actually, we just need to call it with the full route but ENSURE it re-applies the zoom
        this.updateElevationProfile(this.routeGeojson?.geometry?.coordinates);

        if (this.selectedDayIndex !== null && this.selectedDayIndex !== undefined) {
          this.zoomElevationChartToDay(this.selectedDayIndex);
        }
      }
    } catch (e) {
      console.warn('Failed to refresh route photos', e);
      this.routePhotos = [];
    }
  }

  updateProfileLegend(show) {
    if (!this.elevationChart) return;

    // Find the existing sidebar (sibling of elevationChart)
    const chartContainer = this.elevationChart.parentElement;
    if (!chartContainer) return;

    const legendContainer = chartContainer.querySelector('.profile-mode-sidebar');
    if (!legendContainer) return;

    if (!show) {
      // We don't hide the sidebar as it contains other controls
      return;
    }

    // Check if photo toggle exists
    let photoBtn = legendContainer.querySelector('#elevationPhotoToggle');

    if (!photoBtn) {
      // Create it
      photoBtn = document.createElement('button');
      photoBtn.id = 'elevationPhotoToggle';
      photoBtn.className = 'profile-mode-sidebar__item';
      photoBtn.type = 'button';
      photoBtn.setAttribute('role', 'switch');
      photoBtn.title = 'Afficher les photos';
      photoBtn.setAttribute('aria-label', 'Afficher les photos');

      photoBtn.innerHTML = `
        <img src="./data/icons_Xmap/camera.png" alt="" aria-hidden="true" style="width: 20px; height: 20px;" />
        <span class="sr-only">Afficher les photos</span>
      `;

      // Append to legendContainer
      legendContainer.appendChild(photoBtn);

      // Add event listener
      photoBtn.addEventListener('click', () => {
        this.showElevationPhotos = !this.showElevationPhotos;
        console.log(`[elevationPhotoToggle] Toggled to: ${this.showElevationPhotos}`);
        this.updateProfileLegend(true); // Update state

        // Redraw to show/hide photo markers
        this.updateElevationProfile(this.routeGeojson?.geometry?.coordinates);

        // Re-apply day zoom if active to prevent focus reset
        if (this.selectedDayIndex !== null && this.selectedDayIndex !== undefined) {
          this.zoomElevationChartToDay(this.selectedDayIndex);
        }
      });
    }

    // Update state
    photoBtn.setAttribute('aria-checked', this.showElevationPhotos);
    if (this.showElevationPhotos) {
      photoBtn.classList.add('active');
    } else {
      photoBtn.classList.remove('active');
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
    // This is crucial for manual segments where waypoints may be many kilometers apart.
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
                    stackMarkup += `<div class="elevation-marker__icon elevation-marker__icon--photo-stack" aria-hidden="true" style="position: absolute; top: 0; left: 0; width: 100%; height: 35px; border-radius: 6px; border: 2px solid white; z-index: ${zIndex}; transform: translate(${offsetX}px, ${offsetY}px) rotate(${rotation}deg); box-shadow: 0 2px 4px rgba(0,0,0,0.25); background-image: url('${stackItem.data.thumbnailUrl}'); background-size: cover; background-position: center;"></div>`;
                  }
                });
              }

              const mainImg = `<div class="elevation-marker__icon elevation-marker__icon--photo" style="position: relative; width: 100%; height: 35px; border-radius: 6px; border: 2px solid white; display: block; z-index: 20; box-shadow: 0 2px 6px rgba(0,0,0,0.3); background-image: url('${poi.thumbnailUrl}'); background-size: cover; background-position: center;"></div>`;

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

  /**
   * Attach click handlers to photo markers in the elevation chart
   * Opens the photo popup with carousel when clicked
   */
  attachPhotoMarkerClickHandlers() {
    if (!this.elevationChartContainer) return;

    const photoMarkers = this.elevationChartContainer.querySelectorAll('.elevation-marker.photo');

    photoMarkers.forEach(marker => {
      // Make photo markers clickable
      marker.style.pointerEvents = 'auto';
      marker.style.cursor = 'pointer';

      marker.addEventListener('click', (e) => {
        e.stopPropagation();

        const distanceKm = parseFloat(marker.dataset.distanceKm);
        const clusterCount = parseInt(marker.dataset.clusterCount) || 1;

        // Find the photo data from routePhotos
        if (!Array.isArray(this.routePhotos)) return;

        // Find all photos that were clustered at this distance
        // We need to look up the cluster from the allClusterPhotos data
        // For now, find photos near this distance
        const CLUSTER_PROXIMITY = this.routeProfile?.totalDistanceKm / 15 || 1;
        const clusterPhotos = this.routePhotos.filter(photo =>
          Math.abs(photo.distanceKm - distanceKm) < CLUSTER_PROXIMITY
        );

        if (clusterPhotos.length === 0) return;

        // Sort by distance to get the main photo first
        clusterPhotos.sort((a, b) => Math.abs(a.distanceKm - distanceKm) - Math.abs(b.distanceKm - distanceKm));

        const mainPhoto = clusterPhotos[0];

        // Show the popup with carousel
        if (this.map && typeof showElevationChartPhotoPopup === 'function') {
          showElevationChartPhotoPopup(this.map, mainPhoto, clusterPhotos);
        }
      });
    });
  }

  updateElevationMarkerPositions() {
    if (!this.elevationChartContainer) {
      return;
    }
    const markers = Array.from(
      this.elevationChartContainer.querySelectorAll('.elevation-marker[data-distance-km]')
    );
    if (!markers.length) {
      return;
    }

    markers.forEach((marker) => {
      marker.style.removeProperty('--elevation-marker-label-shift');
    });

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
    const domainLow = Math.min(domainMin, domainMax);
    const domainHigh = Math.max(domainMin, domainMax);
    const span = domainHigh - domainLow;
    if (!(span > 0)) {
      return;
    }

    const yMin = Number(this.elevationYAxis?.min);
    const yMax = Number(this.elevationYAxis?.max);
    const ySpan = yMax - yMin;
    const canPositionVertically = Number.isFinite(yMin)
      && Number.isFinite(yMax)
      && Math.abs(ySpan) > Number.EPSILON;

    const containerWidth = Number(this.elevationChartContainer?.clientWidth) || 0;
    const markerEntries = markers
      .map((marker) => {
        const distanceKm = Number(marker.dataset.distanceKm);
        if (!Number.isFinite(distanceKm)) {
          return null;
        }
        const isPoiMarker = marker.classList.contains('poi');
        const isBivouacMarker = marker.classList.contains('bivouac');
        const isPhotoMarker = marker.classList.contains('photo');
        const ratio = span > 0 ? (distanceKm - domainLow) / span : 0;
        const clampedRatio = Math.max(0, Math.min(1, ratio));
        const percent = clampedRatio * 100;
        return {
          marker,
          isPoiMarker,
          isBivouacMarker,
          isPhotoMarker,
          clampedRatio,
          percent,
          hasLabel: Boolean(marker.querySelector('.elevation-marker__label'))
        };
      })
      .filter(Boolean);

    const clusterShiftMap = new Map();
    if (containerWidth > 0) {
      const labelledEntries = markerEntries
        .filter((entry) => entry.hasLabel && (entry.isPoiMarker || entry.isBivouacMarker))
        .sort((a, b) => a.percent - b.percent);

      const placedLabels = [];
      labelledEntries.forEach((entry) => {
        const labelElement = entry.marker.querySelector('.elevation-marker__label');
        if (!labelElement) {
          return;
        }

        const labelRect = typeof labelElement.getBoundingClientRect === 'function'
          ? labelElement.getBoundingClientRect()
          : null;
        const labelWidth = Number(labelElement.offsetWidth)
          || Number(labelRect?.width)
          || 0;
        const labelHeight = Number(labelElement.offsetHeight)
          || Number(labelRect?.height)
          || 0;

        if (labelWidth <= 0 || labelHeight <= 0) {
          clusterShiftMap.set(entry.marker, 0);
          return;
        }

        const centerPx = (entry.percent / 100) * containerWidth;
        const halfWidth = labelWidth / 2;
        const horizontalPadding = ELEVATION_MARKER_LABEL_HORIZONTAL_PADDING_PX;
        const left = centerPx - halfWidth - horizontalPadding;
        const right = centerPx + halfWidth + horizontalPadding;

        let requiredShift = 0;
        for (const placed of placedLabels) {
          if (right <= placed.left || left >= placed.right) {
            continue;
          }
          const candidateShift = placed.shift + placed.height + ELEVATION_MARKER_LABEL_VERTICAL_GAP_PX;
          if (candidateShift > requiredShift) {
            requiredShift = candidateShift;
          }
        }

        clusterShiftMap.set(entry.marker, requiredShift);
        placedLabels.push({ left, right, shift: requiredShift, height: labelHeight });
      });
    }

    const containerRect = typeof this.elevationChartContainer.getBoundingClientRect === 'function'
      ? this.elevationChartContainer.getBoundingClientRect()
      : null;

    markerEntries.forEach((entry) => {
      const { marker, isPoiMarker, isBivouacMarker, isPhotoMarker, clampedRatio, percent, hasLabel } = entry;

      // Hide markers outside the current visible domain range
      const distanceKm = Number(marker.dataset.distanceKm);
      if (Number.isFinite(distanceKm) && (distanceKm < domainLow || distanceKm > domainHigh)) {
        marker.style.display = 'none';
        return;
      }

      // Handle photo visibility toggle
      if (isPhotoMarker && !this.showElevationPhotos) {
        marker.style.display = 'none';
        return;
      }

      marker.style.display = '';

      const labelElement = hasLabel ? marker.querySelector('.elevation-marker__label') : null;
      marker.style.left = `${percent.toFixed(6)}%`;

      const offsetValue = Number(marker.dataset.bottomOffset);
      const offsetPx = Number.isFinite(offsetValue) ? offsetValue : 0;

      if ((isPoiMarker || isBivouacMarker || isPhotoMarker) && canPositionVertically) {
        const clampedDistanceKm = domainLow + clampedRatio * span;
        const elevation = this.getElevationAtDistance(clampedDistanceKm);

        if (Number.isFinite(elevation)) {
          const normalized = (elevation - yMin) / ySpan;
          const clampedElevation = Math.max(0, Math.min(1, normalized));
          const elevationPercent = clampedElevation * 100;

          // Check for internal stacking metadata
          const stackType = marker.dataset.stackType;

          if (stackType === 'internal') {
            const stackIndex = Number(marker.dataset.stackIndex);
            const stackTotal = Number(marker.dataset.stackTotal);

            if (Number.isFinite(stackIndex) && Number.isFinite(stackTotal)) {
              const ratio = (stackTotal - stackIndex - 0.5) / stackTotal;
              const distributedPercent = elevationPercent * ratio;
              marker.style.bottom = `max(15px, ${distributedPercent.toFixed(6)}%)`;
            } else {
              marker.style.bottom = `max(15px, ${elevationPercent.toFixed(6)}%)`;
            }
          } else if (isPhotoMarker) {
            // Photos should never go below the X axis
            // Max height is 60px + margin, so we need a bit of clearance
            const PHOTO_MIN_BOTTOM = '40px';
            if (offsetPx !== 0) {
              marker.style.bottom = `max(${PHOTO_MIN_BOTTOM}, calc(${elevationPercent.toFixed(6)}% + ${offsetPx}px))`;
            } else {
              marker.style.bottom = `max(${PHOTO_MIN_BOTTOM}, ${elevationPercent.toFixed(6)}%)`;
            }
          } else {
            const offsetSuffix = offsetPx !== 0 ? ` + ${offsetPx}px` : '';
            if (offsetSuffix) {
              marker.style.bottom = `max(15px, calc(${elevationPercent.toFixed(6)}%${offsetSuffix}))`;
            } else {
              marker.style.bottom = `max(15px, ${elevationPercent.toFixed(6)}%)`;
            }
          }

          if (isBivouacMarker) {
            const containerHeight = this.elevationChartContainer?.clientHeight || 0;
            const lineHeightPx = Math.max(0, clampedElevation * containerHeight);
            marker.style.setProperty('--bivouac-line-height', `${lineHeightPx.toFixed(1)}px`);
          }
        } else {
          // Fallback if elevation is not finite
          marker.style.bottom = `${offsetPx}px`;
          if (isBivouacMarker) {
            marker.style.setProperty('--bivouac-line-height', '0px');
          }
        }
      } else if (isPoiMarker || isBivouacMarker || isPhotoMarker) {
        // Fallback if cannot position vertically
        marker.style.bottom = `${offsetPx}px`;
        if (isBivouacMarker) {
          marker.style.setProperty('--bivouac-line-height', '0px');
        }
      }

      const clusterShift = clusterShiftMap.get(marker);
      if (Number.isFinite(clusterShift) && clusterShift > 0 && labelElement) {
        let appliedShift = clusterShift;
        if (containerRect && typeof labelElement.getBoundingClientRect === 'function') {
          const labelRect = labelElement.getBoundingClientRect();
          const containerTop = Number(containerRect?.top);
          const labelTop = Number(labelRect?.top);
          if (Number.isFinite(containerTop) && Number.isFinite(labelTop)) {
            const availableShift = labelTop - containerTop - ELEVATION_MARKER_LABEL_TOP_PADDING_PX;
            if (Number.isFinite(availableShift)) {
              appliedShift = Math.min(appliedShift, Math.max(0, availableShift));
            }
          }
        }

        if (appliedShift > 0.5) {
          marker.style.setProperty('--elevation-marker-label-shift', `${appliedShift.toFixed(2)}px`);
        }
      }
    });

    // Collision detection for photo markers
    if (this.showElevationPhotos && containerWidth > 0 && containerRect) {
      const photoEntries = markerEntries.filter(e => e.isPhotoMarker && e.marker.style.display !== 'none');

      // Reset any previous scaling
      photoEntries.forEach(e => {
        e.marker.style.transform = '';
        e.marker.style.zIndex = '';
      });

      // Sort by X position
      photoEntries.sort((a, b) => a.percent - b.percent);

      const PHOTO_SIZE_PX = 32; // Match the rendering size
      const MIN_SIZE_PX = 24;   // Minimum size when overlapping

      const getEstimatedRect = (entry) => {
        const x = (entry.percent / 100) * containerWidth;
        return { x, width: PHOTO_SIZE_PX };
      };

      for (let i = 0; i < photoEntries.length; i++) {
        const current = photoEntries[i];
        const currentRect = getEstimatedRect(current);
        let overlapFactor = 0;

        // Check neighbors
        for (let j = i + 1; j < photoEntries.length; j++) {
          const next = photoEntries[j];
          const nextRect = getEstimatedRect(next);

          // If X distance is less than width, they *might* overlap
          const dist = nextRect.x - currentRect.x;
          if (dist < PHOTO_SIZE_PX) {
            // They are close horizontally.
            overlapFactor = Math.max(overlapFactor, 1 - (dist / PHOTO_SIZE_PX));

            // Also mark the neighbor as overlapping
            next.overlap = Math.max(next.overlap || 0, 1 - (dist / PHOTO_SIZE_PX));
          } else {
            // Sorted by X, so no need to check further
            break;
          }
        }
        current.overlap = Math.max(current.overlap || 0, overlapFactor);
      }

      // Apply scaling based on overlap
      photoEntries.forEach(entry => {
        if (entry.overlap > 0.2) { // Tolerance
          const targetSize = Math.max(MIN_SIZE_PX, PHOTO_SIZE_PX - (entry.overlap * (PHOTO_SIZE_PX - MIN_SIZE_PX)));
          const scale = targetSize / PHOTO_SIZE_PX;
          entry.marker.style.transform = `translate(-50%, 50%) scale(${scale})`;
          entry.marker.style.zIndex = '15'; // Lower z-index for shrunk items
        } else {
          entry.marker.style.zIndex = '20'; // Normal z-index
        }
      });
    }
  }

  updateElevationHoverReadout(distanceKm) {
    if (!Number.isFinite(distanceKm)) {
      if (this.elevationHoverIndicator) {
        this.elevationHoverIndicator.setAttribute('aria-hidden', 'true');
      }
      this.updateRouteStatsHover(null);
      return;
    }

    this.updateRouteStatsHover(distanceKm);
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

  applyRoute(route) {
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
    const profileCoordinates = Array.isArray(this.routeProfile?.coordinates)
      ? this.routeProfile.coordinates
      : [];
    const routeCoordinates = profileCoordinates.map((coord) => (Array.isArray(coord) ? coord.slice() : coord));
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
      const coordinates = this.routeGeojson?.geometry?.coordinates ?? [];

      // Update elevation chart
      this.updateElevationProfile(coordinates);

      // Update distance markers on map
      this.updateDistanceMarkers(this.routeGeojson);

      // Update stats panel
      this._lastSummaryStatsKey = null;
      if (this.routeGeojson) {
        this.updateStats(this.routeGeojson);
      }

      // Update POI day colors
      this.updatePoiDayColors();

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

    try {
      if (!this.router || typeof this.router.getRoute !== 'function') {
        throw new Error('No routing engine is configured');
      }

      await this.prepareNetwork({ reason: 'route-request' });
      const preservedSegments = this.buildPreservedSegments();
      const route = await this.router.getRoute(this.waypoints, {
        mode: this.currentMode,
        preservedSegments
      });

      if (!route || !route.geometry) {
        throw new Error('No route returned from the offline router');
      }

      this.applyRoute(route);
    } catch (error) {
      console.error('Failed to compute route', error);
    }
  }

  renderElevationSparkline() {
    const sparklineBg = this.routeStats?.querySelector('.route-stats__sparkline');
    const target = sparklineBg || this.elevationCollapseToggle;
    if (!target) return;

    // First, try to use elevationSamples if they are already processed
    // Fallback to generating them from the routeProfile if available
    let samples = Array.isArray(this.elevationSamples) && this.elevationSamples.length > 0
      ? this.elevationSamples
      : null;

    if (!samples && this.routeProfile) {
      const coordinates = this.routeProfile.coordinates || [];
      samples = this.generateElevationSamples(coordinates);
    }

    if (!Array.isArray(samples) || samples.length < 2) {
      this.elevationCollapseToggle.classList.add('elevation-toggle--empty');
      this.elevationCollapseToggle.innerHTML = '<span class="sr-only">Afficher le profil d\'élévation</span>';
      return;
    }

    // Filter samples based on selected day if applicable
    if (this.selectedDayIndex !== null && this.selectedDayIndex !== undefined && Array.isArray(this.cutSegments)) {
      const segment = this.cutSegments[this.selectedDayIndex];
      if (segment) {
        const startDist = Number(segment.startKm ?? segment.startDistanceKm ?? 0);
        const endDist = Number(segment.endKm ?? segment.endDistanceKm ?? startDist);
        samples = samples.filter(s => {
          const d = s.distanceKm ?? s.endDistanceKm ?? 0;
          return d >= startDist && d <= endDist;
        });
      }
    }
    this.elevationCollapseToggle.classList.remove('elevation-toggle--empty');

    // Downsample for a "coarse" look as requested by user (approx 30 points)
    const MAX_POINTS = 30;
    let displaySamples = samples;
    if (samples.length > MAX_POINTS) {
      const factor = Math.max(1, Math.floor(samples.length / MAX_POINTS));
      displaySamples = samples.filter((_, i) => i % factor === 0);
      if (displaySamples[displaySamples.length - 1] !== samples[samples.length - 1]) {
        displaySamples.push(samples[samples.length - 1]);
      }
    }

    const elevations = displaySamples.map(s => s.elevation);
    const min = Math.min(...elevations);
    const max = Math.max(...elevations);
    const range = Math.max(1, max - min);

    const distances = displaySamples.map(s => s.distanceKm ?? s.endDistanceKm ?? 0);
    const distMin = distances[0];
    const distMax = distances[distances.length - 1];
    const distRange = Math.max(0.001, distMax - distMin);

    // Vertical padding to ensure peaks/valleys aren't cut off (15% padding)
    const PADDING_Y = 15;
    const SCALE_Y = 100 - (PADDING_Y * 2);

    // Determine segments to draw
    const isSingleDayView = this.selectedDayIndex !== null && this.selectedDayIndex !== undefined;
    const drawingSegments = [];

    if (isSingleDayView && Array.isArray(this.cutSegments)) {
      const seg = this.cutSegments[this.selectedDayIndex];
      if (seg) drawingSegments.push(seg);
    } else if (Array.isArray(this.cutSegments) && this.cutSegments.length > 0) {
      drawingSegments.push(...this.cutSegments);
    } else {
      drawingSegments.push({ color: '#f8b40b', startKm: distMin, endKm: distMax });
    }

    let defsContent = '';
    let pathsContent = '';

    drawingSegments.forEach((segment, idx) => {
      const startDist = Number(segment.startKm ?? segment.startDistanceKm ?? 0);
      const endDist = Number(segment.endKm ?? segment.endDistanceKm ?? startDist);
      const color = segment.color || '#f8b40b';

      // Filter display samples for this segment
      // Use a small epsilon to catch points exactly on the boundary
      const EPSILON = 1e-6;
      let segmentSamples = displaySamples.filter(s => {
        const d = s.distanceKm ?? s.endDistanceKm ?? 0;
        return d >= (startDist - EPSILON) && d <= (endDist + EPSILON);
      });

      // Ensure segment starts exactly at startDist to avoid gaps
      if (!segmentSamples.length || Math.abs((segmentSamples[0].distanceKm ?? 0) - startDist) > EPSILON) {
        const startElev = this.getElevationAtDistance(startDist);
        if (Number.isFinite(startElev)) {
          segmentSamples.unshift({ distanceKm: startDist, elevation: startElev });
        }
      }
      // Ensure segment ends exactly at endDist to avoid gaps
      if (segmentSamples.length > 0 && Math.abs((segmentSamples[segmentSamples.length - 1].distanceKm ?? 0) - endDist) > EPSILON) {
        const endElev = this.getElevationAtDistance(endDist);
        if (Number.isFinite(endElev)) {
          segmentSamples.push({ distanceKm: endDist, elevation: endElev });
        }
      }

      if (segmentSamples.length < 2) return;

      const points = segmentSamples.map((sample) => {
        const dist = sample.distanceKm ?? sample.endDistanceKm ?? 0;
        const elev = sample.elevation ?? min;
        const x = ((dist - distMin) / distRange) * 100;
        const y = (100 - PADDING_Y) - ((elev - min) / range) * SCALE_Y;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      });

      const d = `M ${points.join(' L ')}`;
      const startX = ((segmentSamples[0].distanceKm ?? segmentSamples[0].endDistanceKm ?? 0) - distMin) / distRange * 100;
      const endX = ((segmentSamples[segmentSamples.length - 1].distanceKm ?? segmentSamples[segmentSamples.length - 1].endDistanceKm ?? 0) - distMin) / distRange * 100;
      const fillD = `${d} L ${endX.toFixed(1)},100 L ${startX.toFixed(1)},100 Z`;

      const gradId = `sparkline-grad-${idx}-${Math.floor(Math.random() * 1000)}`;
      defsContent += `
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:${color}; stop-opacity:0.7" />
          <stop offset="100%" style="stop-color:${color}; stop-opacity:0.2" />
        </linearGradient>
      `;
      pathsContent += `
        <path d="${fillD}" fill="url(#${gradId})"></path>
        <path d="${d}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"></path>
      `;
    });

    // Add Photo Markers to Sparkline
    let photoMarkersContent = '';
    if (this.showElevationPhotos && Array.isArray(this.routePhotos)) {
      this.routePhotos.forEach(photo => {
        const dist = Number(photo.distanceKm);
        if (Number.isFinite(dist) && dist >= distMin && dist <= distMax) {
          const elev = this.getElevationAtDistance(dist) ?? min;
          const x = ((dist - distMin) / distRange) * 100;
          const y = (100 - PADDING_Y) - ((elev - min) / range) * SCALE_Y;

          photoMarkersContent += `
            <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#ffffff" stroke="#1a73e8" stroke-width="1.5" style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
          `;
        }
      });
    }

    // Create a highly visible, coarse SVG preview
    target.innerHTML = `
      <svg class="elevation-sparkline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" style="width:100%; height:100%; display:block; pointer-events:none; overflow:visible;">
        <defs>${defsContent}</defs>
        ${pathsContent}
        ${photoMarkersContent}
      </svg>
      <span class="sr-only">Profil d'élévation</span>
    `;
  }
}
