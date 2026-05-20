const SOURCE_ID = 'shadow-v3-debug-atlas-source';
const GLOBAL_FILL_ID = 'shadow-v3-debug-global-fill';
const NEAR_FILL_ID = 'shadow-v3-debug-near-fill';
const LINE_ID = 'shadow-v3-debug-lines';
const CELL_LINE_ID = 'shadow-v3-debug-cells';
const REFRESH_MS = 800;
const POSITION_STORAGE_KEY = 'xplore_shadow_v3_debug_position';

const Z_COLORS = {
  5: '#7f8c8d',
  6: '#00bcd4',
  7: '#3498db',
  8: '#2ecc71',
  9: '#b7e35a',
  10: '#f1c40f',
  11: '#f39c12',
  12: '#e67e22',
  13: '#e74c3c',
  14: '#9b59b6',
  15: '#ff66c4',
  16: '#ecf0f1',
};

function getElements() {
  return {
    panel: document.getElementById('shadowV3DebugOverlay'),
    status: document.getElementById('shadowV3DebugStatus'),
    canvas: document.getElementById('shadowV3DebugCanvas'),
    viewCanvases: {
      elevation: document.getElementById('shadowV3DebugElevationCanvas'),
      shadow: document.getElementById('shadowV3DebugShadowCanvas'),
      raw: document.getElementById('shadowV3DebugRawCanvas'),
      near: document.getElementById('shadowV3DebugNearCanvas'),
    },
    zoomLabel: document.getElementById('shadowV3DebugZoomLabel'),
    log: document.getElementById('shadowV3DebugLog'),
    close: document.getElementById('shadowV3DebugClose'),
    side: document.getElementById('shadowV3DebugSide'),
    resetView: document.getElementById('shadowV3DebugResetView'),
    captureAll: document.getElementById('shadowV3DebugCaptureAll'),
    backgroundNone: document.getElementById('shadowV3DebugBackgroundNone'),
    captureElevation: document.getElementById('shadowV3DebugCaptureElevation'),
    captureShadow: document.getElementById('shadowV3DebugCaptureShadow'),
    captureRaw: document.getElementById('shadowV3DebugCaptureRaw'),
    captureNear: document.getElementById('shadowV3DebugCaptureNear'),
    modeFull: document.getElementById('shadowV3DebugModeFull'),
    modeGlobal: document.getElementById('shadowV3DebugModeGlobal'),
    modeNear: document.getElementById('shadowV3DebugModeNear'),
    modeSelf: document.getElementById('shadowV3DebugModeSelf'),
    copy: document.getElementById('shadowV3DebugCopy'),
    settingsToggle: document.getElementById('debugShadowV3AtlasToggle'),
  };
}

function readStoredSide() {
  try {
    return localStorage.getItem(POSITION_STORAGE_KEY) === 'left' ? 'left' : 'right';
  } catch (_) {
    return 'right';
  }
}

function writeStoredSide(side) {
  try {
    localStorage.setItem(POSITION_STORAGE_KEY, side);
  } catch (_) {
    // Optional UI preference only.
  }
}

function fmtMs(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}ms` : '-';
}

function fmtNum(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '-';
}

function formatCounts(counts) {
  if (!counts || typeof counts !== 'object') return '-';
  const parts = Object.keys(counts)
    .sort((a, b) => Number(a) - Number(b))
    .map(key => `z${key}:${counts[key]}`);
  return parts.length ? parts.join(' ') : '-';
}

function boundsLabel(bounds) {
  return Array.isArray(bounds) ? bounds.map(v => fmtNum(v, 5)).join(', ') : '-';
}

function mercator01ToLngLat(x, y) {
  const lng = x * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
  return [lng, lat];
}

function boundsToPolygon(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 4) return null;
  const [minX, minY, maxX, maxY] = bounds;
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) return null;
  return [
    mercator01ToLngLat(minX, minY),
    mercator01ToLngLat(maxX, minY),
    mercator01ToLngLat(maxX, maxY),
    mercator01ToLngLat(minX, maxY),
    mercator01ToLngLat(minX, minY),
  ];
}

function tileToBounds(tile) {
  if (!tile || !Number.isFinite(tile.z) || !Number.isFinite(tile.x) || !Number.isFinite(tile.y)) return null;
  const scale = 1 << tile.z;
  const minX = tile.x / scale;
  const minY = tile.y / scale;
  return [minX, minY, minX + 1 / scale, minY + 1 / scale];
}

function featureFromBounds(bounds, props) {
  const coordinates = boundsToPolygon(bounds);
  if (!coordinates) return null;
  return {
    type: 'Feature',
    properties: props,
    geometry: { type: 'Polygon', coordinates: [coordinates] },
  };
}

function buildAtlasFeatures(globalMeta, nearMeta) {
  const features = [];
  const addBounds = (bounds, props) => {
    const feature = featureFromBounds(bounds, props);
    if (feature) features.push(feature);
  };

  if (Array.isArray(globalMeta?.bounds)) {
    addBounds(globalMeta.bounds, {
      kind: 'global',
      color: '#ffcc00',
      fill: '#ffcc00',
      label: 'global atlas',
    });
  }
  if (Array.isArray(globalMeta?.fullVisibleBounds)) {
    addBounds(globalMeta.fullVisibleBounds, {
      kind: 'full-visible',
      color: '#a78bfa',
      fill: '#a78bfa',
      label: 'screen visible bounds',
    });
  }
  if (Array.isArray(nearMeta?.bounds)) {
    addBounds(nearMeta.bounds, {
      kind: 'near',
      color: '#00d4ff',
      fill: '#00d4ff',
      label: 'near refine atlas',
    });
  }

  const addCells = (meta, kind) => {
    if (!Array.isArray(meta?.tiles)) return;
    for (const tile of meta.tiles) {
      const bounds = tileToBounds(tile);
      const color = Z_COLORS[tile.z] || '#ffffff';
      addBounds(bounds, {
        kind,
        z: tile.z,
        x: tile.x,
        y: tile.y,
        color,
        fill: color,
        label: `${kind} z${tile.z}/${tile.x}/${tile.y}`,
      });
    }
  };

  addCells(globalMeta, 'cell');
  addCells(nearMeta, 'near-cell');

  return { type: 'FeatureCollection', features };
}

function ensureMapLayers(map) {
  if (typeof map.isStyleLoaded === 'function' && !map.isStyleLoaded()) return false;
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }

  if (!map.getLayer(GLOBAL_FILL_ID)) {
    map.addLayer({
      id: GLOBAL_FILL_ID,
      type: 'fill',
      source: SOURCE_ID,
      filter: ['in', ['get', 'kind'], ['literal', ['global', 'full-visible']]],
      paint: {
        'fill-color': ['get', 'fill'],
        'fill-opacity': ['match', ['get', 'kind'], 'full-visible', 0.055, 0.035],
      },
    });
  }

  if (!map.getLayer(NEAR_FILL_ID)) {
    map.addLayer({
      id: NEAR_FILL_ID,
      type: 'fill',
      source: SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'near'],
      paint: {
        'fill-color': ['get', 'fill'],
        'fill-opacity': 0.075,
      },
    });
  }

  if (!map.getLayer(LINE_ID)) {
    map.addLayer({
      id: LINE_ID,
      type: 'line',
      source: SOURCE_ID,
      filter: ['in', ['get', 'kind'], ['literal', ['global', 'near', 'full-visible']]],
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['match', ['get', 'kind'], 'near', 3.0, 'global', 2.25, 1.4],
        'line-opacity': 0.95,
      },
    });
  }

  if (!map.getLayer(CELL_LINE_ID)) {
    map.addLayer({
      id: CELL_LINE_ID,
      type: 'line',
      source: SOURCE_ID,
      filter: ['in', ['get', 'kind'], ['literal', ['cell', 'near-cell']]],
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['match', ['get', 'kind'], 'near-cell', 1.6, 1.0],
        'line-opacity': ['match', ['get', 'kind'], 'near-cell', 0.9, 0.72],
      },
    });
  }
  return true;
}

function setMapLayersVisible(map, visible) {
  for (const id of [GLOBAL_FILL_ID, NEAR_FILL_ID, LINE_ID, CELL_LINE_ID]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  }
}

function updateMapSource(map, globalMeta, nearMeta) {
  if (!ensureMapLayers(map)) return;
  const source = map.getSource(SOURCE_ID);
  if (source?.setData) source.setData(buildAtlasFeatures(globalMeta, nearMeta));
}

function canvasPointForMercator(bounds, x, y, width, height) {
  const [minX, minY, maxX, maxY] = bounds;
  return [
    ((x - minX) / (maxX - minX)) * width,
    ((y - minY) / (maxY - minY)) * height,
  ];
}

function drawBoundsOnCanvas(ctx, atlasBounds, bounds, width, height, color, alpha = 1, lineWidth = 1.5) {
  if (!Array.isArray(bounds)) return;
  const [minX, minY, maxX, maxY] = bounds;
  const [x0, y0] = canvasPointForMercator(atlasBounds, minX, minY, width, height);
  const [x1, y1] = canvasPointForMercator(atlasBounds, maxX, maxY, width, height);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}

function applyViewport(ctx, viewport, width, height) {
  const zoom = Math.max(1, viewport?.zoom || 1);
  const centerX = Number.isFinite(viewport?.centerX) ? viewport.centerX : 0.5;
  const centerY = Number.isFinite(viewport?.centerY) ? viewport.centerY : 0.5;
  ctx.translate(width / 2, height / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-centerX * width, -centerY * height);
}

function canvasPointToBase(canvas, viewport, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const screenX = ((clientX - rect.left) / Math.max(rect.width, 1)) * canvas.width;
  const screenY = ((clientY - rect.top) / Math.max(rect.height, 1)) * canvas.height;
  const zoom = Math.max(1, viewport?.zoom || 1);
  const centerX = Number.isFinite(viewport?.centerX) ? viewport.centerX : 0.5;
  const centerY = Number.isFinite(viewport?.centerY) ? viewport.centerY : 0.5;
  return {
    screenX,
    screenY,
    normX: centerX + (screenX / Math.max(canvas.width, 1) - 0.5) / zoom,
    normY: centerY + (screenY / Math.max(canvas.height, 1) - 0.5) / zoom,
  };
}

function drawTexturePayload(ctx, width, height, payload, mode, viewport, showHeader = false) {
  if (!ctx || !payload?.pixels || !payload?.size) return false;
  const { pixels, size } = payload;
  const image = new Uint8ClampedArray(width * height * 4);
  const zoom = Math.max(1, viewport?.zoom || 1);
  const centerX = Number.isFinite(viewport?.centerX) ? viewport.centerX : 0.5;
  const centerY = Number.isFinite(viewport?.centerY) ? viewport.centerY : 0.5;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const normX = centerX + (x / Math.max(width - 1, 1) - 0.5) / zoom;
      const normY = centerY + (y / Math.max(height - 1, 1) - 0.5) / zoom;
      const dst = (y * width + x) * 4;
      if (normX < 0 || normX > 1 || normY < 0 || normY > 1) {
        image[dst] = 7;
        image[dst + 1] = 10;
        image[dst + 2] = 13;
        image[dst + 3] = 255;
        continue;
      }

      const sy = Math.max(0, Math.min(size - 1, Math.floor((1 - normY) * (size - 1))));
      const sx = Math.max(0, Math.min(size - 1, Math.floor(normX * (size - 1))));
      const src = (sy * size + sx) * 4;
      if (mode === 'elevation') {
        if (pixels[src + 3] === 0) {
          image[dst] = 16;
          image[dst + 1] = 18;
          image[dst + 2] = 22;
          image[dst + 3] = 255;
          continue;
        }
        const r = pixels[src] / 255;
        const g = pixels[src + 1] / 255;
        const b = pixels[src + 2] / 255;
        const a = pixels[src + 3] / 255;
        const packed = r / 16777216 + g / 65536 + b / 256 + a;
        const elevation = packed * 20000 - 10000;
        const color = elevationColor(Math.max(0, Math.min(1, elevation / 4800)));
        image[dst] = color[0];
        image[dst + 1] = color[1];
        image[dst + 2] = color[2];
        image[dst + 3] = 255;
      } else {
        const value = Math.max(pixels[src], pixels[src + 1], pixels[src + 2]) / 255;
        image[dst] = Math.floor(value * 30);
        image[dst + 1] = Math.floor(value * 185);
        image[dst + 2] = Math.floor(60 + value * 195);
        image[dst + 3] = 255;
      }
    }
  }

  ctx.putImageData(new ImageData(image, width, height), 0, 0);
  if (showHeader) {
    ctx.fillStyle = 'rgba(0,0,0,0.68)';
    ctx.fillRect(0, 0, width, 24);
    ctx.fillStyle = '#eef4f8';
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillText(`${payload.kind || mode} ${size}x${size} zoom ${zoom.toFixed(2)}x`, 10, 16);
  }
  return true;
}

function drawAtlasCanvas(canvas, globalMeta, nearMeta, map, viewport, backgroundCapture) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  const hasBackground = backgroundCapture?.payload &&
    drawTexturePayload(ctx, width, height, backgroundCapture.payload, backgroundCapture.mode, viewport, false);
  if (!hasBackground) {
    ctx.fillStyle = '#070a0d';
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.fillRect(0, 0, width, height);
  }

  const bounds = globalMeta?.bounds;
  if (!Array.isArray(bounds)) {
    ctx.fillStyle = '#dce8ef';
    ctx.font = '13px "JetBrains Mono", monospace';
    ctx.fillText('Waiting for global atlas bounds.', 16, 28);
    return;
  }

  const [minX, minY, maxX, maxY] = bounds;
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (spanX <= 0 || spanY <= 0) return;

  ctx.save();
  applyViewport(ctx, viewport, width, height);

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    const x = i * width / 8;
    const y = i * height / 8;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  for (const tile of globalMeta.tiles || []) {
    const tileBounds = tileToBounds(tile);
    if (!tileBounds) continue;
    const color = Z_COLORS[tile.z] || '#ffffff';
    const [x0, y0] = canvasPointForMercator(bounds, tileBounds[0], tileBounds[1], width, height);
    const [x1, y1] = canvasPointForMercator(bounds, tileBounds[2], tileBounds[3], width, height);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.9;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    if (x1 - x0 > 24 && y1 - y0 > 16) ctx.fillText(`z${tile.z}`, x0 + 4, y0 + 12);
  }

  drawBoundsOnCanvas(ctx, bounds, globalMeta.fullVisibleBounds, width, height, '#a78bfa', 0.95, 2);
  drawBoundsOnCanvas(ctx, bounds, nearMeta?.bounds, width, height, '#00d4ff', 0.98, 3);
  drawBoundsOnCanvas(ctx, bounds, bounds, width, height, '#ffcc00', 1, 2.4);

  if (map) {
    const center = map.getCenter();
    const sin = Math.sin(center.lat * Math.PI / 180);
    const mercX = ((center.lng + 180) / 360) % 1;
    const mercY = 0.5 - 0.25 * Math.log((1 + sin) / (1 - sin)) / Math.PI;
    const [cx, cy] = canvasPointForMercator(bounds, mercX, mercY, width, height);
    ctx.fillStyle = '#ff4fd8';
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();

    const sunDir = window._shadowSunDirection;
    if (Array.isArray(sunDir) && sunDir.length >= 2) {
      ctx.strokeStyle = '#ffd600';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + sunDir[0] * 46, cy - sunDir[1] * 46);
      ctx.stroke();
    }
  }

  ctx.restore();

  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(8, height - 60, width - 16, 48);
  ctx.fillStyle = '#eef4f8';
  ctx.font = '11px "JetBrains Mono", monospace';
  const backgroundLabel = backgroundCapture?.payload ? `bg ${backgroundCapture.payload.kind || backgroundCapture.mode}` : 'bg none';
  ctx.fillText(`global ${globalMeta.size || '-'}px, cells ${globalMeta.tiles?.length || 0}, lod ${globalMeta.lodZooms?.join('/') || '-'}`, 16, height - 40);
  ctx.fillText(`near ${nearMeta?.size || '-'}px, cells ${nearMeta?.tiles?.length || 0}, phase ${globalMeta.progressivePhase || '-'}, ${backgroundLabel}`, 16, height - 22);
  ctx.fillText('wheel zoom / drag pan', width - 172, height - 22);
}

function drawTextureMessage(canvas, message) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#070a0d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#dce8ef';
  ctx.font = '12px "JetBrains Mono", monospace';
  ctx.fillText(message, 14, 28);
}

function elevationColor(normalized) {
  if (normalized < 0.25) {
    const t = normalized / 0.25;
    return [0, Math.floor(t * 255), 255];
  }
  if (normalized < 0.5) {
    const t = (normalized - 0.25) / 0.25;
    return [0, 255, Math.floor((1 - t) * 255)];
  }
  if (normalized < 0.75) {
    const t = (normalized - 0.5) / 0.25;
    return [Math.floor(t * 255), 255, 0];
  }
  if (normalized < 0.95) {
    const t = (normalized - 0.75) / 0.20;
    return [255, Math.floor((1 - t) * 255), 0];
  }
  const t = (normalized - 0.95) / 0.05;
  return [255, Math.floor(t * 255), Math.floor(t * 255)];
}

function renderPixelsToCanvas(canvas, payload, mode, viewport) {
  if (!canvas || !payload?.pixels || !payload?.size) return;
  const ctx = canvas.getContext('2d');
  drawTexturePayload(ctx, canvas.width, canvas.height, payload, mode, viewport, true);
}

function drawAllTextureMessages(viewCanvases, message) {
  for (const canvas of Object.values(viewCanvases || {})) {
    drawTextureMessage(canvas, message);
  }
}

function buildDebugText(map) {
  const globalMeta = window._elevationAtlasDebug || {};
  const nearMeta = window._nearElevationAtlasDebug || {};
  const atlasReuse = window._shadowAtlasReuseDebug || {};
  const shadow = window._shadowPassDebug || {};
  const nearShadow = window._shadowNearPassDebug || {};
  const terrain = window._terrainTileDebug || {};
  const mapMoving = map && typeof map.isMoving === 'function' ? map.isMoving() : false;
  const center = map?.getCenter?.();
  const shadowV3 = window.imageryState?.get?.('shadow-v3');

  return [
    `shadow v3 debug enabled=${window._shadowV3DebugOverlayEnabled === true} active=${shadowV3?.enabled === true} opacity=${fmtNum(shadowV3?.opacity ?? 1, 2)}`,
    `shadow v3 component=${window._shadowV3ComponentMode || 'full'} (full/global/near/self)`,
    `map moving=${mapMoving} zoom=${map ? fmtNum(map.getZoom(), 2) : '-'} pitch=${map ? fmtNum(map.getPitch(), 1) : '-'} bearing=${map ? fmtNum(map.getBearing(), 1) : '-'}`,
    `center ${center ? `${fmtNum(center.lng, 6)}, ${fmtNum(center.lat, 6)}` : '-'}`,
    `phase ${window._shadowProgressivePhase || '-'} cameraHold=${window._shadowCameraRefreshHold === true} cameraMoving=${window._shadowCameraMoving === true}`,
    '',
    `global atlas size=${globalMeta.size || '-'} cells=${globalMeta.tiles?.length || 0} lod=${globalMeta.lodZooms?.join('/') || '-'}`,
    `global bounds ${boundsLabel(globalMeta.bounds)}`,
    `full visible ${boundsLabel(globalMeta.fullVisibleBounds)}`,
    `global visible z ${formatCounts(globalMeta.visibleZooms)}`,
    `global capture z ${formatCounts(globalMeta.captureZooms)}`,
    `global source z ${formatCounts(globalMeta.sourceZooms)}`,
    `fallbacks parent=${globalMeta.parentFallbackCount ?? '-'} flat=${globalMeta.flatFallbackCount ?? '-'} screenClamped=${globalMeta.screenClamped === true}`,
    '',
    `near atlas size=${nearMeta.size || '-'} cells=${nearMeta.tiles?.length || 0} lod=${nearMeta.lodZooms?.join('/') || '-'}`,
    `near bounds ${boundsLabel(nearMeta.bounds)}`,
    `near capture z ${formatCounts(nearMeta.captureZooms)}`,
    `near source z ${formatCounts(nearMeta.sourceZooms)}`,
    '',
    `reuse covered=${atlasReuse.reusedCoveredAtlas === true} cachedPhase=${atlasReuse.cachedAtlasPhase || '-'} requested=${atlasReuse.requestedBounds ? boundsLabel([atlasReuse.requestedBounds.minX, atlasReuse.requestedBounds.minY, atlasReuse.requestedBounds.maxX, atlasReuse.requestedBounds.maxY]) : '-'}`,
    '',
    `shadow algo=${shadow.algorithm || 'raymarch'} duration=${fmtMs(shadow.durationMs)} upsample=${fmtMs(shadow.upsampleMs ?? shadow.blurMs)} size=${shadow.atlasPixelSize || '-'} raw=${shadow.rawAtlasPixelSize || '-'} scale=${fmtNum(shadow.rawToFinalScale, 2)}`,
    `shadow steps=${shadow.maxSteps ?? '-'} step=${shadow.stepMeters ?? '-'} maxDist=${shadow.maxDistance ?? '-'} mpp=${fmtNum(shadow.metersPerPixelX, 2)}/${fmtNum(shadow.metersPerPixelY, 2)}`,
    `near shadow algo=${nearShadow.algorithm || 'raymarch'} duration=${fmtMs(nearShadow.durationMs)} upsample=${fmtMs(nearShadow.upsampleMs ?? nearShadow.blurMs)} size=${nearShadow.atlasPixelSize || '-'} raw=${nearShadow.rawAtlasPixelSize || '-'}`,
    '',
    `terrain draw=${fmtMs(terrain.durationMs)} tiles=${terrain.renderTiles ?? '-'} atlasReady=${terrain.atlasReady === true} reusedMoving=${terrain.atlasReusedWhileMoving === true}`,
    `terrain z ${formatCounts(terrain.terrainZooms)}`,
    `source z ${formatCounts(terrain.sourceZooms)}`,
    '',
    `settings v3Atlas=${window._shadowV3AtlasSize || '-'} v3MaskScale=${window._shadowV3MaskScale ?? '-'} v3NearAtlas=${window._shadowV3NearAtlasSize || '-'} v3NearMaskScale=${window._shadowV3NearMaskScale ?? '-'}`,
    `hiz=${window._shadowV3UseHiZ === true} logSweep=${window._shadowUseLogSweep === true} contact=${window._shadowV3ContactShadows === true}`,
  ].join('\n');
}

function createClipboardText(map) {
  const snapshot = {
    timestamp: new Date().toISOString(),
    map: map ? {
      zoom: map.getZoom(),
      pitch: map.getPitch(),
      bearing: map.getBearing(),
      moving: typeof map.isMoving === 'function' ? map.isMoving() : false,
      center: map.getCenter(),
    } : null,
    shadowV3: window.imageryState?.get?.('shadow-v3') || null,
    globalAtlas: window._elevationAtlasDebug || null,
    nearAtlas: window._nearElevationAtlasDebug || null,
    atlasReuse: window._shadowAtlasReuseDebug || null,
    shadow: window._shadowPassDebug || null,
    nearShadow: window._shadowNearPassDebug || null,
    terrain: window._terrainTileDebug || null,
    settings: {
      shadowV3AtlasSize: window._shadowV3AtlasSize,
      shadowV3MaskScale: window._shadowV3MaskScale,
      shadowV3NearAtlasSize: window._shadowV3NearAtlasSize,
      shadowV3NearMaskScale: window._shadowV3NearMaskScale,
      shadowV3UseHiZ: window._shadowV3UseHiZ,
      shadowUseLogSweep: window._shadowUseLogSweep,
      shadowV3ContactShadows: window._shadowV3ContactShadows,
      shadowV3ComponentMode: window._shadowV3ComponentMode,
    },
  };
  return `${buildDebugText(map)}\n\nraw snapshot\n${JSON.stringify(snapshot, null, 2)}`;
}

export function initShadowV3DebugOverlay(map) {
  const els = getElements();
  if (!map || !els.panel) {
    return { setEnabled() {}, refresh() {} };
  }

  const state = {
    enabled: false,
    side: readStoredSide(),
    viewport: { zoom: 1, centerX: 0.5, centerY: 0.5 },
    captures: {},
    backgroundKind: null,
    timer: null,
    previousTileDebugEnabled: null,
  };

  const applySide = (side) => {
    state.side = side === 'left' ? 'left' : 'right';
    els.panel.classList.toggle('shadow-v3-debug--left', state.side === 'left');
    if (els.side) els.side.textContent = state.side === 'left' ? 'Right' : 'Left';
    writeStoredSide(state.side);
  };

  const updateZoomLabel = () => {
    if (els.zoomLabel) {
      els.zoomLabel.textContent = `zoom ${state.viewport.zoom.toFixed(2)}x center ${state.viewport.centerX.toFixed(3)}, ${state.viewport.centerY.toFixed(3)}`;
    }
  };

  const clampViewport = () => {
    const zoom = Math.max(1, Math.min(24, state.viewport.zoom || 1));
    state.viewport.zoom = zoom;
    const half = 0.5 / zoom;
    state.viewport.centerX = Math.max(half, Math.min(1 - half, state.viewport.centerX));
    state.viewport.centerY = Math.max(half, Math.min(1 - half, state.viewport.centerY));
  };

  const redrawCapturedViews = () => {
    for (const [kind, captured] of Object.entries(state.captures)) {
      const canvas = els.viewCanvases?.[kind];
      if (canvas && captured?.payload) {
        renderPixelsToCanvas(canvas, captured.payload, captured.mode, state.viewport);
      }
    }
  };

  const updateBackgroundButtons = () => {
    const active = state.backgroundKind;
    els.backgroundNone?.setAttribute('data-active', String(active === null));
    els.captureElevation?.setAttribute('data-active', String(active === 'elevation'));
    els.captureShadow?.setAttribute('data-active', String(active === 'shadow'));
    els.captureRaw?.setAttribute('data-active', String(active === 'raw'));
    els.captureNear?.setAttribute('data-active', String(active === 'near'));
  };

  const updateComponentModeButtons = () => {
    const mode = window._shadowV3ComponentMode || 'full';
    els.modeFull?.setAttribute('data-active', String(mode === 'full'));
    els.modeGlobal?.setAttribute('data-active', String(mode === 'global'));
    els.modeNear?.setAttribute('data-active', String(mode === 'near'));
    els.modeSelf?.setAttribute('data-active', String(mode === 'self'));
  };

  const setComponentMode = (mode) => {
    window._shadowV3ComponentMode = mode;
    updateComponentModeButtons();
    if (els.status) els.status.textContent = `Shadow V3 component mode: ${mode}`;
    map.triggerRepaint?.();
    refresh();
  };

  const selectedBackgroundCapture = () => (
    state.backgroundKind ? state.captures[state.backgroundKind] : null
  );

  const redrawAllCanvases = () => {
    const globalMeta = window._elevationAtlasDebug || {};
    const nearMeta = window._nearElevationAtlasDebug || {};
    drawAtlasCanvas(els.canvas, globalMeta, nearMeta, map, state.viewport, selectedBackgroundCapture());
    redrawCapturedViews();
    updateBackgroundButtons();
    updateComponentModeButtons();
    updateZoomLabel();
  };

  const resetViewport = () => {
    state.viewport.zoom = 1;
    state.viewport.centerX = 0.5;
    state.viewport.centerY = 0.5;
    redrawAllCanvases();
  };

  const attachViewportControls = (canvas) => {
    if (!canvas) return;
    let dragging = false;
    let lastPoint = null;

    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const point = canvasPointToBase(canvas, state.viewport, event.clientX, event.clientY);
      const zoomFactor = Math.exp(-event.deltaY * 0.0018);
      const nextZoom = Math.max(1, Math.min(24, state.viewport.zoom * zoomFactor));
      state.viewport.zoom = nextZoom;
      state.viewport.centerX = point.normX - (point.screenX / Math.max(canvas.width, 1) - 0.5) / nextZoom;
      state.viewport.centerY = point.normY - (point.screenY / Math.max(canvas.height, 1) - 0.5) / nextZoom;
      clampViewport();
      redrawAllCanvases();
    }, { passive: false });

    canvas.addEventListener('pointerdown', (event) => {
      dragging = true;
      lastPoint = canvasPointToBase(canvas, state.viewport, event.clientX, event.clientY);
      canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    canvas.addEventListener('pointermove', (event) => {
      if (!dragging || !lastPoint) return;
      const point = canvasPointToBase(canvas, state.viewport, event.clientX, event.clientY);
      state.viewport.centerX -= (point.screenX - lastPoint.screenX) / (Math.max(canvas.width, 1) * state.viewport.zoom);
      state.viewport.centerY -= (point.screenY - lastPoint.screenY) / (Math.max(canvas.height, 1) * state.viewport.zoom);
      clampViewport();
      lastPoint = point;
      redrawAllCanvases();
    });

    const stopDrag = (event) => {
      dragging = false;
      lastPoint = null;
      canvas.releasePointerCapture?.(event.pointerId);
    };
    canvas.addEventListener('pointerup', stopDrag);
    canvas.addEventListener('pointercancel', stopDrag);
    canvas.addEventListener('pointerleave', () => {
      dragging = false;
      lastPoint = null;
    });
  };

  const refresh = () => {
    if (!state.enabled) return;
    const globalMeta = window._elevationAtlasDebug || {};
    const nearMeta = window._nearElevationAtlasDebug || {};
    updateMapSource(map, globalMeta, nearMeta);
    drawAtlasCanvas(els.canvas, globalMeta, nearMeta, map, state.viewport, selectedBackgroundCapture());
    updateBackgroundButtons();
    updateComponentModeButtons();
    updateZoomLabel();
    const text = buildDebugText(map);
    if (els.log && document.activeElement !== els.log) els.log.value = text;
    if (els.status) {
      els.status.textContent = Array.isArray(globalMeta.bounds)
        ? `global ${globalMeta.size || '-'}px, ${globalMeta.tiles?.length || 0} cells, near ${nearMeta.tiles?.length || 0} cells`
        : 'Waiting for atlas metadata.';
    }
  };

  const setEnabled = (enabled) => {
    state.enabled = Boolean(enabled);
    window._shadowV3DebugOverlayEnabled = state.enabled;
    if (els.settingsToggle) els.settingsToggle.checked = state.enabled;
    els.panel.setAttribute('aria-hidden', String(!state.enabled));

    if (state.enabled) {
      if (state.previousTileDebugEnabled === null) {
        state.previousTileDebugEnabled = Boolean(window._shadowTileDebugEnabled);
      }
      window._shadowTileDebugEnabled = true;
      if (ensureMapLayers(map)) setMapLayersVisible(map, true);
      updateBackgroundButtons();
      updateComponentModeButtons();
      refresh();
      clearInterval(state.timer);
      state.timer = window.setInterval(refresh, REFRESH_MS);
      map.triggerRepaint();
      return;
    }

    clearInterval(state.timer);
    state.timer = null;
    setMapLayersVisible(map, false);
    if (state.previousTileDebugEnabled !== null) {
      window._shadowTileDebugEnabled = state.previousTileDebugEnabled;
      state.previousTileDebugEnabled = null;
    }
    if (els.log) els.log.value = 'Debug disabled.';
  };

  const capture = (kind, options = {}) => {
    const selectBackground = options.selectBackground !== false;
    if (!state.enabled) setEnabled(true);
    drawTextureMessage(els.viewCanvases?.[kind], `Reading ${kind} atlas from GPU...`);
    window.requestAnimationFrame(() => {
      try {
        if (kind === 'elevation') {
          const pixels = map.readElevationAtlasPixels?.();
          const size = window._elevationAtlasDebug?.size || Math.sqrt((pixels?.length || 0) / 4);
          if (!pixels || !Number.isFinite(size)) throw new Error('elevation atlas is not ready');
          const payload = { kind: 'elevation', pixels, size };
          state.captures.elevation = { payload, mode: 'elevation' };
          renderPixelsToCanvas(els.viewCanvases?.elevation, payload, 'elevation', state.viewport);
          if (selectBackground) state.backgroundKind = 'elevation';
          redrawAllCanvases();
          return;
        }

        const payload = map.readShadowAtlasPixels?.(kind);
        if (!payload?.pixels || !payload?.size) throw new Error(`${kind} shadow atlas is not ready`);
        state.captures[kind] = { payload, mode: 'shadow' };
        renderPixelsToCanvas(els.viewCanvases?.[kind], payload, 'shadow', state.viewport);
        if (selectBackground) state.backgroundKind = kind;
        redrawAllCanvases();
      } catch (error) {
        drawTextureMessage(els.viewCanvases?.[kind], `Capture failed: ${error?.message || error}`);
        if (selectBackground && state.backgroundKind === kind) {
          state.backgroundKind = null;
          redrawAllCanvases();
        }
      }
    });
  };

  els.close?.addEventListener('click', () => setEnabled(false));
  els.side?.addEventListener('click', () => applySide(state.side === 'left' ? 'right' : 'left'));
  els.resetView?.addEventListener('click', resetViewport);
  els.captureAll?.addEventListener('click', () => {
    capture('elevation');
    capture('shadow', { selectBackground: false });
    capture('raw', { selectBackground: false });
    capture('near', { selectBackground: false });
  });
  els.backgroundNone?.addEventListener('click', () => {
    state.backgroundKind = null;
    redrawAllCanvases();
  });
  els.settingsToggle?.addEventListener('change', () => setEnabled(els.settingsToggle.checked));
  els.captureElevation?.addEventListener('click', () => capture('elevation'));
  els.captureShadow?.addEventListener('click', () => capture('shadow'));
  els.captureRaw?.addEventListener('click', () => capture('raw'));
  els.captureNear?.addEventListener('click', () => capture('near'));
  els.modeFull?.addEventListener('click', () => setComponentMode('full'));
  els.modeGlobal?.addEventListener('click', () => setComponentMode('global'));
  els.modeNear?.addEventListener('click', () => setComponentMode('near'));
  els.modeSelf?.addEventListener('click', () => setComponentMode('self'));
  els.copy?.addEventListener('click', async () => {
    const text = createClipboardText(map);
    if (els.log) els.log.value = text;
    try {
      await navigator.clipboard.writeText(text);
      if (els.status) els.status.textContent = 'Debug snapshot copied.';
    } catch (_) {
      if (els.log) {
        els.log.focus();
        els.log.select();
      }
      if (els.status) els.status.textContent = 'Select the text area to copy the debug snapshot.';
    }
  });

  attachViewportControls(els.canvas);
  for (const canvas of Object.values(els.viewCanvases || {})) {
    attachViewportControls(canvas);
  }

  map.on('style.load', () => {
    if (state.enabled) {
      ensureMapLayers(map);
      setMapLayersVisible(map, true);
      refresh();
    }
  });

  applySide(state.side);
  updateComponentModeButtons();
  updateZoomLabel();
  drawAllTextureMessages(els.viewCanvases, 'Enable Shadow V3 Atlas debug from Settings > Debug.');

  return { setEnabled, refresh, setSide: applySide };
}
