import { StencilMode } from '../gl/stencil_mode';
import { DepthMode } from '../gl/depth_mode';
import { CullFaceMode } from '../gl/cull_face_mode';
import { PosArray, TriangleIndexArray } from '../data/array_types.g';
import posAttributes from '../data/pos_attributes';
import { SegmentVector } from '../data/segment';
import { skyUniformValues } from './program/sky_program';
import { atmosphereUniformValues } from './program/atmosphere_program';
import { type Sky } from '../style/sky';
import { type Light } from '../style/light';
import { Mesh } from './mesh';
import { mat4, vec3, vec4 } from 'gl-matrix';
import { type IReadonlyTransform } from '../geo/transform_interface';
import { ColorMode } from '../gl/color_mode';
import type { Painter } from './painter';
import { type Context } from '../gl/context';
import { getGlobeRadiusPixels } from '../geo/projection/globe_utils';

function getMesh(context: Context, sky: Sky): Mesh {
    // Create the Sky mesh the first time we need it
    if (!sky.mesh) {
        const vertexArray = new PosArray();
        vertexArray.emplaceBack(-1, -1);
        vertexArray.emplaceBack(1, -1);
        vertexArray.emplaceBack(1, 1);
        vertexArray.emplaceBack(-1, 1);

        const indexArray = new TriangleIndexArray();
        indexArray.emplaceBack(0, 1, 2);
        indexArray.emplaceBack(0, 2, 3);

        sky.mesh = new Mesh(
            context.createVertexBuffer(vertexArray, posAttributes.members),
            context.createIndexBuffer(indexArray),
            SegmentVector.simpleSegment(0, 0, vertexArray.length, indexArray.length)
        );
    }

    return sky.mesh;
}

export function drawSky(painter: Painter, sky: Sky) {
    const context = painter.context;
    const gl = context.gl;
    const transform = painter.transform;
    const light = painter.style.light;

    const sunPos = getSunPos(light, transform);
    const moonPos = getMoonPos(light, transform);
    const invProjMatrix = transform.inverseProjectionMatrix;

    // Get light position in polar coordinates
    const _lp = light.properties.get('position') as any;
    const sunAltitude = _lp.z; // Raw Z from light = sin(altitude)

    // Convert Cartesian to spherical for azimuth/elevation
    const sunAzimuth = Math.atan2(_lp.y, _lp.x);
    const sunElevation = Math.asin(_lp.z);

    // Calculate moon phase based on simulation date
    // Lunar cycle is approximately 29.53 days
    // Reference: Jan 6, 2000 was a new moon
    const simulationTime = (typeof window !== 'undefined' && (window as any).skySimulationDate)
        ? (window as any).skySimulationDate
        : Date.now();
    const refNewMoon = new Date('2000-01-06T18:14:00Z').getTime();
    const daysSinceRef = (simulationTime - refNewMoon) / (1000 * 60 * 60 * 24);
    const lunarCycle = 29.530588853;
    const moonPhase = ((daysSinceRef % lunarCycle) + lunarCycle) % lunarCycle / lunarCycle; // 0-1, 0=new, 0.5=full

    const skyParams = {
        sunPos: sunPos as [number, number, number],
        moonPos: moonPos as [number, number, number],
        sunAltitude: sunAltitude,
        sunAzimuth: sunAzimuth,
        sunElevation: sunElevation,
        moonPhase: moonPhase
    };

    const skyUniforms = skyUniformValues(sky, transform, painter.pixelRatio, skyParams, invProjMatrix);

    const depthMode = new DepthMode(gl.LEQUAL, DepthMode.ReadWrite, [0, 1]);
    const stencilMode = StencilMode.disabled;
    const colorMode = painter.colorModeForRenderPass();
    const program = painter.useProgram('sky');

    const mesh = getMesh(context, sky);

    program.draw(context, gl.TRIANGLES, depthMode, stencilMode, colorMode,
        CullFaceMode.disabled, skyUniforms, null, undefined, 'sky', mesh.vertexBuffer,
        mesh.indexBuffer, mesh.segments);
}

function getSunPos(light: Light, transform: IReadonlyTransform): vec3 {
    const _lp = light.properties.get('position') as any;
    // Negate X and Y to align with shadow direction. Use positive Z for correct altitude.
    const sunWorld = [-_lp.x, -_lp.y, _lp.z, 0.0] as any as vec4;

    // Transform World -> Camera space using View matrix (P^-1 * MVP)
    const viewMat = mat4.create();
    mat4.multiply(viewMat, transform.inverseProjectionMatrix, transform.modelViewProjectionMatrix);

    const sunCamera = vec4.create();
    vec4.transformMat4(sunCamera, sunWorld, viewMat);

    return vec3.normalize(vec3.create(), [sunCamera[0], sunCamera[1], sunCamera[2]]) as vec3;
}

function getMoonPos(light: Light, transform: IReadonlyTransform): vec3 {
    const _lp = light.properties.get('position') as any;
    // Moon is opposite to the sun
    const moonWorld = [-_lp.x, -_lp.y, -_lp.z, 0.0] as any as vec4;

    // Transform World -> Camera space using View matrix (P^-1 * MVP)
    const viewMat = mat4.create();
    mat4.multiply(viewMat, transform.inverseProjectionMatrix, transform.modelViewProjectionMatrix);

    const moonCamera = vec4.create();
    vec4.transformMat4(moonCamera, moonWorld, viewMat);

    return vec3.normalize(vec3.create(), [moonCamera[0], moonCamera[1], moonCamera[2]]) as vec3;
}

export function drawAtmosphere(painter: Painter, sky: Sky, light: Light) {
    const context = painter.context;
    const gl = context.gl;
    const program = painter.useProgram('atmosphere');
    const depthMode = new DepthMode(gl.LEQUAL, DepthMode.ReadOnly, [0, 1]);
    const transform = painter.transform;

    const sunPos = getSunPos(light, painter.transform);
    const moonPos = getMoonPos(light, painter.transform);

    const projectionData = transform.getProjectionData({ overscaledTileID: null, applyGlobeMatrix: true, applyTerrainMatrix: true });
    const atmosphereBlend = sky.properties.get('atmosphere-blend') * projectionData.projectionTransition;

    if (atmosphereBlend === 0) {
        return;
    }

    const globeRadius = getGlobeRadiusPixels(transform.worldSize, transform.center.lat);
    const invProjMatrix = transform.inverseProjectionMatrix;
    const vec = new Float64Array(4) as any as vec4;
    vec[3] = 1;
    vec4.transformMat4(vec, vec, transform.modelViewProjectionMatrix);
    vec[0] /= vec[3];
    vec[1] /= vec[3];
    vec[2] /= vec[3];
    vec[3] = 1;
    vec4.transformMat4(vec, vec, invProjMatrix);
    vec[0] /= vec[3];
    vec[1] /= vec[3];
    vec[2] /= vec[3];
    vec[3] = 1;
    const globePosition = [vec[0], vec[1], vec[2]] as vec3;

    const uniformValues = atmosphereUniformValues(sunPos, moonPos, atmosphereBlend, globePosition, globeRadius, invProjMatrix);

    const mesh = getMesh(context, sky);

    program.draw(context, gl.TRIANGLES, depthMode, StencilMode.disabled, ColorMode.alphaBlended, CullFaceMode.disabled, uniformValues, null, null, 'atmosphere', mesh.vertexBuffer, mesh.indexBuffer, mesh.segments);
}
