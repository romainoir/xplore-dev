uniform sampler2D u_texture;
uniform vec4 u_fog_color;
uniform vec4 u_horizon_color;
uniform float u_fog_ground_blend;
uniform float u_fog_ground_blend_opacity;
uniform float u_horizon_fog_blend;
uniform bool u_is_globe_mode;
uniform float u_contour_enabled;
uniform float u_contour_interval;
uniform float u_contour_multiplier;
uniform vec4 u_contour_color;
uniform float u_zoom;
uniform float u_tile_zoom;

uniform sampler2D u_shadow_atlas;
uniform sampler2D u_horizon0;
uniform sampler2D u_horizon1;
uniform sampler2D u_horizon2;
uniform sampler2D u_horizon3;
uniform highp vec4 u_atlas_bounds; // [minX, minY, maxX, maxY]
uniform float u_shadow_intensity;
uniform float u_horizon_available;
uniform float u_horizon_bins;
uniform float u_horizon_edge_softness;
uniform float u_horizon_edge_naturalness;
uniform int u_debug_mode;
uniform float u_cast_shadow_mult;
uniform float u_self_shadow_mult;
uniform float u_ao_cast_mult;
uniform float u_ao_self_mult;
uniform float u_igor_relief_enabled;
uniform float u_sun_altitude;  // Sun altitude in radians (0 = horizon, PI/2 = zenith)
uniform vec2 u_sun_direction;  // Normalized sun direction [sin(azimuth), -cos(azimuth)]

// Per-tile DEM for full-res AO (separate names to avoid prelude precision conflict)
uniform highp sampler2D u_dem_ao;        // DEM texture (same data as u_terrain, different unit)
uniform highp vec4 u_dem_ao_unpack;      // DEM unpack vector
uniform highp float u_dem_ao_dim;        // DEM dimension
uniform highp float u_dem_ao_exag;       // terrain exaggeration
uniform float u_dem_ao_meters_per_pixel; // source DEM GSD in meters
uniform sampler2D u_dem_derivative;      // Prepared native hillshade derivative texture
uniform float u_dem_derivative_available;
uniform sampler2D u_elevation_atlas;     // seamless global elevation atlas (packed float)
uniform float u_metersPerPixel;          // geographic scale for normal calculation
uniform float u_max_steps;
uniform float u_step_meters;
uniform float u_shadow_soft_base;
uniform float u_shadow_soft_mult;
uniform float u_shadow_soft_max;

in vec2 v_texture_pos;
in vec2 v_atlas_uv;
in float v_fog_depth;
in float v_elevation;
in float v_dist_linear;
in vec2 v_dem_coord; // Interpolated DEM coordinate from vertex shader

const float gamma = 2.2;
const float PI = 3.141592653589793;

vec4 gammaToLinear(vec4 color) {
    return pow(color, vec4(gamma));
}

vec4 linearToGamma(vec4 color) {
    return pow(color, vec4(1.0 / gamma));
}

// Unpack elevation from the high-precision atlas (matches terrain_elevation.fragment.glsl)
float unpackAtlas(vec2 uv) {
    vec4 packed = texture(u_elevation_atlas, uv);
    const highp vec4 bitUnsh = vec4(1.0 / (256.0 * 256.0 * 256.0), 1.0 / (256.0 * 256.0), 1.0 / 256.0, 1.0);
    float normalizedElev = dot(packed, bitUnsh);
    return (normalizedElev * 20000.0 - 10000.0) * u_dem_ao_exag;
}


float unpackDemElev(vec4 encoded) {
    vec4 data = encoded * 255.0;
    // Standard Terrain-RGB unpack (dot product for speed and precision)
    return (dot(floor(data.rgb + 0.5), u_dem_ao_unpack.rgb) - u_dem_ao_unpack.a) * u_dem_ao_exag;
}

float sampleDemTexel(vec2 coord) {
    float textureDim = u_dem_ao_dim + 2.0;
    vec2 c = clamp(coord, vec2(0.5), vec2(textureDim - 0.5));
    return unpackDemElev(texture(u_dem_ao, c / textureDim));
}

vec2 sobelGradient(
    float a, float b, float c,
    float d,          float f,
    float g, float h, float i
) {
    return vec2(
        (c + f + f + i) - (a + d + d + g),
        (g + h + h + i) - (a + b + b + c)
    );
}

// Match Igor hillshade's perceived detail: Sobel 3x3 gradients are evaluated
// at neighboring DEM cells and then bilinearly interpolated, like sampling
// MapLibre's prepared hillshade derivative FBO with LINEAR filtering.
vec2 sampleDemGradient(vec2 coord) {
    vec2 safeCoord = clamp(coord, vec2(1.0), vec2(u_dem_ao_dim));
    vec2 base = floor(safeCoord) + 0.5;
    vec2 f = fract(safeCoord);

    float z00 = sampleDemTexel(base + vec2(-1.0, -1.0));
    float z10 = sampleDemTexel(base + vec2( 0.0, -1.0));
    float z20 = sampleDemTexel(base + vec2( 1.0, -1.0));
    float z30 = sampleDemTexel(base + vec2( 2.0, -1.0));
    float z01 = sampleDemTexel(base + vec2(-1.0,  0.0));
    float z11 = sampleDemTexel(base + vec2( 0.0,  0.0));
    float z21 = sampleDemTexel(base + vec2( 1.0,  0.0));
    float z31 = sampleDemTexel(base + vec2( 2.0,  0.0));
    float z02 = sampleDemTexel(base + vec2(-1.0,  1.0));
    float z12 = sampleDemTexel(base + vec2( 0.0,  1.0));
    float z22 = sampleDemTexel(base + vec2( 1.0,  1.0));
    float z32 = sampleDemTexel(base + vec2( 2.0,  1.0));
    float z03 = sampleDemTexel(base + vec2(-1.0,  2.0));
    float z13 = sampleDemTexel(base + vec2( 0.0,  2.0));
    float z23 = sampleDemTexel(base + vec2( 1.0,  2.0));
    float z33 = sampleDemTexel(base + vec2( 2.0,  2.0));

    vec2 g00 = sobelGradient(z00, z10, z20, z01, z21, z02, z12, z22);
    vec2 g10 = sobelGradient(z10, z20, z30, z11, z31, z12, z22, z32);
    vec2 g01 = sobelGradient(z01, z11, z21, z02, z22, z03, z13, z23);
    vec2 g11 = sobelGradient(z11, z21, z31, z12, z32, z13, z23, z33);

    vec2 gradient = mix(mix(g00, g10, f.x), mix(g01, g11, f.x), f.y);
    return gradient / (8.0 * max(u_dem_ao_meters_per_pixel, 1.0));
}

vec2 samplePreparedDemGradient(vec2 coord) {
    float invDim = 1.0 / max(u_dem_ao_dim, 1.0);
    vec2 uv = clamp((coord - 1.0) * invDim, vec2(0.5 * invDim), vec2(1.0 - 0.5 * invDim));
    vec2 encoded = texture(u_dem_derivative, uv).rg;
    return ((encoded - 0.5) * 8.0) * u_dem_ao_exag;
}

vec2 sampleReliefGradient(vec2 coord) {
    if (u_dem_derivative_available > 0.5) {
        return samplePreparedDemGradient(coord);
    }

    return sampleDemGradient(coord);
}

// Safe Bilinear Fetch to prevent corrupt RGBA base-256 wrapping interpolation
float sampleElevationBilinear(vec2 uv) {
    vec2 dim = vec2(2048.0); // Terrain.ATLAS_SIZE
    vec2 pos = uv * dim;
    vec2 posCenter = pos - 0.5;
    vec2 f = fract(posCenter);
    vec2 i = floor(posCenter) + 0.5;
    
    float h00 = unpackAtlas((i + vec2(0.0, 0.0)) / dim);
    float h10 = unpackAtlas((i + vec2(1.0, 0.0)) / dim);
    float h01 = unpackAtlas((i + vec2(0.0, 1.0)) / dim);
    float h11 = unpackAtlas((i + vec2(1.0, 1.0)) / dim);
    
    return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

float directSunAmount(float altitude) {
    return smoothstep(radians(-2.0), radians(8.0), altitude);
}

float castShadowAmount(float altitude) {
    return smoothstep(radians(-0.85), radians(1.25), altitude);
}

float skyAmbientAmount(float altitude) {
    return smoothstep(radians(-16.0), radians(6.0), altitude);
}

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec3 skyMatchedShadowTint(float altitude, float horizonWarmth, vec3 horizonColor, vec3 fogColor) {
    float lowLightBlend = 1.0 - smoothstep(radians(6.0), radians(22.0), altitude);
    vec3 dayTint = vec3(0.08, 0.17, 0.32);
    vec3 nightTint = vec3(0.07, 0.09, 0.15);
    vec3 skyHaze = clamp(mix(fogColor, horizonColor, 0.62), vec3(0.0), vec3(1.0));
    vec3 twilightTint = mix(vec3(0.10, 0.15, 0.28), vec3(0.12, 0.10, 0.22), horizonWarmth);
    twilightTint = mix(twilightTint, vec3(0.10 + skyHaze.r * 0.12, 0.09 + skyHaze.g * 0.08, 0.17 + skyHaze.b * 0.22), 0.52);
    vec3 lowLightTint = mix(nightTint, twilightTint, horizonWarmth);
    return mix(dayTint, lowLightTint, lowLightBlend);
}

vec3 applyTwilightAmbient(vec3 color, float altitude, vec3 horizonColor, vec3 fogColor) {
    float skyAmbient = skyAmbientAmount(altitude);
    float lowLightBlend = 1.0 - smoothstep(radians(3.0), radians(17.0), altitude);
    float horizonWarmth = smoothstep(radians(-6.0), radians(2.0), altitude) *
        (1.0 - smoothstep(radians(6.0), radians(16.0), altitude));

    vec3 skyHaze = clamp(mix(fogColor, horizonColor, 0.45), vec3(0.0), vec3(1.0));
    vec3 nightColor = color * vec3(0.58, 0.64, 0.80) + vec3(0.026, 0.035, 0.060);
    vec3 twilightColor = color * vec3(0.80, 0.84, 0.95) + skyHaze * 0.040;
    twilightColor = mix(twilightColor, color * vec3(0.96, 0.84, 0.68) + skyHaze * 0.070, horizonWarmth * 0.58);
    vec3 lowLightColor = mix(nightColor, twilightColor, skyAmbient);

    return mix(color, lowLightColor, lowLightBlend);
}

const float SHADOW_ATLAS_SIZE = 2048.0;
const float SHADOW_HIT_THRESHOLD = 0.28;
float horizonChannelValue(vec4 packed, float channel) {
    if (channel < 0.5) return packed.r;
    if (channel < 1.5) return packed.g;
    if (channel < 2.5) return packed.b;
    return packed.a;
}

float horizonBin(float bin, vec2 atlasUV) {
    float binCount = max(u_horizon_bins, 1.0);
    float wrappedBin = mod(bin + binCount, binCount);
    if (wrappedBin < 4.0) {
        return horizonChannelValue(texture(u_horizon0, atlasUV), wrappedBin);
    }
    if (wrappedBin < 8.0) {
        return horizonChannelValue(texture(u_horizon1, atlasUV), wrappedBin - 4.0);
    }
    if (wrappedBin < 12.0) {
        return horizonChannelValue(texture(u_horizon2, atlasUV), wrappedBin - 8.0);
    }
    return horizonChannelValue(texture(u_horizon3, atlasUV), wrappedBin - 12.0);
}

float sampleHorizonAngle(float azimuth, vec2 atlasUV) {
    float binCount = max(u_horizon_bins, 1.0);
    float bin = mod(azimuth, PI * 2.0) / ((PI * 2.0) / binCount);
    float bin0 = floor(bin);
    float bin1 = mod(bin0 + 1.0, binCount);
    float t = fract(bin);
    return mix(horizonBin(bin0, atlasUV), horizonBin(bin1, atlasUV), t) * (PI * 0.5);
}

float horizonShadowMask(vec2 atlasUV) {
    if (u_horizon_available < 0.5) return 0.0;

    float sunAzimuth = mod(atan(u_sun_direction.x, -u_sun_direction.y) + PI * 2.0, PI * 2.0);
    float terrainHorizon = sampleHorizonAngle(sunAzimuth, clamp(atlasUV, vec2(0.0), vec2(1.0)));
    float lowSunSoftness = 1.0 - smoothstep(radians(10.0), radians(34.0), u_sun_altitude);
    float horizonEdge = mix(radians(0.55), radians(1.25), lowSunSoftness) * max(u_horizon_edge_softness, 0.25);
    float horizonSignalAA = fwidth(terrainHorizon) * mix(1.15, 1.75, lowSunSoftness);
    float horizonQuantAA = radians(0.18);
    horizonEdge = max(horizonEdge, max(horizonSignalAA, horizonQuantAA));
    float ditherAmount = clamp(u_horizon_edge_naturalness, 0.0, 1.2);
    float ditherNoise =
        valueNoise(atlasUV * 1536.0 + vec2(37.0, 173.0)) * 0.65 +
        valueNoise(atlasUV * 3072.0 + vec2(211.0, 59.0)) * 0.35;
    float thresholdJitter = (ditherNoise - 0.5) * horizonEdge * 0.22 * ditherAmount;
    float directVisibility = smoothstep(terrainHorizon - horizonEdge + thresholdJitter, terrainHorizon + horizonEdge + thresholdJitter, u_sun_altitude);
    return 1.0 - directVisibility;
}

float shadowHitAt(vec2 atlasUV, float edgeAA) {
    float rawMask = texture(u_shadow_atlas, clamp(atlasUV, vec2(0.0), vec2(1.0))).r;
    float thresholdJitter = (valueNoise(atlasUV * SHADOW_ATLAS_SIZE * 1.37 + vec2(91.0, 53.0)) - 0.5) * edgeAA * 0.55;
    float threshold = SHADOW_HIT_THRESHOLD + thresholdJitter;
    return smoothstep(threshold - edgeAA, threshold + edgeAA, rawMask);
}

vec2 rotateShadowOffset(vec2 offset, float c, float s) {
    return vec2(offset.x * c - offset.y * s, offset.x * s + offset.y * c);
}

float poissonShadowHit(vec2 atlasUV, vec2 offset, float radius, float edgeAA, float c, float s) {
    vec2 rotatedOffset = rotateShadowOffset(offset, c, s) * (radius / SHADOW_ATLAS_SIZE);
    return shadowHitAt(atlasUV + rotatedOffset, edgeAA);
}

float remapShadowMask(float rawMask, vec2 atlasUV) {
    float edgeGradient = fwidth(rawMask);
    float edgeAA = clamp(edgeGradient * 0.58 + 0.012, 0.012, 0.058);
    float center = smoothstep(SHADOW_HIT_THRESHOLD - edgeAA, SHADOW_HIT_THRESHOLD + edgeAA, rawMask);
    if (edgeGradient < 0.002 && (center < 0.001 || center > 0.999)) {
        return center;
    }

    vec2 texel = vec2(1.0 / SHADOW_ATLAS_SIZE);
    float lowSunSoftness = 1.0 - smoothstep(radians(10.0), radians(34.0), u_sun_altitude);
    float radius = mix(1.65, 3.15, lowSunSoftness);
    vec2 atlasCell = floor(atlasUV * SHADOW_ATLAS_SIZE);
    float angle = hash12(atlasCell + vec2(7.0, 113.0)) * PI * 2.0;
    float c = cos(angle);
    float s = sin(angle);
    vec2 jitter = vec2(
        hash12(atlasCell + vec2(17.0, 29.0)) - 0.5,
        hash12(atlasCell + vec2(61.0, 11.0)) - 0.5
    ) * texel * mix(0.85, 1.55, lowSunSoftness);
    vec2 sampleUV = atlasUV + jitter;

    float pcf =
        center * 1.7 +
        poissonShadowHit(sampleUV, vec2( 0.1305,  0.9914), radius, edgeAA, c, s) * 0.78 +
        poissonShadowHit(sampleUV, vec2(-0.3688,  0.5490), radius, edgeAA, c, s) +
        poissonShadowHit(sampleUV, vec2( 0.6204,  0.6318), radius, edgeAA, c, s) +
        poissonShadowHit(sampleUV, vec2(-0.7713,  0.1345), radius, edgeAA, c, s) +
        poissonShadowHit(sampleUV, vec2( 0.7211, -0.3072), radius, edgeAA, c, s) +
        poissonShadowHit(sampleUV, vec2(-0.2805, -0.8537), radius, edgeAA, c, s) * 0.82 +
        poissonShadowHit(sampleUV, vec2( 0.0702, -0.3881), radius * 0.72, edgeAA, c, s) * 0.72 +
        poissonShadowHit(sampleUV, vec2(-0.8931, -0.4492), radius, edgeAA, c, s) * 0.78;

    float filtered = pcf / 8.80;
    float transition = filtered * (1.0 - filtered) * 4.0;
    float microBreakup = (valueNoise(atlasUV * SHADOW_ATLAS_SIZE * 2.0 + vec2(211.0, 19.0)) - 0.5) * 0.022 * transition;
    return clamp(filtered + microBreakup, 0.0, 1.0);
}

vec2 localIgorReliefMask(vec2 gradient) {
    vec3 normal = normalize(vec3(-gradient.x, -gradient.y, 1.0));
    vec3 lightDir = normalize(vec3(u_sun_direction, max(tan(max(u_sun_altitude, radians(1.5))), 0.03)));
    float lambert = dot(normal, lightDir);

    float slopeStrength = atan(length(gradient) * 2.0) * 2.0 / PI;
    float lowSunBoost = 1.0 - smoothstep(radians(18.0), radians(45.0), u_sun_altitude);
    float shadow = slopeStrength * (1.0 - smoothstep(0.08, 0.62, lambert)) * mix(0.92, 1.16, lowSunBoost);
    float highlight = slopeStrength * smoothstep(0.36, 0.95, lambert) * 0.42;

    return clamp(vec2(shadow, highlight), 0.0, 1.0);
}

void main() {
    vec4 surface_color = texture(u_texture, vec2(v_texture_pos.x, 1.0 - v_texture_pos.y));

    // Skip fog blending in globe mode
    if (!u_is_globe_mode && v_fog_depth > u_fog_ground_blend) {
        vec4 surface_color_linear = gammaToLinear(surface_color);
        float blend_color = smoothstep(0.0, 1.0, max((v_fog_depth - u_horizon_fog_blend) / (1.0 - u_horizon_fog_blend), 0.0));
        vec4 fog_horizon_color_linear = mix(gammaToLinear(u_fog_color), gammaToLinear(u_horizon_color), blend_color);
        float factor_fog = max(v_fog_depth - u_fog_ground_blend, 0.0) / (1.0 - u_fog_ground_blend);
        fragColor = linearToGamma(mix(surface_color_linear, fog_horizon_color_linear, pow(factor_fog, 2.0) * u_fog_ground_blend_opacity));
    } else {
        fragColor = surface_color;
    }

    // ── Distance-Based Fading Contour Lines ──
    if (u_contour_enabled > 0.5 && u_contour_interval > 0.1) {
        float val = v_elevation * u_contour_multiplier;
        float interval_minor = u_contour_interval;
        float interval_major = interval_minor * 10.0;

        // Fade in with zoom (invisible below z11, fully visible at z13)
        // Fade out with distance (visible within 500m, gone at 3000m)
        float zoom_floor = smoothstep(11.0, 13.0, u_zoom);
        float distance_fade = 1.0 - smoothstep(500.0, 3000.0, v_dist_linear);
        float global_fade = zoom_floor * distance_fade;

        if (global_fade > 0.01) {
            // Distance to nearest contour in meters
            float dist_minor = mod(val, interval_minor);
            if (dist_minor > interval_minor * 0.5) dist_minor = interval_minor - dist_minor;

            float dist_major = mod(val, interval_major);
            if (dist_major > interval_major * 0.5) dist_major = interval_major - dist_major;

            // Screen-space gradient (how many meters per pixel)
            float grad_mag = length(vec2(dFdx(val), dFdy(val)));
            float pixel_dist_minor = dist_minor / max(grad_mag, 1e-6);
            float pixel_dist_major = dist_major / max(grad_mag, 1e-6);

            // Density fade: prevent solid blocks on steep cliffs
            float density_fade = clamp(1.0 - (grad_mag / interval_minor) * 1.5, 0.0, 1.0);

            // 1px wide lines with antialiasing
            float alpha_minor = (1.0 - smoothstep(0.0, 1.0, pixel_dist_minor)) * density_fade;
            float alpha_major = 1.0 - smoothstep(0.0, 1.0, pixel_dist_major);

            float final_alpha = max(alpha_minor * 0.6, alpha_major * 0.85) * global_fade;
            // Un-premultiply alpha (MapLibre Color class premultiplies)
            vec3 base_color = u_contour_color.a > 0.001 ? u_contour_color.rgb / u_contour_color.a : u_contour_color.rgb;
            vec3 color = mix(base_color, vec3(0.0), alpha_major * 0.15);

            fragColor = mix(fragColor, vec4(color, 1.0), final_alpha * u_contour_color.a);
        }
    }

    // ── Full-res local Igor relief is independent from the global shadow atlas.
    // Cast shadows are atlas-bounded, but local relief must cover every terrain tile.
    float directSun = directSunAmount(u_sun_altitude);
    float skyAmbient = skyAmbientAmount(u_sun_altitude);
    float horizonWarmth = smoothstep(radians(-6.0), radians(2.0), u_sun_altitude) *
        (1.0 - smoothstep(radians(6.0), radians(16.0), u_sun_altitude));
    float tintMix = 1.0 - smoothstep(radians(5.0), radians(22.0), u_sun_altitude);
    float directShadow = min(u_shadow_intensity, castShadowAmount(u_sun_altitude));

    vec2 localRelief = vec2(0.0);
    if (u_dem_ao_dim > 2.0 && (u_self_shadow_mult > 0.001 || u_igor_relief_enabled > 0.5)) {
        localRelief = localIgorReliefMask(sampleReliefGradient(clamp(v_dem_coord, vec2(1.0), vec2(u_dem_ao_dim))));
    }

    if (u_igor_relief_enabled > 0.5) {
        vec3 highlightTint = mix(vec3(0.86, 0.91, 1.0), vec3(1.0, 0.94, 0.80), tintMix);
        float reliefHighlight = localRelief.y * (0.035 + directShadow * 0.11) * mix(0.55, 1.0, skyAmbient);
        vec3 ambientLiftTint = mix(vec3(0.72, 0.80, 1.0), vec3(1.0, 0.88, 0.66), tintMix);
        float ambientReliefAO = localRelief.x * (0.035 + skyAmbient * 0.040);
        float ambientReliefLift = localRelief.y * 0.014 * mix(0.55, 1.0, skyAmbient);
        fragColor.rgb = mix(fragColor.rgb, highlightTint, reliefHighlight);
        fragColor.rgb *= 1.0 - ambientReliefAO;
        fragColor.rgb = mix(fragColor.rgb, ambientLiftTint, ambientReliefLift);
    }

    // ── Global Shadow + Time-of-Day Coloring ──
    vec2 atlasUV = v_atlas_uv;
    if (atlasUV.x >= -0.001 && atlasUV.x <= 1.001 && atlasUV.y >= -0.001 && atlasUV.y <= 1.001) {
        float rawAtlasShadow = clamp(texture(u_shadow_atlas, clamp(atlasUV, vec2(0.0), vec2(1.0))).r, 0.0, 1.0);
        float raymarchedShadow = remapShadowMask(rawAtlasShadow, atlasUV);
        float horizonShadow = horizonShadowMask(atlasUV);
        float shadowMask = mix(raymarchedShadow, horizonShadow, clamp(u_horizon_available, 0.0, 1.0));

        vec3 shadowTint = skyMatchedShadowTint(u_sun_altitude, horizonWarmth, u_horizon_color.rgb, u_fog_color.rgb);

        float selfShadowMask = clamp(localRelief.x * u_self_shadow_mult * mix(0.36, 0.92, directShadow), 0.0, 1.0);
        float baseShadow = max(shadowMask, selfShadowMask);
        float shadowAlpha = clamp(baseShadow * directShadow * u_cast_shadow_mult * 0.62, 0.0, 0.74);
        fragColor.rgb = mix(fragColor.rgb, shadowTint, shadowAlpha);

        // Preserve fine terrain relief inside broad cast shadows. Without this
        // post-shadow AO pass, opaque cast shadows flatten the integrated Igor detail.
        if (u_igor_relief_enabled > 0.5) {
            float castPresence = clamp(shadowMask * directShadow, 0.0, 1.0);
            float reliefAO = localRelief.x * castPresence * 0.105;
            float reliefLift = localRelief.y * (0.014 + castPresence * 0.025) * mix(0.55, 1.0, skyAmbient);
            vec3 ambientLiftTint = mix(vec3(0.72, 0.80, 1.0), vec3(1.0, 0.88, 0.66), tintMix);
            fragColor.rgb *= 1.0 - reliefAO;
            fragColor.rgb = mix(fragColor.rgb, ambientLiftTint, reliefLift);
        }

        if (u_debug_mode > 0) {
            if (atlasUV.x >= 0.0 && atlasUV.x <= 1.0 && atlasUV.y >= 0.0 && atlasUV.y <= 1.0) {
                if (u_debug_mode == 3) {
                    vec2 grid = fract(atlasUV * 16.0);
                    float line = step(0.98, grid.x) + step(0.98, grid.y);
                    fragColor.rgb = mix(fragColor.rgb, vec3(0.0, 0.2, 0.8), 0.4);
                    fragColor.rgb = mix(fragColor.rgb, vec3(1.0, 1.0, 0.0), line * 0.5);
                    fragColor.rgb = mix(fragColor.rgb, vec3(atlasUV, 0.0), 0.2);
                } else if (u_debug_mode == 2) {
                    fragColor.rgb = mix(fragColor.rgb, vec3(shadowMask, shadowMask * 0.6, 0.0), 0.8);
                } else if (u_debug_mode == 4) {
                    fragColor.rgb = vec3(1.0); // raw elev debug removed
                } else if (u_debug_mode == 5) {
                    fragColor.rgb = vec3(0.5); // normal debug removed
                }
            }
        }
    }

    fragColor.rgb = applyTwilightAmbient(fragColor.rgb, u_sun_altitude, u_horizon_color.rgb, u_fog_color.rgb);
}
