/**
 * Geocoder Control Module
 * Provides address/location search using Nominatim API
 */

const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';

/**
 * Create a geocoder API adapter for Nominatim
 * @returns {Object} Geocoder API compatible with MaplibreGeocoder
 */
function createNominatimGeocoderApi() {
    return {
        forwardGeocode: async (config) => {
            const features = [];
            try {
                const params = new URLSearchParams({
                    q: config.query,
                    format: 'geojson',
                    polygon_geojson: '1',
                    addressdetails: '1',
                    limit: '8'
                });

                const request = `${NOMINATIM_ENDPOINT}?${params.toString()}`;
                const response = await fetch(request, {
                    headers: {
                        'Accept': 'application/json',
                        // Nominatim requires a valid User-Agent
                        'User-Agent': 'XploreMap/1.0'
                    }
                });

                if (!response.ok) {
                    throw new Error(`Nominatim request failed: ${response.status}`);
                }

                const geojson = await response.json();

                for (const feature of geojson.features) {
                    // Calculate center from bbox if available
                    let center;
                    if (feature.bbox && feature.bbox.length >= 4) {
                        center = [
                            feature.bbox[0] + (feature.bbox[2] - feature.bbox[0]) / 2,
                            feature.bbox[1] + (feature.bbox[3] - feature.bbox[1]) / 2
                        ];
                    } else if (feature.geometry?.coordinates) {
                        // Fallback to geometry coordinates for points
                        center = feature.geometry.type === 'Point'
                            ? feature.geometry.coordinates
                            : null;
                    }

                    if (!center) continue;

                    const point = {
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: center
                        },
                        place_name: feature.properties.display_name,
                        properties: feature.properties,
                        text: feature.properties.display_name,
                        place_type: ['place'],
                        center,
                        bbox: feature.bbox
                    };
                    features.push(point);
                }
            } catch (e) {
                console.error('Geocoder error:', e);
            }
            return { features };
        }
    };
}

/**
 * Initialize and add geocoder control to the map
 * @param {maplibregl.Map} map - The MapLibre map instance
 * @param {Object} options - Configuration options
 * @returns {MaplibreGeocoder|null} The geocoder instance or null if not available
 */
export function initializeGeocoder(map, options = {}) {
    // Check if MaplibreGeocoder is available (loaded via script tag)
    if (typeof MaplibreGeocoder === 'undefined') {
        console.warn('MaplibreGeocoder not available. Geocoder will not be initialized.');
        return null;
    }

    if (typeof maplibregl === 'undefined') {
        console.warn('maplibregl not available. Geocoder will not be initialized.');
        return null;
    }

    const {
        placeholder = 'Search location...',
        collapsed = false, // Always expanded in the top bar
        showResultsWhileTyping = true,
        minLength = 3,
        debounceSearch = 300,
        flyTo = true,
        position = 'top-center'
    } = options;

    const geocoderApi = createNominatimGeocoderApi();

    const geocoder = new MaplibreGeocoder(geocoderApi, {
        maplibregl,
        placeholder,
        collapsed,
        showResultsWhileTyping,
        minLength,
        debounceSearch,
        flyTo,
        marker: false // Don't show default marker on result
    });

    // For top-center/header positioning, target the specific container
    if (position === 'top-center') {
        const container = document.getElementById('headerGeocoder');
        if (container) {
            const geocoderElem = geocoder.onAdd(map);
            if (geocoderElem) {
                container.innerHTML = '';
                container.appendChild(geocoderElem);
            }
        } else {
            // Fallback for centered positioning if container doesn't exist
            let customContainer = document.querySelector('.geocoder-container--top-center');
            if (!customContainer) {
                customContainer = document.createElement('div');
                customContainer.className = 'geocoder-container geocoder-container--top-center';
                document.body.appendChild(customContainer);
            }

            const geocoderElem = geocoder.onAdd(map);
            if (geocoderElem) {
                customContainer.innerHTML = '';
                customContainer.appendChild(geocoderElem);
            }
        }
    } else {
        // Use standard MapLibre control positioning for supported positions
        try {
            map.addControl(geocoder, position);
        } catch (e) {
            console.error('Failed to add geocoder control:', e);
            // Fallback to top-right if provided position failed
            map.addControl(geocoder, 'top-right');
        }
    }

    return geocoder;
}

export default initializeGeocoder;
