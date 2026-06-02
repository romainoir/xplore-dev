# Cleanup Inventory

Date: 2026-06-02

This document records the current repository layout before any destructive cleanup.
No files are deleted or moved in this pass.

## Runtime Surface

These paths are part of the current app runtime:

- `index.html`: main app shell and script entrypoint.
- `scripts/app/`: app orchestration, imagery state, overlays, routing integration.
- `scripts/map/`: local MapLibre bundle, contour integration, photo/peak map helpers.
- `scripts/config/`: shared runtime configuration.
- `styles/main.css`: current app stylesheet.
- `data/`: runtime assets, sprites, icons, offline routing data.
- `xplore_outdoor_hybrid*.json`: local style documents loaded by the basemap switcher.

## Data Assets

Current top-level `data/` folders:

- `data/cartes-icons/`: imported SVG icon catalog from cartes.app/OpenFreeMap style work.
- `data/cartes-sprite/`: generated sprite JSON/PNG files referenced by local styles.
- `data/icons_Xmap/`: app UI and layer-panel icons.
- `data/hiker/`: hiker animation frames.
- `data/logos/`: app logo and branded media.

Current top-level `data/` files mix several roles:

- Toolbar/UI assets: `edit.png`, `folder.png`, `upload.png`, `downloads.png`, `undo.png`, `redo.png`, `clear.png`, `diskette.png`, `layers.png`, `terrain.png`, `footsteps.png`, `sun.png`, `snowflake.png`.
- Layer-panel assets: `OSM_vector.png`, `backcountry.png`, `bike.png`, `contour.png`, `france.png`, `leaf.png`, `running.png`, `ski.png`, `worldwide.png`.
- Routing/offline data: `offline-network.geojson`.
- Legacy or candidate assets to classify later: `route.png`, `style.png`, `randonneur.png`, `walk.png`, `webcam.png`, `tent.png`, `tree.png`, `vector-map.svg`, `contours.svg`.

## MapLibre Copies

There are multiple large MapLibre copies. They should not be deleted until the build/runtime path is fully documented.

- `maplibre-gl-js-5.24.0/`: active source fork for the current terrain/shadow/contour work.
- `scripts/map/maplibre-gl-dev.js`: runtime bundle currently loaded by `index.html`.
- `maplibre-gl-js/`: nested Git repository, currently dirty. Role needs confirmation before cleanup.
- `maplibre-gl-js-shadow-backup/`: nested Git repository, currently dirty. Looks like a backup candidate.
- `maplibre-gl-js-5.18.0/`: older copied fork/reference. Role needs confirmation.

Approximate sizes observed on 2026-06-02:

- `maplibre-gl-js`: 789M
- `maplibre-gl-js-shadow-backup`: 789M
- `maplibre-gl-js-5.24.0`: 693M
- `maplibre-gl-js-5.18.0`: 688M

Most of this size is from embedded `node_modules`.

## Reference And Experiment Folders

- `references/maplibre-contour/`: local reference copy for maplibre-contour.
- `docs/shadow-poc/`: historical shadow proof-of-concept notes.
- `docs/maplibre/`: MapLibre-related documentation.
- `testing/`: small test support folder.
- `untitled folder/`: unclassified folder. Candidate for archive/quarantine later, not touched now.

## Current Git State After Previous Commit

After commit `61e9204 Refine layer panel overlays and contours`, root-level tracked app changes are clean.
Remaining dirty entries are nested repositories:

- `maplibre-gl-js`
- `maplibre-gl-js-shadow-backup`

## Safe Cleanup Policy

For now:

- Do not delete files.
- Do not move runtime assets until all direct path references are centralized or updated.
- Do not modify nested MapLibre repositories unless that is the explicit task.
- Prefer documentation, manifests, and small runtime-safe refactors.

## Next Cleanup Decisions

Recommended future decisions:

- Choose one canonical MapLibre source folder.
- Decide whether `maplibre-gl-js-shadow-backup` should become an archive outside the app repo.
- Decide whether `maplibre-gl-js-5.18.0` is still needed.
- Move top-level `data/*.png` assets into semantic folders only after path references are centralized.
- Add a generated unused-asset report before removing any asset.
