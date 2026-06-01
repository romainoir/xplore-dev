import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outPath = path.join(root, 'docs/style-consolidation-comparison.html');

const styles = [
  {
    name: 'Xplore Outdoor Hybrid',
    file: 'xplore_outdoor_hybrid.json',
    role: 'New candidate style: Cartes Outdoor readability, Xplore soft landcover edges, no Cartes server URLs.',
  },
  {
    name: 'Cartes Outdoor local',
    file: 'cartes_outdoor.json',
    role: 'Best outdoor starting point: natural textures, POI icons, outdoor labels, compact enough to edit.',
  },
  {
    name: 'Xplore / Alpine Topo',
    file: 'Xplore.json',
    role: 'Most concise custom topo style: useful palette, IGN path experiment, hillshade integration.',
  },
  {
    name: 'OSM Liberty local',
    file: 'osm_liberty.json',
    role: 'Full OpenMapTiles reference: good coverage, but too verbose for hand styling.',
  },
  {
    name: 'Terrain Stadia',
    file: 'terrain_vector_on_stadia.json',
    role: 'Good terrain structure and global landcover idea, but external provider and less outdoor detail.',
  },
];

const overtureBase = {
  name: 'Overture base PMTiles',
  url: 'pmtiles://https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-05-20.0/base.pmtiles',
  sourceId: 'overture_base',
  layers: [
    { id: 'bathymetry', minzoom: 0, maxzoom: 13, fields: 'cartography, depth, subtype-like metadata' },
    { id: 'infrastructure', minzoom: 13, maxzoom: 13, fields: 'class, subtype, surface, names' },
    { id: 'land', minzoom: 0, maxzoom: 13, fields: 'class, subtype, surface, elevation, names' },
    { id: 'land_cover', minzoom: 0, maxzoom: 13, fields: 'subtype, cartography' },
    { id: 'land_use', minzoom: 6, maxzoom: 13, fields: 'class, subtype, surface, names' },
    { id: 'water', minzoom: 0, maxzoom: 13, fields: 'class, subtype, is_intermittent, is_salt, names' },
  ],
};

function readStyle(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function asList(values) {
  if (!values?.length) return '<span class="muted">none</span>';
  return values.map((v) => `<code>${escapeHtml(v)}</code>`).join(' ');
}

function layerSourceKey(layer) {
  return [layer.source || '(style)', layer['source-layer'] || '(none)'].join(':');
}

function classifyLayer(layer) {
  const id = `${layer.id || ''}`.toLowerCase();
  const sourceLayer = `${layer['source-layer'] || ''}`.toLowerCase();
  const type = `${layer.type || ''}`.toLowerCase();

  if (type === 'background') return 'base land';
  if (type === 'hillshade' || id.includes('hillshade') || id.includes('shadow') || id.includes('contour')) return 'relief';
  if (sourceLayer.includes('water') || id.includes('water') || sourceLayer.includes('bathymetry') || id.includes('bathymetry')) return 'water';
  if (
    sourceLayer.includes('landcover') ||
    sourceLayer.includes('global_landcover') ||
    sourceLayer.includes('land_cover') ||
    id.includes('wood') ||
    id.includes('forest') ||
    id.includes('rock') ||
    id.includes('scree') ||
    id.includes('grass') ||
    id.includes('glacier') ||
    id.includes('sand') ||
    id.includes('wetland')
  ) return 'landcover';
  if (sourceLayer.includes('landuse') || sourceLayer.includes('land_use') || id.includes('cemetery') || id.includes('school') || id.includes('hospital')) return 'landuse';
  if (sourceLayer.includes('transportation') || sourceLayer.includes('route') || id.includes('road') || id.includes('rail') || id.includes('path') || id.includes('track') || id.includes('bridge') || id.includes('tunnel')) return 'transport';
  if (sourceLayer.includes('mountain') || id.includes('peak') || id.includes('cliff') || id.includes('ridge') || id.includes('arete')) return 'terrain features';
  if (sourceLayer.includes('boundary') || sourceLayer.includes('park') || id.includes('boundary') || id.includes('park')) return 'boundaries/parks';
  if (sourceLayer.includes('building') || id.includes('building')) return 'buildings';
  if (type === 'symbol' || sourceLayer.includes('poi') || sourceLayer.includes('place') || id.includes('label') || id.includes('poi')) return 'labels/pois';
  return 'other';
}

function summarizeStyle(styleMeta) {
  const style = readStyle(styleMeta.file);
  const layers = style.layers || [];
  const byType = {};
  const byCategory = {};
  const bySourceLayer = {};
  const paintKeys = new Set();
  const layoutKeys = new Set();
  const sourceKeys = new Set(Object.keys(style.sources || {}));
  const sourceLayerSet = new Set();

  for (const layer of layers) {
    byType[layer.type || 'unknown'] = (byType[layer.type || 'unknown'] || 0) + 1;
    const category = classifyLayer(layer);
    byCategory[category] = (byCategory[category] || 0) + 1;
    bySourceLayer[layerSourceKey(layer)] = (bySourceLayer[layerSourceKey(layer)] || 0) + 1;
    if (layer['source-layer']) sourceLayerSet.add(layer['source-layer']);
    for (const key of Object.keys(layer.paint || {})) paintKeys.add(key);
    for (const key of Object.keys(layer.layout || {})) layoutKeys.add(key);
  }

  return {
    ...styleMeta,
    style,
    layers,
    layerCount: layers.length,
    sources: sourceKeys,
    sourceLayers: sourceLayerSet,
    byType,
    byCategory,
    bySourceLayer,
    paintKeys,
    layoutKeys,
  };
}

function countRows(obj) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, v]) => `<span class="chip">${escapeHtml(k)} <b>${v}</b></span>`)
    .join(' ');
}

function sharedLayerMatrix(summaries) {
  const all = new Set();
  for (const summary of summaries) {
    for (const sourceLayer of summary.sourceLayers) all.add(sourceLayer);
  }
  return [...all].sort().map((sourceLayer) => {
    const cells = summaries.map((summary) => summary.sourceLayers.has(sourceLayer) ? 'yes' : '');
    return [sourceLayer, ...cells];
  });
}

function topLayerRows(summary) {
  return Object.entries(summary.bySourceLayer)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([key, count]) => `<tr><td><code>${escapeHtml(key)}</code></td><td>${count}</td></tr>`)
    .join('\n');
}

function categoryRows(summaries) {
  const categories = ['base land', 'landcover', 'landuse', 'water', 'relief', 'transport', 'terrain features', 'boundaries/parks', 'buildings', 'labels/pois', 'other'];
  return categories.map((category) => {
    const counts = summaries.map((summary) => summary.byCategory[category] || 0);
    return `<tr><th>${escapeHtml(category)}</th>${counts.map((count) => `<td>${count || ''}</td>`).join('')}</tr>`;
  }).join('\n');
}

function rows(values) {
  return values.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('\n');
}

const summaries = styles.map(summarizeStyle);

const recommendedCategories = [
  ['01 base land', 'Background + neutral land polygons', 'Keep 1 background and 2-4 broad land layers. Avoid many landuse tint variants.'],
  ['02 landcover texture', 'wood, grass, bare rock, scree, sand, wetland, glacier', 'Use Cartes Outdoor patterns, plus optional Overture land_cover as broad underlay. Keep <= 8 visual classes.'],
  ['03 water', 'ocean/lake/river/intermittent + optional bathymetry', 'Use OpenMapTiles water for normal map; use Overture/Cartes bathymetry as a subtle optional layer.'],
  ['04 relief', 'hillshade, contours, shadow/daylight', 'Keep app-generated relief outside the editable basemap style where possible.'],
  ['05 built areas', 'residential/industrial/cemetery/school/hospital/buildings', 'Use muted fills. Buildings only from z14/z15.'],
  ['06 transport', 'roads, tracks, paths, rail, bridges/tunnels', 'Collapse Liberty/Cartes road families to fewer styling classes.'],
  ['07 outdoor routes', 'hiking/bicycle/mtb/ski routes', 'Keep as optional group. Cartes route source is not present in Tuiles en Liberte PMTiles.'],
  ['08 boundaries/parks', 'admin boundaries, protected areas, parks', 'Thin lines and low opacity; avoid competing with routes.'],
  ['09 labels/icons', 'places, road labels, water labels, peaks, POIs', 'Use strong hierarchy: place/road/water/peak first, POIs second.'],
];

const reusePlan = [
  ['Cartes Outdoor', 'Start from this. Keep natural palette, pattern logic, outdoor POIs, peak/cliff rendering, and many road/path decisions.'],
  ['Xplore', 'Steal the concise topo choices: fewer layers, local edits, IGN path experiment, hillshade expectations.'],
  ['OSM Liberty', 'Use as reference only for mature road casing/label hierarchy. Do not copy its full layer count.'],
  ['Terrain Stadia', 'Borrow terrain/global-landcover ideas if useful, but avoid depending on the whole style.'],
  ['Tuiles en Liberte', 'Primary OpenMapTiles source for the unified style. Good free OSM vector base, PMTiles already supported in the app.'],
  ['Overture base', 'Supplemental land_cover/land_use/water/bathymetry source, not a drop-in replacement for Cartes h3-landcover.'],
];

const overtureFit = [
  ['Can replace Cartes h3-landcover directly?', 'No', 'Layer name and fields differ: Cartes uses source-layer landcover, Overture uses land_cover with subtype/cartography. Need dedicated layers.'],
  ['Can recover broad landcover from Overture?', 'Yes', 'Add a vector source to Overture base.pmtiles and create muted fill layers against source-layer land_cover.'],
  ['Can replace Cartes bathymetry?', 'Mostly yes', 'Overture base has bathymetry with depth/cartography up to z13. It may differ visually from Cartes, but is usable.'],
  ['Can reduce dependency on Cartes?', 'Yes', 'Keep Cartes sprites/icons locally; move main data to Tuiles en Liberte + optional Overture base.'],
  ['Production suitability', 'Careful', 'Overture docs say these PMTiles are designed for inspection, not production cartography. Good as reference/supplement, not as sole basemap.'],
];

const duplicatePressure = [
  ['landcover', 'Cartes Outdoor, Xplore, Liberty, Terrain, Overture', 'Keep one detailed OSM landcover set + one optional broad Overture underlay.'],
  ['roads/transport', 'Cartes Outdoor, Liberty, Terrain, Xplore', 'Use Cartes Outdoor as base; borrow Liberty casing only where readability is better.'],
  ['mountains/peaks', 'Cartes Outdoor, Xplore, Liberty, Terrain', 'Use Cartes Outdoor/Xplore. Standardize on source-layer mountain_peak.'],
  ['water/bathymetry', 'Cartes bathymetry, Overture bathymetry, OpenMapTiles water', 'Use OpenMapTiles water; decide between Overture or Cartes bathymetry, not both visible.'],
  ['POIs/icons', 'Cartes Outdoor + Liberty', 'Use fewer POI groups. Cartes sprite/icons are better for this app.'],
  ['relief', 'style hillshade + app shadow/terrain', 'Keep relief in app stack, not duplicated inside every style.'],
];

const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Style consolidation comparison</title>
<style>
  :root {
    color-scheme: light;
    --bg: #f7f7f4;
    --panel: #ffffff;
    --ink: #20231f;
    --muted: #6b7068;
    --line: #d9ddd3;
    --accent: #2f6f5e;
    --accent2: #8a5a2b;
    --warn: #9a5a00;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  header { padding: 24px 28px 16px; border-bottom: 1px solid var(--line); background: #fbfbf8; position: sticky; top: 0; z-index: 5; }
  h1 { margin: 0 0 8px; font-size: 24px; letter-spacing: 0; }
  h2 { margin: 28px 0 10px; font-size: 18px; }
  h3 { margin: 18px 0 8px; font-size: 15px; }
  main { padding: 18px 28px 44px; max-width: 1480px; margin: 0 auto; }
  .muted { color: var(--muted); }
  .grid { display: grid; grid-template-columns: repeat(4, minmax(180px, 1fr)); gap: 12px; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px; }
  .panel strong { display: block; margin-bottom: 6px; }
  code { background: #eef1ea; padding: 1px 4px; border-radius: 4px; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--line); }
  th, td { text-align: left; vertical-align: top; padding: 8px 9px; border-bottom: 1px solid var(--line); }
  th { background: #eef1ea; position: sticky; top: 82px; z-index: 2; }
  tbody tr:hover { background: #fafbf7; }
  .chip { display: inline-block; margin: 2px 4px 2px 0; padding: 3px 7px; border: 1px solid var(--line); border-radius: 999px; background: #fbfcf8; white-space: nowrap; }
  .ok { color: var(--accent); font-weight: 700; }
  .warn { color: var(--warn); font-weight: 700; }
  .section { margin-top: 22px; }
  .two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; }
  .scroll { overflow: auto; max-height: 520px; border: 1px solid var(--line); }
  .small { font-size: 12px; }
  @media (max-width: 900px) { .grid, .two { grid-template-columns: 1fr; } header { position: static; } th { position: static; } }
</style>
</head>
<body>
<header>
  <h1>Style consolidation comparison</h1>
  <div class="muted">Local styles + Overture PMTiles assessment. Goal: one editable outdoor style with a small visual vocabulary.</div>
</header>
<main>
  <section class="grid">
    ${summaries.map((summary) => `<div class="panel"><strong>${escapeHtml(summary.name)}</strong><div>${summary.layerCount} layers</div><div class="muted small">${escapeHtml(summary.role)}</div></div>`).join('\n')}
  </section>

  <section class="section">
    <h2>Executive recommendation</h2>
    <table>
      <tbody>
        ${rows([
          ['Best base style', '<b>Cartes Outdoor local</b>', 'It already has the most useful outdoor decisions: landcover patterns, peaks, paths, icons, water, and compact style semantics.'],
          ['Primary vector data', '<b>Tuiles en Liberte OpenMapTiles PMTiles</b>', 'Use it for the core OpenMapTiles source. It covers all Cartes Outdoor openmaptiles source-layers except route after the mountain_peak remap.'],
          ['Landcover supplement', '<b>Overture base.pmtiles</b>', 'Use as optional broad land_cover/land_use/bathymetry supplement. It is not a drop-in replacement for Cartes h3-landcover.'],
          ['Layer count target', '<b>90-120 style layers</b>', 'Enough for outdoor readability, but far below Liberty. Keep advanced route and analysis layers as optional app groups.'],
          ['Category count target', '<b>9 categories</b>', 'Small enough to style quickly; enough to avoid mixing unrelated visual decisions.'],
        ])}
      </tbody>
    </table>
  </section>

  <section class="section">
    <h2>Style summary</h2>
    <table>
      <thead><tr><th>Style</th><th>Sources</th><th>Layer types</th><th>Semantic categories</th><th>Top source/layers</th></tr></thead>
      <tbody>
        ${summaries.map((summary) => `<tr>
          <td><b>${escapeHtml(summary.name)}</b><br><code>${escapeHtml(summary.file)}</code></td>
          <td>${asList([...summary.sources])}</td>
          <td>${countRows(summary.byType)}</td>
          <td>${countRows(summary.byCategory)}</td>
          <td><table class="small"><tbody>${topLayerRows(summary)}</tbody></table></td>
        </tr>`).join('\n')}
      </tbody>
    </table>
  </section>

  <section class="section">
    <h2>Semantic category pressure</h2>
    <table>
      <thead><tr><th>Category</th>${summaries.map((summary) => `<th>${escapeHtml(summary.name)}</th>`).join('')}</tr></thead>
      <tbody>${categoryRows(summaries)}</tbody>
    </table>
  </section>

  <section class="section">
    <h2>Source-layer availability by style</h2>
    <div class="scroll">
      <table>
        <thead><tr><th>source-layer</th>${summaries.map((summary) => `<th>${escapeHtml(summary.name)}</th>`).join('')}</tr></thead>
        <tbody>
          ${sharedLayerMatrix(summaries).map(([sourceLayer, ...cells]) => `<tr><td><code>${escapeHtml(sourceLayer)}</code></td>${cells.map((cell) => `<td>${cell ? '<span class="ok">yes</span>' : ''}</td>`).join('')}</tr>`).join('\n')}
        </tbody>
      </table>
    </div>
  </section>

  <section class="section">
    <h2>Overture landcover fit</h2>
    <p class="muted">Source candidate: <code>${escapeHtml(overtureBase.url)}</code></p>
    <div class="two">
      <table>
        <thead><tr><th>Question</th><th>Answer</th><th>Implication</th></tr></thead>
        <tbody>${rows(overtureFit)}</tbody>
      </table>
      <table>
        <thead><tr><th>Overture source-layer</th><th>Zoom</th><th>Fields</th></tr></thead>
        <tbody>${overtureBase.layers.map((layer) => `<tr><td><code>${escapeHtml(layer.id)}</code></td><td>${layer.minzoom}-${layer.maxzoom}</td><td>${escapeHtml(layer.fields)}</td></tr>`).join('\n')}</tbody>
      </table>
    </div>
  </section>

  <section class="section">
    <h2>Recommended target categories</h2>
    <table>
      <thead><tr><th>Category</th><th>Contents</th><th>Styling rule</th></tr></thead>
      <tbody>${rows(recommendedCategories)}</tbody>
    </table>
  </section>

  <section class="section">
    <h2>What to reuse</h2>
    <table>
      <thead><tr><th>Source</th><th>Use</th></tr></thead>
      <tbody>${rows(reusePlan)}</tbody>
    </table>
  </section>

  <section class="section">
    <h2>Redundancy to resolve</h2>
    <table>
      <thead><tr><th>Area</th><th>Where duplicated</th><th>Recommendation</th></tr></thead>
      <tbody>${rows(duplicatePressure)}</tbody>
    </table>
  </section>

  <section class="section">
    <h2>Proposed source model</h2>
    <table>
      <thead><tr><th>Source id</th><th>URL</th><th>Purpose</th><th>Status</th></tr></thead>
      <tbody>
        ${rows([
          ['<code>openmaptiles</code>', '<code>pmtiles://https://tuiles.enliberte.fr/planet.pmtiles</code>', 'Core basemap: roads, landcover, water, buildings, labels, POIs.', '<span class="ok">already in cartes_outdoor.json</span>'],
          ['<code>overture_base</code>', `<code>${escapeHtml(overtureBase.url)}</code>`, 'Optional broad land_cover, land_use, bathymetry and water supplement.', '<span class="warn">needs new layers</span>'],
          ['<code>landcover</code> Cartes', '<code>https://serveur.cartes.app/zxy/h3-landcover/{z}/{x}/{y}.mvt</code>', 'Cartes h3 natural cover. Good visual detail, but keeps Cartes data dependency.', '<span class="warn">decide keep/remove</span>'],
          ['<code>bathymetry</code> Cartes', '<code>https://serveur.cartes.app/zxy/bathymetry/{z}/{x}/{y}.mvt</code>', 'Bathymetry. Can likely be replaced by Overture bathymetry.', '<span class="warn">candidate for removal</span>'],
        ])}
      </tbody>
    </table>
  </section>
</main>
</body>
</html>
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);
console.log(`Wrote ${path.relative(root, outPath)}`);
