uniform vec4 u_sky_color;
uniform vec4 u_horizon_color;

uniform vec2 u_horizon;
uniform vec2 u_horizon_normal;
uniform float u_sky_horizon_blend;
uniform float u_sky_blend;
uniform vec2 u_sun_screen_pos;
uniform float u_sun_size;
uniform float u_sun_glow_size;
uniform float u_sun_opacity;
uniform vec4 u_sun_color;
uniform vec4 u_sun_glow_color;

void main() {
    float x = gl_FragCoord.x;
    float y = gl_FragCoord.y;
    float blend = (y - u_horizon.y) * u_horizon_normal.y + (x - u_horizon.x) * u_horizon_normal.x;
    vec4 skyColor = vec4(0.0);
    if (blend > 0.0) {
        if (blend < u_sky_horizon_blend) {
            skyColor = mix(u_sky_color, u_horizon_color, pow(1.0 - blend / u_sky_horizon_blend, 2.0));
        } else {
            skyColor = u_sky_color;
        }
    }

    float sunDistance = length(gl_FragCoord.xy - u_sun_screen_pos);
    float glow = (1.0 - smoothstep(u_sun_size, u_sun_glow_size, sunDistance)) * u_sun_opacity;
    float disk = (1.0 - smoothstep(u_sun_size - 1.5, u_sun_size + 1.5, sunDistance)) * u_sun_opacity;
    float halo = glow * u_sun_glow_color.a * smoothstep(0.0, u_sky_horizon_blend * 0.45, blend);
    skyColor.rgb = mix(skyColor.rgb, u_sun_glow_color.rgb, clamp(halo, 0.0, 0.65));
    skyColor.rgb = mix(skyColor.rgb, u_sun_color.rgb, clamp(disk, 0.0, 1.0));
    skyColor.a = max(skyColor.a, clamp(halo * 0.45 + disk, 0.0, 1.0));

    fragColor = mix(skyColor, vec4(vec3(0.0), 0.0), u_sky_blend);
}
