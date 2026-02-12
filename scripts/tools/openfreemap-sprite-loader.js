const SPRITE_BASE_URL = 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm';
const DEFAULT_PIXEL_RATIO = 2;

let spriteMetadataPromise = null;
let spriteImagePromise = null;
const iconCache = new Map();

function normalizeIconName(name) {
  if (typeof name !== 'string') {
    return '';
  }
  return name.trim().toLowerCase();
}

async function loadSpriteMetadata() {
  if (spriteMetadataPromise) {
    return spriteMetadataPromise;
  }
  if (typeof fetch !== 'function') {
    spriteMetadataPromise = Promise.resolve(null);
    return spriteMetadataPromise;
  }
  const url = `${SPRITE_BASE_URL}@2x.json`;
  spriteMetadataPromise = fetch(url, { mode: 'cors' })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch OpenFreeMap sprite metadata: ${response.status}`);
      }
      return response.json();
    })
    .catch((error) => {
      console.warn('Unable to load OpenFreeMap sprite metadata', error);
      return null;
    });
  return spriteMetadataPromise;
}

async function loadSpriteImage() {
  if (spriteImagePromise) {
    return spriteImagePromise;
  }
  if (typeof Image === 'undefined') {
    spriteImagePromise = Promise.resolve(null);
    return spriteImagePromise;
  }
  const url = `${SPRITE_BASE_URL}@2x.png`;
  spriteImagePromise = new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = (event) => {
      reject(new Error(`Failed to load OpenFreeMap sprite image: ${event?.message || 'unknown error'}`));
    };
    image.src = url;
  })
    .catch((error) => {
      console.warn('Unable to load OpenFreeMap sprite image', error);
      return null;
    });
  return spriteImagePromise;
}

function extractIconBitmap(image, metadata) {
  if (!image || !metadata) {
    return null;
  }
  const { width, height, x, y, pixelRatio = DEFAULT_PIXEL_RATIO } = metadata;
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }
  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, x, y, width, height, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/png');
  if (typeof dataUrl !== 'string' || !dataUrl.length) {
    return null;
  }
  const displayWidth = width / (pixelRatio || DEFAULT_PIXEL_RATIO || 1);
  const displayHeight = height / (pixelRatio || DEFAULT_PIXEL_RATIO || 1);
  return {
    url: dataUrl,
    pixelRatio: pixelRatio || DEFAULT_PIXEL_RATIO,
    width: Number.isFinite(displayWidth) ? displayWidth : width,
    height: Number.isFinite(displayHeight) ? displayHeight : height
  };
}

export async function getOpenFreeMapIcon(name) {
  const normalized = normalizeIconName(name);
  if (!normalized) {
    return null;
  }
  if (iconCache.has(normalized)) {
    return iconCache.get(normalized);
  }
  const [metadataMap, spriteImage] = await Promise.all([
    loadSpriteMetadata(),
    loadSpriteImage()
  ]);
  if (!metadataMap || !spriteImage) {
    return null;
  }
  const metadata = metadataMap[normalized];
  if (!metadata) {
    return null;
  }
  const icon = extractIconBitmap(spriteImage, metadata);
  if (!icon) {
    return null;
  }
  iconCache.set(normalized, icon);
  return icon;
}

export function clearOpenFreeMapIconCache() {
  iconCache.clear();
}
