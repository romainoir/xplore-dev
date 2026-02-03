const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const DEFAULT_NETWORK_RADIUS_METERS = 15000;
export const PATH_RADIUS_METERS = DEFAULT_NETWORK_RADIUS_METERS;
export const POI_RADIUS_METERS = DEFAULT_NETWORK_RADIUS_METERS;
const MIN_COORDINATE_SPAN_EPSILON = 1e-9;
const POI_FILTERS = Object.freeze([
  'node["natural"="peak"]',
  'node["natural"="volcano"]',
  'node["natural"="saddle"]',
  'node["natural"="mountain_pass"]',
  'node["mountain_pass"="yes"]',
  'node["tourism"="viewpoint"]',
  'node["tourism"="alpine_hut"]',
  'node["tourism"="wilderness_hut"]',
  'node["tourism"="guest_house"]',
  'node["tourism"="hostel"]',
  'node["tourism"="hotel"]',
  'node["amenity"="restaurant"]',
  'node["amenity"="fast_food"]',
  'node["amenity"="cafe"]',
  'node["amenity"="bar"]',
  'node["amenity"="pub"]',
  'node["amenity"="parking"]',
  'node["amenity"="shelter"]',
  'node["building"="cabin"]',
  'node["shelter_type"="cabin"]',
  'way["amenity"="parking"]',
  'relation["amenity"="parking"]',
  'way["amenity"="shelter"]',
  'relation["amenity"="shelter"]',
  'way["building"="cabin"]',
  'relation["building"="cabin"]',
  'node["natural"="spring"]',
  'way["natural"="spring"]',
  'node["natural"="water"]',
  'way["natural"="water"]',
  'node["amenity"="drinking_water"]',
  'way["amenity"="drinking_water"]',
  'node["tourism"="information"]["information"="guidepost"]'
]);
const POI_NAME_TAGS = Object.freeze(['name:fr', 'name', 'name:en', 'ref']);
const POI_ADDITIONAL_PROPERTY_TAGS = Object.freeze([
  'ele',
  'importance',
  'importance:level',
  'prominence',
  'prominence:meters',
  'prominence:metres',
  'rank',
  'peak'
]);

function normalizeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toFixed(value, precision = 6) {
  const numeric = normalizeNumber(value);
  if (numeric == null) {
    return null;
  }
  const factor = 10 ** precision;
  return Math.round(numeric * factor) / factor;
}

function clampLatitude(value) {
  const numeric = normalizeNumber(value);
  if (numeric == null) {
    return null;
  }
  return Math.min(90, Math.max(-90, numeric));
}

function clampLongitude(value) {
  const numeric = normalizeNumber(value);
  if (numeric == null) {
    return null;
  }
  if (numeric >= -180 && numeric <= 180) {
    return numeric;
  }
  const normalized = ((numeric + 180) % 360 + 360) % 360 - 180;
  return normalized;
}

function buildCoordinate(lng, lat, elevationCandidates = []) {
  const normalizedLng = normalizeNumber(lng);
  const normalizedLat = normalizeNumber(lat);
  if (normalizedLng == null || normalizedLat == null) {
    return null;
  }
  let elevation = 0;
  for (const candidate of elevationCandidates) {
    const parsed = normalizeNumber(candidate);
    if (parsed != null) {
      elevation = parsed;
      break;
    }
  }
  const roundedLng = toFixed(normalizedLng, 7);
  const roundedLat = toFixed(normalizedLat, 7);
  if (roundedLng == null || roundedLat == null) {
    return null;
  }
  return [roundedLng, roundedLat, elevation];
}

function normalizeRadiusMeters(value) {
  const numeric = normalizeNumber(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return PATH_RADIUS_METERS;
  }
  return Math.max(500, Math.round(numeric));
}

export function getOverpassQuery(lat, lon, radiusMeters = PATH_RADIUS_METERS) {
  const normalizedLat = clampLatitude(lat);
  const normalizedLon = clampLongitude(lon);
  if (normalizedLat == null || normalizedLon == null) {
    throw new Error('getOverpassQuery requires valid latitude and longitude values');
  }
  const latValue = toFixed(normalizedLat, 6);
  const lonValue = toFixed(normalizedLon, 6);
  const radiusValue = normalizeRadiusMeters(radiusMeters);
  const poiFilters = POI_FILTERS
    .map((filter) => `${filter}(around:${radiusValue},${latValue},${lonValue});`)
    .join('\n  ');
  return `[out:json][timeout:180];
(
  way["highway"]["highway"!="proposed"]["highway"!="construction"](around:${radiusValue},${latValue},${lonValue});
  ${poiFilters}
);
(._;>;);
out body center;`;
}

const FORBIDDEN_ACCESS_VALUES = new Set(['no', 'private']);
const ALLOWED_ACCESS_VALUES = new Set(['yes', 'designated', 'permissive', 'destination']);
const DRIVING_HIGHWAYS = new Set([
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'unclassified',
  'residential',
  'living_street',
  'service',
  'road'
]);
const DRIVING_ONLY_HIGHWAYS = new Set(['motorway', 'motorway_link']);
const CYCLING_AND_FOOT_HIGHWAYS = new Set(['cycleway', 'path', 'track', 'bridleway', 'byway']);
const FOOT_ONLY_HIGHWAYS = new Set(['footway', 'pedestrian', 'steps', 'corridor', 'escalator']);

const normalizePoiTagValue = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

function classifyPoiTags(tags = {}) {
  const amenity = normalizePoiTagValue(tags.amenity);
  const tourism = normalizePoiTagValue(tags.tourism);
  const natural = normalizePoiTagValue(tags.natural);
  const building = normalizePoiTagValue(tags.building);
  const shelterType = normalizePoiTagValue(tags.shelter_type);
  const mountainPass = normalizePoiTagValue(tags.mountain_pass);
  const parkingType = normalizePoiTagValue(tags.parking);

  if (natural === 'peak') {
    return { key: 'peak' };
  }
  if (natural === 'volcano') {
    return { key: 'volcano' };
  }
  if (natural === 'saddle') {
    return { key: 'saddle' };
  }
  if (natural === 'mountain_pass' || mountainPass === 'yes' || mountainPass === 'true') {
    return { key: 'mountain_pass' };
  }
  if (tourism === 'viewpoint') {
    return { key: 'viewpoint' };
  }
  if (amenity === 'restaurant') {
    return { key: 'restaurant' };
  }
  if (amenity === 'fast_food') {
    return { key: 'fast_food' };
  }
  if (amenity === 'cafe') {
    return { key: 'cafe' };
  }
  if (amenity === 'bar') {
    return { key: 'bar' };
  }
  if (amenity === 'pub') {
    return { key: 'pub' };
  }
  if (amenity === 'parking') {
    if (parkingType === 'underground') {
      return { key: 'parking_underground', class: 'parking' };
    }
    if (['multi-storey', 'multistorey', 'multi_storey', 'multi level', 'multi-level'].includes(parkingType)) {
      return { key: 'parking_multi-storey', class: 'parking' };
    }
    return { key: 'parking', class: 'parking' };
  }
  if (amenity === 'shelter') {
    if (['cabin', 'basic_hut', 'hut'].includes(shelterType)) {
      return { key: 'cabin', class: 'shelter' };
    }
    return { key: 'shelter', class: 'shelter' };
  }
  if (tourism === 'alpine_hut') {
    return { key: 'alpine_hut' };
  }
  if (tourism === 'wilderness_hut') {
    return { key: 'wilderness_hut' };
  }
  if (tourism === 'guest_house') {
    return { key: 'guest_house' };
  }
  if (tourism === 'hostel') {
    return { key: 'hostel' };
  }
  if (tourism === 'hotel') {
    return { key: 'hotel' };
  }
  if (building === 'cabin') {
    return { key: 'cabin', class: 'shelter' };
  }
  if (shelterType === 'cabin') {
    return { key: 'cabin', class: 'shelter' };
  }
  // Water sources
  if (natural === 'spring') {
    return { key: 'spring' };
  }
  if (natural === 'water') {
    return { key: 'water' };
  }
  if (amenity === 'drinking_water') {
    return { key: 'drinking_water' };
  }
  // Guideposts
  const information = normalizePoiTagValue(tags.information);
  if (tourism === 'information' && information === 'guidepost') {
    return { key: 'guidepost' };
  }
  return null;
}

function extractPoiCoordinate(element) {
  if (!element) {
    return null;
  }
  if (element.type === 'node') {
    return buildCoordinate(
      element.lon ?? element.lng,
      element.lat ?? element.latitude,
      [element.tags?.ele, element.ele]
    );
  }
  const center = element.center;
  if (center) {
    return buildCoordinate(
      center.lon ?? center.lng,
      center.lat ?? center.latitude,
      [center.ele]
    );
  }
  if (Array.isArray(element.geometry) && element.geometry.length) {
    const first = element.geometry[0];
    if (first) {
      return buildCoordinate(
        first.lon ?? first.lng ?? first[0],
        first.lat ?? first[1],
        [first.tags?.ele, first.ele]
      );
    }
  }
  return null;
}

function convertElementToPoiFeature(element) {
  if (!element || typeof element !== 'object' || !element.tags) {
    return null;
  }
  const classification = classifyPoiTags(element.tags);
  if (!classification) {
    return null;
  }
  const coordinates = extractPoiCoordinate(element);
  if (!coordinates) {
    return null;
  }
  const properties = {
    class: classification.class ?? classification.key,
    subclass: classification.key
  };
  if (element.id != null) {
    properties.id = `${element.type || 'node'}/${element.id}`;
    properties.osm_id = element.id;
  }
  POI_NAME_TAGS.forEach((tag) => {
    const value = element.tags[tag];
    if (typeof value === 'string' && value.trim()) {
      properties[tag] = value.trim();
    }
  });
  POI_ADDITIONAL_PROPERTY_TAGS.forEach((tag) => {
    if (!Object.prototype.hasOwnProperty.call(element.tags, tag)) {
      return;
    }
    const raw = element.tags[tag];
    if (raw === null || raw === undefined) {
      return;
    }
    if (typeof raw === 'number') {
      if (Number.isFinite(raw)) {
        properties[tag] = raw;
      }
      return;
    }
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed) {
        properties[tag] = trimmed;
      }
    }
  });
  if (typeof element.tags.name === 'string' && element.tags.name.trim()) {
    properties.name = element.tags.name.trim();
  }
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates
    },
    properties
  };
}

function normalizeTagValue(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function parseAccess(value) {
  const normalized = normalizeTagValue(value);
  if (!normalized) {
    return null;
  }
  if (FORBIDDEN_ACCESS_VALUES.has(normalized) || normalized === 'dismount') {
    return 'forbidden';
  }
  if (ALLOWED_ACCESS_VALUES.has(normalized)) {
    return 'allowed';
  }
  return null;
}

function getAccessStatus(tags, keys) {
  for (const key of keys) {
    const status = parseAccess(tags[key]);
    if (status) {
      return status;
    }
  }
  return null;
}

function applyAccessRestrictions(modes, tags) {
  if (!modes.size) {
    return modes;
  }

  if (modes.has('driving-car')) {
    const drivingStatus = getAccessStatus(tags, ['motor_vehicle', 'motorcar', 'vehicle', 'access']);
    if (drivingStatus === 'forbidden') {
      modes.delete('driving-car');
    }
  }

  if (modes.has('cycling-regular')) {
    const cyclingStatus = getAccessStatus(tags, ['bicycle', 'vehicle', 'access']);
    if (cyclingStatus === 'forbidden') {
      modes.delete('cycling-regular');
    }
  }

  if (modes.has('foot-hiking')) {
    const footStatus = getAccessStatus(tags, ['foot', 'pedestrian', 'access']);
    if (footStatus === 'forbidden') {
      modes.delete('foot-hiking');
    }
  }

  return modes;
}

function determineModes(tags = {}) {
  const highway = typeof tags.highway === 'string' ? tags.highway.trim().toLowerCase() : '';
  if (!highway) {
    return new Set();
  }

  const modes = new Set();
  if (DRIVING_ONLY_HIGHWAYS.has(highway)) {
    modes.add('driving-car');
  } else if (DRIVING_HIGHWAYS.has(highway)) {
    modes.add('driving-car');
    modes.add('cycling-regular');
    modes.add('foot-hiking');
  } else if (CYCLING_AND_FOOT_HIGHWAYS.has(highway)) {
    modes.add('cycling-regular');
    modes.add('foot-hiking');
  } else if (FOOT_ONLY_HIGHWAYS.has(highway)) {
    modes.add('foot-hiking');
  } else {
    modes.add('driving-car');
    modes.add('cycling-regular');
    modes.add('foot-hiking');
  }

  return applyAccessRestrictions(modes, tags);
}

function sanitizeLineCoordinates(coords) {
  if (!Array.isArray(coords) || coords.length < 2) {
    return null;
  }
  const sanitized = [];
  coords.forEach((coord) => {
    if (!coord) {
      return;
    }
    let candidate = null;
    if (Array.isArray(coord)) {
      candidate = buildCoordinate(coord[0], coord[1], [coord[2]]);
    } else if (typeof coord === 'object') {
      candidate = buildCoordinate(
        coord[0] ?? coord.lon ?? coord.lng,
        coord[1] ?? coord.lat ?? coord.latitude,
        [coord[2], coord.ele, coord.alt, coord.altitude]
      );
    }
    if (!candidate) {
      return;
    }
    const previous = sanitized[sanitized.length - 1];
    if (previous
      && Math.abs(previous[0] - candidate[0]) <= MIN_COORDINATE_SPAN_EPSILON
      && Math.abs(previous[1] - candidate[1]) <= MIN_COORDINATE_SPAN_EPSILON) {
      return;
    }
    sanitized.push(candidate);
  });
  return sanitized.length >= 2 ? sanitized : null;
}

const SAC_SCALE_RANK = Object.freeze({
  hiking: 1,
  mountain_hiking: 2,
  demanding_mountain_hiking: 3,
  alpine_hiking: 4,
  demanding_alpine_hiking: 5,
  difficult_alpine_hiking: 6
});

const TRAIL_VISIBILITY_VALUES = new Set(['excellent', 'good', 'intermediate', 'bad', 'horrible', 'no']);

function normalizeTagString(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeSacScale(value) {
  const normalized = normalizeTagString(value);
  if (!normalized) {
    return null;
  }
  const lower = normalized.toLowerCase().replace(/\s+/g, '_');
  if (SAC_SCALE_RANK[lower]) {
    return lower;
  }
  const alias = {
    t1: 'hiking',
    t2: 'mountain_hiking',
    t3: 'demanding_mountain_hiking',
    t4: 'alpine_hiking',
    t5: 'demanding_alpine_hiking',
    t6: 'difficult_alpine_hiking'
  }[lower];
  return alias || null;
}

function normalizeTrailVisibility(value) {
  const normalized = normalizeTagString(value);
  if (!normalized) {
    return null;
  }
  const lower = normalized.toLowerCase().replace(/\s+/g, '_');
  return TRAIL_VISIBILITY_VALUES.has(lower) ? lower : null;
}

function normalizeSurface(value) {
  const normalized = normalizeTagString(value);
  if (!normalized) {
    return null;
  }
  return normalized.toLowerCase().replace(/\s+/g, '_');
}

function normalizeTrackType(value) {
  const normalized = normalizeTagString(value);
  if (!normalized) {
    return null;
  }
  return normalized.toLowerCase().replace(/\s+/g, '_');
}

function collectHikingTags(tags) {
  if (!tags || typeof tags !== 'object') {
    return null;
  }
  const sacScale = normalizeSacScale(tags.sac_scale ?? tags.sacScale);
  const trailVisibility = normalizeTrailVisibility(tags.trail_visibility ?? tags.trailVisibility);
  const surface = normalizeSurface(tags.surface);
  const smoothness = normalizeTagString(tags.smoothness);
  const trackType = normalizeTrackType(tags.tracktype ?? tags.track_type ?? tags.trackType);
  const result = {};
  if (sacScale) {
    result.sacScale = sacScale;
  }
  if (trailVisibility) {
    result.trailVisibility = trailVisibility;
  }
  if (surface) {
    result.surface = surface;
  }
  if (smoothness) {
    result.smoothness = smoothness;
  }
  if (trackType) {
    result.trackType = trackType;
  }
  return Object.keys(result).length ? result : null;
}

function buildCoordinatesFromGeometry(geometry) {
  if (!Array.isArray(geometry)) {
    return null;
  }
  return sanitizeLineCoordinates(
    geometry.map((entry) => ({
      0: entry.lon ?? entry.lng,
      1: entry.lat,
      2: entry.tags?.ele ?? entry.ele
    }))
  );
}

function buildCoordinatesFromNodes(nodeIds, nodesById) {
  if (!Array.isArray(nodeIds) || !nodesById) {
    return null;
  }
  const coords = nodeIds.map((id) => nodesById.get(id)).filter(Boolean);
  return sanitizeLineCoordinates(coords);
}

function buildFeatureFromWay(way, nodesById) {
  if (!way || way.type !== 'way') {
    return null;
  }
  const tags = way.tags || {};
  const modes = determineModes(tags);
  if (!modes.size) {
    return null;
  }
  let coordinates = null;
  if (Array.isArray(way.geometry) && way.geometry.length) {
    coordinates = buildCoordinatesFromGeometry(way.geometry);
  }
  if (!coordinates) {
    coordinates = buildCoordinatesFromNodes(way.nodes, nodesById);
  }
  if (!coordinates) {
    return null;
  }
  const properties = {
    modes: Array.from(modes)
  };
  if (typeof tags.name === 'string' && tags.name.trim().length) {
    properties.name = tags.name.trim();
  }
  const cost = normalizeNumber(tags['xplore:costMultiplier']);
  if (cost != null && cost > 0 && Math.abs(cost - 1) > 1e-6) {
    properties.costMultiplier = Number(cost.toFixed ? cost.toFixed(3) : cost);
  }
  const hiking = collectHikingTags(tags);
  if (hiking) {
    properties.hiking = hiking;
  }
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'LineString',
      coordinates
    }
  };
}

function collectNodes(elements) {
  const nodes = new Map();
  if (!Array.isArray(elements)) {
    return nodes;
  }
  elements.forEach((element) => {
    if (!element || element.type !== 'node') {
      return;
    }
    const coord = buildCoordinate(
      element.lon ?? element.lng,
      element.lat ?? element.latitude,
      [element.tags?.ele, element.ele]
    );
    if (!coord) {
      return;
    }
    nodes.set(element.id, coord);
  });
  return nodes;
}

function convertOverpassElements(elements) {
  const nodesById = collectNodes(elements);
  const networkFeatures = [];
  const poiFeatures = [];
  if (!Array.isArray(elements)) {
    return {
      network: { type: 'FeatureCollection', features: [] },
      pois: { type: 'FeatureCollection', features: [] }
    };
  }
  elements.forEach((element) => {
    if (element && element.type === 'way') {
      const feature = buildFeatureFromWay(element, nodesById);
      if (feature) {
        networkFeatures.push(feature);
      }
    }
    const poiFeature = convertElementToPoiFeature(element);
    if (poiFeature) {
      poiFeatures.push(poiFeature);
    }
  });
  return {
    network: { type: 'FeatureCollection', features: networkFeatures },
    pois: { type: 'FeatureCollection', features: poiFeatures }
  };
}

function metersToLatitudeDegrees(meters) {
  return meters / 111132;
}

function metersToLongitudeDegrees(meters, latitude) {
  const latRad = (latitude * Math.PI) / 180;
  const cosLat = Math.cos(latRad);
  if (cosLat === 0) {
    return 0;
  }
  return meters / (111320 * cosLat);
}

export function computeCoverageBounds({ lat, lon, radiusMeters = Math.max(PATH_RADIUS_METERS, POI_RADIUS_METERS) }) {
  const centerLat = clampLatitude(lat);
  const centerLon = clampLongitude(lon);
  if (centerLat == null || centerLon == null) {
    return null;
  }
  const normalizedRadius = normalizeRadiusMeters(radiusMeters);
  const latDelta = metersToLatitudeDegrees(normalizedRadius);
  const lonDelta = metersToLongitudeDegrees(normalizedRadius, centerLat);
  return {
    west: centerLon - lonDelta,
    east: centerLon + lonDelta,
    south: centerLat - latDelta,
    north: centerLat + latDelta
  };
}

function buildRadiusCandidates(baseRadius = PATH_RADIUS_METERS) {
  const MIN_RADIUS_METERS = 2500;
  const startRadius = normalizeRadiusMeters(baseRadius);
  const factors = [1, 0.85, 0.7, 0.55, 0.4];
  const candidates = new Set();
  factors.forEach((factor) => {
    const candidate = Math.max(MIN_RADIUS_METERS, Math.round(startRadius * factor));
    candidates.add(candidate);
  });
  candidates.add(MIN_RADIUS_METERS);
  return Array.from(candidates).sort((a, b) => b - a);
}

function shouldRetryOverpassError(error) {
  if (!error) {
    return false;
  }
  if (typeof error === 'object') {
    const status = error.status ?? error.code ?? error.statusCode;
    if (status === 504 || status === 503 || status === 502 || status === 429) {
      return true;
    }
  }
  const message = typeof error.message === 'string' ? error.message : '';
  return /\b(504|429)\b/.test(message);
}

export async function extractOverpassNetwork({
  lat,
  lon,
  radiusMeters,
  query,
  endpoint = OVERPASS_ENDPOINT,
  signal
} = {}) {
  const radiusCandidates = buildRadiusCandidates(radiusMeters ?? PATH_RADIUS_METERS);
  let lastError = null;

  for (let index = 0; index < radiusCandidates.length; index += 1) {
    const candidateRadius = radiusCandidates[index];
    try {
      const queryToUse = typeof query === 'string' && query.trim()
        ? query
        : getOverpassQuery(lat, lon, candidateRadius);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8'
        },
        body: queryToUse,
        signal
      });
      if (!response.ok) {
        const error = new Error(`Overpass request failed with status ${response.status}`);
        error.status = response.status;
        error.radiusMeters = candidateRadius;
        throw error;
      }
      const payload = await response.json();
      const elements = Array.isArray(payload?.elements) ? payload.elements : [];
      const { network, pois } = convertOverpassElements(elements);

      // If a custom query was provided, we don't calculate coverage bounds based on radius
      // or retry with smaller radii (unless the caller handles that, but here we just break on success)
      const coverageBounds = typeof query === 'string'
        ? null
        : computeCoverageBounds({ lat, lon, radiusMeters: candidateRadius });

      return { network, pois, coverageBounds };
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      lastError = error;

      // If custom query, do not retry with different radii
      if (typeof query === 'string') {
        break;
      }

      const isLastAttempt = index === radiusCandidates.length - 1;
      if (!shouldRetryOverpassError(error) || isLastAttempt) {
        break;
      }
    }
  }

  throw lastError || new Error('Overpass network extraction failed');
}

export { OVERPASS_ENDPOINT };
