import { Texture } from '../texture';
import { StencilMode } from '../stencil_mode';
import { DepthMode } from '../depth_mode';
import { CullFaceMode } from '../cull_face_mode';
import { type ColorMode } from '../color_mode';
import {
    hillshadeUniformValues,
    hillshadeUniformPrepareValues
} from '../program/hillshade_program';

import type { Painter, RenderOptions } from '../../render/painter';
import type { TileManager } from '../../tile/tile_manager';
import type { HillshadeStyleLayer } from '../../style/style_layer/hillshade_style_layer';
import type { OverscaledTileID } from '../../tile/tile_id';

export function drawHillshade(painter: Painter, tileManager: TileManager, layer: HillshadeStyleLayer, tileIDs: Array<OverscaledTileID>, renderOptions: RenderOptions) {
    if (painter.renderPass !== 'offscreen' && painter.renderPass !== 'translucent') return;

    const { isRenderingToTexture } = renderOptions;
    const context = painter.context;
    const projection = painter.style.projection;
    const useSubdivision = projection.useSubdivision;

    const depthMode = painter.getDepthModeForSublayer(0, DepthMode.ReadOnly);
    const colorMode = painter.colorModeForRenderPass();

    if (painter.renderPass === 'offscreen') {
        const cameraRefreshHeld = typeof window !== 'undefined' && (window as any)._shadowCameraRefreshHold;
        const cameraMoving = (painter.options.moving || cameraRefreshHeld) && !(typeof window !== 'undefined' && (window as any)._isInteractingWithTime);
        if (layer.id === 'terrain-derivative-cache' && cameraMoving) {
            if (typeof window !== 'undefined' && (window as any)._shadowTileDebugEnabled) {
                (window as any)._hillshadePrepareDebug = {
                    layer: layer.id,
                    inputTiles: tileIDs.length,
                    prepared: 0,
                    skippedClean: 0,
                    skippedNoDem: 0,
                    skippedWhileMoving: tileIDs.length,
                    refreshHeld: !!cameraRefreshHeld,
                    zooms: {},
                    durationMs: 0,
                    timestamp: performance.now()
                };
            }
            return;
        }

        // Prepare tiles
        prepareHillshade(painter, tileManager, tileIDs, layer, depthMode, StencilMode.disabled, colorMode);
        context.viewport.set([0, 0, painter.width, painter.height]);
    } else if (painter.renderPass === 'translucent') {
        if (layer.id === 'terrain-derivative-cache') {
            if (typeof window !== 'undefined' && (window as any)._shadowTileDebugEnabled) {
                (window as any)._hillshadeRenderDebug = {
                    layer: layer.id,
                    skippedVisibleDraw: true,
                    tileIDs: tileIDs.length,
                    timestamp: performance.now()
                };
            }
            return;
        }

        // Globe (or any projection with subdivision) needs two-pass rendering to avoid artifacts when rendering texture tiles.
        // See comments in draw_raster.ts for more details.
        if (useSubdivision) {
            // Two-pass rendering
            const [stencilBorderless, stencilBorders, coords] = painter.stencilConfigForOverlapTwoPass(tileIDs);
            renderHillshade(painter, tileManager, layer, coords, stencilBorderless, depthMode, colorMode, false, isRenderingToTexture); // draw without borders
            renderHillshade(painter, tileManager, layer, coords, stencilBorders, depthMode, colorMode, true, isRenderingToTexture); // draw with borders
        } else {
            // Simple rendering
            const [stencil, coords] = painter.getStencilConfigForOverlapAndUpdateStencilID(tileIDs);
            renderHillshade(painter, tileManager, layer, coords, stencil, depthMode, colorMode, false, isRenderingToTexture);
        }
    }
}

function renderHillshade(
    painter: Painter,
    tileManager: TileManager,
    layer: HillshadeStyleLayer,
    coords: Array<OverscaledTileID>,
    stencilModes: { [_: number]: Readonly<StencilMode> },
    depthMode: Readonly<DepthMode>,
    colorMode: Readonly<ColorMode>,
    useBorder: boolean,
    isRenderingToTexture: boolean
) {
    const projection = painter.style.projection;
    const context = painter.context;
    const transform = painter.transform;
    const gl = context.gl;

    const defines = [`#define NUM_ILLUMINATION_SOURCES ${layer.paint.get('hillshade-highlight-color').values.length}`];
    const program = painter.useProgram('hillshade', null, false, defines);
    const align = !painter.options.moving;

    for (const coord of coords) {
        const tile = tileManager.getTile(coord);
        const fbo = tile.fbo;
        if (!fbo) {
            continue;
        }
        const mesh = projection.getMeshFromTileID(context, coord.canonical, useBorder, true, 'raster');

        const terrainData = painter.style.map.terrain?.getTerrainData(coord);

        context.activeTexture.set(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fbo.colorAttachment.get());

        // Bind raw DEM to texture unit 1 (for snow high-precision elevation)
        context.activeTexture.set(gl.TEXTURE1);
        if (tile.demTexture) {
            tile.demTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
        }

        const uniformValues = hillshadeUniformValues(painter, tile, layer);

        const projectionData = transform.getProjectionData({
            overscaledTileID: coord,
            aligned: align,
            applyGlobeMatrix: !isRenderingToTexture,
            applyTerrainMatrix: true
        });

        program.draw(context, gl.TRIANGLES, depthMode, stencilModes[coord.overscaledZ], colorMode, CullFaceMode.backCCW,
            uniformValues, terrainData, projectionData, layer.id, mesh.vertexBuffer, mesh.indexBuffer, mesh.segments);
    }
}

// hillshade rendering is done in two steps. the prepare step first calculates the slope of the terrain in the x and y
// directions for each pixel, and saves those values to a framebuffer texture in the r and g channels.
function prepareHillshade(
    painter: Painter,
    tileManager: TileManager,
    tileIDs: Array<OverscaledTileID>,
    layer: HillshadeStyleLayer,
    depthMode: Readonly<DepthMode>,
    stencilMode: Readonly<StencilMode>,
    colorMode: Readonly<ColorMode>) {

    const context = painter.context;
    const gl = context.gl;
    const debugEnabled = typeof window !== 'undefined' && (window as any)._shadowTileDebugEnabled;
    const debugStart = debugEnabled ? performance.now() : 0;
    let prepared = 0;
    let skippedClean = 0;
    let skippedNoDem = 0;
    let skippedWhileMoving = 0;
    const zooms: Record<string, number> = {};

    for (const coord of tileIDs) {
        const tile = tileManager.getTile(coord);
        const dem = tile.dem;
        if (debugEnabled) {
            const z = String(coord.canonical.z);
            zooms[z] = (zooms[z] || 0) + 1;
        }

        if (!dem || !dem.data) {
            skippedNoDem++;
            continue;
        }

        if (!tile.needsHillshadePrepare) {
            skippedClean++;
            continue;
        }

        const tileSize = dem.dim;
        const textureStride = dem.stride;

        const pixelData = dem.getPixels();
        context.activeTexture.set(gl.TEXTURE1);

        context.pixelStoreUnpackPremultiplyAlpha.set(false);
        tile.demTexture = tile.demTexture || painter.getTileTexture(textureStride);
        if (tile.demTexture) {
            const demTexture = tile.demTexture;
            demTexture.update(pixelData, { premultiply: false });
            demTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
        } else {
            tile.demTexture = new Texture(context, pixelData, gl.RGBA, { premultiply: false });
            tile.demTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
        }

        context.activeTexture.set(gl.TEXTURE0);

        let fbo = tile.fbo;

        if (!fbo) {
            const renderTexture = new Texture(context, { width: tileSize, height: tileSize, data: null }, gl.RGBA);
            renderTexture.bind(gl.LINEAR, gl.CLAMP_TO_EDGE);

            fbo = tile.fbo = context.createFramebuffer(tileSize, tileSize, true, false);
            fbo.colorAttachment.set(renderTexture.texture);
            gl.bindTexture(gl.TEXTURE_2D, null);
        }

        context.bindFramebuffer.set(fbo.framebuffer);
        context.viewport.set([0, 0, tileSize, tileSize]);

        painter.useProgram('hillshadePrepare').draw(context, gl.TRIANGLES,
            depthMode, stencilMode, colorMode, CullFaceMode.disabled,
            hillshadeUniformPrepareValues(tile.tileID, dem),
            null, null, layer.id, painter.rasterBoundsBuffer,
            painter.quadTriangleIndexBuffer, painter.rasterBoundsSegments);

        tile.needsHillshadePrepare = false;
        prepared++;
    }

    if (debugEnabled) {
        (window as any)._hillshadePrepareDebug = {
            layer: layer.id,
            inputTiles: tileIDs.length,
            prepared,
            skippedClean,
            skippedNoDem,
            skippedWhileMoving,
            zooms,
            durationMs: performance.now() - debugStart,
            timestamp: performance.now()
        };
    }
}
