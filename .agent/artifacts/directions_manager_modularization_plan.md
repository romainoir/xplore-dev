# DirectionsManager Modularization Plan v2

## Current State Analysis

**DirectionsManager.js**: ~11,666 lines (~412KB)

### Key Finding: Partial Extraction Already Done

The managers folder contains **9 managers that are already extracted AND instantiated**, but **DirectionsManager still has duplicate code that wasn't removed**. This is the core issue!

### Existing Managers (Already Created & Instantiated):

| Manager | Size | Status | Issue |
|---------|------|--------|-------|
| **PoiManager.js** | ~24KB | ✅ Instantiated at line 359 | DirectionsManager still has duplicate POI methods |
| **ElevationProfileManager.js** | ~18KB | ✅ Instantiated at line 378 | DirectionsManager still has `generateElevationSamples`, `buildElevationAreaPaths`, etc. |
| **RouteManager.js** | ~17KB | ✅ Instantiated at line 395 | DirectionsManager still has `buildRouteProfile`, `computeDistanceKm`, etc. |
| **WaypointManager.js** | ~17KB | ✅ Instantiated at line ~410 | DirectionsManager still has undo/redo, clone methods |
| **BivouacManager.js** | ~16KB | ✅ Instantiated | DirectionsManager still has `addRouteCut`, `computeCutBoundaries`, etc. |
| **StatsManager.js** | ~12KB | ✅ Instantiated | DirectionsManager still has `calculateRouteMetrics`, format methods |
| **ImportExportManager.js** | ~15KB | ✅ Instantiated | DirectionsManager still has import/export methods |
| **RouteDisplayManager.js** | ~8KB | ✅ Instantiated | DirectionsManager still has gradient generation methods |
| **MapInteractionManager.js** | ~7KB | ✅ Instantiated | Only delegates, no duplicate code |

### Supporting Files:
| File | Size | Purpose |
|------|------|---------|
| constants.js | ~10KB | Shared constants |
| utils.js | ~37KB | Utility functions |
| markers.js | ~12KB | Marker creation utilities |
| profile-constants.js | ~7KB | Profile mode definitions |
| profile-utils.js | ~4KB | Profile classification utilities |
| visual-constants.js | ~6KB | Visual/styling constants |

---

## Root Cause

The previous refactoring:
1. ✅ Created manager classes with extracted code
2. ✅ Added manager instantiation to DirectionsManager constructor
3. ❌ **Did NOT remove the original methods from DirectionsManager**
4. ❌ **Did NOT wire up calls to use managers**

This explains why DirectionsManager is still 11k+ lines despite having 9 managers!

---

## Revised Strategy: Delegate & Delete

Instead of extracting new managers, we need to:

### Phase 1: Wire Up Existing Managers (HIGH PRIORITY)
**Goal: Replace duplicate code with delegation calls**

For each manager, identify methods that exist in BOTH DirectionsManager AND the manager, then:
1. Update DirectionsManager to call `this.managerName.methodName()`
2. Delete the duplicate method from DirectionsManager

### Phase 2: Complete Missing Manager Integration

Some managers may be partially extracted. For example:
- `WaypointManager` has undo/redo but DirectionsManager still has `undoLastWaypointChange()`
- `BivouacManager` has cut management but DirectionsManager still has `addRouteCut()`

---

## Phase 1 Detailed: Remove Duplicates

### 1.1 RouteManager Duplicates (~400 lines to remove)

**Manager has** → **DirectionsManager still has**:
| RouteManager Method | DirectionsManager Duplicate | Action |
|--------------------|---------------------------|--------|
| `buildRouteProfile()` | `buildRouteProfile()` at line 6949 | Delegate + Delete |
| `computeDistanceKm()` | `computeDistanceKm()` at line 6743 | Delegate + Delete |
| `getCoordinateAtDistance()` | `getCoordinateAtDistance()` at lines 3232, 9470 | Delegate + Delete |
| `normalizeRouteCutEntry()` | `normalizeRouteCutEntry()` at line 2127 | Delegate + Delete |
| `estimateTravelTimeHours()` | `estimateTravelTimeHours()` at line 8882 | Delegate + Delete |
| `formatDurationHours()` | `formatDurationHours()` at line 8894 | Already in StatsManager |
| `formatDistance()` | `formatDistance()` at line 8700 | Already in StatsManager |

### 1.2 WaypointManager Duplicates (~500 lines to remove)

| WaypointManager Method | DirectionsManager Duplicate | Action |
|-----------------------|---------------------------|--------|
| `cloneWaypoints()` | `cloneWaypoints()` at line 2096 | Delegate + Delete |
| `recordState()` | `recordWaypointState()` at line 2471 | Delegate + Delete |
| `undo()` | `undoLastWaypointChange()` at line 2493 | Delegate + Delete |
| `redo()` | `redoLastWaypointChange()` at line 2532 | Delegate + Delete |
| `createHistorySnapshot()` | `createHistorySnapshot()` at line 2195 | Delegate + Delete |
| `restoreFromSnapshot()` | `restoreStateFromSnapshot()` at line 2425 | Delegate + Delete |
| `trimHistoryStack()` | `trimHistoryStack()` at line 2462 | Delegate + Delete |
| `coordinatesMatch()` | `coordinatesMatch()` at line 8665 | Delegate + Delete |

### 1.3 BivouacManager Duplicates (~600 lines to remove)

| BivouacManager Method | DirectionsManager Duplicate | Action |
|----------------------|---------------------------|--------|
| `addRouteCut()` | `addRouteCut()` at line 4631 | Delegate + Delete |
| `removeBivouacCut()` | `removeBivouacCut()` at line 4673 | Delegate + Delete |
| `resetRouteCuts()` | `resetRouteCuts()` at line 2725 | Delegate + Delete |
| `computeCutBoundaries()` | `computeCutBoundaries()` at line 2761 | Delegate + Delete |
| `updateCutSegments()` | `updateRouteCutSegments()` at line 3322 | Delegate + Delete |
| `getSegmentColor()` | `getSegmentColor()` at line 2732 | Delegate + Delete |
| `computeSegmentMarkers()` | `computeSegmentMarkers()` at line 2787 | Delegate + Delete |
| `updateSegmentMarkers()` | `updateSegmentMarkers()` at line 2998 | Delegate + Delete |
| `assignSegmentNames()` | `assignSegmentNames()` at line 2970 | Delegate + Delete |
| `normalizeRouteCutEntry()` | `normalizeRouteCutEntry()` at line 2127 | Delegate + Delete |
| `setRouteCutDistances()` | `setRouteCutDistances()` at line 2180 | Delegate + Delete |
| `updateDraggedBivouac()` | `updateDraggedBivouac()` at line 4716 | Delegate + Delete |
| `finishBivouacDrag()` | `finishBivouacDrag()` at line 4784 | Delegate + Delete |

### 1.4 ElevationProfileManager Duplicates (~400 lines to remove)

| ElevationProfileManager Method | DirectionsManager Duplicate | Action |
|-------------------------------|---------------------------|--------|
| `generateElevationSamples()` | `generateElevationSamples()` at line 6962 | Delegate + Delete |
| `buildElevationAreaPaths()` | `buildElevationAreaPaths()` at line 7028 | Delegate + Delete |
| `computeAxisTicks()` | `computeAxisTicks()` at line 8727 | Delegate + Delete |
| `updateElevationYAxisLabels()` | `updateElevationYAxisLabels()` at line 9682 | Delegate + Delete |
| `updateElevationXAxis()` | `updateElevationXAxis()` at line 9942 | Delegate + Delete |
| `updateElevationGridLines()` | `updateElevationGridLines()` at line 9743 | Delegate + Delete |
| `formatAxisDistance()` | `formatAxisDistance()` at line 8713 | Delegate + Delete |
| `getElevationAtDistance()` | `getElevationAtDistance()` at line 6619 | Delegate + Delete |

### 1.5 StatsManager Duplicates (~300 lines to remove)

| StatsManager Method | DirectionsManager Duplicate | Action |
|--------------------|---------------------------|--------|
| `calculateRouteMetrics()` | `calculateRouteMetrics()` at line 8797 | Delegate + Delete |
| `estimateTravelTimeHours()` | `estimateTravelTimeHours()` at line 8882 | Delegate + Delete |
| `formatDistance()` | `formatDistance()` at line 8700 | Delegate + Delete |
| `formatDurationHours()` | `formatDurationHours()` at line 8894 | Delegate + Delete |
| `formatEstimatedTimeRange()` | `formatEstimatedTimeRange()` at line 8910 | Delegate + Delete |

### 1.6 RouteDisplayManager Duplicates (~300 lines to remove)

| RouteDisplayManager Method | DirectionsManager Duplicate | Action |
|---------------------------|---------------------------|--------|
| `generateRouteLineGradientExpression()` | at line 3589 | Delegate + Delete |
| `getRouteLineGradientExpression()` | at line 3723 | Delegate + Delete |
| `getSegmentColor()` | at line 2732 | Already covered by Bivouac |

### 1.7 ImportExportManager Duplicates (~400 lines to remove)

| ImportExportManager Method | DirectionsManager Duplicate | Action |
|---------------------------|---------------------------|--------|
| `importFromGeojson()` | `importRouteFromGeojson()` at line 7793 | Delegate + Delete |
| `extractRouteFromGeojson()` | `extractRouteFromGeojson()` at line 7710 | Delegate + Delete |
| `normalizeSequence()` | `normalizeImportedSequence()` at line 7553 | Delegate + Delete |
| `normalizeCoordinate()` | `normalizeImportedCoordinate()` at line 7534 | Delegate + Delete |
| `buildExportFeatureCollection()` | `buildExportFeatureCollection()` at line 3389 | Delegate + Delete |
| `buildSegmentExportCollections()` | `buildSegmentExportCollections()` at line 3499 | Delegate + Delete |
| `deriveWaypointsFromSequence()` | `deriveWaypointsFromImportedSequence()` at line 7612 | Delegate + Delete |
| `estimateSequenceDistanceKm()` | `estimateSequenceDistanceKm()` at line 7598 | Delegate + Delete |
| `mergeCoordinateSegments()` | `mergeImportedCoordinateSegments()` at line 7571 | Delegate + Delete |

---

## Estimated Savings

| Manager | Lines to Remove |
|---------|----------------|
| RouteManager duplicates | ~400 |
| WaypointManager duplicates | ~500 |
| BivouacManager duplicates | ~600 |
| ElevationProfileManager duplicates | ~400 |
| StatsManager duplicates | ~300 |
| RouteDisplayManager duplicates | ~300 |
| ImportExportManager duplicates | ~400 |
| **Total** | **~2,900 lines** |

After removing duplicates: **~8,700 lines** (still large but much better)

---

## Phase 2: New Extractions Needed

After completing Phase 1, the remaining ~8,700 lines would include things that weren't extracted to any manager:

### 2.1 DragManager (NEW) - ~600 lines
Currently not covered by any manager:
- `onMapMouseDown()`
- `onMapMouseMove()`
- `onMapMouseUp()`
- `updateDragPreview()`
- `clearDragPreview()`
- `updateDragWaypointColor()`

### 2.2 HoverManager (NEW) - ~500 lines
Currently not covered:
- `handleRouteSegmentHover()`
- `showRouteHoverOnSegment()` 
- `showRouteHoverAtDistance()`
- `updateRouteHoverDisplay()`
- `hideRouteHover()`
- `projectOntoRoute()`

### 2.3 SegmentClassificationManager (NEW) - ~700 lines
Currently not covered:
- `classifySegment()`
- `classifySlopeSegment()`
- `classifySurfaceSegment()`
- `classifyCategorySegment()`
- `computeSegmentGrade()`
- `getSegmentMetadata()`
- `resolveCategorySegmentEntries()`
- `updateProfileSegments()`

### 2.4 UI Panel/Legend Manager (NEW) - ~600 lines
- Profile legend updates
- Panel visibility
- Dock gestures

---

## Implementation Order

### Sprint 1: Remove Duplicates (Start Here!)
1. Audit each manager to confirm method signatures match
2. Replace DirectionsManager methods with delegation calls
3. Delete duplicate methods
4. Test after each manager

### Sprint 2: New Managers
1. DragManager extraction
2. HoverManager extraction

### Sprint 3: Classification & UI
1. SegmentClassificationManager extraction
2. UI Panel Manager extraction

---

## Progress Tracking

| Phase | Task | Status | Lines Saved |
|-------|------|--------|-------------|
| 1.1 | RouteManager delegation | ⬜ Not Started | ~400 |
| 1.2 | WaypointManager delegation | ⬜ Not Started | ~500 |
| 1.3 | BivouacManager delegation | ⬜ Not Started | ~600 |
| 1.4 | ElevationProfileManager delegation | ⬜ Not Started | ~400 |
| 1.5 | StatsManager delegation | ⬜ Not Started | ~300 |
| 1.6 | RouteDisplayManager delegation | ⬜ Not Started | ~300 |
| 1.7 | ImportExportManager delegation | ⬜ Not Started | ~400 |
| 2.1 | NEW: DragManager | ⬜ Not Started | ~600 |
| 2.2 | NEW: HoverManager | ⬜ Not Started | ~500 |
| 2.3 | NEW: SegmentClassificationManager | ⬜ Not Started | ~700 |
| 2.4 | NEW: UI Panel Manager | ⬜ Not Started | ~600 |

**Target: DirectionsManager reduced to ~3,000-4,000 lines**
