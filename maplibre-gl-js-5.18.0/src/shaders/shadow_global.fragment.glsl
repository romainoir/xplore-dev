uniform sampler2D u_image; // Global Elevation Buffer (Packed)
uniform vec2 u_sunDirection;
uniform float u_sunAltitude;
uniform vec2 u_metersPerPixel; // [mppX, mppY] per-axis for correct aspect ratio
uniform vec4 u_atlas_bounds; // [minX, minY, maxX, maxY] in 0..1 Mercator

uniform float u_max_steps;
uniform float u_step_meters;
uniform vec2 u_dimension;
uniform float u_max_distance;

in vec2 v_pos; // Viewport UV (0..1)

// Unpack logic
const highp vec4 bitUn = vec4(1./(256.*256.*256.), 1./(256.*256.), 1./256., 1.);
highp float unpack(highp vec4 color) {
    return dot(color, bitUn);
}

// Fixed-meter stepping for zoom-independent shadow length
// The loop must have a constant upper bound, but we break early based on the generic uniform.
#define hardMaxSteps 384.0

const float WORLD_CIRCUMFERENCE = 40075016.7;
const float EMPTY_ELEVATION = -9900.0;
const float NEAR_CASCADE_METERS = 1100.0;
const float MID_CASCADE_METERS = 3500.0;

// Safe Bilinear Fetch to prevent corrupt RGBA base-256 wrapping interpolation
float sampleElevationBilinear(vec2 uv) {
    vec2 dim = u_dimension;
    vec2 pos = uv * dim;
    vec2 posCenter = pos - 0.5;
    vec2 f = fract(posCenter);
    vec2 i = floor(posCenter) + 0.5;
    
    vec4 t00 = texture(u_image, (i + vec2(0.0, 0.0)) / dim);
    vec4 t10 = texture(u_image, (i + vec2(1.0, 0.0)) / dim);
    vec4 t01 = texture(u_image, (i + vec2(0.0, 1.0)) / dim);
    vec4 t11 = texture(u_image, (i + vec2(1.0, 1.0)) / dim);
    
    float h00 = unpack(t00) * 20000.0 - 10000.0;
    float h10 = unpack(t10) * 20000.0 - 10000.0;
    float h01 = unpack(t01) * 20000.0 - 10000.0;
    float h11 = unpack(t11) * 20000.0 - 10000.0;
    
    return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

float sampleElevationNearest(vec2 uv) {
    return unpack(texture(u_image, uv)) * 20000.0 - 10000.0;
}

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
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

void main() {
    if (u_sunAltitude <= 0.001) {
        fragColor = vec4(0.0);
        return;
    }
    
    float startElevation = sampleElevationBilinear(v_pos);
    if (startElevation < EMPTY_ELEVATION) {
        fragColor = vec4(0.0);
        return;
    }
    
    // 1. Convert a one-meter world step to atlas UV. The shadow atlas is a
    // Mercator heightfield, so per-axis meters-per-pixel and non-square bounds matter.
    vec2 worldStepPerMeter = vec2(
        u_sunDirection.x / WORLD_CIRCUMFERENCE,
        u_sunDirection.y / WORLD_CIRCUMFERENCE
    );
    vec2 sampleUVStepPerMeter = worldStepPerMeter / (u_atlas_bounds.zw - u_atlas_bounds.xy);
    sampleUVStepPerMeter.y = -sampleUVStepPerMeter.y;

    float tanSun = max(tan(u_sunAltitude), 0.001);
    float jitterMeters = hash12(floor(v_pos * u_dimension) + u_sunDirection * 37.0) * min(u_step_meters, 45.0) * 0.35;
    vec2 previousUV = v_pos + sampleUVStepPerMeter * jitterMeters;
    float previousRayHeight = startElevation + jitterMeters * tanSun;
    float distanceMeters = jitterMeters;
    
    float shadow = 0.0;
    
    // 2. Cascaded raymarch:
    //    near: full GSD steps + manual bilinear elevation
    //    mid: parent-scale steps + manual bilinear elevation
    //    far: coarse steps + nearest elevation, relying on LOD atlas bands
    for (float i = 0.0; i < hardMaxSteps; i++) {
        if (i >= u_max_steps || distanceMeters >= u_max_distance) break;
        
        float stepMeters = u_step_meters * cascadeStepMultiplier(distanceMeters);
        float nextDistance = min(distanceMeters + stepMeters, u_max_distance);
        stepMeters = nextDistance - distanceMeters;
        distanceMeters = nextDistance;

        vec2 currentUV = previousUV + sampleUVStepPerMeter * stepMeters;
        float currentRayHeight = previousRayHeight + stepMeters * tanSun;

        if (currentUV.x < 0.0 || currentUV.x > 1.0 || currentUV.y < 0.0 || currentUV.y > 1.0) break;
        if (currentRayHeight > 8900.0) break;

        float elev = sampleElevationCascade(currentUV, distanceMeters);
        float margin = elev - currentRayHeight;
        if (distanceMeters > MID_CASCADE_METERS && margin > -u_step_meters * 2.0) {
            elev = sampleElevationBilinear(currentUV);
            margin = elev - currentRayHeight;
        }
        
        if (margin > 0.0) {
            float hitMargin = margin;
            vec2 loUV = previousUV;
            vec2 hiUV = currentUV;
            float loRayHeight = previousRayHeight;
            float hiRayHeight = currentRayHeight;
            float loDistance = distanceMeters - stepMeters;
            float hiDistance = distanceMeters;

            for (int j = 0; j < 5; j++) {
                vec2 midUV = mix(loUV, hiUV, 0.5);
                float midRayHeight = mix(loRayHeight, hiRayHeight, 0.5);
                float midDistance = mix(loDistance, hiDistance, 0.5);
                float midElev = sampleElevationBilinear(midUV);

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
            
            float distanceFade = 1.0 - smoothstep(u_max_distance * 0.94, u_max_distance, hiDistance);
            float blockerStrength = smoothstep(0.0, max(8.0, u_step_meters * 1.05), hitMargin);
            float contactFade = smoothstep(0.0, max(18.0, u_step_meters * 1.4), hiDistance);
            shadow = mix(0.50, 1.0, blockerStrength) * mix(0.90, 1.0, contactFade) * distanceFade;
            break;
        }

        previousUV = currentUV;
        previousRayHeight = currentRayHeight;
    }
    
    fragColor = vec4(vec3(shadow), 1.0);
}
