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

export class DirectionsManager {

  constructor(map, uiElements = [], options = {}) {
    if (!map || typeof map.addSource !== 'function') {
      throw new Error('A valid MapLibre GL JS map instance is required');
    }

    const [
      directionsToggle,
      directionsDock,
      directionsControl,
      transportModes,
      swapButton,
      undoButton,
      redoButton,
      clearButton,
      routeStats,
      elevationCard,
      elevationChartBody,
      elevationChart,
      elevationCollapseToggle,
      directionsInfoButton,
      directionsHint,
      profileModeToggle,
      profileModeMenu,
      profileLegend
    ] = uiElements;

    const {
      router = null,
      deferRouterInitialization = false
    } = options ?? {};

    this.map = map;
    this.mapContainer = map.getContainer?.() ?? null;
    this.directionsToggle = directionsToggle ?? null;
    this.directionsDock = directionsDock ?? null;
    this.directionsControl = directionsControl ?? null;
    this.directionsSwipeHandle = this.directionsDock
      ? this.directionsDock.querySelector('.directions-swipe-handle')
      : null;
    this.transportModes = transportModes ? Array.from(transportModes) : [];
    this.swapButton = swapButton ?? null;
    this.undoButton = undoButton ?? null;
    this.redoButton = redoButton ?? null;
    this.clearButton = clearButton ?? null;
    this.routeStats = routeStats ?? null;
    this.elevationChart = elevationChart ?? null;
    this.elevationCard = elevationCard ?? (this.elevationChart?.closest?.('.chart-card') ?? null);
    this.elevationChartBody = elevationChartBody ?? this.elevationChart?.parentElement ?? null;
    this.elevationCollapseToggle = elevationCollapseToggle ?? null;
    this.elevationCollapseLabel = this.elevationCollapseToggle
      ? this.elevationCollapseToggle.querySelector('.chart-card__collapse-label')
      : null;
    this.isElevationCollapsed = true;
    this.elevationHoverIndicator = null;
    this.elevationHoverLine = null;
    this.infoButton = directionsInfoButton ?? null;
    this.directionsHint = directionsHint ?? null;
    this.directionsHeader = this.directionsControl
      ? this.directionsControl.querySelector('.directions-header')
      : null;
    this.profileModeToggle = profileModeToggle ?? null;
    this.profileModeMenu = profileModeMenu ?? null;
    // Profile mode options can come from either the old dropdown menu or the new sidebar
    // First, try the new sidebar (in the chart wrapper)
    this.profileModeSidebar = this.elevationChartBody
      ? this.elevationChartBody.querySelector('.profile-mode-sidebar')
      : null;
    this.profileModeOptions = this.profileModeSidebar
      ? Array.from(this.profileModeSidebar.querySelectorAll('[data-profile-mode]'))
      : this.profileModeMenu
        ? Array.from(this.profileModeMenu.querySelectorAll('[data-profile-mode]'))
        : [];
    this.profileModeLabel = this.profileModeToggle
      ? this.profileModeToggle.querySelector('.profile-mode-button__label')
      : null;
    this.profileLegend = profileLegend ?? null;
    this.profileLegendVisible = false;
    this.profileLegendHoldTimeout = null;

    this.isRouteStatsHoverActive = false;
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

    this.handleDockPointerDown = this.handleDockPointerDown.bind(this);
    this.handleDockPointerMove = this.handleDockPointerMove.bind(this);
    this.handleDockPointerUp = this.handleDockPointerUp.bind(this);

    this.handleProfileLegendPointerEnter = this.handleProfileLegendPointerEnter.bind(this);
    this.handleProfileLegendPointerLeave = this.handleProfileLegendPointerLeave.bind(this);
    this.handleProfileLegendFocus = this.handleProfileLegendFocus.bind(this);
    this.handleProfileLegendBlur = this.handleProfileLegendBlur.bind(this);
    this.handleProfileLegendKeyDown = this.handleProfileLegendKeyDown.bind(this);

    if (this.profileModeToggle) {
      this.profileModeToggle.addEventListener('pointerenter', this.handleProfileLegendPointerEnter);
      this.profileModeToggle.addEventListener('pointerleave', this.handleProfileLegendPointerLeave);
      this.profileModeToggle.addEventListener('pointerdown', this.handleProfileLegendPointerEnter);
      this.profileModeToggle.addEventListener('pointerup', this.handleProfileLegendPointerLeave);
      this.profileModeToggle.addEventListener('pointercancel', this.handleProfileLegendPointerLeave);
      this.profileModeToggle.addEventListener('focus', this.handleProfileLegendFocus);
      this.profileModeToggle.addEventListener('blur', this.handleProfileLegendBlur);
      this.profileModeToggle.addEventListener('keydown', this.handleProfileLegendKeyDown);
      this.profileModeToggle.addEventListener('click', () => {
        this.hideProfileLegend();
      });
    }

    if (this.routeStats) {
      this.routeStats.setAttribute('aria-live', 'polite');
      this.routeStats.setAttribute('role', 'group');
    }

    this.waypoints = [];
    this.waypointHistory = [];
    this.waypointRedoHistory = [];
    this.currentMode = 'foot-hiking';
    this.modeColors = { ...MODE_COLORS };

    this.latestMetrics = null;
    this.selectedDayIndex = null;
    this.fullRouteDomain = null;

    this.isDragging = false;
    this.draggedWaypointIndex = null;
    this.draggedBivouacIndex = null;
    this.draggedBivouacLngLat = null;
    this.hoveredWaypointIndex = null;
    this.hoveredSegmentIndex = null;
    this.hoveredLegIndex = null;

    this.routeGeojson = null;
    this.routeSegments = [];
    this.segmentLegLookup = [];
    this.cachedLegSegments = new Map();
    this.routeProfile = null;
    this.routeCoordinateMetadata = [];
    this.elevationSamples = [];
    this.elevationDomain = null;
    this.elevationYAxis = null;
    this.routeLineGradientSupported = true;
    this.routeLineGradientExpression = null;
    this.routeLineGradientData = EMPTY_COLLECTION;
    this.routeLineFallbackData = EMPTY_COLLECTION;
    this.elevationChartContainer = null;
    this.elevationHoverIndicator = null;
    this.elevationHoverLine = null;
    this.highlightedElevationBar = null;
    this.activeHoverSource = null;
    this.lastElevationHoverDistance = null;
    this.setRoutePointsOfInterest([]);
    this.pendingPoiRequest = null;
    this.offlinePoiCollection = EMPTY_COLLECTION;

    this.setHintVisible(false);

    this.router = null;

    this.handleWaypointMouseDown = (event) => this.onWaypointMouseDown(event);
    this.handleMapMouseDown = (event) => this.onMapMouseDown(event);
    this.handleMapMouseMove = (event) => this.onMapMouseMove(event);
    this.handleMapMouseUp = (event) => this.onMapMouseUp(event);
    this.handleMapMouseLeave = () => {
      this.resetSegmentHover('map');
      this.setHoveredWaypointIndex(null);
    };
    this.handleMapClick = (event) => this.onMapClick(event);
    this.handleWaypointDoubleClick = (event) => this.onWaypointDoubleClick(event);
    this.handleWaypointContextMenu = (event) => this.onWaypointContextMenu(event);
    this.handleElevationPointerMove = (event) => this.onElevationPointerMove(event);
    this.handleElevationPointerLeave = () => this.onElevationPointerLeave();
    this.handleElevationContextMenu = (event) => this.onElevationContextMenu(event);
    this.handleRouteContextMenu = (event) => this.onRouteContextMenu(event);
    this.handleSegmentMarkerMouseDown = (event) => this.onSegmentMarkerMouseDown(event);
    this.handleBivouacClick = (event) => this.onBivouacClick(event);
    this.handleBivouacMouseEnter = (event) => this.onBivouacMouseEnter(event);
    this.handleBivouacMouseLeave = (event) => this.onBivouacMouseLeave(event);
    this.handleWaypointMouseEnter = (event) => this.onWaypointMouseEnter(event);
    this.handleWaypointMouseLeave = (event) => this.onWaypointMouseLeave(event);

    this.routeHoverTooltip = null;
    this.bivouacPopup = null;
    this.bivouacDragStartTime = null;

    this.routeCutDistances = [];
    this.cutSegments = [];
    this.profileSegments = [];
    this.profileMode = DEFAULT_PROFILE_MODE;
    this.profileMenuOpen = false;
    this.routeSegmentsListener = null;
    this.networkPreparationCallback = null;
    this.elevationResizeObserver = null;
    this.terrainElevationErrorLogged = false;

    this.setupRouteLayers();
    this.setupUIHandlers();
    this.setupMapHandlers();
    this.setProfileMode(this.profileMode, { silent: true });
    this.setRouter(router ?? null, { deferEnsureReady: deferRouterInitialization });
    this.updateUndoAvailability();
    this.updatePanelVisibilityState();
    this.updateElevationVisibilityState();
  }

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
  }

  setupUIHandlers() {
    this.directionsToggle?.addEventListener('click', () => {
      this.setPanelVisible(!this.isPanelVisible());
    });

    this.setupPanelGestures();

    this.transportModes.forEach((button) => {
      button.addEventListener('click', () => {
        // Toggle between snap and manual modes
        const currentMode = button.dataset.mode || this.currentMode;
        const newMode = currentMode === 'manual' ? 'foot-hiking' : 'manual';
        button.dataset.mode = newMode;
        button.setAttribute('aria-pressed', newMode === 'foot-hiking' ? 'true' : 'false');
        button.setAttribute('aria-label', newMode === 'manual' ? 'Manual line' : 'Snap to trails');
        button.setAttribute('title', newMode === 'manual' ? 'Manual line' : 'Snap to trails');
        this.setTransportMode(newMode);
      });
    });

    if (this.infoButton) {
      const showHint = () => this.setHintVisible(true);
      const hideHint = () => this.setHintVisible(false);
      this.infoButton.addEventListener('mouseenter', showHint);
      this.infoButton.addEventListener('mouseleave', hideHint);
      this.infoButton.addEventListener('focus', showHint);
      this.infoButton.addEventListener('blur', hideHint);
    }

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
    this.map.on('click', this.handleMapClick);
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
      const markerFeatures = this.computeSegmentMarkers()
        .map((marker) => {
          const coords = Array.isArray(marker.coordinates) ? marker.coordinates.slice() : null;
          if (!coords || coords.length < 2) {
            return null;
          }
          return {
            type: 'Feature',
            properties: {
              name: marker.name ?? marker.title ?? '',
              marker_type: marker.type,
              segmentIndex: marker.segmentIndex ?? null,
              color: marker.labelColor ?? null,
              source: 'waypoint'
            },
            geometry: {
              type: 'Point',
              coordinates: coords
            }
          };
        })
        .filter(Boolean);
      if (!markerFeatures.length) {
        return EMPTY_COLLECTION;
      }
      return {
        type: 'FeatureCollection',
        features: markerFeatures
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

    const markerFeatures = markers
      .map((marker) => {
        const coords = Array.isArray(marker.coordinates) ? marker.coordinates.slice() : null;
        if (!coords || coords.length < 2) {
          return null;
        }
        return {
          type: 'Feature',
          properties: {
            name: marker.name ?? marker.title ?? '',
            marker_type: marker.type,
            segmentIndex: marker.segmentIndex ?? null,
            color: marker.labelColor ?? null,
            source: 'waypoint'
          },
          geometry: {
            type: 'Point',
            coordinates: coords
          }
        };
      })
      .filter(Boolean);

    const features = [...trackFeatures, ...markerFeatures];
    if (!features.length) {
      return EMPTY_COLLECTION;
    }

    return {
      type: 'FeatureCollection',
      features
    };
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

    const displaySegments = Array.isArray(this.profileSegments) && this.profileSegments.length
      ? this.profileSegments
      : this.cutSegments;

    // Compute overlap offsets for the entire route
    const routeCoordinates = this.routeGeojson?.geometry?.coordinates ?? [];
    const overlapResult = computeRouteOverlapOffsets(routeCoordinates);
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
    source.setData(targetData ?? EMPTY_COLLECTION);

    if (this.routeLineGradientSupported) {
      this.setRouteLineGradient();
    }

    this.updateSegmentMarkers();
  }

  updateCutDisplays() {
    // Reset day selection when bivouacs change to avoid inconsistent state
    this.selectedDayIndex = null;

    const coordinates = this.routeGeojson?.geometry?.coordinates ?? [];
    this.updateRouteCutSegments();
    this.updateRouteLineSource();
    this.updateElevationProfile(coordinates);
    this.updateDistanceMarkers(this.routeGeojson);
    this.updateWaypoints();
    this.notifyRouteSegmentsUpdated();
    // Ensure manual route overlay colors are refreshed with the final cutSegments
    this.updateManualRouteSource();

    // Refresh route stats panel to update day tabs after bivouac changes
    this._lastSummaryStatsKey = null; // Clear cache to force re-render
    if (this.routeGeojson) {
      this.updateStats(this.routeGeojson);
    }

    // Update POI icon colors to match new day segments
    this.updatePoiDayColors();
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

  setHintVisible(isVisible) {
    const visible = Boolean(isVisible);
    if (this.directionsHint) {
      this.directionsHint.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }
    if (this.infoButton) {
      this.infoButton.classList.toggle('show-tooltip', visible);
    }
  }

  isPanelVisible() {
    return Boolean(this.directionsControl?.classList.contains('visible'));
  }

  setPanelVisible(shouldShow) {
    const visible = Boolean(shouldShow);
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
      this.setHintVisible(false);
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
      const mousePixel = this.map.project(event.lngLat);
      const markers = this.computeSegmentMarkers();
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
    const viaFallback = this.cutSegments?.[0]?.color ?? fallback;
    const preferFallback = () => {
      if (isStart) {
        return startFallback;
      }
      if (isEnd) {
        return endFallback;
      }
      return viaFallback;
    };

    if (!Array.isArray(this.routeSegments) || !this.routeSegments.length) {
      return preferFallback();
    }

    let distanceKm = null;
    if (isStart) {
      distanceKm = 0;
    } else if (isEnd) {
      const totalDistance = Number(this.routeProfile?.totalDistanceKm);
      distanceKm = Number.isFinite(totalDistance) ? totalDistance : null;
    }

    try {
      if (!Number.isFinite(distanceKm)) {
        const lngLat = toLngLat(coords);
        const projection = this.projectOntoRoute(lngLat, ROUTE_CLICK_PIXEL_TOLERANCE);
        if (projection && Number.isFinite(projection.distanceKm)) {
          distanceKm = projection.distanceKm;
        }
      }

      if (Number.isFinite(distanceKm)) {
        const colorValue = this.getColorForDistance(distanceKm);
        const trimmed = typeof colorValue === 'string' ? colorValue.trim() : '';
        if (trimmed) {
          return trimmed;
        }
      }
    } catch (error) {
      console.warn('Failed to resolve waypoint color', error);
    }

    return preferFallback();
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
    if (typeof this.map.getTerrain === 'function') {
      const terrain = this.map.getTerrain();
      if (!terrain || !terrain.source) {
        return false;
      }
      if (Number.isFinite(terrain.exaggeration) && terrain.exaggeration <= 0) {
        return false;
      }
    }
    return true;
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

    const canQueryTerrain = this.canQueryTerrainElevation();
    if (canQueryTerrain) {
      this.terrainElevationErrorLogged = false;
    }

    for (let index = 0; index < sanitized.length; index += 1) {
      const coord = sanitized[index];
      let elevation = Number.isFinite(coord[2]) ? coord[2] : null;
      if (canQueryTerrain) {
        const terrainElevation = this.queryTerrainElevationValue(coord);
        if (Number.isFinite(terrainElevation)) {
          elevation = terrainElevation;
        }
      }
      coord[2] = Number.isFinite(elevation) ? elevation : null;
    }

    const cumulativeDistances = new Array(sanitized.length).fill(0);
    let totalDistance = 0;

    for (let index = 1; index < sanitized.length; index += 1) {
      const segmentDistance = this.computeDistanceKm(sanitized[index - 1], sanitized[index]);
      totalDistance += Number.isFinite(segmentDistance) ? segmentDistance : 0;
      cumulativeDistances[index] = totalDistance;
    }

    const elevations = sanitized.map((coord) => {
      const elevation = coord?.[2];
      return Number.isFinite(elevation) ? elevation : null;
    });

    return {
      coordinates: sanitized,
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
    this.updateStats(null);
    this.updateElevationProfile([]);
    this.routeCoordinateMetadata = [];
    this.profileSegments = [];
    this.updateRouteLineSource();
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

    const candidates = [];
    const pushCandidate = (coordinates, properties = {}) => {
      const sequence = this.normalizeImportedSequence(coordinates);
      if (sequence.length < 2) {
        return;
      }
      const distanceKm = this.estimateSequenceDistanceKm(sequence);
      const source = typeof properties.source === 'string' ? properties.source : null;
      let priority = 1;
      if (source === 'track') {
        priority = 3;
      } else if (source === 'route') {
        priority = 2;
      }
      candidates.push({
        coordinates: sequence.map((coord) => coord.slice()),
        properties: { ...properties },
        distanceKm,
        priority
      });
    };

    const handleGeometry = (geometry, properties = {}) => {
      if (!geometry || typeof geometry !== 'object') {
        return;
      }
      if (geometry.type === 'LineString') {
        pushCandidate(geometry.coordinates, properties);
        return;
      }
      if (geometry.type === 'MultiLineString') {
        const merged = this.mergeImportedCoordinateSegments(geometry.coordinates);
        if (merged.length >= 2) {
          pushCandidate(merged, properties);
        }
        return;
      }
      if (geometry.type === 'GeometryCollection' && Array.isArray(geometry.geometries)) {
        geometry.geometries.forEach((child) => handleGeometry(child, properties));
      }
    };

    if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
      geojson.features.forEach((feature) => {
        if (!feature || !feature.geometry) {
          return;
        }
        handleGeometry(feature.geometry, feature.properties || {});
      });
    } else if (geojson.type === 'Feature') {
      handleGeometry(geojson.geometry, geojson.properties || {});
    } else if (geojson.type === 'LineString' || geojson.type === 'MultiLineString' || geojson.type === 'GeometryCollection') {
      handleGeometry(geojson, {});
    }

    if (!candidates.length) {
      return null;
    }

    candidates.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      if (Number.isFinite(b.distanceKm) && Number.isFinite(a.distanceKm) && b.distanceKm !== a.distanceKm) {
        return b.distanceKm - a.distanceKm;
      }
      return (b.coordinates.length || 0) - (a.coordinates.length || 0);
    });

    const best = candidates[0];
    const properties = { ...(best.properties || {}) };
    return {
      coordinates: best.coordinates,
      properties,
      distanceKm: best.distanceKm
    };
  }

  importRouteFromGeojson(geojson, options = {}) {
    const candidate = this.extractRouteFromGeojson(geojson);
    if (!candidate || !Array.isArray(candidate.coordinates) || candidate.coordinates.length < 2) {
      console.warn('No route geometry found in imported data');
      return false;
    }

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

    if (!(this.cachedLegSegments instanceof Map) || !this.cachedLegSegments.size) {
      source.setData(EMPTY_COLLECTION);
      return;
    }

    const features = [];
    const fallbackColor = this.modeColors[this.currentMode] || '#f8b40b';

    // Build cumulative distances for legs from routeGeojson segments
    const routeSegments = this.routeGeojson?.properties?.segments;
    const legCumulativeDistances = [0];
    if (Array.isArray(routeSegments)) {
      let cumulative = 0;
      routeSegments.forEach((seg) => {
        // distance is in meters
        const distanceKm = (Number(seg?.distance) || 0) / 1000;
        cumulative += distanceKm;
        legCumulativeDistances.push(cumulative);
      });
    }

    // Helper to compute distance for a coordinate array
    const computeSegmentDistances = (coords) => {
      const distances = [0];
      for (let i = 1; i < coords.length; i++) {
        const prev = coords[i - 1];
        const curr = coords[i];
        const segDist = haversineDistanceMeters(prev, curr) / 1000;
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
      this.renderSimpleStats(metrics, distanceLabel, ascent, descent, timeLabel);
    }

    this.routeStats.classList.add('has-stats');
    this.routeStats.classList.remove('is-hover');
    this.routeStats.setAttribute('data-mode', 'summary');
    this.isRouteStatsHoverActive = false;
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

    // Use same format as multi-day for consistency
    this.routeStats.innerHTML = `
  <div class="day-details is-visible">
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
        <span class="day-details__item-label">Points d'intérêt :</span>
        <span class="day-details__item-value">${escapeHtml(waypointsText)}</span>
      </div>
      <div class="day-details__item">
        <span class="day-details__item-label">Météo :</span>
        <span class="day-details__item-value weather-container" data-weather-target="route">
          <span class="weather-loading">Chargement...</span>
        </span>
      </div>
    </div>
  </div>
`;
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
        <div class="day-details is-visible">
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
              <span class="day-details__item-label">Points d'intérêt :</span>
              <span class="day-details__item-value">${escapeHtml(waypointsText)}</span>
            </div>
            <div class="day-details__item">
              <span class="day-details__item-label">Météo :</span>
              <span class="day-details__item-value weather-container" data-weather-target="day">
                <span class="weather-loading">Chargement...</span>
              </span>
            </div>
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

      // Build difficulty indicator bars
      const difficultyBars = Array.from({ length: 5 }, (_, i) =>
        `<span class="difficulty-bar${i < difficulty.score ? ' filled' : ''}"></span>`
      ).join('');

      dayDetailsHtml = `
        <div class="day-details is-visible">
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
              <span class="day-details__item-label">Points d'intérêt :</span>
              <span class="day-details__item-value">${escapeHtml(waypointsText)}</span>
            </div>
            <div class="day-details__item">
              <span class="day-details__item-label">Météo :</span>
              <span class="day-details__item-value weather-container" data-weather-target="route">
                <span class="weather-loading">Chargement...</span>
              </span>
            </div>
          </div>
        </div>
      `;
    }

    this.routeStats.innerHTML = `
      <div class="${timelineClass}">${dayTabsHtml}</div>
      ${dayDetailsHtml}
    `;

    // Attach click handlers to day tabs
    this.attachDayTabHandlers();

    // Fetch and display weather data asynchronously
    this.updateWeatherDisplay();
  }

  attachDayTabHandlers() {
    if (!this.routeStats) return;

    const dayTabs = this.routeStats.querySelectorAll('.day-tab');
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

    // PRIORITY 1: Build BIDIRECTIONAL CENTERED gradients from profile segments
    // Pure color is centered in each segment, with smooth transitions towards neighbors
    const useProfileGradient = isProfileGradientMode(this.profileMode)
      && Array.isArray(this.profileSegments)
      && this.profileSegments.length > 0;

    if (useProfileGradient) {
      const totalDistanceKm = Number(this.routeProfile?.totalDistanceKm) || domainSpan;
      const TRANSITION_RATIO = 0.25; // 25% transition zone on each side

      // Build segment info with ratios relative to current domain
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

      // Helper to convert km to ratio within current domain
      const kmToRatio = (km) => Math.max(0, Math.min(1, (km - domainMin) / domainSpan));

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

        // Calculate transition points
        const transitionInEnd = startKm + transitionSize;
        const transitionOutStart = endKm - transitionSize;

        // Start of segment - blend from previous color
        if (prevInfo && prevInfo.color !== color) {
          gradientStops.push({ offset: kmToRatio(startKm), color: prevInfo.color });
          if (transitionInEnd < transitionOutStart) {
            gradientStops.push({ offset: kmToRatio(transitionInEnd), color });
          }
        } else {
          gradientStops.push({ offset: kmToRatio(startKm), color });
        }

        // End of segment - blend towards next color
        if (nextInfo && nextInfo.color !== color) {
          if (transitionOutStart > transitionInEnd) {
            gradientStops.push({ offset: kmToRatio(transitionOutStart), color });
          }
        } else {
          gradientStops.push({ offset: kmToRatio(endKm), color });
        }
      });
    } else if (Array.isArray(this.cutSegments) && this.cutSegments.length > 1) {
      // PRIORITY 2: Use day segment colors with SHARP transitions (for bivouac splits)
      const cutSegs = this.cutSegments;
      for (let i = 0; i < cutSegs.length; i += 1) {
        const segment = cutSegs[i];
        if (!segment) continue;

        const segmentColor = typeof segment.color === 'string' ? segment.color.trim() : fallbackColor;
        let startKm = Number(segment.startKm ?? segment.startDistanceKm ?? 0);
        let endKm = Number(segment.endKm ?? segment.endDistanceKm ?? startKm);

        // Calculate ratios relative to current domain
        const startRatio = Math.max(0, Math.min(1, (startKm - domainMin) / domainSpan));
        const endRatio = Math.max(0, Math.min(1, (endKm - domainMin) / domainSpan));

        // Add start stop
        gradientStops.push({ offset: startRatio, color: segmentColor });

        // For sharp transition at boundary
        if (i < cutSegs.length - 1) {
          const nextSegment = cutSegs[i + 1];
          if (nextSegment) {
            const nextColor = typeof nextSegment.color === 'string' ? nextSegment.color.trim() : fallbackColor;
            // Current color just before boundary
            gradientStops.push({ offset: Math.max(0, endRatio - 0.0001), color: segmentColor });
            // Next color at boundary
            gradientStops.push({ offset: endRatio, color: nextColor });
          }
        } else {
          gradientStops.push({ offset: endRatio, color: segmentColor });
        }
      }
    } else {
      // PRIORITY 3: Single segment - use base color
      const baseColor = this.cutSegments?.[0]?.color ?? fallbackColor;
      gradientStops.push({ offset: 0, color: baseColor });
      gradientStops.push({ offset: 1, color: baseColor });
    }

    // Sort stops by offset
    gradientStops.sort((a, b) => a.offset - b.offset);

    // Ensure we have stops at boundaries
    if (gradientStops.length > 0 && gradientStops[0].offset > 0.001) {
      gradientStops.unshift({ offset: 0, color: gradientStops[0].color });
    }
    if (gradientStops.length > 0 && gradientStops[gradientStops.length - 1].offset < 0.999) {
      gradientStops.push({ offset: 1, color: gradientStops[gradientStops.length - 1].color });
    }

    // Clear existing stops
    gradientEl.innerHTML = '';

    // Add new stops directly (no additional processing - use raw map gradient)
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

    xAxis.ticks.forEach((tick) => {
      const ratio = (tick - xAxis.min) / span;
      const percent = Math.max(0, Math.min(100, ratio * 100));
      const label = document.createElement('span');
      // Show "km" on all ticks, use 0.5 discretization
      label.textContent = `${this.formatAxisDistance(tick)} km`;
      label.style.left = `${percent}%`;
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
    const gradeLabel = Number.isFinite(grade) ? `${grade > 0 ? '+' : ''}${grade.toFixed(1)}%` : '—';
    const durationLabel = Number.isFinite(durationHours) ? this.formatDurationHours(durationHours) : '—';
    const ascentLabel = Number.isFinite(cumulativeAscent) && cumulativeAscent > 0 ? `+${cumulativeAscent} m` : '—';

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
    tooltip.style.left = `${percent}%`;
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

    if ((!Array.isArray(sourceFeatures) || !sourceFeatures.length) && !shouldRetry) {
      let abortController = null;
      if (typeof AbortController === 'function') {
        abortController = new AbortController();
        this.pendingPoiAbortController = abortController;
      }
      try {
        const fallbackFeatures = await fetchOverpassRoutePois(line, {
          bufferMeters: POI_MAX_SEARCH_RADIUS_METERS,
          signal: abortController?.signal
        });
        if (this.pendingPoiRequest !== requestToken) {
          return;
        }
        sourceFeatures = fallbackFeatures;
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
        ? (categoryLabel && categoryLabel !== name ? `${name} · ${categoryLabel}` : name)
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

    const resolved = [];
    for (const entry of mergedPois) {
      if (!entry) {
        continue;
      }
      let iconMetadata = null;
      let iconSvgContent = null;
      const iconKey = typeof entry.iconKey === 'string' ? entry.iconKey.trim() : '';
      if (iconKey) {
        try {
          [iconMetadata, iconSvgContent] = await Promise.all([
            getPoiIconMetadata(iconKey),
            getPoiIconSvgContent(iconKey)
          ]);
        } catch (error) {
          console.warn('Failed to load POI icon data', iconKey, error);
        }
        if (this.pendingPoiRequest !== requestToken) {
          return;
        }
      }
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
      if (this.pendingPoiRequest !== requestToken) {
        return;
      }
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

    const samples = this.generateElevationSamples(coordinates);

    if (!samples.length) {
      this.elevationChart.innerHTML = '';
      this.elevationSamples = [];
      this.elevationDomain = null;
      this.fullRouteDomain = null;
      this.elevationYAxis = null;
      this.elevationChartContainer = null;
      this.elevationChartTooltip = null;
      this.elevationHoverIndicator = null;
      this.elevationHoverLine = null;
      this.highlightedElevationBar = null;
      this.lastElevationHoverDistance = null;
      this.updateProfileLegend(false);
      this.updateElevationVisibilityState();
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
    const xAxisLabels = xTickValues
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
        const style = `left:${position}%;transform:${transform}`;
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
          ${gradientMarkup}
          ${gridLinesMarkup}
          <path class="elevation-area-fill" d="${areaPaths.fill}" fill="${gradientMarkup ? `url(#${gradientId})` : areaFillColor}"/>
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
              type: 'poi',
              categoryKey: poi.category || poi.categoryKey || '',
              distanceKm: dist,
              data: poi,
              name: poi.name || poi.title || DEFAULT_POI_TITLE
            });
          }
        });
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
          } else {
            // POI specific rendering
            const poiCategory = typeof poi?.categoryLabel === 'string' ? poi.categoryLabel.trim() : '';
            const colorValue = typeof poi?.color === 'string' && poi.color.trim() ? poi.color.trim() : DEFAULT_POI_COLOR;

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
                  <path d="M12 2c-5.33 4.55-8 8.48-8 11.8 0 4.98 3.8 8.2 8 8.2s8-3.22 8-8.2c0-3.32-2.67-7.25-8-11.8zm0 18c-3.35 0-6-2.57-6-6.2 0-2.34 1.95-5.44 6-9.14 4.05 3.7 6 6.79 6 9.14 0 3.63-2.65 6.2-6 6.2z"/>
                </svg>
              </span>`
            : '';

          const className = isBivouac ? 'elevation-marker bivouac' : `elevation-marker poi${hasWater ? ' has-water' : ''}`;

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
        const ratio = span > 0 ? (distanceKm - domainLow) / span : 0;
        const clampedRatio = Math.max(0, Math.min(1, ratio));
        const percent = clampedRatio * 100;
        return {
          marker,
          isPoiMarker,
          isBivouacMarker,
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
      const { marker, isPoiMarker, isBivouacMarker, clampedRatio, percent, hasLabel } = entry;

      // Hide markers outside the current visible domain range
      const distanceKm = Number(marker.dataset.distanceKm);
      if (Number.isFinite(distanceKm) && (distanceKm < domainLow || distanceKm > domainHigh)) {
        marker.style.display = 'none';
        return;
      }
      marker.style.display = '';

      const labelElement = hasLabel ? marker.querySelector('.elevation-marker__label') : null;
      marker.style.left = `${percent.toFixed(6)}%`;

      const offsetValue = Number(marker.dataset.bottomOffset);
      const offsetPx = Number.isFinite(offsetValue) ? offsetValue : 0;

      if ((isPoiMarker || isBivouacMarker) && canPositionVertically) {
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
              // Distribute internally within the chart height
              // We divide the available height into 'stackTotal' slots and center each item in its slot
              // stackIndex 0 is top (highest priority), stackIndex N is bottom

              // Formula: (Total - Index - 0.5) / Total
              // Example 1 item: (1 - 0 - 0.5)/1 = 0.5 (50%) -> Center of chart
              const ratio = (stackTotal - stackIndex - 0.5) / stackTotal;

              // Apply ratio to the elevation percent
              const distributedPercent = elevationPercent * ratio;

              // Ensure marker doesn't go below chart (15px safety margin)
              marker.style.bottom = `max(15px, ${distributedPercent.toFixed(6)}%)`;
            } else {
              // Fallback if data is missing
              marker.style.bottom = `max(15px, ${elevationPercent.toFixed(6)}%)`;
            }
          } else {
            // Standard positioning (floating or bivouac) with pixel offset
            const offsetSuffix = offsetPx !== 0 ? ` + ${offsetPx}px` : '';
            if (offsetSuffix) {
              marker.style.bottom = `max(15px, calc(${elevationPercent.toFixed(6)}%${offsetSuffix}))`;
            } else {
              marker.style.bottom = `max(15px, ${elevationPercent.toFixed(6)}%)`;
            }
          }
          // Calculate and set the dashed line height for bivouac markers
          // The line should extend from the marker bottom to the chart bottom (0%)
          if (isBivouacMarker) {
            const containerHeight = this.elevationChartContainer?.clientHeight || 0;
            // The marker's bottom is at elevationPercent% from the container bottom
            // So the line height is simply that percentage of the container height
            const lineHeightPx = Math.max(0, clampedElevation * containerHeight);
            marker.style.setProperty('--bivouac-line-height', `${lineHeightPx.toFixed(1)}px`);
          }
        } else {
          marker.style.bottom = `${offsetPx}px`;
          if (isBivouacMarker) {
            marker.style.setProperty('--bivouac-line-height', '0px');
          }
        }
      } else if (isPoiMarker || isBivouacMarker) {
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
        if (value >= 100) return `${Math.round(value)}`;
        if (value >= 10) return `${parseFloat(value.toFixed(1))}`;
        if (value >= 1) return `${parseFloat(value.toFixed(1))}`;
        const precise = parseFloat(value.toFixed(2));
        return Number.isFinite(precise) ? `${precise}` : '';
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
    this.updateCutDisplays();
    this.updateDistanceMarkers(resolvedRoute);
    this.updateStats(resolvedRoute);
    this.refreshRoutePointsOfInterest().catch((error) => {
      console.warn('Failed to refresh route points of interest', error);
    });
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
}
