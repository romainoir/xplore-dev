// Shadow Fragment Shader - H4 Sunlight Engine (Short-Range Raymarch)

uniform sampler2D u_image;       // 0: Center FBO/DEM
uniform sampler2D u_image_raw;   // 1: Center Raw Backup
uniform sampler2D u_neigh_lat;   // 4: Lateral (E/W)
uniform sampler2D u_neigh_long;  // 5: Longitudinal (N/S)
uniform sampler2D u_neigh_diag;  // 6: Diagonal

uniform vec4 u_neigh_zoom_lat;
uniform vec4 u_neigh_zoom_long;
uniform vec4 u_neigh_zoom_diag;
uniform vec2 u_neigh_offsets;    // [dx, dy] sun-facing neighbor direction

uniform sampler2D u_grandparent_dem; // 12
uniform vec4 u_grandparent_zoom; // [scale, offsetX, offsetY, zoomDiff]
uniform float u_shadow_penumbra; // Soft shadow PCSS factor
uniform vec4 u_shadow_shadow_color;
uniform vec4 u_shadow_highlight_color;

in vec2 v_pos;

uniform vec2 u_dimension;
uniform vec4 u_unpack;
uniform float u_metersPerPixel;
uniform vec2 u_sunDirection;     // 2D direction of sun on the DEM plane (normalized, UV space)
uniform float u_sunAltitude;     // Sun altitude in radians
uniform float u_shadowOpacity;   // Max shadow opacity
uniform float u_shadowMaxDistance; // Max raymarching distance in meters
uniform vec4 u_shadowColor;     // Shadow color
uniform vec3 u_tile_id;         // z, x, y

// Debug Mode
uniform int u_debug_mode;

// Raymarching Tuning
uniform float u_shadow_step_size;
uniform float u_shadow_max_steps;
uniform float u_shadow_acceleration;

#define PI 3.141592653589793
// MAX steps for the MOST intensive case (cascade 2)
// Reduced from 256 to 128/96 for performance on mobile/integrated GPUs
// (LocalPass Detail Cascade 2)
// (LongPass Grandparent Cascade 1)
// These are dynamically clamped by shadowMaxDistance/MPP further down.
// Pass 1: Local Raymarch (Cascade Detail) -> maxStepsDetail.
// Pass 2: Grandparent Raymarch (Cascade Global) -> maxStepsGP.
// Raised cap to 256 for POC slider overhead
#define hardMaxSteps 256.0

// Robust Hash (Dave Hoskins) for UV jittering
float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Decode elevation from RGBA DEM data
float decodeElevation(sampler2D tex, vec2 uv) {
    vec4 data = texture(tex, uv);
    return dot(floor(data * 255.0 + 0.5).rgb, u_unpack.rgb) - u_unpack.a;
}

// Apply zoom transform to UV (scale, offset)
vec2 transformUV(vec2 uv, vec4 z) { 
    return uv * z.x + z.yz; 
}

// Bilinear elevation sample from a DEM texture
float sampleElevation(sampler2D dem, vec2 uv) {
    vec2 dim = u_dimension; // 514
    
    // Map uv [0,1] to internal tile pixel coordinates [1.0, 513.0]
    vec2 pos = uv * (dim - 2.0) + 1.0;
    
    vec2 posCenter = pos - 0.5;
    vec2 f = fract(posCenter);
    vec2 i = floor(posCenter) + 0.5;

    float h00 = decodeElevation(dem, (i + vec2(0.0, 0.0)) / dim);
    float h10 = decodeElevation(dem, (i + vec2(1.0, 0.0)) / dim);
    float h01 = decodeElevation(dem, (i + vec2(0.0, 1.0)) / dim);
    float h11 = decodeElevation(dem, (i + vec2(1.0, 1.0)) / dim);

    return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

// Helper for neighbor decoding with zoom transform
float decodeNeighbor(sampler2D tex, vec2 uv, vec4 z) {
    if (z.x < 0.01) return decodeElevation(u_image_raw, uv);
    return decodeElevation(tex, transformUV(uv, z));
}

// Fast Nearest-Neighbor decoded altitude
float decodeElevationNearest(sampler2D tex, vec2 uv) {
    vec2 pos = uv * (u_dimension - 2.0) + 1.0;
    vec2 i = floor(pos) + 0.5;
    return decodeElevation(tex, i / u_dimension);
}

// Fast Decode helper with Zoom
float decodeNeighborNearest(sampler2D tex, vec2 uv, vec4 z) {
    if (z.x < 0.01) return decodeElevationNearest(u_image_raw, uv);
    return decodeElevationNearest(tex, transformUV(uv, z));
}

// Nearest-neighbor robust global lookup (4x faster for raymarching)
float sampleGlobalElevationNearest(vec2 uv) {
    if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
        return decodeElevationNearest(u_image, uv);
    }
    
    float dx = u_neigh_offsets.x;
    float dy = u_neigh_offsets.y;

    if ((uv.x < 0.0 && dx < 0.0) || (uv.x > 1.0 && dx > 0.0)) {
        vec2 uv_lat = uv - vec2(dx, 0.0);
        if (uv.y >= 0.0 && uv.y <= 1.0) return decodeNeighborNearest(u_neigh_lat, uv_lat, u_neigh_zoom_lat);
        if ((uv.y < 0.0 && dy < 0.0) || (uv.y > 1.0 && dy > 0.0)) {
            return decodeNeighborNearest(u_neigh_diag, uv_lat - vec2(0.0, dy), u_neigh_zoom_diag);
        }
    }
    
    if ((uv.y < 0.0 && dy < 0.0) || (uv.y > 1.0 && dy > 0.0)) {
        if (uv.x >= 0.0 && uv.x <= 1.0) {
            return decodeNeighborNearest(u_neigh_long, uv - vec2(0.0, dy), u_neigh_zoom_long);
        }
    }
    
    return decodeElevationNearest(u_image_raw, fract(uv));
}

float sampleGrandparentElevationNearest(vec2 uv) {
    if (u_grandparent_zoom.w <= 0.0) return -99999.0;
    float scale = u_grandparent_zoom.x;
    float offsetX = u_grandparent_zoom.y;
    float offsetY = u_grandparent_zoom.z;
    vec2 gpUV = vec2(offsetX + uv.x * scale, offsetY + uv.y * scale);
    return decodeElevationNearest(u_grandparent_dem, gpUV);
}

// New robust global elevation lookup optimized for 3 sun-facing neighbors
float sampleGlobalElevation(vec2 uv) {
    if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
        return sampleElevation(u_image, uv);
    }
    
    float dx = u_neigh_offsets.x;
    float dy = u_neigh_offsets.y;

    // Lateral Neighbor (West or East)
    if ((uv.x < 0.0 && dx < 0.0) || (uv.x > 1.0 && dx > 0.0)) {
        vec2 uv_lat = uv - vec2(dx, 0.0);
        if (uv.y >= 0.0 && uv.y <= 1.0) return decodeNeighbor(u_neigh_lat, uv_lat, u_neigh_zoom_lat);
        
        // Diagonal Neighbor
        if ((uv.y < 0.0 && dy < 0.0) || (uv.y > 1.0 && dy > 0.0)) {
            return decodeNeighbor(u_neigh_diag, uv_lat - vec2(0.0, dy), u_neigh_zoom_diag);
        }
    }
    
    // Longitudinal Neighbor (North or South)
    if ((uv.y < 0.0 && dy < 0.0) || (uv.y > 1.0 && dy > 0.0)) {
        if (uv.x >= 0.0 && uv.x <= 1.0) {
            return decodeNeighbor(u_neigh_long, uv - vec2(0.0, dy), u_neigh_zoom_long);
        }
    }
    
    // Fallback to center tile raw if neighbor not provided or in non-sun direction
    return decodeElevation(u_image_raw, fract(uv));
}

// Helper: geographic aspect from derivatives (matches Copy 18)
float get_aspect(vec2 deriv) {
    return deriv.x != 0.0 ? atan(deriv.y, -deriv.x) : (3.14159265 / 2.0 * (deriv.y > 0.0 ? 1.0 : -1.0));
}

// Compute Sobel gradient for surface normal
vec2 computeSobelGradient(vec2 uv) {
    vec2 epsilon = 1.5 / u_dimension; // Hits between pixels to force bilinear smoothing

    float a = sampleElevation(u_image, uv + vec2(-epsilon.x, -epsilon.y));
    float b = sampleElevation(u_image, uv + vec2(0.0, -epsilon.y));
    float c = sampleElevation(u_image, uv + vec2(epsilon.x, -epsilon.y));
    float d = sampleElevation(u_image, uv + vec2(-epsilon.x, 0.0));
    float f = sampleElevation(u_image, uv + vec2(epsilon.x, 0.0));
    float g = sampleElevation(u_image, uv + vec2(-epsilon.x, epsilon.y));
    float h = sampleElevation(u_image, uv + vec2(0.0, epsilon.y));
    float i = sampleElevation(u_image, uv + vec2(epsilon.x, epsilon.y));

    // Denominator scaled for 1.5px offset (3px spread)
    return vec2(
        (c + f + f + i) - (a + d + d + g),
        (g + h + h + i) - (a + b + b + c)
    ) / (12.0 * max(u_metersPerPixel, 0.0001));
}

float sampleGrandparentElevation(vec2 uv) {
    if (u_grandparent_zoom.w <= 0.0) return -99999.0;
    
    float scale = u_grandparent_zoom.x;
    float offsetX = u_grandparent_zoom.y;
    float offsetY = u_grandparent_zoom.z;
    
    vec2 gpUV = vec2(offsetX + uv.x * scale, offsetY + uv.y * scale);
    return sampleElevation(u_grandparent_dem, gpUV);
}

// Reusable Raymarching Helper for Hybrid Cascaded Shadows (PCSS)
// Returns 1.0 - shadowRatio (0.0 = deeply shadowed, 1.0 = fully lit)
float run_raymarch(vec3 lightDir, float altitude, vec2 uvStep, float zStep, float stepDistMeters, float stepSizePixels, float maxSteps, float k_penumbra, float accelerationRate, float lift, bool useGrandparent, float startElevation, vec2 startUV) {
    
    // Copy 18: Jitter to decorrelate samples and hide banding
    float jitter = fract(52.9829189 * fract(0.06711056 * gl_FragCoord.x + 0.00583715 * gl_FragCoord.y));
    
    vec2 currentUV = startUV + uvStep * (0.5 + jitter); // Push off center with jitter
    float currentZ = startElevation + lift + zStep * (0.5 + jitter);
    
    float softShadow = 1.0;
    float accumulatedDistance = stepDistMeters * (0.5 + jitter);
    
    const float EARTH_RADIUS_KM = 6378.137;

    // Copy 18: Strict Bounds checking on the 3x3 neighbor grid
    // For local neighbors, we only have [-1.0, 2.0] available. Grandparent covers much more.
    float boundMinX = useGrandparent ? -10.0 : -0.99;
    float boundMaxX = useGrandparent ?  10.0 :  1.99;
    float boundMinY = useGrandparent ? -10.0 : -0.99;
    float boundMaxY = useGrandparent ?  10.0 :  1.99;
    
    float stepsToXBound = (uvStep.x > 0.0) 
        ? (boundMaxX - currentUV.x) / uvStep.x 
        : (uvStep.x < 0.0 ? (boundMinX - currentUV.x) / uvStep.x : 10000.0);
    float stepsToYBound = (uvStep.y > 0.0) 
        ? (boundMaxY - currentUV.y) / uvStep.y 
        : (uvStep.y < 0.0 ? (boundMinY - currentUV.y) / uvStep.y : 10000.0);
        
    // Clamp maxSteps so we NEVER iterate fully off the loaded textures
    maxSteps = min(maxSteps, min(stepsToXBound, stepsToYBound));
    maxSteps = max(maxSteps, 1.0); // Always take at least 1 step

    float CURVATURE_CONST = 1.0 / (2.0 * EARTH_RADIUS_KM);
    
    for(float i = 0.0; i < hardMaxSteps; i++) {
        if (i >= maxSteps) break; 
        
        float h = 0.0;
        
        if (useGrandparent) {
             h = sampleGrandparentElevationNearest(currentUV);
             if (h < -50000.0) break; 
        } else {
             // Stop tracing if we leave the 3x3 loaded neighbor area
             if (currentUV.x < -1.0 || currentUV.x > 2.0 || currentUV.y < -1.0 || currentUV.y > 2.0) break;
             h = sampleGlobalElevationNearest(currentUV);
        }

        float distanceKm = accumulatedDistance / 1000.0;
        if (distanceKm > 200.0) break; 

        // Optimized curvature calculation
        float effectiveHeight = h - (distanceKm * distanceKm * CURVATURE_CONST * 1000.0);
        
        float h_diff = currentZ - effectiveHeight;
        
        // HARD SHADOW: Break immediately on hit. No expensive per-step PCSS divisions.
        if (h_diff < 0.0) { 
            softShadow = 0.0; 
            break; 
        }
        
        // Copy 18 style adaptive acceleration rate
        float curAccel = 1.0 + (i * accelerationRate);
        currentUV += uvStep * curAccel;
        currentZ += zStep * curAccel;
        accumulatedDistance += stepDistMeters * curAccel;
    }
    return 1.0 - clamp(softShadow, 0.0, 1.0);
}

void main() {
    // ========== DEBUG MODE: 3x3 Neighbor Tile Grid ==========
    if (u_debug_mode == 1) {
        vec2 uv = v_pos;
        
        // Which cell of the 3x3 grid are we in? (0,0 is Top-Left)
        int gridX = int(floor(uv.x * 3.0));
        int gridY = int(floor(uv.y * 3.0));
        vec2 localUV = fract(uv * 3.0);
        
        // Map grid cell [0..2] to relative offset [-1..1]
        vec2 targetOffset = vec2(float(gridX - 1), float(gridY - 1));
        
        // Sample global elevation at the target offset
        float elev = sampleGlobalElevation(localUV + targetOffset);
        
        // Debug Blackout: Only show Center (0,0) and active sun-facing neighbors
        bool isActive = (targetOffset.x == 0.0 && targetOffset.y == 0.0) || // Center
                       (targetOffset.x == u_neigh_offsets.x && targetOffset.y == 0.0) || // Lateral
                       (targetOffset.x == 0.0 && targetOffset.y == u_neigh_offsets.y) || // Longitudinal
                       (targetOffset.x == u_neigh_offsets.x && targetOffset.y == u_neigh_offsets.y); // Diagonal
        
        // Elevation heatmap coloring
        float t = clamp(elev / 4000.0, 0.0, 1.0);
        vec3 color = vec3(0.0); // Default to black
        
        if (isActive) {
            if (t < 0.25)      color = mix(vec3(0.0, 0.0, 0.1), vec3(0.4, 0.0, 0.6), t / 0.25);
            else if (t < 0.5)  color = mix(vec3(0.4, 0.0, 0.6), vec3(0.9, 0.1, 0.1), (t - 0.25) / 0.25);
            else if (t < 0.75) color = mix(vec3(0.9, 0.1, 0.1), vec3(1.0, 0.6, 0.0), (t - 0.5) / 0.25);
            else               color = mix(vec3(1.0, 0.6, 0.0), vec3(1.0, 1.0, 0.8), (t - 0.75) / 0.25);
        }
        
        // Tint neighbors green
        if (gridX != 1 || gridY != 1) {
            color = mix(color, vec3(0.0, 1.0, 0.3), 0.25);
        }
        
        // Grid lines
        if (localUV.x < 0.015 || localUV.y < 0.015 || localUV.x > 0.985 || localUV.y > 0.985) {
            color = mix(color, vec3(0.8), 0.4);
        }
        // Outer tile boundary
        if (uv.x < 0.005 || uv.x > 0.995 || uv.y < 0.005 || uv.y > 0.995) {
            color = vec3(1.0);
        }
        
        // Center marker
        if (gridX == 1 && gridY == 1 && distance(localUV, vec2(0.5)) < 0.03) {
            color = vec3(0.0, 1.0, 0.0);
        }
        
        // Sun direction arrow
        if (gridX == 1 && gridY == 1) {
            vec2 center = vec2(0.5);
            vec2 sunDir = normalize(u_sunDirection) * 0.2;
            vec2 arrowEnd = center + sunDir;
            float distToLine = abs((localUV.y - center.y) * sunDir.x - (localUV.x - center.x) * sunDir.y) / length(sunDir);
            float projLen = dot(localUV - center, sunDir) / dot(sunDir, sunDir);
            if (distToLine < 0.015 && projLen > 0.0 && projLen < 1.0) {
                color = vec3(1.0, 1.0, 0.0);
            }
        }

        fragColor = vec4(color, 1.0);
        return;
    }

    float altitude = max(0.001, u_sunAltitude); // Prevent div by 0 
    float azimuth = atan(u_sunDirection.x, -u_sunDirection.y); 
    
    // Day/Night and Visual Refinements
    float sunAlt = u_sunAltitude;
    float isNight = smoothstep(0.05, -0.05, sunAlt);
    
    // Smooth transition for sunset colors
    // 0.40 (Clear Day) -> 0.15 (Sunset) -> 0.0 (Night)
    float sunsetMix = smoothstep(0.40, 0.05, sunAlt);
    float nightMix = smoothstep(0.10, -0.15, sunAlt);
    vec2 grad = computeSobelGradient(v_pos);
    float aspect = get_aspect(grad); 
    
    vec3 normal = normalize(vec3(-grad.x, -grad.y, 1.0));
    float tanAlt = tan(altitude);
    vec3 lightDir = normalize(vec3(u_sunDirection.x, u_sunDirection.y, tanAlt));
    
    float dotNL = dot(normal, lightDir);
    float dotNL_flat = sin(altitude);
    
    float selfShadow = 1.0 - smoothstep(-0.02, 0.02, dotNL);
    float shadow = 0.0;

    if (selfShadow < 0.98) {
        float startElevation = sampleElevation(u_image, v_pos);
        
        float shadow1 = 0.0;
        float zoomDiff = u_grandparent_zoom.w;
        
        // PASS 1: GRANDPARENT (Long Range Cascade)
        // If zoomDiff >= 1.0, we have successfully fallen back to a lower-zoom parent tile
        if (zoomDiff >= 1.0 && u_grandparent_zoom.x > 0.001) {
            float gpMetersPerPixel = u_metersPerPixel * pow(2.0, zoomDiff);
            float gpStepPixels = 4.0; // Fast step
            float gpUVScale = 1.0 / max(0.0001, u_grandparent_zoom.x);
            
            vec2 gpUVStep = (u_sunDirection / (u_dimension.x - 2.0)) * gpStepPixels * gpUVScale;
            float gpZStep = gpStepPixels * gpMetersPerPixel * tanAlt;
            float gpDistMeters = gpStepPixels * gpMetersPerPixel;
            float gpMaxSteps = min(u_shadow_max_steps, 64.0); // Allow tuning but cap at 64 for global pass
            
            shadow1 = run_raymarch(lightDir, altitude, gpUVStep, gpZStep, gpDistMeters, gpStepPixels, gpMaxSteps, u_shadow_penumbra, 0.015, 1.0, true, startElevation, v_pos);
        }
        
        // PASS 2: NORMAL (Medium/Local Range Cascade)
        float stepSize2 = max(u_shadow_step_size, 0.5); // Use Tuning Uniform
        vec2 uvStep2 = (u_sunDirection / (u_dimension.x - 2.0)) * stepSize2;
        float zStep2 = stepSize2 * u_metersPerPixel * tanAlt;
        float distMeters2 = stepSize2 * u_metersPerPixel;
        // Use Tuning Uniform strictly to override the max distance limits
        float maxSteps2 = u_shadow_max_steps;
        
        float shadow2 = run_raymarch(lightDir, altitude, uvStep2, zStep2, distMeters2, stepSize2, maxSteps2, u_shadow_penumbra, u_shadow_acceleration, 1.0, false, startElevation, v_pos);

        // Combine Cascades seamlessly
        shadow = max(shadow1, shadow2);
    } else {
        shadow = 1.0;
    }

    // --- IMPROVED SUNSET & NIGHT COMPOSITION ---
    float t_shd = clamp(dotNL_flat - dotNL, 0.0, 1.0);
    float t_lit = clamp(dotNL - dotNL_flat, 0.0, 1.0);

    // Igor-Style AO: Topographical interior detail
    // At night, we force the 'sun' to be overhead to keep AO definition
    float igor_azi = azimuth + PI;
    float slope_strength = atan(length(grad)) * (2.0 / PI);
    float aspect_strength = 1.0 - abs(mod((aspect + igor_azi) / PI + 0.5, 2.0) - 1.0);
    
    // When sun is below horizon, dampen the aspect dependency to simulate global sky AO
    float igor_ao = slope_strength * mix(aspect_strength, 0.5, nightMix);
    
    // Combine shadow components
    float shadowFactor = max(shadow, selfShadow);
    float baseShadow = max(shadowFactor * 0.75, t_shd);
    
    // Ensure terrain detail remains visible in deep night/shadow
    float sAlpha = baseShadow + igor_ao * 0.45;

    // VIBRANT SUNSET COLORATION
    // Stage 1: Royal Purple (Deep Night)
    // Stage 2: Deep Red/Magenta (Afterglow)
    // Stage 3: Golden/Orange (Sunset)
    // Stage 4: Custom Day Shadow Color
    vec3 PURPLE_NIGHT = vec3(0.05, 0.02, 0.15);
    vec3 RED_AFTERGLOW = vec3(0.35, 0.05, 0.10);
    vec3 GOLDEN_SUNSET = vec3(0.15, 0.08, 0.30); // Deep Indigo-Purple base for sunset
    vec3 DAY_SHADOW = u_shadow_shadow_color.rgb;

    vec3 shadowColor = mix(DAY_SHADOW, GOLDEN_SUNSET, sunsetMix);
    shadowColor = mix(shadowColor, RED_AFTERGLOW, smoothstep(0.15, -0.05, sunAlt));
    shadowColor = mix(shadowColor, PURPLE_NIGHT, nightMix);

    // Final Shadow Opacity (Night is deeper)
    float dynamicOpacity = mix(u_shadowOpacity, u_shadowOpacity * 1.2, nightMix);
    sAlpha *= dynamicOpacity;

    // VIBRANT HIGHLIGHTS
    vec4 styleHighlight = u_shadow_highlight_color;
    vec3 GOLD_HIGHLIGHT = vec3(1.0, 0.6, 0.2);
    vec3 RED_HIGHLIGHT = vec3(1.0, 0.3, 0.1);
    
    vec3 sunTint = mix(styleHighlight.rgb, GOLD_HIGHLIGHT, sunsetMix);
    sunTint = mix(sunTint, RED_HIGHLIGHT, smoothstep(0.10, -0.05, sunAlt));
    
    // Highlight fades as sun goes below horizon
    float hAlpha = t_lit * (1.0 - shadowFactor) * u_shadowOpacity * (1.0 + sunsetMix * 3.0) * 0.25;
    hAlpha *= (1.0 - nightMix);

    // Final result: Weighted sum blend
    vec3 finalColor = sunTint * hAlpha + shadowColor * sAlpha * (1.0 - hAlpha);
    float finalAlpha = clamp(max(hAlpha, sAlpha), 0.0, 1.0);

    fragColor = vec4(finalColor, finalAlpha);

#ifdef OVERDRAW_INSPECTOR
    fragColor = vec4(1.0);
#endif
}
