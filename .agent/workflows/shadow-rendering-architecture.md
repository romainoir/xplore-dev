---
description: Architecture of the Terrain Shadow Rendering and Neighbor Data Pipeline
---

# Terrain Shadow Architecture

## Core Concept: FBO Reuse
The shadow rendering engine relies on casting rays across tile boundaries. To do this efficiently without re-fetching data, we implement a "Neighbor FBO Reuse" strategy.

## 1. Data Flow

### A. Preparation Phase (`hillshade_prepare`)
For every visible tile, MapLibre runs a preparation shader that generates a Framebuffer Object (FBO).
- **Input**: Raw Terrain-RGB texture (Source).
- **Output**: An RGBA FBO containing:
  - **R**: Encoded Slope X
  - **G**: Encoded Slope Y
  - **B**: **Normalized Elevation** ((Elevation + 500) / 10000)
  - **A**: Validity Flag (1.0 = Valid)

### B. Rendering Phase (`hillshade.fragment.glsl`)
When rendering the main hillshade pass:
1. **Center Tile**: Uses its own pre-calculated Slope/Aspect (from FBO) for local shading.
2. **Neighbor Sampling**:
   - The renderer identifies neighboring tiles (N, S, E, W, etc.) via `tilesByKey`.
   - It binds the **Neighbor's FBO** to dedicated texture units (Unit 2-9).
   - If a neighbor is missing, it falls back to the Center Tile's FBO to ensure valid data presence.

## 2. Shader Logic (`decodeFBO`)
The shader reads the neighbor's elevation from the FBO's Blue channel:
```glsl
float decodeFBO(sampler2D tex, vec2 uv) {
    vec4 data = texture(tex, uv);
    if (data.a < 0.5) return -10000.0; // Void check
    return data.b * 10000.0 - 500.0;   // Decode 8-bit elevation
}
```

## 3. Advantages
1. **Consistency**: The data used for shadows is identical to the data used for the neighbor's own terrain rendering.
2. **Reliability**: FBOs are persistent for visible tiles, eliminating issues with "expired" source textures or missing CPU data.
3. **Performance**: No dynamic texture creation (`ensureDemTexture`) is required.

## 4. Precision Notes
- The Elevation in the FBO Blue channel is 8-bit.
- Range: -500m to 9500m.
- Precision: ~40 meters per step.
- While lower than raw 16-bit DEM, this is sufficient for raymarching shadows across boundaries, preventing hard visual artifacts while maintaining performance.
