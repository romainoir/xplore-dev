export const SAC_SCALE_RANK = Object.freeze({
    hiking: 1,
    mountain_hiking: 2,
    demanding_mountain_hiking: 3,
    alpine_hiking: 4,
    demanding_alpine_hiking: 5,
    difficult_alpine_hiking: 6
});

export const TRAIL_VISIBILITY_RANK = Object.freeze({
    excellent: 1,
    good: 2,
    intermediate: 3,
    bad: 4,
    horrible: 5,
    no: 6
});

export const SURFACE_SEVERITY_RANK = Object.freeze({
    paved: 1,
    asphalt: 1,
    concrete: 1,
    'concrete:lanes': 1,
    paving_stones: 1,
    sett: 1,
    cobblestone: 1,
    compacted: 2,
    fine_gravel: 2,
    gravel_turf: 2,
    dirt: 3,
    earth: 3,
    ground: 3,
    gravel: 3,
    grass: 3,
    mud: 3,
    sand: 3,
    scree: 4,
    rock: 4,
    stone: 4,
    pebblestone: 4,
    shingle: 4,
    bare_rock: 4,
    glacier: 5,
    snow: 5,
    ice: 5
});

export const TRAIL_VISIBILITY_VALUES = new Set(Object.keys(TRAIL_VISIBILITY_RANK));

export const SLOPE_CLASSIFICATIONS = Object.freeze([
    { key: 'slope-very-steep-descent', label: 'Descente très raide (<-18%)', color: '#0b3d91', maxGrade: -18, maxInclusive: false },
    { key: 'slope-steep-descent', label: 'Descente raide (-18% à -12%)', color: '#1f5fa5', minGrade: -18, minInclusive: true, maxGrade: -12, maxInclusive: false },
    { key: 'slope-moderate-descent', label: 'Descente modérée (-12% à -6%)', color: '#4aa3f0', minGrade: -12, minInclusive: true, maxGrade: -6, maxInclusive: false },
    { key: 'slope-rolling', label: 'Plat (-6% à 6%)', color: '#27ae60', minGrade: -6, minInclusive: true, maxGrade: 6, maxInclusive: true },
    { key: 'slope-moderate-climb', label: 'Montée modérée (6% à 12%)', color: '#f4d03f', minGrade: 6, minInclusive: true, maxGrade: 12, maxInclusive: false },
    { key: 'slope-hard-climb', label: 'Montée (12% à 18%)', color: '#f39c12', minGrade: 12, minInclusive: true, maxGrade: 18, maxInclusive: false },
    { key: 'slope-steep-climb', label: 'Montée raide (>18%)', color: '#c0392b', minGrade: 18, minInclusive: true }
]);

export const SURFACE_CLASSIFICATIONS = Object.freeze([
    {
        key: 'surface-paved',
        label: 'Route goudronnée',
        color: '#b8b0a0',
        maxMultiplier: 0.95,
        maxInclusive: true,
        surfaceValues: Object.freeze(['paved', 'asphalt', 'concrete', 'concrete:lanes', 'paving_stones', 'sett', 'cobblestone'])
    },
    {
        key: 'surface-compact',
        label: 'Surface compacte',
        color: '#2ecc71',
        minMultiplier: 0.95,
        minInclusive: false,
        maxMultiplier: 1.05,
        maxInclusive: true,
        surfaceValues: Object.freeze(['compacted', 'fine_gravel', 'gravel_turf'])
    },
    {
        key: 'surface-dirt',
        label: 'Terre / gravier',
        color: '#cfa97a',
        minMultiplier: 1.05,
        minInclusive: false,
        maxMultiplier: 1.15,
        maxInclusive: true,
        surfaceValues: Object.freeze(['dirt', 'earth', 'ground', 'gravel', 'grass', 'mud', 'sand'])
    },
    {
        key: 'surface-rocky',
        label: 'Sentier rocheux',
        color: '#8f9299',
        minMultiplier: 1.15,
        minInclusive: false,
        maxMultiplier: 1.3,
        maxInclusive: true,
        surfaceValues: Object.freeze(['scree', 'rock', 'stone', 'pebblestone', 'shingle', 'bare_rock'])
    },
    {
        key: 'surface-alpine',
        label: 'Glacier / alpin',
        color: '#f0f4f7',
        minMultiplier: 1.3,
        minInclusive: false,
        maxMultiplier: 1.3,
        maxInclusive: true,
        surfaceValues: Object.freeze(['glacier', 'snow', 'ice'])
    }
]);

export const SURFACE_LABELS = Object.freeze(
    SURFACE_CLASSIFICATIONS.reduce((accumulator, entry) => {
        if (!entry || !entry.label) {
            return accumulator;
        }
        const values = Array.isArray(entry.surfaceValues) ? entry.surfaceValues : [];
        values.forEach((value) => {
            if (typeof value === 'string' && value) {
                accumulator[value] = entry.label;
            }
        });
        return accumulator;
    }, {})
);

export const UNKNOWN_CATEGORY_CLASSIFICATION = Object.freeze({
    key: 'category-unknown',
    label: 'Non renseigné',
    color: '#d0d4db'
});

export const CATEGORY_CLASSIFICATIONS = Object.freeze([
    UNKNOWN_CATEGORY_CLASSIFICATION,
    {
        key: 'category-t1',
        label: 'Randonnée facile',
        color: '#a8f0c5',
        maxMultiplier: 1,
        maxGrade: 8,
        sacScaleValues: Object.freeze(['hiking'])
    },
    {
        key: 'category-t2',
        label: 'Sentier de montagne',
        color: '#27ae60',
        maxMultiplier: 1.1,
        maxGrade: 12,
        sacScaleValues: Object.freeze(['mountain_hiking'])
    },
    {
        key: 'category-t3',
        label: 'Randonnée alpine',
        color: '#f7d774',
        maxMultiplier: 1.2,
        maxGrade: 18,
        sacScaleValues: Object.freeze(['demanding_mountain_hiking'])
    },
    {
        key: 'category-t4',
        label: 'Itinéraire alpin',
        color: '#e67e22',
        maxMultiplier: 1.35,
        sacScaleValues: Object.freeze(['alpine_hiking'])
    },
    {
        key: 'category-t5',
        label: 'Alpin technique',
        color: '#4a0404',
        sacScaleValues: Object.freeze(['demanding_alpine_hiking', 'difficult_alpine_hiking'])
    }
]);

export const SAC_SCALE_LABELS = Object.freeze(
    CATEGORY_CLASSIFICATIONS.reduce((accumulator, entry) => {
        if (!entry || !entry.label) {
            return accumulator;
        }
        const values = Array.isArray(entry.sacScaleValues) ? entry.sacScaleValues : [];
        values.forEach((value) => {
            if (typeof value === 'string' && value) {
                accumulator[value] = entry.label;
            }
        });
        return accumulator;
    }, {})
);

export const PROFILE_MODE_DEFINITIONS = Object.freeze({
    none: { key: 'none', label: 'None' },
    slope: { key: 'slope', label: 'Slope' },
    surface: { key: 'surface', label: 'Surface' },
    category: { key: 'category', label: 'Difficulty' },
    poi: { key: 'poi', label: 'POI' }
});

export const PROFILE_GRADIENT_MODES = Object.freeze(['slope', 'surface', 'category']);

export const PROFILE_LEGEND_SHOW_DELAY_MS = 1000;

export const SLOPE_GRADIENT_LABELS = Object.freeze(['-18%', '-12%', '-6%', '0%', '6%', '12%', '18%', '>18%']);

export const PROFILE_MODE_LEGENDS = Object.freeze({
    slope: SLOPE_CLASSIFICATIONS,
    surface: SURFACE_CLASSIFICATIONS,
    category: CATEGORY_CLASSIFICATIONS
});

export const DEFAULT_PROFILE_MODE = PROFILE_MODE_DEFINITIONS.none.key;
export const MIN_PROFILE_SEGMENT_DISTANCE_KM = 1e-6;
export const MULTIPLIER_TOLERANCE = 1e-6;
export const GRADE_TOLERANCE = 1e-4;
export const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
