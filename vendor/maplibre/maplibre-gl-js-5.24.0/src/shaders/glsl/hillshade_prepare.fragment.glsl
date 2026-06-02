#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D u_image;
in vec2 v_pos;

uniform vec2 u_dimension;
uniform float u_zoom;
uniform vec4 u_unpack;
uniform float u_metersPerPixel;

float getElevation(vec2 coord, float bias) {
    vec4 data = texture(u_image, coord) * 255.0;
    data.a = -1.0;
    return dot(data, u_unpack);
}

void main() {
    vec2 epsilon = 1.0 / u_dimension;
    float tileSize = u_dimension.x - 2.0;

    // Sample 3x3 neighborhood
    float a = getElevation(v_pos + vec2(-epsilon.x, -epsilon.y), 0.0);
    float b = getElevation(v_pos + vec2(0, -epsilon.y), 0.0);
    float c = getElevation(v_pos + vec2(epsilon.x, -epsilon.y), 0.0);
    float d = getElevation(v_pos + vec2(-epsilon.x, 0), 0.0);
    float e = getElevation(v_pos, 0.0);
    float f = getElevation(v_pos + vec2(epsilon.x, 0), 0.0);
    float g = getElevation(v_pos + vec2(-epsilon.x, epsilon.y), 0.0);
    float h = getElevation(v_pos + vec2(0, epsilon.y), 0.0);
    float i = getElevation(v_pos + vec2(epsilon.x, epsilon.y), 0.0);

    // Compute derivatives using metersPerPixel for accurate slope computation
    vec2 deriv = vec2(
        (c + f + f + i) - (a + d + d + g),
        (g + h + h + i) - (a + b + b + c)
    ) / (8.0 * max(u_metersPerPixel, 0.0001));

    // Encoding: deriv / 8.0 + 0.5
    // Range [-4..4] mapped to [0..1], clipping slopes > ~76°
    float encodedX = deriv.x / 8.0 + 0.5;
    float encodedY = deriv.y / 8.0 + 0.5;

    // Store elevation in blue channel for snow layer
    // Range: -500m to 9500m -> 0.0 to 1.0
    float normalizedElevation = clamp((e + 500.0) / 10000.0, 0.0, 1.0);

    fragColor = clamp(vec4(
        encodedX,
        encodedY,
        normalizedElevation,
        1.0), 0.0, 1.0);

#ifdef OVERDRAW_INSPECTOR
    fragColor = vec4(1.0);
#endif
}
