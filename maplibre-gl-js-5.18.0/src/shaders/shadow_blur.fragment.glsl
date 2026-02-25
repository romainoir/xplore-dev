uniform sampler2D u_image;
uniform vec2 u_direction; // [1.0, 0.0] or [0.0, 1.0]

in vec2 v_pos;

void main() {
    float weights[5] = float[](0.2270270270, 0.1945945946, 0.1216216216, 0.0540540541, 0.0162162162);

    // Dramatically reduce the blur spread so the proxy 8-step shadow remains crisp
    vec2 tex_offset = (u_direction * 0.6) / 2048.0; 
    vec3 result = texture(u_image, v_pos).rgb * weights[0];
    for(int i = 1; i < 5; ++i) {
        result += texture(u_image, v_pos + tex_offset * float(i)).rgb * weights[i];
        result += texture(u_image, v_pos - tex_offset * float(i)).rgb * weights[i];
    }
    fragColor = vec4(result, 1.0);
}
