const EARTH_RADIUS_KM = 6371;
const EARTH_RADIUS_METERS = EARTH_RADIUS_KM * 1000;
const DEG_TO_RAD = Math.PI / 180;
const NODE_CONNECTION_TOLERANCE_METERS = 8;
const NODE_CONNECTION_TOLERANCE_KM = NODE_CONNECTION_TOLERANCE_METERS / 1000;
const DEFAULT_NODE_BUCKET_DEGREES = 0.005;
// Treat distances under ~1 mm as effectively identical when we need to allow
// nodes to merge despite the avoid-key guard.
const DUPLICATE_NODE_DISTANCE_KM = 1e-6;
// Allow edge-based snaps to win when they meaningfully reduce the snap distance while
// still avoiding tiny perturbations near network nodes.
const SNAP_DISTANCE_EPSILON_KM = 1e-9;
const EDGE_SNAP_ENDPOINT_TOLERANCE_METERS = 0.1;
const METERS_PER_LATITUDE_DEGREE = 111132;
const RECENT_NODE_HISTORY_LIMIT = 16;

export function haversineDistanceKm(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) {
    return 0;
  }
  const toRad = (value) => (value * Math.PI) / 180;
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const dLat = lat2 - lat1;
  const dLng = toRad(b[0] - a[0]);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  return EARTH_RADIUS_KM * c;
}

function normalizeModes(value, separator = ',') {
  if (!value) {
    return null;
  }
  if (value instanceof Set) {
    return value.size ? new Set(value) : null;
  }
  if (Array.isArray(value)) {
    const result = value
      .map((mode) => (typeof mode === 'string' ? mode.trim() : String(mode || '')))
      .filter(Boolean);
    return result.length ? new Set(result) : null;
  }
  if (typeof value === 'string') {
    return normalizeModes(value.split(separator), separator);
  }
  return null;
}

function createNodeKey(lng, lat, ele) {
  return `${lng},${lat},${ele}`;
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

function cloneCoordinate(coord) {
  if (!Array.isArray(coord)) {
    return [];
  }
  return coord.slice(0, 3).map((value, index) => (index < 2 ? value : Number.isFinite(value) ? value : 0));
}

function coordsEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) {
    return false;
  }
  return Math.abs(a[0] - b[0]) <= 1e-7 && Math.abs(a[1] - b[1]) <= 1e-7;
}

function interpolateElevation(start, end, fraction) {
  if (!Number.isFinite(fraction)) {
    return 0;
  }
  const startElevation = Number.isFinite(start?.[2]) ? start[2] : 0;
  const endElevation = Number.isFinite(end?.[2]) ? end[2] : 0;
  return startElevation + (endElevation - startElevation) * fraction;
}

function normalizeToleranceToKm({ toleranceDegrees, toleranceMeters }) {
  if (Number.isFinite(toleranceMeters) && toleranceMeters >= 0) {
    return toleranceMeters / 1000;
  }
  if (Number.isFinite(toleranceDegrees) && toleranceDegrees >= 0) {
    const approxMeters = toleranceDegrees * METERS_PER_LATITUDE_DEGREE;
    return Math.max(0, approxMeters / 1000);
  }
  return NODE_CONNECTION_TOLERANCE_KM;
}

function toProjectedMeters(coord, referenceLat) {
  if (!Array.isArray(coord) || coord.length < 2) {
    return null;
  }
  const latRad = coord[1] * DEG_TO_RAD;
  const lngRad = coord[0] * DEG_TO_RAD;
  const refRad = referenceLat * DEG_TO_RAD;
  const x = EARTH_RADIUS_METERS * lngRad * Math.cos(refRad);
  const y = EARTH_RADIUS_METERS * latRad;
  return { x, y };
}

function projectPointOnSegment(point, start, end) {
  if (!Array.isArray(point) || !Array.isArray(start) || !Array.isArray(end)) {
    return null;
  }
  if (start.length < 2 || end.length < 2) {
    return null;
  }
  const referenceLat = (start[1] + end[1]) / 2;
  const projectedPoint = toProjectedMeters(point, referenceLat);
  const projectedStart = toProjectedMeters(start, referenceLat);
  const projectedEnd = toProjectedMeters(end, referenceLat);
  if (!projectedPoint || !projectedStart || !projectedEnd) {
    return null;
  }

  const segment = {
    x: projectedEnd.x - projectedStart.x,
    y: projectedEnd.y - projectedStart.y
  };
  const lengthSq = segment.x * segment.x + segment.y * segment.y;
  if (lengthSq === 0) {
    return null;
  }

  const fromStart = {
    x: projectedPoint.x - projectedStart.x,
    y: projectedPoint.y - projectedStart.y
  };
  let fraction = (fromStart.x * segment.x + fromStart.y * segment.y) / lengthSq;
  if (!Number.isFinite(fraction)) {
    return null;
  }
  fraction = Math.max(0, Math.min(1, fraction));

  const closest = {
    x: projectedStart.x + segment.x * fraction,
    y: projectedStart.y + segment.y * fraction
  };

  const cosRef = Math.cos(referenceLat * DEG_TO_RAD);
  const lng = cosRef !== 0
    ? (closest.x / (EARTH_RADIUS_METERS * cosRef)) / DEG_TO_RAD
    : point[0];
  const lat = (closest.y / EARTH_RADIUS_METERS) / DEG_TO_RAD;
  const elevation = interpolateElevation(start, end, fraction);
  const snapPoint = [lng, lat, elevation];

  const totalDistanceKm = haversineDistanceKm(start, end);
  const distanceToStartKm = totalDistanceKm * fraction;
  const distanceToEndKm = totalDistanceKm * (1 - fraction);
  const distanceKm = haversineDistanceKm(point, snapPoint);

  return {
    point: snapPoint,
    distanceKm,
    distanceMeters: distanceKm * 1000,
    fraction,
    distanceToStartKm,
    distanceToEndKm
  };
}

export class GeoJsonPathFinder {
  constructor(geojson, options = {}) {
    const {
      precision,
      elevationPrecision,
      modesProperty,
      costProperty,
      modeSeparator,
      tolerance,
      nodeConnectionToleranceMeters,
      nodeBucketSizeDegrees
    } = options;

    this.precision = Number.isFinite(precision) && precision > 0 ? precision : 1e7;
    this.elevationPrecision = Number.isFinite(elevationPrecision) && elevationPrecision >= 0
      ? elevationPrecision
      : 2;
    this.modesProperty = typeof modesProperty === 'string' && modesProperty.length
      ? modesProperty
      : 'modes';
    this.costProperty = typeof costProperty === 'string' && costProperty.length
      ? costProperty
      : 'costMultiplier';
    this.modeSeparator = typeof modeSeparator === 'string' && modeSeparator.length
      ? modeSeparator
      : ',';

    this.nodeConnectionToleranceKm = normalizeToleranceToKm({
      toleranceDegrees: tolerance,
      toleranceMeters: nodeConnectionToleranceMeters
    });

    const bucketSize = Number(nodeBucketSizeDegrees);
    this.nodeBucketSizeDegrees = Number.isFinite(bucketSize) && bucketSize > 0
      ? bucketSize
      : DEFAULT_NODE_BUCKET_DEGREES;

    this.nodes = new Map();
    this.nodeList = [];
    this.nodeBuckets = new Map();

    if (geojson) {
      this.load(geojson);
    }
  }

  clear() {
    this.nodes.clear();
    this.nodeList = [];
    this.nodeBuckets.clear();
  }

  load(geojson) {
    this.clear();
    if (!geojson || !Array.isArray(geojson.features)) {
      return;
    }
    geojson.features.forEach((feature) => {
      this._processFeature(feature);
    });
  }

  getAllNodes() {
    return this.nodeList.map((node) => ({
      key: node.key,
      coord: node.coord.slice(),
      degree: node.edges.size
    }));
  }

  _roundCoord(coord) {
    if (!Array.isArray(coord) || coord.length < 2) {
      return null;
    }
    const factor = this.precision;
    const lng = Math.round(coord[0] * factor) / factor;
    const lat = Math.round(coord[1] * factor) / factor;
    const elevation = Number.isFinite(coord[2])
      ? Number(coord[2].toFixed(this.elevationPrecision))
      : 0;
    return [lng, lat, elevation];
  }

  _getOrCreateNode(coord, options = {}) {
    const rounded = this._roundCoord(coord);
    if (!rounded) {
      return null;
    }
    const key = createNodeKey(rounded[0], rounded[1], rounded[2]);
    if (this.nodes.has(key)) {
      return this.nodes.get(key);
    }

    const avoidKey = typeof options?.avoidKey === 'string'
      ? options.avoidKey
      : null;
    const blockedKeys = options?.blockedKeys instanceof Set
      ? options.blockedKeys
      : null;
    const candidates = this._collectNearbyNodes(rounded);
    let nearestNode = null;
    let nearestDistanceKm = Infinity;
    const toleranceKm = this.nodeConnectionToleranceKm;

    candidates.forEach((candidate) => {
      if (!candidate || !Array.isArray(candidate.coord)) {
        return;
      }
      const distanceKm = haversineDistanceKm(candidate.coord, rounded);
      if (avoidKey && candidate.key === avoidKey && distanceKm > DUPLICATE_NODE_DISTANCE_KM) {
        return;
      }
      if (blockedKeys
        && blockedKeys.has(candidate.key)
        && distanceKm > DUPLICATE_NODE_DISTANCE_KM) {
        return;
      }
      if (distanceKm < toleranceKm && distanceKm < nearestDistanceKm) {
        nearestNode = candidate;
        nearestDistanceKm = distanceKm;
      }
    });

    if (nearestNode) {
      return nearestNode;
    }

    const node = {
      key,
      coord: rounded,
      edges: new Map()
    };
    this.nodes.set(key, node);
    this.nodeList.push(node);
    this._addNodeToBuckets(node);
    return node;
  }

  _getBucketIndices(coord) {
    if (!Array.isArray(coord) || coord.length < 2) {
      return null;
    }
    const size = this.nodeBucketSizeDegrees;
    if (!Number.isFinite(size) || size <= 0) {
      return null;
    }
    const lngIndex = Math.round(coord[0] / size);
    const latIndex = Math.round(coord[1] / size);
    if (!Number.isFinite(lngIndex) || !Number.isFinite(latIndex)) {
      return null;
    }
    return { lngIndex, latIndex };
  }

  _getBucketKeyFromIndices({ lngIndex, latIndex }) {
    if (!Number.isFinite(lngIndex) || !Number.isFinite(latIndex)) {
      return null;
    }
    return `${lngIndex}:${latIndex}`;
  }

  _addNodeToBuckets(node) {
    if (!node || !Array.isArray(node.coord)) {
      return;
    }
    const indices = this._getBucketIndices(node.coord);
    if (!indices) {
      return;
    }
    const key = this._getBucketKeyFromIndices(indices);
    if (!key) {
      return;
    }
    if (!this.nodeBuckets.has(key)) {
      this.nodeBuckets.set(key, []);
    }
    this.nodeBuckets.get(key).push(node);
  }

  _collectNearbyNodes(coord) {
    const indices = this._getBucketIndices(coord);
    if (!indices) {
      return this.nodeList;
    }
    const neighbors = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const key = this._getBucketKeyFromIndices({
          lngIndex: indices.lngIndex + dx,
          latIndex: indices.latIndex + dy
        });
        if (!key) {
          continue;
        }
        const bucket = this.nodeBuckets.get(key);
        if (Array.isArray(bucket) && bucket.length) {
          bucket.forEach((node) => neighbors.push(node));
        }
      }
    }
    return neighbors.length ? neighbors : this.nodeList;
  }

  _addDirectedEdge(source, target, edge) {
    if (!source || !target) {
      return;
    }
    const existing = source.edges.get(target.key);
    if (existing && existing.weight <= edge.weight) {
      return;
    }
    source.edges.set(target.key, {
      key: target.key,
      weight: edge.weight,
      distanceKm: edge.distanceKm,
      ascent: edge.ascent,
      descent: edge.descent,
      modes: edge.modes,
      attributes: edge.attributes ? { ...edge.attributes } : null
    });
  }

  _extractEdgeAttributes(properties) {
    if (!properties || typeof properties !== 'object') {
      return null;
    }
    const hiking = properties.hiking && typeof properties.hiking === 'object' ? properties.hiking : null;
    const sacScale = normalizeSacScale(hiking?.sacScale ?? properties.sacScale ?? properties.sac_scale);
    const trailVisibility = normalizeTrailVisibility(hiking?.trailVisibility ?? properties.trailVisibility ?? properties.trail_visibility);
    const surface = normalizeSurface(hiking?.surface ?? properties.surface);
    const smoothness = normalizeTagString(hiking?.smoothness ?? properties.smoothness);
    const trackType = normalizeTrackType(hiking?.trackType ?? properties.trackType ?? properties.tracktype ?? properties.track_type);
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

  _processFeature(feature) {
    if (!feature || !feature.geometry) {
      return;
    }
    const { geometry, properties } = feature;
    const segments = [];
    if (geometry.type === 'LineString') {
      segments.push(geometry.coordinates);
    } else if (geometry.type === 'MultiLineString') {
      geometry.coordinates.forEach((part) => segments.push(part));
    }
    if (!segments.length) {
      return;
    }
    const modes = normalizeModes(properties?.[this.modesProperty], this.modeSeparator);
    const multiplier = Number(properties?.[this.costProperty]);
    const costMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
    const attributes = this._extractEdgeAttributes(properties);

    segments.forEach((coords) => {
      if (!Array.isArray(coords) || coords.length < 2) {
        return;
      }
      const recentKeyOrder = [];
      const recentKeySet = new Set();
      const rememberKey = (node) => {
        if (!node || !node.key) {
          return;
        }
        if (recentKeySet.has(node.key)) {
          return;
        }
        recentKeyOrder.push(node.key);
        recentKeySet.add(node.key);
        if (recentKeyOrder.length > RECENT_NODE_HISTORY_LIMIT) {
          const removed = recentKeyOrder.shift();
          if (removed) {
            recentKeySet.delete(removed);
          }
        }
      };

      for (let index = 0; index < coords.length - 1; index += 1) {
        const start = this._getOrCreateNode(coords[index], {
          blockedKeys: recentKeySet
        });
        rememberKey(start);
        const end = this._getOrCreateNode(coords[index + 1], {
          avoidKey: start?.key,
          blockedKeys: recentKeySet
        });
        rememberKey(end);
        if (!start || !end) {
          continue;
        }
        const distanceKm = haversineDistanceKm(start.coord, end.coord);
        const ascent = Math.max(0, (end.coord[2] ?? 0) - (start.coord[2] ?? 0));
        const descent = Math.max(0, (start.coord[2] ?? 0) - (end.coord[2] ?? 0));
        const weight = distanceKm * costMultiplier;
        const edge = {
          weight,
          distanceKm,
          ascent,
          descent,
          modes,
          attributes
        };
        this._addDirectedEdge(start, end, edge);
        this._addDirectedEdge(end, start, {
          weight,
          distanceKm,
          ascent: descent,
          descent: ascent,
          modes,
          attributes
        });
      }
    });
  }

  findNearestNode(coord) {
    if (!Array.isArray(coord) || coord.length < 2 || !this.nodeList.length) {
      return null;
    }
    let best = null;
    let bestDistance = Infinity;
    this.nodeList.forEach((node) => {
      const distanceKm = haversineDistanceKm(node.coord, coord);
      if (distanceKm < bestDistance) {
        bestDistance = distanceKm;
        best = node;
      }
    });
    if (!best) {
      return null;
    }
    return {
      node: best,
      distanceKm: bestDistance,
      distanceMeters: bestDistance * 1000
    };
  }

  findNearestPoint(coord) {
    if (!Array.isArray(coord) || coord.length < 2 || !this.nodeList.length) {
      return null;
    }

    let bestSnap = null;

    this.nodeList.forEach((node) => {
      const distanceKm = haversineDistanceKm(node.coord, coord);
      if (!bestSnap || distanceKm < bestSnap.distanceKm) {
        bestSnap = {
          type: 'node',
          node,
          point: cloneCoordinate(node.coord),
          distanceKm,
          distanceMeters: distanceKm * 1000
        };
      }
    });

    if (!bestSnap) {
      return null;
    }

    const processedEdges = new Set();

    this.nodes.forEach((node) => {
      node.edges.forEach((edge) => {
        const targetKey = edge.key;
        if (!targetKey) {
          return;
        }
        const pairKey = node.key <= targetKey ? `${node.key}|${targetKey}` : `${targetKey}|${node.key}`;
        if (processedEdges.has(pairKey)) {
          return;
        }
        processedEdges.add(pairKey);
        const target = this.nodes.get(edge.key);
        if (!target) {
          return;
        }
        const projection = projectPointOnSegment(coord, node.coord, target.coord);
        if (!projection) {
          return;
        }
        const minEndpointDistanceKm = Math.min(
          Number.isFinite(projection.distanceToStartKm) ? projection.distanceToStartKm : Infinity,
          Number.isFinite(projection.distanceToEndKm) ? projection.distanceToEndKm : Infinity
        );
        const minEndpointDistanceMeters = minEndpointDistanceKm * 1000;
        if (Number.isFinite(minEndpointDistanceMeters)
          && minEndpointDistanceMeters <= EDGE_SNAP_ENDPOINT_TOLERANCE_METERS
          && bestSnap
          && projection.distanceKm >= bestSnap.distanceKm - SNAP_DISTANCE_EPSILON_KM) {
          return;
        }
        if (bestSnap && projection.distanceKm >= bestSnap.distanceKm - SNAP_DISTANCE_EPSILON_KM) {
          return;
        }
        bestSnap = {
          type: 'edge',
          edgeStart: node,
          edgeEnd: target,
          point: projection.point,
          distanceKm: projection.distanceKm,
          distanceMeters: projection.distanceMeters,
          fraction: projection.fraction,
          distanceToStartKm: projection.distanceToStartKm,
          distanceToEndKm: projection.distanceToEndKm
        };
      });
    });

    return bestSnap;
  }

  buildPath(startKey, endKey, mode) {
    if (!startKey || !endKey) {
      return null;
    }
    if (!this.nodes.has(startKey) || !this.nodes.has(endKey)) {
      return null;
    }
    const distances = new Map();
    const previous = new Map();
    const queue = new Map();

    this.nodes.forEach((_, key) => {
      distances.set(key, Infinity);
    });
    distances.set(startKey, 0);
    queue.set(startKey, 0);

    while (queue.size) {
      let currentKey = null;
      let currentDistance = Infinity;
      queue.forEach((value, key) => {
        if (value < currentDistance) {
          currentDistance = value;
          currentKey = key;
        }
      });
      if (currentKey === null) {
        break;
      }
      queue.delete(currentKey);
      if (currentKey === endKey) {
        break;
      }
      const node = this.nodes.get(currentKey);
      if (!node) {
        continue;
      }
      node.edges.forEach((edge) => {
        if (mode && edge.modes && !edge.modes.has(mode)) {
          return;
        }
        const alt = currentDistance + edge.weight;
        if (alt < distances.get(edge.key)) {
          distances.set(edge.key, alt);
          previous.set(edge.key, currentKey);
          queue.set(edge.key, alt);
        }
      });
    }

    if (!previous.has(endKey) && startKey !== endKey) {
      return null;
    }

    const pathKeys = [];
    let cursor = endKey;
    pathKeys.push(cursor);
    while (previous.has(cursor)) {
      cursor = previous.get(cursor);
      pathKeys.push(cursor);
    }
    pathKeys.reverse();

    const coordinates = [];
    const edges = [];
    let totalDistanceKm = 0;
    let totalAscent = 0;
    let totalDescent = 0;

    for (let index = 0; index < pathKeys.length; index += 1) {
      const key = pathKeys[index];
      const node = this.nodes.get(key);
      if (!node) {
        continue;
      }
      if (!coordinates.length || !coordsEqual(coordinates[coordinates.length - 1], node.coord)) {
        coordinates.push(cloneCoordinate(node.coord));
      }
      if (index < pathKeys.length - 1) {
        const nextKey = pathKeys[index + 1];
        const edge = node.edges.get(nextKey);
        if (edge) {
          const target = this.nodes.get(nextKey);
          const startCoord = cloneCoordinate(node.coord);
          const endCoord = cloneCoordinate(target?.coord ?? []);
          const costMultiplier = Number.isFinite(edge.distanceKm)
            && edge.distanceKm > 0
              ? edge.weight / edge.distanceKm
              : 1;
          totalDistanceKm += edge.distanceKm;
          totalAscent += edge.ascent;
          totalDescent += edge.descent;
          edges.push({
            start: startCoord,
            end: endCoord,
            distanceKm: edge.distanceKm,
            ascent: edge.ascent,
            descent: edge.descent,
            weight: edge.weight,
            costMultiplier: Number.isFinite(costMultiplier) && costMultiplier > 0
              ? costMultiplier
              : 1,
            attributes: edge.attributes ? { ...edge.attributes } : null
          });
        }
      }
    }

    return {
      coordinates,
      distanceKm: totalDistanceKm,
      ascent: totalAscent,
      descent: totalDescent,
      startKey,
      endKey,
      edges
    };
  }
}
