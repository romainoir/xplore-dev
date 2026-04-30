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
        float first = clamp(daylight.g, 0.0, 1.0);
        float last = clamp(daylight.b, 0.0, 1.0);
        float hasSun = step(0.001, rampPos);
        float earlyScore = (1.0 - first) * rampPos * hasSun;
        float lateScore = last * rampPos * hasSun;
        float allDayScore = sqrt(max(earlyScore * lateScore, 0.0));

        vec3 color = mix(vec3(0.03, 0.06, 0.16), vec3(0.05, 0.30, 0.72), smoothstep(0.04, 0.42, rampPos));
        color = mix(color, vec3(0.05, 0.68, 0.56), smoothstep(0.34, 0.72, rampPos));
        color = mix(color, vec3(0.95, 0.82, 0.22), smoothstep(0.70, 0.93, rampPos));
        color = mix(color, vec3(0.34, 0.96, 0.78), earlyScore * (1.0 - lateScore) * 0.35);
        color = mix(color, vec3(1.0, 0.50, 0.12), lateScore * 0.58);
        color = mix(color, vec3(1.0, 0.16, 0.08), lateScore * smoothstep(0.60, 0.95, rampPos) * 0.42);
        color = mix(color, vec3(1.0, 0.95, 0.58), allDayScore * 0.32);
        color = mix(vec3(0.02, 0.03, 0.08), color, hasSun);
        fragColor = vec4(color, u_opacity * mix(0.74, 1.0, rampPos));
        return;
    }

    vec4 color = texture(u_color_ramp, vec2(rampPos, 0.5));
    color.a *= u_opacity;
    fragColor = color;
}
