in vec3 a_pos3d;

uniform mat4 u_fog_matrix;
uniform float u_ele_delta;

uniform vec3 u_tile_id; // [z, x, y]
uniform vec4 u_atlas_bounds; // [minX, minY, maxX, maxY] Mercator
uniform vec4 u_near_atlas_bounds; // [minX, minY, maxX, maxY] Mercator
out vec2 v_texture_pos;
out vec2 v_atlas_uv;
out vec2 v_near_atlas_uv;
out float v_fog_depth;
out float v_elevation;
out float v_dist_linear;
out vec2 v_dem_coord; // DEM texture coordinate for per-pixel AO sampling

void main() {
    float ele = get_elevation(a_pos3d.xy);
    v_elevation = ele;
    float ele_delta = a_pos3d.z == 1.0 ? u_ele_delta : 0.0;
    v_texture_pos = a_pos3d.xy / 8192.0;

    // Compute DEM coord in vertex shader (linear so interpolation is exact)
    v_dem_coord = (u_terrain_matrix * vec4(a_pos3d.xy, 0.0, 1.0)).xy * u_terrain_dim + 1.0;

    float world_scale = pow(2.0, u_tile_id.x);
    vec2 world_uv = (u_tile_id.yz + a_pos3d.xy / 8192.0) / world_scale;
    v_atlas_uv = (world_uv - u_atlas_bounds.xy) / (u_atlas_bounds.zw - u_atlas_bounds.xy);
    v_atlas_uv.y = 1.0 - v_atlas_uv.y; // Flip Y: ortho renders minY at top of FBO
    v_near_atlas_uv = (world_uv - u_near_atlas_bounds.xy) / (u_near_atlas_bounds.zw - u_near_atlas_bounds.xy);
    v_near_atlas_uv.y = 1.0 - v_near_atlas_uv.y;

    gl_Position = projectTileFor3D(a_pos3d.xy, get_elevation(a_pos3d.xy) - ele_delta);
    vec4 pos = u_fog_matrix * vec4(a_pos3d.xy, ele, 1.0);
    v_fog_depth = pos.z / pos.w * 0.5 + 0.5;
    v_dist_linear = pos.w;
}
