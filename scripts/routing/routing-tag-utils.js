/**
 * Shared constants and normalization functions for routing tag processing.
 *
 * This module centralises the SAC scale, trail visibility, surface ranking,
 * and related helpers that were previously duplicated across
 * offline-path-router.js, geojson-pathfinding.js,
 * overpass-network-fetcher.js and openfreemap-network-builder.js.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

const SAC_SCALE_ALIAS = Object.freeze({
    t1: 'hiking',
    t2: 'mountain_hiking',
    t3: 'demanding_mountain_hiking',
    t4: 'alpine_hiking',
    t5: 'demanding_alpine_hiking',
    t6: 'difficult_alpine_hiking'
});

// ---------------------------------------------------------------------------
// Tag normalisation helpers
// ---------------------------------------------------------------------------

export function normalizeTagString(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
}

export function normalizeSacScale(value) {
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
    return SAC_SCALE_ALIAS[sanitized] || SAC_SCALE_ALIAS[lower] || null;
}

export function resolveSacScale(...values) {
    for (const value of values) {
        const normalized = normalizeSacScale(value);
        if (normalized) {
            return normalized;
        }
    }
    return null;
}

export function normalizeTrailVisibility(value) {
    const normalized = normalizeTagString(value);
    if (!normalized) {
        return null;
    }
    const lower = normalized.toLowerCase().replace(/\s+/g, '_');
    return TRAIL_VISIBILITY_VALUES.has(lower) ? lower : null;
}

export function normalizeSurface(value) {
    const normalized = normalizeTagString(value);
    if (!normalized) {
        return null;
    }
    return normalized.toLowerCase().replace(/\s+/g, '_');
}

export function normalizeTrackType(value) {
    const normalized = normalizeTagString(value);
    if (!normalized) {
        return null;
    }
    return normalized.toLowerCase().replace(/\s+/g, '_');
}

// ---------------------------------------------------------------------------
// Hiking attribute collection
// ---------------------------------------------------------------------------

export function collectHikingAttributes(properties) {
    if (!properties || typeof properties !== 'object') {
        return null;
    }
    const sacScale = resolveSacScale(
        properties.sacScale,
        properties.sac_scale,
        properties.difficulty
    );
    const trailVisibility = normalizeTrailVisibility(
        properties.trailVisibility ?? properties.trail_visibility
    );
    const surface = normalizeSurface(properties.surface);
    const smoothness = normalizeTagString(properties.smoothness);
    const trackType = normalizeTrackType(
        properties.trackType ?? properties.tracktype ?? properties.track_type
    );
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
