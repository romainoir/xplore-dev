const SUPPORTED_MODES = new Set(['foot-hiking', 'cycling-regular', 'driving-car']);
const PATH_CLASSES = new Set(['path', 'footway', 'pedestrian', 'steps']);
const PATH_SUBCLASSES = new Set(['path', 'footway', 'trail', 'steps', 'bridleway', 'via_ferrata']);
const CYCLE_CLASSES = new Set(['cycleway']);
const ROAD_CLASSES = new Set(['service', 'residential', 'unclassified', 'minor', 'track', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway']);
const SAC_SCALE_RANK = Object.freeze({
  hiking: 1,
  mountain_hiking: 2,
  demanding_mountain_hiking: 3,
  alpine_hiking: 4,
  demanding_alpine_hiking: 5,
  difficult_alpine_hiking: 6
});

const TRAIL_VISIBILITY_RANK = Object.freeze({
  excellent: 1,
  good: 2,
  intermediate: 3,
  bad: 4,
  horrible: 5,
  no: 6
});

const SURFACE_RANK = Object.freeze({
  paved: 1,
  asphalt: 1,
  concrete: 1,
  'concrete:lanes': 1,
  paving_stones: 1,
  sett: 1,
  cobblestone: 1,
  compacted: 2,
  fine_gravel: 2,
  gravel_turf: 2,
  dirt: 3,
  earth: 3,
  ground: 3,
  gravel: 3,
  grass: 3,
  mud: 3,
  sand: 3,
  scree: 4,
  rock: 4,
  stone: 4,
  pebblestone: 4,
  shingle: 4,
  bare_rock: 4,
  glacier: 5,
  snow: 5,
  ice: 5
});

const DEFAULT_OPTIONS = Object.freeze({
  sourceId: 'openmaptiles',
  sourceLayer: 'transportation',
  boundsPaddingRatio: 0.2,
  coordinatePrecision: 7,
  targetBounds: null
});
const COORD_DUPLICATE_EPSILON = 1e-9;
const ALLOWED_VALUES = new Set(['yes', 'designated', 'permissive', 'official', 'destination', 'unknown']);
const FORBIDDEN_VALUES = new Set(['no', 'private']);

function normalizeValue(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

function allows(value, fallback = false) {
  const normalized = normalizeValue(value);
  if (!normalized) {
    return fallback;
  }
  if (FORBIDDEN_VALUES.has(normalized)) {
    return false;
  }
  if (ALLOWED_VALUES.has(normalized)) {
    return true;
  }
  return fallback;
}

function forbids(value) {
  const normalized = normalizeValue(value);
  return normalized && FORBIDDEN_VALUES.has(normalized);
}

function boundsToObject(bounds) {
  if (!bounds) {
    return null;
  }
  if (typeof bounds.getWest === 'function') {
    return {
      west: bounds.getWest(),
      east: bounds.getEast(),
      south: bounds.getSouth(),
      north: bounds.getNorth()
    };
  }
  const west = Number(bounds.west);
  const east = Number(bounds.east);
  const south = Number(bounds.south);
  const north = Number(bounds.north);
  if ([west, east, south, north].some((value) => !Number.isFinite(value))) {
    return null;
  }
  return { west, east, south, north };
}

function expandBounds(bounds, paddingRatio = 0.2) {
  const target = boundsToObject(bounds);
  if (!target) {
    return null;
  }
  const lngSpan = target.east - target.west;
  const latSpan = target.north - target.south;
  const padLng = Number.isFinite(lngSpan) ? lngSpan * paddingRatio : 0;
  const padLat = Number.isFinite(latSpan) ? latSpan * paddingRatio : 0;
  return {
    west: target.west - padLng,
    east: target.east + padLng,
    south: target.south - padLat,
    north: target.north + padLat
  };
}

function intersectsBounds(featureBounds, targetBounds) {
  if (!featureBounds || !targetBounds) {
    return false;
  }
  if (featureBounds.west > targetBounds.east) return false;
  if (featureBounds.east < targetBounds.west) return false;
  if (featureBounds.south > targetBounds.north) return false;
  if (featureBounds.north < targetBounds.south) return false;
  return true;
}

function updateBoundsWithCoordinate(bounds, coord) {
  if (!Array.isArray(coord) || coord.length < 2) {
    return;
  }
  const lng = Number(coord[0]);
  const lat = Number(coord[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return;
  }
  if (lng < bounds.west) bounds.west = lng;
  if (lng > bounds.east) bounds.east = lng;
  if (lat < bounds.south) bounds.south = lat;
  if (lat > bounds.north) bounds.north = lat;
}

function getGeometryBounds(geometry) {
  if (!geometry || !geometry.type) {
    return null;
  }
  const bounds = { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity };
  const { type, coordinates } = geometry;

  const processLine = (line) => {
    if (!Array.isArray(line)) {
      return;
    }
    line.forEach((coord) => updateBoundsWithCoordinate(bounds, coord));
  };

  if (type === 'LineString') {
    processLine(coordinates);
  } else if (type === 'MultiLineString') {
    if (Array.isArray(coordinates)) {
      coordinates.forEach(processLine);
    }
  } else {
    return null;
  }

  if (!Number.isFinite(bounds.west) || !Number.isFinite(bounds.east) || !Number.isFinite(bounds.south) || !Number.isFinite(bounds.north)) {
    return null;
  }
  return bounds;
}

function waitForMapIdle(map) {
  if (!map || typeof map.once !== 'function') {
    return Promise.resolve();
  }

  const isIdle = () => {
    const styleLoaded = typeof map.isStyleLoaded === 'function' ? map.isStyleLoaded() : true;
    const tilesLoaded = typeof map.areTilesLoaded === 'function' ? map.areTilesLoaded() : true;
    const moving = typeof map.isMoving === 'function' ? map.isMoving() : false;
    return styleLoaded && tilesLoaded && !moving;
  };

  if (isIdle()) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const handleIdle = () => {
      if (!isIdle()) {
        return;
      }
      map.off('idle', handleIdle);
      resolve();
    };
    map.on('idle', handleIdle);
  });
}

function sanitizeLineCoordinates(coords, precision = 7) {
  if (!Array.isArray(coords)) {
    return null;
  }
  const factor = 10 ** precision;
  const sanitized = [];
  coords.forEach((coord) => {
    if (!Array.isArray(coord) || coord.length < 2) {
      return;
    }
    const lng = Number(coord[0]);
    const lat = Number(coord[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return;
    }
    const roundedLng = Math.round(lng * factor) / factor;
    const roundedLat = Math.round(lat * factor) / factor;
    const previous = sanitized[sanitized.length - 1];
    if (previous
      && Math.abs(previous[0] - roundedLng) <= COORD_DUPLICATE_EPSILON
      && Math.abs(previous[1] - roundedLat) <= COORD_DUPLICATE_EPSILON) {
      return;
    }
    const elevation = coord.length > 2 && Number.isFinite(coord[2]) ? Number(coord[2]) : 0;
    sanitized.push([roundedLng, roundedLat, elevation]);
  });
  if (sanitized.length < 2) {
    return null;
  }
  return sanitized;
}

function geometryKeyFromCoords(coords, precision = 6) {
  const keyForSequence = (sequence) => sequence
    .map((coord) => `${coord[0].toFixed(precision)}:${coord[1].toFixed(precision)}`)
    .join('|');
  const forward = keyForSequence(coords);
  const backward = keyForSequence([...coords].reverse());
  return forward < backward ? forward : backward;
}

function determineCostMultiplier(properties) {
  const subclass = normalizeValue(properties?.subclass);
  const surface = normalizeValue(properties?.surface);

  if (subclass === 'steps') {
    return 1.25;
  }
  if (subclass === 'track') {
    return 1.1;
  }
  if (surface && ['gravel', 'ground', 'dirt', 'earth', 'grass'].includes(surface)) {
    return 1.1;
  }
  return 1;
}

function normalizeTagString(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

function normalizeSacScaleValue(value) {
  const normalized = normalizeTagString(value);
  if (!normalized) {
    return null;
  }
  const lower = normalized.toLowerCase().replace(/\s+/g, '_');
  if (SAC_SCALE_RANK[lower]) {
    return lower;
  }
  const sanitized = lower.replace(/\+/g, '');
  if (SAC_SCALE_RANK[sanitized]) {
    return sanitized;
  }
  const alias = {
    t1: 'hiking',
    t2: 'mountain_hiking',
    t3: 'demanding_mountain_hiking',
    t4: 'alpine_hiking',
    t5: 'demanding_alpine_hiking',
    t6: 'difficult_alpine_hiking'
  };
  return alias[sanitized] || alias[lower] || null;
}

function normalizeTrailVisibilityValue(value) {
  const normalized = normalizeTagString(value);
  if (!normalized) {
    return null;
  }
  const lower = normalized.toLowerCase().replace(/\s+/g, '_');
  return TRAIL_VISIBILITY_RANK[lower] ? lower : null;
}

function normalizeSurfaceValue(value) {
  const normalized = normalizeTagString(value);
  if (!normalized) {
    return null;
  }
  const lower = normalized.toLowerCase().replace(/\s+/g, '_');
  return SURFACE_RANK[lower] ? lower : lower;
}

function collectHikingAttributes(properties) {
  if (!properties || typeof properties !== 'object') {
    return null;
  }
  const sacScale = normalizeSacScaleValue(
    properties.sacScale
      ?? properties.sac_scale
      ?? properties.difficulty
  );
  const trailVisibility = normalizeTrailVisibilityValue(properties.trailVisibility ?? properties.trail_visibility);
  const surface = normalizeSurfaceValue(properties.surface);
  const smoothness = normalizeTagString(properties.smoothness);
  const trackType = normalizeTagString(properties.trackType ?? properties.tracktype ?? properties.track_type);
  const attributes = {};
  if (sacScale) {
    attributes.sacScale = sacScale;
  }
  if (trailVisibility) {
    attributes.trailVisibility = trailVisibility;
  }
  if (surface) {
    attributes.surface = surface;
  }
  if (smoothness) {
    attributes.smoothness = smoothness;
  }
  if (trackType) {
    attributes.trackType = trackType;
  }
  return Object.keys(attributes).length ? attributes : null;
}

function mergeHikingAttributes(current, next) {
  if (!current) {
    return next ? { ...next } : null;
  }
  if (!next) {
    return { ...current };
  }
  const merged = { ...current };
  const currentSac = current.sacScale;
  const nextSac = next.sacScale;
  if (nextSac) {
    const currentRank = currentSac ? (SAC_SCALE_RANK[currentSac] || 0) : 0;
    const nextRank = SAC_SCALE_RANK[nextSac] || 0;
    if (!currentSac || nextRank > currentRank) {
      merged.sacScale = nextSac;
    }
  }
  if (next.trailVisibility) {
    const currentRank = merged.trailVisibility ? (TRAIL_VISIBILITY_RANK[merged.trailVisibility] || 0) : 0;
    const nextRank = TRAIL_VISIBILITY_RANK[next.trailVisibility] || 0;
    if (!merged.trailVisibility || nextRank > currentRank) {
      merged.trailVisibility = next.trailVisibility;
    }
  }
  if (next.surface) {
    const currentRank = merged.surface ? (SURFACE_RANK[merged.surface] || 0) : 0;
    const nextRank = SURFACE_RANK[next.surface] || 0;
    if (!merged.surface || nextRank > currentRank) {
      merged.surface = next.surface;
    }
  }
  if (next.smoothness && !merged.smoothness) {
    merged.smoothness = next.smoothness;
  }
  if (next.trackType && !merged.trackType) {
    merged.trackType = next.trackType;
  }
  return merged;
}

function determineSupportedModes(properties) {
  const modes = new Set();
  const cls = normalizeValue(properties?.class);
  const subclass = normalizeValue(properties?.subclass);
  const bicycle = normalizeValue(properties?.bicycle);
  const foot = normalizeValue(properties?.foot);
  const motorVehicle = normalizeValue(properties?.motor_vehicle ?? properties?.motorcar ?? properties?.vehicle);
  const generalAccess = normalizeValue(properties?.access);

  const accessAllowed = !forbids(generalAccess);
  const footAllowed = !forbids(foot) && accessAllowed;
  const bicycleAllowed = !forbids(bicycle) && accessAllowed;
  const motorAllowed = !forbids(motorVehicle) && accessAllowed;

  if (PATH_CLASSES.has(cls) || PATH_SUBCLASSES.has(subclass)) {
    if (footAllowed || allows(foot, true)) {
      modes.add('foot-hiking');
    }
    if ((subclass === 'cycleway' || allows(bicycle, false)) && bicycleAllowed) {
      modes.add('cycling-regular');
    }
  } else if (CYCLE_CLASSES.has(cls) || subclass === 'cycleway') {
    if (bicycleAllowed || allows(bicycle, true)) {
      modes.add('cycling-regular');
    }
    if (footAllowed || allows(foot, false)) {
      modes.add('foot-hiking');
    }
  } else if (ROAD_CLASSES.has(cls) || subclass === 'track') {
    if (motorAllowed || allows(motorVehicle, true)) {
      modes.add('driving-car');
    }
    if (cls !== 'motorway' && (bicycleAllowed || allows(bicycle, true))) {
      modes.add('cycling-regular');
    }
    if (!['motorway', 'trunk'].includes(cls) && (footAllowed || allows(foot, cls !== 'motorway'))) {
      modes.add('foot-hiking');
    }
  } else {
    if (footAllowed || allows(foot, true)) {
      modes.add('foot-hiking');
    }
    if (bicycleAllowed && allows(bicycle, false)) {
      modes.add('cycling-regular');
    }
  }

  const filtered = Array.from(modes).filter((mode) => SUPPORTED_MODES.has(mode));
  return new Set(filtered);
}

function addLineFeature(collectionMap, coords, baseProps, precision) {
  const sanitized = sanitizeLineCoordinates(coords, precision);
  if (!sanitized) {
    return;
  }
  const modes = Array.from(baseProps.modes).filter((mode) => SUPPORTED_MODES.has(mode));
  if (!modes.length) {
    return;
  }
  const key = geometryKeyFromCoords(sanitized, precision);
  const existing = collectionMap.get(key);
  if (existing) {
    const combined = new Set(existing.properties?.modes || []);
    modes.forEach((mode) => combined.add(mode));
    existing.properties.modes = Array.from(combined);
    const existingCost = Number(existing.properties.costMultiplier) || 1;
    const nextCost = Number(baseProps.costMultiplier) || 1;
    if (nextCost < existingCost) {
      existing.properties.costMultiplier = nextCost;
    }
    if (baseProps.name && !existing.properties.name) {
      existing.properties.name = baseProps.name;
    }
    if (baseProps.hiking) {
      const merged = mergeHikingAttributes(existing.properties?.hiking, baseProps.hiking);
      if (merged) {
        existing.properties.hiking = merged;
      }
    }
    collectionMap.set(key, existing);
    return;
  }
  const properties = { modes };
  if (baseProps.name) {
    properties.name = baseProps.name;
  }
  if (Number.isFinite(baseProps.costMultiplier) && baseProps.costMultiplier !== 1) {
    properties.costMultiplier = Number(baseProps.costMultiplier.toFixed ? baseProps.costMultiplier.toFixed(3) : baseProps.costMultiplier);
  }
  if (baseProps.hiking) {
    properties.hiking = { ...baseProps.hiking };
  }
  collectionMap.set(key, {
    type: 'Feature',
    properties,
    geometry: {
      type: 'LineString',
      coordinates: sanitized
    }
  });
}

export async function extractOpenFreeMapNetwork(map, options = {}) {
  if (!map || typeof map.querySourceFeatures !== 'function') {
    throw new Error('extractOpenFreeMapNetwork requires a MapLibre GL JS map instance with querySourceFeatures support');
  }

  const merged = { ...DEFAULT_OPTIONS, ...(options || {}) };
  const {
    sourceId,
    sourceLayer,
    boundsPaddingRatio,
    coordinatePrecision,
    targetBounds
  } = merged;

  await waitForMapIdle(map);

  if (typeof map.getSource === 'function' && !map.getSource(sourceId)) {
    throw new Error(`Map source "${sourceId}" is unavailable`);
  }

  let sourceFeatures = [];
  try {
    sourceFeatures = map.querySourceFeatures(sourceId, { sourceLayer });
  } catch (error) {
    console.warn('Failed to query OpenFreeMap features for offline routing', error);
    sourceFeatures = [];
  }

  if (!Array.isArray(sourceFeatures) || !sourceFeatures.length) {
    return { type: 'FeatureCollection', features: [] };
  }

  const boundsSource = targetBounds ?? (map.getBounds ? map.getBounds() : null);
  const expandedBounds = expandBounds(boundsSource, Number.isFinite(boundsPaddingRatio) ? boundsPaddingRatio : 0.2);

  const featuresByGeometry = new Map();

  sourceFeatures.forEach((feature) => {
    if (!feature) {
      return;
    }
    const plain = typeof feature.toJSON === 'function' ? feature.toJSON() : feature;
    const { geometry, properties } = plain || {};
    if (!geometry || !geometry.type) {
      return;
    }
    const featureBounds = getGeometryBounds(geometry);
    if (!intersectsBounds(featureBounds, expandedBounds)) {
      return;
    }
    const modes = determineSupportedModes(properties || {});
    if (!modes.size) {
      return;
    }
    const costMultiplier = determineCostMultiplier(properties || {});
    const name = typeof properties?.name === 'string' && properties.name.trim().length
      ? properties.name.trim()
      : null;
    const hiking = collectHikingAttributes(properties || {});
    const baseProps = { modes, costMultiplier, name, hiking };

    if (geometry.type === 'LineString') {
      addLineFeature(featuresByGeometry, geometry.coordinates, baseProps, coordinatePrecision);
    } else if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
      geometry.coordinates.forEach((coords) => {
        addLineFeature(featuresByGeometry, coords, baseProps, coordinatePrecision);
      });
    }
  });

  return {
    type: 'FeatureCollection',
    features: Array.from(featuresByGeometry.values())
  };
}

export function computeExpandedBounds(bounds, paddingRatio = 0.2) {
  return expandBounds(bounds, paddingRatio);
}
