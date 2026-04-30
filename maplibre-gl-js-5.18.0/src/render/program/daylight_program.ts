import {
    Uniform1i,
    Uniform1f,
    Uniform3f,
    Uniform4f
} from '../uniform_binding';

import type { Context } from '../../gl/context';
import type { UniformValues, UniformLocations } from '../uniform_binding';
import type { DaylightStyleLayer } from '../../style/style_layer/daylight_style_layer';

export type DaylightUniformsType = {
    'u_daylight': Uniform1i;
    'u_color_ramp': Uniform1i;
    'u_opacity': Uniform1f;
    'u_daylight_mode': Uniform1f;
    'u_tile_id': Uniform3f;
    'u_atlas_bounds': Uniform4f;
};

export type DaylightPrepareUniformsType = {
    'u_horizon0': Uniform1i;
    'u_horizon1': Uniform1i;
    'u_horizon2': Uniform1i;
    'u_horizon3': Uniform1i;
    'u_horizon_bins': Uniform1f;
    'u_horizon_edge_softness': Uniform1f;
    'u_time_weight': Uniform1f;
    'u_solar_lut_0': Uniform4f;
    'u_solar_lut_1': Uniform4f;
    'u_solar_lut_2': Uniform4f;
    'u_solar_lut_3': Uniform4f;
    'u_solar_lut_4': Uniform4f;
    'u_solar_lut_5': Uniform4f;
    'u_solar_lut_6': Uniform4f;
    'u_solar_lut_7': Uniform4f;
    'u_solar_lut_8': Uniform4f;
    'u_solar_lut_9': Uniform4f;
    'u_solar_lut_10': Uniform4f;
    'u_solar_lut_11': Uniform4f;
    'u_solar_lut_12': Uniform4f;
    'u_solar_lut_13': Uniform4f;
    'u_solar_lut_14': Uniform4f;
    'u_solar_lut_15': Uniform4f;
};

const daylightUniforms = (context: Context, locations: UniformLocations): DaylightUniformsType => ({
    'u_daylight': new Uniform1i(context, locations.u_daylight),
    'u_color_ramp': new Uniform1i(context, locations.u_color_ramp),
    'u_opacity': new Uniform1f(context, locations.u_opacity),
    'u_daylight_mode': new Uniform1f(context, locations.u_daylight_mode),
    'u_tile_id': new Uniform3f(context, locations.u_tile_id),
    'u_atlas_bounds': new Uniform4f(context, locations.u_atlas_bounds),
});

const daylightPrepareUniforms = (context: Context, locations: UniformLocations): DaylightPrepareUniformsType => ({
    'u_horizon0': new Uniform1i(context, locations.u_horizon0),
    'u_horizon1': new Uniform1i(context, locations.u_horizon1),
    'u_horizon2': new Uniform1i(context, locations.u_horizon2),
    'u_horizon3': new Uniform1i(context, locations.u_horizon3),
    'u_horizon_bins': new Uniform1f(context, locations.u_horizon_bins),
    'u_horizon_edge_softness': new Uniform1f(context, locations.u_horizon_edge_softness),
    'u_time_weight': new Uniform1f(context, locations.u_time_weight),
    'u_solar_lut_0': new Uniform4f(context, locations.u_solar_lut_0),
    'u_solar_lut_1': new Uniform4f(context, locations.u_solar_lut_1),
    'u_solar_lut_2': new Uniform4f(context, locations.u_solar_lut_2),
    'u_solar_lut_3': new Uniform4f(context, locations.u_solar_lut_3),
    'u_solar_lut_4': new Uniform4f(context, locations.u_solar_lut_4),
    'u_solar_lut_5': new Uniform4f(context, locations.u_solar_lut_5),
    'u_solar_lut_6': new Uniform4f(context, locations.u_solar_lut_6),
    'u_solar_lut_7': new Uniform4f(context, locations.u_solar_lut_7),
    'u_solar_lut_8': new Uniform4f(context, locations.u_solar_lut_8),
    'u_solar_lut_9': new Uniform4f(context, locations.u_solar_lut_9),
    'u_solar_lut_10': new Uniform4f(context, locations.u_solar_lut_10),
    'u_solar_lut_11': new Uniform4f(context, locations.u_solar_lut_11),
    'u_solar_lut_12': new Uniform4f(context, locations.u_solar_lut_12),
    'u_solar_lut_13': new Uniform4f(context, locations.u_solar_lut_13),
    'u_solar_lut_14': new Uniform4f(context, locations.u_solar_lut_14),
    'u_solar_lut_15': new Uniform4f(context, locations.u_solar_lut_15),
});

const daylightUniformValues = (
    layer: DaylightStyleLayer,
    tileID: [number, number, number],
    atlasBounds: [number, number, number, number]
): UniformValues<DaylightUniformsType> => {
    const opacity = (layer.paint.get('daylight-opacity') as number) ?? 0.5;

    return {
        'u_daylight': 0,
        'u_color_ramp': 1,
        'u_opacity': opacity,
        'u_daylight_mode': layer.id === 'sun-window-native' ? 1.0 : 0.0,
        'u_tile_id': tileID,
        'u_atlas_bounds': atlasBounds,
    };
};

const daylightPrepareUniformValues = (
    solarLUT: Float32Array,
    timeWeightMins: number,
    horizonBins: number,
    horizonEdgeSoftness: number
): UniformValues<DaylightPrepareUniformsType> => ({
    'u_horizon0': 0,
    'u_horizon1': 1,
    'u_horizon2': 2,
    'u_horizon3': 3,
    'u_horizon_bins': horizonBins,
    'u_horizon_edge_softness': horizonEdgeSoftness,
    'u_time_weight': timeWeightMins,
    'u_solar_lut_0': [solarLUT[0], solarLUT[1], solarLUT[2], solarLUT[3]],
    'u_solar_lut_1': [solarLUT[4], solarLUT[5], solarLUT[6], solarLUT[7]],
    'u_solar_lut_2': [solarLUT[8], solarLUT[9], solarLUT[10], solarLUT[11]],
    'u_solar_lut_3': [solarLUT[12], solarLUT[13], solarLUT[14], solarLUT[15]],
    'u_solar_lut_4': [solarLUT[16], solarLUT[17], solarLUT[18], solarLUT[19]],
    'u_solar_lut_5': [solarLUT[20], solarLUT[21], solarLUT[22], solarLUT[23]],
    'u_solar_lut_6': [solarLUT[24], solarLUT[25], solarLUT[26], solarLUT[27]],
    'u_solar_lut_7': [solarLUT[28], solarLUT[29], solarLUT[30], solarLUT[31]],
    'u_solar_lut_8': [solarLUT[32], solarLUT[33], solarLUT[34], solarLUT[35]],
    'u_solar_lut_9': [solarLUT[36], solarLUT[37], solarLUT[38], solarLUT[39]],
    'u_solar_lut_10': [solarLUT[40], solarLUT[41], solarLUT[42], solarLUT[43]],
    'u_solar_lut_11': [solarLUT[44], solarLUT[45], solarLUT[46], solarLUT[47]],
    'u_solar_lut_12': [solarLUT[48], solarLUT[49], solarLUT[50], solarLUT[51]],
    'u_solar_lut_13': [solarLUT[52], solarLUT[53], solarLUT[54], solarLUT[55]],
    'u_solar_lut_14': [solarLUT[56], solarLUT[57], solarLUT[58], solarLUT[59]],
    'u_solar_lut_15': [solarLUT[60], solarLUT[61], solarLUT[62], solarLUT[63]],
});

export {
    daylightUniforms,
    daylightPrepareUniforms,
    daylightUniformValues,
    daylightPrepareUniformValues,
};
