/**
 * shadow-controller.js — Sun position calculation, shadow time updates,
 * hillshade illumination direction/altitude synchronisation.
 */

const SHADOW_MIN_RENDER_ALTITUDE = 2;
const SHADOW_MAX_RENDER_ALTITUDE = 89.5;
const CAMERA_SHADOW_SETTLE_MS = 300;
const CAMERA_SHADOW_REFINE_DELAY_MS = 450;
const CAMERA_SHADOW_IDLE_TIMEOUT_MS = 1800;
const SHADOW_RENDER_LAYER_IDS = Object.freeze(['shadow-coarse', 'shadow-v2-coarse', 'shadow-v3-coarse']);

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0, edge1, value) {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

function mixNumber(a, b, t) {
    return a * (1 - t) + b * t;
}

function rgbString(rgb) {
    return `rgb(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])})`;
}

function shadowReachProfileForSun(altitudeDeg) {
    const lowSun = 1 - smoothstep(8, 24, altitudeDeg);
    const horizonSun = 1 - smoothstep(2.5, 9, altitudeDeg);
    const veryLowSun = 1 - smoothstep(0.8, 4.5, altitudeDeg);
    const longReach = clamp(lowSun * 0.62 + horizonSun * 0.30 + veryLowSun * 0.08, 0, 1);

    return {
        lowSun,
        horizonSun,
        veryLowSun,
        longReach,
        maxDistance: Math.round(mixNumber(8000, 18000, longReach)),
        midReachMeters: Math.round(mixNumber(2200, 5600, longReach)),
        farReachMeters: Math.round(mixNumber(5000, 18000, longReach)),
        nearCascadeMeters: Math.round(mixNumber(1100, 1600, longReach)),
        midCascadeMeters: Math.round(mixNumber(3500, 5600, longReach)),
        maxTiles: Math.round(mixNumber(88, 128, longReach)),
        maxCoreTiles: Math.round(mixNumber(44, 56, longReach)),
        zoomBias: mixNumber(0.25, 0.45, lowSun),
        previewMaxDistance: Math.round(mixNumber(4200, 7200, longReach)),
        previewMidReachMeters: Math.round(mixNumber(1400, 2800, longReach)),
        previewFarReachMeters: Math.round(mixNumber(3400, 7200, longReach)),
        previewMaxTiles: Math.round(mixNumber(28, 42, longReach)),
        previewMaxCoreTiles: Math.round(mixNumber(10, 14, longReach)),
        previewZoomBias: mixNumber(-1.35, -0.95, lowSun),
        refineMaxDistance: Math.round(mixNumber(3200, 6200, longReach)),
        refineMidReachMeters: Math.round(mixNumber(900, 1600, longReach)),
        refineFarReachMeters: Math.round(mixNumber(2800, 6200, longReach)),
        refineMaxTiles: Math.round(mixNumber(52, 68, longReach)),
        refineMaxCoreTiles: Math.round(mixNumber(30, 38, longReach)),
        refineZoomBias: mixNumber(0.85, 1.05, lowSun)
    };
}

function publishSolarState(date, center, sunPos, sunAzimuthDeg, sunAltitudeDeg) {
    const azimuthRad = sunAzimuthDeg * Math.PI / 180;
    const reachProfile = shadowReachProfileForSun(sunAltitudeDeg);
    window._skySunAzimuthRad = azimuthRad;
    window._skySunAltitudeRad = sunPos.altitude;
    window._actualSunAltitudeRad = sunPos.altitude;
    window._shadowReachProfile = reachProfile;
    window._shadowSunDirection = [
        Math.sin(azimuthRad),
        -Math.cos(azimuthRad)
    ];
    window._xploreSolarState = {
        dateMs: date.getTime(),
        lat: center.lat,
        lng: center.lng,
        azimuthDeg: sunAzimuthDeg,
        azimuthRad,
        altitudeDeg: sunAltitudeDeg,
        altitudeRad: sunPos.altitude,
        reachProfile
    };
}

function colorRampForSun(altitude) {
    const directSun = smoothstep(-2.0, 8.0, altitude);
    const skyAmbient = smoothstep(-16.0, 6.0, altitude);
    const horizonWarmth = smoothstep(-6.0, 2.0, altitude) * (1.0 - smoothstep(6.0, 16.0, altitude));
    const redWarmth = smoothstep(-4.0, 0.8, altitude) * (1.0 - smoothstep(2.5, 9.0, altitude));
    const warmMix = clamp(horizonWarmth * 0.72 + redWarmth * 0.28, 0, 1);
    const highlight = {
        r: 255,
        g: Math.round((0.97 * (1 - warmMix) + 0.74 * warmMix) * 255),
        b: Math.round((0.92 * (1 - warmMix) + 0.50 * warmMix) * 255)
    };
    const shadow = {
        r: 19,
        g: 22,
        b: 31
    };
    const hillshadeHighlightRgb = [
        mixNumber(170, mixNumber(255, 255, horizonWarmth), skyAmbient),
        mixNumber(190, mixNumber(180, 248, directSun), skyAmbient),
        mixNumber(220, mixNumber(130, 255, directSun), skyAmbient)
    ];
    return {
        highlight: `rgb(${highlight.r}, ${highlight.g}, ${highlight.b})`,
        shadow: `rgb(${shadow.r}, ${shadow.g}, ${shadow.b})`,
        directSun,
        skyAmbient,
        hillshadeHighlight: rgbString(hillshadeHighlightRgb),
        hillshadeShadow: 'rgba(0,0,0, 0.220)'
    };
}

function setDefaultGlobal(name, value) {
    if (typeof window === 'undefined') return;
    if (window[name] === undefined) window[name] = value;
}

function ensureShadowRuntimeDefaults() {
    setDefaultGlobal('_shadowTileDebugEnabled', false);
    setDefaultGlobal('_shadowUseHorizonCurrent', false);
    setDefaultGlobal('_terrainNativeDemZoom', true);
    setDefaultGlobal('_castShadowMult', 1.45);
    setDefaultGlobal('_selfShadowMult', 1.8);
    setDefaultGlobal('_horizonQualityPreset', 'balanced');
    setDefaultGlobal('_horizonDirectionBins', 16);
    setDefaultGlobal('_horizonEdgeSoftness', 1.0);
    setDefaultGlobal('_horizonEdgeNaturalness', 0.0);
    setDefaultGlobal('_shadowAtlasSize', 2048);
    setDefaultGlobal('_shadowMaskScale', 1.0);
    setDefaultGlobal('_shadowNearAtlasSize', 2048);
    setDefaultGlobal('_shadowNearMaskScale', 1.0);
    setDefaultGlobal('_shadowNearDebugTint', false);
    setDefaultGlobal('_shadowUseLogSweep', false);
    setDefaultGlobal('_shadowV3UseHiZ', false);
    setDefaultGlobal('_shadowV3AtlasSize', 4096);
    setDefaultGlobal('_shadowV3MaskScale', 0.5);
    setDefaultGlobal('_shadowV3NearAtlasSize', 4096);
    setDefaultGlobal('_shadowV3NearMaskScale', 0.5);
    setDefaultGlobal('_shadowV3ComponentMode', 'full');
    setDefaultGlobal('_shadowV3ContactShadows', false);
    setDefaultGlobal('_shadowV3ContactStrength', 0.72);
    setDefaultGlobal('_shadowV3ContactDistance', 520);
    setDefaultGlobal('_shadowV3ContactSteps', 10);
    setDefaultGlobal('_shadowRidgeSampleStrength', 0.42);
    setDefaultGlobal('_shadowEdgeCleanup', true);
    setDefaultGlobal('_shadowBlurRadius', 2.75);
    setDefaultGlobal('_shadowCameraMoving', false);
    setDefaultGlobal('_shadowCameraRefreshHold', false);
    setDefaultGlobal('_shadowProgressivePhase', 'stable');
    setDefaultGlobal('_isInteractingWithTime', false);
}

/**
 * Create the shadow controller.
 * @param {maplibregl.Map} map
 * @param {object} deps
 * @returns {object} shadow controller API
 */
export function createShadowController(map, deps = {}) {
    const { viewModeController = null } = deps;
    ensureShadowRuntimeDefaults();

    let lastAppliedDate = new Date(window.skySimulationDate || Date.now());
    let lastDaylightDateKey = '';
    let cameraMoving = false;
    let cameraShadowDeferred = false;
    let cameraShadowRefreshTimer = null;
    let cameraShadowIdleTimer = null;
    let cameraShadowRefineTimer = null;
    let cameraShadowIdleRelease = null;

    function safeSetPaint(layerId, property, value) {
        if (!map?.getLayer(layerId)) return;
        try { map.setPaintProperty(layerId, property, value); } catch (_) { }
    }

    function currentShadowDate() {
        return new Date(lastAppliedDate?.getTime?.() || window.skySimulationDate || Date.now());
    }

    function invalidateNearShadowRefine() {
        const terrain = map?.terrain;
        if (!terrain) return;
        terrain._shadowNearAtlasReady = false;
        delete terrain._shadowNearAtlasReadyAt;
        delete terrain._shadowNearFadeRepaintQueued;
    }

    function invalidateDaylightCacheIfDayChanged(date) {
        const key = date.toDateString();
        if (key === lastDaylightDateKey) return;
        lastDaylightDateKey = key;
        const terrain = map?.terrain;
        if (!terrain) return;
        terrain._daylightAtlasReady = false;
        terrain._daylightAtlasKey = null;
    }

    function clearCameraShadowRefreshTimers() {
        clearTimeout(cameraShadowRefreshTimer);
        clearTimeout(cameraShadowIdleTimer);
        clearTimeout(cameraShadowRefineTimer);
        cameraShadowRefreshTimer = null;
        cameraShadowIdleTimer = null;
        cameraShadowRefineTimer = null;

        if (cameraShadowIdleRelease && map && typeof map.off === 'function') {
            map.off('idle', cameraShadowIdleRelease);
        }
        cameraShadowIdleRelease = null;
    }

    function deferCameraShadowRefresh() {
        clearCameraShadowRefreshTimers();
        cameraMoving = true;
        cameraShadowDeferred = true;
        window._shadowCameraMoving = true;
        window._shadowCameraRefreshHold = true;
        window._shadowProgressivePhase = 'held';
        invalidateNearShadowRefine();
    }

    function releaseCameraShadowRefresh() {
        if (!cameraShadowDeferred || cameraMoving) return;
        // Camera moves should keep the previous stable shadow while moving,
        // then refresh directly at full quality after idle. The low-res
        // preview phase is reserved for time-slider interaction, where the
        // sun direction changes continuously and immediate feedback matters.
        clearCameraShadowRefreshTimers();
        releaseCameraShadowFullRefresh();
    }

    function releaseCameraShadowFullRefresh() {
        if (!cameraShadowDeferred || cameraMoving) return;
        cameraShadowDeferred = false;
        window._shadowCameraRefreshHold = false;
        window._shadowProgressivePhase = 'full';
        updateShadowTime(currentShadowDate(), { forceRepaint: false });
        map?.triggerRepaint();
        scheduleCameraShadowNearRefine();
    }

    function releaseCameraShadowNearRefine() {
        cameraShadowRefineTimer = null;
        if (window._isInteractingWithTime) {
            scheduleCameraShadowNearRefine();
            return;
        }
        if (cameraMoving || window._shadowCameraRefreshHold) return;
        window._shadowProgressivePhase = 'refine';
        updateShadowTime(currentShadowDate(), { forceRepaint: false, skipNearRefine: true });
        map?.triggerRepaint();
    }

    function scheduleCameraShadowNearRefine() {
        clearTimeout(cameraShadowRefineTimer);
        cameraShadowRefineTimer = window.setTimeout(releaseCameraShadowNearRefine, CAMERA_SHADOW_REFINE_DELAY_MS);
    }

    function waitForCameraShadowIdle() {
        cameraShadowRefreshTimer = null;
        if (!map || !cameraShadowDeferred || cameraMoving) return;

        const tilesReady = typeof map.areTilesLoaded === 'function'
            ? map.areTilesLoaded()
            : typeof map.loaded === 'function' ? map.loaded() : false;

        if (tilesReady) {
            releaseCameraShadowRefresh();
            return;
        }

        cameraShadowIdleRelease = () => releaseCameraShadowRefresh();
        map.once('idle', cameraShadowIdleRelease);
        cameraShadowIdleTimer = window.setTimeout(releaseCameraShadowRefresh, CAMERA_SHADOW_IDLE_TIMEOUT_MS);
    }

    function finishCameraShadowRefresh() {
        cameraMoving = false;
        window._shadowCameraMoving = false;
        if (!cameraShadowDeferred) return;

        window._shadowCameraRefreshHold = true;
        clearCameraShadowRefreshTimers();
        cameraShadowRefreshTimer = window.setTimeout(waitForCameraShadowIdle, CAMERA_SHADOW_SETTLE_MS);
    }

    if (map?.on) {
        map.on('movestart', deferCameraShadowRefresh);
        map.on('move', deferCameraShadowRefresh);
        map.on('moveend', finishCameraShadowRefresh);
        map.on('webglcontextrestored', () => {
            const terrain = map.terrain;
            if (terrain) {
                terrain._horizonAtlasReady = false;
                terrain._horizonAtlasKey = null;
                terrain._daylightAtlasReady = false;
                terrain._daylightAtlasKey = null;
            }
            map.once('idle', () => updateShadowTime(currentShadowDate()));
        });
    }

    /**
     * Update shadow illumination for a given date/time.
     * Sets hillshade illumination direction and altitude on all relevant layers,
     * updates the sky simulation, and applies the sun position globally.
     * @param {Date} date
     * @param {object} options
     */
    function updateShadowTime(date, options = {}) {
        if (!date || !(date instanceof Date)) return;
        if (!options.skipNearRefine) {
            invalidateNearShadowRefine();
        }
        lastAppliedDate = date;
        window.skySimulationDate = date.getTime();
        window._daylightDateMs = date.getTime();
        if (!map) return;
        try {
            if (typeof SunCalc === 'undefined' || !SunCalc.getPosition) return;
            const center = map.getCenter();
            const sunPos = SunCalc.getPosition(date, center.lat, center.lng);
            const sunAzi = (sunPos.azimuth * 180 / Math.PI + 180) % 360;
            const sunAlt = sunPos.altitude * 180 / Math.PI;
            const renderAltitude = sunAlt > 0
                ? clamp(sunAlt, SHADOW_MIN_RENDER_ALTITUDE, SHADOW_MAX_RENDER_ALTITUDE)
                : 0;
            const colors = colorRampForSun(sunAlt);

            publishSolarState(date, center, sunPos, sunAzi, sunAlt);
            window._directSunAmount = colors.directSun;
            window._skyAmbientAmount = colors.skyAmbient;
            window.sunConfig = {
                azimuth: sunAzi,
                altitude: sunAlt,
                renderAltitude,
                directSun: colors.directSun,
                skyAmbient: colors.skyAmbient
            };

            SHADOW_RENDER_LAYER_IDS.forEach((layerId) => {
                safeSetPaint(layerId, 'shadow-direction', sunAzi);
                safeSetPaint(layerId, 'shadow-altitude', renderAltitude);
                safeSetPaint(layerId, 'shadow-max-distance', window._shadowReachProfile?.maxDistance || 8000);
                safeSetPaint(layerId, 'shadow-shadow-color', colors.shadow);
                safeSetPaint(layerId, 'shadow-highlight-color', colors.highlight);
            });
            safeSetPaint('terrain-derivative-cache', 'hillshade-illumination-direction', sunAzi);
            safeSetPaint('terrain-derivative-cache', 'hillshade-illumination-altitude', renderAltitude);

            if (map.getLayer('hillshade')) {
                map.setPaintProperty('hillshade', 'hillshade-illumination-direction', [sunAzi, (sunAzi + 45) % 360, (sunAzi - 45 + 360) % 360, (sunAzi + 180) % 360]);
                map.setPaintProperty('hillshade', 'hillshade-illumination-altitude', [renderAltitude, renderAltitude, renderAltitude, renderAltitude]);
                map.setPaintProperty('hillshade', 'hillshade-shadow-color', colors.hillshadeShadow);
                map.setPaintProperty('hillshade', 'hillshade-highlight-color', colors.hillshadeHighlight);
            }

            invalidateDaylightCacheIfDayChanged(date);
        } catch (_) { }

        if (viewModeController?.updateSkyForTime) {
            viewModeController.updateSkyForTime(date);
        }
        if (options.forceRepaint !== false) map.triggerRepaint();
        const phase = window._shadowProgressivePhase;
        const canScheduleNearRefine = !options.skipNearRefine &&
            phase !== 'held' &&
            phase !== 'preview' &&
            phase !== 'full' &&
            phase !== 'refine' &&
            !window._isInteractingWithTime &&
            !cameraMoving &&
            !window._shadowCameraRefreshHold;
        if (canScheduleNearRefine) {
            scheduleCameraShadowNearRefine();
        }
    }

    window.setTimeout(() => updateShadowTime(currentShadowDate(), { forceRepaint: false }), 0);

    return {
        updateShadowTime,
    };
}
