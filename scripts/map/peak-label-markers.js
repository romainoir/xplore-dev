const PEAK_LABEL_LAYER_ID = 'Peak labels';
const MIN_PEAK_MARKER_ZOOM = 10;
const HIGHEST_PEAK_RANK = 1;
const STAR_PEAK_RANK = 4;
const REMOVE_GRACE_MS = 450;
const PITCHED_VIEW_MIN_PITCH = 32;
const PITCHED_VIEW_ZONES = Object.freeze([
  { name: 'horizon', maxY: 0.34, maxRank: 2, maxCount: 5, minGap: 170, depthScale: 0.62 },
  { name: 'far', maxY: 0.52, maxRank: 3, maxCount: 7, minGap: 145, depthScale: 0.72 },
  { name: 'mid', maxY: 0.74, maxRank: 6, maxCount: 12, minGap: 110, depthScale: 0.86 },
  { name: 'near', maxY: 1.1, maxRank: 16, maxCount: 32, minGap: 82, depthScale: 1 },
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function markerScaleForZoom(zoom, depthScale = 1) {
  const zoomScale = clamp(0.72 + (zoom - MIN_PEAK_MARKER_ZOOM) * 0.075, 0.72, 1.08);
  return clamp(zoomScale * depthScale, 0.52, 1.08);
}

function getLocalizedName(properties) {
  return (
    properties?.['name:fr'] ||
    properties?.name ||
    properties?.['name:latin'] ||
    properties?.name_en ||
    properties?.['name:en'] ||
    properties?.['name:nonlatin'] ||
    ''
  ).trim();
}

function parseNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number.parseFloat(value.replace(',', '.').replace(/[^\d.+-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRank(value) {
  const rank = parseNumber(value);
  return rank === null ? 99 : rank;
}

function formatElevation(value) {
  const rounded = Math.round(value);
  try {
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(rounded);
  } catch (_) {
    return String(rounded);
  }
}

function coordinateKey(coordinates) {
  const lon = Math.round(Number(coordinates?.[0]) * 100000);
  const lat = Math.round(Number(coordinates?.[1]) * 100000);
  return `${lon}:${lat}`;
}

function featureKey(feature, peak) {
  const properties = feature.properties || {};
  const stableId = properties.osm_id || properties.id || properties.wikidata || '';
  return [
    stableId,
    peak.name,
    Math.round(peak.elevation),
    coordinateKey(peak.coordinates),
  ].join('|');
}

function peakFromFeature(feature) {
  const coordinates = feature.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

  const lon = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const properties = feature.properties || {};
  const name = getLocalizedName(properties);
  const elevation = parseNumber(properties.ele ?? properties.elevation);
  if (!name || elevation === null) return null;

  const rank = parseRank(properties.rank);
  const peak = {
    coordinates: [lon, lat],
    elevation,
    elevationLabel: `${formatElevation(elevation)} m`,
    isHighest: rank <= HIGHEST_PEAK_RANK,
    isStarred: rank > HIGHEST_PEAK_RANK && rank <= STAR_PEAK_RANK,
    name,
    rank,
  };
  peak.key = featureKey(feature, peak);
  return peak;
}

function queryRenderedPeakFeatures(map) {
  const canvas = map.getCanvas?.();
  const width = canvas?.clientWidth || canvas?.width || 0;
  const height = canvas?.clientHeight || canvas?.height || 0;
  if (!width || !height) return [];

  try {
    return map.queryRenderedFeatures([[0, 0], [width, height]], { layers: [PEAK_LABEL_LAYER_ID] }) || [];
  } catch (_) {
    try {
      return map.queryRenderedFeatures({ layers: [PEAK_LABEL_LAYER_ID] }) || [];
    } catch (error) {
      console.warn('[Peaks] Unable to query rendered peak labels:', error);
      return [];
    }
  }
}

function createStarIcon() {
  const icon = document.createElement('span');
  icon.className = 'xplore-peak-marker__star';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = `
    <svg viewBox="0 0 28 28" focusable="false">
      <path d="M14 1.8l3.1 8.5 9.1 3.1-9.1 3.1L14 26.2l-3.1-9.7-9.1-3.1 9.1-3.1L14 1.8z" />
    </svg>
  `;
  return icon;
}

function createMountainIcon() {
  const icon = document.createElement('span');
  icon.className = 'xplore-peak-marker__mountain';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = `
    <svg viewBox="0 0 42 42" focusable="false">
      <circle class="xplore-peak-marker__mountain-bg" cx="20" cy="23" r="16.5" />
      <path class="xplore-peak-marker__mountain-shape" d="M8.5 31.5 18 15.8l5.1 7.3 3.5-4.3 7 12.7H8.5z" />
      <path class="xplore-peak-marker__mountain-cut" d="M15.5 19.9 18 15.8l3.5 5.1-3.1-1.2-2.2 2.4z" />
      <path class="xplore-peak-marker__mountain-star" d="M32 2.6 34 9l6.5 2-6.5 2-2 6.4-2-6.4-6.5-2 6.5-2z" />
    </svg>
  `;
  return icon;
}

function createMarkerElement() {
  const root = document.createElement('div');
  root.className = 'xplore-peak-marker';

  const body = document.createElement('div');
  body.className = 'xplore-peak-marker__body';

  const row = document.createElement('div');
  row.className = 'xplore-peak-marker__row';

  const badge = document.createElement('div');
  badge.className = 'xplore-peak-marker__badge';

  const name = document.createElement('span');
  name.className = 'xplore-peak-marker__name';

  const elevation = document.createElement('span');
  elevation.className = 'xplore-peak-marker__elevation';

  const iconSlot = document.createElement('span');
  iconSlot.className = 'xplore-peak-marker__icon-slot';

  const leader = document.createElement('span');
  leader.className = 'xplore-peak-marker__leader';

  const dot = document.createElement('span');
  dot.className = 'xplore-peak-marker__dot';

  badge.append(name, elevation);
  row.append(badge, iconSlot);
  body.append(row, leader, dot);
  root.append(body);

  return { root, refs: { body, name, elevation, iconSlot } };
}

function updateMarkerElement(record, peak, zoom) {
  const { root, refs } = record;
  root.dataset.peakRank = String(peak.rank);
  root.classList.toggle('xplore-peak-marker--highest', peak.isHighest);
  root.classList.toggle('xplore-peak-marker--starred', peak.isStarred);
  root.style.setProperty('--peak-label-scale', markerScaleForZoom(zoom, peak.depthScale).toFixed(3));
  root.style.zIndex = String(1000 - Math.min(999, Math.round(peak.rank)));

  if (refs.name.textContent !== peak.name) refs.name.textContent = peak.name;
  if (refs.elevation.textContent !== peak.elevationLabel) refs.elevation.textContent = peak.elevationLabel;

  refs.iconSlot.replaceChildren();
  if (peak.isHighest) refs.iconSlot.append(createMountainIcon());
  else if (peak.isStarred) refs.iconSlot.append(createStarIcon());
}

function dedupePeaks(features) {
  const peaks = new Map();
  features.forEach((feature) => {
    const peak = peakFromFeature(feature);
    if (!peak || peaks.has(peak.key)) return;
    peaks.set(peak.key, peak);
  });
  return [...peaks.values()];
}

function getCanvasSize(map) {
  const canvas = map.getCanvas?.();
  return {
    width: canvas?.clientWidth || canvas?.width || 0,
    height: canvas?.clientHeight || canvas?.height || 0,
  };
}

function projectPeak(map, peak) {
  try {
    const point = map.project(peak.coordinates);
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  } catch (_) {
    return null;
  }
}

function scorePeakForDepth(peak, width) {
  const centerBonus = width > 0
    ? (1 - Math.min(1, Math.abs((peak.screenX || 0) - width / 2) / (width / 2))) * 120
    : 0;
  return -peak.rank * 100000 + peak.elevation + centerBonus;
}

function pickZonePeaks(peaks, zone, width) {
  const selected = [];
  const candidates = peaks
    .filter((peak) => peak.rank <= zone.maxRank)
    .sort((a, b) => scorePeakForDepth(b, width) - scorePeakForDepth(a, width));

  for (const peak of candidates) {
    const tooClose = selected.some((other) => {
      const dx = Math.abs((peak.screenX || 0) - (other.screenX || 0));
      const dy = Math.abs((peak.screenY || 0) - (other.screenY || 0));
      return dx < zone.minGap && dy < 64;
    });
    if (tooClose) continue;
    selected.push(peak);
    if (selected.length >= zone.maxCount) break;
  }

  return selected;
}

function filterPeaksForView(map, peaks) {
  const pitch = typeof map.getPitch === 'function' ? map.getPitch() : 0;
  if (pitch < PITCHED_VIEW_MIN_PITCH) {
    return peaks.map((peak) => ({ ...peak, depthScale: 1 }));
  }

  const { width, height } = getCanvasSize(map);
  if (!width || !height) return peaks;

  const zones = PITCHED_VIEW_ZONES.map((zone) => ({ ...zone, peaks: [] }));
  peaks.forEach((peak) => {
    const screen = projectPeak(map, peak);
    if (!screen) return;
    const zone = zones.find((item) => screen.y <= height * item.maxY) || zones[zones.length - 1];
    zone.peaks.push({
      ...peak,
      depthScale: zone.depthScale,
      screenX: screen.x,
      screenY: screen.y,
    });
  });

  return zones.flatMap((zone) => pickZonePeaks(zone.peaks, zone, width));
}

function isVectorBaseVisible() {
  return window._xploreVectorBaseVisible !== false;
}

export function initPeakLabelMarkers(map) {
  const markers = new Map();
  let destroyed = false;
  let frameId = 0;
  let timerId = 0;

  function removeRecord(key) {
    const record = markers.get(key);
    if (!record) return;
    if (record.removeTimer) window.clearTimeout(record.removeTimer);
    record.marker.remove();
    markers.delete(key);
  }

  function clearMarkers() {
    [...markers.keys()].forEach(removeRecord);
  }

  function ensureMarker(peak) {
    let record = markers.get(peak.key);
    if (!record) {
      const { root, refs } = createMarkerElement();
      const marker = new maplibregl.Marker({
        element: root,
        anchor: 'bottom',
        offset: [0, 0],
        pitchAlignment: 'viewport',
        rotationAlignment: 'viewport',
      })
        .setLngLat(peak.coordinates)
        .addTo(map);
      record = { root, refs, marker, removeTimer: 0 };
      markers.set(peak.key, record);
    }
    if (record.removeTimer) {
      window.clearTimeout(record.removeTimer);
      record.removeTimer = 0;
    }
    record.marker.setLngLat(peak.coordinates);
    updateMarkerElement(record, peak, map.getZoom());
    return record;
  }

  function scheduleRemoval(key) {
    const record = markers.get(key);
    if (!record || record.removeTimer) return;
    record.removeTimer = window.setTimeout(() => removeRecord(key), REMOVE_GRACE_MS);
  }

  function updateMarkers() {
    if (destroyed) return;

    if (!isVectorBaseVisible() || map.getZoom() < MIN_PEAK_MARKER_ZOOM) {
      clearMarkers();
      return;
    }

    if (!map.getLayer(PEAK_LABEL_LAYER_ID)) {
      if (typeof map.isStyleLoaded !== 'function' || map.isStyleLoaded()) clearMarkers();
      return;
    }

    const visibility = map.getLayoutProperty(PEAK_LABEL_LAYER_ID, 'visibility');
    if (visibility === 'none') {
      clearMarkers();
      return;
    }

    if (typeof map.areTilesLoaded === 'function' && !map.areTilesLoaded()) return;

    const peaks = filterPeaksForView(map, dedupePeaks(queryRenderedPeakFeatures(map)));
    const seen = new Set();
    peaks.forEach((peak) => {
      seen.add(peak.key);
      ensureMarker(peak);
    });
    markers.forEach((_, key) => {
      if (!seen.has(key)) scheduleRemoval(key);
    });
  }

  function scheduleUpdate(delay = 0) {
    if (destroyed) return;
    if (timerId) window.clearTimeout(timerId);
    if (delay > 0) {
      timerId = window.setTimeout(() => {
        timerId = 0;
        scheduleUpdate();
      }, delay);
      return;
    }
    if (frameId) return;
    frameId = window.requestAnimationFrame(() => {
      frameId = 0;
      updateMarkers();
    });
  }

  const onIdle = () => scheduleUpdate();
  const onStyleLoad = () => scheduleUpdate(450);
  const onVectorBaseVisibleChange = (event) => {
    if (event?.detail?.visible === false) clearMarkers();
    else scheduleUpdate(180);
  };

  map.on('idle', onIdle);
  map.on('style.load', onStyleLoad);
  window.addEventListener('xplore-vector-base-visible-change', onVectorBaseVisibleChange);

  scheduleUpdate(300);

  return {
    clear: clearMarkers,
    destroy() {
      destroyed = true;
      if (frameId) window.cancelAnimationFrame(frameId);
      if (timerId) window.clearTimeout(timerId);
      map.off('idle', onIdle);
      map.off('style.load', onStyleLoad);
      window.removeEventListener('xplore-vector-base-visible-change', onVectorBaseVisibleChange);
      clearMarkers();
    },
    update: () => scheduleUpdate(),
  };
}
