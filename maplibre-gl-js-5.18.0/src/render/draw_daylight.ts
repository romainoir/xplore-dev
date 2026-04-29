import { StencilMode } from '../gl/stencil_mode';
import { DepthMode } from '../gl/depth_mode';
import { CullFaceMode } from '../gl/cull_face_mode';
import { daylightPrepareUniformValues, daylightUniformValues } from './program/daylight_program';
import { Texture } from './texture';

// Using SunCalc to generate solar positions
import SunCalc from 'suncalc';

import type { Painter, RenderOptions } from './painter';
import type { TileManager } from '../tile/tile_manager';
import type { DaylightStyleLayer } from '../style/style_layer/daylight_style_layer';
import type { OverscaledTileID } from '../tile/tile_id';
import type { Context } from '../gl/context';

// Cache the solar LUT so we only rebuild it once per day/location change
let cachedDateStr = '';
let cachedCenterLat = 0;
let cachedCenterLng = 0;
const SOLAR_LUT_STEPS = 32;
const SOLAR_LUT_FLOATS = SOLAR_LUT_STEPS * 2;

let cachedSolarLUT = new Float32Array(SOLAR_LUT_FLOATS); // azimuth/altitude vec2s
let cachedTimeWeightMins = 0;

/**
 * Builds a solar lookup table (LUT) for the given day and location.
 * Converts SunCalc's (azimuth, altitude) into the Float32Array expected by the shader.
 */
function buildSolarLUT(date: Date, lat: number, lng: number): { lut: Float32Array, weight: number } { // eslint-disable-line
    const dateStr = date.toDateString();

    // Simple cache check to avoid rebuilding every frame
    if (dateStr === cachedDateStr && Math.abs(lat - cachedCenterLat) < 0.1 && Math.abs(lng - cachedCenterLng) < 0.1) {
        return { lut: cachedSolarLUT, weight: cachedTimeWeightMins };
    }

    // Get sunrise and sunset times
    const times = SunCalc.getTimes(date, lat, lng);
    const sunrise = times.sunrise;
    const sunset = times.sunset;

    // Default to zeroed array if sun doesn't rise (e.g. polar night)
    const lut = new Float32Array(SOLAR_LUT_FLOATS);
    let weight = 0;

    if (sunrise && sunset && !isNaN(sunrise.getTime()) && !isNaN(sunset.getTime())) {
        const daylightDurationMs = sunset.getTime() - sunrise.getTime();
        const daylightMins = daylightDurationMs / 60000;

        // Evaluate enough positions to show mountain-shadow duration, while keeping
        // the draw shader cheap enough for an interactive analysis overlay.
        const steps = SOLAR_LUT_STEPS;
        weight = daylightMins / steps; // Time represented by each step

        const stepMs = daylightDurationMs / steps;

        for (let i = 0; i < steps; i++) {
            // Sample exactly in the middle of each time chunk
            const sampleTime = new Date(sunrise.getTime() + (i + 0.5) * stepMs);
            const pos = SunCalc.getPosition(sampleTime, lat, lng);

            // SunCalc azimuth: 0 is South, + is West.
            // MapLibre / Shader Azimuth: 0 is North, increases clockwise.
            let azimuth = pos.azimuth + Math.PI;
            if (azimuth > 2 * Math.PI) azimuth -= 2 * Math.PI;

            // Pack into Float32Array: [Az, Alt, Az, Alt, ...]
            lut[i * 2] = azimuth;
            lut[i * 2 + 1] = pos.altitude;
        }
    }

    cachedDateStr = dateStr;
    cachedCenterLat = lat;
    cachedCenterLng = lng;
    cachedSolarLUT = lut;
    cachedTimeWeightMins = weight;

    return { lut, weight };
}

function getDaylightDate(): Date {
    const daylightDateMs = typeof window !== 'undefined' ? (window as any)._daylightDateMs : undefined;
    return Number.isFinite(daylightDateMs) ? new Date(daylightDateMs) : new Date();
}

function getDaylightCacheKey(date: Date, lat: number, lng: number, atlasBounds: [number, number, number, number]): string {
    return `${date.toDateString()}:${lat.toFixed(1)}:${lng.toFixed(1)}:${atlasBounds.map(v => v.toFixed(7)).join(':')}:${SOLAR_LUT_STEPS}`;
}

function prepareDaylightDuration(
    painter: Painter,
    layer: DaylightStyleLayer,
    solarLUT: Float32Array,
    timeWeightMins: number,
    daylightKey: string,
    depthMode: Readonly<DepthMode>,
    stencilMode: Readonly<StencilMode>,
    colorMode: any
) {
    const debugEnabled = typeof window !== 'undefined' && (window as any)._shadowTileDebugEnabled;
    const start = debugEnabled ? performance.now() : 0;
    const context = painter.context;
    const gl = context.gl;
    const terrain = painter.style.map.terrain as any;

    if (!terrain || !terrain._fboElevationTexture || !terrain._elevationAtlasBounds) {
        if (debugEnabled) {
            (window as any)._daylightPrepareDebug = {
                layer: layer.id,
                skipped: true,
                reason: 'missing elevation atlas',
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
                timeWeightMins,
                daylightKey,
                daylightAtlasSize: terrain._fboDaylightTexture.size?.[0],
                elevationAtlasSize: terrain._fboElevationTexture.size?.[0],
                durationMs: performance.now() - start,
                timestamp: performance.now()
            };
        }
        return;
    }

    const atlasBounds = terrain._elevationAtlasBounds as [number, number, number, number];
    const worldCircumference = 40075016.7;
    const atlasWorldWidth = atlasBounds[2] - atlasBounds[0];
    const atlasWorldHeight = atlasBounds[3] - atlasBounds[1];
    const elevationAtlasSize = terrain._fboElevationTexture.size[0];
    const metersPerPixelX = (atlasWorldWidth * worldCircumference) / elevationAtlasSize;
    const metersPerPixelY = (atlasWorldHeight * worldCircumference) / elevationAtlasSize;
    const baseGsd = Math.max(metersPerPixelX, metersPerPixelY);
    const maxDistance = 8000;
    const stepMeters = Math.max(24, Math.min(120, baseGsd * 1.15));
    const maxSteps = Math.min(96, Math.ceil(maxDistance / stepMeters));
    const daylightFbo = terrain.getFramebuffer('daylight');
    const daylightSize = terrain._fboDaylightTexture.size[0];
    const program = painter.useProgram('daylightPrepare');

    context.bindFramebuffer.set(daylightFbo.framebuffer);
    context.viewport.set([0, 0, daylightSize, daylightSize]);

    context.activeTexture.set(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, terrain._fboElevationTexture.texture);

    program.draw(context, gl.TRIANGLES,
        depthMode, stencilMode, colorMode, CullFaceMode.disabled,
        daylightPrepareUniformValues(
            solarLUT,
            timeWeightMins,
            metersPerPixelX,
            metersPerPixelY,
            atlasBounds,
            elevationAtlasSize,
            maxDistance,
            stepMeters,
            maxSteps
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
            timeWeightMins,
            daylightKey,
            metersPerPixelX,
            metersPerPixelY,
            daylightAtlasSize: daylightSize,
            elevationAtlasSize,
            maxSteps,
            stepMeters,
            maxDistance,
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
        const { lut, weight } = buildSolarLUT(date, center.lat, center.lng);
        const terrain = painter.style.map.terrain as any;
        const atlasBounds = terrain?._elevationAtlasBounds as [number, number, number, number] | undefined;
        if (!atlasBounds) {
            prepareDaylightDuration(painter, layer, lut, weight, 'missing-atlas', painter.getDepthModeForSublayer(0, DepthMode.ReadOnly), StencilMode.disabled, painter.colorModeForRenderPass());
            return;
        }
        const daylightKey = getDaylightCacheKey(date, center.lat, center.lng, atlasBounds);
        const depthMode = painter.getDepthModeForSublayer(0, DepthMode.ReadOnly);
        const colorMode = painter.colorModeForRenderPass();

        prepareDaylightDuration(painter, layer, lut, weight, daylightKey, depthMode, StencilMode.disabled, colorMode);
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
    const daylightKey = getDaylightCacheKey(date, center.lat, center.lng, atlasBounds);
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
            elevationAtlasSize: terrain?._fboElevationTexture?.size?.[0],
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
