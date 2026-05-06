import {UniformColor, Uniform1f, Uniform2f} from '../uniform_binding';
import type {Context} from '../../webgl/context';
import type {UniformValues, UniformLocations} from '../uniform_binding';
import {type IReadonlyTransform} from '../../geo/transform_interface';
import {type Sky} from '../../style/sky';
import {getMercatorHorizon} from '../../geo/projection/mercator_utils';
import {Color} from '@maplibre/maplibre-gl-style-spec';

export type SkyUniformsType = {
    'u_sky_color': UniformColor;
    'u_horizon_color': UniformColor;
    'u_horizon': Uniform2f;
    'u_horizon_normal': Uniform2f;
    'u_sky_horizon_blend': Uniform1f;
    'u_sky_blend': Uniform1f;
    'u_sun_screen_pos': Uniform2f;
    'u_sun_size': Uniform1f;
    'u_sun_glow_size': Uniform1f;
    'u_sun_opacity': Uniform1f;
    'u_sun_color': UniformColor;
    'u_sun_glow_color': UniformColor;
};

const skyUniforms = (context: Context, locations: UniformLocations): SkyUniformsType => ({
    'u_sky_color': new UniformColor(context, locations.u_sky_color),
    'u_horizon_color': new UniformColor(context, locations.u_horizon_color),
    'u_horizon': new Uniform2f(context, locations.u_horizon),
    'u_horizon_normal': new Uniform2f(context, locations.u_horizon_normal),
    'u_sky_horizon_blend': new Uniform1f(context, locations.u_sky_horizon_blend),
    'u_sky_blend': new Uniform1f(context, locations.u_sky_blend),
    'u_sun_screen_pos': new Uniform2f(context, locations.u_sun_screen_pos),
    'u_sun_size': new Uniform1f(context, locations.u_sun_size),
    'u_sun_glow_size': new Uniform1f(context, locations.u_sun_glow_size),
    'u_sun_opacity': new Uniform1f(context, locations.u_sun_opacity),
    'u_sun_color': new UniformColor(context, locations.u_sun_color),
    'u_sun_glow_color': new UniformColor(context, locations.u_sun_glow_color),
});

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

const skyUniformValues = (sky: Sky, transform: IReadonlyTransform, pixelRatio: number): UniformValues<SkyUniformsType> => {
    const cosRoll = Math.cos(transform.rollInRadians);
    const sinRoll = Math.sin(transform.rollInRadians);
    const mercatorHorizon  = getMercatorHorizon(transform);
    const projectionData = transform.getProjectionData({overscaledTileID: null, applyGlobeMatrix: true, applyTerrainMatrix: true});
    const skyBlend = projectionData.projectionTransition;
    const horizon: [number, number] = [(transform.width / 2 - mercatorHorizon * sinRoll) * pixelRatio,
        (transform.height / 2 + mercatorHorizon * cosRoll) * pixelRatio];
    const horizonNormal: [number, number] = [-sinRoll, cosRoll];

    const windowState = typeof window !== 'undefined' ? (window as any) : {};
    const sunAltitude = typeof windowState._skySunAltitudeRad === 'number' ?
        windowState._skySunAltitudeRad :
        typeof windowState._actualSunAltitudeRad === 'number' ? windowState._actualSunAltitudeRad : -Math.PI;
    const sunAzimuth = typeof windowState._skySunAzimuthRad === 'number' ?
        windowState._skySunAzimuthRad :
        Array.isArray(windowState._shadowSunDirection) ?
            Math.atan2(windowState._shadowSunDirection[0], -windowState._shadowSunDirection[1]) :
            0;
    const relativeAzimuth = sunAzimuth - transform.bearingInRadians;
    const tangent = [cosRoll, sinRoll];
    const horizontalOffset = Math.sin(relativeAzimuth) * transform.width * 0.48 * pixelRatio;
    const altitudeLift = Math.sin(clamp(sunAltitude, -0.08, Math.PI / 2)) * transform.height * 1.65 * pixelRatio;
    const sunOpacity = smoothstep(-2.0 * Math.PI / 180.0, 0.35 * Math.PI / 180.0, sunAltitude) * (1.0 - skyBlend);
    const lowSun = 1.0 - smoothstep(4.0 * Math.PI / 180.0, 18.0 * Math.PI / 180.0, sunAltitude);
    const sunColor = new Color(1.0, 0.97 - lowSun * 0.17, 0.82 - lowSun * 0.34, 1.0);
    const sunGlowColor = new Color(1.0, 0.58 + lowSun * 0.10, 0.22, 0.38 + lowSun * 0.18);

    return {
        'u_sky_color': sky.properties.get('sky-color'),
        'u_horizon_color': sky.properties.get('horizon-color'),
        'u_horizon': horizon,
        'u_horizon_normal': horizonNormal,
        'u_sky_horizon_blend': (sky.properties.get('sky-horizon-blend') * transform.height / 2) * pixelRatio,
        'u_sky_blend': skyBlend,
        'u_sun_screen_pos': [
            horizon[0] + tangent[0] * horizontalOffset + horizonNormal[0] * altitudeLift,
            horizon[1] + tangent[1] * horizontalOffset + horizonNormal[1] * altitudeLift
        ] as [number, number],
        'u_sun_size': 9.0 * pixelRatio,
        'u_sun_glow_size': 62.0 * pixelRatio,
        'u_sun_opacity': sunOpacity,
        'u_sun_color': sunColor,
        'u_sun_glow_color': sunGlowColor,
    };
};

export {skyUniforms, skyUniformValues};
