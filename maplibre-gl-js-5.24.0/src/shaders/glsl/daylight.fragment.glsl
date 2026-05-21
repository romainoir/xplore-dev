// Daylight / Sun Duration display shader
// The expensive horizon visibility integration is cached in u_daylight.

uniform sampler2D u_daylight;
uniform sampler2D u_color_ramp;
uniform sampler2D u_dem_derivative;
uniform float u_opacity;
uniform float u_daylight_mode;
uniform float u_dem_derivative_available;
uniform float u_dem_derivative_dim;
uniform float u_dem_derivative_exag;
uniform float u_daylight_relief_strength;

in vec2 v_pos;
in vec2 v_atlas_uv;
in vec2 v_dem_coord;

#ifndef HAS_UNIFORM_u_color_ramp
#define HAS_UNIFORM_u_color_ramp
#endif

const float PI = 3.141592653589793;

vec2 samplePreparedReliefGradient() {
    if (u_dem_derivative_available < 0.5 || u_dem_derivative_dim <= 2.0) {
        return vec2(0.0);
    }

    float invDim = 1.0 / max(u_dem_derivative_dim, 1.0);
    vec2 uv = clamp((v_dem_coord - 1.0) * invDim, vec2(0.5 * invDim), vec2(1.0 - 0.5 * invDim));
    vec2 encoded = texture(u_dem_derivative, uv).rg;
    return ((encoded - 0.5) * 8.0) * max(u_dem_derivative_exag, 0.01);
}

float daylightReliefShadow() {
    vec2 gradient = samplePreparedReliefGradient();
    float gradientLength = length(gradient);
    float slope = atan(gradientLength * 2.0) * 2.0 / PI;
    if (slope <= 0.001) {
        return 0.0;
    }

    // Static, dark-only relief from normal.z, similar to reading the blue
    // channel of a normal map. This adds terrain structure without encoding
    // a directional light or a time-of-day cast shadow into the analysis layer.
    vec3 normal = normalize(vec3(-gradient.x, -gradient.y, 1.0));
    float facing = clamp(normal.z, 0.0, 1.0);
    float facingOcclusion = pow(clamp(1.0 - facing, 0.0, 1.0), 0.62);
    float slopeMask = smoothstep(0.025, 0.52, slope);
    float ridgeDetail = smoothstep(0.09, 0.62, slope);

    return clamp((facingOcclusion * 0.84 + ridgeDetail * 0.16) * slopeMask, 0.0, 1.0);
}

vec3 applyDaylightRelief(vec3 color, float rampPos) {
    float strength = clamp(u_daylight_relief_strength, 0.0, 1.0);
    if (strength <= 0.001) return color;

    float relief = daylightReliefShadow();
    float litMask = smoothstep(0.001, 0.030, rampPos);
    float modeScale = u_daylight_mode > 0.5 ? 0.70 : 1.0;
    float darken = relief * strength * modeScale * litMask;
    return color * (1.0 - darken);
}

void main() {
    if (v_atlas_uv.x < 0.0 || v_atlas_uv.x > 1.0 || v_atlas_uv.y < 0.0 || v_atlas_uv.y > 1.0) {
        fragColor = vec4(0.0);
        return;
    }

    vec4 daylight = texture(u_daylight, v_atlas_uv);
    float rampPos = clamp(daylight.r, 0.0, 1.0);

    if (u_daylight_mode > 0.5) {
        float timingScore = clamp(u_daylight_mode > 1.5 ? daylight.b : daylight.g, 0.0, 1.0);
        float hasSun = step(0.001, rampPos);
        float windowLit = smoothstep(0.012, 0.085, timingScore) * hasSun;
        float score = pow(clamp(smoothstep(0.025, 0.58, timingScore) * hasSun, 0.0, 1.0), 0.72);
        vec3 unlit = vec3(0.0);
        vec3 low = vec3(0.42, 0.02, 0.01);
        vec3 mid = vec3(0.90, 0.04, 0.01);
        vec3 hot = vec3(1.00, 0.46, 0.03);
        vec3 peak = vec3(1.00, 0.85, 0.16);
        vec3 color = mix(low, mid, smoothstep(0.05, 0.48, score));
        color = mix(color, hot, smoothstep(0.42, 0.84, score));
        color = mix(color, peak, smoothstep(0.82, 1.0, score));
        color = mix(unlit, color, windowLit);
        color = applyDaylightRelief(color, rampPos);
        float darkAlpha = 0.58;
        float litAlpha = mix(0.30, 0.06, score);
        float alpha = u_opacity * mix(darkAlpha, litAlpha, windowLit);
        fragColor = vec4(color, alpha);
        return;
    }

    vec4 color = texture(u_color_ramp, vec2(rampPos, 0.5));
    color.rgb = applyDaylightRelief(color.rgb, rampPos);
    color.a *= u_opacity;
    fragColor = color;
}
