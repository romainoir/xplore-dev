import { StencilMode } from '../gl/stencil_mode';
import { DepthMode } from '../gl/depth_mode';
import { CullFaceMode } from '../gl/cull_face_mode';
import { type ColorMode } from '../gl/color_mode';
import { shadowUniformValues } from './program/shadow_program';
import { shadowPrepareUniformValues } from './program/shadow_prepare_program';
// calculateTileKey no longer needed — using canonical z/x/y index instead
import { Texture } from './texture';
import { Framebuffer } from '../gl/framebuffer';

import type { Painter, RenderOptions } from './painter';
import type { TileManager } from '../tile/tile_manager';
import type { ShadowStyleLayer } from '../style/style_layer/shadow_style_layer';
import type { OverscaledTileID } from '../tile/tile_id';
import type { Tile } from '../tile/tile';

/**
 * Determine the 3 sun-facing neighbor offsets based on sun direction.
 * The sun direction vector [dirX, dirY] points toward the sun in UV space
 * (x = east, y = south). We need to trace toward the sun, so we pick
 * neighbors in the direction the sun is coming from.
 *
 * Returns [lateral, longitudinal, diagonal] offsets as [dx, dy].
 */
function getSunFacingNeighborOffsets(dirX: number, dirY: number): Array<[number, number]> {
    // dirX > 0 means sun is to the east → rays come from east → bind east neighbor
    // dirY > 0 means sun is to the south (UV space) → rays come from south → bind south neighbor
    const dx = dirX >= 0 ? 1 : -1;  // lateral neighbor (east/west)
    const dy = dirY >= 0 ? 1 : -1;  // longitudinal neighbor (south/north in UV, but +y = south)

    return [
        [dx, 0],   // lateral (east or west)
        [0, dy],   // longitudinal (north or south)
        [dx, dy],  // diagonal
    ];
}

/**
 * Copy 18's ensureDemTexture: Recreate GPU texture for tiles that have
 * DEM data but lost their GPU texture (e.g. evicted from view).
 * Returns the Texture or null.
 */
function ensureDemTexture(painter: Painter, tile: Tile): any | null {
    if (tile.demTexture) return tile.demTexture;

    const dem = tile.dem;
    if (!dem || !dem.data) return null;

    const context = painter.context;
    const gl = context.gl;
    const stride = dem.stride;
    const pixelData = dem.getPixels();

    context.pixelStoreUnpackPremultiplyAlpha.set(false);
    tile.demTexture = tile.demTexture || painter.getTileTexture(stride);
    if (tile.demTexture) {
        tile.demTexture.update(pixelData, { premultiply: false });
    } else {
        tile.demTexture = new Texture(context, pixelData, gl.RGBA, { premultiply: false });
    }
    tile.demTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
    return tile.demTexture;
}

/**
 * Context object for neighbor lookup, ported exactly from Copy 18.
 * Built once per render pass and reused for all tiles.
 */
interface NeighborLookupContext {
    painter: Painter;
    tileManager: TileManager;
    tilesByCanonical: Map<string, Tile>;
    getNeighborTile: (id: any) => Tile | null;
}

function buildNeighborContext(painter: Painter, tileManager: TileManager): NeighborLookupContext {
    const tilesByCanonical = new Map<string, Tile>();

    // Copy 18's dual-key indexing
    const indexTile = (t: Tile) => {
        if (!t.dem || !t.dem.data) return;
        tilesByCanonical.set(t.tileID.key, t);
        // Copy 18's dual-key indexing (with and without wrap)
        tilesByCanonical.set(`${t.tileID.wrap}/${t.tileID.canonical.z}/${t.tileID.canonical.x}/${t.tileID.canonical.y}`, t);
        tilesByCanonical.set(`${t.tileID.canonical.z}/${t.tileID.canonical.x}/${t.tileID.canonical.y}`, t);
    };

    // 1. Index all in-view tiles
    let inViewCount = 0;
    const inViewTiles = (tileManager as any)._inViewTiles;
    if (inViewTiles && typeof inViewTiles.getAllTiles === 'function') {
        for (const t of inViewTiles.getAllTiles()) {
            indexTile(t);
            inViewCount++;
        }
    }

    // 2. Pre-index ALL tiles from out-of-view cache
    let cacheCount = 0;
    const outOfViewCache = (tileManager as any)._outOfViewCache;
    if (outOfViewCache && outOfViewCache.data) {
        for (const cacheKey in outOfViewCache.data) {
            const entries = outOfViewCache.data[cacheKey];
            if (entries && entries.length > 0) {
                for (const entry of entries) {
                    if (entry.value) {
                        indexTile(entry.value);
                        cacheCount++;
                    }
                }
            }
        }
    }

    // === DIAGNOSTIC: Log tile index every 120 frames ===
    if (!(globalThis as any).__shadowDiag) (globalThis as any).__shadowDiag = 0;
    (globalThis as any).__shadowDiag++;
    const shouldLog = (globalThis as any).__shadowDiag % 120 === 1;
    if (shouldLog) {
        console.log(`[SHADOW-INDEX] inView=${inViewCount} cache=${cacheCount} totalKeys=${tilesByCanonical.size}`);
    }

    // Lazy neighbor finder (fallback)
    const getNeighborTile = (id: any) => {
        const neighbor = tilesByCanonical.get(id.key);
        return neighbor || null;
    };

    return { painter, tileManager, tilesByCanonical, getNeighborTile };
}

interface NeighborInfo {
    tile: Tile | null;
    zoomInfo: [number, number, number, number]; // [scale, offsetX, offsetY, zoomDiff]
}

/**
 * Ported EXACTLY from Copy 18's getNeighborTileWithZoom.
 * 6-path lookup per zoom level, 10-level parental fallback.
 */
function getNeighborTileWithZoom(ctx: NeighborLookupContext, coord: OverscaledTileID, dx: number, dy: number, explicitZoomDiff: number = -1): NeighborInfo {
    const z = coord.canonical.z;
    let wrappedX = coord.canonical.x + dx;
    let vy = coord.canonical.y + dy;
    let newWrap = coord.wrap;

    const tilesPerSide = (1 << z);
    if (wrappedX < 0) {
        wrappedX += tilesPerSide;
        newWrap--;
    } else if (wrappedX >= tilesPerSide) {
        wrappedX -= tilesPerSide;
        newWrap++;
    }

    if (vy < 0 || vy >= tilesPerSide) {
        return { tile: null, zoomInfo: [0.0, 0.0, 0.0, 0.0] };
    }

    let tile: Tile | null = null;
    let scanZ = z;

    if (explicitZoomDiff > 0) {
        if (z < 13) {
            return { tile: null, zoomInfo: [0.0, 0.0, 0.0, 0.0] };
        }
        scanZ = 12;
    }

    // Copy 18: DEEP PARENTAL FALLBACK up to 10 levels
    const minZ = explicitZoomDiff > 0 ? 12 : Math.max(0, z - 10);

    while (scanZ >= minZ) {
        const nx = Math.floor(wrappedX / (1 << (z - scanZ)));
        const ny = Math.floor(vy / (1 << (z - scanZ)));
        const wrap = newWrap;

        // Copy 18: Comprehensive 6-path lookup
        const key1 = `${wrap}/${scanZ}/${nx}/${ny}`;
        const key2 = `${scanZ}/${nx}/${ny}`;
        const key3 = `os/${scanZ}/${wrap}/${nx}/${ny}`;

        if (!(globalThis as any).__shadowDiag) (globalThis as any).__shadowDiag = 0;
        const shouldDetailLog = (globalThis as any).__shadowDiag % 120 === 1 && (dx !== 0 || dy !== 0);

        tile = ctx.tilesByCanonical.get(key1) ||
            ctx.tilesByCanonical.get(key2) ||
            ctx.tilesByCanonical.get(key3) ||
            ctx.getNeighborTile({ key: key1 } as any) ||
            ctx.getNeighborTile({ key: key2 } as any) ||
            ctx.getNeighborTile({ key: key3 } as any);

        if (shouldDetailLog && (dx === 1 && (dy === -1 || dy === 0))) {
            console.log(`[SHADOW-LOOKUP] dx=${dx} dy=${dy} z=${z} scanZ=${scanZ} nx=${nx} ny=${ny} key1=${key1} found=${!!tile}`);
        }

        if (tile) break;
        scanZ--;
    }

    if (!tile) {
        return { tile: null, zoomInfo: [0.0, 0.0, 0.0, 0.0] };
    }

    const tileZ = tile.tileID.canonical.z;
    const zoomDiff = z - tileZ;
    if (zoomDiff === 0) return { tile, zoomInfo: [1.0, 0.0, 0.0, 0.0] };

    const scale = 1.0 / (1 << zoomDiff);
    const divisor = 1 << zoomDiff;
    const offsetX = (wrappedX % divisor) / divisor;
    const offsetY = (vy % divisor) / divisor;

    return { tile, zoomInfo: [scale, offsetX, offsetY, zoomDiff] };
}

/**
 * Simple neighbor tile lookup using the full context.
 * Uses getNeighborTileWithZoom with dx/dy=0/1/-1 for same-zoom neighbor.
 */
function getNeighborTile(ctx: NeighborLookupContext, coord: OverscaledTileID, dx: number, dy: number): Tile | null {
    const info = getNeighborTileWithZoom(ctx, coord, dx, dy);
    return info.tile;
}

export function drawShadow(
    painter: Painter,
    tileManager: TileManager,
    layer: ShadowStyleLayer,
    tileIDs: Array<OverscaledTileID>,
    renderOptions: RenderOptions
) {
    if (painter.renderPass === 'offscreen') {
        // Copy 18's critical offscreen pass: ensure ALL tiles have demTexture
        // This runs BEFORE the translucent pass where neighbor tiles need textures.
        // Without this, neighbor tiles at different zoom levels may not have GPU textures.
        const context = painter.context;
        const gl = context.gl;

        for (const coord of tileIDs) {
            const tile = tileManager.getTile(coord);
            if (!tile) continue;
            const dem = tile.dem;
            if (!dem || !dem.data) continue;

            // Create demTexture if it doesn't exist (Copy 18: prepareHillshade lines 260-272)
            if (!tile.demTexture) {
                const textureStride = dem.stride;
                const pixelData = dem.getPixels();
                context.activeTexture.set(gl.TEXTURE1);
                context.pixelStoreUnpackPremultiplyAlpha.set(false);
                tile.demTexture = painter.getTileTexture(textureStride);
                if (tile.demTexture) {
                    tile.demTexture.update(pixelData, { premultiply: false });
                } else {
                    tile.demTexture = new Texture(context, pixelData, gl.RGBA, { premultiply: false });
                }
                tile.demTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
            }
        }

        // Also prepare tiles from out-of-view cache (critical for neighbor availability)
        const outOfViewCache = (tileManager as any)._outOfViewCache;
        if (outOfViewCache && outOfViewCache.data) {
            const gl = context.gl;
            for (const cacheKey in outOfViewCache.data) {
                const entries = outOfViewCache.data[cacheKey];
                if (entries && entries.length > 0) {
                    const tile = entries[0].value;
                    if (tile && tile.dem && tile.dem.data && !tile.demTexture) {
                        const textureStride = tile.dem.stride;
                        const pixelData = tile.dem.getPixels();
                        context.activeTexture.set(gl.TEXTURE1);
                        context.pixelStoreUnpackPremultiplyAlpha.set(false);
                        tile.demTexture = painter.getTileTexture(textureStride);
                        if (tile.demTexture) {
                            tile.demTexture.update(pixelData, { premultiply: false });
                        } else {
                            tile.demTexture = new Texture(context, pixelData, gl.RGBA, { premultiply: false });
                        }
                        tile.demTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
                    }
                }
            }
        }

        context.viewport.set([0, 0, painter.width, painter.height]);
        return;
    }

    if (painter.renderPass !== 'translucent') return;

    const { isRenderingToTexture } = renderOptions;
    const context = painter.context;
    const projection = painter.style.projection;
    const useSubdivision = projection.useSubdivision;

    const depthMode = painter.getDepthModeForSublayer(0, DepthMode.ReadOnly);
    const colorMode = painter.colorModeForRenderPass();

    // Pre-compute sun direction for neighbor selection
    const shadowProps = layer.getShadowProperties();
    const dirRad = shadowProps.directionRadians;
    const dirX = Math.sin(dirRad);
    const dirY = -Math.cos(dirRad);

    // Check if neighbor fetching is enabled (toggle from UI)
    const useNeighbors = (typeof (globalThis as any).__shadowUseNeighbors === 'undefined')
        ? true
        : !!(globalThis as any).__shadowUseNeighbors;

    const neighborOffsets = useNeighbors
        ? getSunFacingNeighborOffsets(dirX, dirY)
        : [[0, 0], [0, 0], [0, 0]] as Array<[number, number]>;  // No neighbors

    if (useSubdivision) {
        const [stencilBorderless, stencilBorders, coords] = painter.stencilConfigForOverlapTwoPass(tileIDs);
        renderShadowTiles(painter, tileManager, layer, coords, stencilBorderless, depthMode, colorMode, false, isRenderingToTexture, neighborOffsets);
        renderShadowTiles(painter, tileManager, layer, coords, stencilBorders, depthMode, colorMode, true, isRenderingToTexture, neighborOffsets);
    } else {
        const [stencil, coords] = painter.getStencilConfigForOverlapAndUpdateStencilID(tileIDs);
        renderShadowTiles(painter, tileManager, layer, coords, stencil, depthMode, colorMode, false, isRenderingToTexture, neighborOffsets);
    }
}

function renderShadowTiles(
    painter: Painter,
    tileManager: TileManager,
    layer: ShadowStyleLayer,
    coords: Array<OverscaledTileID>,
    stencilModes: { [_: number]: Readonly<StencilMode> },
    depthMode: Readonly<DepthMode>,
    colorMode: Readonly<ColorMode>,
    useBorder: boolean,
    isRenderingToTexture: boolean,
    neighborOffsets: Array<[number, number]>
) {
    const projection = painter.style.projection;
    const context = painter.context;
    const transform = painter.transform;
    const gl = context.gl;

    const program = painter.useProgram('shadow');
    const align = !painter.options.moving;

    // Build neighbor context once per render pass (Copy 18 approach)
    const ctx = buildNeighborContext(painter, tileManager);

    for (const coord of coords) {
        const tile = tileManager.getTile(coord);
        if (!tile || !tile.dem) {
            continue;
        }

        // Bind raw DEM texture to unit 0
        context.activeTexture.set(gl.TEXTURE0);
        if (tile.demTexture) {
            tile.demTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
        } else {
            continue; // No DEM texture available yet
        }

        // Bind 8 neighbors (N, NE, E, SE, S, SW, W, NW) to units 4-11
        // (V4.15.25: Shifted to avoid internal collisions)
        const neighborInfos = [
            getNeighborTileWithZoom(ctx, coord, 0, -1),  // N
            getNeighborTileWithZoom(ctx, coord, 1, -1),  // NE
            getNeighborTileWithZoom(ctx, coord, 1, 0),   // E
            getNeighborTileWithZoom(ctx, coord, 1, 1),   // SE
            getNeighborTileWithZoom(ctx, coord, 0, 1),   // S
            getNeighborTileWithZoom(ctx, coord, -1, 1),  // SW
            getNeighborTileWithZoom(ctx, coord, -1, 0),  // W
            getNeighborTileWithZoom(ctx, coord, -1, -1)  // NW
        ];

        const neighborZoomInfos: Array<[number, number, number, number]> = [];
        for (let i = 0; i < 8; i++) {
            const info = neighborInfos[i];

            context.activeTexture.set(gl.TEXTURE4 + i);
            const tex = info.tile ? ensureDemTexture(painter, info.tile) : null;
            if (tex) {
                tex.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
                neighborZoomInfos.push(info.zoomInfo);
            } else {
                // Fallback to center tile if neighbor missing
                const centerTex = ensureDemTexture(painter, tile);
                if (centerTex) {
                    centerTex.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
                }
                // Sentinel for shader fallback (mirroring / repeating)
                neighborZoomInfos.push([0.0, 0.0, 0.0, 0.0]);
            }
        }

        // Center Tile Raw Backup -> Unit 1
        context.activeTexture.set(gl.TEXTURE1);
        if (tile.demTexture) {
            tile.demTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
        }

        // Grandparent -> u_grandparent_dem (unit 12)
        context.activeTexture.set(gl.TEXTURE12);
        const gpInfo = getNeighborTileWithZoom(ctx, coord, 0, 0, 2);
        const gpTex = gpInfo.tile ? ensureDemTexture(painter, gpInfo.tile) : null;
        if (gpTex) {
            gpTex.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
        } else {
            const centerTex = ensureDemTexture(painter, tile);
            if (centerTex) centerTex.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
        }

        const mesh = projection.getMeshFromTileID(context, coord.canonical, useBorder, true, 'raster');

        const terrainData = painter.style.map.terrain?.getTerrainData(coord);

        const uniformValues = shadowUniformValues(
            painter, tile, layer,
            neighborZoomInfos,
            gpInfo.zoomInfo
        );

        // === DIAGNOSTIC: Log East/NE results for the FIRST tile every 120 frames ===
        if (!(globalThis as any).__shadowDiag) (globalThis as any).__shadowDiag = 0;
        const localShouldLog = (globalThis as any).__shadowDiag % 120 === 1;
        if (localShouldLog && coord === coords[0]) {
            console.log(`[SHADOW-TILE] z${coord.canonical.z} x${coord.canonical.x} y${coord.canonical.y}`);
            const ne = neighborInfos[1];
            const e = neighborInfos[2];
            console.log(`[SHADOW-NE] tile=${ne.tile ? ne.tile.tileID.key : 'MISS'} zoomInfo=${JSON.stringify(ne.zoomInfo)}`);
            console.log(`[SHADOW-E]  tile=${e.tile ? e.tile.tileID.key : 'MISS'} zoomInfo=${JSON.stringify(e.zoomInfo)}`);
        }

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

export function prepareShadow(
    painter: Painter,
    tileManager: TileManager,
    tileIDs: Array<OverscaledTileID>,
    layer: ShadowStyleLayer,
    depthMode: Readonly<DepthMode>,
    stencilMode: Readonly<StencilMode>,
    colorMode: Readonly<ColorMode>
) {
    const context = painter.context;
    const gl = context.gl;

    for (const coord of tileIDs) {
        const tile = tileManager.getTile(coord);
        const dem = tile.dem;

        if (!dem || !dem.data || !tile.needsHorizonPrepare) {
            continue;
        }

        const tileSize = dem.dim;
        const textureStride = dem.stride;

        // Ensure DEM texture is available
        if (!tile.demTexture) {
            const pixelData = dem.getPixels();
            context.pixelStoreUnpackPremultiplyAlpha.set(false);
            tile.demTexture = new Texture(context, pixelData, gl.RGBA, { premultiply: false });
            tile.demTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
        }

        // Horizon Atlas: 1 tile wide, 8 tiles high.
        // Each tile row holds 4 azimuths (RGBA), total 32 azimuths.
        const numRows = 8;
        const atlasWidth = tileSize;
        const atlasHeight = tileSize * numRows;

        let fbo = tile.horizonFBO;
        if (!fbo) {
            // Set a known active texture unit before binding, so we don't accidentally leave this
            // render texture bound on something like TEXTURE4 which might trigger a feedback loop later.
            context.activeTexture.set(gl.TEXTURE0);

            const renderTexture = new Texture(context, { width: atlasWidth, height: atlasHeight, data: null }, gl.RGBA);
            // Use NEAREST filtering to prevent bleeding between adjacent atlas rows 
            // at the Y-boundaries of the tiles.
            renderTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);

            fbo = tile.horizonFBO = context.createFramebuffer(atlasWidth, atlasHeight, true, false);
            fbo.colorAttachment.set(renderTexture.texture);
            tile.horizonTexture = renderTexture;

            // Clean up TEXTURE0 to prevent feedback loops in case another shader reads from it
            gl.bindTexture(gl.TEXTURE_2D, null);
        }

        context.bindFramebuffer.set(fbo.framebuffer);

        const program = painter.useProgram('shadowPrepare');

        // Render 8 times for the 8 slices (4 azimuths per slice)
        const totalAzimuths = 32;
        const azimuthStep = (2 * Math.PI) / totalAzimuths;

        for (let row = 0; row < numRows; row++) {
            // Set viewport to the correct row in the atlas
            context.viewport.set([0, row * tileSize, tileSize, tileSize]);

            const baseAzimuth = row * 4 * azimuthStep; // 4 azimuths per row

            // Get neighbor flags based on the center of this slice's azimuth range.
            // (Just to bind the likely needed neighbors. Or we can just bind all 3 if available)
            // For simplicity in the prep pass, we bind all 3 sun-facing neighbors for the primary azimuth
            const primaryAzimuth = baseAzimuth + 1.5 * azimuthStep; // Middle of the 4 azimuths
            const dirX = Math.sin(primaryAzimuth);
            const dirY = -Math.cos(primaryAzimuth);
            const neighborOffsets = getSunFacingNeighborOffsets(dirX, dirY);

            const prepCtx = buildNeighborContext(painter, tileManager);
            const [lateralOff, longOff, diagOff] = neighborOffsets;
            const lateralTile = (lateralOff[0] !== 0 || lateralOff[1] !== 0) ? getNeighborTile(prepCtx, coord, lateralOff[0], lateralOff[1]) : null;
            const longTile = (longOff[0] !== 0 || longOff[1] !== 0) ? getNeighborTile(prepCtx, coord, longOff[0], longOff[1]) : null;
            const diagTile = (diagOff[0] !== 0 || diagOff[1] !== 0) ? getNeighborTile(prepCtx, coord, diagOff[0], diagOff[1]) : null;

            context.activeTexture.set(gl.TEXTURE0);
            tile.demTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);

            context.activeTexture.set(gl.TEXTURE1);
            const lTex = lateralTile ? ensureDemTexture(painter, lateralTile) : null;
            if (lTex) lTex.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);

            context.activeTexture.set(gl.TEXTURE2);
            const loTex = longTile ? ensureDemTexture(painter, longTile) : null;
            if (loTex) loTex.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);

            context.activeTexture.set(gl.TEXTURE3);
            const dTex = diagTile ? ensureDemTexture(painter, diagTile) : null;
            if (dTex) dTex.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);

            const uniformValues = shadowPrepareUniformValues(
                tile, dem, baseAzimuth, azimuthStep,
                !!lateralTile, !!longTile, !!diagTile
            );

            program.draw(context, gl.TRIANGLES,
                depthMode, stencilMode, colorMode, CullFaceMode.disabled,
                uniformValues,
                null, null, layer.id, painter.rasterBoundsBuffer,
                painter.quadTriangleIndexBuffer, painter.rasterBoundsSegments);
        }

        tile.needsHorizonPrepare = false;
    }
}
