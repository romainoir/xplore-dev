import {
    Uniform1i,
    Uniform1f,
    Uniform2f,
    Uniform3f,
    Uniform4f,
    UniformMatrix4f,
    UniformColor
} from '../uniform_binding';
import type { Context } from '../context';
import type { UniformValues, UniformLocations } from '../uniform_binding';
import { type Sky } from '../../style/sky';
import { Color } from '@maplibre/maplibre-gl-style-spec';
import { type Tile } from '../../tile/tile';
import { type Painter } from '../../render/painter';
import { type mat4 } from 'gl-matrix';

export type TerrainPreludeUniformsType = {
    'u_depth': Uniform1i;
    'u_terrain': Uniform1i;
    'u_terrain_dim': Uniform1f;
    'u_terrain_matrix': UniformMatrix4f;
    'u_terrain_unpack': Uniform4f;
    'u_terrain_exaggeration': Uniform1f;
};

export type TerrainUniformsType = {
    'u_texture': Uniform1i;
    'u_ele_delta': Uniform1f;
    'u_fog_matrix': UniformMatrix4f;
    'u_fog_color': UniformColor;
    'u_fog_ground_blend': Uniform1f;
    'u_fog_ground_blend_opacity': Uniform1f;
    'u_horizon_color': UniformColor;
    'u_horizon_fog_blend': Uniform1f;
    'u_is_globe_mode': Uniform1f;
    'u_contour_enabled': Uniform1f;
    'u_contour_interval': Uniform1f;
    'u_contour_color': UniformColor;
    'u_contour_multiplier': Uniform1f;
    'u_zoom': Uniform1f;
    'u_tile_zoom': Uniform1f;
    'u_shadow_atlas': Uniform1i;
    'u_shadow_near_atlas': Uniform1i;
    'u_horizon0': Uniform1i;
    'u_horizon1': Uniform1i;
    'u_horizon2': Uniform1i;
    'u_horizon3': Uniform1i;
    'u_atlas_bounds': Uniform4f;
    'u_near_atlas_bounds': Uniform4f;
    'u_tile_id': Uniform3f;
    'u_shadow_intensity': Uniform1f;
    'u_shadow_near_available': Uniform1f;
    'u_shadow_near_fade': Uniform1f;
    'u_shadow_near_debug_tint': Uniform1f;
    'u_shadow_display_mode': Uniform1f;
    'u_shadow_component_mode': Uniform1f;
    'u_shadow_near_replace_mode': Uniform1f;
    'u_shadow_global_softness': Uniform1f;
    'u_horizon_available': Uniform1f;
    'u_horizon_bins': Uniform1f;
    'u_horizon_edge_softness': Uniform1f;
    'u_horizon_edge_naturalness': Uniform1f;
    'u_debug_mode': Uniform1i;
    'u_cast_shadow_mult': Uniform1f;
    'u_igor_relief_enabled': Uniform1f;
    'u_sun_altitude': Uniform1f;
    'u_sun_direction': Uniform2f;
    'u_dem_ao': Uniform1i;
    'u_dem_ao_dim': Uniform1f;
    'u_dem_ao_unpack': Uniform4f;
    'u_dem_ao_exag': Uniform1f;
    'u_dem_ao_meters_per_pixel': Uniform1f;
    'u_dem_derivative': Uniform1i;
    'u_dem_derivative_available': Uniform1f;
    'u_shadow_atlas_size': Uniform1f;
    'u_shadow_near_atlas_size': Uniform1f;
    'u_self_shadow_mult': Uniform1f;
    'u_contact_shadow_enabled': Uniform1f;
    'u_contact_shadow_strength': Uniform1f;
    'u_contact_shadow_distance': Uniform1f;
    'u_contact_shadow_steps': Uniform1f;
    'u_shadow_white_base': Uniform1f;
};

export type TerrainElevationUniformsType = {
    'u_ele_delta': Uniform1f;
};

export type TerrainDepthUniformsType = {
    'u_ele_delta': Uniform1f;
};

export type TerrainCoordsUniformsType = {
    'u_texture': Uniform1i;
    'u_terrain_coords_id': Uniform1f;
    'u_ele_delta': Uniform1f;
};

const terrainPreludeUniforms = (context: Context, locations: UniformLocations): TerrainPreludeUniformsType => ({
    'u_depth': new Uniform1i(context, locations.u_depth),
    'u_terrain': new Uniform1i(context, locations.u_terrain),
    'u_terrain_dim': new Uniform1f(context, locations.u_terrain_dim),
    'u_terrain_matrix': new UniformMatrix4f(context, locations.u_terrain_matrix),
    'u_terrain_unpack': new Uniform4f(context, locations.u_terrain_unpack),
    'u_terrain_exaggeration': new Uniform1f(context, locations.u_terrain_exaggeration)
});

const terrainUniforms = (context: Context, locations: UniformLocations): TerrainUniformsType => ({
    'u_texture': new Uniform1i(context, locations.u_texture),
    'u_ele_delta': new Uniform1f(context, locations.u_ele_delta),
    'u_fog_matrix': new UniformMatrix4f(context, locations.u_fog_matrix),
    'u_fog_color': new UniformColor(context, locations.u_fog_color),
    'u_fog_ground_blend': new Uniform1f(context, locations.u_fog_ground_blend),
    'u_fog_ground_blend_opacity': new Uniform1f(context, locations.u_fog_ground_blend_opacity),
    'u_horizon_color': new UniformColor(context, locations.u_horizon_color),
    'u_horizon_fog_blend': new Uniform1f(context, locations.u_horizon_fog_blend),
    'u_is_globe_mode': new Uniform1f(context, locations.u_is_globe_mode),
    'u_contour_enabled': new Uniform1f(context, locations.u_contour_enabled),
    'u_contour_interval': new Uniform1f(context, locations.u_contour_interval),
    'u_contour_color': new UniformColor(context, locations.u_contour_color),
    'u_contour_multiplier': new Uniform1f(context, locations.u_contour_multiplier),
    'u_zoom': new Uniform1f(context, locations.u_zoom),
    'u_tile_zoom': new Uniform1f(context, locations.u_tile_zoom),
    'u_shadow_atlas': new Uniform1i(context, locations.u_shadow_atlas),
    'u_shadow_near_atlas': new Uniform1i(context, locations.u_shadow_near_atlas),
    'u_horizon0': new Uniform1i(context, locations.u_horizon0),
    'u_horizon1': new Uniform1i(context, locations.u_horizon1),
    'u_horizon2': new Uniform1i(context, locations.u_horizon2),
    'u_horizon3': new Uniform1i(context, locations.u_horizon3),
    'u_atlas_bounds': new Uniform4f(context, locations.u_atlas_bounds),
    'u_near_atlas_bounds': new Uniform4f(context, locations.u_near_atlas_bounds),
    'u_tile_id': new Uniform3f(context, locations.u_tile_id),
    'u_shadow_intensity': new Uniform1f(context, locations.u_shadow_intensity),
    'u_shadow_near_available': new Uniform1f(context, locations.u_shadow_near_available),
    'u_shadow_near_fade': new Uniform1f(context, locations.u_shadow_near_fade),
    'u_shadow_near_debug_tint': new Uniform1f(context, locations.u_shadow_near_debug_tint),
    'u_shadow_display_mode': new Uniform1f(context, locations.u_shadow_display_mode),
    'u_shadow_component_mode': new Uniform1f(context, locations.u_shadow_component_mode),
    'u_shadow_near_replace_mode': new Uniform1f(context, locations.u_shadow_near_replace_mode),
    'u_shadow_global_softness': new Uniform1f(context, locations.u_shadow_global_softness),
    'u_horizon_available': new Uniform1f(context, locations.u_horizon_available),
    'u_horizon_bins': new Uniform1f(context, locations.u_horizon_bins),
    'u_horizon_edge_softness': new Uniform1f(context, locations.u_horizon_edge_softness),
    'u_horizon_edge_naturalness': new Uniform1f(context, locations.u_horizon_edge_naturalness),
    'u_debug_mode': new Uniform1i(context, locations.u_debug_mode),
    'u_cast_shadow_mult': new Uniform1f(context, locations.u_cast_shadow_mult),
    'u_igor_relief_enabled': new Uniform1f(context, locations.u_igor_relief_enabled),
    'u_sun_altitude': new Uniform1f(context, locations.u_sun_altitude),
    'u_sun_direction': new Uniform2f(context, locations.u_sun_direction),
    'u_dem_ao': new Uniform1i(context, locations.u_dem_ao),
    'u_dem_ao_dim': new Uniform1f(context, locations.u_dem_ao_dim),
    'u_dem_ao_unpack': new Uniform4f(context, locations.u_dem_ao_unpack),
    'u_dem_ao_exag': new Uniform1f(context, locations.u_dem_ao_exag),
    'u_dem_ao_meters_per_pixel': new Uniform1f(context, locations.u_dem_ao_meters_per_pixel),
    'u_dem_derivative': new Uniform1i(context, locations.u_dem_derivative),
    'u_dem_derivative_available': new Uniform1f(context, locations.u_dem_derivative_available),
    'u_shadow_atlas_size': new Uniform1f(context, locations.u_shadow_atlas_size),
    'u_shadow_near_atlas_size': new Uniform1f(context, locations.u_shadow_near_atlas_size),
    'u_self_shadow_mult': new Uniform1f(context, locations.u_self_shadow_mult),
    'u_contact_shadow_enabled': new Uniform1f(context, locations.u_contact_shadow_enabled),
    'u_contact_shadow_strength': new Uniform1f(context, locations.u_contact_shadow_strength),
    'u_contact_shadow_distance': new Uniform1f(context, locations.u_contact_shadow_distance),
    'u_contact_shadow_steps': new Uniform1f(context, locations.u_contact_shadow_steps),
    'u_shadow_white_base': new Uniform1f(context, locations.u_shadow_white_base),
});

const terrainElevationUniforms = (context: Context, locations: UniformLocations): TerrainElevationUniformsType => ({
    'u_ele_delta': new Uniform1f(context, locations.u_ele_delta)
});

const terrainDepthUniforms = (context: Context, locations: UniformLocations): TerrainDepthUniformsType => ({
    'u_ele_delta': new Uniform1f(context, locations.u_ele_delta)
});

const terrainCoordsUniforms = (context: Context, locations: UniformLocations): TerrainCoordsUniformsType => ({
    'u_texture': new Uniform1i(context, locations.u_texture),
    'u_terrain_coords_id': new Uniform1f(context, locations.u_terrain_coords_id),
    'u_ele_delta': new Uniform1f(context, locations.u_ele_delta)
});

function imageryLayerEnabled(id: string): boolean {
    if (typeof window === 'undefined') return false;
    const state = (window as any).imageryState?.get?.(id);
    return !!(state?.enabled && (state.opacity ?? 1) > 0);
}

function getActiveShadowLayer(painter?: Painter | null, zoom: number = 0): any | null {
    const candidates: Array<[string, string]> = [
        ['shadow-v3', 'shadow-v3-coarse']
    ];

    for (const [stateId, layerId] of candidates) {
        if (!imageryLayerEnabled(stateId)) continue;
        const layer = painter?.style?.getLayer(layerId) as any;
        if (layer && !layer.isHidden(zoom)) return layer;
    }

    return null;
}

const terrainUniformValues = (
    eleDelta: number,
    fogMatrix: mat4,
    sky: Sky,
    pitch: number,
    isGlobeMode: boolean,
    zoom: number = 0,
    painter?: Painter | null,
    tile?: Tile | null): UniformValues<TerrainUniformsType> => {

    const activeShadowLayer = getActiveShadowLayer(painter, zoom);

    // Contour defaults — always on unless explicitly disabled
    let contourEnabled = activeShadowLayer ? 0.0 : 1.0;
    if (typeof window !== 'undefined' && (window as any).imageryState) {
        const cs = (window as any).imageryState.get('contours');
        if (cs && cs.enabled === false) contourEnabled = 0.0;
    }
    let contourInterval = 10.0;
    let contourMultiplier = 1.0;
    let contourColor = Color.parse('rgba(139,90,43,0.2)');

    // Read config from app-side globals
    if (typeof window !== 'undefined' && (window as any).contourConfig) {
        const config = (window as any).contourConfig;
        if (config.interval !== undefined) contourInterval = config.interval;
        if (config.color !== undefined) contourColor = Color.parse(config.color);
        if (config.multiplier !== undefined) contourMultiplier = config.multiplier;
    }

    // Zoom-based interval selection from thresholds
    if (typeof window !== 'undefined' && (window as any).contourThresholds) {
        const thresholds = (window as any).contourThresholds;
        let bestZoom = -1;
        for (const z in thresholds) {
            const pz = parseInt(z);
            if (pz <= zoom && pz > bestZoom) {
                bestZoom = pz;
            }
        }
        if (bestZoom !== -1) {
            contourInterval = thresholds[bestZoom][0];
        }
    }

    const activeShadowIsV3 = activeShadowLayer?.id === 'shadow-v3-coarse';
    const contactBlockedByInteraction = !!painter?.options?.moving ||
        !!painter?.options?.rotating ||
        (typeof window !== 'undefined' && ((window as any)._isInteractingWithTime === true || (window as any)._shadowProgressivePhase === 'preview'));
    const v3ContactEnabled = activeShadowIsV3 &&
        !contactBlockedByInteraction &&
        typeof window !== 'undefined' &&
        (window as any)._shadowV3ContactShadows === true;

    return {
        'u_texture': 0,
        'u_ele_delta': eleDelta,
        'u_fog_matrix': fogMatrix,
        'u_fog_color': sky ? sky.properties.get('fog-color') : Color.white,
        'u_fog_ground_blend': sky ? sky.properties.get('fog-ground-blend') : 1,
        'u_fog_ground_blend_opacity': isGlobeMode ? 0 : (sky ? sky.calculateFogBlendOpacity(pitch) : 0),
        'u_horizon_color': sky ? sky.properties.get('horizon-color') : Color.white,
        'u_horizon_fog_blend': sky ? sky.properties.get('horizon-fog-blend') : 1,
        'u_is_globe_mode': isGlobeMode ? 1 : 0,
        'u_contour_enabled': contourEnabled,
        'u_contour_interval': contourInterval,
        'u_contour_multiplier': contourMultiplier,
        'u_contour_color': contourColor,
        'u_zoom': zoom,
        'u_tile_zoom': 0,
        'u_shadow_atlas': 15, // Bind shadow atlas to unit 15
        'u_shadow_near_atlas': 14,
        'u_horizon0': 8,
        'u_horizon1': 9,
        'u_horizon2': 10,
        'u_horizon3': 11,
        'u_atlas_bounds': (painter?.style?.map?.terrain as any)?._elevationAtlasBounds || [0, 0, 1, 1],
        'u_near_atlas_bounds': (painter?.style?.map?.terrain as any)?._shadowNearAtlasBounds || [0, 0, 1, 1],
        'u_tile_id': tile ? [tile.tileID.canonical.z, tile.tileID.canonical.x, tile.tileID.canonical.y] : [0, 0, 0],
        'u_shadow_intensity': (() => {
            if (!activeShadowLayer || activeShadowLayer.isHidden(zoom)) return 0.0;
            const opacity = activeShadowLayer.getPaintProperty('shadow-opacity');
            return typeof opacity === 'number' ? opacity : 1.0;
        })(),
        'u_shadow_near_available': (() => {
            const terrain = painter?.style?.map?.terrain as any;
            const hidingStaleTimeNear = terrain?._shadowNearAtlasStale === true &&
                terrain?._shadowNearAtlasStaleReason === 'time';
            return terrain?._shadowNearAtlasReady && terrain?._fboNearShadowTexture && !hidingStaleTimeNear ? 1.0 : 0.0;
        })(),
        'u_shadow_near_fade': (() => {
            const map = painter?.style?.map as any;
            const terrain = map?.terrain as any;
            const hidingStaleTimeNear = terrain?._shadowNearAtlasStale === true &&
                terrain?._shadowNearAtlasStaleReason === 'time';
            if (!terrain?._shadowNearAtlasReady || !terrain?._fboNearShadowTexture || hidingStaleTimeNear) return 0.0;
            const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
            const start = Number.isFinite(terrain._shadowNearAtlasReadyAt) ? terrain._shadowNearAtlasReadyAt : now;
            const duration = typeof window !== 'undefined' && Number.isFinite((window as any)._shadowV3NearFadeMs) ?
                Math.max(120, (window as any)._shadowV3NearFadeMs) :
                1200;
            const fade = Math.max(0, Math.min(1, (now - start) / duration));
            if (fade < 1 && !terrain._shadowNearFadeRepaintQueued) {
                terrain._shadowNearFadeRepaintQueued = true;
                const schedule = typeof window !== 'undefined' && window.requestAnimationFrame ?
                    window.requestAnimationFrame.bind(window) :
                    (callback: FrameRequestCallback) => setTimeout(() => callback(now), 16) as any;
                schedule(() => {
                    terrain._shadowNearFadeRepaintQueued = false;
                    map?.triggerRepaint?.();
                });
            }
            return fade;
        })(),
        'u_shadow_near_debug_tint': (typeof window !== 'undefined' && (window as any)._shadowNearDebugTint === true) ? 1.0 : 0.0,
        'u_shadow_display_mode': activeShadowLayer ? 1.0 : 0.0,
        'u_shadow_component_mode': (() => {
            if (!activeShadowIsV3 || typeof window === 'undefined') return 0.0;
            const mode = (window as any)._shadowV3ComponentMode;
            if (mode === 'global') return 1.0;
            if (mode === 'near') return 2.0;
            if (mode === 'self') return 3.0;
            return 0.0;
        })(),
        'u_shadow_near_replace_mode': activeShadowIsV3 &&
            (typeof window === 'undefined' || (window as any)._shadowV3NearReplace !== false) ? 1.0 : 0.0,
        'u_shadow_global_softness': activeShadowIsV3 &&
            typeof window !== 'undefined' &&
            Number.isFinite((window as any)._shadowV3GlobalSoftness) ?
            Math.max(1.0, Math.min(3.0, (window as any)._shadowV3GlobalSoftness)) :
            activeShadowIsV3 ? 1.55 : 1.0,
        'u_horizon_available': (() => {
            if (typeof window === 'undefined' || (window as any)._shadowUseHorizonCurrent !== true) return 0.0;
            const terrain = painter?.style?.map?.terrain as any;
            return terrain?._horizonAtlasReady && terrain?._fboHorizon0Texture && terrain?._fboHorizon1Texture ? 1.0 : 0.0;
        })(),
        'u_horizon_bins': (typeof window !== 'undefined' && (window as any)._horizonDirectionBins) ? (window as any)._horizonDirectionBins : 16.0,
        'u_horizon_edge_softness': (typeof window !== 'undefined' && (window as any)._horizonEdgeSoftness !== undefined) ? (window as any)._horizonEdgeSoftness : 1.0,
        'u_horizon_edge_naturalness': (typeof window !== 'undefined' && (window as any)._horizonEdgeNaturalness !== undefined) ? (window as any)._horizonEdgeNaturalness : 0.0,
        'u_debug_mode': (typeof window !== 'undefined' && (window as any)._shadowDebugMode) ? (window as any)._shadowDebugMode : 0,
        'u_cast_shadow_mult': (typeof window !== 'undefined' && (window as any)._castShadowMult !== undefined) ? (window as any)._castShadowMult : 1.8,
        'u_igor_relief_enabled': (() => {
            if (typeof window !== 'undefined') {
                const imageryState = (window as any).imageryState;
                const shadowEnabled = imageryState?.get?.('shadow-v3')?.enabled === true;
                return shadowEnabled ? 1.0 : 0.0;
            }
            return 0.0;
        })(),
        'u_sun_altitude': (() => {
            if (typeof window !== 'undefined' && (window as any)._actualSunAltitudeRad !== undefined) {
                return (window as any)._actualSunAltitudeRad;
            }
            return activeShadowLayer?.getShadowProperties ? activeShadowLayer.getShadowProperties().altitudeRadians : 0.5;
        })(),
        'u_sun_direction': (() => {
            if (activeShadowIsV3 && typeof window !== 'undefined') {
                const sunDirection = (window as any)._shadowSunDirection;
                if (Array.isArray(sunDirection) && sunDirection.length >= 2 &&
                    Number.isFinite(sunDirection[0]) && Number.isFinite(sunDirection[1])) {
                    return [sunDirection[0], sunDirection[1]];
                }
            }
            if (!activeShadowLayer?.getShadowProperties) return [0.707, -0.707];
            const dir = activeShadowLayer.getShadowProperties().directionRadians;
            return [Math.sin(dir), -Math.cos(dir)];
        })(),
        'u_dem_ao': 13, // Per-tile DEM texture at unit 13 for full-res AO
        'u_dem_ao_dim': 514.0,  // Default, overridden per-tile in drawTerrain
        'u_dem_ao_unpack': [6553.6, 25.6, 0.1, 10000.0], // Default Mapbox DEM unpack
        'u_dem_ao_exag': 1.3, // Default, overridden per-tile in drawTerrain
        'u_dem_ao_meters_per_pixel': 40075016.7 / (512 * Math.pow(2, tile ? tile.tileID.canonical.z : zoom)),
        'u_dem_derivative': 12,
        'u_dem_derivative_available': 0,
        'u_shadow_atlas_size': (painter?.style?.map?.terrain as any)?._fboShadowTexture?.size?.[0] || 2048.0,
        'u_shadow_near_atlas_size': (painter?.style?.map?.terrain as any)?._fboNearShadowTexture?.size?.[0] || 1024.0,
        'u_self_shadow_mult': (typeof window !== 'undefined' && (window as any)._selfShadowMult !== undefined) ? (window as any)._selfShadowMult : 1.8,
        'u_contact_shadow_enabled': v3ContactEnabled ? 1.0 : 0.0,
        'u_contact_shadow_strength': (typeof window !== 'undefined' && Number.isFinite((window as any)._shadowV3ContactStrength)) ? (window as any)._shadowV3ContactStrength : 0.72,
        'u_contact_shadow_distance': (typeof window !== 'undefined' && Number.isFinite((window as any)._shadowV3ContactDistance)) ? (window as any)._shadowV3ContactDistance : 520.0,
        'u_contact_shadow_steps': (typeof window !== 'undefined' && Number.isFinite((window as any)._shadowV3ContactSteps)) ? (window as any)._shadowV3ContactSteps : 10.0,
        'u_shadow_white_base': 0.0,
    };
};

const terrainElevationUniformValues = (
    eleDelta: number
): UniformValues<TerrainElevationUniformsType> => ({
    'u_ele_delta': eleDelta
});

const terrainDepthUniformValues = (
    eleDelta: number
): UniformValues<TerrainDepthUniformsType> => ({
    'u_ele_delta': eleDelta
});

const terrainCoordsUniformValues = (
    coordsId: number,
    eleDelta: number
): UniformValues<TerrainCoordsUniformsType> => ({
    'u_terrain_coords_id': coordsId / 255,
    'u_texture': 0,
    'u_ele_delta': eleDelta
});

export { terrainUniforms, terrainDepthUniforms, terrainElevationUniforms, terrainCoordsUniforms, terrainPreludeUniforms, terrainUniformValues, terrainDepthUniformValues, terrainElevationUniformValues, terrainCoordsUniformValues };
