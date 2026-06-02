uniform mat4 u_inv_proj_matrix;
in vec2 a_pos;
out vec3 v_ray;

void main() {
    gl_Position = vec4(a_pos, 1.0, 1.0);
    vec4 ray_view = u_inv_proj_matrix * vec4(a_pos, -1.0, 1.0);
    v_ray = ray_view.xyz / ray_view.w;
}
