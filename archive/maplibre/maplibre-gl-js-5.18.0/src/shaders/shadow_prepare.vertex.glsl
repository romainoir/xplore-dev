in vec2 a_pos;
out vec2 v_pos;

void main() {
    // MapLibre's rasterBoundsBuffer uses coordinates from 0 to 8192 (EXTENT)
    vec2 pos = a_pos / 8192.0;
    
    // Map [0, 1] to clip space [-1, 1]
    gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
    
    // Invert y to match MapLibre's FBO coordinate system
    v_pos = vec2(pos.x, 1.0 - pos.y);
}
