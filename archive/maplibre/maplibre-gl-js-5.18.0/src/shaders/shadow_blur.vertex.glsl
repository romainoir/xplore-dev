in vec2 a_pos;
out vec2 v_pos;

void main() {
    // a_pos is in 0..8192 (EXTENT)
    vec2 unit_pos = a_pos / 8192.0;
    v_pos = unit_pos;
    // Map to [-1, 1] clip space
    gl_Position = vec4(unit_pos * 2.0 - 1.0, 0.0, 1.0);
}
