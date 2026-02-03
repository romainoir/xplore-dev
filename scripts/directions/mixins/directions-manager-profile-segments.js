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


export class DirectionsManagerProfileSegmentsMixin {
  getSegmentMetadata(segment) {
    if (!segment || typeof segment !== 'object') {
      return null;
    }
    const rawMetadata = segment.metadata;
    const metadata = rawMetadata && !Array.isArray(rawMetadata) && typeof rawMetadata === 'object'
      ? rawMetadata
      : null;
    const metadataEntries = Array.isArray(rawMetadata)
      ? rawMetadata
        .map((entry) => (entry && typeof entry === 'object' ? entry : null))
        .filter(Boolean)
      : [];
    const distanceKm = Number(segment.distanceKm ?? metadata?.distanceKm);
    const startDistanceKm = Number(metadata?.startDistanceKm ?? metadata?.cumulativeStartKm ?? segment.startDistanceKm);
    const endDistanceKm = Number(metadata?.endDistanceKm ?? metadata?.cumulativeEndKm ?? segment.endDistanceKm);
    const ascent = Number(metadata?.ascent ?? segment.ascent ?? 0);
    const descent = Number(metadata?.descent ?? segment.descent ?? 0);
    const costMultiplier = Number(metadata?.costMultiplier);

    let sacScale = null;
    let sacRank = -Infinity;
    let category = null;
    let surface = null;
    let surfaceRank = -Infinity;
    let trailVisibility = null;
    let trailRank = -Infinity;

    const processEntry = (entry) => {
      if (!entry || typeof entry !== 'object') {
        return;
      }
      const hiking = entry.hiking && typeof entry.hiking === 'object' ? entry.hiking : null;
      const sacCandidates = [
        hiking?.sacScale,
        entry.sacScale,
        hiking?.category,
        entry.category,
        hiking?.difficulty,
        entry.difficulty
      ];
      sacCandidates.forEach((candidate) => {
        const normalizedSacScale = normalizeSacScale(candidate);
        if (!normalizedSacScale) {
          return;
        }
        const rank = SAC_SCALE_RANK[normalizedSacScale] || 0;
        if (rank > sacRank) {
          sacRank = rank;
          sacScale = normalizedSacScale;
          category = typeof candidate === 'string' && candidate ? candidate : normalizedSacScale;
        }
      });
      const normalizedSurface = normalizeSurfaceType(hiking?.surface ?? entry.surface);
      const normalizedTrail = normalizeTrailVisibility(hiking?.trailVisibility ?? entry.trailVisibility);
      if (normalizedSurface) {
        const rank = SURFACE_SEVERITY_RANK[normalizedSurface] || 0;
        if (rank > surfaceRank) {
          surfaceRank = rank;
          surface = normalizedSurface;
        }
      }
      if (normalizedTrail) {
        const rank = TRAIL_VISIBILITY_RANK[normalizedTrail] || 0;
        if (rank > trailRank) {
          trailRank = rank;
          trailVisibility = normalizedTrail;
        }
      }
    };

    metadataEntries.forEach(processEntry);
    if (metadata) {
      processEntry(metadata);
    }

    return {
      distanceKm: Number.isFinite(distanceKm) ? distanceKm : Math.max(0, (endDistanceKm ?? 0) - (startDistanceKm ?? 0)),
      startDistanceKm: Number.isFinite(startDistanceKm) ? startDistanceKm : null,
      endDistanceKm: Number.isFinite(endDistanceKm) ? endDistanceKm : null,
      ascent: Number.isFinite(ascent) ? ascent : 0,
      descent: Number.isFinite(descent) ? descent : 0,
      costMultiplier: Number.isFinite(costMultiplier) && costMultiplier > 0 ? costMultiplier : 1,
      source: metadata?.source ?? 'network',
      sacScale,
      category: category ? normalizeSacScale(category) ?? category : null,
      surface,
      trailVisibility
    };
  }

  /**
   * Compute smoothed grade for a segment by looking at a window around it
   * This reduces the noisy/fragmented appearance of slope colors
   */
  computeSegmentGrade(segment) {
    if (!segment) {
      return 0;
    }

    const segmentIndex = segment.index;
    const routeSegments = this.routeSegments;

    // If we have route segments and a valid index, use smoothed calculation
    if (Array.isArray(routeSegments) && Number.isInteger(segmentIndex) && segmentIndex >= 0) {
      // Smoothing window: look 50m before and after
      const smoothingDistanceKm = 0.05; // 50 meters
      const targetStartKm = (segment.startDistanceKm || 0) - smoothingDistanceKm;
      const targetEndKm = (segment.endDistanceKm || segment.startDistanceKm || 0) + smoothingDistanceKm;

      let totalElevationChange = 0;
      let totalDistanceM = 0;

      for (const seg of routeSegments) {
        if (!seg) continue;
        const segStartKm = seg.startDistanceKm || 0;
        const segEndKm = seg.endDistanceKm || segStartKm;

        // Check if this segment overlaps with our window
        if (segEndKm < targetStartKm || segStartKm > targetEndKm) continue;

        const startElev = seg.startElevation;
        const endElev = seg.endElevation;
        const distKm = seg.distanceKm || (segEndKm - segStartKm);

        if (Number.isFinite(startElev) && Number.isFinite(endElev) && distKm > 0) {
          totalElevationChange += (endElev - startElev);
          totalDistanceM += distKm * 1000;
        }
      }

      if (totalDistanceM > 10) { // Minimum 10m to avoid noise
        return (totalElevationChange / totalDistanceM) * 100;
      }
    }

    // Fallback to original calculation for single segment
    const distanceKm = Number(segment.distanceKm);
    const startElevation = Number(segment.startElevation);
    const endElevation = Number(segment.endElevation);
    const distanceMeters = Number.isFinite(distanceKm) ? distanceKm * 1000 : 0;
    if (!Number.isFinite(startElevation) || !Number.isFinite(endElevation) || !(distanceMeters > 0)) {
      const metadata = this.getSegmentMetadata(segment);
      const metadataDistanceKm = Number.isFinite(metadata?.distanceKm)
        ? metadata.distanceKm
        : Number(segment.distanceKm);
      const netElevation = (Number(metadata?.ascent) || 0) - (Number(metadata?.descent) || 0);
      if (Number.isFinite(metadataDistanceKm) && metadataDistanceKm > 0 && Number.isFinite(netElevation) && netElevation !== 0) {
        return (netElevation / (metadataDistanceKm * 1000)) * 100;
      }
      return 0;
    }
    return ((endElevation - startElevation) / distanceMeters) * 100;
  }

  classifySlopeSegment(segment) {
    const grade = this.computeSegmentGrade(segment);
    if (!Number.isFinite(grade)) {
      return null;
    }
    for (const entry of SLOPE_CLASSIFICATIONS) {
      const min = Number.isFinite(entry.minGrade) ? entry.minGrade : -Infinity;
      const max = Number.isFinite(entry.maxGrade) ? entry.maxGrade : Infinity;
      const lowerOk = min === -Infinity
        ? true
        : entry.minInclusive === false
          ? grade > min + GRADE_TOLERANCE
          : grade >= min - GRADE_TOLERANCE;
      const upperOk = max === Infinity
        ? true
        : entry.maxInclusive === true
          ? grade <= max + GRADE_TOLERANCE
          : grade < max - GRADE_TOLERANCE;
      if (lowerOk && upperOk) {
        return cloneClassificationEntry(entry);
      }
    }
    return cloneClassificationEntry(SLOPE_CLASSIFICATIONS[SLOPE_CLASSIFICATIONS.length - 1]);
  }

  classifySurfaceSegment(segment) {
    const metadata = this.getSegmentMetadata(segment);
    const surfaceTag = normalizeSurfaceType(metadata?.surface);
    if (surfaceTag) {
      for (const entry of SURFACE_CLASSIFICATIONS) {
        if (Array.isArray(entry.surfaceValues) && entry.surfaceValues.includes(surfaceTag)) {
          return cloneClassificationEntry(entry);
        }
      }
    }
    const multiplier = Number(metadata?.costMultiplier) || 1;
    for (const entry of SURFACE_CLASSIFICATIONS) {
      const min = Number.isFinite(entry.minMultiplier) ? entry.minMultiplier : -Infinity;
      const max = Number.isFinite(entry.maxMultiplier) ? entry.maxMultiplier : Infinity;
      const lowerOk = min === -Infinity
        ? true
        : entry.minInclusive === false
          ? multiplier > min + MULTIPLIER_TOLERANCE
          : multiplier >= min - MULTIPLIER_TOLERANCE;
      const upperOk = max === Infinity
        ? true
        : entry.maxInclusive === true
          ? multiplier <= max + MULTIPLIER_TOLERANCE
          : multiplier < max - MULTIPLIER_TOLERANCE;
      if (lowerOk && upperOk) {
        return cloneClassificationEntry(entry);
      }
    }
    return cloneClassificationEntry(SURFACE_CLASSIFICATIONS[SURFACE_CLASSIFICATIONS.length - 1]);
  }

  classifyCategorySegment(segment) {
    const metadata = this.getSegmentMetadata(segment);
    const hikingMetadata = metadata?.hiking && typeof metadata.hiking === 'object' ? metadata.hiking : null;
    const sacScale = resolveSacScale(
      metadata?.sacScale,
      metadata?.category,
      hikingMetadata?.sacScale,
      hikingMetadata?.category,
      hikingMetadata?.difficulty
    );
    if (sacScale) {
      for (const entry of CATEGORY_CLASSIFICATIONS) {
        if (Array.isArray(entry.sacScaleValues) && entry.sacScaleValues.includes(sacScale)) {
          return cloneClassificationEntry(entry);
        }
      }
    }
    return cloneClassificationEntry(UNKNOWN_CATEGORY_CLASSIFICATION);
  }

  classifySegment(segment) {
    if (!segment) {
      return null;
    }
    switch (this.profileMode) {
      case 'slope':
        return this.classifySlopeSegment(segment);
      case 'surface':
        return this.classifySurfaceSegment(segment);
      case 'category':
        return this.classifyCategorySegment(segment);
      case 'poi':
      case 'none':
      default:
        return null;
    }
  }

  getWaypointCoordinates() {
    if (!Array.isArray(this.waypoints)) {
      return [];
    }
    return this.waypoints.map((coord) => normalizeCoordinatePair(coord)).filter(Boolean);
  }

  segmentTouchesWaypoint(segment, waypointCoordinates = this.getWaypointCoordinates()) {
    if (!segment || !Array.isArray(waypointCoordinates) || !waypointCoordinates.length) {
      return false;
    }
    const start = Array.isArray(segment.start) ? segment.start : null;
    const end = Array.isArray(segment.end) ? segment.end : null;
    if (!start && !end) {
      return false;
    }
    return waypointCoordinates.some((waypoint) => {
      if (!Array.isArray(waypoint) || waypoint.length < 2) {
        return false;
      }
      if (start && this.coordinatesMatch(start, waypoint)) {
        return true;
      }
      return end ? this.coordinatesMatch(end, waypoint) : false;
    });
  }

  segmentsShareBoundary(first, second) {
    if (!first || !second) {
      return false;
    }
    const boundaries = [
      Array.isArray(first.start) ? first.start : null,
      Array.isArray(first.end) ? first.end : null
    ];
    const comparison = [
      Array.isArray(second.start) ? second.start : null,
      Array.isArray(second.end) ? second.end : null
    ];
    return boundaries.some((candidate) => {
      if (!candidate) {
        return false;
      }
      return comparison.some((other) => other && this.coordinatesMatch(candidate, other));
    });
  }

  resolveCategorySegmentEntries(segmentEntries) {
    if (!Array.isArray(segmentEntries) || !segmentEntries.length) {
      return Array.isArray(segmentEntries) ? segmentEntries : [];
    }

    const resolved = segmentEntries.map((entry) => {
      if (!entry) {
        return null;
      }
      const segment = entry.segment ?? null;
      const classification = entry.classification ? cloneClassificationEntry(entry.classification) : null;
      return { segment, classification };
    });

    const waypointCoordinates = this.getWaypointCoordinates();

    const findNeighborClassification = (startIndex, step) => {
      let index = startIndex + step;
      while (index >= 0 && index < resolved.length) {
        const candidate = resolved[index];
        if (!candidate || !candidate.segment) {
          index += step;
          continue;
        }
        const { classification } = candidate;
        if (!classification || isUnknownCategoryClassification(classification)) {
          index += step;
          continue;
        }
        return classification;
      }
      return null;
    };

    const assignClassification = (entry, classification) => {
      if (!entry || !classification) {
        return;
      }
      entry.classification = cloneClassificationEntry(classification);
    };

    resolved.forEach((entry, index) => {
      if (!entry || !entry.segment) {
        return;
      }
      const metadataSource = entry.segment?.metadata?.source;
      if (!isConnectorMetadataSource(metadataSource)) {
        return;
      }
      if (!isUnknownCategoryClassification(entry.classification)) {
        return;
      }
      const fallback = findNeighborClassification(index, -1) ?? findNeighborClassification(index, 1);
      if (fallback) {
        assignClassification(entry, fallback);
      }
    });

    if (waypointCoordinates.length) {
      resolved.forEach((entry, index) => {
        if (!entry || !entry.segment) {
          return;
        }
        const metadataSource = entry.segment?.metadata?.source;
        if (!isConnectorMetadataSource(metadataSource)) {
          return;
        }
        if (!isUnknownCategoryClassification(entry.classification)) {
          return;
        }
        if (!this.segmentTouchesWaypoint(entry.segment, waypointCoordinates)) {
          return;
        }
        const fallback = findNeighborClassification(index, -1) ?? findNeighborClassification(index, 1);
        if (fallback) {
          assignClassification(entry, fallback);
        }
      });
    }

    let updated = true;
    while (updated) {
      updated = false;
      resolved.forEach((entry, index) => {
        if (!entry || !entry.segment) {
          return;
        }
        const metadataSource = entry.segment?.metadata?.source;
        if (!isConnectorMetadataSource(metadataSource)) {
          return;
        }
        if (!isUnknownCategoryClassification(entry.classification)) {
          return;
        }
        const previous = index > 0 ? resolved[index - 1] : null;
        if (previous && previous.segment && !isUnknownCategoryClassification(previous.classification)
          && this.segmentsShareBoundary(entry.segment, previous.segment)) {
          assignClassification(entry, previous.classification);
          updated = true;
          return;
        }
        const next = index + 1 < resolved.length ? resolved[index + 1] : null;
        if (next && next.segment && !isUnknownCategoryClassification(next.classification)
          && this.segmentsShareBoundary(entry.segment, next.segment)) {
          assignClassification(entry, next.classification);
          updated = true;
        }
      });
    }

    return resolved;
  }

  updateProfileSegments() {
    if (this.profileMode === 'none'
      || this.profileMode === 'poi'
      || !Array.isArray(this.routeSegments)
      || !this.routeSegments.length) {
      this.profileSegments = [];
      this.updateRouteLineSource();
      return;
    }
    const segments = [];
    let current = null;
    const appendCoordinate = (list, coord) => {
      if (!Array.isArray(list) || !Array.isArray(coord) || coord.length < 2) {
        return;
      }
      const last = list[list.length - 1];
      if (last
        && Math.abs(last[0] - coord[0]) <= COORD_EPSILON
        && Math.abs(last[1] - coord[1]) <= COORD_EPSILON) {
        return;
      }
      list.push(coord);
    };

    let segmentEntries = this.routeSegments.map((segment) => {
      if (!segment) {
        return null;
      }
      return {
        segment,
        classification: this.classifySegment(segment) || null
      };
    });

    if (this.profileMode === 'category' && segmentEntries.length) {
      segmentEntries = this.resolveCategorySegmentEntries(segmentEntries);
    }

    segmentEntries.forEach((entry) => {
      if (!entry || !entry.segment) {
        return;
      }
      const { segment } = entry;
      const classification = entry.classification || {};
      const color = typeof classification.color === 'string' ? classification.color : this.modeColors[this.currentMode];
      const name = classification.label ?? '';
      const key = classification.key ?? `${this.profileMode}-default`;
      const startKm = Number(segment.startDistanceKm) || 0;
      const endKm = Number(segment.endDistanceKm) || startKm;
      const distanceKm = Math.max(0, endKm - startKm);
      const startCoord = Array.isArray(segment.start) ? segment.start.slice() : null;
      const endCoord = Array.isArray(segment.end) ? segment.end.slice() : null;
      if (!startCoord || startCoord.length < 2 || !endCoord || endCoord.length < 2) {
        return;
      }
      const zeroLengthSegment = distanceKm <= MIN_PROFILE_SEGMENT_DISTANCE_KM
        && Math.abs(startCoord[0] - endCoord[0]) <= COORD_EPSILON
        && Math.abs(startCoord[1] - endCoord[1]) <= COORD_EPSILON;
      if (zeroLengthSegment) {
        return;
      }
      if (!current || current.key !== key) {
        if (current) {
          if (Array.isArray(current.coordinates) && current.coordinates.length >= 2) {
            segments.push(current);
          }
        }
        const coordinates = [];
        appendCoordinate(coordinates, startCoord);
        appendCoordinate(coordinates, endCoord);
        current = {
          key,
          color,
          name,
          startKm,
          endKm,
          distanceKm,
          coordinates,
          index: segments.length
        };
        return;
      }
      current.endKm = endKm;
      current.distanceKm += distanceKm;
      appendCoordinate(current.coordinates, endCoord);
    });
    if (current && Array.isArray(current.coordinates) && current.coordinates.length >= 2) {
      segments.push(current);
    }
    this.profileSegments = segments.map((entry, index) => ({
      ...entry,
      index,
      coordinates: entry.coordinates.filter((coord) => Array.isArray(coord) && coord.length >= 2)
    })).filter((entry) => entry.coordinates.length >= 2);
    this.updateRouteLineSource();
  }

  getProfileSegmentForDistance(distanceKm) {
    if (!Array.isArray(this.profileSegments) || !this.profileSegments.length) {
      return null;
    }
    const epsilon = 1e-6;
    return this.profileSegments.find((segment, index) => {
      if (!segment) {
        return false;
      }
      const startKm = Number(segment.startKm ?? 0);
      const endKm = Number(segment.endKm ?? startKm);
      if (index === this.profileSegments.length - 1) {
        return distanceKm >= startKm - epsilon && distanceKm <= endKm + epsilon;
      }
      return distanceKm >= startKm - epsilon && distanceKm < endKm - epsilon * 0.5;
    }) ?? null;
  }

}
