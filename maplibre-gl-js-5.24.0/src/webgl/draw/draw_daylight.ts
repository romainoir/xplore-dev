import { StencilMode } from '../stencil_mode';
import { DepthMode } from '../depth_mode';
import { CullFaceMode } from '../cull_face_mode';
import { daylightPrepareUniformValues, daylightUniformValues } from '../program/daylight_program';
import { horizonPrepareUniformValues } from '../program/horizon_program';
import { Texture } from '../texture';
import { Color } from '@maplibre/maplibre-gl-style-spec';

// Using SunCalc to generate solar positions
import SunCalc from 'suncalc';

import type { Painter, RenderOptions } from '../../render/painter';
import type { TileManager } from '../../tile/tile_manager';
import type { DaylightStyleLayer } from '../../style/style_layer/daylight_style_layer';
import type { OverscaledTileID } from '../../tile/tile_id';
import type { Context } from '../context';

// Cache the solar LUT so we only rebuild it once per day/location change
let cachedDateStr = '';
let cachedCenterLat = 0;
let cachedCenterLng = 0;
const SOLAR_LUT_STEPS = 32;
const SOLAR_LUT_FLOATS = SOLAR_LUT_STEPS * 2;
const SUN_WINDOW_LUT_STEPS = 8;
const SUN_WINDOW_LUT_FLOATS = SUN_WINDOW_LUT_STEPS * 2;
const SUN_WINDOW_SUNRISE_PRE_MINS = 10;
const SUN_WINDOW_SUNRISE_POST_MINS = 20;
const SUN_WINDOW_SUNSET_PRE_MINS = 20;
const SUN_WINDOW_SUNSET_POST_MINS = 10;

type SolarLUTResult = {
    lut: Float32Array;
    weight: number;
    sunriseWindowLUT: Float32Array;
    sunsetWindowLUT: Float32Array;
};

type HorizonQualitySettings = {
    preset: string;
    bins: number;
    maxDistance: number;
    horizonSize: number;
    stepScale: number;
    minStep: number;
    maxStep: number;
    edgeSoftness: number;
    edgeNaturalness: number;
};

const HORIZON_QUALITY_PRESETS: Record<string, HorizonQualitySettings> = {
    fast: {
        preset: 'fast',
        bins: 8,
        maxDistance: 6000,
        horizonSize: 768,
        stepScale: 1.10,
        minStep: 24,
        maxStep: 110,
        edgeSoftness: 1.10,
        edgeNaturalness: 0.00
    },
    balanced: {
        preset: 'balanced',
        bins: 16,
        maxDistance: 8000,
        horizonSize: 1024,
        stepScale: 0.90,
        minStep: 18,
        maxStep: 90,
        edgeSoftness: 1.00,
        edgeNaturalness: 0.00
    },
    high: {
        preset: 'high',
        bins: 16,
        maxDistance: 12000,
        horizonSize: 1536,
        stepScale: 0.70,
        minStep: 14,
        maxStep: 72,
        edgeSoftness: 0.85,
        edgeNaturalness: 0.00
    }
};

let cachedSolarLUT = new Float32Array(SOLAR_LUT_FLOATS); // azimuth/altitude vec2s
let cachedSunriseWindowLUT = new Float32Array(SUN_WINDOW_LUT_FLOATS);
let cachedSunsetWindowLUT = new Float32Array(SUN_WINDOW_LUT_FLOATS);
let cachedTimeWeightMins = 0;

function numberGlobal(name: string, fallback: number): number {
    const value = typeof window !== 'undefined' ? (window as any)[name] : undefined;
    return Number.isFinite(value) ? value : fallback;
}

function getHorizonQualitySettings(): HorizonQualitySettings {
    const requestedPreset = typeof window !== 'undefined' ? String((window as any)._horizonQualityPreset || 'balanced') : 'balanced';
    const preset = HORIZON_QUALITY_PRESETS[requestedPreset] || HORIZON_QUALITY_PRESETS.balanced;
    return {
        ...preset,
        edgeSoftness: numberGlobal('_horizonEdgeSoftness', preset.edgeSoftness),
        edgeNaturalness: numberGlobal('_horizonEdgeNaturalness', preset.edgeNaturalness)
    };
}

/**
 * Builds a solar lookup table (LUT) for the given day and location.
 * Converts SunCalc's (azimuth, altitude) into the Float32Array expected by the shader.
 */
function writeSunPosition(lut: Float32Array, index: number, date: Date, lat: number, lng: number) {
    const pos = SunCalc.getPosition(date, lat, lng);

    // SunCalc azimuth: 0 is South, + is West.
    // MapLibre / Shader Azimuth: 0 is North, increases clockwise.
    let azimuth = pos.azimuth + Math.PI;
    if (azimuth > 2 * Math.PI) azimuth -= 2 * Math.PI;

    lut[index * 2] = azimuth;
    lut[index * 2 + 1] = pos.altitude;
}

function buildSolarLUT(date: Date, lat: number, lng: number): SolarLUTResult { // eslint-disable-line
    const dateStr = date.toDateString();

    // Simple cache check to avoid rebuilding every frame
    if (dateStr === cachedDateStr && Math.abs(lat - cachedCenterLat) < 0.1 && Math.abs(lng - cachedCenterLng) < 0.1) {
        return {
            lut: cachedSolarLUT,
            weight: cachedTimeWeightMins,
            sunriseWindowLUT: cachedSunriseWindowLUT,
            sunsetWindowLUT: cachedSunsetWindowLUT
        };
    }

    // Get sunrise and sunset times
    const times = SunCalc.getTimes(date, lat, lng);
    const sunrise = times.sunrise;
    const sunset = times.sunset;

    // Default to zeroed array if sun doesn't rise (e.g. polar night)
    const lut = new Float32Array(SOLAR_LUT_FLOATS);
    const sunriseWindowLUT = new Float32Array(SUN_WINDOW_LUT_FLOATS);
    const sunsetWindowLUT = new Float32Array(SUN_WINDOW_LUT_FLOATS);
    let weight = 0;

    if (sunrise && sunset && !isNaN(sunrise.getTime()) && !isNaN(sunset.getTime())) {
        const sunriseMs = sunrise.getTime();
        const sunsetMs = sunset.getTime();
        const daylightDurationMs = sunsetMs - sunriseMs;
        const daylightMins = daylightDurationMs / 60000;

        // Evaluate enough positions to show mountain-shadow duration, while keeping
        // the draw shader cheap enough for an interactive analysis overlay.
        const steps = SOLAR_LUT_STEPS;
        weight = daylightMins / steps; // Time represented by each step

        const stepMs = daylightDurationMs / steps;

        for (let i = 0; i < steps; i++) {
            // Sample exactly in the middle of each time chunk
            const sampleTime = new Date(sunriseMs + (i + 0.5) * stepMs);
            writeSunPosition(lut, i, sampleTime, lat, lng);
        }

        const sunriseWindowStartMs = sunriseMs - SUN_WINDOW_SUNRISE_PRE_MINS * 60000;
        const sunriseWindowStepMs = (SUN_WINDOW_SUNRISE_PRE_MINS + SUN_WINDOW_SUNRISE_POST_MINS) * 60000 / SUN_WINDOW_LUT_STEPS;
        const sunsetWindowStartMs = sunsetMs - SUN_WINDOW_SUNSET_PRE_MINS * 60000;
        const sunsetWindowStepMs = (SUN_WINDOW_SUNSET_PRE_MINS + SUN_WINDOW_SUNSET_POST_MINS) * 60000 / SUN_WINDOW_LUT_STEPS;
        for (let i = 0; i < SUN_WINDOW_LUT_STEPS; i++) {
            writeSunPosition(sunriseWindowLUT, i, new Date(sunriseWindowStartMs + (i + 0.5) * sunriseWindowStepMs), lat, lng);
            writeSunPosition(sunsetWindowLUT, i, new Date(sunsetWindowStartMs + (i + 0.5) * sunsetWindowStepMs), lat, lng);
        }
    }

    cachedDateStr = dateStr;
    cachedCenterLat = lat;
    cachedCenterLng = lng;
    cachedSolarLUT = lut;
    cachedSunriseWindowLUT = sunriseWindowLUT;
    cachedSunsetWindowLUT = sunsetWindowLUT;
    cachedTimeWeightMins = weight;

    return { lut, weight, sunriseWindowLUT, sunsetWindowLUT };
}

function getDaylightDate(): Date {
    const daylightDateMs = typeof window !== 'undefined' ? (window as any)._daylightDateMs : undefined;
    return Number.isFinite(daylightDateMs) ? new Date(daylightDateMs) : new Date();
}

function getDaylightCacheKey(date: Date, lat: number, lng: number, atlasBounds: [number, number, number, number], horizonKey: string): string {
    const settings = getHorizonQualitySettings();
    return `${date.toDateString()}:${lat.toFixed(1)}:${lng.toFixed(1)}:${atlasBounds.map(v => v.toFixed(7)).join(':')}:${SOLAR_LUT_STEPS}:sunwindow-${SUN_WINDOW_SUNRISE_PRE_MINS}-${SUN_WINDOW_SUNRISE_POST_MINS}-${SUN_WINDOW_SUNSET_PRE_MINS}-${SUN_WINDOW_SUNSET_POST_MINS}:${horizonKey}:edge${settings.edgeSoftness.toFixed(3)}`;
}

function getHorizonCacheKey(
    atlasBounds: [number, number, number, number],
    horizonSize: number,
    horizonBins: number,
    maxDistance: number,
    stepMeters: number,
    maxSteps: number
): string {
    return `${atlasBounds.map(v => v.toFixed(7)).join(':')}:${horizonSize}:${horizonBins}:${maxDistance}:${stepMeters.toFixed(2)}:${maxSteps}`;
}

function prepareHorizonAtlas(
    painter: Painter,
    horizonKey: string,
    horizonBins: number,
    maxDistance: number,
    stepMeters: number,
    maxSteps: number,
    depthMode: Readonly<DepthMode>,
    stencilMode: Readonly<StencilMode>,
    colorMode: any
): boolean {
    const debugEnabled = typeof window !== 'undefined' && (window as any)._shadowTileDebugEnabled;
    const start = debugEnabled ? performance.now() : 0;
    const settings = getHorizonQualitySettings();
    const context = painter.context;
    const gl = context.gl;
    const terrain = painter.style.map.terrain as any;

    if (!terrain || !terrain._fboElevationTexture || !terrain._elevationAtlasBounds) {
        if (debugEnabled) {
            (window as any)._horizonPrepareDebug = {
                skipped: true,
                reason: 'missing elevation atlas',
                durationMs: performance.now() - start,
                timestamp: performance.now()
            };
        }
        return false;
    }

    const hasRequiredHorizonTextures = terrain._fboHorizon0Texture && terrain._fboHorizon1Texture &&
        (horizonBins <= 8 || (terrain._fboHorizon2Texture && terrain._fboHorizon3Texture));

    if (terrain._horizonAtlasReady && terrain._horizonAtlasKey === horizonKey && hasRequiredHorizonTextures) {
        if (debugEnabled) {
            (window as any)._horizonPrepareDebug = {
                prepared: 0,
                clean: 1,
                horizonKey,
                preset: settings.preset,
                size: terrain._fboHorizon0Texture.size?.[0],
                bins: horizonBins,
                maxSteps,
                stepMeters,
                maxDistance,
                durationMs: performance.now() - start,
                timestamp: performance.now()
            };
        }
        return true;
    }

    const atlasBounds = terrain._elevationAtlasBounds as [number, number, number, number];
    const elevationAtlasSize = terrain._fboElevationTexture.size[0];
    const horizon0Fbo = terrain.getFramebuffer('horizon0');
    const horizon1Fbo = terrain.getFramebuffer('horizon1');
    const horizon2Fbo = horizonBins > 8 ? terrain.getFramebuffer('horizon2') : null;
    const horizon3Fbo = horizonBins > 8 ? terrain.getFramebuffer('horizon3') : null;
    const horizonSize = terrain._fboHorizon0Texture.size[0];
    const program = painter.useProgram('horizonPrepare');

    const drawHorizonTarget = (framebuffer: any, directionOffset: number, layerId: string) => {
        context.bindFramebuffer.set(framebuffer.framebuffer);
        context.viewport.set([0, 0, horizonSize, horizonSize]);
        context.clear({ color: Color.transparent });

        context.activeTexture.set(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, terrain._fboElevationTexture.texture);

        program.draw(context, gl.TRIANGLES,
            depthMode, stencilMode, colorMode, CullFaceMode.disabled,
            horizonPrepareUniformValues(
                atlasBounds,
                elevationAtlasSize,
                maxDistance,
                stepMeters,
                maxSteps,
                directionOffset,
                horizonBins
            ),
            null, null, layerId, painter.rasterBoundsBuffer,
            painter.quadTriangleIndexBuffer, painter.rasterBoundsSegments);
    };

    drawHorizonTarget(horizon0Fbo, 0, 'horizon-prepare-0');
    drawHorizonTarget(horizon1Fbo, 4, 'horizon-prepare-1');
    if (horizonBins > 8 && horizon2Fbo && horizon3Fbo) {
        drawHorizonTarget(horizon2Fbo, 8, 'horizon-prepare-2');
        drawHorizonTarget(horizon3Fbo, 12, 'horizon-prepare-3');
    }

    context.bindFramebuffer.set(null);
    context.viewport.set([0, 0, painter.width, painter.height]);

    terrain._horizonAtlasReady = true;
    terrain._horizonAtlasKey = horizonKey;
    terrain._daylightAtlasReady = false;

    if (debugEnabled) {
        (window as any)._horizonPrepareDebug = {
            prepared: 1,
            clean: 0,
            horizonKey,
            preset: settings.preset,
            size: horizonSize,
            bins: horizonBins,
            maxSteps,
            stepMeters,
            maxDistance,
            durationMs: performance.now() - start,
            timestamp: performance.now()
        };
    }

    return true;
}

export function prepareHorizonAtlasForCurrentView(
    painter: Painter,
    depthMode: Readonly<DepthMode>,
    stencilMode: Readonly<StencilMode>,
    colorMode: any
): string | null {
    const terrain = painter.style.map.terrain as any;
    const atlasBounds = terrain?._elevationAtlasBounds as [number, number, number, number] | undefined;
    if (!terrain || !atlasBounds || !terrain._fboElevationTexture) {
        prepareHorizonAtlas(painter, 'missing-atlas', 8, 8000, 90, 96, depthMode, stencilMode, colorMode);
        return null;
    }

    const worldCircumference = 40075016.7;
    const atlasWorldWidth = atlasBounds[2] - atlasBounds[0];
    const atlasWorldHeight = atlasBounds[3] - atlasBounds[1];
    const elevationAtlasSize = terrain._fboElevationTexture.size[0];
    const metersPerPixelX = (atlasWorldWidth * worldCircumference) / elevationAtlasSize;
    const metersPerPixelY = (atlasWorldHeight * worldCircumference) / elevationAtlasSize;
    const baseGsd = Math.max(metersPerPixelX, metersPerPixelY);
    const settings = getHorizonQualitySettings();
    const maxDistance = settings.maxDistance;
    const stepMeters = Math.max(settings.minStep, Math.min(settings.maxStep, baseGsd * settings.stepScale));
    const maxSteps = Math.min(128, Math.ceil(maxDistance / stepMeters));
    const horizonSize = Math.max(512, Math.min(2048, Math.round(settings.horizonSize)));
    terrain._horizonAtlasSize = horizonSize;
    const horizonKey = getHorizonCacheKey(atlasBounds, horizonSize, settings.bins, maxDistance, stepMeters, maxSteps);

    return prepareHorizonAtlas(painter, horizonKey, settings.bins, maxDistance, stepMeters, maxSteps, depthMode, stencilMode, colorMode)
        ? horizonKey
        : null;
}

function prepareDaylightDuration(
    painter: Painter,
    layer: DaylightStyleLayer,
    solarLUT: Float32Array,
    timeWeightMins: number,
    sunriseWindowLUT: Float32Array,
    sunsetWindowLUT: Float32Array,
    daylightKey: string,
    horizonBins: number,
    horizonEdgeSoftness: number,
    depthMode: Readonly<DepthMode>,
    stencilMode: Readonly<StencilMode>,
    colorMode: any
) {
    const debugEnabled = typeof window !== 'undefined' && (window as any)._shadowTileDebugEnabled;
    const start = debugEnabled ? performance.now() : 0;
    const context = painter.context;
    const gl = context.gl;
    const terrain = painter.style.map.terrain as any;

    if (!terrain || !terrain._fboHorizon0Texture || !terrain._fboHorizon1Texture || !terrain._horizonAtlasReady) {
        if (debugEnabled) {
            (window as any)._daylightPrepareDebug = {
                layer: layer.id,
                skipped: true,
                reason: 'missing horizon atlas',
                durationMs: performance.now() - start,
                timestamp: performance.now()
            };
        }
        return;
    }

    if (terrain._daylightAtlasReady && terrain._daylightAtlasKey === daylightKey && terrain._fboDaylightTexture) {
        if (debugEnabled) {
            (window as any)._daylightPrepareDebug = {
                layer: layer.id,
                prepared: 0,
                clean: 1,
                samples: SOLAR_LUT_STEPS,
                sunWindowSamples: SUN_WINDOW_LUT_STEPS,
                timeWeightMins,
                daylightKey,
                preset: getHorizonQualitySettings().preset,
                daylightAtlasSize: terrain._fboDaylightTexture.size?.[0],
                horizonAtlasSize: terrain._fboHorizon0Texture.size?.[0],
                horizonBins,
                durationMs: performance.now() - start,
                timestamp: performance.now()
            };
        }
        return;
    }

    const daylightFbo = terrain.getFramebuffer('daylight');
    const daylightSize = terrain._fboDaylightTexture.size[0];
    const program = painter.useProgram('daylightPrepare');

    context.bindFramebuffer.set(daylightFbo.framebuffer);
    context.viewport.set([0, 0, daylightSize, daylightSize]);

    context.activeTexture.set(gl.TEXTURE0);
    terrain._fboHorizon0Texture.bind(gl.LINEAR, gl.CLAMP_TO_EDGE);
    context.activeTexture.set(gl.TEXTURE1);
    terrain._fboHorizon1Texture.bind(gl.LINEAR, gl.CLAMP_TO_EDGE);
    context.activeTexture.set(gl.TEXTURE2);
    if (terrain._fboHorizon2Texture) terrain._fboHorizon2Texture.bind(gl.LINEAR, gl.CLAMP_TO_EDGE);
    context.activeTexture.set(gl.TEXTURE3);
    if (terrain._fboHorizon3Texture) terrain._fboHorizon3Texture.bind(gl.LINEAR, gl.CLAMP_TO_EDGE);

    program.draw(context, gl.TRIANGLES,
        depthMode, stencilMode, colorMode, CullFaceMode.disabled,
        daylightPrepareUniformValues(
            solarLUT,
            timeWeightMins,
            sunriseWindowLUT,
            sunsetWindowLUT,
            horizonBins,
            horizonEdgeSoftness
        ),
        null, null, `${layer.id}-prepare`, painter.rasterBoundsBuffer,
        painter.quadTriangleIndexBuffer, painter.rasterBoundsSegments);

    context.bindFramebuffer.set(null);
    context.viewport.set([0, 0, painter.width, painter.height]);
    terrain._daylightAtlasReady = true;
    terrain._daylightAtlasKey = daylightKey;

    if (debugEnabled) {
        (window as any)._daylightPrepareDebug = {
            layer: layer.id,
            prepared: 1,
            clean: 0,
            samples: SOLAR_LUT_STEPS,
            sunWindowSamples: SUN_WINDOW_LUT_STEPS,
            timeWeightMins,
            daylightKey,
            preset: getHorizonQualitySettings().preset,
            daylightAtlasSize: daylightSize,
            horizonAtlasSize: terrain._fboHorizon0Texture.size?.[0],
            horizonBins,
            horizonKey: terrain._horizonAtlasKey,
            durationMs: performance.now() - start,
            timestamp: performance.now()
        };
    }
}

export function drawDaylight(
    painter: Painter,
    tileManager: TileManager,
    layer: DaylightStyleLayer,
    tileIDs: Array<OverscaledTileID>,
    renderOptions: RenderOptions // eslint-disable-line
) {
    if (painter.renderPass !== 'offscreen' && painter.renderPass !== 'translucent') return;

    if (painter.renderPass === 'offscreen') {
        const center = painter.transform.center;
        const date = getDaylightDate();
        const { lut, weight, sunriseWindowLUT, sunsetWindowLUT } = buildSolarLUT(date, center.lat, center.lng);
        const terrain = painter.style.map.terrain as any;
        const atlasBounds = terrain?._elevationAtlasBounds as [number, number, number, number] | undefined;
        if (!atlasBounds) {
            const settings = getHorizonQualitySettings();
            prepareDaylightDuration(
                painter,
                layer,
                lut,
                weight,
                sunriseWindowLUT,
                sunsetWindowLUT,
                'missing-atlas',
                settings.bins,
                settings.edgeSoftness,
                painter.getDepthModeForSublayer(0, DepthMode.ReadOnly),
                StencilMode.disabled,
                painter.colorModeForRenderPass()
            );
            return;
        }
        const depthMode = painter.getDepthModeForSublayer(0, DepthMode.ReadOnly);
        const colorMode = painter.colorModeForRenderPass();
        const horizonKey = prepareHorizonAtlasForCurrentView(painter, depthMode, StencilMode.disabled, colorMode);
        if (!horizonKey) {
            return;
        }

        const settings = getHorizonQualitySettings();
        const daylightKey = getDaylightCacheKey(date, center.lat, center.lng, atlasBounds, horizonKey);
        prepareDaylightDuration(
            painter,
            layer,
            lut,
            weight,
            sunriseWindowLUT,
            sunsetWindowLUT,
            daylightKey,
            settings.bins,
            settings.edgeSoftness,
            depthMode,
            StencilMode.disabled,
            colorMode
        );
        painter.context.viewport.set([0, 0, painter.width, painter.height]);
        return;
    }

    // console.warn(`[drawDaylight] translucent pass for ${tileIDs.length} tiles`);

    const context = painter.context;
    const gl = context.gl;
    const projection = painter.style.projection;

    const depthMode = painter.getDepthModeForSublayer(0, DepthMode.ReadOnly);
    const colorMode = painter.colorModeForRenderPass();

    const [stencil, coords] = painter.getStencilConfigForOverlapAndUpdateStencilID(tileIDs);

    // Get current map center and date to read the matching cached daylight texture.
    const center = painter.transform.center;
    const date = getDaylightDate();
    const terrain = painter.style.map.terrain as any;
    const atlasBounds = (terrain?._elevationAtlasBounds || [0, 0, 1, 1]) as [number, number, number, number];
    const horizonKey = terrain?._horizonAtlasKey || 'missing-horizon';
    const daylightKey = getDaylightCacheKey(date, center.lat, center.lng, atlasBounds, horizonKey);
    const colorRampTexture = getColorRampTexture(context, layer);
    if (!colorRampTexture) return;

    const daylightReady = !!(terrain && terrain._fboDaylightTexture && terrain._daylightAtlasReady && terrain._daylightAtlasKey === daylightKey);
    let drawnTiles = 0;
    let skippedTiles = 0;

    for (const coord of coords) {
        const tile = tileManager.getTile(coord);
        if (!tile) continue;

        if (!daylightReady) {
            skippedTiles++;
            continue;
        }

        const useSubdivision = projection.useSubdivision;
        const useBorder = useSubdivision && !!context.extTextureFilterAnisotropic;

        const mesh = projection.getMeshFromTileID(context, coord.canonical, useBorder, true, 'raster');
        const terrainData = painter.style.map.terrain?.getTerrainData(coord);

        const program = painter.useProgram('daylight');

        // Bind after terrain data preparation. getTerrainData can upload and bind
        // DEM textures to the currently active unit, so units 0/1 must be restored
        // immediately before the draw that samples daylight and the color ramp.
        context.activeTexture.set(gl.TEXTURE0);
        terrain._fboDaylightTexture.bind(gl.LINEAR, gl.CLAMP_TO_EDGE);

        context.activeTexture.set(gl.TEXTURE1);
        colorRampTexture.bind(gl.LINEAR, gl.CLAMP_TO_EDGE);

        const uniformValues = daylightUniformValues(
            layer,
            [coord.canonical.z, coord.canonical.x, coord.canonical.y],
            atlasBounds
        );

        const projectionData = painter.transform.getProjectionData({
            overscaledTileID: coord,
            aligned: false,
            applyGlobeMatrix: false,
            applyTerrainMatrix: true
        });

        program.draw(context, gl.TRIANGLES, depthMode, stencil[coord.overscaledZ], colorMode, CullFaceMode.backCCW,
            uniformValues, terrainData, projectionData, layer.id, mesh.vertexBuffer, mesh.indexBuffer, mesh.segments);
        drawnTiles++;
    }

    if (typeof window !== 'undefined' && (window as any)._shadowTileDebugEnabled) {
        (window as any)._daylightDebug = {
            layer: layer.id,
            inputTiles: coords.length,
            drawnTiles,
            skippedTiles,
            atlasReady: daylightReady,
            daylightAtlasSize: terrain?._fboDaylightTexture?.size?.[0],
            horizonAtlasSize: terrain?._fboHorizon0Texture?.size?.[0],
            horizonKey,
            samples: SOLAR_LUT_STEPS,
            daylightKey,
            date: date.toISOString(),
            timestamp: performance.now()
        };
    }
}

function getColorRampTexture(context: Context, layer: DaylightStyleLayer): Texture | null {
    if (!layer.colorRamp) return null;
    if (!layer.colorRampTexture) {
        layer.colorRampTexture = new Texture(context, layer.colorRamp, context.gl.RGBA);
    }
    return layer.colorRampTexture;
}
