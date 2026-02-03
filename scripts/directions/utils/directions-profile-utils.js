import {
    SAC_SCALE_RANK,
    TRAIL_VISIBILITY_RANK,
    TRAIL_VISIBILITY_VALUES,
    SAC_SCALE_LABELS,
    SURFACE_LABELS,
    PROFILE_GRADIENT_MODES,
    UNKNOWN_CATEGORY_CLASSIFICATION
} from '../constants/directions-profile-constants.js';

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
    const alias = {
        t1: 'hiking',
        t2: 'mountain_hiking',
        t3: 'demanding_mountain_hiking',
        t4: 'alpine_hiking',
        t5: 'demanding_alpine_hiking',
        t6: 'difficult_alpine_hiking'
    };
    return alias[sanitized] || alias[lower] || null;
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

export function normalizeSurfaceType(value) {
    const normalized = normalizeTagString(value);
    if (!normalized) {
        return null;
    }
    return normalized.toLowerCase().replace(/\s+/g, '_');
}

export function normalizeCoordinatePair(coord) {
    if (!Array.isArray(coord) || coord.length < 2) {
        return null;
    }
    const lng = Number(coord[0]);
    const lat = Number(coord[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return null;
    }
    return [lng, lat];
}

export function formatTagLabel(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return null;
    }
    return value
        .split('_')
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(' ');
}

export function formatSacScaleLabel(value) {
    const normalized = normalizeSacScale(value);
    if (!normalized) {
        return null;
    }
    const label = SAC_SCALE_LABELS[normalized];
    if (label) {
        return label;
    }
    return formatTagLabel(normalized);
}

export function formatSurfaceLabel(value) {
    const normalized = normalizeSurfaceType(value);
    if (!normalized) {
        return null;
    }
    const label = SURFACE_LABELS[normalized];
    if (label) {
        return label;
    }
    return formatTagLabel(normalized);
}

export function formatTrailVisibilityLabel(value) {
    const normalized = normalizeTrailVisibility(value);
    if (!normalized) {
        return null;
    }
    return formatTagLabel(normalized);
}

export function isProfileGradientMode(mode) {
    return PROFILE_GRADIENT_MODES.includes(mode);
}

export function cloneClassificationEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return null;
    }
    return { ...entry };
}

export function isUnknownCategoryClassification(classification) {
    if (!classification || typeof classification !== 'object') {
        return true;
    }
    const key = typeof classification.key === 'string' ? classification.key : '';
    if (UNKNOWN_CATEGORY_CLASSIFICATION?.key && key === UNKNOWN_CATEGORY_CLASSIFICATION.key) {
        return true;
    }
    const color = typeof classification.color === 'string' ? classification.color.trim() : '';
    return !color;
}
