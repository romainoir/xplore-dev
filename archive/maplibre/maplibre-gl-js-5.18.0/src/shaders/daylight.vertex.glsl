uniform mat4 u_matrix;
uniform vec3 u_tile_id;
uniform vec4 u_atlas_bounds;

in vec2 a_pos;

out vec2 v_pos;
out vec2 v_atlas_uv;

void main() {
    gl_Position = projectTile(a_pos, a_pos);
    v_pos = a_pos / 8192.0;
    float world_scale = pow(2.0, u_tile_id.x);
    vec2 world_uv = (u_tile_id.yz + a_pos / 8192.0) / world_scale;
    v_atlas_uv = (world_uv - u_atlas_bounds.xy) / (u_atlas_bounds.zw - u_atlas_bounds.xy);
    v_atlas_uv.y = 1.0 - v_atlas_uv.y;
    
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
