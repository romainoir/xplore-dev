/**
 * shadow-controller.js — Sun position calculation, shadow time updates,
 * hillshade illumination direction/altitude synchronisation.
 */

/**
 * Create the shadow controller.
 * @param {maplibregl.Map} map
 * @param {object} deps
 * @returns {object} shadow controller API
 */
export function createShadowController(map, deps = {}) {
    const { viewModeController = null } = deps;

    /**
     * Update shadow illumination for a given date/time.
     * Sets hillshade illumination direction and altitude on all relevant layers,
     * updates the sky simulation, and applies the sun position globally.
     * @param {Date} date
     */
    function updateShadowTime(date) {
        if (!date || !(date instanceof Date)) return;
        window.skySimulationDate = date.getTime();
        if (!map) return;
        try {
            const center = map.getCenter();
            const sunPos = SunCalc.getPosition(date, center.lat, center.lng);
            const sunAzi = (sunPos.azimuth * 180 / Math.PI + 180) % 360;
            const sunAlt = sunPos.altitude * 180 / Math.PI;
            window.sunConfig = { azimuth: sunAzi, altitude: sunAlt };

            // Shadow and detail layers get single-direction illumination
            const hScale = Math.max(0, sunAlt / 90);
            const shadowColor = `rgba(0,0,0, ${0.4 - hScale * 0.2})`; // Darker near sunrise/sunset

            let hlColor = '#ffffff';
            if (sunAlt < 5) {
                hlColor = '#ff8c42'; // Sunset orange
            } else if (sunAlt < 15) {
                hlColor = '#ffcf9e'; // Golden hour
            }

            ['shadow-native', 'detail-native'].forEach(l => {
                if (map.getLayer(l)) {
                    map.setPaintProperty(l, 'hillshade-illumination-direction', sunAzi);
                    map.setPaintProperty(l, 'hillshade-illumination-altitude', [sunAlt, sunAlt, sunAlt, sunAlt]);
                    map.setPaintProperty(l, 'hillshade-shadow-color', shadowColor);
                    map.setPaintProperty(l, 'hillshade-highlight-color', hlColor);
                }
            });

            // Modern Raymarched Shadow Cascade
            ['shadow-coarse', 'shadow-detail'].forEach(l => {
                if (map.getLayer(l)) {
                    map.setPaintProperty(l, 'shadow-direction', sunAzi);
                    map.setPaintProperty(l, 'shadow-altitude', Math.max(sunAlt, 2));
                }
            });

            // Hillshade layer gets multi-directional illumination
            if (map.getLayer('hillshade')) {
                map.setPaintProperty('hillshade', 'hillshade-illumination-direction', [sunAzi, (sunAzi + 45) % 360, (sunAzi - 45 + 360) % 360, (sunAzi + 180) % 360]);
                map.setPaintProperty('hillshade', 'hillshade-illumination-altitude', [sunAlt, sunAlt, sunAlt, sunAlt]);
            }
        } catch (_) { }

        if (viewModeController?.updateSkyForTime) {
            viewModeController.updateSkyForTime(date);
        }
        map.triggerRepaint();
    }

    return {
        updateShadowTime,
    };
}
