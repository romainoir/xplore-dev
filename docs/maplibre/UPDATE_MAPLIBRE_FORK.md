# Updating the MapLibre Fork

Last checked: 2026-04-30.

The app currently runs a local MapLibre GL JS 5.24 fork:

- Runtime bundle: `scripts/map/maplibre-gl-dev.js`
- Active fork source: `maplibre-gl-js-5.24.0/`
- Legacy fork source kept for comparison: `maplibre-gl-js-5.18.0/`
- Main app CSS: `maplibre-gl-js-5.24.0/src/css/maplibre-gl.css`
- Shadow PoC: `docs/shadow-poc/shadow_debug_poc.html`

The custom shadow/daylight work is not a plugin. It is patched directly into the MapLibre renderer, style layer system, shaders, and generated dev bundle. Do not replace the fork with upstream MapLibre and expect shadows to keep working.

The terrain-analysis layers are also fork patches. Aspect, slope, avalanche, snow, and Igor relief are implemented as custom hillshade shader modes, not as separate app-only layers. If those shader modes are only partially ported, the layers will render as quantized derivative grayscale.

## Current Upstream Target

Use the latest stable 5.x release first. As of 2026-04-30:

- Latest stable target: `v5.24.0`
- Current app base: `v5.24.0`
- Current prerelease line: `v6.0.0-5`

Treat v6 as a separate migration. The current app loads `scripts/map/maplibre-gl-dev.js` from a classic `<script>` tag. If upstream v6 is ESM-only, the app loader and possibly test pages must move to module loading before v6 can work.

## What v5.19-v5.24 Brings

Useful upstream changes compared with the current v5.18 base:

- v5.24: GPU/text performance improvements, reduced GPU stalls, popup terrain/globe positioning fix, fog skip when opacity is zero.
- v5.23: touch zoom tuning APIs, worker request improvements, marker opacity and terrain/globe covered marker CSS, terrain rendering benchmark and `_demMatrixCache` performance fix.
- v5.22: data-driven `line-cap`, `line-miter-limit`, `line-round-limit`, transparent symbol early culling, clearer style property errors, stale async style-load crash fix.
- v5.21: ES2020 compatibility, tile request `referrerPolicy`, cleanup of legacy browser code.
- v5.20: ETag unmodified support, raster/hillshade/color-relief `resampling`, updateable GeoJSON-VT, high-pitch globe tile-distance fix.
- v5.19: `anisotropicFilterPitch`, better source id errors, raster/WebGL context-loss fixes, elevation bounds fixes.

For Xplore, the most relevant items are renderer performance, high-pitch terrain/globe fixes, raster/hillshade resampling, and context-loss stability. The update is worth testing, but the merge risk is real because the app has deep renderer patches.

Sources:

- https://github.com/maplibre/maplibre-gl-js/releases
- https://github.com/maplibre/maplibre-gl-js/releases/tag/v5.24.0
- https://github.com/maplibre/maplibre-gl-js/releases/tag/v5.18.0

## Files To Rebase Carefully

These are the known fork integration points. An LLM should inspect these first before trying to compile:

- `maplibre-gl-js-5.24.0/src/style/create_style_layer.ts`
- `maplibre-gl-js-5.24.0/src/style/style.ts`
- `maplibre-gl-js-5.24.0/src/style/style_layer/typed_style_layer.ts`
- `maplibre-gl-js-5.24.0/src/style/style_layer/shadow_style_layer.ts`
- `maplibre-gl-js-5.24.0/src/style/style_layer/daylight_style_layer.ts`
- `maplibre-gl-js-5.24.0/src/style/style_layer/shadow_style_layer_properties.g.ts`
- `maplibre-gl-js-5.24.0/src/style/style_layer/daylight_style_layer_properties.g.ts`
- `maplibre-gl-js-5.24.0/src/webgl/draw/draw_shadow.ts`
- `maplibre-gl-js-5.24.0/src/webgl/draw/draw_daylight.ts`
- `maplibre-gl-js-5.24.0/src/webgl/draw/draw_terrain.ts`
- `maplibre-gl-js-5.24.0/src/webgl/draw/draw_hillshade.ts`
- `maplibre-gl-js-5.24.0/src/render/terrain.ts`
- `maplibre-gl-js-5.24.0/src/render/painter.ts`
- `maplibre-gl-js-5.24.0/src/ui/map.ts`
- `maplibre-gl-js-5.24.0/src/webgl/program/program_uniforms.ts`
- `maplibre-gl-js-5.24.0/src/webgl/program/hillshade_program.ts`
- `maplibre-gl-js-5.24.0/src/webgl/program/terrain_program.ts`
- `maplibre-gl-js-5.24.0/src/webgl/program/shadow_program.ts`
- `maplibre-gl-js-5.24.0/src/webgl/program/shadow_prepare_program.ts`
- `maplibre-gl-js-5.24.0/src/webgl/program/daylight_program.ts`
- `maplibre-gl-js-5.24.0/src/webgl/program/horizon_program.ts`
- `maplibre-gl-js-5.24.0/src/shaders/shaders.ts`
- `maplibre-gl-js-5.24.0/src/shaders/glsl/hillshade*.glsl`
- `maplibre-gl-js-5.24.0/src/shaders/glsl/shadow*.glsl`
- `maplibre-gl-js-5.24.0/src/shaders/glsl/daylight*.glsl`
- `maplibre-gl-js-5.24.0/src/shaders/glsl/horizon_prepare.fragment.glsl`
- Generated shader files: `maplibre-gl-js-5.24.0/src/shaders/glsl/*.g.ts` after `npm run codegen`
- Built runtime copied into the app: `scripts/map/maplibre-gl-dev.js`
- Built source map copied into the app: `scripts/map/maplibre-gl-dev.js.map`

Use `rg "shadow-coarse|daylight-native|ShadowStyleLayer|drawGlobalShadow|drawDaylight|horizonPrepare|aspect-native|slope-native|avalanche-native|snow-native|queryTerrainElevation" maplibre-gl-js-5.24.0/src scripts/map/maplibre-gl-dev.js` to find all active patch points.

## Custom Shader Port Checklist

When rebasing to a newer MapLibre release, do not stop after copying GLSL files. The TypeScript wrappers decide which uniforms exist, how textures are bound, and which draw function runs for a style layer.

Terrain analysis / hillshade:

- `src/shaders/glsl/hillshade.fragment.glsl` must include custom methods `ASPECT`, `SLOPE`, `AVALANCHE`, and `SNOW`.
- `src/shaders/glsl/hillshade_prepare.fragment.glsl` must encode derivatives in the custom `deriv / 8.0 + 0.5` format and pass normalized elevation in the blue channel for snow.
- `src/webgl/program/hillshade_program.ts` must bind all custom uniforms used by the GLSL: `u_image_raw`, `u_unpack`, `u_dimension`, `u_metersPerPixel`, `u_snow_altitude`, `u_snow_maxSlope`, `u_slope_min`, `u_slope_max`, `u_skyHighlight`, and `u_skyShadow`.
- `src/webgl/program/hillshade_program.ts` must force method IDs by layer id: `aspect-native -> 6`, `slope-native -> 7`, `avalanche-native -> 8`, `snow-native -> 9`.
- `src/webgl/draw/draw_hillshade.ts` must bind the prepared derivative FBO on texture unit 0 and the raw DEM texture on texture unit 1 before drawing analytical hillshade modes.
- `src/ui/map.ts` must keep the Xplore `Map.queryTerrainElevation()` override. Upstream `Camera.queryTerrainElevation()` returns `null` when 3D terrain is disabled, but Xplore's 2D aspect/slope/avalanche hover readout needs to sample loaded raster-dem tiles in 2D.

Shadow/daylight:

- `src/style/create_style_layer.ts`, `src/style/style.ts`, and `src/style/style_layer/typed_style_layer.ts` must recognize non-standard `shadow` and `daylight` style layer types.
- `src/webgl/draw/index.ts` must register `drawShadow` and `drawDaylight`.
- `src/webgl/program/program_uniforms.ts` and `src/shaders/shaders.ts` must register every custom program/shader pair.
- `src/render/painter.ts` must call the elevation/depth/coordinate atlas path and dispatch shadow/daylight render layers.
- `src/render/terrain.ts` must own and destroy the custom atlas/framebuffer resources.
- `src/webgl/draw/draw_daylight.ts` must render Sunlight Hours, First Sun, and Last Sun with the same terrain-aware projection contract as raster/hillshade/shadow: call `getTerrainData(coord)` and use `getProjectionData({overscaledTileID: coord, aligned: !painter.options.moving, applyGlobeMatrix: !isRenderingToTexture, applyTerrainMatrix: true})`. If `applyGlobeMatrix` is forced off, the duration layers render as flat overlays instead of conforming to pitched terrain.

MapLibre 5.24 projection caveat:

- Do not add legacy fields such as `u_matrix` to `ProjectionData`. In 5.24, `Program.draw()` maps every projection-data field through `projectionObjectToUniformMap`; unknown fields crash with `this.projectionUniforms[uniformName].set`. For custom atlas rendering, override `projectionData.mainMatrix` only.

## Safe Update Workflow

1. Start clean.

   ```bash
   git status --short
   git log --oneline --max-count=5
   ```

   Only proceed if the main app changes are committed. Existing nested dirty directories should be understood before touching them.

2. Create a new upstream source folder instead of replacing the old one.

   ```bash
   git clone --depth=1 --branch v5.24.0 https://github.com/maplibre/maplibre-gl-js.git /tmp/maplibre-gl-js-v5.24.0
   cp -R /tmp/maplibre-gl-js-v5.24.0 ./maplibre-gl-js-5.24.0
   ```

3. Port the custom shadow/daylight files.

   Do not copy whole directories blindly. For each file listed in "Files To Rebase Carefully":

   - Compare upstream 5.18, current fork 5.18, and upstream target.
   - Reapply only the shadow/daylight/horizon/terrain-atlas logic.
   - Preserve any new upstream changes in the target version.
   - Keep generated files consistent with source files.

4. Build the new fork.

   ```bash
   cd maplibre-gl-js-5.24.0
   npm ci
   npm run codegen
   npm run build-dev
   npm run build-css
   ```

5. Copy the validated build into the app.

   ```bash
   cp maplibre-gl-js-5.24.0/dist/maplibre-gl-dev.js scripts/map/maplibre-gl-dev.js
   cp maplibre-gl-js-5.24.0/dist/maplibre-gl-dev.js.map scripts/map/maplibre-gl-dev.js.map
   ```

   Then update CSS references:

   - `index.html`
   - `docs/shadow-poc/shadow_debug_poc.html`

   Replace any old CSS references with `maplibre-gl-js-5.24.0/src/css/maplibre-gl.css`.

6. Static verification.

   ```bash
   node --check scripts/map/maplibre-gl-dev.js
   node --check scripts/app/xploremap-app.js
   node --check scripts/app/imagery-manager.js
   node --check scripts/app/overlay-manager.js
   node --check scripts/app/shadow-controller.js
   node --check scripts/app/terrain-analysis-controller.js
   git diff --check
   ```

7. Visual verification in Safari.

   Minimum checklist:

   - App loads in 2D and 3D.
   - Shadow, Sunlight Hours, First Sun, and Last Sun layers render.
   - Aspect, slope, avalanche, snow, and Igor hillshade render with their expected colors, not grayscale derivative tiles.
   - Aspect and slope hover values appear in 2D mode.
   - Date slider updates daylight layers.
   - Date and time sliders update shadow layer.
   - Panning, rotating, zooming do not recompute shadows while the camera moves.
   - Pitch above 45 degrees does not squeeze the foreground atlas badly.
   - The shadow PoC still matches the main app behavior.
   - Safari console has no `missing FBO textures`, `Can't find variable`, or style-spec validation errors.

8. Commit in small pieces.

   Recommended commits:

   - `Add MapLibre 5.24 fork source`
   - `Port shadow renderer to MapLibre 5.24`
   - `Update app to MapLibre 5.24 bundle`
   - `Remove old MapLibre 5.18 fork after validation`

   Do not remove `maplibre-gl-js-5.18.0/` until Safari validation is done.

## LLM Handoff Prompt

Use this prompt for an LLM that will perform the update:

```text
You are updating the Xplore MapLibre fork from v5.18.0 to the latest stable v5.x release.

Do not replace the app with vanilla MapLibre. Preserve the custom shadow, daylight, horizon-atlas, terrain-atlas, and integrated Igor relief behavior.

Start by reading docs/maplibre/UPDATE_MAPLIBRE_FORK.md, docs/shadow-poc/shadow_poc_summary.md, scripts/app/overlay-manager.js, scripts/app/shadow-controller.js, and the current MapLibre custom files listed in the update guide.

Create a new maplibre-gl-js-<version>/ folder, port the custom renderer changes file by file, build with npm run codegen and npm run build-dev, copy dist/maplibre-gl-dev.js to scripts/map/maplibre-gl-dev.js, update CSS references, run node --check and git diff --check, then summarize exact changed files and remaining risks.

Do not delete the old fork until the new fork is visually validated in Safari.
```
