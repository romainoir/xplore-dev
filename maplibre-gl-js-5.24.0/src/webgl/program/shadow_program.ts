import {
    Uniform1i,
    Uniform1f,
    Uniform2f,
    Uniform3f,
    Uniform4f,
} from '../uniform_binding';

import type { Context } from '../context';
import type { UniformValues, UniformLocations } from '../uniform_binding';
import type { Tile } from '../../tile/tile';
import type { Painter } from '../../render/painter';
import type { ShadowStyleLayer } from '../../style/style_layer/shadow_style_layer';
import { Terrain } from '../../render/terrain';

export type ShadowGlobalUniformsType = {
    'u_image': Uniform1i;
    'u_sunDirection': Uniform2f;
    'u_sunAltitude': Uniform1f;
    'u_metersPerPixel': Uniform2f;
    'u_dimension': Uniform2f;
    'u_atlas_bounds': Uniform4f;
    'u_inv_proj_matrix': Uniform2f; // Dummy or specific inverse projection if needed
    'u_max_steps': Uniform1f;
    'u_step_meters': Uniform1f;
    'u_max_distance': Uniform1f;
};

export type ShadowUniformsType = {
    'u_image': Uniform1i;
    'u_image_raw': Uniform1i;
    'u_neigh_lat': Uniform1i;
    'u_neigh_long': Uniform1i;
    'u_neigh_diag': Uniform1i;

    'u_neigh_zoom_lat': Uniform4f;
    'u_neigh_zoom_long': Uniform4f;
    'u_neigh_zoom_diag': Uniform4f;
    'u_neigh_offsets': Uniform2f;

    'u_grandparent_dem': Uniform1i;
    'u_grandparent_zoom': Uniform4f;
    'u_gp_neigh_lat': Uniform1i;
    'u_gp_neigh_long': Uniform1i;
    'u_gp_neigh_diag': Uniform1i;
    'u_gp_neigh_zoom_lat': Uniform4f;
    'u_gp_neigh_zoom_long': Uniform4f;
    'u_gp_neigh_zoom_diag': Uniform4f;
    'u_dimension': Uniform2f;
    'u_unpack': Uniform4f;
    'u_metersPerPixel': Uniform1f;
    'u_sunDirection': Uniform2f;
    'u_sunAltitude': Uniform1f;
    'u_shadowOpacity': Uniform1f;
    'u_shadowMaxDistance': Uniform1f;
    'u_shadowColor': Uniform4f;
    'u_shadow_penumbra': Uniform1f;
    'u_shadow_shadow_color': Uniform4f;
    'u_shadow_highlight_color': Uniform4f;
    'u_tile_id': Uniform3f;

    // Copy 18 Raymarching Tuning Parameters
    'u_shadow_step_size': Uniform1f;
    'u_shadow_max_steps': Uniform1f;
    'u_shadow_acceleration': Uniform1f;
    'u_shadow_max_dist_c': Uniform1f;

    // Debug Mode
    'u_debug_mode': Uniform1i;
    'u_shadow_mode': Uniform1i;
};

export type ShadowBlurUniformsType = {
    'u_image': Uniform1i;
    'u_direction': Uniform2f;
    'u_texture_size': Uniform1f;
};

const shadowGlobalUniforms = (context: Context, locations: UniformLocations): ShadowGlobalUniformsType => ({
    'u_image': new Uniform1i(context, locations.u_image),
    'u_sunDirection': new Uniform2f(context, locations.u_sunDirection),
    'u_sunAltitude': new Uniform1f(context, locations.u_sunAltitude),
    'u_metersPerPixel': new Uniform2f(context, locations.u_metersPerPixel),
    'u_dimension': new Uniform2f(context, locations.u_dimension),
    'u_atlas_bounds': new Uniform4f(context, locations.u_atlas_bounds),
    'u_inv_proj_matrix': new Uniform2f(context, locations.u_inv_proj_matrix),
    'u_max_steps': new Uniform1f(context, locations.u_max_steps),
    'u_step_meters': new Uniform1f(context, locations.u_step_meters),
    'u_max_distance': new Uniform1f(context, locations.u_max_distance),
});

const shadowUniforms = (context: Context, locations: UniformLocations): ShadowUniformsType => ({
    'u_image': new Uniform1i(context, locations.u_image),
    'u_image_raw': new Uniform1i(context, locations.u_image_raw),
    'u_neigh_lat': new Uniform1i(context, locations.u_neigh_lat),
    'u_neigh_long': new Uniform1i(context, locations.u_neigh_long),
    'u_neigh_diag': new Uniform1i(context, locations.u_neigh_diag),

    'u_neigh_zoom_lat': new Uniform4f(context, locations.u_neigh_zoom_lat),
    'u_neigh_zoom_long': new Uniform4f(context, locations.u_neigh_zoom_long),
    'u_neigh_zoom_diag': new Uniform4f(context, locations.u_neigh_zoom_diag),
    'u_neigh_offsets': new Uniform2f(context, locations.u_neigh_offsets),

    'u_grandparent_dem': new Uniform1i(context, locations.u_grandparent_dem),
    'u_grandparent_zoom': new Uniform4f(context, locations.u_grandparent_zoom),
    'u_gp_neigh_lat': new Uniform1i(context, locations.u_gp_neigh_lat),
    'u_gp_neigh_long': new Uniform1i(context, locations.u_gp_neigh_long),
    'u_gp_neigh_diag': new Uniform1i(context, locations.u_gp_neigh_diag),
    'u_gp_neigh_zoom_lat': new Uniform4f(context, locations.u_gp_neigh_zoom_lat),
    'u_gp_neigh_zoom_long': new Uniform4f(context, locations.u_gp_neigh_zoom_long),
    'u_gp_neigh_zoom_diag': new Uniform4f(context, locations.u_gp_neigh_zoom_diag),
    'u_dimension': new Uniform2f(context, locations.u_dimension),
    'u_unpack': new Uniform4f(context, locations.u_unpack),
    'u_metersPerPixel': new Uniform1f(context, locations.u_metersPerPixel),
    'u_sunDirection': new Uniform2f(context, locations.u_sunDirection),
    'u_sunAltitude': new Uniform1f(context, locations.u_sunAltitude),
    'u_shadowOpacity': new Uniform1f(context, locations.u_shadowOpacity),
    'u_shadowMaxDistance': new Uniform1f(context, locations.u_shadowMaxDistance),
    'u_shadowColor': new Uniform4f(context, locations.u_shadowColor),
    'u_shadow_penumbra': new Uniform1f(context, locations.u_shadow_penumbra),
    'u_shadow_shadow_color': new Uniform4f(context, locations.u_shadow_shadow_color),
    'u_shadow_highlight_color': new Uniform4f(context, locations.u_shadow_highlight_color),
    'u_tile_id': new Uniform3f(context, locations.u_tile_id),

    // Copy 18 Raymarching Tuning Parameters
    'u_shadow_step_size': new Uniform1f(context, locations.u_shadow_step_size),
    'u_shadow_max_steps': new Uniform1f(context, locations.u_shadow_max_steps),
    'u_shadow_acceleration': new Uniform1f(context, locations.u_shadow_acceleration),
    'u_shadow_max_dist_c': new Uniform1f(context, locations.u_shadow_max_dist_c),

    // Debug Mode
    'u_debug_mode': new Uniform1i(context, locations.u_debug_mode),
    'u_shadow_mode': new Uniform1i(context, locations.u_shadow_mode),
});

const shadowBlurUniforms = (context: Context, locations: UniformLocations): ShadowBlurUniformsType => ({
    'u_image': new Uniform1i(context, locations.u_image),
    'u_direction': new Uniform2f(context, locations.u_direction),
    'u_texture_size': new Uniform1f(context, locations.u_texture_size),
});

const shadowUniformValues = (
    painter: Painter,
    tile: Tile,
    layer: ShadowStyleLayer,
    neighborZoomInfos: Array<[number, number, number, number]>,
    grandparentZoomConfig: [number, number, number, number] | null,
    gpNeighborZoomInfos: Array<[number, number, number, number]>
): UniformValues<ShadowUniformsType> => {
    const tileSize = 512;
    const worldCircumference = 40075016.7;
    const zoom = tile.tileID.canonical.z;
    const metersPerPixel = worldCircumference / (tileSize * Math.pow(2, zoom));

    const shadowProps = layer.getShadowProperties();
    const dirRad = shadowProps.directionRadians;
    const altRad = shadowProps.altitudeRadians;

    // Convert geographic azimuth to UV-space direction
    const dirX = Math.sin(dirRad);
    const dirY = -Math.cos(dirRad);

    const opacity = (layer.paint.get('shadow-opacity') as number) ?? 0.5;
    const maxDistance = shadowProps.maxDistance;
    const color = layer.paint.get('shadow-color');
    const penumbra = layer.paint.get('shadow-penumbra');
    const shadowColor = layer.paint.get('shadow-shadow-color');
    const highlightColor = layer.paint.get('shadow-highlight-color');

    // Crisp Raymarching Interpolation logic for Zoom Levels
    let stepSizePixels = 1.0;
    let maxSteps = 256.0;
    let acceleration = 0.0;
    let maxDistC = 1500.0;

    if (zoom <= 12) {
        stepSizePixels = 1.0;
        maxSteps = 256.0;
        acceleration = 0.0;
        maxDistC = 1500.0;
    } else if (zoom >= 18) {
        stepSizePixels = 0.125;
        maxSteps = 256.0;
        acceleration = 0.0;
        maxDistC = 400.0;
    } else if (zoom < 14) {
        const t = (zoom - 12) / 2.0; // 12 to 14
        stepSizePixels = 1.0 * (1 - t) + 0.5 * t;
        maxSteps = 256.0;
        acceleration = 0.0;
        maxDistC = 1500.0 * (1 - t) + 1200.0 * t;
    } else if (zoom < 16) {
        const t = (zoom - 14) / 2.0; // 14 to 16
        stepSizePixels = 0.5 * (1 - t) + 0.25 * t;
        maxSteps = 256.0;
        acceleration = 0.0;
        maxDistC = 1200.0 * (1 - t) + 800.0 * t;
    } else {
        const t = (zoom - 16) / 2.0; // 16 to 18
        stepSizePixels = 0.25 * (1 - t) + 0.125 * t;
        maxSteps = 256.0;
        acceleration = 0.0;
        maxDistC = 800.0 * (1 - t) + 400.0 * t;
    }

    // POC Tuning Overrides (applied first)
    if (typeof window !== 'undefined') {
        if ((window as any)._shadowStepSize !== undefined) {
            stepSizePixels = (window as any)._shadowStepSize;
        }
        if ((window as any)._shadowMaxSteps !== undefined) {
            maxSteps = (window as any)._shadowMaxSteps;
        }
    }

    // Dynamic Shadow Quality (overrides POC to guarantee FPS)
    // Drop raymarch steps significantly while panning or scrubbing time to maintain 60 FPS
    const isMapMoving = painter.options.moving;
    const isTimeSliding = typeof window !== 'undefined' && (window as any)._isInteractingWithTime;
    const isInteracting = isMapMoving || isTimeSliding;

    if (isInteracting) {
        // We MUST increase the step size dramatically, otherwise the ray terminates inches away from the pixel
        // and fails to hit distant mountains entirely!
        const targetSteps = 8.0; // Extremely low steps for obvious interaction diff
        const scaleFactor = maxSteps / targetSteps;
        maxSteps = targetSteps;
        stepSizePixels = Math.max(stepSizePixels * scaleFactor, 16.0); // Large step
    }

    // Shadow Mode Optimization: 0 = Cast (Standard), 1 = Fast (Local only, no neighbors)
    // For the POC, we look for 'fast' or 'detail' in the layer ID
    const shadowMode = (layer.id.toLowerCase().indexOf('fast') !== -1 || layer.id.toLowerCase().indexOf('detail') !== -1) ? 1 : 0;

    return {
        'u_image': 0,
        'u_image_raw': 1,
        'u_neigh_lat': 4,
        'u_neigh_long': 5,
        'u_neigh_diag': 6,

        'u_neigh_zoom_lat': neighborZoomInfos[0],
        'u_neigh_zoom_long': neighborZoomInfos[1],
        'u_neigh_zoom_diag': neighborZoomInfos[2],
        'u_neigh_offsets': [dirX >= 0 ? 1 : -1, dirY >= 0 ? 1 : -1],

        'u_grandparent_dem': 12,
        'u_grandparent_zoom': grandparentZoomConfig || [0, 0, 0, 0],
        'u_gp_neigh_lat': 13,
        'u_gp_neigh_long': 14,
        'u_gp_neigh_diag': 15,
        'u_gp_neigh_zoom_lat': gpNeighborZoomInfos[0],
        'u_gp_neigh_zoom_long': gpNeighborZoomInfos[1],
        'u_gp_neigh_zoom_diag': gpNeighborZoomInfos[2],
        'u_dimension': tile.dem ? [tile.dem.stride, tile.dem.stride] : [514, 514],
        'u_unpack': tile.dem ? tile.dem.getUnpackVector() : [0, 0, 0, 0],
        'u_metersPerPixel': metersPerPixel,
        'u_sunDirection': [dirX, dirY],
        'u_sunAltitude': altRad,
        'u_shadowOpacity': opacity,
        'u_shadowMaxDistance': maxDistance,
        'u_shadowColor': [color.r, color.g, color.b, color.a],
        'u_shadow_penumbra': penumbra,
        'u_shadow_shadow_color': [shadowColor.r, shadowColor.g, shadowColor.b, shadowColor.a],
        'u_shadow_highlight_color': [highlightColor.r, highlightColor.g, highlightColor.b, highlightColor.a],
        'u_tile_id': [tile.tileID.canonical.z, tile.tileID.canonical.x, tile.tileID.canonical.y],

        // Copy 18 Tuning
        'u_shadow_step_size': stepSizePixels,
        'u_shadow_max_steps': maxSteps,
        'u_shadow_acceleration': acceleration,
        'u_shadow_max_dist_c': maxDistC,

        // Debug Mode (reads from browser window in Main Thread)
        'u_debug_mode': (typeof window !== 'undefined' && (window as any)._shadowDebugMode) ? (window as any)._shadowDebugMode : 0,
        'u_shadow_mode': shadowMode,
    };
};

const shadowGlobalUniformValues = (
    painter: Painter,
    layer: ShadowStyleLayer,
    metersPerPixelX: number,
    metersPerPixelY: number
): UniformValues<ShadowGlobalUniformsType> => {
    const terrain = painter.style.map.terrain;
    const atlasBounds = (terrain as any)?._elevationAtlasBounds || [0, 0, 1, 1];

    const shadowProps = layer.getShadowProperties();
    const dirRad = shadowProps.directionRadians;
    const altRad = shadowProps.altitudeRadians;
    const dirX = Math.sin(dirRad);
    const dirY = -Math.cos(dirRad);
    const maxDistance = Math.max(1000, shadowProps.maxDistance || 5000);

    const isMapMoving = painter.options.moving;
    const isTimeSliding = typeof window !== 'undefined' && (window as any)._isInteractingWithTime;
    const progressivePhase = typeof window !== 'undefined' ? (window as any)._shadowProgressivePhase : '';
    const isProgressivePreview = progressivePhase === 'preview';

    const atlasGsd = Math.max(metersPerPixelX, metersPerPixelY);
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
    const passMaxDistance = isProgressivePreview ? Math.min(maxDistance, 4200.0) : maxDistance;

    const qualityScale = isProgressivePreview ? 6.0 : isTimeSliding ? 5.0 : isMapMoving ? 3.0 : 1.25;
    const maxPreviewStep = isProgressivePreview ? 128.0 : isTimeSliding ? 96.0 : isMapMoving ? 56.0 : 18.0;
    const minPreviewSteps = isProgressivePreview ? 18.0 : isTimeSliding ? 24.0 : isMapMoving ? 48.0 : 96.0;
    const maxPreviewSteps = isProgressivePreview ? 56.0 : isTimeSliding ? 80.0 : isMapMoving ? 160.0 : 384.0;

    let stepMeters = clamp(atlasGsd * qualityScale, isProgressivePreview ? 28.0 : isTimeSliding ? 18.0 : isMapMoving ? 10.0 : 5.0, maxPreviewStep);
    const nearDistance = Math.min(isProgressivePreview ? 700.0 : 1100.0, passMaxDistance);
    const midDistance = Math.min(isProgressivePreview ? 2200.0 : 3500.0, passMaxDistance);
    const estimatedSteps =
        nearDistance / stepMeters +
        Math.max(0, midDistance - nearDistance) / (stepMeters * 2.75) +
        Math.max(0, passMaxDistance - midDistance) / (stepMeters * 7.0);
    let maxSteps = clamp(Math.ceil(estimatedSteps) + 8.0, minPreviewSteps, maxPreviewSteps);

    if (typeof window !== 'undefined') {
        (window as any)._shadowAutoQuality = {
            atlasGsd,
            stepMeters,
            maxSteps,
            maxDistance: passMaxDistance,
            cascades: [nearDistance, midDistance, passMaxDistance],
            progressivePhase: isProgressivePreview ? 'preview' : progressivePhase === 'full' ? 'full' : 'stable',
            interacting: isMapMoving || isTimeSliding || isProgressivePreview,
            timeSliding: isTimeSliding
        };
    }

    return {
        'u_image': 0,
        'u_sunDirection': [dirX, dirY],
        'u_sunAltitude': altRad,
        'u_metersPerPixel': [metersPerPixelX, metersPerPixelY],
        'u_dimension': [Terrain.ATLAS_SIZE, Terrain.ATLAS_SIZE],
        'u_atlas_bounds': atlasBounds,
        'u_inv_proj_matrix': [0, 0], // Map to atlas using bounds instead
        'u_max_steps': maxSteps,
        'u_step_meters': stepMeters,
        'u_max_distance': passMaxDistance,
    };
};

export {
    shadowUniforms,
    shadowUniformValues,
    shadowGlobalUniforms,
    shadowGlobalUniformValues,
    shadowBlurUniforms
};
