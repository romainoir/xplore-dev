uniform sampler2D u_texture;
uniform vec4 u_fog_color;
uniform vec4 u_horizon_color;
uniform float u_fog_ground_blend;
uniform float u_fog_ground_blend_opacity;
uniform float u_horizon_fog_blend;
uniform bool u_is_globe_mode;
uniform float u_contour_enabled;
uniform float u_contour_interval;
uniform float u_contour_multiplier;
uniform vec4 u_contour_color;
uniform float u_zoom;
uniform float u_tile_zoom;

uniform sampler2D u_shadow_atlas;
uniform vec4 u_atlas_bounds; // [minX, minY, maxX, maxY]
uniform float u_shadow_intensity;
uniform int u_debug_mode;
uniform float u_sun_altitude;  // Sun altitude in radians (0 = horizon, PI/2 = zenith)
uniform vec2 u_sun_direction;  // Normalized sun direction [sin(azimuth), -cos(azimuth)]

// Per-tile DEM for full-res AO (separate names to avoid prelude precision conflict)
uniform highp sampler2D u_dem_ao;        // DEM texture (same data as u_terrain, different unit)
uniform highp vec4 u_dem_ao_unpack;      // DEM unpack vector
uniform highp float u_dem_ao_dim;        // DEM dimension
uniform highp float u_dem_ao_exag;       // terrain exaggeration
uniform sampler2D u_elevation_atlas;     // seamless global elevation atlas (packed float)
uniform float u_metersPerPixel;          // geographic scale for normal calculation

in vec2 v_texture_pos;
in vec2 v_atlas_uv;
in float v_fog_depth;
in float v_elevation;
in float v_dist_linear;
in vec2 v_dem_coord; // Interpolated DEM coordinate from vertex shader

const float gamma = 2.2;

vec4 gammaToLinear(vec4 color) {
    return pow(color, vec4(gamma));
}

vec4 linearToGamma(vec4 color) {
    return pow(color, vec4(1.0 / gamma));
}

// Unpack elevation from the high-precision atlas (matches terrain_elevation.fragment.glsl)
float unpackAtlas(vec2 uv) {
    vec4 packed = texture(u_elevation_atlas, uv);
    const highp vec4 bitUnsh = vec4(1.0 / (256.0 * 256.0 * 256.0), 1.0 / (256.0 * 256.0), 1.0 / 256.0, 1.0);
    float normalizedElev = dot(packed, bitUnsh);
    return (normalizedElev * 20000.0 - 10000.0) * u_dem_ao_exag;
}


// Sample raw DEM elevation with pixel-exact precision (matching MapLibre hillshade-prepare)
float sampleDemElev(vec2 coord) {
    vec2 pos = floor(coord) + 0.5;
    vec4 data = texture(u_dem_ao, pos / u_dem_ao_dim) * 255.0;
    // Standard Terrain-RGB unpack (dot product for speed and precision)
    return (dot(floor(data.rgb + 0.5), u_dem_ao_unpack.rgb) - u_dem_ao_unpack.a) * u_dem_ao_exag;
}

void main() {
    vec4 surface_color = texture(u_texture, vec2(v_texture_pos.x, 1.0 - v_texture_pos.y));

    // Skip fog blending in globe mode
    if (!u_is_globe_mode && v_fog_depth > u_fog_ground_blend) {
        vec4 surface_color_linear = gammaToLinear(surface_color);
        float blend_color = smoothstep(0.0, 1.0, max((v_fog_depth - u_horizon_fog_blend) / (1.0 - u_horizon_fog_blend), 0.0));
        vec4 fog_horizon_color_linear = mix(gammaToLinear(u_fog_color), gammaToLinear(u_horizon_color), blend_color);
        float factor_fog = max(v_fog_depth - u_fog_ground_blend, 0.0) / (1.0 - u_fog_ground_blend);
        fragColor = linearToGamma(mix(surface_color_linear, fog_horizon_color_linear, pow(factor_fog, 2.0) * u_fog_ground_blend_opacity));
    } else {
        fragColor = surface_color;
    }

    // ── Distance-Based Fading Contour Lines ──
    if (u_contour_enabled > 0.5 && u_contour_interval > 0.1) {
        float val = v_elevation * u_contour_multiplier;
        float interval_minor = u_contour_interval;
        float interval_major = interval_minor * 10.0;

        // Fade in with zoom (invisible below z11, fully visible at z13)
        // Fade out with distance (visible within 500m, gone at 3000m)
        float zoom_floor = smoothstep(11.0, 13.0, u_zoom);
        float distance_fade = 1.0 - smoothstep(500.0, 3000.0, v_dist_linear);
        float global_fade = zoom_floor * distance_fade;

        if (global_fade > 0.01) {
            // Distance to nearest contour in meters
            float dist_minor = mod(val, interval_minor);
            if (dist_minor > interval_minor * 0.5) dist_minor = interval_minor - dist_minor;

            float dist_major = mod(val, interval_major);
            if (dist_major > interval_major * 0.5) dist_major = interval_major - dist_major;

            // Screen-space gradient (how many meters per pixel)
            float grad_mag = length(vec2(dFdx(val), dFdy(val)));
            float pixel_dist_minor = dist_minor / max(grad_mag, 1e-6);
            float pixel_dist_major = dist_major / max(grad_mag, 1e-6);

            // Density fade: prevent solid blocks on steep cliffs
            float density_fade = clamp(1.0 - (grad_mag / interval_minor) * 1.5, 0.0, 1.0);

            // 1px wide lines with antialiasing
            float alpha_minor = (1.0 - smoothstep(0.0, 1.0, pixel_dist_minor)) * density_fade;
            float alpha_major = 1.0 - smoothstep(0.0, 1.0, pixel_dist_major);

            float final_alpha = max(alpha_minor * 0.6, alpha_major * 0.85) * global_fade;
            // Un-premultiply alpha (MapLibre Color class premultiplies)
            vec3 base_color = u_contour_color.a > 0.001 ? u_contour_color.rgb / u_contour_color.a : u_contour_color.rgb;
            vec3 color = mix(base_color, vec3(0.0), alpha_major * 0.15);

            fragColor = mix(fragColor, vec4(color, 1.0), final_alpha * u_contour_color.a);
        }
    }

    // ── Global Shadow + Full-Res AO Hillshade + Time-of-Day Coloring ──
    vec2 atlasUV = v_atlas_uv;
    if (atlasUV.x >= -0.001 && atlasUV.x <= 1.001 && atlasUV.y >= -0.001 && atlasUV.y <= 1.001) {
        float globalShadow = texture(u_shadow_atlas, clamp(atlasUV, 0.0, 1.0)).r;

        // ── Raw DEM-Based Subtle AO (high-resolution relief) ──
        // Using v_dem_coord ensures we sample the raw DEM texture directly, 
        // avoiding the faceting artifacts of the mesh-based elevation atlas.
        float eA = sampleDemElev(v_dem_coord + vec2(-1.0, -1.0));
        float eB = sampleDemElev(v_dem_coord + vec2( 0.0, -1.0));
        float eC = sampleDemElev(v_dem_coord + vec2( 1.0, -1.0));
        float eD = sampleDemElev(v_dem_coord + vec2(-1.0,  0.0));
        float eE = sampleDemElev(v_dem_coord);
        float eF = sampleDemElev(v_dem_coord + vec2( 1.0,  0.0));
        float eG = sampleDemElev(v_dem_coord + vec2(-1.0,  1.0));
        float eH = sampleDemElev(v_dem_coord + vec2( 0.0,  1.0));
        float eI = sampleDemElev(v_dem_coord + vec2( 1.0,  1.0));

        // Sobel gradient geographically scaled (meters/meter)
        // Sobel factor is 8.0. Spatial step is u_metersPerPixel.
        vec2 grad = vec2((eC + eF + eF + eI) - (eA + eD + eD + eG), (eG + eH + eH + eI) - (eA + eB + eB + eC)) / 8.0;
        
        // ── Igor Hillshade Algorithm (GDAL-based) Port for Sharp AO ──
        // Using u_sun_direction and raw spatial gradients for maximum punch.
        float azimuth = atan(u_sun_direction.x, -u_sun_direction.y) + 3.14159265;
        float aspect = (grad.x != 0.0 || grad.y != 0.0) ? atan(grad.y, -grad.x) : 1.570796;
        
        // Slope strength: matches native hillshade-prepare calculations
        float slope_magnitude = length(grad / u_metersPerPixel) * u_dem_ao_exag * 2.0; 
        float slope_strength = atan(slope_magnitude) * 0.6366197; // 2.0/PI
        
        // Aspect strength for directional contrast
        float aspect_strength = 1.0 - abs(mod((aspect + azimuth) / 3.14159265 + 0.5, 2.0) - 1.0);
        
        float ao_shadow = slope_strength * aspect_strength;
        float ao_highlight = slope_strength * (1.0 - aspect_strength);
        
        // Final AO multiplier: Amplified heavily for punchy contrast (multiplier logic needs stronger scale)
        float ao = 1.0 - clamp(ao_shadow * 1.5, 0.0, 0.9) + ao_highlight * 0.4;

        // ── Combine Cast Shadow + Subtle AO ──
        float shadowDarken = 1.0 - globalShadow * u_shadow_intensity * 0.85;
        fragColor.rgb *= shadowDarken * ao;

        // ── Debug Overlays ──
        if (u_debug_mode > 0) {
            if (atlasUV.x >= 0.0 && atlasUV.x <= 1.0 && atlasUV.y >= 0.0 && atlasUV.y <= 1.0) {
                if (u_debug_mode == 3) {
                    vec2 grid = fract(atlasUV * 16.0);
                    float line = step(0.98, grid.x) + step(0.98, grid.y);
                    fragColor.rgb = mix(fragColor.rgb, vec3(0.0, 0.2, 0.8), 0.4);
                    fragColor.rgb = mix(fragColor.rgb, vec3(1.0, 1.0, 0.0), line * 0.5);
                    fragColor.rgb = mix(fragColor.rgb, vec3(atlasUV, 0.0), 0.2);
                } else if (u_debug_mode == 2) {
                    fragColor.rgb = mix(fragColor.rgb, vec3(globalShadow, globalShadow * 0.6, 0.0), 0.8);
                } else if (u_debug_mode == 4) {
                    fragColor.rgb = vec3(1.0); // raw elev debug removed
                } else if (u_debug_mode == 5) {
                    fragColor.rgb = vec3(0.5); // normal debug removed
                }
            }
        }
    }
}
