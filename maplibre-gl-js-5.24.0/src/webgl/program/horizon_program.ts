import {
    Uniform1i,
    Uniform1f,
    Uniform2f,
    Uniform4f,
} from '../uniform_binding';

import type { Context } from '../context';
import type { UniformValues, UniformLocations } from '../uniform_binding';

export type HorizonPrepareUniformsType = {
    'u_image': Uniform1i;
    'u_atlas_bounds': Uniform4f;
    'u_dimension': Uniform2f;
    'u_max_steps': Uniform1f;
    'u_step_meters': Uniform1f;
    'u_max_distance': Uniform1f;
    'u_direction_offset': Uniform1f;
    'u_direction_count': Uniform1f;
};

const horizonPrepareUniforms = (context: Context, locations: UniformLocations): HorizonPrepareUniformsType => ({
    'u_image': new Uniform1i(context, locations.u_image),
    'u_atlas_bounds': new Uniform4f(context, locations.u_atlas_bounds),
    'u_dimension': new Uniform2f(context, locations.u_dimension),
    'u_max_steps': new Uniform1f(context, locations.u_max_steps),
    'u_step_meters': new Uniform1f(context, locations.u_step_meters),
    'u_max_distance': new Uniform1f(context, locations.u_max_distance),
    'u_direction_offset': new Uniform1f(context, locations.u_direction_offset),
    'u_direction_count': new Uniform1f(context, locations.u_direction_count),
});

const horizonPrepareUniformValues = (
    atlasBounds: [number, number, number, number],
    dimension: number,
    maxDistance: number,
    stepMeters: number,
    maxSteps: number,
    directionOffset: number,
    directionCount: number
): UniformValues<HorizonPrepareUniformsType> => ({
    'u_image': 0,
    'u_atlas_bounds': atlasBounds,
    'u_dimension': [dimension, dimension],
    'u_max_steps': maxSteps,
    'u_step_meters': stepMeters,
    'u_max_distance': maxDistance,
    'u_direction_offset': directionOffset,
    'u_direction_count': directionCount,
});

export {
    horizonPrepareUniforms,
    horizonPrepareUniformValues,
};
