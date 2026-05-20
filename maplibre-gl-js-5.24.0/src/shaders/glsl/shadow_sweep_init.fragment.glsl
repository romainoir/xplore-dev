uniform sampler2D u_image;
uniform vec2 u_dimension;

in vec2 v_pos;

const highp vec4 bitUn = vec4(1./(256.*256.*256.), 1./(256.*256.), 1./256., 1.);
const highp vec4 bitSh = vec4(256. * 256. * 256., 256. * 256., 256., 1.);
const highp vec4 bitMsk = vec4(0., vec3(1./256.0));
const float EMPTY_ELEVATION = -9900.0;

highp float unpack(highp vec4 color) {
    return dot(color, bitUn);
}

highp vec4 pack(highp float value) {
    highp vec4 comp = fract(value * bitSh);
    comp -= comp.xxyz * bitMsk;
    return comp;
}

float sampleElevationBilinear(vec2 uv) {
    vec2 pos = uv * u_dimension;
    vec2 posCenter = pos - 0.5;
    vec2 f = fract(posCenter);
    vec2 i = floor(posCenter) + 0.5;

    vec4 t00 = texture(u_image, (i + vec2(0.0, 0.0)) / u_dimension);
    vec4 t10 = texture(u_image, (i + vec2(1.0, 0.0)) / u_dimension);
    vec4 t01 = texture(u_image, (i + vec2(0.0, 1.0)) / u_dimension);
    vec4 t11 = texture(u_image, (i + vec2(1.0, 1.0)) / u_dimension);

    float h00 = unpack(t00) * 20000.0 - 10000.0;
    float h10 = unpack(t10) * 20000.0 - 10000.0;
    float h01 = unpack(t01) * 20000.0 - 10000.0;
    float h11 = unpack(t11) * 20000.0 - 10000.0;

    return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

void main() {
    float elevation = sampleElevationBilinear(v_pos);
    if (elevation < EMPTY_ELEVATION) {
        elevation = -10000.0;
    }

    fragColor = pack(clamp((elevation + 10000.0) / 20000.0, 0.0, 1.0));
}
