import { mat4 } from 'gl-matrix';
import { StencilMode } from '../gl/stencil_mode';
import { DepthMode } from '../gl/depth_mode';
import { terrainUniforms, terrainDepthUniforms, terrainElevationUniforms, terrainCoordsUniformValues, terrainCoordsUniforms, terrainUniformValues, terrainDepthUniformValues, terrainElevationUniformValues } from './program/terrain_program';
import type { Painter, RenderOptions } from './painter';
import type { Tile } from '../tile/tile';
import { CullFaceMode } from '../gl/cull_face_mode';
import { Color } from '@maplibre/maplibre-gl-style-spec';
import { ColorMode } from '../gl/color_mode';
import { Terrain } from './terrain';
import { getSunFacingNeighborOffsets, buildNeighborContext, getNeighborTileWithZoom } from './draw_shadow';
import type { ShadowStyleLayer } from '../style/style_layer/shadow_style_layer';
import { coveringTiles } from '../geo/projection/covering_tiles';

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
    const context = painter.context;
    const gl = context.gl;
    const tr = painter.transform;
    const colorMode = ColorMode.unblended;
    const depthMode = new DepthMode(gl.LEQUAL, DepthMode.ReadWrite, [0, 1]);

    const shadowLayer = painter.style.getLayer('shadow-coarse') as ShadowStyleLayer;
    const sunDir = shadowLayer ? shadowLayer.getShadowProperties() : { directionRadians: 0 };
    const dxRes = Math.sin(sunDir.directionRadians);
    const dyRes = -Math.cos(sunDir.directionRadians);
    const neighbors = getSunFacingNeighborOffsets(dxRes, dyRes);

    const captureSet = new Map<string, Tile>();

    // Use ALL renderable terrain tiles (whatever zoom level MapLibre has loaded)
    const renderableTiles = terrain.tileManager.getRenderableTiles();
    for (const tile of renderableTiles) {
        captureSet.set(tile.tileID.key, tile);
    }

    // 1. Compute Bounding Box of visible tiles in WebMercator space
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const tile of captureSet.values()) {
        const id = tile.tileID.canonical;
        const scale = 1 << id.z;
        const x = id.x / scale;
        const y = id.y / scale;
        const span = 1 / scale;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + span);
        maxY = Math.max(maxY, y + span);
    }

    // 2. Extend bounds in the sun-facing direction to capture shadow casters beyond the view
    // Sunlight comes FROM (dxRes, dyRes), so mountains in that direction cast shadows into view
    const SHADOW_REACH_METERS = 5000; // Max shadow reach in meters
    const WORLD_CIRCUMFERENCE = 40075016.7;
    const extensionMercator = SHADOW_REACH_METERS / WORLD_CIRCUMFERENCE;
    // Extend bounds in the direction the sun comes from
    if (dxRes > 0) maxX += extensionMercator;
    else minX -= extensionMercator;
    if (dyRes > 0) maxY += extensionMercator;
    else minY -= extensionMercator;

    // 3. Find loaded tiles (min Z9) that cover the extended area
    // Lowered to Z9 so Shadow Overscan grandparent tiles are rendered into the FBO.
    const MIN_NEIGHBOR_ZOOM = 9;
    const innerTileManager = (terrain.tileManager as any).tileManager || terrain.tileManager;

    // MapLibre v5+ refactored _tiles into _inViewTiles
    let allTiles: Tile[] = [];
    if (innerTileManager && innerTileManager._inViewTiles && typeof innerTileManager._inViewTiles.getAllTiles === 'function') {
        allTiles = innerTileManager._inViewTiles.getAllTiles();
    } else if (innerTileManager && innerTileManager._tiles) {
        allTiles = Object.values(innerTileManager._tiles);
    }

    for (const tile of allTiles) {
        if (!tile || !tile.tileID) continue;
        const id = tile.tileID.canonical;
        if (id.z < MIN_NEIGHBOR_ZOOM) continue; // Skip coarse tiles

        const scale = 1 << id.z;
        const tx = id.x / scale;
        const ty = id.y / scale;
        const tspan = 1 / scale;

        // Check if this tile overlaps the extended bounds
        if (tx + tspan > minX && tx < maxX && ty + tspan > minY && ty < maxY) {
            if (!captureSet.has(tile.tileID.key)) {
                captureSet.set(tile.tileID.key, tile);
            }
        }
    }

    // Recompute final bounds including the extended tiles
    minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
    for (const tile of captureSet.values()) {
        const id = tile.tileID.canonical;
        const scale = 1 << id.z;
        const x = id.x / scale;
        const y = id.y / scale;
        const span = 1 / scale;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + span);
        maxY = Math.max(maxY, y + span);
    }

    if (captureSet.size === 0) {
        console.warn('[ATLAS] drawElevation: captureSet is EMPTY, skipping elevation atlas render');
        return;
    }

    console.log(`[ATLAS] drawElevation: captureSet=${captureSet.size} tiles, bounds=[${minX.toFixed(6)}, ${minY.toFixed(6)}, ${maxX.toFixed(6)}, ${maxY.toFixed(6)}]`);

    // 2. Setup Orthographic Projection for the Elevation Atlas
    const program = painter.useProgram('terrainElevation');
    const atlasSize = Terrain.ATLAS_SIZE;
    context.bindFramebuffer.set(terrain.getFramebuffer('elevation').framebuffer);
    context.viewport.set([0, 0, atlasSize, atlasSize]);
    context.clear({ color: Color.transparent, depth: 1 });

    // Store Atlas Bounds in terrain object for the shadow raymarcher to use
    (terrain as any)._elevationAtlasBounds = [minX, minY, maxX, maxY];

    const orthoMatrix = mat4.create();
    mat4.ortho(orthoMatrix, minX, maxX, maxY, minY, -10000, 10000); // Reversed Y for Mercator

    for (const tile of captureSet.values()) {
        const mesh = terrain.getTerrainMesh(tile.tileID);
        const terrainData = terrain.getTerrainData(tile.tileID);

        // We override the tiles' projection to be top-down world-space
        const tileMatrix = mat4.create();
        const id = tile.tileID.canonical;
        const scale = 1 << id.z;
        // Tile pos in 0..1 units
        mat4.translate(tileMatrix, tileMatrix, [id.x / scale, id.y / scale, 0]);
        mat4.scale(tileMatrix, tileMatrix, [1 / scale / 8192, 1 / scale / 8192, 1]);

        const finalMatrix = mat4.create();
        mat4.multiply(finalMatrix, orthoMatrix, tileMatrix);

        // Use standard projection data but override projection matrices with our ortho projection
        // projectTileFor3D() uses u_projection_matrix, not u_matrix!
        const projectionData = tr.getProjectionData({ overscaledTileID: tile.tileID, applyTerrainMatrix: false, applyGlobeMatrix: false });
        projectionData['u_matrix'] = finalMatrix as any;
        projectionData['mainMatrix'] = finalMatrix as any; // This maps to u_projection_matrix in the shader

        const uniformValues = terrainElevationUniformValues(0);
        program.draw(context, gl.TRIANGLES, depthMode, StencilMode.disabled, colorMode, CullFaceMode.backCCW, uniformValues, terrainData, projectionData, 'terrain', mesh.vertexBuffer, mesh.indexBuffer, mesh.segments);
    }

    // Expose metadata to window for debug UI in shadow_debug_poc.html
    if (typeof window !== 'undefined') {
        const capturedIds = Array.from(captureSet.values()).map(t => ({
            z: t.tileID.canonical.z,
            x: t.tileID.canonical.x,
            y: t.tileID.canonical.y,
            key: t.tileID.key
        }));
        (window as any)._elevationAtlasDebug = {
            bounds: [minX, minY, maxX, maxY], // WebMercator [0..1]
            size: atlasSize,
            tiles: capturedIds,
            timestamp: performance.now()
        };
    }

    context.bindFramebuffer.set(null);
    context.viewport.set([0, 0, painter.width, painter.height]);
}

function drawTerrain(painter: Painter, terrain: Terrain, tiles: Array<Tile>, renderOptions: RenderOptions) {
    const { isRenderingGlobe } = renderOptions;
    const context = painter.context;
    const gl = context.gl;
    const tr = painter.transform;
    const colorMode = painter.colorModeForRenderPass();
    const depthMode = painter.getDepthModeFor3D();
    const program = painter.useProgram('terrain');

    context.bindFramebuffer.set(null);
    context.viewport.set([0, 0, painter.width, painter.height]);

    for (const tile of tiles) {
        const mesh = terrain.getTerrainMesh(tile.tileID);
        const texture = painter.renderToTexture.getTexture(tile);
        const terrainData = terrain.getTerrainData(tile.tileID);
        context.activeTexture.set(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture.texture);
        const eleDelta = terrain.getMeshFrameDelta(tr.zoom);
        const fogMatrix = tr.calculateFogMatrix(tile.tileID.toUnwrapped());

        // Bind Shadow Atlas to Unit 15
        context.activeTexture.set(gl.TEXTURE15);
        if (terrain._fboShadowTexture) {
            gl.bindTexture(gl.TEXTURE_2D, terrain._fboShadowTexture.texture);
        }
        // DEM AO: bind the per-tile DEM texture to unit 13 for full-res AO
        context.activeTexture.set(gl.TEXTURE13);
        if (terrainData && (terrainData as any).texture) {
            gl.bindTexture(gl.TEXTURE_2D, (terrainData as any).texture);
        }
        // Elevation Atlas: bind the seamless global elevation FBO to unit 14
        context.activeTexture.set(gl.TEXTURE14);
        const elevFbo = terrain.getFramebuffer('elevation');
        const elevTex = elevFbo ? elevFbo.colorAttachment.get() : null;
        if (elevTex) {
            gl.bindTexture(gl.TEXTURE_2D, elevTex);
        }

        // Native Hillshade FBO (Igor gradients): Removed to avoid LINEAR blur
        const uniformValues = terrainUniformValues(eleDelta, fogMatrix, painter.style.sky, tr.pitch, isRenderingGlobe, tr.zoom, painter, tile);
        uniformValues['u_tile_zoom'] = tile.tileID.canonical.z;

        // Set per-tile DEM AO uniforms - u_dem_ao points to unit 13 where we bound the texture
        if (terrainData) {
            const td = terrainData as any;
            uniformValues['u_dem_ao'] = 13; // Our manually bound unit
            uniformValues['u_dem_ao_dim'] = td['u_terrain_dim'] || 514;
            uniformValues['u_dem_ao_unpack'] = td['u_terrain_unpack'] || [6553.6, 25.6, 0.1, 10000.0];
            uniformValues['u_dem_ao_exag'] = td['u_terrain_exaggeration'] || 1.3;
        }

        // Debug log for first tile
        if (tile === tiles[0]) {
            const td = terrainData as any;
            console.log(`[DEM-AO] dim=${td?.['u_terrain_dim']}, exag=${td?.['u_terrain_exaggeration']}, hasTex=${!!(td?.texture)}, unpack=${td?.['u_terrain_unpack']}`);
        }

        // Log once per frame
        if (tile === tiles[0]) {
            console.log(`[ATLAS] drawTerrain: atlas_bounds=[${(uniformValues as any)['u_atlas_bounds']}], debug_mode=${(uniformValues as any)['u_debug_mode']}, tile_id=[${(uniformValues as any)['u_tile_id']}], shadowTex=${!!terrain._fboShadowTexture}`);
        }

        const projectionData = tr.getProjectionData({ overscaledTileID: tile.tileID, applyTerrainMatrix: false, applyGlobeMatrix: true });
        program.draw(context, gl.TRIANGLES, depthMode, StencilMode.disabled, colorMode, CullFaceMode.backCCW, uniformValues, terrainData, projectionData, 'terrain', mesh.vertexBuffer, mesh.indexBuffer, mesh.segments);
    }
}

export {
    drawTerrain,
    drawDepth,
    drawElevation,
    drawCoords
};
