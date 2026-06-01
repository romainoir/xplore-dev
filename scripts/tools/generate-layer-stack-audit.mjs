import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const mdOutPath = path.join(root, 'docs/layer-stack-audit.md');
const htmlOutPath = path.join(root, 'docs/layer-stack-audit.html');

const styleFiles = [
  ['Xplore Outdoor Hybrid', 'xplore_outdoor_hybrid.json'],
  ['Cartes Outdoor local', 'cartes_outdoor.json'],
  ['Liberty Local / Xplore', 'Xplore.json'],
  ['OSM Liberty', 'osm_liberty.json'],
  ['Terrain Stadia local', 'terrain_vector_on_stadia.json'],
];

const fillSourceLayers = ['park', 'landuse', 'landcover', 'water', 'aeroway'];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function cell(value) {
  if (value === undefined || value === null || value === '') return '';
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function table(headers, rows) {
  const header = `| ${headers.map(cell).join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(row => `| ${headers.map(h => cell(row[h])).join(' | ')} |`);
  return [header, sep, ...body].join('\n');
}

function escapeHtml(value) {
  return cell(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlCell(value) {
  const normalized = cell(value);
  if (normalized.startsWith('<span class="pill ')) return normalized;
  return escapeHtml(normalized);
}

function htmlTable(headers, rows, className = '') {
  return [
    `<div class="table-wrap ${className}">`,
    '<table>',
    '<thead>',
    `<tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`,
    '</thead>',
    '<tbody>',
    ...rows.map(row => `<tr>${headers.map(h => `<td>${htmlCell(row[h])}</td>`).join('')}</tr>`),
    '</tbody>',
    '</table>',
    '</div>',
  ].join('\n');
}

function bucketClass(bucket = '') {
  return String(bucket).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

function classifyStyleLayer(layer) {
  if (!layer || !layer.id) return { bucket: 'unknown', finalZone: 'unknown', note: '' };
  if (layer.type === 'background') {
    return {
      bucket: 'background',
      finalZone: '01 replaced by terrain-bg',
      note: 'Removed by injectOverlaysIntoStyle; paint is copied to terrain-bg when available.',
    };
  }

  const sourceLayer = String(layer['source-layer'] || '').toLowerCase();
  const idLower = String(layer.id).toLowerCase();
  const isRoadLike = sourceLayer.includes('road') || sourceLayer.includes('highway')
    || sourceLayer.includes('transport') || sourceLayer.includes('cycle')
    || sourceLayer.includes('rail') || idLower.includes('road')
    || idLower.includes('path') || idLower.includes('track') || idLower.includes('rail');
  const isBuilding = sourceLayer.includes('building') || idLower.includes('building');
  const isBoundary = sourceLayer.includes('boundary') || idLower.includes('boundary');
  const isWaterway = sourceLayer.includes('waterway') || idLower.includes('river')
    || idLower.includes('stream') || idLower.includes('canal') || idLower.includes('waterway');
  const isFillLayer = layer.type === 'fill' && fillSourceLayers.some(sl => sourceLayer.startsWith(sl));

  if (layer.type === 'symbol') {
    return {
      bucket: 'overlay/symbol',
      finalZone: '13 labels/icons',
      note: 'All style symbols are moved to the top after route/debug layers.',
    };
  }
  if (layer.type === 'fill-extrusion' || isRoadLike || isBuilding || isBoundary || isWaterway) {
    return {
      bucket: 'overlay',
      finalZone: '09 style overlays',
      note: 'Moved above hillshade/analysis and below symbols.',
    };
  }
  if (isFillLayer) {
    return {
      bucket: 'fills',
      finalZone: '05 vector fills',
      note: 'Moved below hillshade so relief shades the fill color.',
    };
  }
  return {
    bucket: 'underlay',
    finalZone: '04 vector underlay',
    note: 'Opacity controlled by vector/base visibility; not explicitly reordered after fill pass.',
  };
}

function compactLayer(layer) {
  const cls = classifyStyleLayer(layer);
  return {
    '#': layer.__index,
    zone: cls.finalZone,
    bucket: cls.bucket,
    id: layer.id,
    type: layer.type,
    source: layer.source || '',
    'source-layer': layer['source-layer'] || '',
    minzoom: layer.minzoom ?? '',
    maxzoom: layer.maxzoom ?? '',
    note: cls.note,
  };
}

const runtimeZones = [
  { zone: '01', layer: 'terrain-bg', source: 'overlay-manager', role: 'Background / neutral no-basemap white background', risk: 'Replaces every style background. Good for None, but it means style background colors are not real style layers anymore.' },
  { zone: '02', layer: 'terrain', source: 'overlay-manager', role: 'Raster DEM texture used as terrain base', risk: 'Can be visually redundant with terrain-bg + hillshade if it is only used as a DEM carrier.' },
  { zone: '03', layer: 'basemap raster group', source: 'IMAGERY_OPTIONS basemap ids', role: 'IGN Scan, orthophotos, satellite, COSIA, Lidar MNT/MNS, forest inventory', risk: 'Same order path as imagery overlays, but treated as basemap by id list.' },
  { zone: '04', layer: 'style underlay bucket', source: 'current vector style', role: 'Non-fill, non-overlay style layers', risk: 'Bucket is heuristic. Some land/area layers can be misbucketed depending on source-layer names.' },
  { zone: '05', layer: 'style fills bucket', source: 'current vector style', role: 'park/landuse/landcover/water/aeroway fills below hillshade', risk: 'Fill bucket plus raster basemaps can overlap; hidden by basemap switch, but source of complexity.' },
  { zone: '06', layer: 'hillshade2, hillshade, terrain-derivative-cache', source: 'overlay-manager', role: 'Relief shading and derivative cache', risk: 'Xplore.json already has a hillshade id, which collides with the generated hillshade id.' },
  { zone: '07', layer: 'terrain native analysis', source: 'overlay-manager + IMAGERY_OPTIONS', role: 'normalmap, snow-native, aspect, slope, avalanche, shadow-v3, daylight windows', risk: 'Several are custom/native layers sharing DEM sources; their relative order is hardcoded separately.' },
  { zone: '08', layer: 'raster overlays', source: 'IMAGERY_OPTIONS overlay ids', role: 'Strava, winter traces, snow-depth', risk: 'The ordering is user reorderable, but constrained by basemap/overlay buckets.' },
  { zone: '09', layer: 'style overlay bucket', source: 'current vector style', role: 'roads, paths, rails, buildings, boundaries, waterways, non-symbol overlays', risk: 'Moved above analysis; can cover slope/aspect/shadow more than expected.' },
  { zone: '10', layer: 'GPX', source: 'scripts/gpx/gpx-io.js', role: 'Imported GPX line and point layers', risk: 'Inserted before top symbol layer; later global symbol moves can put labels above GPX.' },
  { zone: '11', layer: 'route layers', source: 'directions-manager-init.js', role: 'Route lines, waypoints, markers, hover/drag layers', risk: 'Manual route layers and POI layers are not in ROUTE_LAYER_ORDER_TOP_TO_BOTTOM.' },
  { zone: '12', layer: 'debug network', source: 'routing-orchestrator.js', role: 'Offline network debug lines, intersections, POIs', risk: 'bringDebugNetworkToFront runs before style symbols are moved to top, so labels can cover debug.' },
  { zone: '13', layer: 'style symbols', source: 'current vector style', role: 'Basemap labels and icons', risk: 'Moved to absolute top late; this can cover route/debug/analysis overlays.' },
  { zone: '14', layer: 'contour 2D layers', source: 'contour-2d.js', role: 'contour-line-minor, contour-line-major, contour-label', risk: 'There is also shader contour rendering; this is a second contour system.' },
  { zone: '15', layer: 'wikimedia', source: 'wikimedia-photos.js', role: 'photo query circle and thumbnail symbols', risk: 'Always moved to top; intentionally overrides everything.' },
];

const dynamicLayers = [
  ['01', 'terrain-bg', 'background', 'overlay-manager', 'always / None white', 'Generated background; receives incoming style background paint.'],
  ['02', 'terrain', 'raster', 'terrainSource', 'vector base', 'Added after terrain-bg. Hidden when vector base hidden.'],
  ['06', 'hillshade2', 'hillshade', 'reliefDem', 'vector base', 'Second relief shade layer.'],
  ['06', 'hillshade', 'hillshade', 'hillshadeSource', 'vector base', 'Potential ID collision with Xplore.json hillshade.'],
  ['06', 'terrain-derivative-cache', 'hillshade', 'terrainSource', 'cache', 'Visible but transparent; used by shader/derivatives.'],
  ['07', 'normalmap', 'hillshade/native', 'hillshadeSource', 'hidden/native', 'Native analysis carrier.'],
  ['07', 'snow-native', 'hillshade/native', 'hillshadeSource', 'snow toolbox', 'Snow native analysis layer.'],
  ['07', 'aspect-native', 'hillshade/native', 'hillshadeSource', 'terrain toolbox', 'Aspect.'],
  ['07', 'slope-native', 'hillshade/native', 'hillshadeSource', 'terrain toolbox', 'Slope.'],
  ['07', 'avalanche-native', 'hillshade/native', 'hillshadeSource', 'terrain toolbox', 'Avalanche.'],
  ['07', 'daylight-native', 'daylight', 'terrainSource', 'shadow toolbox', 'Exclusive with shadow-v3 and sun windows.'],
  ['07', 'sunrise-window-native', 'daylight', 'terrainSource', 'shadow toolbox', 'Sunrise window.'],
  ['07', 'sunset-window-native', 'daylight', 'terrainSource', 'shadow toolbox', 'Sunset window.'],
  ['07', 'shadow-v3-coarse', 'shadow', 'terrainSource', 'shadow toolbox', 'Custom cast shadow layer.'],
  ['03', 'ign-scan', 'raster', 'ign-scan', 'basemap', 'IGN Scan.'],
  ['03', 'ign-cosia', 'raster', 'ign-cosia', 'basemap/land cover', 'COSIA land cover.'],
  ['03', 'ign-forest-inventory', 'raster', 'ign-forest-inventory', 'basemap/land cover', 'Forest overlay for Lidar.'],
  ['03', 'ign-orthophotos', 'raster', 'ign-orthophotos', 'basemap', 'IGN ortho.'],
  ['03', 'world-imagery', 'raster', 'world-imagery', 'basemap', 'Layer id differs from option id eox-s2.'],
  ['03', 'ign-lidar-hd-mns-shadow', 'raster', 'ign-lidar-hd-mns-shadow', 'basemap', 'Lidar MNS shadow.'],
  ['03', 'ign-lidar-hd-mnt-shadow', 'raster', 'ign-lidar-hd-mnt-shadow', 'basemap', 'Lidar MNT shadow.'],
  ['08', 'strava-heatmap-all', 'raster', 'strava-heatmap-all', 'imagery overlay', 'Heatmap group exclusive.'],
  ['08', 'strava-winter', 'raster', 'strava-winter', 'imagery overlay', 'Heatmap group exclusive.'],
  ['08', 'strava-backcountry-ski', 'raster', 'strava-backcountry-ski', 'imagery overlay', 'Heatmap group exclusive.'],
  ['08', 'strava-cycling', 'raster', 'strava-cycling', 'imagery overlay', 'Heatmap group exclusive.'],
  ['08', 'strava-run', 'raster', 'strava-run', 'imagery overlay', 'Heatmap group exclusive.'],
  ['08', 'ign-traces-hivernales', 'raster', 'ign-traces-hivernales', 'imagery overlay', 'Winter traces.'],
  ['08', 'snow-depth', 'raster', 'snow-depth', 'snow toolbox', 'Raster snow depth.'],
  ['09', 'osm-features', 'virtual bucket', 'style overlay bucket', 'pathway/vector', 'Controls non-symbol overlay bucket opacity.'],
  ['05', 'vector-fills', 'virtual bucket', 'style fill bucket', 'basemap/vector', 'Controls fill bucket opacity.'],
  ['01?', 'white-background', 'background option', 'background', 'hidden/dead', 'Layer id background is usually removed; probably legacy/dead after terrain-bg.'],
  ['10', 'gpx-track-line', 'line', 'gpx-source', 'GPX import', 'Inserted before top label.'],
  ['10', 'gpx-track-points', 'circle', 'gpx-source', 'GPX import', 'Inserted before top label.'],
  ['11', 'route-line-casing', 'line', 'route-line-source', 'directions', 'In route reorder list.'],
  ['11', 'route-line', 'line', 'route-line-source', 'directions', 'In route reorder list.'],
  ['11', 'route-line-manual-bg', 'line', 'route-manual-source', 'directions', 'Not in ROUTE_LAYER_ORDER_TOP_TO_BOTTOM.'],
  ['11', 'route-line-manual', 'line', 'route-manual-source', 'directions', 'Not in ROUTE_LAYER_ORDER_TOP_TO_BOTTOM.'],
  ['11', 'route-segment-hover', 'line', 'route-segments-source', 'directions', 'In route reorder list.'],
  ['11', 'distance-markers', 'symbol', 'distance-markers-source', 'directions', 'In route reorder list but symbols later move above.'],
  ['11', 'waypoints-hit-area', 'circle', 'waypoints', 'directions', 'In route reorder list.'],
  ['11', 'route-pois', 'circle', 'route-pois', 'directions', 'Not in route reorder list.'],
  ['11', 'route-pois-icons', 'symbol', 'route-pois', 'directions', 'Not in route reorder list.'],
  ['11', 'route-pois-labels', 'symbol', 'route-pois', 'directions', 'Not in route reorder list.'],
  ['11', 'segment-markers', 'symbol', 'segment-markers', 'directions', 'In route reorder list.'],
  ['11', 'waypoints', 'circle', 'waypoints', 'directions', 'In route reorder list.'],
  ['11', 'waypoint-hover-drag', 'circle', 'waypoints', 'directions', 'In route reorder list.'],
  ['11', 'route-hover-point', 'circle', 'route-hover-point-source', 'directions', 'In route reorder list.'],
  ['11', 'drag-preview-line', 'line', 'drag-preview-source', 'directions', 'Not in route reorder list.'],
  ['12', 'offline-router-network-debug', 'line', 'offline-router-network-debug', 'debug', 'Moved by bringDebugNetworkToFront.'],
  ['12', 'offline-router-network-debug-intersections', 'circle', 'offline-router-network-debug', 'debug', 'Moved by bringDebugNetworkToFront.'],
  ['12', 'offline-router-network-pois', 'circle', 'offline-router-network-pois', 'debug', 'Moved by bringDebugNetworkToFront.'],
  ['12', 'offline-router-network-pois-labels', 'symbol', 'offline-router-network-pois', 'debug', 'Moved by bringDebugNetworkToFront.'],
  ['14', 'contour-line-minor', 'line', 'contours', '2D contours', 'Separate from shader contours.'],
  ['14', 'contour-line-major', 'line', 'contours', '2D contours', 'Separate from shader contours.'],
  ['14', 'contour-label', 'symbol', 'contours', '2D contours', 'Moved to top after style symbols.'],
  ['15', 'wikimedia-photos-base', 'circle', 'wikimedia-photos', 'wikimedia', 'Invisible query anchor.'],
  ['15', 'wikimedia-thumbnails-small', 'symbol', 'wikimedia-photos', 'wikimedia', 'Always moved to top.'],
  ['15', 'wikimedia-thumbnails-large', 'symbol', 'wikimedia-photos', 'wikimedia', 'Always moved to top.'],
  ['debug', 'debug-tiles', 'raster', 'debug-tiles', 'debug', 'Ad-hoc debug layer from xploremap-app.js.'],
].map(([zone, id, type, source, control, note]) => ({ zone, id, type, source, control, note }));

const styleSummaries = [];
const allLayerOccurrences = new Map();
const styleTables = new Map();

for (const [label, file] of styleFiles) {
  if (!fs.existsSync(path.join(root, file))) continue;
  const style = readJson(file);
  const layers = (style.layers || []).map((layer, index) => ({ ...layer, __index: index }));
  const bucketCounts = layers.reduce((acc, layer) => {
    const bucket = classifyStyleLayer(layer).bucket;
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, {});
  styleSummaries.push({
    style: label,
    file,
    layers: layers.length,
    sources: Object.keys(style.sources || {}).join(', '),
    sprite: style.sprite || '(injected by app if Cartes)',
    glyphs: style.glyphs || '',
    buckets: Object.entries(bucketCounts).map(([k, v]) => `${k}:${v}`).join(', '),
  });
  styleTables.set(label, layers.map(compactLayer));
  for (const layer of layers) {
    if (!allLayerOccurrences.has(layer.id)) allLayerOccurrences.set(layer.id, []);
    allLayerOccurrences.get(layer.id).push(`${label}#${layer.__index}`);
  }
}

for (const layer of dynamicLayers) {
  if (!allLayerOccurrences.has(layer.id)) allLayerOccurrences.set(layer.id, []);
  allLayerOccurrences.get(layer.id).push(`dynamic:${layer.zone}`);
}

const collisions = [...allLayerOccurrences.entries()]
  .filter(([, refs]) => refs.length > 1)
  .map(([id, refs]) => ({ id, occurrences: refs.join(', ') }))
  .sort((a, b) => a.id.localeCompare(b.id));

const cartesRows = styleTables.get('Cartes Outdoor local') || [];
const issueRows = [
  { issue: 'hillshade id collision', 'why it matters': 'Xplore.json contains a hillshade layer id while overlay-manager also owns hillshade. The generated layer can be skipped, leaving a style-owned hillshade with different source/paint.' },
  { issue: 'white-background legacy option', 'why it matters': 'IMAGERY_OPTIONS still references layerId background, but backgrounds are stripped and replaced by terrain-bg. This is likely dead after the new None basemap.' },
  { issue: 'two contour systems', 'why it matters': 'The 3D terrain shader renders contours from imageryState.contours, while contour-2d.js creates contour-line-minor/major/label. They need one owner and one ordering policy.' },
  { issue: 'route order list incomplete', 'why it matters': 'route-line-manual, route-line-manual-bg, route-pois*, and drag-preview-line are created but not listed in ROUTE_LAYER_ORDER_TOP_TO_BOTTOM.' },
  { issue: 'style symbols moved very late', 'why it matters': 'Base map labels/icons are moved above route/debug layers. That may be intended for labels, but it can hide route markers/debug POIs.' },
  { issue: 'style overlay bucket is heuristic', 'why it matters': 'Road/building/boundary/waterway detection uses id/source-layer substrings. New styles can easily put layers in the wrong bucket.' },
  { issue: 'terrain + hillshade + derivative cache overlap', 'why it matters': 'terrain, hillshade2, hillshade, terrain-derivative-cache, normalmap all share DEM-related work. Some are visual, some are cache/native carriers; they should be named and ordered by explicit purpose.' },
];

const markdown = [
  '# Layer Stack Audit',
  '',
  `Generated from local files on ${new Date().toISOString()}.`,
  '',
  '## Runtime Stack Zones',
  '',
  'Approximate final order is bottom to top. Some layers move again after style changes, user imagery reorder, GPX import, or debug toggles.',
  '',
  table(['zone', 'layer', 'source', 'role', 'risk'], runtimeZones),
  '',
  '## Dynamic / App-Generated Layers',
  '',
  table(['zone', 'id', 'type', 'source', 'control', 'note'], dynamicLayers),
  '',
  '## Style File Summary',
  '',
  table(['style', 'file', 'layers', 'sources', 'sprite', 'glyphs', 'buckets'], styleSummaries),
  '',
  '## Potential Redundancy / Placement Issues',
  '',
  table(['issue', 'why it matters'], issueRows),
  '',
  '## Duplicate Layer IDs Across Styles / Dynamic Layers',
  '',
  table(['id', 'occurrences'], collisions),
  '',
  '## Cartes Outdoor Local Style Layers',
  '',
  table(['#', 'zone', 'bucket', 'id', 'type', 'source', 'source-layer', 'minzoom', 'maxzoom', 'note'], cartesRows),
  '',
].join('\n');

function renderStyleDetails() {
  return [...styleTables.entries()].map(([label, rows], index) => {
    const summary = styleSummaries.find(s => s.style === label);
    const taggedRows = rows.map(row => ({
      ...row,
      bucket: `<span class="pill ${bucketClass(row.bucket)}">${row.bucket}</span>`,
    }));
    const tableHtml = htmlTable(['#', 'zone', 'bucket', 'id', 'type', 'source', 'source-layer', 'minzoom', 'maxzoom', 'note'], taggedRows, 'wide');
    return `
      <details ${index === 0 ? 'open' : ''} class="style-detail">
        <summary>
          <span>${escapeHtml(label)}</span>
          <small>${escapeHtml(summary?.file)} · ${escapeHtml(summary?.layers)} layers · ${escapeHtml(summary?.buckets)}</small>
        </summary>
        ${tableHtml}
      </details>
    `;
  }).join('\n');
}

const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Layer Stack Audit</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7fb;
      --panel: #ffffff;
      --ink: #18212f;
      --muted: #667085;
      --line: #d8dee9;
      --accent: #1f7a8c;
      --warn: #9a3412;
      --code: #eef3f8;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background: var(--bg);
    }
    header {
      position: sticky;
      top: 0;
      z-index: 20;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(220px, 420px);
      gap: 18px;
      align-items: center;
      padding: 18px 28px;
      background: rgba(245, 247, 251, 0.96);
      border-bottom: 1px solid var(--line);
      backdrop-filter: blur(8px);
    }
    h1 { margin: 0; font-size: 22px; letter-spacing: 0; }
    .meta { color: var(--muted); font-size: 12px; margin-top: 3px; }
    #filter {
      width: 100%;
      height: 38px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 0 12px;
      font: inherit;
      background: #fff;
    }
    main {
      max-width: 1600px;
      margin: 0 auto;
      padding: 22px 28px 48px;
    }
    nav {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 18px;
    }
    nav a {
      color: var(--accent);
      background: #e8f4f6;
      border: 1px solid #c8e4e9;
      border-radius: 999px;
      padding: 6px 10px;
      text-decoration: none;
      font-size: 12px;
      font-weight: 600;
    }
    section, details {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      margin: 14px 0;
      overflow: hidden;
    }
    section > h2 {
      margin: 0;
      padding: 14px 16px;
      font-size: 16px;
      border-bottom: 1px solid var(--line);
      background: #fbfcfe;
    }
    .hint {
      margin: 0;
      padding: 12px 16px;
      color: var(--muted);
      border-bottom: 1px solid var(--line);
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px;
      padding: 14px;
    }
    .card {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 12px;
      background: #fcfdff;
    }
    .card strong { display: block; font-size: 20px; }
    .card span { color: var(--muted); }
    .table-wrap {
      max-height: 72vh;
      overflow: auto;
    }
    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      font-size: 12px;
    }
    th, td {
      text-align: left;
      vertical-align: top;
      border-bottom: 1px solid #e7ebf2;
      padding: 7px 9px;
      max-width: 440px;
    }
    th {
      position: sticky;
      top: 0;
      z-index: 5;
      background: #eef3f8;
      color: #344054;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0;
      white-space: nowrap;
    }
    td:first-child, th:first-child { white-space: nowrap; }
    tr:hover td { background: #f8fbff; }
    code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--code); border-radius: 4px; padding: 1px 4px; }
    summary {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      cursor: pointer;
      padding: 14px 16px;
      background: #fbfcfe;
      border-bottom: 1px solid var(--line);
      font-weight: 700;
    }
    summary small {
      color: var(--muted);
      font-weight: 500;
      text-align: right;
    }
    .pill {
      display: inline-block;
      min-width: 72px;
      text-align: center;
      border-radius: 999px;
      padding: 2px 7px;
      background: #eef2ff;
      color: #3730a3;
      font-weight: 700;
    }
    .fills { background: #dcfce7; color: #166534; }
    .overlay { background: #fee2e2; color: #991b1b; }
    .overlay-symbol { background: #fef3c7; color: #92400e; }
    .underlay { background: #e0f2fe; color: #075985; }
    .background { background: #f1f5f9; color: #475569; }
    .unknown { background: #f3f4f6; color: #374151; }
    .issue-table td:first-child { color: var(--warn); font-weight: 700; }
    .hidden-by-filter { display: none; }
    @media (max-width: 800px) {
      header { grid-template-columns: 1fr; padding: 14px 16px; }
      main { padding: 16px; }
      th, td { max-width: 260px; }
      summary { display: block; }
      summary small { display: block; text-align: left; margin-top: 4px; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Layer Stack Audit</h1>
      <div class="meta">Generated from local files on ${escapeHtml(new Date().toISOString())}</div>
    </div>
    <input id="filter" type="search" placeholder="Filtrer par id, source, bucket, note..." aria-label="Filtrer les tables">
  </header>
  <main>
    <nav>
      <a href="#runtime">Runtime stack</a>
      <a href="#dynamic">Dynamic layers</a>
      <a href="#styles">Styles</a>
      <a href="#issues">Issues</a>
      <a href="#duplicates">Duplicates</a>
      <a href="#style-details">Style details</a>
    </nav>

    <section id="summary">
      <h2>Summary</h2>
      <div class="cards">
        <div class="card"><strong>${escapeHtml(runtimeZones.length)}</strong><span>runtime zones</span></div>
        <div class="card"><strong>${escapeHtml(dynamicLayers.length)}</strong><span>dynamic/app layers</span></div>
        <div class="card"><strong>${escapeHtml(cartesRows.length)}</strong><span>Cartes Outdoor layers</span></div>
        <div class="card"><strong>${escapeHtml(collisions.length)}</strong><span>duplicate layer ids</span></div>
      </div>
    </section>

    <section id="runtime">
      <h2>Runtime Stack Zones</h2>
      <p class="hint">Ordre approximatif bas -> haut. Certains layers bougent encore après setStyle, reorder utilisateur, import GPX ou debug.</p>
      ${htmlTable(['zone', 'layer', 'source', 'role', 'risk'], runtimeZones)}
    </section>

    <section id="dynamic">
      <h2>Dynamic / App-Generated Layers</h2>
      ${htmlTable(['zone', 'id', 'type', 'source', 'control', 'note'], dynamicLayers)}
    </section>

    <section id="styles">
      <h2>Style File Summary</h2>
      ${htmlTable(['style', 'file', 'layers', 'sources', 'sprite', 'glyphs', 'buckets'], styleSummaries)}
    </section>

    <section id="issues">
      <h2>Potential Redundancy / Placement Issues</h2>
      ${htmlTable(['issue', 'why it matters'], issueRows, 'issue-table')}
    </section>

    <section id="duplicates">
      <h2>Duplicate Layer IDs Across Styles / Dynamic Layers</h2>
      ${htmlTable(['id', 'occurrences'], collisions)}
    </section>

    <section id="style-details">
      <h2>Local Style Layer Details</h2>
      <p class="hint">Cartes Outdoor est ouvert par défaut. Les autres styles sont repliés pour réduire le bruit.</p>
      ${renderStyleDetails()}
    </section>
  </main>
  <script>
    const filter = document.getElementById('filter');
    filter.addEventListener('input', () => {
      const query = filter.value.trim().toLowerCase();
      document.querySelectorAll('tbody tr').forEach((row) => {
        const match = !query || row.textContent.toLowerCase().includes(query);
        row.classList.toggle('hidden-by-filter', !match);
      });
    });
  </script>
</body>
</html>
`;

fs.mkdirSync(path.dirname(mdOutPath), { recursive: true });
fs.writeFileSync(mdOutPath, markdown);
fs.writeFileSync(htmlOutPath, html);
console.log(`Wrote ${path.relative(root, mdOutPath)}`);
console.log(`Wrote ${path.relative(root, htmlOutPath)}`);
