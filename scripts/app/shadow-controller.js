/**
 * shadow-controller.js — Sun position calculation, shadow time updates,
 * hillshade illumination direction/altitude synchronisation.
 */

const SHADOW_MIN_RENDER_ALTITUDE = 2;
const SHADOW_MAX_RENDER_ALTITUDE = 89.5;
const CAMERA_SHADOW_SETTLE_MS = 450;
const CAMERA_SHADOW_FINE_DELAY_MS = 1200;
const CAMERA_SHADOW_IDLE_TIMEOUT_MS = 1800;

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
        maxTiles: Math.round(mixNumber(72, 112, longReach)),
        maxCoreTiles: Math.round(mixNumber(32, 40, longReach)),
        zoomBias: mixNumber(0, 0.15, lowSun),
        previewMaxDistance: Math.round(mixNumber(4200, 7200, longReach)),
        previewMidReachMeters: Math.round(mixNumber(1400, 2800, longReach)),
        previewFarReachMeters: Math.round(mixNumber(3400, 7200, longReach)),
        previewMaxTiles: Math.round(mixNumber(28, 42, longReach)),
        previewMaxCoreTiles: Math.round(mixNumber(10, 14, longReach)),
        previewZoomBias: mixNumber(-1.35, -0.95, lowSun)
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
    setDefaultGlobal('_shadowMaskScale', 0.5);
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
    let cameraShadowFullTimer = null;
    let cameraShadowIdleRelease = null;

    function safeSetPaint(layerId, property, value) {
        if (!map?.getLayer(layerId)) return;
        try { map.setPaintProperty(layerId, property, value); } catch (_) { }
    }

    function currentShadowDate() {
        return new Date(lastAppliedDate?.getTime?.() || window.skySimulationDate || Date.now());
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
        clearTimeout(cameraShadowFullTimer);
        cameraShadowRefreshTimer = null;
        cameraShadowIdleTimer = null;
        cameraShadowFullTimer = null;

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
    }

    function releaseCameraShadowRefresh() {
        if (!cameraShadowDeferred || cameraMoving) return;
        clearCameraShadowRefreshTimers();
        window._shadowCameraRefreshHold = false;
        window._shadowProgressivePhase = 'preview';
        updateShadowTime(currentShadowDate(), { forceRepaint: false });
        map?.triggerRepaint();
        cameraShadowFullTimer = window.setTimeout(releaseCameraShadowFullRefresh, CAMERA_SHADOW_FINE_DELAY_MS);
    }

    function releaseCameraShadowFullRefresh() {
        cameraShadowFullTimer = null;
        if (!cameraShadowDeferred || cameraMoving) return;
        cameraShadowDeferred = false;
        window._shadowCameraRefreshHold = false;
        window._shadowProgressivePhase = 'full';
        updateShadowTime(currentShadowDate(), { forceRepaint: false });
        map?.triggerRepaint();
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

            safeSetPaint('shadow-coarse', 'shadow-direction', sunAzi);
            safeSetPaint('shadow-coarse', 'shadow-altitude', renderAltitude);
            safeSetPaint('shadow-coarse', 'shadow-max-distance', window._shadowReachProfile?.maxDistance || 8000);
            safeSetPaint('shadow-coarse', 'shadow-shadow-color', colors.shadow);
            safeSetPaint('shadow-coarse', 'shadow-highlight-color', colors.highlight);
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
    }

    window.setTimeout(() => updateShadowTime(currentShadowDate(), { forceRepaint: false }), 0);

    return {
        updateShadowTime,
    };
}
