/**
 * Geocoder Control Module
 * Provides fast location search using Photon plus Nominatim metadata enrichment.
 */

import {
    PEAK_ELEVATION_THRESHOLDS,
    PEAK_IMPORTANCE_VALUE_MAP,
    PEAK_PRINCIPAL_ICON_THRESHOLD,
    PEAK_PROMINENCE_THRESHOLDS,
    PEAK_ROLE_VALUE_MAP,
    POI_ICON_DEFINITIONS
} from '../directions/constants/directions-constants.js';

const DEFAULT_PHOTON_ENDPOINT = 'https://photon.komoot.io/api/';
const NOMINATIM_SEARCH_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_LOOKUP_ENDPOINT = 'https://nominatim.openstreetmap.org/lookup';
const SEARCH_ICON_BASE_URL = new URL('../../data/icons_Xmap/', import.meta.url).href;
const DEFAULT_LIMIT = 12;
const PHOTON_FETCH_LIMIT = 18;
const PHOTON_OUTDOOR_LIMIT = 10;
const PHOTON_ARTICLE_VARIANT_REQUEST_LIMIT = 2;
const NOMINATIM_ENRICH_LIMIT = 8;
const CACHE_TTL_MS = 2 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const PHOTON_BACKOFF_MS = 45 * 1000;

const searchCache = new Map();
const nominatimLookupCache = new Map();
let latestGeocodeRequest = 0;
let lastRenderedQuery = '';
let photonUnavailableUntil = 0;
let lastPhotonFailureLog = 0;

const CATEGORY_META = Object.freeze({
    peak: { label: 'Peak', className: 'peak', priority: 48 },
    volcano: { label: 'Volcano', className: 'peak', priority: 46 },
    mountain_pass: { label: 'Pass', className: 'pass', priority: 42 },
    saddle: { label: 'Saddle', className: 'pass', priority: 39 },
    alpine_hut: { label: 'Refuge', className: 'hut', priority: 38 },
    wilderness_hut: { label: 'Hut', className: 'hut', priority: 36 },
    hut: { label: 'Hut', className: 'hut', priority: 34 },
    viewpoint: { label: 'Viewpoint', className: 'viewpoint', priority: 32 },
    lake: { label: 'Lake', className: 'water', priority: 30 },
    water: { label: 'Water', className: 'water', priority: 24 },
    city: { label: 'City', className: 'place', priority: 26 },
    town: { label: 'Town', className: 'place', priority: 24 },
    village: { label: 'Village', className: 'place', priority: 22 },
    state: { label: 'Region', className: 'region', priority: 18 },
    county: { label: 'Area', className: 'region', priority: 16 },
    country: { label: 'Country', className: 'region', priority: 14 },
    place: { label: 'Place', className: 'place', priority: 18 },
    poi: { label: 'POI', className: 'poi', priority: 12 }
});

const SEARCH_ICON_FALLBACKS = Object.freeze({
    peak: 'peak_minor',
    volcano: 'peak_minor',
    mountain_pass: 'saddle',
    saddle: 'saddle',
    alpine_hut: 'cabin',
    wilderness_hut: 'cabin',
    hut: 'cabin',
    viewpoint: 'viewpoint',
    lake: 'water',
    water: 'water',
    city: 'signpost',
    town: 'signpost',
    village: 'signpost',
    state: 'signpost',
    county: 'signpost',
    country: 'signpost',
    place: 'signpost',
    poi: 'signpost'
});

const DEDUPE_BY_NAME_LOCATION_CATEGORIES = new Set([
    'water',
    'lake',
    'poi',
    'place',
    'city',
    'town',
    'village',
    'state',
    'county',
    'country'
]);

const OUTDOOR_CATEGORIES = new Set([
    'peak',
    'volcano',
    'mountain_pass',
    'saddle',
    'alpine_hut',
    'wilderness_hut',
    'hut',
    'viewpoint',
    'lake',
    'water'
]);

const ELEVATION_REQUIRED_CATEGORIES = new Set([
    'peak',
    'volcano',
    'mountain_pass',
    'saddle'
]);

const ELEVATION_DISPLAY_CATEGORIES = new Set([
    'peak',
    'volcano',
    'mountain_pass',
    'saddle',
    'lake',
    'water'
]);

const PHOTON_OUTDOOR_TAG_FILTERS = Object.freeze([
    'natural:peak',
    'natural:volcano',
    'natural:saddle',
    'natural:mountain_pass',
    'tourism:alpine_hut'
]);
const ARTICLE_VARIANT_PREFIXES = Object.freeze(['la', 'le', 'les', "l'"]);
const ARTICLE_VARIANT_TAG_FILTERS = Object.freeze([
    'natural:peak',
    'natural:volcano',
    'tourism:viewpoint',
    'tourism:alpine_hut'
]);

function normalizeText(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function highlightMatch(value, query = lastRenderedQuery) {
    const text = String(value ?? '');
    const normalizedText = normalizeText(text);
    const normalizedQuery = normalizeText(query);
    if (!normalizedText || !normalizedQuery) return escapeHtml(text);

    const index = normalizedText.indexOf(normalizedQuery);
    if (index < 0) return escapeHtml(text);

    return [
        escapeHtml(text.slice(0, index)),
        '<strong>',
        escapeHtml(text.slice(index, index + normalizedQuery.length)),
        '</strong>',
        escapeHtml(text.slice(index + normalizedQuery.length))
    ].join('');
}

function getPreferredLanguage() {
    const language = typeof navigator !== 'undefined'
        ? (navigator.languages?.[0] || navigator.language || '')
        : '';
    const code = language.split('-')[0].toLowerCase();
    return code || 'fr';
}

function getMapBias(map) {
    if (!map || typeof map.getCenter !== 'function') return null;
    const center = map.getCenter();
    if (!center || !Number.isFinite(center.lng) || !Number.isFinite(center.lat)) return null;
    const zoom = typeof map.getZoom === 'function' ? map.getZoom() : 12;
    return {
        lon: center.lng,
        lat: center.lat,
        zoom: Number.isFinite(zoom) ? zoom : 12
    };
}

function buildCacheKey(query, bias, limit, language, endpoint = '') {
    const q = normalizeText(query);
    const lon = bias ? Math.round(bias.lon * 10) / 10 : 0;
    const lat = bias ? Math.round(bias.lat * 10) / 10 : 0;
    const zoom = bias ? Math.round(bias.zoom) : 0;
    return `${language}|${limit}|${endpoint}|${q}|${lon}|${lat}|${zoom}`;
}

function getCachedSearch(key) {
    const entry = searchCache.get(key);
    if (!entry) return null;
    if (performance.now() - entry.timestamp > CACHE_TTL_MS) {
        searchCache.delete(key);
        return null;
    }
    return entry.value;
}

function setCachedSearch(key, value) {
    searchCache.set(key, { value, timestamp: performance.now() });
    if (searchCache.size > 80) {
        const firstKey = searchCache.keys().next().value;
        if (firstKey) searchCache.delete(firstKey);
    }
}

async function fetchJsonWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
                Accept: 'application/json',
                ...(options.headers || {})
            }
        });
        if (!response.ok) {
            throw new Error(`Search request failed: ${response.status}`);
        }
        return await response.json();
    } finally {
        clearTimeout(timeout);
    }
}

function isPhotonUnavailable() {
    return performance.now() < photonUnavailableUntil;
}

function markPhotonUnavailable(error) {
    const now = performance.now();
    photonUnavailableUntil = now + PHOTON_BACKOFF_MS;
    if (!lastPhotonFailureLog || now - lastPhotonFailureLog > PHOTON_BACKOFF_MS) {
        lastPhotonFailureLog = now;
        console.warn('Photon geocoder unavailable, falling back to Nominatim:', error?.message || error);
    }
}

function getPhotonEndpoint(optionEndpoint = '') {
    const globalEndpoint = typeof window !== 'undefined'
        ? window.XPLORE_PHOTON_ENDPOINT
        : '';
    const endpoint = String(optionEndpoint || globalEndpoint || DEFAULT_PHOTON_ENDPOINT).trim();
    return endpoint || DEFAULT_PHOTON_ENDPOINT;
}

function appendSearchParams(url, params) {
    const separator = url.includes('?')
        ? (url.endsWith('?') || url.endsWith('&') ? '' : '&')
        : '?';
    return `${url}${separator}${params.toString()}`;
}

function parseElevation(properties = {}) {
    const candidates = [
        properties.ele,
        properties.elevation,
        properties.altitude,
        properties.extratags?.ele,
        properties.extratags?.elevation,
        properties.extratags?.altitude,
        properties.extra?.ele,
        properties.extra?.elevation,
        properties.extra?.altitude
    ];
    for (const candidate of candidates) {
        if (candidate == null) continue;
        const numeric = Number(String(candidate).replace(/[^\d.-]/g, ''));
        if (Number.isFinite(numeric)) return numeric;
    }
    return null;
}

function parseProminence(properties = {}) {
    const candidates = [
        properties.prominence,
        properties['prominence:meters'],
        properties['prominence:metres'],
        properties.extratags?.prominence,
        properties.extratags?.['prominence:meters'],
        properties.extratags?.['prominence:metres']
    ];
    for (const candidate of candidates) {
        if (candidate == null) continue;
        const numeric = Number(String(candidate).replace(/[^\d.-]/g, ''));
        if (Number.isFinite(numeric)) return numeric;
    }
    return null;
}

function parseSearchNumber(value) {
    if (value == null) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const match = String(value).trim().replace(',', '.').match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const numeric = Number(match[0]);
    return Number.isFinite(numeric) ? numeric : null;
}

function normalizeTagValue(value) {
    return normalizeText(value).replace(/_/g, '-');
}

function getTagValue(properties = {}, keys = []) {
    for (const key of keys) {
        const value = properties?.[key]
            ?? properties?.extratags?.[key]
            ?? properties?.extra?.[key];
        if (value != null && String(value).trim()) return value;
    }
    return null;
}

function computePeakImportance(properties = {}, fallbackElevation = null, fallbackProminence = null) {
    const importanceValue = normalizeTagValue(getTagValue(properties, ['importance', 'importance:level']));
    let score = importanceValue && PEAK_IMPORTANCE_VALUE_MAP.has(importanceValue)
        ? PEAK_IMPORTANCE_VALUE_MAP.get(importanceValue)
        : 0;

    const rankValue = parseSearchNumber(getTagValue(properties, ['rank']));
    if (Number.isFinite(rankValue)) {
        const clampedRank = Math.max(0, Math.min(rankValue, 9));
        score = Math.max(score, Math.max(0, 6 - Math.min(clampedRank, 6)));
    }

    const peakRole = normalizeTagValue(getTagValue(properties, ['peak']));
    if (peakRole && PEAK_ROLE_VALUE_MAP.has(peakRole)) {
        score = Math.max(score, PEAK_ROLE_VALUE_MAP.get(peakRole));
    }

    let prominence = parseProminence(properties);
    if (!Number.isFinite(prominence) && Number.isFinite(fallbackProminence)) {
        prominence = fallbackProminence;
    }
    if (Number.isFinite(prominence)) {
        for (const threshold of PEAK_PROMINENCE_THRESHOLDS) {
            if (prominence >= threshold.min) {
                score = Math.max(score, threshold.score);
                break;
            }
        }
    }

    let elevation = parseElevation(properties);
    if (!Number.isFinite(elevation) && Number.isFinite(fallbackElevation)) {
        elevation = fallbackElevation;
    }
    if (Number.isFinite(elevation)) {
        for (const threshold of PEAK_ELEVATION_THRESHOLDS) {
            if (elevation >= threshold.min) {
                score = Math.max(score, threshold.score);
                break;
            }
        }
    }

    return {
        score,
        importance: importanceValue,
        rank: Number.isFinite(rankValue) ? rankValue : null,
        peakRole,
        prominence: Number.isFinite(prominence) ? prominence : null,
        elevation: Number.isFinite(elevation) ? elevation : null
    };
}

function getSearchIconKey(category, properties = {}) {
    if (category === 'peak' || category === 'volcano') {
        const peakScore = Number(properties.xplorePeakImportanceScore);
        return Number.isFinite(peakScore) && peakScore >= PEAK_PRINCIPAL_ICON_THRESHOLD
            ? 'peak_principal'
            : 'peak_minor';
    }
    return POI_ICON_DEFINITIONS[category]?.icon || SEARCH_ICON_FALLBACKS[category] || 'signpost';
}

function getSearchIconColor(category, iconKey) {
    if (iconKey === 'peak_principal') return '#ff3b30';
    return POI_ICON_DEFINITIONS[category]?.color || '#7bb7ff';
}

function getSearchIconUrl(iconKey) {
    const safeKey = typeof iconKey === 'string' && iconKey.trim() ? iconKey.trim() : 'signpost';
    return new URL(`${encodeURIComponent(safeKey)}.svg`, SEARCH_ICON_BASE_URL).href;
}

function applyPeakClassification(feature) {
    const props = feature?.properties || {};
    const category = props.xploreCategory;
    if (category !== 'peak' && category !== 'volcano') {
        props.xploreIconKey = getSearchIconKey(category, props);
        props.xploreIconColor = getSearchIconColor(category, props.xploreIconKey);
        return feature;
    }

    const peak = computePeakImportance(props, props.xploreElevation, props.xploreProminence);
    props.xplorePeakImportanceScore = peak.score;
    props.xplorePeakClass = peak.score >= PEAK_PRINCIPAL_ICON_THRESHOLD ? 'principal' : 'minor';
    props.xplorePeakClassLabel = props.xplorePeakClass === 'principal'
        ? (category === 'volcano' ? 'Major volcano' : 'Major peak')
        : (category === 'volcano' ? 'Volcano' : 'Peak');
    if (Number.isFinite(peak.prominence)) props.xploreProminence = peak.prominence;
    if (Number.isFinite(peak.elevation)) props.xploreElevation = peak.elevation;
    props.xploreIconKey = getSearchIconKey(category, props);
    props.xploreIconColor = getSearchIconColor(category, props.xploreIconKey);
    return feature;
}

function shouldDisplayElevationForCategory(category) {
    return ELEVATION_DISPLAY_CATEGORIES.has(category);
}

function shouldDisplayElevation(featureOrProperties) {
    const props = featureOrProperties?.properties || featureOrProperties || {};
    return shouldDisplayElevationForCategory(props.xploreCategory);
}

function classifyPhotonFeature(properties = {}) {
    const key = normalizeText(properties.osm_key);
    const value = normalizeText(properties.osm_value);

    if (key === 'natural' && value === 'peak') return 'peak';
    if (key === 'natural' && value === 'volcano') return 'volcano';
    if (key === 'natural' && value === 'saddle') return 'saddle';
    if (key === 'natural' && value === 'mountain_pass') return 'mountain_pass';
    if (key === 'mountain_pass' && ['yes', 'true'].includes(value)) return 'mountain_pass';
    if (key === 'tourism' && value === 'alpine_hut') return 'alpine_hut';
    if (key === 'tourism' && value === 'wilderness_hut') return 'wilderness_hut';
    if (key === 'tourism' && value === 'viewpoint') return 'viewpoint';
    if (key === 'amenity' && value === 'shelter') return 'hut';
    if (key === 'building' && value === 'cabin') return 'hut';
    if (key === 'natural' && ['water', 'lake'].includes(value)) return 'lake';
    if (key === 'water') return 'water';
    if (key === 'waterway' && ['river', 'stream'].includes(value)) return 'water';

    if (key === 'place') {
        if (CATEGORY_META[value]) return value;
        return 'place';
    }

    if (CATEGORY_META[value]) return value;
    return 'poi';
}

function classifyNominatimFeature(properties = {}) {
    const className = normalizeText(properties.class);
    const type = normalizeText(properties.type);
    const category = normalizeText(properties.category);
    const natural = normalizeText(properties.extratags?.natural);
    const tourism = normalizeText(properties.extratags?.tourism);
    const amenity = normalizeText(properties.extratags?.amenity);

    if (className === 'natural' && type === 'peak') return 'peak';
    if (className === 'natural' && type === 'volcano') return 'volcano';
    if (className === 'natural' && type === 'saddle') return 'saddle';
    if (className === 'natural' && type === 'mountain_pass') return 'mountain_pass';
    if (className === 'natural' && ['water', 'lake'].includes(type)) return 'lake';
    if (className === 'waterway') return 'water';
    if (className === 'tourism' && type === 'alpine_hut') return 'alpine_hut';
    if (className === 'tourism' && type === 'wilderness_hut') return 'wilderness_hut';
    if (className === 'tourism' && type === 'viewpoint') return 'viewpoint';
    if (natural === 'peak') return 'peak';
    if (natural === 'volcano') return 'volcano';
    if (natural === 'saddle') return 'saddle';
    if (natural === 'mountain_pass') return 'mountain_pass';
    if (tourism === 'alpine_hut') return 'alpine_hut';
    if (tourism === 'wilderness_hut') return 'wilderness_hut';
    if (tourism === 'viewpoint') return 'viewpoint';
    if (amenity === 'shelter') return 'hut';
    if (className === 'place' && CATEGORY_META[type]) return type;
    if (CATEGORY_META[type]) return type;
    if (CATEGORY_META[category]) return category;
    return className === 'place' ? 'place' : 'poi';
}

function startsWithArticle(query) {
    const normalized = normalizeText(query);
    return ARTICLE_VARIANT_PREFIXES.some((prefix) => (
        prefix.endsWith("'")
            ? normalized.startsWith(prefix)
            : normalized === prefix || normalized.startsWith(`${prefix} `)
    ));
}

function isSingleTokenQuery(query) {
    return normalizeText(query).split(/\s+/).filter(Boolean).length === 1;
}

function buildArticleVariantQueries(query) {
    const normalized = normalizeText(query);
    if (normalized.length < 5 || !isSingleTokenQuery(query) || startsWithArticle(query)) return [];
    return ARTICLE_VARIANT_PREFIXES.map((prefix) => (
        prefix.endsWith("'") ? `${prefix}${query}` : `${prefix} ${query}`
    ));
}

function hasGoodOutdoorResult(features, query) {
    const normalizedQuery = normalizeText(query);
    return features.some((feature) => {
        const props = feature?.properties || {};
        const category = props.xploreCategory;
        if (!OUTDOOR_CATEGORIES.has(category)) return false;
        const title = normalizeText(props.xploreTitle || feature.text || '');
        if (!title.includes(normalizedQuery)) return false;
        if (shouldDisplayElevationForCategory(category)) return true;
        const elevation = Number(props.xploreElevation);
        return Number.isFinite(elevation) && elevation > 20;
    });
}

function hasStrongPlaceResult(features, query) {
    const normalizedQuery = normalizeText(query);
    return features.slice(0, 4).some((feature) => {
        const props = feature?.properties || {};
        const category = props.xploreCategory;
        if (!['city', 'town', 'village', 'state', 'county', 'country', 'place'].includes(category)) return false;
        const title = normalizeText(props.xploreTitle || feature.text || '');
        return title === normalizedQuery || title.startsWith(normalizedQuery);
    });
}

function photonExtentToBbox(extent) {
    if (!Array.isArray(extent) || extent.length < 4) return null;
    const [minLon, maxLat, maxLon, minLat] = extent.map(Number);
    if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return null;
    return [minLon, minLat, maxLon, maxLat];
}

function normalizeOsmType(value) {
    const type = normalizeText(value);
    if (type === 'n' || type === 'node') return 'N';
    if (type === 'w' || type === 'way') return 'W';
    if (type === 'r' || type === 'relation') return 'R';
    return '';
}

function makeOsmLookupId(osmType, osmId) {
    const type = normalizeOsmType(osmType);
    const id = Number(osmId);
    return type && Number.isFinite(id) ? `${type}${Math.trunc(id)}` : '';
}

function makeNominatimLookupKey(item = {}) {
    return makeOsmLookupId(item.osm_type, item.osm_id);
}

function buildSubtitle(properties = {}) {
    const parts = [];
    const place = properties.city || properties.county || properties.state;
    const country = properties.country;
    if (place && place !== properties.name) parts.push(place);
    if (country && country !== place) parts.push(country);
    return parts.filter(Boolean).join(', ');
}

function toSearchFeature(feature, source = 'photon') {
    const properties = feature?.properties || {};
    const coordinates = feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

    const center = [Number(coordinates[0]), Number(coordinates[1])];
    if (!center.every(Number.isFinite)) return null;

    const category = source === 'photon'
        ? classifyPhotonFeature(properties)
        : classifyNominatimFeature(properties);
    const meta = CATEGORY_META[category] || CATEGORY_META.poi;
    const title = properties.name || properties.display_name || properties.label || 'Unnamed place';
    const subtitle = source === 'photon'
        ? buildSubtitle(properties)
        : (properties.display_name || '').split(',').slice(1, 3).join(',').trim();
    const elevation = shouldDisplayElevationForCategory(category) ? parseElevation(properties) : null;
    const bbox = source === 'photon'
        ? photonExtentToBbox(properties.extent)
        : (Array.isArray(feature.bbox) ? feature.bbox : null);
    const osmId = properties.osm_id ? makeOsmLookupId(properties.osm_type, properties.osm_id) : '';

    const searchFeature = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: center },
        place_name: subtitle ? `${title}, ${subtitle}` : title,
        text: title,
        place_type: [category],
        center,
        bbox,
        properties: {
            ...properties,
            xploreSearchSource: source,
            xploreCategory: category,
            xploreCategoryLabel: meta.label,
            xploreCategoryClass: meta.className,
            xploreTitle: title,
            xploreSubtitle: subtitle,
            xploreElevation: elevation,
            xploreProminence: parseProminence(properties),
            xploreOsmKey: properties.osm_key || '',
            xploreOsmValue: properties.osm_value || '',
            xploreOsmId: osmId
        }
    };

    return applyPeakClassification(searchFeature);
}

function scoreFeature(feature, query, index) {
    const props = feature.properties || {};
    const category = props.xploreCategory || 'poi';
    const meta = CATEGORY_META[category] || CATEGORY_META.poi;
    const title = normalizeText(props.xploreTitle || feature.text || '');
    const q = normalizeText(query);
    let score = 100 - index * 2 + meta.priority;

    if (title === q) score += 60;
    else if (title.startsWith(q)) score += 28;
    else if (title.includes(` ${q}`)) score += 16;
    else if (title.includes(q)) score += 8;

    if (OUTDOOR_CATEGORIES.has(category)) score += 12;

    const elevation = Number(props.xploreElevation);
    if (Number.isFinite(elevation) && ['peak', 'volcano', 'mountain_pass', 'saddle'].includes(category)) {
        score += Math.min(32, Math.max(0, elevation / 180));
    } else if (ELEVATION_REQUIRED_CATEGORIES.has(category)) {
        score -= 12;
    }

    const prominence = Number(props.xploreProminence);
    if (Number.isFinite(prominence) && ['peak', 'volcano'].includes(category)) {
        score += Math.min(42, Math.max(0, prominence / 45));
    }

    const peakScore = Number(props.xplorePeakImportanceScore);
    if (Number.isFinite(peakScore) && ['peak', 'volcano'].includes(category)) {
        score += peakScore * 8;
    }

    const importance = Number(props.xploreImportance);
    if (Number.isFinite(importance)) {
        score += Math.min(28, Math.max(0, importance * 70));
    }

    return score;
}

function dedupeFeatures(features) {
    const seen = new Set();
    const seenSpatial = new Set();
    const seenNameLocation = new Set();
    return features.filter((feature) => {
        const props = feature.properties || {};
        const sourceId = props.xploreOsmId;
        const center = feature.center || feature.geometry?.coordinates || [];
        const title = normalizeText(props.xploreTitle || feature.text);
        const category = props.xploreCategory || '';
        const subtitle = normalizeText(props.xploreSubtitle || props.city || props.country || '');
        const key = sourceId || [
            title,
            category,
            Number(center[0]).toFixed(5),
            Number(center[1]).toFixed(5)
        ].join('|');
        if (seen.has(key)) return false;
        seen.add(key);

        const spatialKey = [
            title,
            category,
            Number(center[0]).toFixed(3),
            Number(center[1]).toFixed(3)
        ].join('|');
        if (seenSpatial.has(spatialKey)) return false;
        seenSpatial.add(spatialKey);

        if (DEDUPE_BY_NAME_LOCATION_CATEGORIES.has(category)) {
            const semanticKey = [title, category, subtitle].join('|');
            if (seenNameLocation.has(semanticKey)) return false;
            seenNameLocation.add(semanticKey);
        }

        return true;
    });
}

function rankFeatures(features, query) {
    const ranked = features
        .map((feature, index) => ({ feature, score: scoreFeature(feature, query, index) }))
        .sort((a, b) => b.score - a.score)
        .map(({ feature }) => feature);
    return dedupeFeatures(ranked);
}

async function fetchPhotonFeatures(query, {
    map = null,
    limit = DEFAULT_LIMIT,
    language = getPreferredLanguage(),
    osmTags = null,
    photonEndpoint = DEFAULT_PHOTON_ENDPOINT
} = {}) {
    if (isPhotonUnavailable()) return [];

    const bias = getMapBias(map);
    const params = new URLSearchParams({
        q: query,
        limit: String(limit),
        lang: language,
        dedupe: '1'
    });

    if (Array.isArray(osmTags)) {
        osmTags.forEach((tag) => {
            if (tag) params.append('osm_tag', tag);
        });
    }

    if (bias) {
        params.set('lon', bias.lon.toFixed(6));
        params.set('lat', bias.lat.toFixed(6));
        params.set('zoom', String(Math.round(bias.zoom)));
        params.set('location_bias_scale', '0.35');
    }

    const request = appendSearchParams(photonEndpoint, params);
    try {
        const geojson = await fetchJsonWithTimeout(request);
        photonUnavailableUntil = 0;
        return (geojson.features || [])
            .map((feature) => toSearchFeature(feature, 'photon'))
            .filter(Boolean);
    } catch (error) {
        markPhotonUnavailable(error);
        return [];
    }
}

async function fetchPhotonOutdoorFeatures(query, {
    map = null,
    language = getPreferredLanguage(),
    photonEndpoint = DEFAULT_PHOTON_ENDPOINT
} = {}) {
    const normalizedQuery = normalizeText(query);
    if (normalizedQuery.length < 4 || isPhotonUnavailable()) return [];

    return fetchPhotonFeatures(query, {
        map,
        limit: PHOTON_OUTDOOR_LIMIT,
        language,
        osmTags: PHOTON_OUTDOOR_TAG_FILTERS,
        photonEndpoint
    });
}

async function fetchPhotonArticleVariantFeatures(query, {
    map = null,
    language = getPreferredLanguage(),
    photonEndpoint = DEFAULT_PHOTON_ENDPOINT
} = {}) {
    const queryVariants = buildArticleVariantQueries(query).slice(0, PHOTON_ARTICLE_VARIANT_REQUEST_LIMIT);
    if (!queryVariants.length || isPhotonUnavailable()) return [];

    const requests = queryVariants.map((variant) => fetchPhotonFeatures(variant, {
        map,
        limit: PHOTON_OUTDOOR_LIMIT,
        language,
        osmTags: ARTICLE_VARIANT_TAG_FILTERS,
        photonEndpoint
    }).catch(() => []));
    const groups = await Promise.all(requests);
    return groups.flat();
}

async function fetchNominatimFeatures(query, { limit = 6 } = {}) {
    const params = new URLSearchParams({
        q: query,
        format: 'geojson',
        polygon_geojson: '0',
        addressdetails: '1',
        extratags: '1',
        namedetails: '1',
        limit: String(limit)
    });

    const request = `${NOMINATIM_SEARCH_ENDPOINT}?${params.toString()}`;
    const geojson = await fetchJsonWithTimeout(request);
    return (geojson.features || [])
        .map((feature) => {
            if (feature.bbox && feature.bbox.length >= 4) {
                feature.geometry = {
                    type: 'Point',
                    coordinates: [
                        feature.bbox[0] + (feature.bbox[2] - feature.bbox[0]) / 2,
                        feature.bbox[1] + (feature.bbox[3] - feature.bbox[1]) / 2
                    ]
                };
            }
            return toSearchFeature(feature, 'nominatim');
        })
        .filter(Boolean);
}

async function fetchFallbackNominatimFeatures(query, { limit = 6 } = {}) {
    try {
        return await fetchNominatimFeatures(query, { limit });
    } catch (error) {
        console.warn('Nominatim geocoder fallback failed:', error);
        return [];
    }
}

function needsNominatimEnrichment(feature) {
    const props = feature?.properties || {};
    if (!props.xploreOsmId || !shouldDisplayElevationForCategory(props.xploreCategory)) return false;
    const elevation = Number(props.xploreElevation);
    const prominence = Number(props.xploreProminence);
    if (props.xploreCategory === 'peak' || props.xploreCategory === 'volcano') {
        return !Number.isFinite(elevation) || elevation <= 1 || !Number.isFinite(prominence);
    }
    return !Number.isFinite(elevation) || elevation <= 1;
}

function applyNominatimLookup(feature, lookup) {
    if (!feature?.properties || !lookup) return feature;

    const elevation = shouldDisplayElevation(feature) ? parseElevation(lookup) : null;
    if (Number.isFinite(elevation)) {
        feature.properties.xploreElevation = elevation;
        feature.properties.xploreElevationSource = 'nominatim';
    }

    const prominence = parseProminence(lookup);
    if (Number.isFinite(prominence)) {
        feature.properties.xploreProminence = prominence;
    }

    if (lookup.importance != null) {
        const importance = Number(lookup.importance);
        if (Number.isFinite(importance)) feature.properties.xploreImportance = importance;
    }

    const wikidata = lookup.extratags?.wikidata;
    if (wikidata) feature.properties.xploreWikidata = wikidata;

    if (lookup.address) {
        feature.properties.xploreNominatimAddress = lookup.address;
    }

    return applyPeakClassification(feature);
}

async function fetchNominatimLookups(osmIds) {
    const missingIds = osmIds.filter((id) => id && !nominatimLookupCache.has(id));
    if (missingIds.length) {
        const params = new URLSearchParams({
            osm_ids: missingIds.join(','),
            format: 'jsonv2',
            extratags: '1',
            namedetails: '1',
            addressdetails: '1'
        });
        const request = `${NOMINATIM_LOOKUP_ENDPOINT}?${params.toString()}`;
        const rows = await fetchJsonWithTimeout(request);
        const found = new Set();
        for (const row of Array.isArray(rows) ? rows : []) {
            const key = makeNominatimLookupKey(row);
            if (!key) continue;
            found.add(key);
            nominatimLookupCache.set(key, row);
        }
        missingIds.forEach((id) => {
            if (!found.has(id)) nominatimLookupCache.set(id, null);
        });
    }

    const lookupMap = new Map();
    osmIds.forEach((id) => {
        if (id && nominatimLookupCache.has(id)) {
            lookupMap.set(id, nominatimLookupCache.get(id));
        }
    });
    return lookupMap;
}

async function enrichOutdoorFeaturesWithNominatim(features) {
    const ids = [];
    const seen = new Set();
    for (const feature of features) {
        if (!needsNominatimEnrichment(feature)) continue;
        const id = feature.properties.xploreOsmId;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
        if (ids.length >= NOMINATIM_ENRICH_LIMIT) break;
    }

    if (!ids.length) return features;

    try {
        const lookupMap = await fetchNominatimLookups(ids);
        return features.map((feature) => {
            const id = feature?.properties?.xploreOsmId;
            return id && lookupMap.has(id)
                ? applyNominatimLookup(feature, lookupMap.get(id))
                : feature;
        });
    } catch (error) {
        console.warn('Nominatim enrichment failed:', error);
        return features;
    }
}

/**
 * Create a geocoder API adapter for Photon.
 * @returns {Object} Geocoder API compatible with MaplibreGeocoder
 */
function createPhotonGeocoderApi(map, options = {}) {
    return {
        forwardGeocode: async (config) => {
            const query = String(config.query || '').trim();
            lastRenderedQuery = query;
            if (query.length < 2) return { features: [] };

            const requestId = ++latestGeocodeRequest;
            const limit = Number.isFinite(options.limit) ? options.limit : DEFAULT_LIMIT;
            const language = options.language || getPreferredLanguage();
            const photonEndpoint = getPhotonEndpoint(options.photonEndpoint);
            const bias = getMapBias(map);
            const cacheKey = buildCacheKey(query, bias, limit, language, photonEndpoint);
            const cached = getCachedSearch(cacheKey);
            if (cached) return { features: cached };

            try {
                const genericPhoton = await fetchPhotonFeatures(query, {
                    map,
                    limit: Math.max(limit, PHOTON_FETCH_LIMIT),
                    language,
                    photonEndpoint
                });
                const outdoorPhoton = isPhotonUnavailable()
                    ? []
                    : await fetchPhotonOutdoorFeatures(query, { map, language, photonEndpoint });
                let features = [...outdoorPhoton, ...genericPhoton];

                if (
                    !isPhotonUnavailable()
                    && !hasGoodOutdoorResult(features, query)
                    && !hasStrongPlaceResult(features, query)
                ) {
                    const articleVariants = await fetchPhotonArticleVariantFeatures(query, {
                        map,
                        language,
                        photonEndpoint
                    });
                    features = [...articleVariants, ...features];
                }

                if (!features.length) {
                    features = await fetchFallbackNominatimFeatures(query, { limit: Math.min(limit, 8) });
                }

                if (requestId !== latestGeocodeRequest) return { features: [] };

                let ranked = rankFeatures(features, query);
                ranked = await enrichOutdoorFeaturesWithNominatim(ranked);
                if (requestId !== latestGeocodeRequest) return { features: [] };
                ranked = rankFeatures(ranked, query).slice(0, limit);
                setCachedSearch(cacheKey, ranked);
                return { features: ranked };
            } catch (e) {
                console.error('Geocoder error:', e);
                return { features: [] };
            }
        }
    };
}

function formatElevation(value) {
    const elevation = Number(value);
    if (!Number.isFinite(elevation)) return '';
    return `${Math.round(elevation).toLocaleString()} m`;
}

function renderSearchResult(item) {
    const props = item.properties || {};
    const categoryLabel = escapeHtml(props.xplorePeakClassLabel || props.xploreCategoryLabel || 'Place');
    const title = highlightMatch(props.xploreTitle || item.text || item.place_name || '');
    const subtitle = escapeHtml(props.xploreSubtitle || '');
    const elevation = shouldDisplayElevation(props) ? formatElevation(props.xploreElevation) : '';
    const iconKey = props.xploreIconKey || getSearchIconKey(props.xploreCategory || 'poi', props);
    const iconColor = props.xploreIconColor || getSearchIconColor(props.xploreCategory || 'poi', iconKey);
    const iconUrl = getSearchIconUrl(iconKey);
    const iconStyle = [
        `--xplore-search-icon-url:url('${escapeHtml(iconUrl)}')`,
        `--xplore-search-icon-color:${escapeHtml(iconColor)}`
    ].join(';');

    return `
        <div class="xplore-search-result">
            <div class="xplore-search-result__icon" style="${iconStyle}" aria-hidden="true"></div>
            <div class="xplore-search-result__body">
                <div class="xplore-search-result__title">${title}</div>
                <div class="xplore-search-result__meta">
                    <span>${categoryLabel}</span>${subtitle ? `<span>${subtitle}</span>` : ''}
                </div>
            </div>
            ${elevation ? `<div class="xplore-search-result__elevation">${escapeHtml(elevation)}</div>` : ''}
        </div>
    `;
}

function getSearchItemValue(item) {
    return item?.properties?.xploreTitle || item?.text || item?.place_name || '';
}

/**
 * Initialize and add geocoder control to the map
 * @param {maplibregl.Map} map - The MapLibre map instance
 * @param {Object} options - Configuration options
 * @returns {MaplibreGeocoder|null} The geocoder instance or null if not available
 */
export function initializeGeocoder(map, options = {}) {
    // Check if MaplibreGeocoder is available (loaded via script tag)
    if (typeof MaplibreGeocoder === 'undefined') {
        console.warn('MaplibreGeocoder not available. Geocoder will not be initialized.');
        return null;
    }

    if (typeof maplibregl === 'undefined') {
        console.warn('maplibregl not available. Geocoder will not be initialized.');
        return null;
    }

    const {
        placeholder = 'Search location...',
        collapsed = false, // Always expanded in the top bar
        showResultsWhileTyping = true,
        minLength = 2,
        debounceSearch = 450,
        flyTo = true,
        position = 'top-center',
        limit = DEFAULT_LIMIT,
        photonEndpoint = ''
    } = options;

    const geocoderApi = createPhotonGeocoderApi(map, { limit, photonEndpoint });

    const geocoder = new MaplibreGeocoder(geocoderApi, {
        maplibregl,
        placeholder,
        collapsed,
        showResultsWhileTyping,
        minLength,
        debounceSearch,
        flyTo,
        limit,
        marker: false, // Don't show default marker on result
        render: renderSearchResult,
        getItemValue: getSearchItemValue
    });

    // For top-center/header positioning, target the specific container
    if (position === 'top-center') {
        const container = document.getElementById('headerGeocoder');
        if (container) {
            const geocoderElem = geocoder.onAdd(map);
            if (geocoderElem) {
                container.innerHTML = '';
                container.appendChild(geocoderElem);
            }
        } else {
            // Fallback for centered positioning if container doesn't exist
            let customContainer = document.querySelector('.geocoder-container--top-center');
            if (!customContainer) {
                customContainer = document.createElement('div');
                customContainer.className = 'geocoder-container geocoder-container--top-center';
                document.body.appendChild(customContainer);
            }

            const geocoderElem = geocoder.onAdd(map);
            if (geocoderElem) {
                customContainer.innerHTML = '';
                customContainer.appendChild(geocoderElem);
            }
        }
    } else {
        // Use standard MapLibre control positioning for supported positions
        try {
            map.addControl(geocoder, position);
        } catch (e) {
            console.error('Failed to add geocoder control:', e);
            // Fallback to top-right if provided position failed
            map.addControl(geocoder, 'top-right');
        }
    }

    return geocoder;
}

export default initializeGeocoder;
