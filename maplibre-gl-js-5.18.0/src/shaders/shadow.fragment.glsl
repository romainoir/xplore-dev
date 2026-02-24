// Shadow Fragment Shader - H4 Sunlight Engine (Short-Range Raymarch)

uniform sampler2D u_image;       // 0: Center FBO/DEM
uniform sampler2D u_image_raw;   // 1: Center Raw Backup
uniform sampler2D u_neigh_lat;   // 4: Lateral (E/W)
uniform sampler2D u_neigh_long;  // 5: Longitudinal (N/S)
uniform sampler2D u_neigh_diag;  // 6: Diagonal

uniform vec4 u_neigh_zoom_lat;
uniform vec4 u_neigh_zoom_long;
uniform vec4 u_neigh_zoom_diag;
uniform vec2 u_neigh_offsets;    // [dx, dy] sun-facing neighbor direction

uniform sampler2D u_grandparent_dem; // 12
uniform vec4 u_grandparent_zoom; // [scale, offsetX, offsetY, zoomDiff]
uniform sampler2D u_gp_neigh_lat;
uniform sampler2D u_gp_neigh_long;
uniform sampler2D u_gp_neigh_diag;
uniform vec4 u_gp_neigh_zoom_lat;
uniform vec4 u_gp_neigh_zoom_long;
uniform vec4 u_gp_neigh_zoom_diag;
uniform float u_shadow_penumbra; // Soft shadow PCSS factor
uniform vec4 u_shadow_shadow_color;
uniform vec4 u_shadow_highlight_color;

in vec2 v_pos;

uniform vec2 u_dimension;
uniform vec4 u_unpack;
uniform float u_metersPerPixel;
uniform vec2 u_sunDirection;     // 2D direction of sun on the DEM plane (normalized, UV space)
uniform float u_sunAltitude;     // Sun altitude in radians
uniform float u_shadowOpacity;   // Max shadow opacity
uniform float u_shadowMaxDistance; // Max raymarching distance in meters
uniform vec4 u_shadowColor;     // Shadow color
uniform vec3 u_tile_id;         // z, x, y

// Debug Mode
uniform int u_debug_mode;
uniform int u_shadow_mode;

// Raymarching Tuning
uniform float u_shadow_step_size;
uniform float u_shadow_max_steps;
uniform float u_shadow_acceleration;

#define PI 3.141592653589793
#define hardMaxSteps 256.0

// Robust Hash (Dave Hoskins) for UV jittering
float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Decode elevation from RGBA DEM data
float decodeElevation(sampler2D tex, vec2 uv) {
    vec4 data = texture(tex, uv);
    return dot(floor(data * 255.0 + 0.5).rgb, u_unpack.rgb) - u_unpack.a;
}

// Apply zoom transform to UV (scale, offset)
vec2 transformUV(vec2 uv, vec4 z) { 
    return uv * z.x + z.yz; 
}

// Bilinear elevation sample from a DEM texture
float sampleElevation(sampler2D dem, vec2 uv) {
    vec2 dim = u_dimension; // 514
    vec2 pos = uv * (dim - 2.0) + 1.0;
    vec2 posCenter = pos - 0.5;
    vec2 f = fract(posCenter);
    vec2 i = floor(posCenter) + 0.5;
    float h00 = decodeElevation(dem, (i + vec2(0.0, 0.0)) / dim);
    float h10 = decodeElevation(dem, (i + vec2(1.0, 0.0)) / dim);
    float h01 = decodeElevation(dem, (i + vec2(0.0, 1.0)) / dim);
    float h11 = decodeElevation(dem, (i + vec2(1.0, 1.0)) / dim);
    return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

// Helper for neighbor decoding with zoom transform
float decodeNeighbor(sampler2D tex, vec2 uv, vec4 z) {
    if (z.x < 0.01) return decodeElevation(u_image_raw, uv);
    return decodeElevation(tex, transformUV(uv, z));
}

// Fast Nearest-Neighbor decoded altitude
float decodeElevationNearest(sampler2D tex, vec2 uv) {
    vec2 pos = uv * (u_dimension - 2.0) + 1.0;
    vec2 i = floor(pos) + 0.5;
    return decodeElevation(tex, i / u_dimension);
}

// Fast Decode helper with Zoom
float decodeNeighborNearest(sampler2D tex, vec2 uv, vec4 z) {
    if (z.x < 0.01) return decodeElevationNearest(u_image_raw, uv);
    return decodeElevationNearest(tex, transformUV(uv, z));
}

// Nearest-neighbor robust global lookup (4x faster for raymarching)
float sampleGlobalElevationNearest(vec2 uv) {
    if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
        return decodeElevationNearest(u_image, uv);
    }
    if (u_shadow_mode == 1) return -99999.0;
    float dx = u_neigh_offsets.x;
    float dy = u_neigh_offsets.y;
    if ((uv.x < 0.0 && dx < 0.0) || (uv.x > 1.0 && dx > 0.0)) {
        vec2 uv_lat = uv - vec2(dx, 0.0);
        if (uv.y >= 0.0 && uv.y <= 1.0) return decodeNeighborNearest(u_neigh_lat, uv_lat, u_neigh_zoom_lat);
        if ((uv.y < 0.0 && dy < 0.0) || (uv.y > 1.0 && dy > 0.0)) {
            return decodeNeighborNearest(u_neigh_diag, uv_lat - vec2(0.0, dy), u_neigh_zoom_diag);
        }
    }
    if ((uv.y < 0.0 && dy < 0.0) || (uv.y > 1.0 && dy > 0.0)) {
        if (uv.x >= 0.0 && uv.x <= 1.0) {
            return decodeNeighborNearest(u_neigh_long, uv - vec2(0.0, dy), u_neigh_zoom_long);
        }
    }
    return decodeElevationNearest(u_image_raw, fract(uv));
}

float sampleGrandparentElevationGlobal(vec2 uv) {
    if (u_grandparent_zoom.w <= 0.0) return -99999.0;
    float scale = u_grandparent_zoom.x;
    float offsetX = u_grandparent_zoom.y;
    float offsetY = u_grandparent_zoom.z;
    vec2 gpUV = vec2(offsetX + uv.x * scale, offsetY + uv.y * scale);
    float h = -99999.0;
    if (gpUV.x >= 0.0 && gpUV.x <= 1.0 && gpUV.y >= 0.0 && gpUV.y <= 1.0) {
        h = sampleElevation(u_grandparent_dem, gpUV);
    } else {
        float dx = u_neigh_offsets.x;
        float dy = u_neigh_offsets.y;
        if ((gpUV.x < 0.0 && dx < 0.0) || (gpUV.x > 1.0 && dx > 0.0)) {
            vec2 uv_lat = gpUV - vec2(dx, 0.0);
            if (gpUV.y >= 0.0 && gpUV.y <= 1.0) {
                if (u_gp_neigh_zoom_lat.x >= 0.01) h = sampleElevation(u_gp_neigh_lat, uv_lat);
            } else if ((gpUV.y < 0.0 && dy < 0.0) || (gpUV.y > 1.0 && dy > 0.0)) {
                if (u_gp_neigh_zoom_diag.x >= 0.01) h = sampleElevation(u_gp_neigh_diag, uv_lat - vec2(0.0, dy));
            }
        }
        if (h < -5000.0 && ((gpUV.y < 0.0 && dy < 0.0) || (gpUV.y > 1.0 && dy > 0.0))) {
            if (gpUV.x >= 0.0 && gpUV.x <= 1.0) {
                if (u_gp_neigh_zoom_long.x >= 0.01) h = sampleElevation(u_gp_neigh_long, gpUV - vec2(0.0, dy));
            }
        }
    }
    if (h < -5000.0) h = sampleElevation(u_grandparent_dem, clamp(gpUV, 0.01, 0.99));
    return h;
}

float sampleGlobalElevation(vec2 uv) {
    if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) return sampleElevation(u_image, uv);
    if (u_shadow_mode == 1) return -99999.0;
    float dx = u_neigh_offsets.x;
    float dy = u_neigh_offsets.y;
    if ((uv.x < 0.0 && dx < 0.0) || (uv.x > 1.0 && dx > 0.0)) {
        vec2 uv_lat = uv - vec2(dx, 0.0);
        if (uv.y >= 0.0 && uv.y <= 1.0) return decodeNeighbor(u_neigh_lat, uv_lat, u_neigh_zoom_lat);
        if ((uv.y < 0.0 && dy < 0.0) || (uv.y > 1.0 && dy > 0.0)) return decodeNeighbor(u_neigh_diag, uv_lat - vec2(0.0, dy), u_neigh_zoom_diag);
    }
    if ((uv.y < 0.0 && dy < 0.0) || (uv.y > 1.0 && dy > 0.0)) {
        if (uv.x >= 0.0 && uv.x <= 1.0) return decodeNeighbor(u_neigh_long, uv - vec2(0.0, dy), u_neigh_zoom_long);
    }
    return decodeElevation(u_image_raw, fract(uv));
}

float get_aspect(vec2 deriv) {
    return deriv.x != 0.0 ? atan(deriv.y, -deriv.x) : (3.14159265 / 2.0 * (deriv.y > 0.0 ? 1.0 : -1.0));
}

vec2 computeSobelGradient(vec2 uv) {
    vec2 epsilon = 1.5 / u_dimension;
    float a = sampleElevation(u_image, uv + vec2(-epsilon.x, -epsilon.y));
    float b = sampleElevation(u_image, uv + vec2(0.0, -epsilon.y));
    float c = sampleElevation(u_image, uv + vec2(epsilon.x, -epsilon.y));
    float d = sampleElevation(u_image, uv + vec2(-epsilon.x, 0.0));
    float f = sampleElevation(u_image, uv + vec2(epsilon.x, 0.0));
    float g = sampleElevation(u_image, uv + vec2(-epsilon.x, epsilon.y));
    float h = sampleElevation(u_image, uv + vec2(0.0, epsilon.y));
    float i = sampleElevation(u_image, uv + vec2(epsilon.x, epsilon.y));
    return vec2((c + f + f + i) - (a + d + d + g), (g + h + h + i) - (a + b + b + c)) / (12.0 * max(u_metersPerPixel, 0.0001));
}

float run_raymarch(vec3 lightDir, float altitude, vec2 uvStep, float zStep, float stepDistMeters, float stepSizePixels, float maxSteps, float k_penumbra, float accelerationRate, float lift, bool useGrandparent, bool allowNeighbors, float startElevation, vec2 startUV) {
    float jitter = fract(52.9829189 * fract(0.06711056 * gl_FragCoord.x + 0.00583715 * gl_FragCoord.y));
    vec2 currentUV = startUV + uvStep * (0.5 + jitter);
    float currentZ = startElevation + lift + zStep * (0.5 + jitter);
    float softShadow = 1.0;
    float accumulatedDistance = stepDistMeters * (0.5 + jitter);
    const float EARTH_RADIUS_KM = 6378.137;
    float boundMin = allowNeighbors ? -0.99 : 0.001;
    float boundMax = allowNeighbors ?  1.99 : 0.999;
    float boundMinX = useGrandparent ? -10.0 : boundMin;
    float boundMaxX = useGrandparent ?  10.0 : boundMax;
    float boundMinY = useGrandparent ? -10.0 : boundMin;
    float boundMaxY = useGrandparent ?  10.0 : boundMax;
    float stepsToXBound = (uvStep.x > 0.0) ? (boundMaxX - currentUV.x) / uvStep.x : (uvStep.x < 0.0 ? (boundMinX - currentUV.x) / uvStep.x : 10000.0);
    float stepsToYBound = (uvStep.y > 0.0) ? (boundMaxY - currentUV.y) / uvStep.y : (uvStep.y < 0.0 ? (boundMinY - currentUV.y) / uvStep.y : 10000.0);
    maxSteps = min(maxSteps, min(stepsToXBound, stepsToYBound));
    maxSteps = max(maxSteps, 1.0);
    float CURVATURE_CONST = 1.0 / (2.0 * EARTH_RADIUS_KM);
    for(float i = 0.0; i < hardMaxSteps; i++) {
        if (i >= maxSteps) break; 
        float h = 0.0;
        if (useGrandparent) {
             h = sampleGrandparentElevationGlobal(currentUV);
             if (h < -50000.0) break; 
        } else {
             if (currentUV.x < boundMinX || currentUV.x > boundMaxX || currentUV.y < boundMinY || currentUV.y > boundMaxY) break;
             h = sampleGlobalElevationNearest(currentUV);
        }
        float distanceKm = accumulatedDistance / 1000.0;
        if (distanceKm > 200.0) break; 
        float effectiveHeight = h - (distanceKm * distanceKm * CURVATURE_CONST * 1000.0);
        if (currentZ < effectiveHeight) { softShadow = 0.0; break; }
        float curAccel = 1.0 + (i * accelerationRate);
        currentUV += uvStep * curAccel;
        currentZ += zStep * curAccel;
        accumulatedDistance += stepDistMeters * curAccel;
    }
    return 1.0 - clamp(softShadow, 0.0, 1.0);
}

void main() {
    // Early out: no shadows when sun is below horizon
    if (u_sunAltitude <= 0.0) {
        fragColor = vec4(0.0);
        return;
    }

    float altitude = u_sunAltitude;
    float tanAlt = tan(altitude);
    vec3 lightDir = normalize(vec3(u_sunDirection.x, u_sunDirection.y, tanAlt));
    float shadow = 0.0;

    float startElevation = sampleElevation(u_image, v_pos);
    float shadow1 = 0.0;
    float zoomDiff = u_grandparent_zoom.w;
    
    // Grandparent Cascade (Long-range)
    if (zoomDiff >= 1.0 && u_grandparent_zoom.x > 0.001) {
        float gpMetersPerPixel = u_metersPerPixel * pow(2.0, zoomDiff);
        float gpStepPixels = 6.0;
        float gpUVScale = 1.0 / max(0.0001, u_grandparent_zoom.x);
        vec2 uvStep1 = (lightDir.xy / gpMetersPerPixel) * gpStepPixels * gpUVScale;
        float zStep1 = lightDir.z * gpStepPixels * gpUVScale;
        float distMeters1 = gpStepPixels;
        float maxSteps1 = min(u_shadow_max_steps, 64.0);
        shadow1 = run_raymarch(lightDir, altitude, uvStep1, zStep1, distMeters1, gpStepPixels, maxSteps1, u_shadow_penumbra, 0.015, 1.0, true, true, startElevation, v_pos);
    }
    
    // Local Cascade (High-res)
    float stepSize2 = max(u_shadow_step_size, 0.5);
    vec2 uvStep2 = (u_sunDirection / (u_dimension.x - 2.0)) * stepSize2;
    float zStep2 = stepSize2 * u_metersPerPixel * tanAlt;
    float distMeters2 = stepSize2 * u_metersPerPixel;
    float maxSteps2 = u_shadow_max_steps;
    bool allowNeighbors = (u_shadow_mode == 0);
    float shadow2 = run_raymarch(lightDir, altitude, uvStep2, zStep2, distMeters2, stepSize2, maxSteps2, u_shadow_penumbra, u_shadow_acceleration, 1.0, false, allowNeighbors, startElevation, v_pos);
    
    shadow = max(shadow1, shadow2);

    // Final shadow factor (0.0 = lit, 1.0 = shadowed)
    float finalShadow = shadow * 0.75; 

    fragColor = vec4(finalShadow, 0.0, 0.0, 1.0);
#ifdef OVERDRAW_INSPECTOR
    fragColor = vec4(1.0);
#endif
}

