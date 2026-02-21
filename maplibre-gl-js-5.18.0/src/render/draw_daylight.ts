import { StencilMode } from '../gl/stencil_mode';
import { DepthMode } from '../gl/depth_mode';
import { CullFaceMode } from '../gl/cull_face_mode';
import { daylightUniformValues } from './program/daylight_program';
import { Texture } from './texture';
import { prepareShadow } from './draw_shadow';

// Using SunCalc to generate solar positions
import SunCalc from 'suncalc';

import type { Painter, RenderOptions } from './painter';
import type { TileManager } from '../tile/tile_manager';
import type { DaylightStyleLayer } from '../style/style_layer/daylight_style_layer';
import type { OverscaledTileID } from '../tile/tile_id';
import type { Tile } from '../tile/tile';
import type { Context } from '../gl/context';

// Cache the solar LUT so we only rebuild it once per day/location change
let cachedDateStr = '';
let cachedCenterLat = 0;
let cachedCenterLng = 0;
let cachedSolarLUT = new Float32Array(32); // 32 floats (16 vec2s)
let cachedTimeWeightMins = 0;

/**
 * Builds a 16-step solar lookup table (LUT) for the given day and location.
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
    const lut = new Float32Array(32);
    let weight = 0;

    if (sunrise && sunset && !isNaN(sunrise.getTime()) && !isNaN(sunset.getTime())) {
        const daylightDurationMs = sunset.getTime() - sunrise.getTime();
        const daylightMins = daylightDurationMs / 60000;

        // We evaluate 16 positions across the daylight hours
        const steps = 16;
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

export function drawDaylight(
    painter: Painter,
    tileManager: TileManager,
    layer: DaylightStyleLayer,
    tileIDs: Array<OverscaledTileID>,
    renderOptions: RenderOptions // eslint-disable-line
) {
    if (painter.renderPass !== 'offscreen' && painter.renderPass !== 'translucent') return;

    if (painter.renderPass === 'offscreen') {
        // console.warn(`[drawDaylight] offscreen pass for ${tileIDs.length} tiles`);
        prepareShadow(painter, tileManager, tileIDs, layer as any, painter.getDepthModeForSublayer(0, DepthMode.ReadOnly), StencilMode.disabled, painter.colorModeForRenderPass());
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

    // Get current map center and a date (use today if no property is provided)
    const center = painter.transform.center;
    // For now, default to today. In the future this could be reading a `daylight-date` property.
    const date = new Date();

    // Build the Solar LUT for the day
    const { lut, weight } = buildSolarLUT(date, center.lat, center.lng);

    for (const coord of coords) {
        const tile = tileManager.getTile(coord);

        // Daylight relies on the H4 Horizon Atlas built by the shadow layer.
        // If it's not ready or doesn't exist, skip rendering daylight for this tile.
        if (!tile.horizonTexture) {
            console.warn(`[drawDaylight] missing horizonTexture for tile ${coord.canonical}`);
            continue;
        }

        const colorRampTexture = getColorRampTexture(context, layer);
        if (!colorRampTexture) {
            console.warn(`[drawDaylight] missing colorRampTexture`);
            continue;
        }

        const program = painter.useProgram('daylight');

        // Bind the Horizon Atlas to unit 0
        context.activeTexture.set(gl.TEXTURE0);
        tile.horizonTexture.bind(gl.LINEAR, gl.CLAMP_TO_EDGE);

        // Bind the Custom Color Ramp to unit 1
        context.activeTexture.set(gl.TEXTURE1);
        if (colorRampTexture) {
            colorRampTexture.bind(gl.LINEAR, gl.CLAMP_TO_EDGE);
        }

        const useSubdivision = projection.useSubdivision;
        const useBorder = useSubdivision && !!context.extTextureFilterAnisotropic;

        const mesh = projection.getMeshFromTileID(context, coord.canonical, useBorder, true, 'raster');

        // Pass 32 floats (16 samples) directly into the uniform locations
        const uniformValues = daylightUniformValues(
            painter, tile, layer,
            lut, weight
        );

        const projectionData = painter.transform.getProjectionData({
            overscaledTileID: coord,
            aligned: false,
            applyGlobeMatrix: false,
            applyTerrainMatrix: true
        });

        const terrainData = painter.style.map.terrain?.getTerrainData(coord);

        program.draw(context, gl.TRIANGLES, depthMode, stencil[coord.overscaledZ], colorMode, CullFaceMode.backCCW,
            uniformValues, terrainData, projectionData, layer.id, mesh.vertexBuffer, mesh.indexBuffer, mesh.segments);
    }
}

function getColorRampTexture(context: Context, layer: DaylightStyleLayer): Texture | null {
    if (!layer.colorRamp) return null;
    if (!layer.colorRampTexture) {
        layer.colorRampTexture = new Texture(context, layer.colorRamp, context.gl.RGBA);
    }
    return layer.colorRampTexture;
}
