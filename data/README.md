# Data Directory

This folder currently contains runtime assets, imported map sprites, UI icons, and offline data.
Do not delete or move files from this folder without checking runtime references first.

## Folders

- `cartes-icons/`: imported SVG icon catalog used by cartes/OpenFreeMap style compatibility.
- `cartes-sprite/`: generated sprite sheets referenced by the outdoor style JSON.
- `icons_Xmap/`: Xplore UI and layer-panel icons.
- `hiker/`: hiker animation frames.
- `logos/`: Xplore logo and branded media.

## Top-Level Files

Top-level files are still mixed. Current known roles:

- App toolbar and controls: `edit.png`, `folder.png`, `upload.png`, `downloads.png`, `undo.png`, `redo.png`, `clear.png`, `diskette.png`, `layers.png`, `terrain.png`, `footsteps.png`, `sun.png`, `snowflake.png`.
- Layer panel: `OSM_vector.png`, `backcountry.png`, `bike.png`, `contour.png`, `france.png`, `leaf.png`, `running.png`, `ski.png`, `worldwide.png`.
- Routing data: `offline-network.geojson`.
- Legacy/candidates to classify: `route.png`, `style.png`, `randonneur.png`, `walk.png`, `webcam.png`, `tent.png`, `tree.png`, `vector-map.svg`, `contours.svg`.

The layer-panel asset paths are centralized in `scripts/config/layer-assets.js`.
