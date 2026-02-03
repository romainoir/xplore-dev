// Utility module for XploreMap POI icons management
const ICON_BASE_PATH = './data/icons_Xmap/';

// Day segment colors - matches SEGMENT_COLOR_PALETTE in directions_test.js
// First color is the default route color, then day 1, day 2, etc.
const DAY_COLORS = Object.freeze([
  '#f8b40b',  // Day 0 (default/single-day) - Yellow/orange route color
  '#5a8f7b',  // Day 1 - Sage green
  '#b87f5a',  // Day 2 - Terracotta
  '#6b8fa3',  // Day 3 - Slate blue
  '#8b7355',  // Day 4 - Warm brown
  '#7a9e7e',  // Day 5 - Forest green
  '#a8857a',  // Day 6 - Dusty rose
  '#6a8d92',  // Day 7 - Teal gray
  '#9b8567',  // Day 8 - Ochre
  '#7b8fa3',  // Day 9 - Blue gray
]);

const ICON_SPECS = Object.freeze({
  cabin: { path: `${ICON_BASE_PATH}cabin.svg`, pixelRatio: 1 },
  camera: { path: `${ICON_BASE_PATH}camera.svg`, pixelRatio: 1 },
  parking: { path: `${ICON_BASE_PATH}parking.svg`, pixelRatio: 1 },
  peak_minor: { path: `${ICON_BASE_PATH}peak_minor.svg`, pixelRatio: 1 },
  peak_principal: { path: `${ICON_BASE_PATH}peak_principal.svg`, pixelRatio: 1 },
  saddle: { path: `${ICON_BASE_PATH}saddle.svg`, pixelRatio: 1 },
  signpost: { path: `${ICON_BASE_PATH}signpost.svg`, pixelRatio: 1 },
  viewpoint: { path: `${ICON_BASE_PATH}viewpoint.svg`, pixelRatio: 1 },
  water: { path: `${ICON_BASE_PATH}water.svg`, pixelRatio: 1 }
});

const metadataCache = new Map();
const metadataPromises = new Map();
const mapImagePromises = new WeakMap();

function normalizePoiIconKey(key) {
  if (typeof key !== 'string') {
    return '';
  }
  return key.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function resolveIconUrl(path) {
  if (typeof path !== 'string' || !path) {
    return '';
  }
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  if (typeof window !== 'undefined' && window.location) {
    try {
      return new URL(path, window.location.href).toString();
    } catch (error) {
      console.warn('Failed to resolve POI icon URL', path, error);
    }
  }
  return path;
}

export function getPoiIconImageId(iconKey) {
  const normalized = normalizePoiIconKey(iconKey);
  return normalized ? `xmap-poi-${normalized}` : '';
}

/**
 * Get the icon image ID for a specific day index
 * @param {string} iconKey - The base icon key (e.g., 'cabin')
 * @param {number} dayIndex - The day index (0 = default, 1 = day 1, etc.)
 * @returns {string} The day-specific icon image ID
 */
export function getPoiIconImageIdForDay(iconKey, dayIndex = 0) {
  const normalized = normalizePoiIconKey(iconKey);
  if (!normalized) return '';
  const safeDayIndex = Math.max(0, Math.min(DAY_COLORS.length - 1, Math.floor(dayIndex) || 0));
  return `xmap-poi-${normalized}-day${safeDayIndex}`;
}

/**
 * Get the day color for a given day index
 * @param {number} dayIndex - The day index
 * @returns {string} The hex color for that day
 */
export function getDayColor(dayIndex) {
  const safeDayIndex = Math.max(0, Math.min(DAY_COLORS.length - 1, Math.floor(dayIndex) || 0));
  return DAY_COLORS[safeDayIndex];
}

export async function getPoiIconMetadata(iconKey) {
  const normalized = normalizePoiIconKey(iconKey);
  if (!normalized) {
    return null;
  }
  if (metadataCache.has(normalized)) {
    return metadataCache.get(normalized);
  }
  if (metadataPromises.has(normalized)) {
    return metadataPromises.get(normalized);
  }
  const spec = ICON_SPECS[normalized];
  if (!spec) {
    metadataCache.set(normalized, null);
    return null;
  }
  const url = resolveIconUrl(spec.path);
  if (typeof Image === 'undefined') {
    const fallback = { url, width: spec.width ?? null, height: spec.height ?? null, pixelRatio: spec.pixelRatio ?? 1 };
    metadataCache.set(normalized, fallback);
    return fallback;
  }
  const promise = new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.loading = 'eager';
    image.onload = () => {
      const metadata = {
        url,
        width: Number.isFinite(image.naturalWidth) && image.naturalWidth > 0 ? image.naturalWidth : spec.width ?? null,
        height: Number.isFinite(image.naturalHeight) && image.naturalHeight > 0 ? image.naturalHeight : spec.height ?? null,
        pixelRatio: spec.pixelRatio ?? 1
      };
      metadataCache.set(normalized, metadata);
      metadataPromises.delete(normalized);
      resolve(metadata);
    };
    image.onerror = () => {
      console.warn('Failed to load POI icon asset', iconKey);
      metadataCache.set(normalized, null);
      metadataPromises.delete(normalized);
      resolve(null);
    };
    image.src = url;
  });
  metadataPromises.set(normalized, promise);
  return promise;
}

const svgContentCache = new Map();
const svgContentPromises = new Map();

export async function getPoiIconSvgContent(iconKey) {
  const normalized = normalizePoiIconKey(iconKey);
  if (!normalized) return null;

  if (svgContentCache.has(normalized)) return svgContentCache.get(normalized);
  if (svgContentPromises.has(normalized)) return svgContentPromises.get(normalized);

  const spec = ICON_SPECS[normalized];
  if (!spec || !spec.path.endsWith('.svg')) return null;

  const url = resolveIconUrl(spec.path);
  // Add cache buster to ensure we get the latest SVG content (user updates)
  const fetchUrl = `${url}?t=${Date.now()}`;
  const promise = fetch(fetchUrl)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    })
    .then(svgText => {
      // Basic cleanup to ensure it's a valid SVG string
      if (!svgText.includes('<svg')) return null;
      svgContentCache.set(normalized, svgText);
      svgContentPromises.delete(normalized);
      return svgText;
    })
    .catch(err => {
      console.warn('Failed to fetch SVG content', iconKey, err);
      svgContentCache.set(normalized, null);
      svgContentPromises.delete(normalized);
      return null;
    });

  svgContentPromises.set(normalized, promise);
  return promise;
}

/**
 * Load an SVG and convert it to an ImageData object for MapLibre
 * @param {string} url - SVG URL
 * @param {number} size - Target size in pixels
 * @param {string} fillColor - Color for icon fill
 * @param {string} strokeColor - Color for icon stroke (contour)
 * @returns {Promise<{data: ImageData, width: number, height: number} | null>}
 */
async function loadSvgAsImage(url, size = 64, fillColor = null, strokeColor = '#ffffff') {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    let svgText = await response.text();
    if (!svgText.includes('<svg')) {
      throw new Error('Invalid SVG content');
    }

    // Set CSS variables for icons that use them
    if (fillColor || strokeColor) {
      const cssVars = [];
      if (fillColor) cssVars.push(`--icon-fill: ${fillColor}`);
      if (strokeColor) cssVars.push(`--icon-stroke: ${strokeColor}`);

      // Inject CSS variables into SVG style
      svgText = svgText.replace(
        /<svg([^>]*)>/i,
        (match, attrs) => {
          // Check if there's already a style attribute
          if (/style\s*=\s*["']/i.test(attrs)) {
            // Append to existing style
            return match.replace(
              /style\s*=\s*["']([^"']*)["']/i,
              (m, existingStyle) => `style="${existingStyle}; ${cssVars.join('; ')}"`
            );
          } else {
            // Add new style attribute
            return `<svg${attrs} style="${cssVars.join('; ')}">`;
          }
        }
      );
    }

    // For SVGs that don't use CSS variables (like cabin.svg), modify stroke directly
    if (strokeColor) {
      // Replace hardcoded stroke colors with the stroke color
      svgText = svgText.replace(
        /stroke\s*=\s*["']#[0-9a-fA-F]{3,6}["']/gi,
        `stroke="${strokeColor}"`
      );
    }

    // For fill colors on elements that don't use CSS variables
    if (fillColor) {
      // Add fill to groups/paths that only have stroke (no fill or fill="none")
      svgText = svgText.replace(
        /<g([^>]*?)fill\s*=\s*["']none["']([^>]*?)>/gi,
        `<g$1fill="${fillColor}"$2>`
      );
    }

    // Create a blob URL from the modified SVG
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const blobUrl = URL.createObjectURL(blob);

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        // Create canvas and draw the image
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(blobUrl);
          resolve(null);
          return;
        }

        // Draw centered and scaled
        ctx.drawImage(img, 0, 0, size, size);
        const imageData = ctx.getImageData(0, 0, size, size);

        URL.revokeObjectURL(blobUrl);
        resolve({
          data: imageData,
          width: size,
          height: size
        });
      };
      img.onerror = () => {
        console.warn('Failed to load SVG as image', url);
        URL.revokeObjectURL(blobUrl);
        resolve(null);
      };
      img.src = blobUrl;
    });
  } catch (error) {
    console.warn('Failed to load SVG', url, error);
    return null;
  }
}

export function ensurePoiIconImages(map, iconKeys = []) {
  if (!map || typeof map.addImage !== 'function') {
    return Promise.resolve();
  }
  const keys = Array.isArray(iconKeys) && iconKeys.length
    ? iconKeys
    : Object.keys(ICON_SPECS);
  const normalizedKeys = Array.from(new Set(keys
    .map((key) => normalizePoiIconKey(key))
    .filter((key) => key && ICON_SPECS[key])));
  if (!normalizedKeys.length) {
    return Promise.resolve();
  }
  let promisesById = mapImagePromises.get(map);
  if (!promisesById) {
    promisesById = new Map();
    mapImagePromises.set(map, promisesById);
  }

  // Create tasks for each icon key AND each day color variant
  const tasks = [];

  for (const key of normalizedKeys) {
    const spec = ICON_SPECS[key];
    if (!spec) continue;

    const url = resolveIconUrl(spec.path);
    const isSvg = spec.path.endsWith('.svg');

    // Create a variant for each day color
    for (let dayIndex = 0; dayIndex < DAY_COLORS.length; dayIndex++) {
      const imageId = getPoiIconImageIdForDay(key, dayIndex);
      if (!imageId) continue;

      // Skip if already loaded or loading
      if (map.hasImage(imageId)) continue;
      if (promisesById.has(imageId)) continue;

      const dayColor = DAY_COLORS[dayIndex];

      const promise = (async () => {
        if (isSvg) {
          const iconSize = 64;
          const strokeColor = '#ffffff'; // White stroke for visibility
          const result = await loadSvgAsImage(url, iconSize, dayColor, strokeColor);
          if (result && result.data) {
            try {
              if (!map.hasImage(imageId)) {
                map.addImage(imageId, result.data, { pixelRatio: 2 });
              }
              return imageId;
            } catch (addError) {
              console.warn('Failed to register POI icon image', key, dayIndex, addError);
            }
          }
          promisesById.delete(imageId);
          return null;
        }

        // For raster images, load once and use for all days (no color tinting)
        return new Promise((resolve) => {
          map.loadImage(url, (error, image) => {
            if (error || !image) {
              console.warn('Failed to load POI icon image', key, error);
              promisesById.delete(imageId);
              resolve(null);
              return;
            }
            try {
              if (!map.hasImage(imageId)) {
                map.addImage(imageId, image, { pixelRatio: spec.pixelRatio ?? 1 });
              }
              resolve(imageId);
            } catch (addError) {
              console.warn('Failed to register POI icon image', key, addError);
              promisesById.delete(imageId);
              resolve(null);
            }
          });
        });
      })();

      promisesById.set(imageId, promise);
      tasks.push(promise);
    }
  }

  return Promise.all(tasks).then(() => undefined);
}
