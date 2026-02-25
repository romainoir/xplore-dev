uniform sampler2D u_image; // Global Elevation Buffer (Packed)
uniform vec2 u_sunDirection;
uniform float u_sunAltitude;
uniform vec2 u_metersPerPixel; // [mppX, mppY] per-axis for correct aspect ratio
uniform vec4 u_atlas_bounds; // [minX, minY, maxX, maxY] in 0..1 Mercator

uniform float u_max_steps;
uniform float u_step_meters;
uniform vec2 u_dimension;

in vec2 v_pos; // Viewport UV (0..1)

// Unpack logic
const highp vec4 bitUn = vec4(1./(256.*256.*256.), 1./(256.*256.), 1./256., 1.);
highp float unpack(highp vec4 color) {
    return dot(color, bitUn);
}

// Fixed-meter stepping for zoom-independent shadow length
// The loop must have a constant upper bound, but we break early based on the generic uniform.
#define hardMaxSteps 512.0

const float WORLD_CIRCUMFERENCE = 40075016.7;

// Interleaved Gradient Noise (IGN) for spatial dithering
float getIGN(vec2 p) {
    vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
    return fract(magic.z * fract(dot(p, magic.xy)));
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

void main() {
    // 1. Convert Screen-UV to World-Mercator
    // v_pos Y must be flipped because ortho renders minY at FBO top
    vec2 flippedPos = vec2(v_pos.x, 1.0 - v_pos.y);
    vec2 worldPos = flippedPos * (u_atlas_bounds.zw - u_atlas_bounds.xy) + u_atlas_bounds.xy;
    
    float startElevation = sampleElevationBilinear(v_pos);
    
    // 2. Loop Hoisting: Pre-calculate the exact UV step size OUTSIDE the loop
    vec2 worldStep = vec2(
        u_sunDirection.x * u_step_meters / WORLD_CIRCUMFERENCE,
        u_sunDirection.y * u_step_meters / WORLD_CIRCUMFERENCE
    );
    // Convert worldStep directly to a UV-space delta
    vec2 sampleUVStep = worldStep / (u_atlas_bounds.zw - u_atlas_bounds.xy);
    // Apply Y-flip constraint to the step itself (moving North/South correctly)
    sampleUVStep.y = -sampleUVStep.y; 

    float zStep = u_step_meters * tan(u_sunAltitude);
    
    // 3. IGN Dithering: Apply a 0-1 random offset to the initial ray position
    float ditherOffset = getIGN(gl_FragCoord.xy);
    vec2 currentSampleUV = v_pos + (sampleUVStep * ditherOffset);
    float currentRayHeight = startElevation + (zStep * ditherOffset);
    
    float shadow = 0.0;
    
    // Perform maximum N steps raymarching
    for (float i = 1.0; i <= hardMaxSteps; i++) {
        if (i > u_max_steps) break;
        
        // Coarse-to-Fine Ray Acceleration:
        // Use a smooth linear acceleration instead of an exploding exponential curve.
        // Step 1: 1x | Step 100: 2x | Step 200: 3x.
        float curAccel = 1.0 + (i * 0.01);
        
        // Calculate the ground elevation exactly under the current ray position
        float elev = sampleElevationBilinear(currentSampleUV);
        
        // Pseudo-SDF Altitude Striding:
        // Calculate the physical empty space between the ray and the terrain.
        // If the ray is 1000m high in the sky, stride 10x faster across the empty void.
        // As the ray gets closer to the mountain peak, clamp smoothly back to 1.0x for precision.
        float clearance = currentRayHeight - elev;
        float altitudeStride = clamp(clearance / 100.0, 1.0, 10.0);
        
        // Apply both Linear Acceleration (distance) and Altitude Striding (clearance)
        float finalAccel = curAccel * altitudeStride;
        
        currentSampleUV += sampleUVStep * finalAccel;
        currentRayHeight += zStep * finalAccel;
        
        // Early Exit 1: Out of Atlas Bounds
        if (currentSampleUV.x < 0.0 || currentSampleUV.x > 1.0 || currentSampleUV.y < 0.0 || currentSampleUV.y > 1.0) break;
        
        // Early Exit 2: Atmospheric Escape
        // If the ray breaches 8900m (taller than Everest), no terrain can possibly occlude it.
        if (currentRayHeight > 8900.0) break;
        
        // Re-sample the new position to check for actual geological intersection
        elev = sampleElevationBilinear(currentSampleUV);
        
        if (elev > currentRayHeight) {
            
            // 3-Step Binary Search (Geometric Refinement)
            // The ray has plunged underground, but because of our massive acceleration strides,
            // we may have overshot the exact ridge line by 40 meters, causing blocky artifacts.
            // We now step backward 20m, then forward 10m, then backward 5m, bisecting
            // the intersection point to geometric pixel perfection!
            float stepScale = 0.5;
            for (int j = 0; j < 3; j++) {
                currentSampleUV -= (sampleUVStep * finalAccel) * stepScale;
                currentRayHeight -= (zStep * finalAccel) * stepScale;
                
                elev = sampleElevationBilinear(currentSampleUV);
                
                // If we popped back above ground, flip the direction to step forward next time
                if (currentRayHeight > elev) {
                    stepScale = -abs(stepScale) * 0.5;
                } else {
                    stepScale = abs(stepScale) * 0.5;
                }
            }
            
            float penetration = elev - currentRayHeight;
            shadow = clamp(penetration / 50.0, 0.3, 1.0);
            break;
        }
    }
    
    fragColor = vec4(vec3(shadow), 1.0);
}
