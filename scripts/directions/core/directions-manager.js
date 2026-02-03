import { EMPTY_COLLECTION, MODE_COLORS } from '../constants/directions-constants.js';
import { DEFAULT_PROFILE_MODE } from '../constants/directions-profile-constants.js';

import { DirectionsManagerInitMixin } from '../mixins/directions-manager-init.js';
import { DirectionsManagerProfileSegmentsMixin } from '../mixins/directions-manager-profile-segments.js';
import { DirectionsManagerHistoryMixin } from '../mixins/directions-manager-history.js';
import { DirectionsManagerRoutingMixin } from '../mixins/directions-manager-routing.js';
import { DirectionsManagerRouteMixin } from '../mixins/directions-manager-route.js';
import { DirectionsManagerInteractionsMixin } from '../mixins/directions-manager-interactions.js';
import { DirectionsManagerStatsMixin } from '../mixins/directions-manager-stats.js';

const applyMixins = (targetClass, mixinClasses) => {
  mixinClasses.forEach((mixinClass) => {
    const descriptors = Object.getOwnPropertyDescriptors(mixinClass.prototype);
    delete descriptors.constructor;
    Object.defineProperties(targetClass.prototype, descriptors);
  });
};

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
      routeTimeline,
      elevationCard,
      elevationChartBody,
      elevationChart,
      elevationCollapseToggle,
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
    this.routeTimeline = routeTimeline ?? null;
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

    // Ensure route layers stay on top when custom layers are toggled or style changes
    this.map.on('styledata', () => {
      if (typeof this.moveRouteLayersToTop === 'function') {
        this.moveRouteLayersToTop();
      }
    });

    this.setupUIHandlers();
    this.setupMapHandlers();
    this.setProfileMode(this.profileMode, { silent: true });
    this.setRouter(router ?? null, { deferEnsureReady: deferRouterInitialization });
    this.updateUndoAvailability();
    this.updatePanelVisibilityState();
    this.updateElevationVisibilityState();
  }

}

applyMixins(DirectionsManager, [
  DirectionsManagerInitMixin,
  DirectionsManagerProfileSegmentsMixin,
  DirectionsManagerHistoryMixin,
  DirectionsManagerRoutingMixin,
  DirectionsManagerRouteMixin,
  DirectionsManagerInteractionsMixin,
  DirectionsManagerStatsMixin
]);
