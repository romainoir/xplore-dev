import { mat4 } from 'gl-matrix';
import Point from '@mapbox/point-geometry';
import { StencilMode } from '../stencil_mode';
import { DepthMode } from '../depth_mode';
import { terrainUniforms, terrainDepthUniforms, terrainElevationUniforms, terrainCoordsUniformValues, terrainCoordsUniforms, terrainUniformValues, terrainDepthUniformValues, terrainElevationUniformValues } from '../program/terrain_program';
import { hillshadeUniformPrepareValues } from '../program/hillshade_program';
import type { Painter, RenderOptions } from '../../render/painter';
import type { Tile } from '../../tile/tile';
import { CullFaceMode } from '../cull_face_mode';
import { Color } from '@maplibre/maplibre-gl-style-spec';
import { ColorMode } from '../color_mode';
import { Terrain } from '../../render/terrain';
import { Texture } from '../texture';
import { RGBAImage } from '../../util/image';
import type { ShadowStyleLayer } from '../../style/style_layer/shadow_style_layer';
import type { TerrainData } from '../../render/terrain';
import { OverscaledTileID } from '../../tile/tile_id';

type MercatorBounds = {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
};

type AtlasLodOptions = {
    maxTiles?: number;
    maxCoreTiles?: number;
    zoomBias?: number;
    midReachMeters?: number;
    farReachMeters?: number;
};

const WORLD_CIRCUMFERENCE = 40075016.7;
const SHADOW_REACH_METERS = 5000;
const MID_SHADOW_REACH_METERS = 2200;
const MAX_ELEVATION_ATLAS_TILES = 72;
const MAX_CORE_ATLAS_TILES = 32;
const FOREGROUND_ATLAS_PITCH_START = 42;
const FOREGROUND_ATLAS_PITCH_RANGE = 18;
const FOREGROUND_ATLAS_TOP_FRACTION = 0.42;

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function positiveModulo(value: number, modulo: number): number {
    return ((value % modulo) + modulo) % modulo;
}

function incrementCount(counts: Record<string, number>, value: number | string | undefined) {
    const key = String(value ?? 'none');
    counts[key] = (counts[key] || 0) + 1;
}

function tileMercatorBounds(tileID: OverscaledTileID): MercatorBounds {
    const id = tileID.canonical;
    const scale = 1 << id.z;
    const span = 1 / scale;
    const x = tileID.wrap + id.x / scale;
    const y = id.y / scale;

    return {
        minX: x,
        minY: y,
        maxX: x + span,
        maxY: y + span
    };
}

function includeBounds(target: MercatorBounds, tileBounds: MercatorBounds) {
    target.minX = Math.min(target.minX, tileBounds.minX);
    target.minY = Math.min(target.minY, tileBounds.minY);
    target.maxX = Math.max(target.maxX, tileBounds.maxX);
    target.maxY = Math.max(target.maxY, tileBounds.maxY);
}

function intersectBounds(a: MercatorBounds, b: MercatorBounds): MercatorBounds | null {
    const bounds = {
        minX: Math.max(a.minX, b.minX),
        minY: Math.max(a.minY, b.minY),
        maxX: Math.min(a.maxX, b.maxX),
        maxY: Math.min(a.maxY, b.maxY)
    };

    return bounds.maxX > bounds.minX && bounds.maxY > bounds.minY ? bounds : null;
}

function expandBounds(bounds: MercatorBounds, margin: number): MercatorBounds {
    return {
        minX: bounds.minX - margin,
        minY: bounds.minY - margin,
        maxX: bounds.maxX + margin,
        maxY: bounds.maxY + margin
    };
}

function finiteBounds(bounds: MercatorBounds): boolean {
    return Number.isFinite(bounds.minX) && Number.isFinite(bounds.minY) &&
        Number.isFinite(bounds.maxX) && Number.isFinite(bounds.maxY);
}

export function getShadowAtlasVisibleBounds(painter: Painter, terrain: Terrain, renderableTiles: Array<Tile> = terrain.tileManager.getRenderableTiles()): {
    bounds: MercatorBounds;
    fullBounds: MercatorBounds;
    screenClamped: boolean;
    screenTop: number;
    pitch: number;
} | null {
    const fullBounds: MercatorBounds = {minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity};
    for (const tile of renderableTiles) {
        includeBounds(fullBounds, tileMercatorBounds(tile.tileID));
    }

    if (!finiteBounds(fullBounds)) return null;

    const tr = painter.transform;
    const pitch = tr.pitch;
    const enabled = typeof window === 'undefined' || (window as any)._shadowForegroundAtlas !== false;
    const pitchFactor = enabled ? clamp((pitch - FOREGROUND_ATLAS_PITCH_START) / FOREGROUND_ATLAS_PITCH_RANGE, 0, 1) : 0;

    if (pitchFactor <= 0.001) {
        return {bounds: fullBounds, fullBounds, screenClamped: false, screenTop: 0, pitch};
    }

    const screenTop = FOREGROUND_ATLAS_TOP_FRACTION * pitchFactor;
    const sampleBounds: MercatorBounds = {minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity};
    const width = tr.width;
    const height = tr.height;
    const xs = [0.04, 0.20, 0.50, 0.80, 0.96];
    const ys = [
        screenTop,
        screenTop + (1 - screenTop) * 0.25,
        screenTop + (1 - screenTop) * 0.50,
        screenTop + (1 - screenTop) * 0.75,
        0.98
    ];

    for (const yf of ys) {
        for (const xf of xs) {
            const coord = tr.screenPointToMercatorCoordinate(new Point(
                clamp(width * xf, 0, Math.max(width - 1, 0)),
                clamp(height * yf, 0, Math.max(height - 1, 0))
            ));
            if (coord && Number.isFinite(coord.x) && Number.isFinite(coord.y)) {
                includeBounds(sampleBounds, {minX: coord.x, minY: coord.y, maxX: coord.x, maxY: coord.y});
            }
        }
    }

    if (!finiteBounds(sampleBounds)) {
        return {bounds: fullBounds, fullBounds, screenClamped: false, screenTop: 0, pitch};
    }

    const sampledWidth = sampleBounds.maxX - sampleBounds.minX;
    const sampledHeight = sampleBounds.maxY - sampleBounds.minY;
    const minMargin = 1200 / WORLD_CIRCUMFERENCE;
    const margin = Math.max(Math.max(sampledWidth, sampledHeight) * 0.18, minMargin);
    const clampedBounds = intersectBounds(expandBounds(sampleBounds, margin), fullBounds);

    return {
        bounds: clampedBounds || fullBounds,
        fullBounds,
        screenClamped: !!clampedBounds,
        screenTop,
        pitch
    };
}

function extendBoundsTowardSun(bounds: MercatorBounds, dx: number, dy: number, meters: number): MercatorBounds {
    const extension = meters / WORLD_CIRCUMFERENCE;
    return {
        minX: dx >= 0 ? bounds.minX : bounds.minX - extension,
        minY: dy >= 0 ? bounds.minY : bounds.minY - extension,
        maxX: dx >= 0 ? bounds.maxX + extension : bounds.maxX,
        maxY: dy >= 0 ? bounds.maxY + extension : bounds.maxY
    };
}

function boundsContain(outer: MercatorBounds, inner: MercatorBounds): boolean {
    const epsilon = 1e-12;
    return inner.minX >= outer.minX - epsilon &&
        inner.minY >= outer.minY - epsilon &&
        inner.maxX <= outer.maxX + epsilon &&
        inner.maxY <= outer.maxY + epsilon;
}

function countAtlasTiles(bounds: MercatorBounds, zoom: number): number {
    const scale = 1 << zoom;
    const minTileX = Math.floor(bounds.minX * scale);
    const maxTileX = Math.ceil(bounds.maxX * scale) - 1;
    const minTileY = clamp(Math.floor(bounds.minY * scale), 0, scale - 1);
    const maxTileY = clamp(Math.ceil(bounds.maxY * scale) - 1, 0, scale - 1);

    if (maxTileX < minTileX || maxTileY < minTileY) return 0;
    return (maxTileX - minTileX + 1) * (maxTileY - minTileY + 1);
}

function chooseAtlasZoom(mapZoom: number, minZoom: number, maxZoom: number, bounds: MercatorBounds, maxTiles: number): number {
    let zoom = clamp(Math.floor(mapZoom), minZoom, maxZoom);

    while (zoom > minZoom && countAtlasTiles(bounds, zoom) > maxTiles) {
        zoom--;
    }

    return zoom;
}

function buildAtlasTileIDs(bounds: MercatorBounds, zoom: number): { tileIDs: Array<OverscaledTileID>; bounds: MercatorBounds } {
    const scale = 1 << zoom;
    const minTileX = Math.floor(bounds.minX * scale);
    const maxTileX = Math.ceil(bounds.maxX * scale) - 1;
    const minTileY = clamp(Math.floor(bounds.minY * scale), 0, scale - 1);
    const maxTileY = clamp(Math.ceil(bounds.maxY * scale) - 1, 0, scale - 1);
    const tileIDs: Array<OverscaledTileID> = [];

    for (let rawX = minTileX; rawX <= maxTileX; rawX++) {
        const wrap = Math.floor(rawX / scale);
        const x = positiveModulo(rawX, scale);

        for (let y = minTileY; y <= maxTileY; y++) {
            tileIDs.push(new OverscaledTileID(zoom, wrap, zoom, x, y));
        }
    }

    return {
        tileIDs,
        bounds: {
            minX: minTileX / scale,
            minY: minTileY / scale,
            maxX: (maxTileX + 1) / scale,
            maxY: (maxTileY + 1) / scale
        }
    };
}

function collectLodTileIDs(visibleBounds: MercatorBounds, dx: number, dy: number, mapZoom: number, minZoom: number, maxZoom: number, options: AtlasLodOptions = {}): {
    tileIDs: Array<OverscaledTileID>;
    bounds: MercatorBounds;
    lodZooms: Array<number>;
} {
    const coreZoom = chooseAtlasZoom(mapZoom + (options.zoomBias ?? 0), minZoom, maxZoom, visibleBounds, options.maxCoreTiles ?? MAX_CORE_ATLAS_TILES);
    let midZoom = Math.max(minZoom, coreZoom - 1);
    let farZoom = Math.max(minZoom, coreZoom - 2);
    const midReachMeters = options.midReachMeters ?? MID_SHADOW_REACH_METERS;
    const farReachMeters = options.farReachMeters ?? SHADOW_REACH_METERS;
    const maxTiles = options.maxTiles ?? MAX_ELEVATION_ATLAS_TILES;

    const build = () => {
        const selected = new Map<string, OverscaledTileID>();
        const coveredBounds: Array<MercatorBounds> = [];
        const lodZooms: Array<number> = [];

        const addBand = (bounds: MercatorBounds, zoom: number, skipCovered: boolean) => {
            const band = buildAtlasTileIDs(bounds, zoom);
            let added = 0;

            for (const tileID of band.tileIDs) {
                const tileBounds = tileMercatorBounds(tileID);
                if (skipCovered && coveredBounds.some(covered => boundsContain(covered, tileBounds))) {
                    continue;
                }
                selected.set(tileID.key, tileID);
                added++;
            }

            if (added > 0) {
                coveredBounds.push(band.bounds);
                lodZooms.push(zoom);
            }
        };

        addBand(visibleBounds, coreZoom, false);
        addBand(extendBoundsTowardSun(visibleBounds, dx, dy, midReachMeters), midZoom, true);
        addBand(extendBoundsTowardSun(visibleBounds, dx, dy, farReachMeters), farZoom, true);

        const tileIDs = Array.from(selected.values()).sort((a, b) => {
            const az = a.canonical.z;
            const bz = b.canonical.z;
            if (az !== bz) return az - bz;
            if (a.wrap !== b.wrap) return a.wrap - b.wrap;
            if (a.canonical.x !== b.canonical.x) return a.canonical.x - b.canonical.x;
            return a.canonical.y - b.canonical.y;
        });

        const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        for (const tileID of tileIDs) {
            includeBounds(bounds, tileMercatorBounds(tileID));
        }

        return {
            tileIDs,
            bounds,
            lodZooms: Array.from(new Set(lodZooms)).sort((a, b) => b - a)
        };
    };

    let atlas = build();
    while (atlas.tileIDs.length > maxTiles && (farZoom > minZoom || midZoom > minZoom)) {
        if (farZoom > minZoom) {
            farZoom--;
        } else {
            midZoom--;
        }
        atlas = build();
    }

    return atlas;
}

function numberFromProfile(profile: any, key: string, fallback: number): number {
    const value = profile?.[key];
    return Number.isFinite(value) ? Number(value) : fallback;
}

function getShadowAtlasLodOptions(previewAtlas: boolean): AtlasLodOptions {
    const profile = typeof window !== 'undefined' ? (window as any)._shadowReachProfile : null;

    if (previewAtlas) {
        return {
            maxTiles: Math.round(numberFromProfile(profile, 'previewMaxTiles', 28)),
            maxCoreTiles: Math.round(numberFromProfile(profile, 'previewMaxCoreTiles', 10)),
            zoomBias: numberFromProfile(profile, 'previewZoomBias', -1.35),
            midReachMeters: numberFromProfile(profile, 'previewMidReachMeters', 1400),
            farReachMeters: numberFromProfile(profile, 'previewFarReachMeters', 3400)
        };
    }

    return {
        maxTiles: Math.round(numberFromProfile(profile, 'maxTiles', MAX_ELEVATION_ATLAS_TILES)),
        maxCoreTiles: Math.round(numberFromProfile(profile, 'maxCoreTiles', MAX_CORE_ATLAS_TILES)),
        zoomBias: numberFromProfile(profile, 'zoomBias', 0),
        midReachMeters: numberFromProfile(profile, 'midReachMeters', MID_SHADOW_REACH_METERS),
        farReachMeters: numberFromProfile(profile, 'farReachMeters', SHADOW_REACH_METERS)
    };
}

/**
 * Redraw the Depth Framebuffer
 * @param painter - the painter
 * @param terrain - the terrain
 */
function drawDepth(painter: Painter, terrain: Terrain) {
    const context = painter.context;
    const gl = context.gl;
    const tr = painter.transform;
    const colorMode = ColorMode.unblended;
    const depthMode = new DepthMode(gl.LEQUAL, DepthMode.ReadWrite, [0, 1]);
    const tiles = terrain.tileManager.getRenderableTiles();
    const program = painter.useProgram('terrainDepth');
    context.bindFramebuffer.set(terrain.getFramebuffer('depth').framebuffer);
    context.viewport.set([0, 0, painter.width / devicePixelRatio, painter.height / devicePixelRatio]);
    context.clear({ color: Color.transparent, depth: 1 });
    for (const tile of tiles) {
        const mesh = terrain.getTerrainMesh(tile.tileID);
        const terrainData = terrain.getTerrainData(tile.tileID);
        const projectionData = tr.getProjectionData({ overscaledTileID: tile.tileID, applyTerrainMatrix: false, applyGlobeMatrix: true });
        const uniformValues = terrainDepthUniformValues(terrain.getMeshFrameDelta(tr.zoom));
        program.draw(context, gl.TRIANGLES, depthMode, StencilMode.disabled, colorMode, CullFaceMode.backCCW, uniformValues, terrainData, projectionData, 'terrain', mesh.vertexBuffer, mesh.indexBuffer, mesh.segments);
    }
    context.bindFramebuffer.set(null);
    context.viewport.set([0, 0, painter.width, painter.height]);
}

/**
 * Redraw the Coords Framebuffers
 * @param painter - the painter
 * @param terrain - the terrain
 */
function drawCoords(painter: Painter, terrain: Terrain) {
    const context = painter.context;
    const gl = context.gl;
    const tr = painter.transform;
    const colorMode = ColorMode.unblended;
    const depthMode = new DepthMode(gl.LEQUAL, DepthMode.ReadWrite, [0, 1]);
    const coords = terrain.getCoordsTexture();
    const tiles = terrain.tileManager.getRenderableTiles();

    // draw tile-coords into framebuffer
    const program = painter.useProgram('terrainCoords');
    context.bindFramebuffer.set(terrain.getFramebuffer('coords').framebuffer);
    context.viewport.set([0, 0, painter.width / devicePixelRatio, painter.height / devicePixelRatio]);
    context.clear({ color: Color.transparent, depth: 1 });
    terrain.coordsIndex = [];
    for (const tile of tiles) {
        const mesh = terrain.getTerrainMesh(tile.tileID);
        const terrainData = terrain.getTerrainData(tile.tileID);
        context.activeTexture.set(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, coords.texture);
        const uniformValues = terrainCoordsUniformValues(255 - terrain.coordsIndex.length, terrain.getMeshFrameDelta(tr.zoom));
        const projectionData = tr.getProjectionData({ overscaledTileID: tile.tileID, applyTerrainMatrix: false, applyGlobeMatrix: true });
        program.draw(context, gl.TRIANGLES, depthMode, StencilMode.disabled, colorMode, CullFaceMode.backCCW, uniformValues, terrainData, projectionData, 'terrain', mesh.vertexBuffer, mesh.indexBuffer, mesh.segments);
        terrain.coordsIndex.push(tile.tileID.key);
    }
    context.viewport.set([0, 0, painter.width, painter.height]);
}

function drawElevation(painter: Painter, terrain: Terrain) {
    const debugEnabled = typeof window !== 'undefined' && (window as any)._shadowTileDebugEnabled;
    const debugStart = debugEnabled ? performance.now() : 0;
    const context = painter.context;
    const gl = context.gl;
    const tr = painter.transform;
    const colorMode = ColorMode.unblended;
    // The atlas is a 2D heightfield cache, not a camera-visible terrain pass.
    // Draw order should decide mixed-zoom precedence, otherwise coarse parents can
    // depth-test over detailed child tiles and create square shadow patches.
    const depthMode = DepthMode.disabled;

    const shadowLayer = painter.style.getLayer('shadow-coarse') as ShadowStyleLayer;
    const sunDir = shadowLayer ? shadowLayer.getShadowProperties() : { directionRadians: 0 };
    const dxRes = Math.sin(sunDir.directionRadians);
    const dyRes = -Math.cos(sunDir.directionRadians);

    // 1. Compute the atlas footprint. At high pitch, the renderable tile set
    // can run all the way to the horizon, which would squeeze the foreground
    // into a tiny part of the atlas. Clamp the core footprint to the lower
    // screen region and let LOD bands handle sun-facing casters.
    const renderableTiles = terrain.tileManager.getRenderableTiles();
    const atlasVisible = getShadowAtlasVisibleBounds(painter, terrain, renderableTiles);
    const visibleZooms: Record<string, number> = {};

    for (const tile of renderableTiles) {
        if (debugEnabled) {
            incrementCount(visibleZooms, tile.tileID.canonical.z);
        }
    }

    if (!atlasVisible) {
        console.warn('[ATLAS] drawElevation: no visible terrain tiles, skipping elevation atlas render');
        return;
    }

    const visibleBounds = atlasVisible.bounds;
    let minX = visibleBounds.minX;
    let minY = visibleBounds.minY;
    let maxX = visibleBounds.maxX;
    let maxY = visibleBounds.maxY;

    // 3. Quantize the atlas to deterministic LOD bands. The visible core stays
    // detailed, while farther sun-facing caster regions fall back to parent cells.
    const source = terrain.tileManager.getSource();
    const sourceMinZoom = source.minzoom ?? terrain.tileManager.minzoom ?? 0;
    const sourceMaxZoom = source.maxzoom ?? terrain.tileManager.maxzoom ?? 22;
    const terrainDeltaZoom = terrain.tileManager.getEffectiveDeltaZoom();
    const targetMinZoom = sourceMinZoom + terrainDeltaZoom;
    const targetMaxZoom = sourceMaxZoom + terrainDeltaZoom;
    const progressivePhase = typeof window !== 'undefined' ? (window as any)._shadowProgressivePhase : '';
    const previewAtlas = progressivePhase === 'preview';
    const atlasLodOptions = getShadowAtlasLodOptions(previewAtlas);
    const atlasCells = collectLodTileIDs(
        { minX, minY, maxX, maxY },
        dxRes,
        dyRes,
        tr.zoom,
        targetMinZoom,
        targetMaxZoom,
        atlasLodOptions
    );
    const captureTileIDs = atlasCells.tileIDs;

    if (captureTileIDs.length === 0) {
        console.warn('[ATLAS] drawElevation: atlas cell set is empty, skipping elevation atlas render');
        return;
    }

    minX = atlasCells.bounds.minX;
    minY = atlasCells.bounds.minY;
    maxX = atlasCells.bounds.maxX;
    maxY = atlasCells.bounds.maxY;

    // We removed the forced early-return here because Painter's terrainFacilitator.dirty
    // already throttles this function appropriately. If we early-return here, the FBO never
    // updates at all on the final frame when interaction ceases!

    // console.log(`[ATLAS] drawElevation: lod=${atlasCells.lodZooms.join('/')}, cells=${captureTileIDs.length}, bounds=[${minX.toFixed(6)}, ${minY.toFixed(6)}, ${maxX.toFixed(6)}, ${maxY.toFixed(6)}]`);

    // 4. Setup Orthographic Projection for the Elevation Atlas
    const program = painter.useProgram('terrainElevation');
    const atlasSize = Terrain.ATLAS_SIZE;
    context.bindFramebuffer.set(terrain.getFramebuffer('elevation').framebuffer);
    context.viewport.set([0, 0, atlasSize, atlasSize]);
    context.clear({ color: Color.transparent, depth: 1 });

    // Store Atlas Bounds in terrain object for the shadow raymarcher to use
    (terrain as any)._elevationAtlasBounds = [minX, minY, maxX, maxY];
    (terrain as any)._elevationAtlasVisibleBounds = [visibleBounds.minX, visibleBounds.minY, visibleBounds.maxX, visibleBounds.maxY];
    (terrain as any)._elevationAtlasFullVisibleBounds = [atlasVisible.fullBounds.minX, atlasVisible.fullBounds.minY, atlasVisible.fullBounds.maxX, atlasVisible.fullBounds.maxY];
    (terrain as any)._elevationAtlasScreenClamped = atlasVisible.screenClamped;
    (terrain as any)._elevationAtlasScreenTop = atlasVisible.screenTop;
    (terrain as any)._elevationAtlasProgressivePhase = previewAtlas ? 'preview' : progressivePhase === 'full' ? 'full' : 'stable';
    (terrain as any)._daylightAtlasReady = false;
    (terrain as any)._horizonAtlasReady = false;

    const orthoMatrix = mat4.create();
    mat4.ortho(orthoMatrix, minX, maxX, maxY, minY, -10000, 10000); // Reversed Y for Mercator

    let parentFallbackCount = 0;
    let flatFallbackCount = 0;
    const captureZooms: Record<string, number> = {};
    const sourceZooms: Record<string, number> = {};

    for (const tileID of captureTileIDs) {
        if (debugEnabled) {
            incrementCount(captureZooms, tileID.canonical.z);
        }
        const mesh = terrain.getTerrainMesh(tileID);
        const terrainData = terrain.getTerrainData(tileID);
        const sourceTile = terrainData.tile;
        if (debugEnabled) {
            incrementCount(sourceZooms, sourceTile?.tileID?.canonical?.z);
        }
        if (!sourceTile?.dem) {
            flatFallbackCount++;
        } else if (sourceTile.tileID.canonical.z < tileID.canonical.z) {
            parentFallbackCount++;
        }

        // We override the tiles' projection to be top-down world-space
        const tileMatrix = mat4.create();
        const id = tileID.canonical;
        const scale = 1 << id.z;
        // Tile pos in 0..1 units
        mat4.translate(tileMatrix, tileMatrix, [tileID.wrap + id.x / scale, id.y / scale, 0]);
        mat4.scale(tileMatrix, tileMatrix, [1 / scale / 8192, 1 / scale / 8192, 1]);

        const finalMatrix = mat4.create();
        mat4.multiply(finalMatrix, orthoMatrix, tileMatrix);

        // Use standard projection data but override the 5.24 projection matrix
        // consumed by projectTileFor3D().
        const projectionData = tr.getProjectionData({ overscaledTileID: tileID, applyTerrainMatrix: false, applyGlobeMatrix: false });
        projectionData.mainMatrix = finalMatrix as any;

        const uniformValues = terrainElevationUniformValues(0);
        program.draw(context, gl.TRIANGLES, depthMode, StencilMode.disabled, colorMode, CullFaceMode.backCCW, uniformValues, terrainData, projectionData, 'terrain', mesh.vertexBuffer, mesh.indexBuffer, mesh.segments);
    }

    // Expose metadata to window for debug UI in shadow_debug_poc.html
    if (typeof window !== 'undefined') {
        const capturedIds = captureTileIDs.map(tileID => ({
            z: tileID.canonical.z,
            x: tileID.canonical.x,
            y: tileID.canonical.y,
            wrap: tileID.wrap,
            key: tileID.key
        }));
        (window as any)._elevationAtlasDebug = {
            bounds: [minX, minY, maxX, maxY], // WebMercator [0..1]
            size: atlasSize,
            tiles: capturedIds,
            lodZooms: atlasCells.lodZooms,
            maxTiles: atlasLodOptions.maxTiles ?? MAX_ELEVATION_ATLAS_TILES,
            maxCoreTiles: atlasLodOptions.maxCoreTiles ?? MAX_CORE_ATLAS_TILES,
            midReachMeters: atlasLodOptions.midReachMeters ?? MID_SHADOW_REACH_METERS,
            farReachMeters: atlasLodOptions.farReachMeters ?? SHADOW_REACH_METERS,
            reachProfile: typeof window !== 'undefined' ? (window as any)._shadowReachProfile : null,
            progressivePhase: previewAtlas ? 'preview' : progressivePhase === 'full' ? 'full' : 'stable',
            parentFallbackCount,
            flatFallbackCount,
            screenClamped: atlasVisible.screenClamped,
            screenTop: atlasVisible.screenTop,
            pitch: atlasVisible.pitch,
            fullVisibleBounds: [
                atlasVisible.fullBounds.minX,
                atlasVisible.fullBounds.minY,
                atlasVisible.fullBounds.maxX,
                atlasVisible.fullBounds.maxY
            ],
            visibleTiles: renderableTiles.length,
            visibleZooms,
            captureZooms,
            sourceZooms,
            durationMs: debugEnabled ? performance.now() - debugStart : undefined,
            timestamp: performance.now()
        };
    }

    context.bindFramebuffer.set(null);
    context.viewport.set([0, 0, painter.width, painter.height]);
}

function prepareTerrainDerivativeTexture(painter: Painter, sourceTile?: Tile | null): WebGLTexture | null {
    const dem = sourceTile?.dem;
    if (!sourceTile || !dem || !dem.data) {
        return null;
    }

    const context = painter.context;
    const gl = context.gl;
    const tileSize = dem.dim;
    const textureStride = dem.stride;

    if (sourceTile.needsHillshadePrepare || !sourceTile.fbo) {
        const pixelData = dem.getPixels();

        context.activeTexture.set(gl.TEXTURE1);
        context.pixelStoreUnpackPremultiplyAlpha.set(false);
        sourceTile.demTexture = sourceTile.demTexture || painter.getTileTexture(textureStride);
        if (sourceTile.demTexture) {
            sourceTile.demTexture.update(pixelData, { premultiply: false });
            sourceTile.demTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
        } else {
            sourceTile.demTexture = new Texture(context, pixelData, gl.RGBA, { premultiply: false });
            sourceTile.demTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);
        }

        let fbo = sourceTile.fbo;
        if (!fbo) {
            const renderTexture = new Texture(context, { width: tileSize, height: tileSize, data: null }, gl.RGBA);
            renderTexture.bind(gl.LINEAR, gl.CLAMP_TO_EDGE);

            fbo = sourceTile.fbo = context.createFramebuffer(tileSize, tileSize, true, false);
            fbo.colorAttachment.set(renderTexture.texture);
        }

        context.bindFramebuffer.set(fbo.framebuffer);
        context.viewport.set([0, 0, tileSize, tileSize]);

        painter.useProgram('hillshadePrepare').draw(context, gl.TRIANGLES,
            DepthMode.disabled, StencilMode.disabled, ColorMode.unblended, CullFaceMode.disabled,
            hillshadeUniformPrepareValues(sourceTile.tileID, dem),
            null, null, 'terrain-derivative', painter.rasterBoundsBuffer,
            painter.quadTriangleIndexBuffer, painter.rasterBoundsSegments);

        sourceTile.needsHillshadePrepare = false;
        context.bindFramebuffer.set(null);
        context.viewport.set([0, 0, painter.width, painter.height]);
    }

    return sourceTile.fbo?.colorAttachment.get() || null;
}

function getNeutralDerivativeTexture(painter: Painter): WebGLTexture | null {
    const terrain = painter.style.map.terrain as any;
    if (!terrain) {
        return null;
    }

    if (!terrain._terrainNeutralDerivativeTexture) {
        const context = painter.context;
        const gl = context.gl;
        const neutral = new RGBAImage({ width: 1, height: 1 }, new Uint8Array([128, 128, 0, 255]));
        terrain._terrainNeutralDerivativeTexture = new Texture(context, neutral, gl.RGBA, { premultiply: false });
        terrain._terrainNeutralDerivativeTexture.bind(gl.LINEAR, gl.CLAMP_TO_EDGE);
    }

    return terrain._terrainNeutralDerivativeTexture.texture;
}

function drawTerrain(painter: Painter, terrain: Terrain, tiles: Array<Tile>, renderOptions: RenderOptions) {
    const { isRenderingGlobe } = renderOptions;
    const context = painter.context;
    const gl = context.gl;
    const tr = painter.transform;
    const colorMode = painter.colorModeForRenderPass();
    const depthMode = painter.getDepthModeFor3D();
    const debugEnabled = typeof window !== 'undefined' && (window as any)._shadowTileDebugEnabled;
    const debugStart = debugEnabled ? performance.now() : 0;

    const derivativeByTile = new Map<string, WebGLTexture | null>();
    const terrainDataByTile = new Map<string, TerrainData>();
    let derivativeReady = 0;
    let derivativeMissing = 0;
    let derivativeManualPrepare = 0;
    let derivativePrepareMs = 0;
    let derivativeSkippedMoving = 0;
    let missingDem = 0;
    const terrainZooms: Record<string, number> = {};
    const sourceZooms: Record<string, number> = {};
    const missingDerivativeTiles: Array<string> = [];
    const cameraRefreshHeld = typeof window !== 'undefined' && (window as any)._shadowCameraRefreshHold;
    const cameraMoving = (painter.options.moving || cameraRefreshHeld) && !(typeof window !== 'undefined' && (window as any)._isInteractingWithTime);

    for (const tile of tiles) {
        if (debugEnabled) {
            incrementCount(terrainZooms, tile.tileID.canonical.z);
        }
        const terrainData = terrain.getTerrainData(tile.tileID);
        terrainDataByTile.set(tile.tileID.key, terrainData);
        const sourceTile = (terrainData as any)?.tile as Tile | undefined;
        if (debugEnabled) {
            incrementCount(sourceZooms, sourceTile?.tileID?.canonical?.z);
        }
        if (!sourceTile?.dem) {
            missingDem++;
        }
        const willPrepare = !!sourceTile?.dem?.data && (sourceTile.needsHillshadePrepare || !sourceTile.fbo);
        let derivativeTexture: WebGLTexture | null = null;

        if (cameraMoving) {
            derivativeTexture = sourceTile?.fbo?.colorAttachment.get() || null;
            if (willPrepare) {
                derivativeSkippedMoving++;
            }
        } else {
            const prepareStart = debugEnabled ? performance.now() : 0;
            derivativeTexture = prepareTerrainDerivativeTexture(painter, sourceTile);
            if (debugEnabled) {
                derivativePrepareMs += performance.now() - prepareStart;
            }
            if (willPrepare && derivativeTexture) {
                derivativeManualPrepare++;
            }
        }

        if (derivativeTexture) {
            derivativeReady++;
        } else {
            derivativeMissing++;
            if (missingDerivativeTiles.length < 8) {
                const id = tile.tileID.canonical;
                missingDerivativeTiles.push(`${id.z}/${id.x}/${id.y}`);
            }
        }
        derivativeByTile.set(tile.tileID.key, derivativeTexture);
    }

    context.bindFramebuffer.set(null);
    context.viewport.set([0, 0, painter.width, painter.height]);
    const neutralDerivativeTexture = getNeutralDerivativeTexture(painter);
    const program = painter.useProgram('terrain');

    for (const tile of tiles) {
        const mesh = terrain.getTerrainMesh(tile.tileID);
        const texture = painter.renderToTexture.getTexture(tile);
        const terrainData = terrainDataByTile.get(tile.tileID.key);
        context.activeTexture.set(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture.texture);
        const eleDelta = terrain.getMeshFrameDelta(tr.zoom);
        const fogMatrix = tr.calculateFogMatrix(tile.tileID.toUnwrapped());
        const derivativeTexture = derivativeByTile.get(tile.tileID.key);

        // Bind Shadow Atlas to Unit 15
        context.activeTexture.set(gl.TEXTURE15);
        if (terrain._fboShadowTexture) {
            gl.bindTexture(gl.TEXTURE_2D, terrain._fboShadowTexture.texture);
        }
        // Horizon atlases: current-time terrain shadow can update from uniforms only.
        context.activeTexture.set(gl.TEXTURE8);
        if ((terrain as any)._fboHorizon0Texture) {
            (terrain as any)._fboHorizon0Texture.bind(gl.LINEAR, gl.CLAMP_TO_EDGE);
        }
        context.activeTexture.set(gl.TEXTURE9);
        if ((terrain as any)._fboHorizon1Texture) {
            (terrain as any)._fboHorizon1Texture.bind(gl.LINEAR, gl.CLAMP_TO_EDGE);
        }
        context.activeTexture.set(gl.TEXTURE10);
        if ((terrain as any)._fboHorizon2Texture) {
            (terrain as any)._fboHorizon2Texture.bind(gl.LINEAR, gl.CLAMP_TO_EDGE);
        }
        context.activeTexture.set(gl.TEXTURE11);
        if ((terrain as any)._fboHorizon3Texture) {
            (terrain as any)._fboHorizon3Texture.bind(gl.LINEAR, gl.CLAMP_TO_EDGE);
        }
        // Prepared Igor/Sobel derivatives. This mirrors the native hillshade
        // pipeline and avoids running a Sobel kernel per terrain fragment.
        context.activeTexture.set(gl.TEXTURE12);
        gl.bindTexture(gl.TEXTURE_2D, derivativeTexture || neutralDerivativeTexture);
        // DEM AO: bind the per-tile DEM texture to unit 13 for full-res AO
        context.activeTexture.set(gl.TEXTURE13);
        if (terrainData && (terrainData as any).texture) {
            gl.bindTexture(gl.TEXTURE_2D, (terrainData as any).texture);
        }
        const uniformValues = terrainUniformValues(eleDelta, fogMatrix, painter.style.sky, tr.pitch, isRenderingGlobe, tr.zoom, painter, tile);
        uniformValues['u_tile_zoom'] = tile.tileID.canonical.z;
        uniformValues['u_dem_derivative'] = 12;
        uniformValues['u_dem_derivative_available'] = derivativeTexture ? 1.0 : 0.0;

        // Set per-tile DEM AO uniforms - u_dem_ao points to unit 13 where we bound the texture
        if (terrainData) {
            const td = terrainData as any;
            uniformValues['u_dem_ao'] = 13; // Our manually bound unit
            uniformValues['u_dem_ao_dim'] = td['u_terrain_dim'] || 514;
            uniformValues['u_dem_ao_unpack'] = td['u_terrain_unpack'] || [6553.6, 25.6, 0.1, 10000.0];
            uniformValues['u_dem_ao_exag'] = td['u_terrain_exaggeration'] || 1.3;
            const sourceZoom = td.tile?.tileID?.canonical?.z ?? tile.tileID.canonical.z;
            const demDim = td['u_terrain_dim'] || 512;
            uniformValues['u_dem_ao_meters_per_pixel'] = WORLD_CIRCUMFERENCE / (demDim * Math.pow(2, sourceZoom));
        }

        // Debug log for first tile
        if (tile === tiles[0]) {
            const td = terrainData as any;
            // console.log(`[DEM-AO] dim=${td?.['u_terrain_dim']}, exag=${td?.['u_terrain_exaggeration']}, hasTex=${!!(td?.texture)}, unpack=${td?.['u_terrain_unpack']}`);
        }

        // Log once per frame
        if (tile === tiles[0]) {
            // console.log(`[ATLAS] drawTerrain: atlas_bounds=[${(uniformValues as any)['u_atlas_bounds']}], debug_mode=${(uniformValues as any)['u_debug_mode']}, tile_id=[${(uniformValues as any)['u_tile_id']}], shadowTex=${!!terrain._fboShadowTexture}`);
        }

        const projectionData = tr.getProjectionData({ overscaledTileID: tile.tileID, applyTerrainMatrix: false, applyGlobeMatrix: true });
        program.draw(context, gl.TRIANGLES, depthMode, StencilMode.disabled, colorMode, CullFaceMode.backCCW, uniformValues, terrainData, projectionData, 'terrain', mesh.vertexBuffer, mesh.indexBuffer, mesh.segments);
    }

    if (debugEnabled) {
        (window as any)._terrainTileDebug = {
            renderTiles: tiles.length,
            terrainZooms,
            sourceZooms,
            derivativeReady,
            derivativeMissing,
            derivativeManualPrepare,
            derivativePrepareMs,
            derivativeSkippedMoving,
            missingDem,
            missingDerivativeTiles,
            moving: painter.options.moving,
            rotating: painter.options.rotating,
            refreshHeld: !!cameraRefreshHeld,
            atlasReady: !!(terrain as any)._shadowAtlasReady,
            horizonReady: !!(terrain as any)._horizonAtlasReady,
            atlasReusedWhileMoving: !!(terrain as any)._shadowAtlasReusedWhileMoving,
            durationMs: performance.now() - debugStart,
            timestamp: performance.now()
        };
    }
}

export {
    drawTerrain,
    drawDepth,
    drawElevation,
    drawCoords
};
