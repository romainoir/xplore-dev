uniform sampler2D u_image;
uniform sampler2D u_image_raw;
in vec2 v_pos;

uniform vec2 u_latrange;
uniform float u_exaggeration;
uniform vec4 u_accent;
uniform int u_method;
uniform float u_altitudes[NUM_ILLUMINATION_SOURCES];
uniform float u_azimuths[NUM_ILLUMINATION_SOURCES];
uniform vec4 u_shadows[NUM_ILLUMINATION_SOURCES];
uniform vec4 u_highlights[NUM_ILLUMINATION_SOURCES];
uniform float u_metersPerPixel;
uniform float u_snow_altitude;
uniform float u_snow_maxSlope;
uniform float u_slope_min;
uniform float u_slope_max;
uniform float u_bearing;
uniform vec4 u_unpack;
uniform vec2 u_dimension;
uniform vec4 u_skyHighlight;
uniform vec4 u_skyShadow;

#define PI 3.141592653589793

#define STANDARD 0
#define COMBINED 1
#define IGOR 2
#define MULTIDIRECTIONAL 3
#define BASIC 4
#define ASPECT 6
#define SLOPE 7
#define AVALANCHE 8
#define SNOW 9

float get_aspect(vec2 deriv)
{
    return deriv.x != 0.0 ? atan(deriv.y, -deriv.x) : PI / 2.0 * (deriv.y > 0.0 ? 1.0 : -1.0);
}

// Based on GDALHillshadeIgorAlg() (https://github.com/OSGeo/gdal/blob/ad4280be5aee202eea412c075e4591878aaeb018/apps/gdaldem_lib.cpp#L849).
// GDAL's version only calculates shading.
// This version also adds highlighting. To match GDAL's output, make hillshade-highlight-color transparent.
void igor_hillshade(vec2 deriv)
{
    deriv = deriv * u_exaggeration * 2.0;
    float aspect = get_aspect(deriv);
    float azimuth = u_azimuths[0] + PI;
    float slope_stength = atan(length(deriv)) * 2.0/PI;
    float aspect_strength = 1.0 - abs(mod((aspect + azimuth) / PI + 0.5, 2.0) - 1.0);
    float shadow_strength = slope_stength * aspect_strength;
    float highlight_strength = slope_stength * (1.0-aspect_strength);
    fragColor = u_shadows[0] * shadow_strength + u_highlights[0] * highlight_strength;
}

// MapLibre's legacy hillshade algorithm
void standard_hillshade(vec2 deriv)
{
    // We add PI to make this property match the global light object, which adds PI/2 to the light's azimuthal
    // position property to account for 0deg corresponding to north/the top of the viewport in the style spec
    // and the original shader was written to accept (-illuminationDirection - 90) as the azimuthal.
    float azimuth = u_azimuths[0] + PI;

    // We also multiply the slope by an arbitrary z-factor of 0.625
    float slope = atan(0.625 * length(deriv));
    float aspect = get_aspect(deriv);

    float intensity = u_exaggeration;

    // We scale the slope exponentially based on intensity, using a calculation similar to
    // the exponential interpolation function in the style spec:
    // src/style-spec/expression/definitions/interpolate.js#L217-L228
    // so that higher intensity values create more opaque hillshading.
    float base = 1.875 - intensity * 1.75;
    float maxValue = 0.5 * PI;
    float scaledSlope = intensity != 0.5 ? ((pow(base, slope) - 1.0) / (pow(base, maxValue) - 1.0)) * maxValue : slope;

    // The accent color is calculated with the cosine of the slope while the shade color is calculated with the sine
    // so that the accent color's rate of change eases in while the shade color's eases out.
    float accent = cos(scaledSlope);
    // We multiply both the accent and shade color by a clamped intensity value
    // so that intensities >= 0.5 do not additionally affect the color values
    // while intensity values < 0.5 make the overall color more transparent.
    vec4 accent_color = (1.0 - accent) * u_accent * clamp(intensity * 2.0, 0.0, 1.0);
    float shade = abs(mod((aspect + azimuth) / PI + 0.5, 2.0) - 1.0);
    vec4 shade_color = mix(u_shadows[0], u_highlights[0], shade) * sin(scaledSlope) * clamp(intensity * 2.0, 0.0, 1.0);
    fragColor = accent_color * (1.0 - shade_color.a) + shade_color;
}

// Based on GDALHillshadeAlg(). (https://github.com/OSGeo/gdal/blob/ad4280be5aee202eea412c075e4591878aaeb018/apps/gdaldem_lib.cpp#L908)
// GDAL's output ranges from black to white, and is gray in the middle.
// The output of this function ranges from hillshade-shadow-color to hillshade-highlight-color, and
// is transparent in the middle. To match GDAL's output, make hillshade-highlight-color white,
// hillshade-shadow color black, and the background color gray.
void basic_hillshade(vec2 deriv)
{
    deriv = deriv * u_exaggeration * 2.0;
    float azimuth = u_azimuths[0] + PI;
    float cos_az = cos(azimuth);
    float sin_az = sin(azimuth);
    float cos_alt = cos(u_altitudes[0]);
    float sin_alt = sin(u_altitudes[0]);

    float cang = (sin_alt - (deriv.y*cos_az*cos_alt - deriv.x*sin_az*cos_alt)) / sqrt(1.0 + dot(deriv, deriv));

    float shade = clamp(cang, 0.0, 1.0);
    if(shade > 0.5)
    {
        fragColor = u_highlights[0]*(2.0*shade - 1.0);
    }
    else
    {
        fragColor = u_shadows[0]*(1.0 - 2.0*shade);
    }
}

// This functioon applies the basic_hillshade algorithm across multiple independent light sources.
// The final color is the average of the contribution from each light source.
void multidirectional_hillshade(vec2 deriv)
{
    deriv = deriv * u_exaggeration * 2.0;
    fragColor = vec4(0,0,0,0);

    for(int i = 0; i < NUM_ILLUMINATION_SOURCES; i++)
    {
        float cos_alt = cos(u_altitudes[i]);
        float sin_alt = sin(u_altitudes[i]);
        float cos_az = -cos(u_azimuths[i]);
        float sin_az = -sin(u_azimuths[i]);

        float cang = (sin_alt - (deriv.y*cos_az*cos_alt - deriv.x*sin_az*cos_alt)) / sqrt(1.0 + dot(deriv, deriv));

        float shade = clamp(cang, 0.0, 1.0);

        if(shade > 0.5)
        {
            fragColor += u_highlights[i]*(2.0*shade - 1.0)/float(NUM_ILLUMINATION_SOURCES);
        }
        else
        {
            fragColor += u_shadows[i]*(1.0 - 2.0*shade)/float(NUM_ILLUMINATION_SOURCES);
        }
    }
}

// Based on GDALHillshadeCombinedAlg(). (https://github.com/OSGeo/gdal/blob/ad4280be5aee202eea412c075e4591878aaeb018/apps/gdaldem_lib.cpp#L1084)
// GDAL's version only calculates shading.
// This version also adds highlighting. To match GDAL's output, make hillshade-highlight-color transparent.
void combined_hillshade(vec2 deriv)
{
    deriv = deriv * u_exaggeration * 2.0;
    float azimuth = u_azimuths[0] + PI;
    float cos_az = cos(azimuth);
    float sin_az = sin(azimuth);
    float cos_alt = cos(u_altitudes[0]);
    float sin_alt = sin(u_altitudes[0]);

    float cang = acos((sin_alt - (deriv.y*cos_az*cos_alt - deriv.x*sin_az*cos_alt)) / sqrt(1.0 + dot(deriv, deriv)));

    cang = clamp(cang, 0.0, PI/2.0);

    float shade = cang* atan(length(deriv)) * 4.0/PI/PI;
    float highlight = (PI/2.0-cang)* atan(length(deriv)) * 4.0/PI/PI;

    fragColor = u_shadows[0]*shade + u_highlights[0]*highlight;
}

// Helper: Convert derivatives to slope in degrees
float getSlopeInDegrees(vec2 deriv) {
    return degrees(atan(length(deriv)));
}

// Aspect (slope direction)
void aspect_hillshade(vec2 deriv)
{
    deriv = -deriv * u_exaggeration;
    float aspect = mod(degrees(atan(deriv.x, deriv.y)) + 180.0, 360.0);
    
    vec3 color;
    if (aspect >= 337.5 || aspect < 22.5)       color = vec3(0.47, 1.0, 1.0);    // N - cyan
    else if (aspect < 67.5)                      color = vec3(0.48, 0.76, 1.0);   // NE - light blue
    else if (aspect < 112.5)                     color = vec3(1.0, 1.0, 1.0);     // E - white
    else if (aspect < 157.5)                     color = vec3(1.0, 0.7, 0.52);    // SE - peach
    else if (aspect < 202.5)                     color = vec3(1.0, 0.3, 0.0);     // S - orange
    else if (aspect < 247.5)                     color = vec3(0.48, 0.14, 0.0);   // SW - brown
    else if (aspect < 292.5)                     color = vec3(0.16, 0.16, 0.16);  // W - dark gray
    else                                          color = vec3(0.0, 0.21, 0.47);   // NW - dark blue
    
    fragColor = vec4(color, 0.9);
}

// Slope steepness
void slope_hillshade(vec2 deriv)
{
    deriv = deriv * u_exaggeration;
    float slope = min(getSlopeInDegrees(deriv), 90.0);
    
    vec3 colors[9];
    colors[0] = vec3(0.2, 0.8, 0.2);
    colors[1] = vec3(0.4, 0.9, 0.36);
    colors[2] = vec3(0.87, 0.87, 0.0);
    colors[3] = vec3(1.0, 0.7, 0.0);
    colors[4] = vec3(1.0, 0.28, 0.2);
    colors[5] = vec3(0.87, 0.0, 0.43);
    colors[6] = vec3(0.6, 0.0, 0.58);
    colors[7] = vec3(0.41, 0.0, 0.58);
    colors[8] = vec3(0.3, 0.0, 0.53);
    
    float stops[9];
    stops[0] = 5.0; stops[1] = 15.0; stops[2] = 25.0;
    stops[3] = 35.0; stops[4] = 45.0; stops[5] = 55.0;
    stops[6] = 65.0; stops[7] = 75.0; stops[8] = 90.0;
    
    vec3 color = colors[8];
    for (int i = 0; i < 8; i++) {
        if (slope <= stops[i+1]) {
            float t = (slope - stops[i]) / (stops[i+1] - stops[i]);
            color = mix(colors[i], colors[i+1], smoothstep(0.0, 1.0, t));
            break;
        }
    }
    
    // Alpha mask: fade out slopes outside [u_slope_min, u_slope_max] range
    float alpha = 0.7;
    if (u_slope_min > 0.0 || u_slope_max < 90.0) {
        float fadeIn = smoothstep(u_slope_min - 2.0, u_slope_min + 2.0, slope);
        float fadeOut = 1.0 - smoothstep(u_slope_max - 2.0, u_slope_max + 2.0, slope);
        alpha *= fadeIn * fadeOut;
    }
    
    fragColor = vec4(color, alpha);
}

// Avalanche zones
void avalanche_hillshade(vec2 deriv)
{
    deriv = deriv * u_exaggeration;
    float slope = getSlopeInDegrees(deriv);
    
    float alpha = smoothstep(30.0, 35.0, slope);
    
    vec3 color;
    if (slope < 30.0) {
        color = vec3(0.0);
        alpha = 0.0;
    } else if (slope < 35.0) {
        color = vec3(226.0, 190.0, 27.0) / 255.0;
    } else if (slope < 40.0) {
        color = vec3(216.0, 114.0, 27.0) / 255.0;
    } else if (slope < 45.0) {
        color = vec3(226.0, 27.0, 27.0) / 255.0;
    } else {
        color = vec3(184.0, 130.0, 173.0) / 255.0;
    }
    
    fragColor = vec4(color, alpha);
}

// High-precision elevation from raw DEM texture
float getRawElevation(vec2 uv) {
    vec2 dim = u_dimension;
    vec2 pos = uv * dim - 0.5;
    vec2 f = fract(pos);
    vec2 i = floor(pos) + 0.5;
    
    // Decode 4 samples and bilinearly interpolate
    vec4 d00 = texture(u_image_raw, (i + vec2(0, 0)) / dim);
    vec4 d10 = texture(u_image_raw, (i + vec2(1, 0)) / dim);
    vec4 d01 = texture(u_image_raw, (i + vec2(0, 1)) / dim);
    vec4 d11 = texture(u_image_raw, (i + vec2(1, 1)) / dim);
    
    float h00 = dot(floor(d00 * 255.0 + 0.5).rgb, u_unpack.rgb) - u_unpack.a;
    float h10 = dot(floor(d10 * 255.0 + 0.5).rgb, u_unpack.rgb) - u_unpack.a;
    float h01 = dot(floor(d01 * 255.0 + 0.5).rgb, u_unpack.rgb) - u_unpack.a;
    float h11 = dot(floor(d11 * 255.0 + 0.5).rgb, u_unpack.rgb) - u_unpack.a;
    
    return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

// Snow layer
void snow_hillshade(vec2 deriv, float elevation)
{
    float slopeValue = getSlopeInDegrees(deriv);
    float aspect = mod(degrees(atan(-deriv.x, -deriv.y)) + 180.0, 360.0);
    
    // Aspect Bias
    float northness = cos(radians(aspect + 180.0));
    float aspectBias = northness * 3.0;
    float slopeThreshold = clamp(u_snow_maxSlope + aspectBias, 0.0, 90.0);
    
    // Altitude Mask
    float altitudeMask = smoothstep(
        u_snow_altitude + 100.0,
        u_snow_altitude + 200.0,
        elevation
    );
    
    // Slope Mask
    float slopeBlur = 5.0;
    float slopeMask = 1.0 - smoothstep(slopeThreshold - slopeBlur, slopeThreshold + slopeBlur, slopeValue);
    
    // Combine
    float cosAspect = cos(radians(aspect));
    float aspectAlpha = mix(0.8, 1.0, 0.5 * (1.0 + cosAspect));

    float finalMask = clamp(altitudeMask * slopeMask * aspectAlpha, 0.0, 1.0);
    
    vec3 color = vec3(0.0);
    float alpha = 0.0;
    
    if (finalMask > 0.01) {
        vec3 normal = normalize(vec3(-deriv.x, -deriv.y, 1.0));
        vec3 lightDir = normalize(vec3(0.45, 0.35, 0.82));
        float diffuse = clamp(dot(normal, lightDir), -1.0, 1.0);
        float lambert = clamp(0.5 + 0.5 * diffuse, 0.0, 1.0);
        float contrast = pow(lambert, 0.7);
        float shadowBoost = pow(1.0 - lambert, 2.0);
        
        vec3 shadowColor = vec3(0.6, 0.67, 0.78);
        vec3 highlightColor = vec3(0.94);
        color = mix(shadowColor, highlightColor, contrast);
        color *= (1.0 - 0.18 * shadowBoost);
        
        float specular = pow(max(diffuse, 0.0), 8.0) * 0.06;
        color += vec3(specular);
        
        float ao = smoothstep(0.0, 0.6, lambert);
        color *= mix(0.82, 1.0, ao);
        
        alpha = finalMask * clamp(u_exaggeration, 0.0, 1.0);
        color *= alpha;
    }
    
    fragColor = vec4(color, alpha);
}

void main() {
    vec4 pixel = texture(u_image, v_pos);

    // Decode derivatives (no latitude scaleFactor — metersPerPixel handles this)
    vec2 deriv = (pixel.rg * 8.0) - 4.0;

    if (u_method == BASIC) {
        basic_hillshade(deriv);
    } else if (u_method == COMBINED) {
        combined_hillshade(deriv);
    } else if (u_method == IGOR) {
        igor_hillshade(deriv);
    } else if (u_method == MULTIDIRECTIONAL) {
        multidirectional_hillshade(deriv);
    } else if (u_method == ASPECT) {
        aspect_hillshade(deriv);
    } else if (u_method == SLOPE) {
        slope_hillshade(deriv);
    } else if (u_method == AVALANCHE) {
        avalanche_hillshade(deriv);
    } else if (u_method == SNOW) {
        float elevation = getRawElevation(v_pos);
        snow_hillshade(deriv, elevation);
    } else {
        standard_hillshade(deriv);
    }

#ifdef OVERDRAW_INSPECTOR
    fragColor = vec4(1.0);
#endif
}
