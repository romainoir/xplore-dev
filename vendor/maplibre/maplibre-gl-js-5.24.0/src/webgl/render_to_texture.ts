import {type Painter, type RenderOptions} from '../render/painter';
import {type Tile} from '../tile/tile';
import {Color} from '@maplibre/maplibre-gl-style-spec';
import {type OverscaledTileID} from '../tile/tile_id';
import {drawTerrain} from './draw/draw_terrain';
import {type Style} from '../style/style';
import {type Terrain} from '../render/terrain';
import {type Texture} from './texture';
import type {StyleLayer} from '../style/style_layer';
import {ImageSource, type CanonicalTileRange} from '../source/image_source';

/**
 * lookup table which layers should rendered to texture
 */
const LAYERS_TO_TEXTURES: Record<string, boolean> = {
    background: true,
    fill: true,
    line: true,
    raster: true,
    hillshade: true,
    'color-relief': true,
    daylight: true
};

function getTerrainTileRangesSignature(terrainTileRanges: {[zoom: string]: CanonicalTileRange} | null): string {
    if (!terrainTileRanges) return '';

    return Object.keys(terrainTileRanges)
        .sort((a, b) => Number(a) - Number(b))
        .map((zoom) => {
            const range = terrainTileRanges[zoom];
            return `${zoom}:${range.minTileXWrapped},${range.maxTileXWrapped},${range.minTileY},${range.maxTileY},${range.minWrap},${range.maxWrap}`;
        })
        .join('|');
}

/**
 * @internal
 * A helper class to help define what should be rendered to texture and how
 */
export class RenderToTexture {
    painter: Painter;
    terrain: Terrain;
    rttSize: number;
    /**
     * coordsAscending contains a list of all tiles which should be rendered for one render-to-texture tile
     * e.g. render 4 raster-tiles with size 256px to the 512px render-to-texture tile
     */
    _coordsAscending: {[_: string]: {[_:string]: OverscaledTileID[]}};
    _coordsAscendingCache: {[_: string]: {key: string; coords: {[_: string]: OverscaledTileID[]}}};
    /**
     * fingerprint string representing the unique state of source tiles and revision
     * for a given render-to-texture tile. Used to detect changes and trigger re-rendering.
     * Format: "sorted_tile_keys#revision"
     */
    _rttFingerprints: {[sourceId: string]: {[rttTileKey: string]: string}};
    /**
     * store for render-stacks
     * a render stack is a set of layers which should be rendered into one texture
     * every stylesheet can have multiple stacks. A new stack is created if layers which should
     * not rendered to texture sit between layers which should rendered to texture. e.g. hillshading or symbols
     */
    _stacks: string[][];
    _stackDrawsContours: boolean[];
    _contourAboveLayerIds: Set<string>;
    /**
     * remember the previous processed layer to check if a new stack is needed
     */
    _prevType: string;
    /**
     * a list of tiles that can potentially rendered
     */
    _renderableTiles: Tile[];
    /**
     * a list of tiles that should be rendered to screen in the next render-call
     */
    _rttTiles: Tile[];
    /**
     * a list of all layer-ids which should be rendered
     */
    _renderableLayerIds: string[];
    constructor(painter: Painter, terrain: Terrain) {
        this.painter = painter;
        this.terrain = terrain;
        this.rttSize = terrain.tileManager.tileSize * terrain.qualityFactor;
        this._coordsAscendingCache = {};
    }

    getTexture(tile: Tile): Texture {
        return tile.getRTT(this._stacks.length - 1).texture;
    }

    prepareForRender(style: Style, zoom: number) {
        this._stacks = [];
        this._stackDrawsContours = [];
        const contourAboveLayerIds = typeof window !== 'undefined' ? (window as any)._xploreContourAboveLayerIds : null;
        this._contourAboveLayerIds = new Set(Array.isArray(contourAboveLayerIds)
            ? contourAboveLayerIds.filter((id: unknown) => typeof id === 'string') as string[]
            : []);
        this._prevType = null;
        this._rttTiles = [];
        this._renderableTiles = this.terrain.tileManager.getRenderableTiles();
        this._renderableLayerIds = style._order.filter(id => !style._layers[id].isHidden(zoom));

        const rttSourceIds = new Set<string>();
        for (const id of this._renderableLayerIds) {
            const layer = style._layers[id];
            if (LAYERS_TO_TEXTURES[layer.type] && layer.source) rttSourceIds.add(layer.source);
        }

        this._coordsAscending = {};
        const terrainTilesSignature = this._renderableTiles.map(tile => tile.tileID.key).join(',');
        for (const id of rttSourceIds) {
            const tileManager = style.tileManagers[id];
            if (!tileManager) continue;
            const tileIDs = tileManager.getVisibleCoordinates();
            const source = tileManager.getSource();
            const terrainTileRanges = source instanceof ImageSource ? source.terrainTileRanges : null;
            const cacheKey = `${terrainTilesSignature}#${tileIDs.map(tileID => tileID.key).join(',')}#${getTerrainTileRangesSignature(terrainTileRanges)}`;
            const cached = this._coordsAscendingCache[id];
            if (cached?.key === cacheKey) {
                this._coordsAscending[id] = cached.coords;
                continue;
            }

            const coordsAscending: {[_: string]: OverscaledTileID[]} = {};
            for (const tileID of tileIDs) {
                const keys = this.terrain.tileManager.getTerrainCoords(tileID, terrainTileRanges);
                for (const key in keys) {
                    coordsAscending[key] ||= [];
                    coordsAscending[key].push(keys[key]);
                }
            }

            this._coordsAscending[id] = coordsAscending;
            this._coordsAscendingCache[id] = {key: cacheKey, coords: coordsAscending};
        }

        this._rttFingerprints = {};
        for (const id of this._renderableLayerIds) {
            const layer = style._layers[id];
            const source = layer.source;
            const shouldRenderToTexture = LAYERS_TO_TEXTURES[layer.type];

            if (source && shouldRenderToTexture && !this._rttFingerprints[source] && this._coordsAscending[source]) {
                this._rttFingerprints[source] = {};
                const revision = style.tileManagers[source]?.getState().revision ?? 0;
                for (const key in this._coordsAscending[source])
                    this._rttFingerprints[source][key] = `${this._coordsAscending[source][key].map(c => c.key).sort().join()}#${revision}`;
            }
        }

        // check tiles to render
        for (const tile of this._renderableTiles) {
            for (const source in this._rttFingerprints) {
                // rerender if there are different coords to render than in the last rendering
                // or if the source revision has changed
                const fingerprint = this._rttFingerprints[source][tile.tileID.key];
                if (fingerprint && fingerprint !== tile.rttFingerprint[source]) tile.releaseRTT(this.painter);
            }
        }
    }

    /**
     * due that switching textures is relatively slow, the render
     * layer-by-layer context is not practicable. To bypass this problem
     * this lines of code stack all layers and later render all at once.
     * Because of the stylesheet possibility to mixing render-to-texture layers
     * and 'live'-layers (f.e. symbols) it is necessary to create more stacks. For example
     * a symbol-layer is in between of fill-layers.
     * @param layer - the layer to render
     * @param renderOptions - flags describing how to render the layer
     * @returns if true layer is rendered to texture, otherwise false
     */
    _renderStack(stack: number, options: RenderOptions): void {
        const painter = this.painter;
        const layers = this._stacks[stack] || [];
        const terrainOptions: RenderOptions = {
            ...options,
            terrainRenderToTextureStack: stack,
            terrainDrawsContours: this._stackDrawsContours[stack] !== false,
        };
        for (const tile of this._renderableTiles) {
            this._rttTiles.push(tile);
            if (tile.getRTT(stack)) continue;
            const obj = tile.acquireRTT(painter, stack, this.rttSize);
            painter.bindRTT(obj);
            painter.context.clear({color: Color.transparent, stencil: 0});
            painter.currentStencilSource = undefined;
            for (const layerId of layers) {
                const layer = painter.style._layers[layerId];
                const coords = layer.source ? this._coordsAscending[layer.source][tile.tileID.key] : [tile.tileID];
                painter.context.viewport.set([0, 0, this.rttSize, this.rttSize]);
                painter._renderTileClippingMasks(layer, coords, true);
                painter.renderLayer(painter, painter.style.tileManagers[layer.source], layer, coords, options);
                if (layer.source) tile.rttFingerprint[layer.source] = this._rttFingerprints[layer.source][tile.tileID.key];
            }
        }
        drawTerrain(this.painter, this.terrain, this._rttTiles, terrainOptions);
        this._rttTiles = [];
    }

    renderLayer(layer: StyleLayer, renderOptions: RenderOptions): boolean {
        if (layer.isHidden(this.painter.transform.zoom)) return false;

        const options: RenderOptions = {...renderOptions, isRenderingToTexture: true};
        const type = layer.type;
        const isLastLayer = this._renderableLayerIds[this._renderableLayerIds.length - 1] === layer.id;

        // remember background, fill, line & raster layer to render into a stack
        if (LAYERS_TO_TEXTURES[type]) {
            const currentStack = this._stacks[this._stacks.length - 1];
            const layerDrawsAboveContours = this._contourAboveLayerIds.has(layer.id);
            const shouldSplitBeforeLayer = layerDrawsAboveContours &&
                !!currentStack?.length &&
                this._stackDrawsContours[this._stackDrawsContours.length - 1] !== false;
            if (shouldSplitBeforeLayer) {
                this._renderStack(this._stacks.length - 1, options);
            }
            // create a new stack if previous layer was not rendered to texture (f.e. symbols)
            if (!this._prevType || !LAYERS_TO_TEXTURES[this._prevType] || shouldSplitBeforeLayer) {
                this._stacks.push([]);
                this._stackDrawsContours.push(!layerDrawsAboveContours);
            }
            // push current render-to-texture layer to render-stack
            this._prevType = type;
            this._stacks[this._stacks.length - 1].push(layer.id);
            // rendering is done later, all in once
            if (!isLastLayer) return true;
        }

        // in case a stack is finished render all collected stack-layers into a texture
        if (LAYERS_TO_TEXTURES[this._prevType] || (LAYERS_TO_TEXTURES[type] && isLastLayer)) {
            this._prevType = type;
            this._renderStack(this._stacks.length - 1, options);

            return LAYERS_TO_TEXTURES[type];
        }

        return false;
    }

}
