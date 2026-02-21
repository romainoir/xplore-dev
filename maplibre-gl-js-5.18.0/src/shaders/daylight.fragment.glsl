// Daylight / Sun Duration fragment shader
// Computes accumulated daily sunlight by checking the precomputed 32-azimuth Horizon Atlas

uniform sampler2D u_horizon;

uniform float u_opacity;
uniform vec3 u_tile_id;
uniform float u_time_weight; // e.g. 10.0 minutes per step
uniform sampler2D u_color_ramp;

// 32 daily sun positions (Azimuth in X, Altitude in Y)
// Passed as 8 vec4s to avoid uniform array limits and texture binding overhead
uniform vec4 u_solar_lut_0;
uniform vec4 u_solar_lut_1;
uniform vec4 u_solar_lut_2;
uniform vec4 u_solar_lut_3;
uniform vec4 u_solar_lut_4;
uniform vec4 u_solar_lut_5;
uniform vec4 u_solar_lut_6;
uniform vec4 u_solar_lut_7;

in vec2 v_pos;

#ifndef HAS_UNIFORM_u_color_ramp
#define HAS_UNIFORM_u_color_ramp
#endif

#define PI 3.141592653589793

// Fetch and interpolate the horizon angle from the 32-slice H4 Horizon atlas
float getHorizonAngle(vec2 uv, float sunAzimuth) {
    float azIndexF = (sunAzimuth / (2.0 * PI)) * 32.0;

    float azIndex0 = floor(azIndexF);
    float azIndex1 = azIndex0 + 1.0;
    float blend = fract(azIndexF);

    int idx0 = int(mod(azIndex0, 32.0));
    int idx1 = int(mod(azIndex1, 32.0));

    int row0 = idx0 / 4;
    int ch0 = idx0 - (row0 * 4); // idx0 % 4
    
    vec2 atlasUV0 = vec2(uv.x, (uv.y + float(row0)) / 8.0);
    vec4 encoded0 = texture(u_horizon, atlasUV0);
    float packed0 = ch0 == 0 ? encoded0.r : (ch0 == 1 ? encoded0.g : (ch0 == 2 ? encoded0.b : encoded0.a));
    float angle0 = (packed0 * PI) - (PI / 2.0);

    int row1 = idx1 / 4;
    int ch1 = idx1 - (row1 * 4); // idx1 % 4
    vec2 atlasUV1 = vec2(uv.x, (uv.y + float(row1)) / 8.0);
    vec4 encoded1 = texture(u_horizon, atlasUV1);
    float packed1 = ch1 == 0 ? encoded1.r : (ch1 == 1 ? encoded1.g : (ch1 == 2 ? encoded1.b : encoded1.a));
    float angle1 = (packed1 * PI) - (PI / 2.0);

    return mix(angle0, angle1, blend);
}

// Function to check one sun position and add its time weight if visible
float testTimeStep(vec2 sunPos, vec2 uv) {
    float sunAzimuth = sunPos.x;
    float sunAltitude = sunPos.y;
    
    // If sun is below mathematical horizon, it's definitely night
    if (sunAltitude <= 0.0) return 0.0;
    
    float horizonAngle = getHorizonAngle(uv, sunAzimuth);
    
    // If sun is above the local terrain horizon, add the time weight
    if (sunAltitude > horizonAngle) {
        return u_time_weight;
    }
    
    return 0.0;
}

void main() {
    float totalMinutes = 0.0;
    
    // Unroll the loop manually since GLSL ES 3.0 requires constant indices for arrays and matrices
    vec2 p0 = vec2(u_solar_lut_0.x, u_solar_lut_0.y); totalMinutes += testTimeStep(p0, v_pos);
    vec2 p1 = vec2(u_solar_lut_0.z, u_solar_lut_0.w); totalMinutes += testTimeStep(p1, v_pos);
    vec2 p2 = vec2(u_solar_lut_1.x, u_solar_lut_1.y); totalMinutes += testTimeStep(p2, v_pos);
    vec2 p3 = vec2(u_solar_lut_1.z, u_solar_lut_1.w); totalMinutes += testTimeStep(p3, v_pos);
    vec2 p4 = vec2(u_solar_lut_2.x, u_solar_lut_2.y); totalMinutes += testTimeStep(p4, v_pos);
    vec2 p5 = vec2(u_solar_lut_2.z, u_solar_lut_2.w); totalMinutes += testTimeStep(p5, v_pos);
    vec2 p6 = vec2(u_solar_lut_3.x, u_solar_lut_3.y); totalMinutes += testTimeStep(p6, v_pos);
    vec2 p7 = vec2(u_solar_lut_3.z, u_solar_lut_3.w); totalMinutes += testTimeStep(p7, v_pos);
    vec2 p8 = vec2(u_solar_lut_4.x, u_solar_lut_4.y); totalMinutes += testTimeStep(p8, v_pos);
    vec2 p9 = vec2(u_solar_lut_4.z, u_solar_lut_4.w); totalMinutes += testTimeStep(p9, v_pos);
    vec2 p10 = vec2(u_solar_lut_5.x, u_solar_lut_5.y); totalMinutes += testTimeStep(p10, v_pos);
    vec2 p11 = vec2(u_solar_lut_5.z, u_solar_lut_5.w); totalMinutes += testTimeStep(p11, v_pos);
    vec2 p12 = vec2(u_solar_lut_6.x, u_solar_lut_6.y); totalMinutes += testTimeStep(p12, v_pos);
    vec2 p13 = vec2(u_solar_lut_6.z, u_solar_lut_6.w); totalMinutes += testTimeStep(p13, v_pos);
    vec2 p14 = vec2(u_solar_lut_7.x, u_solar_lut_7.y); totalMinutes += testTimeStep(p14, v_pos);
    vec2 p15 = vec2(u_solar_lut_7.z, u_solar_lut_7.w); totalMinutes += testTimeStep(p15, v_pos);
    
    // Total hours of sunlight
    float totalHours = totalMinutes / 60.0;
    
    // Map total hours to [0.0, 1.0] for the color ramp lookup
    // Assuming max sunlight is ~12 hours for a better visual spread
    float rampPos = clamp(totalHours / 12.0, 0.0, 1.0);
    
    // Lookup color
    vec4 color = texture(u_color_ramp, vec2(rampPos, 0.5));
    
    // Apply user opacity
    color.a *= u_opacity;
    
    fragColor = color;
}
