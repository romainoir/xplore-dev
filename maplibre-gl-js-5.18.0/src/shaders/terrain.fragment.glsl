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

// Sample raw DEM elevation at a coord in DEM-space
float sampleDemElev(vec2 coord) {
    vec2 f = fract(coord);
    float d = 1.0 / u_dem_ao_dim;
    vec2 c = (floor(coord) + 0.5) * d;
    vec4 rgbTL = texture(u_dem_ao, c) * 255.0 * u_dem_ao_unpack; float tl = rgbTL.r + rgbTL.g + rgbTL.b - u_dem_ao_unpack.a;
    vec4 rgbTR = texture(u_dem_ao, c + vec2(d, 0.0)) * 255.0 * u_dem_ao_unpack; float tr = rgbTR.r + rgbTR.g + rgbTR.b - u_dem_ao_unpack.a;
    vec4 rgbBL = texture(u_dem_ao, c + vec2(0.0, d)) * 255.0 * u_dem_ao_unpack; float bl = rgbBL.r + rgbBL.g + rgbBL.b - u_dem_ao_unpack.a;
    vec4 rgbBR = texture(u_dem_ao, c + vec2(d, d)) * 255.0 * u_dem_ao_unpack; float br = rgbBR.r + rgbBR.g + rgbBR.b - u_dem_ao_unpack.a;
    return mix(mix(tl, tr, f.x), mix(bl, br, f.x), f.y) * u_dem_ao_exag;
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
        
        // The normal math: normalize(-df/dx, -df/dy, 1/mpp_scaling) 
        // This is equivalent to normalize(-dx, -dy, mpp)
        vec3 normal = normalize(vec3(-grad.x, -grad.y, u_metersPerPixel));

        vec3 aoLight = normalize(vec3(0.1, 0.2, 1.0)); 
        float dotAO = clamp(dot(normal, aoLight), 0.0, 1.0);
        float ao = dotAO * 0.35 + 0.65; // Strengthened range for high-res DEM detail

        // ── Combine Cast Shadow + Subtle AO ──
        float shadowDarken = 1.0 - globalShadow * u_shadow_intensity * 0.65;
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
                    float normalized = clamp(eE / 4000.0, 0.0, 1.0);
                    fragColor.rgb = vec3(normalized);
                } else if (u_debug_mode == 5) {
                    fragColor.rgb = normal * 0.5 + 0.5;
                }
            }
        }
    }
}
