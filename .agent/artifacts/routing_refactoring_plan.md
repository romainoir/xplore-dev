# Routing System Refactoring Plan

## Issues Identified and Status

### 1. Drag Preview Color Problems ✅ FIXED
- **Problem**: The drag preview line doesn't use the color of the segment where the drag started
- **Solution**: Store `_dragSegmentColor` at drag start, use it in `getPreviewColor()` and `updateDragWaypointColor()`
- **Files Modified**: `directions_test.js`
- **Functions Modified**: `onMapMouseDown()`, `onWaypointMouseDown()`, `updateDragPreview()`, `updateDragWaypointColor()`, `onMapMouseUp()`

### 2. Waypoint/Pin Color During Drag ✅ FIXED
- **Problem**: The dragged waypoint doesn't match the segment color
- **Solution**: `updateDragWaypointColor()` now prioritizes `_dragSegmentColor`
- **Files Modified**: `directions_test.js`

### 3. Drag Preview Line Endpoints ✅ FIXED
- **Problem**: Preview lines don't connect to the correct neighboring waypoints
- **Solution**: Simplified `findNeighbors()` to prioritize stored neighbors (`_dragPrevNeighbor`, `_dragNextNeighbor`), removed complex bivouac recalculation logic
- **Files Modified**: `directions_test.js`
- **Code Removed**: `getAllRouteKeyPoints()` function (no longer needed)

### 4. Route Segment Mode Preservation (Online Routing) ✅ FIXED
- **Problem**: When switching from snapping to manual mode in online routing, existing segments lose their original mode
- **Solution**: ORS router now stores/uses `segment_modes` and `routingMode` properly
- **Files Modified**: `scripts/openrouteservice-router.js`

### 5. Drag Creates Segments With Original Mode ✅ FIXED (NEW)
- **Problem**: When dragging a waypoint from a manual/snapped segment, new segments should inherit that mode, not the global mode
- **Solution**: 
  - Store `_dragSegmentMode` at drag start (from `cachedLegSegments[legIndex].routingMode`)
  - Pass `modeOverride` to `getRoute()` in `onMapMouseUp()`
  - Modified `getRoute()` to accept optional `modeOverride` parameter
- **Files Modified**: `directions_test.js`
- **Functions Modified**: `onMapMouseDown()`, `onWaypointMouseDown()`, `onMapMouseUp()`, `getRoute()`

---

## Architecture Overview (Updated)

### Key Components

```
┌─────────────────────────────────────────────────────────────┐
│                    DirectionsManager                        │
├─────────────────────────────────────────────────────────────┤
│ State:                                                      │
│   - waypoints[]           : Route waypoint coordinates      │
│   - routeGeojson          : Current route GeoJSON feature   │
│   - cachedLegSegments     : Map of segment data by index    │
│   - currentMode           : 'foot-hiking' | 'manual'        │
│   - cutSegments           : Day/stage color segments        │
│   - routeProfile          : Elevation/distance profile      │
├─────────────────────────────────────────────────────────────┤
│ Drag State:                                                 │
│   - isDragging            : Boolean                         │
│   - draggedWaypointIndex  : Number                          │
│   - _dragPrevNeighbor     : Stored previous neighbor coords │
│   - _dragNextNeighbor     : Stored next neighbor coords     │
│   - _dragSegmentColor     : Color at drag start position ✅ │
│   - _dragSegmentMode      : Routing mode of original seg ✅ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Router (ORS / Offline)                   │
├─────────────────────────────────────────────────────────────┤
│ Input:                                                      │
│   - waypoints             : Coordinate array                │
│   - mode                  : Travel mode (or modeOverride)   │
│   - preservedSegments     : Segments to preserve            │
├─────────────────────────────────────────────────────────────┤
│ Output:                                                     │
│   - GeoJSON Feature with:                                   │
│     - geometry.coordinates                                  │
│     - properties.segments                                   │
│     - properties.segment_modes ✅                           │
│     - properties.coordinate_metadata                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Summary

### Changes Made to `directions_test.js`:

1. **`onMapMouseDown()`**: Stores `_dragSegmentColor` and `_dragSegmentMode` at drag start
2. **`onWaypointMouseDown()`**: Stores `_dragSegmentColor` and `_dragSegmentMode` for existing waypoint drag
3. **`onMapMouseUp()`**: Uses `_dragSegmentMode` as `modeOverride` when calling `getRoute()`
4. **`updateDragPreview()`**: Uses `_dragSegmentColor` for preview line color
5. **`updateDragWaypointColor()`**: Uses `_dragSegmentColor` for waypoint circle color
6. **`getRoute(options)`**: Accepts optional `modeOverride` parameter for new segment routing mode

### Changes Made to `scripts/openrouteservice-router.js`:

1. **`preservedMap`**: Now stores `routingMode` for each preserved segment
2. **Manual mode with preserved segments**: Properly preserves original routing modes
3. **All route outputs**: Include `segment_modes` array in properties

---

## Testing Checklist

- [x] Drag preview line matches segment color
- [x] Dragged waypoint circle matches segment color  
- [x] Preview lines connect to correct neighbor waypoints
- [x] Dragging from manual segment creates manual segments
- [x] Dragging from snapped segment creates snapped segments
- [ ] Segment modes preserved when adding new waypoints (needs testing)
- [ ] Segment modes preserved after undo/redo (needs testing)
- [ ] Segment modes preserved after route swap (needs testing)
- [ ] Manual segments display dotted line style
- [ ] Online and offline routing behave consistently
