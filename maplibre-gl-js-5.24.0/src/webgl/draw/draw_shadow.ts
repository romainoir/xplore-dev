import { StencilMode } from '../stencil_mode';
import { DepthMode } from '../depth_mode';
import { CullFaceMode } from '../cull_face_mode';
import { ColorMode } from '../color_mode';
import { shadowUniformValues, shadowGlobalUniformValues, shadowBlurUniforms } from '../program/shadow_program';
import { prepareHorizonAtlasForCurrentView } from './draw_daylight';
import { shadowPrepareUniformValues } from '../program/shadow_prepare_program';
// calculateTileKey no longer needed — using canonical z/x/y index instead
import { Color } from '@maplibre/maplibre-gl-style-spec';
import { Texture } from '../texture';
import { Framebuffer } from '../framebuffer';

import type { Painter, RenderOptions } from '../../render/painter';
import type { TileManager } from '../../tile/tile_manager';
import type { ShadowStyleLayer } from '../../style/style_layer/shadow_style_layer';
import type { OverscaledTileID } from '../../tile/tile_id';
import type { Tile } from '../../tile/tile';

/**
 * Determine the 3 sun-facing neighbor offsets based on sun direction.
 * The sun direction vector [dirX, dirY] points toward the sun in UV space
 * (x = east, y = south). We need to trace toward the sun, so we pick
 * neighbors in the direction the sun is coming from.
 *
 * Returns [lateral, longitudinal, diagonal] offsets as [dx, dy].
 */
export function getSunFacingNeighborOffsets(dirX: number, dirY: number): Array<[number, number]> {
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

export function buildNeighborContext(painter: Painter, tileManager: TileManager): NeighborLookupContext {
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
export function getNeighborTileWithZoom(ctx: NeighborLookupContext, coord: OverscaledTileID, dx: number, dy: number, explicitZoomDiff: number = -1): NeighborInfo {
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
            // console.log(`[SHADOW-LOOKUP] dx=${dx} dy=${dy} z=${z} scanZ=${scanZ} nx=${nx} ny=${ny} key1=${key1} found=${!!tile}`);
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
    const terrain = painter.style.map.terrain;
    const isCoarseGlobalShadow = layer.id.toLowerCase().indexOf('coarse') !== -1;
    const cameraRefreshHeld = typeof window !== 'undefined' && (window as any)._shadowCameraRefreshHold;
    const cameraMoving = (painter.options.moving || cameraRefreshHeld) && !(typeof window !== 'undefined' && (window as any)._isInteractingWithTime);
    const useHorizonCurrentShadow = typeof window !== 'undefined' && (window as any)._shadowUseHorizonCurrent === true;
    const shadowAtlasReady = !!((terrain as any)?._shadowAtlasReady);
    const horizonAtlasReady = !!((terrain as any)?._horizonAtlasReady);
    const hasReusableCurrentShadow = shadowAtlasReady || (useHorizonCurrentShadow && horizonAtlasReady);
    const canUseCachedShadow = cameraMoving && isCoarseGlobalShadow && hasReusableCurrentShadow;

    if (painter.renderPass === 'offscreen') {
        if (isCoarseGlobalShadow && useHorizonCurrentShadow && !!(terrain as any)?._elevationAtlasBounds) {
            if (typeof window !== 'undefined' && (window as any)._shadowTileDebugEnabled) {
                (window as any)._shadowOffscreenDebug = {
                    layer: layer.id,
                    skippedHorizonCurrentShadow: true,
                    inputTiles: tileIDs.length,
                    timestamp: performance.now()
                };
            }
            return;
        }

        if (canUseCachedShadow) {
            if (typeof window !== 'undefined' && (window as any)._shadowTileDebugEnabled) {
                (window as any)._shadowOffscreenDebug = {
                    layer: layer.id,
                    skippedCachedWhileMoving: true,
                    refreshHeld: !!cameraRefreshHeld,
                    inputTiles: tileIDs.length,
                    timestamp: performance.now()
                };
            }
            return;
        }

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
    if (isRenderingToTexture && isCoarseGlobalShadow) return;

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

    // OPTIMIZATION: If this is the coarse shadow layer (Z12), use the Global Sweep pass.
    // This kills the O(N^2) neighbor-sampling redundancy and tile-loop overhead.
    if (layer.id.toLowerCase().indexOf('coarse') !== -1) {
        if (isRenderingToTexture) return;

        const terrain = painter.style.map.terrain;
        const cameraRefreshHeld = typeof window !== 'undefined' && (window as any)._shadowCameraRefreshHold;
        const cameraMoving = (painter.options.moving || cameraRefreshHeld) && !(typeof window !== 'undefined' && (window as any)._isInteractingWithTime);
        const useHorizonCurrentShadow = typeof window !== 'undefined' && (window as any)._shadowUseHorizonCurrent === true;
        const shadowAtlasReady = !!((terrain as any)?._shadowAtlasReady);
        const horizonAtlasReady = !!((terrain as any)?._horizonAtlasReady);
        const hasReusableCurrentShadow = shadowAtlasReady || (useHorizonCurrentShadow && horizonAtlasReady);
        if (cameraMoving && hasReusableCurrentShadow) {
            (terrain as any)._shadowAtlasReusedWhileMoving = true;
            if (typeof window !== 'undefined' && (window as any)._shadowTileDebugEnabled) {
                (window as any)._shadowPassDebug = {
                    skipped: true,
                    reason: cameraRefreshHeld ? 'cached shadow during post-move settle' : 'cached shadow while camera moving',
                    refreshHeld: !!cameraRefreshHeld,
                    durationMs: 0,
                    timestamp: performance.now()
                };
            }
            return;
        }
        drawGlobalShadow(painter, layer);
        return;
    }

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

        // Neighbors -> Units 4-11 (Clockwise from North)
        const neighborZoomInfos: Array<[number, number, number, number]> = [];
        const isGPDebug = (globalThis as any)._shadowDebugMode === 2;
        const shadowMode = (globalThis as any)._shadowMode || 0; // 0: 8-neighbors, 1: 3-neighbors

        if (shadowMode === 0 || isGPDebug) {
            const gpJump = coord.canonical.z > 12 ? (1 << (coord.canonical.z - 12)) : 1;

            for (let i = 0; i < 3; i++) {
                context.activeTexture.set(gl.TEXTURE4 + i);
                const off = neighborOffsets[i];

                // If GP debug mode is on, we fetch Z12 neighbors instead of local ones
                const info = isGPDebug
                    ? getNeighborTileWithZoom(ctx, coord, off[0] * gpJump, off[1] * gpJump, 2)
                    : getNeighborTileWithZoom(ctx, coord, off[0], off[1]);

                const tex = info.tile ? ensureDemTexture(painter, info.tile) : null;
                if (tex) {
                    tex.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
                    neighborZoomInfos.push(info.zoomInfo);
                } else {
                    // Fallback to center tile if neighbor missing
                    const centerTex = ensureDemTexture(painter, tile);
                    if (centerTex) centerTex.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
                    neighborZoomInfos.push([0.0, 0.0, 0.0, 0.0]);
                }
            }
        } else {
            for (let i = 0; i < 3; i++) neighborZoomInfos.push([0.0, 0.0, 0.0, 0.0]);
        }

        // Center Tile Raw Backup -> Unit 1
        context.activeTexture.set(gl.TEXTURE1);
        if (tile.demTexture) {
            tile.demTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
        }

        // Grandparent -> u_grandparent_dem (unit 12)
        const gpJump = coord.canonical.z > 12 ? (1 << (coord.canonical.z - 12)) : 1;
        const gpInfo = getNeighborTileWithZoom(ctx, coord, 0, 0, 2);
        let gpZoomInfo: [number, number, number, number] = [0.0, 0.0, 0.0, 0.0];

        context.activeTexture.set(gl.TEXTURE12);
        const gpTex = gpInfo.tile ? ensureDemTexture(painter, gpInfo.tile) : null;
        if (gpTex) {
            gpTex.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
            gpZoomInfo = gpInfo.zoomInfo;
        } else {
            const centerTex = ensureDemTexture(painter, tile);
            if (centerTex) centerTex.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
        }

        // Bind 3 sun-facing neighbors (Lateral, Longitudinal, Diagonal) for GP
        const sunDirProperties = layer.getShadowProperties();
        const sdirX = Math.sin(sunDirProperties.directionRadians);
        const sdirY = -Math.cos(sunDirProperties.directionRadians);

        // GP Neighbors -> units 13-15
        const gpNeighborZoomInfos: Array<[number, number, number, number]> = [];
        const gpOffsets = getSunFacingNeighborOffsets(sdirX, sdirY);
        for (let i = 0; i < 3; i++) {
            const off = gpOffsets[i];
            const info = getNeighborTileWithZoom(ctx, coord, off[0] * gpJump, off[1] * gpJump, 2);
            context.activeTexture.set(gl.TEXTURE13 + i);
            const tex = info.tile ? ensureDemTexture(painter, info.tile) : null;
            if (tex) {
                tex.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
                gpNeighborZoomInfos.push(info.zoomInfo);
            } else {
                // Dummy fallback to GP center
                if (gpTex) gpTex.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
                gpNeighborZoomInfos.push([0.0, 0.0, 0.0, 0.0]);
            }
        }

        const mesh = projection.getMeshFromTileID(context, coord.canonical, useBorder, true, 'raster');

        const terrainData = painter.style.map.terrain?.getTerrainData(coord);

        const uniformValues = shadowUniformValues(
            painter, tile, layer,
            neighborZoomInfos,
            gpZoomInfo,
            gpNeighborZoomInfos
        );

        if (!(globalThis as any).__shadowDiag) (globalThis as any).__shadowDiag = 0;
        (globalThis as any).__shadowDiag++;

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

/**
 * Draw Global Screen-Space Shadows (Zero Redundancy Z12 Pass)
 */
type ShadowAtlasTarget = 'global' | 'near';

function markShadowAtlasReady(terrain: any, isNearAtlas: boolean) {
    if (isNearAtlas) {
        terrain._shadowNearAtlasReady = true;
        terrain._shadowNearAtlasReadyAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        return;
    }

    terrain._shadowAtlasReady = true;
    terrain._shadowAtlasReusedWhileMoving = false;
}

function isShadowV3Active(): boolean {
    return typeof window !== 'undefined' &&
        (window as any).imageryState?.get?.('shadow-v3')?.enabled === true &&
        ((window as any).imageryState?.get?.('shadow-v3')?.opacity ?? 1) > 0;
}

function ensureShadowHiZResources(painter: Painter, terrain: any, baseSize: number): {
    textures: Array<Texture>;
    fbos: Array<Framebuffer>;
    sizes: Array<number>;
} | null {
    const context = painter.context;
    const gl = context.gl;
    const levels = 5;
    const sizes: Array<number> = [];
    for (let i = 0; i < levels; i++) {
        sizes.push(Math.max(1, Math.floor(baseSize / Math.pow(2, i + 1))));
    }

    const currentBaseSize = terrain._shadowHiZBaseSize;
    const currentTextures = terrain._shadowHiZTextures as Array<Texture> | undefined;
    const currentFbos = terrain._shadowHiZFbos as Array<Framebuffer> | undefined;
    const resourcesValid = currentBaseSize === baseSize &&
        currentTextures?.length === levels &&
        currentFbos?.length === levels &&
        currentTextures.every((texture, index) => texture?.size?.[0] === sizes[index]);

    if (!resourcesValid) {
        if (typeof terrain._destroyShadowHiZ === 'function') {
            terrain._destroyShadowHiZ();
        }
        terrain._shadowHiZTextures = [];
        terrain._shadowHiZFbos = [];
        terrain._shadowHiZBaseSize = baseSize;

        for (const size of sizes) {
            const texture = new Texture(context, { width: size, height: size, data: null }, gl.RGBA, { premultiply: false });
            texture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
            const fbo = context.createFramebuffer(size, size, false, false);
            fbo.colorAttachment.set(texture.texture);
            terrain._shadowHiZTextures.push(texture);
            terrain._shadowHiZFbos.push(fbo);
        }
    }

    if (!terrain._shadowHiZTextures || !terrain._shadowHiZFbos) {
        return null;
    }

    return {
        textures: terrain._shadowHiZTextures,
        fbos: terrain._shadowHiZFbos,
        sizes
    };
}

function drawShadowHiZMips(
    painter: Painter,
    terrain: any,
    elevationTexture: Texture,
    depthMode: DepthMode,
    stencilMode: StencilMode,
    colorMode: ColorMode
): {levels: Array<number>; durationMs: number} {
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const context = painter.context;
    const gl = context.gl;
    const resources = ensureShadowHiZResources(painter, terrain, elevationTexture.size[0]);
    if (!resources) {
        return {levels: [], durationMs: 0};
    }

    const program = painter.useProgram('shadowHizMip');
    let readTexture = elevationTexture;
    let readSize = elevationTexture.size[0];

    for (let i = 0; i < resources.textures.length; i++) {
        const writeSize = resources.sizes[i];
        context.bindFramebuffer.set(resources.fbos[i].framebuffer);
        context.viewport.set([0, 0, writeSize, writeSize]);
        context.clear({ color: Color.transparent });

        context.activeTexture.set(gl.TEXTURE0);
        readTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);

        program.draw(context, gl.TRIANGLES, depthMode, stencilMode, colorMode, CullFaceMode.disabled,
            { 'u_image': 0, 'u_src_dimension': [readSize, readSize] }, null, null, 'shadow-hiz-mip',
            painter.rasterBoundsBuffer, painter.quadTriangleIndexBuffer, painter.rasterBoundsSegments);

        readTexture = resources.textures[i];
        readSize = writeSize;
    }

    return {
        levels: resources.sizes,
        durationMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start
    };
}

function drawGlobalShadowHiZ(
    painter: Painter,
    layer: ShadowStyleLayer,
    target: ShadowAtlasTarget,
    options: {
        terrain: any;
        elevationTexture: Texture;
        atlasBounds: Array<number>;
        rawAtlasPixelSize: number;
        uniformValues: any;
        depthMode: DepthMode;
        stencilMode: StencilMode;
        colorMode: ColorMode;
    }
): {hizLevels: Array<number>; mipMs: number; drawMs: number} {
    const drawStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const context = painter.context;
    const gl = context.gl;
    const resources = ensureShadowHiZResources(painter, options.terrain, options.elevationTexture.size[0]);
    if (!resources) {
        return {hizLevels: [], mipMs: 0, drawMs: 0};
    }

    const mipDebug = drawShadowHiZMips(painter, options.terrain, options.elevationTexture, options.depthMode, options.stencilMode, options.colorMode);
    const rawShadowFbo = options.terrain.getFramebuffer(target === 'near' ? 'near_shadow_blur' : 'shadow_blur');

    context.bindFramebuffer.set(rawShadowFbo.framebuffer);
    context.viewport.set([0, 0, options.rawAtlasPixelSize, options.rawAtlasPixelSize]);
    context.clear({ color: Color.transparent });

    context.activeTexture.set(gl.TEXTURE0);
    options.elevationTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
    for (let i = 0; i < resources.textures.length; i++) {
        context.activeTexture.set(gl.TEXTURE0 + i + 1);
        resources.textures[i].bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
    }

    const values = options.uniformValues;
    const program = painter.useProgram('shadowHizGlobal');
    program.draw(context, gl.TRIANGLES, options.depthMode, options.stencilMode, options.colorMode, CullFaceMode.disabled, {
        'u_image': 0,
        'u_hiz1': 1,
        'u_hiz2': 2,
        'u_hiz3': 3,
        'u_hiz4': 4,
        'u_hiz5': 5,
        'u_sunDirection': values['u_sunDirection'],
        'u_sunAltitude': values['u_sunAltitude'],
        'u_metersPerPixel': values['u_metersPerPixel'],
        'u_dimension': [options.elevationTexture.size[0], options.elevationTexture.size[1]],
        'u_atlas_bounds': options.atlasBounds,
        'u_max_distance': values['u_max_distance'],
        'u_step_meters': values['u_step_meters'],
        'u_max_steps': values['u_max_steps'],
        'u_near_cascade_distance': values['u_near_cascade_distance'],
        'u_mid_cascade_distance': values['u_mid_cascade_distance']
    }, null, null, layer.id, painter.rasterBoundsBuffer, painter.quadTriangleIndexBuffer, painter.rasterBoundsSegments);

    return {
        hizLevels: mipDebug.levels,
        mipMs: mipDebug.durationMs,
        drawMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - drawStart - mipDebug.durationMs
    };
}

export function drawGlobalShadow(
    painter: Painter,
    layer: ShadowStyleLayer,
    target: ShadowAtlasTarget = 'global'
) {
    const isNearAtlas = target === 'near';
    const debugEnabled = typeof window !== 'undefined' && (window as any)._shadowTileDebugEnabled;
    const debugStart = debugEnabled ? performance.now() : 0;
    const context = painter.context;
    const gl = context.gl;

    const terrain = painter.style.map.terrain;
    const elevationTexture = isNearAtlas ? terrain?._fboNearElevationTexture : terrain?._fboElevationTexture;
    const shadowTexture = isNearAtlas ? terrain?._fboNearShadowTexture : terrain?._fboShadowTexture;
    if (!terrain || !elevationTexture || !shadowTexture) {
        console.warn(`[ATLAS] drawGlobalShadow: missing FBO textures. target=${target}, Terrain: ${!!terrain}, ElevationTex: ${!!elevationTexture}, ShadowTex: ${!!shadowTexture}`);
        return;
    }

    const colorMode = painter.colorModeForRenderPass();
    const depthMode = DepthMode.disabled;
    const stencilMode = StencilMode.disabled;

    const useHorizonCurrentShadow = typeof window !== 'undefined' && (window as any)._shadowUseHorizonCurrent === true;
    if (!isNearAtlas && useHorizonCurrentShadow) {
        const horizonKey = prepareHorizonAtlasForCurrentView(painter, depthMode, stencilMode, colorMode);
        if (horizonKey && (terrain as any)._horizonAtlasReady) {
            context.bindFramebuffer.set(null);
            context.viewport.set([0, 0, painter.width, painter.height]);
            markShadowAtlasReady(terrain, false);
            if (debugEnabled) {
                (window as any)._shadowPassDebug = {
                    skipped: true,
                    reason: 'current shadow from horizon atlas',
                    horizonKey,
                    durationMs: performance.now() - debugStart,
                    timestamp: performance.now()
                };
            }
            return;
        }
    }

    // 1. Calculate Atlas-space scales
    const atlasBounds = isNearAtlas ?
        (terrain as any)._shadowNearAtlasBounds :
        (terrain as any)._elevationAtlasBounds; // [minX, minY, maxX, maxY] in 0..1 world
    if (!atlasBounds) {
        console.warn(`[ATLAS] drawGlobalShadow: no ${isNearAtlas ? '_shadowNearAtlasBounds' : '_elevationAtlasBounds'} set`);
        return;
    }

    const worldCircumference = 40075016.7;
    const atlasWorldWidth = atlasBounds[2] - atlasBounds[0];
    const atlasWorldHeight = atlasBounds[3] - atlasBounds[1];
    const elevationAtlasPixelSize = elevationTexture.size[0];
    const atlasPixelSize = shadowTexture.size[0]; // Square shadow mask atlas
    const rawShadowFbo = terrain.getFramebuffer(isNearAtlas ? 'near_shadow_blur' : 'shadow_blur');
    const shadowBlurTexture = isNearAtlas ? terrain._fboNearShadowBlurTexture : terrain._fboShadowBlurTexture;
    const rawAtlasPixelSize = shadowBlurTexture?.size?.[0] || atlasPixelSize;

    // Per-axis meters per raw-shadow pixel. The final atlas stays 2K, but
    // the raw mask can be lower-res and bilinearly upsampled to remove
    // terrain-tile stair steps without reducing long-distance shadow reach.
    const metersPerPixelX = (atlasWorldWidth * worldCircumference) / rawAtlasPixelSize;
    const metersPerPixelY = (atlasWorldHeight * worldCircumference) / rawAtlasPixelSize;


    const uniformValues = shadowGlobalUniformValues(painter, layer, metersPerPixelX, metersPerPixelY, {
        atlasBounds,
        elevationAtlasSize: elevationAtlasPixelSize,
        target
    });

    // 2. Render the raw mask into a lower-res FBO, then upsample into the
    // final 2K shadow atlas with LINEAR filtering.
    context.bindFramebuffer.set(rawShadowFbo.framebuffer);
    context.viewport.set([0, 0, rawAtlasPixelSize, rawAtlasPixelSize]);
    context.clear({ color: Color.transparent }); // Clear to no shadow (0)

    const opacity = layer.paint.get('shadow-opacity') as number;
    if (typeof opacity === 'number' && opacity <= 0.003 && (globalThis as any)._shadowDebugMode !== 2) {
        context.bindFramebuffer.set(terrain.getFramebuffer(isNearAtlas ? 'near_shadow' : 'shadow').framebuffer);
        context.viewport.set([0, 0, atlasPixelSize, atlasPixelSize]);
        context.clear({ color: Color.transparent });
        context.bindFramebuffer.set(null);
        context.viewport.set([0, 0, painter.width, painter.height]);
        markShadowAtlasReady(terrain, isNearAtlas);
        if (debugEnabled) {
            (window as any)[isNearAtlas ? '_shadowNearPassDebug' : '_shadowPassDebug'] = {
                skipped: true,
                reason: 'shadow opacity <= 0',
                target,
                durationMs: performance.now() - debugStart,
                atlasPixelSize,
                timestamp: performance.now()
            };
        }
        return;
    }

    // Bind Elevation Atlas to Unit 0
    context.activeTexture.set(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, elevationTexture.texture);

    const progressivePhase = typeof window !== 'undefined' ? (window as any)._shadowProgressivePhase : '';
    const isProgressivePreview = progressivePhase === 'preview';
    const useLogSweep = typeof window !== 'undefined' && (window as any)._shadowUseLogSweep === true;
    const useHiZ = isShadowV3Active() && typeof window !== 'undefined' && (window as any)._shadowV3UseHiZ === true;
    if (useHiZ) {
        const hizDebug = drawGlobalShadowHiZ(painter, layer, target, {
            terrain,
            elevationTexture,
            atlasBounds,
            rawAtlasPixelSize,
            uniformValues,
            depthMode,
            stencilMode,
            colorMode
        });
        const upsampleStart = debugEnabled ? performance.now() : 0;
        drawGlobalShadowUpsample(painter, target);
        const upsampleMs = debugEnabled ? performance.now() - upsampleStart : 0;

        context.bindFramebuffer.set(null);
        context.viewport.set([0, 0, painter.width, painter.height]);
        markShadowAtlasReady(terrain, isNearAtlas);

        if (debugEnabled) {
            (window as any)[isNearAtlas ? '_shadowNearPassDebug' : '_shadowPassDebug'] = {
                target,
                algorithm: 'hiz-max-mip',
                durationMs: performance.now() - debugStart,
                hizMipMs: hizDebug.mipMs,
                hizDrawMs: hizDebug.drawMs,
                hizLevels: hizDebug.hizLevels,
                upsampleMs,
                maxSteps: uniformValues['u_max_steps'],
                stepMeters: uniformValues['u_step_meters'],
                maxDistance: uniformValues['u_max_distance'],
                atlasPixelSize,
                rawAtlasPixelSize,
                rawToFinalScale: atlasPixelSize / Math.max(rawAtlasPixelSize, 1),
                elevationAtlasPixelSize,
                metersPerPixelX,
                metersPerPixelY,
                progressivePhase: isProgressivePreview ? 'preview' : progressivePhase === 'full' ? 'full' : 'stable',
                timestamp: performance.now()
            };
        }
        return;
    }
    if (useLogSweep) {
        const sweepStart = debugEnabled ? performance.now() : 0;
        const sweepDebug = drawGlobalShadowSweep(painter, target, {
            atlasBounds,
            metersPerPixelX,
            metersPerPixelY,
            maxDistance: Number(uniformValues['u_max_distance']) || 5000,
            sunDirection: uniformValues['u_sunDirection'] as [number, number],
            sunAltitude: Number(uniformValues['u_sunAltitude']) || 0
        });
        const sweepMs = debugEnabled ? performance.now() - sweepStart : 0;

        context.bindFramebuffer.set(null);
        context.viewport.set([0, 0, painter.width, painter.height]);
        markShadowAtlasReady(terrain, isNearAtlas);

        if (debugEnabled) {
            (window as any)[isNearAtlas ? '_shadowNearPassDebug' : '_shadowPassDebug'] = {
                target,
                algorithm: 'log-sweep',
                durationMs: performance.now() - debugStart,
                sweepMs,
                passes: sweepDebug.passes,
                maxSweepPixels: sweepDebug.maxSweepPixels,
                maxDistance: uniformValues['u_max_distance'],
                atlasPixelSize,
                rawAtlasPixelSize: atlasPixelSize,
                rawToFinalScale: 1,
                elevationAtlasPixelSize,
                metersPerPixelX,
                metersPerPixelY,
                progressivePhase: isProgressivePreview ? 'preview' : progressivePhase === 'full' ? 'full' : 'stable',
                timestamp: performance.now()
            };
        }
        return;
    }

    if (!(globalThis as any)._shadowLogThrottle) (globalThis as any)._shadowLogThrottle = 0;
    if ((globalThis as any)._shadowLogThrottle++ % 60 === 0 || !((painter as any)._wasInteracting)) {
        // console.log(`[SHADOW] drawGlobalShadow triggered. maxSteps=${uniformValues['u_max_steps']}, stepMeters=${uniformValues['u_step_meters']}`);
    }

    const program = painter.useProgram('shadowGlobal');

    // Use painter's built-in quad buffers
    program.draw(context, gl.TRIANGLES, depthMode, stencilMode, colorMode, CullFaceMode.disabled,
        uniformValues, null, null, layer.id, painter.rasterBoundsBuffer,
        painter.quadTriangleIndexBuffer, painter.rasterBoundsSegments);

    // Bilinear upsample is the edge cleanup: it keeps the final atlas at 2K
    // for terrain sampling, but avoids exposing raw 1:1 mask stair steps.
    const upsampleStart = debugEnabled ? performance.now() : 0;
    drawGlobalShadowUpsample(painter, target);
    const upsampleMs = debugEnabled ? performance.now() - upsampleStart : 0;

    // Unbind FBO to prevent feedback loop when terrain shader samples the shadow texture
    context.bindFramebuffer.set(null);
    context.viewport.set([0, 0, painter.width, painter.height]);
    markShadowAtlasReady(terrain, isNearAtlas);

    if (debugEnabled) {
        (window as any)[isNearAtlas ? '_shadowNearPassDebug' : '_shadowPassDebug'] = {
            target,
            durationMs: performance.now() - debugStart,
            blurMs: upsampleMs,
            upsampleMs,
            maxSteps: uniformValues['u_max_steps'],
            stepMeters: uniformValues['u_step_meters'],
            maxDistance: uniformValues['u_max_distance'],
            atlasPixelSize,
            rawAtlasPixelSize,
            rawToFinalScale: atlasPixelSize / Math.max(rawAtlasPixelSize, 1),
            elevationAtlasPixelSize,
            metersPerPixelX,
            metersPerPixelY,
            progressivePhase: isProgressivePreview ? 'preview' : progressivePhase === 'full' ? 'full' : 'stable',
            timestamp: performance.now()
        };
    }
}

function drawGlobalShadowSweep(
    painter: Painter,
    target: ShadowAtlasTarget,
    options: {
        atlasBounds: [number, number, number, number] | number[];
        metersPerPixelX: number;
        metersPerPixelY: number;
        maxDistance: number;
        sunDirection: [number, number];
        sunAltitude: number;
    }
): {passes: number; maxSweepPixels: number} {
    const context = painter.context;
    const gl = context.gl;
    const terrainInstance = painter.style.map.terrain;
    const isNearAtlas = target === 'near';
    const elevationTexture = isNearAtlas ? terrainInstance?._fboNearElevationTexture : terrainInstance?._fboElevationTexture;
    const shadowTexture = isNearAtlas ? terrainInstance?._fboNearShadowTexture : terrainInstance?._fboShadowTexture;
    const stateTexture = isNearAtlas ? terrainInstance?._fboNearShadowBlurTexture : terrainInstance?._fboShadowBlurTexture;
    if (!terrainInstance || !elevationTexture || !shadowTexture || !stateTexture) {
        return {passes: 0, maxSweepPixels: 0};
    }

    const size = shadowTexture.size[0];
    const stateSize = stateTexture.size[0];
    const drawSize = Math.min(size, stateSize);
    const colorMode = ColorMode.unblended;
    const depthMode = DepthMode.disabled;
    const stencilMode = StencilMode.disabled;
    const cullMode = CullFaceMode.disabled;

    // Prefix-sweep state is packed RGBA height data, so all intermediate reads
    // must use nearest filtering. The final visibility mask is restored to
    // linear filtering for terrain sampling below.
    context.activeTexture.set(gl.TEXTURE0);
    elevationTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
    stateTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
    shadowTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);

    const stateFboName = isNearAtlas ? 'near_shadow_blur' : 'shadow_blur';
    const shadowFboName = isNearAtlas ? 'near_shadow' : 'shadow';
    const stateFbo = terrainInstance.getFramebuffer(stateFboName);
    const shadowFbo = terrainInstance.getFramebuffer(shadowFboName);

    const initProgram = painter.useProgram('shadowSweepInit');
    context.bindFramebuffer.set(stateFbo.framebuffer);
    context.viewport.set([0, 0, drawSize, drawSize]);
    context.clear({ color: Color.transparent });
    context.activeTexture.set(gl.TEXTURE0);
    elevationTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
    initProgram.draw(context, gl.TRIANGLES, depthMode, stencilMode, colorMode, cullMode,
        { 'u_image': 0, 'u_dimension': [elevationTexture.size[0], elevationTexture.size[1]] }, null, null, 'shadow-sweep-init',
        painter.rasterBoundsBuffer, painter.quadTriangleIndexBuffer, painter.rasterBoundsSegments);

    const minPixelMeters = Math.max(1, Math.min(options.metersPerPixelX, options.metersPerPixelY));
    const maxSweepPixels = Math.max(1, Math.min(drawSize, Math.ceil(options.maxDistance / minPixelMeters)));
    const maxPasses = Math.ceil(Math.log2(drawSize)) + 1;
    let passes = Math.max(2, Math.min(maxPasses, Math.ceil(Math.log2(maxSweepPixels + 1))));
    if (passes % 2 !== 0) {
        passes = Math.min(maxPasses, passes + 1);
    }
    if (passes % 2 !== 0 && passes > 2) {
        passes--;
    }

    const stepProgram = painter.useProgram('shadowSweepStep');
    let readTexture = stateTexture;
    let writeFbo = shadowFbo;
    let writeTexture = shadowTexture;

    for (let i = 0; i < passes; i++) {
        context.bindFramebuffer.set(writeFbo.framebuffer);
        context.viewport.set([0, 0, drawSize, drawSize]);
        context.clear({ color: Color.transparent });

        context.activeTexture.set(gl.TEXTURE0);
        readTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);

        stepProgram.draw(context, gl.TRIANGLES, depthMode, stencilMode, colorMode, cullMode, {
            'u_state': 0,
            'u_sunDirection': options.sunDirection,
            'u_sunAltitude': options.sunAltitude,
            'u_metersPerPixel': [options.metersPerPixelX, options.metersPerPixelY],
            'u_dimension': [drawSize, drawSize],
            'u_atlas_bounds': options.atlasBounds,
            'u_jump_pixels': Math.pow(2, i)
        }, null, null, 'shadow-sweep-step',
        painter.rasterBoundsBuffer, painter.quadTriangleIndexBuffer, painter.rasterBoundsSegments);

        if (writeTexture === shadowTexture) {
            readTexture = shadowTexture;
            writeTexture = stateTexture;
            writeFbo = stateFbo;
        } else {
            readTexture = stateTexture;
            writeTexture = shadowTexture;
            writeFbo = shadowFbo;
        }
    }

    // The pass count is kept even, so the final packed score should live in
    // stateTexture. If a browser-specific change ever breaks that invariant,
    // fall back to the last read texture and avoid feedback by writing to the
    // alternate state first would be the next step.
    const finalScoreTexture = readTexture;
    const finalProgram = painter.useProgram('shadowSweepFinal');
    context.bindFramebuffer.set(shadowFbo.framebuffer);
    context.viewport.set([0, 0, size, size]);
    context.clear({ color: Color.transparent });
    context.activeTexture.set(gl.TEXTURE0);
    finalScoreTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
    context.activeTexture.set(gl.TEXTURE1);
    elevationTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
    finalProgram.draw(context, gl.TRIANGLES, depthMode, stencilMode, colorMode, cullMode, {
        'u_state': 0,
        'u_elevation': 1,
        'u_dimension': [elevationTexture.size[0], elevationTexture.size[1]],
        'u_metersPerPixel': [options.metersPerPixelX, options.metersPerPixelY]
    }, null, null, 'shadow-sweep-final',
    painter.rasterBoundsBuffer, painter.quadTriangleIndexBuffer, painter.rasterBoundsSegments);

    context.activeTexture.set(gl.TEXTURE0);
    shadowTexture.bind(gl.LINEAR, gl.CLAMP_TO_EDGE);
    stateTexture.bind(gl.LINEAR, gl.CLAMP_TO_EDGE);

    return {passes, maxSweepPixels};
}

function drawGlobalShadowUpsample(painter: Painter, target: ShadowAtlasTarget = 'global') {
    const context = painter.context;
    const gl = context.gl;
    const terrainInstance = painter.style.map.terrain;
    const isNearAtlas = target === 'near';
    const shadowTexture = isNearAtlas ? terrainInstance?._fboNearShadowTexture : terrainInstance?._fboShadowTexture;
    const shadowBlurTexture = isNearAtlas ? terrainInstance?._fboNearShadowBlurTexture : terrainInstance?._fboShadowBlurTexture;
    if (!terrainInstance || !shadowTexture || !shadowBlurTexture) return;

    const finalSize = shadowTexture.size[0];
    const rawSize = shadowBlurTexture.size[0];
    const program = painter.useProgram('shadowBlur');
    const edgeCleanup = typeof window === 'undefined' || (window as any)._shadowEdgeCleanup !== false;
    const shadowV2Active = typeof window !== 'undefined' &&
        (((window as any).imageryState?.get?.('shadow-v2')?.enabled === true &&
        ((window as any).imageryState?.get?.('shadow-v2')?.opacity ?? 1) > 0) ||
        ((window as any).imageryState?.get?.('shadow-v3')?.enabled === true &&
        ((window as any).imageryState?.get?.('shadow-v3')?.opacity ?? 1) > 0));
    const cleanupRadius = edgeCleanup ?
        (shadowV2Active ? (isNearAtlas ? 0.28 : 0.42) : (isNearAtlas ? 0.55 : 0.85)) :
        0.0;

    context.bindFramebuffer.set(terrainInstance.getFramebuffer(isNearAtlas ? 'near_shadow' : 'shadow').framebuffer);
    context.viewport.set([0, 0, finalSize, finalSize]);
    context.clear({ color: Color.transparent });

    context.activeTexture.set(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, shadowBlurTexture.texture);

    program.draw(context, gl.TRIANGLES,
        DepthMode.disabled, StencilMode.disabled, ColorMode.unblended, CullFaceMode.disabled,
        { 'u_image': 0, 'u_direction': [0.0, 0.0], 'u_texture_size': rawSize, 'u_blur_radius': cleanupRadius }, null, null, 'shadow-upsample',
        painter.rasterBoundsBuffer, painter.quadTriangleIndexBuffer, painter.rasterBoundsSegments);
}

/**
 * Executes a 2-pass Gaussian blur (Horizontal + Vertical) on the Shadow Atlas.
 * Pass 1: u_shadow_atlas -> u_shadow_blur_atlas (Horizontal)
 * Pass 2: u_shadow_blur_atlas -> u_shadow_atlas (Vertical)
 */
export function drawGlobalShadowBlur(painter: Painter) {
    const context = painter.context;
    const gl = context.gl;
    const terrainInstance = painter.style.map.terrain;
    if (!terrainInstance || !terrainInstance._fboShadowTexture || !terrainInstance._fboShadowBlurTexture) return;

    const fboWidth = terrainInstance._fboShadowTexture.size[0];
    const fboHeight = terrainInstance._fboShadowTexture.size[1];
    const blurRadius = typeof window !== 'undefined' && Number.isFinite((window as any)._shadowBlurRadius) ?
        Number((window as any)._shadowBlurRadius) :
        2.75;
    const program = painter.useProgram('shadowBlur');
    const colorMode = ColorMode.unblended;
    const depthMode = DepthMode.disabled;
    const stencilMode = StencilMode.disabled;

    // --- Pass 1: Horizontal Blur ---
    // Target: shadow_blur FBO
    context.bindFramebuffer.set(terrainInstance.getFramebuffer('shadow_blur').framebuffer);
    context.viewport.set([0, 0, fboWidth, fboHeight]);

    // Input: Original shadow texture (unit 0)
    context.activeTexture.set(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, terrainInstance._fboShadowTexture.texture);

    program.draw(context, gl.TRIANGLES, depthMode, stencilMode, colorMode, CullFaceMode.disabled,
        { 'u_image': 0, 'u_direction': [1.0, 0.0], 'u_texture_size': fboWidth, 'u_blur_radius': blurRadius }, null, null, 'shadow-blur-h',
        painter.rasterBoundsBuffer, painter.quadTriangleIndexBuffer, painter.rasterBoundsSegments);

    // --- Pass 2: Vertical Blur ---
    // Target: Original shadow FBO
    context.bindFramebuffer.set(terrainInstance.getFramebuffer('shadow').framebuffer);
    context.viewport.set([0, 0, fboWidth, fboHeight]);

    // Input: Horizontal blurred texture (unit 0)
    context.activeTexture.set(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, terrainInstance._fboShadowBlurTexture.texture);

    program.draw(context, gl.TRIANGLES, depthMode, stencilMode, colorMode, CullFaceMode.disabled,
        { 'u_image': 0, 'u_direction': [0.0, 1.0], 'u_texture_size': fboWidth, 'u_blur_radius': blurRadius }, null, null, 'shadow-blur-v',
        painter.rasterBoundsBuffer, painter.quadTriangleIndexBuffer, painter.rasterBoundsSegments);
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
    const prepCtx = buildNeighborContext(painter, tileManager);

    for (const coord of tileIDs) {
        const tile = tileManager.getTile(coord);
        const dem = tile.dem;
        const needsPrepare = tile.needsHorizonPrepare || !tile.horizonTexture || !tile.horizonFBO;

        if (!dem || !dem.data || !needsPrepare) {
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

            const [lateralOff, longOff, diagOff] = neighborOffsets;

            // The shader hardcodes u_dem_west to the X-axis neighbor (TEXTURE1)
            // and u_dem_north to the Y-axis neighbor (TEXTURE2).
            const xAxisOff = lateralOff[0] !== 0 ? lateralOff : longOff;
            const yAxisOff = lateralOff[1] !== 0 ? lateralOff : longOff;

            const xInfo = (xAxisOff[0] !== 0) ? getNeighborTileWithZoom(prepCtx, coord, xAxisOff[0], xAxisOff[1]) : { tile: null, zoomInfo: [1.0, 0.0, 0.0, 0.0] as [number, number, number, number] };
            const yInfo = (yAxisOff[1] !== 0) ? getNeighborTileWithZoom(prepCtx, coord, yAxisOff[0], yAxisOff[1]) : { tile: null, zoomInfo: [1.0, 0.0, 0.0, 0.0] as [number, number, number, number] };
            const diagInfo = (diagOff[0] !== 0 || diagOff[1] !== 0) ? getNeighborTileWithZoom(prepCtx, coord, diagOff[0], diagOff[1]) : { tile: null, zoomInfo: [1.0, 0.0, 0.0, 0.0] as [number, number, number, number] };

            const xTile = xInfo.tile;
            const yTile = yInfo.tile;
            const diagTile = diagInfo.tile;

            context.activeTexture.set(gl.TEXTURE0);
            tile.demTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);

            context.activeTexture.set(gl.TEXTURE1);
            const xTex = xTile ? ensureDemTexture(painter, xTile) : null;
            if (xTex) xTex.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);

            context.activeTexture.set(gl.TEXTURE2);
            const yTex = yTile ? ensureDemTexture(painter, yTile) : null;
            if (yTex) yTex.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);

            context.activeTexture.set(gl.TEXTURE3);
            const dTex = diagTile ? ensureDemTexture(painter, diagTile) : null;
            if (dTex) dTex.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);

            const uniformValues = shadowPrepareUniformValues(
                tile, dem, baseAzimuth, azimuthStep,
                !!xTex, !!yTex, !!dTex,
                xInfo.zoomInfo, yInfo.zoomInfo, diagInfo.zoomInfo
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
