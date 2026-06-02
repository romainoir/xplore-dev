uniform sampler2D u_state;
uniform sampler2D u_elevation;
uniform vec2 u_dimension;
uniform vec2 u_metersPerPixel;

in vec2 v_pos;

const highp vec4 bitUn = vec4(1./(256.*256.*256.), 1./(256.*256.), 1./256., 1.);
const float EMPTY_ELEVATION = -9900.0;

highp float unpack(highp vec4 color) {
    return dot(color, bitUn);
}

float unpackHeight(vec4 packed) {
    return unpack(packed) * 20000.0 - 10000.0;
}

float sampleElevationBilinear(vec2 uv) {
    vec2 pos = uv * u_dimension;
    vec2 posCenter = pos - 0.5;
    vec2 f = fract(posCenter);
    vec2 i = floor(posCenter) + 0.5;

    vec4 t00 = texture(u_elevation, (i + vec2(0.0, 0.0)) / u_dimension);
    vec4 t10 = texture(u_elevation, (i + vec2(1.0, 0.0)) / u_dimension);
    vec4 t01 = texture(u_elevation, (i + vec2(0.0, 1.0)) / u_dimension);
    vec4 t11 = texture(u_elevation, (i + vec2(1.0, 1.0)) / u_dimension);

    float h00 = unpackHeight(t00);
    float h10 = unpackHeight(t10);
    float h01 = unpackHeight(t01);
    float h11 = unpackHeight(t11);

    return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

void main() {
    float receiverElevation = sampleElevationBilinear(v_pos);
    if (receiverElevation < EMPTY_ELEVATION) {
        fragColor = vec4(0.0);
        return;
    }

    float bestProjectedHeight = unpackHeight(texture(u_state, v_pos));
    float gsd = max(u_metersPerPixel.x, u_metersPerPixel.y);
    float bias = max(1.2, gsd * 0.030);
    float edgeMeters = max(2.0, gsd * 0.18);
    float shadow = smoothstep(bias, bias + edgeMeters, bestProjectedHeight - receiverElevation);

    fragColor = vec4(vec3(shadow), 1.0);
}
