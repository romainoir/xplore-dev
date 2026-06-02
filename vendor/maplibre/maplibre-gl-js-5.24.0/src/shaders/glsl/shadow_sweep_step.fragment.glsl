uniform sampler2D u_state;
uniform vec2 u_sunDirection;
uniform float u_sunAltitude;
uniform vec2 u_metersPerPixel;
uniform vec2 u_dimension;
uniform vec4 u_atlas_bounds;
uniform float u_jump_pixels;

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

float unpackHeight(vec4 packed) {
    return unpack(packed) * 20000.0 - 10000.0;
}

vec2 sunPixelDirection() {
    vec2 atlasSpan = max(u_atlas_bounds.zw - u_atlas_bounds.xy, vec2(1.0e-9));
    vec2 uvPerMeter = vec2(u_sunDirection.x / atlasSpan.x, -u_sunDirection.y / atlasSpan.y);
    vec2 pixelDir = uvPerMeter * u_dimension;
    float len = length(pixelDir);
    return len > 0.00001 ? pixelDir / len : vec2(1.0, 0.0);
}

void main() {
    float currentScore = unpackHeight(texture(u_state, v_pos));
    vec2 pixelDir = sunPixelDirection();
    vec2 jumpPixels = pixelDir * u_jump_pixels;
    vec2 upstreamUV = v_pos + jumpPixels / u_dimension;

    if (upstreamUV.x >= 0.0 && upstreamUV.x <= 1.0 && upstreamUV.y >= 0.0 && upstreamUV.y <= 1.0) {
        float upstreamScore = unpackHeight(texture(u_state, upstreamUV));
        float jumpMeters = length(jumpPixels * u_metersPerPixel);
        float candidate = upstreamScore - jumpMeters * max(tan(u_sunAltitude), 0.001);
        currentScore = max(currentScore, candidate);
    }

    fragColor = pack(clamp((currentScore + 10000.0) / 20000.0, 0.0, 1.0));
}
