uniform sampler2D u_image; // base elevation atlas, packed [0..1] => [-10000..10000] m
uniform sampler2D u_hiz1;
uniform sampler2D u_hiz2;
uniform sampler2D u_hiz3;
uniform sampler2D u_hiz4;
uniform sampler2D u_hiz5;
uniform vec2 u_sunDirection;
uniform float u_sunAltitude;
uniform vec2 u_metersPerPixel;
uniform vec2 u_dimension;
uniform vec4 u_atlas_bounds;
uniform float u_max_distance;
uniform float u_step_meters;
uniform float u_max_steps;
uniform float u_near_cascade_distance;
uniform float u_mid_cascade_distance;

in vec2 v_pos;

const highp vec4 bitUn = vec4(1./(256.*256.*256.), 1./(256.*256.), 1./256., 1.);
const float WORLD_CIRCUMFERENCE = 40075016.7;
const float EMPTY_ELEVATION = -9900.0;
#define hardMaxSteps 192.0

highp float unpack(highp vec4 color) {
    return dot(color, bitUn);
}

float unpackHeight(vec4 color) {
    return unpack(color) * 20000.0 - 10000.0;
}

float samplePackedBilinear(sampler2D image, vec2 uv, vec2 dim) {
    vec2 pos = uv * dim;
    vec2 posCenter = pos - 0.5;
    vec2 f = fract(posCenter);
    vec2 i = floor(posCenter) + 0.5;

    float h00 = unpackHeight(texture(image, (i + vec2(0.0, 0.0)) / dim));
    float h10 = unpackHeight(texture(image, (i + vec2(1.0, 0.0)) / dim));
    float h01 = unpackHeight(texture(image, (i + vec2(0.0, 1.0)) / dim));
    float h11 = unpackHeight(texture(image, (i + vec2(1.0, 1.0)) / dim));

    return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

float sampleBaseElevation(vec2 uv) {
    return samplePackedBilinear(u_image, clamp(uv, vec2(0.0), vec2(1.0)), u_dimension);
}

float sampleMaxLevel(vec2 uv, float level) {
    vec2 safeUv = clamp(uv, vec2(0.0), vec2(1.0));
    if (level < 0.5) return sampleBaseElevation(safeUv);
    if (level < 1.5) return unpackHeight(texture(u_hiz1, safeUv));
    if (level < 2.5) return unpackHeight(texture(u_hiz2, safeUv));
    if (level < 3.5) return unpackHeight(texture(u_hiz3, safeUv));
    if (level < 4.5) return unpackHeight(texture(u_hiz4, safeUv));
    return unpackHeight(texture(u_hiz5, safeUv));
}

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float levelStepMeters(float level) {
    float basePixelMeters = max(u_metersPerPixel.x, u_metersPerPixel.y);
    float levelPixels = exp2(level);
    float lowSun = 1.0 - smoothstep(radians(12.0), radians(32.0), u_sunAltitude);
    float multiplier = mix(1.05, 0.80, lowSun);
    return max(u_step_meters, basePixelMeters * levelPixels * multiplier);
}

void main() {
    if (u_sunAltitude <= 0.001) {
        fragColor = vec4(0.0);
        return;
    }

    float startElevation = sampleBaseElevation(v_pos);
    if (startElevation < EMPTY_ELEVATION) {
        fragColor = vec4(0.0);
        return;
    }

    vec2 worldStepPerMeter = vec2(
        u_sunDirection.x / WORLD_CIRCUMFERENCE,
        u_sunDirection.y / WORLD_CIRCUMFERENCE
    );
    vec2 sampleUVStepPerMeter = worldStepPerMeter / max(u_atlas_bounds.zw - u_atlas_bounds.xy, vec2(1.0e-9));
    sampleUVStepPerMeter.y = -sampleUVStepPerMeter.y;

    float tanSun = max(tan(u_sunAltitude), 0.001);
    float jitterMeters = hash12(floor(v_pos * u_dimension * 0.5) + u_sunDirection * 71.0) * min(u_step_meters, 35.0) * 0.22;
    vec2 currentUV = v_pos + sampleUVStepPerMeter * jitterMeters;
    float distanceMeters = jitterMeters;
    float currentRayHeight = startElevation + jitterMeters * tanSun;
    float shadow = 0.0;

    for (float i = 0.0; i < hardMaxSteps; i++) {
        if (i >= u_max_steps || distanceMeters >= u_max_distance) break;

        bool advanced = false;

        for (int li = 5; li >= 0; li--) {
            float level = float(li);
            float stepMeters = levelStepMeters(level);
            if (distanceMeters < u_near_cascade_distance && level > 2.0) continue;
            if (distanceMeters < u_mid_cascade_distance && level > 4.0) continue;

            float nextDistance = min(distanceMeters + stepMeters, u_max_distance);
            float actualStep = nextDistance - distanceMeters;
            vec2 nextUV = currentUV + sampleUVStepPerMeter * actualStep;
            vec2 midUV = currentUV + sampleUVStepPerMeter * (actualStep * 0.5);
            float nextRayHeight = currentRayHeight + actualStep * tanSun;
            float midRayHeight = currentRayHeight + actualStep * 0.5 * tanSun;

            if (nextUV.x < 0.0 || nextUV.x > 1.0 || nextUV.y < 0.0 || nextUV.y > 1.0) {
                distanceMeters = u_max_distance;
                advanced = true;
                break;
            }

            float maxElev = max(sampleMaxLevel(midUV, level), sampleMaxLevel(nextUV, level));
            float levelMeters = max(u_metersPerPixel.x, u_metersPerPixel.y) * exp2(level);
            float conservativeBias = max(1.0, levelMeters * 0.025);

            if (maxElev + conservativeBias < min(midRayHeight, nextRayHeight)) {
                currentUV = nextUV;
                currentRayHeight = nextRayHeight;
                distanceMeters = nextDistance;
                advanced = true;
                break;
            }

            if (li == 0) {
                vec2 q1UV = currentUV + sampleUVStepPerMeter * (actualStep * 0.25);
                vec2 q2UV = midUV;
                vec2 q3UV = currentUV + sampleUVStepPerMeter * (actualStep * 0.75);
                float q1RayHeight = currentRayHeight + actualStep * 0.25 * tanSun;
                float q2RayHeight = midRayHeight;
                float q3RayHeight = currentRayHeight + actualStep * 0.75 * tanSun;
                float q1Distance = distanceMeters + actualStep * 0.25;
                float q2Distance = distanceMeters + actualStep * 0.5;
                float q3Distance = distanceMeters + actualStep * 0.75;

                float q1Elev = sampleBaseElevation(q1UV);
                float q2Elev = sampleBaseElevation(q2UV);
                float q3Elev = sampleBaseElevation(q3UV);
                float q4Elev = sampleBaseElevation(nextUV);

                bool hit = false;
                vec2 loUV = currentUV;
                vec2 hiUV = nextUV;
                float loRayHeight = currentRayHeight;
                float hiRayHeight = nextRayHeight;
                float loDistance = distanceMeters;
                float hiDistance = nextDistance;

                if (q1Elev > q1RayHeight) {
                    hit = true;
                    hiUV = q1UV;
                    hiRayHeight = q1RayHeight;
                    hiDistance = q1Distance;
                } else if (q2Elev > q2RayHeight) {
                    hit = true;
                    loUV = q1UV;
                    loRayHeight = q1RayHeight;
                    loDistance = q1Distance;
                    hiUV = q2UV;
                    hiRayHeight = q2RayHeight;
                    hiDistance = q2Distance;
                } else if (q3Elev > q3RayHeight) {
                    hit = true;
                    loUV = q2UV;
                    loRayHeight = q2RayHeight;
                    loDistance = q2Distance;
                    hiUV = q3UV;
                    hiRayHeight = q3RayHeight;
                    hiDistance = q3Distance;
                } else if (q4Elev > nextRayHeight) {
                    hit = true;
                    loUV = q3UV;
                    loRayHeight = q3RayHeight;
                    loDistance = q3Distance;
                }

                if (hit) {

                    for (int j = 0; j < 5; j++) {
                        vec2 midUV = mix(loUV, hiUV, 0.5);
                        float midRayHeight = mix(loRayHeight, hiRayHeight, 0.5);
                        float midDistance = mix(loDistance, hiDistance, 0.5);
                        float midElev = sampleBaseElevation(midUV);

                        if (midElev > midRayHeight) {
                            hiUV = midUV;
                            hiRayHeight = midRayHeight;
                            hiDistance = midDistance;
                        } else {
                            loUV = midUV;
                            loRayHeight = midRayHeight;
                            loDistance = midDistance;
                        }
                    }

                    shadow = 1.0 - smoothstep(u_max_distance * 0.94, u_max_distance, hiDistance);
                    distanceMeters = u_max_distance;
                    advanced = true;
                    break;
                }

                currentUV = nextUV;
                currentRayHeight = nextRayHeight;
                distanceMeters = nextDistance;
                advanced = true;
                break;
            }
        }

        if (!advanced) {
            distanceMeters = u_max_distance;
        }
    }

    fragColor = vec4(vec3(shadow), 1.0);
}
