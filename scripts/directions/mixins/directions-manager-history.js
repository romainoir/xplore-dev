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
  buildPoiIdentifier
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


export class DirectionsManagerHistoryMixin {
  cloneWaypoints(source = this.waypoints) {
    if (!Array.isArray(source)) {
      return [];
    }
    return source.map((coords) => (Array.isArray(coords) ? coords.slice() : []));
  }

  buildWaypointCoordinate(coords) {
    if (!Array.isArray(coords) || coords.length < 2) {
      return null;
    }

    const lng = Number(coords[0]);
    const lat = Number(coords[1]);

    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return null;
    }

    let elevation = coords.length > 2 && Number.isFinite(coords[2]) ? Number(coords[2]) : null;

    if (!Number.isFinite(elevation)) {
      const terrainElevation = this.queryTerrainElevationValue([lng, lat]);
      if (Number.isFinite(terrainElevation)) {
        elevation = terrainElevation;
      }
    }

    return Number.isFinite(elevation) ? [lng, lat, elevation] : [lng, lat];
  }

  normalizeRouteCutEntry(entry) {
    if (entry === null || entry === undefined) {
      return null;
    }

    if (typeof entry === 'number') {
      const distance = Number(entry);
      return Number.isFinite(distance) ? { distanceKm: distance, lng: null, lat: null } : null;
    }

    if (typeof entry === 'object') {
      const distance = Number(entry.distanceKm ?? entry.distance ?? entry.value);
      if (!Number.isFinite(distance)) {
        return null;
      }

      let lng = null;
      let lat = null;

      if (Array.isArray(entry.coordinates) && entry.coordinates.length >= 2) {
        const [coordLng, coordLat] = entry.coordinates;
        lng = Number(coordLng);
        lat = Number(coordLat);
      } else {
        const maybeLng = Number(entry.lng ?? entry.lon ?? entry.longitude);
        const maybeLat = Number(entry.lat ?? entry.latitude);
        if (Number.isFinite(maybeLng) && Number.isFinite(maybeLat)) {
          lng = maybeLng;
          lat = maybeLat;
        }
      }

      return {
        distanceKm: distance,
        lng: Number.isFinite(lng) ? lng : null,
        lat: Number.isFinite(lat) ? lat : null
      };
    }

    return null;
  }

  cloneRouteCuts(source = this.routeCutDistances) {
    if (!Array.isArray(source)) {
      return [];
    }

    return source
      .map((entry) => this.normalizeRouteCutEntry(entry))
      .filter((entry) => entry && Number.isFinite(entry.distanceKm))
      .map((entry) => ({ ...entry }));
  }

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

  createHistorySnapshot() {
    const waypoints = this.cloneWaypoints();
    const routeCuts = this.cloneRouteCuts();
    // Clone the cached leg segments to preserve routing modes (manual vs snapping)
    const legSegments = this.cloneCachedLegSegments();
    return { waypoints, routeCuts, legSegments };
  }

  /**
   * Clone cachedLegSegments Map to preserve segment data including routing modes.
   */
  cloneCachedLegSegments() {
    if (!(this.cachedLegSegments instanceof Map) || !this.cachedLegSegments.size) {
      return [];
    }
    const cloned = [];
    for (const [index, segment] of this.cachedLegSegments.entries()) {
      if (!segment) continue;
      cloned.push({
        index,
        startIndex: segment.startIndex,
        endIndex: segment.endIndex,
        coordinates: Array.isArray(segment.coordinates)
          ? segment.coordinates.map((c) => (Array.isArray(c) ? c.slice() : c))
          : null,
        distance: segment.distance,
        duration: segment.duration,
        ascent: segment.ascent,
        descent: segment.descent,
        metadata: Array.isArray(segment.metadata)
          ? segment.metadata.map((m) => (m && typeof m === 'object' ? { ...m } : m))
          : [],
        routingMode: segment.routingMode || null
      });
    }
    return cloned;
  }

  /**
   * Restore cachedLegSegments from a cloned array.
   */
  restoreCachedLegSegments(legSegmentsArray) {
    if (!Array.isArray(legSegmentsArray) || !legSegmentsArray.length) {
      this.cachedLegSegments = new Map();
      return;
    }
    const restored = new Map();
    for (const segment of legSegmentsArray) {
      if (!segment || !Number.isInteger(segment.index)) continue;
      restored.set(segment.index, {
        startIndex: segment.startIndex,
        endIndex: segment.endIndex,
        coordinates: Array.isArray(segment.coordinates)
          ? segment.coordinates.map((c) => (Array.isArray(c) ? c.slice() : c))
          : null,
        distance: segment.distance,
        duration: segment.duration,
        ascent: segment.ascent,
        descent: segment.descent,
        metadata: Array.isArray(segment.metadata)
          ? segment.metadata.map((m) => (m && typeof m === 'object' ? { ...m } : m))
          : [],
        routingMode: segment.routingMode || null
      });
    }
    this.cachedLegSegments = restored;
  }

  /**
   * Reverse the cached leg segments when the route direction is swapped.
   * This preserves the routing mode (manual vs snapping) for each segment
   * while remapping the indices to match the reversed waypoint order.
   */
  reverseCachedLegSegments() {
    if (!(this.cachedLegSegments instanceof Map) || !this.cachedLegSegments.size) {
      return;
    }

    const numWaypoints = this.waypoints.length;
    if (numWaypoints < 2) {
      this.cachedLegSegments = new Map();
      return;
    }

    const numLegs = numWaypoints - 1;
    const reversed = new Map();

    // Each segment at old index i becomes segment at new index (numLegs - 1 - i)
    // And its coordinates need to be reversed
    for (const [oldIndex, segment] of this.cachedLegSegments.entries()) {
      if (!segment) continue;

      const newIndex = numLegs - 1 - oldIndex;
      if (newIndex < 0 || newIndex >= numLegs) continue;

      // Reverse the coordinates array for this segment
      const reversedCoords = Array.isArray(segment.coordinates)
        ? segment.coordinates.slice().reverse()
        : null;

      // Swap ascent and descent since direction is reversed
      const newAscent = segment.descent;
      const newDescent = segment.ascent;

      reversed.set(newIndex, {
        startIndex: newIndex,
        endIndex: newIndex + 1,
        coordinates: reversedCoords,
        distance: segment.distance,
        duration: segment.duration,
        ascent: newAscent,
        descent: newDescent,
        metadata: Array.isArray(segment.metadata)
          ? segment.metadata.map((m) => (m && typeof m === 'object' ? { ...m } : m))
          : [],
        routingMode: segment.routingMode || null
      });
    }

    this.cachedLegSegments = reversed;
    this.updateManualRouteSource();
  }

  /**
   * Rebuild the route display from cached leg segments without calling the router.
   * This is used when restoring from undo/redo to preserve original routing modes.
   */
  rebuildRouteFromCachedSegments() {
    if (!(this.cachedLegSegments instanceof Map) || !this.cachedLegSegments.size) {
      // No cached segments, fall back to routing
      this.getRoute();
      return;
    }

    // Build coordinates, segments, and segment_modes from cached data
    const coordinates = [];
    const segments = [];
    const segmentModes = [];
    const segmentMetadata = [];
    let totalDistance = 0;
    let totalAscent = 0;
    let totalDescent = 0;

    // Sort segments by index
    const sortedSegments = Array.from(this.cachedLegSegments.entries())
      .sort((a, b) => a[0] - b[0]);

    for (const [index, segment] of sortedSegments) {
      if (!segment || !Array.isArray(segment.coordinates) || segment.coordinates.length < 2) {
        continue;
      }

      // Append coordinates (avoiding duplicates at boundaries)
      segment.coordinates.forEach((coord, coordIndex) => {
        if (!Array.isArray(coord) || coord.length < 2) return;
        if (coordinates.length > 0 && coordIndex === 0) {
          // Skip first coord if it matches the last one (boundary)
          const last = coordinates[coordinates.length - 1];
          if (Math.abs(last[0] - coord[0]) < 1e-8 && Math.abs(last[1] - coord[1]) < 1e-8) {
            return;
          }
        }
        coordinates.push(coord.slice());
      });

      const distanceMeters = (segment.distance ?? 0);
      const distanceKm = distanceMeters / 1000;
      const ascent = segment.ascent ?? 0;
      const descent = segment.descent ?? 0;

      totalDistance += distanceMeters;
      totalAscent += ascent;
      totalDescent += descent;

      segments.push({
        distance: distanceMeters,
        duration: segment.duration ?? 0,
        ascent,
        descent,
        start_index: segment.startIndex,
        end_index: segment.endIndex
      });

      // Preserve the routing mode for this segment
      segmentModes.push(segment.routingMode || 'foot-hiking');

      // Preserve metadata
      segmentMetadata.push(Array.isArray(segment.metadata) ? segment.metadata : []);
    }

    if (coordinates.length < 2) {
      // Not enough coordinates, fall back to routing
      this.getRoute();
      return;
    }

    // Build the route feature
    const routeFeature = {
      type: 'Feature',
      properties: {
        profile: this.currentMode,
        summary: {
          distance: totalDistance,
          duration: this.estimateDuration(totalDistance / 1000),
          ascent: totalAscent,
          descent: totalDescent
        },
        segments,
        segment_modes: segmentModes,
        segment_metadata: segmentMetadata
      },
      geometry: {
        type: 'LineString',
        coordinates
      }
    };

    // Apply the rebuilt route
    this.applyRoute(routeFeature);
  }

  /**
   * Estimate duration in seconds based on distance and current mode.
   */
  estimateDuration(distanceKm) {
    const speedKmh = 4.5; // Default hiking speed
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 0;
    return (distanceKm / speedKmh) * 3600;
  }

  restoreStateFromSnapshot(snapshot) {
    if (!snapshot) {
      return false;
    }

    let waypointSnapshot = null;
    let routeCutSnapshot = [];
    let legSegmentsSnapshot = null;

    if (Array.isArray(snapshot)) {
      waypointSnapshot = this.cloneWaypoints(snapshot);
    } else if (Array.isArray(snapshot.waypoints)) {
      waypointSnapshot = this.cloneWaypoints(snapshot.waypoints);
      routeCutSnapshot = this.cloneRouteCuts(
        Array.isArray(snapshot.routeCuts) ? snapshot.routeCuts : []
      );
      // Restore leg segments if present in snapshot
      if (Array.isArray(snapshot.legSegments)) {
        legSegmentsSnapshot = snapshot.legSegments;
      }
    }

    if (!Array.isArray(waypointSnapshot)) {
      return false;
    }

    this.waypoints = waypointSnapshot;
    this.setRouteCutDistances(routeCutSnapshot);

    // Restore leg segments if available (preserves manual/snapping modes)
    if (legSegmentsSnapshot) {
      this.restoreCachedLegSegments(legSegmentsSnapshot);
    }

    return true;
  }

  trimHistoryStack(stack) {
    if (!Array.isArray(stack)) {
      return;
    }
    if (stack.length > WAYPOINT_HISTORY_LIMIT) {
      stack.splice(0, stack.length - WAYPOINT_HISTORY_LIMIT);
    }
  }

  recordWaypointState() {
    const snapshot = this.createHistorySnapshot();
    if (!snapshot || !Array.isArray(snapshot.waypoints)) {
      return;
    }
    this.waypointHistory.push(snapshot);
    this.trimHistoryStack(this.waypointHistory);
    this.waypointRedoHistory = [];
    this.updateUndoAvailability();
  }

  updateUndoAvailability() {
    const hasHistory = Array.isArray(this.waypointHistory) && this.waypointHistory.length > 0;
    if (this.undoButton) {
      this.undoButton.disabled = !hasHistory;
    }
    const hasRedo = Array.isArray(this.waypointRedoHistory) && this.waypointRedoHistory.length > 0;
    if (this.redoButton) {
      this.redoButton.disabled = !hasRedo;
    }
  }

  undoLastWaypointChange() {
    if (!Array.isArray(this.waypointHistory) || !this.waypointHistory.length) {
      return;
    }
    const previous = this.waypointHistory.pop();
    const currentSnapshot = this.createHistorySnapshot();
    // Check if the previous snapshot has leg segments before restoring
    const hasLegSegments = previous && Array.isArray(previous.legSegments) && previous.legSegments.length > 0;
    const restored = this.restoreStateFromSnapshot(previous);
    if (!restored) {
      this.updateUndoAvailability();
      return;
    }
    if (currentSnapshot && Array.isArray(currentSnapshot.waypoints)) {
      this.waypointRedoHistory.push(currentSnapshot);
      this.trimHistoryStack(this.waypointRedoHistory);
    }
    // Refresh the manual route overlay
    this.updateManualRouteSource();
    if (this.waypoints.length >= 2) {
      this.updateWaypoints();
      // If we restored leg segments, use them to rebuild the route
      // This preserves the original routing modes (manual vs snapping)
      if (hasLegSegments && this.cachedLegSegments instanceof Map && this.cachedLegSegments.size > 0) {
        this.rebuildRouteFromCachedSegments();
      } else {
        // No preserved segments, need to recalculate
        this.getRoute();
      }
    } else {
      this.clearRoute();
      this.updateWaypoints();
      this.updateStats(null);
      this.updateElevationProfile([]);
    }
    this.updateModeAvailability();
    this.updateUndoAvailability();
  }

  redoLastWaypointChange() {
    if (!Array.isArray(this.waypointRedoHistory) || !this.waypointRedoHistory.length) {
      return;
    }
    const next = this.waypointRedoHistory.pop();
    const currentSnapshot = this.createHistorySnapshot();
    // Check if the next snapshot has leg segments before restoring
    const hasLegSegments = next && Array.isArray(next.legSegments) && next.legSegments.length > 0;
    const restored = this.restoreStateFromSnapshot(next);
    if (!restored) {
      this.updateUndoAvailability();
      return;
    }
    if (currentSnapshot && Array.isArray(currentSnapshot.waypoints)) {
      this.waypointHistory.push(currentSnapshot);
      this.trimHistoryStack(this.waypointHistory);
    }
    // Refresh the manual route overlay
    this.updateManualRouteSource();
    if (this.waypoints.length >= 2) {
      this.updateWaypoints();
      // If we restored leg segments, use them to rebuild the route
      // This preserves the original routing modes (manual vs snapping)
      if (hasLegSegments && this.cachedLegSegments instanceof Map && this.cachedLegSegments.size > 0) {
        this.rebuildRouteFromCachedSegments();
      } else {
        // No preserved segments, need to recalculate
        this.getRoute();
      }
    } else {
      this.clearRoute();
      this.updateWaypoints();
      this.updateStats(null);
      this.updateElevationProfile([]);
    }
    this.updateModeAvailability();
    this.updateUndoAvailability();
  }

}
