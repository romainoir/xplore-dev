import {
    METEO_FRANCE_API_DOMAIN,
    METEO_FRANCE_API_TOKEN,
    METEO_FRANCE_ICON_BASE_URL,
    METEO_FRANCE_RAIN_ICON_BASE_URL,
    WEATHER_CACHE_TTL_MS,
    PEAK_CATEGORY_SET,
    PEAK_PRINCIPAL_ICON_THRESHOLD,
    POI_ICON_TARGET_DISPLAY_SIZE_PX,
    ELEVATION_PROFILE_POI_CATEGORY_SET,
    POI_ELEVATION_PROPERTY_KEYS,
    PEAK_IMPORTANCE_VALUE_MAP,
    PEAK_ROLE_VALUE_MAP,
    PEAK_PROMINENCE_THRESHOLDS,
    PEAK_ELEVATION_THRESHOLDS,
    POI_CLUSTER_MIN_SPACING_KM,
    POI_CLUSTER_MAX_SPACING_KM,
    POI_CLUSTER_DISTANCE_SCALE,
    PARKING_CATEGORY_SET,
    PARKING_CLUSTER_MIN_SPACING_KM,
    ELEVATION_PROFILE_POI_CLUSTER_MIN_WINDOW_KM,
    ELEVATION_PROFILE_POI_CLUSTER_MAX_WINDOW_KM,
    ELEVATION_PROFILE_POI_CLUSTER_DISTANCE_SCALE,
    LABELLED_POI_CATEGORY_SET,
    PEAK_LABEL_ELEVATION_THRESHOLD_METERS,
    POI_NAME_PROPERTIES,
    CONNECTOR_METADATA_SOURCES,
    turfApi,
    POI_SEARCH_RADIUS_METERS,
    POI_MAX_SEARCH_RADIUS_METERS,
    POI_FALLBACK_ENDPOINT,
    POI_FALLBACK_MAX_BOUND_SPAN_DEGREES,
    POI_FALLBACK_TIMEOUT_SECONDS,
    POI_CATEGORY_DISTANCE_OVERRIDES,
    DEFAULT_POI_COLOR,
    DEFAULT_POI_TITLE,
    POI_ICON_DEFINITIONS,
    POI_ADDITIONAL_PROPERTY_TAGS
} from '../constants/directions-constants.js';

import { extractOverpassNetwork } from '../../routing/overpass-network-fetcher.js';

export function isConnectorMetadataSource(source) {
    return typeof source === 'string' && CONNECTOR_METADATA_SOURCES.has(source);
}

// Cache for weather data to avoid repeated API calls
const weatherDataCache = new Map();

/**
 * Fetch weather forecast from Météo-France API
 * @param {number} lon - Longitude
 * @param {number} lat - Latitude
 * @returns {Promise<Object|null>} Weather data or null on error
 */
export async function fetchMeteoFrance(lon, lat) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        return null;
    }

    // Round coordinates to reduce cache fragmentation
    const roundedLon = Math.round(lon * 100) / 100;
    const roundedLat = Math.round(lat * 100) / 100;
    const cacheKey = `${roundedLon},${roundedLat}`;

    // Check cache
    const cached = weatherDataCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < WEATHER_CACHE_TTL_MS) {
        return cached.data;
    }

    try {
        const forecastUrl = `${METEO_FRANCE_API_DOMAIN}/forecast?lon=${lon}&lat=${lat}&token=${METEO_FRANCE_API_TOKEN}`;
        const response = await fetch(forecastUrl);

        if (!response.ok) {
            console.warn('Météo-France API error:', response.status);
            return null;
        }

        const data = await response.json();

        // Cache the result
        weatherDataCache.set(cacheKey, { data, timestamp: Date.now() });

        return data;
    } catch (error) {
        console.warn('Failed to fetch Météo-France data:', error);
        return null;
    }
}

/**
 * Get weather forecast from Météo-France data for a specific day
 * @param {Object} weatherData - Raw forecast data from API
 * @param {number} dayOffset - Day offset from today (0 = today, 1 = tomorrow, etc.)
 * @returns {Object|null} Weather info for the specified day
 */
export function getWeatherForDay(weatherData, dayOffset = 0) {
    if (!weatherData?.forecast || !Array.isArray(weatherData.forecast)) {
        return null;
    }

    const now = new Date();
    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + dayOffset);

    // For today (offset 0), use current hour
    // For future days, target noon (12:00) for representative weather
    const targetHour = dayOffset === 0 ? now.getHours() : 12;
    targetDate.setHours(targetHour, 0, 0, 0);
    const targetTimestamp = targetDate.getTime();

    // Find the forecast closest to target time
    const relevantForecast = weatherData.forecast
        .map((f) => ({
            ...f,
            date: new Date(f.dt * 1000),
            diff: Math.abs(f.dt * 1000 - targetTimestamp)
        }))
        .filter((f) => {
            const forecastDate = f.date;
            // For future days, only consider forecasts on that specific day
            if (dayOffset > 0) {
                return forecastDate.toDateString() === targetDate.toDateString();
            }
            // For today, allow forecasts from last hour onwards
            return f.date >= new Date(Date.now() - 3600000);
        })
        .sort((a, b) => a.diff - b.diff)[0];

    if (!relevantForecast) {
        return null;
    }

    const temperature = Math.round(relevantForecast.T?.value ?? 0);
    const weatherIcon = relevantForecast.weather?.icon || '';
    const weatherDesc = relevantForecast.weather?.desc || '';
    const rainAmount = relevantForecast.rain?.['1h'] ?? 0;
    const isRaining = rainAmount > 0;

    return {
        temperature,
        weatherIcon,
        weatherDesc,
        rainAmount,
        isRaining,
        locationName: weatherData.position?.name || '',
        weatherIconUrl: weatherIcon ? `${METEO_FRANCE_ICON_BASE_URL}${weatherIcon}.svg` : '',
        rainIconUrl: isRaining
            ? `${METEO_FRANCE_RAIN_ICON_BASE_URL}pluie-moderee.svg`
            : `${METEO_FRANCE_RAIN_ICON_BASE_URL}pas-de-pluie.svg`,
        dayOffset,
        forecastDate: relevantForecast.date
    };
}

// Backward compatibility alias
export function getCurrentHourWeather(weatherData) {
    return getWeatherForDay(weatherData, 0);
}

/**
 * Render weather widget HTML
 * @param {Object} weather - Current weather data from getCurrentHourWeather
 * @returns {string} HTML string for weather display
 */
export function renderWeatherWidget(weather) {
    if (!weather) {
        return '<span class="weather-loading">Chargement...</span>';
    }

    const tempDisplay = `${weather.temperature}°`;
    const rainTitle = weather.isRaining
        ? `Pluie: ${weather.rainAmount} mm/h`
        : 'Pas de pluie';

    return `
    <span class="weather-widget" title="${weather.weatherDesc}. ${rainTitle}">
      <span class="weather-temp">${tempDisplay}</span>
      <img class="weather-icon" src="${weather.weatherIconUrl}" alt="${weather.weatherDesc}" width="24" height="24" loading="lazy" />
      <img class="weather-rain-icon" src="${weather.rainIconUrl}" alt="${rainTitle}" width="20" height="20" loading="lazy" />
    </span>
  `;
}

export function resolveRoutePoiIconKey(categoryKey, baseIconKey, peakImportanceScore) {
    const normalizedBase = typeof baseIconKey === 'string' ? baseIconKey.trim() : '';
    const normalizedCategory = typeof categoryKey === 'string' ? categoryKey.trim() : '';
    if (PEAK_CATEGORY_SET.has(normalizedCategory)) {
        const score = Number(peakImportanceScore);
        if (Number.isFinite(score) && score >= PEAK_PRINCIPAL_ICON_THRESHOLD) {
            return 'peak_principal';
        }
        return normalizedBase || 'peak_minor';
    }
    return normalizedBase || normalizedCategory;
}

export function computePoiIconDisplayMetrics(iconMetadata) {
    if (!iconMetadata) {
        return null;
    }
    const width = Number(iconMetadata.width);
    const height = Number(iconMetadata.height);
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        return null;
    }
    const pixelRatio = Number(iconMetadata.pixelRatio) || 1;
    const displayWidth = width / pixelRatio;
    const displayHeight = height / pixelRatio;
    if (!Number.isFinite(displayWidth) || displayWidth <= 0 || !Number.isFinite(displayHeight) || displayHeight <= 0) {
        return null;
    }
    const maxDimension = Math.max(displayWidth, displayHeight);
    if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
        return {
            displayWidth,
            displayHeight,
            mapScale: 1
        };
    }
    const scale = Math.min(1, POI_ICON_TARGET_DISPLAY_SIZE_PX / maxDimension);
    return {
        displayWidth: displayWidth * scale,
        displayHeight: displayHeight * scale,
        mapScale: scale
    };
}

export function isElevationProfilePoiCategory(key) {
    if (typeof key !== 'string' || !key) {
        return false;
    }
    return ELEVATION_PROFILE_POI_CATEGORY_SET.has(key);
}

export function normalizePoiValue(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.trim().toLowerCase();
}

export function parseNumericValue(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().replace(',', '.');
        if (!normalized) {
            return null;
        }
        const match = normalized.match(/-?\d+(?:\.\d+)?/);
        if (!match) {
            return null;
        }
        const parsed = Number(match[0]);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

export function parsePoiElevation(properties = {}) {
    for (const key of POI_ELEVATION_PROPERTY_KEYS) {
        const raw = properties?.[key];
        if (raw === null || raw === undefined) {
            continue;
        }
        const numeric = parseNumericValue(raw);
        if (Number.isFinite(numeric)) {
            return numeric;
        }
    }
    return null;
}

export function computePeakImportanceScore(properties = {}, fallbackElevation = null) {
    const importanceValue = normalizePoiValue(properties?.importance || properties?.['importance:level']);
    let score = importanceValue && PEAK_IMPORTANCE_VALUE_MAP.has(importanceValue)
        ? PEAK_IMPORTANCE_VALUE_MAP.get(importanceValue)
        : 0;

    const rankValue = parseNumericValue(properties?.rank);
    if (Number.isFinite(rankValue)) {
        const clampedRank = Math.max(0, Math.min(rankValue, 9));
        const rankScore = Math.max(0, 6 - Math.min(clampedRank, 6));
        score = Math.max(score, rankScore);
    }

    const peakRoleValue = normalizePoiValue(properties?.peak);
    if (peakRoleValue && PEAK_ROLE_VALUE_MAP.has(peakRoleValue)) {
        score = Math.max(score, PEAK_ROLE_VALUE_MAP.get(peakRoleValue));
    }

    const prominenceCandidates = [
        properties?.prominence,
        properties?.['prominence:meters'],
        properties?.['prominence:metres']
    ];
    let prominenceValue = null;
    for (const candidate of prominenceCandidates) {
        const numeric = parseNumericValue(candidate);
        if (Number.isFinite(numeric)) {
            prominenceValue = numeric;
            break;
        }
    }
    if (Number.isFinite(prominenceValue)) {
        for (const threshold of PEAK_PROMINENCE_THRESHOLDS) {
            if (prominenceValue >= threshold.min) {
                score = Math.max(score, threshold.score);
                break;
            }
        }
    }

    let elevationValue = parsePoiElevation(properties);
    if (!Number.isFinite(elevationValue) && Number.isFinite(fallbackElevation)) {
        elevationValue = fallbackElevation;
    }
    if (Number.isFinite(elevationValue)) {
        for (const threshold of PEAK_ELEVATION_THRESHOLDS) {
            if (elevationValue >= threshold.min) {
                score = Math.max(score, threshold.score);
                break;
            }
        }
    }

    return {
        score,
        importance: importanceValue,
        rank: Number.isFinite(rankValue) ? rankValue : null,
        peakRole: peakRoleValue,
        prominence: Number.isFinite(prominenceValue) ? prominenceValue : null,
        elevation: Number.isFinite(elevationValue) ? elevationValue : null
    };
}

export function computePoiClusterSpacing(totalDistanceKm) {
    const normalizedDistance = Number(totalDistanceKm);
    if (!Number.isFinite(normalizedDistance) || normalizedDistance <= 0) {
        return POI_CLUSTER_MIN_SPACING_KM;
    }
    const scaled = normalizedDistance / POI_CLUSTER_DISTANCE_SCALE;
    const clamped = Math.max(POI_CLUSTER_MIN_SPACING_KM, Math.min(POI_CLUSTER_MAX_SPACING_KM, scaled));
    return clamped;
}

export function selectClusterRepresentative(items, categoryKey) {
    if (!Array.isArray(items) || !items.length) {
        return null;
    }
    if (PEAK_CATEGORY_SET.has(categoryKey)) {
        let chosen = null;
        let bestScore = -Infinity;
        let bestElevation = -Infinity;
        items.forEach((item) => {
            if (!item) {
                return;
            }
            const importanceScore = Number(item.peakImportanceScore);
            const score = Number.isFinite(importanceScore) ? importanceScore : 0;
            const elevation = Number(item.elevation);
            const normalizedElevation = Number.isFinite(elevation) ? elevation : -Infinity;
            if (score > bestScore) {
                bestScore = score;
                bestElevation = normalizedElevation;
                chosen = item;
                return;
            }
            if (score === bestScore) {
                if (normalizedElevation > bestElevation) {
                    bestElevation = normalizedElevation;
                    chosen = item;
                    return;
                }
                if (normalizedElevation === bestElevation) {
                    const chosenHasName = typeof chosen?.name === 'string' && chosen.name;
                    const itemHasName = typeof item.name === 'string' && item.name;
                    if (!chosenHasName && itemHasName) {
                        chosen = item;
                    }
                }
                return;
            }
        });
        return chosen ?? items[0];
    }
    const named = items.find((item) => typeof item?.name === 'string' && item.name.trim());
    return named ?? items[0];
}

export function clusterRoutePointsOfInterest(pois, totalDistanceKm) {
    if (!Array.isArray(pois) || !pois.length) {
        return [];
    }
    const spacingKm = computePoiClusterSpacing(totalDistanceKm);
    const grouped = new Map();
    pois.forEach((poi) => {
        if (!poi || !Number.isFinite(poi.distanceKm)) {
            return;
        }
        const key = poi.categoryKey ?? 'default';
        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key).push(poi);
    });

    const results = [];
    grouped.forEach((list, categoryKey) => {
        const sorted = list
            .filter((poi) => poi && Number.isFinite(poi.distanceKm))
            .sort((a, b) => a.distanceKm - b.distanceKm);
        if (!sorted.length) {
            return;
        }
        let cluster = [];
        let clusterBase = null;
        const activeSpacingKm = PARKING_CATEGORY_SET.has(categoryKey)
            ? Math.max(spacingKm, PARKING_CLUSTER_MIN_SPACING_KM)
            : spacingKm;
        sorted.forEach((poi) => {
            const distance = Number(poi.distanceKm);
            if (!Number.isFinite(distance)) {
                return;
            }
            if (!cluster.length) {
                cluster = [poi];
                clusterBase = distance;
                return;
            }
            if (Math.abs(distance - clusterBase) <= activeSpacingKm) {
                cluster.push(poi);
            } else {
                const representative = selectClusterRepresentative(cluster, categoryKey);
                if (representative) {
                    results.push(representative);
                }
                cluster = [poi];
                clusterBase = distance;
            }
        });
        if (cluster.length) {
            const representative = selectClusterRepresentative(cluster, categoryKey);
            if (representative) {
                results.push(representative);
            }
        }
    });

    results.sort((a, b) => a.distanceKm - b.distanceKm);
    return results;
}

export function computeElevationProfilePoiClusterWindow(totalDistanceKm) {
    const distance = Number(totalDistanceKm);
    if (!Number.isFinite(distance) || distance <= 0) {
        return ELEVATION_PROFILE_POI_CLUSTER_MIN_WINDOW_KM;
    }
    const scaled = distance / ELEVATION_PROFILE_POI_CLUSTER_DISTANCE_SCALE;
    const clamped = Math.min(
        ELEVATION_PROFILE_POI_CLUSTER_MAX_WINDOW_KM,
        Math.max(ELEVATION_PROFILE_POI_CLUSTER_MIN_WINDOW_KM, scaled)
    );
    return clamped;
}

export function selectElevationProfileLabelLeader(items) {
    if (!Array.isArray(items) || !items.length) {
        return null;
    }
    let chosen = null;
    let bestScore = -Infinity;
    let bestElevation = -Infinity;
    items.forEach((item) => {
        if (!item) {
            return;
        }
        const peakImportanceScore = Number(item.peakImportanceScore);
        const elevation = Number(item.elevation);
        const hasElevation = Number.isFinite(elevation);
        const name = typeof item.name === 'string' ? item.name.trim() : '';
        const weightedScore = (Number.isFinite(peakImportanceScore) ? peakImportanceScore : 0) * 10
            + (hasElevation ? elevation / 1000 : 0)
            + (name ? 0.01 : 0);
        if (weightedScore > bestScore) {
            bestScore = weightedScore;
            bestElevation = hasElevation ? elevation : -Infinity;
            chosen = item;
            return;
        }
        if (weightedScore === bestScore) {
            if (hasElevation && (!Number.isFinite(bestElevation) || elevation > bestElevation)) {
                bestElevation = elevation;
                chosen = item;
                return;
            }
            if (hasElevation && elevation === bestElevation) {
                const chosenHasName = typeof chosen?.name === 'string' && chosen.name.trim();
                if (!chosenHasName && name) {
                    chosen = item;
                }
            }
        }
    });
    return chosen ?? items[0] ?? null;
}

export function markElevationProfileLabelLeaders(pois, totalDistanceKm) {
    if (!Array.isArray(pois) || !pois.length) {
        return Array.isArray(pois) ? pois : [];
    }
    const windowKm = Math.max(
        Number.EPSILON,
        computeElevationProfilePoiClusterWindow(totalDistanceKm)
    );
    const sorted = pois
        .filter((poi) => poi && Number.isFinite(poi.distanceKm))
        .sort((a, b) => a.distanceKm - b.distanceKm);

    pois.forEach((poi) => {
        if (poi) {
            poi.showElevationProfileLabel = false;
        }
    });

    const eligible = sorted.filter((poi) => poi && poi.showLabel);
    if (!eligible.length) {
        return pois;
    }

    let cluster = [];
    let clusterBase = null;
    eligible.forEach((poi) => {
        const distance = Number(poi.distanceKm);
        if (!cluster.length) {
            cluster = [poi];
            clusterBase = distance;
            return;
        }
        if (Math.abs(distance - clusterBase) <= windowKm) {
            cluster.push(poi);
            return;
        }
        const leader = selectElevationProfileLabelLeader(cluster);
        if (leader) {
            leader.showElevationProfileLabel = true;
        }
        cluster = [poi];
        clusterBase = distance;
    });

    if (cluster.length) {
        const leader = selectElevationProfileLabelLeader(cluster);
        if (leader) {
            leader.showElevationProfileLabel = true;
        }
    }

    return pois;
}

export function shouldShowPoiLabel(poi) {
    if (!poi) {
        return false;
    }
    const categoryKey = typeof poi.categoryKey === 'string' ? poi.categoryKey : '';
    if (!LABELLED_POI_CATEGORY_SET.has(categoryKey)) {
        return false;
    }
    const name = typeof poi.name === 'string' ? poi.name.trim() : '';
    if (!name) {
        return false;
    }
    if (PEAK_CATEGORY_SET.has(categoryKey)) {
        const score = Number(poi.peakImportanceScore);
        if (Number.isFinite(score) && score > 0) {
            return true;
        }
        const elevation = Number(poi.elevation);
        if (Number.isFinite(elevation) && elevation >= PEAK_LABEL_ELEVATION_THRESHOLD_METERS) {
            return true;
        }
        return false;
    }
    return true;
}

export function resolvePoiName(properties = {}) {
    for (const key of POI_NAME_PROPERTIES) {
        const raw = properties[key];
        if (typeof raw === 'string') {
            const trimmed = raw.trim();
            if (trimmed) {
                return trimmed;
            }
        }
    }
    return '';
}

export function adjustHexColor(hex, ratio = 0) {
    if (typeof hex !== 'string' || !/^#([0-9a-f]{6})$/i.test(hex)) {
        return hex;
    }

    const normalized = hex.slice(1);
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    const clampedRatio = Math.max(-1, Math.min(1, Number(ratio) || 0));

    const transform = (channel) => {
        if (clampedRatio >= 0) {
            return Math.round(channel + (255 - channel) * clampedRatio);
        }
        return Math.round(channel * (1 + clampedRatio));
    };

    const toHex = (value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0');

    const nextR = toHex(transform(r));
    const nextG = toHex(transform(g));
    const nextB = toHex(transform(b));
    return `#${nextR}${nextG}${nextB}`;
}

export function escapeHtml(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}


export const EARTH_RADIUS_METERS = 6371000;

export function toRadians(value) {
    return (value * Math.PI) / 180;
}

export function toDegrees(value) {
    return (value * 180) / Math.PI;
}

export function haversineDistanceMeters(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) {
        return null;
    }
    const lat1 = Number(a[1]);
    const lat2 = Number(b[1]);
    const lon1 = Number(a[0]);
    const lon2 = Number(b[0]);
    if (!Number.isFinite(lat1) || !Number.isFinite(lat2) || !Number.isFinite(lon1) || !Number.isFinite(lon2)) {
        return null;
    }
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const radLat1 = toRadians(lat1);
    const radLat2 = toRadians(lat2);
    const sinLat = Math.sin(dLat / 2);
    const sinLon = Math.sin(dLon / 2);
    const aTerm = sinLat * sinLat + Math.cos(radLat1) * Math.cos(radLat2) * sinLon * sinLon;
    const c = 2 * Math.atan2(Math.sqrt(aTerm), Math.sqrt(Math.max(0, 1 - aTerm)));
    return EARTH_RADIUS_METERS * c;
}

export function bearingBetween(start, end) {
    if (!Array.isArray(start) || !Array.isArray(end) || start.length < 2 || end.length < 2) {
        return null;
    }
    const lat1 = toRadians(Number(start[1]));
    const lat2 = toRadians(Number(end[1]));
    const lon1 = toRadians(Number(start[0]));
    const lon2 = toRadians(Number(end[0]));
    if (!Number.isFinite(lat1) || !Number.isFinite(lat2) || !Number.isFinite(lon1) || !Number.isFinite(lon2)) {
        return null;
    }
    const dLon = lon2 - lon1;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    if (x === 0 && y === 0) {
        return 0;
    }
    let bearing = toDegrees(Math.atan2(y, x));
    if (!Number.isFinite(bearing)) {
        return null;
    }
    bearing = (bearing + 360) % 360;
    return bearing;
}

/**
 * Detect overlapping segments in a route (e.g., out-and-back sections)
 * and compute offset values to visually separate them.
 * 
 * @param {Array<[number, number]>} coordinates - Route coordinates [lng, lat]
 * @param {number} toleranceMeters - Distance threshold to consider points as overlapping
 * @returns {Object} { offsets: Float32Array, isOverlap: Uint8Array }
 */
export function computeRouteOverlapOffsets(coordinates, toleranceMeters = 15) {
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
        return { offsets: new Float32Array(0), isOverlap: new Uint8Array(0) };
    }

    const count = coordinates.length;
    const offsets = new Float32Array(count); // 0 = no offset, 1 = right, -1 = left (relative to direction)
    const isOverlap = new Uint8Array(count); // 1 = part of an overlap

    // Spatial index for faster neighbor lookup
    // Simple grid-based hashing
    const gridSize = 0.001; // ~100m
    const grid = new Map();
    const getGridKey = (lng, lat) => `${Math.floor(lng / gridSize)},${Math.floor(lat / gridSize)}`;

    for (let i = 0; i < count; i++) {
        const coord = coordinates[i];
        if (!Array.isArray(coord) || coord.length < 2) continue;
        const key = getGridKey(coord[0], coord[1]);
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(i);
    }

    // Minimum index distance to consider as "overlap" (avoid self-intersection of adjacent points)
    const minIndexGap = 10;

    for (let i = 0; i < count; i++) {
        const coord = coordinates[i];
        if (!Array.isArray(coord) || coord.length < 2) continue;

        const key = getGridKey(coord[0], coord[1]);
        const [gx, gy] = key.split(',').map(Number);

        // Check 3x3 grid cells
        const neighborKeys = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                neighborKeys.push(`${gx + dx},${gy + dy}`);
            }
        }

        for (const key of neighborKeys) {
            const indices = grid.get(key);
            if (!indices) continue;

            for (const j of indices) {
                // Skip if too close in sequence (not a real overlap)
                if (Math.abs(j - i) < minIndexGap) continue;

                // Check distance
                const other = coordinates[j];
                if (!Array.isArray(other) || other.length < 2) continue;

                const distance = haversineDistanceMeters(coord, other);
                if (distance === null || distance > toleranceMeters) continue;

                // Found an overlap! Mark both points
                isOverlap[i] = 1;
                isOverlap[j] = 1;

                // Determine which is "outbound" (earlier) vs "return" (later)
                // We want to push them apart.
                // Simple heuristic: earlier index = right offset, later index = left offset
                // This assumes out-and-back on the same side of the road logic
                if (i < j) {
                    offsets[i] = 1;
                } else {
                    offsets[i] = -1;
                }
            }
        }
    }

    // Smooth the offsets to avoid abrupt changes (simple moving average)
    const smoothed = new Float32Array(count);
    const smoothWindow = 3;
    for (let i = 0; i < count; i++) {
        let sum = 0;
        let weightSum = 0;
        for (let j = Math.max(0, i - smoothWindow); j <= Math.min(count - 1, i + smoothWindow); j++) {
            const weight = 1 - Math.abs(j - i) / (smoothWindow + 1);
            sum += offsets[j] * weight;
            weightSum += weight;
        }
        smoothed[i] = weightSum > 0 ? sum / weightSum : 0;
    }

    return { offsets: smoothed, isOverlap };
}

/**
 * Apply geometric offset to coordinates by shifting them perpendicular to the route direction.
 * This physically moves the coordinates rather than relying on MapLibre's line-offset property.
 * 
 * @param {Array<[number, number, number?]>} coordinates - Route coordinates [lng, lat, elevation?]
 * @param {Float32Array|Array<number>} offsets - Offset values in pixels (positive = right, negative = left)
 * @param {number} metersPerPixel - Conversion factor from pixels to meters (depends on zoom level, ~1-3m at typical zoom)
 * @returns {Array<[number, number, number?]>} New coordinates with geometric offset applied
 */
export function geometricOffsetCoordinates(coordinates, offsets, metersPerPixel = 2) {
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
        return coordinates;
    }
    if (!offsets || offsets.length !== coordinates.length) {
        return coordinates;
    }

    const count = coordinates.length;
    const result = new Array(count);

    // Earth radius for coordinate conversion
    const earthRadius = 6371000;

    for (let i = 0; i < count; i++) {
        const coord = coordinates[i];
        if (!Array.isArray(coord) || coord.length < 2) {
            result[i] = coord;
            continue;
        }

        const offsetPx = offsets[i] ?? 0;
        if (Math.abs(offsetPx) < 0.1) {
            // No significant offset, keep original
            result[i] = coord.slice();
            continue;
        }

        // Calculate bearing to next point (or from previous point for last)
        let bearing;
        if (i < count - 1) {
            bearing = bearingBetween(coord, coordinates[i + 1]);
        } else if (i > 0) {
            bearing = bearingBetween(coordinates[i - 1], coord);
        } else {
            result[i] = coord.slice();
            continue;
        }

        if (bearing === null) {
            result[i] = coord.slice();
            continue;
        }

        // Perpendicular bearing (right turn = +90 degrees)
        const perpBearing = (bearing + 90) % 360;
        const perpBearingRad = toRadians(perpBearing);

        // Convert offset from pixels to meters
        const offsetMeters = offsetPx * metersPerPixel;

        // Calculate new position
        const lat = coord[1];
        const lng = coord[0];
        const latRad = toRadians(lat);

        // Offset in degrees
        const deltaLat = (offsetMeters * Math.cos(perpBearingRad)) / earthRadius;
        const deltaLng = (offsetMeters * Math.sin(perpBearingRad)) / (earthRadius * Math.cos(latRad));

        const newLng = lng + toDegrees(deltaLng);
        const newLat = lat + toDegrees(deltaLat);

        // Preserve elevation if present
        if (coord.length > 2) {
            result[i] = [newLng, newLat, coord[2]];
        } else {
            result[i] = [newLng, newLat];
        }
    }

    return result;
}



function clampBounds(bounds) {
    if (!bounds) return null;
    return {
        west: Math.max(-180, Math.min(180, bounds.west)),
        south: Math.max(-90, Math.min(90, bounds.south)),
        east: Math.max(-180, Math.min(180, bounds.east)),
        north: Math.max(-90, Math.min(90, bounds.north))
    };
}

export function getBufferedRouteBounds(line, bufferMeters = POI_SEARCH_RADIUS_METERS) {
    if (!turfApi || typeof turfApi.buffer !== 'function' || typeof turfApi.bbox !== 'function') {
        return null;
    }
    try {
        const padded = turfApi.buffer(line, bufferMeters, { units: 'meters' });
        const bbox = turfApi.bbox(padded);
        if (!Array.isArray(bbox) || bbox.length !== 4) {
            return null;
        }
        const [west, south, east, north] = bbox.map((value) => Number.isFinite(value) ? value : null);
        if ([west, south, east, north].some((value) => value == null)) {
            return null;
        }
        if (east < west) {
            return null;
        }
        return clampBounds({ west, south, east, north });
    } catch (error) {
        console.warn('Failed to compute buffered bounds for POI fallback query', error);
        return null;
    }
}

export function buildOverpassPoiQuery(bounds, timeout = POI_FALLBACK_TIMEOUT_SECONDS) {
    if (!bounds) {
        return null;
    }
    const { west, south, east, north } = bounds;
    const bbox = `${south},${west},${north},${east}`;

    const filters = [
        'node["natural"="peak"]',
        'way["natural"="peak"]',
        'relation["natural"="peak"]',
        'node["natural"="volcano"]',
        'way["natural"="volcano"]',
        'relation["natural"="volcano"]',
        'node["natural"="saddle"]',
        'way["natural"="saddle"]',
        'relation["natural"="saddle"]',
        'node["natural"="mountain_pass"]',
        'way["natural"="mountain_pass"]',
        'relation["natural"="mountain_pass"]',
        'node["mountain_pass"="yes"]',
        'way["mountain_pass"="yes"]',
        'relation["mountain_pass"="yes"]',
        'node["tourism"="viewpoint"]',
        'way["tourism"="viewpoint"]',
        'relation["tourism"="viewpoint"]',
        'node["tourism"="alpine_hut"]',
        'way["tourism"="alpine_hut"]',
        'relation["tourism"="alpine_hut"]',
        'node["tourism"="wilderness_hut"]',
        'way["tourism"="wilderness_hut"]',
        'relation["tourism"="wilderness_hut"]',
        'node["amenity"="shelter"]',
        'way["amenity"="shelter"]',
        'relation["amenity"="shelter"]',
        'node["building"="cabin"]',
        'way["building"="cabin"]',
        'relation["building"="cabin"]',
        'node["natural"="spring"]',
        'way["natural"="spring"]',
        'node["amenity"="drinking_water"]',
        'way["amenity"="drinking_water"]',
        // Guideposts (hiking trail signs)
        'node["tourism"="information"]["information"="guidepost"]',
        'node["amenity"="parking"]',
        'way["amenity"="parking"]',
        'relation["amenity"="parking"]'
    ];
    const query = `
    [out:json][timeout:${timeout}];
    (
      ${filters.map(filter => `${filter}(${bbox});`).join('\n      ')}
    );
    out center;
  `;
    return query;
}

export async function fetchOverpassRoutePois(line, {
    bufferMeters = POI_MAX_SEARCH_RADIUS_METERS,
    endpoint = POI_FALLBACK_ENDPOINT,
    signal
} = {}) {
    const bounds = getBufferedRouteBounds(line, bufferMeters);
    if (!bounds) {
        return [];
    }
    const { west, east, south, north } = bounds;
    const lngSpan = Math.abs(east - west);
    const latSpan = Math.abs(north - south);
    if (lngSpan > POI_FALLBACK_MAX_BOUND_SPAN_DEGREES || latSpan > POI_FALLBACK_MAX_BOUND_SPAN_DEGREES) {
        return [];
    }
    const query = buildOverpassPoiQuery(bounds);
    if (!query) {
        return [];
    }

    try {
        const { pois } = await extractOverpassNetwork({
            query,
            endpoint,
            signal
        });
        return Array.isArray(pois?.features) ? pois.features : [];
    } catch (error) {
        if (signal && signal.aborted) {
            return [];
        }
        throw error;
    }
}

export function resolvePoiDefinition(properties = {}) {
    const candidates = [];
    const subclass = normalizePoiValue(properties.subclass);
    const className = normalizePoiValue(properties.class);
    const amenity = normalizePoiValue(properties.amenity);
    const tourism = normalizePoiValue(properties.tourism);
    const manMade = normalizePoiValue(properties.man_made);
    const natural = normalizePoiValue(properties.natural);
    [subclass, className, amenity, tourism, manMade, natural]
        .filter((value, index, array) => value && array.indexOf(value) === index)
        .forEach((value) => {
            candidates.push(value);
        });
    for (const candidate of candidates) {
        if (candidate && POI_ICON_DEFINITIONS[candidate] && isElevationProfilePoiCategory(candidate)) {
            return { key: candidate, definition: POI_ICON_DEFINITIONS[candidate] };
        }
    }
    return null;
}

export function buildPoiIdentifier(categoryKey, coordinates, rawId) {
    if (typeof rawId === 'string' && rawId.trim()) {
        return `${categoryKey}:${rawId.trim()}`;
    }
    if (Number.isFinite(rawId)) {
        return `${categoryKey}:${rawId}`;
    }
    if (Array.isArray(coordinates) && coordinates.length >= 2) {
        const lng = Number(coordinates[0]);
        const lat = Number(coordinates[1]);
        if (Number.isFinite(lng) && Number.isFinite(lat)) {
            const precision = 1e6;
            const lngKey = Math.round(lng * precision) / precision;
            const latKey = Math.round(lat * precision) / precision;
            return `${categoryKey}:${lngKey},${latKey}`;
        }
    }
    const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    return `${categoryKey}:${randomId}`;
}
