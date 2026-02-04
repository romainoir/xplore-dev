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


export class DirectionsManagerInitMixin {
  setupRouteLayers() {
    const removeLayer = (id) => {
      if (this.map.getLayer(id)) {
        this.map.removeLayer(id);
      }
    };
    const removeSource = (id) => {
      if (this.map.getSource(id)) {
        this.map.removeSource(id);
      }
    };

    removeLayer('route-line');
    removeLayer('route-line-casing');
    removeLayer('route-line-manual');
    removeLayer('route-line-manual-bg');
    removeLayer('route-segment-hover');
    removeLayer('distance-markers');
    removeLayer('waypoint-hover-drag');
    removeLayer('route-hover-point');
    removeLayer('waypoints');
    removeLayer('waypoints-hit-area');
    removeLayer(SEGMENT_MARKER_LAYER_ID);
    removeLayer(ROUTE_POI_LABEL_LAYER_ID);
    removeLayer(ROUTE_POI_ICON_LAYER_ID);
    removeLayer(ROUTE_POI_LAYER_ID);

    removeSource('route-line-source');
    removeSource('route-manual-source');
    removeSource('route-segments-source');
    removeSource('distance-markers-source');
    removeSource('route-hover-point-source');
    removeSource('waypoints');
    removeSource(SEGMENT_MARKER_SOURCE_ID);
    removeSource(ROUTE_POI_SOURCE_ID);

    this.map.addSource('route-line-source', {
      type: 'geojson',
      data: EMPTY_COLLECTION,
      lineMetrics: true
    });

    this.map.addSource('route-segments-source', {
      type: 'geojson',
      data: EMPTY_COLLECTION
    });

    this.map.addSource('distance-markers-source', {
      type: 'geojson',
      data: EMPTY_COLLECTION
    });

    this.map.addSource('route-hover-point-source', {
      type: 'geojson',
      data: EMPTY_COLLECTION
    });

    // Source for drag preview visualization (dashed lines during via point drag)
    this.map.addSource('drag-preview-source', {
      type: 'geojson',
      data: EMPTY_COLLECTION
    });

    this.map.addSource('waypoints', {
      type: 'geojson',
      data: EMPTY_COLLECTION
    });

    this.map.addSource(SEGMENT_MARKER_SOURCE_ID, {
      type: 'geojson',
      data: EMPTY_COLLECTION
    });

    this.map.addSource(ROUTE_POI_SOURCE_ID, {
      type: 'geojson',
      data: EMPTY_COLLECTION
    });

    // Add white casing layer (border effect behind the main route)
    this.map.addLayer({
      id: 'route-line-casing',
      type: 'line',
      source: 'route-line-source',
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': '#ffffff',
        'line-width': 6,
        'line-opacity': 0.9
      }
    });

    const routeLineLayer = {
      id: 'route-line',
      type: 'line',
      source: 'route-line-source',
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': ['coalesce', ['get', 'color'], this.modeColors[this.currentMode]],
        'line-width': 4,
        'line-opacity': 0.95
      }
    };

    try {
      this.map.addLayer(routeLineLayer);
    } catch (error) {
      if (this.routeLineGradientSupported && this.isLineGradientUnsupportedError(error)) {
        this.disableRouteLineGradient();
        this.map.addLayer(routeLineLayer);
      } else {
        throw error;
      }
    }

    if (this.routeLineGradientSupported) {
      this.setRouteLineGradient();
    }

    // Add source for manual route segments (dotted overlay)
    this.map.addSource('route-manual-source', {
      type: 'geojson',
      data: EMPTY_COLLECTION
    });

    // Add white background for manual route segments (for contrast)
    this.map.addLayer({
      id: 'route-line-manual-bg',
      type: 'line',
      source: 'route-manual-source',
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': '#ffffff',
        'line-width': 6,
        'line-opacity': 0.9
      }
    });

    // Add manual route line layer with dotted pattern on top
    // Note: Using 'line-cap': 'butt' instead of 'round' to fix Safari rendering issue
    // where dashed lines don't appear with 'round' cap
    this.map.addLayer({
      id: 'route-line-manual',
      type: 'line',
      source: 'route-manual-source',
      layout: {
        'line-join': 'round',
        'line-cap': 'butt'
      },
      paint: {
        // Use data-driven color from feature properties to match day/segment colors
        'line-color': ['coalesce', ['get', 'color'], this.modeColors['manual'] || '#f8b40b'],
        'line-width': 4,
        'line-opacity': 1,
        'line-dasharray': [2, 2]
      }
    });

    this.map.addLayer({
      id: 'route-segment-hover',
      type: 'line',
      source: 'route-segments-source',
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': 'yellow',
        'line-width': 6,
        'line-opacity': 0
      },
      filter: ['==', 'segmentIndex', -1]
    });

    this.map.addLayer({
      id: 'distance-markers',
      type: 'symbol',
      source: 'distance-markers-source',
      layout: {
        'symbol-placement': 'point',
        'icon-image': ['get', 'imageId'],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'center',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.35, 12, 0.425, 16, 0.525],
        'text-field': '',
        'text-font': ['Noto Sans Bold'],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-optional': true
      },
      paint: {
        'icon-opacity': 0.95
      }
    });

    this.map.addLayer({
      id: 'waypoints-hit-area',
      type: 'circle',
      source: 'waypoints',
      paint: {
        'circle-radius': 8,
        'circle-color': 'transparent'
      },
      filter: ['==', '$type', 'Point']
    });

    this.map.addLayer({
      id: ROUTE_POI_LAYER_ID,
      type: 'circle',
      source: ROUTE_POI_SOURCE_ID,
      layout: {
        visibility: 'none'
      },
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          8, 6,
          12, 9,
          16, 12
        ],
        'circle-color': ['coalesce', ['get', 'color'], DEFAULT_POI_COLOR],
        'circle-stroke-color': 'rgba(255, 255, 255, 0.95)',
        'circle-stroke-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          8, 2,
          12, 2.5,
          16, 3
        ],
        // Hide circles when icon is available
        'circle-opacity': ['case', ['boolean', ['get', 'hasIcon'], false], 0, 0.95],
        'circle-stroke-opacity': ['case', ['boolean', ['get', 'hasIcon'], false], 0, 1]
      },
      filter: ['==', '$type', 'Point']
    });

    this.map.addLayer({
      id: ROUTE_POI_ICON_LAYER_ID,
      type: 'symbol',
      source: ROUTE_POI_SOURCE_ID,
      layout: {
        'icon-image': ['coalesce', ['get', 'iconImageId'], ''],
        'icon-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          8, 0.56,
          12, 0.84,
          16, 1.12
        ],
        'icon-anchor': 'center',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-optional': false,
        visibility: 'none'
      },
      paint: {
        'icon-opacity': ['case', ['boolean', ['get', 'hasIcon'], false], 0.95, 0]
      },
      filter: ['==', '$type', 'Point']
    });



    this.map.addLayer({
      id: ROUTE_POI_LABEL_LAYER_ID,
      type: 'symbol',
      source: ROUTE_POI_SOURCE_ID,
      layout: {
        'text-field': ['coalesce', ['get', 'name'], ['get', 'title'], ''],
        'text-size': 12,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-font': ['Noto Sans Bold'],
        'text-optional': true,
        visibility: 'none'
      },
      paint: {
        'text-color': ['coalesce', ['get', 'color'], DEFAULT_POI_COLOR],
        'text-halo-color': 'rgba(255, 255, 255, 0.95)',
        'text-halo-width': 1.1,
        'text-halo-blur': 0.25
      },
      filter: ['==', ['get', 'showLabel'], true]
    });

    ensureSegmentMarkerImages(this.map, this.modeColors[this.currentMode]);
    this.map.addLayer({
      id: SEGMENT_MARKER_LAYER_ID,
      type: 'symbol',
      source: SEGMENT_MARKER_SOURCE_ID,
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-anchor': 'bottom',
        'icon-offset': [0, 0],
        'icon-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          8,
          ['match', ['get', 'type'], 'bivouac', 0.4, 0.55],
          12,
          ['match', ['get', 'type'], 'bivouac', 0.6, 0.75],
          16,
          ['match', ['get', 'type'], 'bivouac', 0.8, 0.95]
        ],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'text-field': ['get', 'title'],
        'text-size': 13,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-font': ['Noto Sans Bold'],
        'text-optional': true,
        'symbol-sort-key': ['coalesce', ['get', 'order'], 0]
      },
      paint: {
        'icon-opacity': 0.95,
        'text-color': ['coalesce', ['get', 'labelColor'], 'rgba(17, 34, 48, 0.85)'],
        'text-halo-color': 'rgba(255, 255, 255, 0.95)',
        'text-halo-width': 1.3,
        'text-halo-blur': 0.45
      }
    });

    this.map.addLayer({
      id: 'waypoints',
      type: 'circle',
      source: 'waypoints',
      paint: {
        'circle-radius': [
          'case',
          ['==', ['get', 'role'], 'start'], 0,
          ['==', ['get', 'role'], 'end'], 0,
          3.6  // Via point size (0.6x of 6)
        ],
        'circle-color': [
          'case',
          ['==', ['get', 'role'], 'start'], '#2f8f3b',
          ['==', ['get', 'role'], 'end'], '#d64545',
          ['coalesce', ['get', 'color'], this.modeColors[this.currentMode]]
        ],
        'circle-opacity': [
          'case',
          ['==', ['get', 'role'], 'start'], 0,
          ['==', ['get', 'role'], 'end'], 0,
          1
        ],
        'circle-stroke-width': [
          'case',
          ['any', ['==', ['get', 'role'], 'start'], ['==', ['get', 'role'], 'end']], 0,
          1.8  // White stroke for via points (0.6x of 3)
        ],
        'circle-stroke-color': '#ffffff',  // White contour for all via points
        'circle-stroke-opacity': [
          'case',
          ['any', ['==', ['get', 'role'], 'start'], ['==', ['get', 'role'], 'end']], 0,
          0.95
        ]
      },
      filter: ['==', '$type', 'Point']
    });

    this.map.addLayer({
      id: 'waypoint-hover-drag',
      type: 'circle',
      source: 'waypoints',
      paint: {
        'circle-radius': [
          'case',
          ['==', ['get', 'role'], 'start'], 0,
          ['==', ['get', 'role'], 'end'], 0,
          7.8  // Hover size (1.3x of normal 6)
        ],
        'circle-color': [
          'case',
          ['==', ['get', 'role'], 'start'], '#2f8f3b',
          ['==', ['get', 'role'], 'end'], '#d64545',
          ['coalesce', ['get', 'color'], this.modeColors[this.currentMode]]
        ],
        'circle-stroke-width': [
          'case',
          ['==', ['get', 'role'], 'start'], 0,
          ['==', ['get', 'role'], 'end'], 0,
          2.4  // Hover stroke (0.6x of 4)
        ],
        'circle-stroke-color': '#ffffff',  // White stroke for via points
        'circle-opacity': 0.95
      },
      filter: ['==', 'index', -1]
    });

    this.map.addLayer({
      id: 'route-hover-point',
      type: 'circle',
      source: 'route-hover-point-source',
      paint: {
        'circle-radius': 6,
        'circle-color': '#fff',
        'circle-stroke-width': 2,
        'circle-stroke-color': this.modeColors[this.currentMode],
        'circle-opacity': 0
      }
    });

    // Layer for drag preview visualization (dashed lines)
    // Note: Using 'line-cap': 'butt' instead of default 'round' to fix Safari rendering issue
    // where dashed lines don't appear with 'round' cap
    this.map.addLayer({
      id: 'drag-preview-line',
      type: 'line',
      source: 'drag-preview-source',
      layout: {
        'line-cap': 'butt'
      },
      paint: {
        'line-color': ['coalesce', ['get', 'color'], this.modeColors[this.currentMode]],
        'line-width': 3,
        'line-dasharray': [4, 4],
        'line-opacity': 0.8
      }
    });

    this.updateSegmentMarkers();
    this.updateRoutePoiData();
    this.updateRoutePoiLayerVisibility();
    this.moveRouteLayersToTop();
  }

  moveRouteLayersToTop() {
    if (!this.map) return;

    // Line layers should be above terrain but below map labels/symbols
    const lineLayers = [
      'route-line-casing',
      'route-line',
      'route-line-manual-bg',
      'route-line-manual',
      'route-segment-hover'
    ];

    // Marker/Symbol layers should stay at the absolute top
    const markerLayers = [
      'distance-markers',
      'waypoints-hit-area',
      'route-poi',
      'route-poi-icon',
      'route-poi-label',
      'segment-markers',
      'waypoints',
      'waypoint-hover-drag',
      'route-hover-point',
      'drag-preview-line'
    ];

    // Find first symbol layer that isn't one of ours
    const firstSymbolLayer = this.map.getStyle?.()?.layers?.find((l) =>
      l.type === 'symbol' && !markerLayers.includes(l.id) && !lineLayers.includes(l.id)
    );

    // 1. Position line layers before map symbols
    lineLayers.forEach((id) => {
      if (this.map.getLayer(id)) {
        if (firstSymbolLayer) {
          this.map.moveLayer(id, firstSymbolLayer.id);
        } else {
          this.map.moveLayer(id);
        }
      }
    });

    // 2. Move markers to the absolute top (in order)
    markerLayers.forEach((id) => {
      if (this.map.getLayer(id)) {
        this.map.moveLayer(id);
      }
    });
  }

  setupUIHandlers() {
    this.directionsToggle?.addEventListener('click', () => {
      console.log('[DirectionsManager] Toggle Button Clicked. Setting visible:', !this.isPanelVisible());
      this.setPanelVisible(!this.isPanelVisible());
    });

    this.setupPanelGestures();

    this.transportModes.forEach((button) => {
      button.addEventListener('click', () => {
        const mode = button.dataset.mode;
        if (mode) {
          this.setTransportMode(mode);
        }
      });
    });

    if (this.elevationCollapseToggle) {
      this.elevationCollapseToggle.addEventListener('click', () => {
        this.setElevationCollapsed(!this.isElevationCollapsed);
      });
    }

    this.swapButton?.addEventListener('click', () => {
      if (this.waypoints.length < 2) return;
      this.recordWaypointState();
      this.mirrorRouteCutsForReversedRoute();
      this.waypoints.reverse();
      // Reverse the cached leg segments to preserve routing modes
      this.reverseCachedLegSegments();
      this.updateWaypoints();
      // Use cached segments to rebuild route, preserving original modes
      if (this.cachedLegSegments instanceof Map && this.cachedLegSegments.size > 0) {
        this.rebuildRouteFromCachedSegments();
      } else {
        this.getRoute();
      }
    });

    this.undoButton?.addEventListener('click', () => {
      this.undoLastWaypointChange();
    });

    this.redoButton?.addEventListener('click', () => {
      this.redoLastWaypointChange();
    });

    this.clearButton?.addEventListener('click', () => {
      this.clearDirections();
    });

    if (this.profileModeToggle) {
      this.profileModeToggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.toggleProfileMenu();
      });
    }

    if (this.profileModeMenu) {
      this.profileModeMenu.setAttribute('aria-hidden', this.profileMenuOpen ? 'false' : 'true');
      this.profileModeMenu.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          this.closeProfileMenu({ restoreFocus: true });
        }
      });

      this.handleDocumentClickForProfileMenu = (event) => {
        if (!this.profileMenuOpen) {
          return;
        }
        const target = event.target;
        if (this.profileModeMenu?.contains(target)) {
          return;
        }
        if (this.profileModeToggle && target === this.profileModeToggle) {
          return;
        }
        this.closeProfileMenu();
      };
      document.addEventListener('click', this.handleDocumentClickForProfileMenu);
    }


    if (this.profileModeOptions.length) {
      this.profileModeOptions.forEach((button) => {
        // Click handler with toggle behavior
        button.addEventListener('click', (event) => {
          event.preventDefault();
          const mode = button.dataset.profileMode;
          // Toggle: if clicking on already active mode, go back to 'none'
          const newMode = this.profileMode === mode ? 'none' : mode;
          this.setProfileMode(newMode);
          this.closeProfileMenu();
        });

        // Long-hover to show legend (similar to profile toggle button)
        let legendHoverTimeout = null;
        button.addEventListener('pointerenter', () => {
          const mode = button.dataset.profileMode;
          if (mode && mode !== 'none' && mode !== 'poi') {
            legendHoverTimeout = setTimeout(() => {
              // Temporarily set profile mode for legend display
              const originalMode = this.profileMode;
              this.profileMode = mode;
              this.updateProfileLegend(true);
              this.showProfileLegend();
              this.profileMode = originalMode;
            }, PROFILE_LEGEND_SHOW_DELAY_MS);
          }
        });
        button.addEventListener('pointerleave', () => {
          if (legendHoverTimeout) {
            clearTimeout(legendHoverTimeout);
            legendHoverTimeout = null;
          }
          this.hideProfileLegend();
        });
      });
    }
  }

  supportsPanelGestures() {
    if (typeof window === 'undefined') {
      return false;
    }
    if (typeof window.matchMedia === 'function') {
      try {
        if (window.matchMedia('(pointer: coarse)').matches) {
          return true;
        }
      } catch (_) {
        // Ignore matchMedia errors and fall through to other checks.
      }
    }
    if (typeof navigator !== 'undefined') {
      if (Number.isFinite(navigator.maxTouchPoints) && navigator.maxTouchPoints > 0) {
        return true;
      }
    }
    if ('ontouchstart' in window) {
      return true;
    }
    if (typeof document !== 'undefined' && document.documentElement
      && 'ontouchstart' in document.documentElement) {
      return true;
    }
    return false;
  }

  setupPanelGestures() {
    if (!this.directionsDock || !this.supportsPanelGestures()) {
      return;
    }
    this.directionsDock.addEventListener('pointerdown', this.handleDockPointerDown);
  }

  handleDockPointerDown(event) {
    if (!event || event.pointerType !== 'touch' || !this.directionsDock) {
      return;
    }
    const target = event.target;
    if (!target) {
      return;
    }
    const interactive = target.closest('button, a, input, select, textarea, [role="button"], [role="link"]');
    if (interactive) {
      return;
    }
    const handleElement = target.closest('.directions-swipe-handle');
    const headerElement = this.directionsHeader
      ? target.closest('.directions-header')
      : null;
    const isVisible = this.isPanelVisible();
    const canOpen = !isVisible && Boolean(handleElement);
    const canClose = isVisible && (Boolean(headerElement) || Boolean(handleElement));
    if (!canOpen && !canClose) {
      return;
    }
    const startY = Number.isFinite(event.clientY) ? event.clientY : 0;
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    this.panelSwipeState = {
      active: true,
      pointerId: event.pointerId,
      startY,
      lastY: startY,
      startTime: now,
      allowOpen: canOpen,
      allowClose: canClose,
      hasExceededThreshold: false
    };
    try {
      target.setPointerCapture?.(event.pointerId);
    } catch (_) {
      // Ignore pointer capture failures.
    }
    this.directionsDock.addEventListener('pointermove', this.handleDockPointerMove);
    this.directionsDock.addEventListener('pointerup', this.handleDockPointerUp);
    this.directionsDock.addEventListener('pointercancel', this.handleDockPointerUp);
  }

  handleDockPointerMove(event) {
    const state = this.panelSwipeState;
    if (!state?.active || event.pointerId !== state.pointerId) {
      return;
    }
    const currentY = Number.isFinite(event.clientY) ? event.clientY : state.lastY;
    const deltaY = currentY - state.startY;
    state.lastY = currentY;
    if (!state.hasExceededThreshold && Math.abs(deltaY) > 8 && event.cancelable) {
      event.preventDefault();
      state.hasExceededThreshold = true;
    }
  }

  handleDockPointerUp(event) {
    const state = this.panelSwipeState;
    if (!state?.active || event.pointerId !== state.pointerId || !this.directionsDock) {
      return;
    }
    const endY = Number.isFinite(event.clientY) ? event.clientY : state.lastY;
    const deltaY = endY - state.startY;
    const absDelta = Math.abs(deltaY);
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    const duration = Math.max(1, now - state.startTime);
    const quickSwipe = absDelta > 25 && duration < 320;
    const threshold = 48;

    let handled = false;
    if (state.allowOpen && (deltaY <= -threshold || (quickSwipe && deltaY < -20))) {
      this.setPanelVisible(true);
      handled = true;
    } else if (state.allowClose && (deltaY >= threshold || (quickSwipe && deltaY > 20))) {
      this.setPanelVisible(false);
      handled = true;
    } else if (absDelta < 10) {
      if (state.allowOpen) {
        this.setPanelVisible(true);
        handled = true;
      } else if (state.allowClose) {
        this.setPanelVisible(false);
        handled = true;
      }
    }

    try {
      event.target.releasePointerCapture?.(state.pointerId);
    } catch (_) {
      // Ignore pointer release failures.
    }

    this.panelSwipeState = {
      active: false,
      pointerId: null,
      startY: 0,
      lastY: 0,
      startTime: 0,
      allowOpen: false,
      allowClose: false,
      hasExceededThreshold: false
    };

    this.directionsDock.removeEventListener('pointermove', this.handleDockPointerMove);
    this.directionsDock.removeEventListener('pointerup', this.handleDockPointerUp);
    this.directionsDock.removeEventListener('pointercancel', this.handleDockPointerUp);

    if (handled && event.cancelable) {
      event.preventDefault();
    }
  }

  setupMapHandlers() {
    this.map.on('mousedown', 'waypoints-hit-area', this.handleWaypointMouseDown);
    this.map.on('mouseenter', 'waypoints-hit-area', this.handleWaypointMouseEnter);
    this.map.on('mouseleave', 'waypoints-hit-area', this.handleWaypointMouseLeave);
    this.map.on('mousedown', SEGMENT_MARKER_LAYER_ID, this.handleSegmentMarkerMouseDown);
    this.map.on('touchstart', SEGMENT_MARKER_LAYER_ID, this.handleSegmentMarkerMouseDown);
    this.map.on('click', SEGMENT_MARKER_LAYER_ID, this.handleBivouacClick);
    this.map.on('mouseenter', SEGMENT_MARKER_LAYER_ID, this.handleBivouacMouseEnter);
    this.map.on('mouseleave', SEGMENT_MARKER_LAYER_ID, this.handleBivouacMouseLeave);
    this.map.on('mousedown', this.handleMapMouseDown);
    this.map.on('mousemove', this.handleMapMouseMove);
    this.map.on('mouseup', this.handleMapMouseUp);
    this.map.on('mouseleave', this.handleMapMouseLeave);
    this.map.on('click', (e) => {
      console.log('[DirectionsManager] Map Clicked. Panel visible:', this.isPanelVisible());
      this.handleMapClick(e);
    });
    this.map.on('dblclick', 'waypoints-hit-area', this.handleWaypointDoubleClick);
    this.map.on('contextmenu', 'waypoints-hit-area', this.handleWaypointContextMenu);
    this.map.on('contextmenu', this.handleRouteContextMenu);
  }

  getProfileModeDefinition(mode) {
    const definition = PROFILE_MODE_DEFINITIONS?.[mode];
    return definition || PROFILE_MODE_DEFINITIONS[DEFAULT_PROFILE_MODE];
  }

  getProfileLegendEntries(mode) {
    if (!mode || mode === 'none') {
      return [];
    }
    const entries = PROFILE_MODE_LEGENDS?.[mode];
    if (!Array.isArray(entries)) {
      return [];
    }
    return entries.map((entry) => cloneClassificationEntry(entry)).filter(Boolean);
  }

  updateProfileModeUI() {
    const definition = this.getProfileModeDefinition(this.profileMode);
    const label = definition?.label ?? this.profileMode;
    if (this.profileModeLabel) {
      this.profileModeLabel.textContent = label;
    }
    if (this.profileModeToggle) {
      this.profileModeToggle.setAttribute('aria-expanded', this.profileMenuOpen ? 'true' : 'false');
    }
    if (this.profileModeMenu) {
      this.profileModeMenu.classList.toggle('profile-mode-menu__list--open', this.profileMenuOpen);
      this.profileModeMenu.setAttribute('aria-hidden', this.profileMenuOpen ? 'false' : 'true');
    }
    this.profileModeOptions.forEach((button) => {
      const mode = button?.dataset?.profileMode;
      const isActive = mode === this.profileMode;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
    const hasRoute = Array.isArray(this.routeGeojson?.geometry?.coordinates)
      && this.routeGeojson.geometry.coordinates.length >= 2;
    this.updateProfileLegend(hasRoute);
  }

  updateProfileLegend(hasRoute = true) {
    if (!this.profileLegend) {
      return;
    }
    const shouldDisplay = Boolean(
      hasRoute && this.profileMode !== 'none' && this.profileMode !== 'poi'
    );
    if (!shouldDisplay) {
      this.profileLegend.innerHTML = '';
      this.profileLegend.setAttribute('aria-hidden', 'true');
      this.profileLegend.classList.remove('profile-legend--gradient');
      this.profileLegend.dataset.ready = 'false';
      this.profileLegendVisible = false;
      this.cancelProfileLegendReveal();
      return;
    }
    const entries = this.getProfileLegendEntries(this.profileMode);
    if (!entries.length) {
      this.profileLegend.innerHTML = '';
      this.profileLegend.setAttribute('aria-hidden', 'true');
      this.profileLegend.classList.remove('profile-legend--gradient');
      this.profileLegend.dataset.ready = 'false';
      this.profileLegendVisible = false;
      this.cancelProfileLegendReveal();
      return;
    }
    const fallbackColor = this.modeColors?.[this.currentMode] ?? '#3ab7c6';
    const normalizeColor = (value) => {
      if (typeof value !== 'string') {
        return fallbackColor;
      }
      const trimmed = value.trim();
      if (HEX_COLOR_PATTERN.test(trimmed)) {
        return trimmed;
      }
      return fallbackColor;
    };
    const isGradientMode = this.profileMode === 'slope';
    this.profileLegend.classList.toggle('profile-legend--gradient', isGradientMode);
    this.profileLegend.innerHTML = '';
    this.profileLegend.dataset.ready = 'true';
    this.profileLegendVisible = this.profileLegendVisible && shouldDisplay;
    if (isGradientMode) {
      const totalStops = entries.length - 1;
      const gradientStops = entries
        .map((entry, index) => {
          const color = normalizeColor(entry.color);
          if (totalStops <= 0) {
            return `${color} 0%`;
          }
          const percentage = (index / totalStops) * 100;
          const clamped = Number.isFinite(percentage) ? Math.max(0, Math.min(percentage, 100)) : 0;
          return `${color} ${clamped.toFixed(2)}%`;
        });
      const gradientBar = document.createElement('div');
      gradientBar.className = 'profile-legend__gradient-bar';
      const gradientTrack = document.createElement('div');
      gradientTrack.className = 'profile-legend__gradient-track';
      if (gradientStops.length) {
        gradientTrack.style.setProperty('--profile-gradient', `linear-gradient(90deg, ${gradientStops.join(', ')})`);
      }
      gradientBar.appendChild(gradientTrack);
      const labelsWrapper = document.createElement('div');
      labelsWrapper.className = 'profile-legend__gradient-labels';
      const extractRangeLabel = (entry) => {
        if (!entry || typeof entry !== 'object') {
          return '';
        }
        if (typeof entry.label === 'string') {
          const match = entry.label.match(/\(([^)]+)\)/);
          if (match && match[1]) {
            return match[1];
          }
          return entry.label;
        }
        if (typeof entry.key === 'string') {
          return entry.key;
        }
        return '';
      };
      const labels = this.profileMode === 'slope'
        ? SLOPE_GRADIENT_LABELS
        : entries.map((entry) => extractRangeLabel(entry)).filter((label) => typeof label === 'string' && label);
      labels.forEach((labelText) => {
        const labelElement = document.createElement('span');
        labelElement.className = 'profile-legend__gradient-label';
        labelElement.textContent = labelText;
        labelsWrapper.appendChild(labelElement);
      });
      this.profileLegend.appendChild(gradientBar);
      this.profileLegend.appendChild(labelsWrapper);
    } else {
      const items = entries
        .map((entry) => {
          const color = normalizeColor(entry.color);
          const safeLabel = escapeHtml(entry.label ?? entry.key ?? '');
          return `
          <li class="profile-legend__item">
            <span class="profile-legend__swatch" style="--legend-color:${color}"></span>
            <span class="profile-legend__label">${safeLabel}</span>
          </li>
        `.trim();
        })
        .join('');
      this.profileLegend.innerHTML = `<ul class="profile-legend__list">${items}</ul>`;
    }
    this.profileLegend.setAttribute('aria-hidden', this.profileLegendVisible ? 'false' : 'true');
  }

  openProfileMenu() {
    if (this.profileMenuOpen) {
      return;
    }
    this.profileMenuOpen = true;
    this.updateProfileModeUI();
    if (this.profileModeMenu && typeof this.profileModeMenu.focus === 'function') {
      this.profileModeMenu.focus();
    }
    this.hideProfileLegend();
  }

  closeProfileMenu({ restoreFocus = false } = {}) {
    if (!this.profileMenuOpen) {
      return;
    }
    this.profileMenuOpen = false;
    this.updateProfileModeUI();
    if (restoreFocus && this.profileModeToggle && typeof this.profileModeToggle.focus === 'function') {
      this.profileModeToggle.focus();
    }
    this.hideProfileLegend();
  }

  toggleProfileMenu() {
    if (this.profileMenuOpen) {
      this.closeProfileMenu();
    } else {
      this.openProfileMenu();
    }
  }

  setProfileMode(mode, { silent = false } = {}) {
    const normalized = typeof mode === 'string' && PROFILE_MODE_DEFINITIONS[mode]
      ? mode
      : DEFAULT_PROFILE_MODE;
    this.profileMode = normalized;
    this.updateProfileModeUI();
    this.hideProfileLegend();
    this.updateRoutePoiLayerVisibility();
    if (silent) {
      return;
    }
    this.updateProfileSegments();
    // Update manual route overlay colors to match the new profile mode
    this.updateManualRouteSource();
    // Refresh distance markers to update colors based on new profile mode
    this.updateDistanceMarkers(this.routeGeojson);
    // Refresh waypoint colors to match the new profile mode
    this.updateWaypoints();
    if (Array.isArray(this.routeGeojson?.geometry?.coordinates)
      && this.routeGeojson.geometry.coordinates.length >= 2) {
      this.updateElevationProfile(this.routeGeojson.geometry.coordinates);

      // Re-apply day zoom if a day was selected
      if (this.selectedDayIndex !== null && this.selectedDayIndex !== undefined) {
        this.zoomElevationChartToDay(this.selectedDayIndex);
      }
    }
  }

  hasProfileLegendContent() {
    return Boolean(this.profileLegend) && this.profileLegend.dataset?.ready === 'true';
  }

  cancelProfileLegendReveal() {
    if (this.profileLegendHoldTimeout !== null) {
      clearTimeout(this.profileLegendHoldTimeout);
      this.profileLegendHoldTimeout = null;
    }
  }

  scheduleProfileLegendReveal() {
    if (!this.hasProfileLegendContent() || this.profileMenuOpen || this.profileLegendVisible) {
      return;
    }
    this.cancelProfileLegendReveal();
    this.profileLegendHoldTimeout = globalThis.setTimeout(() => {
      this.profileLegendHoldTimeout = null;
      this.showProfileLegend();
    }, PROFILE_LEGEND_SHOW_DELAY_MS);
  }

  showProfileLegend() {
    if (!this.hasProfileLegendContent() || this.profileMenuOpen || !this.profileLegend) {
      return;
    }
    this.cancelProfileLegendReveal();
    this.profileLegendVisible = true;
    this.profileLegend.setAttribute('aria-hidden', 'false');
  }

  hideProfileLegend() {
    this.cancelProfileLegendReveal();
    this.profileLegendVisible = false;
    if (this.profileLegend) {
      this.profileLegend.setAttribute('aria-hidden', 'true');
    }
  }

  handleProfileLegendPointerEnter(event) {
    if (!event) {
      return;
    }
    if (event.type === 'pointerenter' && event.pointerType === 'touch') {
      return;
    }
    if (event.type === 'pointerdown' && typeof event.button === 'number' && event.button !== 0) {
      return;
    }
    this.scheduleProfileLegendReveal();
  }

  handleProfileLegendPointerLeave() {
    this.cancelProfileLegendReveal();
    if (this.profileModeToggle && document.activeElement === this.profileModeToggle) {
      return;
    }
    this.hideProfileLegend();
  }

  handleProfileLegendFocus() {
    this.scheduleProfileLegendReveal();
  }

  handleProfileLegendBlur() {
    this.hideProfileLegend();
  }

  handleProfileLegendKeyDown(event) {
    if (event?.key === 'Escape') {
      this.hideProfileLegend();
    }
  }

}
