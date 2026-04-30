import { VIEW_MODES } from '../config/map-config.js';
import { updateSunPosition } from './sun-controller.js';

const DEFAULT_EXAGGERATION = 1;
const ANALYSIS_TERRAIN_EXAGGERATION = 1;
const DEFAULT_EASING_DURATION = 3000;
const DEFAULT_FLATTEN_DURATION = 1200;
const DEFAULT_ORIENTATION_DURATION = 1500;
const DEFAULT_RESET_DURATION = 800;

const easeInOut = (t) => 0.5 * (1 - Math.cos(Math.PI * t));

function resolveValue(resolver, fallback) {
  if (typeof resolver === 'function') {
    try {
      const value = resolver();
      return value ?? fallback;
    } catch (error) {
      console.warn('Failed to resolve value', error);
      return fallback;
    }
  }
  return resolver ?? fallback;
}

function resolveArray(resolver) {
  const value = resolveValue(resolver, []);
  return Array.isArray(value) ? value : [];
}

export function createViewModeController(map, options = {}) {
  if (!map) {
    throw new Error('A MapLibre map instance is required');
  }

  const toggleButton = options.toggleButton ?? null;
  const hdToggle = options.hdToggle ?? null;
  const vignetteElement = options.vignetteElement ?? null;
  const skySettings = options.skySettings ?? null;
  const defaultMode = options.defaultMode ?? VIEW_MODES.THREED;
  const defaultOrientation = options.defaultOrientation ?? { pitch: 45, bearing: 0 };
  const orientationDuration = Number.isFinite(options.orientationDuration)
    ? options.orientationDuration
    : DEFAULT_ORIENTATION_DURATION;
  const exaggerationDuration = Number.isFinite(options.exaggerationDuration)
    ? options.exaggerationDuration
    : DEFAULT_EASING_DURATION;
  const flattenDuration = Number.isFinite(options.flattenDuration)
    ? options.flattenDuration
    : DEFAULT_FLATTEN_DURATION;
  const resetDuration = Number.isFinite(options.resetDuration)
    ? options.resetDuration
    : DEFAULT_RESET_DURATION;
  const defaultExaggeration = Number.isFinite(options.defaultExaggeration)
    ? options.defaultExaggeration
    : DEFAULT_EXAGGERATION;
  const skipSky = options.skipSky ?? false;
  let hdEnabled = options.defaultHd ?? true;

  const terrainSourceResolver = options.terrainSourceId ?? 'terrainSource';
  const hdSourceResolver = options.hdSources ?? [];

  let currentMode = defaultMode;
  let last3DOrientation = { ...defaultOrientation };
  let currentExaggeration = currentMode === VIEW_MODES.THREED ? defaultExaggeration : 0;
  let terrainEnabled = !!map.getTerrain();
  let analysisTerrainRequired = false;
  let rafId = null;
  let moveEndHandler = null;
  let isInternalChange = false;

  function setSunAnalysisTerrainFlag(required) {
    if (typeof window !== 'undefined') {
      window._xploreSunAnalysisTerrain = Boolean(required);
    }
  }

  function resolveTerrainSourceId() {
    const resolved = resolveValue(terrainSourceResolver, null);
    return typeof resolved === 'string' && resolved.length ? resolved : null;
  }

  function terrainOptionsAreRaised(terrainOptions) {
    if (!terrainOptions) return false;
    const exaggeration = typeof terrainOptions.exaggeration === 'number' ? terrainOptions.exaggeration : 1;
    return exaggeration > 0;
  }

  function applyTerrainForCurrentMode() {
    const terrainSourceId = resolveTerrainSourceId();
    if (!terrainSourceId || typeof map.setTerrain !== 'function') {
      currentExaggeration = 0;
      terrainEnabled = false;
      return;
    }
    if (!map.getSource(terrainSourceId)) {
      currentExaggeration = 0;
      terrainEnabled = false;
      return;
    }

    const is3D = currentMode === VIEW_MODES.THREED;
    const shouldKeepAnalysisTerrain = !is3D && analysisTerrainRequired;

    isInternalChange = true;
    if (is3D) {
      map.setTerrain({ source: terrainSourceId, exaggeration: defaultExaggeration });
      terrainEnabled = true;
      currentExaggeration = defaultExaggeration;
    } else if (shouldKeepAnalysisTerrain) {
      map.setTerrain({ source: terrainSourceId, exaggeration: ANALYSIS_TERRAIN_EXAGGERATION });
      terrainEnabled = true;
      currentExaggeration = ANALYSIS_TERRAIN_EXAGGERATION;
    } else {
      map.setTerrain(null);
      terrainEnabled = false;
      currentExaggeration = 0;
    }
    isInternalChange = false;
  }

  // Listen for external terrain changes (e.g. from MapLibre TerrainControl)
  map.on('terrain', (e) => {
    if (isInternalChange) return;

    const targetMode = terrainOptionsAreRaised(e.terrain) ? VIEW_MODES.THREED : VIEW_MODES.TWOD;

    if (targetMode !== currentMode) {
      // Sync our internal mode and trigger the rest of the transition (camera, sky, etc)
      applyMode(targetMode, { animate: true, syncTerrain: false });
    }
  });

  // Track last simulation date for glare effect updates
  let lastSimulationDate = null;
  let glareUpdatePending = false;

  // Update fog glare effect after camera movement settles (debounced to avoid first-frame hiccup)
  // Using 'moveend' instead of 'move' prevents setLight/setSky/setFog from triggering
  // synchronous style recalculation during the first frame of a pan/rotate gesture.
  let glareDebounceTimer = null;
  map.on('moveend', () => {
    // Kill-switch: window._disableGlare = true to skip all glare updates
    if (typeof window !== 'undefined' && window._disableGlare) return;
    if (skipSky) return;
    if (currentMode !== VIEW_MODES.THREED || !lastSimulationDate) return;

    // Debounce: wait 100ms after last moveend before updating
    if (glareDebounceTimer) clearTimeout(glareDebounceTimer);
    glareDebounceTimer = setTimeout(() => {
      glareDebounceTimer = null;
      const center = map.getCenter();
      updateSunPosition(map, center.lat, center.lng, lastSimulationDate);
    }, 100);
  });

  function stopAnimation() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function clearMoveEndHandler() {
    if (moveEndHandler) {
      map.off('moveend', moveEndHandler);
      moveEndHandler = null;
    }
  }

  function updateToggleButton() {
    if (!toggleButton) return;
    const is3D = currentMode === VIEW_MODES.THREED;
    const nextLabel = is3D ? 'Switch to 2D' : 'Switch to 3D';
    toggleButton.classList.toggle('active', is3D);
    toggleButton.setAttribute('aria-pressed', String(is3D));
    toggleButton.setAttribute('aria-label', nextLabel);
    toggleButton.setAttribute('title', nextLabel);

    const label = toggleButton.querySelector('.toggle-3d__label');
    if (label) {
      label.textContent = is3D ? '2D' : '3D';
    }
  }

  function updateVignette() {
    if (!vignetteElement) return;
    vignetteElement.dataset.mode = currentMode;
  }

  function applySky(is3D, simulationDate = null) {
    if (skipSky) return; // Feature gate: sky/fog disabled
    if (typeof map.setSky !== 'function') {
      return;
    }

    const apply = () => {
      try {
        if (is3D) {
          const center = map.getCenter();
          const date = simulationDate || new Date();
          // Use the simplified SunController to update the map's light source
          updateSunPosition(map, center.lat, center.lng, date);

        } else {
          // Disable sky and fog in 2D
          if (typeof map.setSky === 'function') {
            map.setSky({});
          }
          if (typeof map.setFog === 'function') {
            map.setFog(null);
          }
        }
      } catch (e) {
        console.warn('[ViewMode] Error applying sky:', e);
      }
    };

    if (typeof map.isStyleLoaded === 'function' && !map.isStyleLoaded()) {
      if (typeof map.once === 'function') {
        map.once('styledata', apply);
      } else {
        map.on('styledata', function handleStyleData() {
          map.off('styledata', handleStyleData);
          apply();
        });
      }
      return;
    }

    apply();
  }

  function setTerrainExaggeration(value) {
    const previousMode = currentMode;
    currentExaggeration = Math.max(value, 0);

    isInternalChange = true;
    if (value <= 0) {
      currentMode = VIEW_MODES.TWOD;
      applyTerrainForCurrentMode();
      currentMode = previousMode;
      currentExaggeration = 0;
    } else {
      const terrainSourceId = resolveTerrainSourceId();
      if (!terrainSourceId || !map.getSource(terrainSourceId) || typeof map.setTerrain !== 'function') {
        terrainEnabled = false;
        isInternalChange = false;
        return;
      }
      map.setTerrain({ source: terrainSourceId, exaggeration: value });
      terrainEnabled = true;
    }
    isInternalChange = false;
  }

  function animateExaggeration(target, duration = DEFAULT_EASING_DURATION, onDone) {
    const terrainSourceId = resolveTerrainSourceId();
    if (!terrainSourceId || !map.getSource(terrainSourceId) || typeof map.setTerrain !== 'function') {
      setTerrainExaggeration(target);
      if (typeof onDone === 'function') onDone();
      return;
    }

    stopAnimation();
    const from = currentExaggeration;
    if (target > 0 && !terrainEnabled) {
      setTerrainExaggeration(Math.max(from, 0.0001));
    }
    const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    const step = (now) => {
      const elapsed = now - start;
      const t = Math.min(1, duration <= 0 ? 1 : elapsed / duration);
      const eased = easeInOut(t);
      const value = from + (target - from) * eased;
      setTerrainExaggeration(value);
      if (t < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        if (target <= 0) {
          setTerrainExaggeration(0);
        }
        rafId = null;
        if (typeof onDone === 'function') onDone();
      }
    };

    rafId = requestAnimationFrame(step);
  }

  function updateInteractions(is3D) {
    const method = is3D ? 'enable' : 'disable';
    if (map.dragRotate && typeof map.dragRotate[method] === 'function') {
      map.dragRotate[method]();
    }
    if (map.touchZoomRotate && typeof map.touchZoomRotate[is3D ? 'enableRotation' : 'disableRotation'] === 'function') {
      map.touchZoomRotate[is3D ? 'enableRotation' : 'disableRotation']();
    }
    if (map.touchPitch && typeof map.touchPitch[method] === 'function') {
      map.touchPitch[method]();
    }
    if (map.keyboard && typeof map.keyboard[is3D ? 'enableRotation' : 'disableRotation'] === 'function') {
      map.keyboard[is3D ? 'enableRotation' : 'disableRotation']();
    }
  }

  function applyHdMode() {
    return; // PERF TEST: use MapLibre default LOD instead of aggressive custom params
    if (typeof map.setSourceTileLodParams !== 'function') {
      return;
    }
    const sources = resolveArray(hdSourceResolver);
    if (!sources.length) return;

    const minlod = hdEnabled ? 3 : 4;
    const maxlod = hdEnabled ? 9 : 3;

    sources.forEach((sourceId) => {
      if (!sourceId || !map.getSource(sourceId)) return;
      try {
        map.setSourceTileLodParams(minlod, maxlod, sourceId);
      } catch (error) {
        console.warn('Unable to update LOD params for source', sourceId, error);
      }
    });
  }

  function setHdEnabled(nextValue) {
    hdEnabled = Boolean(nextValue);
    if (hdToggle) {
      if ('checked' in hdToggle) {
        hdToggle.checked = hdEnabled;
      }
      if (typeof hdToggle.classList?.toggle === 'function') {
        hdToggle.classList.toggle('active', hdEnabled);
      }
      if (typeof hdToggle.setAttribute === 'function') {
        hdToggle.setAttribute('aria-pressed', String(hdEnabled));
      }
    }
    applyHdMode();
  }

  function scheduleTerrainAnimation(callback) {
    clearMoveEndHandler();
    if (typeof callback !== 'function') return;
    moveEndHandler = () => {
      clearMoveEndHandler();
      callback();
    };
    map.on('moveend', moveEndHandler);
  }

  function applyMode(mode, { animate = true, syncTerrain = true } = {}) {
    if (mode !== VIEW_MODES.THREED && mode !== VIEW_MODES.TWOD) {
      return;
    }

    const is3D = mode === VIEW_MODES.THREED;
    currentMode = mode;
    updateToggleButton();
    updateVignette();

    // Lock/unlock rotation based on mode
    updateInteractions(is3D);

    // Sync terrain state if requested
    if (syncTerrain) {
      applyTerrainForCurrentMode();
      if (!is3D) {
        // Strict 2D Mode: Force Top-Down and North-Up
        map.setPitch(0);
        map.setBearing(0);
      }
    }

    // Sky only in 3D
    applySky(is3D);
    applyHdMode();

    // Re-evaluate terrain-dependent analysis layers (like shadows) purely by their imageryState
    if (map.getStyle() && typeof window.imageryManager?.applyImageryState === 'function') {
      window.imageryManager.applyImageryState();
    }

    // Show/hide FOV controls based on 3D mode (only if debug is enabled)
    const fovControls = document.getElementById('fovControls');
    if (fovControls) {
      const shouldShow = is3D && window.XploreDebug;
      fovControls.style.display = shouldShow ? 'block' : 'none';
    }
  }

  function toggleMode() {
    const nextMode = currentMode === VIEW_MODES.THREED ? VIEW_MODES.TWOD : VIEW_MODES.THREED;
    applyMode(nextMode);
  }

  if (toggleButton) {
    toggleButton.addEventListener('click', toggleMode);
  }

  if (hdToggle) {
    const isCheckboxToggle = hdToggle.tagName === 'INPUT' && hdToggle.type === 'checkbox';
    if (isCheckboxToggle) {
      hdToggle.checked = hdEnabled;
      hdToggle.addEventListener('change', () => {
        setHdEnabled(hdToggle.checked);
      });
    } else {
      hdToggle.classList.toggle('active', hdEnabled);
      hdToggle.setAttribute('aria-pressed', String(hdEnabled));
      hdToggle.addEventListener('click', () => {
        setHdEnabled(!hdEnabled);
      });
    }
  }

  function onTerrainSourcesUpdated() {
    applyTerrainForCurrentMode();
    applySky(currentMode === VIEW_MODES.THREED);
    applyHdMode();
  }

  function setAnalysisTerrainRequired(required) {
    const nextRequired = Boolean(required);
    setSunAnalysisTerrainFlag(nextRequired);
    if (analysisTerrainRequired === nextRequired) return;
    analysisTerrainRequired = nextRequired;
    if (currentMode === VIEW_MODES.TWOD) {
      applyTerrainForCurrentMode();
      map.triggerRepaint();
    }
  }

  applyMode(currentMode, { animate: false });
  setSunAnalysisTerrainFlag(analysisTerrainRequired);
  applyHdMode();

  // Public method to update sky based on simulation time
  function updateSkyForTime(simulationDate) {
    // Store for glare effect updates when camera moves
    if (simulationDate) {
      lastSimulationDate = simulationDate;
    }

    if (currentMode === VIEW_MODES.THREED) {
      applySky(true, simulationDate);
    }
  }

  return {
    applyMode,
    toggleMode,
    getMode: () => currentMode,
    applyCurrentMode: (options = {}) => applyMode(currentMode, options),
    onTerrainSourcesUpdated,
    setAnalysisTerrainRequired,
    setHdEnabled,
    refreshHdMode: applyHdMode,
    updateSkyForTime  // New: update sky based on time
  };
}

