import { escapeHtml } from '../utils/directions-utils.js';

import { SEGMENT_MARKER_LAYER_ID } from '../constants/directions-visual-constants.js';


export class DirectionsManagerBivouacMixin {
  onBivouacClick(event) {
    // Cancel any pending start/end drag - a click means we released before drag activated
    if (this._startEndDragTimeout) {
      clearTimeout(this._startEndDragTimeout);
      this._startEndDragTimeout = null;
    }

    // Handle click on start marker to create a loop
    if (this._pendingStartEndDrag && !this.isDragging) {
      const pendingInfo = this._pendingStartEndDrag;
      this._pendingStartEndDrag = null;

      // Click on start marker creates a loop (adds start point as destination)
      if (pendingInfo.type === 'start' && this.waypoints.length >= 2) {
        const startCoords = this.waypoints[0];
        if (Array.isArray(startCoords) && startCoords.length >= 2) {
          this.recordWaypointState();
          // Add the start point coordinates as the new destination
          const loopWaypoint = this.buildWaypointCoordinate([startCoords[0], startCoords[1]]) ?? [startCoords[0], startCoords[1]];
          this.waypoints.push(loopWaypoint);
          this.updateWaypoints();
          this.getRoute();
          return;
        }
      }
      // Click on end marker doesn't do anything special (could be extended later)
      return;
    }
    this._pendingStartEndDrag = null;

    // Cancel any pending bivouac drag - a click means we released before long press activated
    if (this._bivouacDragTimeout) {
      clearTimeout(this._bivouacDragTimeout);
      this._bivouacDragTimeout = null;
    }
    this._pendingBivouacDrag = null;

    // Only show popup if not dragging
    if (this.isDragging) return;

    // Close any existing bivouac popup first
    if (this.bivouacPopup) {
      this.bivouacPopup.remove();
      this.bivouacPopup = null;
    }

    const feature = event.features?.[0];
    const type = feature?.properties?.type;
    if (type !== 'bivouac') return;

    const order = Number(feature.properties?.order);
    const cutIndex = Number.isFinite(order) ? order - 1 : null;
    if (!Number.isInteger(cutIndex) || cutIndex < 0) return;

    // Get bivouac location
    const coordinates = feature.geometry?.coordinates?.slice?.();
    if (!Array.isArray(coordinates) || coordinates.length < 2) return;

    // If popup already open at same location, toggle it off
    if (this.bivouacPopup && this.bivouacPopup.isOpen?.()) {
      this.bivouacPopup.remove();
      return;
    }

    // Get associated cut segment info
    const segment = this.cutSegments?.[cutIndex];

    // Calculate bivouac details
    const distanceKm = segment?.endKm ?? segment?.endDistanceKm ?? 0;
    const elevation = this.getElevationAtDistance(distanceKm);
    const slope = this.computeGradeAtDistance(distanceKm);

    // Get day segment metrics
    const dayNumber = cutIndex + 1;
    const dayMetrics = segment ? this.computeCumulativeMetrics(
      segment.endKm ?? segment.endDistanceKm ?? 0,
      segment.startKm ?? segment.startDistanceKm ?? 0
    ) : null;
    const dayDistanceKm = dayMetrics?.distanceKm ?? 0;
    const dayAscent = Math.round(dayMetrics?.ascent ?? 0);
    const dayDescent = Math.round(dayMetrics?.descent ?? 0);
    const dayTime = this.estimateTravelTimeHours(dayDistanceKm, dayAscent, dayDescent);

    // Get bivouac marker name
    const markers = this.computeSegmentMarkers();
    const bivouacMarker = markers.find(m => m.type === 'bivouac' && m.order === order);
    const bivouacName = bivouacMarker?.name ?? bivouacMarker?.title ?? `Bivouac ${cutIndex + 1}`;

    // Get day color for this segment
    const dayColor = this.getSegmentColor(dayNumber);

    // Build popup content
    const elevationLabel = Number.isFinite(elevation) ? `${Math.round(elevation)} m` : '—';

    // Calculate sunrise/sunset times for this location
    const [lng, lat] = coordinates;
    const sunTimes = this.calculateSunTimes(lat, lng);
    const sunriseLabel = sunTimes?.sunrise ?? '—';
    const sunsetLabel = sunTimes?.sunset ?? '—';

    // Find nearest water sources (up to 2 different types)
    const waterSources = this.findNearestWaterSources(coordinates, 2);
    const formatWaterDistance = (d) => d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`;

    // Build water options HTML
    let waterOptionsHtml = '';
    if (waterSources.length === 0) {
      waterOptionsHtml = '<span class="bivouac-popup__stat-value">—</span>';
    } else {
      waterOptionsHtml = waterSources.map((source, i) => {
        const distLabel = formatWaterDistance(source.distance);
        return `<span class="bivouac-popup__water-option">${source.type}: ${distLabel}</span>`;
      }).join('');
    }

    const popupHtml = `
      <div class="bivouac-popup" style="--day-color: ${dayColor}">
        <div class="bivouac-popup__header">
          <span class="bivouac-popup__title">${escapeHtml(bivouacName)}</span>
          <button class="bivouac-popup__delete" data-bivouac-index="${cutIndex}" title="Supprimer le bivouac" aria-label="Supprimer le bivouac">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          </button>
        </div>
        <div class="bivouac-popup__stats">
          <div class="bivouac-popup__stat">
            <span class="bivouac-popup__stat-label">Jour ${dayNumber} - Résumé</span>
            <span class="bivouac-popup__stat-value">${this.formatDistance(dayDistanceKm)} km · +${dayAscent}m · ${this.formatDurationHours(dayTime)}</span>
          </div>
          <div class="bivouac-popup__stat">
            <span class="bivouac-popup__stat-label">Altitude</span>
            <span class="bivouac-popup__stat-value">${elevationLabel}</span>
          </div>
          <div class="bivouac-popup__stat bivouac-popup__stat--sun">
            <span class="bivouac-popup__stat-label">
              <svg class="bivouac-popup__stat-icon" viewBox="0 0 24 24"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0 .39-.39.39-1.03 0-1.41l-1.06-1.06zm1.06-10.96c-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0 .39-.39.39-1.03 0-1.41l-1.06-1.06c-.39-.39-1.03-.39-1.41 0zM7.05 18.36c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z"/></svg>
              Lever / Coucher
            </span>
            <span class="bivouac-popup__stat-value">${sunriseLabel} / ${sunsetLabel}</span>
          </div>
          <div class="bivouac-popup__stat bivouac-popup__stat--water">
            <span class="bivouac-popup__stat-label">
              <svg class="bivouac-popup__stat-icon" viewBox="0 0 24 24"><path d="M12 2c-5.33 4.55-8 8.48-8 11.8 0 4.98 3.8 8.2 8 8.2s8-3.22 8-8.2c0-3.32-2.67-7.25-8-11.8zm0 18c-3.35 0-6-2.57-6-6.2 0-2.34 1.95-5.44 6-9.14 4.05 3.7 6 6.79 6 9.14 0 3.63-2.65 6.2-6 6.2z"/></svg>
              Eau à proximité
            </span>
            <div class="bivouac-popup__water-options">${waterOptionsHtml}</div>
          </div>
          <div class="bivouac-popup__stat bivouac-popup__stat--weather">
            <span class="bivouac-popup__stat-label">
              <svg class="bivouac-popup__stat-icon" viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/></svg>
              Météo J+${dayNumber - 1}
            </span>
            <span class="bivouac-popup__stat-value weather-container" data-bivouac-day="${dayNumber}" data-lon="${lng}" data-lat="${lat}">
              <span class="weather-loading">Chargement...</span>
            </span>
          </div>
        </div>
      </div>
    `;

    // Create popup with close button for click-to-dismiss
    if (this.bivouacPopup) {
      this.bivouacPopup.remove();
    }

    this.bivouacPopup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: true,
      className: 'bivouac-popup-container',
      offset: [0, -16],
      maxWidth: '280px'
    });

    this.bivouacPopup
      .setLngLat(coordinates)
      .setHTML(popupHtml)
      .addTo(this.map);

    // Fetch and update weather for this bivouac location
    this.updateBivouacWeather(lng, lat, dayNumber);

    // Add click handler for delete button
    const popupEl = this.bivouacPopup.getElement();
    const deleteBtn = popupEl?.querySelector('.bivouac-popup__delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = Number(deleteBtn.dataset.bivouacIndex);
        if (Number.isInteger(index) && index >= 0) {
          this.removeBivouacCut(index);
          this.bivouacPopup?.remove();
        }
      });
    }

    // Stop event propagation to prevent map click from adding waypoint
    if (event.originalEvent) {
      event.originalEvent.stopPropagation();
      event.originalEvent.preventDefault();
    }
    // Mark this click as handled so map click handler knows to ignore it
    this._bivouacClickHandled = true;
    setTimeout(() => { this._bivouacClickHandled = false; }, 50);
  }


  /**
   * Calculate sunrise and sunset times for a given location.
   * Uses a simplified astronomical calculation.
   * @param {number} lat - Latitude in degrees
   * @param {number} lng - Longitude in degrees
   * @param {Date} date - Optional date (defaults to today)
   * @returns {{ sunrise: string, sunset: string } | null}
   */
  calculateSunTimes(lat, lng, date = new Date()) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }

    try {
      const toRad = (deg) => deg * Math.PI / 180;
      const toDeg = (rad) => rad * 180 / Math.PI;

      // Day of year
      const start = new Date(date.getFullYear(), 0, 0);
      const diff = date - start;
      const oneDay = 1000 * 60 * 60 * 24;
      const dayOfYear = Math.floor(diff / oneDay);

      // Solar declination
      const declination = -23.45 * Math.cos(toRad(360 / 365 * (dayOfYear + 10)));

      // Hour angle
      const latRad = toRad(lat);
      const declRad = toRad(declination);
      const cosHourAngle = -Math.tan(latRad) * Math.tan(declRad);

      // Check for polar day/night
      if (cosHourAngle < -1 || cosHourAngle > 1) {
        return { sunrise: 'N/A', sunset: 'N/A' };
      }

      const hourAngle = toDeg(Math.acos(cosHourAngle));

      // Time correction for longitude (4 minutes per degree from 15° multiples)
      const timezone = Math.round(lng / 15);
      const timeCorrection = (lng - timezone * 15) * 4; // minutes

      // Equation of time approximation
      const B = toRad(360 / 365 * (dayOfYear - 81));
      const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);

      // Solar noon in minutes from midnight
      const solarNoon = 720 - timeCorrection - eot;

      // Sunrise and sunset in minutes
      const sunriseMinutes = solarNoon - hourAngle * 4;
      const sunsetMinutes = solarNoon + hourAngle * 4;

      const formatTime = (minutes) => {
        const h = Math.floor(minutes / 60) % 24;
        const m = Math.round(minutes % 60);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      };

      return {
        sunrise: formatTime(sunriseMinutes),
        sunset: formatTime(sunsetMinutes)
      };
    } catch (error) {
      console.warn('Failed to calculate sun times', error);
      return null;
    }
  }


  /**
   * Find the nearest water sources from a given coordinate.
   * Searches map features for water bodies and POIs (fountains, springs, etc.)
   * @param {number[]} coordinates - [lng, lat] coordinates
   * @param {number} maxResults - Maximum number of results to return (default 2)
   * @returns {Array<{ distance: number, type: string }>}
   */
  findNearestWaterSources(coordinates, maxResults = 2) {
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      return [];
    }

    const [lng, lat] = coordinates;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return [];
    }

    try {
      // Water layer definitions with human-readable type labels
      const waterLayerConfig = [
        { id: 'Water', type: 'Lake' },
        { id: 'Water intermittent', type: 'Seasonal lake' },
        { id: 'River', type: 'River' },
        { id: 'River intermittent', type: 'Seasonal river' },
        { id: 'Other waterway', type: 'Stream' },
        { id: 'Other waterway intermittent', type: 'Seasonal stream' },
        { id: 'Glacier', type: 'Glacier' }
      ];

      // POI classes that indicate water sources
      const waterPoiClasses = new Set([
        'drinking_water', 'fountain', 'water_well', 'spring',
        'waterfall', 'watering_place'
      ]);

      // Human-readable type from POI subclass
      const poiTypeMap = {
        'drinking_water': 'Drinking water',
        'fountain': 'Fountain',
        'water_well': 'Well',
        'spring': 'Spring',
        'waterfall': 'Waterfall',
        'watering_place': 'Watering place'
      };

      // Use a fixed geographic radius (in km) instead of pixels
      // This ensures consistent results regardless of zoom level
      const SEARCH_RADIUS_KM = 5; // 5km search radius

      // Convert km to approximate degrees (at this latitude)
      // 1 degree latitude ≈ 111 km
      // 1 degree longitude ≈ 111 * cos(lat) km
      const latRadiusDeg = SEARCH_RADIUS_KM / 111;
      const lngRadiusDeg = SEARCH_RADIUS_KM / (111 * Math.cos(lat * Math.PI / 180));

      // Calculate geographic bounding box
      const minLng = lng - lngRadiusDeg;
      const maxLng = lng + lngRadiusDeg;
      const minLat = lat - latRadiusDeg;
      const maxLat = lat + latRadiusDeg;

      // Convert to screen coordinates for queryRenderedFeatures
      const sw = this.map.project([minLng, minLat]);
      const ne = this.map.project([maxLng, maxLat]);

      const bbox = [
        [Math.min(sw.x, ne.x), Math.min(sw.y, ne.y)],
        [Math.max(sw.x, ne.x), Math.max(sw.y, ne.y)]
      ];

      // Collect all water sources with distances
      const waterSources = [];
      const seenTypes = new Set();


      // Helper to calculate distance to geometry
      const calcGeometryDistance = (geometry) => {
        let distance = Infinity;

        if (geometry.type === 'Point') {
          const [fLng, fLat] = geometry.coordinates;
          distance = this.haversineDistance(lat, lng, fLat, fLng);
        } else if (geometry.type === 'LineString') {
          for (const coord of geometry.coordinates) {
            const d = this.haversineDistance(lat, lng, coord[1], coord[0]);
            if (d < distance) distance = d;
          }
        } else if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
          const rings = geometry.type === 'Polygon'
            ? [geometry.coordinates[0]]
            : geometry.coordinates.map(p => p[0]);
          for (const ring of rings) {
            for (const coord of ring) {
              const d = this.haversineDistance(lat, lng, coord[1], coord[0]);
              if (d < distance) distance = d;
            }
          }
        }

        return distance;
      };

      // Query water body layers
      for (const { id, type } of waterLayerConfig) {
        if (!this.map.getLayer(id)) continue;

        const features = this.map.queryRenderedFeatures(bbox, { layers: [id] });

        for (const feature of features) {
          const geometry = feature.geometry;
          if (!geometry) continue;

          const distance = calcGeometryDistance(geometry);
          if (distance !== Infinity) {
            waterSources.push({ distance, type });
          }
        }
      }

      // Query POI layer for water-related points (fountains, springs, etc.)
      const poiLayers = ['poi', 'POI', 'poi_z16', 'poi_z15', 'poi_z14'];
      for (const layerId of poiLayers) {
        if (!this.map.getLayer(layerId)) continue;

        const features = this.map.queryRenderedFeatures(bbox, { layers: [layerId] });

        for (const feature of features) {
          const props = feature.properties || {};
          const subclass = props.subclass || props.class || '';

          if (!waterPoiClasses.has(subclass)) continue;

          const geometry = feature.geometry;
          if (!geometry) continue;

          const distance = calcGeometryDistance(geometry);
          if (distance !== Infinity) {
            const type = poiTypeMap[subclass] || subclass;
            waterSources.push({ distance, type });
          }
        }
      }

      // Sort by distance and return unique types (prefer closest of each type)
      waterSources.sort((a, b) => a.distance - b.distance);

      const results = [];
      for (const source of waterSources) {
        // Skip if we already have this type (keep only closest of each type)
        if (seenTypes.has(source.type)) continue;

        seenTypes.add(source.type);
        results.push(source);

        if (results.length >= maxResults) break;
      }

      return results;
    } catch (error) {
      console.warn('Failed to find nearest water', error);
      return [];
    }
  }


  /**
   * Calculate haversine distance between two points in km
   */
  haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }


  onBivouacMouseEnter(event) {
    const feature = event.features?.[0];
    const type = feature?.properties?.type;
    const order = feature?.properties?.order;

    // Handle all segment marker types (start, end, bivouac)
    if (!type || !['start', 'end', 'bivouac'].includes(type)) return;

    // Change cursor to grab for draggable markers
    this.map.getCanvas().style.cursor = 'grab';

    // Store hovered marker info for the expression
    this._hoveredMarkerType = type;
    this._hoveredMarkerOrder = order;

    // Scale up ONLY the specific hovered marker, not all markers of same type
    if (this.map.getLayer(SEGMENT_MARKER_LAYER_ID)) {
      // Build icon-size expression that scales up only the specific hovered marker
      // We use a case expression to check both type AND order
      const buildSizeExpression = (hoverSize, normalBivouac, normalOther) => {
        return [
          'case',
          // Check if this is the exact marker being hovered (matching both type and order)
          ['all',
            ['==', ['get', 'type'], type],
            ['==', ['get', 'order'], order ?? 0]
          ],
          hoverSize,
          // Otherwise, use normal sizes based on type
          ['match', ['get', 'type'],
            'bivouac', normalBivouac,
            normalOther
          ]
        ];
      };

      this.map.setLayoutProperty(SEGMENT_MARKER_LAYER_ID, 'icon-size', [
        'interpolate',
        ['linear'],
        ['zoom'],
        8, buildSizeExpression(0.7, 0.4, 0.55),
        12, buildSizeExpression(1.0, 0.6, 0.75),
        16, buildSizeExpression(1.25, 0.8, 0.95)
      ]);
    }
  }


  onBivouacMouseLeave(event) {
    // Restore cursor
    this.map.getCanvas().style.cursor = '';

    this._hoveredMarkerType = null;
    this._hoveredMarkerOrder = null;

    // Restore original icon size
    if (this.map.getLayer(SEGMENT_MARKER_LAYER_ID)) {
      this.map.setLayoutProperty(SEGMENT_MARKER_LAYER_ID, 'icon-size', [
        'interpolate',
        ['linear'],
        ['zoom'],
        8,
        ['match', ['get', 'type'], 'bivouac', 0.4, 0.55],
        12,
        ['match', ['get', 'type'], 'bivouac', 0.6, 0.75],
        16,
        ['match', ['get', 'type'], 'bivouac', 0.8, 0.95]
      ]);
    }
  }

}
