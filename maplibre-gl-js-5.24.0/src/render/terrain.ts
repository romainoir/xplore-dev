
import { mat4, vec2 } from 'gl-matrix';
import { OverscaledTileID } from '../tile/tile_id';
import { RGBAImage } from '../util/image';
import { warnOnce } from '../util/util';
import { Pos3dArray, TriangleIndexArray } from '../data/array_types.g';
import pos3dAttributes from '../data/pos3d_attributes';
import { SegmentVector } from '../data/segment';
import { Texture } from '../webgl/texture';
import { MercatorCoordinate } from '../geo/mercator_coordinate';
import { TerrainTileManager } from '../tile/terrain_tile_manager';
import { EXTENT } from '../data/extent';
import { type LngLat, earthRadius } from '../geo/lng_lat';
import { Mesh } from './mesh';
import { isInBoundsForZoomLngLat } from '../util/world_bounds';
import { NORTH_POLE_Y, SOUTH_POLE_Y } from './subdivision';
import { coveringTiles } from '../geo/projection/covering_tiles';
import type Point from '@mapbox/point-geometry';
import type { Tile } from '../tile/tile';
import type { Framebuffer } from '../webgl/framebuffer';
import type { TileManager } from '../tile/tile_manager';
import type { TerrainSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Painter } from './painter';
import type { IReadonlyTransform } from '../geo/transform_interface';

/**
 * @internal
 * A terrain GPU related object
 */
export type TerrainData = {
    'u_depth': number;
    'u_terrain': number;
    'u_terrain_dim': number;
    'u_terrain_matrix': mat4;
    'u_terrain_unpack': number[];
    'u_terrain_exaggeration': number;
    texture: WebGLTexture;
    depthTexture: WebGLTexture;
    tile: Tile;
};

/**
 * @internal
 * This is the main class which handles most of the 3D Terrain logic. It has the following topics:
 *
 * 1. loads raster-dem tiles via the internal tileManager this.tileManager
 * 2. creates a depth-framebuffer, which is used to calculate the visibility of coordinates
 * 3. creates a coords-framebuffer, which is used the get to tile-coordinate for a screen-pixel
 * 4. stores all render-to-texture tiles in the this.tileManager._tiles
 * 5. calculates the elevation for a specific tile-coordinate
 * 6. creates a terrain-mesh
 *
 * A note about the GPU resource-usage:
 *
 * Framebuffers:
 *
 * - one for the depth & coords framebuffer with the size of the map-div.
 * - one for rendering a tile to texture with the size of tileSize (= 512x512).
 *
 * Textures:
 *
 * - one texture for an empty raster-dem tile with size 1x1
 * - one texture for an empty depth-buffer, when terrain is disabled with size 1x1
 * - one texture for an each loaded raster-dem with size of the source.tileSize
 * - one texture for the coords-framebuffer with the size of the map-div.
 * - one texture for the depth-framebuffer with the size of the map-div.
 * - one texture for the encoded tile-coords with the size 2*tileSize (=1024x1024)
 * - finally for each render-to-texture tile (= this._tiles) a set of textures
 * for each render stack (The stack-concept is documented in painter.ts).
 *
 * Normally there exists 1-3 Textures per tile, depending on the stylesheet.
 * Each Textures has the size 2*tileSize (= 1024x1024). Also there exists a
 * cache of the last 150 newest rendered tiles.
 *
 */
export class Terrain {
    /**
     * The style this terrain corresponds to
     */
    painter: Painter;
    /**
     * the tilemanager this terrain is based on
     */
    tileManager: TerrainTileManager;
    /**
     * the TerrainSpecification object passed to this instance
     */
    options: TerrainSpecification;
    /**
     * define the meshSize per tile.
     */
    meshSize: number;
    /**
     * multiplicator for the elevation. Used to make terrain more "extreme".
     */
    exaggeration: number;
    /**
     * to not see pixels in the render-to-texture tiles it is good to render them bigger
     * this number is the multiplicator (must be a power of 2) for the current tileSize.
     * So to get good results with not too much memory footprint a value of 2 should be fine.
     */
    qualityFactor: number;
    /**
     * holds the framebuffer object in size of the screen to render the coords & depth into a texture.
     */
    _fbo: Framebuffer;
    _fboCoordsTexture: Texture;
    _fboDepthTexture: Texture;
    _fboElevationTexture: Texture;
    _fboShadowTexture: Texture;
    _fboShadowBlurTexture: Texture;
    _fboDaylightTexture: Texture;
    _fboHorizon0Texture: Texture;
    _fboHorizon1Texture: Texture;
    _fboHorizon2Texture: Texture;
    _fboHorizon3Texture: Texture;
    _horizonAtlasSize: number;
    _emptyDepthTexture: Texture;
    /**
     * GL Objects for the terrain-mesh
     * The mesh is a regular mesh, which has the advantage that it can be reused for all tiles.
     */
    _meshCache: { [key: string]: Mesh } = {};
    /**
     * coords index contains a list of tileID.keys. This index is used to identify
     * the tile via the alpha-cannel in the coords-texture.
     * As the alpha-channel has 1 Byte a max of 255 tiles can rendered without an error.
     */
    coordsIndex: Array<string>;
    /**
     * tile-coords encoded in the rgb channel, _coordsIndex is in the alpha-channel.
     */
    _coordsTexture: Texture;
    /**
     * accuracy of the coords. 2 * tileSize should be enough.
     */
    _coordsTextureSize: number;
    /**
     * variables for an empty dem texture, which is used while the raster-dem tile is loading.
     */
    _emptyDemUnpack: number[];
    _emptyDemTexture: Texture;
    _emptyDemMatrix: mat4;
    /**
     * as of overzooming of raster-dem tiles in high zoomlevels, this cache contains
     * matrices to transform from vector-tile coords to raster-dem-tile coords.
     */
    _demMatrixCache: { [_: string]: { matrix: mat4; coord: OverscaledTileID } };

    constructor(painter: Painter, tileManager: TileManager, options: TerrainSpecification) {
        this.painter = painter;
        this.tileManager = new TerrainTileManager(tileManager);
        this.options = options;
        this.exaggeration = typeof options.exaggeration === 'number' ? options.exaggeration : 1.0;
        this.qualityFactor = 2;
        this.meshSize = 128;
        this._demMatrixCache = {};
        this.coordsIndex = [];
        this._coordsTextureSize = 1024;
        this._horizonAtlasSize = Terrain.HORIZON_ATLAS_SIZE;
    }

    _destroyHorizonAtlases() {
        if (this._fboHorizon0Texture) this._fboHorizon0Texture.destroy();
        if (this._fboHorizon1Texture) this._fboHorizon1Texture.destroy();
        if (this._fboHorizon2Texture) this._fboHorizon2Texture.destroy();
        if (this._fboHorizon3Texture) this._fboHorizon3Texture.destroy();
        if (this._fboHorizon0) this._fboHorizon0.destroy();
        if (this._fboHorizon1) this._fboHorizon1.destroy();
        if (this._fboHorizon2) this._fboHorizon2.destroy();
        if (this._fboHorizon3) this._fboHorizon3.destroy();
        delete this._fboHorizon0Texture;
        delete this._fboHorizon1Texture;
        delete this._fboHorizon2Texture;
        delete this._fboHorizon3Texture;
        delete this._fboHorizon0;
        delete this._fboHorizon1;
        delete this._fboHorizon2;
        delete this._fboHorizon3;
        delete (this as any)._daylightAtlasReady;
        delete (this as any)._daylightAtlasKey;
        delete (this as any)._horizonAtlasReady;
        delete (this as any)._horizonAtlasKey;
    }

    destroy() {
        if (this._fbo) this._fbo.destroy();
        if (this._fboCoordsTexture) this._fboCoordsTexture.destroy();
        if (this._fboDepthTexture) this._fboDepthTexture.destroy();
        if (this._fboElevationTexture) this._fboElevationTexture.destroy();
        if (this._fboShadowTexture) this._fboShadowTexture.destroy();
        if (this._fboShadowBlurTexture) this._fboShadowBlurTexture.destroy();
        if (this._fboDaylightTexture) this._fboDaylightTexture.destroy();
        if (this._fboElevation) this._fboElevation.destroy();
        if (this._fboShadow) this._fboShadow.destroy();
        if (this._fboShadowBlur) this._fboShadowBlur.destroy();
        if (this._fboDaylight) this._fboDaylight.destroy();
        if (this._emptyDemTexture) this._emptyDemTexture.destroy();
        if (this._emptyDepthTexture) this._emptyDepthTexture.destroy();
        if (this._coordsTexture) this._coordsTexture.destroy();
        for (const key in this._meshCache) {
            this._meshCache[key].destroy();
        }
        this._destroyHorizonAtlases();
    }

    /**
     * Get the elevation-value from original dem-data for a given tile-coordinate.
     * Coordinates that fall outside `[0, extent)` are normalized to the
     * appropriate neighbor tile before lookup.
     * @param tileID - the tile to get the elevation for
     * @param x - x coordinate relative to the tile, may be outside `[0, extent)`
     * @param y - y coordinate relative to the tile, may be outside `[0, extent)`
     * @param extent - optional, default 8192
     * @returns the elevation
     */
    getDEMElevation(tileID: OverscaledTileID, x: number, y: number, extent: number = EXTENT): number {
        const normalized = tileID.normalizeCoordinates(x, y, extent);
        if (!normalized) return 0;

        const terrain = this.getTerrainData(normalized.tileID);
        const dem = terrain.tile?.dem;
        if (!dem) return 0;

        const pos = vec2.transformMat4([] as any, [normalized.x / extent * EXTENT, normalized.y / extent * EXTENT], terrain.u_terrain_matrix);
        const coord = [pos[0] * dem.dim, pos[1] * dem.dim];

        // bilinear interpolation
        const cx = Math.floor(coord[0]),
            cy = Math.floor(coord[1]),
            tx = coord[0] - cx,
            ty = coord[1] - cy;
        return (
            dem.get(cx, cy) * (1 - tx) * (1 - ty) +
            dem.get(cx + 1, cy) * (tx) * (1 - ty) +
            dem.get(cx, cy + 1) * (1 - tx) * (ty) +
            dem.get(cx + 1, cy + 1) * (tx) * (ty)
        );
    }

    /**
     * Get the elevation for given {@link LngLat} in respect of exaggeration.
     * @param lnglat - the location
     * @param zoom - the zoom, use {@link getElevationForLngLat} if you don't want a specific zoom level, but more accurate results.
     * @returns the elevation
     */
    getElevationForLngLatZoom(lnglat: LngLat, zoom: number) {
        if (!isInBoundsForZoomLngLat(zoom, lnglat.wrap())) return 0;
        const { tileID, mercatorX, mercatorY } = this._getOverscaledTileIDFromLngLatZoom(lnglat, zoom);
        return this.getElevation(tileID, mercatorX % EXTENT, mercatorY % EXTENT, EXTENT);
    }

    /**
     * Get the elevation for given {@link LngLat} in respect of exaggeration.
     * This will traverse up the zoom levels to find the first tile with data to return.
     * @param lnglat - the location
     * @returns the elevation
     */
    getElevationForLngLat(lnglat: LngLat, transform: IReadonlyTransform) {
        const terrainCoveringTiles = coveringTiles(transform, { maxzoom: this.tileManager.maxzoom, minzoom: this.tileManager.minzoom, tileSize: 512, terrain: this });
        let zoom = 0;
        for (const tile of terrainCoveringTiles) {
            if (tile.canonical.z > zoom) {
                zoom = Math.min(tile.canonical.z, this.tileManager.maxzoom);
            }
        }
        return this.getElevationForLngLatZoom(lnglat, zoom);
    }

    /**
     * Get the elevation for given coordinate in respect of exaggeration.
     * @param tileID - the tile id
     * @param x - x coordinate relative to the tile, may be outside `[0, extent)`
     * @param y - y coordinate relative to the tile, may be outside `[0, extent)`
     * @param extent - optional, default 8192
     * @returns the elevation
     */
    getElevation(tileID: OverscaledTileID, x: number, y: number, extent: number = EXTENT): number {
        return this.getDEMElevation(tileID, x, y, extent) * this.exaggeration;
    }

    /**
     * returns a Terrain Object for a tile. Unless the tile corresponds to data (e.g. tile is loading), return a flat dem object
     * @param tileID - the tile to get the terrain for
     * @returns the terrain data to use in the program
     */
    getTerrainData(tileID: OverscaledTileID): TerrainData {
        // create empty DEM Objects, which will used while raster-dem tiles are loading.
        // creates an empty depth-buffer texture which is needed, during the initialization process of the 3d mesh..
        if (!this._emptyDemTexture) {
            const context = this.painter.context;
            const image = new RGBAImage({ width: 1, height: 1 }, new Uint8Array(1 * 4));
            this._emptyDepthTexture = new Texture(context, image, context.gl.RGBA, { premultiply: false });
            this._emptyDemUnpack = [0, 0, 0, 0];
            this._emptyDemTexture = new Texture(context, new RGBAImage({ width: 1, height: 1 }), context.gl.RGBA, { premultiply: false });
            this._emptyDemTexture.bind(context.gl.NEAREST, context.gl.CLAMP_TO_EDGE);
            this._emptyDemMatrix = mat4.identity([] as any);
        }
        // find covering dem tile and prepare demTexture
        const sourceTile = this.tileManager.getSourceTile(tileID, true);
        if (sourceTile && sourceTile.dem && (!sourceTile.demTexture || sourceTile.needsTerrainPrepare)) {
            const context = this.painter.context;
            sourceTile.demTexture = this.painter.getTileTexture(sourceTile.dem.stride);
            if (sourceTile.demTexture) sourceTile.demTexture.update(sourceTile.dem.getPixels(), { premultiply: false });
            else sourceTile.demTexture = new Texture(context, sourceTile.dem.getPixels(), context.gl.RGBA, { premultiply: false });
            sourceTile.demTexture.bind(context.gl.NEAREST, context.gl.CLAMP_TO_EDGE);
            sourceTile.needsTerrainPrepare = false;
        }
        // create matrix for lookup in dem data
        const matrixKey = sourceTile && sourceTile.toString() + sourceTile.tileID.key + tileID.key;
        if (matrixKey && !this._demMatrixCache[matrixKey]) {
            const maxzoom = this.tileManager.getSource().maxzoom;
            let dz = tileID.canonical.z - sourceTile.tileID.canonical.z;
            if (tileID.overscaledZ > tileID.canonical.z) {
                if (tileID.canonical.z >= maxzoom) dz = tileID.canonical.z - maxzoom;
                else warnOnce('cannot calculate elevation if elevation maxzoom > source.maxzoom');
            }
            const dx = tileID.canonical.x - (tileID.canonical.x >> dz << dz);
            const dy = tileID.canonical.y - (tileID.canonical.y >> dz << dz);
            const demMatrix = mat4.fromScaling(new Float64Array(16) as any, [1 / (EXTENT << dz), 1 / (EXTENT << dz), 0]);
            mat4.translate(demMatrix, demMatrix, [dx * EXTENT, dy * EXTENT, 0]);
            this._demMatrixCache[matrixKey] = { matrix: demMatrix, coord: tileID };
        }
        // return uniform values & textures
        return {
            'u_depth': 2,
            'u_terrain': 3,
            'u_terrain_dim': sourceTile && sourceTile.dem && sourceTile.dem.dim || 1,
            'u_terrain_matrix': matrixKey ? this._demMatrixCache[matrixKey].matrix : this._emptyDemMatrix,
            'u_terrain_unpack': sourceTile && sourceTile.dem && sourceTile.dem.getUnpackVector() || this._emptyDemUnpack,
            'u_terrain_exaggeration': this.exaggeration,
            texture: (sourceTile && sourceTile.demTexture || this._emptyDemTexture).texture,
            depthTexture: (this._fboDepthTexture || this._emptyDepthTexture).texture,
            tile: sourceTile
        };
    }

    /**
     * get a framebuffer as big as the map-div, which will be used to render depth & coords into a texture
     * @param texture - the texture
     * @returns the frame buffer
     */
    _fboElevation: Framebuffer;
    _fboShadow: Framebuffer;
    _fboShadowBlur: Framebuffer;
    _fboDaylight: Framebuffer;
    _fboHorizon0: Framebuffer;
    _fboHorizon1: Framebuffer;
    _fboHorizon2: Framebuffer;
    _fboHorizon3: Framebuffer;
    static readonly ATLAS_SIZE = 2048;
    static readonly SHADOW_ATLAS_SIZE = 2048;
    static readonly HORIZON_ATLAS_SIZE = 1024;

    getFramebuffer(texture: string): Framebuffer {
        const painter = this.painter;
        const width = painter.width / devicePixelRatio;
        const height = painter.height / devicePixelRatio;
        if (this._fbo && (this._fbo.width !== width || this._fbo.height !== height)) {
            this._fbo.destroy();
            this._fboCoordsTexture.destroy();
            this._fboDepthTexture.destroy();
            if (this._fboElevationTexture) this._fboElevationTexture.destroy();
            if (this._fboShadowTexture) this._fboShadowTexture.destroy();
            if (this._fboShadowBlurTexture) this._fboShadowBlurTexture.destroy();
            if (this._fboDaylightTexture) this._fboDaylightTexture.destroy();
            if (this._fboElevation) this._fboElevation.destroy();
            if (this._fboShadow) this._fboShadow.destroy();
            if (this._fboShadowBlur) this._fboShadowBlur.destroy();
            if (this._fboDaylight) this._fboDaylight.destroy();
            delete this._fbo;
            delete this._fboDepthTexture;
            delete this._fboElevationTexture;
            delete this._fboShadowTexture;
            delete this._fboShadowBlurTexture;
            delete this._fboDaylightTexture;
            delete this._fboCoordsTexture;
            delete this._fboElevation;
            delete this._fboShadow;
            delete this._fboShadowBlur;
            delete this._fboDaylight;
            delete (this as any)._shadowAtlasReady;
            delete (this as any)._daylightAtlasReady;
            delete (this as any)._daylightAtlasKey;
            delete (this as any)._horizonAtlasReady;
            delete (this as any)._horizonAtlasKey;
            delete (this as any)._shadowAtlasReusedWhileMoving;
            delete (this as any)._shadowAtlasNeedsRefreshAfterCameraMove;
            this._destroyHorizonAtlases();
        }
        if (!this._fboCoordsTexture) {
            this._fboCoordsTexture = new Texture(painter.context, { width, height, data: null }, painter.context.gl.RGBA, { premultiply: false });
            this._fboCoordsTexture.bind(painter.context.gl.NEAREST, painter.context.gl.CLAMP_TO_EDGE);
        }
        if (!this._fboDepthTexture) {
            this._fboDepthTexture = new Texture(painter.context, { width, height, data: null }, painter.context.gl.RGBA, { premultiply: false });
            this._fboDepthTexture.bind(painter.context.gl.NEAREST, painter.context.gl.CLAMP_TO_EDGE);
        }
        // Elevation and shadow atlases default to 2K. Edge cleanup happens in a
        // separate blur pass so we do not pay the memory cost of a larger mask.
        const atlasSize = Terrain.ATLAS_SIZE;
        const maxTextureSize = painter.context.gl.getParameter(painter.context.gl.MAX_TEXTURE_SIZE) as number;
        const requestedShadowAtlasSize = typeof window !== 'undefined' && Number.isFinite((window as any)._shadowAtlasSize) ?
            Number((window as any)._shadowAtlasSize) :
            Terrain.SHADOW_ATLAS_SIZE;
        const shadowAtlasSize = Math.max(atlasSize, Math.min(maxTextureSize, Math.round(requestedShadowAtlasSize)));
        const requestedShadowMaskScale = typeof window !== 'undefined' && Number.isFinite((window as any)._shadowMaskScale) ?
            Number((window as any)._shadowMaskScale) :
            0.5;
        const shadowMaskScale = Math.max(0.25, Math.min(1.0, requestedShadowMaskScale));
        const shadowMaskSize = Math.max(512, Math.min(shadowAtlasSize, Math.round(shadowAtlasSize * shadowMaskScale)));
        if (!this._fboElevationTexture) {
            this._fboElevationTexture = new Texture(painter.context, { width: atlasSize, height: atlasSize, data: null }, painter.context.gl.RGBA, { premultiply: false });
            // The elevation atlas stores a packed float in RGBA channels. Hardware linear
            // filtering corrupts the packed bytes, so shaders do their own bilinear decode.
            this._fboElevationTexture.bind(painter.context.gl.NEAREST, painter.context.gl.CLAMP_TO_EDGE);
        }
        if (this._fboShadowTexture && this._fboShadowTexture.size[0] !== shadowAtlasSize) {
            this._fboShadowTexture.destroy();
            if (this._fboShadowBlurTexture) this._fboShadowBlurTexture.destroy();
            if (this._fboShadow) this._fboShadow.destroy();
            if (this._fboShadowBlur) this._fboShadowBlur.destroy();
            delete this._fboShadowTexture;
            delete this._fboShadowBlurTexture;
            delete this._fboShadow;
            delete this._fboShadowBlur;
            delete (this as any)._shadowAtlasReady;
            delete (this as any)._shadowAtlasReusedWhileMoving;
            delete (this as any)._shadowAtlasNeedsRefreshAfterCameraMove;
        }
        if (!this._fboShadowTexture) {
            this._fboShadowTexture = new Texture(painter.context, { width: shadowAtlasSize, height: shadowAtlasSize, data: null }, painter.context.gl.RGBA, { premultiply: false });
            this._fboShadowTexture.bind(painter.context.gl.LINEAR, painter.context.gl.CLAMP_TO_EDGE);
        }
        if (this._fboShadowBlurTexture && this._fboShadowBlurTexture.size[0] !== shadowMaskSize) {
            this._fboShadowBlurTexture.destroy();
            if (this._fboShadowBlur) this._fboShadowBlur.destroy();
            delete this._fboShadowBlurTexture;
            delete this._fboShadowBlur;
            delete (this as any)._shadowAtlasReady;
            delete (this as any)._shadowAtlasReusedWhileMoving;
            delete (this as any)._shadowAtlasNeedsRefreshAfterCameraMove;
        }
        if (!this._fboDaylightTexture) {
            this._fboDaylightTexture = new Texture(painter.context, { width: atlasSize, height: atlasSize, data: null }, painter.context.gl.RGBA, { premultiply: false });
            this._fboDaylightTexture.bind(painter.context.gl.LINEAR, painter.context.gl.CLAMP_TO_EDGE);
        }
        const horizonAtlasSize = Math.max(512, Math.min(Terrain.ATLAS_SIZE, Math.round(this._horizonAtlasSize || Terrain.HORIZON_ATLAS_SIZE)));
        if (this._fboHorizon0Texture && this._fboHorizon0Texture.size[0] !== horizonAtlasSize) {
            this._destroyHorizonAtlases();
        }
        if (!this._fboHorizon0Texture) {
            this._fboHorizon0Texture = new Texture(painter.context, { width: horizonAtlasSize, height: horizonAtlasSize, data: null }, painter.context.gl.RGBA, { premultiply: false });
            this._fboHorizon0Texture.bind(painter.context.gl.LINEAR, painter.context.gl.CLAMP_TO_EDGE);
        }
        if (!this._fboHorizon1Texture) {
            this._fboHorizon1Texture = new Texture(painter.context, { width: horizonAtlasSize, height: horizonAtlasSize, data: null }, painter.context.gl.RGBA, { premultiply: false });
            this._fboHorizon1Texture.bind(painter.context.gl.LINEAR, painter.context.gl.CLAMP_TO_EDGE);
        }
        if (!this._fboHorizon2Texture) {
            this._fboHorizon2Texture = new Texture(painter.context, { width: horizonAtlasSize, height: horizonAtlasSize, data: null }, painter.context.gl.RGBA, { premultiply: false });
            this._fboHorizon2Texture.bind(painter.context.gl.LINEAR, painter.context.gl.CLAMP_TO_EDGE);
        }
        if (!this._fboHorizon3Texture) {
            this._fboHorizon3Texture = new Texture(painter.context, { width: horizonAtlasSize, height: horizonAtlasSize, data: null }, painter.context.gl.RGBA, { premultiply: false });
            this._fboHorizon3Texture.bind(painter.context.gl.LINEAR, painter.context.gl.CLAMP_TO_EDGE);
        }
        if (!this._fbo) {
            this._fbo = painter.context.createFramebuffer(width, height, true, false);
            this._fbo.depthAttachment.set(painter.context.createRenderbuffer(painter.context.gl.DEPTH_COMPONENT16, width, height));
        }

        // Elevation and Shadow get their own dedicated FBOs to avoid feedback loops
        if (texture === 'elevation') {
            if (!this._fboElevation) {
                this._fboElevation = painter.context.createFramebuffer(atlasSize, atlasSize, true, false);
                this._fboElevation.depthAttachment.set(painter.context.createRenderbuffer(painter.context.gl.DEPTH_COMPONENT16, atlasSize, atlasSize));
            }
            this._fboElevation.colorAttachment.set(this._fboElevationTexture.texture);
            return this._fboElevation;
        }
        if (texture === 'shadow') {
            if (!this._fboShadow) {
                this._fboShadow = painter.context.createFramebuffer(shadowAtlasSize, shadowAtlasSize, false, false);
            }
            this._fboShadow.colorAttachment.set(this._fboShadowTexture.texture);
            return this._fboShadow;
        }
        if (texture === 'shadow_blur') {
            if (!this._fboShadowBlurTexture) {
                this._fboShadowBlurTexture = new Texture(painter.context, { width: shadowMaskSize, height: shadowMaskSize, data: null }, painter.context.gl.RGBA, { premultiply: false });
                this._fboShadowBlurTexture.bind(painter.context.gl.LINEAR, painter.context.gl.CLAMP_TO_EDGE);
            }
            if (!this._fboShadowBlur) {
                this._fboShadowBlur = painter.context.createFramebuffer(shadowMaskSize, shadowMaskSize, false, false);
            }
            this._fboShadowBlur.colorAttachment.set(this._fboShadowBlurTexture.texture);
            return this._fboShadowBlur;
        }
        if (texture === 'daylight') {
            if (!this._fboDaylight) {
                this._fboDaylight = painter.context.createFramebuffer(atlasSize, atlasSize, false, false);
            }
            this._fboDaylight.colorAttachment.set(this._fboDaylightTexture.texture);
            return this._fboDaylight;
        }
        if (texture === 'horizon0') {
            if (!this._fboHorizon0) {
                this._fboHorizon0 = painter.context.createFramebuffer(horizonAtlasSize, horizonAtlasSize, false, false);
            }
            this._fboHorizon0.colorAttachment.set(this._fboHorizon0Texture.texture);
            return this._fboHorizon0;
        }
        if (texture === 'horizon1') {
            if (!this._fboHorizon1) {
                this._fboHorizon1 = painter.context.createFramebuffer(horizonAtlasSize, horizonAtlasSize, false, false);
            }
            this._fboHorizon1.colorAttachment.set(this._fboHorizon1Texture.texture);
            return this._fboHorizon1;
        }
        if (texture === 'horizon2') {
            if (!this._fboHorizon2) {
                this._fboHorizon2 = painter.context.createFramebuffer(horizonAtlasSize, horizonAtlasSize, false, false);
            }
            this._fboHorizon2.colorAttachment.set(this._fboHorizon2Texture.texture);
            return this._fboHorizon2;
        }
        if (texture === 'horizon3') {
            if (!this._fboHorizon3) {
                this._fboHorizon3 = painter.context.createFramebuffer(horizonAtlasSize, horizonAtlasSize, false, false);
            }
            this._fboHorizon3.colorAttachment.set(this._fboHorizon3Texture.texture);
            return this._fboHorizon3;
        }

        this._fbo.colorAttachment.set(texture === 'coords' ? this._fboCoordsTexture.texture :
            this._fboDepthTexture.texture);
        return this._fbo;
    }

    /**
     * create coords texture, needed to grab coordinates from canvas
     * encode coords coordinate into 4 bytes:
     *   - 8 lower bits for x
     *   - 8 lower bits for y
     *   - 4 higher bits for x
     *   - 4 higher bits for y
     *   - 8 bits for coordsIndex (1 .. 255) (= number of terraintile), is later setted in draw_terrain uniform value
     * @returns the texture
     */
    getCoordsTexture(): Texture {
        const context = this.painter.context;
        if (this._coordsTexture) return this._coordsTexture;
        const data = new Uint8Array(this._coordsTextureSize * this._coordsTextureSize * 4);
        for (let y = 0, i = 0; y < this._coordsTextureSize; y++) for (let x = 0; x < this._coordsTextureSize; x++, i += 4) {
            data[i + 0] = x & 255;
            data[i + 1] = y & 255;
            data[i + 2] = ((x >> 8) << 4) | (y >> 8);
            data[i + 3] = 0;
        }
        const image = new RGBAImage({ width: this._coordsTextureSize, height: this._coordsTextureSize }, new Uint8Array(data.buffer));
        const texture = new Texture(context, image, context.gl.RGBA, { premultiply: false });
        texture.bind(context.gl.NEAREST, context.gl.CLAMP_TO_EDGE);
        this._coordsTexture = texture;
        return texture;
    }

    /**
     * Reads a pixel from the coords-framebuffer and translate this to mercator, or null, if the pixel doesn't lie on the terrain's surface (but the sky instead).
     * @param p - Screen-Coordinate
     * @returns Mercator coordinate for a screen pixel, or null, if the pixel is not covered by terrain (is in the sky).
     */
    pointCoordinate(p: Point): MercatorCoordinate {
        // First, ensure the coords framebuffer is up to date.
        this.painter.maybeDrawDepthAndCoords(true);

        const rgba = new Uint8Array(4);
        const context = this.painter.context, gl = context.gl;
        const px = Math.round(p.x * this.painter.pixelRatio / devicePixelRatio);
        const py = Math.round(p.y * this.painter.pixelRatio / devicePixelRatio);
        const fbHeight = Math.round(this.painter.height / devicePixelRatio);
        // grab coordinate pixel from coordinates framebuffer
        context.bindFramebuffer.set(this.getFramebuffer('coords').framebuffer);
        gl.readPixels(px, fbHeight - py - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        context.bindFramebuffer.set(null);
        // decode coordinates (encoding see getCoordsTexture)
        const x = rgba[0] + ((rgba[2] >> 4) << 8);
        const y = rgba[1] + ((rgba[2] & 15) << 8);
        const tileID = this.coordsIndex[255 - rgba[3]];
        const tile = tileID && this.tileManager.getTileByID(tileID);

        if (!tile) {
            return null;
        }

        const coordsSize = this._coordsTextureSize;
        const worldSize = (1 << tile.tileID.canonical.z) * coordsSize;
        return new MercatorCoordinate(
            (tile.tileID.canonical.x * coordsSize + x) / worldSize + tile.tileID.wrap,
            (tile.tileID.canonical.y * coordsSize + y) / worldSize,
            this.getElevation(tile.tileID, x, y, coordsSize)
        );
    }

    /**
     * Reads the depth value from the depth-framebuffer at a given screen pixel
     * @param p - Screen coordinate
     * @returns depth value in clip space (between 0 and 1)
     */

    depthAtPoint(p: Point): number {
        const rgba = new Uint8Array(4);
        const context = this.painter.context, gl = context.gl;
        context.bindFramebuffer.set(this.getFramebuffer('depth').framebuffer);
        gl.readPixels(p.x, this.painter.height / devicePixelRatio - p.y - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        context.bindFramebuffer.set(null);
        // decode coordinates (encoding see terran_depth.fragment.glsl)
        const depthValue = (rgba[0] / (256 * 256 * 256) + rgba[1] / (256 * 256) + rgba[2] / 256 + rgba[3]) / 256;
        return depthValue;
    }

    /**
     * Reads the entire 2048x2048 Elevation Atlas FBO pixels for debugging purposes.
     * @returns Uint8Array containing the raw RGBA pixels of the atlas
     * @internal
     */
    readElevationAtlasPixels(): Uint8Array | null {
        if (!this._fboElevation) return null;

        const context = this.painter.context;
        const gl = context.gl;
        const size = Terrain.ATLAS_SIZE;
        const pixels = new Uint8Array(size * size * 4);

        context.bindFramebuffer.set(this._fboElevation.framebuffer);
        gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        context.bindFramebuffer.set(null);

        return pixels;
    }

    /**
     * Reads cached sun-analysis atlas data for a single geographic point.
     *
     * The horizon atlas stores normalized horizon angles in directional bins:
     * `angleRadians = channel * PI / 2`. The daylight atlas stores the
     * normalized daylight-duration ramp in R, sunrise-window score in G, and
     * sunset-window score in B.
     *
     * @internal
     */
    readSunAnalysisAtlas(lngLat: LngLat): {
        atlasUV: [number, number];
        horizonBins: number;
        horizonAngles: number[];
        daylight: {durationRamp: number; sunriseScore: number; sunsetScore: number} | null;
    } | null {
        const atlasBounds = (this as any)._elevationAtlasBounds as [number, number, number, number] | undefined;
        if (!atlasBounds || !(this as any)._horizonAtlasReady || !this._fboHorizon0Texture || !this._fboHorizon1Texture) {
            return null;
        }

        const merc = MercatorCoordinate.fromLngLat(lngLat);
        const u = (merc.x - atlasBounds[0]) / (atlasBounds[2] - atlasBounds[0]);
        const v = 1.0 - (merc.y - atlasBounds[1]) / (atlasBounds[3] - atlasBounds[1]);
        if (u < 0 || u > 1 || v < 0 || v > 1) {
            return null;
        }

        const context = this.painter.context;
        const gl = context.gl;
        const pixel = new Uint8Array(4);
        const readFramebufferPixel = (framebuffer: Framebuffer, size: number): number[] => {
            const x = Math.max(0, Math.min(size - 1, Math.floor(u * size)));
            const y = Math.max(0, Math.min(size - 1, Math.floor(v * size)));
            context.bindFramebuffer.set(framebuffer.framebuffer);
            gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            return [pixel[0] / 255, pixel[1] / 255, pixel[2] / 255, pixel[3] / 255];
        };

        const horizonBins = Math.max(8, Math.min(16, Math.round(Number((this as any)._horizonDirectionBins) || 8)));
        const horizonSize = this._fboHorizon0Texture.size[0];
        const horizonAngles: number[] = [];
        const pushAngles = (values: number[]) => {
            for (const value of values) {
                if (horizonAngles.length < horizonBins) horizonAngles.push(value * Math.PI * 0.5);
            }
        };

        pushAngles(readFramebufferPixel(this.getFramebuffer('horizon0'), horizonSize));
        pushAngles(readFramebufferPixel(this.getFramebuffer('horizon1'), horizonSize));
        if (horizonBins > 8 && this._fboHorizon2Texture && this._fboHorizon3Texture) {
            const size2 = this._fboHorizon2Texture.size[0];
            pushAngles(readFramebufferPixel(this.getFramebuffer('horizon2'), size2));
            pushAngles(readFramebufferPixel(this.getFramebuffer('horizon3'), size2));
        }

        let daylight: {durationRamp: number; sunriseScore: number; sunsetScore: number} | null = null;
        if ((this as any)._daylightAtlasReady && this._fboDaylightTexture) {
            const values = readFramebufferPixel(this.getFramebuffer('daylight'), this._fboDaylightTexture.size[0]);
            daylight = {
                durationRamp: values[0],
                sunriseScore: values[1],
                sunsetScore: values[2]
            };
        }

        context.bindFramebuffer.set(null);
        return {
            atlasUV: [u, v],
            horizonBins,
            horizonAngles,
            daylight
        };
    }

    /**
     * create a regular mesh which will be used by all terrain-tiles
     * @returns the created regular mesh
     */
    getTerrainMesh(tileId: OverscaledTileID): Mesh {
        const globeEnabled = this.painter.style.projection?.transitionState > 0;
        const northPole = globeEnabled && tileId.canonical.y === 0;
        const southPole = globeEnabled && tileId.canonical.y === (1 << tileId.canonical.z) - 1;
        const key = `m_${northPole ? 'n' : ''}_${southPole ? 's' : ''}`;
        if (this._meshCache[key]) {
            return this._meshCache[key];
        }
        const context = this.painter.context;

        const vertexArray = new Pos3dArray();
        const indexArray = new TriangleIndexArray();
        const meshSize = this.meshSize;
        const delta = EXTENT / meshSize;
        const meshSize2 = meshSize * meshSize;
        for (let y = 0; y <= meshSize; y++) for (let x = 0; x <= meshSize; x++) {
            vertexArray.emplaceBack(x * delta, y * delta, 0);
        }
        for (let y = 0; y < meshSize2; y += meshSize + 1) for (let x = 0; x < meshSize; x++) {
            indexArray.emplaceBack(x + y, meshSize + x + y + 1, meshSize + x + y + 2);
            indexArray.emplaceBack(x + y, meshSize + x + y + 2, x + y + 1);
        }
        // add an extra frame around the mesh to avoid stitching on tile boundaries with different zoomlevels
        // top-bottom frame + pole vertices, if needed
        const offsetTop = vertexArray.length;
        const offsetTopEdge = 0;
        const offsetBottom = offsetTop + (meshSize + 1);
        const offsetBottomEdge = (meshSize + 1) * meshSize;
        const northY = northPole ? NORTH_POLE_Y : 0;
        const northZ = northPole ? 0 : 1;
        const southY = southPole ? SOUTH_POLE_Y : EXTENT;
        const southZ = southPole ? 0 : 1;
        for (let x = 0; x <= meshSize; x++) {
            vertexArray.emplaceBack(x * delta, northY, northZ);
        }
        for (let x = 0; x <= meshSize; x++) {
            vertexArray.emplaceBack(x * delta, southY, southZ);
        }
        for (let x = 0; x < meshSize; x++) {
            indexArray.emplaceBack(offsetBottomEdge + x, offsetBottom + x, offsetBottom + x + 1);
            indexArray.emplaceBack(offsetBottomEdge + x, offsetBottom + x + 1, offsetBottomEdge + x + 1);
            indexArray.emplaceBack(offsetTopEdge + x, offsetTop + x + 1, offsetTop + x);
            indexArray.emplaceBack(offsetTopEdge + x, offsetTopEdge + x + 1, offsetTop + x + 1);
        }
        // left-right frame
        const offsetLeft = vertexArray.length;
        const offsetRight = offsetLeft + (meshSize + 1) * 2;
        for (const x of [0, 1]) for (let y = 0; y <= meshSize; y++) for (const z of [0, 1]) {
            vertexArray.emplaceBack(x * EXTENT, y * delta, z);
        }
        for (let y = 0; y < meshSize * 2; y += 2) {
            indexArray.emplaceBack(offsetLeft + y, offsetLeft + y + 1, offsetLeft + y + 3);
            indexArray.emplaceBack(offsetLeft + y, offsetLeft + y + 3, offsetLeft + y + 2);
            indexArray.emplaceBack(offsetRight + y, offsetRight + y + 3, offsetRight + y + 1);
            indexArray.emplaceBack(offsetRight + y, offsetRight + y + 2, offsetRight + y + 3);
        }

        const mesh = new Mesh(
            context.createVertexBuffer(vertexArray, pos3dAttributes.members),
            context.createIndexBuffer(indexArray),
            SegmentVector.simpleSegment(0, 0, vertexArray.length, indexArray.length)
        );
        this._meshCache[key] = mesh;
        return mesh;
    }

    /**
     * Calculates a height of the frame around the terrain-mesh to avoid stitching between
     * tile boundaries in different zoomlevels.
     * @param zoom - current zoomlevel
     * @returns the elevation delta in meters
     */
    getMeshFrameDelta(zoom: number): number {
        // divide by 5 is evaluated by trial & error to get a frame in the right height
        return 2 * Math.PI * earthRadius / Math.pow(2, Math.max(zoom, 0)) / 5;
    }

    getMinTileElevationForLngLatZoom(lnglat: LngLat, zoom: number) {
        if (!isInBoundsForZoomLngLat(zoom, lnglat.wrap())) return 0;
        const { tileID } = this._getOverscaledTileIDFromLngLatZoom(lnglat, zoom);
        return this.getMinMaxElevation(tileID).minElevation ?? 0;
    }

    /**
     * Get the minimum and maximum elevation contained in a tile. This includes any
     * exaggeration included in the terrain.
     *
     * @param tileID - ID of the tile to be used as a source for the min/max elevation
     * @returns the minimum and maximum elevation found in the tile, including the terrain's
     * exaggeration
     */
    getMinMaxElevation(tileID: OverscaledTileID): { minElevation: number | null; maxElevation: number | null } {
        const tile = this.getTerrainData(tileID).tile;
        const minMax = { minElevation: null, maxElevation: null };
        if (tile && tile.dem) {
            minMax.minElevation = tile.dem.min * this.exaggeration;
            minMax.maxElevation = tile.dem.max * this.exaggeration;
        }
        return minMax;
    }

    _getOverscaledTileIDFromLngLatZoom(lnglat: LngLat, zoom: number): { tileID: OverscaledTileID; mercatorX: number; mercatorY: number } {
        const mercatorCoordinate = MercatorCoordinate.fromLngLat(lnglat.wrap());
        const worldSize = (1 << zoom) * EXTENT;
        const mercatorX = mercatorCoordinate.x * worldSize;
        const mercatorY = mercatorCoordinate.y * worldSize;
        const tileX = Math.floor(mercatorX / EXTENT), tileY = Math.floor(mercatorY / EXTENT);
        const tileID = new OverscaledTileID(zoom, 0, zoom, tileX, tileY);
        return {
            tileID,
            mercatorX,
            mercatorY
        };
    }
}
