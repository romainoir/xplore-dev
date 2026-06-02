import { UniformColor, Uniform1f, Uniform2f, Uniform3f, UniformMatrix4f } from '../uniform_binding';
import type { Context } from '../../gl/context';
import type { UniformValues, UniformLocations } from '../uniform_binding';
import { type IReadonlyTransform } from '../../geo/transform_interface';
import { type Sky } from '../../style/sky';
import { getMercatorHorizon } from '../../geo/projection/mercator_utils';

export type SkyUniformsType = {
    'u_sky_color': UniformColor;
    'u_horizon_color': UniformColor;
    'u_horizon': Uniform2f;
    'u_horizon_normal': Uniform2f;
    'u_sky_horizon_blend': Uniform1f;
    'u_sky_blend': Uniform1f;
    'u_sun_pos': Uniform3f;
    'u_moon_pos': Uniform3f;
    'u_sun_intensity': Uniform1f;
    'u_sun_altitude': Uniform1f;
    'u_moon_phase': Uniform1f;
    'u_inv_proj_matrix': UniformMatrix4f;
    'u_sun_azimuth': Uniform1f;
    'u_sun_elevation': Uniform1f;
    'u_camera_bearing': Uniform1f;
    'u_camera_pitch': Uniform1f;
    'u_fov': Uniform1f;
};

const skyUniforms = (context: Context, locations: UniformLocations): SkyUniformsType => ({
    'u_sky_color': new UniformColor(context, locations.u_sky_color),
    'u_horizon_color': new UniformColor(context, locations.u_horizon_color),
    'u_horizon': new Uniform2f(context, locations.u_horizon),
    'u_horizon_normal': new Uniform2f(context, locations.u_horizon_normal),
    'u_sky_horizon_blend': new Uniform1f(context, locations.u_sky_horizon_blend),
    'u_sky_blend': new Uniform1f(context, locations.u_sky_blend),
    'u_sun_pos': new Uniform3f(context, locations.u_sun_pos),
    'u_moon_pos': new Uniform3f(context, locations.u_moon_pos),
    'u_sun_intensity': new Uniform1f(context, locations.u_sun_intensity),
    'u_sun_altitude': new Uniform1f(context, locations.u_sun_altitude),
    'u_moon_phase': new Uniform1f(context, locations.u_moon_phase),
    'u_inv_proj_matrix': new UniformMatrix4f(context, locations.u_inv_proj_matrix),
    'u_sun_azimuth': new Uniform1f(context, locations.u_sun_azimuth),
    'u_sun_elevation': new Uniform1f(context, locations.u_sun_elevation),
    'u_camera_bearing': new Uniform1f(context, locations.u_camera_bearing),
    'u_camera_pitch': new Uniform1f(context, locations.u_camera_pitch),
    'u_fov': new Uniform1f(context, locations.u_fov),
});

export interface SkyUniformParams {
    sunPos: [number, number, number];
    moonPos: [number, number, number];
    sunAltitude: number;
    sunAzimuth: number;
    sunElevation: number;
    moonPhase: number;
}

const skyUniformValues = (sky: Sky, transform: IReadonlyTransform, pixelRatio: number, params: SkyUniformParams, invProjMatrix: any): UniformValues<SkyUniformsType> => {
    const cosRoll = Math.cos(transform.rollInRadians);
    const sinRoll = Math.sin(transform.rollInRadians);
    const mercatorHorizon = getMercatorHorizon(transform);

    const skyBlend = 0.0;

    // Use the native mercator horizon which tracks the geometric horizon
    // based on camera pitch and distance. The skyBlend=0 above already
    // prevents the zoom-dependent sky visibility switching that caused
    // the original jumping issue.
    const finalMercatorHorizon = mercatorHorizon;

    return {
        'u_sky_color': sky.properties.get('sky-color'),
        'u_horizon_color': sky.properties.get('horizon-color'),
        'u_horizon': [(transform.width / 2 - finalMercatorHorizon * sinRoll) * pixelRatio,
        (transform.height / 2 + finalMercatorHorizon * cosRoll) * pixelRatio],
        'u_horizon_normal': [-sinRoll, cosRoll],
        'u_sky_horizon_blend': (sky.properties.get('sky-horizon-blend') * transform.height / 2) * pixelRatio,
        'u_sky_blend': skyBlend,
        'u_sun_pos': params.sunPos,
        'u_moon_pos': params.moonPos,
        'u_sun_intensity': 1.0,
        'u_sun_altitude': params.sunAltitude,
        'u_moon_phase': params.moonPhase,
        'u_inv_proj_matrix': invProjMatrix as any,
        'u_sun_azimuth': params.sunAzimuth,
        'u_sun_elevation': params.sunElevation,
        'u_camera_bearing': transform.bearingInRadians,
        'u_camera_pitch': transform.pitchInRadians,
        'u_fov': transform.fovInRadians,
    };
};

export { skyUniforms, skyUniformValues };
