import {
  COORD_EPSILON,
  WAYPOINT_MATCH_TOLERANCE_METERS,
  ROUTE_CUT_EPSILON_KM,
  turfApi
} from '../constants/directions-constants.js';


export class DirectionsManagerRouteLogMixin {

  snapshotWaypoints() {
    if (!Array.isArray(this.waypoints)) {
      return [];
    }
    return this.waypoints.map((coord) => (Array.isArray(coord) ? coord.slice() : coord));
  }


  normalizeWaypointForLog(coord) {
    if (!Array.isArray(coord) || coord.length < 2) {
      return null;
    }
    const lng = Number(coord[0]);
    const lat = Number(coord[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return null;
    }
    const roundedLng = Math.round(lng * 1e6) / 1e6;
    const roundedLat = Math.round(lat * 1e6) / 1e6;
    return {
      raw: [lng, lat],
      rounded: [roundedLng, roundedLat],
      string: `[${roundedLng.toFixed(6)}, ${roundedLat.toFixed(6)}]`
    };
  }


  collectViaWaypointEntries(list) {
    const result = new Map();
    if (!Array.isArray(list) || list.length < 3) {
      return result;
    }
    for (let index = 1; index < list.length - 1; index += 1) {
      const normalized = this.normalizeWaypointForLog(list[index]);
      if (normalized) {
        result.set(index, { ...normalized, index });
      }
    }
    return result;
  }


  buildWaypointLogSummary(list) {
    if (!Array.isArray(list) || !list.length) {
      return [];
    }

    const total = list.length;
    let viaOrder = 0;
    const roundPixel = (value) => (Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null);

    return list
      .map((coord, index) => {
        const normalized = this.normalizeWaypointForLog(coord);
        if (!normalized) {
          return null;
        }

        const [rawLng, rawLat] = normalized.raw;
        let role = 'via';
        let label = '';
        let id = '';
        let order = 0;

        if (index === 0) {
          role = 'start';
          label = 'Départ';
          id = 'start';
        } else if (index === total - 1) {
          role = 'end';
          label = 'Arrivée';
          id = 'end';
        } else {
          viaOrder += 1;
          role = 'via';
          order = viaOrder;
          label = `Via ${viaOrder}`;
          id = `via-${viaOrder}`;
        }

        const projected =
          this.map && typeof this.map.project === 'function'
            ? this.map.project(new maplibregl.LngLat(rawLng, rawLat))
            : null;

        return {
          index,
          role,
          id,
          label,
          order,
          lng: normalized.rounded[0],
          lat: normalized.rounded[1],
          rawLng,
          rawLat,
          x: roundPixel(projected?.x),
          y: roundPixel(projected?.y)
        };
      })
      .filter(Boolean);
  }


  buildWaypointListEntries(summary = []) {
    if (!Array.isArray(summary) || !summary.length) {
      return [];
    }

    return summary
      .map((item, index) => {
        if (!item) {
          return null;
        }

        const waypointNumber = index + 1;
        const rawLng = Number(item.rawLng);
        const rawLat = Number(item.rawLat);
        const hasValidCoordinates = Number.isFinite(rawLng) && Number.isFinite(rawLat);
        const coordinateText = hasValidCoordinates
          ? `[${rawLng.toFixed(6)}, ${rawLat.toFixed(6)}]`
          : null;
        const roleLabel = typeof item.label === 'string' && item.label.length ? item.label : item.role;
        const descriptionBase = `Waypoint ${waypointNumber}`;
        const descriptionRole = roleLabel ? ` (${roleLabel})` : '';
        const description = hasValidCoordinates
          ? `${descriptionBase}${descriptionRole}: ${coordinateText}`
          : `${descriptionBase}${descriptionRole}`;

        return {
          waypoint: `Waypoint ${waypointNumber}`,
          index: item.index,
          role: item.role,
          label: roleLabel,
          coordinates: hasValidCoordinates ? [rawLng, rawLat] : null,
          coordinatesText: coordinateText,
          description
        };
      })
      .filter(Boolean);
  }


  haveWaypointSummariesChanged(previous = [], next = []) {
    if (!Array.isArray(previous) || !Array.isArray(next)) {
      return true;
    }

    if (previous.length !== next.length) {
      return true;
    }

    for (let index = 0; index < previous.length; index += 1) {
      const prev = previous[index];
      const nextItem = next[index];
      if (!prev || !nextItem) {
        return true;
      }

      if (prev.id !== nextItem.id || prev.role !== nextItem.role) {
        return true;
      }

      const lngDelta = Math.abs((prev.rawLng ?? 0) - (nextItem.rawLng ?? 0));
      const latDelta = Math.abs((prev.rawLat ?? 0) - (nextItem.rawLat ?? 0));
      if (Number.isFinite(lngDelta) && Number.isFinite(latDelta)) {
        if (lngDelta > COORD_EPSILON || latDelta > COORD_EPSILON) {
          return true;
        }
      }
    }

    return false;
  }


  buildBivouacLogSummary(distances) {
    if (!Array.isArray(distances) || !distances.length) {
      return [];
    }

    if (!turfApi) {
      return [];
    }

    const geometry = this.routeGeojson?.geometry;
    const coordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates : null;
    if (!coordinates || coordinates.length < 2) {
      return [];
    }

    const totalDistance = Number(this.routeProfile?.totalDistanceKm);
    if (!Number.isFinite(totalDistance) || totalDistance <= ROUTE_CUT_EPSILON_KM) {
      return [];
    }

    const roundPixel = (value) => (Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null);

    return distances
      .map((value, index) => {
        const distanceKm = Number(value);
        if (!Number.isFinite(distanceKm)) {
          return null;
        }

        const clamped = Math.max(0, Math.min(distanceKm, totalDistance));
        let coords = null;

        try {
          const point = turfApi.along(geometry, clamped, { units: 'kilometers' });
          coords = Array.isArray(point?.geometry?.coordinates) ? point.geometry.coordinates : null;
        } catch (error) {
          console.warn('Failed to compute bivouac position', error);
          return null;
        }

        if (!coords || coords.length < 2) {
          return null;
        }

        const lng = Number(coords[0]);
        const lat = Number(coords[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
          return null;
        }

        const roundedLng = Math.round(lng * 1e6) / 1e6;
        const roundedLat = Math.round(lat * 1e6) / 1e6;
        const projected =
          this.map && typeof this.map.project === 'function'
            ? this.map.project(new maplibregl.LngLat(lng, lat))
            : null;

        return {
          order: index + 1,
          id: `bivouac-${index + 1}`,
          label: `Bivouac ${index + 1}`,
          distanceKm: Math.round(clamped * 1000) / 1000,
          originalDistanceKm: Math.round(distanceKm * 1000) / 1000,
          lng: roundedLng,
          lat: roundedLat,
          rawLng: lng,
          rawLat: lat,
          x: roundPixel(projected?.x),
          y: roundPixel(projected?.y)
        };
      })
      .filter(Boolean);
  }


  haveBivouacSummariesChanged(previous = [], next = []) {
    if (!Array.isArray(previous) || !Array.isArray(next)) {
      return true;
    }

    if (previous.length !== next.length) {
      return true;
    }

    for (let index = 0; index < previous.length; index += 1) {
      const prev = previous[index];
      const nextItem = next[index];
      if (!prev || !nextItem) {
        return true;
      }

      if (prev.id !== nextItem.id) {
        return true;
      }

      const lngDelta = Math.abs((prev.rawLng ?? 0) - (nextItem.rawLng ?? 0));
      const latDelta = Math.abs((prev.rawLat ?? 0) - (nextItem.rawLat ?? 0));
      if (Number.isFinite(lngDelta) && Number.isFinite(latDelta)) {
        if (lngDelta > COORD_EPSILON || latDelta > COORD_EPSILON) {
          return true;
        }
      }

      const distanceDelta = Math.abs((prev.distanceKm ?? 0) - (nextItem.distanceKm ?? 0));
      if (Number.isFinite(distanceDelta) && distanceDelta > ROUTE_CUT_EPSILON_KM / 10) {
        return true;
      }
    }

    return false;
  }


  areLoggedWaypointsEqual(previous, next) {
    if (!previous || !next) {
      return false;
    }

    const prevRaw = Array.isArray(previous.raw) ? previous.raw : null;
    const nextRaw = Array.isArray(next.raw) ? next.raw : null;
    if (prevRaw && nextRaw) {
      const lngDelta = Math.abs(prevRaw[0] - nextRaw[0]);
      const latDelta = Math.abs(prevRaw[1] - nextRaw[1]);
      if (Number.isFinite(lngDelta) && Number.isFinite(latDelta) && lngDelta <= COORD_EPSILON && latDelta <= COORD_EPSILON) {
        return true;
      }
    }

    if (Array.isArray(previous.rounded) && Array.isArray(next.rounded)) {
      if (previous.rounded[0] === next.rounded[0] && previous.rounded[1] === next.rounded[1]) {
        return true;
      }
    }

    if (typeof previous.string === 'string' && typeof next.string === 'string') {
      return previous.string === next.string;
    }

    return false;
  }


  computeWaypointDeltaMeters(previous, next) {
    if (!previous?.raw || !next?.raw || !turfApi) {
      return null;
    }

    try {
      const distance = turfApi.distance(
        turfApi.point(previous.raw),
        turfApi.point(next.raw),
        { units: 'meters' }
      );
      if (Number.isFinite(distance)) {
        return Math.round(distance * 100) / 100;
      }
    } catch (error) {
      console.warn('Failed to compute waypoint delta distance', error);
    }

    return null;
  }


  snapWaypointsToRoute() {
    if (!Array.isArray(this.waypoints) || this.waypoints.length < 2) {
      return false;
    }

    const normalizeCoord = (coord) => {
      if (!Array.isArray(coord) || coord.length < 2) {
        return null;
      }
      const lng = Number(coord[0]);
      const lat = Number(coord[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return null;
      }
      const elevation = coord.length > 2 && Number.isFinite(coord[2]) ? Number(coord[2]) : null;
      return Number.isFinite(elevation) ? [lng, lat, elevation] : [lng, lat];
    };

    const normalizedWaypoints = this.waypoints.map((coord) => normalizeCoord(coord) ?? coord);
    const routeCoords = Array.isArray(this.routeProfile?.coordinates)
      ? this.routeProfile.coordinates.filter((coord) => Array.isArray(coord) && coord.length >= 2)
      : [];

    const shouldSnapToRoute = this.currentMode !== 'manual' && routeCoords.length >= 2;
    const applyCoordinateUpdate = (coord, index) => {
      if (!Array.isArray(coord) || coord.length < 2) {
        return false;
      }
      const current = this.waypoints[index];
      const hasComparableCurrent = Array.isArray(current) && current.length >= 2;
      const lengthChanged = !Array.isArray(current) || current.length !== coord.length;
      const differs = hasComparableCurrent ? !this.coordinatesMatch(current, coord) : true;
      if (lengthChanged || differs) {
        this.waypoints[index] = coord.slice();
        return true;
      }
      return false;
    };

    let changed = false;

    if (shouldSnapToRoute) {
      const toleranceMeters = Math.max(75, WAYPOINT_MATCH_TOLERANCE_METERS || 0);
      const lastWaypointIndex = normalizedWaypoints.length - 1;
      let searchStartIndex = 0;

      normalizedWaypoints.forEach((waypoint, index) => {
        if (!Array.isArray(waypoint) || waypoint.length < 2) {
          return;
        }

        let targetCoord = null;
        if (index === 0) {
          targetCoord = routeCoords[0];
          searchStartIndex = 0;
        } else if (index === lastWaypointIndex) {
          targetCoord = routeCoords[routeCoords.length - 1];
        } else {
          let bestIndex = null;
          let bestDistance = Infinity;
          for (let routeIndex = searchStartIndex; routeIndex < routeCoords.length; routeIndex += 1) {
            const candidate = routeCoords[routeIndex];
            if (!Array.isArray(candidate) || candidate.length < 2) {
              continue;
            }
            const distance = this.computeCoordinateDistanceMeters(waypoint, candidate);
            if (!Number.isFinite(distance)) {
              continue;
            }
            if (distance < bestDistance) {
              bestDistance = distance;
              bestIndex = routeIndex;
            }
            if (distance <= toleranceMeters) {
              break;
            }
          }

          if (bestIndex !== null) {
            targetCoord = routeCoords[bestIndex];
            searchStartIndex = bestIndex;
          }
        }

        const normalizedTarget = normalizeCoord(targetCoord) ?? waypoint;
        if (applyCoordinateUpdate(normalizedTarget, index)) {
          changed = true;
        }
      });

      return changed;
    }

    normalizedWaypoints.forEach((coord, index) => {
      if (applyCoordinateUpdate(normalizeCoord(coord) ?? coord, index)) {
        changed = true;
      }
    });

    return changed;
  }

}
