/**
 * xploremap-app.js — Slim orchestrator.
 *
 * Imports the modular subsystems and wires them together.
 * Keeps inline: DirectionsManager wiring, GPX import/export with segment
 * exports, imagery-panel DOM rendering, toolbox open/close, FOV/LOD controls.
 */

// ─── Module imports ───
import { createMap, getBaseStyleLayerBuckets } from './map-init.js';
import { createImageryManager, IMAGERY_OPTIONS, LAYER_GROUPS, LAYER_GROUP_BY_MEMBER_ID, clampOpacity, DEM_SOURCE_MAX_ZOOM } from './imagery-manager.js';
import { applyOverlays, applyHillshadeAppearance } from './overlay-manager.js';
import { createRoutingOrchestrator } from './routing-orchestrator.js';
import { createShadowController } from './shadow-controller.js';
import {
  initTerrainAnalysisConfig,
  setupTerrainHoverInfo,
  updateAnalyticalLegends as renderAnalyticalLegends,
} from './terrain-analysis-controller.js';

// ─── External module imports ───
import { createViewModeController } from '../map/map-view-mode-controller.js';
import { DirectionsManager } from '../directions/core/directions-manager.js';
import { RouteLibraryManager } from '../storage/route-library-manager.js';
import { RouteLibraryUI } from '../ui/route-library-ui.js';
import { ensureGpxLayers, zoomToGeojson, parseGpxToGeoJson, geojsonToGpx } from '../gpx/gpx-io.js';

// ─── Config imports ───
import {
  MAPTERHORN_TILE_URL,
  SKY_SETTINGS,
  VIEW_MODES,
  DEFAULT_3D_ORIENTATION,
} from '../config/map-config.js';

// ═══════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════

async function init() {
  // ── 1. Create Map ──
  const { map } = await createMap();

  // ── 2. DEM contour source ──
  const demSource = new mlcontour.DemSource({
    url: MAPTERHORN_TILE_URL,
    encoding: 'terrarium',
    maxzoom: DEM_SOURCE_MAX_ZOOM,
    worker: true,
    tileSize: 512,
  });
  demSource.setupMaplibre(maplibregl);

  // ── 3. Terrain analysis defaults ──
  initTerrainAnalysisConfig();

  // ── 4. View-mode controller & Shadow controller ──
  const vignetteEl = document.querySelector('.vignette');
  const viewToggleBtn = document.getElementById('toggle3D');

  const viewModeController = createViewModeController(map, {
    toggleButton: viewToggleBtn,
    vignetteElement: vignetteEl,
    skySettings: SKY_SETTINGS,
    defaultMode: VIEW_MODES.THREED,
    defaultOrientation: DEFAULT_3D_ORIENTATION,
    terrainSourceId: 'terrainSource',
    hdSources: ['terrainSource', 'hillshadeSource', 'reliefDem'],
  });

  const shadowCtrl = createShadowController(map, { viewModeController });

  // ── 5. Imagery manager ──
  const { overlay: baseStyleOverlayLayerIds, underlay: baseStyleUnderlayLayerIds } = getBaseStyleLayerBuckets();

  const imagery = createImageryManager(map, {
    baseStyleOverlayLayerIds,
    baseStyleUnderlayLayerIds,
    updateAnalyticalLegends: () => renderAnalyticalLegends(map, imagery.imageryState, shadowCtrl.updateShadowTime),
  });

  // ── 6. Routing orchestrator ──
  const routing = createRoutingOrchestrator(map);

  // ── 7. GPX state ──
  const EMPTY_COLLECTION = { type: 'FeatureCollection', features: [] };
  let currentGpxData = EMPTY_COLLECTION;
  let directionsExportData = EMPTY_COLLECTION;
  let directionsSegmentExports = [];

  const ensureFeatureCollection = (geojson) => {
    if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) return EMPTY_COLLECTION;
    return { type: 'FeatureCollection', features: geojson.features.filter(Boolean) };
  };

  const buildCombinedExportData = () => {
    const features = [];
    [currentGpxData, directionsExportData].forEach(c => {
      if (!c || c.type !== 'FeatureCollection') return;
      (c.features || []).forEach(f => { if (f) features.push(f); });
    });
    return { type: 'FeatureCollection', features };
  };

  const cloneFeature = (feature) => {
    if (!feature) return null;
    try { if (typeof structuredClone === 'function') return structuredClone(feature); } catch (_) { }
    try { return JSON.parse(JSON.stringify(feature)); } catch (_) { return null; }
  };

  const slugify = (value) => {
    if (typeof value !== 'string') return 'segment';
    const s = value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s || 'segment';
  };

  const applyGpxData = (geojson, { fitBounds = false } = {}) => {
    currentGpxData = ensureFeatureCollection(geojson);
    const apply = () => {
      ensureGpxLayers(map, currentGpxData);
      if (fitBounds && currentGpxData.features.length) zoomToGeojson(map, currentGpxData);
    };
    if (typeof map.isStyleLoaded === 'function' && !map.isStyleLoaded()) map.once('style.load', apply);
    else apply();
  };
  applyGpxData(EMPTY_COLLECTION);

  // ── 8. Style image missing handler ──
  map.on('styleimagemissing', (e) => {
    if (map.hasImage(e.id)) return;
    map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array([0, 0, 0, 0]) });
  });

  // ── 9. Overlay wiring ──
  const getOverlayDeps = () => ({
    imageryState: imagery.imageryState,
    demSource,
    applyImageryState: imagery.applyImageryState,
    updateImageryControlStates: imagery.updateImageryControlStates,
    applyImageryLayerOrder: imagery.applyImageryLayerOrder,
    ensureGpxLayers,
    currentGpxData,
    debugNetworkVisible: routing.debugNetworkVisible,
    bringDebugNetworkToFront: routing.bringDebugNetworkToFront,
    viewModeController,
  });

  map.on('style.load', () => applyOverlays(map, getOverlayDeps()));
  map.once('style.load', () => applyHillshadeAppearance(map));
  map.once('style.load', () => {
    if (viewModeController && typeof viewModeController.applyCurrentMode === 'function') {
      viewModeController.applyCurrentMode({ animate: false });
    }
  });

  // ── 10. DOM references for DirectionsManager ──
  const directionsToggle = document.getElementById('directionsToggle');
  const directionsDock = document.getElementById('directionsDock');
  const directionsControl = document.getElementById('directionsControl');
  const transportModes = document.getElementById('transportModes');
  const swapButton = document.getElementById('swapButton');
  const undoButton = document.getElementById('undoButton');
  const redoButton = document.getElementById('redoButton');
  const clearButton = document.getElementById('clearButton');
  const routeStats = document.getElementById('routeStats');
  const routeTimeline = document.getElementById('routeTimeline');
  const elevationCard = document.getElementById('elevationCard');
  const elevationChartBody = document.getElementById('elevationChartBody');
  const elevationChart = document.getElementById('elevationChart');
  const elevationCollapseToggle = document.getElementById('elevationCollapseToggle');
  const profileModeToggle = document.getElementById('profileModeToggle');
  const profileModeMenu = document.getElementById('profileModeMenu');
  const profileLegend = document.getElementById('profileLegend');

  // ── 11. DirectionsManager setup (on map load) ──
  let directionsManager = null;

  map.on('load', async () => {
    // Terrain hover readout
    setupTerrainHoverInfo(map);

    try {
      directionsManager = new DirectionsManager(map, [
        directionsToggle, directionsDock, directionsControl, transportModes,
        swapButton, undoButton, redoButton, clearButton,
        routeStats, routeTimeline, elevationCard, elevationChartBody,
        elevationChart, elevationCollapseToggle, profileModeToggle,
        profileModeMenu, profileLegend,
      ], {
        router: routing.offlineRouter,
        deferRouterInitialization: true,
      });

      routing.directionsManager = directionsManager;

      // Route Library
      const routeLibraryManager = new RouteLibraryManager();
      const routeLibraryUI = new RouteLibraryUI(routeLibraryManager, directionsManager);
      directionsManager.routeLibraryManager = routeLibraryManager;

      console.log('[App] DirectionsManager initialized:', directionsManager);

      // Set initial router
      const initialRouter = routing.routers[routing.activeRouterKey] ?? routing.offlineRouter;
      if (typeof directionsManager.setRouter === 'function') {
        const deferEnsureReady = initialRouter === routing.offlineRouter
          && (!Array.isArray(directionsManager.waypoints) || directionsManager.waypoints.length === 0);
        directionsManager.setRouter(initialRouter, { deferEnsureReady });
      }
      if (typeof directionsManager.setOfflinePointsOfInterest === 'function') {
        directionsManager.setOfflinePointsOfInterest(routing.offlineNetworkPois);
      }

      // Route segment listener
      directionsManager.setRouteSegmentsListener((payload) => {
        const isObject = payload && typeof payload === 'object';
        const dataset = isObject && payload.full ? payload.full : payload;
        directionsExportData = ensureFeatureCollection(dataset);
        const segments = isObject && Array.isArray(payload.segments) ? payload.segments : [];
        directionsSegmentExports = segments
          .map((entry) => {
            const collection = ensureFeatureCollection(entry?.collection);
            if (!collection.features?.length) return null;
            const name = typeof entry?.name === 'string' && entry.name.trim().length ? entry.name.trim() : null;
            return { name, index: Number.isInteger(entry?.index) ? entry.index : null, collection };
          })
          .filter(Boolean);
      });

      // Clear directions → clear GPX layer
      directionsManager.setClearDirectionsListener(() => {
        currentGpxData = EMPTY_COLLECTION;
        ensureGpxLayers(map, currentGpxData);
      });

      // Network preparation callback
      directionsManager.setNetworkPreparationCallback(async ({ waypoints }) => {
        if (routing.activeRouterKey !== 'offline') return;
        const coords = Array.isArray(waypoints) ? waypoints : [];
        if (coords.length) {
          try { await routing.offlineRouter.ensureReady(); } catch (e) {
            console.warn('Offline router init failed', e);
          }
        }
        const bounds = routing.computeCoordinateBounds(coords);

        const lacksWaypointCoverage = () => {
          if (!coords.length) return false;
          return routing.shouldRefreshOfflineNetwork();
        };
        const lacksMapCoverage = () => {
          if (coords.length) return false;
          return routing.shouldRefreshOfflineNetwork();
        };

        if (lacksWaypointCoverage() || lacksMapCoverage()) {
          try { await routing.refreshOfflineNetwork({ waypointBounds: bounds }); }
          catch (e) { console.warn('Deferred offline network refresh failed', e); }
        }
      });
    } catch (error) {
      console.error('Failed to initialize directions manager', error);
    }
  });

  // ── 12. Routing toggle click handlers ──
  const routingModeToggle = document.getElementById('routingModeToggle');
  const routingModeIcon = routingModeToggle?.querySelector('.routing-mode-toggle__icon');

  const setActiveRouter = async (targetKey, { reroute = false } = {}) => {
    if (!routing.routers[targetKey]) {
      console.warn(`Router "${targetKey}" unavailable; keeping ${routing.activeRouterKey}`);
      routing.updateRoutingModeToggle();
      routing.updateDebugNetworkAvailability();
      return;
    }
    if (targetKey === routing.activeRouterKey) {
      routing.updateRoutingModeToggle();
      routing.updateDebugNetworkAvailability();
      if (reroute && directionsManager?.waypoints?.length >= 2) {
        directionsManager.getRoute();
      }
      return;
    }
    if (routingModeToggle) routingModeToggle.disabled = true;
    routing.activeRouterKey = targetKey;
    routing.updateRoutingModeToggle();
    routing.updateDebugNetworkAvailability();
    try {
      if (targetKey !== 'offline') {
        if (routing.debugNetworkVisible) {
          routing.hideDebugNetworkLayer();
          routing.debugNetworkVisible = false;
        }
        routing.updateDebugNetworkControlState(false);
      }
      if (directionsManager && typeof directionsManager.setRouter === 'function') {
        const waypointCount = Array.isArray(directionsManager.waypoints) ? directionsManager.waypoints.length : 0;
        const deferEnsureReady = targetKey === 'offline' && waypointCount === 0;
        directionsManager.setRouter(routing.routers[targetKey], { reroute, deferEnsureReady });
      }
    } finally {
      if (routingModeToggle) routingModeToggle.disabled = false;
      routing.updateRoutingModeToggle();
      routing.updateDebugNetworkAvailability();
    }
  };

  const switchRoutingMode = (key, { reroute = true } = {}) =>
    setActiveRouter(key, { reroute }).catch(e => console.error('Failed to switch routing mode', e));

  if (routingModeToggle) {
    routingModeToggle.addEventListener('click', () => {
      switchRoutingMode(routing.activeRouterKey === 'offline' ? 'online' : 'offline');
    });
  }
  if (routingModeIcon) {
    routingModeIcon.addEventListener('click', (e) => {
      if (routing.activeRouterKey !== 'offline') return;
      e.stopPropagation();
      switchRoutingMode('online');
    });
  }

  // ── 13. Debug network checkbox ──
  const debugNetworkCheckbox = document.getElementById('debugNetworkCheckbox');
  if (debugNetworkCheckbox) {
    routing.updateDebugNetworkControlState(false);
    debugNetworkCheckbox.addEventListener('change', async () => {
      if (routing.activeRouterKey !== 'offline') { routing.updateDebugNetworkControlState(false); return; }
      const target = debugNetworkCheckbox.checked;
      debugNetworkCheckbox.disabled = true;
      try {
        if (target) {
          let applied = await routing.applyDebugNetworkLayer();
          if (!applied) { await routing.refreshOfflineNetwork(); applied = await routing.applyDebugNetworkLayer(); }
          if (!applied) window.alert('Unable to display routing network.');
          routing.debugNetworkVisible = applied;
        } else {
          routing.hideDebugNetworkLayer();
          routing.debugNetworkVisible = false;
        }
      } catch (e) { console.error('Failed to toggle routing network overlay', e); }
      finally {
        debugNetworkCheckbox.disabled = false;
        routing.updateDebugNetworkControlState(routing.debugNetworkVisible);
      }
    });
  }

  // ── 14. GPX import / export (inline — segment-aware) ──
  const gpxImportButton = document.getElementById('gpxImportButton');
  const gpxFileInput = document.getElementById('gpxFileInput');
  const gpxExportButton = document.getElementById('gpxExportButton');

  if (gpxImportButton && gpxFileInput) {
    gpxImportButton.addEventListener('click', () => gpxFileInput.click());
    gpxFileInput.addEventListener('change', async () => {
      const file = gpxFileInput.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const geojson = parseGpxToGeoJson(text);
        if (!geojson?.features?.length) {
          window.alert('No GPX features found.');
        } else {
          applyGpxData(geojson, { fitBounds: true });
          if (directionsManager?.importRouteFromGeojson) {
            if (!directionsManager.importRouteFromGeojson(geojson)) {
              console.warn('Unable to init routing from imported GPX');
            }
          }
        }
      } catch (e) {
        console.error('Failed to import GPX', e);
        window.alert('Unable to load GPX file.');
      } finally { gpxFileInput.value = ''; }
    });
  }

  if (gpxExportButton) {
    gpxExportButton.addEventListener('click', () => {
      const dataset = buildCombinedExportData();
      if (!dataset.features?.length) { window.alert('No GPX data to export.'); return; }
      try {
        const downloadGpx = (content, filename) => {
          const blob = new Blob([content], { type: 'application/gpx+xml' });
          const url = URL.createObjectURL(blob);
          const a = Object.assign(document.createElement('a'), { href: url, download: filename });
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 0);
        };
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const base = `xploremap-${ts}`;
        const segs = (directionsSegmentExports || []).filter(e => e?.collection?.features?.length);
        if (segs.length) {
          segs.forEach((entry, i) => {
            try {
              const feats = [];
              (currentGpxData.features || []).forEach(f => { const c = cloneFeature(f); if (c) feats.push(c); });
              (entry.collection.features || []).forEach(f => { const c = cloneFeature(f); if (c) feats.push(c); });
              if (!feats.length) return;
              const label = entry.name ? slugify(entry.name) : `segment-${String(i + 1).padStart(2, '0')}`;
              downloadGpx(geojsonToGpx({ type: 'FeatureCollection', features: feats }), `${base}-${String(i + 1).padStart(2, '0')}-${label}.gpx`);
            } catch (e) { console.error('Segment GPX export failed', e); }
          });
          return;
        }
        downloadGpx(geojsonToGpx(dataset), `${base}.gpx`);
      } catch (e) { console.error('GPX export failed', e); window.alert('Unable to export GPX data.'); }
    });
  }

  // ── 15. Settings panel (cog button) ──
  const settingsToggle = document.getElementById('settingsToggle');
  const settingsPanel = document.getElementById('settingsPanel');
  const settingsPanelClose = document.getElementById('settingsPanelClose');

  const setSettingsPanelOpen = (open) => {
    if (!settingsPanel || !settingsToggle) return;
    settingsPanel.classList.toggle('settings-panel--open', open);
    settingsPanel.setAttribute('aria-hidden', String(!open));
    settingsToggle.setAttribute('aria-expanded', String(open));
  };

  if (settingsToggle && settingsPanel) {
    settingsToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = settingsPanel.classList.contains('settings-panel--open');
      if (!isOpen) imagery.setImageryPanelOpen(false);
      setSettingsPanelOpen(!isOpen);
    });
    if (settingsPanelClose) settingsPanelClose.addEventListener('click', () => setSettingsPanelOpen(false));
    document.addEventListener('click', (e) => {
      if (!settingsPanel.classList.contains('settings-panel--open')) return;
      if (settingsPanel.contains(e.target) || settingsToggle.contains(e.target)) return;
      setSettingsPanelOpen(false);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setSettingsPanelOpen(false); });
  }

  // ── Settings: Performance controls ──
  const fovSlider = document.getElementById('fovSlider');
  const fovLabel = document.getElementById('fovLabel');
  const lodMaxZoomSlider = document.getElementById('lodMaxZoomSlider');
  const lodMaxZoomLabel = document.getElementById('lodMaxZoomLabel');
  const lodTileRatioSlider = document.getElementById('lodTileRatioSlider');
  const lodTileRatioLabel = document.getElementById('lodTileRatioLabel');
  const dprToggle = document.getElementById('dprToggle');

  if (dprToggle) {
    dprToggle.checked = localStorage.getItem('xplore_dpr_enabled') !== 'false';
    dprToggle.addEventListener('change', () => {
      localStorage.setItem('xplore_dpr_enabled', dprToggle.checked);
      if (confirm('Changing resolution requires reload. Reload now?')) window.location.reload();
    });
  }

  if (fovSlider && fovLabel) {
    const updateFov = () => {
      const deg = parseInt(fovSlider.value, 10);
      fovLabel.textContent = `${deg}°`;
      if (map && typeof map.setVerticalFieldOfView === 'function') map.setVerticalFieldOfView(deg);
    };
    fovSlider.addEventListener('input', updateFov);
    updateFov();
  }

  const updateLodParams = () => {
    if (!map || typeof map.setSourceTileLodParams !== 'function') return;
    const maxZoom = lodMaxZoomSlider ? parseInt(lodMaxZoomSlider.value, 10) : 5;
    const tileRatio = lodTileRatioSlider ? parseFloat(lodTileRatioSlider.value) : 1;
    map.setSourceTileLodParams(maxZoom, tileRatio);
    if (lodMaxZoomLabel) lodMaxZoomLabel.textContent = String(maxZoom);
    if (lodTileRatioLabel) lodTileRatioLabel.textContent = tileRatio.toFixed(1);
  };

  if (lodMaxZoomSlider) lodMaxZoomSlider.addEventListener('input', updateLodParams);
  if (lodTileRatioSlider) lodTileRatioSlider.addEventListener('input', updateLodParams);
  updateLodParams();

  // ── Settings: Debug controls ──
  const debugModeToggle = document.getElementById('debugModeToggle');
  const debugOptions = document.getElementById('debugOptions');
  const debugLayersToggle = document.getElementById('debugLayersToggle');
  const debugNetworkToggle = document.getElementById('debugNetworkToggle');
  const debugShadowTunerToggle = document.getElementById('debugShadowTunerToggle');
  const debugTileBordersToggle = document.getElementById('debugTileBordersToggle');

  const setDebugOptionsOpen = (open) => {
    if (!debugOptions) return;
    debugOptions.classList.toggle('settings-panel__debug-options--open', open);
    debugOptions.setAttribute('aria-hidden', String(!open));
  };

  if (debugModeToggle) {
    debugModeToggle.checked = Boolean(window.XploreDebug);
    setDebugOptionsOpen(debugModeToggle.checked);
    debugModeToggle.addEventListener('change', () => {
      window.XploreDebug = debugModeToggle.checked;
      localStorage.setItem('xplore_debug', debugModeToggle.checked ? '1' : '0');
      setDebugOptionsOpen(debugModeToggle.checked);
      // When debug mode is turned off, also disable all debug sub-options
      if (!debugModeToggle.checked) {
        if (debugLayersToggle?.checked) { debugLayersToggle.checked = false; debugLayersToggle.dispatchEvent(new Event('change')); }
        if (debugTileBordersToggle?.checked) { debugTileBordersToggle.checked = false; debugTileBordersToggle.dispatchEvent(new Event('change')); }
        if (debugNetworkToggle?.checked) { debugNetworkToggle.checked = false; debugNetworkToggle.dispatchEvent(new Event('change')); }
        if (debugShadowTunerToggle?.checked) { debugShadowTunerToggle.checked = false; debugShadowTunerToggle.dispatchEvent(new Event('change')); }
      }
      console.log(`[Settings] Debug mode ${debugModeToggle.checked ? 'enabled' : 'disabled'}`);
    });
  }

  // Debug sub-option: Debug Tiles overlay (self-contained, bypasses imagery system)
  if (debugLayersToggle) {
    debugLayersToggle.addEventListener('change', () => {
      if (!map) return;
      if (debugLayersToggle.checked) {
        // Create source + layer on first use
        if (!map.getSource('debug-tiles')) {
          map.addSource('debug-tiles', {
            type: 'raster',
            url: 'https://demotiles.maplibre.org/debug-tiles/number/tiles.json',
            tileSize: 256,
            maxzoom: 19
          });
        }
        if (!map.getLayer('debug-tiles')) {
          map.addLayer({ id: 'debug-tiles', type: 'raster', source: 'debug-tiles', paint: { 'raster-opacity': 0.7 } });
        }
        map.setLayoutProperty('debug-tiles', 'visibility', 'visible');
      } else {
        if (map.getLayer('debug-tiles')) {
          map.setLayoutProperty('debug-tiles', 'visibility', 'none');
        }
      }
    });
  }

  // Debug sub-option: Network Visualization
  if (debugNetworkToggle) {
    debugNetworkToggle.addEventListener('change', () => {
      const checkbox = document.getElementById('debugNetworkCheckbox');
      if (checkbox) {
        checkbox.checked = debugNetworkToggle.checked;
        checkbox.dispatchEvent(new Event('change'));
      }
    });
  }

  // Debug sub-option: Shadow Tuner
  if (debugShadowTunerToggle) {
    debugShadowTunerToggle.addEventListener('change', () => {
      if (debugShadowTunerToggle.checked && typeof window.ShadowTuner !== 'undefined') {
        try { new window.ShadowTuner(map); } catch (e) { console.warn('[Settings] ShadowTuner init failed:', e); }
      }
    });
  }

  // Debug sub-option: Tile Borders
  if (debugTileBordersToggle) {
    debugTileBordersToggle.addEventListener('change', () => {
      if (map) {
        map.showTileBoundaries = debugTileBordersToggle.checked;
      }
    });
  }


  // ═════════════════════════════════════════════════════════════════════
  // IMAGERY PANEL DOM RENDERING (inline per user request)
  // ═════════════════════════════════════════════════════════════════════

  const imageryPanel = document.getElementById('imageryPanel');
  const imageryPanelToggle = document.getElementById('imageryPanelToggle');
  const imageryPanelDrawer = document.getElementById('imageryPanelDrawer');
  const imageryToggle = document.getElementById('imageryToggle');

  // ── Imagery panel open/close ──
  if (imageryPanelToggle && imageryPanelDrawer) {
    imagery.setImageryPanelOpen(false);
    imageryPanelToggle.addEventListener('click', () => {
      const next = !imageryPanelDrawer.classList.contains('imagery-panel__drawer--open');
      if (next) setSettingsPanelOpen(false);
      imagery.setImageryPanelOpen(next);
    });
    document.addEventListener('click', (e) => {
      if (!imageryPanelDrawer.classList.contains('imagery-panel__drawer--open')) return;
      if (!imageryPanel || imageryPanel.contains(e.target)) return;
      imagery.setImageryPanelOpen(false);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') imagery.setImageryPanelOpen(false); });
  }

  // ── Directions sidebar bar ──
  const directionsActionsBar = document.getElementById('directionsActionsBar');
  const updateActionsBarVisibility = () => {
    if (!directionsActionsBar || !directionsControl) return;
    const isOpen = directionsControl.classList.contains('visible');
    directionsActionsBar.classList.toggle('visible', isOpen);
    directionsActionsBar.setAttribute('aria-hidden', String(!isOpen));
  };
  if (directionsDock && directionsActionsBar) {
    if (directionsControl) {
      new MutationObserver((mutations) => {
        mutations.forEach(m => { if (m.attributeName === 'class') updateActionsBarVisibility(); });
      }).observe(directionsControl, { attributes: true, attributeFilter: ['class'] });
    }
    if (directionsToggle) directionsToggle.addEventListener('click', () => setTimeout(updateActionsBarVisibility, 10));
    updateActionsBarVisibility();
  }

  // ── Toolbox open/close logic ──
  const terrainToolboxToggle = document.getElementById('terrainToolboxToggle');
  const terrainToolbox = document.getElementById('terrainToolbox');
  const snowToolboxToggle = document.getElementById('snowToolboxToggle');
  const snowToolbox = document.getElementById('snowToolbox');
  const shadowToolboxToggle = document.getElementById('shadowToolboxToggle');
  const shadowToolbox = document.getElementById('shadowToolbox');

  const setTerrainToolboxOpen = (open) => {
    if (!terrainToolbox || !terrainToolboxToggle) return;
    terrainToolbox.classList.toggle('visible', open);
    terrainToolbox.setAttribute('aria-hidden', String(!open));
    terrainToolboxToggle.setAttribute('aria-expanded', String(open));
    terrainToolboxToggle.classList.toggle('active', open);
    if (open) { setSnowToolboxOpen(false); setShadowToolboxOpen(false); }
  };

  const setSnowToolboxOpen = (open) => {
    if (!snowToolbox || !snowToolboxToggle) return;
    snowToolbox.classList.toggle('visible', open);
    snowToolbox.setAttribute('aria-hidden', String(!open));
    snowToolboxToggle.setAttribute('aria-expanded', String(open));
    snowToolboxToggle.classList.toggle('active', open);
    if (open) { setTerrainToolboxOpen(false); setShadowToolboxOpen(false); }
  };

  const setShadowToolboxOpen = (open) => {
    if (!shadowToolbox || !shadowToolboxToggle) return;
    shadowToolbox.classList.toggle('visible', open);
    shadowToolbox.setAttribute('aria-hidden', String(!open));
    shadowToolboxToggle.setAttribute('aria-expanded', String(open));
    shadowToolboxToggle.classList.toggle('active', open);
    if (open) { setTerrainToolboxOpen(false); setSnowToolboxOpen(false); }
  };

  // Wire toolbox handlers into imagery manager
  imagery.setToolboxHandlers({ setTerrainToolboxOpen, setSnowToolboxOpen, setShadowToolboxOpen });

  if (terrainToolboxToggle && terrainToolbox) {
    terrainToolboxToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = terrainToolbox.classList.contains('visible');
      if (!isOpen) imagery.setImageryPanelOpen(false);
      setTerrainToolboxOpen(!isOpen);
    });
    document.addEventListener('click', (e) => {
      if (!terrainToolbox.classList.contains('visible')) return;
      if (terrainToolboxToggle.contains(e.target) || terrainToolbox.contains(e.target)) return;
      setTerrainToolboxOpen(false);
    });
  }

  if (snowToolboxToggle && snowToolbox) {
    snowToolboxToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = snowToolbox.classList.contains('visible');
      if (!isOpen) imagery.setImageryPanelOpen(false);
      setSnowToolboxOpen(!isOpen);
    });
    document.addEventListener('click', (e) => {
      if (!snowToolbox.classList.contains('visible')) return;
      if (snowToolboxToggle.contains(e.target) || snowToolbox.contains(e.target)) return;
      setSnowToolboxOpen(false);
    });
  }

  if (shadowToolboxToggle && shadowToolbox) {
    shadowToolboxToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = shadowToolbox.classList.contains('visible');
      if (!isOpen) imagery.setImageryPanelOpen(false);
      setShadowToolboxOpen(!isOpen);
    });
    document.addEventListener('click', (e) => {
      if (!shadowToolbox.classList.contains('visible')) return;
      if (shadowToolboxToggle.contains(e.target) || shadowToolbox.contains(e.target)) return;
      setShadowToolboxOpen(false);
    });
  }

  // ── Imagery panel: render controls ──
  if (imageryToggle) {
    const { SHADOW_TOOLBOX_IDS, TERRAIN_TOOLBOX_IDS, SNOW_TOOLBOX_IDS } = imagery;
    if (terrainToolbox) terrainToolbox.textContent = '';
    if (snowToolbox) snowToolbox.textContent = '';
    if (shadowToolbox) shadowToolbox.textContent = '';

    if (!IMAGERY_OPTIONS.length) {
      imageryToggle.setAttribute('hidden', 'true');
      imageryToggle.setAttribute('aria-hidden', 'true');
      imageryPanel?.setAttribute('hidden', 'true');
    } else {
      imageryToggle.removeAttribute('hidden');
      imageryToggle.setAttribute('aria-hidden', 'false');
      imageryPanel?.removeAttribute('hidden');

      IMAGERY_OPTIONS.forEach((option) => {
        if (option.hiddenControl) return;

        const isTerrainToolboxMember = TERRAIN_TOOLBOX_IDS.includes(option.id);
        const isSnowToolboxMember = SNOW_TOOLBOX_IDS.includes(option.id);
        const isShadowToolboxMember = SHADOW_TOOLBOX_IDS.includes(option.id);
        const state = imagery.imageryState.get(option.id) ?? { enabled: false, opacity: 0 };
        const group = LAYER_GROUP_BY_MEMBER_ID.get(option.id);

        // ── Toolbox member rendering ──
        if (isTerrainToolboxMember || isSnowToolboxMember || isShadowToolboxMember) {
          const toggleButton = document.createElement('button');
          toggleButton.type = 'button';
          let btnClass = 'btn terrain-toolbox__toggle';
          if (isSnowToolboxMember) btnClass = 'btn snow-toolbox__toggle';
          if (isShadowToolboxMember) btnClass = 'btn shadow-toolbox__toggle';
          toggleButton.className = btnClass;
          toggleButton.dataset.imageryId = option.id;
          toggleButton.setAttribute('aria-pressed', 'false');
          toggleButton.setAttribute('title', option.label);
          toggleButton.setAttribute('aria-label', option.label);

          const previewUrl = typeof option.previewImage === 'string' && option.previewImage.length
            ? option.previewImage : imagery.createTilePreviewUrl(option.tileTemplate);
          if (previewUrl) {
            const img = document.createElement('img');
            img.src = previewUrl; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.draggable = false;
            toggleButton.appendChild(img);
          }
          const srLabel = document.createElement('span');
          srLabel.className = 'sr-only'; srLabel.textContent = option.label;
          toggleButton.appendChild(srLabel);

          toggleButton.addEventListener('click', () => {
            toggleButton.blur();
            const cur = imagery.imageryState.get(option.id);
            if (!cur) return;
            const active = Boolean(cur.enabled && cur.opacity > 0);
            const nextEnabled = !active;
            if (group?.exclusive && nextEnabled) {
              group.members.forEach(id => { if (id !== option.id) { const s = imagery.imageryState.get(id); if (s) s.enabled = false; } });
            }
            cur.enabled = nextEnabled;
            if (nextEnabled && cur.opacity <= 0) cur.opacity = typeof option.defaultOpacity === 'number' ? option.defaultOpacity : 1.0;
            imagery.applyImageryState();
            imagery.updateImageryControlStates();
            imagery.applyImageryLayerOrder();
            if (isTerrainToolboxMember) setTerrainToolboxOpen(false);
            if (isSnowToolboxMember) setSnowToolboxOpen(false);
            if (isShadowToolboxMember) setShadowToolboxOpen(false);
          });

          let targetToolbox = terrainToolbox;
          if (isSnowToolboxMember) targetToolbox = snowToolbox;
          if (isShadowToolboxMember) targetToolbox = shadowToolbox;
          if (targetToolbox) targetToolbox.appendChild(toggleButton);

          imagery.imageryControls.set(option.id, { container: toggleButton, button: toggleButton, slider: null, sliderWrapper: null, isGroupMember: false });
          return;
        }


        // ── Group / Non-grouped rendering ──
        let container;
        let isGroupMember = false;

        if (group) {
          isGroupMember = true;
          if (!imagery.groupContainers.has(group.id)) {
            const groupContainer = document.createElement('div');
            groupContainer.className = 'imagery-group';
            groupContainer.dataset.groupId = group.id;

            const row = document.createElement('div');
            row.className = 'imagery-group__row';
            const groupPreview = document.createElement('div');
            groupPreview.className = 'imagery-group__preview';
            const groupLabel = document.createElement('span');
            groupLabel.className = 'imagery-group__label';
            groupLabel.textContent = group.label;
            row.appendChild(groupPreview);
            row.appendChild(groupLabel);
            groupContainer.appendChild(row);

            const isNoSliderGroup = ['terrain-analysis', 'sun-analysis', 'snow'].includes(group.id);
            let groupSlider = null;
            if (!isNoSliderGroup) {
              const sliderWrapper = document.createElement('div');
              sliderWrapper.className = 'imagery-group__opacity-wrapper';
              groupSlider = document.createElement('input');
              groupSlider.type = 'range'; groupSlider.min = '0'; groupSlider.max = '1'; groupSlider.step = '0.05';
              groupSlider.className = 'imagery-group__opacity';
              groupSlider.setAttribute('aria-label', `${group.label} opacity`);
              const firstEnabled = group.members.find(id => imagery.imageryState.get(id)?.enabled);
              groupSlider.value = String(firstEnabled ? imagery.imageryState.get(firstEnabled).opacity : 0.8);
              groupSlider.addEventListener('input', () => {
                const v = clampOpacity(Number.parseFloat(groupSlider.value));
                group.members.forEach(mid => { const ms = imagery.imageryState.get(mid); if (ms) ms.opacity = v; });
                imagery.applyImageryState();
                imagery.updateImageryControlStates();
              });
              const stop = e => e.stopPropagation();
              groupSlider.addEventListener('mousedown', stop);
              groupSlider.addEventListener('touchstart', stop, { passive: true });
              sliderWrapper.appendChild(groupSlider);
              groupContainer.appendChild(sliderWrapper);
            }

            // Drag handlers for group
            const firstMemberId = group.members[0];
            groupContainer.setAttribute('draggable', 'true');
            groupContainer.dataset.imageryId = firstMemberId;
            groupContainer.addEventListener('dragstart', (e) => {
              imagery.dragSourceImageryId = firstMemberId;
              imagery.resetDragIndicators();
              groupContainer.classList.add('imagery-group--dragging');
              if (e?.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', firstMemberId); }
            });
            groupContainer.addEventListener('dragend', () => { imagery.dragSourceImageryId = null; imagery.resetDragIndicators(); groupContainer.classList.remove('imagery-group--dragging'); });
            groupContainer.addEventListener('dragover', (e) => {
              if (!imagery.dragSourceImageryId || group.members.includes(imagery.dragSourceImageryId)) return;
              e.preventDefault();
              if (e?.dataTransfer) e.dataTransfer.dropEffect = 'move';
              const rect = groupContainer.getBoundingClientRect();
              const before = e.clientY < rect.top + rect.height / 2;
              groupContainer.classList.toggle('imagery-group--drag-over-before', before);
              groupContainer.classList.toggle('imagery-group--drag-over-after', !before);
            });
            groupContainer.addEventListener('dragleave', () => groupContainer.classList.remove('imagery-group--drag-over-before', 'imagery-group--drag-over-after'));
            groupContainer.addEventListener('drop', (e) => {
              if (!imagery.dragSourceImageryId || group.members.includes(imagery.dragSourceImageryId)) return;
              e.preventDefault();
              const before = e.clientY < groupContainer.getBoundingClientRect().top + groupContainer.getBoundingClientRect().height / 2;
              imagery.moveImageryOption(imagery.dragSourceImageryId, firstMemberId, before);
              imagery.dragSourceImageryId = null;
              imagery.resetDragIndicators();
              groupContainer.classList.remove('imagery-group--drag-over-before', 'imagery-group--drag-over-after');
            });

            imagery.groupContainers.set(group.id, { container: groupContainer, preview: groupPreview, slider: groupSlider });
            imageryToggle.appendChild(groupContainer);
          }
          container = imagery.groupContainers.get(group.id).preview;
        } else {
          container = document.createElement('div');
          container.className = 'imagery-option';
          container.dataset.imageryId = option.id;
          container.setAttribute('draggable', 'true');
          container.addEventListener('dragstart', (e) => {
            imagery.dragSourceImageryId = option.id; imagery.resetDragIndicators();
            container.classList.add('imagery-option--dragging');
            if (e?.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', option.id); }
          });
          container.addEventListener('dragend', () => { imagery.dragSourceImageryId = null; imagery.resetDragIndicators(); });
          container.addEventListener('dragover', (e) => {
            if (!imagery.dragSourceImageryId || imagery.dragSourceImageryId === option.id) return;
            e.preventDefault();
            if (e?.dataTransfer) e.dataTransfer.dropEffect = 'move';
            const rect = container.getBoundingClientRect();
            const before = e.clientY < rect.top + rect.height / 2;
            container.classList.toggle('imagery-option--drag-over-before', before);
            container.classList.toggle('imagery-option--drag-over-after', !before);
          });
          container.addEventListener('dragleave', () => container.classList.remove('imagery-option--drag-over-before', 'imagery-option--drag-over-after'));
          container.addEventListener('drop', (e) => {
            if (!imagery.dragSourceImageryId || imagery.dragSourceImageryId === option.id) return;
            e.preventDefault();
            const before = e.clientY < container.getBoundingClientRect().top + container.getBoundingClientRect().height / 2;
            imagery.moveImageryOption(imagery.dragSourceImageryId, option.id, before);
            imagery.dragSourceImageryId = null; imagery.resetDragIndicators();
          });
        }

        // ── Toggle button (same for grouped and non-grouped) ──
        const toggleButton = document.createElement('button');
        toggleButton.type = 'button';
        toggleButton.className = isGroupMember ? 'imagery-group__toggle' : 'imagery-option__toggle';
        toggleButton.dataset.imageryId = option.id;
        toggleButton.setAttribute('aria-pressed', 'false');
        toggleButton.setAttribute('title', option.label);
        toggleButton.setAttribute('aria-label', option.label);

        const previewUrl = typeof option.previewImage === 'string' && option.previewImage.length
          ? option.previewImage : imagery.createTilePreviewUrl(option.tileTemplate);
        if (previewUrl) {
          const img = document.createElement('img');
          img.src = previewUrl; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.draggable = false;
          img.className = isGroupMember ? 'imagery-group__thumb' : 'imagery-option__thumb';
          toggleButton.appendChild(img);
        }
        const srLabel = document.createElement('span');
        srLabel.className = 'sr-only'; srLabel.textContent = option.label;
        toggleButton.appendChild(srLabel);

        toggleButton.addEventListener('click', () => {
          toggleButton.blur();
          const cur = imagery.imageryState.get(option.id);
          if (!cur) return;
          const active = Boolean(cur.enabled && cur.opacity > 0);
          const nextEnabled = !active;
          const clickGroup = LAYER_GROUP_BY_MEMBER_ID.get(option.id);
          if (clickGroup?.exclusive && nextEnabled) {
            clickGroup.members.forEach(id => { if (id !== option.id) { const s = imagery.imageryState.get(id); if (s) s.enabled = false; } });
          }
          cur.enabled = nextEnabled;
          if (nextEnabled) {
            let usedGroupSlider = false;
            if (clickGroup && imagery.groupContainers.has(clickGroup.id)) {
              const gd = imagery.groupContainers.get(clickGroup.id);
              if (gd?.slider) { cur.opacity = clampOpacity(Number.parseFloat(gd.slider.value)); usedGroupSlider = true; }
            }
            if (!usedGroupSlider && cur.opacity <= 0) {
              const fb = typeof option.defaultOpacity === 'number' ? clampOpacity(option.defaultOpacity) : 1;
              cur.opacity = fb > 0 ? fb : 1;
            }
          }
          imagery.applyImageryState();
          imagery.updateImageryControlStates();
          imagery.applyImageryLayerOrder();
        });

        if (isGroupMember) {
          container.appendChild(toggleButton);
          const groupData = imagery.groupContainers.get(group.id);
          imagery.imageryControls.set(option.id, { container: groupData.container, button: toggleButton, slider: groupData.slider, sliderWrapper: null, isGroupMember: true });
        } else {
          const row = document.createElement('div'); row.className = 'imagery-option__row';
          const preview = document.createElement('div'); preview.className = 'imagery-option__preview';
          preview.appendChild(toggleButton);
          const label = document.createElement('span'); label.className = 'imagery-option__label'; label.textContent = option.label;
          row.appendChild(preview); row.appendChild(label); container.appendChild(row);

          const noSliderTypes = ['hillshade', 'native-layer', 'wikimedia'];
          const hideSlider = noSliderTypes.includes(option.type);
          let slider = null, sliderWrapper = null;
          if (!hideSlider) {
            sliderWrapper = document.createElement('div'); sliderWrapper.className = 'imagery-option__opacity-wrapper';
            slider = document.createElement('input');
            slider.type = 'range'; slider.min = '0'; slider.max = '1'; slider.step = '0.05';
            slider.value = String(state.opacity); slider.className = 'imagery-option__opacity';
            slider.setAttribute('aria-label', `${option.label} opacity`);
            slider.addEventListener('input', () => {
              const s = imagery.imageryState.get(option.id); if (!s) return;
              const v = clampOpacity(Number.parseFloat(slider.value));
              s.opacity = v; s.enabled = v > 0;
              imagery.applyImageryState(); imagery.updateImageryControlStates(); imagery.applyImageryLayerOrder();
            });
            const stop = e => e.stopPropagation();
            slider.addEventListener('mousedown', stop);
            slider.addEventListener('touchstart', stop, { passive: true });
            sliderWrapper.appendChild(slider);
            container.appendChild(sliderWrapper);
          }
          imagery.imageryControls.set(option.id, { container, button: toggleButton, slider, sliderWrapper, isGroupMember: false });
          imageryToggle.appendChild(container);
        }
      }); // end IMAGERY_OPTIONS.forEach

      imagery.updateImageryControlStates();
      imagery.updateImageryDomOrder();

      // Container-level drag handlers (move to boundary)
      if (!imageryToggle.dataset.dragHandlersBound) {
        imageryToggle.addEventListener('dragover', (e) => {
          if (!imagery.dragSourceImageryId) return;
          if (e.target?.closest?.('.imagery-option')) return;
          e.preventDefault();
          if (e?.dataTransfer) e.dataTransfer.dropEffect = 'move';
        });
        imageryToggle.addEventListener('drop', (e) => {
          if (!imagery.dragSourceImageryId) return;
          if (e.target?.closest?.('.imagery-option')) return;
          e.preventDefault();
          const toStart = e.clientY < imageryToggle.getBoundingClientRect().top + imageryToggle.getBoundingClientRect().height / 2;
          imagery.moveImageryOptionToBoundary(imagery.dragSourceImageryId, toStart);
          imagery.dragSourceImageryId = null;
          imagery.resetDragIndicators();
        });
        imageryToggle.dataset.dragHandlersBound = 'true';
      }
    }
  }

  // ── 16. Shadow Debug Tuner ──
  if (window.XploreDebug && typeof window.ShadowTuner !== 'undefined') {
    window.shadowTuner = new window.ShadowTuner(map);
    window.shadowTuner.toggleUI();
  }
}

// ╔═══════════════════════════════════════════════════════════════════════╗
// ║                          ENTRY POINT                                ║
// ╚═══════════════════════════════════════════════════════════════════════╝
init().catch((error) => {
  console.error('Failed to initialise the map', error);
});
