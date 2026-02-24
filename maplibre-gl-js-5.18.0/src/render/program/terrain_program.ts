import {
    Uniform1i,
    Uniform1f,
    Uniform2f,
    Uniform3f,
    Uniform4f,
    UniformMatrix4f,
    UniformColor
} from '../uniform_binding';
import type { Context } from '../../gl/context';
import type { UniformValues, UniformLocations } from '../../render/uniform_binding';
import { type Sky } from '../../style/sky';
import { Color } from '@maplibre/maplibre-gl-style-spec';
import { type Tile } from '../../tile/tile';
import { type Painter } from '../painter';
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
    'u_atlas_bounds': Uniform4f;
    'u_tile_id': Uniform3f;
    'u_shadow_intensity': Uniform1f;
    'u_debug_mode': Uniform1i;
    'u_sun_altitude': Uniform1f;
    'u_sun_direction': Uniform2f;
    'u_dem_ao': Uniform1i;
    'u_dem_ao_dim': Uniform1f;
    'u_dem_ao_unpack': Uniform4f;
    'u_dem_ao_exag': Uniform1f;
    'u_elevation_atlas': Uniform1i;
    'u_metersPerPixel': Uniform1f;
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
    'u_atlas_bounds': new Uniform4f(context, locations.u_atlas_bounds),
    'u_tile_id': new Uniform3f(context, locations.u_tile_id),
    'u_shadow_intensity': new Uniform1f(context, locations.u_shadow_intensity),
    'u_debug_mode': new Uniform1i(context, locations.u_debug_mode),
    'u_sun_altitude': new Uniform1f(context, locations.u_sun_altitude),
    'u_sun_direction': new Uniform2f(context, locations.u_sun_direction),
    'u_dem_ao': new Uniform1i(context, locations.u_dem_ao),
    'u_dem_ao_dim': new Uniform1f(context, locations.u_dem_ao_dim),
    'u_dem_ao_unpack': new Uniform4f(context, locations.u_dem_ao_unpack),
    'u_dem_ao_exag': new Uniform1f(context, locations.u_dem_ao_exag),
    'u_elevation_atlas': new Uniform1i(context, locations.u_elevation_atlas),
    'u_metersPerPixel': new Uniform1f(context, locations.u_metersPerPixel),
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

const terrainUniformValues = (
    eleDelta: number,
    fogMatrix: mat4,
    sky: Sky,
    pitch: number,
    isGlobeMode: boolean,
    zoom: number,
    painter?: Painter,
    tile?: Tile | null): UniformValues<TerrainUniformsType> => {

    // Contour defaults — always on unless explicitly disabled
    let contourEnabled = 1.0;
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
        'u_atlas_bounds': (painter.style.map.terrain as any)?._elevationAtlasBounds || [0, 0, 1, 1],
        'u_tile_id': tile ? [tile.tileID.canonical.z, tile.tileID.canonical.x, tile.tileID.canonical.y] : [0, 0, 0],
        'u_shadow_intensity': 1.0,
        'u_debug_mode': (typeof window !== 'undefined' && (window as any)._shadowDebugMode) ? (window as any)._shadowDebugMode : 0,
        'u_sun_altitude': (() => {
            const sl = painter?.style?.getLayer('shadow-coarse') as any;
            return sl?.getShadowProperties ? sl.getShadowProperties().altitudeRadians : 0.5;
        })(),
        'u_sun_direction': (() => {
            const sl = painter?.style?.getLayer('shadow-coarse') as any;
            if (!sl?.getShadowProperties) return [0.707, -0.707];
            const dir = sl.getShadowProperties().directionRadians;
            return [Math.sin(dir), -Math.cos(dir)];
        })(),
        'u_dem_ao': 13, // Per-tile DEM texture at unit 13 for full-res AO
        'u_dem_ao_dim': 514.0,  // Default, overridden per-tile in drawTerrain
        'u_dem_ao_unpack': [6553.6, 25.6, 0.1, 10000.0], // Default Mapbox DEM unpack
        'u_dem_ao_exag': 1.3, // Default, overridden per-tile in drawTerrain
        'u_elevation_atlas': 14, // Bind elevation atlas to unit 14
        'u_metersPerPixel': 40075016.7 / (512 * Math.pow(2, tile ? tile.tileID.canonical.z : zoom)),
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
