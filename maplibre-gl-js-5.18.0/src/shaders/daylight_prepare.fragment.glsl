// Daylight / Sun Duration global atlas prepare shader.
// Integrates direct-sun visibility over the same continuous elevation atlas used by cast shadows.

uniform sampler2D u_image; // packed global elevation atlas
uniform vec2 u_metersPerPixel;
uniform vec4 u_atlas_bounds;
uniform vec2 u_dimension;
uniform float u_max_steps;
uniform float u_step_meters;
uniform float u_max_distance;
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

const highp vec4 bitUn = vec4(1./(256.*256.*256.), 1./(256.*256.), 1./256., 1.);
const float WORLD_CIRCUMFERENCE = 40075016.7;
const float EMPTY_ELEVATION = -9900.0;
const float NEAR_CASCADE_METERS = 1200.0;
const float MID_CASCADE_METERS = 4200.0;

#define hardMaxSteps 128.0

highp float unpackElevation(highp vec4 color) {
    return dot(color, bitUn) * 20000.0 - 10000.0;
}

float sampleElevationBilinear(vec2 uv) {
    vec2 pos = uv * u_dimension;
    vec2 posCenter = pos - 0.5;
    vec2 f = fract(posCenter);
    vec2 i = floor(posCenter) + 0.5;

    float h00 = unpackElevation(texture(u_image, (i + vec2(0.0, 0.0)) / u_dimension));
    float h10 = unpackElevation(texture(u_image, (i + vec2(1.0, 0.0)) / u_dimension));
    float h01 = unpackElevation(texture(u_image, (i + vec2(0.0, 1.0)) / u_dimension));
    float h11 = unpackElevation(texture(u_image, (i + vec2(1.0, 1.0)) / u_dimension));

    return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

float sampleElevationNearest(vec2 uv) {
    return unpackElevation(texture(u_image, uv));
}

float cascadeStepMultiplier(float distanceMeters) {
    float nearToMid = smoothstep(NEAR_CASCADE_METERS * 0.75, NEAR_CASCADE_METERS * 1.25, distanceMeters);
    float midToFar = smoothstep(MID_CASCADE_METERS * 0.75, MID_CASCADE_METERS * 1.25, distanceMeters);
    return mix(mix(1.0, 2.8, nearToMid), 7.0, midToFar);
}

float sampleElevationCascade(vec2 uv, float distanceMeters) {
    if (distanceMeters > MID_CASCADE_METERS) {
        return sampleElevationNearest(uv);
    }
    return sampleElevationBilinear(uv);
}

float sunVisibility(vec2 sunPos, vec2 uv, float startElevation) {
    float sunAzimuth = sunPos.x;
    float sunAltitude = sunPos.y;
    float lowSunVisibility = smoothstep(radians(-0.5), radians(1.2), sunAltitude);
    if (lowSunVisibility <= 0.0) return 0.0;

    vec2 sunDirection = vec2(sin(sunAzimuth), -cos(sunAzimuth));
    vec2 worldStepPerMeter = vec2(
        sunDirection.x / WORLD_CIRCUMFERENCE,
        sunDirection.y / WORLD_CIRCUMFERENCE
    );
    vec2 sampleUVStepPerMeter = worldStepPerMeter / (u_atlas_bounds.zw - u_atlas_bounds.xy);
    sampleUVStepPerMeter.y = -sampleUVStepPerMeter.y;

    float tanSun = max(tan(max(sunAltitude, radians(0.25))), 0.004);
    vec2 currentUV = uv;
    float rayHeight = startElevation;
    float distanceMeters = 0.0;

    for (float i = 0.0; i < hardMaxSteps; i++) {
        if (i >= u_max_steps || distanceMeters >= u_max_distance) break;

        float stepMeters = u_step_meters * cascadeStepMultiplier(distanceMeters);
        float nextDistance = min(distanceMeters + stepMeters, u_max_distance);
        stepMeters = nextDistance - distanceMeters;
        distanceMeters = nextDistance;

        currentUV += sampleUVStepPerMeter * stepMeters;
        rayHeight += stepMeters * tanSun;

        if (currentUV.x < 0.0 || currentUV.x > 1.0 || currentUV.y < 0.0 || currentUV.y > 1.0) break;
        if (rayHeight > 8900.0) break;

        float elev = sampleElevationCascade(currentUV, distanceMeters);
        if (distanceMeters > MID_CASCADE_METERS && elev > rayHeight - u_step_meters * 2.0) {
            elev = sampleElevationBilinear(currentUV);
        }

        if (elev > rayHeight) {
            return 0.0;
        }
    }

    return lowSunVisibility;
}

float packedVisibility(vec4 packedSunPositions, vec2 uv, float startElevation) {
    return sunVisibility(packedSunPositions.xy, uv, startElevation) +
        sunVisibility(packedSunPositions.zw, uv, startElevation);
}

void main() {
    float startElevation = sampleElevationBilinear(v_pos);
    if (startElevation < EMPTY_ELEVATION) {
        fragColor = vec4(0.0);
        return;
    }

    float visibleSamples = 0.0;
    visibleSamples += packedVisibility(u_solar_lut_0, v_pos, startElevation);
    visibleSamples += packedVisibility(u_solar_lut_1, v_pos, startElevation);
    visibleSamples += packedVisibility(u_solar_lut_2, v_pos, startElevation);
    visibleSamples += packedVisibility(u_solar_lut_3, v_pos, startElevation);
    visibleSamples += packedVisibility(u_solar_lut_4, v_pos, startElevation);
    visibleSamples += packedVisibility(u_solar_lut_5, v_pos, startElevation);
    visibleSamples += packedVisibility(u_solar_lut_6, v_pos, startElevation);
    visibleSamples += packedVisibility(u_solar_lut_7, v_pos, startElevation);
    visibleSamples += packedVisibility(u_solar_lut_8, v_pos, startElevation);
    visibleSamples += packedVisibility(u_solar_lut_9, v_pos, startElevation);
    visibleSamples += packedVisibility(u_solar_lut_10, v_pos, startElevation);
    visibleSamples += packedVisibility(u_solar_lut_11, v_pos, startElevation);
    visibleSamples += packedVisibility(u_solar_lut_12, v_pos, startElevation);
    visibleSamples += packedVisibility(u_solar_lut_13, v_pos, startElevation);
    visibleSamples += packedVisibility(u_solar_lut_14, v_pos, startElevation);
    visibleSamples += packedVisibility(u_solar_lut_15, v_pos, startElevation);

    float totalHours = visibleSamples * u_time_weight / 60.0;
    float rampPos = smoothstep(0.0, 1.0, clamp(totalHours / 15.0, 0.0, 1.0));
    fragColor = vec4(rampPos, rampPos, rampPos, 1.0);
}
