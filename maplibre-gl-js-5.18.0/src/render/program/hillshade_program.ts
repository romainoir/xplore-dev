import { mat4 } from 'gl-matrix';

import {
    Uniform1i,
    Uniform1f,
    Uniform2f,
    UniformColor,
    UniformFloatArray,
    UniformColorArray,
    UniformMatrix4f,
    Uniform4f
} from '../uniform_binding';
import { EXTENT } from '../../data/extent';
import { MercatorCoordinate } from '../../geo/mercator_coordinate';
import { Color } from '@maplibre/maplibre-gl-style-spec';

import type { Context } from '../../gl/context';
import type { UniformValues, UniformLocations } from '../uniform_binding';
import type { Tile } from '../../tile/tile';
import type { Painter } from '../painter';
import type { HillshadeStyleLayer } from '../../style/style_layer/hillshade_style_layer';
import type { DEMData } from '../../data/dem_data';
import type { OverscaledTileID } from '../../tile/tile_id';

export type HillshadeUniformsType = {
    'u_image': Uniform1i;
    'u_latrange': Uniform2f;
    'u_exaggeration': Uniform1f;
    'u_altitudes': UniformFloatArray;
    'u_azimuths': UniformFloatArray;
    'u_accent': UniformColor;
    'u_method': Uniform1i;
    'u_shadows': UniformColorArray;
    'u_highlights': UniformColorArray;
    'u_metersPerPixel': Uniform1f;
    'u_snow_altitude': Uniform1f;
    'u_snow_maxSlope': Uniform1f;
    'u_slope_min': Uniform1f;
    'u_slope_max': Uniform1f;
    'u_bearing': Uniform1f;
    'u_image_raw': Uniform1i;
    'u_unpack': Uniform4f;
    'u_dimension': Uniform2f;
    'u_skyHighlight': UniformColor;
    'u_skyShadow': UniformColor;
};

export type HillshadePrepareUniformsType = {
    'u_matrix': UniformMatrix4f;
    'u_image': Uniform1i;
    'u_dimension': Uniform2f;
    'u_zoom': Uniform1f;
    'u_unpack': Uniform4f;
    'u_metersPerPixel': Uniform1f;
};

const hillshadeUniforms = (context: Context, locations: UniformLocations): HillshadeUniformsType => ({
    'u_image': new Uniform1i(context, locations.u_image),
    'u_latrange': new Uniform2f(context, locations.u_latrange),
    'u_exaggeration': new Uniform1f(context, locations.u_exaggeration),
    'u_altitudes': new UniformFloatArray(context, locations.u_altitudes),
    'u_azimuths': new UniformFloatArray(context, locations.u_azimuths),
    'u_accent': new UniformColor(context, locations.u_accent),
    'u_method': new Uniform1i(context, locations.u_method),
    'u_shadows': new UniformColorArray(context, locations.u_shadows),
    'u_highlights': new UniformColorArray(context, locations.u_highlights),
    'u_metersPerPixel': new Uniform1f(context, locations.u_metersPerPixel),
    'u_snow_altitude': new Uniform1f(context, locations.u_snow_altitude),
    'u_snow_maxSlope': new Uniform1f(context, locations.u_snow_maxSlope),
    'u_slope_min': new Uniform1f(context, locations.u_slope_min),
    'u_slope_max': new Uniform1f(context, locations.u_slope_max),
    'u_bearing': new Uniform1f(context, locations.u_bearing),
    'u_image_raw': new Uniform1i(context, locations.u_image_raw),
    'u_unpack': new Uniform4f(context, locations.u_unpack),
    'u_dimension': new Uniform2f(context, locations.u_dimension),
    'u_skyHighlight': new UniformColor(context, locations.u_skyHighlight),
    'u_skyShadow': new UniformColor(context, locations.u_skyShadow),
});

const hillshadePrepareUniforms = (context: Context, locations: UniformLocations): HillshadePrepareUniformsType => ({
    'u_matrix': new UniformMatrix4f(context, locations.u_matrix),
    'u_image': new Uniform1i(context, locations.u_image),
    'u_dimension': new Uniform2f(context, locations.u_dimension),
    'u_zoom': new Uniform1f(context, locations.u_zoom),
    'u_unpack': new Uniform4f(context, locations.u_unpack),
    'u_metersPerPixel': new Uniform1f(context, locations.u_metersPerPixel)
});

const hillshadeUniformValues = (
    painter: Painter,
    tile: Tile,
    layer: HillshadeStyleLayer,
): UniformValues<HillshadeUniformsType> => {
    const accent = layer.paint.get('hillshade-accent-color');
    let method;

    // Force method based on layer ID - bypasses style-spec validation
    if (layer.id === 'aspect' || layer.id === 'aspect-native') {
        method = 6;  // ASPECT
    } else if (layer.id === 'slope' || layer.id === 'slope-native') {
        method = 7;  // SLOPE
    } else if (layer.id === 'avalanche' || layer.id === 'avalanche-native') {
        method = 8;  // AVALANCHE
    } else if (layer.id === 'snow' || layer.id === 'snow-native') {
        method = 9;  // SNOW
    } else {
        const methodValue = layer.paint.get('hillshade-method') as string;
        switch (methodValue) {
            case 'basic':
                method = 4;
                break;
            case 'combined':
                method = 1;
                break;
            case 'igor':
                method = 2;
                break;
            case 'multidirectional':
                method = 3;
                break;
            case 'standard':
            default:
                method = 0;
                break;
        }
    }

    const illumination = layer.getIlluminationProperties();

    for (let i = 0; i < illumination.directionRadians.length; i++) {
        if (layer.paint.get('hillshade-illumination-anchor') === 'viewport') {
            illumination.directionRadians[i] += painter.transform.bearingInRadians;
        }
    }

    const latRange = getTileLatRange(painter, tile.tileID);
    const tileSize = 512;
    const worldCircumference = 40075016.7;
    const zoom = tile.tileID.overscaledZ;
    const globalMetersPerPixel = worldCircumference / (tileSize * Math.pow(2, zoom));

    // Sky preset parameters
    const skyPreset = (typeof window !== 'undefined' && (window as any)._currentSkyPreset) || {};
    const skyHighlightHex = skyPreset['hillshade-highlight'] || '#FFFFFF';
    const skyShadowHex = skyPreset['hillshade-shadow'] || '#000000';
    const skyHighlight = Color.parse(skyHighlightHex) || Color.parse('#FFFFFF');
    const skyShadow = Color.parse(skyShadowHex) || Color.parse('#000000');

    // Snow parameters
    const snowConfig = (typeof window !== 'undefined' && (window as any).snowConfig) || {};
    const snowAltitude = snowConfig.altitude ?? 1000;
    const snowMaxSlope = snowConfig.maxSlope ?? 35;

    // Slope filter parameters
    const slopeConfig = (typeof window !== 'undefined' && (window as any).slopeConfig) || {};

    return {
        'u_image': 0,
        'u_image_raw': 1,

        'u_unpack': tile.dem ? tile.dem.getUnpackVector() : [0, 0, 0, 0],
        'u_dimension': tile.dem ? [tile.dem.stride, tile.dem.stride] : [514, 514],

        'u_bearing': painter.transform.bearingInRadians,

        'u_latrange': latRange,
        'u_exaggeration': layer.paint.get('hillshade-exaggeration'),
        'u_altitudes': illumination.altitudeRadians,
        'u_azimuths': illumination.directionRadians,
        'u_accent': accent,
        'u_method': method,
        'u_highlights': illumination.highlightColor,
        'u_shadows': illumination.shadowColor,
        'u_metersPerPixel': globalMetersPerPixel,
        'u_snow_altitude': snowAltitude,
        'u_snow_maxSlope': snowMaxSlope,
        'u_slope_min': slopeConfig.min ?? 0,
        'u_slope_max': slopeConfig.max ?? 90,
        'u_skyHighlight': skyHighlight,
        'u_skyShadow': skyShadow,
    };
};

const hillshadeUniformPrepareValues = (tileID: OverscaledTileID, dem: DEMData): UniformValues<HillshadePrepareUniformsType> => {

    const stride = dem.stride;
    const matrix = mat4.create();
    // Flip rendering at y axis.
    mat4.ortho(matrix, 0, EXTENT, -EXTENT, 0, 0, 1);
    mat4.translate(matrix, matrix, [0, -EXTENT, 0]);

    const metersPerPixel = 40075016.6855785 / (512 * Math.pow(2, tileID.overscaledZ));

    return {
        'u_matrix': matrix,
        'u_image': 1,
        'u_dimension': [stride, stride],
        'u_zoom': tileID.overscaledZ,
        'u_unpack': dem.getUnpackVector(),
        'u_metersPerPixel': metersPerPixel
    };
};

function getTileLatRange(painter: Painter, tileID: OverscaledTileID) {
    // for scaling the magnitude of a points slope by its latitude
    const tilesAtZoom = Math.pow(2, tileID.canonical.z);
    const y = tileID.canonical.y;
    return [
        new MercatorCoordinate(0, y / tilesAtZoom).toLngLat().lat,
        new MercatorCoordinate(0, (y + 1) / tilesAtZoom).toLngLat().lat];
}

export {
    hillshadeUniforms,
    hillshadePrepareUniforms,
    hillshadeUniformValues,
    hillshadeUniformPrepareValues
};
