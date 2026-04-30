// Horizon atlas prepare shader.
// Packs four directional horizon angles into RGBA. It is rendered twice:
// directions 0..3 into horizon0 and 4..7 into horizon1.

uniform sampler2D u_image; // packed global elevation atlas
uniform vec4 u_atlas_bounds;
uniform vec2 u_dimension;
uniform float u_max_steps;
uniform float u_step_meters;
uniform float u_max_distance;
uniform float u_direction_offset;
uniform float u_direction_count;

in vec2 v_pos;

const highp vec4 bitUn = vec4(1./(256.*256.*256.), 1./(256.*256.), 1./256., 1.);
const float PI = 3.141592653589793;
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
    return mix(mix(1.0, 2.75, nearToMid), 7.0, midToFar);
}

float sampleElevationCascade(vec2 uv, float distanceMeters) {
    if (distanceMeters > MID_CASCADE_METERS) {
        return sampleElevationNearest(uv);
    }
    return sampleElevationBilinear(uv);
}

float horizonAngleForBin(float directionBin, float startElevation) {
    float azimuth = directionBin * (PI * 2.0) / max(u_direction_count, 1.0);
    vec2 direction = vec2(sin(azimuth), -cos(azimuth));
    vec2 worldStepPerMeter = vec2(
        direction.x / WORLD_CIRCUMFERENCE,
        direction.y / WORLD_CIRCUMFERENCE
    );
    vec2 sampleUVStepPerMeter = worldStepPerMeter / (u_atlas_bounds.zw - u_atlas_bounds.xy);
    sampleUVStepPerMeter.y = -sampleUVStepPerMeter.y;

    vec2 currentUV = v_pos;
    vec2 atlasMetersPerPixel = (u_atlas_bounds.zw - u_atlas_bounds.xy) * WORLD_CIRCUMFERENCE / u_dimension;
    float baseGsd = max(atlasMetersPerPixel.x, atlasMetersPerPixel.y);
    float distanceMeters = max(max(u_step_meters * 0.85, baseGsd * 1.20), 10.0);
    float maxAngle = 0.0;

    for (float i = 0.0; i < hardMaxSteps; i++) {
        if (i >= u_max_steps || distanceMeters >= u_max_distance) break;

        currentUV = v_pos + sampleUVStepPerMeter * distanceMeters;
        if (currentUV.x < 0.0 || currentUV.x > 1.0 || currentUV.y < 0.0 || currentUV.y > 1.0) break;

        float elev = sampleElevationCascade(currentUV, distanceMeters);
        float candidateBand = max(u_step_meters * 6.0, 120.0);
        if (distanceMeters > MID_CASCADE_METERS && elev > startElevation - candidateBand) {
            elev = sampleElevationBilinear(currentUV);
        }

        if (elev > EMPTY_ELEVATION) {
            maxAngle = max(maxAngle, atan((elev - startElevation) / max(distanceMeters, 1.0)));
        }

        float stepMeters = u_step_meters * cascadeStepMultiplier(distanceMeters);
        distanceMeters = min(distanceMeters + stepMeters, u_max_distance);
    }

    return clamp(maxAngle / (PI * 0.5), 0.0, 1.0);
}

void main() {
    float startElevation = sampleElevationBilinear(v_pos);
    if (startElevation < EMPTY_ELEVATION) {
        fragColor = vec4(1.0);
        return;
    }

    float d0 = u_direction_offset + 0.0;
    float d1 = u_direction_offset + 1.0;
    float d2 = u_direction_offset + 2.0;
    float d3 = u_direction_offset + 3.0;
    fragColor = vec4(
        horizonAngleForBin(d0, startElevation),
        horizonAngleForBin(d1, startElevation),
        horizonAngleForBin(d2, startElevation),
        horizonAngleForBin(d3, startElevation)
    );
}
