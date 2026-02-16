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

in vec2 v_texture_pos;
in float v_fog_depth;
in float v_elevation;
in float v_dist_linear;

const float gamma = 2.2;

vec4 gammaToLinear(vec4 color) {
    return pow(color, vec4(gamma));
}

vec4 linearToGamma(vec4 color) {
    return pow(color, vec4(1.0 / gamma));
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
            float alpha_major = 1.0 - smoothstep(0.5, 1.5, pixel_dist_major);

            float final_alpha = max(alpha_minor * 0.6, alpha_major) * global_fade;
            vec3 color = mix(u_contour_color.rgb, vec3(0.0), alpha_major * 0.3);

            fragColor = mix(fragColor, vec4(color, 1.0), final_alpha * u_contour_color.a);
        }
    }
}
