uniform mat4 u_matrix;

in vec2 a_pos;

out vec2 v_pos;

void main() {
    gl_Position = projectTile(a_pos, a_pos);
    v_pos = a_pos / 8192.0;
    
    // Invert y to match MapLibre's FBO coordinate system where textures are flipped
    v_pos.y = 1.0 - v_pos.y;
    
    // North pole
    if (a_pos.y < -32767.5) {
        v_pos.y = 1.0; // Flipped
    }
    // South pole
    if (a_pos.y > 32766.5) {
        v_pos.y = 0.0; // Flipped
    }
}
