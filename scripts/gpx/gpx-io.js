import { GPX_LINE_LAYER_ID, GPX_POINT_LAYER_ID, GPX_SOURCE_ID } from '../config/map-config.js';

function getTextContent(el, tagName) {
  if (!el) return null;
  const child = el.getElementsByTagName(tagName)[0];
  if (!child || !child.textContent) return null;
  const text = child.textContent.trim();
  return text.length ? text : null;
}

function parsePointElement(el, latAttr = 'lat', lonAttr = 'lon') {
  if (!el) return null;
  const lat = parseFloat(el.getAttribute(latAttr));
  const lon = parseFloat(el.getAttribute(lonAttr));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const coord = [lon, lat];
  const eleText = getTextContent(el, 'ele');
  const ele = eleText !== null ? parseFloat(eleText) : NaN;
  if (Number.isFinite(ele)) coord.push(ele);
  return coord;
}

export function parseGpxToGeoJson(gpxText) {
  if (!gpxText) return null;
  const parser = new DOMParser();
  const doc = parser.parseFromString(gpxText, 'application/xml');
  if (!doc || doc.getElementsByTagName('parsererror').length) {
    throw new Error('Invalid GPX document');
  }

  const features = [];

  const appendLineFeature = (coordinates, properties = {}) => {
    if (!Array.isArray(coordinates) || coordinates.length < 2) return;
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates },
      properties
    });
  };

  const appendMultiLineFeature = (segments, properties = {}) => {
    const validSegments = segments.filter(segment => Array.isArray(segment) && segment.length >= 2);
    if (!validSegments.length) return;
    if (validSegments.length === 1) {
      appendLineFeature(validSegments[0], properties);
      return;
    }
    features.push({
      type: 'Feature',
      geometry: { type: 'MultiLineString', coordinates: validSegments },
      properties
    });
  };

  const appendPointFeature = (coord, properties = {}) => {
    if (!Array.isArray(coord) || coord.length < 2) return;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coord },
      properties
    });
  };

  const trackElements = Array.from(doc.getElementsByTagName('trk'));
  trackElements.forEach((trackEl, trackIndex) => {
    const trackName = getTextContent(trackEl, 'name') || `Track ${trackIndex + 1}`;
    const segments = Array.from(trackEl.getElementsByTagName('trkseg'));
    const segmentCoords = [];
    segments.forEach((segmentEl, segIndex) => {
      const points = Array.from(segmentEl.getElementsByTagName('trkpt'));
      const coords = points
        .map(pt => parsePointElement(pt))
        .filter(coord => Array.isArray(coord));
      if (coords.length >= 2) {
        segmentCoords.push(coords);
      } else if (coords.length === 1) {
        appendPointFeature(coords[0], { name: trackName, source: 'track', segment: segIndex + 1 });
      }
    });
    appendMultiLineFeature(segmentCoords, { name: trackName, source: 'track' });
  });

  const routeElements = Array.from(doc.getElementsByTagName('rte'));
  routeElements.forEach((routeEl, routeIndex) => {
    const routeName = getTextContent(routeEl, 'name') || `Route ${routeIndex + 1}`;
    const points = Array.from(routeEl.getElementsByTagName('rtept'));
    const coords = points
      .map(pt => parsePointElement(pt))
      .filter(coord => Array.isArray(coord));
    appendLineFeature(coords, { name: routeName, source: 'route' });
  });

  const waypointElements = Array.from(doc.getElementsByTagName('wpt'));
  waypointElements.forEach((wptEl, waypointIndex) => {
    const coord = parsePointElement(wptEl);
    if (!coord) return;
    const name = getTextContent(wptEl, 'name') || `Waypoint ${waypointIndex + 1}`;
    appendPointFeature(coord, { name, source: 'waypoint' });
  });

  return {
    type: 'FeatureCollection',
    features
  };
}

export function computeGeojsonBounds(geojson) {
  if (!geojson || geojson.type !== 'FeatureCollection') return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const extend = (coord) => {
    if (!Array.isArray(coord) || coord.length < 2) return;
    const [x, y] = coord;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  const walk = (coords) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number') {
      extend(coords);
      return;
    }
    coords.forEach(walk);
  };

  (geojson.features || []).forEach(feature => {
    if (!feature || !feature.geometry) return;
    walk(feature.geometry.coordinates);
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  return [[minX, minY], [maxX, maxY]];
}

export function ensureGpxLayers(map, data, beforeLayerId) {
  if (!map) return;
  const emptyCollection = { type: 'FeatureCollection', features: [] };
  const dataset = data && Array.isArray(data.features) ? data : emptyCollection;

  const existingSource = map.getSource(GPX_SOURCE_ID);
  if (existingSource) {
    existingSource.setData(dataset);
  } else if (typeof map.addSource === 'function') {
    map.addSource(GPX_SOURCE_ID, {
      type: 'geojson',
      data: dataset
    });
  }

  const before = beforeLayerId || undefined;

  if (!map.getLayer(GPX_LINE_LAYER_ID)) {
    map.addLayer({
      id: GPX_LINE_LAYER_ID,
      type: 'line',
      source: GPX_SOURCE_ID,
      filter: ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: {
        'line-color': '#ff6b3a',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.4, 12, 3.6, 14, 5.2, 16, 7.5],
        'line-opacity': 0.9
      }
    }, before);
  } else if (before) {
    try { map.moveLayer(GPX_LINE_LAYER_ID, before); } catch (_) {}
  }

  if (!map.getLayer(GPX_POINT_LAYER_ID)) {
    map.addLayer({
      id: GPX_POINT_LAYER_ID,
      type: 'circle',
      source: GPX_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 12, 5.5, 16, 8],
        'circle-color': '#ffffff',
        'circle-opacity': 0.95,
        'circle-stroke-color': '#ff6b3a',
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, 1.2, 12, 1.6, 16, 2.4]
      }
    }, before);
  } else if (before) {
    try { map.moveLayer(GPX_POINT_LAYER_ID, before); } catch (_) {}
  }
}

export function zoomToGeojson(map, geojson) {
  if (!map || !geojson) return;
  const bounds = computeGeojsonBounds(geojson);
  if (!bounds) return;
  const [[minX, minY], [maxX, maxY]] = bounds;
  if (minX === maxX && minY === maxY) {
    const currentZoom = typeof map.getZoom === 'function' ? map.getZoom() : 13;
    const targetZoom = Number.isFinite(currentZoom) ? Math.max(13, currentZoom) : 13;
    map.flyTo({ center: [minX, minY], zoom: targetZoom });
    return;
  }
  map.fitBounds(bounds, {
    padding: { top: 80, bottom: 80, left: 80, right: 80 },
    maxZoom: 15,
    duration: 1200
  });
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeCoordinate(coord) {
  if (!Array.isArray(coord) || coord.length < 2) return null;
  const [lon, lat, ele] = coord;
  if (!isFiniteNumber(lon) || !isFiniteNumber(lat)) return null;
  const normalized = { lon, lat };
  if (isFiniteNumber(ele)) normalized.ele = ele;
  return normalized;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function serializeTrack(name, segments) {
  if (!segments.length) return '';
  const parts = ['  <trk>'];
  if (name) parts.push(`    <name>${escapeXml(name)}</name>`);
  segments.forEach((segment) => {
    if (!Array.isArray(segment) || segment.length < 2) return;
    parts.push('    <trkseg>');
    segment.forEach((pt) => {
      const { lat, lon, ele } = pt;
      parts.push(`      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}">`);
      if (isFiniteNumber(ele)) {
        parts.push(`        <ele>${ele.toFixed(1)}</ele>`);
      }
      parts.push('      </trkpt>');
    });
    parts.push('    </trkseg>');
  });
  parts.push('  </trk>');
  return parts.join('\n');
}

function serializeRoute(name, points) {
  if (!points.length) return '';
  const parts = ['  <rte>'];
  if (name) parts.push(`    <name>${escapeXml(name)}</name>`);
  points.forEach((pt) => {
    const { lat, lon, ele } = pt;
    parts.push(`    <rtept lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}">`);
    if (isFiniteNumber(ele)) {
      parts.push(`      <ele>${ele.toFixed(1)}</ele>`);
    }
    parts.push('    </rtept>');
  });
  parts.push('  </rte>');
  return parts.join('\n');
}

function serializeWaypoint(name, point) {
  if (!point) return '';
  const { lat, lon, ele } = point;
  const parts = [`  <wpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}">`];
  if (name) parts.push(`    <name>${escapeXml(name)}</name>`);
  if (isFiniteNumber(ele)) {
    parts.push(`    <ele>${ele.toFixed(1)}</ele>`);
  }
  parts.push('  </wpt>');
  return parts.join('\n');
}

export function geojsonToGpx(geojson, { creator = 'XploreMap' } = {}) {
  if (!geojson || geojson.type !== 'FeatureCollection') {
    throw new Error('Invalid GeoJSON dataset');
  }

  const safeCreator = typeof creator === 'string' && creator.trim().length ? creator.trim() : 'XploreMap';

  const tracks = [];
  const routes = [];
  const waypoints = [];

  let trackCount = 0;
  let routeCount = 0;
  let waypointCount = 0;

  (geojson.features || []).forEach((feature) => {
    if (!feature || !feature.geometry) return;
    const props = feature.properties && typeof feature.properties === 'object' ? feature.properties : {};
    const nameProp = typeof props.name === 'string' && props.name.trim().length ? props.name.trim() : null;
    const source = typeof props.source === 'string' ? props.source.toLowerCase() : '';

    switch (feature.geometry.type) {
      case 'LineString': {
        const points = (feature.geometry.coordinates || [])
          .map(normalizeCoordinate)
          .filter(Boolean);
        if (points.length < 2) break;
        if (source === 'route') {
          const routeName = nameProp || `Route ${++routeCount}`;
          routes.push({ name: routeName, points });
        } else {
          const trackName = nameProp || `Track ${++trackCount}`;
          tracks.push({ name: trackName, segments: [points] });
        }
        break;
      }
      case 'MultiLineString': {
        const segments = (feature.geometry.coordinates || [])
          .map(segment => Array.isArray(segment)
            ? segment.map(normalizeCoordinate).filter(Boolean)
            : [])
          .filter(segment => segment.length >= 2);
        if (!segments.length) break;
        if (source === 'route') {
          const flattened = segments.flat();
          if (flattened.length >= 2) {
            const routeName = nameProp || `Route ${++routeCount}`;
            routes.push({ name: routeName, points: flattened });
          }
        } else {
          const trackName = nameProp || `Track ${++trackCount}`;
          tracks.push({ name: trackName, segments });
        }
        break;
      }
      case 'Point': {
        const point = normalizeCoordinate(feature.geometry.coordinates);
        if (!point) break;
        const label = nameProp || `Waypoint ${++waypointCount}`;
        waypoints.push({ name: label, point });
        break;
      }
      default:
        break;
    }
  });

  const gpxParts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="${escapeXml(safeCreator)}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">`
  ];

  waypoints.forEach(({ name, point }) => {
    const block = serializeWaypoint(name, point);
    if (block) gpxParts.push(block);
  });

  routes.forEach(({ name, points }) => {
    const block = serializeRoute(name, points);
    if (block) gpxParts.push(block);
  });

  tracks.forEach(({ name, segments }) => {
    const block = serializeTrack(name, segments);
    if (block) gpxParts.push(block);
  });

  gpxParts.push('</gpx>');

  return gpxParts.join('\n');
}
