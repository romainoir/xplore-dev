import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const inputPath = path.join(root, 'cartes_outdoor.json');
const labelInputPath = path.join(root, 'cartes_base.json');
const outputPath = path.join(root, 'xplore_outdoor_hybrid.json');

const OPENMAPTILES_PM_TILES = 'pmtiles://https://tuiles.enliberte.fr/planet.pmtiles';
const OPENFREEMAP_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const LOCAL_CARTES_SPRITE = './data/vendor/cartes/sprite/sprite';
const REMOVED_SOURCE_LAYER_IDS = new Set(['Grass-Bare-Snow', 'Bare-Snow', 'Snow', 'Crops', 'Tree', 'water-depth']);
const KEPT_CARTES_SYMBOL_IDS = new Set(['Cliff Symbols', 'Arete Symbols', 'Oneway', 'Cycle highways icons']);

const style = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const labelStyle = JSON.parse(fs.readFileSync(labelInputPath, 'utf8'));

style.id = 'xplore-outdoor-hybrid';
style.name = 'Xplore Outdoor Hybrid';
style.metadata = {
  ...(style.metadata || {}),
  'xplore:base-style': 'cartes-outdoor',
  'xplore:goal': 'Cartes Outdoor readability without Cartes server data dependencies',
  'xplore:primary-vector-source': OPENMAPTILES_PM_TILES,
};
style.projection = { type: 'mercator' };
style.sprite = LOCAL_CARTES_SPRITE;
style.glyphs = OPENFREEMAP_GLYPHS;
style.sources = {
  openmaptiles: {
    type: 'vector',
    url: OPENMAPTILES_PM_TILES,
    attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
  },
};

const fontMap = new Map([
  ['RobotoRegular-NotoSansRegular', ['Noto Sans Regular']],
  ['RobotoMediumRegular-NotoSansRegular', ['Noto Sans Bold']],
  ['RobotoBold-NotoSansBold', ['Noto Sans Bold']],
  ['RobotoItalic-NotoSansItalic', ['Noto Sans Italic']],
]);

function normalizeTextFonts(layer) {
  const font = layer.layout?.['text-font'];
  if (typeof font === 'string') {
    layer.layout['text-font'] = fontMap.get(font)?.[0] || font;
    return;
  }
  if (!Array.isArray(font)) return;
  if (font.every((fontName) => typeof fontName === 'string')) {
    const mapped = font.flatMap((fontName) => fontMap.get(fontName) || [fontName]);
    layer.layout['text-font'] = [...new Set(mapped)];
    return;
  }
  layer.layout['text-font'] = normalizeFontExpression(font);
}

function normalizeFontExpression(value) {
  if (typeof value === 'string') return fontMap.get(value)?.[0] || value;
  if (Array.isArray(value)) return value.map(normalizeFontExpression);
  return value;
}

function mutateLayer(layer) {
  normalizeTextFonts(layer);

  if (layer.source === 'openmaptiles' && layer['source-layer'] === 'mountain') {
    layer['source-layer'] = 'mountain_peak';
  }

  if (layer.id === 'Cliff Symbols' || layer.id === 'Arete Symbols' || layer.id === 'Peak labels') {
    replacePropertyName(layer.filter, 'subclass', 'class');
  }

  applyOpenMapTilesTextFields(layer);
  tuneMountainPeakLayer(layer);
  hideMountainPeakFallbackLabelLayer(layer);
  applyPastelPalette(layer);
}

function mutateCartesLabelLayer(layer) {
  layer.source = 'openmaptiles';
  layer.metadata = {
    ...(layer.metadata || {}),
    'xplore:label-source': 'cartes-base',
  };

  const layout = { ...(layer.layout || {}) };
  layout.visibility = layout.visibility || 'visible';
  layout['text-field'] = chooseLabelTextField(layer);
  layer.layout = layout;

  if (layer['source-layer'] === 'mountain') {
    layer['source-layer'] = 'mountain_peak';
  }
  if (layer.id === 'Stone' || layer.id === 'Peak labels') {
    replacePropertyName(layer.filter, 'subclass', 'class');
  }

  normalizeTextFonts(layer);
  tuneMountainPeakLayer(layer);
  hideMountainPeakFallbackLabelLayer(layer);
  applyPastelPalette(layer);
  return layer;
}

function chooseLabelTextField(layer) {
  const id = layer.id.toLowerCase();
  const sourceLayer = layer['source-layer'];
  if (id === 'difficult path label' || id === 'private road labels') return layer.layout?.['text-field'];
  if (id === 'stone') return localizedName();
  if (sourceLayer === 'housenumber') return '{housenumber}';
  if (id.includes('shield')) return '{ref}';
  if (id.includes('junction')) return '{ref}';
  if (id.includes('gate')) return '{ref}';
  if (sourceLayer === 'aerodrome_label' || id.includes('airport')) return airportLabel();
  if (sourceLayer === 'mountain_peak' || sourceLayer === 'mountain' || id.includes('peak') || id.includes('volcano')) return peakLabel();
  if (id === 'road labels') return namedRoadLabel();
  return localizedName();
}

function replacePropertyName(value, from, to) {
  if (!Array.isArray(value)) return;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === from) value[i] = to;
    else replacePropertyName(value[i], from, to);
  }
}

function localizedName() {
  return [
    'coalesce',
    ['get', 'name:fr'],
    ['get', 'name'],
    ['get', 'name:latin'],
    ['get', 'name_en'],
    ['get', 'name:en'],
    ['get', 'name:nonlatin'],
    '',
  ];
}

function namedRoadLabel() {
  const name = localizedName();
  return [
    'case',
    ['all', ['has', 'ref'], ['!=', name, '']],
    ['concat', name, ' ', ['get', 'ref']],
    ['has', 'ref'],
    ['get', 'ref'],
    name,
  ];
}

function peakLabel() {
  const name = localizedName();
  return [
    'case',
    ['all', ['has', 'ele'], ['!=', name, '']],
    ['concat', name, '\n', ['to-string', ['get', 'ele']], ' m'],
    ['has', 'ele'],
    ['concat', ['to-string', ['get', 'ele']], ' m'],
    name,
  ];
}

function peakRank() {
  return ['to-number', ['coalesce', ['get', 'rank'], 99], 99];
}

function peakRankThreshold() {
  return ['step', ['zoom'], 1, 9, 2, 11, 4, 12.5, 8, 14, 16, 16, 99];
}

function peakVisibilityFilter({ requireElevation = false, requireName = false } = {}) {
  const filter = [
    'all',
    ['==', ['geometry-type'], 'Point'],
    ['in', ['get', 'class'], ['literal', ['peak', 'volcano']]],
    ['any', ['has', 'ele'], ['!=', localizedName(), '']],
    ['<=', peakRank(), peakRankThreshold()],
  ];
  if (requireElevation) filter.push(['has', 'ele']);
  if (requireName) filter.push(['!=', localizedName(), '']);
  return filter;
}

function tuneMountainPeakLayer(layer) {
  if (layer.id !== 'Peak labels') return;

  layer.minzoom = 10;
  delete layer.maxzoom;
  layer.filter = peakVisibilityFilter({ requireElevation: true, requireName: true });
  layer.layout = {
    'icon-image': 'cartesapp-triangle',
    'icon-size': [
      'interpolate',
      ['linear'],
      ['zoom'],
      10,
      ['case', ['==', peakRank(), 1], 0.7, 0.5],
      14,
      ['case', ['==', peakRank(), 1], 1, 0.8],
    ],
    'text-field': peakLabel(),
    'text-font': ['Noto Sans Bold'],
    'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 16, 18, 20],
    'text-anchor': 'top',
    'text-offset': [0, 0.7],
    'text-padding': 4,
    'text-max-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 15, 8],
    'symbol-sort-key': peakRank(),
    'symbol-z-order': 'viewport-y',
    visibility: 'visible',
  };
  layer.paint = {
    ...(layer.paint || {}),
    'icon-opacity': 0,
    'text-opacity': 0,
    'icon-translate': [0, 0],
    'text-translate': [0, 0],
    'text-color': '#26323a',
    'text-halo-width': 0,
    'text-halo-blur': 0,
    'text-halo-color': 'rgba(255,255,255,0)',
  };
}

function hideMountainPeakFallbackLabelLayer(layer) {
  if (layer.id !== 'Stone' || layer['source-layer'] !== 'mountain_peak') return;
  layer.layout = { ...(layer.layout || {}), visibility: 'none' };
  layer.paint = { ...(layer.paint || {}), 'icon-opacity': 0, 'text-opacity': 0 };
}

function airportLabel() {
  const name = localizedName();
  return [
    'step',
    ['zoom'],
    ['coalesce', ['get', 'iata'], name],
    12,
    name,
  ];
}

function applyOpenMapTilesTextFields(layer) {
  if (layer.type !== 'symbol' || !layer.layout || layer.layout['text-field'] === undefined) return;

  if (layer.id === 'Road labels') {
    layer.layout['text-field'] = namedRoadLabel();
    return;
  }
  if (layer.id === 'Peak labels') {
    layer.layout['text-field'] = peakLabel();
    return;
  }
  if (layer.id === 'Airport') {
    layer.layout['text-field'] = airportLabel();
    return;
  }

  const nameLabelIds = new Set([
    'park null label',
    'boundary low_emission_zone label',
    'boundary limited_traffic_zone label',
    'River labels',
    'Ocean and sea labels',
    'Ocean labels',
    'Lake labels',
    'Gondola',
    'Ferry',
    'Stone',
    'Parking',
    'Car utilities',
    'Other POI',
    'Protected area labels',
    'Place labels',
    'Station',
    'State labels',
    'Town labels',
    'City labels',
    'Capital city labels',
    'Country labels',
    'Continent labels',
    'Hiking route labels',
    'Bicycle route labels',
    'MTB route labels',
    'Ski route labels',
  ]);

  if (nameLabelIds.has(layer.id)) {
    layer.layout['text-field'] = localizedName();
  }
}

const palette = {
  backgroundLow: 'hsl(47, 26%, 88%)',
  backgroundHigh: 'hsl(43, 28%, 93%)',
  residentialLow: 'hsl(47, 16%, 88%)',
  residentialHigh: 'hsl(35, 18%, 91%)',
  industrial: 'hsl(47, 24%, 88%)',
  quarry: 'hsla(30, 22%, 84%, 0.55)',
  retail: 'hsl(35, 18%, 92%)',
  school: 'hsl(39, 31%, 88%)',
  hospital: 'hsl(0, 31%, 92%)',
  cemetery: 'hsl(82, 14%, 85%)',
  stadium: 'hsl(94, 38%, 85%)',
  farmland: '#eae0d0',
  grass: 'hsl(82, 42%, 76%)',
  woodNeedle: 'hsl(105, 25%, 63%)',
  woodBroadleaf: 'hsl(87, 36%, 70%)',
  glacier: 'hsl(200, 40%, 94%)',
  rock: 'hsl(25, 8%, 78%)',
  wetland: 'hsla(190, 36%, 70%, 0.35)',
  sand: 'hsl(47, 46%, 82%)',
  water: 'hsl(205, 56%, 73%)',
  waterIntermittent: 'hsl(205, 56%, 82%)',
  waterTunnel: 'hsl(205, 50%, 80%)',
  park: 'hsl(102, 24%, 62%)',
  parkLine: 'hsl(102, 24%, 54%)',
  parkText: 'hsl(108, 29%, 27%)',
  building: 'hsl(36, 25%, 80%)',
  buildingOutline: 'hsl(31, 18%, 70%)',
  pier: 'hsl(43, 30%, 91%)',
  cliff: 'hsl(23, 14%, 46%)',
  cycleway: 'hsl(226, 48%, 70%)',
  cyclewayOutline: 'hsl(226, 32%, 42%)',
};

const woodBlendColor = [
  'match',
  ['get', 'leaf_type'],
  'needleleaved',
  palette.woodNeedle,
  palette.woodBroadleaf,
];

const landcoverBlendColor = [
  'case',
  ['==', ['get', 'class'], 'wood'],
  woodBlendColor,
  ['==', ['get', 'class'], 'grass'],
  palette.grass,
  ['==', ['get', 'class'], 'farmland'],
  palette.farmland,
  ['==', ['get', 'class'], 'rock'],
  palette.rock,
  ['==', ['get', 'class'], 'sand'],
  palette.sand,
  ['==', ['get', 'class'], 'wetland'],
  palette.wetland,
  ['==', ['get', 'class'], 'ice'],
  palette.glacier,
  palette.backgroundLow,
];

function landuseBlendColorAtZoom(residentialColor) {
  return [
    'case',
    ['in', ['get', 'class'], ['literal', ['residential', 'suburbs', 'neighbourhood']]],
    residentialColor,
    ['==', ['get', 'class'], 'industrial'],
    palette.industrial,
    ['==', ['get', 'class'], 'quarry'],
    palette.quarry,
    ['==', ['get', 'class'], 'retail'],
    palette.retail,
    ['in', ['get', 'class'], ['literal', ['college', 'school', 'university']]],
    palette.school,
    ['==', ['get', 'class'], 'hospital'],
    palette.hospital,
    ['==', ['get', 'class'], 'cemetery'],
    palette.cemetery,
    ['in', ['get', 'class'], ['literal', ['pitch', 'stadium', 'playground']]],
    palette.stadium,
    palette.residentialHigh,
  ];
}

const landuseBlendColor = [
  'interpolate',
  ['linear'],
  ['zoom'],
  1,
  landuseBlendColorAtZoom(palette.residentialLow),
  15,
  landuseBlendColorAtZoom(palette.residentialHigh),
];

const waterBlendColor = [
  'case',
  ['all', ['has', 'intermittent'], ['==', ['get', 'intermittent'], 1]],
  palette.waterIntermittent,
  palette.water,
];

function applyPastelPalette(layer) {
  const paint = layer.paint || {};

  if (layer.id === 'Background') {
    paint['background-color'] = ['interpolate', ['linear'], ['zoom'], 1, palette.backgroundLow, 15, palette.backgroundHigh];
  } else if (layer.id === 'Residential') {
    paint['fill-color'] = ['interpolate', ['linear'], ['zoom'], 1, palette.residentialLow, 15, palette.residentialHigh];
  } else if (layer.id === 'Industrial') {
    paint['fill-color'] = ['match', ['get', 'class'], 'industrial', palette.industrial, palette.quarry];
  } else if (layer.id === 'Retail') {
    paint['fill-color'] = palette.retail;
  } else if (layer.id === 'School') {
    paint['fill-color'] = palette.school;
  } else if (layer.id === 'Hospital') {
    paint['fill-color'] = palette.hospital;
  } else if (layer.id === 'Airport zone' || layer.id === 'Aeroway' || layer.id === 'Heliport') {
    paint[layer.type === 'line' ? 'line-color' : 'fill-color'] = 'hsl(42, 18%, 94%)';
  } else if (layer.id === 'Farmland') {
    paint['fill-color'] = palette.farmland;
  } else if (layer.id === 'Grass') {
    paint['fill-color'] = palette.grass;
    paint['fill-opacity'] = 0.52;
  } else if (layer.id === 'Wood') {
    paint['fill-color'] = woodBlendColor;
    paint['fill-opacity'] = 0.52;
  } else if (layer.id === 'Wood symbols') {
    paint['fill-opacity'] = 0.14;
  } else if (layer.id === 'Glacier') {
    paint['fill-color'] = palette.glacier;
  } else if (layer.id === 'Water ocean' || layer.id === 'Water lake') {
    paint['fill-color'] = palette.water;
  } else if (layer.id === 'Water intermittent') {
    paint['fill-color'] = palette.waterIntermittent;
    paint['fill-opacity'] = 0.75;
  } else if (layer.id === 'River' || layer.id === 'Aqueduct') {
    paint['line-color'] = palette.water;
  } else if (layer.id === 'River tunnel') {
    paint['line-color'] = palette.waterTunnel;
  } else if (layer.id === 'Rock') {
    paint['fill-color'] = palette.rock;
  } else if (layer.id === 'Rock texture') {
    paint['fill-opacity'] = 0.42;
  } else if (layer.id === 'Wetland (medium scale)') {
    paint['fill-color'] = palette.wetland;
  } else if (layer.id === 'Beach' || layer.id === 'Sand') {
    paint['fill-color'] = palette.sand;
  } else if (layer.id === 'Cemetery') {
    paint['fill-color'] = palette.cemetery;
  } else if (layer.id === 'Stadium') {
    paint['fill-color'] = palette.stadium;
  } else if (layer.id === 'Trees') {
    paint['circle-color'] = woodBlendColor;
    paint['circle-opacity'] = ['interpolate', ['linear'], ['zoom'], 14, 0.16, 22, 0.32];
  } else if (layer.id === 'Tree rows') {
    paint['line-color'] = woodBlendColor;
    paint['line-opacity'] = ['interpolate', ['linear'], ['zoom'], 14, 0.16, 22, 0.32];
  } else if (layer.id === 'park null polygon') {
    paint['fill-color'] = palette.park;
    paint['fill-opacity'] = ['interpolate', ['linear'], ['zoom'], 6, 0.08, 10, 0.12, 12, 0];
  } else if (layer.id === 'park null contour') {
    paint['line-color'] = palette.parkLine;
  } else if (layer.id === 'park null label') {
    paint['text-color'] = palette.parkText;
  } else if (layer.id === 'Protected area labels') {
    paint['icon-color'] = palette.parkText;
    paint['text-color'] = palette.parkText;
    paint['text-halo-color'] = 'hsla(47, 26%, 96%, 0.75)';
  } else if (layer.id === 'Pier' || layer.id === 'Bridge') {
    paint['fill-color'] = palette.pier;
  } else if (layer.id === 'Pier road') {
    paint['line-color'] = palette.pier;
  } else if (layer.id === 'Pedestrian polygons' || layer.id === 'Pedestrian ways') {
    paint[layer.type === 'line' ? 'line-color' : 'fill-color'] = ['match', ['get', 'subclass'], 'platform', 'hsl(260, 28%, 91%)', 'hsl(31, 40%, 94%)'];
  } else if (layer.id === 'Building') {
    paint['fill-color'] = ['string', ['get', 'colour'], palette.building];
    paint['fill-outline-color'] = palette.buildingOutline;
  } else if (layer.id === 'Building 3D') {
    paint['fill-extrusion-color'] = ['string', ['get', 'colour'], palette.building];
  } else if (layer.id === 'Cliff and Ridge Line') {
    paint['line-color'] = palette.cliff;
  } else if (layer.id === 'Cycleway' || layer.id === 'Bridge for Cycleway') {
    paint['line-color'] = palette.cycleway;
  } else if (layer.id === 'Cycleway outline' || layer.id === 'Bridge outline for Cycleway' || layer.id === 'Cycle highways outline') {
    paint['line-color'] = palette.cyclewayOutline;
  } else if (layer.id === 'Cycle highways') {
    paint['line-color'] = 'hsl(0, 0%, 98%)';
  } else if (layer.id === 'River labels') {
    paint['text-color'] = 'hsl(210, 42%, 35%)';
    paint['text-halo-color'] = 'hsla(0, 0%, 100%, 0.85)';
  } else if (layer.id === 'Ocean and sea labels' || layer.id === 'Ocean labels' || layer.id === 'Lake labels') {
    paint['text-color'] = 'hsl(210, 42%, 38%)';
    paint['text-halo-color'] = 'hsla(0, 0%, 100%, 0.75)';
  } else if (layer.id === 'Country labels') {
    paint['text-color'] = 'hsl(218, 24%, 28%)';
  } else if (layer.id === 'Continent labels') {
    paint['text-color'] = 'hsl(120, 22%, 32%)';
  }

  layer.paint = paint;
}

style.layers = style.layers.filter((layer) => !REMOVED_SOURCE_LAYER_IDS.has(layer.id));
style.layers = style.layers.filter((layer) => {
  if (layer.type !== 'symbol') return true;
  if (KEPT_CARTES_SYMBOL_IDS.has(layer.id)) return true;
  return layer.layout?.['text-field'] === undefined;
});
style.layers.forEach(mutateLayer);

const softEdgeLayers = [
  {
    id: 'xplore-landcover-soft-edge-wide',
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'landcover',
    minzoom: 7,
    maxzoom: 18,
    filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass', 'farmland', 'rock', 'sand', 'wetland', 'ice']]],
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'visible' },
    paint: {
      'line-blur': ['interpolate', ['linear'], ['zoom'], 7, 8, 9, 12, 11, 18, 15, 10, 17, 4],
      'line-color': landcoverBlendColor,
      'line-opacity': ['interpolate', ['exponential', 1.5], ['zoom'], 8, 0.34, 12, 0.22, 15, 0.1, 18, 0],
      'line-width': ['interpolate', ['linear'], ['zoom'], 7, 6, 9, 12, 11, 18, 15, 10, 17, 4],
    },
  },
  {
    id: 'xplore-landcover-soft-edge',
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'landcover',
    minzoom: 8,
    maxzoom: 22,
    filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass', 'farmland', 'rock', 'sand', 'wetland', 'ice']]],
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'visible' },
    paint: {
      'line-blur': ['interpolate', ['linear'], ['zoom'], 8, 4, 10, 8, 12, 12, 16, 7, 20, 3],
      'line-color': landcoverBlendColor,
      'line-opacity': ['interpolate', ['exponential', 1.5], ['zoom'], 9, 0.28, 12, 0.2, 14, 0.13, 17, 0.08, 20, 0.04],
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 10, 8, 12, 12, 16, 8, 20, 4],
    },
  },
  {
    id: 'xplore-landuse-soft-edge',
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'landuse',
    minzoom: 8,
    maxzoom: 20,
    filter: ['in', ['get', 'class'], ['literal', ['residential', 'suburbs', 'neighbourhood', 'industrial', 'quarry', 'commercial', 'retail', 'cemetery', 'college', 'school', 'university', 'hospital', 'pitch', 'stadium', 'playground']]],
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'visible' },
    paint: {
      'line-blur': ['interpolate', ['exponential', 1.5], ['zoom'], 8, 2, 12, 7, 15, 10, 18, 5],
      'line-color': landuseBlendColor,
      'line-opacity': ['interpolate', ['exponential', 1.5], ['zoom'], 8, 0.28, 13, 0.16, 16, 0.08, 19, 0.03],
      'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 8, 3, 12, 14, 15, 22, 18, 10],
    },
  },
  {
    id: 'xplore-water-soft-edge',
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'water',
    minzoom: 5,
    maxzoom: 18,
    filter: ['==', ['geometry-type'], 'Polygon'],
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'visible' },
    paint: {
      'line-color': waterBlendColor,
      'line-width': ['interpolate', ['linear'], ['zoom'], 5, 4, 11, 10, 16, 6],
      'line-blur': ['interpolate', ['linear'], ['zoom'], 5, 5, 11, 10, 16, 5],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.2, 11, 0.28, 14, 0.16, 17, 0.06, 18, 0],
    },
  },
];

const insertAfterId = 'Water intermittent';
const insertIndex = style.layers.findIndex((layer) => layer.id === insertAfterId);
if (insertIndex >= 0) {
  style.layers.splice(insertIndex + 1, 0, ...softEdgeLayers);
} else {
  style.layers.splice(1, 0, ...softEdgeLayers);
}

const cartesLabelLayers = labelStyle.layers
  .filter((layer) => layer?.type === 'symbol' && layer.source === 'openmaptiles' && layer.layout?.['text-field'] !== undefined)
  .map((layer) => mutateCartesLabelLayer(JSON.parse(JSON.stringify(layer))));
style.layers.push(...cartesLabelLayers);

style.layers = style.layers.filter((layer) => layer.id !== 'Peak leader lines' && layer.id !== 'Peak label icons');

function assertNoCartesServerUrls(value, pathParts = []) {
  if (typeof value === 'string') {
    if (/https?:\/\/(?:serveur\.)?cartes\.app/i.test(value)) {
      throw new Error(`Cartes server URL remains at ${pathParts.join('.')}: ${value}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoCartesServerUrls(item, pathParts.concat(index)));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      assertNoCartesServerUrls(nested, pathParts.concat(key));
    }
  }
}

assertNoCartesServerUrls(style);

fs.writeFileSync(outputPath, `${JSON.stringify(style, null, 2)}\n`);
console.log(`Wrote ${path.relative(root, outputPath)} (${style.layers.length} layers)`);
