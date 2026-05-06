import {UniformColor, Uniform1f, Uniform2f, Uniform3f, UniformMatrix4f} from '../uniform_binding';
import type {Context} from '../../webgl/context';
import type {UniformValues, UniformLocations} from '../uniform_binding';
import {type IReadonlyTransform} from '../../geo/transform_interface';
import {type Sky} from '../../style/sky';
import {getMercatorHorizon} from '../../geo/projection/mercator_utils';
import {type mat4, type vec3} from 'gl-matrix';

export type SkyUniformsType = {
    'u_sky_color': UniformColor;
    'u_horizon_color': UniformColor;
    'u_horizon': Uniform2f;
    'u_horizon_normal': Uniform2f;
    'u_sky_horizon_blend': Uniform1f;
    'u_sky_blend': Uniform1f;
    'u_sun_pos': Uniform3f;
    'u_sun_opacity': Uniform1f;
    'u_inv_proj_matrix': UniformMatrix4f;
};

const skyUniforms = (context: Context, locations: UniformLocations): SkyUniformsType => ({
    'u_sky_color': new UniformColor(context, locations.u_sky_color),
    'u_horizon_color': new UniformColor(context, locations.u_horizon_color),
    'u_horizon': new Uniform2f(context, locations.u_horizon),
    'u_horizon_normal': new Uniform2f(context, locations.u_horizon_normal),
    'u_sky_horizon_blend': new Uniform1f(context, locations.u_sky_horizon_blend),
    'u_sky_blend': new Uniform1f(context, locations.u_sky_blend),
    'u_sun_pos': new Uniform3f(context, locations.u_sun_pos),
    'u_sun_opacity': new Uniform1f(context, locations.u_sun_opacity),
    'u_inv_proj_matrix': new UniformMatrix4f(context, locations.u_inv_proj_matrix),
});

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

const skyUniformValues = (
    sky: Sky,
    transform: IReadonlyTransform,
    pixelRatio: number,
    sunPos: vec3,
    sunAltitudeRad: number,
    invProjMatrix: mat4,
): UniformValues<SkyUniformsType> => {
    const cosRoll = Math.cos(transform.rollInRadians);
    const sinRoll = Math.sin(transform.rollInRadians);
    const mercatorHorizon  = getMercatorHorizon(transform);
    const projectionData = transform.getProjectionData({overscaledTileID: null, applyGlobeMatrix: true, applyTerrainMatrix: true});
    const skyBlend = projectionData.projectionTransition;
    const deg = Math.PI / 180.0;
    const sunOpacity = smoothstep(-1.25 * deg, 1.5 * deg, sunAltitudeRad) * (1 - skyBlend);
    return {
        'u_sky_color': sky.properties.get('sky-color'),
        'u_horizon_color': sky.properties.get('horizon-color'),
        'u_horizon': [(transform.width / 2 - mercatorHorizon * sinRoll)  * pixelRatio,
            (transform.height / 2 + mercatorHorizon * cosRoll) * pixelRatio],
        'u_horizon_normal': [-sinRoll, cosRoll],
        'u_sky_horizon_blend': (sky.properties.get('sky-horizon-blend') * transform.height / 2) * pixelRatio,
        'u_sky_blend': skyBlend,
        'u_sun_pos': sunPos,
        'u_sun_opacity': sunOpacity,
        'u_inv_proj_matrix': invProjMatrix,
    };
};

export {skyUniforms, skyUniformValues};
