uniform sampler2D u_image;
uniform vec2 u_direction; // [1.0, 0.0] or [0.0, 1.0]
uniform float u_texture_size;
uniform float u_blur_radius;

in vec2 v_pos;

void main() {
    if (dot(u_direction, u_direction) < 0.000001) {
        float radius = max(u_blur_radius, 0.0);
        vec2 texel = vec2(radius / max(u_texture_size, 1.0));
        vec3 center = texture(u_image, v_pos).rgb;

        vec3 left = texture(u_image, v_pos + vec2(-texel.x, 0.0)).rgb;
        vec3 right = texture(u_image, v_pos + vec2(texel.x, 0.0)).rgb;
        vec3 down = texture(u_image, v_pos + vec2(0.0, -texel.y)).rgb;
        vec3 up = texture(u_image, v_pos + vec2(0.0, texel.y)).rgb;
        vec3 dl = texture(u_image, v_pos + vec2(-texel.x, -texel.y)).rgb;
        vec3 dr = texture(u_image, v_pos + vec2(texel.x, -texel.y)).rgb;
        vec3 ul = texture(u_image, v_pos + vec2(-texel.x, texel.y)).rgb;
        vec3 ur = texture(u_image, v_pos + vec2(texel.x, texel.y)).rgb;

        vec3 localMin = min(center, min(min(left, right), min(down, up)));
        vec3 localMax = max(center, max(max(left, right), max(down, up)));
        localMin = min(localMin, min(min(dl, dr), min(ul, ur)));
        localMax = max(localMax, max(max(dl, dr), max(ul, ur)));
        float edge = smoothstep(0.035, 0.36, max(max(localMax.r - localMin.r, localMax.g - localMin.g), localMax.b - localMin.b));

        vec3 filtered = (
            center * 4.0 +
            (left + right + down + up) * 1.25 +
            (dl + dr + ul + ur) * 0.50
        ) / 11.0;

        fragColor = vec4(mix(center, filtered, edge * 0.72), 1.0);
        return;
    }

    float weights[5] = float[](0.2270270270, 0.1945945946, 0.1216216216, 0.0540540541, 0.0162162162);

    // Sub-texel edge cleanup: enough to remove atlas stair-stepping, not a soft penumbra.
    vec2 tex_offset = (u_direction * max(u_blur_radius, 0.0)) / max(u_texture_size, 1.0);
    vec3 result = texture(u_image, v_pos).rgb * weights[0];
    for(int i = 1; i < 5; ++i) {
        result += texture(u_image, v_pos + tex_offset * float(i)).rgb * weights[i];
        result += texture(u_image, v_pos - tex_offset * float(i)).rgb * weights[i];
    }
    fragColor = vec4(result, 1.0);
}
