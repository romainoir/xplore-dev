# Task: Implement Screen-Space Elevation Buffer for Shadows

## Objective
Eliminate persistent shadow discontinuities and tile boundary artifacts by verifying and implementing a Screen-Space Elevation Buffer ("Global Shadow Map").

## Changes Implemented

### 1. Global Shadow Map Generation (`draw_hillshade.ts`)
- **Function**: `renderGlobalShadowMap`
- **Logic**: Iterates over all visible tiles and renders their raw DEM data (from `demTexture`) into a single full-screen Framebuffer (`painter.shadowMapFBO`).
- **Transform**: Uses `calculatePosMatrix` to project each tile to its correct screen position, creating a seamless mosaic of elevation data.
- **Optimization**: Uses `textureCopy` shader (flat quad render) to efficiently copy data.

### 2. Render Pipeline Integration (`draw_hillshade.ts`)
- **Setup**: In `renderHillshade`, the 9-tile neighbor loop was removed for the shadow pass.
- **Binding**: Instead, the `shadowMapFBO` is bound to `gl.TEXTURE1`.
- **Fallbacks**: neighbor texture creation logic was replaced by this robust screen-space approach.

### 3. Shader Logic (`hillshade.fragment.glsl`)
- **Sampling Strategy**: Changed `getElevation` to standard "Screen-Space Sampling".
- **Coordinate Transform**:
  - Input: Local Tile UV (`v_pos`)
  - Step 1: `tilePos = v_pos * 8192` (Local Tile Coord)
  - Step 2: `clipPos = u_matrix * tilePos` (Global Clip Space)
  - Step 3: `screenUV = clipPos * 0.5 + 0.5` (Screen Texture Coord)
  - Step 4: `texture(u_shadow_map, screenUV)`
- **Result**: Ray marching can "walk" off the current tile and seamlessly sample the neighbor's data from the Shadow Map, without needing complex neighbor lookup logic in the shader.

### 4. Supporting Changes
- **`shaders.ts`**: Updated `textureCopy` vertex shader to normalize `a_pos` by 8192.0 (matching standard MapLibre extent).
- **`hillshade_program.ts`**: Added `u_shadow_map` and verified `u_matrix` availability.

## Verification
- **Build**: `npm run build-prod` passed.
- **Deploy**: `cp dist/maplibre-gl.js ../libs/` executed.

## Next Steps
- Validate visually in the application.
- If shadows appear "flat" (ortho projection issue), verify if `u_matrix` used in `renderGlobalShadowMap` matches the camera view correctly (it should, as it uses the same transform).
- Fine-tune `rayStep` or bias if screen-space resolution differs significantly from tile resolution.
