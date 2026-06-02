# Cleanup Inventory

Date: 2026-06-02

This document records the current repository layout after the non-destructive
cleanup pass. No project assets are deleted in this pass. Assets and references
have been reorganized with `git mv` so the runtime no longer depends on mixed
top-level data, style, vendor, and experiment folders.

## Runtime Surface

These paths are part of the current app runtime:

- `index.html`: main app shell and script entrypoint.
- `scripts/app/`: app orchestration, imagery state, overlays, routing integration.
- `scripts/map/`: local MapLibre bundle, contour integration, photo/peak map helpers.
- `scripts/config/`: shared runtime configuration.
- `styles/main.css`: current app stylesheet.
- `styles/map-styles/`: local style documents loaded by the basemap switcher.
- `data/`: runtime assets, sprites, icons, offline routing data.
- `vendor/maplibre/maplibre-gl-js-5.24.0/`: active MapLibre source fork.

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

There are multiple large MapLibre copies. They are now grouped by role and should
not be deleted until the build/runtime path is fully documented.

- `vendor/maplibre/maplibre-gl-js-5.24.0/`: active source fork for the current terrain/shadow/contour work.
- `scripts/map/maplibre-gl-dev.js`: runtime bundle currently loaded by `index.html`.
- `archive/maplibre/maplibre-gl-js-5.18.0/`: older copied fork/reference. Role needs confirmation.
- `archive/maplibre/nested-repos/maplibre-gl-js/`: nested Git repository, currently dirty. Role needs confirmation before cleanup.
- `archive/maplibre/nested-repos/maplibre-gl-js-shadow-backup/`: nested Git repository, currently dirty. Looks like a backup candidate.

Approximate sizes observed on 2026-06-02:

- `archive/maplibre/nested-repos/maplibre-gl-js`: 789M
- `archive/maplibre/nested-repos/maplibre-gl-js-shadow-backup`: 789M
- `vendor/maplibre/maplibre-gl-js-5.24.0`: 693M
- `archive/maplibre/maplibre-gl-js-5.18.0`: 688M

Most of this size is from embedded `node_modules`.

## Reference And Experiment Folders

- `archive/references/maplibre-contour/`: local reference copy for maplibre-contour.
- `archive/manual-tests/`: standalone manual test/demo pages.
- `archive/legacy-libs/`: older local library bundles used by archived tests.
- `fixtures/gpx/`: sample GPX files.
- `docs/shadow-poc/`: historical shadow proof-of-concept notes.
- `docs/maplibre/`: MapLibre-related documentation.

## Current Git State After Previous Commit

After commit `a8a96fc Organize data assets by role`, root-level tracked app changes
were clean. Remaining dirty entries were nested repositories:

- `archive/maplibre/nested-repos/maplibre-gl-js`
- `archive/maplibre/nested-repos/maplibre-gl-js-shadow-backup`

## Safe Cleanup Policy

For now:

- Do not delete files.
- Runtime asset moves must update all direct path references in the same commit.
- Do not modify nested MapLibre repositories unless that is the explicit task.
- Prefer documentation, manifests, and small runtime-safe refactors.

## Next Cleanup Decisions

Recommended future decisions:

- Decide whether archived nested MapLibre repositories should stay in the app repo.
- Decide whether `archive/maplibre/maplibre-gl-js-5.18.0` is still needed.
- Add a generated unused-asset report before removing any asset.
