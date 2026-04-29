// Daylight / Sun Duration display shader
// The expensive horizon visibility integration is cached in u_daylight.

uniform sampler2D u_daylight;
uniform sampler2D u_color_ramp;
uniform float u_opacity;

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

    float rampPos = clamp(texture(u_daylight, v_atlas_uv).r, 0.0, 1.0);
    vec4 color = texture(u_color_ramp, vec2(rampPos, 0.5));
    color.a *= u_opacity;
    fragColor = color;
}
