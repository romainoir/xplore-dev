import {
    Uniform1i,
    Uniform1f,
    Uniform2f,
    Uniform3f,
    Uniform4f
} from '../uniform_binding';

import type { Context } from '../../gl/context';
import type { UniformValues, UniformLocations } from '../uniform_binding';
import type { Tile } from '../../tile/tile';
import type { Painter } from '../painter';
import type { DaylightStyleLayer } from '../../style/style_layer/daylight_style_layer';

export type DaylightUniformsType = {
    'u_horizon': Uniform1i;
    'u_color_ramp': Uniform1i;
    'u_opacity': Uniform1f;
    'u_tile_id': Uniform3f;
    // 1D array of altitudes for each of the 32 azimuth slices throughout the day
    // We send this as 32 floats (or 8 vec4s) to avoid texture overhead for a simple LUT
    'u_solar_lut_0': Uniform4f;
    'u_solar_lut_1': Uniform4f;
    'u_solar_lut_2': Uniform4f;
    'u_solar_lut_3': Uniform4f;
    'u_solar_lut_4': Uniform4f;
    'u_solar_lut_5': Uniform4f;
    'u_solar_lut_6': Uniform4f;
    'u_solar_lut_7': Uniform4f;
    'u_time_weight': Uniform1f; // Minutes per step
};

const daylightUniforms = (context: Context, locations: UniformLocations): DaylightUniformsType => ({
    'u_horizon': new Uniform1i(context, locations.u_horizon),
    'u_color_ramp': new Uniform1i(context, locations.u_color_ramp),
    'u_opacity': new Uniform1f(context, locations.u_opacity),
    'u_tile_id': new Uniform3f(context, locations.u_tile_id),
    'u_solar_lut_0': new Uniform4f(context, locations.u_solar_lut_0),
    'u_solar_lut_1': new Uniform4f(context, locations.u_solar_lut_1),
    'u_solar_lut_2': new Uniform4f(context, locations.u_solar_lut_2),
    'u_solar_lut_3': new Uniform4f(context, locations.u_solar_lut_3),
    'u_solar_lut_4': new Uniform4f(context, locations.u_solar_lut_4),
    'u_solar_lut_5': new Uniform4f(context, locations.u_solar_lut_5),
    'u_solar_lut_6': new Uniform4f(context, locations.u_solar_lut_6),
    'u_solar_lut_7': new Uniform4f(context, locations.u_solar_lut_7),
    'u_time_weight': new Uniform1f(context, locations.u_time_weight),
});

const daylightUniformValues = (
    painter: Painter,
    tile: Tile,
    layer: DaylightStyleLayer,
    solarLUT: Float32Array, // Must be exactly 32 floats
    timeWeightMins: number
): UniformValues<DaylightUniformsType> => {

    const opacity = (layer.paint.get('daylight-opacity') as number) ?? 0.5;

    return {
        'u_horizon': 0, // GL_TEXTURE0
        'u_color_ramp': 1, // GL_TEXTURE1
        'u_opacity': opacity,
        'u_tile_id': [tile.tileID.canonical.z, tile.tileID.canonical.x, tile.tileID.canonical.y],
        'u_solar_lut_0': [solarLUT[0], solarLUT[1], solarLUT[2], solarLUT[3]],
        'u_solar_lut_1': [solarLUT[4], solarLUT[5], solarLUT[6], solarLUT[7]],
        'u_solar_lut_2': [solarLUT[8], solarLUT[9], solarLUT[10], solarLUT[11]],
        'u_solar_lut_3': [solarLUT[12], solarLUT[13], solarLUT[14], solarLUT[15]],
        'u_solar_lut_4': [solarLUT[16], solarLUT[17], solarLUT[18], solarLUT[19]],
        'u_solar_lut_5': [solarLUT[20], solarLUT[21], solarLUT[22], solarLUT[23]],
        'u_solar_lut_6': [solarLUT[24], solarLUT[25], solarLUT[26], solarLUT[27]],
        'u_solar_lut_7': [solarLUT[28], solarLUT[29], solarLUT[30], solarLUT[31]],
        'u_time_weight': timeWeightMins
    };
};

export {
    daylightUniforms,
    daylightUniformValues,
};
