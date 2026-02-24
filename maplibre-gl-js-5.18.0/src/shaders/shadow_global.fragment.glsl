uniform sampler2D u_image; // Global Elevation Buffer (Packed)
uniform vec2 u_sunDirection;
uniform float u_sunAltitude;
uniform vec2 u_metersPerPixel; // [mppX, mppY] per-axis for correct aspect ratio
uniform vec4 u_atlas_bounds; // [minX, minY, maxX, maxY] in 0..1 Mercator

in vec2 v_pos; // Viewport UV (0..1)

// Unpack logic
const highp vec4 bitUn = vec4(1./(256.*256.*256.), 1./(256.*256.), 1./256., 1.);
highp float unpack(highp vec4 color) {
    return dot(color, bitUn);
}

// Fixed-meter stepping for zoom-independent shadow length
const float MAX_STEPS = 200.0;
const float STEP_METERS = 25.0;  // 25 meters per step → max reach = 5000m
const float WORLD_CIRCUMFERENCE = 40075016.7;

void main() {
    // 1. Convert Screen-UV to World-Mercator
    // v_pos Y must be flipped because ortho renders minY at FBO top
    vec2 flippedPos = vec2(v_pos.x, 1.0 - v_pos.y);
    vec2 worldPos = flippedPos * (u_atlas_bounds.zw - u_atlas_bounds.xy) + u_atlas_bounds.xy;
    
    vec4 elevData = texture(u_image, v_pos); // Sample without flip (texture coords)
    float startElevation = unpack(elevData) * 20000.0 - 10000.0;
    
    // 2. Calculate World-Mercator Increment per step in FIXED METERS
    // This ensures shadow length is zoom-independent
    vec2 worldStep = vec2(
        u_sunDirection.x * STEP_METERS / WORLD_CIRCUMFERENCE,
        u_sunDirection.y * STEP_METERS / WORLD_CIRCUMFERENCE
    );
    float zStep = STEP_METERS * tan(u_sunAltitude);
    
    float shadow = 0.0;
    vec2 currentWorld = worldPos;
    float currentRayHeight = startElevation;
    
    for (float i = 1.0; i <= MAX_STEPS; i++) {
        currentWorld += worldStep;
        currentRayHeight += zStep;
        
        // 3. Convert World back to Atlas-UV for sampling (with Y-flip for FBO orientation)
        vec2 sampleUV = (currentWorld - u_atlas_bounds.xy) / (u_atlas_bounds.zw - u_atlas_bounds.xy);
        sampleUV.y = 1.0 - sampleUV.y; // Flip Y: ortho renders minY at top of FBO
        
        // Atlas bounds check
        if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) break;
        
        vec4 data = texture(u_image, sampleUV);
        float elev = unpack(data) * 20000.0 - 10000.0;
        
        if (elev > currentRayHeight) {
            // Soft penumbra: sharper near occluder, softer when ray barely touches
            float penetration = elev - currentRayHeight;
            shadow = clamp(penetration / 50.0, 0.3, 1.0);
            break;
        }
    }
    
    fragColor = vec4(vec3(shadow), 1.0);
}
