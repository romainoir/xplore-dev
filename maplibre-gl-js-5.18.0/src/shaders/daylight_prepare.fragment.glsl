// Daylight / Sun Duration atlas prepare shader.
// Integrates direct-sun visibility from cached directional horizon angles.

uniform sampler2D u_horizon0; // bins 0..3: N, NE, E, SE
uniform sampler2D u_horizon1; // bins 4..7: S, SW, W, NW
uniform sampler2D u_horizon2; // bins 8..11 when using 16-bin quality
uniform sampler2D u_horizon3; // bins 12..15 when using 16-bin quality
uniform float u_horizon_bins;
uniform float u_horizon_edge_softness;
uniform float u_time_weight; // minutes per solar sample

uniform vec4 u_solar_lut_0;
uniform vec4 u_solar_lut_1;
uniform vec4 u_solar_lut_2;
uniform vec4 u_solar_lut_3;
uniform vec4 u_solar_lut_4;
uniform vec4 u_solar_lut_5;
uniform vec4 u_solar_lut_6;
uniform vec4 u_solar_lut_7;
uniform vec4 u_solar_lut_8;
uniform vec4 u_solar_lut_9;
uniform vec4 u_solar_lut_10;
uniform vec4 u_solar_lut_11;
uniform vec4 u_solar_lut_12;
uniform vec4 u_solar_lut_13;
uniform vec4 u_solar_lut_14;
uniform vec4 u_solar_lut_15;

in vec2 v_pos;

const float PI = 3.141592653589793;
const float SOLAR_SAMPLES = 32.0;

float channelValue(vec4 packed, float channel) {
    if (channel < 0.5) return packed.r;
    if (channel < 1.5) return packed.g;
    if (channel < 2.5) return packed.b;
    return packed.a;
}

float horizonBin(float bin, vec2 uv) {
    float wrappedBin = mod(bin + u_horizon_bins, u_horizon_bins);
    if (wrappedBin < 4.0) {
        return channelValue(texture(u_horizon0, uv), wrappedBin);
    }
    if (wrappedBin < 8.0) {
        return channelValue(texture(u_horizon1, uv), wrappedBin - 4.0);
    }
    if (wrappedBin < 12.0) {
        return channelValue(texture(u_horizon2, uv), wrappedBin - 8.0);
    }
    return channelValue(texture(u_horizon3, uv), wrappedBin - 12.0);
}

float sampleHorizonAngle(float azimuth, vec2 uv) {
    float bin = mod(azimuth, PI * 2.0) / ((PI * 2.0) / max(u_horizon_bins, 1.0));
    float bin0 = floor(bin);
    float bin1 = mod(bin0 + 1.0, u_horizon_bins);
    float t = fract(bin);
    float h0 = horizonBin(bin0, uv);
    float h1 = horizonBin(bin1, uv);
    return mix(h0, h1, t) * (PI * 0.5);
}

float sunVisibility(vec2 sunPos, vec2 uv) {
    float sunAzimuth = sunPos.x;
    float sunAltitude = sunPos.y;
    float aboveHorizon = smoothstep(radians(-0.5), radians(1.2), sunAltitude);
    if (aboveHorizon <= 0.0) return 0.0;

    float terrainHorizon = sampleHorizonAngle(sunAzimuth, uv);
    float edgeSoftness = radians(0.70) * max(u_horizon_edge_softness, 0.25);
    edgeSoftness = max(edgeSoftness, fwidth(terrainHorizon) * 1.35 + radians(0.12));
    return aboveHorizon * smoothstep(terrainHorizon - edgeSoftness, terrainHorizon + edgeSoftness, sunAltitude);
}

void accumulateVisibility(vec4 packedSunPositions, vec2 uv, float baseIndex, float oneHourSamples, inout float visibleSamples, inout float morningScore, inout float morningNorm, inout float eveningScore, inout float eveningNorm) {
    float v0 = sunVisibility(packedSunPositions.xy, uv);
    float v1 = sunVisibility(packedSunPositions.zw, uv);
    visibleSamples += v0 + v1;

    float idx0 = baseIndex;
    float idx1 = baseIndex + 1.0;
    float morning0 = 1.0 - smoothstep(0.0, oneHourSamples, idx0);
    float morning1 = 1.0 - smoothstep(0.0, oneHourSamples, idx1);
    float evening0 = 1.0 - smoothstep(0.0, oneHourSamples, (SOLAR_SAMPLES - 1.0) - idx0);
    float evening1 = 1.0 - smoothstep(0.0, oneHourSamples, (SOLAR_SAMPLES - 1.0) - idx1);

    morningScore += v0 * morning0 + v1 * morning1;
    morningNorm += morning0 + morning1;
    eveningScore += v0 * evening0 + v1 * evening1;
    eveningNorm += evening0 + evening1;
}

void main() {
    float visibleSamples = 0.0;
    float oneHourSamples = clamp(60.0 / max(u_time_weight, 1.0), 1.0, SOLAR_SAMPLES);
    float morningScore = 0.0;
    float morningNorm = 0.0;
    float eveningScore = 0.0;
    float eveningNorm = 0.0;
    accumulateVisibility(u_solar_lut_0, v_pos, 0.0, oneHourSamples, visibleSamples, morningScore, morningNorm, eveningScore, eveningNorm);
    accumulateVisibility(u_solar_lut_1, v_pos, 2.0, oneHourSamples, visibleSamples, morningScore, morningNorm, eveningScore, eveningNorm);
    accumulateVisibility(u_solar_lut_2, v_pos, 4.0, oneHourSamples, visibleSamples, morningScore, morningNorm, eveningScore, eveningNorm);
    accumulateVisibility(u_solar_lut_3, v_pos, 6.0, oneHourSamples, visibleSamples, morningScore, morningNorm, eveningScore, eveningNorm);
    accumulateVisibility(u_solar_lut_4, v_pos, 8.0, oneHourSamples, visibleSamples, morningScore, morningNorm, eveningScore, eveningNorm);
    accumulateVisibility(u_solar_lut_5, v_pos, 10.0, oneHourSamples, visibleSamples, morningScore, morningNorm, eveningScore, eveningNorm);
    accumulateVisibility(u_solar_lut_6, v_pos, 12.0, oneHourSamples, visibleSamples, morningScore, morningNorm, eveningScore, eveningNorm);
    accumulateVisibility(u_solar_lut_7, v_pos, 14.0, oneHourSamples, visibleSamples, morningScore, morningNorm, eveningScore, eveningNorm);
    accumulateVisibility(u_solar_lut_8, v_pos, 16.0, oneHourSamples, visibleSamples, morningScore, morningNorm, eveningScore, eveningNorm);
    accumulateVisibility(u_solar_lut_9, v_pos, 18.0, oneHourSamples, visibleSamples, morningScore, morningNorm, eveningScore, eveningNorm);
    accumulateVisibility(u_solar_lut_10, v_pos, 20.0, oneHourSamples, visibleSamples, morningScore, morningNorm, eveningScore, eveningNorm);
    accumulateVisibility(u_solar_lut_11, v_pos, 22.0, oneHourSamples, visibleSamples, morningScore, morningNorm, eveningScore, eveningNorm);
    accumulateVisibility(u_solar_lut_12, v_pos, 24.0, oneHourSamples, visibleSamples, morningScore, morningNorm, eveningScore, eveningNorm);
    accumulateVisibility(u_solar_lut_13, v_pos, 26.0, oneHourSamples, visibleSamples, morningScore, morningNorm, eveningScore, eveningNorm);
    accumulateVisibility(u_solar_lut_14, v_pos, 28.0, oneHourSamples, visibleSamples, morningScore, morningNorm, eveningScore, eveningNorm);
    accumulateVisibility(u_solar_lut_15, v_pos, 30.0, oneHourSamples, visibleSamples, morningScore, morningNorm, eveningScore, eveningNorm);

    float totalHours = visibleSamples * u_time_weight / 60.0;
    float daylightHours = max(u_time_weight * SOLAR_SAMPLES / 60.0, 1.0);
    float rampPos = smoothstep(0.0, 1.0, clamp(totalHours / daylightHours, 0.0, 1.0));
    morningScore = clamp(morningScore / max(morningNorm, 0.0001), 0.0, 1.0);
    eveningScore = clamp(eveningScore / max(eveningNorm, 0.0001), 0.0, 1.0);
    fragColor = vec4(rampPos, morningScore, eveningScore, 1.0);
}
