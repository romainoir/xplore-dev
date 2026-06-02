# Data Directory

This folder contains runtime assets, imported map sprites, UI icons, archived legacy
assets, and offline map data. Do not delete or move files from this folder without
checking runtime references first.

## Folders

- `app/brand/`: Xplore logo and branded media.
- `app/controls/`: toolbar, route, and map-control icons.
- `app/layer-icons/`: layer-panel icons that do not come from the Xmap icon set.
- `app/xmap-icons/`: Xplore/Xmap icons used by the layer panel, POIs, search, and popups.
- `app/animation/hiker/`: hiker animation frames.
- `map/routing/`: offline routing data.
- `vendor/cartes/icons/`: imported SVG icon catalog used by cartes/OpenFreeMap style compatibility.
- `vendor/cartes/sprite/`: generated sprite sheets referenced by local style JSON files.
- `archive/legacy-assets/`: assets kept for reference or later classification.

## Top-Level Files

Only this README should live at the top level. Keep new runtime assets inside one
of the folders above.

The layer-panel asset paths are centralized in `scripts/config/layer-assets.js`.
