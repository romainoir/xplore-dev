// Daylight / Sun Duration display shader
// The expensive horizon visibility integration is cached in u_daylight.

uniform sampler2D u_daylight;
uniform sampler2D u_color_ramp;
uniform float u_opacity;
uniform float u_daylight_mode;

in vec2 v_pos;
in vec2 v_atlas_uv;

#ifndef HAS_UNIFORM_u_color_ramp
#define HAS_UNIFORM_u_color_ramp
#endif

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
        float windowLit = smoothstep(0.012, 0.085, timingScore);
        float score = pow(clamp(smoothstep(0.025, 0.58, timingScore) * hasSun, 0.0, 1.0), 0.72);
        vec3 unlit = vec3(0.0);
        vec3 low = vec3(0.36, 0.02, 0.01);
        vec3 mid = vec3(0.82, 0.03, 0.01);
        vec3 hot = vec3(1.00, 0.72, 0.03);
        vec3 peak = vec3(1.00, 0.98, 0.55);
        vec3 color = mix(low, mid, smoothstep(0.05, 0.48, score));
        color = mix(color, hot, smoothstep(0.42, 0.84, score));
        color = mix(color, peak, smoothstep(0.82, 1.0, score));
        color = mix(unlit, color, windowLit);
        float alpha = u_opacity * hasSun * mix(0.92, 1.0, windowLit);
        fragColor = vec4(color, alpha);
        return;
    }

    vec4 color = texture(u_color_ramp, vec2(rampPos, 0.5));
    color.a *= u_opacity;
    fragColor = color;
}
