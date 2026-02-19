/**
 * gpx-controller.js — GPX import/export wiring and file input handling.
 */

/**
 * Setup GPX import and export button handlers.
 * @param {maplibregl.Map} map
 * @param {object} deps
 */
import { Toast } from '../ui/toast.js';

export function setupGpxControls(map, deps = {}) {
    const { directionsManagerGetter } = deps;

    const gpxFileInput = document.getElementById('gpxFileInput');
    const gpxImportButton = document.getElementById('gpxImportButton');
    const gpxExportButton = document.getElementById('gpxExportButton');

    // GPX Import
    if (gpxImportButton && gpxFileInput) {
        gpxImportButton.addEventListener('click', () => gpxFileInput.click());
        gpxFileInput.addEventListener('change', async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const dm = directionsManagerGetter?.();
                if (dm && typeof dm.importGPX === 'function') {
                    dm.importGPX(text);
                }
            } catch (error) {
                console.error('Failed to import GPX file', error);
                Toast.error('Unable to import GPX file.');
            }
            gpxFileInput.value = '';
        });
    }

    // GPX Export
    if (gpxExportButton) {
        gpxExportButton.addEventListener('click', () => {
            try {
                const dm = directionsManagerGetter?.();
                if (dm && typeof dm.exportGPX === 'function') {
                    dm.exportGPX();
                }
            } catch (error) {
                console.error('Failed to export GPX data', error);
                Toast.error('Unable to export GPX data.');
            }
        });
    }
}
