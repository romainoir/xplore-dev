export const pmtilesProtocol = new pmtiles.Protocol({ metadata: true, errorOnMissingTile: true });

if (typeof maplibregl !== 'undefined' && typeof maplibregl.addProtocol === 'function') {
  maplibregl.addProtocol('pmtiles', (params, abortController) => pmtilesProtocol.tile(params, abortController));
}
