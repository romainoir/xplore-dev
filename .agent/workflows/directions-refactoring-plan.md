---
description: DirectionsManager Refactoring Plan - Reduce from 10K to 5K lines
---

# DirectionsManager Major Refactoring Plan

## Current State
- **File:** `scripts/directions/DirectionsManager.js`
- **Lines:** 10,895
- **Methods:** 363
- **Target:** ~5,000 lines (50% reduction)

## Core Problem
`DirectionsManager` is a "God Class" that handles:
- Route state management
- Waypoint management
- Elevation chart UI
- Stats panel UI
- Profile legend UI
- Map layer management
- Bivouac/segment management
- Import/export
- Weather display
- POI display
- Drag interactions
- Event handling

## Existing Managers (Underutilized)
| Manager | Current Lines | Could Handle |
|---------|--------------|--------------|
| `ElevationProfileManager` | 485 | +800 lines from DirectionsManager |
| `StatsManager` | 400 | +600 lines from DirectionsManager |
| `RouteDisplayManager` | 300 | +500 lines from DirectionsManager |
| `WaypointManager` | 600 | +200 lines from DirectionsManager |
| `BivouacManager` | 620 | +150 lines from DirectionsManager |
| `PoiManager` | 400 | +300 lines from DirectionsManager |
| `ImportExportManager` | 350 | +100 lines from DirectionsManager |
| `RouteManager` | 400 | +200 lines from DirectionsManager |

**Total potential extraction: ~2,850 lines**

---

## Phase 1: Elevation Chart Extraction (~800 lines)

### Methods to Move to ElevationProfileManager
```
updateElevationProfile()           ~180 lines
updateElevationChartView()          ~35 lines
zoomElevationChartToDay()           ~75 lines
updateElevationGradient()          ~100 lines
updateElevationXAxis()              ~25 lines
updateElevationYAxisLabels()        ~50 lines
updateElevationGridLines()          ~45 lines
updateElevationMarkerPositions()    ~60 lines
updateElevationMarkerVisibility()   ~40 lines
showElevationChartTooltip()         ~65 lines
hideElevationChartTooltip()          ~8 lines
ensureElevationChartTooltip()       ~25 lines
onElevationPointerMove()            ~30 lines
onElevationPointerLeave()            ~8 lines
attachElevationChartEvents()        ~10 lines
detachElevationChartEvents()        ~10 lines
highlightElevationAt()              ~35 lines
```

### Strategy
1. Pass `DirectionsManager` instance as `context` to ElevationProfileManager
2. Methods access `context.routeProfile`, `context.cutSegments`, etc.
3. Keep thin wrappers in DirectionsManager:
   ```javascript
   updateElevationProfile(coords) {
     this.elevationProfileManager.updateElevationProfile(coords, this);
   }
   ```

### State to Share
- `elevationSamples`, `elevationDomain`, `elevationYAxis`
- `fullRouteDomain`, `fullRouteYAxis`

---

## Phase 2: Stats Panel Extraction (~600 lines)
  - **Goal**: Move stats rendering and calculation to `StatsManager.js`.
  - **Methods to Move**:
    - `renderRouteStatsSummary`
    - `renderSimpleStats`
    - `renderMultiDayTimeline`
    - `attachDayTabHandlers`
    - `updateWeatherDisplay`
    - `computeCumulativeMetrics`
    - `computeDayDifficulty`
    - `getKeyWaypointsForDay`
  - **Status**: **Completed**

## Phase 3: Route Display Extraction (~500 lines)

### Methods to Move to RouteDisplayManager
```
updateRouteLineSource()            ~180 lines
updateDistanceMarkers()             ~60 lines
updateManualRouteSource()          ~150 lines
setRouteLineGradient()              ~15 lines
generateRouteLineGradientExpression() ~100 lines
```

### Dependency
Requires access to `map`, `cutSegments`, `profileSegments`, `modeColors`.

---

## Phase 4: Profile Mode/Legend Extraction (~200 lines)

### Methods to Move to New `ProfileModeManager` or `ElevationProfileManager`
```
updateProfileLegend()               ~95 lines
getProfileLegendEntries()           ~40 lines
showProfileLegend()                 ~15 lines
hideProfileLegend()                 ~10 lines
scheduleProfileLegendReveal()       ~12 lines
cancelProfileLegendReveal()          ~8 lines
openProfileMenu()                   ~12 lines
closeProfileMenu()                  ~15 lines
```

---

## Phase 5: Segment Classification Extraction (~200 lines)

### Methods to Move to RouteManager or New `SegmentClassifier`
```
classifySlopeSegment()              ~25 lines
classifySurfaceSegment()            ~20 lines
classifyWayTypeSegment()            ~20 lines
resolveCategorySegmentEntries()    ~100 lines
getSegmentMetadata()                ~45 lines
```

---

## Phase 6: Utility Method Cleanup (~500 lines)

### Already Delegated (Thin Wrappers to Remove)
Many methods are now 3-line wrappers:
```javascript
someMethod(args) {
  return this.someManager.someMethod(args);
}
```
Consider inlining these at call sites or exposing managers directly.

### Duplicate Utility Functions
- `haversineDistance` variants exist in multiple files
- `formatDistance` variants exist in multiple files
- Consider moving to `utils.js`

---

## Implementation Order

1. **Checkpoint current state** - Commit before starting
2. **Phase 1: Elevation Chart** - Biggest win, relatively self-contained
3. **Test thoroughly** - Bivouac placement, day zooming, hover tooltips
4. **Phase 2: Stats Panel** - Second biggest win
5. **Test thoroughly** - Multi-day timeline, weather display
6. **Phase 3: Route Display** - Complex but isolated
7. **Phases 4-6** - Cleanup and smaller extractions

---

## Risk Mitigation

1. **Keep method signatures identical** in DirectionsManager
2. **Use context pattern** - Methods receive `dm` (DirectionsManager) as parameter
3. **Test after each phase** - Don't batch multiple phases
4. **Git commits after each method group**

---

## Expected Final State

| Component | Current | After Refactor |
|-----------|---------|----------------|
| DirectionsManager | 10,895 | ~5,000 |
| ElevationProfileManager | 485 | ~1,200 |
| StatsManager | 400 | ~1,000 |
| RouteDisplayManager | 300 | ~800 |
| Others | -- | +500 distributed |

**Total code remains similar, but responsibility is properly distributed.**
