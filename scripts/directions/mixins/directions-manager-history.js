import { WAYPOINT_HISTORY_LIMIT } from '../constants/directions-constants.js';


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
