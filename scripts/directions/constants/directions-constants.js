import { OVERPASS_ENDPOINT as OVERPASS_INTERPRETER_ENDPOINT } from '../../routing/overpass-network-fetcher.js';

export const EMPTY_COLLECTION = {
    type: 'FeatureCollection',
    features: []
};

export const MODE_COLORS = {
    'foot-hiking': '#f8b40b',
    // Manual mode uses the same color as foot-hiking - only the line style differs (dotted)
    manual: '#f8b40b'
};

export const HOVER_PIXEL_TOLERANCE = 12;
export const COORD_EPSILON = 1e-6;
export const WAYPOINT_MATCH_TOLERANCE_METERS = 30;
export const MAX_ELEVATION_POINTS = 180;
export const MAX_DISTANCE_MARKERS = 60;
export const WAYPOINT_HISTORY_LIMIT = 20;
export const ELEVATION_TICK_TARGET = 5;
export const DISTANCE_TICK_TARGET = 6;
export const ROUTE_CUT_EPSILON_KM = 0.02;
export const ROUTE_CLICK_PIXEL_TOLERANCE = 18;
export const ROUTE_GRADIENT_BLEND_DISTANCE_KM = 0.05;
export const OVERLAP_DETECTION_TOLERANCE_METERS = 15;
export const OVERLAP_LINE_OFFSET_PX = 1;
export const turfApi = typeof turf !== 'undefined' ? turf : null;

export const POI_SEARCH_RADIUS_METERS = 200;
export const POI_CATEGORY_DISTANCE_OVERRIDES = Object.freeze({
    peak: 100,
    volcano: 200,
    mountain_pass: 100,
    saddle: 100,
    alpine_hut: 200,
    wilderness_hut: 200,
    hut: 200,
    cabin: 200,
    shelter: 200,
    water: 200,
    spring: 200,
    drinking_water: 200,
    guidepost: 5  // Signposts should only show if very close to route
});
export const POI_MAX_SEARCH_RADIUS_METERS = Math.max(
    POI_SEARCH_RADIUS_METERS,
    ...Object.values(POI_CATEGORY_DISTANCE_OVERRIDES)
);
export const DEFAULT_POI_COLOR = '#2d7bd6';
// Vertical spacing between stacked floating icons (peaks, bivouacs)
export const POI_FLOATING_STACK_SPACING_PX = 12;
// Vertical spacing between stacked internal icons (parking, water)
export const POI_INTERNAL_STACK_SPACING_PX = 18;
// POI category priority order (Higher value = Higher priority/Importance)
// Used to determine which POI stays on the elevation line when stacked
export const POI_CATEGORY_PRIORITY = Object.freeze({
    'bivouac': 1000, // Special handling, always top
    'peak_principal': 100,
    'peak': 90,
    'volcano': 90,
    'peak_minor': 80,
    'saddle': 70,
    'pass': 70,
    'mountain_pass': 70,
    'water': 60,
    'spring': 60,
    'drinking_water': 60,
    'guidepost': 50,
    'information': 50,
    'signpost': 50,
    'viewpoint': 40,
    'camera': 30,
    'cabin': 75,
    'shelter': 75,
    'alpine_hut': 75,
    'wilderness_hut': 75,
    'parking': 10
});
export const POI_CATEGORY_DEFAULT_PRIORITY = 5;

// Water source categories that can be merged with nearby host POIs
export const WATER_CATEGORY_KEYS = Object.freeze(['spring', 'water', 'drinking_water']);
export const WATER_CATEGORY_SET = new Set(WATER_CATEGORY_KEYS);

// POI categories that can host a water indicator when water is nearby
export const WATER_HOST_CATEGORIES = Object.freeze([
    'alpine_hut', 'wilderness_hut', 'hut', 'cabin', 'shelter',
    'parking', 'parking_underground', 'parking_multi-storey', 'parking_multistorey', 'parking_multi_storey',
    'viewpoint'
]);
export const WATER_HOST_CATEGORY_SET = new Set(WATER_HOST_CATEGORIES);

// Maximum distance (in km along the route) to merge water with a host POI
export const WATER_MERGE_PROXIMITY_KM = 0.5;
export const ELEVATION_MARKER_LABEL_VERTICAL_GAP_PX = 4;
export const ELEVATION_MARKER_LABEL_HORIZONTAL_PADDING_PX = 6;
export const ELEVATION_MARKER_LABEL_TOP_PADDING_PX = 4;
export const DEFAULT_POI_TITLE = 'Point d’intérêt';
export const POI_NAME_PROPERTIES = Object.freeze(['name:fr', 'name', 'name:en', 'ref']);
export const POI_ADDITIONAL_PROPERTY_TAGS = Object.freeze([
    'ele',
    'importance',
    'importance:level',
    'prominence',
    'prominence:meters',
    'prominence:metres',
    'rank',
    'peak'
]);
export const POI_FALLBACK_MAX_BOUND_SPAN_DEGREES = 2.5;
export const POI_FALLBACK_TIMEOUT_SECONDS = 60;
export const POI_FALLBACK_ENDPOINT = OVERPASS_INTERPRETER_ENDPOINT;
export const POI_ICON_TARGET_DISPLAY_SIZE_PX = 26;
export const PEAK_PRINCIPAL_ICON_THRESHOLD = 4;
export const ROUTE_POI_ICON_LAYER_ID = 'route-poi-icons';
export const POI_ICON_DEFINITIONS = Object.freeze({
    peak: { icon: 'peak_minor', label: 'Sommet', color: '#2d7bd6' },
    volcano: { icon: 'peak_minor', label: 'Volcan', color: '#2d7bd6' },
    mountain_pass: { icon: 'saddle', label: 'Col', color: '#4a6d8c' },
    saddle: { icon: 'saddle', label: 'Col', color: '#4a6d8c' },
    viewpoint: { icon: 'viewpoint', label: 'Point de vue', color: '#35a3ad' },
    alpine_hut: { icon: 'cabin', label: 'Refuge', color: '#c26d2d' },
    wilderness_hut: { icon: 'cabin', label: 'Cabane', color: '#c26d2d' },
    hut: { icon: 'cabin', label: 'Cabane', color: '#c26d2d' },
    cabin: { icon: 'cabin', label: 'Cabane', color: '#c26d2d' },
    shelter: { icon: 'cabin', label: 'Abri', color: '#c26d2d' },
    spring: { icon: 'water', label: 'Source', color: '#3b82f6' },
    water: { icon: 'water', label: 'Eau', color: '#3b82f6' },
    drinking_water: { icon: 'water', label: 'Eau potable', color: '#3b82f6' },
    guidepost: { icon: 'signpost', label: 'Panneau', color: '#6b7280' },
    parking: { icon: 'parking', label: 'Parking', color: '#4b5563' },
    parking_underground: { icon: 'parking', label: 'Parking', color: '#4b5563' },
    'parking_multi-storey': { icon: 'parking', label: 'Parking', color: '#4b5563' },
    parking_multistorey: { icon: 'parking', label: 'Parking', color: '#4b5563' },
    'parking_multi_storey': { icon: 'parking', label: 'Parking', color: '#4b5563' }
});

export const PARKING_CATEGORY_KEYS = Object.freeze([
    'parking',
    'parking_underground',
    'parking_multi-storey',
    'parking_multistorey',
    'parking_multi_storey'
]);
export const PARKING_CATEGORY_SET = new Set(PARKING_CATEGORY_KEYS);
export const PARKING_CLUSTER_MIN_SPACING_KM = 1;

export const ELEVATION_PROFILE_POI_CATEGORY_KEYS = Object.freeze([
    'peak',
    'volcano',
    'mountain_pass',
    'saddle',
    'viewpoint',
    'alpine_hut',
    'wilderness_hut',
    'hut',
    'cabin',
    'shelter',
    'spring',
    'water',
    'drinking_water',
    'guidepost',
    'parking',
    'parking_underground',
    'parking_multi-storey',
    'parking_multistorey',
    'parking_multi_storey'
]);
export const ELEVATION_PROFILE_POI_CATEGORY_SET = new Set(ELEVATION_PROFILE_POI_CATEGORY_KEYS);

export const ROUTE_POI_SOURCE_ID = 'route-pois';
export const ROUTE_POI_LAYER_ID = 'route-pois';
export const ROUTE_POI_LABEL_LAYER_ID = 'route-poi-labels';

export const POI_CLUSTER_MIN_SPACING_KM = 0.05;
export const POI_CLUSTER_MAX_SPACING_KM = 1.5;
export const POI_CLUSTER_DISTANCE_SCALE = 120;

export const HIKING_BASE_SPEED_KMPH = 5;
export const ASCENT_METERS_PER_HOUR = 500;
export const DESCENT_METERS_PER_HOUR = 800;

export const ELEVATION_PROFILE_POI_CLUSTER_MIN_WINDOW_KM = 0.4;
export const ELEVATION_PROFILE_POI_CLUSTER_MAX_WINDOW_KM = 2;
export const ELEVATION_PROFILE_POI_CLUSTER_DISTANCE_SCALE = 30;

// Météo-France API configuration
export const METEO_FRANCE_API_DOMAIN = 'https://webservice.meteofrance.com';
export const METEO_FRANCE_API_TOKEN = '__Wj7dVSTjV9YGu1guveLyDq0g7S7TfTjaHBTPTpO0kj8__';
export const METEO_FRANCE_ICON_BASE_URL = 'https://meteofrance.com/modules/custom/mf_tools_common_theme_public/svg/weather/';
export const METEO_FRANCE_RAIN_ICON_BASE_URL = 'https://meteofrance.com/modules/custom/mf_tools_common_theme_public/svg/rain/';

export const WEATHER_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export const PEAK_CATEGORY_KEYS = Object.freeze(['peak', 'volcano']);
export const PEAK_CATEGORY_SET = new Set(PEAK_CATEGORY_KEYS);
export const PASS_CATEGORY_KEYS = Object.freeze(['mountain_pass', 'saddle']);

export const LABELLED_POI_CATEGORY_KEYS = Object.freeze([
    ...PEAK_CATEGORY_KEYS,
    ...PASS_CATEGORY_KEYS,
    'viewpoint',
    'alpine_hut',
    'wilderness_hut',
    'hut',
    'cabin',
    'shelter'
]);
export const LABELLED_POI_CATEGORY_SET = new Set(LABELLED_POI_CATEGORY_KEYS);
export const PEAK_LABEL_ELEVATION_THRESHOLD_METERS = 3500;
export const PEAK_IMPORTANCE_VALUE_MAP = new Map([
    ['international', 5],
    ['continental', 5],
    ['national', 4],
    ['state', 4],
    ['provincial', 4],
    ['regional', 3],
    ['cantonal', 3],
    ['departmental', 3],
    ['local', 2],
    ['municipal', 2]
]);
export const PEAK_ROLE_VALUE_MAP = new Map([
    ['major', 4],
    ['principal', 4],
    ['main', 4],
    ['primary', 4],
    ['summit', 3],
    ['mountain', 3],
    ['secondary', 2],
    ['minor', 1]
]);
export const PEAK_PROMINENCE_THRESHOLDS = Object.freeze([
    { min: 1500, score: 5 },
    { min: 600, score: 4 },
    { min: 300, score: 3 },
    { min: 150, score: 2 }
]);
export const PEAK_ELEVATION_THRESHOLDS = Object.freeze([
    { min: 4200, score: 5 },
    { min: 3600, score: 4 },
    { min: 3000, score: 3 },
    { min: 2400, score: 2 }
]);

export const POI_ELEVATION_PROPERTY_KEYS = Object.freeze(['ele', 'elevation', 'height']);

export const CONNECTOR_METADATA_SOURCES = new Set(['connector', 'connector-start', 'connector-end']);
