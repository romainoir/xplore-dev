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
uniform sampler2D u_shadow_near_atlas;
uniform sampler2D u_horizon0;
uniform sampler2D u_horizon1;
uniform sampler2D u_horizon2;
uniform sampler2D u_horizon3;
uniform highp vec4 u_atlas_bounds; // [minX, minY, maxX, maxY]
uniform highp vec4 u_near_atlas_bounds; // [minX, minY, maxX, maxY]
uniform float u_shadow_intensity;
uniform float u_shadow_near_available;
uniform float u_shadow_near_fade;
uniform float u_shadow_near_debug_tint;
uniform float u_shadow_display_mode;
uniform float u_shadow_component_mode;
uniform float u_shadow_near_replace_mode;
uniform float u_shadow_global_softness;
uniform float u_horizon_available;
uniform float u_horizon_bins;
uniform float u_horizon_edge_softness;
uniform float u_horizon_edge_naturalness;
uniform int u_debug_mode;
uniform float u_cast_shadow_mult;
uniform float u_self_shadow_mult;
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
uniform float u_shadow_atlas_size;
uniform float u_shadow_near_atlas_size;
uniform float u_contact_shadow_enabled;
uniform float u_contact_shadow_strength;
uniform float u_contact_shadow_distance;
uniform float u_contact_shadow_steps;
uniform float u_shadow_white_base;

in vec2 v_texture_pos;
in vec2 v_atlas_uv;
in vec2 v_near_atlas_uv;
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

vec2 sampleCheapDemGradient(vec2 coord) {
    vec2 safeCoord = clamp(coord, vec2(1.0), vec2(u_dem_ao_dim));
    float left = sampleDemTexel(safeCoord + vec2(-1.0, 0.0));
    float right = sampleDemTexel(safeCoord + vec2(1.0, 0.0));
    float down = sampleDemTexel(safeCoord + vec2(0.0, -1.0));
    float up = sampleDemTexel(safeCoord + vec2(0.0, 1.0));
    return vec2(right - left, up - down) / (2.0 * max(u_dem_ao_meters_per_pixel, 1.0));
}

vec2 sampleReliefGradient(vec2 coord) {
    if (u_dem_derivative_available > 0.5) {
        return samplePreparedDemGradient(coord);
    }

    // Keep relief shadows stable while MapLibre's derivative cache catches up.
    // The full Sobel fallback is too expensive during pan/zoom, but a cheap
    // central difference prevents tiles from briefly becoming flat/white.
    return sampleCheapDemGradient(coord);
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

vec3 applySkyLightTint(vec3 color, float altitude, vec3 horizonColor, vec3 fogColor) {
    float skyAmbient = skyAmbientAmount(altitude);
    float lowLightBlend = 1.0 - smoothstep(radians(3.0), radians(17.0), altitude);
    float horizonWarmth = smoothstep(radians(-6.0), radians(2.0), altitude) *
        (1.0 - smoothstep(radians(6.0), radians(16.0), altitude));
    float redWarmth = smoothstep(radians(-4.0), radians(0.8), altitude) *
        (1.0 - smoothstep(radians(2.5), radians(9.0), altitude));

    vec3 skyHaze = clamp(mix(fogColor, horizonColor, 0.55), vec3(0.0), vec3(1.0));
    vec3 nightColor = color * vec3(0.58, 0.63, 0.78) + vec3(0.026, 0.034, 0.056);
    float fullNight = 1.0 - smoothstep(radians(-10.0), radians(-2.0), altitude);
    nightColor = mix(nightColor, vec3(0.045, 0.052, 0.075), fullNight * 0.38);
    vec3 twilightCool = color * vec3(0.80, 0.84, 0.96) + skyHaze * 0.045;
    vec3 golden = color * vec3(1.02, 0.84, 0.62) + skyHaze * 0.085;
    vec3 redGold = color * vec3(1.06, 0.72, 0.54) + skyHaze * 0.100;
    vec3 twilightColor = mix(twilightCool, golden, horizonWarmth * 0.72);
    twilightColor = mix(twilightColor, redGold, redWarmth * 0.55);
    vec3 lowLightColor = mix(nightColor, twilightColor, skyAmbient);

    return mix(color, lowLightColor, lowLightBlend);
}

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

float shadowHitAt(vec2 atlasUV, float edgeAA, float thresholdJitter) {
    float rawMask = texture(u_shadow_atlas, clamp(atlasUV, vec2(0.0), vec2(1.0))).r;
    float aa = clamp(edgeAA * 0.45, 0.004, 0.028);
    return smoothstep(0.02 - aa + thresholdJitter, 0.98 + aa + thresholdJitter, rawMask);
}

float orientedShadowHit(vec2 atlasUV, vec2 edgeNormal, vec2 offset, float radius, float edgeAA, float thresholdJitter) {
    vec2 edgeTangent = vec2(-edgeNormal.y, edgeNormal.x);
    vec2 sampleOffset = (edgeNormal * offset.x + edgeTangent * offset.y) * (radius / max(u_shadow_atlas_size, 1.0));
    return shadowHitAt(atlasUV + sampleOffset, edgeAA, thresholdJitter);
}

vec2 shadowAtlasEdgeNormal(vec2 atlasUV, float rawMask) {
    vec2 texel = vec2(1.0 / max(u_shadow_atlas_size, 1.0));
    float left = texture(u_shadow_atlas, clamp(atlasUV - vec2(texel.x, 0.0), vec2(0.0), vec2(1.0))).r;
    float right = texture(u_shadow_atlas, clamp(atlasUV + vec2(texel.x, 0.0), vec2(0.0), vec2(1.0))).r;
    float down = texture(u_shadow_atlas, clamp(atlasUV - vec2(0.0, texel.y), vec2(0.0), vec2(1.0))).r;
    float up = texture(u_shadow_atlas, clamp(atlasUV + vec2(0.0, texel.y), vec2(0.0), vec2(1.0))).r;
    vec2 atlasGradient = vec2(right - left, up - down);
    if (dot(atlasGradient, atlasGradient) > 0.000001) {
        return normalize(atlasGradient);
    }

    vec2 screenGradient = vec2(dFdx(rawMask), dFdy(rawMask));
    if (dot(screenGradient, screenGradient) > 0.000001) {
        return normalize(screenGradient);
    }
    return vec2(1.0, 0.0);
}

float remapShadowMask(float rawMask, vec2 atlasUV) {
    if (u_shadow_display_mode > 0.5) {
        float globalSoftness = clamp(u_shadow_global_softness, 1.0, 3.0);
        float edgeGradient = fwidth(rawMask);
        float atlasFootprint = max(length(dFdx(atlasUV) * u_shadow_atlas_size), length(dFdy(atlasUV) * u_shadow_atlas_size));
        float aa = clamp(max(edgeGradient * mix(0.36, 0.58, (globalSoftness - 1.0) * 0.5), 0.0035 + atlasFootprint * mix(0.0018, 0.0042, (globalSoftness - 1.0) * 0.5)), 0.0035, 0.052);
        float base = smoothstep(0.10 - aa, 0.88 + aa, rawMask);
        if (edgeGradient < 0.0015 && (base < 0.001 || base > 0.999)) {
            return base;
        }

        vec2 edgeNormal = shadowAtlasEdgeNormal(atlasUV, rawMask);
        float atlasScale = max(u_shadow_atlas_size, 1.0);
        float lowSunSoftness = 1.0 - smoothstep(radians(10.0), radians(34.0), u_sun_altitude);
        float radius = clamp((mix(0.92, 1.95, lowSunSoftness) + atlasFootprint * 0.42) * globalSoftness, 0.92, 5.40);
        float edgeBand = smoothstep(0.03, 0.42, base) * (1.0 - smoothstep(0.58, 0.98, base));
        float stableNoise = valueNoise(atlasUV * atlasScale * 0.65 + vec2(41.0, 137.0)) * 0.65 +
            valueNoise(atlasUV * atlasScale * 1.37 + vec2(211.0, 17.0)) * 0.35;
        float jitter = (stableNoise - 0.5) * edgeBand * 0.013;
        vec2 texelNormal = edgeNormal / atlasScale;
        vec2 texelTangent = vec2(-texelNormal.y, texelNormal.x);
        float s0 = smoothstep(0.10 - aa + jitter, 0.88 + aa + jitter, rawMask);
        float s1 = shadowHitAt(atlasUV + texelNormal * radius, aa, jitter * 0.35);
        float s2 = shadowHitAt(atlasUV - texelNormal * radius, aa, jitter * 0.35);
        float s3 = shadowHitAt(atlasUV + texelTangent * radius * 0.62, aa, jitter * 0.20);
        float s4 = shadowHitAt(atlasUV - texelTangent * radius * 0.62, aa, jitter * 0.20);
        float s5 = shadowHitAt(atlasUV + texelNormal * radius * 2.05 + texelTangent * radius * 0.25, aa, jitter * 0.16);
        float s6 = shadowHitAt(atlasUV - texelNormal * radius * 2.05 - texelTangent * radius * 0.25, aa, jitter * 0.16);
        float s7 = shadowHitAt(atlasUV + texelNormal * radius * 1.35 - texelTangent * radius * 0.95, aa, jitter * 0.12);
        float s8 = shadowHitAt(atlasUV - texelNormal * radius * 1.35 + texelTangent * radius * 0.95, aa, jitter * 0.12);
        float filtered = (s0 * 2.20 + s1 * 0.92 + s2 * 0.92 + s3 * 0.48 + s4 * 0.48 + s5 * 0.42 + s6 * 0.42 + s7 * 0.25 + s8 * 0.25) / 6.34;
        float crisp = smoothstep(0.13, 0.87, filtered);

        return clamp(mix(filtered, crisp, 0.05), 0.0, 1.0);
    }

    float edgeGradient = fwidth(rawMask);
    float atlasFootprint = max(length(dFdx(atlasUV) * u_shadow_atlas_size), length(dFdy(atlasUV) * u_shadow_atlas_size));
    float edgeAA = clamp(max(edgeGradient * 0.48, 0.004 + atlasFootprint * 0.0028), 0.004, 0.038);
    float center = shadowHitAt(atlasUV, edgeAA, 0.0);
    if (edgeGradient < 0.0015 && (center < 0.001 || center > 0.999)) {
        return center;
    }

    float lowSunSoftness = 1.0 - smoothstep(radians(10.0), radians(34.0), u_sun_altitude);
    vec2 edgeNormal = shadowAtlasEdgeNormal(atlasUV, rawMask);
    vec2 edgeTangent = vec2(-edgeNormal.y, edgeNormal.x);
    float radius = clamp(max(mix(1.15, 2.35, lowSunSoftness), atlasFootprint * 0.72), 1.15, 4.50);
    float transition = smoothstep(0.025, 0.36, center) * (1.0 - smoothstep(0.64, 0.985, center));
    float gradientBand = smoothstep(0.001, 0.018, edgeGradient);
    float edgeBand = clamp(max(transition, gradientBand), 0.0, 1.0);
    float atlasScale = max(u_shadow_atlas_size, 1.0);
    float coarseNoise = valueNoise(atlasUV * atlasScale * 0.19 + vec2(17.0, 91.0));
    float midNoise = valueNoise(atlasUV * atlasScale * 0.73 + vec2(131.0, 47.0));
    float tangentNoise = valueNoise(atlasUV * atlasScale * 0.41 + vec2(59.0, 179.0));
    float breakup = ((coarseNoise * 0.64 + midNoise * 0.36) - 0.5) * 2.0;
    float tangentBreakup = (tangentNoise - 0.5) * 2.0;
    vec2 breakupOffset = (edgeNormal * breakup * 0.52 + edgeTangent * tangentBreakup * 0.18) * (edgeBand * radius / atlasScale);
    float thresholdJitter = breakup * edgeBand * 0.025;
    vec2 filteredUV = atlasUV + breakupOffset;
    center = shadowHitAt(filteredUV, edgeAA, thresholdJitter);

    float pcf =
        center * 3.20 +
        orientedShadowHit(filteredUV, edgeNormal, vec2(-1.10,  0.00), radius, edgeAA, thresholdJitter) * 1.15 +
        orientedShadowHit(filteredUV, edgeNormal, vec2( 1.10,  0.00), radius, edgeAA, thresholdJitter) * 1.15 +
        orientedShadowHit(filteredUV, edgeNormal, vec2( 0.00, -0.82), radius, edgeAA, thresholdJitter) * 0.74 +
        orientedShadowHit(filteredUV, edgeNormal, vec2( 0.00,  0.82), radius, edgeAA, thresholdJitter) * 0.74 +
        orientedShadowHit(filteredUV, edgeNormal, vec2(-0.72,  0.62), radius, edgeAA, thresholdJitter) * 0.72 +
        orientedShadowHit(filteredUV, edgeNormal, vec2( 0.72, -0.62), radius, edgeAA, thresholdJitter) * 0.72 +
        orientedShadowHit(filteredUV, edgeNormal, vec2(-0.72, -0.62), radius, edgeAA, thresholdJitter) * 0.52 +
        orientedShadowHit(filteredUV, edgeNormal, vec2( 0.72,  0.62), radius, edgeAA, thresholdJitter) * 0.52 +
        orientedShadowHit(filteredUV, edgeNormal, vec2(-1.55,  0.25), radius, edgeAA, thresholdJitter) * 0.34 +
        orientedShadowHit(filteredUV, edgeNormal, vec2( 1.55, -0.25), radius, edgeAA, thresholdJitter) * 0.34 +
        orientedShadowHit(filteredUV, edgeNormal, vec2(-0.20,  1.45), radius, edgeAA, thresholdJitter) * 0.26 +
        orientedShadowHit(filteredUV, edgeNormal, vec2( 0.20, -1.45), radius, edgeAA, thresholdJitter) * 0.26;

    float filtered = pcf / 10.66;
    float crisp = smoothstep(0.18, 0.82, filtered);
    float crispAmount = mix(0.08, 0.03, lowSunSoftness);
    return clamp(mix(filtered, crisp, crispAmount), 0.0, 1.0);
}

float nearShadowHitAt(vec2 atlasUV, float edgeAA) {
    float rawMask = texture(u_shadow_near_atlas, clamp(atlasUV, vec2(0.0), vec2(1.0))).r;
    float aa = clamp(edgeAA * 0.45, 0.004, 0.028);
    return smoothstep(0.025 - aa, 0.975 + aa, rawMask);
}

float remapNearShadowMask(float rawMask, vec2 atlasUV) {
    float edgeGradient = fwidth(rawMask);
    float atlasFootprint = max(length(dFdx(atlasUV) * u_shadow_near_atlas_size), length(dFdy(atlasUV) * u_shadow_near_atlas_size));
    float edgeAA = clamp(max(edgeGradient * 0.52, 0.004 + atlasFootprint * 0.0025), 0.004, 0.035);
    float center = nearShadowHitAt(atlasUV, edgeAA);
    if (edgeGradient < 0.0015 && (center < 0.001 || center > 0.999)) {
        return center;
    }

    vec2 texel = vec2(1.0 / max(u_shadow_near_atlas_size, 1.0));
    float pcf =
        center * 2.70 +
        nearShadowHitAt(atlasUV + vec2( texel.x, 0.0), edgeAA) * 0.95 +
        nearShadowHitAt(atlasUV + vec2(-texel.x, 0.0), edgeAA) * 0.95 +
        nearShadowHitAt(atlasUV + vec2(0.0,  texel.y), edgeAA) * 0.95 +
        nearShadowHitAt(atlasUV + vec2(0.0, -texel.y), edgeAA) * 0.95 +
        nearShadowHitAt(atlasUV + vec2( texel.x,  texel.y), edgeAA) * 0.42 +
        nearShadowHitAt(atlasUV + vec2(-texel.x,  texel.y), edgeAA) * 0.42 +
        nearShadowHitAt(atlasUV + vec2( texel.x, -texel.y), edgeAA) * 0.42 +
        nearShadowHitAt(atlasUV + vec2(-texel.x, -texel.y), edgeAA) * 0.42;

    float filtered = pcf / 8.18;
    return clamp(mix(filtered, smoothstep(0.18, 0.82, filtered), 0.035), 0.0, 1.0);
}

float atlasEdgeRoom(vec2 atlasUV) {
    return min(min(atlasUV.x, 1.0 - atlasUV.x), min(atlasUV.y, 1.0 - atlasUV.y));
}

float rayRoomToAtlasEdge(vec2 atlasUV, vec2 rayDir) {
    float tx = rayDir.x > 0.0001 ? (1.0 - atlasUV.x) / rayDir.x :
        rayDir.x < -0.0001 ? atlasUV.x / -rayDir.x : 1.0e6;
    float ty = rayDir.y > 0.0001 ? (1.0 - atlasUV.y) / rayDir.y :
        rayDir.y < -0.0001 ? atlasUV.y / -rayDir.y : 1.0e6;
    return min(tx, ty);
}

float nearAtlasCoverage(vec2 nearAtlasUV) {
    vec2 nearSpan = max(u_near_atlas_bounds.zw - u_near_atlas_bounds.xy, vec2(1.0e-9));
    vec2 sunDirNearUV = vec2(u_sun_direction.x / nearSpan.x, -u_sun_direction.y / nearSpan.y);
    float sunDirLen = length(sunDirNearUV);
    sunDirNearUV = sunDirLen > 0.00001 ? sunDirNearUV / sunDirLen : vec2(1.0, 0.0);

    // The near cascade can only be trusted if the receiver is not close to the
    // atlas border and there is enough room in the sunward direction for local
    // casters. Otherwise it may miss far terrain that the global atlas still has.
    float borderCoverage = smoothstep(0.012, 0.060, atlasEdgeRoom(nearAtlasUV));
    float sunwardCoverage = smoothstep(0.045, 0.170, rayRoomToAtlasEdge(nearAtlasUV, sunDirNearUV));
    return borderCoverage * sunwardCoverage;
}

float nearAtlasReplaceCoverage(vec2 nearAtlasUV) {
    vec2 nearSpan = max(u_near_atlas_bounds.zw - u_near_atlas_bounds.xy, vec2(1.0e-9));
    vec2 sunDirNearUV = vec2(u_sun_direction.x / nearSpan.x, -u_sun_direction.y / nearSpan.y);
    float sunDirLen = length(sunDirNearUV);
    sunDirNearUV = sunDirLen > 0.00001 ? sunDirNearUV / sunDirLen : vec2(1.0, 0.0);

    // Replacement is stricter than additive coverage. In this central region,
    // the near cascade has enough border/sunward room to clean coarse global
    // edge pixels without deleting real long-range mountain shadows elsewhere.
    float borderCoverage = smoothstep(0.075, 0.155, atlasEdgeRoom(nearAtlasUV));
    float sunwardCoverage = smoothstep(0.180, 0.360, rayRoomToAtlasEdge(nearAtlasUV, sunDirNearUV));
    return borderCoverage * sunwardCoverage;
}

float localIgorLambert(vec2 gradient) {
    vec3 normal = normalize(vec3(-gradient.x, -gradient.y, 1.0));
    vec3 lightDir = normalize(vec3(u_sun_direction, max(tan(max(u_sun_altitude, radians(1.5))), 0.03)));
    return dot(normal, lightDir);
}

float localIgorSlopeStrength(vec2 gradient) {
    return atan(length(gradient) * 2.0) * 2.0 / PI;
}

float localIgorReliefShadowFrom(float lambert, float slopeStrength) {
    float lowSunBoost = 1.0 - smoothstep(radians(18.0), radians(45.0), u_sun_altitude);
    float shadow = slopeStrength * (1.0 - smoothstep(0.08, 0.62, lambert)) * mix(0.92, 1.16, lowSunBoost);

    return clamp(shadow, 0.0, 1.0);
}

float localIgorReliefShadow(vec2 gradient) {
    return localIgorReliefShadowFrom(localIgorLambert(gradient), localIgorSlopeStrength(gradient));
}

float localTerrainContactShadow(vec2 coord, float startElevation) {
    if (u_contact_shadow_enabled < 0.5 || u_sun_altitude <= radians(0.25) || u_dem_ao_dim <= 2.0) {
        return 0.0;
    }

    vec2 rayDir = normalize(u_sun_direction);
    if (dot(rayDir, rayDir) < 0.5) {
        return 0.0;
    }

    float demGsd = max(u_dem_ao_meters_per_pixel, 0.5);
    float maxDistance = max(u_contact_shadow_distance, demGsd * 6.0);
    float steps = clamp(floor(u_contact_shadow_steps + 0.5), 4.0, 14.0);
    float stepMeters = max(maxDistance / steps, demGsd * 0.85);
    float tanSun = max(tan(u_sun_altitude), 0.018);
    float lowSunBoost = 1.0 - smoothstep(radians(10.0), radians(32.0), u_sun_altitude);
    float hitBias = max(0.65, demGsd * mix(0.035, 0.020, lowSunBoost));
    float contact = 0.0;

    for (int i = 1; i <= 14; i++) {
        if (float(i) > steps) break;

        float distanceMeters = (float(i) - 0.35) * stepMeters;
        if (distanceMeters > maxDistance) break;

        vec2 sampleCoord = coord + rayDir * (distanceMeters / demGsd);
        if (sampleCoord.x < 1.0 || sampleCoord.x > u_dem_ao_dim ||
            sampleCoord.y < 1.0 || sampleCoord.y > u_dem_ao_dim) {
            break;
        }

        float blockerElevation = sampleDemTexel(sampleCoord);
        float rayHeight = startElevation + distanceMeters * tanSun + hitBias;
        float excess = blockerElevation - rayHeight;
        float hit = smoothstep(0.20, max(1.15, demGsd * 0.18), excess);
        float distanceFade = 1.0 - smoothstep(maxDistance * 0.16, maxDistance, distanceMeters);
        contact = max(contact, hit * distanceFade);
    }

    return clamp(contact * u_contact_shadow_strength, 0.0, 1.0);
}

vec4 applyTerrainFog(vec4 color) {
    if (u_is_globe_mode || v_fog_depth <= u_fog_ground_blend) {
        return color;
    }

    vec4 colorLinear = gammaToLinear(color);
    float blendColor = smoothstep(0.0, 1.0, max((v_fog_depth - u_horizon_fog_blend) / (1.0 - u_horizon_fog_blend), 0.0));
    vec4 fogHorizonColorLinear = mix(gammaToLinear(u_fog_color), gammaToLinear(u_horizon_color), blendColor);
    float factorFog = max(v_fog_depth - u_fog_ground_blend, 0.0) / (1.0 - u_fog_ground_blend);
    return linearToGamma(mix(colorLinear, fogHorizonColorLinear, pow(factorFog, 2.0) * u_fog_ground_blend_opacity));
}

void main() {
    vec4 surface_color = texture(u_texture, vec2(v_texture_pos.x, 1.0 - v_texture_pos.y));
    surface_color = mix(surface_color, vec4(1.0), clamp(u_shadow_white_base, 0.0, 1.0));
    fragColor = surface_color;

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
    float skyAmbient = skyAmbientAmount(u_sun_altitude);
    float shadowStrength = clamp(u_shadow_intensity, 0.0, 1.0);
    float sunCastVisibility = smoothstep(radians(-0.15), radians(0.85), u_sun_altitude);

    float localReliefShadow = 0.0;
    vec2 localReliefGradient = vec2(0.0);
    float localReliefLambert = 1.0;
    float localReliefSlope = 0.0;
    float localElevation = 0.0;
    float contactShadow = 0.0;
    if (u_dem_ao_dim > 2.0 && (u_self_shadow_mult > 0.001 || u_igor_relief_enabled > 0.5)) {
        localElevation = sampleDemTexel(clamp(v_dem_coord, vec2(1.0), vec2(u_dem_ao_dim)));
        localReliefGradient = sampleReliefGradient(clamp(v_dem_coord, vec2(1.0), vec2(u_dem_ao_dim)));
        localReliefLambert = localIgorLambert(localReliefGradient);
        localReliefSlope = localIgorSlopeStrength(localReliefGradient);
        localReliefShadow = localIgorReliefShadowFrom(localReliefLambert, localReliefSlope);
        contactShadow = localTerrainContactShadow(clamp(v_dem_coord, vec2(1.0), vec2(u_dem_ao_dim)), localElevation);
    }
    float reliefShadowStrength = mix(0.70, clamp(u_self_shadow_mult, 0.0, 3.0), 0.55);

    fragColor.rgb = applySkyLightTint(fragColor.rgb, u_sun_altitude, u_horizon_color.rgb, u_fog_color.rgb);

    // ── Global Shadow Occlusion ──
    vec2 atlasUV = v_atlas_uv;
    bool atlasCovered = atlasUV.x >= -0.001 && atlasUV.x <= 1.001 && atlasUV.y >= -0.001 && atlasUV.y <= 1.001;
    float shadowMask = 0.0;
    float nearShadowMask = 0.0;
    float nearContribution = 0.0;
    float rawAtlasShadow = 0.0;
    float rawNearShadow = 0.0;
    float castPresence = 0.0;
    bool useGlobalCastShadow = u_shadow_component_mode < 1.5;
    bool useNearCastShadow = u_shadow_component_mode < 0.5 || (u_shadow_component_mode > 1.5 && u_shadow_component_mode < 2.5);

    if (useGlobalCastShadow &&
        atlasUV.x >= -0.001 && atlasUV.x <= 1.001 && atlasUV.y >= -0.001 && atlasUV.y <= 1.001) {
        rawAtlasShadow = clamp(texture(u_shadow_atlas, clamp(atlasUV, vec2(0.0), vec2(1.0))).r, 0.0, 1.0);
        float raymarchedShadow = remapShadowMask(rawAtlasShadow, atlasUV);
        float horizonShadow = horizonShadowMask(atlasUV);
        shadowMask = mix(raymarchedShadow, horizonShadow, clamp(u_horizon_available, 0.0, 1.0));
    }
    if (useNearCastShadow &&
        u_shadow_near_available > 0.5 &&
        v_near_atlas_uv.x >= -0.001 && v_near_atlas_uv.x <= 1.001 &&
        v_near_atlas_uv.y >= -0.001 && v_near_atlas_uv.y <= 1.001) {
        rawNearShadow = clamp(texture(u_shadow_near_atlas, clamp(v_near_atlas_uv, vec2(0.0), vec2(1.0))).r, 0.0, 1.0);
        nearShadowMask = remapNearShadowMask(rawNearShadow, v_near_atlas_uv);
        float previousShadowMask = shadowMask;
        float nearFade = smoothstep(0.0, 1.0, clamp(u_shadow_near_fade, 0.0, 1.0));
        float nearCoverage = nearAtlasCoverage(v_near_atlas_uv) * nearFade;
        float additiveShadow = max(shadowMask, nearShadowMask * nearCoverage);
        float replaceCoverage = nearAtlasReplaceCoverage(v_near_atlas_uv);
        if (!useGlobalCastShadow) {
            shadowMask = nearShadowMask * nearCoverage;
        } else if (u_shadow_near_replace_mode > 0.5) {
            // V3 optimized composition:
            // - outside near atlas: global remains authoritative;
            // - border ring: additive blend avoids holes while near fades in;
            // - trusted core: near replaces the coarse global edge, reducing
            //   double-shadow halos and making the refined atlas visibly useful.
            //
            // At very low sun angles the global atlas may include long-range
            // mountain casters outside the near atlas, so keep strong global
            // shadows if the near atlas says "lit".
            float lowSunLongShadow = 1.0 - smoothstep(radians(10.0), radians(22.0), u_sun_altitude);
            float strongGlobalOnly = smoothstep(0.82, 0.98, shadowMask) * (1.0 - smoothstep(0.08, 0.36, nearShadowMask));
            float preserveLongGlobal = strongGlobalOnly * lowSunLongShadow * 0.82;

            // Fade shadow creation and shadow removal differently. New near
            // contact shadows can appear early, but removing a coarse global
            // shadow must be delayed; otherwise the cross-fade briefly exposes
            // the white base as a bright halo before the refined mask settles.
            float nearLighter = smoothstep(0.02, 0.18, shadowMask - nearShadowMask);
            float addReplaceFade = smoothstep(0.04, 0.92, nearFade);
            float removeReplaceFade = smoothstep(0.42, 1.0, nearFade);
            float replaceFade = mix(addReplaceFade, removeReplaceFade, nearLighter);
            float replaceWeight = replaceCoverage * replaceFade * (1.0 - preserveLongGlobal);
            float stableBase = mix(additiveShadow, shadowMask, nearLighter * (1.0 - addReplaceFade));
            shadowMask = mix(stableBase, nearShadowMask, replaceWeight);
        } else {
            // Legacy V3 blend kept as a runtime fallback for visual A/B.
            float globalPartialEdge = smoothstep(0.035, 0.30, shadowMask) * (1.0 - smoothstep(0.76, 0.97, shadowMask));
            float nearAddsDetail = smoothstep(-0.02, 0.10, nearShadowMask - shadowMask);
            float replaceWeight = replaceCoverage * globalPartialEdge * nearFade * nearAddsDetail;
            shadowMask = mix(additiveShadow, max(additiveShadow, nearShadowMask), replaceWeight);
        }
        nearContribution = max(shadowMask - previousShadowMask, 0.0);
    }
    if (u_shadow_near_debug_tint > 0.5 && nearShadowMask > 0.01) {
        float tintMask = clamp(max(nearContribution, nearShadowMask * 0.35), 0.0, 1.0);
        fragColor.rgb = mix(fragColor.rgb, vec3(0.02, 0.72, 1.0), tintMask * 0.45);
    }

    vec3 shadowTint = vec3(0.075, 0.085, 0.120);
    float lowSunFarFallback = 1.0 - smoothstep(radians(7.0), radians(22.0), u_sun_altitude);
    float farTerrainSignal = clamp(localReliefShadow * u_self_shadow_mult * mix(0.28, 0.58, lowSunFarFallback), 0.0, 1.0);
    float farTerrainShadow = useGlobalCastShadow ? smoothstep(0.025, 0.68, farTerrainSignal) * (atlasCovered ? 0.0 : 1.0) : 0.0;

    if (u_shadow_display_mode > 0.5) {
        // V2 follows copy 7's lighting model: Light = Ambient * AO + Sun * SelfLight * CastLight.
        // This keeps self-shadow directional instead of letting static slope AO dominate.
        float selfLight = smoothstep(0.0, 1.0, clamp(localReliefLambert, 0.0, 1.0));
        float ao = 1.0 - smoothstep(0.10, 0.70, localReliefSlope) * 0.25;
        float ambientConfig = 0.20;
        float sunConfig = 1.0 - ambientConfig;
        float castShadow = clamp(max(shadowMask, farTerrainShadow), 0.0, 1.0);
        float castLight = 1.0 - castShadow * sunCastVisibility;
        float totalLight = (ambientConfig * ao) + (sunConfig * selfLight * castLight);
        float copy7Shadow = 1.0 - clamp(totalLight, 0.0, 1.0);
        float shadowAlpha = clamp(copy7Shadow * shadowStrength * u_cast_shadow_mult * 0.52, 0.0, 0.76);
        fragColor.rgb = mix(fragColor.rgb, shadowTint, shadowAlpha);
        float contactOnly = contactShadow * (1.0 - smoothstep(0.08, 0.78, castShadow)) * sunCastVisibility;
        fragColor.rgb = mix(fragColor.rgb, shadowTint, contactOnly * shadowStrength * 0.22);

        if (u_igor_relief_enabled > 0.5) {
            castPresence = clamp(castShadow * shadowStrength * sunCastVisibility, 0.0, 1.0);
            float reliefAO = localReliefShadow * castPresence * 0.060 * reliefShadowStrength;
            fragColor.rgb *= 1.0 - reliefAO;
        }
    } else {
        // V1 keeps its original atlas/edge filtering, but now uses the same
        // copy 7 intensity balance as V2 for cast and self shadows.
        float selfLight = smoothstep(0.0, 1.0, clamp(localReliefLambert, 0.0, 1.0));
        float ao = 1.0 - smoothstep(0.10, 0.70, localReliefSlope) * 0.25;
        float ambientConfig = 0.20;
        float sunConfig = 1.0 - ambientConfig;
        float castShadow = clamp(max(shadowMask, farTerrainShadow), 0.0, 1.0);
        float castLight = 1.0 - castShadow * sunCastVisibility;
        float totalLight = (ambientConfig * ao) + (sunConfig * selfLight * castLight);
        float copy7Shadow = 1.0 - clamp(totalLight, 0.0, 1.0);
        float shadowAlpha = clamp(copy7Shadow * shadowStrength * u_cast_shadow_mult * 0.52, 0.0, 0.76);
        fragColor.rgb = mix(fragColor.rgb, shadowTint, shadowAlpha);
        float contactOnly = contactShadow * (1.0 - smoothstep(0.08, 0.78, castShadow)) * sunCastVisibility;
        fragColor.rgb = mix(fragColor.rgb, shadowTint, contactOnly * shadowStrength * 0.22);

        if (u_igor_relief_enabled > 0.5) {
            castPresence = clamp(castShadow * shadowStrength * sunCastVisibility, 0.0, 1.0);
            float reliefAO = localReliefShadow * castPresence * 0.060 * reliefShadowStrength;
            fragColor.rgb *= 1.0 - reliefAO;
        }
    }

    // Fog is a final atmospheric composite over terrain lighting. Keeping it
    // after global shadows prevents far shadow masks from drawing over horizon fog.
    fragColor = applyTerrainFog(fragColor);

    if (atlasCovered) {
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
}
