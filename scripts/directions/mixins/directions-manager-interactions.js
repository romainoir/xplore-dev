import {
  EMPTY_COLLECTION,
  HOVER_PIXEL_TOLERANCE,
  ROUTE_CLICK_PIXEL_TOLERANCE
} from '../constants/directions-constants.js';

import { escapeHtml } from '../utils/directions-utils.js';

import { SEGMENT_MARKER_LAYER_ID } from '../constants/directions-visual-constants.js';

import {
  createWaypointFeature,
  toLngLat
} from '../markers/directions-markers.js';

import {
  formatSacScaleLabel,
  formatSurfaceLabel,
  formatTrailVisibilityLabel
} from '../utils/directions-profile-utils.js';


export class DirectionsManagerInteractionsMixin {
  isPanelVisible() {
    return Boolean(this.directionsControl?.classList.contains('visible'));
  }

  setPanelVisible(shouldShow) {
    const visible = Boolean(shouldShow);
    console.log('[DirectionsManager] setPanelVisible:', visible, {
      control: !!this.directionsControl,
      toggle: !!this.directionsToggle,
      dock: !!this.directionsDock
    });
    if (this.directionsControl) {
      this.directionsControl.classList.toggle('visible', visible);
    }
    if (this.directionsToggle) {
      this.directionsToggle.classList.toggle('active', visible);
    }

    // Mutual exclusivity: if directions panel is opening, close the library
    if (visible && this.routeLibraryManager) {
      // Find the RouteLibraryUI instance or just use a custom event if we don't have direct access
      // Given the architecture, we know RouteLibraryUI is likely registered or we can just trigger the close logic
      const libraryDock = document.getElementById('routeLibraryDock');
      const libraryToggle = document.getElementById('libraryToggle');
      if (libraryDock && libraryDock.classList.contains('visible')) {
        libraryDock.classList.remove('visible');
        libraryDock.setAttribute('aria-hidden', 'true');
        if (libraryToggle) {
          libraryToggle.classList.remove('active');
          libraryToggle.setAttribute('aria-expanded', 'false');
        }
      }
    }

    this.updatePanelVisibilityState();

    // Show/hide routing start tooltip based on visibility and waypoints
    this.updateRoutingStartTooltip();
  }

  updateRoutingStartTooltip() {
    const tooltip = document.getElementById('routingStartTooltip');
    if (!tooltip) return;

    const shouldShow = this.isPanelVisible() && (!Array.isArray(this.waypoints) || this.waypoints.length === 0);
    tooltip.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
  }

  updatePanelVisibilityState() {
    const isVisible = this.isPanelVisible();
    if (this.directionsToggle) {
      this.directionsToggle.setAttribute('aria-expanded', isVisible ? 'true' : 'false');
    }
    if (this.directionsControl) {
      this.directionsControl.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
    }
    if (this.routeStats) {
      this.routeStats.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
    }
    this.updateElevationVisibilityState();
    if (!isVisible) {
      this.hideRouteHover();
    }
  }

  updateElevationVisibilityState() {
    const panelVisible = this.isPanelVisible();
    const hideContent = !panelVisible || this.isElevationCollapsed;
    if (this.elevationCard) {
      this.elevationCard.classList.toggle('chart-card--collapsed', this.isElevationCollapsed);
      this.elevationCard.classList.toggle('elevation-section--collapsed', this.isElevationCollapsed);
    }
    if (this.elevationChartBody) {
      this.elevationChartBody.hidden = this.isElevationCollapsed;
      this.elevationChartBody.setAttribute('aria-hidden', hideContent ? 'true' : 'false');
    }
    if (this.elevationChart) {
      this.elevationChart.setAttribute('aria-hidden', hideContent ? 'true' : 'false');
    }
    if (this.elevationCollapseToggle) {
      this.elevationCollapseToggle.setAttribute('aria-expanded', this.isElevationCollapsed ? 'false' : 'true');
      const collapseLabel = this.isElevationCollapsed ? 'Show elevation' : 'Hide elevation';
      this.elevationCollapseToggle.setAttribute('aria-label', collapseLabel);
      if (this.elevationCollapseLabel) {
        this.elevationCollapseLabel.textContent = collapseLabel;
      }
    }
    if (hideContent) {
      this.detachElevationChartEvents();
    } else {
      this.attachElevationChartEvents();
      this.updateElevationMarkerPositions();
    }
  }

  setElevationCollapsed(collapsed) {
    this.isElevationCollapsed = Boolean(collapsed);

    // Update toggle button and container classes in stats if it exists
    if (this.routeStats) {
      const isExpanded = !this.isElevationCollapsed;
      this.routeStats.classList.toggle('is-expanded', isExpanded);
      this.routeStats.classList.toggle('is-collapsed', !isExpanded);

      const toggle = this.routeStats.querySelector('#routeStatsToggle');
      if (toggle) {
        toggle.classList.toggle('is-active', isExpanded);
        toggle.setAttribute('aria-expanded', isExpanded);
        toggle.title = isExpanded ? 'Réduire' : 'Développer';
        const expandIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>';
        const retractIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="10" y1="14" x2="3" y2="21"></line></svg>';
        toggle.innerHTML = isExpanded ? retractIcon : expandIcon;
      }
    }

    // When expanding, refresh elevation data in case terrain tiles have loaded since route was opened
    if (!this.isElevationCollapsed && this.routeProfile) {
      if (typeof this.refreshElevationProfile === 'function') {
        // Force a refresh to get latest terrain data
        this.refreshElevationProfile();
      }
    }

    this.updateElevationVisibilityState();
  }

  ensurePanelVisible() {
    if (!this.isPanelVisible()) {
      this.setPanelVisible(true);
    }
  }

  onWaypointMouseDown(event) {
    if (!this.isPanelVisible()) return;
    const feature = event.features?.[0];
    if (!feature) return;
    this.isDragging = true;
    this.draggedWaypointIndex = Number(feature.properties.index);
    this.setHoveredWaypointIndex(this.draggedWaypointIndex);
    this.map.dragPan?.disable();
    // Change cursor to grabbing
    this.map.getCanvas().style.cursor = 'grabbing';

    // Store neighbor waypoints for drag preview visualization
    const waypointIndex = this.draggedWaypointIndex;
    this._dragPrevNeighbor = this.waypoints[waypointIndex - 1]?.slice(0, 2) ?? null;
    this._dragNextNeighbor = this.waypoints[waypointIndex + 1]?.slice(0, 2) ?? null;

    // Store the segment color at this waypoint's position for consistent preview coloring
    // Estimate distance based on waypoint index
    if (this.routeProfile && Number.isFinite(this.routeProfile.totalDistanceKm) && this.waypoints.length > 1) {
      const fraction = waypointIndex / (this.waypoints.length - 1);
      const estimatedDistanceKm = fraction * this.routeProfile.totalDistanceKm;
      this._dragSegmentColor = this.getColorForDistance(estimatedDistanceKm);
    } else {
      this._dragSegmentColor = this.modeColors[this.currentMode];
    }

    // Store the routing mode of the adjacent segments so new segments inherit it
    // Check the segment before and after this waypoint - use the mode of either
    // Priority: if both exist and have different modes, prefer the previous segment's mode
    const prevLeg = this.cachedLegSegments?.get(waypointIndex - 1);
    const nextLeg = this.cachedLegSegments?.get(waypointIndex);
    const prevMode = prevLeg?.routingMode;
    const nextMode = nextLeg?.routingMode;
    // Use prevMode if available, otherwise nextMode, otherwise current global mode
    this._dragSegmentMode = prevMode || nextMode || this.currentMode;
  }

  /**
   * Handle mouse entering a waypoint for hover effects
   */
  onWaypointMouseEnter(event) {
    if (!this.isPanelVisible() || this.isDragging) return;
    const feature = event.features?.[0];
    if (!feature) return;

    const role = feature.properties?.role;

    // Show grab cursor
    this.map.getCanvas().style.cursor = 'grab';

    // Scale up the flag icons for start/end waypoints
    if ((role === 'start' || role === 'end') && this.map.getLayer(SEGMENT_MARKER_LAYER_ID)) {
      const type = role; // 'start' or 'end'
      this._hoveredMarkerType = type;

      this.map.setLayoutProperty(SEGMENT_MARKER_LAYER_ID, 'icon-size', [
        'interpolate',
        ['linear'],
        ['zoom'],
        8,
        ['match', ['get', 'type'],
          type, 0.75,  // Hover size for flag (larger)
          'bivouac', 0.4,
          0.55
        ],
        12,
        ['match', ['get', 'type'],
          type, 1.0,  // Hover size (larger)
          'bivouac', 0.6,
          0.75
        ],
        16,
        ['match', ['get', 'type'],
          type, 1.25,  // Hover size (larger)
          'bivouac', 0.8,
          0.95
        ]
      ]);
    }
  }

  /**
   * Handle mouse leaving a waypoint
   */
  onWaypointMouseLeave(event) {
    if (!this.isPanelVisible()) return;

    // Restore cursor only if not dragging
    if (!this.isDragging) {
      this.map.getCanvas().style.cursor = '';
    }

    // Restore icon sizes
    if (this._hoveredMarkerType && this.map.getLayer(SEGMENT_MARKER_LAYER_ID)) {
      this._hoveredMarkerType = null;
      this.map.setLayoutProperty(SEGMENT_MARKER_LAYER_ID, 'icon-size', [
        'interpolate',
        ['linear'],
        ['zoom'],
        8,
        ['match', ['get', 'type'], 'bivouac', 0.4, 0.55],
        12,
        ['match', ['get', 'type'], 'bivouac', 0.6, 0.75],
        16,
        ['match', ['get', 'type'], 'bivouac', 0.8, 0.95]
      ]);
    }
  }

  onSegmentMarkerMouseDown(event) {
    if (!this.isPanelVisible()) return;
    const feature = event.features?.[0];
    const type = feature?.properties?.type;

    // Handle start/end markers (departure/arrival)
    // Click on start marker creates a loop, drag moves the marker
    if (type === 'start' || type === 'end') {
      const waypointIndex = type === 'start' ? 0 : this.waypoints.length - 1;
      if (waypointIndex >= 0 && waypointIndex < this.waypoints.length) {
        // Store pending info for click vs drag detection
        this._pendingStartEndDrag = {
          type,
          waypointIndex,
          startLngLat: event?.lngLat ? [event.lngLat.lng, event.lngLat.lat] : null,
          startTime: Date.now()
        };

        // Set timeout to activate drag after short delay (200ms)
        // If released before timeout, it's a click
        this._startEndDragTimeout = setTimeout(() => {
          if (this._pendingStartEndDrag) {
            this.isDragging = true;
            this.draggedWaypointIndex = this._pendingStartEndDrag.waypointIndex;
            this.setHoveredWaypointIndex(this._pendingStartEndDrag.waypointIndex);
            this.map.dragPan?.disable();
            this.map.getCanvas().style.cursor = 'grabbing';
          }
        }, 200);

        event.preventDefault?.();
        event.originalEvent?.preventDefault?.();
      }
      return;
    }

    // Handle bivouac markers
    if (type !== 'bivouac') {
      return;
    }

    const order = Number(feature.properties?.order);
    const cutIndex = Number.isFinite(order) ? order - 1 : null;
    if (!Number.isInteger(cutIndex) || cutIndex < 0) {
      return;
    }

    if (!Array.isArray(this.routeCutDistances) || cutIndex >= this.routeCutDistances.length) {
      return;
    }

    // Store pending drag info but don't start drag immediately
    // Require a long press (300ms) before drag activates
    this._pendingBivouacDrag = {
      cutIndex,
      startLngLat: event?.lngLat ? [event.lngLat.lng, event.lngLat.lat] : null,
      startTime: Date.now()
    };

    // Set timeout to activate drag after long press
    this._bivouacDragTimeout = setTimeout(() => {
      if (this._pendingBivouacDrag) {
        this.isDragging = true;
        this.draggedWaypointIndex = null;
        this.draggedBivouacIndex = this._pendingBivouacDrag.cutIndex;
        if (this._pendingBivouacDrag.startLngLat) {
          this.draggedBivouacLngLat = this._pendingBivouacDrag.startLngLat;
          this.updateSegmentMarkers();
        }
        this.map.dragPan?.disable();
        // Change cursor to indicate dragging is active
        this.map.getCanvas().style.cursor = 'grabbing';
      }
    }, 300);

    event.preventDefault?.();
    event.originalEvent?.preventDefault?.();
  }
  /**
   * Handle mousedown on the map to enable click-and-drag via point insertion.
   * When LEFT-clicking on a hovered route segment, creates a via point and starts dragging it.
   * Right-click is handled by contextmenu for bivouac creation.
   */
  onMapMouseDown(event) {
    if (!this.isPanelVisible() || this.isDragging) return;

    // Only handle left mouse button (button === 0)
    // Right-click (button === 2) should still create bivouacs via contextmenu
    if (event.originalEvent?.button !== 0) return;

    // Skip if clicking on waypoints or bivouac markers (handled by their own handlers)
    const hitWaypoints = this.map.queryRenderedFeatures(event.point, { layers: ['waypoints-hit-area'] });
    if (hitWaypoints.length) return;

    const hitBivouacs = this.map.queryRenderedFeatures(event.point, { layers: [SEGMENT_MARKER_LAYER_ID] });
    if (hitBivouacs.length) return;

    // Check if we're hovering over the route (have a hovered segment)
    if (this.hoveredSegmentIndex === null || this.waypoints.length < 2) return;

    // Project click onto route to get insert position
    const projection = this.projectOntoRoute(event.lngLat, ROUTE_CLICK_PIXEL_TOLERANCE);
    if (!projection) return;

    const segmentIndex = Number.isInteger(projection.segmentIndex)
      ? projection.segmentIndex
      : this.hoveredSegmentIndex;

    // Find the leg index for this segment
    const segment = this.routeSegments?.[segmentIndex];
    if (!segment) return;

    // Calculate insert index - determine which leg this segment belongs to
    let insertIndex = 1;
    let legIndex = segment.legIndex;

    // If legIndex is not set, try to determine it from segment position
    if (!Number.isInteger(legIndex)) {
      // Find which leg contains this segment by comparing its distance to waypoint distances
      const segmentDistanceKm = segment.startDistanceKm ?? 0;
      const waypointDistances = this.getWaypointDistances();

      // Find the leg that contains this distance
      for (let i = 0; i < waypointDistances.length - 1; i++) {
        const legStart = waypointDistances[i];
        const legEnd = waypointDistances[i + 1];
        if (segmentDistanceKm >= legStart && segmentDistanceKm < legEnd) {
          legIndex = i;
          break;
        }
      }
      // If still not found, default to last leg
      if (!Number.isInteger(legIndex) && waypointDistances.length > 1) {
        legIndex = waypointDistances.length - 2;
      }
    }

    if (Number.isInteger(legIndex)) {
      insertIndex = Math.min(this.waypoints.length, Math.max(0, legIndex) + 1);
    }
    insertIndex = Math.max(1, insertIndex);

    // Get the projected coordinates for the via point
    const projectedCoords = Array.isArray(projection.projection?.coordinates)
      ? projection.projection.coordinates.slice()
      : [event.lngLat.lng, event.lngLat.lat];

    // Store neighbor waypoint coordinates BEFORE inserting (for correct drag preview)
    // Use legIndex to get exact waypoint neighbors of this leg
    const prevNeighborCoords = Number.isInteger(legIndex) && this.waypoints[legIndex]
      ? this.waypoints[legIndex].slice(0, 2)
      : this.waypoints[insertIndex - 1]?.slice(0, 2) ?? null;
    const nextNeighborCoords = Number.isInteger(legIndex) && this.waypoints[legIndex + 1]
      ? this.waypoints[legIndex + 1].slice(0, 2)
      : this.waypoints[insertIndex]?.slice(0, 2) ?? null;

    // IMPORTANT: Capture segment color and mode BEFORE inserting waypoint and updating state
    // This ensures we get the correct values before the route is recalculated
    const dragDistanceKm = Number.isFinite(projection.distanceKm)
      ? projection.distanceKm
      : (segment?.startDistanceKm ?? 0);
    const capturedSegmentColor = this.getColorForDistance(dragDistanceKm);
    const cachedLeg = this.cachedLegSegments?.get(legIndex);
    const capturedSegmentMode = cachedLeg?.routingMode || this.currentMode;

    // Record state for undo
    this.recordWaypointState();

    // Insert via waypoint at the projected location
    const waypoint = this.buildWaypointCoordinate(projectedCoords) ?? projectedCoords;
    this.waypoints.splice(insertIndex, 0, waypoint);
    // IMPORTANT: Re-index cached leg segments AFTER insertion
    // This ensures segments after the insertion point get their indices shifted
    // e.g., if we insert at index 3, segment at cache[3] becomes cache[4], etc.
    this.shiftCachedLegSegments(insertIndex, 1);
    this.updateWaypoints();

    // Immediately start dragging the inserted waypoint
    this.isDragging = true;
    this.draggedWaypointIndex = insertIndex;
    this._viaInsertedByDrag = true; // Flag to prevent click handler from adding another point
    this._dragPrevNeighbor = prevNeighborCoords; // Store for updateDragPreview
    this._dragNextNeighbor = nextNeighborCoords; // Store for updateDragPreview
    // Use pre-captured color and mode for consistent behavior
    this._dragSegmentColor = capturedSegmentColor;
    this._dragSegmentMode = capturedSegmentMode;
    this.setHoveredWaypointIndex(insertIndex);
    this.map.dragPan?.disable();

    // Hide the route hover point since we're now dragging a waypoint
    this.resetSegmentHover('map');

    event.preventDefault?.();
    event.originalEvent?.preventDefault?.();
  }

  onMapMouseMove(event) {
    if (!this.isPanelVisible()) return;

    // Dragging operations should not be throttled for responsiveness
    if (this.isDragging && this.draggedWaypointIndex !== null) {
      const coords = [event.lngLat.lng, event.lngLat.lat];
      this.waypoints[this.draggedWaypointIndex] = this.buildWaypointCoordinate(coords) ?? coords;
      this.updateWaypoints();

      // Show drag preview lines (dashed lines from neighbors to drag position)
      this.updateDragPreview(this.draggedWaypointIndex, coords);

      // Update the waypoint hover drag circle color to match the route segment color
      this.updateDragWaypointColor(this.draggedWaypointIndex);
    }

    if (this.isDragging && this.draggedBivouacIndex !== null) {
      if (event?.lngLat && Number.isFinite(event.lngLat.lng) && Number.isFinite(event.lngLat.lat)) {
        this.draggedBivouacLngLat = [event.lngLat.lng, event.lngLat.lat];
        this.updateSegmentMarkers();
      }
    }

    // Throttle non-drag mouse move handling to ~60fps max for performance
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!this.isDragging && this._lastMouseMoveTime && now - this._lastMouseMoveTime < 16) {
      return;
    }
    this._lastMouseMoveTime = now;

    const features = this.map.queryRenderedFeatures(event.point, { layers: ['waypoints-hit-area'] });
    if (features.length > 0) {
      const feature = features[0];
      const index = Number(feature.properties.index);
      const role = feature.properties.role;
      this.setHoveredWaypointIndex(index);
      if (!this.isDragging && role === 'via') {
        this.resetSegmentHover('map');
        return;
      }
      if (this.isDragging) {
        return;
      }
    } else if (!this.isDragging) {
      this.setHoveredWaypointIndex(null);
    }

    if (!this.isDragging) {
      this.handleRouteSegmentHover(event);
    }
  }

  onMapMouseUp(event) {
    // Clear any pending start/end drag that wasn't activated
    if (this._startEndDragTimeout) {
      clearTimeout(this._startEndDragTimeout);
      this._startEndDragTimeout = null;
    }
    // Note: Don't clear _pendingStartEndDrag here - let onBivouacClick handle click detection

    if (!this.isDragging) return;
    const movedWaypoint = this.draggedWaypointIndex !== null;
    const movedWaypointIndex = this.draggedWaypointIndex;
    const movedBivouac = this.draggedBivouacIndex !== null;
    // Capture the segment mode before clearing drag state
    // This is the mode of the original segment that was being dragged
    const dragSegmentMode = this._dragSegmentMode;
    this.isDragging = false;
    this.draggedWaypointIndex = null;
    this.map.dragPan?.enable();
    this.setHoveredWaypointIndex(null);
    // Clear drag preview lines and stored neighbor coords
    this.clearDragPreview();
    this.resetDragWaypointColor();
    this._dragPrevNeighbor = null;
    this._dragNextNeighbor = null;
    this._dragSegmentColor = null;
    this._dragSegmentMode = null;

    if (movedWaypoint && this.waypoints.length >= 2) {
      const startLeg = Math.max(0, movedWaypointIndex - 1);
      const endLeg = Math.min(this.waypoints.length - 2, movedWaypointIndex);
      this.invalidateCachedLegSegments({ startIndex: startLeg, endIndex: endLeg });

      // Use the original segment's mode for new segments created by dragging
      // This ensures dragging from a manual segment creates manual segments,
      // and dragging from a snapped segment creates snapped segments
      // INDEPENDENT of the current global mode setting
      if (dragSegmentMode && dragSegmentMode !== this.currentMode) {
        const originalMode = this.currentMode;
        this.currentMode = dragSegmentMode;
        this.getRoute().finally(() => {
          // Restore the original global mode after route calculation
          this.currentMode = originalMode;
        });
      } else {
        this.getRoute();
      }
    }
    if (movedBivouac) {
      const releaseLngLat = event?.lngLat ?? null;
      this.finishBivouacDrag(releaseLngLat);
      this.draggedBivouacIndex = null;
    }
  }

  /**
   * Update the drag preview visualization showing dashed lines
   * from neighboring waypoints to the current drag position.
   * Takes into account both waypoints and bivouacs as intermediate points.
   */
  updateDragPreview(waypointIndex, dragCoords) {
    const source = this.map.getSource('drag-preview-source');
    if (!source) return;

    const features = [];

    // Collect all key points on the route (waypoints + bivouacs) sorted by distance
    const getAllRouteKeyPoints = () => {
      const points = [];

      // Add all waypoints with their estimated distances
      const totalDistance = this.routeProfile?.totalDistanceKm ?? 0;
      const waypointCount = this.waypoints.length;

      this.waypoints.forEach((coords, idx) => {
        if (!Array.isArray(coords) || coords.length < 2) return;
        // Estimate distance for this waypoint
        let distanceKm = 0;
        if (waypointCount > 1 && totalDistance > 0) {
          distanceKm = (idx / (waypointCount - 1)) * totalDistance;
        }
        points.push({
          type: 'waypoint',
          index: idx,
          coordinates: coords.slice(0, 2),
          distanceKm
        });
      });

      // Add bivouac coordinates from cutSegments
      if (Array.isArray(this.cutSegments) && this.cutSegments.length > 1) {
        this.cutSegments.forEach((segment, idx) => {
          // Each segment except the first has a bivouac at its start
          if (idx > 0 && segment.startKm != null) {
            const bivouacCoords = this.getCoordinateAtDistance(segment.startKm);
            if (Array.isArray(bivouacCoords) && bivouacCoords.length >= 2) {
              points.push({
                type: 'bivouac',
                index: idx,
                coordinates: bivouacCoords.slice(0, 2),
                distanceKm: segment.startKm
              });
            }
          }
        });
      }

      // Sort all points by distance
      points.sort((a, b) => a.distanceKm - b.distanceKm);
      return points;
    };

    // Get neighbors for the dragged waypoint (considering both waypoints AND bivouacs)
    const findNeighbors = () => {
      // If we have stored neighbors (from onMapMouseDown or onWaypointMouseDown), use them first
      const storedPrev = this._dragPrevNeighbor;
      const storedNext = this._dragNextNeighbor;

      // Get all key points including bivouacs
      const keyPoints = getAllRouteKeyPoints();

      // Find the current waypoint in keyPoints
      const currentWaypointPoint = keyPoints.find(p => p.type === 'waypoint' && p.index === waypointIndex);
      if (!currentWaypointPoint) {
        // Fallback to stored or waypoint neighbors
        return {
          prev: storedPrev ?? this.waypoints[waypointIndex - 1]?.slice(0, 2),
          next: storedNext ?? this.waypoints[waypointIndex + 1]?.slice(0, 2)
        };
      }

      // Find the index in sorted keyPoints
      const sortedIndex = keyPoints.indexOf(currentWaypointPoint);

      // Get previous and next points (could be waypoints or bivouacs)
      const prevPoint = sortedIndex > 0 ? keyPoints[sortedIndex - 1] : null;
      const nextPoint = sortedIndex < keyPoints.length - 1 ? keyPoints[sortedIndex + 1] : null;

      return {
        prev: prevPoint?.coordinates ?? storedPrev ?? this.waypoints[waypointIndex - 1]?.slice(0, 2),
        next: nextPoint?.coordinates ?? storedNext ?? this.waypoints[waypointIndex + 1]?.slice(0, 2)
      };
    };

    const neighbors = findNeighbors();
    const prevCoords = neighbors.prev;
    const nextCoords = neighbors.next;

    // Get the appropriate color for the drag preview
    // Use the color stored at drag start for consistency
    const getPreviewColor = () => {
      // Priority 1: Use the color stored when drag started
      if (this._dragSegmentColor) {
        return this._dragSegmentColor;
      }
      // Priority 2: Try to get the color based on the drag position using getColorForDistance
      if (this.routeProfile && Number.isFinite(this.routeProfile.totalDistanceKm)) {
        const totalWaypoints = this.waypoints.length;
        if (totalWaypoints > 1) {
          const fraction = waypointIndex / (totalWaypoints - 1);
          const estimatedDistance = fraction * this.routeProfile.totalDistanceKm;
          const color = this.getColorForDistance(estimatedDistance);
          if (color) return color;
        }
      }
      // Priority 3: Fall back to cut segments
      if (Array.isArray(this.cutSegments) && this.cutSegments.length > 0) {
        return this.cutSegments[0]?.color ?? this.modeColors[this.currentMode];
      }
      return this.modeColors[this.currentMode];
    };

    const previewColor = getPreviewColor();

    // Line from previous waypoint to drag position
    if (prevCoords) {
      features.push({
        type: 'Feature',
        properties: { color: previewColor },
        geometry: {
          type: 'LineString',
          coordinates: [prevCoords, dragCoords]
        }
      });
    }

    // Line from drag position to next waypoint
    if (nextCoords) {
      features.push({
        type: 'Feature',
        properties: { color: previewColor },
        geometry: {
          type: 'LineString',
          coordinates: [dragCoords, nextCoords]
        }
      });
    }

    source.setData({
      type: 'FeatureCollection',
      features
    });
  }

  /**
   * Clear the drag preview visualization.
   */
  clearDragPreview() {
    const source = this.map.getSource('drag-preview-source');
    if (source) {
      source.setData(EMPTY_COLLECTION);
    }
  }

  /**
  * Update the color of the waypoint-hover-drag circle during drag
  * to match the current route segment color.
  */
  updateDragWaypointColor(waypointIndex) {
    if (!this.map.getLayer('waypoint-hover-drag')) return;

    // Priority 1: Use the color stored when drag started
    let dragColor = this._dragSegmentColor;

    // Priority 2: Calculate based on position if not stored
    if (!dragColor) {
      dragColor = this.modeColors[this.currentMode];
      if (this.routeProfile && Number.isFinite(this.routeProfile.totalDistanceKm)) {
        const totalWaypoints = this.waypoints.length;
        if (totalWaypoints > 1) {
          const fraction = waypointIndex / (totalWaypoints - 1);
          const estimatedDistance = fraction * this.routeProfile.totalDistanceKm;
          const color = this.getColorForDistance(estimatedDistance);
          if (color) dragColor = color;
        }
      } else if (Array.isArray(this.cutSegments) && this.cutSegments.length > 0) {
        dragColor = this.cutSegments[0]?.color ?? dragColor;
      }
    }

    // Update the layer's stroke color for the dragged waypoint
    try {
      this.map.setPaintProperty('waypoint-hover-drag', 'circle-stroke-color', dragColor);
    } catch (error) {
      // Ignore errors if layer doesn't support dynamic updates
    }
  }

  /**
   * Reset the waypoint-hover-drag color to its default expression.
   */
  resetDragWaypointColor() {
    if (!this.map.getLayer('waypoint-hover-drag')) return;
    try {
      this.map.setPaintProperty('waypoint-hover-drag', 'circle-stroke-color', '#ffffff');
    } catch (error) {
      // Ignore errors
    }
  }

  /**
   * Get cumulative distances (in km) at each waypoint position.
   * Used to determine which leg a route segment belongs to.
   * @returns {number[]} Array of cumulative distances, one per waypoint
   */
  getWaypointDistances() {
    const distances = [0];

    // If we have route profile with day data, use it
    if (this.routeProfile?.totalDistanceKm && this.waypoints.length >= 2) {
      // Find waypoint positions in the route by matching coordinates
      const routeCoords = this.routeGeojson?.geometry?.coordinates;
      if (Array.isArray(routeCoords) && routeCoords.length >= 2) {
        let cumulativeKm = 0;
        let waypointIdx = 1;

        for (let i = 0; i < routeCoords.length - 1 && waypointIdx < this.waypoints.length; i++) {
          const coord = routeCoords[i];
          const nextCoord = routeCoords[i + 1];

          // Calculate segment distance
          const segDist = this.haversineDistance(coord[1], coord[0], nextCoord[1], nextCoord[0]);
          cumulativeKm += segDist;

          // Check if next waypoint matches next coord (approximately)
          const waypoint = this.waypoints[waypointIdx];
          if (waypoint && this.coordinatesMatch(waypoint, nextCoord)) {
            distances.push(cumulativeKm);
            waypointIdx++;
          }
        }

        // If we didn't find all waypoints, add the total distance for remaining
        while (distances.length < this.waypoints.length) {
          distances.push(this.routeProfile.totalDistanceKm);
        }
      }
    }

    // Fallback: split total distance evenly between waypoints
    if (distances.length < this.waypoints.length && this.waypoints.length >= 2) {
      const totalKm = this.routeProfile?.totalDistanceKm ?? 0;
      const numLegs = this.waypoints.length - 1;
      for (let i = 1; i < this.waypoints.length; i++) {
        distances[i] = (i / numLegs) * totalKm;
      }
    }

    return distances;
  }

  async onMapClick(event) {
    if (!this.isPanelVisible() || this.isDragging) return;

    // Skip if via waypoint was already inserted by drag
    if (this._viaInsertedByDrag) {
      this._viaInsertedByDrag = false;
      return;
    }

    // Skip if bivouac was clicked (handled separately)
    if (this._bivouacClickHandled) return;

    // If bivouac popup is open, close it and don't add a waypoint
    if (this.bivouacPopup && this.bivouacPopup.isOpen?.()) {
      this.bivouacPopup.remove();
      return;
    }

    // Check if click was on a segment marker (bivouac)
    const hitSegmentMarkers = this.map.queryRenderedFeatures(event.point, { layers: [SEGMENT_MARKER_LAYER_ID] });
    if (hitSegmentMarkers.length) return;

    const hitWaypoints = this.map.queryRenderedFeatures(event.point, { layers: ['waypoints-hit-area'] });
    if (hitWaypoints.length) return;

    const projection = this.projectOntoRoute(event.lngLat, ROUTE_CLICK_PIXEL_TOLERANCE);
    if (projection) {
      this.addViaWaypoint(event.lngLat, projection);
      return;
    }

    if (this.hoveredSegmentIndex !== null) {
      this.addViaWaypoint(event.lngLat);
      return;
    }

    let targetLngLat = [event.lngLat.lng, event.lngLat.lat];
    if (this.currentMode !== 'manual') {
      const snapped = await this.snapLngLatToNetwork(event.lngLat);
      if (Array.isArray(snapped) && snapped.length >= 2
        && Number.isFinite(snapped[0])
        && Number.isFinite(snapped[1])) {
        targetLngLat = [snapped[0], snapped[1]];
      }
    }
    this.recordWaypointState();
    const waypoint = this.buildWaypointCoordinate(targetLngLat) ?? targetLngLat.slice();
    this.waypoints.push(waypoint);
    this.updateWaypoints();
    if (this.waypoints.length === 1) {
      this.prepareNetwork({ reason: 'first-waypoint' });
    } else if (this.waypoints.length >= 2) {
      this.getRoute();
    }
    this.updateModeAvailability();
  }

  onWaypointDoubleClick(event) {
    if (!this.isPanelVisible()) return;
    const index = Number(event.features?.[0]?.properties.index);
    if (!Number.isFinite(index) || index <= 0 || index >= this.waypoints.length - 1) return;
    this.recordWaypointState();
    const removalIndex = index;
    const startLeg = Math.max(0, removalIndex - 1);
    const endLeg = Math.min(this.waypoints.length - 2, removalIndex);
    this.invalidateCachedLegSegments({ startIndex: startLeg, endIndex: endLeg });
    this.waypoints.splice(removalIndex, 1);
    this.shiftCachedLegSegments(removalIndex + 1, -1);
    this.updateWaypoints();
    if (this.waypoints.length >= 2) {
      this.getRoute();
    } else {
      this.clearRoute();
      this.updateStats(null);
      this.updateElevationProfile([]);
    }
  }

  /**
   * Handle right-click on a via waypoint to show context menu with remove option
   */
  onWaypointContextMenu(event) {
    if (!this.isPanelVisible()) return;

    event.preventDefault();

    const feature = event.features?.[0];
    if (!feature) return;

    const index = Number(feature.properties?.index);
    const role = feature.properties?.role;

    // Only show context menu for via points (not start or end)
    if (!Number.isFinite(index) || role === 'start' || role === 'end') return;
    if (index <= 0 || index >= this.waypoints.length - 1) return;

    // Set flag to prevent route context menu from also showing
    this._waypointContextMenuHandled = true;

    // Close any existing waypoint popup
    if (this.waypointContextPopup) {
      this.waypointContextPopup.remove();
      this.waypointContextPopup = null;
    }

    // Create popup content
    const popupContent = document.createElement('div');
    popupContent.className = 'waypoint-context-menu';
    popupContent.innerHTML = `
      <button type="button" class="waypoint-context-menu__item waypoint-context-menu__item--remove">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        <span>Remove waypoint</span>
      </button>
    `;

    // Add click handler for remove button
    const removeBtn = popupContent.querySelector('.waypoint-context-menu__item--remove');
    removeBtn.addEventListener('click', () => {
      this.waypointContextPopup?.remove();
      this.waypointContextPopup = null;

      // Remove the waypoint (same logic as double-click)
      this.recordWaypointState();
      const removalIndex = index;
      const startLeg = Math.max(0, removalIndex - 1);
      const endLeg = Math.min(this.waypoints.length - 2, removalIndex);
      this.invalidateCachedLegSegments({ startIndex: startLeg, endIndex: endLeg });
      this.waypoints.splice(removalIndex, 1);
      this.shiftCachedLegSegments(removalIndex + 1, -1);
      this.updateWaypoints();
      if (this.waypoints.length >= 2) {
        this.getRoute();
      } else {
        this.clearRoute();
        this.updateStats(null);
        this.updateElevationProfile([]);
      }
    });

    // Create and show the popup
    const coords = this.waypoints[index];
    if (!coords || coords.length < 2) return;

    this.waypointContextPopup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: true,
      className: 'waypoint-context-popup',
      anchor: 'bottom',
      offset: [0, -10]
    })
      .setLngLat([coords[0], coords[1]])
      .setDOMContent(popupContent)
      .addTo(this.map);
  }

  setHoveredWaypointIndex(index) {
    this.hoveredWaypointIndex = index;
    const target = Number.isInteger(index) ? index : -1;
    if (this.map.getLayer('waypoint-hover-drag')) {
      this.map.setFilter('waypoint-hover-drag', ['==', 'index', target]);
    }
  }

  handleRouteSegmentHover(event) {
    if (!this.routeSegments.length) {
      this.resetSegmentHover('map');
      return;
    }

    // Check if we're near a marker (bivouac, start, end) - if so, don't show route hover
    // This makes it easier to click on these markers
    // Radius is ~1.5x the symbol size for comfortable interaction
    const MARKER_EXCLUSION_RADIUS = 60; // pixels
    const markerFeatures = this.map.queryRenderedFeatures(event.point, {
      layers: [SEGMENT_MARKER_LAYER_ID]
    });
    const nearMarker = markerFeatures.some((feature) => {
      const type = feature.properties?.type;
      return type === 'bivouac' || type === 'start' || type === 'end';
    });

    if (nearMarker) {
      // Also check the wider radius for exclusion
      // Use cached markers to avoid recomputing on every mouse move
      const mousePixel = this.map.project(event.lngLat);
      const markers = this._cachedSegmentMarkers ?? this.computeSegmentMarkers();
      const isTooCloseToAnyMarker = markers.some((marker) => {
        const type = marker.type;
        if (!['bivouac', 'start', 'end'].includes(type) || !marker.coordinates) return false;
        const markerPixel = this.map.project(toLngLat(marker.coordinates));
        const dist = Math.hypot(mousePixel.x - markerPixel.x, mousePixel.y - markerPixel.y);
        return dist < MARKER_EXCLUSION_RADIUS;
      });

      if (isTooCloseToAnyMarker) {
        this.resetSegmentHover('map');
        return;
      }
    }

    const mousePixel = this.map.project(event.lngLat);
    let closestIndex = -1;
    let minDistance = Infinity;

    this.routeSegments.forEach((segment, index) => {
      const startPixel = this.map.project(toLngLat(segment.start));
      const endPixel = this.map.project(toLngLat(segment.end));
      const distance = this.pointToSegmentDistance(mousePixel, startPixel, endPixel);
      if (distance < minDistance && distance <= HOVER_PIXEL_TOLERANCE) {
        minDistance = distance;
        closestIndex = index;
      }
    });

    if (closestIndex === -1) {
      this.resetSegmentHover('map');
    } else {
      const segment = this.routeSegments[closestIndex];
      if (!segment) {
        this.resetSegmentHover('map');
        return;
      }
      const projection = this.projectPointOnSegment(event.lngLat, segment.start, segment.end);
      this.showRouteHoverOnSegment(closestIndex, projection, { mousePoint: event.point, source: 'map' });
    }
  }

  setHoveredSegment(index) {
    this.hoveredSegmentIndex = Number.isInteger(index) ? index : null;
    this.hoveredLegIndex = this.hoveredSegmentIndex !== null
      ? this.segmentLegLookup[this.hoveredSegmentIndex] ?? null
      : null;

    if (this.map.getLayer('route-segment-hover')) {
      const target = this.hoveredSegmentIndex ?? -1;
      this.map.setFilter('route-segment-hover', ['==', 'segmentIndex', target]);
    }
  }

  clearHover(source = null) {
    if (source && this.activeHoverSource && source !== this.activeHoverSource) {
      return;
    }
    this.activeHoverSource = null;
    this.setHoveredSegment(null);
    this.hideRouteHover();
  }

  resetSegmentHover(source = null) {
    this.clearHover(source);
  }

  async addViaWaypoint(lngLat, projectionOverride = null) {
    if (!lngLat || this.waypoints.length < 2) {
      return;
    }

    const ensureProjection = () => {
      if (projectionOverride) {
        return projectionOverride;
      }
      return this.projectOntoRoute(lngLat, ROUTE_CLICK_PIXEL_TOLERANCE);
    };

    const projectionResult = ensureProjection();
    let segmentIndex = Number.isInteger(projectionResult?.segmentIndex)
      ? projectionResult.segmentIndex
      : null;
    let snappedCoords = Array.isArray(projectionResult?.projection?.coordinates)
      ? projectionResult.projection.coordinates.slice()
      : null;

    if (!snappedCoords && this.hoveredSegmentIndex !== null) {
      const segment = this.routeSegments[this.hoveredSegmentIndex];
      if (segment) {
        const projection = this.projectPointOnSegment(lngLat, segment.start, segment.end);
        if (Array.isArray(projection?.coordinates)) {
          snappedCoords = projection.coordinates.slice();
          segmentIndex = this.hoveredSegmentIndex;
        }
      }
    }

    if (!Array.isArray(snappedCoords) || snappedCoords.length < 2) {
      return;
    }

    const [lng, lat] = snappedCoords;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return;
    }

    const snapped = [lng, lat];
    const alreadyExists = this.waypoints.some((coord) => this.coordinatesMatch(coord, snapped));
    if (alreadyExists) {
      this.resetSegmentHover();
      return;
    }

    let insertIndex = this.waypoints.length - 1;
    const projectedLeg = Number.isInteger(segmentIndex)
      ? this.segmentLegLookup?.[segmentIndex]
      : null;
    if (Number.isInteger(projectedLeg)) {
      insertIndex = Math.min(projectedLeg + 1, this.waypoints.length - 1);
    } else if (Number.isInteger(this.hoveredLegIndex)) {
      insertIndex = Math.min(this.hoveredLegIndex + 1, this.waypoints.length - 1);
    }

    insertIndex = Math.max(1, insertIndex);

    this.recordWaypointState();
    const waypoint = this.buildWaypointCoordinate(snapped) ?? snapped;
    this.waypoints.splice(insertIndex, 0, waypoint);
    this.shiftCachedLegSegments(insertIndex, 1);
    const startLeg = Math.max(0, insertIndex - 1);
    const endLeg = Math.min(this.waypoints.length - 2, insertIndex);
    this.invalidateCachedLegSegments({ startIndex: startLeg, endIndex: endLeg });
    this.updateWaypoints();
    this.resetSegmentHover();
    await this.prepareNetwork({ reason: 'via-inserted' });
    this.getRoute();
  }

  updateWaypoints() {
    const source = this.map.getSource('waypoints');
    if (!source) return;
    const total = this.waypoints.length;
    const features = this.waypoints.map((coords, index) => {
      const extras = this.buildWaypointDisplayProperties(coords, index, total);
      return createWaypointFeature(coords, index, total, extras);
    });
    source.setData({
      type: 'FeatureCollection',
      features
    });

    this.updateSegmentMarkers();

    // Hide the routing start tooltip once waypoints are placed
    this.updateRoutingStartTooltip();
  }

  buildWaypointDisplayProperties(coords, index, total) {
    const color = this.resolveWaypointColor(coords, index, total);
    return { color };
  }

  resolveWaypointColor(coords, index, total) {
    const fallback = this.modeColors[this.currentMode];
    if (!Array.isArray(coords) || coords.length < 2) {
      return fallback;
    }

    const isStart = index === 0;
    const isEnd = total > 1 && index === total - 1;
    const startFallback = '#2f8f3b';
    const endFallback = '#d64545';

    // Start and end use fixed colors
    if (isStart) {
      return startFallback;
    }
    if (isEnd) {
      return endFallback;
    }

    // For via waypoints, calculate actual cumulative distance from cached legs
    // to ensure consistency with route profile and manual route segments
    if (this.cachedLegSegments instanceof Map && this.cachedLegSegments.size > 0) {
      const legDistances = [];
      for (const segment of this.cachedLegSegments.values()) {
        const coords = Array.isArray(segment.coordinates) ? segment.coordinates : [];
        let dist = 0;
        for (let i = 1; i < coords.length; i++) {
          dist += this.computeDistanceKm(coords[i - 1], coords[i]);
        }
        legDistances.push(dist);
      }

      let cumulativeDistanceKm = 0;
      for (let i = 0; i < index && i < legDistances.length; i++) {
        cumulativeDistanceKm += legDistances[i];
      }

      const profileColor = this.getColorForDistance(cumulativeDistanceKm);
      if (profileColor) {
        return profileColor;
      }
    }

    // Fallback: Try to get color from cutSegments (day segments)
    if (Array.isArray(this.cutSegments) && this.cutSegments.length > index) {
      const segment = this.cutSegments[index];
      if (segment?.color) {
        return segment.color;
      }
    }

    // Final fallback to first segment color or mode color
    const viaFallback = this.cutSegments?.[0]?.color ?? fallback;
    return viaFallback;
  }

  projectPointOnSegment(lngLat, startCoord, endCoord) {
    const startPixel = this.map.project(toLngLat(startCoord));
    const endPixel = this.map.project(toLngLat(endCoord));
    const clickPixel = this.map.project(lngLat);
    const dx = endPixel.x - startPixel.x;
    const dy = endPixel.y - startPixel.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) {
      return { coordinates: [...startCoord], t: 0 };
    }
    let t = ((clickPixel.x - startPixel.x) * dx + (clickPixel.y - startPixel.y) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
    const projected = {
      x: startPixel.x + t * dx,
      y: startPixel.y + t * dy
    };
    const result = this.map.unproject(projected);
    return { coordinates: [result.lng, result.lat], t };
  }

  pointToSegmentDistance(point, startPixel, endPixel) {
    const dx = endPixel.x - startPixel.x;
    const dy = endPixel.y - startPixel.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) {
      return Math.hypot(point.x - startPixel.x, point.y - startPixel.y);
    }
    let t = ((point.x - startPixel.x) * dx + (point.y - startPixel.y) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
    const projection = {
      x: startPixel.x + t * dx,
      y: startPixel.y + t * dy
    };
    return Math.hypot(point.x - projection.x, point.y - projection.y);
  }
  findSegmentIndexByDistance(distanceKm) {
    if (!Array.isArray(this.routeSegments) || !this.routeSegments.length) {
      return null;
    }
    if (!Number.isFinite(distanceKm)) {
      return null;
    }

    const lastIndex = this.routeSegments.length - 1;
    if (distanceKm <= (this.routeSegments[0]?.startDistanceKm ?? 0)) {
      return 0;
    }
    if (distanceKm >= (this.routeSegments[lastIndex]?.endDistanceKm ?? 0)) {
      return lastIndex;
    }

    let low = 0;
    let high = lastIndex;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const segment = this.routeSegments[mid];
      if (!segment) {
        break;
      }
      const start = segment.startDistanceKm ?? 0;
      const end = segment.endDistanceKm ?? start;
      if (distanceKm < start) {
        high = mid - 1;
      } else if (distanceKm > end) {
        low = mid + 1;
      } else {
        return mid;
      }
    }

    const candidate = Math.max(0, Math.min(low, lastIndex));
    return candidate;
  }

  interpolateSegmentCoordinate(segment, t, distanceKm) {
    if (!segment) {
      return null;
    }
    const start = segment.start ?? [];
    const end = segment.end ?? [];
    const startLng = Number(start[0]);
    const startLat = Number(start[1]);
    const endLng = Number(end[0]);
    const endLat = Number(end[1]);
    if (!Number.isFinite(startLng) || !Number.isFinite(startLat) || !Number.isFinite(endLng) || !Number.isFinite(endLat)) {
      return null;
    }

    const clampedT = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
    const lng = startLng + (endLng - startLng) * clampedT;
    const lat = startLat + (endLat - startLat) * clampedT;

    const coord = [lng, lat];
    const interpolatedElevation = this.getElevationAtDistance(distanceKm);
    if (Number.isFinite(interpolatedElevation)) {
      coord.push(interpolatedElevation);
      return coord;
    }

    const startElevation = Number(start[2]);
    const endElevation = Number(end[2]);
    if (Number.isFinite(startElevation) && Number.isFinite(endElevation)) {
      coord.push(startElevation + (endElevation - startElevation) * clampedT);
    } else if (Number.isFinite(startElevation)) {
      coord.push(startElevation);
    } else if (Number.isFinite(endElevation)) {
      coord.push(endElevation);
    }

    return coord;
  }

  showRouteHoverOnSegment(segmentIndex, projection, { mousePoint = null, source = null } = {}) {
    const segment = this.routeSegments?.[segmentIndex];
    if (!segment) {
      return;
    }

    const clampedT = Math.max(0, Math.min(1, Number.isFinite(projection?.t) ? projection.t : 0));
    const distanceKm = Number.isFinite(projection?.distanceKm)
      ? projection.distanceKm
      : (segment.startDistanceKm ?? 0) + (segment.distanceKm ?? 0) * clampedT;

    const coordinates = this.interpolateSegmentCoordinate(segment, clampedT, distanceKm) ?? projection?.coordinates ?? null;
    let screenPoint = mousePoint;
    if ((!screenPoint || !Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y)) && coordinates) {
      try {
        const projected = this.map.project(toLngLat(coordinates));
        if (projected && Number.isFinite(projected.x) && Number.isFinite(projected.y)) {
          screenPoint = { x: projected.x, y: projected.y };
        }
      } catch (error) {
        console.warn('Failed to project hover coordinate', error);
      }
    }

    const projectionData = {
      ...projection,
      coordinates,
      t: clampedT,
      distanceKm,
      source
    };

    this.activeHoverSource = source ?? null;
    this.setHoveredSegment(segmentIndex);
    this.updateRouteHoverDisplay(screenPoint, segment, projectionData);
  }

  showRouteHoverAtDistance(distanceKm, { source = null } = {}) {
    if (!Number.isFinite(distanceKm)) {
      this.resetSegmentHover(source ?? undefined);
      this.updateElevationHoverReadout(null);
      return;
    }

    const segmentIndex = this.findSegmentIndexByDistance(distanceKm);
    if (!Number.isInteger(segmentIndex)) {
      this.resetSegmentHover(source ?? undefined);
      this.updateElevationHoverReadout(null);
      return;
    }

    const segment = this.routeSegments?.[segmentIndex];
    if (!segment) {
      this.resetSegmentHover(source ?? undefined);
      this.updateElevationHoverReadout(null);
      return;
    }

    const startDistance = segment.startDistanceKm ?? 0;
    const segmentDistance = segment.distanceKm ?? 0;
    let relativeDistance = distanceKm - startDistance;
    if (!Number.isFinite(relativeDistance)) {
      relativeDistance = 0;
    }
    relativeDistance = Math.max(0, Math.min(segmentDistance, relativeDistance));
    const t = segmentDistance > 0 ? relativeDistance / segmentDistance : 0;

    this.updateElevationHoverReadout(distanceKm);
    this.showRouteHoverOnSegment(segmentIndex, { t, distanceKm }, { source });
  }
  hideRouteHover() {
    if (this.routeHoverTooltip) {
      this.routeHoverTooltip.style.display = 'none';
    }
    this.map.getSource('route-hover-point-source')?.setData(EMPTY_COLLECTION);
    if (this.map.getLayer('route-hover-point')) {
      this.map.setPaintProperty('route-hover-point', 'circle-opacity', 0);
    }
    const canvas = this.map.getCanvas?.();
    if (canvas) {
      canvas.style.cursor = '';
    }
    this.highlightElevationAt(null);
    this.updateElevationHoverReadout(null);
    this.updateRouteStatsHover(null);
  }

  updateRouteHoverDisplay(mousePoint, segment, projection) {
    if (!segment || !projection) return;

    const tooltip = this.ensureRouteHoverTooltip();
    const clampedT = Math.max(0, Math.min(1, Number.isFinite(projection.t) ? projection.t : 0));
    const distanceKm = Number.isFinite(projection.distanceKm)
      ? projection.distanceKm
      : (segment.startDistanceKm ?? 0) + (segment.distanceKm ?? 0) * clampedT;
    const distanceLabel = this.formatDistance(distanceKm);
    const elevation = this.getElevationAtDistance(distanceKm);
    let gradeValue = this.computeGradeAtDistance(distanceKm);
    if (!Number.isFinite(gradeValue)) {
      if ((segment.distanceKm ?? 0) > 0 && Number.isFinite(segment.startElevation) && Number.isFinite(segment.endElevation)) {
        gradeValue = ((segment.endElevation - segment.startElevation) / Math.max(segment.distanceKm * 1000, 1)) * 100;
      } else {
        gradeValue = null;
      }
    }
    const altitudeLabel = Number.isFinite(elevation) ? `${Math.round(elevation)} m` : 'N/A';
    const gradeLabel = this.formatGrade(gradeValue);

    this.updateRouteStatsHover(distanceKm, { elevation, grade: gradeValue });

    let screenPoint = mousePoint;
    if ((!screenPoint || !Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y)) && projection.coordinates) {
      try {
        const projected = this.map.project(toLngLat(projection.coordinates));
        if (projected && Number.isFinite(projected.x) && Number.isFinite(projected.y)) {
          screenPoint = { x: projected.x, y: projected.y };
        }
      } catch (error) {
        console.warn('Failed to project tooltip coordinate', error);
      }
    }

    const metadata = this.getSegmentMetadata(segment);
    const detailItems = [];
    detailItems.push(`<span class="tooltip-altitude">Alt. ${escapeHtml(altitudeLabel)}</span>`);
    detailItems.push(`<span class="tooltip-grade">${escapeHtml(gradeLabel)}</span>`);

    if (metadata) {
      const sacLabel = formatSacScaleLabel(metadata.sacScale);
      if (sacLabel) {
        detailItems.push(`<span class="tooltip-sac">Difficulty: ${escapeHtml(sacLabel)}</span>`);
      }
      const surfaceLabel = formatSurfaceLabel(metadata.surface);
      if (surfaceLabel) {
        detailItems.push(`<span class="tooltip-surface">Surface: ${escapeHtml(surfaceLabel)}</span>`);
      }
      const trailLabel = formatTrailVisibilityLabel(metadata.trailVisibility);
      if (trailLabel) {
        detailItems.push(`<span class="tooltip-trail">Visibility: ${escapeHtml(trailLabel)}</span>`);
      }
    }

    const detailsMarkup = detailItems.join('');

    tooltip.innerHTML = `
      <div class="tooltip-distance">${escapeHtml(distanceLabel)} km</div>
      <div class="tooltip-details">
        ${detailsMarkup}
      </div>
    `;
    tooltip.style.display = 'block';

    const container = this.mapContainer;
    if (container && screenPoint) {
      const margin = 12;
      const tooltipWidth = tooltip.offsetWidth;
      const tooltipHeight = tooltip.offsetHeight;
      const maxLeft = container.clientWidth - tooltipWidth - margin;
      const maxTop = container.clientHeight - tooltipHeight - margin;
      const centeredLeft = screenPoint.x - tooltipWidth / 2;
      let rawTop = screenPoint.y - tooltipHeight - margin;
      if (rawTop < margin) {
        rawTop = Math.min(screenPoint.y + margin, maxTop);
      }
      const left = Math.min(Math.max(centeredLeft, margin), Math.max(margin, maxLeft));
      const top = Math.min(Math.max(rawTop, margin), Math.max(margin, maxTop));
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    }

    if (this.map.getLayer('route-hover-point')) {
      const hoverSegment = this.getCutSegmentForDistance(distanceKm);
      const hoverColor = hoverSegment?.color ?? this.modeColors[this.currentMode];
      this.map.setPaintProperty('route-hover-point', 'circle-stroke-color', hoverColor);
      this.map.setPaintProperty('route-hover-point', 'circle-opacity', 1);
    }
    if (projection.coordinates) {
      this.map.getSource('route-hover-point-source')?.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: projection.coordinates }
          }
        ]
      });
    } else {
      this.map.getSource('route-hover-point-source')?.setData(EMPTY_COLLECTION);
    }

    const canvas = this.map.getCanvas?.();
    if (canvas) {
      const shouldPointer = projection.source === 'map';
      canvas.style.cursor = shouldPointer ? 'pointer' : '';
    }

    this.highlightElevationAt(distanceKm);
  }

}
