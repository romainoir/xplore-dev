import { VIEW_MODES } from './constants.js';

const DEFAULT_EXAGGERATION = 1;
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
  let hdEnabled = options.defaultHd ?? true;

  const terrainSourceResolver = options.terrainSourceId ?? 'terrainSource';
  const hdSourceResolver = options.hdSources ?? [];

  let currentMode = defaultMode;
  let last3DOrientation = { ...defaultOrientation };
  let currentExaggeration = currentMode === VIEW_MODES.THREED ? defaultExaggeration : 0;
  let terrainEnabled = false;
  let rafId = null;
  let moveEndHandler = null;

  function resolveTerrainSourceId() {
    const resolved = resolveValue(terrainSourceResolver, null);
    return typeof resolved === 'string' && resolved.length ? resolved : null;
  }

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
  }

  function updateVignette() {
    if (!vignetteElement) return;
    vignetteElement.dataset.mode = currentMode;
  }

  function applySky(is3D) {
    if (typeof map.setSky !== 'function') {
      return;
    }

    if (!skySettings && is3D) {
      return;
    }

    const apply = () => {
      map.setSky(is3D ? skySettings : null);
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
    const terrainSourceId = resolveTerrainSourceId();
    if (!terrainSourceId || typeof map.setTerrain !== 'function') {
      currentExaggeration = value;
      terrainEnabled = false;
      return;
    }
    if (!map.getSource(terrainSourceId)) {
      currentExaggeration = value;
      terrainEnabled = false;
      return;
    }
    currentExaggeration = value;
    if (value <= 0) {
      map.setTerrain(null);
      terrainEnabled = false;
      currentExaggeration = 0;
    } else {
      map.setTerrain({ source: terrainSourceId, exaggeration: value });
      terrainEnabled = true;
    }
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
    if (map.dragRotate && typeof map.dragRotate[is3D ? 'enable' : 'disable'] === 'function') {
      map.dragRotate[is3D ? 'enable' : 'disable']();
    }
    if (map.touchZoomRotate && typeof map.touchZoomRotate[is3D ? 'enableRotation' : 'disableRotation'] === 'function') {
      map.touchZoomRotate[is3D ? 'enableRotation' : 'disableRotation']();
    }
  }

  function applyHdMode() {
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

  function applyMode(mode, { animate = true } = {}) {
    if (mode !== VIEW_MODES.THREED && mode !== VIEW_MODES.TWOD) {
      return;
    }

    if (currentMode === VIEW_MODES.THREED && mode === VIEW_MODES.TWOD) {
      last3DOrientation = {
        pitch: Number.isFinite(map.getPitch()) ? map.getPitch() : defaultOrientation.pitch,
        bearing: Number.isFinite(map.getBearing()) ? map.getBearing() : defaultOrientation.bearing
      };
    }

    currentMode = mode;
    updateToggleButton();
    updateVignette();

    const is3D = currentMode === VIEW_MODES.THREED;
    updateInteractions(is3D);

    const targetOrientation = is3D ? last3DOrientation : { pitch: 0, bearing: 0 };
    const fallbackPitch = Number.isFinite(defaultOrientation.pitch) ? defaultOrientation.pitch : 45;
    const fallbackBearing = Number.isFinite(defaultOrientation.bearing) ? defaultOrientation.bearing : 0;
    const orientation = {
      pitch: Number.isFinite(targetOrientation.pitch) ? targetOrientation.pitch : fallbackPitch,
      bearing: Number.isFinite(targetOrientation.bearing) ? targetOrientation.bearing : fallbackBearing
    };

    clearMoveEndHandler();

    if (is3D) {
      applySky(true);
      if (!animate) {
        stopAnimation();
        setTerrainExaggeration(defaultExaggeration);
        map.setPitch(orientation.pitch);
        map.setBearing(orientation.bearing);
      } else {
        stopAnimation();
        const currentPitch = Number.isFinite(map.getPitch()) ? map.getPitch() : 0;
        const currentBearing = Number.isFinite(map.getBearing()) ? map.getBearing() : 0;
        const orientationChanged =
          Math.abs(currentPitch - orientation.pitch) > 0.01 ||
          Math.abs(currentBearing - orientation.bearing) > 0.01;

        if (orientationChanged && typeof map.easeTo === 'function') {
          scheduleTerrainAnimation(() => animateExaggeration(defaultExaggeration, exaggerationDuration));
          map.easeTo({
            pitch: orientation.pitch,
            bearing: orientation.bearing,
            duration: orientationDuration
          });
        } else {
          animateExaggeration(defaultExaggeration, exaggerationDuration);
        }
      }
    } else {
      if (!animate) {
        stopAnimation();
        setTerrainExaggeration(0);
        if (typeof map.setPitch === 'function') map.setPitch(0);
        if (typeof map.setBearing === 'function') map.setBearing(0);
        applySky(false);
      } else {
        stopAnimation();
        animateExaggeration(0, flattenDuration, () => {
          if (typeof map.easeTo === 'function') {
            map.easeTo({
              pitch: 0,
              bearing: 0,
              duration: resetDuration
            });
          } else {
            if (typeof map.setPitch === 'function') map.setPitch(0);
            if (typeof map.setBearing === 'function') map.setBearing(0);
          }
          applySky(false);
        });
      }
    }

    applyHdMode();
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
    terrainEnabled = false;
    if (currentMode === VIEW_MODES.THREED) {
      setTerrainExaggeration(defaultExaggeration);
      applySky(true);
    } else {
      setTerrainExaggeration(0);
      applySky(false);
    }
    applyHdMode();
  }

  applyMode(currentMode, { animate: false });
  applyHdMode();

  return {
    applyMode,
    toggleMode,
    getMode: () => currentMode,
    applyCurrentMode: (options = {}) => applyMode(currentMode, options),
    onTerrainSourcesUpdated,
    setHdEnabled,
    refreshHdMode: applyHdMode
  };
}
