uniform sampler2D u_image;
uniform vec2 u_src_dimension;

in vec2 v_pos;

const highp vec4 bitUn = vec4(1./(256.*256.*256.), 1./(256.*256.), 1./256., 1.);
const highp vec4 bitSh = vec4(256. * 256. * 256., 256. * 256., 256., 1.);
const highp vec4 bitMsk = vec4(0., vec3(1./256.0));

highp float unpack(highp vec4 color) {
    return dot(color, bitUn);
}

highp vec4 pack(highp float value) {
    highp vec4 comp = fract(value * bitSh);
    comp -= comp.xxyz * bitMsk;
    return comp;
}

void main() {
    vec2 srcTexel = 1.0 / max(u_src_dimension, vec2(1.0));
    vec2 srcBase = floor(v_pos * u_src_dimension * 0.5) * 2.0 + 0.5;
    vec2 uv00 = srcBase / u_src_dimension;
    vec2 uv10 = uv00 + vec2(srcTexel.x, 0.0);
    vec2 uv01 = uv00 + vec2(0.0, srcTexel.y);
    vec2 uv11 = uv00 + srcTexel;

    float h = unpack(texture(u_image, uv00));
    h = max(h, unpack(texture(u_image, uv10)));
    h = max(h, unpack(texture(u_image, uv01)));
    h = max(h, unpack(texture(u_image, uv11)));

    fragColor = pack(h);
}
