import { adjustHexColor } from '../utils/directions-utils.js';
import {
    DEFAULT_DISTANCE_MARKER_COLOR,
    DISTANCE_MARKER_PREFIX,
    SEGMENT_MARKER_COLORS,
    START_MARKER_ICON_ID,
    BIVOUAC_MARKER_ICON_ID,
    END_MARKER_ICON_ID
} from '../constants/directions-visual-constants.js';

export function createMarkerCanvas(baseSize = 52) {
    const ratio = 2;
    const canvas = document.createElement('canvas');
    canvas.width = baseSize * ratio;
    canvas.height = baseSize * ratio;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return null;
    }
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, baseSize, baseSize);
    return { canvas, ctx, ratio, size: baseSize };
}

export function finalizeMarkerImage(base) {
    if (!base) {
        return null;
    }

    const { canvas, ctx, ratio } = base;
    const width = canvas.width;
    const height = canvas.height;

    if (!width || !height) {
        return null;
    }

    const imageData = ctx.getImageData(0, 0, width, height);
    return { image: imageData, pixelRatio: ratio };
}

export function createFlagMarkerImage(fillColor) {
    const base = createMarkerCanvas();
    if (!base) {
        return null;
    }

    const { ctx, size } = base;
    const poleX = size * 0.5;
    const poleTop = size * 0.16;
    const poleBottom = size * 0.88;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
    ctx.beginPath();
    ctx.ellipse(poleX, poleBottom + size * 0.03, size * 0.2, size * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#27363f';
    ctx.lineWidth = size * 0.06;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(poleX, poleTop);
    ctx.lineTo(poleX, poleBottom);
    ctx.stroke();

    const flagWidth = size * 0.36;
    const flagHeight = size * 0.3;
    ctx.fillStyle = fillColor;
    ctx.strokeStyle = 'rgba(17, 34, 48, 0.18)';
    ctx.lineWidth = size * 0.025;
    ctx.beginPath();
    ctx.moveTo(poleX, poleTop + size * 0.02);
    ctx.quadraticCurveTo(poleX + flagWidth, poleTop - size * 0.04, poleX + flagWidth, poleTop + flagHeight * 0.35);
    ctx.quadraticCurveTo(poleX + flagWidth, poleTop + flagHeight * 0.75, poleX, poleTop + flagHeight);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    return finalizeMarkerImage(base);
}

export function createTentMarkerImage(fillColor) {
    const base = createMarkerCanvas();
    if (!base) {
        return null;
    }

    const { ctx, size } = base;

    // Scale factor to fit the 100x100 SVG viewBox to our canvas size
    const scale = size / 100;

    // Helper to draw the complete tent shape with configurable line thickness
    const drawTent = (lineMultiplier = 1) => {
        // Crossed poles - continuation of tent edges
        ctx.lineWidth = 5 * scale * lineMultiplier;
        ctx.beginPath();
        ctx.moveTo(44 * scale, 0);
        ctx.lineTo(50 * scale, 12 * scale);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(56 * scale, 0);
        ctx.lineTo(50 * scale, 12 * scale);
        ctx.stroke();

        // Main tent body with entrance cutout
        ctx.lineWidth = 4 * scale * lineMultiplier;
        ctx.beginPath();
        ctx.moveTo(50 * scale, 12 * scale);
        ctx.lineTo(5 * scale, 88 * scale);
        ctx.lineTo(38 * scale, 88 * scale);
        ctx.lineTo(50 * scale, 60 * scale);
        ctx.lineTo(62 * scale, 88 * scale);
        ctx.lineTo(95 * scale, 88 * scale);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Ground bar
        ctx.lineWidth = 6 * scale * lineMultiplier;
        ctx.beginPath();
        ctx.moveTo(3 * scale, 93 * scale);
        ctx.lineTo(97 * scale, 93 * scale);
        ctx.stroke();
    };

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // First pass: Draw white halo/outline with thicker lines
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    drawTent(2.5); // 2.5x thicker for halo effect

    // Second pass: Draw colored fill on top with normal lines
    ctx.fillStyle = fillColor;
    ctx.strokeStyle = fillColor;
    drawTent(1);

    return finalizeMarkerImage(base);
}

export function ensureSegmentMarkerImages(map, bivouacColor = SEGMENT_MARKER_COLORS.bivouac) {
    if (!map || typeof map.hasImage !== 'function' || typeof map.addImage !== 'function') {
        return;
    }

    if (!map.hasImage(START_MARKER_ICON_ID)) {
        const startIcon = createFlagMarkerImage(SEGMENT_MARKER_COLORS.start);
        if (startIcon) {
            map.addImage(START_MARKER_ICON_ID, startIcon.image, { pixelRatio: startIcon.pixelRatio });
        }
    }

    if (!map.hasImage(END_MARKER_ICON_ID)) {
        const endIcon = createFlagMarkerImage(SEGMENT_MARKER_COLORS.end);
        if (endIcon) {
            map.addImage(END_MARKER_ICON_ID, endIcon.image, { pixelRatio: endIcon.pixelRatio });
        }
    }

    // Always use the generated tent icon with the specified color
    const tentIcon = createTentMarkerImage(bivouacColor);
    if (tentIcon) {
        // Remove existing image if present to allow color update
        if (map.hasImage(BIVOUAC_MARKER_ICON_ID)) {
            map.removeImage(BIVOUAC_MARKER_ICON_ID);
        }
        map.addImage(BIVOUAC_MARKER_ICON_ID, tentIcon.image, { pixelRatio: tentIcon.pixelRatio });
    }
}

export function updateBivouacMarkerColor(map, color) {
    if (!map || typeof map.hasImage !== 'function') {
        return;
    }

    const tentIcon = createTentMarkerImage(color);
    if (!tentIcon) {
        return;
    }

    try {
        if (map.hasImage(BIVOUAC_MARKER_ICON_ID)) {
            map.removeImage(BIVOUAC_MARKER_ICON_ID);
        }
        map.addImage(BIVOUAC_MARKER_ICON_ID, tentIcon.image, { pixelRatio: tentIcon.pixelRatio });
    } catch (error) {
        console.warn('Failed to update bivouac marker color', error);
    }
}

export function getOrCreateBivouacIcon(map, color) {
    if (!map || typeof map.hasImage !== 'function') {
        return BIVOUAC_MARKER_ICON_ID;
    }

    // Normalize color to lowercase hex
    const normalizedColor = (color || '').trim().toLowerCase();
    if (!normalizedColor || !/^#[0-9a-f]{6}$/i.test(normalizedColor)) {
        return BIVOUAC_MARKER_ICON_ID;
    }

    // Create a unique icon ID for this color
    const colorIconId = `bivouac-${normalizedColor.slice(1)}`;

    // Check if icon already exists
    if (map.hasImage(colorIconId)) {
        return colorIconId;
    }

    // Create new icon with this color
    const tentIcon = createTentMarkerImage(normalizedColor);
    if (tentIcon) {
        try {
            map.addImage(colorIconId, tentIcon.image, { pixelRatio: tentIcon.pixelRatio });
            return colorIconId;
        } catch (error) {
            console.warn('Failed to create bivouac icon for color', normalizedColor, error);
        }
    }

    return BIVOUAC_MARKER_ICON_ID;
}

export function createDistanceMarkerImage(label, {
    fill = DEFAULT_DISTANCE_MARKER_COLOR
} = {}) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
        return null;
    }

    const deviceRatio = 2;
    const fontSize = 13;
    const paddingX = 8;
    const paddingY = 6;
    const borderRadius = 8;
    const font = `600 ${fontSize * deviceRatio}px 'Noto Sans', 'Noto Sans Bold', sans-serif`;
    context.font = font;
    const metrics = context.measureText(label);
    const textWidth = metrics.width;

    const baseWidth = Math.ceil(textWidth / deviceRatio + paddingX * 2);
    const baseHeight = Math.ceil(fontSize + paddingY * 2);

    canvas.width = baseWidth * deviceRatio;
    canvas.height = baseHeight * deviceRatio;

    context.scale(deviceRatio, deviceRatio);
    context.font = `600 ${fontSize}px 'Noto Sans', 'Noto Sans Bold', sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    const drawRoundedRect = (x, y, width, height, radius) => {
        const r = Math.min(radius, width / 2, height / 2);
        context.beginPath();
        context.moveTo(x + r, y);
        context.lineTo(x + width - r, y);
        context.quadraticCurveTo(x + width, y, x + width, y + r);
        context.lineTo(x + width, y + height - r);
        context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        context.lineTo(x + r, y + height);
        context.quadraticCurveTo(x, y + height, x, y + height - r);
        context.lineTo(x, y + r);
        context.quadraticCurveTo(x, y, x + r, y);
        context.closePath();
    };

    drawRoundedRect(0, 0, baseWidth, baseHeight, borderRadius);
    const strokeColor = adjustHexColor(fill, -0.2);

    context.save();
    context.shadowColor = 'rgba(17, 34, 48, 0.3)';
    context.shadowBlur = 8;
    context.shadowOffsetY = 2;
    context.fillStyle = fill;
    context.fill();
    context.restore();

    context.lineWidth = 1.5;
    context.strokeStyle = strokeColor;
    context.stroke();

    context.fillStyle = '#ffffff';
    context.fillText(label, baseWidth / 2, baseHeight / 2);

    const width = canvas.width;
    const height = canvas.height;
    if (!width || !height) {
        return null;
    }

    const imageData = context.getImageData(0, 0, width, height);
    return {
        image: {
            width,
            height,
            data: imageData.data
        },
        pixelRatio: deviceRatio
    };
}

export function buildDistanceMarkerId(label, fill) {
    const normalizedLabel = String(label)
        .toLowerCase()
        .replace(/[^0-9a-z]+/gi, '-');
    const normalizedColor = typeof fill === 'string' && fill
        ? fill.toLowerCase().replace(/[^0-9a-f]+/g, '')
        : 'default';
    return `${DISTANCE_MARKER_PREFIX}${normalizedLabel}-${normalizedColor}`;
}

export function ensureDistanceMarkerImage(map, label, { fill } = {}) {
    const color = typeof fill === 'string' && fill ? fill : DEFAULT_DISTANCE_MARKER_COLOR;
    const imageId = buildDistanceMarkerId(label, color);
    if (map.hasImage(imageId)) {
        return imageId;
    }

    const rendered = createDistanceMarkerImage(label, { fill: color });
    if (!rendered) {
        return null;
    }

    map.addImage(imageId, rendered.image, { pixelRatio: rendered.pixelRatio });
    return imageId;
}

export const createWaypointFeature = (coords, index, total, extraProperties = {}) => {
    const isStart = index === 0;
    const isEnd = index === total - 1 && total > 1;
    const role = isStart ? 'start' : isEnd ? 'end' : 'via';

    let title = '';
    if (isStart) {
        title = 'Départ';
    } else if (isEnd) {
        title = 'Arrivée';
    }

    return {
        type: 'Feature',
        properties: {
            index,
            role,
            title,
            ...extraProperties
        },
        geometry: {
            type: 'Point',
            coordinates: coords
        }
    };
};

export const toLngLat = (coord) => new maplibregl.LngLat(coord[0], coord[1]);
