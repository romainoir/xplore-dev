# Xplore Terrain Shadows: Current Implementation And Improvement Notes

This document describes the current custom MapLibre terrain shadow pipeline in
`vendor/maplibre/maplibre-gl-js-5.24.0` and the app-side controller in `scripts/app`.

The goal is fast, map-native terrain cast shadows over MapLibre terrain, with
time/date control, daylight/sunrise/sunset layers, and acceptable performance in
Safari. The current state is usable, but the cast-shadow edge quality is still
limited by atlas resolution and by the way the near refinement is composited.

## Executive Summary

The app computes terrain shadows in a top-down elevation atlas:

1. Render visible/caster terrain DEM tiles into a packed elevation atlas.
2. Run a fullscreen raymarch shader over that atlas to produce a shadow mask.
3. Bilinearly upsample the raw mask into the final shadow texture.
4. During terrain rendering, sample that shadow texture by world/Mercator UV.
5. Add local Igor-like self-shadow from the native DEM/derivative texture.
6. Composite sky/night/fog and shadow tint in the terrain fragment shader.

The important limitation:

```text
3D terrain relief is rendered at MapLibre terrain tile resolution.
Cast shadows are rendered at shadow-atlas resolution.
If the atlas covers a large area, one shadow texel can cover many terrain pixels.
That produces edge offsets, staircase silhouettes, and soft/late contact.
```

The recently added `near atlas` is currently only a secondary mask combined with:

```glsl
shadowMask = max(globalShadowMask, nearShadowMask);
```

That means the near atlas can add missing shadow, but it cannot remove or correct
a coarse global shadow that is already too large, too shifted, or too soft. This
is likely why blue-tinted near-shadow areas do not look materially more refined.

## Relevant Files

Core atlas and terrain rendering:

- `vendor/maplibre/maplibre-gl-js-5.24.0/src/webgl/draw/draw_terrain.ts`
- `vendor/maplibre/maplibre-gl-js-5.24.0/src/webgl/draw/draw_shadow.ts`
- `vendor/maplibre/maplibre-gl-js-5.24.0/src/render/painter.ts`
- `vendor/maplibre/maplibre-gl-js-5.24.0/src/render/terrain.ts`

Shaders:

- `vendor/maplibre/maplibre-gl-js-5.24.0/src/shaders/glsl/shadow_global.fragment.glsl`
- `vendor/maplibre/maplibre-gl-js-5.24.0/src/shaders/glsl/terrain.vertex.glsl`
- `vendor/maplibre/maplibre-gl-js-5.24.0/src/shaders/glsl/terrain.fragment.glsl`

Uniform setup:

- `vendor/maplibre/maplibre-gl-js-5.24.0/src/webgl/program/shadow_program.ts`
- `vendor/maplibre/maplibre-gl-js-5.24.0/src/webgl/program/terrain_program.ts`

App-side scheduling and sun profile:

- `scripts/app/shadow-controller.js`

Generated bundle used by the app:

- `scripts/map/maplibre-gl-dev.js`

## Coordinate Systems

The shadow atlas is in normalized WebMercator world coordinates:

```text
world x: 0..1 over the whole world width
world y: 0..1 over Mercator y
```

For a terrain tile:

```text
tile id = (z, x, y)
vertex local position = p_tile in [0, 8192]^2
world_uv = (vec2(x, y) + p_tile / 8192) / 2^z
```

The terrain vertex shader computes atlas coordinates:

```glsl
v_atlas_uv = (world_uv - u_atlas_bounds.xy) /
             (u_atlas_bounds.zw - u_atlas_bounds.xy);
v_atlas_uv.y = 1.0 - v_atlas_uv.y;
```

The near atlas uses the same formula but with `u_near_atlas_bounds`.

The Y flip is needed because the elevation atlas is rendered with an orthographic
matrix that maps Mercator minY/maxY into framebuffer coordinates.

## Runtime Scheduling

The app does not recompute shadows while moving the map:

```text
camera move start -> _shadowProgressivePhase = "held"
camera moving     -> reuse last shadow atlas
camera idle       -> preview pass
later             -> full pass
later             -> near refine pass
```

Current defaults in `scripts/app/shadow-controller.js`:

```js
_shadowAtlasSize = 2048
_shadowMaskScale = 0.5
_shadowNearAtlasSize = 1024
_shadowNearMaskScale = 1.0
_shadowNearDebugTint = true
```

So the global shadow atlas is a 2048 final texture but the raw mask is normally
1024 because `2048 * 0.5 = 1024`. The near atlas is currently 1024 final and
1024 raw.

The sun altitude controls shadow reach:

```text
high sun -> shorter max distance, fewer atlas tiles
low sun  -> longer max distance, more far caster tiles
```

The profile values are written to:

```js
window._shadowReachProfile
```

and include:

```text
maxDistance
midReachMeters
farReachMeters
nearCascadeMeters
midCascadeMeters
maxTiles
maxCoreTiles
preview*
refine*
```

## Pass 1: Elevation Atlas Generation

Implemented in `drawElevationAtlas(...)` in `draw_terrain.ts`.

There are two targets:

```text
global atlas -> target = "global"
near atlas   -> target = "near"
```

### 1. Visible bounds

First, all renderable terrain tiles are converted into Mercator bounds:

```text
tile span = 1 / 2^z
tile min = (wrap + x / 2^z, y / 2^z)
tile max = min + span
```

At high pitch, the global bounds are clamped to the foreground/lower screen area
so the atlas is not dominated by horizon tiles:

```text
pitchFactor = clamp((pitch - 42) / 18, 0, 1)
screenTop = 0.42 * pitchFactor
```

Sampled screen points are projected onto terrain using MapLibre transform
functions, then expanded by a margin.

For the near atlas, a tighter set of screen samples is used:

```text
pitched:
  x = [0.18, 0.38, 0.62, 0.82]
  y = [0.46, 0.62, 0.78, 0.94]

not pitched:
  x = [0.22, 0.50, 0.78]
  y = [0.30, 0.50, 0.70]
```

### 2. LOD tile selection

The atlas does not simply render every visible tile at one zoom. It builds three
LOD bands:

```text
core band: visible bounds at coreZoom
mid band:  visible bounds extended toward sun, at coreZoom - 1
far band:  visible bounds extended further toward sun, at coreZoom - 2
```

Diagram:

```text
sun direction ->

        far band, low zoom, large area
   +----------------------------------+
   |                                  |
   |      mid band                    |
   |   +----------------------+       |
   |   |                      |       |
   |   |   core/visible       |       |
   |   |   high detail        |       |
   |   +----------------------+       |
   |                                  |
   +----------------------------------+
```

The extension toward sun is:

```text
extension = reachMeters / WORLD_CIRCUMFERENCE

if dx >= 0: maxX += extension else minX -= extension
if dy >= 0: maxY += extension else minY -= extension
```

This tries to include terrain in the direction the sunlight comes from, because
that terrain can cast shadows onto the visible area.

The selected tiles are limited by a max tile count. If too many tiles are needed,
the far/mid zooms are lowered.

Current near refinement LOD defaults:

```text
refineMaxTiles:       52 -> 68 depending on low sun
refineMaxCoreTiles:   30 -> 38
refineZoomBias:       0.85 -> 1.05
refineMidReachMeters: 900 -> 1600
refineFarReachMeters: 2800 -> 6200
```

### 3. Rendering DEM into the elevation atlas

For each selected terrain tile, we render its terrain mesh into a top-down
orthographic framebuffer:

```ts
mat4.ortho(orthoMatrix, minX, maxX, maxY, minY, -10000, 10000)
```

The tile matrix maps MapLibre tile-local mesh coordinates into normalized
Mercator world coordinates:

```text
tileMatrix = translate(wrap + x / 2^z, y / 2^z)
tileMatrix *= scale(1 / 2^z / 8192, 1 / 2^z / 8192, 1)
finalMatrix = orthoMatrix * tileMatrix
```

The elevation is packed into RGBA. Because RGBA byte interpolation corrupts
packed floats, the elevation atlas texture uses `NEAREST` filtering. Bilinear
height sampling is done manually in the shadow shader by decoding four nearest
samples.

## Pass 2: Shadow Mask Raymarch

Implemented in `drawGlobalShadow(...)` and `shadow_global.fragment.glsl`.

The shader runs once per output shadow-mask pixel. For a pixel at atlas UV `p`,
the receiver elevation is:

```glsl
h0 = sampleElevationBilinear(p)
```

Sun direction:

```text
dir = (sin(azimuth), -cos(azimuth))
alt = sun altitude in radians
```

One meter in Mercator world UV:

```glsl
worldStepPerMeter = dir / WORLD_CIRCUMFERENCE
sampleUVStepPerMeter = worldStepPerMeter / (atlasBounds.zw - atlasBounds.xy)
sampleUVStepPerMeter.y *= -1
```

The ray height at distance `d` meters from receiver toward the sun is:

```text
h_ray(d) = h0 + d * tan(alt)
```

Terrain height sampled along the ray:

```text
h_terrain(d) = elevation(p + d * sampleUVStepPerMeter)
```

The receiver is shadowed if:

```text
exists d in (0, maxDistance) such that h_terrain(d) > h_ray(d)
```

Pseudo-code:

```glsl
shadow = 0
d = jitter
uv = p + d * stepUV
rayH = h0 + d * tanSun

for i in 0..maxSteps:
    step = stepMeters * cascadeStepMultiplier(d)
    d += step
    uv += step * stepUV
    rayH += step * tanSun

    terrainH = sampleElevationBilinear(uv)
    if terrainH > rayH:
        binary search 5 iterations between previous and current point
        shadow = distanceFade
        break
```

The step multiplier is a simple distance cascade:

```glsl
nearToMid = smoothstep(nearDistance * 0.75,
                       nearDistance * 1.25,
                       distanceMeters)

midToFar = smoothstep(midDistance * 0.75,
                      midDistance * 1.25,
                      distanceMeters)

multiplier = mix(mix(1.0, 2.75, nearToMid), 7.0, midToFar)
```

So the raymarch uses smaller steps near the receiver and larger steps far away.

The raw shadow mask is rendered into:

```text
global: shadow_blur FBO, usually 1024 if final atlas is 2048 and maskScale=0.5
near:   near_shadow_blur FBO, currently 1024
```

Then the raw mask is copied/upsampled into:

```text
global final: shadow FBO
near final:   near_shadow FBO
```

with linear filtering.

## Pass 3: Terrain Composite

Implemented in `terrain.fragment.glsl`.

Each terrain fragment has:

```text
v_atlas_uv      -> lookup into global shadow atlas
v_near_atlas_uv -> lookup into near shadow atlas
v_dem_coord     -> lookup into the per-tile DEM/derivative texture
```

The global shadow texture is sampled and post-filtered:

```glsl
rawAtlasShadow = texture(u_shadow_atlas, atlasUV).r
raymarchedShadow = remapShadowMask(rawAtlasShadow, atlasUV)
```

`remapShadowMask` applies:

- `smoothstep` thresholding
- edge gradient detection with `fwidth`
- small noise-based UV/threshold jitter
- oriented PCF samples along the estimated edge normal/tangent

This cleans up the rendered mask, but it cannot recover sub-texel geometric
accuracy that was lost during atlas generation or raymarching.

The near atlas is sampled if available:

```glsl
rawNearShadow = texture(u_shadow_near_atlas, v_near_atlas_uv).r
nearShadowMask = remapNearShadowMask(rawNearShadow, v_near_atlas_uv)
shadowMask = max(shadowMask, nearShadowMask)
```

Important: `max()` makes the near atlas conservative. It can add occlusion but
cannot carve away a coarse/global false positive.

The cyan debug tint is:

```glsl
if (_shadowNearDebugTint && nearShadowMask > 0.01):
    tint cyan
```

Therefore, blue means:

```text
near atlas is sampled and has nonzero shadow
```

It does not mean:

```text
near atlas is improving the final edge
```

because the final edge may still be dominated by the global mask.

## Local Igor-Like Self Shadow

The app also computes local terrain relief independent from the global shadow
atlas. This is the "Igor-like" relief inside the terrain shader.

The shader samples either:

- prepared native hillshade derivative texture, or
- per-fragment DEM Sobel fallback.

Gradient:

```text
g = (dz/dx, dz/dy)
normal = normalize((-g.x, -g.y, 1))
lightDir = normalize((sunDir.x, sunDir.y, tan(sunAltitude)))
lambert = dot(normal, lightDir)
```

Self-shadow signal:

```glsl
slopeStrength = atan(length(g) * 2.0) * 2.0 / PI
shadow = slopeStrength *
         (1.0 - smoothstep(0.08, 0.62, lambert)) *
         lowSunBoost
```

This is full-resolution relative to the terrain DEM/derivative tile, not the
global shadow atlas. It explains why local relief can look sharper than cast
shadows.

## Why The Current Edges Are Offset Or Under-Resolved

There are multiple error sources.

### 1. Atlas texel footprint

The effective atlas ground sample distance is:

```text
atlasGSDx = (atlasBounds.maxX - atlasBounds.minX) * WORLD_CIRCUMFERENCE / maskSize
atlasGSDy = (atlasBounds.maxY - atlasBounds.minY) * WORLD_CIRCUMFERENCE / maskSize
atlasGSD = max(atlasGSDx, atlasGSDy)
```

If the atlas covers 8 km with a 1024 raw mask:

```text
atlasGSD ~= 8000 / 1024 ~= 7.8 m/px
```

If it covers 18 km:

```text
atlasGSD ~= 17.6 m/px
```

The shadow edge cannot be geometrically accurate below roughly half to one atlas
texel before filtering.

### 2. Raymarch step size

The shader tests terrain only at discrete distances:

```text
d_n = d_0 + sum(stepMeters * cascadeMultiplier)
```

A binary search after a hit refines the hit location, but the initial detection
still depends on where sampled elevations cross the ray. Coarser far steps can
miss or delay contact with narrow ridges.

### 3. DEM/elevation interpolation error

Height error becomes horizontal shadow error:

```text
horizontal_error ~= height_error / tan(sunAltitude)
```

At low sun:

```text
sunAltitude = 5 deg
tan(5 deg) ~= 0.087
10 m height error -> 115 m horizontal error
```

This is why dawn/sunset are both the most important and hardest cases.

### 4. Global mask is post-filtered, not physically refined

`remapShadowMask` and the bilinear upsample can make edges less ugly, but they
operate on an already quantized mask. They can soften or dither a stair-step
edge, but they cannot know the true terrain silhouette if the mask missed it.

### 5. Near atlas currently uses `max`, not replacement

This is probably the main reason the blue debug areas are not visibly refined.

Current:

```glsl
final = max(global, near)
```

Better for refinement:

```glsl
final = mix(global, near, nearAuthority)
```

or:

```glsl
final = near inside reliable near coverage
final = global outside near coverage
```

But this needs care because near atlas may not contain long-distance casters.
If near replaces global blindly, distant mountain shadows may disappear.

## Current Near Atlas Behavior

The near atlas is generated after the full pass with:

```text
_shadowProgressivePhase = "refine"
```

It has its own:

```text
near_elevation
near_shadow_blur
near_shadow
_shadowNearAtlasBounds
```

It uses a tighter screen-sampled footprint and a smaller max distance:

```text
refineMaxDistance = 3200..6200 m
```

This is not yet a true high-quality refinement because:

1. The near final atlas is only 1024, not 2048 or 4096.
2. It still runs the same atlas raymarch algorithm.
3. It is combined with `max(global, near)`.
4. If the near footprint is still large, its GSD is not much better.
5. It cannot remove coarse global shadow where global is wrong.

## 4K/8K Sparse Atlas Idea

The user's idea:

```text
Generate a larger 4K/8K atlas quickly by sampling every 2 or 4 pixels.
Then refine only pixels near the shadow edge/border.
```

This is conceptually sound, but in WebGL it requires a multi-pass design.

Memory costs:

```text
RGBA8 2048^2  ~= 16 MB per texture
RGBA8 4096^2  ~= 64 MB per texture
RGBA8 8192^2  ~= 256 MB per texture
```

A full pipeline needs at least:

```text
elevation atlas
raw shadow mask
final shadow mask
possibly edge mask / temporary mask
```

So 8K is risky in Safari. 4K may be possible on desktop but should be optional
and not default.

A sparse 4K/8K render is not automatic. Drawing a fullscreen 8K fragment shader
and discarding 3/4 pixels still launches many fragments. Better designs:

### Option A: Low-res raw mask + high-res edge refinement

```text
1. Render coarse shadow mask at 1024 or 2048.
2. Upsample to 4096.
3. Build an edge mask: edge = abs(dFdx(mask)) + abs(dFdy(mask)).
4. Re-run expensive raymarch only where edge > threshold.
5. Composite:
   final = refined on edge band, coarse elsewhere.
```

In WebGL, step 4 is hard to make truly sparse without compute shaders. It can
still early-out in the fragment shader:

```glsl
if (edge < threshold) {
    fragColor = coarseValue;
    return;
}
run expensive raymarch
```

That saves ALU for non-edge pixels but still pays rasterization cost.

### Option B: Block/tile edge refinement

```text
1. Classify edge blocks, e.g. 16x16 or 32x32 pixel blocks.
2. Render small quads/scissor rectangles only for active blocks.
3. Refine only those blocks into a higher-res shadow texture.
```

This is closer to sparse rendering. It avoids full 4K/8K expensive passes, but
requires GPU-side or CPU-side block list management. CPU readback would stall, so
the best version uses a GPU reduction/pyramid or conservative CPU heuristics.

### Option C: Cascaded atlas replacement

Use multiple atlases:

```text
near: high resolution, small footprint, authoritative
mid:  current global 2K footprint
far:  low resolution, long range
```

Composite:

```text
if inside near reliable area:
    shadow = max(near, farLongRangeContribution)
else:
    shadow = global
```

This is more compatible with WebGL and MapLibre than true sparse 8K.

### Option D: Horizon-angle textures

For each pixel/tile and direction bin, precompute:

```text
H_theta(p) = max over s>0 of atan((height(p + s*dir_theta) - height(p)) / s)
```

Then current sun shadow becomes:

```text
shadow(p) = sunAltitude < H_sunAzimuth(p)
```

This is excellent for realtime time slider/daylight accumulation because changing
time only changes the comparison angle. It is less expensive per frame once the
horizon texture exists.

But the quality still depends on horizon texture resolution and direction bins.
It is a good long-term direction for sun duration, sunrise/sunset, and maybe
current shadows if computed at high enough resolution.

## Most Likely Next Improvements

### 1. Make near atlas authoritative inside reliable coverage

Current:

```glsl
shadow = max(global, near)
```

Proposed:

```glsl
nearCoverage = inside near atlas, away from near border
shadow = mix(global, near, nearCoverage)
```

But because near may not include far casters:

```glsl
shadow = max(mix(global, near, nearCoverage), globalFarOnly)
```

This suggests splitting global into:

```text
global local/mid
global far-only
```

or making near include enough far reach at low sun.

### 2. Increase near atlas to 2048 before trying 4K global

A safe diagnostic:

```js
window._shadowNearAtlasSize = 2048
window._shadowNearMaskScale = 1.0
```

If blue areas suddenly sharpen, the problem is mostly near atlas GSD. If not, the
problem is mostly composition/raymarch/coverage.

### 3. Log and display GSD

The debug UI should show:

```text
global m/px
near m/px
global bounds km
near bounds km
capture zooms
source zooms
parent fallbacks
raw mask size
final mask size
```

This will make it obvious when the near atlas is not actually more detailed than
the global atlas.

### 4. Edge-only local ray refinement in terrain fragment

For fragments near global shadow edges:

```glsl
edge = fwidth(globalShadowMask) or abs(gradient)
if edge high:
    run a short raymarch against per-tile DEM / neighbor DEM
```

This can anchor the start of cast shadows to the same resolution as the terrain
DEM, at least for local/contact shadows. It will not solve long mountain shadows
by itself, but it can fix the visible contact offset around ridges.

### 5. Separate contact shadows from long-range shadows

Use two systems:

```text
long-range cast shadows:
    atlas / horizon / LOD, stable and broad

contact/ridge shadows:
    high-res local DEM/neighbor ray, short distance only
```

Composite:

```glsl
finalShadow = max(longRangeShadow, contactShadow)
```

This is likely better visually than trying to make one global atlas solve both
20 km mountain shadows and 5 m ridge contact detail.

## Diagnostic Interpretation Of The Current Blue Tint

If the screen is blue in shadowed zones:

```text
near atlas is bound
near atlas has nonzero shadow there
terrain shader is sampling it
```

If the edge is not sharper:

```text
near mask is not higher quality than global at that location
or global mask still dominates final output
or near mask lacks the caster/receiver resolution needed
or post-filtering is smoothing the same quantized edge
```

The most suspicious design issue is the `max(global, near)` composite. A true
refinement pass should be allowed to replace the global result inside a reliable
near coverage zone. Otherwise it cannot correct false-positive global shadow.

## Assessment Of Four Proposed Next Architectures

This section evaluates four possible improvements against the current MapLibre
constraints: WebGL, Safari, tiled DEM sources, 2D and 3D map modes, long mountain
shadows, time/date sliders, and the need to stay interactive while panning.

### 1. Hierarchical raymarching with max-mip elevation

This is a strong idea if we keep the atlas/raymarch architecture. The current
shader advances with a mostly fixed metric step:

```text
p0 = receiver position
L  = horizontal sun direction in atlas UV
a  = sun altitude
d  = ray distance in meters

rayHeight(d) = h(p0) + d * tan(a)
terrainHeight(d) = h(p0 + L * d)

shadowed if terrainHeight(d) > rayHeight(d) + bias
```

The expensive part is that every pixel samples many distances:

```text
for d = stepMeters; d < maxDistance; d += stepMeters:
    test one terrain sample
```

A max-mip pyramid changes the atlas from this:

```text
mip 0: exact elevation, one value per atlas pixel
mip 1: max elevation over 2x2 child pixels
mip 2: max elevation over 4x4 child pixels
mip 3: max elevation over 8x8 child pixels
...
```

The ray can then skip over a block if the whole block is guaranteed to be below
the ray. The conservative test is not just:

```text
maxHeight(block) < rayHeight(blockCenter)
```

It should use the lowest ray height that crosses the block:

```text
maxHeight(block) < minRayHeightOverBlock - bias
```

If this is true, the ray cannot hit anything inside the block, so it can jump to
the next block. If false, the traversal descends to a finer mip level.

Visual sketch:

```text
current fixed march:

receiver *----x----x----x----x----x----x----x----x---->
              all samples cost roughly the same

max-mip march:

receiver *---------[skip big block]---------[skip]--x-x->
                                                 refine only near possible hits
```

This can reduce ALU work, especially across valleys and flat areas. It also
reduces missed narrow ridges if the mip pyramid is conservative.

Important caveats:

- WebGL default mipmaps are averages, not max values. We need custom FBO passes.
- A 4K max pyramid costs memory and bandwidth, but much less than full brute
  force raymarching at 4K.
- Near the horizon, `tan(a)` is small, so rays stay close to terrain for a very
  long distance. Even hierarchical traversal can spend time refining many
  potential contacts.
- It still produces an atlas-resolution mask. It improves marching accuracy and
  performance, but it does not magically give subpixel contact edges.

Verdict for this project: good medium-term upgrade for the global/macro atlas,
especially if we want 4K. It does not fully solve the local ridge/contact offset
alone.

### 2. Logarithmic shadow sweep / parallel prefix max

The useful mathematical reformulation is this. For one fixed sun azimuth and
altitude, a receiver pixel is shadowed if any upstream terrain point has a larger
apparent elevation angle:

```text
H(p, azimuth) = max over s > 0 of atan((h(p + sL) - h(p)) / s)

shadowed if H(p, azimuth) > sunAltitude
```

Equivalently, for one fixed sun altitude `a`:

```text
shadowed if max over s > 0 of [h(p + sL) - s * tan(a)] > h(p) + bias
```

That is a directional max-prefix problem. Instead of every pixel marching
independently, we propagate the best upstream blocker through the atlas:

```text
pass 0: compare distance 1 pixel
pass 1: compare distance 2 pixels
pass 2: compare distance 4 pixels
pass 3: compare distance 8 pixels
...
pass N: compare distance 2^N pixels
```

For a 2048 atlas this is about 11 full-screen passes. For a 4096 atlas it is
about 12 passes.

Visual sketch:

```text
sun direction ---->

pass 1: each pixel learns from neighbor 1
pass 2: each pixel learns from neighbor 2
pass 3: each pixel learns from neighbor 4
pass 4: each pixel learns from neighbor 8

after log2(width) passes:
each pixel knows the best upstream blocker along that discrete direction
```

This is attractive because it replaces one heavy fragment loop with many very
small passes. It also avoids fixed-step ray misses.

Important caveats:

- The "exact" version is cleanest when the sun direction aligns with a texture
  axis or a simple grid direction. Arbitrary azimuth needs bilinear addressing,
  fractional offsets, or multiple directional sweeps.
- It is exact at atlas-pixel resolution, not continuous world resolution.
- It is bandwidth-heavy: 11 or 12 full-atlas read/write passes can be fine on
  desktop, but Safari/mobile may still be sensitive.
- It depends on how much state can be packed in the FBO. To propagate the best
  blocker robustly, we may need height plus distance or a transformed scalar.

Verdict for this project: very interesting for the global shadow pass and worth
prototype testing. It could remove the current raymarch step artifacts. It still
needs edge filtering or a high-res near/contact pass for close detail.

### 3. Horizon Angle Maps

This is the best match for a map application with date/time sliders. Terrain is
static; only the sun changes. So the expensive visibility information can be
precomputed per terrain tile.

For every DEM texel and every stored azimuth direction:

```text
horizonAngle(p, azimuth_i) =
    max over s in [sMin, sMax] of atan((h(p + sL_i) - h(p)) / s)
```

At render time:

```glsl
float h0 = sampleHorizonTexture(azimuth0);
float h1 = sampleHorizonTexture(azimuth1);
float horizon = mix(h0, h1, azimuthFraction);

float shadow = sunAltitude < horizon ? 1.0 : 0.0;
```

For daylight duration:

```text
duration(p) = sum over time samples t:
    sunAltitude(t) > horizonAngle(p, sunAzimuth(t))
```

This is ideal for:

- dragging the time slider,
- sunrise and sunset heatmaps,
- sun-duration accumulation,
- mobile performance,
- stable results independent of the current camera.

Memory example:

```text
16 azimuths stored as 8-bit angle:
    16 bytes per DEM texel if stored naively

16 azimuths packed as 4 RGBA8 textures:
    4 texture fetches, 16 directions

32 azimuths packed as 8 RGBA8 textures:
    smoother azimuth interpolation, more memory/fetches
```

Important caveats:

- Precomputation must include cross-tile neighbors or parent/halo DEM data.
  Otherwise mountains just outside the tile will not cast into the tile.
- Runtime WebWorker computation is possible but not trivial at high zooms and
  large horizons. Server/prebuilt horizon tiles are cleaner.
- Quantization matters. 8-bit angles may be enough visually, but 16-bit is safer
  for low sun angles.
- The output is still a hard visibility value unless we add angular filtering,
  blue-noise dithering, or an estimated sun-disk penumbra.
- It does not directly produce "soft edge geometry"; it gives fast, stable
  visibility at DEM resolution.

Verdict for this project: best long-term architecture. It is especially strong
for time/date interaction and sun-duration layers. It is a bigger system change
because it needs horizon textures per DEM tile, source management, cache policy,
and cross-tile horizon generation.

### 4. Screen-space contact shadows plus macro atlas

This targets a different failure mode: contact alignment. The current cast
shadow mask is made in a top-down atlas. A close ridge can be hundreds of screen
pixels wide but only a few atlas pixels wide. That causes visible offsets where
the shadow does not start exactly at the rendered ridge.

Screen-space shadows use the rendered depth buffer:

```text
for each screen pixel:
    reconstruct world position from depth
    march a short ray toward the sun in screen/depth space
    if depth along ray is closer than expected, local terrain blocks the light
```

Visual split:

```text
macro atlas:
    far mountains
    long valley shadows
    stable broad occlusion

screen-space/contact:
    visible ridges
    foreground terrain
    exact start of the shadow on the rendered surface
```

This is common in game engines because it gives excellent local contact detail.

Important caveats:

- It only knows what is visible in the current camera depth buffer. Off-screen
  mountains cannot cast screen-space shadows.
- It can change with camera pitch/bearing because visibility changes.
- It requires reliable depth texture access and world reconstruction inside the
  MapLibre render pipeline.
- It is most useful in 3D/high-pitch views, less useful for flat 2D map mode.

Verdict for this project: useful as a later complement, not the primary system.
It can fix visible local anchoring, but the map still needs a macro atlas or
horizon maps for long mountain shadows.

## Recommended Direction From Here

The proposed architectures are not mutually exclusive. The cleanest path for
this project is probably staged:

```text
stage 1, immediate:
    fix current near cascade composition
    make near atlas authoritative inside reliable coverage
    keep global atlas for far shadows

stage 2, quality/performance:
    replace brute raymarch global pass with either:
        max-mip hierarchical traversal
        or logarithmic directional sweep

stage 3, product-level time slider:
    build horizon-angle textures for DEM tiles
    use them for instant time changes and daylight/sunrise/sunset layers

stage 4, optional 3D polish:
    add screen-space contact shadows for foreground/high-pitch views
```

For the current blue-shadow problem, the most relevant fix is not yet one of
the big new architectures. It is the cascade composition rule:

```glsl
// current behavior: near can only add shadow
shadow = max(globalShadow, nearShadow);

// better behavior inside reliable near coverage:
shadow = mix(globalShadow, nearShadow, nearAuthority);
```

The hard part is choosing `nearAuthority`. It should be high only where the near
atlas contains both the receiver and enough upstream terrain in the sun
direction. Otherwise the near atlas may miss far mountain blockers.

One practical compromise:

```glsl
float nearCoverage = insideNearAtlasWithSunUpstreamMargin(worldUv);
float globalEdge = estimateEdgeStrength(globalShadow);

// Use near strongly around coarse global edges.
// Keep global in broad far-shadow interiors.
float nearAuthority = nearCoverage * smoothstep(edgeLow, edgeHigh, globalEdge);

shadow = mix(globalShadow, nearShadow, nearAuthority);
shadow = max(shadow, farMountainShadowConfidence * globalShadow);
```

This lets the near cascade fix visible jagged edges without throwing away broad
long-range shadows from mountains outside the near footprint.

## Short Version For Another AI

The current implementation is a MapLibre terrain shadow system based on a
top-down WebMercator elevation atlas. It renders DEM terrain tiles into a packed
RGBA elevation framebuffer, raymarches a shadow mask in atlas UV toward the sun,
upsamples the raw mask, and samples it in the terrain shader using per-fragment
world UV. It also adds full-resolution local Igor-like self-shadow from DEM
gradients/derivatives.

The core quality problem is that cast-shadow silhouettes are limited by atlas
GSD, not terrain tile resolution. Post-filtering cannot recover geometry lost in
the atlas mask. A recently added near atlas is sampled and tinted blue, but it is
currently combined via `max(global, near)`, so it cannot remove or correct coarse
global shadows. For real improvement, either make a high-res near cascade
authoritative in its footprint, add edge-only local DEM ray refinement, or move
toward horizon-angle textures/cascaded shadow atlases. A full 8K atlas is likely
too memory-expensive in Safari; a 4K or sparse edge-refine approach is possible
but needs a careful multi-pass design.
