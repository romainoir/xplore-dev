# Shadow POC Technical Summary

This document summarizes the technical improvements implemented during the Shadow POC phase to enhance terrain rendering quality and analytical visualization.

## 1. Soft Shadows (Two-Pass Gaussian Blur)
To eliminate pixelated shadow edges, a dedicated two-pass Gaussian blur was implemented for the global shadow atlas.
- **Dedicated Atlas**: Transitioned from screen-sized FBOs to a fixed **2048x2048** square atlas for consistent shadow resolution across all viewports.
- **Gaussian Blur**: Implemented `shadow_blur.fragment.glsl` performing separate horizontal and vertical passes. This achieved smooth penumbra effects without modifying the underlying raymarching geometry.
- **Geographic Scaling**: Integrated per-axis `metersPerPixel` calculations to ensure shadow lengths and blur radii are geographically consistent across the map.

## 2. Igor Hillshade Integration
The **Igor Hillshade** method (inspired by GDAL) was integrated as a high-contrast analytical layer.
- **High Contrast**: Uses a specific lighting model that emphasizes terrain structural detail more aggressively than the standard "combined" method.
- **Interactive Toggle**: Added a dedicated layer and UI control in `shadow_debug_poc.html` to toggle the effect on/off.
- **Optimal Calibration**: Set to the maximum valid `hillshade-exaggeration` (1.0) with deepened shadow/accent colors for a "popping" 3D effect.

## 3. Intensified Ambient Occlusion (AO)
Refined the analytical AO (Hillshade) logic within the core terrain shader (`terrain.fragment.glsl`).
- **Raw DEM Sampling**: Switched to sampling high-precision raw DEM textures for AO calculation, eliminating the "faceting" artifacts caused by mesh-based elevation data.
- **Strengthened Relief**: Increased the AO darkening intensity from 18% to **35%**, significantly enhancing the definition of ridges, crevices, and steep gullies.
- **Resolution & Scaling Fix**: Corrected a 2-pixel mismatch in the sampling step within `terrain.fragment.glsl`. Updated `terrain_program.ts` to calculate `u_metersPerPixel` using the **native tile resolution** (`canonical.z`) instead of the map zoom. This ensures AO detail remains sharp and spatially correct even when highly overscaled (Z16-Z18).

## 4. Performance & Stability
- Maintained a stable **60 FPS** on high-end hardware during full-res rendering (Z15+).
- Cleaned up diagnostic logs to ensure a production-ready browser console.
- Resolved shader registration `TypeErrors` to ensure robust engine initialization.

---

## 5. Debug POC Refactor - 2026-04-27
`shadow_debug_poc.html` was refactored from a brittle one-off page into a scoped debug controller while keeping it as a single standalone HTML file.

- **Local dependencies**: Replaced remote MapLibre CSS and SunCalc CDN usage with the local MapLibre CSS and an inline solar-position helper. The page still needs network access for Mapterhorn DEM tiles.
- **DEM consistency**: Updated the POC DEM source to match the app-side 512 px Mapterhorn source shape and split the global shadow source from the terrain source.
- **Sun safety**: Reworked the time slider to use integer minutes and clamp shader-facing sun altitude into the custom style-spec range. Below-horizon sun now disables cast shadow opacity instead of writing invalid negative values.
- **Layer setup**: Added explicit Igor hillshade method styling and full shadow paint defaults, including shadow/highlight colors and max distance.
- **Control flow**: Centralized range-control bindings for the window globals consumed by the custom MapLibre build (`_shadowStepSize`, `_shadowMaxSteps`, `_shadowSoftBase`, `_shadowSoftMult`, `_shadowSoftMax`, `_castShadowMult`, `_shadowDebugMode`).
- **Debug hardening**: Added status reporting, guarded custom layer/API calls, removed malformed closing markup, and made the elevation atlas overlay tolerate missing metadata/readback instead of throwing.
- **Square shadow artifact fix**: The elevation atlas now uses nearest texture filtering because it stores packed RGBA float elevations. Hardware linear filtering corrupts those bytes before shader unpacking. The atlas render pass also draws low-zoom parent tiles first and high-zoom child tiles last with depth disabled, so coarse fallback tiles can fill gaps but cannot overwrite detailed DEM tiles.
- **Automatic GSD quality**: Replaced the visible terrain-fragment raymarch with a precomputed global shadow atlas sampled by terrain. The atlas pass derives ray step distance from atlas meters-per-pixel, clamps the step budget from `shadow-max-distance`, and removes stochastic ray phase jitter to avoid diagonal hatching. The POC no longer exposes raymarch/penumbra tuning sliders.
- **Progressive time scrubbing**: Time-slider interaction now throttles sun/shadow updates and asks the atlas pass for a lower-quality preview. Releasing the slider clears preview mode and triggers a full-quality shadow recompute.
- **Camera movement cache**: Camera moves reuse the last stable shadow atlas instead of recomputing elevation and shadow atlases every frame. The atlas is recomputed once when movement stops.
- **Night rendering**: Terrain now receives the real solar altitude from the POC instead of the clamped raymarch altitude, so below-horizon times dim into a night tint instead of snapping back to bright daytime colors.
- **Camera preview reuse**: Camera movement now reuses existing depth, coords, elevation, and shadow FBOs for a short preview window, then schedules one forced terrain/shadow refresh after movement settles.
- **Stable atlas LOD**: The elevation atlas no longer collects whichever loaded parent/child tiles happen to overlap the view. It now uses deterministic LOD bands: detailed cells over the visible terrain, medium parent cells in the near sun-facing caster band, and coarser parent/grandparent cells for the far caster band. This keeps distant mountains available for cast shadows without forcing one uniform high zoom across the whole atlas.
- **Cascaded global raymarch**: The shadow pass now uses a cascaded heightfield march: precise bilinear samples near the receiver, larger parent-scale steps in the mid range, and coarse nearest samples in the far caster band. Empty atlas pixels return immediately, and hit points are binary-refined only after an actual intersection.
- **Cleaner shadow termination**: Far-cascade candidate hits are rechecked with bilinear elevation before refinement, and the final edge strength is based on base atlas GSD rather than the coarse far step. A small max-distance fade avoids a hard clipped tail when the requested shadow distance is exhausted.
- **No atlas refresh while moving**: Camera movement now always reuses the existing atlas when one is available, even if DEM tiles arrive during the move. The atlas refresh is deferred until interaction stops.
- **Shadow contrast restored**: The atlas now keeps a visible minimum opacity for confirmed ray hits, and terrain applies cast shadows with a darker tint and stronger default multiplier so shadows do not wash out after the cascaded march optimization.
- **Continuous twilight model**: Sunrise/sunset no longer use a binary horizon cutoff. The POC drives direct shadow opacity through a smooth 0-6 degree solar fade, the terrain shader uses a -12 to +5 degree sky-ambient curve for twilight/night visibility, and the global shadow pass skips raymarching when direct light is effectively zero.
- **Clean hard cast-shadow edges**: Replaced the wide soft blur with a tiny atlas-space edge cleanup pass plus derivative-aware terrain remap. Shadows stay hard, but staircase aliasing at the silhouette is filtered.
- **Unified local self-shadow anchoring**: The terrain shader now derives a high-resolution local slope shadow from the per-tile DEM and merges it with the global cast-shadow mask using the same tint/intensity model, making cast-shadow bases attach more cleanly to ridges and steep local relief.
- **Igor-grade local shadow normals**: The local self-shadow now uses a bilinearly interpolated Sobel 3x3 DEM gradient, matching the way MapLibre's Igor hillshade prepares and filters terrain derivatives while allowing self-shadow intensity to match cast-shadow intensity.
- **Full-resolution shadow source**: Removed the z12-only `coarseTerrainSource`; the shadow layer now uses `terrainSource` directly, so shadow DEM availability matches Igor hillshade's z15 source.
- **Integrated Igor relief**: Removed the separate `detail-native` hillshade layer from the POC and moved Igor-like local relief into the terrain/cast-shadow shader using the same Sobel DEM gradient as the self-shadow pass.
- **Shadow interior relief AO**: Added a post-cast-shadow AO/detail pass so broad cast shadows no longer flatten the integrated Igor relief; local Sobel shadow detail remains visible inside shaded regions.
- **Native DEM zoom for integrated relief**: The POC now opts terrain into `deltaZoom = 0`, so terrain/self-shadow DEM sampling no longer underzooms one level below the visible raster-dem source.
- **Native-style derivative cache for integrated relief**: The terrain pass now prepares a per-tile Sobel derivative texture with MapLibre's existing `hillshadePrepare` shader and samples it bilinearly, instead of running a 16-sample Sobel kernel in every terrain fragment.
- **Stable cast-shadow edge jitter**: The global shadow raymarch now starts from a tiny deterministic atlas-pixel jitter. This breaks up residual staircase quantization at shadow silhouettes without adding frame-to-frame shimmer during camera movement.
- **Stable derivative binding while moving**: Terrain derivative preparation now runs before terrain draw, and texture unit 12 always receives a complete neutral derivative texture when a source DEM derivative is not ready. This avoids transient missing/invalid gradient sampling during camera movement.
- **Optional native hillshade cache owner**: The POC can install a transparent `terrain-derivative-cache` hillshade layer on `terrainSource`. It is visually invisible, but it lets MapLibre's native hillshade pipeline own visible DEM tile derivative preparation and invalidation, while the terrain shader samples those prepared gradients.
- **Prepared derivative UV fix**: Sampling of the prepared derivative texture now maps padded DEM coordinates back to native hillshade FBO UVs with the same half-texel convention as MapLibre's hillshade renderer.
- **Derivative cache without visible hillshade draw**: When the optional transparent `terrain-derivative-cache` layer is enabled, it runs only its offscreen derivative prepare pass. The translucent visible hillshade draw is skipped so the cache layer does not add per-frame terrain rendering cost while panning.
- **Non-blocking atlas debug overlay**: The elevation-atlas debug view no longer performs a full 2048px `readPixels` every 500 ms. It only reads when the atlas timestamp changes, throttles to 1500 ms, and pauses readback while the map is moving.
- **Tile/FPS performance logging**: Added runtime debug globals and an on-map tile/FPS panel. It reports frame timing, terrain render tile counts, terrain/source zoom distributions, missing DEM/derivative counts, native hillshade derivative-prepare work, elevation-atlas timings, and global shadow-pass timings. The same snapshot is throttled to the browser console as `[shadow-poc perf]`.
- **Selectable/copyable debug output**: The tile/FPS panel now writes a compact summary plus raw sanitized debug snapshots into a selectable `<pre>`, supports panel scrolling, and includes a copy button for pasting Safari performance logs.
- **Lower-overhead debug with native derivative ownership**: The tile/FPS panel now updates at 1 Hz and builds the full JSON snapshot only on copy. The transparent hillshade cache layer remains enabled by default because it gives MapLibre ownership of derivative lifecycle and avoids transient missing-gradient tiles, while the visible hillshade draw is still skipped.
- **Suspended-frame filtering**: The FPS counter now drops browser/tab suspension gaps above 1000 ms from the rolling average and reports them as `gap`, so one blocked or backgrounded frame no longer makes a stable 60 FPS scene read as single-digit FPS.
- **Deferred camera shadow refresh**: Camera movement no longer recomputes sun/shadow paint on every `move` event. The POC keeps the current shadow atlas while panning/zooming/rotating and performs one refresh on `moveend`.
- **Optional Esri satellite base**: Added an Esri World Imagery raster source and toggle. The imagery layer is inserted before the custom shadow layer so cast shadows remain visible above the satellite terrain texture.
- **Strict cached-shadow interaction mode**: During camera movement, the transparent derivative-cache hillshade layer skips its offscreen prepare pass, terrain binds only already-prepared derivative textures, and the shadow layer skips both DEM-prep and global-sweep passes when a cached atlas exists. No low-quality shadow/derivative refresh is attempted while panning, zooming, or rotating; normal preparation resumes after interaction ends.
- **Post-move settle refresh**: After `moveend`, the POC keeps cached shadows active for a short settle window, waits for map idle when possible, and falls back to a timeout before releasing the full-quality recompute. This separates final tile loading from atlas/shadow regeneration and avoids a hard freeze on the first frame after release.
- **Coarse-to-fine post-move shadows**: The post-move refresh now runs in two phases. A coarse preview pass uses fewer atlas cells, lower LOD, shorter reach, larger ray steps, and no cleanup blur; a delayed full pass refines the atlas once the map has settled.
- **Covered-atlas shadow reuse**: Before launching preview/full recomputation, the renderer checks whether the current visible terrain plus sun-facing caster margin is still contained in the existing atlas bounds. If so, it reuses the cached elevation/shadow atlas and skips the redundant raymarch, similar in spirit to MapLibre hillshade derivative reuse.
- **Continuous low-light shading**: Cast shadows are slightly lighter in direct sun, fade through a wider dawn/dusk range, and keep local Igor-style relief visible at night so full-night terrain and near-horizon cast shadows sit in the same tonal family instead of snapping between bright and black.
- **Date-aware sun-duration layer**: The daylight layer now consumes the POC date picker through `_daylightDateMs`, uses a soft local-horizon test around sunrise/sunset, and normalizes the color ramp over longer mountain summer days for smoother sun-duration gradients.
- **Continuous sun-duration atlas**: The daylight layer now matches the global shadow architecture. It accumulates 32 sunrise-to-sunset shadow tests into one continuous duration atlas over the same elevation atlas bounds as cast shadows, then colorizes that atlas over visible terrain tiles. This removes tile-local duration rectangles and makes the layer behave like an accumulation of the shadow atlas over the day.
- **Full-resolution sun-duration atlas**: The daylight accumulation atlas now uses the same 2048 px atlas resolution as the elevation and cast-shadow atlases, and the debug panel reports daylight/elevation atlas sizes as `size=daylight/elevation`.
- **Stable daylight texture bindings**: The daylight renderer now prepares terrain data before binding the daylight atlas and color ramp texture. This prevents transient DEM/RGB elevation textures from replacing the color ramp when fast camera movement causes tile DEM uploads.
- **Simplified debug controls**: Removed the cycle-debug and separate integrated-Igor toggles from the POC UI. Igor-style local relief is always part of the terrain/shadow rendering, while the tile/FPS debug log is now opt-in and disabled by default; the elevation atlas overlay remains available independently.
- **Stronger rotated Poisson shadow edges**: Cast shadows no longer run the atlas blur pass by default. The global raymarch writes a mostly binary hit mask, while the terrain shader reconstructs softness with a rotated Poisson PCF kernel only near real edges. The kernel radius and stable threshold jitter are larger in the transition band, giving softer, less stair-stepped edges without whole-atlas blur or interior banding.
- **Initial horizon-angle atlas**: Added a cached directional horizon atlas for sun-duration. The renderer packs horizon angles into RGBA horizon textures whenever the elevation atlas changes, then the daylight atlas integrates the day from cheap horizon-angle comparisons instead of per-sample raymarching. This is the first step toward realtime current-shadow visualization from horizon textures.
- **Horizon-driven current shadows**: Terrain shading now samples the horizon atlas directly for the current sun azimuth/altitude when the horizon atlas is ready, while the raymarched shadow atlas remains as fallback. The coarse shadow pass skips its global raymarch once the horizon atlas is valid, so time-slider shadow updates become uniform-only terrain redraws instead of shadow-atlas recomputation.
- **Horizon quality controls**: The POC UI now exposes `Fast`, `Balanced`, and `High` shadow quality presets plus edge softness and a conservative edge-dither slider. Balanced/High use a 16-direction horizon atlas packed into four RGBA textures, while Fast uses 8 directions for cheaper recomputation. Edge controls update uniforms and daylight cache keys without exposing raymarch internals.
- **Grid-free edge dither default**: Edge dither now defaults to zero, is capped to a subtle range, and uses low-amplitude smooth value noise instead of coarse cell threshold jitter. This keeps the clean horizon edge as the baseline while preserving a small optional breakup control for aliasing experiments.
- **Quality-scaled horizon atlas**: Horizon preparation now uses preset-specific atlas sizes (`Fast` 768 px, `Balanced` 1024 px, `High` 1536 px) and resets cached horizon/daylight atlases when the requested size changes. The horizon compare is derivative- and quantization-aware, so edge filtering follows the horizon-angle signal instead of relying on a separate blur pass.
- **Readable sun-duration map**: The daylight accumulation atlas now maps visible sun time to a fraction of the actual sunrise-to-sunset duration for the selected date, then renders with a dark-purple to blue/teal/green/yellow/orange/red ramp where warmer colors mean more sun.

## Current Known Constraints
- The POC depends on `scripts/map/maplibre-gl-dev.js` exposing the custom `shadow`, `daylight`, and elevation-atlas readback hooks.
- Terrain rendering still depends on live Mapterhorn DEM tile requests.

---
*Created on 2026-02-24; refactored on 2026-04-27*
