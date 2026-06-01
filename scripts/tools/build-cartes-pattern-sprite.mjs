import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');
const SPRITE_DIR = path.resolve(ROOT, 'data', 'cartes-sprite');
const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const TEXTURES = Object.freeze([
  {
    id: 'cartesapp-bare_rock',
    path: 'data/cartes-icons/bare_rock.svg',
    width: 24,
    height: 24
  },
  {
    id: 'cartesapp-scree',
    path: 'data/cartes-icons/scree.svg',
    width: 20,
    height: 20
  },
  {
    id: 'cartesapp-unknown_leaf',
    path: 'data/cartes-icons/unknown_leaf.svg',
    width: 20,
    height: 20,
    aliases: [
      'cartesapp-broadleaved',
      'cartesapp-needleleaved',
      'cartesapp-mixed',
      'cartesapp-mixed_leaf',
      'cartesapp-broadleaf',
      'cartesapp-needleleaf',
      'cartesapp-deciduous',
      'cartesapp-evergreen',
      'cartesapp-coniferous',
      'cartesapp-leafless',
      'cartesapp-unknown'
    ]
  }
]);

async function loadPuppeteer() {
  const puppeteerPath = path.resolve(
    ROOT,
    'maplibre-gl-js-5.24.0/node_modules/puppeteer/lib/cjs/puppeteer/puppeteer.js'
  );
  const module = await import(pathToFileURL(puppeteerPath).href);
  return module.default || module;
}

async function loadTextureSources() {
  return Promise.all(TEXTURES.map(async (texture) => ({
    ...texture,
    svg: await fs.readFile(path.resolve(ROOT, texture.path), 'utf8')
  })));
}

async function renderSprite(browser, scale, textureSources) {
  const suffix = scale === 1 ? '' : '@2x';
  const [spritePng, spriteJson] = await Promise.all([
    fs.readFile(path.join(SPRITE_DIR, `sprite${suffix}.png`)),
    fs.readFile(path.join(SPRITE_DIR, `sprite${suffix}.json`), 'utf8').then(JSON.parse)
  ]);
  const page = await browser.newPage();
  try {
    return await page.evaluate(async ({ spriteDataUrl, metadata, scaleFactor, textures }) => {
      function loadImage(src) {
        return new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error(`Unable to load image: ${src.slice(0, 80)}`));
          image.src = src;
        });
      }

      const baseImage = await loadImage(spriteDataUrl);
      const padding = Math.max(2, Math.round(2 * scaleFactor));
      const placements = [];
      let x = 0;
      let y = baseImage.height + padding;
      let rowHeight = 0;

      textures.forEach((texture) => {
        const width = Math.round(texture.width * scaleFactor);
        const height = Math.round(texture.height * scaleFactor);
        if (x > 0 && x + width > baseImage.width) {
          x = 0;
          y += rowHeight + padding;
          rowHeight = 0;
        }
        placements.push({ id: texture.id, x, y, width, height });
        x += width + padding;
        rowHeight = Math.max(rowHeight, height);
      });

      const canvas = document.createElement('canvas');
      canvas.width = baseImage.width;
      canvas.height = Math.max(baseImage.height, y + rowHeight);
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(baseImage, 0, 0);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';

      await Promise.all(textures.map(async (texture, index) => {
        const placement = placements[index];
        const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(texture.svg)}`;
        const image = await loadImage(svgDataUrl);
        context.drawImage(image, placement.x, placement.y, placement.width, placement.height);
      }));

      const nextMetadata = { ...metadata };
      textures.forEach((texture, index) => {
        const placement = placements[index];
        const entry = {
          width: placement.width,
          height: placement.height,
          x: placement.x,
          y: placement.y,
          pixelRatio: scaleFactor
        };
        nextMetadata[texture.id] = entry;
        (texture.aliases || []).forEach((alias) => {
          nextMetadata[alias] = { ...entry };
        });
      });

      return {
        pngBase64: canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''),
        metadata: nextMetadata
      };
    }, {
      spriteDataUrl: `data:image/png;base64,${spritePng.toString('base64')}`,
      metadata: spriteJson,
      scaleFactor: scale,
      textures: textureSources
    });
  } finally {
    await page.close();
  }
}

async function writeSprite(scale, result) {
  const suffix = scale === 1 ? '' : '@2x';
  await Promise.all([
    fs.writeFile(path.join(SPRITE_DIR, `sprite${suffix}.png`), Buffer.from(result.pngBase64, 'base64')),
    fs.writeFile(path.join(SPRITE_DIR, `sprite${suffix}.json`), `${JSON.stringify(result.metadata, null, 2)}\n`, 'utf8')
  ]);
}

async function main() {
  const [puppeteer, textureSources] = await Promise.all([loadPuppeteer(), loadTextureSources()]);
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu']
  });
  try {
    const [sprite1x, sprite2x] = await Promise.all([
      renderSprite(browser, 1, textureSources),
      renderSprite(browser, 2, textureSources)
    ]);
    await Promise.all([
      writeSprite(1, sprite1x),
      writeSprite(2, sprite2x)
    ]);
  } finally {
    await browser.close();
  }
  console.log(`Wrote ${path.relative(ROOT, SPRITE_DIR)}/sprite.png and sprite@2x.png with cartesapp pattern textures.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
