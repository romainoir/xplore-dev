import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SPRITE_METADATA_URL = 'https://raw.githubusercontent.com/hyperknot/openfreemap-styles/main/sprites/sprites/ofm_f384/ofm@2x.json';

async function loadMetadataFromFile(filePath) {
  const absolute = path.resolve(filePath);
  const raw = await fs.readFile(absolute, 'utf8');
  return JSON.parse(raw);
}

async function fetchSpriteMetadata() {
  if (process.argv.length > 2) {
    return loadMetadataFromFile(process.argv[2]);
  }

  if (typeof fetch !== 'function') {
    throw new Error('Fetch API is not available in this environment. Provide a local JSON file path.');
  }

  const response = await fetch(SPRITE_METADATA_URL);
  if (!response.ok) {
    throw new Error(`Failed to download sprite metadata: HTTP ${response.status}`);
  }
  return response.json();
}

function buildMarkdownTable(entries) {
  const intro = [
    '# OpenFreemap sprite lookup',
    '',
    'Generated from the OpenFreemap sprite metadata. Each row lists the sprite key alongside the matching tag/value name.',
    ''
  ];
  const header = ['| Sprite | Tag |', '| --- | --- |'];
  const rows = entries.map(([name]) => `| \`${name}\` | \`${name}\` |`);
  return intro.concat(header, rows).join('\n');
}

async function main() {
  const metadata = await fetchSpriteMetadata();
  const entries = Object.entries(metadata).sort(([a], [b]) => a.localeCompare(b));
  const table = buildMarkdownTable(entries);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const outputPath = path.resolve(__dirname, '..', 'data', 'openfreemap-sprites-table.md');

  await fs.writeFile(outputPath, `${table}\n`, 'utf8');
  console.log(`Sprite table written to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
