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


export class DirectionsManagerRoutingMixin {
  updateModeAvailability() {
    if (!Array.isArray(this.transportModes) || !this.transportModes.length) {
      return;
    }

    const supports = (mode) => {
      if (!this.router || typeof this.router.supportsMode !== 'function') {
        return true;
      }
      return this.router.supportsMode(mode);
    };

    let hasActiveMode = false;

    this.transportModes.forEach((button) => {
      const mode = button.dataset.mode;
      if (!mode) return;
      const supported = supports(mode);
      button.disabled = !supported;
      button.classList.toggle('mode-disabled', !supported);
      const shouldBeActive = supported && mode === this.currentMode;
      button.classList.toggle('active', shouldBeActive);
      if (shouldBeActive) {
        hasActiveMode = true;
      }
    });

    if (!hasActiveMode) {
      const fallbackButton = this.transportModes.find((button) => {
        const mode = button.dataset.mode;
        return mode && supports(mode);
      });
      if (fallbackButton) {
        this.setTransportMode(fallbackButton.dataset.mode);
      }
    }
  }

  setRouter(router, options = {}) {
    this.router = router ?? null;
    const { reroute = false, deferEnsureReady = false } = options ?? {};
    if (this.router && typeof this.router.ensureReady === 'function' && !deferEnsureReady) {
      this.router.ensureReady().catch((error) => {
        console.error('Router failed to initialize', error);
      });
    }
    this.updateModeAvailability();
    if (reroute && this.waypoints.length >= 2) {
      this.getRoute();
    }
  }

  setOfflinePointsOfInterest(collection) {
    let normalized = EMPTY_COLLECTION;
    if (collection && typeof collection === 'object' && collection.type === 'FeatureCollection'
      && Array.isArray(collection.features)) {
      const features = collection.features
        .map((feature) => {
          if (!feature || typeof feature !== 'object') {
            return null;
          }
          const geometry = feature.geometry;
          if (!geometry || geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) {
            return null;
          }
          const lng = Number(geometry.coordinates[0]);
          const lat = Number(geometry.coordinates[1]);
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
            return null;
          }
          const originalCoords = Array.isArray(geometry.coordinates)
            ? geometry.coordinates
            : [];
          const elevation = originalCoords.length >= 3 ? Number(originalCoords[2]) : null;
          const properties = feature.properties && typeof feature.properties === 'object'
            ? { ...feature.properties }
            : {};
          if (!Object.prototype.hasOwnProperty.call(properties, 'ele') && Number.isFinite(elevation)) {
            properties.ele = elevation;
          }
          const coordinates = Number.isFinite(elevation)
            ? [lng, lat, elevation]
            : [lng, lat];
          return {
            type: 'Feature',
            properties,
            geometry: {
              type: 'Point',
              coordinates
            }
          };
        })
        .filter(Boolean);
      if (features.length) {
        normalized = { type: 'FeatureCollection', features };
      }
    }
    this.offlinePoiCollection = normalized;
    if (Array.isArray(this.routeProfile?.coordinates) && this.routeProfile.coordinates.length >= 2) {
      this.refreshRoutePointsOfInterest().catch(() => { });
    } else {
      this.setRoutePointsOfInterest([]);
      this.pendingPoiRequest = null;
    }
  }

  setRouteSegmentsListener(callback) {
    this.routeSegmentsListener = typeof callback === 'function' ? callback : null;
    this.notifyRouteSegmentsUpdated();
  }

  setClearDirectionsListener(callback) {
    this.clearDirectionsListener = typeof callback === 'function' ? callback : null;
  }

  notifyRouteSegmentsUpdated() {
    if (typeof this.routeSegmentsListener !== 'function') {
      return;
    }
    try {
      const payload = {
        full: this.buildExportFeatureCollection(),
        segments: this.buildSegmentExportCollections()
      };
      this.routeSegmentsListener(payload);
    } catch (error) {
      console.error('Route segment listener failed', error);
    }
  }

  setNetworkPreparationCallback(callback) {
    this.networkPreparationCallback = typeof callback === 'function' ? callback : null;
  }

  async prepareNetwork(context = {}) {
    if (typeof this.networkPreparationCallback !== 'function') {
      return;
    }

    const reason = typeof context.reason === 'string' && context.reason
      ? context.reason
      : 'route-request';

    try {
      await this.networkPreparationCallback({
        waypoints: this.snapshotWaypoints(),
        mode: this.currentMode,
        reason
      });
    } catch (error) {
      console.warn('Failed to prepare routing network', error);
    }
  }

  resetRouteCuts() {
    this.routeCutDistances = [];
    this.cutSegments = [];
    this.updateSegmentMarkers();
    this.updateDistanceMarkers(this.routeGeojson);
  }

  getSegmentColor(index) {
    if (!Number.isInteger(index) || index < 0) {
      return this.modeColors[this.currentMode];
    }
    if (index === 0) {
      return this.modeColors[this.currentMode];
    }
    const paletteIndex = (index - 1) % SEGMENT_COLOR_PALETTE.length;
    return SEGMENT_COLOR_PALETTE[paletteIndex] ?? this.modeColors[this.currentMode];
  }

  updateCutSegmentColors() {
    if (!Array.isArray(this.cutSegments) || !this.cutSegments.length) {
      this.updateSegmentMarkers();
      return;
    }
    this.cutSegments = this.cutSegments.map((segment, index) => ({
      ...segment,
      index,
      color: this.getSegmentColor(index),
      name: segment?.name ?? `Segment ${index + 1}`
    }));
    this.assignSegmentNames();
    this.updateSegmentMarkers();
    this.updateDistanceMarkers(this.routeGeojson);
    // Update manual route overlay colors to match day segment colors
    this.updateManualRouteSource();
  }

  computeCutBoundaries() {
    const totalDistance = Number(this.routeProfile?.totalDistanceKm) || 0;
    if (!Number.isFinite(totalDistance) || totalDistance <= 0) {
      return [];
    }

    const rawCuts = Array.isArray(this.routeCutDistances)
      ? this.routeCutDistances
        .map((entry) => Number(entry?.distanceKm ?? entry))
        .filter((value) => Number.isFinite(value))
      : [];

    const interiorCuts = rawCuts
      .filter((value) => value > ROUTE_CUT_EPSILON_KM && value < totalDistance - ROUTE_CUT_EPSILON_KM)
      .sort((a, b) => a - b);

    const uniqueCuts = [];
    interiorCuts.forEach((value) => {
      if (!uniqueCuts.some((existing) => Math.abs(existing - value) <= ROUTE_CUT_EPSILON_KM / 2)) {
        uniqueCuts.push(value);
      }
    });

    return [0, ...uniqueCuts, totalDistance];
  }

  computeSegmentMarkers(segments = this.cutSegments) {
    const routeCoordinates = Array.isArray(this.routeProfile?.coordinates)
      ? this.routeProfile.coordinates
      : [];
    const waypointCoordinates = Array.isArray(this.waypoints) ? this.waypoints : [];
    const baseCoordinates = routeCoordinates.length ? routeCoordinates : waypointCoordinates;

    if (!Array.isArray(baseCoordinates) || !baseCoordinates.length) {
      return [];
    }

    const cloneCoord = (coord) => {
      if (!Array.isArray(coord) || coord.length < 2) {
        return null;
      }
      return coord.slice();
    };

    const hasRouteGeometry = routeCoordinates.length >= 2;
    const waypointCount = waypointCoordinates.length;

    const ensureSegments = () => {
      if (Array.isArray(segments) && segments.length) {
        return segments;
      }
      const first = cloneCoord(baseCoordinates[0]);
      if (!first) {
        return [];
      }
      const last = cloneCoord(baseCoordinates[baseCoordinates.length - 1] ?? baseCoordinates[0]);
      if (!last || (baseCoordinates.length === 1 && !hasRouteGeometry && waypointCount < 2)) {
        return [{
          index: 0,
          startKm: 0,
          endKm: 0,
          distanceKm: 0,
          coordinates: [first],
          color: this.getSegmentColor(0)
        }];
      }
      const totalDistance = Number(this.routeProfile?.totalDistanceKm);
      const distanceKm = Number.isFinite(totalDistance) ? totalDistance : 0;
      const coords = baseCoordinates.length > 1 ? [first, last] : [first];
      return [{
        index: 0,
        startKm: 0,
        endKm: distanceKm,
        distanceKm,
        coordinates: coords,
        color: this.getSegmentColor(0)
      }];
    };

    const resolvedSegments = ensureSegments();
    if (!resolvedSegments.length) {
      return [];
    }

    const markers = [];
    const firstSegment = resolvedSegments[0];
    const startCoord = cloneCoord(firstSegment?.coordinates?.[0] ?? baseCoordinates[0]);
    if (startCoord) {
      markers.push({
        type: 'start',
        title: 'Départ',
        name: 'Départ',
        coordinates: startCoord,
        labelColor: SEGMENT_MARKER_COLORS.start,
        icon: SEGMENT_MARKER_ICONS.start,
        segmentIndex: 0,
        order: 0
      });
    }

    for (let index = 0; index < resolvedSegments.length - 1; index += 1) {
      const current = resolvedSegments[index];
      const next = resolvedSegments[index + 1];
      const currentCoords = Array.isArray(current?.coordinates) ? current.coordinates : [];
      let boundary = cloneCoord(currentCoords[currentCoords.length - 1]);
      if (!boundary) {
        const nextCoords = Array.isArray(next?.coordinates) ? next.coordinates : [];
        boundary = cloneCoord(nextCoords[0]);
      }
      if (!boundary) {
        continue;
      }
      // Use the color of the NEXT segment (the day starting at this bivouac)
      const segmentColor = next?.color || current?.color || this.modeColors[this.currentMode];
      markers.push({
        type: 'bivouac',
        title: `Bivouac ${index + 1}`,
        name: `Bivouac ${index + 1}`,
        coordinates: boundary,
        labelColor: segmentColor,
        segmentColor: segmentColor,  // Store for icon coloring
        icon: SEGMENT_MARKER_ICONS.bivouac,
        segmentIndex: index + 1,
        order: index + 1
      });
    }

    const lastSegment = resolvedSegments[resolvedSegments.length - 1];
    const lastCoords = Array.isArray(lastSegment?.coordinates) ? lastSegment.coordinates : [];
    const hasDistinctEnd = () => {
      if (resolvedSegments.length > 1) {
        return true;
      }
      if (lastCoords.length >= 2) {
        return true;
      }
      return baseCoordinates.length >= 2;
    };
    const endCoord = cloneCoord(lastCoords[lastCoords.length - 1] ?? baseCoordinates[baseCoordinates.length - 1]);
    if (endCoord && hasDistinctEnd()) {
      markers.push({
        type: 'end',
        title: 'Arrivée',
        name: 'Arrivée',
        coordinates: endCoord,
        labelColor: SEGMENT_MARKER_COLORS.end,
        icon: SEGMENT_MARKER_ICONS.end,
        segmentIndex: resolvedSegments.length - 1,
        order: resolvedSegments.length
      });
    }

    const previewIndex = Number.isInteger(this.draggedBivouacIndex) ? this.draggedBivouacIndex : null;
    if (previewIndex !== null && Array.isArray(this.draggedBivouacLngLat)) {
      const [lng, lat] = this.draggedBivouacLngLat;
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        const targetOrder = previewIndex + 1;
        markers.forEach((marker) => {
          if (marker?.type !== 'bivouac') {
            return;
          }
          const order = Number.isFinite(marker.order)
            ? marker.order
            : Number(marker.segmentIndex);
          if (order === targetOrder) {
            marker.coordinates = [lng, lat];
          }
        });
      }
    }

    return markers;
  }

  getMarkerDistance(marker) {
    if (!marker || !this.routeProfile) {
      return null;
    }

    if (marker.type === 'start') {
      return 0;
    }

    if (marker.type === 'end') {
      return Number(this.routeProfile.totalDistanceKm) || 0;
    }

    if (marker.type === 'bivouac') {
      const segmentIndex = Number(marker.segmentIndex);
      if (Number.isInteger(segmentIndex) && segmentIndex > 0) {
        const nextSegment = this.cutSegments?.[segmentIndex];
        if (nextSegment && Number.isFinite(nextSegment.startKm)) {
          return Number(nextSegment.startKm);
        }
        const prevSegment = this.cutSegments?.[segmentIndex - 1];
        if (prevSegment && Number.isFinite(prevSegment.endKm)) {
          return Number(prevSegment.endKm);
        }
        const cutEntry = this.routeCutDistances?.[segmentIndex - 1];
        const cutValue = Number(cutEntry?.distanceKm ?? cutEntry);
        if (Number.isFinite(cutValue)) {
          return cutValue;
        }
      }
    }

    return null;
  }

  assignSegmentNames() {
    if (!Array.isArray(this.cutSegments) || !this.cutSegments.length) {
      return;
    }
    const markers = this.computeSegmentMarkers(this.cutSegments);
    if (markers.length < 2) {
      return;
    }
    this.cutSegments = this.cutSegments.map((segment, index) => {
      const startMarker = markers[index];
      const endMarker = markers[index + 1];
      let name = segment?.name ?? `Segment ${index + 1}`;
      const startTitle = startMarker?.title ?? '';
      const endTitle = endMarker?.title ?? '';
      if (startTitle && endTitle) {
        name = `${startTitle} → ${endTitle}`;
      } else if (endTitle) {
        name = endTitle;
      } else if (startTitle) {
        name = startTitle;
      }
      return {
        ...segment,
        name
      };
    });
  }

  updateSegmentMarkers() {
    const source = this.map.getSource(SEGMENT_MARKER_SOURCE_ID);
    if (!source) {
      return;
    }
    const markers = this.computeSegmentMarkers();
    // Cache markers for use in handleRouteSegmentHover to avoid recomputation
    this._cachedSegmentMarkers = markers;
    if (!markers.length) {
      source.setData(EMPTY_COLLECTION);
      return;
    }
    const features = markers
      .map((marker, index) => {
        const coords = Array.isArray(marker.coordinates) ? marker.coordinates.slice() : null;
        if (!coords || coords.length < 2) {
          return null;
        }

        // For bivouac markers, create a color-specific icon
        let iconId = marker.icon;
        if (marker.type === 'bivouac' && marker.segmentColor) {
          iconId = getOrCreateBivouacIcon(this.map, marker.segmentColor);
        }

        return {
          type: 'Feature',
          properties: {
            type: marker.type,
            title: marker.title,
            name: marker.name,
            labelColor: marker.labelColor,
            icon: iconId,
            order: marker.order ?? index,
            segmentIndex: marker.segmentIndex ?? index
          },
          geometry: {
            type: 'Point',
            coordinates: coords
          }
        };
      })
      .filter(Boolean);

    if (!features.length) {
      source.setData(EMPTY_COLLECTION);
      return;
    }

    source.setData({
      type: 'FeatureCollection',
      features
    });
  }

}
