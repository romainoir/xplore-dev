#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function loadDependency(name) {
  const candidates = [
    name,
    `/tmp/xplore-pmtiles-audit/node_modules/${name}`
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (_) { }
  }
  throw new Error(
    `Missing dependency "${name}". Install with: npm install --prefix /tmp/xplore-pmtiles-audit --no-save pmtiles @mapbox/vector-tile pbf`
  );
}

const { PMTiles, FetchSource } = loadDependency('pmtiles');
const { VectorTile } = loadDependency('@mapbox/vector-tile');
const Protobuf = loadDependency('pbf');

const DEFAULT_STYLE = 'xplore_outdoor_hybrid-2.json';
const DEFAULT_SAMPLES = [
  { name: 'world-z4', z: 4, bbox: [-180, -85, 180, 85] },
  { name: 'alps-z10', z: 10, bbox: [5, 43.5, 12.5, 47.8] },
  { name: 'matterhorn-z13', z: 13, bbox: [7.45, 45.85, 7.85, 46.1] },
  { name: 'oeschinen-z13', z: 13, bbox: [7.62, 46.43, 7.85, 46.58] },
  { name: 'rainier-z11', z: 11, bbox: [-122.1, 46.65, -121.55, 47.05] }
];

function parseArgs(argv) {
  const args = {
    style: DEFAULT_STYLE,
    markdown: '',
    samples: DEFAULT_SAMPLES,
    concurrency: 8
  };
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith('--')) args.style = rest.shift();
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--markdown') args.markdown = rest[++index] || '';
    else if (arg === '--concurrency') args.concurrency = Math.max(1, Number(rest[++index]) || 8);
    else if (arg === '--sample') {
      const [name, z, minLon, minLat, maxLon, maxLat] = String(rest[++index] || '').split(',');
      if (!name || !z) throw new Error('Invalid --sample. Use name,z,minLon,minLat,maxLon,maxLat');
      args.samples.push({
        name,
        z: Number(z),
        bbox: [Number(minLon), Number(minLat), Number(maxLon), Number(maxLat)]
      });
    }
  }
  return args;
}

function lonToTile(lon, z) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

function latToTile(lat, z) {
  const radians = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2 * 2 ** z);
}

function sampleTiles(sample) {
  const [minLon, minLat, maxLon, maxLat] = sample.bbox;
  const maxIndex = 2 ** sample.z - 1;
  const x1 = Math.max(0, Math.min(maxIndex, lonToTile(minLon, sample.z)));
  const x2 = Math.max(0, Math.min(maxIndex, lonToTile(maxLon, sample.z)));
  const y1 = Math.max(0, Math.min(maxIndex, latToTile(maxLat, sample.z)));
  const y2 = Math.max(0, Math.min(maxIndex, latToTile(minLat, sample.z)));
  const tiles = [];
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x += 1) {
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y += 1) {
      tiles.push({ sample: sample.name, z: sample.z, x, y });
    }
  }
  return tiles;
}

async function mapConcurrent(items, concurrency, worker) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

function geometryType(feature) {
  return { 1: 'Point', 2: 'LineString', 3: 'Polygon' }[feature.type] || '';
}

function propValue(token, props, geomType, zoom) {
  if (token === '$type') return geomType;
  if (Array.isArray(token)) return evalExpression(token, props, geomType, zoom);
  return token;
}

function legacyPropertyValue(token, props, geomType, zoom) {
  if (token === '$type') return geomType;
  if (typeof token === 'string') return props[token];
  return propValue(token, props, geomType, zoom);
}

function compareValues(op, left, right) {
  if (op === '==') return left === right;
  if (op === '!=') return left !== right;
  if (op === '>') return left > right;
  if (op === '>=') return left >= right;
  if (op === '<') return left < right;
  if (op === '<=') return left <= right;
  return false;
}

function evalExpression(expr, props, geomType, zoom) {
  if (!Array.isArray(expr)) return expr;
  const op = expr[0];
  if (op === 'get') return props[expr[1]];
  if (op === 'literal') return expr[1];
  if (op === 'geometry-type') return geomType;
  if (op === 'zoom') return zoom;
  if (op === 'has') return Object.prototype.hasOwnProperty.call(props, expr[1]);
  if (op === '!has') return !Object.prototype.hasOwnProperty.call(props, expr[1]);
  if (op === '!') return !evalExpression(expr[1], props, geomType, zoom);
  if (['==', '!=', '>', '>=', '<', '<='].includes(op)) {
    return compareValues(op, propValue(expr[1], props, geomType, zoom), propValue(expr[2], props, geomType, zoom));
  }
  if (op === 'all') return expr.slice(1).every(item => Boolean(evalExpression(item, props, geomType, zoom)));
  if (op === 'any') return expr.slice(1).some(item => Boolean(evalExpression(item, props, geomType, zoom)));
  if (op === 'none') return !expr.slice(1).some(item => Boolean(evalExpression(item, props, geomType, zoom)));
  if (op === 'in') {
    const needle = propValue(expr[1], props, geomType, zoom);
    const haystack = propValue(expr[2], props, geomType, zoom);
    return Array.isArray(haystack) ? haystack.includes(needle) : expr.slice(2).map(item => propValue(item, props, geomType, zoom)).includes(needle);
  }
  if (op === '!in') {
    const needle = legacyPropertyValue(expr[1], props, geomType, zoom);
    return !expr.slice(2).includes(needle);
  }
  if (op === 'match') {
    const input = propValue(expr[1], props, geomType, zoom);
    for (let index = 2; index < expr.length - 1; index += 2) {
      const labels = expr[index];
      const matched = Array.isArray(labels) ? labels.includes(input) : labels === input;
      if (matched) return propValue(expr[index + 1], props, geomType, zoom);
    }
    return propValue(expr[expr.length - 1], props, geomType, zoom);
  }
  if (op === 'case') {
    for (let index = 1; index < expr.length - 1; index += 2) {
      if (evalExpression(expr[index], props, geomType, zoom)) return propValue(expr[index + 1], props, geomType, zoom);
    }
    return propValue(expr[expr.length - 1], props, geomType, zoom);
  }
  if (op === 'coalesce') {
    for (const item of expr.slice(1)) {
      const value = propValue(item, props, geomType, zoom);
      if (value !== null && value !== undefined) return value;
    }
    return null;
  }
  if (op === 'to-number') {
    for (const item of expr.slice(1)) {
      const value = Number(propValue(item, props, geomType, zoom));
      if (Number.isFinite(value)) return value;
    }
    return 0;
  }
  if (op === 'step') {
    const input = Number(propValue(expr[1], props, geomType, zoom));
    let output = propValue(expr[2], props, geomType, zoom);
    for (let index = 3; index < expr.length - 1; index += 2) {
      const stop = Number(expr[index]);
      if (!Number.isFinite(input) || input < stop) break;
      output = propValue(expr[index + 1], props, geomType, zoom);
    }
    return output;
  }
  return undefined;
}

function evalFilter(filter, props, geomType, zoom) {
  if (!filter) return true;
  if (!Array.isArray(filter)) return Boolean(filter);
  const op = filter[0];
  if (op === 'all') return filter.slice(1).every(item => evalFilter(item, props, geomType, zoom));
  if (op === 'any') return filter.slice(1).some(item => evalFilter(item, props, geomType, zoom));
  if (op === 'none') return !filter.slice(1).some(item => evalFilter(item, props, geomType, zoom));
  if (['==', '!=', '>', '>=', '<', '<='].includes(op)) {
    return compareValues(op, legacyPropertyValue(filter[1], props, geomType, zoom), propValue(filter[2], props, geomType, zoom));
  }
  if (op === 'in') {
    if (Array.isArray(filter[1])) return Boolean(evalExpression(filter, props, geomType, zoom));
    return filter.slice(2).includes(legacyPropertyValue(filter[1], props, geomType, zoom));
  }
  if (op === '!in') {
    if (Array.isArray(filter[1])) return !evalExpression(['in', ...filter.slice(1)], props, geomType, zoom);
    return !filter.slice(2).includes(legacyPropertyValue(filter[1], props, geomType, zoom));
  }
  if (op === 'has') return Object.prototype.hasOwnProperty.call(props, filter[1]);
  if (op === '!has') return !Object.prototype.hasOwnProperty.call(props, filter[1]);
  if (op === '!') return !evalFilter(filter[1], props, geomType, zoom);
  return Boolean(evalExpression(filter, props, geomType, zoom));
}

function sourceLayerKey(sourceLayer, className, subclass) {
  return `${sourceLayer}\u0000${className ?? ''}\u0000${subclass ?? ''}`;
}

function displayValue(value) {
  return value === undefined || value === null || value === '' ? '(none)' : String(value);
}

function zoomMatches(layer, z) {
  return (layer.minzoom === undefined || z >= layer.minzoom) && (layer.maxzoom === undefined || z < layer.maxzoom);
}

function layerVisible(layer) {
  return layer.layout?.visibility !== 'none';
}

function makeMarkdown(report) {
  const lines = [];
  lines.push(`# Style Class Coverage Audit`);
  lines.push('');
  lines.push(`Style: \`${report.styleFile}\``);
  lines.push(`Vector source: \`${report.vectorSourceId}\``);
  lines.push(`PMTiles: \`${report.pmtilesUrl}\``);
  lines.push('');
  lines.push(`Observed ${report.observedPairs} distinct source-layer/class/subclass pairs from ${report.tilesRead}/${report.tilesPlanned} sampled tiles.`);
  lines.push('');
  lines.push('## Missing Source Layers');
  lines.push('');
  if (!report.missingSourceLayers.length) {
    lines.push('All style source layers exist in PMTiles metadata.');
  } else {
    lines.push('| Missing source layer | Style layers |');
    lines.push('| --- | --- |');
    report.missingSourceLayers.forEach(item => {
      lines.push(`| ${item.sourceLayer} | ${item.layers.join(', ')} |`);
    });
  }
  lines.push('');
  lines.push('## Samples');
  lines.push('');
  lines.push('| Sample | Zoom | BBox | Tiles |');
  lines.push('| --- | ---: | --- | ---: |');
  report.samples.forEach(sample => {
    lines.push(`| ${sample.name} | ${sample.z} | ${sample.bbox.join(', ')} | ${sample.tiles} |`);
  });
  lines.push('');
  lines.push('## Missing Visible Coverage');
  lines.push('');
  if (!report.missing.length) {
    lines.push('No observed `class/subclass` pair was missing a visible style layer in this sample set.');
  } else {
    lines.push('| Source layer | Class | Subclass | Features | Samples |');
    lines.push('| --- | --- | --- | ---: | --- |');
    report.missing.forEach(item => {
      lines.push(`| ${item.sourceLayer} | ${displayValue(item.className)} | ${displayValue(item.subclass)} | ${item.count} | ${item.samples.join(', ')} |`);
    });
  }
  lines.push('');
  lines.push('## Covered Only Outside Sample Zoom');
  lines.push('');
  if (!report.onlyOtherZoom.length) {
    lines.push('No observed pair was only covered outside the sampled zooms.');
  } else {
    lines.push('| Source layer | Class | Subclass | Features | Matching layers |');
    lines.push('| --- | --- | --- | ---: | --- |');
    report.onlyOtherZoom.forEach(item => {
      lines.push(`| ${item.sourceLayer} | ${displayValue(item.className)} | ${displayValue(item.subclass)} | ${item.count} | ${item.layers.join(', ')} |`);
    });
  }
  lines.push('');
  lines.push('## Observed Values By Source Layer');
  lines.push('');
  Object.entries(report.bySourceLayer).forEach(([sourceLayer, values]) => {
    lines.push(`### ${sourceLayer}`);
    lines.push('');
    lines.push('| Class | Subclass | Features | Coverage | Layers |');
    lines.push('| --- | --- | ---: | --- | --- |');
    values.forEach(item => {
      lines.push(`| ${displayValue(item.className)} | ${displayValue(item.subclass)} | ${item.count} | ${item.coverage} | ${item.layers.join(', ')} |`);
    });
    lines.push('');
  });
  lines.push('## Notes');
  lines.push('');
  lines.push('- This checks values observed in sampled vector tiles, not an official exhaustive schema. If a rare class is absent from these samples, it will not appear here.');
  lines.push('- A pair is considered covered when at least one visible style layer for the same source layer matches the feature filter.');
  lines.push('- Layers with `layout.visibility: none` do not count as visible coverage.');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const styleFile = path.resolve(args.style);
  const style = JSON.parse(fs.readFileSync(styleFile, 'utf8'));
  const vectorSourceEntry = Object.entries(style.sources || {}).find(([, source]) => source.type === 'vector');
  if (!vectorSourceEntry) throw new Error('No vector source found in style.');
  const [vectorSourceId, vectorSource] = vectorSourceEntry;
  const pmtilesUrl = String(vectorSource.url || '').replace(/^pmtiles:\/\//, '');
  if (!pmtilesUrl) throw new Error(`Vector source ${vectorSourceId} has no PMTiles URL.`);

  const styleLayers = (style.layers || []).filter(layer => layer.source === vectorSourceId && layer['source-layer']);
  const styleLayersBySourceLayer = new Map();
  styleLayers.forEach(layer => {
    const key = layer['source-layer'];
    if (!styleLayersBySourceLayer.has(key)) styleLayersBySourceLayer.set(key, []);
    styleLayersBySourceLayer.get(key).push(layer);
  });

  const pmtiles = new PMTiles(new FetchSource(pmtilesUrl));
  const metadata = await pmtiles.getMetadata();
  const sourceLayersWithClass = new Set(
    (metadata.vector_layers || [])
      .filter(layer => layer.fields?.class || layer.fields?.subclass)
      .map(layer => layer.id)
  );
  const metadataSourceLayers = new Set((metadata.vector_layers || []).map(layer => layer.id));
  const missingSourceLayersById = new Map();
  styleLayers.forEach(layer => {
    const sourceLayer = layer['source-layer'];
    if (metadataSourceLayers.has(sourceLayer)) return;
    if (!missingSourceLayersById.has(sourceLayer)) missingSourceLayersById.set(sourceLayer, []);
    missingSourceLayersById.get(sourceLayer).push(layer.id);
  });

  const allTiles = args.samples.flatMap(sample => sampleTiles(sample));
  const seenTileKeys = new Set();
  const tiles = allTiles.filter(tile => {
    const key = `${tile.z}/${tile.x}/${tile.y}`;
    if (seenTileKeys.has(key)) return false;
    seenTileKeys.add(key);
    return true;
  });

  const observed = new Map();
  let tilesRead = 0;
  await mapConcurrent(tiles, args.concurrency, async tileRef => {
    const tile = await pmtiles.getZxy(tileRef.z, tileRef.x, tileRef.y);
    if (!tile?.data) return;
    tilesRead += 1;
    const vectorTile = new VectorTile(new Protobuf(tile.data));
    Object.entries(vectorTile.layers).forEach(([sourceLayer, vectorLayer]) => {
      if (!sourceLayersWithClass.has(sourceLayer)) return;
      for (let index = 0; index < vectorLayer.length; index += 1) {
        const feature = vectorLayer.feature(index);
        const props = feature.properties || {};
        if (props.class === undefined && props.subclass === undefined) continue;
        const key = sourceLayerKey(sourceLayer, props.class, props.subclass);
        if (!observed.has(key)) {
          observed.set(key, {
            sourceLayer,
            className: props.class,
            subclass: props.subclass,
            count: 0,
            samples: new Set(),
            matchingVisibleAtZoom: new Set(),
            matchingVisibleAnyZoom: new Set(),
            matchingHidden: new Set()
          });
        }
        const item = observed.get(key);
        item.count += 1;
        item.samples.add(tileRef.sample);
        const geomType = geometryType(feature);
        (styleLayersBySourceLayer.get(sourceLayer) || []).forEach(layer => {
          if (!evalFilter(layer.filter, props, geomType, tileRef.z)) return;
          if (!layerVisible(layer)) {
            item.matchingHidden.add(layer.id);
            return;
          }
          item.matchingVisibleAnyZoom.add(layer.id);
          if (zoomMatches(layer, tileRef.z)) item.matchingVisibleAtZoom.add(layer.id);
        });
      }
    });
  });

  const values = [...observed.values()].sort((a, b) => (
    a.sourceLayer.localeCompare(b.sourceLayer) ||
    displayValue(a.className).localeCompare(displayValue(b.className)) ||
    displayValue(a.subclass).localeCompare(displayValue(b.subclass))
  ));
  const normalized = values.map(item => {
    let coverage = 'missing';
    let layers = [];
    if (item.matchingVisibleAtZoom.size) {
      coverage = 'visible';
      layers = [...item.matchingVisibleAtZoom];
    } else if (item.matchingVisibleAnyZoom.size) {
      coverage = 'other zoom';
      layers = [...item.matchingVisibleAnyZoom];
    } else if (item.matchingHidden.size) {
      coverage = 'hidden only';
      layers = [...item.matchingHidden];
    }
    return {
      sourceLayer: item.sourceLayer,
      className: item.className,
      subclass: item.subclass,
      count: item.count,
      samples: [...item.samples].sort(),
      coverage,
      layers
    };
  });

  const bySourceLayer = {};
  normalized.forEach(item => {
    if (!bySourceLayer[item.sourceLayer]) bySourceLayer[item.sourceLayer] = [];
    bySourceLayer[item.sourceLayer].push(item);
  });

  const samples = args.samples.map(sample => ({
    ...sample,
    tiles: sampleTiles(sample).length
  }));
  const report = {
    styleFile: path.relative(process.cwd(), styleFile),
    vectorSourceId,
    pmtilesUrl,
    samples,
    tilesPlanned: tiles.length,
    tilesRead,
    observedPairs: normalized.length,
    missingSourceLayers: [...missingSourceLayersById.entries()]
      .map(([sourceLayer, layers]) => ({ sourceLayer, layers }))
      .sort((a, b) => a.sourceLayer.localeCompare(b.sourceLayer)),
    missing: normalized.filter(item => item.coverage === 'missing' || item.coverage === 'hidden only'),
    onlyOtherZoom: normalized.filter(item => item.coverage === 'other zoom'),
    bySourceLayer
  };

  const markdown = makeMarkdown(report);
  if (args.markdown) {
    fs.mkdirSync(path.dirname(args.markdown), { recursive: true });
    fs.writeFileSync(args.markdown, markdown);
  }
  process.stdout.write(markdown);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
