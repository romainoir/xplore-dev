import {
  DEFAULT_POI_COLOR,
  DEFAULT_POI_TITLE,
  POI_SEARCH_RADIUS_METERS,
  POI_CATEGORY_DISTANCE_OVERRIDES,
  POI_MAX_SEARCH_RADIUS_METERS,
  turfApi,
  WATER_CATEGORY_SET,
  WATER_HOST_CATEGORY_SET,
  WATER_MERGE_PROXIMITY_KM
} from '../constants/directions-constants.js';

import {
  fetchMeteoFrance,
  getWeatherForDay,
  renderWeatherWidget,
  resolveRoutePoiIconKey,
  computePoiIconDisplayMetrics,
  clusterRoutePointsOfInterest,
  computePeakImportanceScore,
  markElevationProfileLabelLeaders,
  parsePoiElevation,
  resolvePoiDefinition,
  resolvePoiName,
  shouldShowPoiLabel,
  buildPoiIdentifier,
  fetchOverpassRoutePois
} from '../utils/directions-utils.js';

import {
  getPoiIconImageId,
  getPoiIconImageIdForDay,
  getPoiIconMetadata,
  getPoiIconSvgContent
} from '../../poi/poi-icon-catalog.js';

import {
  fetchWikimediaPhotosInBounds,
  getPhotoThumbnailUrl
} from '../../map/wikimedia-photos.js';

export class DirectionsManagerPoiMixin {
  /**
   * Fetch and display weather data for the current route
   */
  async updateWeatherDisplay() {
    if (!this.routeStats) return;

    const weatherContainers = this.routeStats.querySelectorAll('.weather-container');
    if (!weatherContainers.length) return;

    // Get coordinates based on current view (selected day or full route)
    let targetCoordinates = null;
    // Day offset for forecast: Jour 1 = today (0), Jour 2 = tomorrow (1), etc.
    let dayOffset = this.selectedDayIndex !== null && this.selectedDayIndex !== undefined
      ? this.selectedDayIndex
      : 0;

    if (this.selectedDayIndex !== null && this.selectedDayIndex !== undefined) {
      // Get midpoint of selected day segment
      const segment = this.cutSegments?.[this.selectedDayIndex];
      if (segment) {
        const startKm = Number(segment.startKm ?? segment.startDistanceKm ?? 0);
        const endKm = Number(segment.endKm ?? segment.endDistanceKm ?? startKm);
        const midKm = (startKm + endKm) / 2;
        targetCoordinates = this.getCoordinateAtDistance(midKm);
      }
    }

    // Fallback to route midpoint
    if (!targetCoordinates) {
      const coords = this.routeGeojson?.geometry?.coordinates;
      if (Array.isArray(coords) && coords.length >= 2) {
        const midIndex = Math.floor(coords.length / 2);
        targetCoordinates = coords[midIndex];
      }
    }

    if (!targetCoordinates || !Array.isArray(targetCoordinates) || targetCoordinates.length < 2) {
      weatherContainers.forEach((container) => {
        container.innerHTML = '<span class="weather-unavailable">Coordonnées non disponibles</span>';
      });
      return;
    }

    const [lon, lat] = targetCoordinates;

    try {
      const weatherData = await fetchMeteoFrance(lon, lat);
      // Use day-specific forecast based on selected day
      const weather = getWeatherForDay(weatherData, dayOffset);

      if (weather) {
        const weatherHtml = renderWeatherWidget(weather);
        weatherContainers.forEach((container) => {
          container.innerHTML = weatherHtml;
        });
      } else {
        weatherContainers.forEach((container) => {
          container.innerHTML = '<span class="weather-unavailable">Données non disponibles</span>';
        });
      }
    } catch (error) {
      console.warn('Weather update failed:', error);
      weatherContainers.forEach((container) => {
        container.innerHTML = '<span class="weather-unavailable">Erreur de chargement</span>';
      });
    }
  }

  /**
   * Fetch and display weather for a specific bivouac popup
   * @param {number} lon - Longitude
   * @param {number} lat - Latitude  
   * @param {number} dayNumber - Day number (1 = today, 2 = tomorrow, etc.)
   */
  async updateBivouacWeather(lon, lat, dayNumber) {
    // Find the weather container in the popup
    const popupEl = this.bivouacPopup?.getElement?.();
    if (!popupEl) return;

    const weatherContainer = popupEl.querySelector('.weather-container');
    if (!weatherContainer) return;

    // Day offset: day 1 = today (offset 0), day 2 = tomorrow (offset 1)
    const dayOffset = dayNumber - 1;

    try {
      const weatherData = await fetchMeteoFrance(lon, lat);
      const weather = getWeatherForDay(weatherData, dayOffset);

      if (weather) {
        weatherContainer.innerHTML = renderWeatherWidget(weather);
      } else {
        weatherContainer.innerHTML = '<span class="weather-unavailable">Non disponible</span>';
      }
    } catch (error) {
      console.warn('Bivouac weather update failed:', error);
      weatherContainer.innerHTML = '<span class="weather-unavailable">Erreur</span>';
    }
  }

  async refreshRoutePointsOfInterest() {
    const poiRefreshStart = performance.now();
    const profile = this.routeProfile;
    const coordinates = Array.isArray(profile?.coordinates) ? profile.coordinates : [];
    if (!this.map || coordinates.length < 2 || !turfApi || typeof turfApi.lineString !== 'function'
      || typeof turfApi.nearestPointOnLine !== 'function') {
      this.setRoutePointsOfInterest([]);
      return;
    }

    if (this.pendingPoiAbortController && typeof this.pendingPoiAbortController.abort === 'function') {
      try {
        this.pendingPoiAbortController.abort();
      } catch (error) {
        console.warn('Failed to abort pending POI fallback request', error);
      }
    }
    this.pendingPoiAbortController = null;

    const requestToken = Symbol('poi-request');
    this.pendingPoiRequest = requestToken;
    const line = turfApi.lineString(coordinates.map((coord) => [coord[0], coord[1]]));
    const totalDistanceKm = Number(profile?.totalDistanceKm);


    const sourceCollection = this.offlinePoiCollection;
    let sourceFeatures = Array.isArray(sourceCollection?.features) ? sourceCollection.features : [];
    const shouldRetry = false;
    const poiTimings = { overpassFetch: 0 };

    if ((!Array.isArray(sourceFeatures) || !sourceFeatures.length) && !shouldRetry) {
      let abortController = null;
      if (typeof AbortController === 'function') {
        abortController = new AbortController();
        this.pendingPoiAbortController = abortController;
      }
      try {
        const overpassStart = performance.now();
        const fallbackFeatures = await fetchOverpassRoutePois(line, {
          bufferMeters: POI_MAX_SEARCH_RADIUS_METERS,
          signal: abortController?.signal
        });
        poiTimings.overpassFetch = performance.now() - overpassStart;
        if (this.pendingPoiRequest !== requestToken) {
          return;
        }
        sourceFeatures = fallbackFeatures;
        console.log('%c[POI Overpass Fetch]', 'color: #FF9800; font-weight: bold', {
          'fetchTime': `${poiTimings.overpassFetch.toFixed(1)} ms`,
          'featuresFound': fallbackFeatures?.length || 0
        });
      } catch (error) {
        if (!(abortController?.signal?.aborted)) {
          console.warn('Failed to fetch POIs from Overpass fallback', error);
        }
      } finally {
        if (this.pendingPoiAbortController === abortController) {
          this.pendingPoiAbortController = null;
        }
      }
    }

    if (!Array.isArray(sourceFeatures) || !sourceFeatures.length) {
      this.setRoutePointsOfInterest([]);
      if (Array.isArray(this.routeGeojson?.geometry?.coordinates)
        && this.routeGeojson.geometry.coordinates.length >= 2) {
        this.updateElevationProfile(this.routeGeojson.geometry.coordinates);
      }
      this.pendingPoiRequest = null;
      return;
    }

    const seen = new Set();
    const collected = [];



    // OPTIMIZATION: Compute route bounding box to pre-filter POIs
    // This avoids expensive nearestPointOnLine for POIs far from the route
    const BBOX_BUFFER_DEG = 0.02; // ~2km buffer in degrees (rough approximation)
    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;
    coordinates.forEach(coord => {
      if (Array.isArray(coord) && coord.length >= 2) {
        const [lng, lat] = coord;
        if (Number.isFinite(lng) && Number.isFinite(lat)) {
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
        }
      }
    });
    // Expand bbox by buffer
    minLng -= BBOX_BUFFER_DEG;
    maxLng += BBOX_BUFFER_DEG;
    minLat -= BBOX_BUFFER_DEG;
    maxLat += BBOX_BUFFER_DEG;

    let skippedByBbox = 0;

    sourceFeatures.forEach((feature) => {
      if (!feature || typeof feature !== 'object') {
        return;
      }
      const geometry = feature.geometry;
      if (!geometry || !Array.isArray(geometry.coordinates)) {
        return;
      }

      // Extract coordinates based on geometry type
      let lng, lat;
      if (geometry.type === 'Point') {
        [lng, lat] = geometry.coordinates;
      } else if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates[0])) {
        // Calculate centroid of first ring (outer boundary)
        const ring = geometry.coordinates[0];
        if (ring.length < 3) return;
        let sumLng = 0, sumLat = 0;
        ring.forEach(coord => {
          if (Array.isArray(coord) && coord.length >= 2) {
            sumLng += coord[0];
            sumLat += coord[1];
          }
        });
        lng = sumLng / ring.length;
        lat = sumLat / ring.length;
      } else {
        // Unsupported geometry type
        return;
      }

      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return;
      }

      // OPTIMIZATION: Skip POIs outside route bounding box (fast O(1) check)
      if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) {
        skippedByBbox++;
        return;
      }

      const definition = resolvePoiDefinition(feature.properties || {});
      if (!definition) {
        return;
      }
      let nearest = null;
      try {
        nearest = turfApi.nearestPointOnLine(line, turfApi.point([lng, lat]), { units: 'kilometers' });
      } catch (error) {
        return;
      }
      const distanceKm = Number(nearest?.properties?.location);
      const distanceToLineKm = Number(nearest?.properties?.dist ?? nearest?.properties?.distance);
      if (!Number.isFinite(distanceKm) || !Number.isFinite(distanceToLineKm)) {
        return;
      }
      const categoryKey = typeof definition?.key === 'string' ? definition.key : '';
      const maxDistanceMeters = Number.isFinite(POI_CATEGORY_DISTANCE_OVERRIDES[categoryKey])
        ? Math.max(0, POI_CATEGORY_DISTANCE_OVERRIDES[categoryKey])
        : POI_SEARCH_RADIUS_METERS;
      const distanceMeters = distanceToLineKm * 1000;
      if (!Number.isFinite(distanceMeters) || distanceMeters > maxDistanceMeters) {
        return;
      }
      const rawId = feature?.properties?.id
        ?? feature?.properties?.osm_id
        ?? feature?.properties?.['@id']
        ?? feature?.id
        ?? feature?.properties?.ref;
      const identifier = buildPoiIdentifier(definition.key, [lng, lat], rawId);
      if (seen.has(identifier)) {
        return;
      }
      seen.add(identifier);

      const name = resolvePoiName(feature.properties || {});
      if (!name && definition.key === 'peak') {
        return;
      }
      const categoryLabel = definition.definition.label ?? DEFAULT_POI_TITLE;
      const tooltip = name
        ? (categoryLabel && categoryLabel !== name ? `${name} · ${categoryLabel} ` : name)
        : categoryLabel || DEFAULT_POI_TITLE;
      const clampedDistanceKm = Number.isFinite(totalDistanceKm)
        ? Math.max(0, Math.min(totalDistanceKm, distanceKm))
        : Math.max(0, distanceKm);

      const coordsArray = Array.isArray(feature.geometry?.coordinates)
        ? feature.geometry.coordinates
        : [];
      const coordinateElevation = coordsArray.length >= 3 ? Number(coordsArray[2]) : null;
      let elevation = parsePoiElevation(feature.properties || {});
      if (!Number.isFinite(elevation) && Number.isFinite(coordinateElevation)) {
        elevation = coordinateElevation;
      }
      const peakImportance = computePeakImportanceScore(feature.properties || {}, elevation);
      const peakImportanceScore = Number.isFinite(peakImportance?.score) ? peakImportance.score : 0;

      const baseIconKey = definition.definition.icon ?? definition.key;
      const iconKey = resolveRoutePoiIconKey(definition.key, baseIconKey, peakImportanceScore);
      const iconImageId = getPoiIconImageId(iconKey);

      collected.push({
        id: identifier,
        name,
        title: tooltip,
        categoryLabel,
        categoryKey: definition.key,
        iconKey,
        iconImageId,
        color: definition.definition.color ?? DEFAULT_POI_COLOR,
        distanceKm: clampedDistanceKm,
        coordinates: [lng, lat],
        elevation,
        peakImportanceScore
      });
    });



    collected.sort((a, b) => a.distanceKm - b.distanceKm);

    const clustered = clusterRoutePointsOfInterest(collected, totalDistanceKm);

    // Merge water sources with nearby host POIs (cabins, parking, etc.)
    const mergedPois = (() => {
      if (!clustered.length) return [];

      // Separate water sources from others
      const waterSources = [];
      const potentialHosts = [];
      const others = [];

      clustered.forEach(poi => {
        if (WATER_CATEGORY_SET.has(poi.categoryKey)) {
          waterSources.push(poi);
        } else if (WATER_HOST_CATEGORY_SET.has(poi.categoryKey)) {
          potentialHosts.push(poi);
        } else {
          others.push(poi);
        }
      });

      const usedWaterIndices = new Set();

      const enrichedHosts = potentialHosts.map(host => {
        // Find closest unused water source within range
        let bestWaterIdx = -1;
        let minDist = Infinity;

        waterSources.forEach((water, idx) => {
          if (usedWaterIndices.has(idx)) return;

          const dist = Math.abs(host.distanceKm - water.distanceKm);
          if (dist <= WATER_MERGE_PROXIMITY_KM && dist < minDist) {
            minDist = dist;
            bestWaterIdx = idx;
          }
        });

        if (bestWaterIdx !== -1) {
          usedWaterIndices.add(bestWaterIdx);
          return { ...host, hasWater: true };
        }
        return host;
      });

      const remainingWater = waterSources.filter((_, idx) => !usedWaterIndices.has(idx));

      const result = [...others, ...enrichedHosts, ...remainingWater];
      result.sort((a, b) => a.distanceKm - b.distanceKm);
      return result;
    })();

    // OPTIMIZATION: Load all unique icons in parallel instead of sequentially
    // This reduces O(n × latency) to O(latency) for icon loading
    const uniqueIconKeys = new Set();
    mergedPois.forEach(entry => {
      if (entry?.iconKey) {
        uniqueIconKeys.add(entry.iconKey.trim());
      }
    });

    // Parallel fetch all unique icons
    const iconDataMap = new Map();
    if (uniqueIconKeys.size > 0) {
      const iconPromises = Array.from(uniqueIconKeys).map(async (iconKey) => {
        try {
          const [metadata, svgContent] = await Promise.all([
            getPoiIconMetadata(iconKey),
            getPoiIconSvgContent(iconKey)
          ]);
          return { iconKey, metadata, svgContent };
        } catch (error) {
          console.warn('Failed to load POI icon data', iconKey, error);
          return { iconKey, metadata: null, svgContent: null };
        }
      });

      const results = await Promise.all(iconPromises);
      results.forEach(({ iconKey, metadata, svgContent }) => {
        iconDataMap.set(iconKey, { metadata, svgContent });
      });
    }

    if (this.pendingPoiRequest !== requestToken) {
      return;
    }



    // Now process POIs using cached icon data (synchronous, fast)
    const resolved = [];
    for (const entry of mergedPois) {
      if (!entry) {
        continue;
      }
      const iconKey = typeof entry.iconKey === 'string' ? entry.iconKey.trim() : '';
      const iconData = iconKey ? iconDataMap.get(iconKey) : null;
      const iconMetadata = iconData?.metadata || null;
      const iconSvgContent = iconData?.svgContent || null;

      const decorated = { ...entry };
      if (iconSvgContent) {
        decorated.iconSvgContent = iconSvgContent;
      }
      if (iconMetadata) {
        const metrics = computePoiIconDisplayMetrics(iconMetadata);
        decorated.icon = {
          ...iconMetadata,
          displayWidth: metrics?.displayWidth ?? null,
          displayHeight: metrics?.displayHeight ?? null
        };
        decorated.iconDisplayWidth = metrics?.displayWidth ?? null;
        decorated.iconDisplayHeight = metrics?.displayHeight ?? null;
        decorated.iconDisplayScale = metrics?.mapScale ?? 1;
        decorated.iconImageId = entry.iconImageId ?? getPoiIconImageId(iconKey);
      } else {
        decorated.icon = null;
        decorated.iconDisplayWidth = null;
        decorated.iconDisplayHeight = null;
        decorated.iconDisplayScale = 1;
        decorated.iconImageId = null;
      }
      decorated.showLabel = shouldShowPoiLabel(decorated);
      resolved.push(decorated);
    }

    if (this.pendingPoiRequest !== requestToken) {
      return;
    }

    markElevationProfileLabelLeaders(resolved, totalDistanceKm);

    // Assign day segment colors and icon variants to POIs based on their distance
    const segments = Array.isArray(this.cutSegments) ? this.cutSegments : [];
    const defaultColor = this.modeColors?.[this.currentMode] || '#f8b40b';

    resolved.forEach((poi) => {
      if (!poi || !Number.isFinite(poi.distanceKm)) return;

      // Find which day segment this POI belongs to
      let dayIndex = 0; // Default to day 0 (single-day or first segment)
      const segment = segments.find((seg, idx) => {
        const start = Number(seg.startKm ?? seg.startDistanceKm ?? 0);
        const end = Number(seg.endKm ?? seg.endDistanceKm ?? start);
        if (poi.distanceKm >= start && poi.distanceKm <= end) {
          dayIndex = idx; // Segment index directly maps to day color index
          return true;
        }
        return false;
      });

      // Use segment color if found, otherwise use default route color
      poi.color = segment?.color || defaultColor;

      // Assign day-specific icon image ID for map rendering
      const iconKey = typeof poi.iconKey === 'string' ? poi.iconKey.trim() : '';
      if (iconKey) {
        poi.iconImageId = getPoiIconImageIdForDay(iconKey, dayIndex);
      }
    });

    this.setRoutePointsOfInterest(resolved);

    if (Array.isArray(this.routeGeojson?.geometry?.coordinates)
      && this.routeGeojson.geometry.coordinates.length >= 2) {
      this.updateElevationProfile(this.routeGeojson.geometry.coordinates);
    } else if (coordinates.length >= 2) {
      this.updateElevationProfile(coordinates);
    }
    this.pendingPoiRequest = null;
    this.pendingPoiAbortController = null;

    // Log POI refresh timing
    const poiRefreshTotal = performance.now() - poiRefreshStart;
    console.log('%c[POI Refresh]', 'color: #00BCD4; font-weight: bold', {
      'total': `${poiRefreshTotal.toFixed(1)} ms`,
      'poisFound': resolved.length,
      'routeCoords': coordinates.length
    });
  }

  async refreshRoutePhotos() {
    // Phase 1: Preparation (Coordinates & Bounds)
    const coordinates = this.routeGeojson?.geometry?.coordinates;
    if (!coordinates || coordinates.length < 2) {
      this.routePhotos = [];
      return;
    }

    // Always fetch photos regardless of map layer state to ensure they are ready 
    // when the user toggles the elevation sidebar. This matches working BAK behavior.

    // Calculate bounds manually
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    coordinates.forEach(coord => {
      if (Array.isArray(coord) && coord.length >= 2) {
        if (coord[0] < minLng) minLng = coord[0];
        if (coord[0] > maxLng) maxLng = coord[0];
        if (coord[1] < minLat) minLat = coord[1];
        if (coord[1] > maxLat) maxLat = coord[1];
      }
    });

    const padding = 0.01;
    const bounds = {
      getNorth: () => maxLat + padding,
      getSouth: () => minLat - padding,
      getEast: () => maxLng + padding,
      getWest: () => minLng - padding
    };

    try {
      console.log(`[refreshRoutePhotos] Fetching photos for bounds: N=${bounds.getNorth().toFixed(4)}, S=${bounds.getSouth().toFixed(4)}, E=${bounds.getEast().toFixed(4)}, W=${bounds.getWest().toFixed(4)}`);
      const collection = await fetchWikimediaPhotosInBounds(bounds);
      if (!collection || !collection.features) {
        this.routePhotos = [];
        return;
      }

      const line = turfApi.lineString(coordinates);
      const photos = [];
      const seen = new Set();
      const MAX_DIST_KM = 0.3; // 300m - very relaxed threshold to ensure mountain photos appear

      // Performance Optimization: Downsample coordinates for distance matching 
      // Turf.nearestPointOnLine is O(N) where N is number of coordinates.
      // Increased resolution to 1000 points for better accuracy.
      const downsampleFactor = Math.max(1, Math.ceil(coordinates.length / 1000));
      const simplifiedCoords = coordinates.filter((_, i) => i % downsampleFactor === 0);
      if (simplifiedCoords[simplifiedCoords.length - 1] !== coordinates[coordinates.length - 1]) {
        simplifiedCoords.push(coordinates[coordinates.length - 1]);
      }
      const simplifiedLine = turfApi.lineString(simplifiedCoords);

      console.log(`[refreshRoutePhotos] Fetched ${collection.features.length} photos. Processing with ${simplifiedCoords.length} route points...`);

      for (const feature of collection.features) {
        const [lng, lat] = feature.geometry.coordinates;
        // Simple bounding box check first
        if (lng < minLng - 0.01 || lng > maxLng + 0.01 || lat < minLat - 0.01 || lat > maxLat + 0.01) continue;

        const point = turfApi.point([lng, lat]);
        // Use simplified line for distance check
        const nearest = turfApi.nearestPointOnLine(simplifiedLine, point, { units: 'kilometers' });
        const distKm = nearest.properties.dist;

        if (distKm <= MAX_DIST_KM) {
          const id = feature.properties.pageId;
          if (seen.has(id)) continue;
          seen.add(id);

          photos.push({
            id: feature.properties.pageId,
            title: feature.properties.title,
            fileName: feature.properties.fileName,
            lng,
            lat,
            distanceKm: nearest.properties.location,
            distanceToRouteKm: distKm,
            thumbnailUrl: getPhotoThumbnailUrl(feature.properties.fileName, 400)
          });
        }
      }

      this.routePhotos = photos.sort((a, b) => a.distanceKm - b.distanceKm);
      console.log(`[refreshRoutePhotos] Success: ${this.routePhotos.length} photos assigned to route. Samples:`, this.routePhotos.slice(0, 3));

      // Trigger chart update if we have photos and the chart is already rendered
      if (this.routePhotos.length > 0 && this.elevationChartContainer) {
        // Redraw with current coordinates to preserve focus/day selection
        const coords = this.selectedDayIndex !== null
          ? this.routeGeojson?.geometry?.coordinates
          : this.routeGeojson?.geometry?.coordinates;
        // The above is slightly redundant, the key is updateElevationProfile 
        // will preserve selectedDayIndex logic if called correctly.
        // Actually, we just need to call it with the full route but ENSURE it re-applies the zoom
        this.updateElevationProfile(this.routeGeojson?.geometry?.coordinates);

        if (this.selectedDayIndex !== null && this.selectedDayIndex !== undefined) {
          this.zoomElevationChartToDay(this.selectedDayIndex);
        }
      }
    } catch (e) {
      console.warn('Failed to refresh route photos', e);
      this.routePhotos = [];
    }
  }

  updateProfileLegend(show) {
    if (!this.elevationChart) return;

    // Find the existing sidebar (sibling of elevationChart)
    const chartContainer = this.elevationChart.parentElement;
    if (!chartContainer) return;

    const legendContainer = chartContainer.querySelector('.profile-mode-sidebar');
    if (!legendContainer) return;

    if (!show) {
      // We don't hide the sidebar as it contains other controls
      return;
    }

    // Check if photo toggle exists
    let photoBtn = legendContainer.querySelector('#elevationPhotoToggle');

    if (!photoBtn) {
      // Create it
      photoBtn = document.createElement('button');
      photoBtn.id = 'elevationPhotoToggle';
      photoBtn.className = 'profile-mode-sidebar__item';
      photoBtn.type = 'button';
      photoBtn.setAttribute('role', 'switch');
      photoBtn.title = 'Afficher les photos';
      photoBtn.setAttribute('aria-label', 'Afficher les photos');

      photoBtn.innerHTML = `
        <img src="./data/icons_Xmap/camera.png" alt="" aria-hidden="true" style="width: 20px; height: 20px;" />
        <span class="sr-only">Afficher les photos</span>
      `;

      // Append to legendContainer
      legendContainer.appendChild(photoBtn);

      // Add event listener
      photoBtn.addEventListener('click', () => {
        this.showElevationPhotos = !this.showElevationPhotos;
        console.log(`[elevationPhotoToggle] Toggled to: ${this.showElevationPhotos}`);
        this.updateProfileLegend(true); // Update state

        // Redraw to show/hide photo markers
        this.updateElevationProfile(this.routeGeojson?.geometry?.coordinates);

        // Re-apply day zoom if active to prevent focus reset
        if (this.selectedDayIndex !== null && this.selectedDayIndex !== undefined) {
          this.zoomElevationChartToDay(this.selectedDayIndex);
        }
      });
    }

    // Update state
    photoBtn.setAttribute('aria-checked', this.showElevationPhotos);
    if (this.showElevationPhotos) {
      photoBtn.classList.add('active');
    } else {
      photoBtn.classList.remove('active');
    }
  }

  refreshElevationProfile() {
    if (!this.routeGeojson || !this.routeGeojson.geometry) {
      this._elevationRefreshPending = false;
      return;
    }

    const coordinates = this.routeGeojson.geometry.coordinates;
    const profile = this.buildRouteProfile(coordinates);

    const currentSampleCount = this.routeProfile?.terrainSampleCount ?? 0;
    const newSampleCount = profile?.terrainSampleCount ?? 0;
    const totalPoints = profile?.coordinates?.length ?? 1;

    // Only commit refresh if we actually found MORE terrain data
    if (newSampleCount > currentSampleCount) {
      this.routeProfile = profile;

      // Update the main route GeoJSON with the new elevations (densified)
      if (this.routeGeojson && this.routeGeojson.geometry) {
        this.routeGeojson.geometry.coordinates = profile.coordinates.map(c => c.slice());
      }

      // Sync all data structures with new altitudes
      this.rebuildSegmentData();
      this.updateRouteCutSegments();
      this.updateRouteLineSource();
      this.updateWaypoints();

      // Update the chart
      this.updateElevationProfile(profile.coordinates);

      // Update metrics and summary
      this.latestMetrics = this.calculateRouteMetrics({
        geometry: { coordinates: profile.coordinates },
        properties: this.routeGeojson.properties
      });
      this.renderRouteStatsSummary(this.latestMetrics);
      this.updateDistanceMarkers(this.routeGeojson);
    }

    // High coverage reached (95%+)
    if (newSampleCount >= totalPoints * 0.95) {
      this._elevationRefreshPending = false;
    }
  }

}

