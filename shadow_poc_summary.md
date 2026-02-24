# Shadow POC Technical Summary - February 2026

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

## 4. Performance & Stability
- Maintained a stable **60 FPS** on high-end hardware during full-res rendering (Z15+).
- Cleaned up diagnostic logs to ensure a production-ready browser console.
- Resolved shader registration `TypeErrors` to ensure robust engine initialization.

---
*Created on 2026-02-24*
