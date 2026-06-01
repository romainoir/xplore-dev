# Local Change Log

## 2026-05-23 16:36 CEST

Base commit: `63328d4` (`Refine Shadow V3 and daylight overlays`)

Local changes tracked in this pass:

- Added landcover edge tint layers in `xplore_outdoor_hybrid.json` so landcover color bleeds under relief/contours without changing the terrain shader.
- Replaced Cartes tree pattern SVGs with top-down canopy/conifer patterns:
  `data/cartes-icons/unknown_leaf.svg`,
  `data/cartes-icons/broadleaved.svg`,
  `data/cartes-icons/needleleaved.svg`.
- Kept native `Peak labels` hidden while still usable for DOM marker queries in `scripts/app/imagery-manager.js`.
- Restyled DOM peak badges in `styles/main.css` to use a quieter dark app-theme treatment with white text and dark halo/shadow.

