/**
 * Sun Controller Utility
 * 
 * Calculates sun position using SunCalc and updates the map's light source.
 * Inspired by Microsoft Bing Maps atmospheric rendering.
 */

/**
 * Simple hex color interpolation
 */
function interpolateColor(color1, color2, factor) {
    if (factor <= 0) return color1;
    if (factor >= 1) return color2;

    const hex1 = color1.replace('#', '');
    const hex2 = color2.replace('#', '');

    const r1 = parseInt(hex1.substring(0, 2), 16);
    const g1 = parseInt(hex1.substring(2, 4), 16);
    const b1 = parseInt(hex1.substring(4, 6), 16);

    const r2 = parseInt(hex2.substring(0, 2), 16);
    const g2 = parseInt(hex2.substring(2, 4), 16);
    const b2 = parseInt(hex2.substring(4, 6), 16);

    const r = Math.round(r1 + (r2 - r1) * factor);
    const g = Math.round(g1 + (g2 - g1) * factor);
    const b = Math.round(b1 + (b2 - b1) * factor);

    return '#' +
        r.toString(16).padStart(2, '0') +
        g.toString(16).padStart(2, '0') +
        b.toString(16).padStart(2, '0');
}

/**
 * Interpolate between multiple color stops
 */
function multiInterpolate(stops, value) {
    const result = {};
    const keys = Object.keys(stops[0].colors);

    // Find the two stops to interpolate between
    let lower = stops[0];
    let upper = stops[stops.length - 1];

    for (let i = 0; i < stops.length - 1; i++) {
        if (value >= stops[i].alt && value < stops[i + 1].alt) {
            lower = stops[i];
            upper = stops[i + 1];
            break;
        }
    }

    // Handle edge cases
    if (value <= stops[0].alt) {
        return stops[0].colors;
    }
    if (value >= stops[stops.length - 1].alt) {
        return stops[stops.length - 1].colors;
    }

    // Calculate interpolation factor
    const range = upper.alt - lower.alt;
    const t = range > 0 ? (value - lower.alt) / range : 0;

    // Interpolate each color
    keys.forEach(key => {
        result[key] = interpolateColor(lower.colors[key], upper.colors[key], t);
    });

    return result;
}

function publishSolarState(date, lat, lon, sunPos, azimuthDegrees, altitudeDegrees) {
    const azimuthRad = azimuthDegrees * Math.PI / 180;
    window._skySunAzimuthRad = azimuthRad;
    window._skySunAltitudeRad = sunPos.altitude;
    window._actualSunAltitudeRad = sunPos.altitude;
    window._shadowSunDirection = [
        Math.sin(azimuthRad),
        -Math.cos(azimuthRad)
    ];
    window._xploreSolarState = {
        dateMs: date.getTime(),
        lat,
        lng: lon,
        azimuthDeg: azimuthDegrees,
        azimuthRad,
        altitudeDeg: altitudeDegrees,
        altitudeRad: sunPos.altitude
    };
}

/**
 * Update the sun position on the map
 * Color palette inspired by Microsoft Bing Maps
 */
export function updateSunPosition(map, lat, lon, date) {
    if (!map) return;

    try {
        if (typeof SunCalc === 'undefined' || !SunCalc.getPosition) {
            console.warn('[SunController] SunCalc not available');
            return;
        }

        // Store simulation date globally for shader access (moon phase calculation)
        window.skySimulationDate = date.getTime();

        const sunPos = SunCalc.getPosition(date, lat, lon);

        // Convert SunCalc coordinates to MapLibre coordinates
        const azimuthDegrees = (sunPos.azimuth * 180 / Math.PI) + 180;
        const altitudeDegrees = sunPos.altitude * 180 / Math.PI;
        publishSolarState(date, lat, lon, sunPos, azimuthDegrees, altitudeDegrees);

        // Polar angle: 0 = zenith (up), 90 = horizon
        const polarAngle = 90 - altitudeDegrees;

        if (typeof map.setLight === 'function') {
            // Light color: warm at sunrise/sunset, white during day
            const lightColor = altitudeDegrees < 10
                ? interpolateColor('#ffbb77', '#ffffff', Math.max(0, altitudeDegrees / 10))
                : '#ffffff';

            // Light intensity: full during day, reduced at night
            // Daylight: 0.85, Twilight: gradual fade, Night: 0.15 (moonlight/ambient)
            let lightIntensity;
            if (altitudeDegrees > 5) {
                lightIntensity = 0.85; // Full daylight
            } else if (altitudeDegrees > -6) {
                // Civil twilight: fade from 0.85 to 0.4
                lightIntensity = 0.4 + (0.45 * (altitudeDegrees + 6) / 11);
            } else if (altitudeDegrees > -18) {
                // Nautical/Astronomical twilight: fade from 0.4 to 0.15
                lightIntensity = 0.15 + (0.25 * (altitudeDegrees + 18) / 12);
            } else {
                lightIntensity = 0.15; // Night - very dim ambient
            }

            map.setLight({
                'position': [1.5, azimuthDegrees, polarAngle],
                'anchor': 'map',
                'color': lightColor,
                'intensity': lightIntensity
            });
        }

        const sunAlt = altitudeDegrees;

        // Bing Maps-inspired color stops (altitude in degrees)
        // More color stages for smoother, more realistic transitions
        const colorStops = [
            {
                alt: -18, // Astronomical twilight - deep night
                colors: {
                    sky: '#050a12',       // Very dark blue-black
                    horizon: '#0d1520',   // Slightly lighter at horizon
                    fog: '#080c14',       // Dark fog
                    fogHigh: '#000008',   // Near black at top
                    spaceColor: '#000005' // Deep space
                }
            },
            {
                alt: -12, // Nautical twilight - blue hour starts
                colors: {
                    sky: '#0f1e35',       // Deep navy blue
                    horizon: '#1a3050',   // Blue horizon
                    fog: '#0d1825',       // Dark blue fog
                    fogHigh: '#050810',   // Very dark top
                    spaceColor: '#020408'
                }
            },
            {
                alt: -6, // Civil twilight - blue hour peak
                colors: {
                    sky: '#1e3a5f',       // Rich blue (like Bing at 5:28 AM)
                    horizon: '#2d4a6a',   // Lighter blue horizon
                    fog: '#1a3050',       // Blue atmospheric haze
                    fogHigh: '#0a1525',
                    spaceColor: '#050a15'
                }
            },
            {
                alt: -2, // Dawn/dusk - golden hour begins
                colors: {
                    sky: '#3a5575',       // Muted blue transitioning
                    horizon: '#c47830',   // Orange/gold horizon (like Bing 8:18 AM)
                    fog: '#a07050',       // Warm haze
                    fogHigh: '#2a4060',
                    spaceColor: '#101820'
                }
            },
            {
                alt: 2, // Sunrise/sunset - peak golden hour
                colors: {
                    sky: '#5a7595',       // Light grayish blue
                    horizon: '#e0a040',   // Golden horizon
                    fog: '#c09060',       // Golden fog/haze
                    fogHigh: '#4a6585',
                    spaceColor: '#1a2535'
                }
            },
            {
                alt: 8, // Early morning/late afternoon
                colors: {
                    sky: '#7090b0',       // Soft blue
                    horizon: '#b0c8e0',   // Pale horizon
                    fog: '#90a8c0',       // Light blue-gray fog
                    fogHigh: '#5070a0',
                    spaceColor: '#253545'
                }
            },
            {
                alt: 15, // Morning/afternoon
                colors: {
                    sky: '#80a0c5',       // Clear blue
                    horizon: '#c0d5ea',   // Light horizon
                    fog: '#a0b8d0',       // Subtle atmospheric haze
                    fogHigh: '#4070b0',   // Blue upper sky
                    spaceColor: '#304050'
                }
            },
            {
                alt: 30, // Midday - brightest
                colors: {
                    sky: '#88b0d8',       // Bright sky blue (like Bing 3:56 PM)
                    horizon: '#d0e0f0',   // Pale whitish horizon
                    fog: '#b0cce8',       // Light atmospheric perspective
                    fogHigh: '#3868c0',   // Deeper blue at zenith
                    spaceColor: '#405060'
                }
            },
            {
                alt: 60, // High noon
                colors: {
                    sky: '#90b8e0',       // Pure sky blue
                    horizon: '#d8e8f5',   // Nearly white horizon
                    fog: '#c0d8f0',       // Very light haze
                    fogHigh: '#3060b8',   // Deep blue zenith
                    spaceColor: '#506070'
                }
            }
        ];

        // Get interpolated colors
        const currentColors = multiInterpolate(colorStops, sunAlt);

        // Calculate star intensity (smooth transition)
        const starIntensity = sunAlt < -12 ? 1.0
            : sunAlt < -6 ? ((-6 - sunAlt) / 6)
                : 0.0;

        // 1. Sky settings
        if (typeof map.setSky === 'function' && !window._disableSkyUpdate) {
            map.setSky({
                'sky-color': currentColors.sky,
                'horizon-color': currentColors.horizon,
                'fog-color': currentColors.fog,
                'atmosphere-blend': sunAlt > -6 ? 0.85 : Math.max(0.2, (sunAlt + 18) / 24)
            });
        }

        // 2. Volumetric Fog with sun glare effect
        // Skip if manual override is active (user is debugging)
        if (typeof map.setFog === 'function' && !window._fogManualOverride && !window._disableFog) {
            // Base fog range
            let fogNear = sunAlt > 10 ? 0.3 : 0.5;
            let fogFar = sunAlt > 10 ? 4.0 : 2.5;
            let fogColor = currentColors.fog;

            // === SUN GLARE EFFECT ===
            // When looking towards the sun during golden hour, bring fog very close
            const isGoldenHour = sunAlt > -5 && sunAlt < 15;

            if (isGoldenHour && map.getBearing !== undefined && map.getPitch !== undefined) {
                try {
                    // Get camera direction (bearing)
                    const cameraBearing = map.getBearing(); // 0-360 degrees, 0=North
                    const cameraPitch = map.getPitch(); // 0-85 degrees

                    // Calculate angle difference between camera and sun
                    // Sun azimuth is already calculated above
                    let angleDiff = Math.abs(azimuthDegrees - cameraBearing);
                    if (angleDiff > 180) angleDiff = 360 - angleDiff;

                    // Glare is strongest when looking directly at sun (angleDiff near 0)
                    // and pitch is low-ish (looking towards horizon where sun is)
                    const lookingAtSun = angleDiff < 60; // Within 60° cone of sun direction
                    const pitchTowardsSun = cameraPitch < 70; // Not looking straight down

                    if (lookingAtSun && pitchTowardsSun) {
                        // Calculate glare intensity (0-1)
                        // Strongest when directly facing sun, weakest at 60°
                        const glareFromAngle = 1.0 - (angleDiff / 60);

                        // Also factor in sun altitude - stronger glare when sun is very low
                        const sunLowness = sunAlt < 5 ? 1.0 : Math.max(0, (15 - sunAlt) / 10);

                        const glareIntensity = glareFromAngle * sunLowness;

                        // Apply glare: bring fog closer, add warm tint
                        fogNear = fogNear - (glareIntensity * 0.4); // Can go negative for extreme close fog
                        fogFar = fogFar - (glareIntensity * 2.0);   // Much closer far plane

                        // Clamp to reasonable values
                        fogNear = Math.max(-0.5, fogNear);
                        fogFar = Math.max(0.5, fogFar);

                        // Warm up the fog color during glare
                        if (glareIntensity > 0.3) {
                            // Blend towards warm orange for glare
                            fogColor = sunAlt < 5
                                ? interpolateColor(currentColors.fog, '#ffcc88', glareIntensity * 0.5)
                                : currentColors.fog;
                        }
                    }
                } catch (e) {
                    // Ignore errors - camera methods might not be available
                }
            }

            map.setFog({
                'range': [fogNear, fogFar],
                'color': fogColor,
                'horizon-blend': 0.15,
                'high-color': currentColors.fogHigh,
                'space-color': currentColors.spaceColor,
                'star-intensity': starIntensity
            });
        }

        return sunPos;

    } catch (e) {
        console.warn('[SunController] Failed to update sun position:', e);
    }
}

export default {
    updateSunPosition
};
