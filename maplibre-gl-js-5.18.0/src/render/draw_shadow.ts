import { StencilMode } from '../gl/stencil_mode';
import { DepthMode } from '../gl/depth_mode';
import { CullFaceMode } from '../gl/cull_face_mode';
import { ColorMode } from '../gl/color_mode';
import { shadowUniformValues, shadowGlobalUniformValues, shadowBlurUniforms } from './program/shadow_program';
import { drawElevation } from './draw_terrain';
import { prepareHorizonAtlasForCurrentView } from './draw_daylight';
import { shadowPrepareUniformValues } from './program/shadow_prepare_program';
// calculateTileKey no longer needed — using canonical z/x/y index instead
import { Color } from '@maplibre/maplibre-gl-style-spec';
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
    const useHorizonCurrentShadow = typeof window === 'undefined' || (window as any)._shadowUseHorizonCurrent !== false;
    const canUseCachedShadow = cameraMoving && isCoarseGlobalShadow && (!!(terrain as any)?._shadowAtlasReady || !!(terrain as any)?._horizonAtlasReady);

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
        const terrain = painter.style.map.terrain;
        const cameraRefreshHeld = typeof window !== 'undefined' && (window as any)._shadowCameraRefreshHold;
        const cameraMoving = (painter.options.moving || cameraRefreshHeld) && !(typeof window !== 'undefined' && (window as any)._isInteractingWithTime);
        if (cameraMoving && (!!(terrain as any)?._shadowAtlasReady || !!(terrain as any)?._horizonAtlasReady)) {
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
export function drawGlobalShadow(
    painter: Painter,
    layer: ShadowStyleLayer
) {
    const debugEnabled = typeof window !== 'undefined' && (window as any)._shadowTileDebugEnabled;
    const debugStart = debugEnabled ? performance.now() : 0;
    const context = painter.context;
    const gl = context.gl;
    const transform = painter.transform;

    const terrain = painter.style.map.terrain;
    if (!terrain || !terrain._fboElevationTexture || !terrain._fboShadowTexture) {
        console.warn(`[ATLAS] drawGlobalShadow: missing FBO textures. Terrain: ${!!terrain}, ElevationTex: ${!!terrain?._fboElevationTexture}, ShadowTex: ${!!terrain?._fboShadowTexture}`);
        return;
    }

    const colorMode = painter.colorModeForRenderPass();
    const depthMode = DepthMode.disabled;
    const stencilMode = StencilMode.disabled;

    const useHorizonCurrentShadow = typeof window === 'undefined' || (window as any)._shadowUseHorizonCurrent !== false;
    if (useHorizonCurrentShadow) {
        const horizonKey = prepareHorizonAtlasForCurrentView(painter, depthMode, stencilMode, colorMode);
        if (horizonKey && (terrain as any)._horizonAtlasReady) {
            context.bindFramebuffer.set(null);
            context.viewport.set([0, 0, painter.width, painter.height]);
            (terrain as any)._shadowAtlasReady = true;
            (terrain as any)._shadowAtlasReusedWhileMoving = false;
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

    const program = painter.useProgram('shadowGlobal');

    // 1. Calculate Atlas-space scales
    const atlasBounds = (terrain as any)._elevationAtlasBounds; // [minX, minY, maxX, maxY] in 0..1 world
    if (!atlasBounds) {
        console.warn('[ATLAS] drawGlobalShadow: no _elevationAtlasBounds set');
        return;
    }

    const worldCircumference = 40075016.7;
    const atlasWorldWidth = atlasBounds[2] - atlasBounds[0];
    const atlasWorldHeight = atlasBounds[3] - atlasBounds[1];
    const atlasPixelSize = terrain._fboElevationTexture.size[0]; // Square atlas

    // Per-axis meters per pixel for correct raymarching in non-square Mercator regions
    const metersPerPixelX = (atlasWorldWidth * worldCircumference) / atlasPixelSize;
    const metersPerPixelY = (atlasWorldHeight * worldCircumference) / atlasPixelSize;


    const uniformValues = shadowGlobalUniformValues(painter, layer, metersPerPixelX, metersPerPixelY);

    // 2. Render to Shadow FBO
    context.bindFramebuffer.set(terrain.getFramebuffer('shadow').framebuffer);
    context.viewport.set([0, 0, terrain._fboShadowTexture.size[0], terrain._fboShadowTexture.size[1]]);
    context.clear({ color: Color.transparent }); // Clear to no shadow (0)

    const opacity = layer.paint.get('shadow-opacity') as number;
    if (typeof opacity === 'number' && opacity <= 0.003 && (globalThis as any)._shadowDebugMode !== 2) {
        context.bindFramebuffer.set(null);
        context.viewport.set([0, 0, painter.width, painter.height]);
        (terrain as any)._shadowAtlasReady = true;
        (terrain as any)._shadowAtlasReusedWhileMoving = false;
        if (debugEnabled) {
            (window as any)._shadowPassDebug = {
                skipped: true,
                reason: 'shadow opacity <= 0',
                durationMs: performance.now() - debugStart,
                atlasPixelSize,
                timestamp: performance.now()
            };
        }
        return;
    }

    // Bind Elevation Atlas to Unit 0
    context.activeTexture.set(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, terrain._fboElevationTexture.texture);

    if (!(globalThis as any)._shadowLogThrottle) (globalThis as any)._shadowLogThrottle = 0;
    if ((globalThis as any)._shadowLogThrottle++ % 60 === 0 || !((painter as any)._wasInteracting)) {
        // console.log(`[SHADOW] drawGlobalShadow triggered. maxSteps=${uniformValues['u_max_steps']}, stepMeters=${uniformValues['u_step_meters']}`);
    }

    // Use painter's built-in quad buffers
    program.draw(context, gl.TRIANGLES, depthMode, stencilMode, colorMode, CullFaceMode.disabled,
        uniformValues, null, null, layer.id, painter.rasterBoundsBuffer,
        painter.quadTriangleIndexBuffer, painter.rasterBoundsSegments);

    // Optional atlas-space blur is intentionally disabled by default. Shadow
    // contacts are cleaned in the terrain shader with derivative-aware remap
    // and a tiny edge-only atlas filter, which preserves silhouettes better
    // than rounding the whole atlas.
    const isTimeSliding = typeof window !== 'undefined' && (window as any)._isInteractingWithTime;
    const progressivePhase = typeof window !== 'undefined' ? (window as any)._shadowProgressivePhase : '';
    const isProgressivePreview = progressivePhase === 'preview';
    const useEdgeCleanup = typeof window !== 'undefined' && (window as any)._shadowEdgeCleanup === true;
    const blurStart = debugEnabled ? performance.now() : 0;
    if (useEdgeCleanup && !isTimeSliding && !isProgressivePreview) {
        drawGlobalShadowBlur(painter);
    }
    const blurMs = debugEnabled && useEdgeCleanup && !isTimeSliding && !isProgressivePreview ? performance.now() - blurStart : 0;

    // Unbind FBO to prevent feedback loop when terrain shader samples the shadow texture
    context.bindFramebuffer.set(null);
    context.viewport.set([0, 0, painter.width, painter.height]);
    (terrain as any)._shadowAtlasReady = true;
    (terrain as any)._shadowAtlasReusedWhileMoving = false;

    if (debugEnabled) {
        (window as any)._shadowPassDebug = {
            durationMs: performance.now() - debugStart,
            blurMs,
            maxSteps: uniformValues['u_max_steps'],
            stepMeters: uniformValues['u_step_meters'],
            maxDistance: uniformValues['u_max_distance'],
            atlasPixelSize,
            metersPerPixelX,
            metersPerPixelY,
            progressivePhase: isProgressivePreview ? 'preview' : progressivePhase === 'full' ? 'full' : 'stable',
            timestamp: performance.now()
        };
    }
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
        { 'u_image': 0, 'u_direction': [1.0, 0.0] }, null, null, 'shadow-blur-h',
        painter.rasterBoundsBuffer, painter.quadTriangleIndexBuffer, painter.rasterBoundsSegments);

    // --- Pass 2: Vertical Blur ---
    // Target: Original shadow FBO
    context.bindFramebuffer.set(terrainInstance.getFramebuffer('shadow').framebuffer);
    context.viewport.set([0, 0, fboWidth, fboHeight]);

    // Input: Horizontal blurred texture (unit 0)
    context.activeTexture.set(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, terrainInstance._fboShadowBlurTexture.texture);

    program.draw(context, gl.TRIANGLES, depthMode, stencilMode, colorMode, CullFaceMode.disabled,
        { 'u_image': 0, 'u_direction': [0.0, 1.0] }, null, null, 'shadow-blur-v',
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
