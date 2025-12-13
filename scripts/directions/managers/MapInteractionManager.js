/**
 * MapInteractionManager - Handles map event binding and delegates to DirectionsManager.
 * 
 * This manager encapsulates:
 * - Map event binding/unbinding
 * - Event delegation to parent handler methods
 * - Cursor management
 */

export class MapInteractionManager {
    /**
     * @param {Object} options
     * @param {Object} options.map - MapLibre GL map instance
     * @param {Object} options.directionsManager - Reference to DirectionsManager for delegation
     */
    constructor(options = {}) {
        const { map, directionsManager } = options;

        if (!map || typeof map.on !== 'function') {
            throw new Error('MapInteractionManager requires a valid MapLibre map instance');
        }

        if (!directionsManager) {
            throw new Error('MapInteractionManager requires a DirectionsManager instance');
        }

        this.map = map;
        this.dm = directionsManager;
        this.isSetup = false;

        // Bind event handlers to preserve context
        this._bindEventHandlers();
    }

    /**
     * Bind all event handler methods to this instance
     */
    _bindEventHandlers() {
        this._handleWaypointMouseDown = (e) => this.dm.onWaypointMouseDown(e);
        this._handleWaypointMouseEnter = (e) => this.dm.onWaypointMouseEnter?.(e);
        this._handleWaypointMouseLeave = (e) => this.dm.onWaypointMouseLeave?.(e);
        this._handleWaypointDoubleClick = (e) => this.dm.onWaypointDoubleClick(e);
        this._handleWaypointContextMenu = (e) => this.dm.onWaypointContextMenu(e);

        this._handleMapMouseDown = (e) => this.dm.onMapMouseDown(e);
        this._handleMapMouseMove = (e) => this.dm.onMapMouseMove(e);
        this._handleMapMouseUp = (e) => this.dm.onMapMouseUp(e);
        this._handleMapClick = (e) => this.dm.onMapClick(e);
        this._handleMapMouseLeave = () => {
            this.dm.resetSegmentHover?.('map');
            this.dm.setHoveredWaypointIndex?.(null);
        };

        this._handleSegmentMarkerMouseDown = (e) => this.dm.onSegmentMarkerMouseDown(e);
        this._handleSegmentMarkerMouseEnter = (e) => this.dm.onBivouacMouseEnter?.(e);
        this._handleSegmentMarkerMouseLeave = (e) => this.dm.onBivouacMouseLeave?.(e);
        this._handleBivouacClick = (e) => this.dm.onBivouacClick(e);

        this._handleRouteContextMenu = (e) => this.dm.onRouteContextMenu(e);
        this._handleElevationPointerMove = (e) => this.dm.onElevationPointerMove?.(e);
        this._handleElevationPointerLeave = () => this.dm.onElevationPointerLeave?.();
        this._handleElevationContextMenu = (e) => this.dm.onElevationContextMenu(e);
    }

    /**
     * Setup all map event handlers
     */
    setupEventHandlers() {
        if (this.isSetup) return;

        // Waypoint layer events
        this.map.on('mousedown', 'waypoints-hit-area', this._handleWaypointMouseDown);
        this.map.on('mouseenter', 'waypoints-hit-area', this._handleWaypointMouseEnter);
        this.map.on('mouseleave', 'waypoints-hit-area', this._handleWaypointMouseLeave);
        this.map.on('dblclick', 'waypoints-hit-area', this._handleWaypointDoubleClick);
        this.map.on('contextmenu', 'waypoints-hit-area', this._handleWaypointContextMenu);

        // Segment marker (start/end/bivouac) events
        this.map.on('mousedown', 'segment-markers', this._handleSegmentMarkerMouseDown);
        this.map.on('mouseenter', 'segment-markers', this._handleSegmentMarkerMouseEnter);
        this.map.on('mouseleave', 'segment-markers', this._handleSegmentMarkerMouseLeave);
        this.map.on('click', 'segment-markers', this._handleBivouacClick);

        // Global map events
        this.map.on('mousedown', this._handleMapMouseDown);
        this.map.on('mousemove', this._handleMapMouseMove);
        this.map.on('mouseup', this._handleMapMouseUp);
        this.map.on('click', this._handleMapClick);
        this.map.on('mouseleave', this._handleMapMouseLeave);
        this.map.on('contextmenu', this._handleRouteContextMenu);

        this.isSetup = true;
    }

    /**
     * Remove all map event handlers
     */
    removeEventHandlers() {
        if (!this.isSetup) return;

        // Waypoint layer events
        this.map.off('mousedown', 'waypoints-hit-area', this._handleWaypointMouseDown);
        this.map.off('mouseenter', 'waypoints-hit-area', this._handleWaypointMouseEnter);
        this.map.off('mouseleave', 'waypoints-hit-area', this._handleWaypointMouseLeave);
        this.map.off('dblclick', 'waypoints-hit-area', this._handleWaypointDoubleClick);
        this.map.off('contextmenu', 'waypoints-hit-area', this._handleWaypointContextMenu);

        // Segment marker events
        this.map.off('mousedown', 'segment-markers', this._handleSegmentMarkerMouseDown);
        this.map.off('mouseenter', 'segment-markers', this._handleSegmentMarkerMouseEnter);
        this.map.off('mouseleave', 'segment-markers', this._handleSegmentMarkerMouseLeave);
        this.map.off('click', 'segment-markers', this._handleBivouacClick);

        // Global map events
        this.map.off('mousedown', this._handleMapMouseDown);
        this.map.off('mousemove', this._handleMapMouseMove);
        this.map.off('mouseup', this._handleMapMouseUp);
        this.map.off('click', this._handleMapClick);
        this.map.off('mouseleave', this._handleMapMouseLeave);
        this.map.off('contextmenu', this._handleRouteContextMenu);

        this.isSetup = false;
    }

    /**
     * Setup elevation chart event handlers
     * @param {HTMLElement} elevationChartBody - The elevation chart body element
     */
    setupElevationHandlers(elevationChartBody) {
        if (!elevationChartBody) return;

        elevationChartBody.addEventListener('pointermove', this._handleElevationPointerMove);
        elevationChartBody.addEventListener('pointerleave', this._handleElevationPointerLeave);
        elevationChartBody.addEventListener('contextmenu', this._handleElevationContextMenu);
    }

    /**
     * Remove elevation chart event handlers
     * @param {HTMLElement} elevationChartBody - The elevation chart body element
     */
    removeElevationHandlers(elevationChartBody) {
        if (!elevationChartBody) return;

        elevationChartBody.removeEventListener('pointermove', this._handleElevationPointerMove);
        elevationChartBody.removeEventListener('pointerleave', this._handleElevationPointerLeave);
        elevationChartBody.removeEventListener('contextmenu', this._handleElevationContextMenu);
    }

    /**
     * Check if handlers are set up
     * @returns {boolean} True if handlers are active
     */
    isActive() {
        return this.isSetup;
    }

    /**
     * Cleanup
     */
    destroy() {
        this.removeEventHandlers();
        this.dm = null;
        this.map = null;
    }
}
