
import { RouteLibraryManager } from '../storage/route-library-manager.js';
import { geojsonToGpx, parseGpxToGeoJson, zoomToGeojson } from '../gpx/gpx-io.js';
import { haversineDistanceMeters } from '../directions/utils/directions-utils.js';

export class RouteLibraryUI {
    constructor(manager, directionsManager) {
        this.manager = manager;
        this.directionsManager = directionsManager;
        this.dock = document.getElementById('routeLibraryDock');
        this.toggleBtn = document.getElementById('libraryToggle');
        this.listContainer = document.getElementById('routeList');
        this.searchInput = document.getElementById('librarySearchInput');
        this.importBtn = document.getElementById('libraryImportBtn');
        this.libraryGpxInput = document.getElementById('libraryGpxInput');
        this.saveBtn = document.getElementById('saveRouteButton');

        this.isVisible = false;
        this.routes = [];

        this.init();
    }

    init() {
        if (this.toggleBtn) {
            this.toggleBtn.addEventListener('click', () => this.toggleDock());
        }

        if (this.saveBtn) {
            this.saveBtn.addEventListener('click', () => this.promptSave());
        }

        if (this.searchInput) {
            this.searchInput.addEventListener('input', (e) => this.filterRoutes(e.target.value));
        }

        if (this.importBtn && this.libraryGpxInput) {
            this.importBtn.addEventListener('click', () => {
                this.libraryGpxInput.click();
            });

            this.libraryGpxInput.addEventListener('change', async (e) => {
                const files = e.target.files;
                if (!files || files.length === 0) return;

                // Process all files
                for (const file of files) {
                    await this.handleImport(file);
                }

                await this.loadRoutes(); // Refresh once after all imports

                e.target.value = ''; // Reset
            });
        }

        // Event delegation for route card actions
        if (this.listContainer) {
            this.listContainer.addEventListener('click', (e) => this.handleCardAction(e));
            this.listContainer.addEventListener('dblclick', (e) => {
                const title = e.target.closest('.route-title');
                if (title) {
                    const originalName = title.textContent;
                    title.contentEditable = true;
                    title.focus();

                    // Select all text
                    const range = document.createRange();
                    range.selectNodeContents(title);
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);

                    const finishEdit = async () => {
                        title.contentEditable = false;
                        const newName = title.textContent.trim();
                        const card = title.closest('.route-card');
                        const id = card?.dataset.id;

                        if (id && newName && newName !== originalName) {
                            try {
                                await this.manager.updateRoute(id, { name: newName });
                                title.title = newName; // Update tooltip
                            } catch (e) {
                                console.error("Rename failed", e);
                                title.textContent = originalName; // Revert
                            }
                        } else if (newName === "") {
                            title.textContent = originalName; // Revert if empty
                        }
                    };

                    title.addEventListener('blur', finishEdit, { once: true });
                    title.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            title.blur();
                        }
                        if (e.key === 'Escape') {
                            e.preventDefault();
                            title.textContent = originalName; // Revert
                            title.blur();
                        }
                    });
                }
            });
        }

        // Refresh list when dock is opened
        // Also listen for external updates if needed (e.g. after save)
        document.addEventListener('route-library-update', () => this.loadRoutes());
    }



    async toggleDock() {
        this.isVisible = !this.isVisible;
        this.dock.classList.toggle('visible', this.isVisible);
        this.toggleBtn.classList.toggle('active', this.isVisible);
        this.dock.setAttribute('aria-hidden', !this.isVisible);
        this.toggleBtn.setAttribute('aria-expanded', this.isVisible);

        if (this.isVisible) {
            // Close directions dock if separate (optional, based on UX preference)
            // const directionsDock = document.getElementById('directionsDock');
            // directionsDock.classList.remove('visible');
            // document.getElementById('directionsToggle').classList.remove('active');

            await this.loadRoutes();
        }
    }

    async loadRoutes() {
        try {
            this.routes = await this.manager.getAllRoutes();
            this.renderRoutes(this.routes);
        } catch (error) {
            console.error('Failed to load routes:', error);
            this.listContainer.innerHTML = '<div class="empty-state">Error loading routes.</div>';
        }
    }

    renderRoutes(routes) {
        if (!routes || routes.length === 0) {
            this.listContainer.innerHTML = '<div class="empty-state">No saved routes yet.</div>';
            return;
        }

        this.listContainer.innerHTML = routes.map(route => this.createCardHTML(route)).join('');
    }

    createCardHTML(route) {
        const date = new Date(route.updatedAt).toLocaleDateString();
        const stats = route.stats || {};

        const validDistance = (stats.distanceKm || 0).toFixed(1);
        const validAscent = isFinite(stats.elevationGain) ? Math.round(stats.elevationGain) : 0;
        const validDescent = isFinite(stats.elevationLoss) ? Math.round(stats.elevationLoss) : 0;
        const durationH = Math.floor((stats.durationMinutes || 0) / 60);
        const durationM = Math.round((stats.durationMinutes || 0) % 60);
        const validDuration = stats.durationMinutes ? `${durationH}h ${durationM}m` : '-';
        const color = stats.color || '#f8b40b';
        const days = stats.days > 1 ? `<span style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 8px; color: white;">${stats.days} Jours</span>` : '';

        // Difficulty
        const difficultyLevel = stats.difficulty?.level || '';
        const difficultyScore = stats.difficulty?.score || 0;
        const difficultyBars = Array.from({ length: 5 }, (_, i) =>
            `<span class="difficulty-bar${i < difficultyScore ? ' filled' : ''}" style="display:inline-block; width:4px; height:8px; margin-right:1px; background:${i < difficultyScore ? color : 'rgba(255,255,255,0.2)'}; border-radius: 1px;"></span>`
        ).join('');
        const difficultyHtml = difficultyLevel ? `
            <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; opacity: 0.8; margin-top: 4px; color: white;">
                <div style="display: flex;">${difficultyBars}</div>
                <span>${difficultyLevel}</span>
            </div>
        ` : '';

        // Improved Sparkline (Multi-color filled area)
        let sparklineHtml = '';
        if (stats.elevationProfile && stats.elevationProfile.length > 1) {
            const profile = stats.elevationProfile;
            const width = 280;
            const height = 50;
            const minEle = Math.min(...profile);
            const maxEle = Math.max(...profile);
            const range = maxEle - minEle || 1;

            // Build Gradient Stops from Segments
            let gradientStops = '';
            let strokeGradientStops = '';

            if (Array.isArray(stats.segments) && stats.segments.length > 0) {
                const totalDist = stats.distanceKm || 1;
                // Add stops for each segment to create hard transitions
                stats.segments.forEach((seg, i) => {
                    const startPct = Math.max(0, Math.min(100, (seg.startKm / totalDist) * 100));
                    const endPct = Math.max(0, Math.min(100, (seg.endKm / totalDist) * 100));

                    // Fill Gradient (low opacity)
                    gradientStops += `<stop offset="${startPct}%" stop-color="${seg.color}" stop-opacity="0.4" />`;
                    gradientStops += `<stop offset="${endPct}%" stop-color="${seg.color}" stop-opacity="0.4" />`;

                    // Stroke Gradient (full opacity)
                    strokeGradientStops += `<stop offset="${startPct}%" stop-color="${seg.color}" stop-opacity="1" />`;
                    strokeGradientStops += `<stop offset="${endPct}%" stop-color="${seg.color}" stop-opacity="1" />`;
                });
            } else {
                gradientStops = `
                    <stop offset="0%" style="stop-color:${color};stop-opacity:0.4" />
                    <stop offset="100%" style="stop-color:${color};stop-opacity:0.1" />
                 `;
                strokeGradientStops = `
                    <stop offset="0%" stop-color="${color}" stop-opacity="1" />
                    <stop offset="100%" stop-color="${color}" stop-opacity="1" />
                 `;
            }

            // Generate path for line
            const points = profile.map((ele, i) => {
                const x = (i / (profile.length - 1)) * width;
                const y = height - ((ele - minEle) / range) * height;
                return `${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(' ');

            // Close the path for fill
            const fillPoints = `${points} ${width},${height} 0,${height}`;

            sparklineHtml = `
                <div class="route-sparkline-container" style="height: ${height}px; margin: 12px 0 8px 0; overflow: hidden; border-radius: 4px; background: transparent; position: relative;">
                    <svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="display: block;">
                         <defs>
                            <linearGradient id="grad-fill-${route.id}" x1="0%" y1="0%" x2="100%" y2="0%">
                                ${gradientStops}
                            </linearGradient>
                            <linearGradient id="grad-stroke-${route.id}" x1="0%" y1="0%" x2="100%" y2="0%">
                                ${strokeGradientStops}
                            </linearGradient>
                        </defs>
                        <polygon points="${fillPoints}" fill="url(#grad-fill-${route.id})" />
                        <polyline points="${points}" fill="none" stroke="url(#grad-stroke-${route.id})" stroke-width="2" vector-effect="non-scaling-stroke"/>
                    </svg>
                </div>
            `;
        }

        return `
      <div class="route-card" data-id="${route.id}" style="color: white; border-left: none;">
        <div class="route-card__header" style="flex-direction: column; align-items: stretch;">
            <div class="route-header" style="display: flex; align-items: center; margin-bottom: 8px;">
                 <h3 class="route-title" style="margin: 0; font-size: 15px; font-weight: 600; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; color: white;" title="${this.escapeHtml(route.name)}">${this.escapeHtml(route.name)}</h3>
                 ${days}
            </div>

            <div class="route-stats-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; font-size: 13px;">
                 <div style="display: flex; flex-direction: column;">
                    <span style="opacity: 0.6; font-size: 11px;">Distance</span>
                    <span style="font-weight: 500;">${validDistance} km</span>
                 </div>
                 <div style="display: flex; flex-direction: column;">
                    <span style="opacity: 0.6; font-size: 11px;">Dénivelé</span>
                    <span style="font-weight: 500;">+${validAscent} / -${validDescent} m</span>
                 </div>
                 <div style="display: flex; flex-direction: column;">
                    <span style="opacity: 0.6; font-size: 11px;">Temps</span>
                    <span style="font-weight: 500;">${validDuration}</span>
                 </div>
            </div>

            ${difficultyHtml}

            ${sparklineHtml}

            <div class="route-actions" style="margin-top: 8px; display: flex; justify-content: flex-end; gap: 8px;">
                <button class="btn btn--outline btn--sm action-load" data-id="${route.id}" style="flex: 1; color: white; border-color: rgba(255,255,255,0.3);">Load</button>
                <button class="btn btn--text btn--sm action-export" data-id="${route.id}" title="Export GPX" style="color: white;">
                    <img src="./data/download.png" width="16" height="16" alt="Export" style="opacity: 0.7; filter: brightness(0) invert(1);">
                </button>
                <button class="btn btn--text btn--sm action-delete" data-id="${route.id}" title="Delete" style="color: white;">
                        <img src="./data/trash.svg" width="16" height="16" alt="Delete" style="filter: brightness(0) invert(1);">
                </button>
            </div>
        </div>
      </div>
    `;
    }

    handleCardAction(e) {
        // Handle clicks on SVG or path within button
        const btn = e.target.closest('button');
        if (!btn) return;

        const id = btn.dataset.id;
        if (!id) return;

        if (btn.classList.contains('action-load')) {
            this.manager.getRoute(id).then(route => this.loadRouteToMap(route));
        } else if (btn.classList.contains('action-delete')) {
            this.manager.getRoute(id).then(route => {
                if (confirm(`Delete route "${route.name}"?`)) {
                    this.deleteRoute(id);
                }
            });
        } else if (btn.classList.contains('action-export')) {
            this.manager.getRoute(id).then(route => this.exportRoute(route));
        }
    }

    async loadRouteToMap(route) {
        if (this.directionsManager) {
            const geojson = route.geojson;
            if (geojson) {
                // Use the robust import method from DirectionsManager
                if (typeof this.directionsManager.importRouteFromGeojson === 'function') {
                    const success = this.directionsManager.importRouteFromGeojson(geojson, { name: route.name });
                    if (success) {
                        // Zoom to the loaded route
                        if (this.directionsManager.map) {
                            zoomToGeojson(this.directionsManager.map, geojson);
                        }
                    } else {
                        console.warn("importRouteFromGeojson returned false");
                        alert("Could not load route geometry.");
                    }
                } else {
                    console.warn('DirectionsManager.importRouteFromGeojson not available.');
                    alert("Loading routes is not supported in this version.");
                }

                // Close library on small screens
                if (window.innerWidth < 1024) {
                    this.toggleDock();
                }
            }
        }
    }

    async exportRoute(route) {
        try {
            const gpxString = geojsonToGpx(route.geojson, { creator: 'XploreMap' });
            const blob = new Blob([gpxString], { type: 'application/gpx+xml' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${route.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.gpx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error("Export failed", e);
            alert("Failed to export GPX");
        }
    }

    async deleteRoute(id) {
        await this.manager.deleteRoute(id);
        await this.loadRoutes(); // Refresh
    }

    filterRoutes(query) {
        if (!query) {
            this.renderRoutes(this.routes);
            return;
        }
        const lower = query.toLowerCase();
        const filtered = this.routes.filter(r =>
            r.name.toLowerCase().includes(lower) ||
            (r.tags && r.tags.some(t => t.toLowerCase().includes(lower)))
        );
        this.renderRoutes(filtered);
    }

    formatDuration(minutes) {
        const h = Math.floor(minutes / 60);
        const m = Math.floor(minutes % 60);
        return h > 0 ? `${h}h ${m}m` : `${m}min`;
    }

    async handleImport(file) {
        try {
            const text = await file.text();
            const geojson = parseGpxToGeoJson(text);

            if (!geojson || !geojson.features || geojson.features.length === 0) {
                console.warn(`No valid route data found in GPX: ${file.name}`);
                return;
            }

            // Compute stats & profile
            const { stats, elevationProfile } = this.computeRouteStats(geojson);

            // Use filename as default name
            const name = file.name.replace(/\.gpx$/i, '');

            const routeData = {
                name,
                geojson,
                stats: {
                    ...stats,
                    elevationProfile // Store the profile for the sparkline
                },
                tags: ['imported']
            };

            await this.manager.saveRoute(routeData);

        } catch (e) {
            console.error("Import failed", e);
            alert(`Failed to import GPX: ${file.name}`);
        }
    }

    computeRouteStats(geojson) {
        let distanceMeters = 0;
        let elevationGain = 0;
        let elevationLoss = 0;
        let segmentCount = 0;
        const allElevations = [];

        // Helper to process coords
        const processCoords = (coords) => {
            if (!Array.isArray(coords)) return;
            segmentCount++;
            for (let i = 0; i < coords.length; i++) {
                const curr = coords[i];
                if (curr.length > 2) allElevations.push(curr[2]);

                if (i > 0) {
                    const prev = coords[i - 1];
                    distanceMeters += haversineDistanceMeters(prev, curr) || 0;

                    if (prev.length > 2 && curr.length > 2) {
                        const diff = curr[2] - prev[2];
                        if (diff > 0) {
                            elevationGain += diff;
                        } else {
                            elevationLoss += Math.abs(diff); // Capture descent
                        }
                    }
                }
            }
        };

        const features = geojson.features || [];
        features.forEach(f => {
            if (f.geometry.type === 'LineString') {
                processCoords(f.geometry.coordinates);
            } else if (f.geometry.type === 'MultiLineString') {
                f.geometry.coordinates.forEach(processCoords);
            }
        });

        // Generate simplified profile (e.g. 50 points)
        let elevationProfile = [];
        if (allElevations.length > 0) {
            const samples = 50;
            const step = Math.max(1, Math.floor(allElevations.length / samples));
            for (let i = 0; i < allElevations.length; i += step) {
                elevationProfile.push(Math.round(allElevations[i]));
            }
        }

        return {
            stats: {
                distanceKm: distanceMeters / 1000,
                elevationGain,
                elevationLoss,
                durationMinutes: (distanceMeters / 1000) * 15, // Rough estimate
                days: segmentCount // Use segment count as day count approximation
            },
            elevationProfile
        };
    }

    async promptSave() {
        if (!this.directionsManager) return;

        // Simple prompt for V1
        const name = window.prompt("Enter a name for this route:", "New Route");
        if (name) {
            try {
                await this.directionsManager.saveCurrentRoute(name);
                alert("Route saved successfully!");
                this.loadRoutes(); // Refresh list
            } catch (e) {
                console.error("Save failed", e);
                alert("Failed to save route. See console for details.");
            }
        }
    }

    escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}
