uniform vec4 u_sky_color;
uniform vec4 u_horizon_color;

uniform vec2 u_horizon;
uniform vec2 u_horizon_normal;
uniform float u_sky_horizon_blend;
uniform float u_sky_blend;
uniform vec3 u_sun_pos;
uniform float u_sun_opacity;

in vec3 view_direction;

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

    vec3 viewDir = normalize(view_direction);
    vec3 sunDir = normalize(u_sun_pos);
    float sunAngle = acos(clamp(dot(viewDir, sunDir), -1.0, 1.0));
    float diskRadius = 0.012; // Deliberately readable while staying close to the real solar direction.
    float glowRadius = 0.085;
    float aa = max(fwidth(sunAngle) * 1.8, 0.0007);
    float disk = 1.0 - smoothstep(diskRadius - aa, diskRadius + aa, sunAngle);
    float glow = 1.0 - smoothstep(diskRadius, glowRadius, sunAngle);
    glow *= glow;

    float horizonMask = smoothstep(0.0, max(u_sky_horizon_blend * 0.25, 1.0), blend);
    float sunAmount = u_sun_opacity * horizonMask;
    vec3 glowColor = vec3(1.0, 0.55, 0.22);
    vec3 diskColor = vec3(1.0, 0.93, 0.72);
    skyColor.rgb = mix(skyColor.rgb, glowColor, clamp(glow * sunAmount * 0.52, 0.0, 0.65));
    skyColor.rgb = mix(skyColor.rgb, diskColor, clamp(disk * sunAmount, 0.0, 1.0));
    skyColor.a = max(skyColor.a, clamp((glow * 0.20 + disk) * sunAmount, 0.0, 1.0));

    fragColor = mix(skyColor, vec4(vec3(0.0), 0.0), u_sky_blend);
}
