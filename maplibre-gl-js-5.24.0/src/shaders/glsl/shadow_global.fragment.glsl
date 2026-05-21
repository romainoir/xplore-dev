uniform sampler2D u_image; // Global Elevation Buffer (Packed)
uniform vec2 u_sunDirection;
uniform float u_sunAltitude;
uniform vec2 u_metersPerPixel; // [mppX, mppY] per-axis for correct aspect ratio
uniform vec4 u_atlas_bounds; // [minX, minY, maxX, maxY] in 0..1 Mercator
uniform vec4 u_near_atlas_bounds; // [minX, minY, maxX, maxY] for optional near-core skip

uniform float u_max_steps;
uniform float u_step_meters;
uniform vec2 u_dimension;
uniform float u_max_distance;
uniform float u_near_cascade_distance;
uniform float u_mid_cascade_distance;
uniform float u_ridge_sample_strength;
uniform float u_skip_near_core;

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

bool shouldSkipNearCore(vec2 globalUV) {
    if (u_skip_near_core < 0.5 || u_sunAltitude < radians(14.0)) {
        return false;
    }

    vec2 nearSpan = u_near_atlas_bounds.zw - u_near_atlas_bounds.xy;
    if (nearSpan.x <= 0.0 || nearSpan.y <= 0.0) {
        return false;
    }

    vec2 worldMercator = mix(u_atlas_bounds.xy, u_atlas_bounds.zw, globalUV);
    vec2 nearUV = (worldMercator - u_near_atlas_bounds.xy) / nearSpan;
    if (nearUV.x <= 0.0 || nearUV.x >= 1.0 || nearUV.y <= 0.0 || nearUV.y >= 1.0) {
        return false;
    }

    vec2 sunDirNearUV = vec2(u_sunDirection.x / nearSpan.x, -u_sunDirection.y / nearSpan.y);
    float sunDirLen = length(sunDirNearUV);
    sunDirNearUV = sunDirLen > 0.00001 ? sunDirNearUV / sunDirLen : vec2(1.0, 0.0);

    return atlasEdgeRoom(nearUV) > 0.16 && rayRoomToAtlasEdge(nearUV, sunDirNearUV) > 0.26;
}

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
    float nearDistance = max(u_near_cascade_distance, 1.0);
    float midDistance = max(u_mid_cascade_distance, nearDistance + 1.0);
    float nearToMid = smoothstep(nearDistance * 0.75, nearDistance * 1.25, distanceMeters);
    float midToFar = smoothstep(midDistance * 0.75, midDistance * 1.25, distanceMeters);
    return mix(mix(1.0, 2.75, nearToMid), 7.0, midToFar);
}

float sampleElevationCascade(vec2 uv, float distanceMeters) {
    // Manual bilinear sampling is more expensive than nearest, but it removes
    // far-cascade blockiness in cast-shadow silhouettes after camera idle.
    return sampleElevationBilinear(uv);
}

float sampleElevationRidgeAware(vec2 uv, float distanceMeters) {
    float center = sampleElevationBilinear(uv);
    float nearRidgeWindow = 1.0 - smoothstep(u_near_cascade_distance * 0.65, u_mid_cascade_distance * 1.05, distanceMeters);
    float ridgeStrength = clamp(u_ridge_sample_strength, 0.0, 1.0) * nearRidgeWindow;
    if (ridgeStrength <= 0.001) {
        return center;
    }

    vec2 atlasSpan = max(u_atlas_bounds.zw - u_atlas_bounds.xy, vec2(1.0e-9));
    vec2 rayDir = vec2(u_sunDirection.x / atlasSpan.x, -u_sunDirection.y / atlasSpan.y);
    float rayLen = length(rayDir);
    rayDir = rayLen > 0.00001 ? rayDir / rayLen : vec2(1.0, 0.0);
    vec2 texel = vec2(1.0) / max(u_dimension, vec2(1.0));

    float lowSunRidge = 1.0 - smoothstep(radians(14.0), radians(34.0), u_sunAltitude);
    float radius = mix(0.38, 0.82, lowSunRidge);
    vec2 rayStep = rayDir * texel * radius;

    float ridge = center;
    ridge = max(ridge, sampleElevationBilinear(uv + rayStep));
    ridge = max(ridge, sampleElevationBilinear(uv - rayStep));

    float lift = max(ridge - center, 0.0);
    return center + lift * ridgeStrength;
}

void main() {
    if (u_sunAltitude <= 0.001) {
        fragColor = vec4(0.0);
        return;
    }

    if (shouldSkipNearCore(v_pos)) {
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

        float elev = sampleElevationRidgeAware(currentUV, distanceMeters);
        float margin = elev - currentRayHeight;
        if (distanceMeters > u_mid_cascade_distance && margin > -u_step_meters * 2.0) {
            elev = sampleElevationRidgeAware(currentUV, distanceMeters);
            margin = elev - currentRayHeight;
        }
        
        if (margin > 0.0) {
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
                float midElev = sampleElevationRidgeAware(midUV, midDistance);

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
            shadow = distanceFade;
            break;
        }

        previousUV = currentUV;
        previousRayHeight = currentRayHeight;
    }
    
    fragColor = vec4(vec3(shadow), 1.0);
}
