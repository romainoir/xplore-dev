import { turfApi } from '../constants/directions-constants.js';

import {
  haversineDistanceMeters,
  bearingBetween
} from '../utils/directions-utils.js';


export class DirectionsManagerImportMixin {

  normalizeImportedCoordinate(coord) {
    if (!Array.isArray(coord) || coord.length < 2) {
      return null;
    }
    const lng = Number(coord[0]);
    const lat = Number(coord[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return null;
    }
    const normalized = [lng, lat];
    if (coord.length > 2) {
      const elevation = Number(coord[2]);
      if (Number.isFinite(elevation)) {
        normalized.push(elevation);
      }
    }
    return normalized;
  }


  normalizeImportedSequence(coords) {
    if (!Array.isArray(coords)) {
      return [];
    }
    const sequence = [];
    coords.forEach((coord) => {
      const normalized = this.normalizeImportedCoordinate(coord);
      if (!normalized) {
        return;
      }
      if (sequence.length && this.coordinatesMatch(sequence[sequence.length - 1], normalized)) {
        return;
      }
      sequence.push(normalized);
    });
    return sequence;
  }


  mergeImportedCoordinateSegments(segments) {
    if (!Array.isArray(segments)) {
      return [];
    }
    const merged = [];
    segments.forEach((segment) => {
      const sequence = this.normalizeImportedSequence(segment);
      if (!sequence.length) {
        return;
      }
      if (!merged.length) {
        sequence.forEach((coord) => merged.push(coord));
        return;
      }
      const last = merged[merged.length - 1];
      const startIndex = this.coordinatesMatch(last, sequence[0]) ? 1 : 0;
      for (let index = startIndex; index < sequence.length; index += 1) {
        const coord = sequence[index];
        if (merged.length && this.coordinatesMatch(merged[merged.length - 1], coord)) {
          continue;
        }
        merged.push(coord);
      }
    });
    return merged;
  }


  estimateSequenceDistanceKm(coords) {
    if (!Array.isArray(coords) || coords.length < 2) {
      return 0;
    }
    let totalMeters = 0;
    for (let index = 0; index < coords.length - 1; index += 1) {
      const distance = this.computeCoordinateDistanceMeters(coords[index], coords[index + 1]);
      if (Number.isFinite(distance)) {
        totalMeters += distance;
      }
    }
    return totalMeters / 1000;
  }


  deriveWaypointsFromImportedSequence(coords, options = {}) {
    const sequence = this.normalizeImportedSequence(coords);
    if (sequence.length < 2) {
      return sequence;
    }

    const totalDistanceKm = this.estimateSequenceDistanceKm(sequence);
    const maxWaypoints = Number.isInteger(options.maxWaypoints) && options.maxWaypoints >= 2
      ? options.maxWaypoints
      : 60;
    const desiredSpacing = maxWaypoints > 1 && totalDistanceKm > 0
      ? (totalDistanceKm * 1000) / (maxWaypoints - 1)
      : 0;
    const minSpacingMeters = Math.max(120, Math.min(800, desiredSpacing || 250));
    const angleThreshold = Number.isFinite(options.angleThresholdDegrees)
      ? options.angleThresholdDegrees
      : 28;

    const waypoints = [];
    const pushWaypoint = (coord) => {
      if (!Array.isArray(coord) || coord.length < 2) {
        return;
      }
      const waypoint = coord.length > 2
        ? [coord[0], coord[1], coord[2]]
        : [coord[0], coord[1]];
      if (waypoints.length && this.coordinatesMatch(waypoints[waypoints.length - 1], waypoint)) {
        return;
      }
      waypoints.push(waypoint);
    };

    pushWaypoint(sequence[0]);
    let lastIndex = 0;
    let accumulatedDistance = 0;

    for (let index = 1; index < sequence.length - 1; index += 1) {
      const current = sequence[index];
      const previous = sequence[lastIndex];
      const next = sequence[index + 1];
      const segmentDistance = this.computeCoordinateDistanceMeters(previous, current)
        || haversineDistanceMeters(previous, current)
        || 0;
      accumulatedDistance += segmentDistance;

      let include = accumulatedDistance >= minSpacingMeters;

      if (!include && previous && next) {
        const bearingPrev = bearingBetween(previous, current);
        const bearingNext = bearingBetween(current, next);
        if (Number.isFinite(bearingPrev) && Number.isFinite(bearingNext)) {
          let delta = Math.abs(bearingNext - bearingPrev);
          if (delta > 180) {
            delta = 360 - delta;
          }
          if (delta >= angleThreshold) {
            include = true;
          }
        }
      }

      if (!include && previous && next) {
        const nextDistance = this.computeCoordinateDistanceMeters(current, next)
          || haversineDistanceMeters(current, next)
          || 0;
        if (nextDistance >= minSpacingMeters * 1.5) {
          include = true;
        }
      }

      if (include) {
        pushWaypoint(current);
        lastIndex = index;
        accumulatedDistance = 0;
      }
    }

    pushWaypoint(sequence[sequence.length - 1]);

    if (waypoints.length > maxWaypoints) {
      const step = (waypoints.length - 1) / (maxWaypoints - 1);
      const reduced = [];
      for (let i = 0; i < maxWaypoints; i += 1) {
        const targetIndex = Math.min(waypoints.length - 1, Math.round(i * step));
        const coord = waypoints[targetIndex];
        if (!reduced.length || !this.coordinatesMatch(reduced[reduced.length - 1], coord)) {
          reduced.push(coord.slice());
        }
      }
      if (!this.coordinatesMatch(reduced[reduced.length - 1], waypoints[waypoints.length - 1])) {
        reduced.push(waypoints[waypoints.length - 1].slice());
      }
      return reduced;
    }

    return waypoints;
  }


  extractRouteFromGeojson(geojson) {
    if (!geojson) {
      return null;
    }

    // New logic: First attempt to detect a partitioned route (multiple segments)
    // that should be joined together.
    const segments = [];
    const points = [];

    const collectFeatures = (geometry, properties = {}) => {
      if (!geometry) return;
      if (geometry.type === 'LineString') {
        segments.push({
          coordinates: geometry.coordinates,
          properties,
          segmentIndex: properties.segmentIndex ?? -1
        });
      } else if (geometry.type === 'MultiLineString') {
        // Treat MultiLineString as a single coherent segment if possible, 
        // or split if needed. For now, pushing as one segment usually works 
        // for basic GPX, but if we exported segments, they are usually separate features.
        // We'll flatten it.
        this.mergeImportedCoordinateSegments(geometry.coordinates).forEach(chain => {
          segments.push({
            coordinates: chain,
            properties,
            segmentIndex: properties.segmentIndex ?? -1
          });
        });
      } else if (geometry.type === 'Point') {
        points.push({
          coordinates: geometry.coordinates,
          properties
        });
      } else if (geometry.type === 'GeometryCollection' && Array.isArray(geometry.geometries)) {
        geometry.geometries.forEach(g => collectFeatures(g, properties));
      }
    };

    if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
      geojson.features.forEach(f => collectFeatures(f.geometry, f.properties || {}));
    } else if (geojson.type === 'Feature') {
      collectFeatures(geojson.geometry, geojson.properties || {});
    } else {
      collectFeatures(geojson, {});
    }

    if (segments.length === 0) return null;

    // Check if we have multiple segments that look like a split route
    // If we have explicit segmentIndices, use them.
    const hasIndices = segments.some(s => s.segmentIndex !== -1);

    let mergedCoordinates = [];
    let primaryProperties = {};

    if (hasIndices) {
      // Sort by index
      segments.sort((a, b) => {
        const idxA = a.segmentIndex !== -1 ? a.segmentIndex : 9999;
        const idxB = b.segmentIndex !== -1 ? b.segmentIndex : 9999;
        return idxA - idxB;
      });

      let segmentModes = [];
      let coordinateMetadata = [];
      let segmentColors = [];
      let totalMergedDist = 0;

      const autoCuts = [];
      segments.forEach((seg, i) => {
        const segmentDist = this.estimateSequenceDistanceKm(seg.coordinates);

        if (i > 0) {
          const prevSeg = segments[i - 1];
          const prevLast = prevSeg.coordinates[prevSeg.coordinates.length - 1];
          const currFirst = seg.coordinates[0];
          if (prevLast && currFirst && this.computeDistanceKm(prevLast, currFirst) < 0.1) {
            autoCuts.push({
              distanceKm: totalMergedDist,
              lng: prevLast[0],
              lat: prevLast[1]
            });
          }
        }

        this.appendCoordinates(mergedCoordinates, seg.coordinates);
        totalMergedDist += segmentDist;

        if (Array.isArray(seg.properties?.segment_modes)) {
          segmentModes = [...segmentModes, ...seg.properties.segment_modes];
        }
        if (Array.isArray(seg.properties?.coordinate_metadata)) {
          coordinateMetadata = [...coordinateMetadata, ...seg.properties.coordinate_metadata];
        }
        segmentColors.push(seg.properties?.color || null);
      });

      // Inject automatic bivouacs if no explicit ones were found at those locations
      autoCuts.forEach((cut, i) => {
        const isDuplicate = points.some(p => p.properties?.marker_type === 'bivouac' && this.computeDistanceKm(p.coordinates, [cut.lng, cut.lat]) < 0.05);
        if (!isDuplicate) {
          points.push({
            coordinates: [cut.lng, cut.lat],
            properties: { marker_type: 'bivouac', source: 'auto-split', segmentIndex: i + 1 }
          });
        }
      });

      primaryProperties = {
        ...segments[0].properties,
        segment_modes: segmentModes,
        coordinate_metadata: coordinateMetadata,
        segment_colors: segmentColors
      };

    } else if (segments.length > 1) {
      // No indices, but multiple segments. 
      // Heuristic: if they are geographically continuous, merge them.
      // Otherwise, fallback to "Best Candidate" approach (existing behavior) 
      // OR just merge everything in order (dangerous if random order).

      // For now, let's look for the single longest continuous chain we can build, 
      // or just default to the longest individual segment if they are disjoint.

      // Simple approach for XploreMap exported routes (which usually have segmentIndex anyway):
      // If no indices, we default to the legacy logic of picking the "best" one,
      // UNLESS they form a chain.
      // But for "Direct Save" routes, we KNOW we write segmentIndex.
      // So legacy GPX files are the main concern here.

      // Let's use the legacy logic for "best candidate" if no explicit structure is found,
      // to avoid breaking random GPX imports that contain noise.

      const candidates = segments.map(s => {
        const seq = this.normalizeImportedSequence(s.coordinates);
        return {
          coordinates: seq,
          properties: s.properties,
          distanceKm: this.estimateSequenceDistanceKm(seq),
          priority: s.properties.source === 'track' ? 3 : (s.properties.source === 'route' ? 2 : 1)
        };
      });

      candidates.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        if (b.distanceKm !== a.distanceKm) return b.distanceKm - a.distanceKm;
        return b.coordinates.length - a.coordinates.length;
      });

      // However, if the user explicitly Selected multiple files in the Library, 
      // they are treated as separate routes. Here we are inside ONE geojson.
      // If a single GPX contains multiple tracks, they typically want them all.
      // But `importRouteFromGeojson` is designed to load A SINGLE route context.
      // So we MUST merge them or pick one.
      // Heuristic: if they are geographically continuous, merge them.
      // And if they were separate tracks, they might represent days!
      mergedCoordinates = candidates[0].coordinates.slice();
      let totalMergedDist = candidates[0].distanceKm;
      const autoCuts = [];

      let segmentModes = candidates[0].properties.segment_modes || [];
      let coordinateMetadata = candidates[0].properties.coordinate_metadata || [];
      let segmentColors = [candidates[0].properties.color || null];

      for (let i = 1; i < candidates.length; i++) {
        const prev = mergedCoordinates[mergedCoordinates.length - 1];
        const curr = candidates[i].coordinates;
        if (!prev || !curr.length) continue;

        const distToPrev = this.computeDistanceKm(prev, curr[0]);
        if (distToPrev < 0.1) { // within 100m
          autoCuts.push({
            distanceKm: totalMergedDist,
            lng: prev[0],
            lat: prev[1]
          });
          this.appendCoordinates(mergedCoordinates, curr);
          totalMergedDist += candidates[i].distanceKm;

          // Concatenate metadata/modes if matching the segment structure
          if (Array.isArray(candidates[i].properties.segment_modes)) {
            segmentModes = [...segmentModes, ...candidates[i].properties.segment_modes];
          }
          if (Array.isArray(candidates[i].properties.coordinate_metadata)) {
            coordinateMetadata = [...coordinateMetadata, ...candidates[i].properties.coordinate_metadata];
          }
          segmentColors.push(candidates[i].properties.color || null);
        } else {
          // Not continuous, we stop merging
          break;
        }
      }

      primaryProperties = {
        ...candidates[0].properties,
        segment_modes: segmentModes,
        coordinate_metadata: coordinateMetadata,
        segment_colors: segmentColors
      };

      // If we detected automatic cuts (from separate tracks) and no explicit bivouacs were found,
      // we add them to the points array so importRouteFromGeojson can restore segments.
      // Filter out duplicates if they are extremely close.
      autoCuts.forEach((cut, i) => {
        const isDuplicate = points.some(p => p.properties?.marker_type === 'bivouac' && this.computeDistanceKm(p.geometry.coordinates, [cut.lng, cut.lat]) < 0.05);
        if (!isDuplicate) {
          points.push({
            geometry: { type: 'Point', coordinates: [cut.lng, cut.lat] },
            properties: { marker_type: 'bivouac', source: 'auto-split', segmentIndex: i + 1 }
          });
        }
      });
    } else {
      // Single segment
      mergedCoordinates = this.normalizeImportedSequence(segments[0].coordinates);
      primaryProperties = segments[0].properties;
    }

    return {
      coordinates: mergedCoordinates,
      properties: primaryProperties,
      distanceKm: this.estimateSequenceDistanceKm(mergedCoordinates),
      points: points // extract potential checkpoints/bivouacs
    };
  }


  appendCoordinates(target, source) {
    if (!source || source.length === 0) return;
    if (target.length === 0) {
      source.forEach(c => target.push(c));
      return;
    }

    const last = target[target.length - 1];
    const first = source[0];

    // If identically same coordinates (floating point tol), skip first
    // Using a slightly wider tolerance (1e-5 ~ 1 meter) to handle GPX rounding/jitter at junctions
    const isSame = Math.abs(last[0] - first[0]) < 1e-5 && Math.abs(last[1] - first[1]) < 1e-5;

    for (let i = (isSame ? 1 : 0); i < source.length; i++) {
      target.push(source[i]);
    }
  }


  importRouteFromGeojson(geojson, options = {}) {
    const candidate = this.extractRouteFromGeojson(geojson);
    if (!candidate || !Array.isArray(candidate.coordinates) || candidate.coordinates.length < 2) {
      console.warn('No route geometry found in imported data');
      return false;
    }

    this.currentRouteId = options.id || null;

    let waypoints = [];
    const explicitWaypoints = (candidate.points || [])
      .filter(p => p.properties?.source === 'waypoint')
      .map(p => p.coordinates);

    if (explicitWaypoints.length >= 2) {
      waypoints = explicitWaypoints;
    } else {
      waypoints = this.deriveWaypointsFromImportedSequence(candidate.coordinates, options);
    }
    if (!Array.isArray(waypoints) || waypoints.length < 2) {
      console.warn('Imported route did not contain enough distinct coordinates');
      return false;
    }

    this.clearDirections();
    this.ensurePanelVisible();
    this.waypoints = waypoints.map((coord) => coord.slice());

    // 1. Prepare Bivouacs/Cuts BEFORE applying the route
    // This allows applyRoute to preserve and project them onto the new geometry correctly
    if (candidate.points && candidate.points.length > 0) {
      const bivouacs = candidate.points.filter(p => p.properties && p.properties.marker_type === 'bivouac');
      if (bivouacs.length > 0) {
        const cuts = [];
        const line = turfApi.lineString(candidate.coordinates);

        bivouacs.forEach(b => {
          const pt = turfApi.point(b.coordinates);
          const snapped = turfApi.nearestPointOnLine(line, pt, { units: 'kilometers' });
          let distKm = snapped?.properties?.location;

          // Robust fallback if turf snapping doesn't provide a location
          if (!Number.isFinite(distKm)) {
            const idx = candidate.coordinates.findIndex(c => this.coordinatesMatch(c, b.coordinates));
            if (idx !== -1) {
              distKm = this.estimateSequenceDistanceKm(candidate.coordinates.slice(0, idx + 1));
            }
          }

          if (Number.isFinite(distKm)) {
            cuts.push({
              distanceKm: distKm,
              lng: b.coordinates[0],
              lat: b.coordinates[1],
              source: 'imported-bivouac'
            });
          }
        });

        if (cuts.length > 0) {
          this.setRouteCutDistances(cuts);
        }
      }
    }

    const routeFeature = {
      type: 'Feature',
      properties: {
        ...(candidate.properties || {}),
        source: candidate.properties?.source || 'imported-route',
        name: candidate.properties?.name || options.name || null
      },
      geometry: {
        type: 'LineString',
        coordinates: candidate.coordinates.map((coord) => coord.slice())
      }
    };

    // 2. Apply the route - this now sees the restored cuts and projects them
    this.applyRoute(routeFeature);

    // updateWaypoints triggers updateSegmentMarkers
    this.updateWaypoints();
    this.updateModeAvailability();

    this.prepareNetwork({ reason: 'imported-route' }).catch(() => { });
    return true;
  }

}
