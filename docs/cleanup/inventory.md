# Cleanup Inventory

Date: 2026-06-02

This document records the current repository layout before any destructive cleanup.
No project assets are deleted in this pass. Data assets have been reorganized with
`git mv` so the runtime no longer depends on a mixed top-level `data/` folder.

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

Current `data/` folders:

- `data/vendor/cartes/icons/`: imported SVG icon catalog from cartes.app/OpenFreeMap style work.
- `data/vendor/cartes/sprite/`: generated sprite JSON/PNG files referenced by local styles.
- `data/app/controls/`: toolbar, routing, and map-control icons.
- `data/app/layer-icons/`: layer-panel icons that do not come from the Xmap icon set.
- `data/app/xmap-icons/`: app UI and layer-panel icons.
- `data/app/animation/hiker/`: hiker animation frames.
- `data/app/brand/`: app logo and branded media.
- `data/map/routing/`: offline routing data.
- `data/archive/legacy-assets/`: assets kept for reference or later classification.

Only `data/README.md` should remain at `data/` top level.

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

After commit `8f946e1 Document cleanup inventory and layer assets`, root-level tracked
app changes were clean. Remaining dirty entries were nested repositories:

- `maplibre-gl-js`
- `maplibre-gl-js-shadow-backup`

## Safe Cleanup Policy

For now:

- Do not delete files.
- Runtime asset moves must update all direct path references in the same commit.
- Do not modify nested MapLibre repositories unless that is the explicit task.
- Prefer documentation, manifests, and small runtime-safe refactors.

## Next Cleanup Decisions

Recommended future decisions:

- Choose one canonical MapLibre source folder.
- Decide whether `maplibre-gl-js-shadow-backup` should become an archive outside the app repo.
- Decide whether `maplibre-gl-js-5.18.0` is still needed.
- Add a generated unused-asset report before removing any asset.
