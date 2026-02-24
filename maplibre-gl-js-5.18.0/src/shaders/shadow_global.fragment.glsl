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
// By using dithering + blur, we can safely halve the step count for double performance
const float MAX_STEPS = 100.0;
const float STEP_METERS = 40.0;  // 40m * 100 = 4000m reach
const float WORLD_CIRCUMFERENCE = 40075016.7;

// Interleaved Gradient Noise (IGN) for spatial dithering
float getIGN(vec2 p) {
    vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
    return fract(magic.z * fract(dot(p, magic.xy)));
}

void main() {
    // 1. Convert Screen-UV to World-Mercator
    // v_pos Y must be flipped because ortho renders minY at FBO top
    vec2 flippedPos = vec2(v_pos.x, 1.0 - v_pos.y);
    vec2 worldPos = flippedPos * (u_atlas_bounds.zw - u_atlas_bounds.xy) + u_atlas_bounds.xy;
    
    vec4 elevData = texture(u_image, v_pos); // Sample without flip (texture coords)
    float startElevation = unpack(elevData) * 20000.0 - 10000.0;
    
    // 2. Loop Hoisting: Pre-calculate the exact UV step size OUTSIDE the loop
    vec2 worldStep = vec2(
        u_sunDirection.x * STEP_METERS / WORLD_CIRCUMFERENCE,
        u_sunDirection.y * STEP_METERS / WORLD_CIRCUMFERENCE
    );
    // Convert worldStep directly to a UV-space delta
    vec2 sampleUVStep = worldStep / (u_atlas_bounds.zw - u_atlas_bounds.xy);
    // Apply Y-flip constraint to the step itself (moving North/South correctly)
    sampleUVStep.y = -sampleUVStep.y; 

    float zStep = STEP_METERS * tan(u_sunAltitude);
    
    // 3. IGN Dithering: Apply a 0-1 random offset to the initial ray position
    float ditherOffset = getIGN(gl_FragCoord.xy);
    vec2 currentSampleUV = v_pos + (sampleUVStep * ditherOffset);
    float currentRayHeight = startElevation + (zStep * ditherOffset);
    
    float shadow = 0.0;
    
    // Perform maximum N steps raymarching
    for (float i = 1.0; i <= MAX_STEPS; i++) {
        currentSampleUV += sampleUVStep;
        currentRayHeight += zStep;
        
        // Early Exit 1: Out of Atlas Bounds
        if (currentSampleUV.x < 0.0 || currentSampleUV.x > 1.0 || currentSampleUV.y < 0.0 || currentSampleUV.y > 1.0) break;
        
        // Early Exit 2: Atmospheric Escape
        // If the ray breaches 8900m (taller than Everest), no terrain can possibly occlude it.
        if (currentRayHeight > 8900.0) break;
        
        vec4 data = texture(u_image, currentSampleUV);
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
