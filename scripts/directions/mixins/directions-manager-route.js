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
import { fetchWikimediaPhotosInBounds, getPhotoThumbnailUrl } from '../../map/wikimedia-photos.js';

export class DirectionsManagerRouteMixin {
  setRoutePointsOfInterest(pois) {
    this.routePointsOfInterest = Array.isArray(pois) ? pois : [];
    this.updateRoutePoiData();
    this.updateRoutePoiLayerVisibility();
    // Re-render route stats to show POIs in the "Points d'intérêt" section
    // This is needed because POIs are loaded asynchronously after initial stats render
    if (this.latestMetrics) {
      // Clear the cache to force re-render with updated POI data
      this._lastSummaryStatsKey = null;
      this.renderRouteStatsSummary(this.latestMetrics);
    }
  }

  updateRoutePoiData() {
    if (!this.map || typeof this.map.getSource !== 'function') {
      return;
    }
    const source = this.map.getSource(ROUTE_POI_SOURCE_ID);
    if (!source || typeof source.setData !== 'function') {
      return;
    }
    const pois = Array.isArray(this.routePointsOfInterest) ? this.routePointsOfInterest : [];
    if (!pois.length) {
      source.setData(EMPTY_COLLECTION);
      return;
    }

    // Collect all unique icon keys
    const iconKeys = new Set();
    pois.forEach((poi) => {
      const iconKey = typeof poi?.iconKey === 'string' ? poi.iconKey.trim() : '';
      if (iconKey) {
        iconKeys.add(iconKey);
      }
    });

    // Build features - trust that icons are already loaded or will be soon
    const buildFeatures = () => {
      return pois
        .map((poi) => {
          if (!poi) {
            return null;
          }
          const coords = Array.isArray(poi.coordinates) ? poi.coordinates : null;
          if (!coords || coords.length < 2) {
            return null;
          }
          const lng = Number(coords[0]);
          const lat = Number(coords[1]);
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
            return null;
          }
          const name = typeof poi.name === 'string' ? poi.name.trim() : '';
          const title = typeof poi.title === 'string' ? poi.title : name;
          const iconImageId = typeof poi.iconImageId === 'string' ? poi.iconImageId.trim() : '';
          const iconDisplayScale = Number(poi.iconDisplayScale);

          // Check if the image is registered
          const hasIcon = Boolean(iconImageId && this.map.hasImage(iconImageId));

          return {
            type: 'Feature',
            properties: {
              id: poi.id ?? null,
              title: title || '',
              name,
              categoryKey: poi.categoryKey ?? '',
              color: typeof poi.color === 'string' && poi.color.trim() ? poi.color.trim() : DEFAULT_POI_COLOR,
              showLabel: Boolean(poi.showLabel && name),
              iconImageId: hasIcon ? iconImageId : '',
              iconDisplayScale: hasIcon && Number.isFinite(iconDisplayScale) && iconDisplayScale > 0
                ? iconDisplayScale
                : 1,
              hasIcon
            },
            geometry: {
              type: 'Point',
              coordinates: [lng, lat]
            }
          };
        })
        .filter(Boolean);
    };

    // Set data immediately (icons may show as circles if not yet loaded)
    const features = buildFeatures();
    source.setData(features.length ? { type: 'FeatureCollection', features } : EMPTY_COLLECTION);

    // If we have icon keys, load them in background and refresh when done
    if (iconKeys.size) {
      ensurePoiIconImages(this.map, Array.from(iconKeys)).then(() => {
        // Re-build features now that icons are loaded
        const updatedFeatures = buildFeatures();
        source.setData(updatedFeatures.length ? { type: 'FeatureCollection', features: updatedFeatures } : EMPTY_COLLECTION);
      }).catch((error) => {
        console.warn('[POI Layer] Icon loading failed:', error);
      });
    }
  }

  updateRoutePoiLayerVisibility() {
    if (!this.map || typeof this.map.getLayer !== 'function' || typeof this.map.setLayoutProperty !== 'function') {
      return;
    }
    const hasPois = Array.isArray(this.routePointsOfInterest) && this.routePointsOfInterest.length > 0;
    const shouldShow = this.profileMode === 'poi' && hasPois;
    const visibility = shouldShow ? 'visible' : 'none';

    [ROUTE_POI_LAYER_ID, ROUTE_POI_ICON_LAYER_ID, ROUTE_POI_LABEL_LAYER_ID].forEach((layerId) => {
      if (this.map.getLayer(layerId)) {
        try {
          this.map.setLayoutProperty(layerId, 'visibility', visibility);
        } catch (error) {
          console.warn('Failed to set POI layer visibility', layerId, error);
        }
      }
    });
  }

  /**
   * Update POI colors and icons to match current day segments.
   * Called when bivouacs are added/removed/moved.
   */
  updatePoiDayColors() {
    if (!Array.isArray(this.routePointsOfInterest) || !this.routePointsOfInterest.length) {
      return;
    }

    const segments = Array.isArray(this.cutSegments) ? this.cutSegments : [];
    const defaultColor = this.modeColors?.[this.currentMode] || '#f8b40b';

    // Re-assign day colors and icon IDs
    this.routePointsOfInterest.forEach((poi) => {
      if (!poi || !Number.isFinite(poi.distanceKm)) return;

      // Find which day segment this POI belongs to
      let dayIndex = 0;
      const segment = segments.find((seg, idx) => {
        const start = Number(seg.startKm ?? seg.startDistanceKm ?? 0);
        const end = Number(seg.endKm ?? seg.endDistanceKm ?? start);
        if (poi.distanceKm >= start && poi.distanceKm <= end) {
          dayIndex = idx; // Segment index directly maps to day color index
          return true;
        }
        return false;
      });

      // Update color
      poi.color = segment?.color || defaultColor;

      // Update icon image ID
      const iconKey = typeof poi.iconKey === 'string' ? poi.iconKey.trim() : '';
      if (iconKey) {
        poi.iconImageId = getPoiIconImageIdForDay(iconKey, dayIndex);
      }
    });

    // Refresh the map layer data
    this.updateRoutePoiData();
  }

  getCoordinateAtDistance(distanceKm) {
    if (!this.routeProfile || !Array.isArray(this.routeSegments) || !this.routeSegments.length) {
      return null;
    }
    const totalDistance = Number(this.routeProfile.totalDistanceKm) || 0;
    if (!Number.isFinite(distanceKm)) {
      return null;
    }
    if (distanceKm <= 0) {
      const start = this.routeProfile.coordinates?.[0];
      return Array.isArray(start) ? [...start] : null;
    }
    if (distanceKm >= totalDistance) {
      const end = this.routeProfile.coordinates?.[this.routeProfile.coordinates.length - 1];
      return Array.isArray(end) ? [...end] : null;
    }

    const segmentIndex = this.findSegmentIndexByDistance(distanceKm);
    const segment = Number.isInteger(segmentIndex) ? this.routeSegments?.[segmentIndex] : null;
    if (!segment) {
      const fallback = this.routeProfile.coordinates?.[this.routeProfile.coordinates.length - 1];
      return Array.isArray(fallback) ? [...fallback] : null;
    }

    const startDistance = Number(segment.startDistanceKm) || 0;
    const segmentDistance = Number(segment.distanceKm) || 0;
    const relative = Number(distanceKm) - startDistance;
    const t = segmentDistance > 0 ? Math.max(0, Math.min(1, relative / segmentDistance)) : 0;
    return this.interpolateSegmentCoordinate(segment, t, distanceKm);
  }

  extractCoordinatesBetween(startKm, endKm) {
    if (!this.routeProfile || !Array.isArray(this.routeProfile.coordinates)) {
      return [];
    }

    const coordinates = this.routeProfile.coordinates;
    const distances = this.routeProfile.cumulativeDistances ?? [];
    const result = [];
    const tolerance = 1e-6;

    const pushUnique = (coord) => {
      if (!Array.isArray(coord) || coord.length < 2) {
        return;
      }
      const clone = coord.slice();
      if (!result.length) {
        result.push(clone);
        return;
      }

      const last = result[result.length - 1];
      const lngDelta = Math.abs((last?.[0] ?? 0) - (clone?.[0] ?? 0));
      const latDelta = Math.abs((last?.[1] ?? 0) - (clone?.[1] ?? 0));
      const withinCoordinateEpsilon = lngDelta <= COORD_EPSILON && latDelta <= COORD_EPSILON;

      let withinDistanceTolerance = false;
      if (!withinCoordinateEpsilon) {
        const separationKm = this.computeDistanceKm(last, clone);
        withinDistanceTolerance = Number.isFinite(separationKm) && separationKm <= 0.0005;
      }

      if (!withinCoordinateEpsilon && !withinDistanceTolerance) {
        result.push(clone);
      }
    };

    const startCoord = this.getCoordinateAtDistance(startKm);
    if (startCoord) {
      pushUnique(startCoord);
    }

    for (let index = 0; index < coordinates.length; index += 1) {
      const distance = Number(distances[index]);
      if (!Number.isFinite(distance)) {
        continue;
      }
      if (distance > startKm + tolerance && distance < endKm - tolerance) {
        pushUnique(coordinates[index]);
      }
    }

    const endCoord = this.getCoordinateAtDistance(endKm);
    if (endCoord) {
      pushUnique(endCoord);
    }

    return result;
  }

  updateRouteCutSegments() {
    if (!this.routeProfile || !Array.isArray(this.routeProfile.coordinates) || this.routeProfile.coordinates.length < 2) {
      this.cutSegments = [];
      this.updateSegmentMarkers();
      return;
    }

    const boundaries = this.computeCutBoundaries();
    if (boundaries.length < 2) {
      this.cutSegments = [];
      this.updateSegmentMarkers();
      return;
    }

    const segments = [];
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const startKm = boundaries[index];
      const endKm = boundaries[index + 1];
      if (!Number.isFinite(startKm) || !Number.isFinite(endKm) || endKm - startKm <= 1e-6) {
        continue;
      }
      const coords = this.extractCoordinatesBetween(startKm, endKm);
      if (!Array.isArray(coords) || coords.length < 2) {
        continue;
      }
      const segmentIndex = segments.length;
      segments.push({
        index: segmentIndex,
        startKm,
        endKm,
        distanceKm: endKm - startKm,
        coordinates: coords,
        color: this.getSegmentColor(segmentIndex),
        name: `Segment ${segmentIndex + 1}`
      });
    }

    for (let index = 1; index < segments.length; index += 1) {
      const previous = segments[index - 1];
      const current = segments[index];
      if (!previous || !current) {
        continue;
      }
      const prevCoords = previous.coordinates;
      const currentCoords = current.coordinates;
      if (!Array.isArray(prevCoords) || !prevCoords.length || !Array.isArray(currentCoords) || !currentCoords.length) {
        continue;
      }
      const boundaryKm = current.startKm;
      let shared = Number.isFinite(boundaryKm) ? this.getCoordinateAtDistance(boundaryKm) : null;
      if (!Array.isArray(shared) || shared.length < 2) {
        const fallback = prevCoords[prevCoords.length - 1] ?? currentCoords[0];
        shared = Array.isArray(fallback) ? fallback.slice() : null;
      }
      if (Array.isArray(shared) && shared.length >= 2) {
        prevCoords[prevCoords.length - 1] = shared.slice();
        currentCoords[0] = shared.slice();
      }
    }

    this.cutSegments = segments;
    this.assignSegmentNames();
    this.updateSegmentMarkers();
    // Update manual route overlay colors to match day segment colors
    this.updateManualRouteSource();
  }

  buildExportFeatureCollection() {
    if (!Array.isArray(this.cutSegments) || !this.cutSegments.length) {
      const markers = this.computeSegmentMarkers();
      const waypointFeatures = (this.waypoints || []).map((coord, idx) => {
        if (!Array.isArray(coord) || coord.length < 2) return null;

        // Match with computed markers (start, bivouac, end)
        const marker = markers.find(m => this.coordinatesMatch(m.coordinates, coord));

        return {
          type: 'Feature',
          properties: {
            name: marker?.name || (idx === 0 ? 'Départ' : (idx === this.waypoints.length - 1 ? 'Arrivée' : `Waypoint ${idx}`)),
            marker_type: marker?.type || 'via',
            segmentIndex: marker?.segmentIndex ?? null,
            color: marker?.labelColor || null,
            source: 'waypoint'
          },
          geometry: {
            type: 'Point',
            coordinates: coord.slice()
          }
        };
      }).filter(Boolean);

      const trackFeatures = [];
      if (this.routeGeojson && this.routeGeojson.geometry) {
        trackFeatures.push({
          type: 'Feature',
          properties: {
            ...this.routeGeojson.properties,
            source: 'track',
            name: this.routeGeojson.properties?.name || 'Route'
          },
          geometry: JSON.parse(JSON.stringify(this.routeGeojson.geometry))
        });
      }

      const features = [...trackFeatures, ...waypointFeatures];
      if (!features.length) {
        return EMPTY_COLLECTION;
      }
      return {
        type: 'FeatureCollection',
        features
      };
    }

    const markers = this.computeSegmentMarkers(this.cutSegments);

    const trackFeatures = this.cutSegments
      .map((segment) => {
        if (!segment || !Array.isArray(segment.coordinates) || segment.coordinates.length < 2) {
          return null;
        }
        const startKm = Number(segment.startKm ?? 0);
        const endKm = Number(segment.endKm ?? 0);
        const distanceKm = Number.isFinite(segment.distanceKm)
          ? Number(segment.distanceKm)
          : Number(endKm - startKm);
        const startMarker = Number.isInteger(segment.index) ? markers?.[segment.index] : null;
        const endMarker = Number.isInteger(segment.index) ? markers?.[segment.index + 1] : null;
        let segmentName = segment.name ?? `Segment ${segment.index + 1}`;
        const startTitle = startMarker?.title ?? '';
        const endTitle = endMarker?.title ?? '';
        if (startTitle && endTitle) {
          segmentName = `${startTitle} → ${endTitle}`;
        } else if (endTitle) {
          segmentName = endTitle;
        } else if (startTitle) {
          segmentName = startTitle;
        }
        return {
          type: 'Feature',
          properties: {
            name: segmentName,
            segmentIndex: segment.index,
            start_km: Number.isFinite(startKm) ? Number(startKm.toFixed(3)) : 0,
            end_km: Number.isFinite(endKm) ? Number(endKm.toFixed(3)) : 0,
            distance_km: Number.isFinite(distanceKm) ? Number(distanceKm.toFixed(3)) : 0,
            color: segment.color ?? null,
            source: 'track'
          },
          geometry: {
            type: 'LineString',
            coordinates: segment.coordinates.map((coord) => coord.slice())
          }
        };
      })
      .filter(Boolean);

    // Export ALL waypoints to ensure route reconstruction is perfect
    const waypointFeatures = (this.waypoints || []).map((coord, idx) => {
      if (!Array.isArray(coord) || coord.length < 2) return null;

      // Check if this waypoint is a bivouac
      const marker = markers.find(m => this.coordinatesMatch(m.coordinates, coord));

      return {
        type: 'Feature',
        properties: {
          name: marker?.name || (idx === 0 ? 'Départ' : (idx === this.waypoints.length - 1 ? 'Arrivée' : `Waypoint ${idx}`)),
          marker_type: marker?.type || 'via',
          segmentIndex: marker?.segmentIndex ?? null,
          color: marker?.labelColor || null,
          source: 'waypoint'
        },
        geometry: {
          type: 'Point',
          coordinates: coord.slice()
        }
      };
    }).filter(Boolean);

    const features = [...trackFeatures, ...waypointFeatures];
    if (!features.length) {
      return EMPTY_COLLECTION;
    }

    return {
      type: 'FeatureCollection',
      features
    };
  }

  async saveCurrentRoute(name) {
    if (!this.routeLibraryManager) {
      console.warn("RouteLibraryManager not initialized.");
      throw new Error("Library not available");
    }

    const geojson = this.buildExportFeatureCollection();
    if (!geojson || !geojson.features || geojson.features.length === 0) {
      throw new Error("No route to save");
    }

    // Ensure metrics are up to date
    const route = this.getRoute();
    let metrics = this.latestMetrics;

    // Fallback if metrics are missing or incomplete
    if (!metrics || (!metrics.totalDistanceKm && !metrics.distanceKm)) {
      metrics = this.calculateRouteMetrics(route);
    }

    const distanceKm = metrics.totalDistanceKm ?? metrics.distanceKm ?? 0;
    const ascent = metrics.elevationGain ?? metrics.ascent ?? 0;
    const descent = metrics.elevationLoss ?? metrics.descent ?? 0;

    // Estimate duration if missing
    let durationMinutes = metrics.durationMinutes || (metrics.duration / 60);
    if (!durationMinutes) {
      const durationHours = this.estimateTravelTimeHours(distanceKm, ascent, descent);
      durationMinutes = durationHours * 60;
    }

    // Calculate Difficulty
    const difficulty = this.computeDayDifficulty(distanceKm, ascent, descent, 0, distanceKm);

    // Extract Segments for Sparkline Colors
    let segments = [];
    if (Array.isArray(this.cutSegments) && this.cutSegments.length > 0) {
      segments = this.cutSegments.map(seg => ({
        startKm: Number(seg.startKm ?? seg.startDistanceKm ?? 0),
        endKm: Number(seg.endKm ?? seg.endDistanceKm ?? 0),
        color: seg.color || this.modeColors[this.currentMode] || '#f8b40b'
      }));
    } else {
      // Single segment
      segments.push({
        startKm: 0,
        endKm: distanceKm,
        color: this.modeColors[this.currentMode] || '#f8b40b'
      });
    }

    // Build Stats Object
    const stats = {
      distanceKm,
      elevationGain: ascent,
      elevationLoss: descent,
      durationMinutes,
      days: (Array.isArray(this.cutSegments) && this.cutSegments.length > 1) ? this.cutSegments.length : 1,
      color: this.modeColors[this.currentMode], // Main route color
      difficulty: {
        score: difficulty.score,
        level: difficulty.level
      },
      segments // Save segments for coloring
    };

    // Find highest point and fetch a Wikimedia Photo for the background
    try {
      let maxEle = -Infinity;
      let highestPoint = null;

      // Use the geojson features we already built to find the highest point
      geojson.features.forEach(f => {
        const processCoords = (coords) => {
          for (const c of coords) {
            if (Array.isArray(c) && c.length > 2 && c[2] > maxEle) {
              maxEle = c[2];
              highestPoint = c;
            }
          }
        };

        if (f.geometry.type === 'LineString') {
          processCoords(f.geometry.coordinates);
        } else if (f.geometry.type === 'MultiLineString') {
          f.geometry.coordinates.forEach(processCoords);
        }
      });

      if (highestPoint) {
        // Fetch photos around highest point (bbox ~5km for better chance of finding one)
        const lat = highestPoint[1];
        const lon = highestPoint[0];
        const delta = 0.05; // approx 5km radius
        const bounds = {
          getNorth: () => lat + delta,
          getSouth: () => lat - delta,
          getEast: () => lon + delta,
          getWest: () => lon - delta
        };

        const photoCollection = await fetchWikimediaPhotosInBounds(bounds);
        if (photoCollection?.features?.length > 0) {
          // Sort by distance to highest point to get the closest one
          const photos = photoCollection.features
            .map(f => {
              const d = haversineDistanceMeters([lon, lat], f.geometry.coordinates);
              return { ...f, distance: d };
            })
            .sort((a, b) => a.distance - b.distance);

          const photo = photos[0];
          stats.imageUrl = getPhotoThumbnailUrl(photo.properties.fileName, 600);
          console.log(`Found background photo for route near highest point: ${photo.properties.title}`);
        }
      }
    } catch (photoErr) {
      console.warn("Failed to fetch route background photo", photoErr);
    }

    // Generate high-fidelity simplified profile for library sparkline (sample by distance)
    let elevationProfile = [];
    if (this.routeProfile && Array.isArray(this.routeProfile.coordinates) && Array.isArray(this.routeProfile.cumulativeDistances)) {
      const coords = this.routeProfile.coordinates;
      const dists = this.routeProfile.cumulativeDistances;
      const totalDist = Number(this.routeProfile.totalDistanceKm) || 0;
      const samples = 500; // High-fidelity for smooth curves

      if (coords.length > 0 && totalDist > 0) {
        const step = totalDist / (samples - 1);
        let cursor = 0;
        for (let i = 0; i < samples; i++) {
          const targetD = i * step;
          while (cursor < coords.length - 1 && dists[cursor + 1] < targetD) {
            cursor++;
          }
          const ele = coords[cursor].length > 2 ? coords[cursor][2] : 0;
          elevationProfile.push(Math.round(ele));
        }
      } else if (coords.length > 0) {
        // Fallback for zero-length routes
        elevationProfile = [Math.round(coords[0][2] || 0), Math.round(coords[0][2] || 0)];
      }
    }
    stats.elevationProfile = elevationProfile;

    const routeData = {
      id: this.currentRouteId, // Maintain same ID if updated
      name: name || `Route ${new Date().toLocaleDateString()}`,
      geojson,
      stats,
      tags: ['saved']
    };

    return this.routeLibraryManager.saveRoute(routeData);
  }

  buildSegmentExportCollections() {
    if (!Array.isArray(this.cutSegments) || !this.cutSegments.length) {
      return [];
    }

    const markers = this.computeSegmentMarkers(this.cutSegments);
    if (!markers.length) {
      return [];
    }

    const collections = this.cutSegments.map((segment, index) => {
      if (!segment || !Array.isArray(segment.coordinates) || segment.coordinates.length < 2) {
        return null;
      }

      const coordinates = segment.coordinates.map((coord) => coord.slice());
      if (coordinates.length < 2) {
        return null;
      }

      const startMarker = markers[index];
      const endMarker = markers[index + 1];
      const startKm = Number(segment.startKm ?? 0);
      const endKm = Number(segment.endKm ?? 0);
      const distanceKm = Number.isFinite(segment.distanceKm)
        ? Number(segment.distanceKm)
        : Number(endKm - startKm);
      const segmentName = segment.name ?? `Segment ${index + 1}`;

      const features = [
        {
          type: 'Feature',
          properties: {
            name: segmentName,
            segmentIndex: segment.index,
            start_km: Number.isFinite(startKm) ? Number(startKm.toFixed(3)) : 0,
            end_km: Number.isFinite(endKm) ? Number(endKm.toFixed(3)) : 0,
            distance_km: Number.isFinite(distanceKm) ? Number(distanceKm.toFixed(3)) : 0,
            color: segment.color ?? null,
            source: 'track'
          },
          geometry: {
            type: 'LineString',
            coordinates
          }
        }
      ];

      const appendMarker = (marker) => {
        const coords = Array.isArray(marker?.coordinates) ? marker.coordinates.slice() : null;
        if (!coords || coords.length < 2) {
          return;
        }
        const key = `${coords[0].toFixed(6)},${coords[1].toFixed(6)},${marker?.type ?? ''}`;
        if (!appendMarker.cache.has(key)) {
          appendMarker.cache.add(key);
          features.push({
            type: 'Feature',
            properties: {
              name: marker?.name ?? marker?.title ?? '',
              marker_type: marker?.type ?? null,
              segmentIndex: marker?.segmentIndex ?? null,
              color: marker?.labelColor ?? null,
              source: 'waypoint'
            },
            geometry: {
              type: 'Point',
              coordinates: coords
            }
          });
        }
      };
      appendMarker.cache = new Set();

      appendMarker(startMarker);
      appendMarker(endMarker);

      return {
        name: segmentName,
        index,
        collection: {
          type: 'FeatureCollection',
          features
        }
      };
    }).filter(Boolean);

    return collections;
  }

  generateRouteLineGradientExpression(segments) {
    if (!Array.isArray(segments) || !segments.length) {
      return null;
    }

    const totalDistanceKm = segments.reduce((sum, segment) => {
      const value = Number(segment?.distanceKm);
      if (!Number.isFinite(value) || value <= 0) {
        return sum;
      }
      return sum + value;
    }, 0);

    if (!Number.isFinite(totalDistanceKm) || totalDistanceKm <= 0) {
      return null;
    }

    const clamp01 = (value) => {
      if (!Number.isFinite(value)) {
        return 0;
      }
      if (value <= 0) {
        return 0;
      }
      if (value >= 1) {
        return 1;
      }
      return value;
    };

    const stops = [];
    let traversed = 0;
    let previousColor = null;
    let previousNormalizedColor = null;

    segments.forEach((segment, index) => {
      if (!segment) {
        return;
      }
      const color = typeof segment.color === 'string' ? segment.color : null;
      const normalizedColor = typeof segment.normalizedColor === 'string' ? segment.normalizedColor : null;
      const segmentDistance = Number(segment.distanceKm);
      const distanceKm = Number.isFinite(segmentDistance) && segmentDistance > 0 ? segmentDistance : 0;
      const blendPortion = clamp01(Number(segment.blendPortion));
      const startRatio = traversed / totalDistanceKm;
      const endRatio = (traversed + distanceKm) / totalDistanceKm;
      const clampedStart = clamp01(startRatio);
      const clampedEnd = clamp01(endRatio);

      if (index === 0) {
        if (color) {
          stops.push({ offset: 0, color });
        }
      } else if (color && normalizedColor && previousColor && previousNormalizedColor && previousNormalizedColor !== normalizedColor) {
        stops.push({ offset: clampedStart, color: previousColor });
        if (blendPortion > 0 && distanceKm > 0) {
          const blendDistance = Math.min(distanceKm * blendPortion, distanceKm);
          const blendOffset = clamp01((traversed + blendDistance) / totalDistanceKm);
          if (blendOffset > clampedStart) {
            stops.push({ offset: blendOffset, color });
          } else {
            stops.push({ offset: clampedStart, color });
          }
        } else {
          stops.push({ offset: clampedStart, color });
        }
      }

      if (color) {
        if (distanceKm > 0) {
          stops.push({ offset: clampedEnd, color });
        } else if (!stops.length || stops[stops.length - 1].color !== color) {
          stops.push({ offset: clampedStart, color });
        }
      }

      traversed += distanceKm;
      previousColor = color ?? previousColor;
      previousNormalizedColor = normalizedColor ?? previousNormalizedColor;
    });

    if (!stops.length) {
      return null;
    }

    const normalizedStops = [];
    let lastOffset = null;

    stops
      .filter((stop) => stop && typeof stop.color === 'string')
      .forEach((stop) => {
        const color = stop.color.trim();
        if (!color) {
          return;
        }
        const offset = clamp01(stop.offset);
        if (lastOffset !== null && Math.abs(offset - lastOffset) <= 1e-6) {
          if (normalizedStops.length) {
            normalizedStops[normalizedStops.length - 1].color = color;
          }
          lastOffset = offset;
          return;
        }
        lastOffset = offset;
        normalizedStops.push({ offset, color });
      });

    if (!normalizedStops.length) {
      return null;
    }

    const firstStop = normalizedStops[0];
    if (firstStop.offset !== 0) {
      normalizedStops.unshift({ offset: 0, color: firstStop.color });
    }

    const lastStop = normalizedStops[normalizedStops.length - 1];
    if (lastStop.offset !== 1) {
      normalizedStops.push({ offset: 1, color: lastStop.color });
    }

    if (normalizedStops.length < 2) {
      return null;
    }

    const expression = ['interpolate', ['linear'], ['line-progress']];
    normalizedStops.forEach((stop) => {
      expression.push(clamp01(stop.offset));
      expression.push(stop.color);
    });

    return expression;
  }

  getRouteLineGradientExpression() {
    if (!Array.isArray(this.routeLineGradientExpression) || this.routeLineGradientExpression.length <= 4) {
      return null;
    }
    return this.routeLineGradientExpression;
  }

  isLineGradientUnsupportedError(error) {
    if (!error || typeof error.message !== 'string') {
      return false;
    }
    return error.message.includes('line-gradient') || error.message.includes('lineMetrics');
  }

  disableRouteLineGradient() {
    if (!this.routeLineGradientSupported) {
      return;
    }
    this.routeLineGradientSupported = false;
    this.routeLineGradientExpression = null;
    if (this.map.getLayer('route-line')) {
      try {
        this.map.setPaintProperty('route-line', 'line-gradient', null);
      } catch (setError) {
        // Ignore failures when clearing unsupported properties.
      }
    }
    const source = this.map.getSource('route-line-source');
    if (source) {
      source.setData(this.routeLineFallbackData ?? EMPTY_COLLECTION);
    }
  }

  setRouteLineGradient() {
    if (!this.routeLineGradientSupported || !this.map.getLayer('route-line')) {
      return;
    }
    try {
      this.map.setPaintProperty('route-line', 'line-gradient', this.getRouteLineGradientExpression());
    } catch (error) {
      if (this.isLineGradientUnsupportedError(error)) {
        this.disableRouteLineGradient();
      } else {
        throw error;
      }
    }
  }

  updateRouteLineSource() {
    const source = this.map.getSource('route-line-source');
    if (!source) {
      return;
    }

    // Move route layers to top to prevent occlusion by custom terrain layers
    if (typeof this.moveRouteLayersToTop === 'function') {
      this.moveRouteLayersToTop();
    }

    const displaySegments = Array.isArray(this.profileSegments) && this.profileSegments.length
      ? this.profileSegments
      : this.cutSegments;

    // Compute overlap offsets for the entire route (cached to avoid recomputation)
    const routeCoordinates = this.routeGeojson?.geometry?.coordinates ?? [];

    // Build cache key from coordinate count and first/last points for quick comparison
    const coordCount = routeCoordinates.length;
    const firstCoord = routeCoordinates[0];
    const lastCoord = routeCoordinates[coordCount - 1];
    const overlapCacheKey = coordCount > 0
      ? `${coordCount}:${firstCoord?.[0]?.toFixed(6)},${firstCoord?.[1]?.toFixed(6)}:${lastCoord?.[0]?.toFixed(6)},${lastCoord?.[1]?.toFixed(6)}`
      : '';

    // Use cached result if route hasn't changed
    let overlapResult;
    if (this._overlapCacheKey === overlapCacheKey && this._cachedOverlapResult) {
      overlapResult = this._cachedOverlapResult;
    } else {
      overlapResult = computeRouteOverlapOffsets(routeCoordinates);
      this._overlapCacheKey = overlapCacheKey;
      this._cachedOverlapResult = overlapResult;
    }

    const overlapOffsets = overlapResult.offsets;
    this.routeOverlapOffsets = overlapOffsets;
    this.routeOverlapMarkers = overlapResult.isOverlap;

    // Apply geometric offset to route coordinates for overlapping sections
    const offsetRouteCoordinates = geometricOffsetCoordinates(routeCoordinates, overlapOffsets);

    const allowGradient = isProfileGradientMode(this.profileMode);
    const useBaseColor = this.profileMode === 'none' && displaySegments !== this.cutSegments;
    const fallbackColor = this.modeColors[this.currentMode];
    const normalizeColor = (value) => {
      if (typeof value !== 'string') {
        return null;
      }
      const trimmed = value.trim();
      return trimmed.length ? trimmed : null;
    };

    const fallbackFeatures = [];
    const normalizedSegments = [];

    const waypointCoordinates = this.getWaypointCoordinates();
    const waypointMatchCache = new Map();
    const coordinatesNearWaypoint = (candidate) => {
      if (!waypointCoordinates.length) {
        return false;
      }
      const normalized = normalizeCoordinatePair(candidate);
      if (!normalized) {
        return false;
      }
      const [lng, lat] = normalized;
      const cacheKey = `${lng.toFixed(6)},${lat.toFixed(6)}`;
      if (waypointMatchCache.has(cacheKey)) {
        return waypointMatchCache.get(cacheKey);
      }
      const matches = waypointCoordinates.some((waypoint) => this.coordinatesMatch(waypoint, normalized));
      waypointMatchCache.set(cacheKey, matches);
      return matches;
    };

    let previousColorValue = null;

    const coordinateDistanceKm = (coords) => {
      if (!Array.isArray(coords) || coords.length < 2) {
        return 0;
      }
      let totalMeters = 0;
      for (let index = 1; index < coords.length; index += 1) {
        const segmentDistance = haversineDistanceMeters(coords[index - 1], coords[index]);
        if (Number.isFinite(segmentDistance) && segmentDistance > 0) {
          totalMeters += segmentDistance;
        }
      }
      return totalMeters / 1000;
    };

    // Helper to compute average offset for a segment's coordinates
    // and return the geometrically offset coordinates
    const computeSegmentOffsetAndCoords = (segmentCoords) => {
      if (!segmentCoords?.length || !overlapOffsets?.length || !routeCoordinates?.length) {
        return { offset: 0, offsetCoords: segmentCoords };
      }

      // Build array of offsets for this segment's coordinates
      const segmentOffsets = new Float32Array(segmentCoords.length);
      let totalOffset = 0;
      let matchCount = 0;

      for (let k = 0; k < segmentCoords.length; k++) {
        const coord = segmentCoords[k];
        if (!Array.isArray(coord) || coord.length < 2) continue;

        // Find closest matching coordinate in main route
        for (let i = 0; i < routeCoordinates.length; i++) {
          const routeCoord = routeCoordinates[i];
          if (!Array.isArray(routeCoord) || routeCoord.length < 2) continue;
          if (Math.abs(coord[0] - routeCoord[0]) < COORD_EPSILON * 10 &&
            Math.abs(coord[1] - routeCoord[1]) < COORD_EPSILON * 10) {
            const offset = overlapOffsets[i] ?? 0;
            segmentOffsets[k] = offset;
            if (offset !== 0) {
              totalOffset += offset;
              matchCount++;
            }
            break;
          }
        }
      }

      const avgOffset = matchCount > 0 ? totalOffset / matchCount : 0;

      // Apply geometric offset to segment coordinates
      const offsetCoords = geometricOffsetCoordinates(segmentCoords, segmentOffsets);

      return { offset: avgOffset, offsetCoords };
    };

    if (Array.isArray(displaySegments)) {
      displaySegments.forEach((segment) => {
        if (!segment) {
          return;
        }
        if (segment.routingMode === 'manual') {
          return;
        }

        const coordinates = Array.isArray(segment.coordinates)
          ? segment.coordinates.map((coord) => (Array.isArray(coord) ? coord.slice() : null)).filter(Boolean)
          : [];
        if (coordinates.length < 2) {
          return;
        }

        const segmentColorValue = normalizeColor(useBaseColor ? fallbackColor : segment.color) ?? fallbackColor;
        const normalizedCurrent = segmentColorValue.toLowerCase();
        const normalizedPrevious = typeof previousColorValue === 'string'
          ? previousColorValue.toLowerCase()
          : null;

        let startKm = Number(segment.startKm);
        if (!Number.isFinite(startKm)) {
          startKm = Number(segment.startDistanceKm);
        }
        let endKm = Number(segment.endKm);
        if (!Number.isFinite(endKm)) {
          endKm = Number(segment.endDistanceKm);
        }

        let distanceKm = Number(segment.distanceKm);
        if (!Number.isFinite(distanceKm)) {
          if (Number.isFinite(startKm) && Number.isFinite(endKm)) {
            distanceKm = Math.max(0, endKm - startKm);
          } else {
            distanceKm = coordinateDistanceKm(coordinates);
          }
        }
        if (!Number.isFinite(distanceKm) || distanceKm < 0) {
          distanceKm = 0;
        }

        const previousSegmentEntry = normalizedSegments[normalizedSegments.length - 1];
        const boundaryNearWaypoint = (() => {
          if (!allowGradient || useBaseColor || !previousSegmentEntry) {
            return false;
          }
          if (!waypointCoordinates.length) {
            return false;
          }
          const previousCoords = Array.isArray(previousSegmentEntry.coordinates)
            ? previousSegmentEntry.coordinates
            : [];
          const previousEnd = previousCoords.length ? previousCoords[previousCoords.length - 1] : null;
          const currentStart = coordinates.length ? coordinates[0] : null;
          return coordinatesNearWaypoint(currentStart) || coordinatesNearWaypoint(previousEnd);
        })();

        let blendPortion = 0;
        const shouldBlend = allowGradient
          && !useBaseColor
          && normalizedPrevious
          && normalizedPrevious !== normalizedCurrent
          && !boundaryNearWaypoint;
        if (shouldBlend) {
          if (distanceKm > 0) {
            const ratio = ROUTE_GRADIENT_BLEND_DISTANCE_KM / Math.max(distanceKm, ROUTE_GRADIENT_BLEND_DISTANCE_KM);
            blendPortion = Math.min(0.4, Math.max(0.05, ratio));
          } else {
            blendPortion = 0.2;
          }
        }

        // Compute offset and geometrically offset coordinates for this segment
        const { offset: segmentOffset, offsetCoords } = computeSegmentOffsetAndCoords(coordinates);

        fallbackFeatures.push({
          type: 'Feature',
          properties: {
            color: segmentColorValue,
            segmentIndex: segment.index,
            name: segment.name,
            startKm: Number.isFinite(startKm) ? startKm : null,
            endKm: Number.isFinite(endKm) ? endKm : null,
            offset: segmentOffset
          },
          geometry: {
            type: 'LineString',
            coordinates: offsetCoords
          }
        });

        normalizedSegments.push({
          coordinates: offsetCoords,
          color: segmentColorValue,
          normalizedColor: normalizedCurrent,
          distanceKm,
          blendPortion
        });

        previousColorValue = segmentColorValue;
      });
    }

    this.routeLineFallbackData = fallbackFeatures.length
      ? {
        type: 'FeatureCollection',
        features: fallbackFeatures
      }
      : EMPTY_COLLECTION;

    const gradientCoordinates = [];
    normalizedSegments.forEach((segment) => {
      if (!Array.isArray(segment.coordinates)) {
        return;
      }
      segment.coordinates.forEach((coord, index) => {
        if (!Array.isArray(coord) || coord.length < 2) {
          return;
        }
        if (gradientCoordinates.length && index === 0) {
          const last = gradientCoordinates[gradientCoordinates.length - 1];
          if (last
            && Math.abs(last[0] - coord[0]) <= COORD_EPSILON
            && Math.abs(last[1] - coord[1]) <= COORD_EPSILON) {
            return;
          }
        }
        gradientCoordinates.push(coord);
      });
    });

    if (allowGradient) {
      this.routeLineGradientExpression = this.generateRouteLineGradientExpression(normalizedSegments);

      this.routeLineGradientData = gradientCoordinates.length >= 2 && this.routeLineGradientExpression
        ? {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: gradientCoordinates
              }
            }
          ]
        }
        : EMPTY_COLLECTION;
    } else {
      this.routeLineGradientExpression = null;
      this.routeLineGradientData = EMPTY_COLLECTION;
    }

    // Use gradient mode when available and supported
    // Geometric offset is now applied to coordinates, so works for all modes
    const shouldUseGradient = allowGradient
      && this.routeLineGradientSupported
      && Array.isArray(this.routeLineGradientExpression)
      && this.routeLineGradientExpression.length > 4
      && this.routeLineGradientData?.features?.length;

    const targetData = shouldUseGradient ? this.routeLineGradientData : this.routeLineFallbackData;

    // Time the MapLibre setData call
    const setDataStart = performance.now();
    source.setData(targetData ?? EMPTY_COLLECTION);
    const setDataTime = performance.now() - setDataStart;

    // Log if setData is slow (> 5ms)
    if (setDataTime > 5) {
      console.log('%c[MapLibre setData]', 'color: #FF5722; font-weight: bold', {
        'source': 'route-line-source',
        'time': `${setDataTime.toFixed(1)}ms`,
        'features': targetData?.features?.length || 0,
        'coords': gradientCoordinates?.length || 0
      });
    }

    if (this.routeLineGradientSupported) {
      this.setRouteLineGradient();
    }

    this.updateSegmentMarkers();
  }

  updateCutDisplays() {
    // Reset day selection when bivouacs change to avoid inconsistent state
    this.selectedDayIndex = null;

    // Phase 1: Update map visuals immediately (fast operations)
    this.updateRouteCutSegments();
    this.updateRouteLineSource();
    this.updateWaypoints();
    this.notifyRouteSegmentsUpdated();

    // Phase 2: Defer heavy DOM updates to next frame for smoother UX
    const deferHeavyUpdates = () => {
      const coordinates = this.routeGeojson?.geometry?.coordinates ?? [];
      this.updateElevationProfile(coordinates);
      this.updateDistanceMarkers(this.routeGeojson);

      // Refresh route stats panel to update day tabs after bivouac changes
      this._lastSummaryStatsKey = null; // Clear cache to force re-render
      if (this.routeGeojson) {
        this.updateStats(this.routeGeojson);
      }

      // Update POI icon colors to match new day segments
      this.updatePoiDayColors();
    };

    // Use requestAnimationFrame to defer heavy operations
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(deferHeavyUpdates);
    } else {
      deferHeavyUpdates();
    }
  }

  getCutSegmentForDistance(distanceKm) {
    if (!Array.isArray(this.cutSegments) || !this.cutSegments.length) {
      return null;
    }
    const epsilon = 1e-6;
    return this.cutSegments.find((segment, index) => {
      const start = Number(segment.startKm ?? 0);
      const end = Number(segment.endKm ?? start);
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return false;
      }
      if (index === this.cutSegments.length - 1) {
        return distanceKm >= start - epsilon && distanceKm <= end + epsilon;
      }
      return distanceKm >= start - epsilon && distanceKm < end - epsilon * 0.5;
    }) ?? null;
  }

  getColorForDistance(distanceKm) {
    if (!Number.isFinite(distanceKm)) {
      return this.modeColors[this.currentMode];
    }
    if (this.profileMode === 'none') {
      const cutSegment = this.getCutSegmentForDistance(distanceKm);
      if (cutSegment?.color) {
        return cutSegment.color;
      }
      return this.modeColors[this.currentMode];
    }
    const profileSegment = this.getProfileSegmentForDistance(distanceKm);
    if (profileSegment?.color) {
      return profileSegment.color;
    }
    const segment = this.getCutSegmentForDistance(distanceKm);
    if (segment?.color) {
      return segment.color;
    }
    return this.modeColors[this.currentMode];
  }

  projectOntoRoute(lngLat, tolerance = ROUTE_CLICK_PIXEL_TOLERANCE) {
    if (!Array.isArray(this.routeSegments) || !this.routeSegments.length) {
      return null;
    }

    const mousePixel = this.map.project(lngLat);
    let closest = null;
    let minDistance = Infinity;
    const maxTolerance = Number.isFinite(tolerance) ? tolerance : HOVER_PIXEL_TOLERANCE;

    this.routeSegments.forEach((segment, index) => {
      const startPixel = this.map.project(toLngLat(segment.start));
      const endPixel = this.map.project(toLngLat(segment.end));
      const distance = this.pointToSegmentDistance(mousePixel, startPixel, endPixel);
      if (distance <= maxTolerance && distance < minDistance) {
        minDistance = distance;
        closest = { segment, index };
      }
    });

    if (!closest) {
      return null;
    }

    const projection = this.projectPointOnSegment(lngLat, closest.segment.start, closest.segment.end);
    const segmentDistance = Number(closest.segment.distanceKm) || 0;
    const startDistance = Number(closest.segment.startDistanceKm) || 0;
    const relative = Number.isFinite(projection.t) ? projection.t * segmentDistance : 0;
    const distanceKm = startDistance + relative;

    return {
      segmentIndex: closest.index,
      distanceKm,
      projection: { ...projection, distanceKm }
    };
  }

  async snapLngLatToNetwork(lngLat) {
    if (!lngLat || !this.router) {
      return null;
    }

    const lng = Number(lngLat.lng);
    const lat = Number(lngLat.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return null;
    }

    try {
      if (typeof this.router.ensureReady === 'function') {
        await this.router.ensureReady();
      }
    } catch (error) {
      console.warn('Failed to ensure offline router readiness for waypoint snapping', error);
      return null;
    }

    const coord = [lng, lat];
    let snap = null;
    if (typeof this.router.findNearestPoint === 'function') {
      snap = this.router.findNearestPoint(coord);
    } else if (this.router.pathFinder?.findNearestPoint) {
      snap = this.router.pathFinder.findNearestPoint(coord);
    }

    if (!snap || !Array.isArray(snap.point) || snap.point.length < 2) {
      return null;
    }

    const distanceMeters = Number(snap.distanceMeters);
    const maxSnapDistance = Number(this.router.maxSnapDistanceMeters);
    if (Number.isFinite(maxSnapDistance) && Number.isFinite(distanceMeters) && distanceMeters > maxSnapDistance) {
      return null;
    }

    const snappedLng = Number(snap.point[0]);
    const snappedLat = Number(snap.point[1]);
    if (!Number.isFinite(snappedLng) || !Number.isFinite(snappedLat)) {
      return null;
    }

    return [snappedLng, snappedLat];
  }

  snapshotWaypoints() {
    if (!Array.isArray(this.waypoints)) {
      return [];
    }
    return this.waypoints.map((coord) => (Array.isArray(coord) ? coord.slice() : coord));
  }

  normalizeWaypointForLog(coord) {
    if (!Array.isArray(coord) || coord.length < 2) {
      return null;
    }
    const lng = Number(coord[0]);
    const lat = Number(coord[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return null;
    }
    const roundedLng = Math.round(lng * 1e6) / 1e6;
    const roundedLat = Math.round(lat * 1e6) / 1e6;
    return {
      raw: [lng, lat],
      rounded: [roundedLng, roundedLat],
      string: `[${roundedLng.toFixed(6)}, ${roundedLat.toFixed(6)}]`
    };
  }

  collectViaWaypointEntries(list) {
    const result = new Map();
    if (!Array.isArray(list) || list.length < 3) {
      return result;
    }
    for (let index = 1; index < list.length - 1; index += 1) {
      const normalized = this.normalizeWaypointForLog(list[index]);
      if (normalized) {
        result.set(index, { ...normalized, index });
      }
    }
    return result;
  }

  buildWaypointLogSummary(list) {
    if (!Array.isArray(list) || !list.length) {
      return [];
    }

    const total = list.length;
    let viaOrder = 0;
    const roundPixel = (value) => (Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null);

    return list
      .map((coord, index) => {
        const normalized = this.normalizeWaypointForLog(coord);
        if (!normalized) {
          return null;
        }

        const [rawLng, rawLat] = normalized.raw;
        let role = 'via';
        let label = '';
        let id = '';
        let order = 0;

        if (index === 0) {
          role = 'start';
          label = 'Départ';
          id = 'start';
        } else if (index === total - 1) {
          role = 'end';
          label = 'Arrivée';
          id = 'end';
        } else {
          viaOrder += 1;
          role = 'via';
          order = viaOrder;
          label = `Via ${viaOrder}`;
          id = `via-${viaOrder}`;
        }

        const projected =
          this.map && typeof this.map.project === 'function'
            ? this.map.project(new maplibregl.LngLat(rawLng, rawLat))
            : null;

        return {
          index,
          role,
          id,
          label,
          order,
          lng: normalized.rounded[0],
          lat: normalized.rounded[1],
          rawLng,
          rawLat,
          x: roundPixel(projected?.x),
          y: roundPixel(projected?.y)
        };
      })
      .filter(Boolean);
  }

  buildWaypointListEntries(summary = []) {
    if (!Array.isArray(summary) || !summary.length) {
      return [];
    }

    return summary
      .map((item, index) => {
        if (!item) {
          return null;
        }

        const waypointNumber = index + 1;
        const rawLng = Number(item.rawLng);
        const rawLat = Number(item.rawLat);
        const hasValidCoordinates = Number.isFinite(rawLng) && Number.isFinite(rawLat);
        const coordinateText = hasValidCoordinates
          ? `[${rawLng.toFixed(6)}, ${rawLat.toFixed(6)}]`
          : null;
        const roleLabel = typeof item.label === 'string' && item.label.length ? item.label : item.role;
        const descriptionBase = `Waypoint ${waypointNumber}`;
        const descriptionRole = roleLabel ? ` (${roleLabel})` : '';
        const description = hasValidCoordinates
          ? `${descriptionBase}${descriptionRole}: ${coordinateText}`
          : `${descriptionBase}${descriptionRole}`;

        return {
          waypoint: `Waypoint ${waypointNumber}`,
          index: item.index,
          role: item.role,
          label: roleLabel,
          coordinates: hasValidCoordinates ? [rawLng, rawLat] : null,
          coordinatesText: coordinateText,
          description
        };
      })
      .filter(Boolean);
  }

  haveWaypointSummariesChanged(previous = [], next = []) {
    if (!Array.isArray(previous) || !Array.isArray(next)) {
      return true;
    }

    if (previous.length !== next.length) {
      return true;
    }

    for (let index = 0; index < previous.length; index += 1) {
      const prev = previous[index];
      const nextItem = next[index];
      if (!prev || !nextItem) {
        return true;
      }

      if (prev.id !== nextItem.id || prev.role !== nextItem.role) {
        return true;
      }

      const lngDelta = Math.abs((prev.rawLng ?? 0) - (nextItem.rawLng ?? 0));
      const latDelta = Math.abs((prev.rawLat ?? 0) - (nextItem.rawLat ?? 0));
      if (Number.isFinite(lngDelta) && Number.isFinite(latDelta)) {
        if (lngDelta > COORD_EPSILON || latDelta > COORD_EPSILON) {
          return true;
        }
      }
    }

    return false;
  }

  buildBivouacLogSummary(distances) {
    if (!Array.isArray(distances) || !distances.length) {
      return [];
    }

    if (!turfApi) {
      return [];
    }

    const geometry = this.routeGeojson?.geometry;
    const coordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates : null;
    if (!coordinates || coordinates.length < 2) {
      return [];
    }

    const totalDistance = Number(this.routeProfile?.totalDistanceKm);
    if (!Number.isFinite(totalDistance) || totalDistance <= ROUTE_CUT_EPSILON_KM) {
      return [];
    }

    const roundPixel = (value) => (Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null);

    return distances
      .map((value, index) => {
        const distanceKm = Number(value);
        if (!Number.isFinite(distanceKm)) {
          return null;
        }

        const clamped = Math.max(0, Math.min(distanceKm, totalDistance));
        let coords = null;

        try {
          const point = turfApi.along(geometry, clamped, { units: 'kilometers' });
          coords = Array.isArray(point?.geometry?.coordinates) ? point.geometry.coordinates : null;
        } catch (error) {
          console.warn('Failed to compute bivouac position', error);
          return null;
        }

        if (!coords || coords.length < 2) {
          return null;
        }

        const lng = Number(coords[0]);
        const lat = Number(coords[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
          return null;
        }

        const roundedLng = Math.round(lng * 1e6) / 1e6;
        const roundedLat = Math.round(lat * 1e6) / 1e6;
        const projected =
          this.map && typeof this.map.project === 'function'
            ? this.map.project(new maplibregl.LngLat(lng, lat))
            : null;

        return {
          order: index + 1,
          id: `bivouac-${index + 1}`,
          label: `Bivouac ${index + 1}`,
          distanceKm: Math.round(clamped * 1000) / 1000,
          originalDistanceKm: Math.round(distanceKm * 1000) / 1000,
          lng: roundedLng,
          lat: roundedLat,
          rawLng: lng,
          rawLat: lat,
          x: roundPixel(projected?.x),
          y: roundPixel(projected?.y)
        };
      })
      .filter(Boolean);
  }

  haveBivouacSummariesChanged(previous = [], next = []) {
    if (!Array.isArray(previous) || !Array.isArray(next)) {
      return true;
    }

    if (previous.length !== next.length) {
      return true;
    }

    for (let index = 0; index < previous.length; index += 1) {
      const prev = previous[index];
      const nextItem = next[index];
      if (!prev || !nextItem) {
        return true;
      }

      if (prev.id !== nextItem.id) {
        return true;
      }

      const lngDelta = Math.abs((prev.rawLng ?? 0) - (nextItem.rawLng ?? 0));
      const latDelta = Math.abs((prev.rawLat ?? 0) - (nextItem.rawLat ?? 0));
      if (Number.isFinite(lngDelta) && Number.isFinite(latDelta)) {
        if (lngDelta > COORD_EPSILON || latDelta > COORD_EPSILON) {
          return true;
        }
      }

      const distanceDelta = Math.abs((prev.distanceKm ?? 0) - (nextItem.distanceKm ?? 0));
      if (Number.isFinite(distanceDelta) && distanceDelta > ROUTE_CUT_EPSILON_KM / 10) {
        return true;
      }
    }

    return false;
  }

  areLoggedWaypointsEqual(previous, next) {
    if (!previous || !next) {
      return false;
    }

    const prevRaw = Array.isArray(previous.raw) ? previous.raw : null;
    const nextRaw = Array.isArray(next.raw) ? next.raw : null;
    if (prevRaw && nextRaw) {
      const lngDelta = Math.abs(prevRaw[0] - nextRaw[0]);
      const latDelta = Math.abs(prevRaw[1] - nextRaw[1]);
      if (Number.isFinite(lngDelta) && Number.isFinite(latDelta) && lngDelta <= COORD_EPSILON && latDelta <= COORD_EPSILON) {
        return true;
      }
    }

    if (Array.isArray(previous.rounded) && Array.isArray(next.rounded)) {
      if (previous.rounded[0] === next.rounded[0] && previous.rounded[1] === next.rounded[1]) {
        return true;
      }
    }

    if (typeof previous.string === 'string' && typeof next.string === 'string') {
      return previous.string === next.string;
    }

    return false;
  }

  computeWaypointDeltaMeters(previous, next) {
    if (!previous?.raw || !next?.raw || !turfApi) {
      return null;
    }

    try {
      const distance = turfApi.distance(
        turfApi.point(previous.raw),
        turfApi.point(next.raw),
        { units: 'meters' }
      );
      if (Number.isFinite(distance)) {
        return Math.round(distance * 100) / 100;
      }
    } catch (error) {
      console.warn('Failed to compute waypoint delta distance', error);
    }

    return null;
  }

  snapWaypointsToRoute() {
    if (!Array.isArray(this.waypoints) || this.waypoints.length < 2) {
      return false;
    }

    const normalizeCoord = (coord) => {
      if (!Array.isArray(coord) || coord.length < 2) {
        return null;
      }
      const lng = Number(coord[0]);
      const lat = Number(coord[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return null;
      }
      const elevation = coord.length > 2 && Number.isFinite(coord[2]) ? Number(coord[2]) : null;
      return Number.isFinite(elevation) ? [lng, lat, elevation] : [lng, lat];
    };

    const normalizedWaypoints = this.waypoints.map((coord) => normalizeCoord(coord) ?? coord);
    const routeCoords = Array.isArray(this.routeProfile?.coordinates)
      ? this.routeProfile.coordinates.filter((coord) => Array.isArray(coord) && coord.length >= 2)
      : [];

    const shouldSnapToRoute = this.currentMode !== 'manual' && routeCoords.length >= 2;
    const applyCoordinateUpdate = (coord, index) => {
      if (!Array.isArray(coord) || coord.length < 2) {
        return false;
      }
      const current = this.waypoints[index];
      const hasComparableCurrent = Array.isArray(current) && current.length >= 2;
      const lengthChanged = !Array.isArray(current) || current.length !== coord.length;
      const differs = hasComparableCurrent ? !this.coordinatesMatch(current, coord) : true;
      if (lengthChanged || differs) {
        this.waypoints[index] = coord.slice();
        return true;
      }
      return false;
    };

    let changed = false;

    if (shouldSnapToRoute) {
      const toleranceMeters = Math.max(75, WAYPOINT_MATCH_TOLERANCE_METERS || 0);
      const lastWaypointIndex = normalizedWaypoints.length - 1;
      let searchStartIndex = 0;

      normalizedWaypoints.forEach((waypoint, index) => {
        if (!Array.isArray(waypoint) || waypoint.length < 2) {
          return;
        }

        let targetCoord = null;
        if (index === 0) {
          targetCoord = routeCoords[0];
          searchStartIndex = 0;
        } else if (index === lastWaypointIndex) {
          targetCoord = routeCoords[routeCoords.length - 1];
        } else {
          let bestIndex = null;
          let bestDistance = Infinity;
          for (let routeIndex = searchStartIndex; routeIndex < routeCoords.length; routeIndex += 1) {
            const candidate = routeCoords[routeIndex];
            if (!Array.isArray(candidate) || candidate.length < 2) {
              continue;
            }
            const distance = this.computeCoordinateDistanceMeters(waypoint, candidate);
            if (!Number.isFinite(distance)) {
              continue;
            }
            if (distance < bestDistance) {
              bestDistance = distance;
              bestIndex = routeIndex;
            }
            if (distance <= toleranceMeters) {
              break;
            }
          }

          if (bestIndex !== null) {
            targetCoord = routeCoords[bestIndex];
            searchStartIndex = bestIndex;
          }
        }

        const normalizedTarget = normalizeCoord(targetCoord) ?? waypoint;
        if (applyCoordinateUpdate(normalizedTarget, index)) {
          changed = true;
        }
      });

      return changed;
    }

    normalizedWaypoints.forEach((coord, index) => {
      if (applyCoordinateUpdate(normalizeCoord(coord) ?? coord, index)) {
        changed = true;
      }
    });

    return changed;
  }

  addRouteCut(distanceKm, coordinates = null) {
    if (!this.routeProfile) {
      return;
    }

    const totalDistance = Number(this.routeProfile.totalDistanceKm) || 0;
    if (!Number.isFinite(distanceKm) || !Number.isFinite(totalDistance) || totalDistance <= ROUTE_CUT_EPSILON_KM) {
      return;
    }

    const clamped = Math.max(0, Math.min(totalDistance, distanceKm));
    if (clamped <= ROUTE_CUT_EPSILON_KM || totalDistance - clamped <= ROUTE_CUT_EPSILON_KM) {
      return;
    }

    const exists = Array.isArray(this.routeCutDistances) && this.routeCutDistances.some((cut) => {
      const value = Number(cut?.distanceKm ?? cut);
      return Number.isFinite(value) && Math.abs(value - clamped) <= ROUTE_CUT_EPSILON_KM / 2;
    });
    if (exists) {
      return;
    }

    this.recordWaypointState();
    let targetCoordinates = null;
    if (Array.isArray(coordinates) && coordinates.length >= 2) {
      targetCoordinates = coordinates;
    } else {
      targetCoordinates = this.getCoordinateAtDistance(clamped);
    }
    const lng = Number(targetCoordinates?.[0]);
    const lat = Number(targetCoordinates?.[1]);
    const nextCuts = Array.isArray(this.routeCutDistances) ? [...this.routeCutDistances] : [];
    nextCuts.push({
      distanceKm: clamped,
      lng: Number.isFinite(lng) ? lng : null,
      lat: Number.isFinite(lat) ? lat : null
    });
    this.setRouteCutDistances(nextCuts);
    this.updateCutDisplays();
  }

  removeBivouacCut(index) {
    if (!Array.isArray(this.routeCutDistances) || !this.routeCutDistances.length) {
      return;
    }

    if (!Number.isInteger(index) || index < 0 || index >= this.routeCutDistances.length) {
      return;
    }

    this.recordWaypointState();
    const nextCuts = [...this.routeCutDistances];
    nextCuts.splice(index, 1);
    this.setRouteCutDistances(nextCuts);
    this.updateCutDisplays();
  }

  mirrorRouteCutsForReversedRoute() {
    if (!this.routeProfile || !Array.isArray(this.routeCutDistances) || !this.routeCutDistances.length) {
      return;
    }

    const totalDistance = Number(this.routeProfile.totalDistanceKm);
    if (!Number.isFinite(totalDistance) || totalDistance <= ROUTE_CUT_EPSILON_KM) {
      return;
    }

    const mirrored = Array.isArray(this.routeCutDistances)
      ? this.routeCutDistances
        .map((entry) => this.normalizeRouteCutEntry(entry))
        .filter((entry) => entry && Number.isFinite(entry.distanceKm))
        .map((entry) => ({
          distanceKm: totalDistance - entry.distanceKm,
          lng: Number.isFinite(entry.lng) ? entry.lng : null,
          lat: Number.isFinite(entry.lat) ? entry.lat : null
        }))
        .filter((entry) => entry.distanceKm > ROUTE_CUT_EPSILON_KM
          && totalDistance - entry.distanceKm > ROUTE_CUT_EPSILON_KM)
        .sort((a, b) => a.distanceKm - b.distanceKm)
      : [];

    this.setRouteCutDistances(mirrored);
  }

  updateDraggedBivouac(distanceKm, coordinates = null) {
    if (this.draggedBivouacIndex === null) {
      return;
    }
    if (!this.routeProfile || !Array.isArray(this.routeCutDistances) || !this.routeCutDistances.length) {
      return;
    }

    const index = this.draggedBivouacIndex;
    if (index < 0 || index >= this.routeCutDistances.length) {
      return;
    }

    const totalDistance = Number(this.routeProfile.totalDistanceKm) || 0;
    if (!Number.isFinite(totalDistance) || totalDistance <= ROUTE_CUT_EPSILON_KM) {
      return;
    }

    const prevEntry = index > 0 ? this.routeCutDistances[index - 1] : null;
    const nextEntry = index < this.routeCutDistances.length - 1 ? this.routeCutDistances[index + 1] : null;
    const prevDistance = index > 0 ? Number(prevEntry?.distanceKm ?? prevEntry) : 0;
    const nextDistance = index < this.routeCutDistances.length - 1
      ? Number(nextEntry?.distanceKm ?? nextEntry)
      : totalDistance;
    if ((index > 0 && !Number.isFinite(prevDistance))
      || (index < this.routeCutDistances.length - 1 && !Number.isFinite(nextDistance))) {
      return;
    }

    const minDistance = index > 0 ? prevDistance + ROUTE_CUT_EPSILON_KM : ROUTE_CUT_EPSILON_KM;
    const maxDistance = index < this.routeCutDistances.length - 1
      ? nextDistance - ROUTE_CUT_EPSILON_KM
      : totalDistance - ROUTE_CUT_EPSILON_KM;
    if (maxDistance <= minDistance) {
      return;
    }

    const clamped = Math.max(minDistance, Math.min(maxDistance, distanceKm));
    if (!Number.isFinite(clamped)) {
      return;
    }

    const currentEntry = this.routeCutDistances[index];
    const currentDistance = Number(currentEntry?.distanceKm ?? currentEntry);
    const hasCoordinateUpdate = Array.isArray(coordinates) && coordinates.length >= 2;
    if (!hasCoordinateUpdate && Number.isFinite(currentDistance) && Math.abs(currentDistance - clamped) <= 1e-5) {
      return;
    }

    let targetCoordinates = null;
    if (hasCoordinateUpdate) {
      targetCoordinates = coordinates;
    } else {
      targetCoordinates = this.getCoordinateAtDistance(clamped);
    }
    const lng = Number(targetCoordinates?.[0]);
    const lat = Number(targetCoordinates?.[1]);

    const nextCuts = [...this.routeCutDistances];
    nextCuts[index] = {
      distanceKm: clamped,
      lng: Number.isFinite(lng) ? lng : null,
      lat: Number.isFinite(lat) ? lat : null
    };
    this.setRouteCutDistances(nextCuts);
    this.updateCutDisplays();
  }

  finishBivouacDrag(lngLat) {
    const previewLngLat = Array.isArray(this.draggedBivouacLngLat)
      ? this.draggedBivouacLngLat
      : null;
    let target = null;

    const hasDraggedCut = Number.isInteger(this.draggedBivouacIndex)
      && this.draggedBivouacIndex >= 0
      && Array.isArray(this.routeCutDistances)
      && this.routeCutDistances.length > this.draggedBivouacIndex;
    if (hasDraggedCut) {
      this.recordWaypointState();
    }

    if (lngLat && Number.isFinite(lngLat.lng) && Number.isFinite(lngLat.lat)) {
      target = lngLat;
    } else if (Array.isArray(lngLat) && lngLat.length >= 2) {
      target = toLngLat(lngLat);
    } else if (previewLngLat) {
      target = toLngLat(previewLngLat);
    }

    if (target) {
      const projection = this.projectOntoRoute(target, Number.MAX_SAFE_INTEGER);
      if (projection && Number.isFinite(projection.distanceKm)) {
        const projectedCoordinates = projection.projection?.coordinates;
        this.updateDraggedBivouac(projection.distanceKm, projectedCoordinates);
      } else {
        this.updateCutDisplays();
      }
    } else {
      this.updateCutDisplays();
    }

    this.draggedBivouacLngLat = null;
    this.updateSegmentMarkers();
  }

  onRouteContextMenu(event) {
    // Skip if waypoint context menu was already handled
    if (this._waypointContextMenuHandled) {
      this._waypointContextMenuHandled = false;
      return;
    }

    if (!event?.point || !Array.isArray(this.routeSegments) || !this.routeSegments.length) {
      return;
    }

    const projection = this.projectOntoRoute(event.lngLat, ROUTE_CLICK_PIXEL_TOLERANCE);
    if (!projection || !Number.isFinite(projection.distanceKm)) {
      return;
    }

    event.preventDefault?.();
    event.originalEvent?.preventDefault?.();

    this.addRouteCut(projection.distanceKm, projection.projection?.coordinates);
  }

}
