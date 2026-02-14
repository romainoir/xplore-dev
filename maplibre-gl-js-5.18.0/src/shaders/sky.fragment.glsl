uniform vec4 u_sky_color;
uniform vec4 u_horizon_color;

uniform vec2 u_horizon;
uniform vec2 u_horizon_normal;
uniform float u_sky_horizon_blend;
uniform float u_sky_blend;

uniform vec3 u_sun_pos;
uniform vec3 u_moon_pos;
uniform float u_sun_intensity;
uniform float u_sun_altitude;
uniform float u_moon_phase; // 0=new moon, 0.5=full moon, 1=new moon
uniform mat4 u_inv_proj_matrix;

// Reserved for future screen-space positioning
uniform float u_sun_azimuth;
uniform float u_sun_elevation;
uniform float u_camera_bearing;
uniform float u_camera_pitch;
uniform float u_fov;
in vec3 v_ray;

void main() {
    float x = gl_FragCoord.x;
    float y = gl_FragCoord.y;
    float blend = (y - u_horizon.y) * u_horizon_normal.y + (x - u_horizon.x) * u_horizon_normal.x;
    
    // Base sky color with horizon gradient
    vec3 baseColor = u_sky_color.rgb;
    
    if (blend > 0.0) {
        if (blend < u_sky_horizon_blend) {
            baseColor = mix(u_sky_color.rgb, u_horizon_color.rgb, pow(1.0 - blend / u_sky_horizon_blend, 2.0));
        }
    } else {
        float belowBlend = min(1.0, abs(blend) / max(u_sky_horizon_blend, 1.0));
        baseColor = mix(u_horizon_color.rgb, u_sky_color.rgb, belowBlend);
    }
    
    // View direction from vertex shader
    vec3 view_dir = normalize(v_ray);
    
    // ========== SUN RENDERING (Optimized) ==========
    vec3 sun_dir = normalize(u_sun_pos);
    float mu = dot(view_dir, sun_dir);
    
    vec3 sun_total = vec3(0.0);
    if (mu > 0.0) { // Early exit: only calc sun if in front of camera
        vec3 ddx = dFdx(view_dir);
        vec3 ddy = dFdy(view_dir);
        float fragmentAngle = length(ddx + ddy) / length(view_dir);
        
        float sunAngularRadius = 0.00454;
        float angle = acos(clamp(mu, -1.0, 1.0));
        float sun_disk = smoothstep(sunAngularRadius, sunAngularRadius - fragmentAngle * 2.0, angle);
        
        float sun_glare = pow(max(0.0, mu), 1024.0) * 0.3;
        sun_glare += pow(max(0.0, mu), 128.0) * 0.05;
        
        vec3 sunTint = mix(
            vec3(1.0, 0.4, 0.1),
            vec3(1.0, 0.98, 0.95),
            smoothstep(-0.05, 0.35, u_sun_altitude)
        );
        
        sun_total = sunTint * (80.0 * sun_disk + 1.5 * sun_glare);
    }
    
    // ========== MOON RENDERING (Optimized Early Exit) ==========
    vec3 moon_total = vec3(0.0);
    vec3 moon_dir = normalize(u_moon_pos);
    float mu_moon = dot(view_dir, moon_dir);

    if (mu_moon > 0.98) { // Only do complex math near the moon disk (2 degrees)
        vec3 ddx_m = dFdx(view_dir);
        vec3 ddy_m = dFdy(view_dir);
        float fragmentAngle_m = length(ddx_m + ddy_m) / length(view_dir);

        float moonAngularRadius = 0.00454;
        float moonAngle = acos(clamp(mu_moon, -1.0, 1.0));
        float moon_disk_full = smoothstep(moonAngularRadius, moonAngularRadius - fragmentAngle_m * 2.0, moonAngle);
        
        float normalizedDist = moonAngle / moonAngularRadius;
        vec3 toPixel = view_dir - moon_dir * mu_moon;
        float toPixelLen = length(toPixel);
        
        vec3 worldUp = vec3(0.0, 0.0, 1.0);
        vec3 moonRight = normalize(cross(moon_dir, worldUp));
        vec3 moonUp = cross(moonRight, moon_dir);
        
        float px = toPixelLen > 0.0001 ? dot(toPixel / toPixelLen, moonRight) * normalizedDist : 0.0;
        float py = toPixelLen > 0.0001 ? dot(toPixel / toPixelLen, moonUp) * normalizedDist : 0.0;
        
        float phaseAngle = u_moon_phase * 6.28318;
        float terminatorPos = -cos(phaseAngle);
        float edgeFactor = sqrt(max(0.0, 1.0 - py * py));
        float adjustedTerminator = terminatorPos * edgeFactor;
        
        float phaseMask = smoothstep(adjustedTerminator - 0.08, adjustedTerminator + 0.08, px);
        if (u_moon_phase > 0.5) phaseMask = 1.0 - phaseMask;
        
        float moon_disk = moon_disk_full * phaseMask;
        float moonVisibility = smoothstep(-0.10, -0.30, u_sun_altitude);
        
        float haloRadius = moonAngularRadius * 2.0;
        float haloIntensity = smoothstep(haloRadius, moonAngularRadius, moonAngle) * 0.08;
        vec3 haloColor = vec3(0.5, 0.55, 0.7) * haloIntensity * moonVisibility;
        
        vec3 moonBaseColor = vec3(0.80, 0.78, 0.74);
        moon_total = moonBaseColor * 10.0 * moon_disk * moonVisibility;
        
        float darkSide = moon_disk_full * (1.0 - phaseMask);
        vec3 earthshineColor = vec3(0.08, 0.10, 0.15) * darkSide * moonVisibility;
        moon_total += earthshineColor + haloColor;
    }
    
    // Horizon mask
    float body_visible = smoothstep(-0.005, 0.005, blend / max(u_sky_horizon_blend, 10.0));
    
    vec3 finalColor = baseColor + (sun_total * u_sun_intensity + moon_total) * body_visible;
    fragColor = vec4(finalColor, u_sky_color.a);
    fragColor = mix(fragColor, vec4(vec3(0.0), 0.0), u_sky_blend);
}
