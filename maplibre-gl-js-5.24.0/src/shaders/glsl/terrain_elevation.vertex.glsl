in vec3 a_pos3d;

uniform mat4 u_fog_matrix;
uniform float u_ele_delta;

out float v_elevation;

void main() {
    float ele = get_elevation(a_pos3d.xy);
    v_elevation = ele;
    float ele_delta = a_pos3d.z == 1.0 ? u_ele_delta : 0.0;
    gl_Position = projectTileFor3D(a_pos3d.xy, get_elevation(a_pos3d.xy) - ele_delta);
}
