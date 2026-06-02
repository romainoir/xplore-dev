import {
    Uniform1i,
    Uniform1f,
    Uniform2f,
    Uniform4f
} from '../uniform_binding';

import type { Context } from '../context';
import type { UniformValues, UniformLocations } from '../uniform_binding';
import type { Tile } from '../../tile/tile';
import type { Painter } from '../../render/painter';
import type { DEMData } from '../../data/dem_data';

export type ShadowPrepareUniformsType = {
    'u_image': Uniform1i;
    'u_dem_north': Uniform1i;
    'u_dem_west': Uniform1i;
    'u_dem_corner': Uniform1i;
    'u_dimension': Uniform2f;
    'u_unpack': Uniform4f;
    'u_metersPerPixel': Uniform1f;
    'u_base_azimuth': Uniform1f;
    'u_azimuth_step': Uniform1f;
    'u_has_north': Uniform1f;
    'u_has_west': Uniform1f;
    'u_has_corner': Uniform1f;
    'u_zoom_north': Uniform4f;
    'u_zoom_west': Uniform4f;
    'u_zoom_corner': Uniform4f;
};

const shadowPrepareUniforms = (context: Context, locations: UniformLocations): ShadowPrepareUniformsType => ({
    'u_image': new Uniform1i(context, locations.u_image),
    'u_dem_north': new Uniform1i(context, locations.u_dem_north),
    'u_dem_west': new Uniform1i(context, locations.u_dem_west),
    'u_dem_corner': new Uniform1i(context, locations.u_dem_corner),
    'u_dimension': new Uniform2f(context, locations.u_dimension),
    'u_unpack': new Uniform4f(context, locations.u_unpack),
    'u_metersPerPixel': new Uniform1f(context, locations.u_metersPerPixel),
    'u_base_azimuth': new Uniform1f(context, locations.u_base_azimuth),
    'u_azimuth_step': new Uniform1f(context, locations.u_azimuth_step),
    'u_has_north': new Uniform1f(context, locations.u_has_north),
    'u_has_west': new Uniform1f(context, locations.u_has_west),
    'u_has_corner': new Uniform1f(context, locations.u_has_corner),
    'u_zoom_north': new Uniform4f(context, locations.u_zoom_north),
    'u_zoom_west': new Uniform4f(context, locations.u_zoom_west),
    'u_zoom_corner': new Uniform4f(context, locations.u_zoom_corner),
});

const shadowPrepareUniformValues = (
    tile: Tile,
    dem: DEMData,
    baseAzimuth: number,
    azimuthStep: number,
    hasLateral: boolean,
    hasLongitudinal: boolean,
    hasDiagonal: boolean,
    zoomWest: [number, number, number, number],
    zoomNorth: [number, number, number, number],
    zoomCorner: [number, number, number, number]
): UniformValues<ShadowPrepareUniformsType> => {
    const tileSize = 512;
    const worldCircumference = 40075016.7;
    const zoom = tile.tileID.canonical.z;
    const metersPerPixel = worldCircumference / (tileSize * Math.pow(2, zoom));

    return {
        'u_image': 0,
        'u_dem_west': 1,
        'u_dem_north': 2,
        'u_dem_corner': 3,
        'u_dimension': [dem.stride, dem.stride],
        'u_unpack': dem.getUnpackVector(),
        'u_metersPerPixel': metersPerPixel,
        'u_base_azimuth': baseAzimuth,
        'u_azimuth_step': azimuthStep,
        'u_has_west': hasLateral ? 1.0 : 0.0,
        'u_has_north': hasLongitudinal ? 1.0 : 0.0,
        'u_has_corner': hasDiagonal ? 1.0 : 0.0,
        'u_zoom_west': zoomWest,
        'u_zoom_north': zoomNorth,
        'u_zoom_corner': zoomCorner,
    };
};

export {
    shadowPrepareUniforms,
    shadowPrepareUniformValues,
};
