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


export class DirectionsManagerInteractionsMixin {
  isPanelVisible() {
    return Boolean(this.directionsControl?.classList.contains('visible'));
  }

  setPanelVisible(shouldShow) {
    const visible = Boolean(shouldShow);
    console.log('[DirectionsManager] setPanelVisible:', visible, {
      control: !!this.directionsControl,
      toggle: !!this.directionsToggle,
      dock: !!this.directionsDock
    });
    if (this.directionsControl) {
      this.directionsControl.classList.toggle('visible', visible);
    }
    if (this.directionsToggle) {
      this.directionsToggle.classList.toggle('active', visible);
    }
    this.updatePanelVisibilityState();

    // Show/hide routing start tooltip based on visibility and waypoints
    this.updateRoutingStartTooltip();
  }

  updateRoutingStartTooltip() {
    const tooltip = document.getElementById('routingStartTooltip');
    if (!tooltip) return;

    const shouldShow = this.isPanelVisible() && (!Array.isArray(this.waypoints) || this.waypoints.length === 0);
    tooltip.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
  }

  updatePanelVisibilityState() {
    const isVisible = this.isPanelVisible();
    if (this.directionsToggle) {
      this.directionsToggle.setAttribute('aria-expanded', isVisible ? 'true' : 'false');
    }
    if (this.directionsControl) {
      this.directionsControl.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
    }
    if (this.directionsDock) {
      this.directionsDock.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
    }
    if (this.routeStats) {
      this.routeStats.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
    }
    this.updateElevationVisibilityState();
    if (!isVisible) {
      this.hideRouteHover();
    }
  }

  updateElevationVisibilityState() {
    const panelVisible = this.isPanelVisible();
    const hideContent = !panelVisible || this.isElevationCollapsed;
    if (this.elevationCard) {
      this.elevationCard.classList.toggle('chart-card--collapsed', this.isElevationCollapsed);
      this.elevationCard.classList.toggle('elevation-section--collapsed', this.isElevationCollapsed);
    }
    if (this.elevationChartBody) {
      this.elevationChartBody.hidden = this.isElevationCollapsed;
      this.elevationChartBody.setAttribute('aria-hidden', hideContent ? 'true' : 'false');
    }
    if (this.elevationChart) {
      this.elevationChart.setAttribute('aria-hidden', hideContent ? 'true' : 'false');
    }
    if (this.elevationCollapseToggle) {
      this.elevationCollapseToggle.setAttribute('aria-expanded', this.isElevationCollapsed ? 'false' : 'true');
      const collapseLabel = this.isElevationCollapsed ? 'Show elevation' : 'Hide elevation';
      this.elevationCollapseToggle.setAttribute('aria-label', collapseLabel);
      if (this.elevationCollapseLabel) {
        this.elevationCollapseLabel.textContent = collapseLabel;
      }
    }
    if (hideContent) {
      this.detachElevationChartEvents();
    } else {
      this.attachElevationChartEvents();
      this.updateElevationMarkerPositions();
    }
  }

  setElevationCollapsed(collapsed) {
    this.isElevationCollapsed = Boolean(collapsed);

    // Update toggle button in stats if it exists
    const toggle = this.routeStats?.querySelector('#routeStatsToggle');
    if (toggle) {
      const isExpanded = !this.isElevationCollapsed;
      toggle.classList.toggle('is-active', isExpanded);
      toggle.setAttribute('aria-expanded', isExpanded);
      toggle.title = isExpanded ? 'Réduire' : 'Développer';
      const expandIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>';
      const retractIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="10" y1="14" x2="3" y2="21"></line></svg>';
      toggle.innerHTML = isExpanded ? retractIcon : expandIcon;
    }

    this.updateElevationVisibilityState();
  }

  ensurePanelVisible() {
    if (!this.isPanelVisible()) {
      this.setPanelVisible(true);
    }
  }

  onWaypointMouseDown(event) {
    if (!this.isPanelVisible()) return;
    const feature = event.features?.[0];
    if (!feature) return;
    this.isDragging = true;
    this.draggedWaypointIndex = Number(feature.properties.index);
    this.setHoveredWaypointIndex(this.draggedWaypointIndex);
    this.map.dragPan?.disable();
    // Change cursor to grabbing
    this.map.getCanvas().style.cursor = 'grabbing';

    // Store neighbor waypoints for drag preview visualization
    const waypointIndex = this.draggedWaypointIndex;
    this._dragPrevNeighbor = this.waypoints[waypointIndex - 1]?.slice(0, 2) ?? null;
    this._dragNextNeighbor = this.waypoints[waypointIndex + 1]?.slice(0, 2) ?? null;

    // Store the segment color at this waypoint's position for consistent preview coloring
    // Estimate distance based on waypoint index
    if (this.routeProfile && Number.isFinite(this.routeProfile.totalDistanceKm) && this.waypoints.length > 1) {
      const fraction = waypointIndex / (this.waypoints.length - 1);
      const estimatedDistanceKm = fraction * this.routeProfile.totalDistanceKm;
      this._dragSegmentColor = this.getColorForDistance(estimatedDistanceKm);
    } else {
      this._dragSegmentColor = this.modeColors[this.currentMode];
    }

    // Store the routing mode of the adjacent segments so new segments inherit it
    // Check the segment before and after this waypoint - use the mode of either
    // Priority: if both exist and have different modes, prefer the previous segment's mode
    const prevLeg = this.cachedLegSegments?.get(waypointIndex - 1);
    const nextLeg = this.cachedLegSegments?.get(waypointIndex);
    const prevMode = prevLeg?.routingMode;
    const nextMode = nextLeg?.routingMode;
    // Use prevMode if available, otherwise nextMode, otherwise current global mode
    this._dragSegmentMode = prevMode || nextMode || this.currentMode;
  }

  /**
   * Handle mouse entering a waypoint for hover effects
   */
  onWaypointMouseEnter(event) {
    if (!this.isPanelVisible() || this.isDragging) return;
    const feature = event.features?.[0];
    if (!feature) return;

    const role = feature.properties?.role;

    // Show grab cursor
    this.map.getCanvas().style.cursor = 'grab';

    // Scale up the flag icons for start/end waypoints
    if ((role === 'start' || role === 'end') && this.map.getLayer(SEGMENT_MARKER_LAYER_ID)) {
      const type = role; // 'start' or 'end'
      this._hoveredMarkerType = type;

      this.map.setLayoutProperty(SEGMENT_MARKER_LAYER_ID, 'icon-size', [
        'interpolate',
        ['linear'],
        ['zoom'],
        8,
        ['match', ['get', 'type'],
          type, 0.75,  // Hover size for flag (larger)
          'bivouac', 0.4,
          0.55
        ],
        12,
        ['match', ['get', 'type'],
          type, 1.0,  // Hover size (larger)
          'bivouac', 0.6,
          0.75
        ],
        16,
        ['match', ['get', 'type'],
          type, 1.25,  // Hover size (larger)
          'bivouac', 0.8,
          0.95
        ]
      ]);
    }
  }

  /**
   * Handle mouse leaving a waypoint
   */
  onWaypointMouseLeave(event) {
    if (!this.isPanelVisible()) return;

    // Restore cursor only if not dragging
    if (!this.isDragging) {
      this.map.getCanvas().style.cursor = '';
    }

    // Restore icon sizes
    if (this._hoveredMarkerType && this.map.getLayer(SEGMENT_MARKER_LAYER_ID)) {
      this._hoveredMarkerType = null;
      this.map.setLayoutProperty(SEGMENT_MARKER_LAYER_ID, 'icon-size', [
        'interpolate',
        ['linear'],
        ['zoom'],
        8,
        ['match', ['get', 'type'], 'bivouac', 0.4, 0.55],
        12,
        ['match', ['get', 'type'], 'bivouac', 0.6, 0.75],
        16,
        ['match', ['get', 'type'], 'bivouac', 0.8, 0.95]
      ]);
    }
  }

  onSegmentMarkerMouseDown(event) {
    if (!this.isPanelVisible()) return;
    const feature = event.features?.[0];
    const type = feature?.properties?.type;

    // Handle start/end markers (departure/arrival)
    // Click on start marker creates a loop, drag moves the marker
    if (type === 'start' || type === 'end') {
      const waypointIndex = type === 'start' ? 0 : this.waypoints.length - 1;
      if (waypointIndex >= 0 && waypointIndex < this.waypoints.length) {
        // Store pending info for click vs drag detection
        this._pendingStartEndDrag = {
          type,
          waypointIndex,
          startLngLat: event?.lngLat ? [event.lngLat.lng, event.lngLat.lat] : null,
          startTime: Date.now()
        };

        // Set timeout to activate drag after short delay (200ms)
        // If released before timeout, it's a click
        this._startEndDragTimeout = setTimeout(() => {
          if (this._pendingStartEndDrag) {
            this.isDragging = true;
            this.draggedWaypointIndex = this._pendingStartEndDrag.waypointIndex;
            this.setHoveredWaypointIndex(this._pendingStartEndDrag.waypointIndex);
            this.map.dragPan?.disable();
            this.map.getCanvas().style.cursor = 'grabbing';
          }
        }, 200);

        event.preventDefault?.();
        event.originalEvent?.preventDefault?.();
      }
      return;
    }

    // Handle bivouac markers
    if (type !== 'bivouac') {
      return;
    }

    const order = Number(feature.properties?.order);
    const cutIndex = Number.isFinite(order) ? order - 1 : null;
    if (!Number.isInteger(cutIndex) || cutIndex < 0) {
      return;
    }

    if (!Array.isArray(this.routeCutDistances) || cutIndex >= this.routeCutDistances.length) {
      return;
    }

    // Store pending drag info but don't start drag immediately
    // Require a long press (300ms) before drag activates
    this._pendingBivouacDrag = {
      cutIndex,
      startLngLat: event?.lngLat ? [event.lngLat.lng, event.lngLat.lat] : null,
      startTime: Date.now()
    };

    // Set timeout to activate drag after long press
    this._bivouacDragTimeout = setTimeout(() => {
      if (this._pendingBivouacDrag) {
        this.isDragging = true;
        this.draggedWaypointIndex = null;
        this.draggedBivouacIndex = this._pendingBivouacDrag.cutIndex;
        if (this._pendingBivouacDrag.startLngLat) {
          this.draggedBivouacLngLat = this._pendingBivouacDrag.startLngLat;
          this.updateSegmentMarkers();
        }
        this.map.dragPan?.disable();
        // Change cursor to indicate dragging is active
        this.map.getCanvas().style.cursor = 'grabbing';
      }
    }, 300);

    event.preventDefault?.();
    event.originalEvent?.preventDefault?.();
  }
  onBivouacClick(event) {
    // Cancel any pending start/end drag - a click means we released before drag activated
    if (this._startEndDragTimeout) {
      clearTimeout(this._startEndDragTimeout);
      this._startEndDragTimeout = null;
    }

    // Handle click on start marker to create a loop
    if (this._pendingStartEndDrag && !this.isDragging) {
      const pendingInfo = this._pendingStartEndDrag;
      this._pendingStartEndDrag = null;

      // Click on start marker creates a loop (adds start point as destination)
      if (pendingInfo.type === 'start' && this.waypoints.length >= 2) {
        const startCoords = this.waypoints[0];
        if (Array.isArray(startCoords) && startCoords.length >= 2) {
          this.recordWaypointState();
          // Add the start point coordinates as the new destination
          const loopWaypoint = this.buildWaypointCoordinate([startCoords[0], startCoords[1]]) ?? [startCoords[0], startCoords[1]];
          this.waypoints.push(loopWaypoint);
          this.updateWaypoints();
          this.getRoute();
          return;
        }
      }
      // Click on end marker doesn't do anything special (could be extended later)
      return;
    }
    this._pendingStartEndDrag = null;

    // Cancel any pending bivouac drag - a click means we released before long press activated
    if (this._bivouacDragTimeout) {
      clearTimeout(this._bivouacDragTimeout);
      this._bivouacDragTimeout = null;
    }
    this._pendingBivouacDrag = null;

    // Only show popup if not dragging
    if (this.isDragging) return;

    // Close any existing bivouac popup first
    if (this.bivouacPopup) {
      this.bivouacPopup.remove();
      this.bivouacPopup = null;
    }

    const feature = event.features?.[0];
    const type = feature?.properties?.type;
    if (type !== 'bivouac') return;

    const order = Number(feature.properties?.order);
    const cutIndex = Number.isFinite(order) ? order - 1 : null;
    if (!Number.isInteger(cutIndex) || cutIndex < 0) return;

    // Get bivouac location
    const coordinates = feature.geometry?.coordinates?.slice?.();
    if (!Array.isArray(coordinates) || coordinates.length < 2) return;

    // If popup already open at same location, toggle it off
    if (this.bivouacPopup && this.bivouacPopup.isOpen?.()) {
      this.bivouacPopup.remove();
      return;
    }

    // Get associated cut segment info
    const segment = this.cutSegments?.[cutIndex];

    // Calculate bivouac details
    const distanceKm = segment?.endKm ?? segment?.endDistanceKm ?? 0;
    const elevation = this.getElevationAtDistance(distanceKm);
    const slope = this.computeGradeAtDistance(distanceKm);

    // Get day segment metrics
    const dayNumber = cutIndex + 1;
    const dayMetrics = segment ? this.computeCumulativeMetrics(
      segment.endKm ?? segment.endDistanceKm ?? 0,
      segment.startKm ?? segment.startDistanceKm ?? 0
    ) : null;
    const dayDistanceKm = dayMetrics?.distanceKm ?? 0;
    const dayAscent = Math.round(dayMetrics?.ascent ?? 0);
    const dayDescent = Math.round(dayMetrics?.descent ?? 0);
    const dayTime = this.estimateTravelTimeHours(dayDistanceKm, dayAscent, dayDescent);

    // Get bivouac marker name
    const markers = this.computeSegmentMarkers();
    const bivouacMarker = markers.find(m => m.type === 'bivouac' && m.order === order);
    const bivouacName = bivouacMarker?.name ?? bivouacMarker?.title ?? `Bivouac ${cutIndex + 1}`;

    // Get day color for this segment
    const dayColor = this.getSegmentColor(dayNumber);

    // Build popup content
    const elevationLabel = Number.isFinite(elevation) ? `${Math.round(elevation)} m` : '—';

    // Calculate sunrise/sunset times for this location
    const [lng, lat] = coordinates;
    const sunTimes = this.calculateSunTimes(lat, lng);
    const sunriseLabel = sunTimes?.sunrise ?? '—';
    const sunsetLabel = sunTimes?.sunset ?? '—';

    // Find nearest water sources (up to 2 different types)
    const waterSources = this.findNearestWaterSources(coordinates, 2);
    const formatWaterDistance = (d) => d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`;

    // Build water options HTML
    let waterOptionsHtml = '';
    if (waterSources.length === 0) {
      waterOptionsHtml = '<span class="bivouac-popup__stat-value">—</span>';
    } else {
      waterOptionsHtml = waterSources.map((source, i) => {
        const distLabel = formatWaterDistance(source.distance);
        return `<span class="bivouac-popup__water-option">${source.type}: ${distLabel}</span>`;
      }).join('');
    }

    const popupHtml = `
      <div class="bivouac-popup" style="--day-color: ${dayColor}">
        <div class="bivouac-popup__header">
          <span class="bivouac-popup__title">${escapeHtml(bivouacName)}</span>
          <button class="bivouac-popup__delete" data-bivouac-index="${cutIndex}" title="Supprimer le bivouac" aria-label="Supprimer le bivouac">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          </button>
        </div>
        <div class="bivouac-popup__stats">
          <div class="bivouac-popup__stat">
            <span class="bivouac-popup__stat-label">Jour ${dayNumber} - Résumé</span>
            <span class="bivouac-popup__stat-value">${this.formatDistance(dayDistanceKm)} km · +${dayAscent}m · ${this.formatDurationHours(dayTime)}</span>
          </div>
          <div class="bivouac-popup__stat">
            <span class="bivouac-popup__stat-label">Altitude</span>
            <span class="bivouac-popup__stat-value">${elevationLabel}</span>
          </div>
          <div class="bivouac-popup__stat bivouac-popup__stat--sun">
            <span class="bivouac-popup__stat-label">
              <svg class="bivouac-popup__stat-icon" viewBox="0 0 24 24"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0 .39-.39.39-1.03 0-1.41l-1.06-1.06zm1.06-10.96c-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0 .39-.39.39-1.03 0-1.41l-1.06-1.06c-.39-.39-1.03-.39-1.41 0zM7.05 18.36c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z"/></svg>
              Lever / Coucher
            </span>
            <span class="bivouac-popup__stat-value">${sunriseLabel} / ${sunsetLabel}</span>
          </div>
          <div class="bivouac-popup__stat bivouac-popup__stat--water">
            <span class="bivouac-popup__stat-label">
              <svg class="bivouac-popup__stat-icon" viewBox="0 0 24 24"><path d="M12 2c-5.33 4.55-8 8.48-8 11.8 0 4.98 3.8 8.2 8 8.2s8-3.22 8-8.2c0-3.32-2.67-7.25-8-11.8zm0 18c-3.35 0-6-2.57-6-6.2 0-2.34 1.95-5.44 6-9.14 4.05 3.7 6 6.79 6 9.14 0 3.63-2.65 6.2-6 6.2z"/></svg>
              Eau à proximité
            </span>
            <div class="bivouac-popup__water-options">${waterOptionsHtml}</div>
          </div>
          <div class="bivouac-popup__stat bivouac-popup__stat--weather">
            <span class="bivouac-popup__stat-label">
              <svg class="bivouac-popup__stat-icon" viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/></svg>
              Météo J+${dayNumber - 1}
            </span>
            <span class="bivouac-popup__stat-value weather-container" data-bivouac-day="${dayNumber}" data-lon="${lng}" data-lat="${lat}">
              <span class="weather-loading">Chargement...</span>
            </span>
          </div>
        </div>
      </div>
    `;

    // Create popup with close button for click-to-dismiss
    if (this.bivouacPopup) {
      this.bivouacPopup.remove();
    }

    this.bivouacPopup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: true,
      className: 'bivouac-popup-container',
      offset: [0, -16],
      maxWidth: '280px'
    });

    this.bivouacPopup
      .setLngLat(coordinates)
      .setHTML(popupHtml)
      .addTo(this.map);

    // Fetch and update weather for this bivouac location
    this.updateBivouacWeather(lng, lat, dayNumber);

    // Add click handler for delete button
    const popupEl = this.bivouacPopup.getElement();
    const deleteBtn = popupEl?.querySelector('.bivouac-popup__delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = Number(deleteBtn.dataset.bivouacIndex);
        if (Number.isInteger(index) && index >= 0) {
          this.removeBivouacCut(index);
          this.bivouacPopup?.remove();
        }
      });
    }

    // Stop event propagation to prevent map click from adding waypoint
    if (event.originalEvent) {
      event.originalEvent.stopPropagation();
      event.originalEvent.preventDefault();
    }
    // Mark this click as handled so map click handler knows to ignore it
    this._bivouacClickHandled = true;
    setTimeout(() => { this._bivouacClickHandled = false; }, 50);
  }

  /**
   * Calculate sunrise and sunset times for a given location.
   * Uses a simplified astronomical calculation.
   * @param {number} lat - Latitude in degrees
   * @param {number} lng - Longitude in degrees
   * @param {Date} date - Optional date (defaults to today)
   * @returns {{ sunrise: string, sunset: string } | null}
   */
  calculateSunTimes(lat, lng, date = new Date()) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }

    try {
      const toRad = (deg) => deg * Math.PI / 180;
      const toDeg = (rad) => rad * 180 / Math.PI;

      // Day of year
      const start = new Date(date.getFullYear(), 0, 0);
      const diff = date - start;
      const oneDay = 1000 * 60 * 60 * 24;
      const dayOfYear = Math.floor(diff / oneDay);

      // Solar declination
      const declination = -23.45 * Math.cos(toRad(360 / 365 * (dayOfYear + 10)));

      // Hour angle
      const latRad = toRad(lat);
      const declRad = toRad(declination);
      const cosHourAngle = -Math.tan(latRad) * Math.tan(declRad);

      // Check for polar day/night
      if (cosHourAngle < -1 || cosHourAngle > 1) {
        return { sunrise: 'N/A', sunset: 'N/A' };
      }

      const hourAngle = toDeg(Math.acos(cosHourAngle));

      // Time correction for longitude (4 minutes per degree from 15° multiples)
      const timezone = Math.round(lng / 15);
      const timeCorrection = (lng - timezone * 15) * 4; // minutes

      // Equation of time approximation
      const B = toRad(360 / 365 * (dayOfYear - 81));
      const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);

      // Solar noon in minutes from midnight
      const solarNoon = 720 - timeCorrection - eot;

      // Sunrise and sunset in minutes
      const sunriseMinutes = solarNoon - hourAngle * 4;
      const sunsetMinutes = solarNoon + hourAngle * 4;

      const formatTime = (minutes) => {
        const h = Math.floor(minutes / 60) % 24;
        const m = Math.round(minutes % 60);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      };

      return {
        sunrise: formatTime(sunriseMinutes),
        sunset: formatTime(sunsetMinutes)
      };
    } catch (error) {
      console.warn('Failed to calculate sun times', error);
      return null;
    }
  }

  /**
   * Find the nearest water sources from a given coordinate.
   * Searches map features for water bodies and POIs (fountains, springs, etc.)
   * @param {number[]} coordinates - [lng, lat] coordinates
   * @param {number} maxResults - Maximum number of results to return (default 2)
   * @returns {Array<{ distance: number, type: string }>}
   */
  findNearestWaterSources(coordinates, maxResults = 2) {
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      return [];
    }

    const [lng, lat] = coordinates;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return [];
    }

    try {
      // Water layer definitions with human-readable type labels
      const waterLayerConfig = [
        { id: 'Water', type: 'Lake' },
        { id: 'Water intermittent', type: 'Seasonal lake' },
        { id: 'River', type: 'River' },
        { id: 'River intermittent', type: 'Seasonal river' },
        { id: 'Other waterway', type: 'Stream' },
        { id: 'Other waterway intermittent', type: 'Seasonal stream' },
        { id: 'Glacier', type: 'Glacier' }
      ];

      // POI classes that indicate water sources
      const waterPoiClasses = new Set([
        'drinking_water', 'fountain', 'water_well', 'spring',
        'waterfall', 'watering_place'
      ]);

      // Human-readable type from POI subclass
      const poiTypeMap = {
        'drinking_water': 'Drinking water',
        'fountain': 'Fountain',
        'water_well': 'Well',
        'spring': 'Spring',
        'waterfall': 'Waterfall',
        'watering_place': 'Watering place'
      };

      // Use a fixed geographic radius (in km) instead of pixels
      // This ensures consistent results regardless of zoom level
      const SEARCH_RADIUS_KM = 5; // 5km search radius

      // Convert km to approximate degrees (at this latitude)
      // 1 degree latitude ≈ 111 km
      // 1 degree longitude ≈ 111 * cos(lat) km
      const latRadiusDeg = SEARCH_RADIUS_KM / 111;
      const lngRadiusDeg = SEARCH_RADIUS_KM / (111 * Math.cos(lat * Math.PI / 180));

      // Calculate geographic bounding box
      const minLng = lng - lngRadiusDeg;
      const maxLng = lng + lngRadiusDeg;
      const minLat = lat - latRadiusDeg;
      const maxLat = lat + latRadiusDeg;

      // Convert to screen coordinates for queryRenderedFeatures
      const sw = this.map.project([minLng, minLat]);
      const ne = this.map.project([maxLng, maxLat]);

      const bbox = [
        [Math.min(sw.x, ne.x), Math.min(sw.y, ne.y)],
        [Math.max(sw.x, ne.x), Math.max(sw.y, ne.y)]
      ];

      // Collect all water sources with distances
      const waterSources = [];
      const seenTypes = new Set();


      // Helper to calculate distance to geometry
      const calcGeometryDistance = (geometry) => {
        let distance = Infinity;

        if (geometry.type === 'Point') {
          const [fLng, fLat] = geometry.coordinates;
          distance = this.haversineDistance(lat, lng, fLat, fLng);
        } else if (geometry.type === 'LineString') {
          for (const coord of geometry.coordinates) {
            const d = this.haversineDistance(lat, lng, coord[1], coord[0]);
            if (d < distance) distance = d;
          }
        } else if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
          const rings = geometry.type === 'Polygon'
            ? [geometry.coordinates[0]]
            : geometry.coordinates.map(p => p[0]);
          for (const ring of rings) {
            for (const coord of ring) {
              const d = this.haversineDistance(lat, lng, coord[1], coord[0]);
              if (d < distance) distance = d;
            }
          }
        }

        return distance;
      };

      // Query water body layers
      for (const { id, type } of waterLayerConfig) {
        if (!this.map.getLayer(id)) continue;

        const features = this.map.queryRenderedFeatures(bbox, { layers: [id] });

        for (const feature of features) {
          const geometry = feature.geometry;
          if (!geometry) continue;

          const distance = calcGeometryDistance(geometry);
          if (distance !== Infinity) {
            waterSources.push({ distance, type });
          }
        }
      }

      // Query POI layer for water-related points (fountains, springs, etc.)
      const poiLayers = ['poi', 'POI', 'poi_z16', 'poi_z15', 'poi_z14'];
      for (const layerId of poiLayers) {
        if (!this.map.getLayer(layerId)) continue;

        const features = this.map.queryRenderedFeatures(bbox, { layers: [layerId] });

        for (const feature of features) {
          const props = feature.properties || {};
          const subclass = props.subclass || props.class || '';

          if (!waterPoiClasses.has(subclass)) continue;

          const geometry = feature.geometry;
          if (!geometry) continue;

          const distance = calcGeometryDistance(geometry);
          if (distance !== Infinity) {
            const type = poiTypeMap[subclass] || subclass;
            waterSources.push({ distance, type });
          }
        }
      }

      // Sort by distance and return unique types (prefer closest of each type)
      waterSources.sort((a, b) => a.distance - b.distance);

      const results = [];
      for (const source of waterSources) {
        // Skip if we already have this type (keep only closest of each type)
        if (seenTypes.has(source.type)) continue;

        seenTypes.add(source.type);
        results.push(source);

        if (results.length >= maxResults) break;
      }

      return results;
    } catch (error) {
      console.warn('Failed to find nearest water', error);
      return [];
    }
  }

  /**
   * Calculate haversine distance between two points in km
   */
  haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  onBivouacMouseEnter(event) {
    const feature = event.features?.[0];
    const type = feature?.properties?.type;
    const order = feature?.properties?.order;

    // Handle all segment marker types (start, end, bivouac)
    if (!type || !['start', 'end', 'bivouac'].includes(type)) return;

    // Change cursor to grab for draggable markers
    this.map.getCanvas().style.cursor = 'grab';

    // Store hovered marker info for the expression
    this._hoveredMarkerType = type;
    this._hoveredMarkerOrder = order;

    // Scale up ONLY the specific hovered marker, not all markers of same type
    if (this.map.getLayer(SEGMENT_MARKER_LAYER_ID)) {
      // Build icon-size expression that scales up only the specific hovered marker
      // We use a case expression to check both type AND order
      const buildSizeExpression = (hoverSize, normalBivouac, normalOther) => {
        return [
          'case',
          // Check if this is the exact marker being hovered (matching both type and order)
          ['all',
            ['==', ['get', 'type'], type],
            ['==', ['get', 'order'], order ?? 0]
          ],
          hoverSize,
          // Otherwise, use normal sizes based on type
          ['match', ['get', 'type'],
            'bivouac', normalBivouac,
            normalOther
          ]
        ];
      };

      this.map.setLayoutProperty(SEGMENT_MARKER_LAYER_ID, 'icon-size', [
        'interpolate',
        ['linear'],
        ['zoom'],
        8, buildSizeExpression(0.7, 0.4, 0.55),
        12, buildSizeExpression(1.0, 0.6, 0.75),
        16, buildSizeExpression(1.25, 0.8, 0.95)
      ]);
    }
  }

  onBivouacMouseLeave(event) {
    // Restore cursor
    this.map.getCanvas().style.cursor = '';

    this._hoveredMarkerType = null;
    this._hoveredMarkerOrder = null;

    // Restore original icon size
    if (this.map.getLayer(SEGMENT_MARKER_LAYER_ID)) {
      this.map.setLayoutProperty(SEGMENT_MARKER_LAYER_ID, 'icon-size', [
        'interpolate',
        ['linear'],
        ['zoom'],
        8,
        ['match', ['get', 'type'], 'bivouac', 0.4, 0.55],
        12,
        ['match', ['get', 'type'], 'bivouac', 0.6, 0.75],
        16,
        ['match', ['get', 'type'], 'bivouac', 0.8, 0.95]
      ]);
    }
  }

  /**
   * Handle mousedown on the map to enable click-and-drag via point insertion.
   * When LEFT-clicking on a hovered route segment, creates a via point and starts dragging it.
   * Right-click is handled by contextmenu for bivouac creation.
   */
  onMapMouseDown(event) {
    if (!this.isPanelVisible() || this.isDragging) return;

    // Only handle left mouse button (button === 0)
    // Right-click (button === 2) should still create bivouacs via contextmenu
    if (event.originalEvent?.button !== 0) return;

    // Skip if clicking on waypoints or bivouac markers (handled by their own handlers)
    const hitWaypoints = this.map.queryRenderedFeatures(event.point, { layers: ['waypoints-hit-area'] });
    if (hitWaypoints.length) return;

    const hitBivouacs = this.map.queryRenderedFeatures(event.point, { layers: [SEGMENT_MARKER_LAYER_ID] });
    if (hitBivouacs.length) return;

    // Check if we're hovering over the route (have a hovered segment)
    if (this.hoveredSegmentIndex === null || this.waypoints.length < 2) return;

    // Project click onto route to get insert position
    const projection = this.projectOntoRoute(event.lngLat, ROUTE_CLICK_PIXEL_TOLERANCE);
    if (!projection) return;

    const segmentIndex = Number.isInteger(projection.segmentIndex)
      ? projection.segmentIndex
      : this.hoveredSegmentIndex;

    // Find the leg index for this segment
    const segment = this.routeSegments?.[segmentIndex];
    if (!segment) return;

    // Calculate insert index - determine which leg this segment belongs to
    let insertIndex = 1;
    let legIndex = segment.legIndex;

    // If legIndex is not set, try to determine it from segment position
    if (!Number.isInteger(legIndex)) {
      // Find which leg contains this segment by comparing its distance to waypoint distances
      const segmentDistanceKm = segment.startDistanceKm ?? 0;
      const waypointDistances = this.getWaypointDistances();

      // Find the leg that contains this distance
      for (let i = 0; i < waypointDistances.length - 1; i++) {
        const legStart = waypointDistances[i];
        const legEnd = waypointDistances[i + 1];
        if (segmentDistanceKm >= legStart && segmentDistanceKm < legEnd) {
          legIndex = i;
          break;
        }
      }
      // If still not found, default to last leg
      if (!Number.isInteger(legIndex) && waypointDistances.length > 1) {
        legIndex = waypointDistances.length - 2;
      }
    }

    if (Number.isInteger(legIndex)) {
      insertIndex = Math.min(this.waypoints.length, Math.max(0, legIndex) + 1);
    }
    insertIndex = Math.max(1, insertIndex);

    // Get the projected coordinates for the via point
    const projectedCoords = Array.isArray(projection.projection?.coordinates)
      ? projection.projection.coordinates.slice()
      : [event.lngLat.lng, event.lngLat.lat];

    // Store neighbor waypoint coordinates BEFORE inserting (for correct drag preview)
    // Use legIndex to get exact waypoint neighbors of this leg
    const prevNeighborCoords = Number.isInteger(legIndex) && this.waypoints[legIndex]
      ? this.waypoints[legIndex].slice(0, 2)
      : this.waypoints[insertIndex - 1]?.slice(0, 2) ?? null;
    const nextNeighborCoords = Number.isInteger(legIndex) && this.waypoints[legIndex + 1]
      ? this.waypoints[legIndex + 1].slice(0, 2)
      : this.waypoints[insertIndex]?.slice(0, 2) ?? null;

    // IMPORTANT: Capture segment color and mode BEFORE inserting waypoint and updating state
    // This ensures we get the correct values before the route is recalculated
    const dragDistanceKm = Number.isFinite(projection.distanceKm)
      ? projection.distanceKm
      : (segment?.startDistanceKm ?? 0);
    const capturedSegmentColor = this.getColorForDistance(dragDistanceKm);
    const cachedLeg = this.cachedLegSegments?.get(legIndex);
    const capturedSegmentMode = cachedLeg?.routingMode || this.currentMode;

    // Record state for undo
    this.recordWaypointState();

    // Insert via waypoint at the projected location
    const waypoint = this.buildWaypointCoordinate(projectedCoords) ?? projectedCoords;
    this.waypoints.splice(insertIndex, 0, waypoint);
    // IMPORTANT: Re-index cached leg segments AFTER insertion
    // This ensures segments after the insertion point get their indices shifted
    // e.g., if we insert at index 3, segment at cache[3] becomes cache[4], etc.
    this.shiftCachedLegSegments(insertIndex, 1);
    this.updateWaypoints();

    // Immediately start dragging the inserted waypoint
    this.isDragging = true;
    this.draggedWaypointIndex = insertIndex;
    this._viaInsertedByDrag = true; // Flag to prevent click handler from adding another point
    this._dragPrevNeighbor = prevNeighborCoords; // Store for updateDragPreview
    this._dragNextNeighbor = nextNeighborCoords; // Store for updateDragPreview
    // Use pre-captured color and mode for consistent behavior
    this._dragSegmentColor = capturedSegmentColor;
    this._dragSegmentMode = capturedSegmentMode;
    this.setHoveredWaypointIndex(insertIndex);
    this.map.dragPan?.disable();

    // Hide the route hover point since we're now dragging a waypoint
    this.resetSegmentHover('map');

    event.preventDefault?.();
    event.originalEvent?.preventDefault?.();
  }

  onMapMouseMove(event) {
    if (!this.isPanelVisible()) return;

    // Dragging operations should not be throttled for responsiveness
    if (this.isDragging && this.draggedWaypointIndex !== null) {
      const coords = [event.lngLat.lng, event.lngLat.lat];
      this.waypoints[this.draggedWaypointIndex] = this.buildWaypointCoordinate(coords) ?? coords;
      this.updateWaypoints();

      // Show drag preview lines (dashed lines from neighbors to drag position)
      this.updateDragPreview(this.draggedWaypointIndex, coords);

      // Update the waypoint hover drag circle color to match the route segment color
      this.updateDragWaypointColor(this.draggedWaypointIndex);
    }

    if (this.isDragging && this.draggedBivouacIndex !== null) {
      if (event?.lngLat && Number.isFinite(event.lngLat.lng) && Number.isFinite(event.lngLat.lat)) {
        this.draggedBivouacLngLat = [event.lngLat.lng, event.lngLat.lat];
        this.updateSegmentMarkers();
      }
    }

    // Throttle non-drag mouse move handling to ~60fps max for performance
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!this.isDragging && this._lastMouseMoveTime && now - this._lastMouseMoveTime < 16) {
      return;
    }
    this._lastMouseMoveTime = now;

    const features = this.map.queryRenderedFeatures(event.point, { layers: ['waypoints-hit-area'] });
    if (features.length > 0) {
      const feature = features[0];
      const index = Number(feature.properties.index);
      const role = feature.properties.role;
      this.setHoveredWaypointIndex(index);
      if (!this.isDragging && role === 'via') {
        this.resetSegmentHover('map');
        return;
      }
      if (this.isDragging) {
        return;
      }
    } else if (!this.isDragging) {
      this.setHoveredWaypointIndex(null);
    }

    if (!this.isDragging) {
      this.handleRouteSegmentHover(event);
    }
  }

  onMapMouseUp(event) {
    // Clear any pending start/end drag that wasn't activated
    if (this._startEndDragTimeout) {
      clearTimeout(this._startEndDragTimeout);
      this._startEndDragTimeout = null;
    }
    // Note: Don't clear _pendingStartEndDrag here - let onBivouacClick handle click detection

    if (!this.isDragging) return;
    const movedWaypoint = this.draggedWaypointIndex !== null;
    const movedWaypointIndex = this.draggedWaypointIndex;
    const movedBivouac = this.draggedBivouacIndex !== null;
    // Capture the segment mode before clearing drag state
    // This is the mode of the original segment that was being dragged
    const dragSegmentMode = this._dragSegmentMode;
    this.isDragging = false;
    this.draggedWaypointIndex = null;
    this.map.dragPan?.enable();
    this.setHoveredWaypointIndex(null);
    // Clear drag preview lines and stored neighbor coords
    this.clearDragPreview();
    this.resetDragWaypointColor();
    this._dragPrevNeighbor = null;
    this._dragNextNeighbor = null;
    this._dragSegmentColor = null;
    this._dragSegmentMode = null;

    if (movedWaypoint && this.waypoints.length >= 2) {
      const startLeg = Math.max(0, movedWaypointIndex - 1);
      const endLeg = Math.min(this.waypoints.length - 2, movedWaypointIndex);
      this.invalidateCachedLegSegments({ startIndex: startLeg, endIndex: endLeg });

      // Use the original segment's mode for new segments created by dragging
      // This ensures dragging from a manual segment creates manual segments,
      // and dragging from a snapped segment creates snapped segments
      // INDEPENDENT of the current global mode setting
      if (dragSegmentMode && dragSegmentMode !== this.currentMode) {
        const originalMode = this.currentMode;
        this.currentMode = dragSegmentMode;
        this.getRoute().finally(() => {
          // Restore the original global mode after route calculation
          this.currentMode = originalMode;
        });
      } else {
        this.getRoute();
      }
    }
    if (movedBivouac) {
      const releaseLngLat = event?.lngLat ?? null;
      this.finishBivouacDrag(releaseLngLat);
      this.draggedBivouacIndex = null;
    }
  }

  /**
   * Update the drag preview visualization showing dashed lines
   * from neighboring waypoints to the current drag position.
   * Takes into account both waypoints and bivouacs as intermediate points.
   */
  updateDragPreview(waypointIndex, dragCoords) {
    const source = this.map.getSource('drag-preview-source');
    if (!source) return;

    const features = [];

    // Collect all key points on the route (waypoints + bivouacs) sorted by distance
    const getAllRouteKeyPoints = () => {
      const points = [];

      // Add all waypoints with their estimated distances
      const totalDistance = this.routeProfile?.totalDistanceKm ?? 0;
      const waypointCount = this.waypoints.length;

      this.waypoints.forEach((coords, idx) => {
        if (!Array.isArray(coords) || coords.length < 2) return;
        // Estimate distance for this waypoint
        let distanceKm = 0;
        if (waypointCount > 1 && totalDistance > 0) {
          distanceKm = (idx / (waypointCount - 1)) * totalDistance;
        }
        points.push({
          type: 'waypoint',
          index: idx,
          coordinates: coords.slice(0, 2),
          distanceKm
        });
      });

      // Add bivouac coordinates from cutSegments
      if (Array.isArray(this.cutSegments) && this.cutSegments.length > 1) {
        this.cutSegments.forEach((segment, idx) => {
          // Each segment except the first has a bivouac at its start
          if (idx > 0 && segment.startKm != null) {
            const bivouacCoords = this.getCoordinateAtDistance(segment.startKm);
            if (Array.isArray(bivouacCoords) && bivouacCoords.length >= 2) {
              points.push({
                type: 'bivouac',
                index: idx,
                coordinates: bivouacCoords.slice(0, 2),
                distanceKm: segment.startKm
              });
            }
          }
        });
      }

      // Sort all points by distance
      points.sort((a, b) => a.distanceKm - b.distanceKm);
      return points;
    };

    // Get neighbors for the dragged waypoint (considering both waypoints AND bivouacs)
    const findNeighbors = () => {
      // If we have stored neighbors (from onMapMouseDown or onWaypointMouseDown), use them first
      const storedPrev = this._dragPrevNeighbor;
      const storedNext = this._dragNextNeighbor;

      // Get all key points including bivouacs
      const keyPoints = getAllRouteKeyPoints();

      // Find the current waypoint in keyPoints
      const currentWaypointPoint = keyPoints.find(p => p.type === 'waypoint' && p.index === waypointIndex);
      if (!currentWaypointPoint) {
        // Fallback to stored or waypoint neighbors
        return {
          prev: storedPrev ?? this.waypoints[waypointIndex - 1]?.slice(0, 2),
          next: storedNext ?? this.waypoints[waypointIndex + 1]?.slice(0, 2)
        };
      }

      // Find the index in sorted keyPoints
      const sortedIndex = keyPoints.indexOf(currentWaypointPoint);

      // Get previous and next points (could be waypoints or bivouacs)
      const prevPoint = sortedIndex > 0 ? keyPoints[sortedIndex - 1] : null;
      const nextPoint = sortedIndex < keyPoints.length - 1 ? keyPoints[sortedIndex + 1] : null;

      return {
        prev: prevPoint?.coordinates ?? storedPrev ?? this.waypoints[waypointIndex - 1]?.slice(0, 2),
        next: nextPoint?.coordinates ?? storedNext ?? this.waypoints[waypointIndex + 1]?.slice(0, 2)
      };
    };

    const neighbors = findNeighbors();
    const prevCoords = neighbors.prev;
    const nextCoords = neighbors.next;

    // Get the appropriate color for the drag preview
    // Use the color stored at drag start for consistency
    const getPreviewColor = () => {
      // Priority 1: Use the color stored when drag started
      if (this._dragSegmentColor) {
        return this._dragSegmentColor;
      }
      // Priority 2: Try to get the color based on the drag position using getColorForDistance
      if (this.routeProfile && Number.isFinite(this.routeProfile.totalDistanceKm)) {
        const totalWaypoints = this.waypoints.length;
        if (totalWaypoints > 1) {
          const fraction = waypointIndex / (totalWaypoints - 1);
          const estimatedDistance = fraction * this.routeProfile.totalDistanceKm;
          const color = this.getColorForDistance(estimatedDistance);
          if (color) return color;
        }
      }
      // Priority 3: Fall back to cut segments
      if (Array.isArray(this.cutSegments) && this.cutSegments.length > 0) {
        return this.cutSegments[0]?.color ?? this.modeColors[this.currentMode];
      }
      return this.modeColors[this.currentMode];
    };

    const previewColor = getPreviewColor();

    // Line from previous waypoint to drag position
    if (prevCoords) {
      features.push({
        type: 'Feature',
        properties: { color: previewColor },
        geometry: {
          type: 'LineString',
          coordinates: [prevCoords, dragCoords]
        }
      });
    }

    // Line from drag position to next waypoint
    if (nextCoords) {
      features.push({
        type: 'Feature',
        properties: { color: previewColor },
        geometry: {
          type: 'LineString',
          coordinates: [dragCoords, nextCoords]
        }
      });
    }

    source.setData({
      type: 'FeatureCollection',
      features
    });
  }

  /**
   * Clear the drag preview visualization.
   */
  clearDragPreview() {
    const source = this.map.getSource('drag-preview-source');
    if (source) {
      source.setData(EMPTY_COLLECTION);
    }
  }

  /**
  * Update the color of the waypoint-hover-drag circle during drag
  * to match the current route segment color.
  */
  updateDragWaypointColor(waypointIndex) {
    if (!this.map.getLayer('waypoint-hover-drag')) return;

    // Priority 1: Use the color stored when drag started
    let dragColor = this._dragSegmentColor;

    // Priority 2: Calculate based on position if not stored
    if (!dragColor) {
      dragColor = this.modeColors[this.currentMode];
      if (this.routeProfile && Number.isFinite(this.routeProfile.totalDistanceKm)) {
        const totalWaypoints = this.waypoints.length;
        if (totalWaypoints > 1) {
          const fraction = waypointIndex / (totalWaypoints - 1);
          const estimatedDistance = fraction * this.routeProfile.totalDistanceKm;
          const color = this.getColorForDistance(estimatedDistance);
          if (color) dragColor = color;
        }
      } else if (Array.isArray(this.cutSegments) && this.cutSegments.length > 0) {
        dragColor = this.cutSegments[0]?.color ?? dragColor;
      }
    }

    // Update the layer's stroke color for the dragged waypoint
    try {
      this.map.setPaintProperty('waypoint-hover-drag', 'circle-stroke-color', dragColor);
    } catch (error) {
      // Ignore errors if layer doesn't support dynamic updates
    }
  }

  /**
   * Reset the waypoint-hover-drag color to its default expression.
   */
  resetDragWaypointColor() {
    if (!this.map.getLayer('waypoint-hover-drag')) return;
    try {
      this.map.setPaintProperty('waypoint-hover-drag', 'circle-stroke-color', '#ffffff');
    } catch (error) {
      // Ignore errors
    }
  }

  /**
   * Get cumulative distances (in km) at each waypoint position.
   * Used to determine which leg a route segment belongs to.
   * @returns {number[]} Array of cumulative distances, one per waypoint
   */
  getWaypointDistances() {
    const distances = [0];

    // If we have route profile with day data, use it
    if (this.routeProfile?.totalDistanceKm && this.waypoints.length >= 2) {
      // Find waypoint positions in the route by matching coordinates
      const routeCoords = this.routeGeojson?.geometry?.coordinates;
      if (Array.isArray(routeCoords) && routeCoords.length >= 2) {
        let cumulativeKm = 0;
        let waypointIdx = 1;

        for (let i = 0; i < routeCoords.length - 1 && waypointIdx < this.waypoints.length; i++) {
          const coord = routeCoords[i];
          const nextCoord = routeCoords[i + 1];

          // Calculate segment distance
          const segDist = this.haversineDistance(coord[1], coord[0], nextCoord[1], nextCoord[0]);
          cumulativeKm += segDist;

          // Check if next waypoint matches next coord (approximately)
          const waypoint = this.waypoints[waypointIdx];
          if (waypoint && this.coordinatesMatch(waypoint, nextCoord)) {
            distances.push(cumulativeKm);
            waypointIdx++;
          }
        }

        // If we didn't find all waypoints, add the total distance for remaining
        while (distances.length < this.waypoints.length) {
          distances.push(this.routeProfile.totalDistanceKm);
        }
      }
    }

    // Fallback: split total distance evenly between waypoints
    if (distances.length < this.waypoints.length && this.waypoints.length >= 2) {
      const totalKm = this.routeProfile?.totalDistanceKm ?? 0;
      const numLegs = this.waypoints.length - 1;
      for (let i = 1; i < this.waypoints.length; i++) {
        distances[i] = (i / numLegs) * totalKm;
      }
    }

    return distances;
  }

  async onMapClick(event) {
    if (!this.isPanelVisible() || this.isDragging) return;

    // Skip if via waypoint was already inserted by drag
    if (this._viaInsertedByDrag) {
      this._viaInsertedByDrag = false;
      return;
    }

    // Skip if bivouac was clicked (handled separately)
    if (this._bivouacClickHandled) return;

    // If bivouac popup is open, close it and don't add a waypoint
    if (this.bivouacPopup && this.bivouacPopup.isOpen?.()) {
      this.bivouacPopup.remove();
      return;
    }

    // Check if click was on a segment marker (bivouac)
    const hitSegmentMarkers = this.map.queryRenderedFeatures(event.point, { layers: [SEGMENT_MARKER_LAYER_ID] });
    if (hitSegmentMarkers.length) return;

    const hitWaypoints = this.map.queryRenderedFeatures(event.point, { layers: ['waypoints-hit-area'] });
    if (hitWaypoints.length) return;

    const projection = this.projectOntoRoute(event.lngLat, ROUTE_CLICK_PIXEL_TOLERANCE);
    if (projection) {
      this.addViaWaypoint(event.lngLat, projection);
      return;
    }

    if (this.hoveredSegmentIndex !== null) {
      this.addViaWaypoint(event.lngLat);
      return;
    }

    let targetLngLat = [event.lngLat.lng, event.lngLat.lat];
    if (this.currentMode !== 'manual') {
      const snapped = await this.snapLngLatToNetwork(event.lngLat);
      if (Array.isArray(snapped) && snapped.length >= 2
        && Number.isFinite(snapped[0])
        && Number.isFinite(snapped[1])) {
        targetLngLat = [snapped[0], snapped[1]];
      }
    }
    this.recordWaypointState();
    const waypoint = this.buildWaypointCoordinate(targetLngLat) ?? targetLngLat.slice();
    this.waypoints.push(waypoint);
    this.updateWaypoints();
    if (this.waypoints.length === 1) {
      this.prepareNetwork({ reason: 'first-waypoint' });
    } else if (this.waypoints.length >= 2) {
      this.getRoute();
    }
    this.updateModeAvailability();
  }

  onWaypointDoubleClick(event) {
    if (!this.isPanelVisible()) return;
    const index = Number(event.features?.[0]?.properties.index);
    if (!Number.isFinite(index) || index <= 0 || index >= this.waypoints.length - 1) return;
    this.recordWaypointState();
    const removalIndex = index;
    const startLeg = Math.max(0, removalIndex - 1);
    const endLeg = Math.min(this.waypoints.length - 2, removalIndex);
    this.invalidateCachedLegSegments({ startIndex: startLeg, endIndex: endLeg });
    this.waypoints.splice(removalIndex, 1);
    this.shiftCachedLegSegments(removalIndex + 1, -1);
    this.updateWaypoints();
    if (this.waypoints.length >= 2) {
      this.getRoute();
    } else {
      this.clearRoute();
      this.updateStats(null);
      this.updateElevationProfile([]);
    }
  }

  /**
   * Handle right-click on a via waypoint to show context menu with remove option
   */
  onWaypointContextMenu(event) {
    if (!this.isPanelVisible()) return;

    event.preventDefault();

    const feature = event.features?.[0];
    if (!feature) return;

    const index = Number(feature.properties?.index);
    const role = feature.properties?.role;

    // Only show context menu for via points (not start or end)
    if (!Number.isFinite(index) || role === 'start' || role === 'end') return;
    if (index <= 0 || index >= this.waypoints.length - 1) return;

    // Set flag to prevent route context menu from also showing
    this._waypointContextMenuHandled = true;

    // Close any existing waypoint popup
    if (this.waypointContextPopup) {
      this.waypointContextPopup.remove();
      this.waypointContextPopup = null;
    }

    // Create popup content
    const popupContent = document.createElement('div');
    popupContent.className = 'waypoint-context-menu';
    popupContent.innerHTML = `
      <button type="button" class="waypoint-context-menu__item waypoint-context-menu__item--remove">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        <span>Remove waypoint</span>
      </button>
    `;

    // Add click handler for remove button
    const removeBtn = popupContent.querySelector('.waypoint-context-menu__item--remove');
    removeBtn.addEventListener('click', () => {
      this.waypointContextPopup?.remove();
      this.waypointContextPopup = null;

      // Remove the waypoint (same logic as double-click)
      this.recordWaypointState();
      const removalIndex = index;
      const startLeg = Math.max(0, removalIndex - 1);
      const endLeg = Math.min(this.waypoints.length - 2, removalIndex);
      this.invalidateCachedLegSegments({ startIndex: startLeg, endIndex: endLeg });
      this.waypoints.splice(removalIndex, 1);
      this.shiftCachedLegSegments(removalIndex + 1, -1);
      this.updateWaypoints();
      if (this.waypoints.length >= 2) {
        this.getRoute();
      } else {
        this.clearRoute();
        this.updateStats(null);
        this.updateElevationProfile([]);
      }
    });

    // Create and show the popup
    const coords = this.waypoints[index];
    if (!coords || coords.length < 2) return;

    this.waypointContextPopup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: true,
      className: 'waypoint-context-popup',
      anchor: 'bottom',
      offset: [0, -10]
    })
      .setLngLat([coords[0], coords[1]])
      .setDOMContent(popupContent)
      .addTo(this.map);
  }

  setHoveredWaypointIndex(index) {
    this.hoveredWaypointIndex = index;
    const target = Number.isInteger(index) ? index : -1;
    if (this.map.getLayer('waypoint-hover-drag')) {
      this.map.setFilter('waypoint-hover-drag', ['==', 'index', target]);
    }
  }

  handleRouteSegmentHover(event) {
    if (!this.routeSegments.length) {
      this.resetSegmentHover('map');
      return;
    }

    // Check if we're near a marker (bivouac, start, end) - if so, don't show route hover
    // This makes it easier to click on these markers
    // Radius is ~1.5x the symbol size for comfortable interaction
    const MARKER_EXCLUSION_RADIUS = 60; // pixels
    const markerFeatures = this.map.queryRenderedFeatures(event.point, {
      layers: [SEGMENT_MARKER_LAYER_ID]
    });
    const nearMarker = markerFeatures.some((feature) => {
      const type = feature.properties?.type;
      return type === 'bivouac' || type === 'start' || type === 'end';
    });

    if (nearMarker) {
      // Also check the wider radius for exclusion
      // Use cached markers to avoid recomputing on every mouse move
      const mousePixel = this.map.project(event.lngLat);
      const markers = this._cachedSegmentMarkers ?? this.computeSegmentMarkers();
      const isTooCloseToAnyMarker = markers.some((marker) => {
        const type = marker.type;
        if (!['bivouac', 'start', 'end'].includes(type) || !marker.coordinates) return false;
        const markerPixel = this.map.project(toLngLat(marker.coordinates));
        const dist = Math.hypot(mousePixel.x - markerPixel.x, mousePixel.y - markerPixel.y);
        return dist < MARKER_EXCLUSION_RADIUS;
      });

      if (isTooCloseToAnyMarker) {
        this.resetSegmentHover('map');
        return;
      }
    }

    const mousePixel = this.map.project(event.lngLat);
    let closestIndex = -1;
    let minDistance = Infinity;

    this.routeSegments.forEach((segment, index) => {
      const startPixel = this.map.project(toLngLat(segment.start));
      const endPixel = this.map.project(toLngLat(segment.end));
      const distance = this.pointToSegmentDistance(mousePixel, startPixel, endPixel);
      if (distance < minDistance && distance <= HOVER_PIXEL_TOLERANCE) {
        minDistance = distance;
        closestIndex = index;
      }
    });

    if (closestIndex === -1) {
      this.resetSegmentHover('map');
    } else {
      const segment = this.routeSegments[closestIndex];
      if (!segment) {
        this.resetSegmentHover('map');
        return;
      }
      const projection = this.projectPointOnSegment(event.lngLat, segment.start, segment.end);
      this.showRouteHoverOnSegment(closestIndex, projection, { mousePoint: event.point, source: 'map' });
    }
  }

  setHoveredSegment(index) {
    this.hoveredSegmentIndex = Number.isInteger(index) ? index : null;
    this.hoveredLegIndex = this.hoveredSegmentIndex !== null
      ? this.segmentLegLookup[this.hoveredSegmentIndex] ?? null
      : null;

    if (this.map.getLayer('route-segment-hover')) {
      const target = this.hoveredSegmentIndex ?? -1;
      this.map.setFilter('route-segment-hover', ['==', 'segmentIndex', target]);
    }
  }

  clearHover(source = null) {
    if (source && this.activeHoverSource && source !== this.activeHoverSource) {
      return;
    }
    this.activeHoverSource = null;
    this.setHoveredSegment(null);
    this.hideRouteHover();
  }

  resetSegmentHover(source = null) {
    this.clearHover(source);
  }

  async addViaWaypoint(lngLat, projectionOverride = null) {
    if (!lngLat || this.waypoints.length < 2) {
      return;
    }

    const ensureProjection = () => {
      if (projectionOverride) {
        return projectionOverride;
      }
      return this.projectOntoRoute(lngLat, ROUTE_CLICK_PIXEL_TOLERANCE);
    };

    const projectionResult = ensureProjection();
    let segmentIndex = Number.isInteger(projectionResult?.segmentIndex)
      ? projectionResult.segmentIndex
      : null;
    let snappedCoords = Array.isArray(projectionResult?.projection?.coordinates)
      ? projectionResult.projection.coordinates.slice()
      : null;

    if (!snappedCoords && this.hoveredSegmentIndex !== null) {
      const segment = this.routeSegments[this.hoveredSegmentIndex];
      if (segment) {
        const projection = this.projectPointOnSegment(lngLat, segment.start, segment.end);
        if (Array.isArray(projection?.coordinates)) {
          snappedCoords = projection.coordinates.slice();
          segmentIndex = this.hoveredSegmentIndex;
        }
      }
    }

    if (!Array.isArray(snappedCoords) || snappedCoords.length < 2) {
      return;
    }

    const [lng, lat] = snappedCoords;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return;
    }

    const snapped = [lng, lat];
    const alreadyExists = this.waypoints.some((coord) => this.coordinatesMatch(coord, snapped));
    if (alreadyExists) {
      this.resetSegmentHover();
      return;
    }

    let insertIndex = this.waypoints.length - 1;
    const projectedLeg = Number.isInteger(segmentIndex)
      ? this.segmentLegLookup?.[segmentIndex]
      : null;
    if (Number.isInteger(projectedLeg)) {
      insertIndex = Math.min(projectedLeg + 1, this.waypoints.length - 1);
    } else if (Number.isInteger(this.hoveredLegIndex)) {
      insertIndex = Math.min(this.hoveredLegIndex + 1, this.waypoints.length - 1);
    }

    insertIndex = Math.max(1, insertIndex);

    this.recordWaypointState();
    const waypoint = this.buildWaypointCoordinate(snapped) ?? snapped;
    this.waypoints.splice(insertIndex, 0, waypoint);
    this.shiftCachedLegSegments(insertIndex, 1);
    const startLeg = Math.max(0, insertIndex - 1);
    const endLeg = Math.min(this.waypoints.length - 2, insertIndex);
    this.invalidateCachedLegSegments({ startIndex: startLeg, endIndex: endLeg });
    this.updateWaypoints();
    this.resetSegmentHover();
    await this.prepareNetwork({ reason: 'via-inserted' });
    this.getRoute();
  }

  updateWaypoints() {
    const source = this.map.getSource('waypoints');
    if (!source) return;
    const total = this.waypoints.length;
    const features = this.waypoints.map((coords, index) => {
      const extras = this.buildWaypointDisplayProperties(coords, index, total);
      return createWaypointFeature(coords, index, total, extras);
    });
    source.setData({
      type: 'FeatureCollection',
      features
    });

    this.updateSegmentMarkers();

    // Hide the routing start tooltip once waypoints are placed
    this.updateRoutingStartTooltip();
  }

  buildWaypointDisplayProperties(coords, index, total) {
    const color = this.resolveWaypointColor(coords, index, total);
    return { color };
  }

  resolveWaypointColor(coords, index, total) {
    const fallback = this.modeColors[this.currentMode];
    if (!Array.isArray(coords) || coords.length < 2) {
      return fallback;
    }

    const isStart = index === 0;
    const isEnd = total > 1 && index === total - 1;
    const startFallback = '#2f8f3b';
    const endFallback = '#d64545';

    // Start and end use fixed colors
    if (isStart) {
      return startFallback;
    }
    if (isEnd) {
      return endFallback;
    }

    // For via waypoints, calculate actual cumulative distance from cached legs
    // to ensure consistency with route profile and manual route segments
    if (this.cachedLegSegments instanceof Map && this.cachedLegSegments.size > 0) {
      const legDistances = [];
      for (const segment of this.cachedLegSegments.values()) {
        const coords = Array.isArray(segment.coordinates) ? segment.coordinates : [];
        let dist = 0;
        for (let i = 1; i < coords.length; i++) {
          dist += this.computeDistanceKm(coords[i - 1], coords[i]);
        }
        legDistances.push(dist);
      }

      let cumulativeDistanceKm = 0;
      for (let i = 0; i < index && i < legDistances.length; i++) {
        cumulativeDistanceKm += legDistances[i];
      }

      const profileColor = this.getColorForDistance(cumulativeDistanceKm);
      if (profileColor) {
        return profileColor;
      }
    }

    // Fallback: Try to get color from cutSegments (day segments)
    if (Array.isArray(this.cutSegments) && this.cutSegments.length > index) {
      const segment = this.cutSegments[index];
      if (segment?.color) {
        return segment.color;
      }
    }

    // Final fallback to first segment color or mode color
    const viaFallback = this.cutSegments?.[0]?.color ?? fallback;
    return viaFallback;
  }

  projectPointOnSegment(lngLat, startCoord, endCoord) {
    const startPixel = this.map.project(toLngLat(startCoord));
    const endPixel = this.map.project(toLngLat(endCoord));
    const clickPixel = this.map.project(lngLat);
    const dx = endPixel.x - startPixel.x;
    const dy = endPixel.y - startPixel.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) {
      return { coordinates: [...startCoord], t: 0 };
    }
    let t = ((clickPixel.x - startPixel.x) * dx + (clickPixel.y - startPixel.y) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
    const projected = {
      x: startPixel.x + t * dx,
      y: startPixel.y + t * dy
    };
    const result = this.map.unproject(projected);
    return { coordinates: [result.lng, result.lat], t };
  }

  pointToSegmentDistance(point, startPixel, endPixel) {
    const dx = endPixel.x - startPixel.x;
    const dy = endPixel.y - startPixel.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) {
      return Math.hypot(point.x - startPixel.x, point.y - startPixel.y);
    }
    let t = ((point.x - startPixel.x) * dx + (point.y - startPixel.y) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
    const projection = {
      x: startPixel.x + t * dx,
      y: startPixel.y + t * dy
    };
    return Math.hypot(point.x - projection.x, point.y - projection.y);
  }

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

  findSegmentIndexByDistance(distanceKm) {
    if (!Array.isArray(this.routeSegments) || !this.routeSegments.length) {
      return null;
    }
    if (!Number.isFinite(distanceKm)) {
      return null;
    }

    const lastIndex = this.routeSegments.length - 1;
    if (distanceKm <= (this.routeSegments[0]?.startDistanceKm ?? 0)) {
      return 0;
    }
    if (distanceKm >= (this.routeSegments[lastIndex]?.endDistanceKm ?? 0)) {
      return lastIndex;
    }

    let low = 0;
    let high = lastIndex;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const segment = this.routeSegments[mid];
      if (!segment) {
        break;
      }
      const start = segment.startDistanceKm ?? 0;
      const end = segment.endDistanceKm ?? start;
      if (distanceKm < start) {
        high = mid - 1;
      } else if (distanceKm > end) {
        low = mid + 1;
      } else {
        return mid;
      }
    }

    const candidate = Math.max(0, Math.min(low, lastIndex));
    return candidate;
  }

  interpolateSegmentCoordinate(segment, t, distanceKm) {
    if (!segment) {
      return null;
    }
    const start = segment.start ?? [];
    const end = segment.end ?? [];
    const startLng = Number(start[0]);
    const startLat = Number(start[1]);
    const endLng = Number(end[0]);
    const endLat = Number(end[1]);
    if (!Number.isFinite(startLng) || !Number.isFinite(startLat) || !Number.isFinite(endLng) || !Number.isFinite(endLat)) {
      return null;
    }

    const clampedT = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
    const lng = startLng + (endLng - startLng) * clampedT;
    const lat = startLat + (endLat - startLat) * clampedT;

    const coord = [lng, lat];
    const interpolatedElevation = this.getElevationAtDistance(distanceKm);
    if (Number.isFinite(interpolatedElevation)) {
      coord.push(interpolatedElevation);
      return coord;
    }

    const startElevation = Number(start[2]);
    const endElevation = Number(end[2]);
    if (Number.isFinite(startElevation) && Number.isFinite(endElevation)) {
      coord.push(startElevation + (endElevation - startElevation) * clampedT);
    } else if (Number.isFinite(startElevation)) {
      coord.push(startElevation);
    } else if (Number.isFinite(endElevation)) {
      coord.push(endElevation);
    }

    return coord;
  }

  showRouteHoverOnSegment(segmentIndex, projection, { mousePoint = null, source = null } = {}) {
    const segment = this.routeSegments?.[segmentIndex];
    if (!segment) {
      return;
    }

    const clampedT = Math.max(0, Math.min(1, Number.isFinite(projection?.t) ? projection.t : 0));
    const distanceKm = Number.isFinite(projection?.distanceKm)
      ? projection.distanceKm
      : (segment.startDistanceKm ?? 0) + (segment.distanceKm ?? 0) * clampedT;

    const coordinates = this.interpolateSegmentCoordinate(segment, clampedT, distanceKm) ?? projection?.coordinates ?? null;
    let screenPoint = mousePoint;
    if ((!screenPoint || !Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y)) && coordinates) {
      try {
        const projected = this.map.project(toLngLat(coordinates));
        if (projected && Number.isFinite(projected.x) && Number.isFinite(projected.y)) {
          screenPoint = { x: projected.x, y: projected.y };
        }
      } catch (error) {
        console.warn('Failed to project hover coordinate', error);
      }
    }

    const projectionData = {
      ...projection,
      coordinates,
      t: clampedT,
      distanceKm,
      source
    };

    this.activeHoverSource = source ?? null;
    this.setHoveredSegment(segmentIndex);
    this.updateRouteHoverDisplay(screenPoint, segment, projectionData);
  }

  showRouteHoverAtDistance(distanceKm, { source = null } = {}) {
    if (!Number.isFinite(distanceKm)) {
      this.resetSegmentHover(source ?? undefined);
      this.updateElevationHoverReadout(null);
      return;
    }

    const segmentIndex = this.findSegmentIndexByDistance(distanceKm);
    if (!Number.isInteger(segmentIndex)) {
      this.resetSegmentHover(source ?? undefined);
      this.updateElevationHoverReadout(null);
      return;
    }

    const segment = this.routeSegments?.[segmentIndex];
    if (!segment) {
      this.resetSegmentHover(source ?? undefined);
      this.updateElevationHoverReadout(null);
      return;
    }

    const startDistance = segment.startDistanceKm ?? 0;
    const segmentDistance = segment.distanceKm ?? 0;
    let relativeDistance = distanceKm - startDistance;
    if (!Number.isFinite(relativeDistance)) {
      relativeDistance = 0;
    }
    relativeDistance = Math.max(0, Math.min(segmentDistance, relativeDistance));
    const t = segmentDistance > 0 ? relativeDistance / segmentDistance : 0;

    this.updateElevationHoverReadout(distanceKm);
    this.showRouteHoverOnSegment(segmentIndex, { t, distanceKm }, { source });
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

    for (let index = 0; index < processingSequence.length; index += 1) {
      const coord = processingSequence[index];
      let elevation = Number.isFinite(coord[2]) ? coord[2] : null;
      if (canQueryTerrain) {
        const terrainElevation = this.queryTerrainElevationValue(coord);
        if (Number.isFinite(terrainElevation)) {
          elevation = terrainElevation;
        }
      }
      coord[2] = Number.isFinite(elevation) ? elevation : null;
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
      elevations
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

  hideRouteHover() {
    if (this.routeHoverTooltip) {
      this.routeHoverTooltip.style.display = 'none';
    }
    this.map.getSource('route-hover-point-source')?.setData(EMPTY_COLLECTION);
    if (this.map.getLayer('route-hover-point')) {
      this.map.setPaintProperty('route-hover-point', 'circle-opacity', 0);
    }
    const canvas = this.map.getCanvas?.();
    if (canvas) {
      canvas.style.cursor = '';
    }
    this.highlightElevationAt(null);
    this.updateElevationHoverReadout(null);
    this.updateRouteStatsHover(null);
  }

  updateRouteHoverDisplay(mousePoint, segment, projection) {
    if (!segment || !projection) return;

    const tooltip = this.ensureRouteHoverTooltip();
    const clampedT = Math.max(0, Math.min(1, Number.isFinite(projection.t) ? projection.t : 0));
    const distanceKm = Number.isFinite(projection.distanceKm)
      ? projection.distanceKm
      : (segment.startDistanceKm ?? 0) + (segment.distanceKm ?? 0) * clampedT;
    const distanceLabel = this.formatDistance(distanceKm);
    const elevation = this.getElevationAtDistance(distanceKm);
    let gradeValue = this.computeGradeAtDistance(distanceKm);
    if (!Number.isFinite(gradeValue)) {
      if ((segment.distanceKm ?? 0) > 0 && Number.isFinite(segment.startElevation) && Number.isFinite(segment.endElevation)) {
        gradeValue = ((segment.endElevation - segment.startElevation) / Math.max(segment.distanceKm * 1000, 1)) * 100;
      } else {
        gradeValue = null;
      }
    }
    const altitudeLabel = Number.isFinite(elevation) ? `${Math.round(elevation)} m` : 'N/A';
    const gradeLabel = this.formatGrade(gradeValue);

    this.updateRouteStatsHover(distanceKm, { elevation, grade: gradeValue });

    let screenPoint = mousePoint;
    if ((!screenPoint || !Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y)) && projection.coordinates) {
      try {
        const projected = this.map.project(toLngLat(projection.coordinates));
        if (projected && Number.isFinite(projected.x) && Number.isFinite(projected.y)) {
          screenPoint = { x: projected.x, y: projected.y };
        }
      } catch (error) {
        console.warn('Failed to project tooltip coordinate', error);
      }
    }

    const metadata = this.getSegmentMetadata(segment);
    const detailItems = [];
    detailItems.push(`<span class="tooltip-altitude">Alt. ${escapeHtml(altitudeLabel)}</span>`);
    detailItems.push(`<span class="tooltip-grade">${escapeHtml(gradeLabel)}</span>`);

    if (metadata) {
      const sacLabel = formatSacScaleLabel(metadata.sacScale);
      if (sacLabel) {
        detailItems.push(`<span class="tooltip-sac">Difficulty: ${escapeHtml(sacLabel)}</span>`);
      }
      const surfaceLabel = formatSurfaceLabel(metadata.surface);
      if (surfaceLabel) {
        detailItems.push(`<span class="tooltip-surface">Surface: ${escapeHtml(surfaceLabel)}</span>`);
      }
      const trailLabel = formatTrailVisibilityLabel(metadata.trailVisibility);
      if (trailLabel) {
        detailItems.push(`<span class="tooltip-trail">Visibility: ${escapeHtml(trailLabel)}</span>`);
      }
    }

    const detailsMarkup = detailItems.join('');

    tooltip.innerHTML = `
      <div class="tooltip-distance">${escapeHtml(distanceLabel)} km</div>
      <div class="tooltip-details">
        ${detailsMarkup}
      </div>
    `;
    tooltip.style.display = 'block';

    const container = this.mapContainer;
    if (container && screenPoint) {
      const margin = 12;
      const tooltipWidth = tooltip.offsetWidth;
      const tooltipHeight = tooltip.offsetHeight;
      const maxLeft = container.clientWidth - tooltipWidth - margin;
      const maxTop = container.clientHeight - tooltipHeight - margin;
      const centeredLeft = screenPoint.x - tooltipWidth / 2;
      let rawTop = screenPoint.y - tooltipHeight - margin;
      if (rawTop < margin) {
        rawTop = Math.min(screenPoint.y + margin, maxTop);
      }
      const left = Math.min(Math.max(centeredLeft, margin), Math.max(margin, maxLeft));
      const top = Math.min(Math.max(rawTop, margin), Math.max(margin, maxTop));
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    }

    if (this.map.getLayer('route-hover-point')) {
      const hoverSegment = this.getCutSegmentForDistance(distanceKm);
      const hoverColor = hoverSegment?.color ?? this.modeColors[this.currentMode];
      this.map.setPaintProperty('route-hover-point', 'circle-stroke-color', hoverColor);
      this.map.setPaintProperty('route-hover-point', 'circle-opacity', 1);
    }
    if (projection.coordinates) {
      this.map.getSource('route-hover-point-source')?.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: projection.coordinates }
          }
        ]
      });
    } else {
      this.map.getSource('route-hover-point-source')?.setData(EMPTY_COLLECTION);
    }

    const canvas = this.map.getCanvas?.();
    if (canvas) {
      const shouldPointer = projection.source === 'map';
      canvas.style.cursor = shouldPointer ? 'pointer' : '';
    }

    this.highlightElevationAt(distanceKm);
  }

}
