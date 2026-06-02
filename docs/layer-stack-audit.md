# Layer Stack Audit

Generated from local files on 2026-05-22T13:57:05.723Z.

## Runtime Stack Zones

Approximate final order is bottom to top. Some layers move again after style changes, user imagery reorder, GPX import, or debug toggles.

| zone | layer | source | role | risk |
| --- | --- | --- | --- | --- |
| 01 | terrain-bg | overlay-manager | Background / neutral no-basemap white background | Replaces every style background. Good for None, but it means style background colors are not real style layers anymore. |
| 02 | terrain | overlay-manager | Raster DEM texture used as terrain base | Can be visually redundant with terrain-bg + hillshade if it is only used as a DEM carrier. |
| 03 | basemap raster group | IMAGERY_OPTIONS basemap ids | IGN Scan, orthophotos, satellite, COSIA, Lidar MNT/MNS, forest inventory | Same order path as imagery overlays, but treated as basemap by id list. |
| 04 | style underlay bucket | current vector style | Non-fill, non-overlay style layers | Bucket is heuristic. Some land/area layers can be misbucketed depending on source-layer names. |
| 05 | style fills bucket | current vector style | park/landuse/landcover/water/aeroway fills below hillshade | Fill bucket plus raster basemaps can overlap; hidden by basemap switch, but source of complexity. |
| 06 | hillshade2, hillshade, terrain-derivative-cache | overlay-manager | Relief shading and derivative cache | Xplore.json already has a hillshade id, which collides with the generated hillshade id. |
| 07 | terrain native analysis | overlay-manager + IMAGERY_OPTIONS | normalmap, snow-native, aspect, slope, avalanche, shadow-v3, daylight windows | Several are custom/native layers sharing DEM sources; their relative order is hardcoded separately. |
| 08 | raster overlays | IMAGERY_OPTIONS overlay ids | Strava, winter traces, snow-depth | The ordering is user reorderable, but constrained by basemap/overlay buckets. |
| 09 | style overlay bucket | current vector style | roads, paths, rails, buildings, boundaries, waterways, non-symbol overlays | Moved above analysis; can cover slope/aspect/shadow more than expected. |
| 10 | GPX | scripts/gpx/gpx-io.js | Imported GPX line and point layers | Inserted before top symbol layer; later global symbol moves can put labels above GPX. |
| 11 | route layers | directions-manager-init.js | Route lines, waypoints, markers, hover/drag layers | Manual route layers and POI layers are not in ROUTE_LAYER_ORDER_TOP_TO_BOTTOM. |
| 12 | debug network | routing-orchestrator.js | Offline network debug lines, intersections, POIs | bringDebugNetworkToFront runs before style symbols are moved to top, so labels can cover debug. |
| 13 | style symbols | current vector style | Basemap labels and icons | Moved to absolute top late; this can cover route/debug/analysis overlays. |
| 14 | contour 2D layers | contour-2d.js | contour-line-minor, contour-line-major, contour-label | There is also shader contour rendering; this is a second contour system. |
| 15 | wikimedia | wikimedia-photos.js | photo query circle and thumbnail symbols | Always moved to top; intentionally overrides everything. |

## Dynamic / App-Generated Layers

| zone | id | type | source | control | note |
| --- | --- | --- | --- | --- | --- |
| 01 | terrain-bg | background | overlay-manager | always / None white | Generated background; receives incoming style background paint. |
| 02 | terrain | raster | terrainSource | vector base | Added after terrain-bg. Hidden when vector base hidden. |
| 06 | hillshade2 | hillshade | reliefDem | vector base | Second relief shade layer. |
| 06 | hillshade | hillshade | hillshadeSource | vector base | Potential ID collision with Xplore.json hillshade. |
| 06 | terrain-derivative-cache | hillshade | terrainSource | cache | Visible but transparent; used by shader/derivatives. |
| 07 | normalmap | hillshade/native | hillshadeSource | hidden/native | Native analysis carrier. |
| 07 | snow-native | hillshade/native | hillshadeSource | snow toolbox | Snow native analysis layer. |
| 07 | aspect-native | hillshade/native | hillshadeSource | terrain toolbox | Aspect. |
| 07 | slope-native | hillshade/native | hillshadeSource | terrain toolbox | Slope. |
| 07 | avalanche-native | hillshade/native | hillshadeSource | terrain toolbox | Avalanche. |
| 07 | daylight-native | daylight | terrainSource | shadow toolbox | Exclusive with shadow-v3 and sun windows. |
| 07 | sunrise-window-native | daylight | terrainSource | shadow toolbox | Sunrise window. |
| 07 | sunset-window-native | daylight | terrainSource | shadow toolbox | Sunset window. |
| 07 | shadow-v3-coarse | shadow | terrainSource | shadow toolbox | Custom cast shadow layer. |
| 03 | ign-scan | raster | ign-scan | basemap | IGN Scan. |
| 03 | ign-cosia | raster | ign-cosia | basemap/land cover | COSIA land cover. |
| 03 | ign-forest-inventory | raster | ign-forest-inventory | basemap/land cover | Forest overlay for Lidar. |
| 03 | ign-orthophotos | raster | ign-orthophotos | basemap | IGN ortho. |
| 03 | world-imagery | raster | world-imagery | basemap | Layer id differs from option id eox-s2. |
| 03 | ign-lidar-hd-mns-shadow | raster | ign-lidar-hd-mns-shadow | basemap | Lidar MNS shadow. |
| 03 | ign-lidar-hd-mnt-shadow | raster | ign-lidar-hd-mnt-shadow | basemap | Lidar MNT shadow. |
| 08 | strava-heatmap-all | raster | strava-heatmap-all | imagery overlay | Heatmap group exclusive. |
| 08 | strava-winter | raster | strava-winter | imagery overlay | Heatmap group exclusive. |
| 08 | strava-backcountry-ski | raster | strava-backcountry-ski | imagery overlay | Heatmap group exclusive. |
| 08 | strava-cycling | raster | strava-cycling | imagery overlay | Heatmap group exclusive. |
| 08 | strava-run | raster | strava-run | imagery overlay | Heatmap group exclusive. |
| 08 | ign-traces-hivernales | raster | ign-traces-hivernales | imagery overlay | Winter traces. |
| 08 | snow-depth | raster | snow-depth | snow toolbox | Raster snow depth. |
| 09 | osm-features | virtual bucket | style overlay bucket | pathway/vector | Controls non-symbol overlay bucket opacity. |
| 05 | vector-fills | virtual bucket | style fill bucket | basemap/vector | Controls fill bucket opacity. |
| 01? | white-background | background option | background | hidden/dead | Layer id background is usually removed; probably legacy/dead after terrain-bg. |
| 10 | gpx-track-line | line | gpx-source | GPX import | Inserted before top label. |
| 10 | gpx-track-points | circle | gpx-source | GPX import | Inserted before top label. |
| 11 | route-line-casing | line | route-line-source | directions | In route reorder list. |
| 11 | route-line | line | route-line-source | directions | In route reorder list. |
| 11 | route-line-manual-bg | line | route-manual-source | directions | Not in ROUTE_LAYER_ORDER_TOP_TO_BOTTOM. |
| 11 | route-line-manual | line | route-manual-source | directions | Not in ROUTE_LAYER_ORDER_TOP_TO_BOTTOM. |
| 11 | route-segment-hover | line | route-segments-source | directions | In route reorder list. |
| 11 | distance-markers | symbol | distance-markers-source | directions | In route reorder list but symbols later move above. |
| 11 | waypoints-hit-area | circle | waypoints | directions | In route reorder list. |
| 11 | route-pois | circle | route-pois | directions | Not in route reorder list. |
| 11 | route-pois-icons | symbol | route-pois | directions | Not in route reorder list. |
| 11 | route-pois-labels | symbol | route-pois | directions | Not in route reorder list. |
| 11 | segment-markers | symbol | segment-markers | directions | In route reorder list. |
| 11 | waypoints | circle | waypoints | directions | In route reorder list. |
| 11 | waypoint-hover-drag | circle | waypoints | directions | In route reorder list. |
| 11 | route-hover-point | circle | route-hover-point-source | directions | In route reorder list. |
| 11 | drag-preview-line | line | drag-preview-source | directions | Not in route reorder list. |
| 12 | offline-router-network-debug | line | offline-router-network-debug | debug | Moved by bringDebugNetworkToFront. |
| 12 | offline-router-network-debug-intersections | circle | offline-router-network-debug | debug | Moved by bringDebugNetworkToFront. |
| 12 | offline-router-network-pois | circle | offline-router-network-pois | debug | Moved by bringDebugNetworkToFront. |
| 12 | offline-router-network-pois-labels | symbol | offline-router-network-pois | debug | Moved by bringDebugNetworkToFront. |
| 14 | contour-line-minor | line | contours | 2D contours | Separate from shader contours. |
| 14 | contour-line-major | line | contours | 2D contours | Separate from shader contours. |
| 14 | contour-label | symbol | contours | 2D contours | Moved to top after style symbols. |
| 15 | wikimedia-photos-base | circle | wikimedia-photos | wikimedia | Invisible query anchor. |
| 15 | wikimedia-thumbnails-small | symbol | wikimedia-photos | wikimedia | Always moved to top. |
| 15 | wikimedia-thumbnails-large | symbol | wikimedia-photos | wikimedia | Always moved to top. |
| debug | debug-tiles | raster | debug-tiles | debug | Ad-hoc debug layer from xploremap-app.js. |

## Style File Summary

| style | file | layers | sources | sprite | glyphs | buckets |
| --- | --- | --- | --- | --- | --- | --- |
| Xplore Outdoor Hybrid | xplore_outdoor_hybrid.json | 148 | openmaptiles | ./data/vendor/cartes/sprite/sprite | https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf | background:2, fills:23, underlay:24, overlay/symbol:40, overlay:59 |
| Cartes Outdoor local | cartes_outdoor.json | 150 | openmaptiles, landcover, bathymetry | (injected by app if Cartes) | https://cartes.app/fonts/glyphs/{fontstack}/{range}.pbf | background:2, fills:28, underlay:21, overlay/symbol:40, overlay:59 |
| Liberty Local / Xplore | Xplore.json | 65 | openmaptiles, mapterhorn, ign_plan | https://api.maptiler.com/maps/openstreetmap/sprite | https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=get_your_own_OpIi9ZULNHzrESv6T2vL | background:1, fills:14, underlay:11, overlay:26, overlay/symbol:13 |
| OSM Liberty | osm_liberty.json | 196 | openmaptiles, ne2_shaded | https://tiles.openfreemap.org/sprites/ofm_f384/ofm | https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf | background:1, fills:39, underlay:4, overlay:107, overlay/symbol:45 |
| Terrain Stadia local | terrain_vector_on_stadia.json | 81 | stamen-omt, global_landcover_v1, stamen_null, terrarium | https://tiles.stadiamaps.com/styles/stamen-terrain/sprite | https://tiles.stadiamaps.com/fonts/{fontstack}/{range}.pbf | background:1, underlay:11, fills:11, overlay:40, overlay/symbol:18 |

## Potential Redundancy / Placement Issues

| issue | why it matters |
| --- | --- |
| hillshade id collision | Xplore.json contains a hillshade layer id while overlay-manager also owns hillshade. The generated layer can be skipped, leaving a style-owned hillshade with different source/paint. |
| white-background legacy option | IMAGERY_OPTIONS still references layerId background, but backgrounds are stripped and replaced by terrain-bg. This is likely dead after the new None basemap. |
| two contour systems | The 3D terrain shader renders contours from imageryState.contours, while contour-2d.js creates contour-line-minor/major/label. They need one owner and one ordering policy. |
| route order list incomplete | route-line-manual, route-line-manual-bg, route-pois*, and drag-preview-line are created but not listed in ROUTE_LAYER_ORDER_TOP_TO_BOTTOM. |
| style symbols moved very late | Base map labels/icons are moved above route/debug layers. That may be intended for labels, but it can hide route markers/debug POIs. |
| style overlay bucket is heuristic | Road/building/boundary/waterway detection uses id/source-layer substrings. New styles can easily put layers in the wrong bucket. |
| terrain + hillshade + derivative cache overlap | terrain, hillshade2, hillshade, terrain-derivative-cache, normalmap all share DEM-related work. Some are visual, some are cache/native carriers; they should be named and ordered by explicit purpose. |

## Duplicate Layer IDs Across Styles / Dynamic Layers

| id | occurrences |
| --- | --- |
| Aeroway | Xplore Outdoor Hybrid#45, Cartes Outdoor local#47 |
| Airport | Xplore Outdoor Hybrid#136, Cartes Outdoor local#138 |
| Airport gate | Xplore Outdoor Hybrid#137, Cartes Outdoor local#139 |
| Airport zone | Xplore Outdoor Hybrid#6, Cartes Outdoor local#11 |
| airport-label | Liberty Local / Xplore#55, Terrain Stadia local#73 |
| Aqueduct | Xplore Outdoor Hybrid#96, Cartes Outdoor local#98 |
| Aqueduct outline | Xplore Outdoor Hybrid#95, Cartes Outdoor local#97 |
| Arete Symbols | Xplore Outdoor Hybrid#37, Cartes Outdoor local#43 |
| Background | Xplore Outdoor Hybrid#0, Cartes Outdoor local#0, OSM Liberty#0 |
| Beach | Xplore Outdoor Hybrid#19, Cartes Outdoor local#25, OSM Liberty#31 |
| Bicycle route | Xplore Outdoor Hybrid#106, Cartes Outdoor local#108 |
| Bicycle route dasharray | Xplore Outdoor Hybrid#107, Cartes Outdoor local#109 |
| Bicycle route labels | Xplore Outdoor Hybrid#145, Cartes Outdoor local#147 |
| Bicycle route outline | Xplore Outdoor Hybrid#105, Cartes Outdoor local#107 |
| boundary limited_traffic_zone contour | Xplore Outdoor Hybrid#28, Cartes Outdoor local#34 |
| boundary limited_traffic_zone label | Xplore Outdoor Hybrid#29, Cartes Outdoor local#35 |
| boundary limited_traffic_zone polygon | Xplore Outdoor Hybrid#27, Cartes Outdoor local#33 |
| boundary low_emission_zone contour | Xplore Outdoor Hybrid#25, Cartes Outdoor local#31 |
| boundary low_emission_zone label | Xplore Outdoor Hybrid#26, Cartes Outdoor local#32 |
| boundary low_emission_zone polygon | Xplore Outdoor Hybrid#24, Cartes Outdoor local#30 |
| Bridge | Xplore Outdoor Hybrid#56, Cartes Outdoor local#58 |
| Bridge fill for path | Xplore Outdoor Hybrid#79, Cartes Outdoor local#81 |
| Bridge fill for rail | Xplore Outdoor Hybrid#88, Cartes Outdoor local#90 |
| Bridge for Cycleway | Xplore Outdoor Hybrid#77, Cartes Outdoor local#79 |
| Bridge for major roads | Xplore Outdoor Hybrid#85, Cartes Outdoor local#87 |
| Bridge for minor roads | Xplore Outdoor Hybrid#83, Cartes Outdoor local#85 |
| Bridge for motorway | Xplore Outdoor Hybrid#87, Cartes Outdoor local#89 |
| Bridge outline for Cycleway | Xplore Outdoor Hybrid#76, Cartes Outdoor local#78 |
| Bridge outline for major roads | Xplore Outdoor Hybrid#84, Cartes Outdoor local#86 |
| Bridge outline for minor roads | Xplore Outdoor Hybrid#82, Cartes Outdoor local#84 |
| Bridge outline for motorway | Xplore Outdoor Hybrid#86, Cartes Outdoor local#88 |
| Bridge outline for path | Xplore Outdoor Hybrid#78, Cartes Outdoor local#80 |
| Bridge outline for rail | Xplore Outdoor Hybrid#89, Cartes Outdoor local#91 |
| building | Liberty Local / Xplore#50, Terrain Stadia local#36 |
| Building | Xplore Outdoor Hybrid#93, Cartes Outdoor local#95 |
| Building 3D | Xplore Outdoor Hybrid#94, Cartes Outdoor local#96 |
| Cablecar | Xplore Outdoor Hybrid#97, Cartes Outdoor local#99, OSM Liberty#147 |
| Cablecar dash | Xplore Outdoor Hybrid#98, Cartes Outdoor local#100, OSM Liberty#148 |
| Capital city labels | Xplore Outdoor Hybrid#141, Cartes Outdoor local#143, OSM Liberty#194 |
| Car utilities | Xplore Outdoor Hybrid#130, Cartes Outdoor local#132 |
| Cemetery | Xplore Outdoor Hybrid#30, Cartes Outdoor local#36, OSM Liberty#1 |
| City labels | Xplore Outdoor Hybrid#140, Cartes Outdoor local#142, OSM Liberty#193 |
| Cliff and Ridge Line | Xplore Outdoor Hybrid#35, Cartes Outdoor local#41 |
| Cliff Symbols | Xplore Outdoor Hybrid#36, Cartes Outdoor local#42 |
| Continent labels | Xplore Outdoor Hybrid#143, Cartes Outdoor local#145 |
| Country border | Xplore Outdoor Hybrid#101, Cartes Outdoor local#103 |
| Country labels | Xplore Outdoor Hybrid#142, Cartes Outdoor local#144, OSM Liberty#195 |
| Cycle highways | Xplore Outdoor Hybrid#91, Cartes Outdoor local#93 |
| Cycle highways icons | Xplore Outdoor Hybrid#92, Cartes Outdoor local#94 |
| Cycle highways outline | Xplore Outdoor Hybrid#90, Cartes Outdoor local#92 |
| Cycleway | Xplore Outdoor Hybrid#67, Cartes Outdoor local#69 |
| Cycleway outline | Xplore Outdoor Hybrid#57, Cartes Outdoor local#59 |
| Difficult Path Label | Xplore Outdoor Hybrid#70, Cartes Outdoor local#72 |
| Disputed border | Xplore Outdoor Hybrid#100, Cartes Outdoor local#102, OSM Liberty#150 |
| Farmland | Xplore Outdoor Hybrid#7, Cartes Outdoor local#12, OSM Liberty#27 |
| Ferry | Xplore Outdoor Hybrid#121, Cartes Outdoor local#123, OSM Liberty#161 |
| Ferry line | Xplore Outdoor Hybrid#47, Cartes Outdoor local#49 |
| Footway | Xplore Outdoor Hybrid#68, Cartes Outdoor local#70 |
| Footway on bridges | Xplore Outdoor Hybrid#80, Cartes Outdoor local#82 |
| Footway tunnel | Xplore Outdoor Hybrid#53, Cartes Outdoor local#55 |
| Footway tunnel outline | Xplore Outdoor Hybrid#52, Cartes Outdoor local#54 |
| Glacier | Xplore Outdoor Hybrid#11, Cartes Outdoor local#16, OSM Liberty#37 |
| Gondola | Xplore Outdoor Hybrid#120, Cartes Outdoor local#122 |
| Grass | Xplore Outdoor Hybrid#8, Cartes Outdoor local#13, OSM Liberty#35 |
| Heliport | Xplore Outdoor Hybrid#46, Cartes Outdoor local#48 |
| Highway junction | Xplore Outdoor Hybrid#125, Cartes Outdoor local#127 |
| Highway shield | Xplore Outdoor Hybrid#126, Cartes Outdoor local#128, OSM Liberty#180 |
| Highway shield (US) | Xplore Outdoor Hybrid#127, Cartes Outdoor local#129 |
| Hiking route | Xplore Outdoor Hybrid#103, Cartes Outdoor local#105 |
| Hiking route dasharray | Xplore Outdoor Hybrid#104, Cartes Outdoor local#106 |
| Hiking route labels | Xplore Outdoor Hybrid#144, Cartes Outdoor local#146 |
| Hiking route outline | Xplore Outdoor Hybrid#102, Cartes Outdoor local#104 |
| hillshade | Liberty Local / Xplore#16, Terrain Stadia local#15, dynamic:06 |
| Hospital | Xplore Outdoor Hybrid#5, Cartes Outdoor local#10 |
| Housenumber | Xplore Outdoor Hybrid#119, Cartes Outdoor local#121 |
| Industrial | Xplore Outdoor Hybrid#2, Cartes Outdoor local#7 |
| Lake labels | Xplore Outdoor Hybrid#118, Cartes Outdoor local#120 |
| Landcover patterns | Liberty Local / Xplore#17, OSM Liberty#34 |
| landcover_outer_glow | Liberty Local / Xplore#12, Terrain Stadia local#6 |
| landcover_outer_glow_2x | Liberty Local / Xplore#13, Terrain Stadia local#7 |
| Major rail | Xplore Outdoor Hybrid#72, Cartes Outdoor local#74, OSM Liberty#111 |
| Major rail hatching | Xplore Outdoor Hybrid#73, Cartes Outdoor local#75, OSM Liberty#113 |
| Major road | Xplore Outdoor Hybrid#65, Cartes Outdoor local#67 |
| Major road outline | Xplore Outdoor Hybrid#59, Cartes Outdoor local#61 |
| Minor rail | Xplore Outdoor Hybrid#74, Cartes Outdoor local#76, OSM Liberty#112 |
| Minor rail hatching | Xplore Outdoor Hybrid#75, Cartes Outdoor local#77, OSM Liberty#114 |
| Minor road | Xplore Outdoor Hybrid#64, Cartes Outdoor local#66, OSM Liberty#96 |
| Minor road outline | Xplore Outdoor Hybrid#58, Cartes Outdoor local#60 |
| Motorway | Xplore Outdoor Hybrid#66, Cartes Outdoor local#68 |
| Motorway outline | Xplore Outdoor Hybrid#60, Cartes Outdoor local#62 |
| MTB route | Xplore Outdoor Hybrid#109, Cartes Outdoor local#111 |
| MTB route dasharray | Xplore Outdoor Hybrid#110, Cartes Outdoor local#112 |
| MTB route labels | Xplore Outdoor Hybrid#146, Cartes Outdoor local#148 |
| MTB route outline | Xplore Outdoor Hybrid#108, Cartes Outdoor local#110 |
| National park labels | Liberty Local / Xplore#60, OSM Liberty#186 |
| Neige | Xplore Outdoor Hybrid#34, Cartes Outdoor local#40 |
| Ocean and sea labels | Xplore Outdoor Hybrid#116, Cartes Outdoor local#118 |
| Ocean labels | Xplore Outdoor Hybrid#117, Cartes Outdoor local#119 |
| Oneway | Xplore Outdoor Hybrid#122, Cartes Outdoor local#124 |
| Other border | Xplore Outdoor Hybrid#99, Cartes Outdoor local#101, OSM Liberty#149 |
| Other POI | Xplore Outdoor Hybrid#131, Cartes Outdoor local#133 |
| park null contour | Xplore Outdoor Hybrid#13, Cartes Outdoor local#18 |
| park null label | Xplore Outdoor Hybrid#14, Cartes Outdoor local#19 |
| park null polygon | Xplore Outdoor Hybrid#12, Cartes Outdoor local#17 |
| Parking | Xplore Outdoor Hybrid#129, Cartes Outdoor local#131 |
| Path | Xplore Outdoor Hybrid#69, Cartes Outdoor local#71 |
| Path on bridges | Xplore Outdoor Hybrid#81, Cartes Outdoor local#83 |
| Peak labels | Xplore Outdoor Hybrid#134, Cartes Outdoor local#136 |
| Pedestrian polygons | Xplore Outdoor Hybrid#22, Cartes Outdoor local#28 |
| Pedestrian ways | Xplore Outdoor Hybrid#23, Cartes Outdoor local#29 |
| Pier | Xplore Outdoor Hybrid#54, Cartes Outdoor local#56, OSM Liberty#77 |
| Pier road | Xplore Outdoor Hybrid#55, Cartes Outdoor local#57, OSM Liberty#78 |
| Place labels | Xplore Outdoor Hybrid#133, Cartes Outdoor local#135 |
| Private road labels | Xplore Outdoor Hybrid#124, Cartes Outdoor local#126 |
| Protected area labels | Xplore Outdoor Hybrid#132, Cartes Outdoor local#134 |
| Railway tunnel | Xplore Outdoor Hybrid#50, Cartes Outdoor local#52 |
| Railway tunnel hatching | Xplore Outdoor Hybrid#51, Cartes Outdoor local#53 |
| Residential | Xplore Outdoor Hybrid#1, Cartes Outdoor local#6 |
| Retail | Xplore Outdoor Hybrid#3, Cartes Outdoor local#8 |
| River | Xplore Outdoor Hybrid#39, Cartes Outdoor local#45, OSM Liberty#39 |
| River labels | Xplore Outdoor Hybrid#115, Cartes Outdoor local#117, OSM Liberty#151 |
| River tunnel | Xplore Outdoor Hybrid#38, Cartes Outdoor local#44, OSM Liberty#38 |
| Road labels | Xplore Outdoor Hybrid#123, Cartes Outdoor local#125, OSM Liberty#176 |
| Road under construction | Xplore Outdoor Hybrid#61, Cartes Outdoor local#63 |
| Rock | Xplore Outdoor Hybrid#16, Cartes Outdoor local#22 |
| Rock texture | Xplore Outdoor Hybrid#17, Cartes Outdoor local#23 |
| Sand | Xplore Outdoor Hybrid#20, Cartes Outdoor local#26, OSM Liberty#20 |
| School | Xplore Outdoor Hybrid#4, Cartes Outdoor local#9 |
| Ski route | Xplore Outdoor Hybrid#113, Cartes Outdoor local#115 |
| Ski route dasharray | Xplore Outdoor Hybrid#114, Cartes Outdoor local#116 |
| Ski route labels | Xplore Outdoor Hybrid#147, Cartes Outdoor local#149 |
| Ski route outline | Xplore Outdoor Hybrid#112, Cartes Outdoor local#114 |
| Ski route surface | Xplore Outdoor Hybrid#111, Cartes Outdoor local#113 |
| Stadium | Xplore Outdoor Hybrid#31, Cartes Outdoor local#37, OSM Liberty#12 |
| State labels | Xplore Outdoor Hybrid#138, Cartes Outdoor local#140, OSM Liberty#192 |
| Station | Xplore Outdoor Hybrid#135, Cartes Outdoor local#137 |
| Steps | Xplore Outdoor Hybrid#71, Cartes Outdoor local#73 |
| Stone | Xplore Outdoor Hybrid#128, Cartes Outdoor local#130 |
| Town labels | Xplore Outdoor Hybrid#139, Cartes Outdoor local#141, OSM Liberty#191 |
| Track | Xplore Outdoor Hybrid#62, Cartes Outdoor local#64 |
| Track dasharray | Xplore Outdoor Hybrid#63, Cartes Outdoor local#65 |
| Tree rows | Xplore Outdoor Hybrid#33, Cartes Outdoor local#39 |
| Trees | Xplore Outdoor Hybrid#32, Cartes Outdoor local#38 |
| Tunnel | Xplore Outdoor Hybrid#49, Cartes Outdoor local#51 |
| Tunnel hatching | Xplore Outdoor Hybrid#48, Cartes Outdoor local#50 |
| water | Liberty Local / Xplore#10, Terrain Stadia local#20 |
| Water intermittent | Xplore Outdoor Hybrid#40, Cartes Outdoor local#46, OSM Liberty#43 |
| Water lake | Xplore Outdoor Hybrid#21, Cartes Outdoor local#27 |
| Water ocean | Xplore Outdoor Hybrid#15, Cartes Outdoor local#20 |
| waterway | Liberty Local / Xplore#23, Terrain Stadia local#18 |
| Wetland (medium scale) | Xplore Outdoor Hybrid#18, Cartes Outdoor local#24, OSM Liberty#4 |
| Wood | Xplore Outdoor Hybrid#9, Cartes Outdoor local#14, OSM Liberty#16 |
| Wood symbols | Xplore Outdoor Hybrid#10, Cartes Outdoor local#15 |

## Cartes Outdoor Local Style Layers

| # | zone | bucket | id | type | source | source-layer | minzoom | maxzoom | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 01 replaced by terrain-bg | background | Background | background |  |  |  |  | Removed by injectOverlaysIntoStyle; paint is copied to terrain-bg when available. |
| 1 | 05 vector fills | fills | Grass-Bare-Snow | fill | landcover | landcover |  | 10 | Moved below hillshade so relief shades the fill color. |
| 2 | 05 vector fills | fills | Bare-Snow | fill | landcover | landcover |  | 10 | Moved below hillshade so relief shades the fill color. |
| 3 | 05 vector fills | fills | Snow | fill | landcover | landcover |  | 10 | Moved below hillshade so relief shades the fill color. |
| 4 | 05 vector fills | fills | Crops | fill | landcover | landcover |  | 10 | Moved below hillshade so relief shades the fill color. |
| 5 | 05 vector fills | fills | Tree | fill | landcover | landcover |  | 10 | Moved below hillshade so relief shades the fill color. |
| 6 | 05 vector fills | fills | Residential | fill | openmaptiles | landuse | 5 | 22 | Moved below hillshade so relief shades the fill color. |
| 7 | 05 vector fills | fills | Industrial | fill | openmaptiles | landuse | 9 | 24 | Moved below hillshade so relief shades the fill color. |
| 8 | 05 vector fills | fills | Retail | fill | openmaptiles | landuse | 5 | 22 | Moved below hillshade so relief shades the fill color. |
| 9 | 05 vector fills | fills | School | fill | openmaptiles | landuse | 9 | 22 | Moved below hillshade so relief shades the fill color. |
| 10 | 05 vector fills | fills | Hospital | fill | openmaptiles | landuse | 9 | 22 | Moved below hillshade so relief shades the fill color. |
| 11 | 05 vector fills | fills | Airport zone | fill | openmaptiles | aeroway | 11 |  | Moved below hillshade so relief shades the fill color. |
| 12 | 05 vector fills | fills | Farmland | fill | openmaptiles | landcover | 9 |  | Moved below hillshade so relief shades the fill color. |
| 13 | 05 vector fills | fills | Grass | fill | openmaptiles | landcover | 9 |  | Moved below hillshade so relief shades the fill color. |
| 14 | 05 vector fills | fills | Wood | fill | openmaptiles | landcover | 9 |  | Moved below hillshade so relief shades the fill color. |
| 15 | 05 vector fills | fills | Wood symbols | fill | openmaptiles | landcover | 9 |  | Moved below hillshade so relief shades the fill color. |
| 16 | 05 vector fills | fills | Glacier | fill | openmaptiles | landcover | 9 | 24 | Moved below hillshade so relief shades the fill color. |
| 17 | 05 vector fills | fills | park null polygon | fill | openmaptiles | park |  | 12 | Moved below hillshade so relief shades the fill color. |
| 18 | 04 vector underlay | underlay | park null contour | line | openmaptiles | park | 6 |  | Opacity controlled by vector/base visibility; not explicitly reordered after fill pass. |
| 19 | 13 labels/icons | overlay/symbol | park null label | symbol | openmaptiles | park | 6 | 22 | All style symbols are moved to the top after route/debug layers. |
| 20 | 05 vector fills | fills | Water ocean | fill | openmaptiles | water |  |  | Moved below hillshade so relief shades the fill color. |
| 21 | 04 vector underlay | underlay | water-depth | fill | bathymetry | bathymetry |  | 12 | Opacity controlled by vector/base visibility; not explicitly reordered after fill pass. |
| 22 | 05 vector fills | fills | Rock | fill | openmaptiles | landcover | 9 |  | Moved below hillshade so relief shades the fill color. |
| 23 | 05 vector fills | fills | Rock texture | fill | openmaptiles | landcover | 9 |  | Moved below hillshade so relief shades the fill color. |
| 24 | 05 vector fills | fills | Wetland (medium scale) | fill | openmaptiles | landcover | 9 |  | Moved below hillshade so relief shades the fill color. |
| 25 | 05 vector fills | fills | Beach | fill | openmaptiles | landcover | 9 |  | Moved below hillshade so relief shades the fill color. |
| 26 | 05 vector fills | fills | Sand | fill | openmaptiles | landcover | 9 |  | Moved below hillshade so relief shades the fill color. |
| 27 | 05 vector fills | fills | Water lake | fill | openmaptiles | water |  |  | Moved below hillshade so relief shades the fill color. |
| 28 | 09 style overlays | overlay | Pedestrian polygons | fill | openmaptiles | transportation |  |  | Moved above hillshade/analysis and below symbols. |
| 29 | 09 style overlays | overlay | Pedestrian ways | line | openmaptiles | transportation |  |  | Moved above hillshade/analysis and below symbols. |
| 30 | 09 style overlays | overlay | boundary low_emission_zone polygon | fill | openmaptiles | boundary |  | 16 | Moved above hillshade/analysis and below symbols. |
| 31 | 09 style overlays | overlay | boundary low_emission_zone contour | line | openmaptiles | boundary | 14 |  | Moved above hillshade/analysis and below symbols. |
| 32 | 13 labels/icons | overlay/symbol | boundary low_emission_zone label | symbol | openmaptiles | boundary | 14 | 22 | All style symbols are moved to the top after route/debug layers. |
| 33 | 09 style overlays | overlay | boundary limited_traffic_zone polygon | fill | openmaptiles | boundary |  | 24 | Moved above hillshade/analysis and below symbols. |
| 34 | 09 style overlays | overlay | boundary limited_traffic_zone contour | line | openmaptiles | boundary | 14 |  | Moved above hillshade/analysis and below symbols. |
| 35 | 13 labels/icons | overlay/symbol | boundary limited_traffic_zone label | symbol | openmaptiles | boundary | 14 | 22 | All style symbols are moved to the top after route/debug layers. |
| 36 | 05 vector fills | fills | Cemetery | fill | openmaptiles | landuse | 9 | 22 | Moved below hillshade so relief shades the fill color. |
| 37 | 05 vector fills | fills | Stadium | fill | openmaptiles | landuse | 9 | 22 | Moved below hillshade so relief shades the fill color. |
| 38 | 04 vector underlay | underlay | Trees | circle | openmaptiles | landcover | 14 |  | Opacity controlled by vector/base visibility; not explicitly reordered after fill pass. |
| 39 | 04 vector underlay | underlay | Tree rows | line | openmaptiles | landcover | 14 |  | Opacity controlled by vector/base visibility; not explicitly reordered after fill pass. |
| 40 | 01 replaced by terrain-bg | background | Neige | background |  |  |  |  | Removed by injectOverlaysIntoStyle; paint is copied to terrain-bg when available. |
| 41 | 04 vector underlay | underlay | Cliff and Ridge Line | line | openmaptiles | mountain_peak | 12 |  | Opacity controlled by vector/base visibility; not explicitly reordered after fill pass. |
| 42 | 13 labels/icons | overlay/symbol | Cliff Symbols | symbol | openmaptiles | mountain_peak | 12 |  | All style symbols are moved to the top after route/debug layers. |
| 43 | 13 labels/icons | overlay/symbol | Arete Symbols | symbol | openmaptiles | mountain_peak | 12 |  | All style symbols are moved to the top after route/debug layers. |
| 44 | 09 style overlays | overlay | River tunnel | line | openmaptiles | waterway | 14 |  | Moved above hillshade/analysis and below symbols. |
| 45 | 09 style overlays | overlay | River | line | openmaptiles | waterway |  |  | Moved above hillshade/analysis and below symbols. |
| 46 | 05 vector fills | fills | Water intermittent | fill | openmaptiles | water |  |  | Moved below hillshade so relief shades the fill color. |
| 47 | 04 vector underlay | underlay | Aeroway | line | openmaptiles | aeroway | 11 |  | Opacity controlled by vector/base visibility; not explicitly reordered after fill pass. |
| 48 | 05 vector fills | fills | Heliport | fill | openmaptiles | aeroway | 11 |  | Moved below hillshade so relief shades the fill color. |
| 49 | 09 style overlays | overlay | Ferry line | line | openmaptiles | transportation |  |  | Moved above hillshade/analysis and below symbols. |
| 50 | 09 style overlays | overlay | Tunnel hatching | line | openmaptiles | transportation | 4 |  | Moved above hillshade/analysis and below symbols. |
| 51 | 09 style overlays | overlay | Tunnel | line | openmaptiles | transportation | 4 |  | Moved above hillshade/analysis and below symbols. |
| 52 | 09 style overlays | overlay | Railway tunnel | line | openmaptiles | transportation | 5 |  | Moved above hillshade/analysis and below symbols. |
| 53 | 09 style overlays | overlay | Railway tunnel hatching | line | openmaptiles | transportation | 15 |  | Moved above hillshade/analysis and below symbols. |
| 54 | 09 style overlays | overlay | Footway tunnel outline | line | openmaptiles | transportation | 12 |  | Moved above hillshade/analysis and below symbols. |
| 55 | 09 style overlays | overlay | Footway tunnel | line | openmaptiles | transportation | 12 |  | Moved above hillshade/analysis and below symbols. |
| 56 | 09 style overlays | overlay | Pier | fill | openmaptiles | transportation |  |  | Moved above hillshade/analysis and below symbols. |
| 57 | 09 style overlays | overlay | Pier road | line | openmaptiles | transportation |  |  | Moved above hillshade/analysis and below symbols. |
| 58 | 09 style overlays | overlay | Bridge | fill | openmaptiles | transportation |  |  | Moved above hillshade/analysis and below symbols. |
| 59 | 09 style overlays | overlay | Cycleway outline | line | openmaptiles | transportation | 15 |  | Moved above hillshade/analysis and below symbols. |
| 60 | 09 style overlays | overlay | Minor road outline | line | openmaptiles | transportation | 11 |  | Moved above hillshade/analysis and below symbols. |
| 61 | 09 style overlays | overlay | Major road outline | line | openmaptiles | transportation | 8 |  | Moved above hillshade/analysis and below symbols. |
| 62 | 09 style overlays | overlay | Motorway outline | line | openmaptiles | transportation | 6 |  | Moved above hillshade/analysis and below symbols. |
| 63 | 09 style overlays | overlay | Road under construction | line | openmaptiles | transportation | 8 |  | Moved above hillshade/analysis and below symbols. |
| 64 | 09 style overlays | overlay | Track | line | openmaptiles | transportation | 12 |  | Moved above hillshade/analysis and below symbols. |
| 65 | 09 style overlays | overlay | Track dasharray | line | openmaptiles | transportation | 13 |  | Moved above hillshade/analysis and below symbols. |
| 66 | 09 style overlays | overlay | Minor road | line | openmaptiles | transportation | 10 |  | Moved above hillshade/analysis and below symbols. |
| 67 | 09 style overlays | overlay | Major road | line | openmaptiles | transportation | 10 |  | Moved above hillshade/analysis and below symbols. |
| 68 | 09 style overlays | overlay | Motorway | line | openmaptiles | transportation | 6 |  | Moved above hillshade/analysis and below symbols. |
| 69 | 09 style overlays | overlay | Cycleway | line | openmaptiles | transportation | 15 |  | Moved above hillshade/analysis and below symbols. |
| 70 | 09 style overlays | overlay | Footway | line | openmaptiles | transportation | 12 |  | Moved above hillshade/analysis and below symbols. |
| 71 | 09 style overlays | overlay | Path | line | openmaptiles | transportation | 12 |  | Moved above hillshade/analysis and below symbols. |
| 72 | 13 labels/icons | overlay/symbol | Difficult Path Label | symbol | openmaptiles | transportation | 12 |  | All style symbols are moved to the top after route/debug layers. |
| 73 | 09 style overlays | overlay | Steps | line | openmaptiles | transportation | 12 |  | Moved above hillshade/analysis and below symbols. |
| 74 | 09 style overlays | overlay | Major rail | line | openmaptiles | transportation | 5 | 22 | Moved above hillshade/analysis and below symbols. |
| 75 | 09 style overlays | overlay | Major rail hatching | line | openmaptiles | transportation | 15 |  | Moved above hillshade/analysis and below symbols. |
| 76 | 09 style overlays | overlay | Minor rail | line | openmaptiles | transportation | 8 | 22 | Moved above hillshade/analysis and below symbols. |
| 77 | 09 style overlays | overlay | Minor rail hatching | line | openmaptiles | transportation | 15 |  | Moved above hillshade/analysis and below symbols. |
| 78 | 09 style overlays | overlay | Bridge outline for Cycleway | line | openmaptiles | transportation | 15 |  | Moved above hillshade/analysis and below symbols. |
| 79 | 09 style overlays | overlay | Bridge for Cycleway | line | openmaptiles | transportation | 15 |  | Moved above hillshade/analysis and below symbols. |
| 80 | 09 style overlays | overlay | Bridge outline for path | line | openmaptiles | transportation | 14 |  | Moved above hillshade/analysis and below symbols. |
| 81 | 09 style overlays | overlay | Bridge fill for path | line | openmaptiles | transportation | 14 |  | Moved above hillshade/analysis and below symbols. |
| 82 | 09 style overlays | overlay | Footway on bridges | line | openmaptiles | transportation | 12 |  | Moved above hillshade/analysis and below symbols. |
| 83 | 09 style overlays | overlay | Path on bridges | line | openmaptiles | transportation | 12 |  | Moved above hillshade/analysis and below symbols. |
| 84 | 09 style overlays | overlay | Bridge outline for minor roads | line | openmaptiles | transportation | 14 |  | Moved above hillshade/analysis and below symbols. |
| 85 | 09 style overlays | overlay | Bridge for minor roads | line | openmaptiles | transportation | 10 |  | Moved above hillshade/analysis and below symbols. |
| 86 | 09 style overlays | overlay | Bridge outline for major roads | line | openmaptiles | transportation | 14 |  | Moved above hillshade/analysis and below symbols. |
| 87 | 09 style overlays | overlay | Bridge for major roads | line | openmaptiles | transportation | 10 |  | Moved above hillshade/analysis and below symbols. |
| 88 | 09 style overlays | overlay | Bridge outline for motorway | line | openmaptiles | transportation | 14 |  | Moved above hillshade/analysis and below symbols. |
| 89 | 09 style overlays | overlay | Bridge for motorway | line | openmaptiles | transportation | 6 |  | Moved above hillshade/analysis and below symbols. |
| 90 | 09 style overlays | overlay | Bridge fill for rail | line | openmaptiles | transportation | 14 |  | Moved above hillshade/analysis and below symbols. |
| 91 | 09 style overlays | overlay | Bridge outline for rail | line | openmaptiles | transportation | 14 |  | Moved above hillshade/analysis and below symbols. |
| 92 | 04 vector underlay | underlay | Cycle highways outline | line | openmaptiles | route | 10 | 15 | Opacity controlled by vector/base visibility; not explicitly reordered after fill pass. |
| 93 | 04 vector underlay | underlay | Cycle highways | line | openmaptiles | route | 10 | 15 | Opacity controlled by vector/base visibility; not explicitly reordered after fill pass. |
| 94 | 13 labels/icons | overlay/symbol | Cycle highways icons | symbol | openmaptiles | route | 10 | 15 | All style symbols are moved to the top after route/debug layers. |
| 95 | 09 style overlays | overlay | Building | fill | openmaptiles | building | 14 | 17 | Moved above hillshade/analysis and below symbols. |
| 96 | 09 style overlays | overlay | Building 3D | fill-extrusion | openmaptiles | building | 16 |  | Moved above hillshade/analysis and below symbols. |
| 97 | 09 style overlays | overlay | Aqueduct outline | line | openmaptiles | waterway |  |  | Moved above hillshade/analysis and below symbols. |
| 98 | 09 style overlays | overlay | Aqueduct | line | openmaptiles | waterway |  |  | Moved above hillshade/analysis and below symbols. |
| 99 | 09 style overlays | overlay | Cablecar | line | openmaptiles | transportation | 13 |  | Moved above hillshade/analysis and below symbols. |
| 100 | 09 style overlays | overlay | Cablecar dash | line | openmaptiles | transportation | 13 |  | Moved above hillshade/analysis and below symbols. |
| 101 | 09 style overlays | overlay | Other border | line | openmaptiles | boundary | 3 | 22 | Moved above hillshade/analysis and below symbols. |
| 102 | 09 style overlays | overlay | Disputed border | line | openmaptiles | boundary | 0 |  | Moved above hillshade/analysis and below symbols. |
| 103 | 09 style overlays | overlay | Country border | line | openmaptiles | boundary | 0 |  | Moved above hillshade/analysis and below symbols. |
| 104 | 04 vector underlay | underlay | Hiking route outline | line | openmaptiles | route | 4 |  | Opacity controlled by vector/base visibility; not explicitly reordered after fill pass. |
| 105 | 04 vector underlay | underlay | Hiking route | line | openmaptiles | route | 4 |  | Opacity controlled by vector/base visibility; not explicitly reordered after fill pass. |
| 106 | 04 vector underlay | underlay | Hiking route dasharray | line | openmaptiles | route | 4 |  | Opacity controlled by vector/base visibility; not explicitly reordered after fill pass. |
| 107 | 04 vector underlay | underlay | Bicycle route outline | line | openmaptiles | route | 4 |  | Opacity controlled by vector/base visibility; not explicitly reordered after fill pass. |
| 108 | 04 vector underlay | underlay | Bicycle route | line | openmaptiles | route | 4 |  | Opacity controlled by vector/base visibility; not explicitly reordered after fill pass. |
| 109 | 04 vector underlay | underlay | Bicycle route dasharray | line | openmaptiles | route | 4 |  | Opacity controlled by vector/base visibility; not explicitly reordered after fill pass. |
| 110 | 04 vector underlay | underlay | MTB route outline | line | openmaptiles | route | 4 |  | Opacity controlled by vector/base visibility; not explicitly reordered after fill pass. |
| 111 | 04 vector underlay | underlay | MTB route | line | openmaptiles | route | 4 |  | Opacity controlled by vector/base visibility; not explicitly reordered after fill pass. |
| 112 | 04 vector underlay | underlay | MTB route dasharray | line | openmaptiles | route | 4 |  | Opacity controlled by vector/base visibility; not explicitly reordered after fill pass. |
| 113 | 04 vector underlay | underlay | Ski route surface | fill | openmaptiles | route | 11 |  | Opacity controlled by vector/base visibility; not explicitly reordered after fill pass. |
| 114 | 04 vector underlay | underlay | Ski route outline | line | openmaptiles | route | 4 |  | Opacity controlled by vector/base visibility; not explicitly reordered after fill pass. |
| 115 | 04 vector underlay | underlay | Ski route | line | openmaptiles | route | 4 |  | Opacity controlled by vector/base visibility; not explicitly reordered after fill pass. |
| 116 | 04 vector underlay | underlay | Ski route dasharray | line | openmaptiles | route | 4 |  | Opacity controlled by vector/base visibility; not explicitly reordered after fill pass. |
| 117 | 13 labels/icons | overlay/symbol | River labels | symbol | openmaptiles | water_name | 13 |  | All style symbols are moved to the top after route/debug layers. |
| 118 | 13 labels/icons | overlay/symbol | Ocean and sea labels | symbol | openmaptiles | place | 0 | 14 | All style symbols are moved to the top after route/debug layers. |
| 119 | 13 labels/icons | overlay/symbol | Ocean labels | symbol | openmaptiles | water_name | 0 | 14 | All style symbols are moved to the top after route/debug layers. |
| 120 | 13 labels/icons | overlay/symbol | Lake labels | symbol | openmaptiles | water_name | 12 |  | All style symbols are moved to the top after route/debug layers. |
| 121 | 13 labels/icons | overlay/symbol | Housenumber | symbol | openmaptiles | housenumber | 18 |  | All style symbols are moved to the top after route/debug layers. |
| 122 | 13 labels/icons | overlay/symbol | Gondola | symbol | openmaptiles | transportation_name | 13 |  | All style symbols are moved to the top after route/debug layers. |
| 123 | 13 labels/icons | overlay/symbol | Ferry | symbol | openmaptiles | transportation_name | 12 |  | All style symbols are moved to the top after route/debug layers. |
| 124 | 13 labels/icons | overlay/symbol | Oneway | symbol | openmaptiles | transportation | 16 |  | All style symbols are moved to the top after route/debug layers. |
| 125 | 13 labels/icons | overlay/symbol | Road labels | symbol | openmaptiles | transportation_name | 6 | 22 | All style symbols are moved to the top after route/debug layers. |
| 126 | 13 labels/icons | overlay/symbol | Private road labels | symbol | openmaptiles | transportation | 17 | 22 | All style symbols are moved to the top after route/debug layers. |
| 127 | 13 labels/icons | overlay/symbol | Highway junction | symbol | openmaptiles | transportation_name | 16 | 22 | All style symbols are moved to the top after route/debug layers. |
| 128 | 13 labels/icons | overlay/symbol | Highway shield | symbol | openmaptiles | transportation_name | 22 | 22 | All style symbols are moved to the top after route/debug layers. |
| 129 | 13 labels/icons | overlay/symbol | Highway shield (US) | symbol | openmaptiles | transportation_name | 7 |  | All style symbols are moved to the top after route/debug layers. |
| 130 | 13 labels/icons | overlay/symbol | Stone | symbol | openmaptiles | mountain_peak | 13 |  | All style symbols are moved to the top after route/debug layers. |
| 131 | 13 labels/icons | overlay/symbol | Parking | symbol | openmaptiles | poi | 17 |  | All style symbols are moved to the top after route/debug layers. |
| 132 | 13 labels/icons | overlay/symbol | Car utilities | symbol | openmaptiles | poi | 13 |  | All style symbols are moved to the top after route/debug layers. |
| 133 | 13 labels/icons | overlay/symbol | Other POI | symbol | openmaptiles | poi | 10 |  | All style symbols are moved to the top after route/debug layers. |
| 134 | 13 labels/icons | overlay/symbol | Protected area labels | symbol | openmaptiles | park | 9 | 22 | All style symbols are moved to the top after route/debug layers. |
| 135 | 13 labels/icons | overlay/symbol | Place labels | symbol | openmaptiles | place | 4 |  | All style symbols are moved to the top after route/debug layers. |
| 136 | 13 labels/icons | overlay/symbol | Peak labels | symbol | openmaptiles | mountain_peak | 11 |  | All style symbols are moved to the top after route/debug layers. |
| 137 | 13 labels/icons | overlay/symbol | Station | symbol | openmaptiles | poi | 10 | 22 | All style symbols are moved to the top after route/debug layers. |
| 138 | 13 labels/icons | overlay/symbol | Airport | symbol | openmaptiles | aerodrome_label | 8 |  | All style symbols are moved to the top after route/debug layers. |
| 139 | 13 labels/icons | overlay/symbol | Airport gate | symbol | openmaptiles | aeroway | 15 |  | All style symbols are moved to the top after route/debug layers. |
| 140 | 13 labels/icons | overlay/symbol | State labels | symbol | openmaptiles | place | 3 | 9 | All style symbols are moved to the top after route/debug layers. |
| 141 | 13 labels/icons | overlay/symbol | Town labels | symbol | openmaptiles | place | 6 | 16 | All style symbols are moved to the top after route/debug layers. |
| 142 | 13 labels/icons | overlay/symbol | City labels | symbol | openmaptiles | place | 4 | 16 | All style symbols are moved to the top after route/debug layers. |
| 143 | 13 labels/icons | overlay/symbol | Capital city labels | symbol | openmaptiles | place | 4 | 16 | All style symbols are moved to the top after route/debug layers. |
| 144 | 13 labels/icons | overlay/symbol | Country labels | symbol | openmaptiles | place | 2.5 | 12 | All style symbols are moved to the top after route/debug layers. |
| 145 | 13 labels/icons | overlay/symbol | Continent labels | symbol | openmaptiles | place |  | 4 | All style symbols are moved to the top after route/debug layers. |
| 146 | 13 labels/icons | overlay/symbol | Hiking route labels | symbol | openmaptiles | route | 13 |  | All style symbols are moved to the top after route/debug layers. |
| 147 | 13 labels/icons | overlay/symbol | Bicycle route labels | symbol | openmaptiles | route | 13 |  | All style symbols are moved to the top after route/debug layers. |
| 148 | 13 labels/icons | overlay/symbol | MTB route labels | symbol | openmaptiles | route | 13 |  | All style symbols are moved to the top after route/debug layers. |
| 149 | 13 labels/icons | overlay/symbol | Ski route labels | symbol | openmaptiles | route | 13 |  | All style symbols are moved to the top after route/debug layers. |
