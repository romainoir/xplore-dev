/**
 * WaypointManager - Handles waypoint state, history, and CRUD operations.
 * 
 * This manager encapsulates:
 * - Waypoint array state management
 * - Undo/redo history
 * - Waypoint cloning and snapshotting
 * - Waypoint display feature generation
 */

import { WAYPOINT_HISTORY_LIMIT, COORD_EPSILON } from '../constants.js';
import { createWaypointFeature } from '../markers.js';

export class WaypointManager {
    /**
     * @param {Object} options
     * @param {Object} options.map - MapLibre GL map instance
     * @param {Function} options.getRouteCutDistances - Returns route cut distances
     * @param {Function} options.getCachedLegSegments - Returns cached leg segments
     * @param {Object} options.callbacks - Callbacks for state changes
     */
    constructor(options = {}) {
        const {
            map,
            getRouteCutDistances,
            getCachedLegSegments,
            cloneCachedLegSegments,
            restoreCachedLegSegments,
            callbacks = {}
        } = options;

        this.map = map;
        this.getRouteCutDistances = getRouteCutDistances || (() => []);
        this.getCachedLegSegments = getCachedLegSegments || (() => new Map());
        this.cloneCachedLegSegments = cloneCachedLegSegments || (() => []);
        this.restoreCachedLegSegments = restoreCachedLegSegments || (() => { });

        // Callbacks
        this.callbacks = {
            onWaypointsChanged: callbacks.onWaypointsChanged || (() => { }),
            onHistoryChanged: callbacks.onHistoryChanged || (() => { }),
            resolveWaypointColor: callbacks.resolveWaypointColor || (() => '#666666'),
            cloneRouteCuts: callbacks.cloneRouteCuts || (() => []),
            setRouteCutDistances: callbacks.setRouteCutDistances || (() => { })
        };

        // State
        this.waypoints = [];
        this.waypointHistory = [];
        this.waypointRedoHistory = [];
    }

    /**
     * Get current waypoints
     * @returns {Array} Current waypoints array
     */
    getWaypoints() {
        return this.waypoints;
    }

    /**
     * Set waypoints array
     * @param {Array} waypoints - New waypoints array
     */
    setWaypoints(waypoints) {
        this.waypoints = Array.isArray(waypoints) ? waypoints : [];
    }

    /**
     * Get waypoint count
     * @returns {number} Number of waypoints
     */
    getCount() {
        return this.waypoints.length;
    }

    /**
     * Check if we have enough waypoints for a route
     * @returns {boolean} True if 2+ waypoints
     */
    hasRoute() {
        return this.waypoints.length >= 2;
    }

    /**
     * Clone waypoints array
     * @param {Array} source - Source waypoints (defaults to current)
     * @returns {Array} Cloned waypoints
     */
    cloneWaypoints(source = this.waypoints) {
        if (!Array.isArray(source)) {
            return [];
        }
        return source.map((coords) => (Array.isArray(coords) ? coords.slice() : []));
    }

    /**
     * Snapshot current waypoints
     * @returns {Array} Cloned waypoints array
     */
    snapshotWaypoints() {
        return this.cloneWaypoints();
    }

    /**
     * Add a waypoint at the end
     * @param {Array} coords - [lng, lat] or [lng, lat, elevation]
     */
    addWaypoint(coords) {
        if (!Array.isArray(coords) || coords.length < 2) {
            return;
        }
        this.waypoints.push(coords.slice());
    }

    /**
     * Insert a waypoint at a specific index
     * @param {number} index - Index to insert at
     * @param {Array} coords - [lng, lat] or [lng, lat, elevation]
     */
    insertWaypoint(index, coords) {
        if (!Array.isArray(coords) || coords.length < 2) {
            return;
        }
        const insertIndex = Math.max(0, Math.min(this.waypoints.length, index));
        this.waypoints.splice(insertIndex, 0, coords.slice());
    }

    /**
     * Remove a waypoint at a specific index
     * @param {number} index - Index to remove
     * @returns {Array|null} Removed waypoint or null
     */
    removeWaypoint(index) {
        if (index < 0 || index >= this.waypoints.length) {
            return null;
        }
        const removed = this.waypoints.splice(index, 1);
        return removed.length ? removed[0] : null;
    }

    /**
     * Update a waypoint's coordinates
     * @param {number} index - Waypoint index
     * @param {Array} coords - New coordinates
     */
    updateWaypoint(index, coords) {
        if (index < 0 || index >= this.waypoints.length) {
            return;
        }
        if (!Array.isArray(coords) || coords.length < 2) {
            return;
        }
        this.waypoints[index] = coords.slice();
    }

    /**
     * Get waypoint at index
     * @param {number} index - Waypoint index
     * @returns {Array|null} Waypoint coordinates or null
     */
    getWaypoint(index) {
        if (index < 0 || index >= this.waypoints.length) {
            return null;
        }
        return this.waypoints[index];
    }

    /**
     * Clear all waypoints
     */
    clearWaypoints() {
        this.waypoints = [];
        this.waypointHistory = [];
        this.waypointRedoHistory = [];
    }

    /**
     * Create a history snapshot of current state
     * @returns {Object} Snapshot with waypoints, routeCuts, legSegments
     */
    createHistorySnapshot() {
        const waypoints = this.cloneWaypoints();
        const routeCuts = this.callbacks.cloneRouteCuts();
        const legSegments = this.cloneCachedLegSegments();
        return { waypoints, routeCuts, legSegments };
    }

    /**
     * Record current state to history (before making changes)
     */
    recordState() {
        const snapshot = this.createHistorySnapshot();
        if (!snapshot || !Array.isArray(snapshot.waypoints)) {
            return;
        }
        this.waypointHistory.push(snapshot);
        this.trimHistoryStack(this.waypointHistory);
        this.waypointRedoHistory = [];
        this.callbacks.onHistoryChanged();
    }

    /**
     * Undo last waypoint change
     * @returns {boolean} True if undo was successful
     */
    undo() {
        if (!this.waypointHistory.length) {
            return false;
        }
        const previous = this.waypointHistory.pop();
        const currentSnapshot = this.createHistorySnapshot();

        const restored = this.restoreFromSnapshot(previous);
        if (!restored) {
            this.callbacks.onHistoryChanged();
            return false;
        }

        if (currentSnapshot && Array.isArray(currentSnapshot.waypoints)) {
            this.waypointRedoHistory.push(currentSnapshot);
            this.trimHistoryStack(this.waypointRedoHistory);
        }

        this.callbacks.onHistoryChanged();
        return true;
    }

    /**
     * Redo last undone change
     * @returns {boolean} True if redo was successful
     */
    redo() {
        if (!this.waypointRedoHistory.length) {
            return false;
        }
        const next = this.waypointRedoHistory.pop();
        const currentSnapshot = this.createHistorySnapshot();

        const restored = this.restoreFromSnapshot(next);
        if (!restored) {
            this.callbacks.onHistoryChanged();
            return false;
        }

        if (currentSnapshot && Array.isArray(currentSnapshot.waypoints)) {
            this.waypointHistory.push(currentSnapshot);
            this.trimHistoryStack(this.waypointHistory);
        }

        this.callbacks.onHistoryChanged();
        return true;
    }

    /**
     * Restore state from a snapshot
     * @param {Object} snapshot - Snapshot to restore
     * @returns {boolean} True if restoration was successful
     */
    restoreFromSnapshot(snapshot) {
        if (!snapshot) {
            return false;
        }

        let waypointSnapshot = null;
        let routeCutSnapshot = [];
        let legSegmentsSnapshot = null;

        if (Array.isArray(snapshot)) {
            waypointSnapshot = this.cloneWaypoints(snapshot);
        } else if (Array.isArray(snapshot.waypoints)) {
            waypointSnapshot = this.cloneWaypoints(snapshot.waypoints);
            routeCutSnapshot = Array.isArray(snapshot.routeCuts) ? snapshot.routeCuts : [];
            if (Array.isArray(snapshot.legSegments)) {
                legSegmentsSnapshot = snapshot.legSegments;
            }
        }

        if (!Array.isArray(waypointSnapshot)) {
            return false;
        }

        this.waypoints = waypointSnapshot;
        this.callbacks.setRouteCutDistances(routeCutSnapshot);

        if (legSegmentsSnapshot) {
            this.restoreCachedLegSegments(legSegmentsSnapshot);
        }

        return true;
    }

    /**
     * Trim history stack to limit
     * @param {Array} stack - History stack to trim
     */
    trimHistoryStack(stack) {
        if (!Array.isArray(stack)) {
            return;
        }
        if (stack.length > WAYPOINT_HISTORY_LIMIT) {
            stack.splice(0, stack.length - WAYPOINT_HISTORY_LIMIT);
        }
    }

    /**
     * Check if undo is available
     * @returns {boolean} True if can undo
     */
    canUndo() {
        return this.waypointHistory.length > 0;
    }

    /**
     * Check if redo is available
     * @returns {boolean} True if can redo
     */
    canRedo() {
        return this.waypointRedoHistory.length > 0;
    }

    /**
     * Build waypoint display features for GeoJSON source
     * @returns {Object} GeoJSON FeatureCollection
     */
    buildWaypointFeatures() {
        const total = this.waypoints.length;
        const features = this.waypoints.map((coords, index) => {
            const color = this.callbacks.resolveWaypointColor(coords, index, total);
            return createWaypointFeature(coords, index, total, { color });
        });
        return {
            type: 'FeatureCollection',
            features
        };
    }

    /**
     * Update the map waypoints source with current state
     */
    updateMapSource() {
        if (!this.map) return;
        const source = this.map.getSource('waypoints');
        if (!source) return;
        source.setData(this.buildWaypointFeatures());
    }

    /**
     * Check if two coordinates match (within epsilon)
     * @param {Array} a - First coordinate
     * @param {Array} b - Second coordinate
     * @returns {boolean} True if coordinates match
     */
    coordinatesMatch(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b)) {
            return false;
        }
        if (a.length < 2 || b.length < 2) {
            return false;
        }
        return (
            Math.abs(a[0] - b[0]) < COORD_EPSILON &&
            Math.abs(a[1] - b[1]) < COORD_EPSILON
        );
    }

    /**
     * Reverse the waypoints order
     */
    reverse() {
        this.waypoints.reverse();
    }

    /**
     * Get start waypoint
     * @returns {Array|null} Start coordinates or null
     */
    getStart() {
        return this.waypoints.length > 0 ? this.waypoints[0] : null;
    }

    /**
     * Get end waypoint
     * @returns {Array|null} End coordinates or null
     */
    getEnd() {
        return this.waypoints.length > 0 ? this.waypoints[this.waypoints.length - 1] : null;
    }
}
