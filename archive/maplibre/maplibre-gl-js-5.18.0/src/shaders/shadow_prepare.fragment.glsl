// H4 Horizon Map Builder - Offscreen Pass

uniform sampler2D u_image;
uniform sampler2D u_dem_north;
uniform sampler2D u_dem_west;
uniform sampler2D u_dem_corner;

in vec2 v_pos;

uniform vec2 u_dimension;
uniform vec4 u_unpack;
uniform float u_metersPerPixel;

// Base azimuth for the 4 channels (in radians)
uniform float u_base_azimuth;
// Azimuth step per channel (e.g., 2PI / 32)
uniform float u_azimuth_step;

uniform float u_has_north;
uniform float u_has_west;
uniform float u_has_corner;

uniform vec4 u_zoom_north;
uniform vec4 u_zoom_west;
uniform vec4 u_zoom_corner;

#define MAX_STEPS 128
#define PI 3.141592653589793

// Decode elevation from RGBA DEM data
float decodeElevation(vec4 data) {
    return dot(floor(data * 255.0 + 0.5).rgb, u_unpack.rgb) - u_unpack.a;
}

// Bilinear elevation sample from a DEM texture using geometric [0, 1] coordinates
float sampleElevation(sampler2D dem, vec2 uv) {
    vec2 dim = u_dimension;
    vec2 pos = uv * dim - 0.5;
    vec2 f = fract(pos);
    vec2 i = floor(pos) + 0.5;

    float h00 = decodeElevation(texture(dem, (i + vec2(0.0, 0.0)) / dim));
    float h10 = decodeElevation(texture(dem, (i + vec2(1.0, 0.0)) / dim));
    float h01 = decodeElevation(texture(dem, (i + vec2(0.0, 1.0)) / dim));
    float h11 = decodeElevation(texture(dem, (i + vec2(1.0, 1.0)) / dim));

    return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

// Sample global elevation (with cross-tile neighbor support)
float sampleGlobalElevation(vec2 uv) {
    if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
        return sampleElevation(u_image, uv);
    }

    bool xOut = uv.x < 0.0 || uv.x > 1.0;
    bool yOut = uv.y < 0.0 || uv.y > 1.0;

    if (xOut && yOut && u_has_corner > 0.5) {
        vec2 neighborUV = vec2(uv.x < 0.0 ? uv.x + 1.0 : uv.x - 1.0, uv.y < 0.0 ? uv.y + 1.0 : uv.y - 1.0);
        vec2 scaledUV = u_zoom_corner.yz + (neighborUV * u_zoom_corner.x);
        if (scaledUV.x >= 0.0 && scaledUV.x <= 1.0 && scaledUV.y >= 0.0 && scaledUV.y <= 1.0) {
            return sampleElevation(u_dem_corner, scaledUV);
        }
    }
    if (xOut && !yOut && u_has_west > 0.5) {
        vec2 neighborUV = vec2(uv.x < 0.0 ? uv.x + 1.0 : uv.x - 1.0, uv.y);
        vec2 scaledUV = u_zoom_west.yz + (neighborUV * u_zoom_west.x);
        if (scaledUV.x >= 0.0 && scaledUV.x <= 1.0) {
            return sampleElevation(u_dem_west, scaledUV);
        }
    }
    if (yOut && !xOut && u_has_north > 0.5) {
        vec2 neighborUV = vec2(uv.x, uv.y < 0.0 ? uv.y + 1.0 : uv.y - 1.0);
        vec2 scaledUV = u_zoom_north.yz + (neighborUV * u_zoom_north.x);
        if (scaledUV.y >= 0.0 && scaledUV.y <= 1.0) {
            return sampleElevation(u_dem_north, scaledUV);
        }
    }

    // If we've reached here, the ray is out of bounds and we don't have the required neighbor tile.
    // Return a special flag (-9999.0) so the raymarching loop knows to terminate this ray.
    return -9999.0;
}

vec2 getDirection(float azimuth) {
    // Convert geographic azimuth to UV-space direction
    // Geographic: 0 = North, 90 = East
    // UV space: x = East, y = South
    return normalize(vec2(sin(azimuth), -cos(azimuth)));
}

void main() {
    float startElevation = sampleElevation(u_image, v_pos);
    
    // We compute max horizon angle for 4 azimuths simultaneously (RGBA output)
    vec4 maxAngles = vec4(-PI / 2.0); // start with -90 degrees
    
    vec2 dirR = getDirection(u_base_azimuth);
    vec2 dirG = getDirection(u_base_azimuth + u_azimuth_step);
    vec2 dirB = getDirection(u_base_azimuth + 2.0 * u_azimuth_step);
    vec2 dirA = getDirection(u_base_azimuth + 3.0 * u_azimuth_step);

    float geoResolution = u_dimension.x - 2.0;
    vec2 texelR = dirR / geoResolution;
    vec2 texelG = dirG / geoResolution;
    vec2 texelB = dirB / geoResolution;
    vec2 texelA = dirA / geoResolution;

    bool hasNeighbors = (u_has_west > 0.5 || u_has_north > 0.5 || u_has_corner > 0.5);
    float minBound = hasNeighbors ? -1.0 : 0.0;
    float maxBound = hasNeighbors ? 2.0 : 1.0;

    vec2 posR = v_pos;
    vec2 posG = v_pos;
    vec2 posB = v_pos;
    vec2 posA = v_pos;

    bvec4 activeRays = bvec4(true);
    float traveled = 0.0;

    // Start with a fine 2-pixel step so we don't jump over sharp local ridges,
    // and geometrically increase the step size to reach far distances quickly.
    float currentPixelStep = 2.0;
    
    // Daylight-duration needs the local terrain horizon, not just the current tile.
    // The shader can safely sample the current tile plus one sun-facing neighbor/corner,
    // so use most of that footprint while letting out-of-bounds sampling terminate rays.
    float maxDist = (u_dimension.x - 2.0) * u_metersPerPixel * 1.75;

    for (int i = 0; i < 96; i++) {
        float stepDist = u_metersPerPixel * currentPixelStep;
        traveled += stepDist;
        
        if (traveled > maxDist) break;
        
        posR += texelR * currentPixelStep;
        posG += texelG * currentPixelStep;
        posB += texelB * currentPixelStep;
        posA += texelA * currentPixelStep;

        // Check bounds and sample elevation
        if (activeRays.r) {
            float elev = sampleGlobalElevation(posR);
            if (elev == -9999.0) {
                activeRays.r = false;
            } else {
                float angle = atan(elev - startElevation, traveled);
                maxAngles.r = max(maxAngles.r, angle);
            }
        }
        if (activeRays.g) {
            float elev = sampleGlobalElevation(posG);
            if (elev == -9999.0) {
                activeRays.g = false;
            } else {
                float angle = atan(elev - startElevation, traveled);
                maxAngles.g = max(maxAngles.g, angle);
            }
        }
        if (activeRays.b) {
            float elev = sampleGlobalElevation(posB);
            if (elev == -9999.0) {
                activeRays.b = false;
            } else {
                float angle = atan(elev - startElevation, traveled);
                maxAngles.b = max(maxAngles.b, angle);
            }
        }
        if (activeRays.a) {
            float elev = sampleGlobalElevation(posA);
            if (elev == -9999.0) {
                activeRays.a = false;
            } else {
                float angle = atan(elev - startElevation, traveled);
                maxAngles.a = max(maxAngles.a, angle);
            }
        }
        
        if (!any(activeRays)) break;
        
        // Geometrically increase step size by 3% each iteration.
        // This allows us to cover ~1100 pixels (4+ tiles) in 96 steps.
        currentPixelStep *= 1.03;
    }

    // Remap angles from [-PI/2, PI/2] to [0.0, 1.0] for storage in 8-bit texture
    // Angle + PI/2 gives [0, PI]. Divide by PI gives [0, 1].
    fragColor = (maxAngles + (PI / 2.0)) / PI;
}
