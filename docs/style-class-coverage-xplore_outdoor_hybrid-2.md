# Style Class Coverage Audit

Style: `styles/map-styles/xplore_outdoor_hybrid-2.json`
Vector source: `openmaptiles`
PMTiles: `https://tuiles.enliberte.fr/planet.pmtiles`

Observed 301 distinct source-layer/class/subclass pairs from 820/820 sampled tiles.

## Missing Source Layers

| Missing source layer | Style layers |
| --- | --- |
| route | Cycle highways outline, Cycle highways, Hiking route outline, Hiking route, Hiking route dasharray, Bicycle route outline, Bicycle route, Bicycle route dasharray, MTB route outline, MTB route, MTB route dasharray, Ski route surface, Ski route outline, Ski route, Ski route dasharray, Cycle highways icons, Hiking route labels, Bicycle route labels, MTB route labels, Ski route labels |

## Samples

| Sample | Zoom | BBox | Tiles |
| --- | ---: | --- | ---: |
| world-z4 | 4 | -180, -85, 180, 85 | 256 |
| alps-z10 | 10 | 5, 43.5, 12.5, 47.8 | 418 |
| matterhorn-z13 | 13 | 7.45, 45.85, 7.85, 46.1 | 90 |
| oeschinen-z13 | 13 | 7.62, 46.43, 7.85, 46.58 | 36 |
| rainier-z11 | 11 | -122.1, 46.65, -121.55, 47.05 | 20 |

## Missing Visible Coverage

| Source layer | Class | Subclass | Features | Samples |
| --- | --- | --- | ---: | --- |
| aerodrome_label | international | (none) | 46 | alps-z10 |
| aerodrome_label | military | (none) | 40 | alps-z10 |
| aerodrome_label | other | (none) | 1125 | alps-z10, matterhorn-z13, rainier-z11 |
| aerodrome_label | private | (none) | 5 | alps-z10 |
| aerodrome_label | regional | (none) | 30 | alps-z10 |
| boundary | aboriginal_lands | (none) | 313 | rainier-z11, world-z4 |
| landuse | commercial | (none) | 221 | alps-z10, oeschinen-z13, rainier-z11 |
| landuse | dam | (none) | 2 | matterhorn-z13, rainier-z11 |
| landuse | education | (none) | 2 | alps-z10 |
| landuse | healthcare | (none) | 2 | alps-z10 |
| landuse | military | (none) | 252 | alps-z10, oeschinen-z13 |
| landuse | quarter | (none) | 170 | alps-z10 |
| landuse | railway | (none) | 189 | alps-z10, matterhorn-z13, oeschinen-z13 |
| landuse | recreation_ground | (none) | 1 | alps-z10 |
| landuse | suburb | (none) | 343 | alps-z10 |
| landuse | theme_park | (none) | 11 | alps-z10 |
| landuse | tourism | (none) | 1 | alps-z10 |
| landuse | track | (none) | 9 | alps-z10 |
| landuse | yes | (none) | 2 | alps-z10 |
| landuse | zoo | (none) | 19 | alps-z10 |
| mountain_peak | saddle | (none) | 2941 | alps-z10, matterhorn-z13, oeschinen-z13, rainier-z11 |
| transportation | ferry | (none) | 187 | alps-z10, world-z4 |
| transportation_name | service | (none) | 3 | matterhorn-z13, oeschinen-z13 |

## Covered Only Outside Sample Zoom

| Source layer | Class | Subclass | Features | Matching layers |
| --- | --- | --- | ---: | --- |
| aeroway | heliport | (none) | 1 | Airport zone, Heliport |
| aeroway | taxiway | (none) | 1653 | Airport zone |
| landcover | ice | ice_shelf | 109 | Glacier |
| transportation | path | cycleway | 4 | Cycleway outline, Cycleway |

## Observed Values By Source Layer

### aerodrome_label

| Class | Subclass | Features | Coverage | Layers |
| --- | --- | ---: | --- | --- |
| international | (none) | 46 | hidden only | Airport |
| military | (none) | 40 | hidden only | Airport |
| other | (none) | 1125 | hidden only | Airport |
| private | (none) | 5 | missing |  |
| regional | (none) | 30 | hidden only | Airport |

### aeroway

| Class | Subclass | Features | Coverage | Layers |
| --- | --- | ---: | --- | --- |
| aerodrome | (none) | 284 | visible | Airport zone |
| apron | (none) | 55 | visible | Airport zone |
| helipad | (none) | 1 | visible | Airport zone, Heliport |
| heliport | (none) | 1 | other zoom | Airport zone, Heliport |
| runway | (none) | 955 | visible | Airport zone |
| taxiway | (none) | 1653 | other zoom | Airport zone |

### boundary

| Class | Subclass | Features | Coverage | Layers |
| --- | --- | ---: | --- | --- |
| aboriginal_lands | (none) | 313 | missing |  |

### landcover

| Class | Subclass | Features | Coverage | Layers |
| --- | --- | ---: | --- | --- |
| farmland | farmland | 29246 | visible | Farmland |
| farmland | orchard | 1756 | visible | Farmland |
| farmland | plant_nursery | 55 | visible | Farmland |
| farmland | vineyard | 1686 | visible | Farmland |
| grass | allotments | 7 | visible | Grass |
| grass | fell | 1072 | visible | Grass |
| grass | garden | 13 | visible | Grass |
| grass | golf_course | 421 | visible | Grass |
| grass | grass | 776 | visible | Grass |
| grass | grassland | 6504 | visible | Grass, Grassland |
| grass | heath | 2133 | visible | Grass |
| grass | meadow | 24792 | visible | meadow, Grass |
| grass | park | 269 | visible | Grass |
| grass | recreation_ground | 16 | visible | Grass |
| grass | scrub | 6250 | visible | Grass |
| grass | tundra | 7 | visible | Grass |
| grass | village_green | 1 | visible | Grass |
| ice | glacier | 2210 | visible | Glacier |
| ice | ice_shelf | 109 | other zoom | Glacier |
| rock | bare_rock | 8046 | visible | Rock, Rock texture |
| rock | scree | 8320 | visible | Rock, Rock scree light texture |
| sand | beach | 58 | visible | Beach |
| sand | sand | 43 | visible | Sand |
| wetland | bog | 1 | visible | Wetland (medium scale) |
| wetland | marsh | 4 | visible | Wetland (medium scale) |
| wetland | saltmarsh | 3 | visible | Wetland (medium scale) |
| wetland | wet_meadow | 1 | visible | Wetland (medium scale) |
| wetland | wetland | 925 | visible | Wetland (medium scale) |
| wood | forest | 4910 | visible | Wood, Wood symbols |
| wood | wood | 820 | visible | Wood, Wood symbols |

### landuse

| Class | Subclass | Features | Coverage | Layers |
| --- | --- | ---: | --- | --- |
| cemetery | (none) | 33 | visible | Cemetery |
| college | (none) | 3 | visible | School |
| commercial | (none) | 221 | missing |  |
| dam | (none) | 2 | missing |  |
| education | (none) | 2 | missing |  |
| healthcare | (none) | 2 | missing |  |
| hospital | (none) | 44 | visible | Hospital |
| industrial | (none) | 2766 | visible | Industrial |
| military | (none) | 252 | missing |  |
| neighbourhood | (none) | 103 | visible | Residential |
| pitch | (none) | 16 | visible | Stadium |
| playground | (none) | 3 | visible | Stadium |
| quarry | (none) | 652 | visible | quarry, Industrial |
| quarter | (none) | 170 | missing |  |
| railway | (none) | 189 | missing |  |
| recreation_ground | (none) | 1 | missing |  |
| residential | (none) | 483 | visible | Residential |
| retail | (none) | 165 | visible | Retail |
| school | (none) | 18 | visible | School |
| stadium | (none) | 1 | visible | Stadium |
| suburb | (none) | 343 | missing |  |
| theme_park | (none) | 11 | missing |  |
| tourism | (none) | 1 | missing |  |
| track | (none) | 9 | missing |  |
| university | (none) | 14 | visible | School |
| yes | (none) | 2 | missing |  |
| zoo | (none) | 19 | missing |  |

### mountain_peak

| Class | Subclass | Features | Coverage | Layers |
| --- | --- | ---: | --- | --- |
| arete | (none) | 74 | visible | Arete Symbols |
| cliff | (none) | 2915 | visible | Cliff and Ridge Line, Cliff Symbols |
| peak | (none) | 21499 | visible | Peak labels |
| ridge | (none) | 393 | visible | Cliff and Ridge Line |
| saddle | (none) | 2941 | missing |  |
| volcano | (none) | 30 | visible | Peak labels |

### park

| Class | Subclass | Features | Coverage | Layers |
| --- | --- | ---: | --- | --- |
| agricultural_park | (none) | 13 | visible | Protected area labels, park null polygon, park null contour, park null label |
| aire_d'adhésion | (none) | 20 | visible | Protected area labels, park null polygon, park null contour, park null label |
| aire_d’adhésion | (none) | 32 | visible | Protected area labels, park null polygon, park null contour, park null label |
| aire_optimum_d'adhésion | (none) | 4 | visible | park null polygon, park null contour, park null label, Protected area labels |
| area_contigua | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| area_marina_protetta | (none) | 2 | visible | park null polygon, park null contour, park null label, Protected area labels |
| area_naturale_marina_protetta | (none) | 3 | visible | park null polygon, park null contour, park null label, Protected area labels |
| area_naturale_marina_protetta_delle_cinque_terre | (none) | 11 | visible | Protected area labels, park null polygon, park null contour, park null label |
| area_naturale_protetta | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| area_naturale_protetta_di_interesse_locale | (none) | 8 | visible | park null polygon, park null contour, park null label, Protected area labels |
| area_protetta | (none) | 11 | visible | Protected area labels, park null polygon, park null contour, park null label |
| area_protetta_della_regione_marche | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| area_protetta_nazionale | (none) | 11 | visible | Protected area labels, park null polygon, park null contour, park null label |
| area_protetta_regionale | (none) | 139 | visible | park null polygon, park null contour, park null label, Protected area labels |
| area_wilderness | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| arrêté_de_protection_de_biotope | (none) | 4 | visible | park null polygon, park null contour, park null label, Protected area labels |
| aufwertung_der_natürlichen_lebensräume | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| biosphärenreservat | (none) | 12 | visible | Protected area labels, park null polygon, park null contour, park null label |
| biosphärenreservat-kernzone | (none) | 12 | visible | Protected area labels, park null polygon, park null contour, park null label |
| biosphere_reserve | (none) | 12 | visible | Protected area labels, park null polygon, park null contour, park null label |
| biotop | (none) | 105 | visible | park null polygon, park null contour, park null label, Protected area labels |
| biotopo | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| biotopo_prà_delle_nasse | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| cœur | (none) | 53 | visible | Protected area labels, park null polygon, park null contour, park null label |
| community_forest | (none) | 10 | visible | Protected area labels, park null polygon, park null contour, park null label |
| direttiva_92/43/cee_(habitat) | (none) | 11 | visible | Protected area labels, park null polygon, park null contour, park null label |
| espace_naturel_sensible | (none) | 33 | visible | park null polygon, park null contour, park null label, Protected area labels |
| fauna-flora-habitat | (none) | 16 | visible | park null polygon, park null contour, park null label, Protected area labels |
| fauna-flora-habitat-gebiet | (none) | 20 | visible | park null polygon, park null contour, park null label, Protected area labels |
| ffh-gebiet | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| flora-fauna-habitat | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| gebietsverbot | (none) | 110 | visible | park null polygon, park null contour, park null label, Protected area labels |
| gebietsverbot_und_wegegebot | (none) | 12 | visible | park null polygon, park null contour, park null label, Protected area labels |
| geomorphological | (none) | 348 | visible | Protected area labels, park null polygon, park null contour, park null label |
| gesamtanlage | (none) | 2 | visible | park null polygon, park null contour, park null label, Protected area labels |
| geschützter_landschaftsbestandteil | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| geschützter_landschaftsteil | (none) | 6 | visible | park null polygon, park null contour, park null label, Protected area labels |
| hüsliriet | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| landschaftsschutzgebiet | (none) | 175 | visible | Protected area labels, park null polygon, park null contour, park null label |
| monumento_naturale | (none) | 3 | visible | park null polygon, park null contour, park null label, Protected area labels |
| national_bedeutendes_wasservogelschutzgebiet | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| national_forest | (none) | 18 | visible | park null polygon, park null contour, park null label, Protected area labels |
| national_park | (none) | 100 | visible | Protected area labels, park null polygon, park null contour, park null label |
| nationalpark | (none) | 14 | visible | Protected area labels, park null polygon, park null contour, park null label |
| natura_2000 | (none) | 44 | visible | Protected area labels, park null polygon, park null contour, park null label |
| natura2000 | (none) | 16 | visible | park null polygon, park null contour, park null label, Protected area labels |
| natural_resources_conservation_area | (none) | 2 | visible | park null polygon, park null contour, park null label, Protected area labels |
| naturdenkmal | (none) | 4 | visible | park null polygon, park null contour, park null label, Protected area labels |
| nature_reserve | (none) | 538 | visible | park null polygon, park null contour, park null label, Protected area labels |
| naturerlebnispark | (none) | 2 | visible | park null polygon, park null contour, park null label, Protected area labels |
| naturpark | (none) | 188 | visible | park null polygon, park null contour, park null label, Protected area labels |
| naturschutzgebiet | (none) | 625 | visible | Protected area labels, park null polygon, park null contour, park null label |
| oasi | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| oasi_cave_di_gaggio | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| örtliches_schutzgebiet | (none) | 4 | visible | park null polygon, park null contour, park null label, Protected area labels |
| parc_national_des_écrins_(aire_d’adhésion) | (none) | 20 | visible | park null polygon, park null contour, park null label, Protected area labels |
| parc_naturel_marin | (none) | 6 | visible | Protected area labels, park null polygon, park null contour, park null label |
| parc_naturel_périurbain | (none) | 4 | visible | park null polygon, park null contour, park null label, Protected area labels |
| parc_naturel_régional | (none) | 259 | visible | Protected area labels, park null polygon, park null contour, park null label |
| parco_fluviale_del_po | (none) | 23 | visible | park null polygon, park null contour, park null label, Protected area labels |
| parco_locale_di_interesse_sovraccomunale | (none) | 34 | visible | Protected area labels, park null polygon, park null contour, park null label |
| parco_locale_di_interesse_sovracomunale | (none) | 81 | visible | Protected area labels, park null polygon, park null contour, park null label |
| parco_locale_di_interesse_sovracomunale_(plis) | (none) | 3 | visible | park null polygon, park null contour, park null label, Protected area labels |
| parco_naturale | (none) | 49 | visible | park null polygon, park null contour, park null label, Protected area labels |
| parco_naturale_regionale | (none) | 33 | visible | Protected area labels, park null polygon, park null contour, park null label |
| parco_regionale | (none) | 111 | visible | park null polygon, park null contour, park null label, Protected area labels |
| parco_regionale_naturale | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| parte_rere_natura_2000 | (none) | 3 | visible | park null polygon, park null contour, park null label, Protected area labels |
| pflanzenschutzgebiet | (none) | 12 | visible | Protected area labels, park null polygon, park null contour, park null label |
| protected_area | (none) | 1252 | visible | park null polygon, park null contour, park null label, Protected area labels |
| protected_site | (none) | 3 | visible | park null polygon, park null contour, park null label, Protected area labels |
| regional_nature_park | (none) | 12 | visible | Protected area labels, park null polygon, park null contour, park null label |
| regional_park | (none) | 25 | visible | Protected area labels, park null polygon, park null contour, park null label |
| regionaler_naturpark | (none) | 118 | visible | Protected area labels, park null polygon, park null contour, park null label |
| renaturierungsgebiet | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| réserve_biologique_dirigée | (none) | 47 | visible | park null polygon, park null contour, park null label, Protected area labels |
| réserve_biologique_intégrale | (none) | 36 | visible | park null polygon, park null contour, park null label, Protected area labels |
| réserve_de_la_biosphère,_aire_de_coopération | (none) | 15 | visible | Protected area labels, park null polygon, park null contour, park null label |
| réserve_de_la_biosphère,_zone_centrale | (none) | 12 | visible | Protected area labels, park null polygon, park null contour, park null label |
| réserve_de_la_biosphère,_zone_tampon | (none) | 14 | visible | Protected area labels, park null polygon, park null contour, park null label |
| réserve_de_vie_sauvage | (none) | 2 | visible | park null polygon, park null contour, park null label, Protected area labels |
| réserve_intégrale_de_parc_national | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| réserve_nationale_de_chasse_et_faune_sauvage | (none) | 10 | visible | Protected area labels, park null polygon, park null contour, park null label |
| réserve_naturelle | (none) | 3 | visible | park null polygon, park null contour, park null label, Protected area labels |
| réserve_naturelle_nationale | (none) | 168 | visible | park null polygon, park null contour, park null label, Protected area labels |
| réserve_naturelle_régionale | (none) | 61 | visible | Protected area labels, park null polygon, park null contour, park null label |
| rete_natura_2000 | (none) | 2 | visible | park null polygon, park null contour, park null label, Protected area labels |
| rete_natura2000 | (none) | 3 | visible | park null polygon, park null contour, park null label, Protected area labels |
| riserva_nationale | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| riserva_naturale | (none) | 16 | visible | Protected area labels, park null polygon, park null contour, park null label |
| riserva_naturale_biogenetica | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| riserva_naturale_di_torile_e_trecasali | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| riserva_naturale_integrale | (none) | 5 | visible | park null polygon, park null contour, park null label, Protected area labels |
| riserva_naturale_orientata | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| riserva_naturale_regionale | (none) | 12 | visible | park null polygon, park null contour, park null label, Protected area labels |
| riserva_naturale_statale | (none) | 3 | visible | Protected area labels |
| riserva_regionale_dell'adelasia | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| ruhegebiet | (none) | 11 | visible | Protected area labels, park null polygon, park null contour, park null label |
| ruhegebiet;naturpark | (none) | 13 | visible | Protected area labels, park null polygon, park null contour, park null label |
| ruhezone | (none) | 10 | visible | Protected area labels, park null polygon, park null contour, park null label |
| schongebiet | (none) | 303 | visible | park null polygon, park null contour, park null label, Protected area labels |
| schutzgebiet | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| schutzzone | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| schutzzone_nach_empfehlung_"bergwelt_tirol_-_miteinander_erleben" | (none) | 263 | visible | park null polygon, park null contour, park null label, Protected area labels |
| schutzzone_nach_empfehlung_"jagdbetrieb_schaatwald/zöblen" | (none) | 2 | visible | park null polygon, park null contour, park null label, Protected area labels |
| schutzzone_nach_empfehlung_"jagdbetrieb_schattwald/zöblen" | (none) | 3 | visible | park null polygon, park null contour, park null label, Protected area labels |
| schutzzone_rehwild | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| sieben_möser | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| site_of_community_importance | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| sites_classés | (none) | 2 | visible | park null polygon, park null contour, park null label, Protected area labels |
| sito_d'interesse_comunitario | (none) | 4 | visible | Protected area labels, park null polygon, park null contour, park null label |
| sito_di_importanza_comunitaria | (none) | 140 | visible | Protected area labels, park null polygon, park null contour, park null label |
| sito_di_importanza_comunitaria_(sic) | (none) | 3 | visible | Protected area labels |
| sito_di_importanza_comunitaria_e_zona_di_protezione_speciale | (none) | 7 | visible | park null polygon, park null contour, park null label, Protected area labels |
| sito_di_importanza_comunitaria;zona_speciale_di_conservazione | (none) | 2 | visible | park null polygon, park null contour, park null label, Protected area labels |
| sito_di_importanza_regionale | (none) | 2 | visible | park null polygon, park null contour, park null label, Protected area labels |
| sito_di_interesse_comunitario | (none) | 36 | visible | Protected area labels, park null polygon, park null contour, park null label |
| sito_di_interesse_regionale | (none) | 2 | visible | park null polygon, park null contour, park null label, Protected area labels |
| sito_rere_natura_2000 | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| sonderschutzgebiet | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| sonstige_schutzgebiete | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| state_forest | (none) | 18 | visible | Protected area labels, park null polygon, park null contour, park null label |
| state_park | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| unesco_global_geopark | (none) | 3 | visible | park null polygon, park null contour, park null label, Protected area labels |
| unesco-biosphärenpark | (none) | 12 | visible | Protected area labels, park null polygon, park null contour, park null label |
| villaggio_operaio_di_crespi_d'adda | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| waldreservat | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| wasserschutzgebiet | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| wasserschutzgebiet-schutzzone_iii | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| wegegebot | (none) | 33 | visible | park null polygon, park null contour, park null label, Protected area labels |
| weltnaturerbe | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| wiesenbrütergebiet | (none) | 2 | visible | park null polygon, park null contour, park null label, Protected area labels |
| wild-europaschutzgebiet | (none) | 5 | visible | park null polygon, park null contour, park null label, Protected area labels |
| wilderness_area | (none) | 65 | visible | park null polygon, park null contour, park null label, Protected area labels |
| wildlife_area | (none) | 3 | visible | Protected area labels |
| wildruhefläche_nach_jagdgesetz | (none) | 51 | visible | park null polygon, park null contour, park null label, Protected area labels |
| wildruhezone | (none) | 7 | visible | park null polygon, park null contour, park null label, Protected area labels |
| zona_1_(a) | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| zona_1(a) | (none) | 4 | visible | park null polygon, park null contour, park null label, Protected area labels |
| zona_di_parco_regionale | (none) | 16 | visible | Protected area labels, park null polygon, park null contour, park null label |
| zona_di_protezione_speciale | (none) | 48 | visible | Protected area labels, park null polygon, park null contour, park null label |
| zona_di_tutela_paesaggistica | (none) | 13 | visible | Protected area labels, park null polygon, park null contour, park null label |
| zona_speciale_di_conservazione | (none) | 11 | visible | Protected area labels, park null polygon, park null contour, park null label |
| zone_marine_protégée | (none) | 2 | visible | park null polygon, park null contour, park null label, Protected area labels |
| zone_naturelle_d'intérêt_écologique_faunistique_et_floristique_continentale_de_type_1 | (none) | 1 | visible | park null polygon, park null contour, park null label, Protected area labels |
| zone_réglementée_des_merveilles | (none) | 2 | visible | park null polygon, park null contour, park null label, Protected area labels |

### place

| Class | Subclass | Features | Coverage | Layers |
| --- | --- | ---: | --- | --- |
| aboriginal_lands | (none) | 13 | visible | Place labels |
| city | (none) | 10049 | visible | City labels, Capital city labels |
| country | (none) | 1761 | visible | Country labels |
| hamlet | (none) | 2564 | visible | Place labels |
| island | (none) | 409 | visible | Place labels |
| province | (none) | 1299 | visible | State labels |
| state | (none) | 11385 | visible | State labels |
| suburb | (none) | 3 | visible | Place labels |
| town | (none) | 10052 | visible | City labels, Town labels |
| village | (none) | 117269 | visible | Place labels, City labels |

### poi

| Class | Subclass | Features | Coverage | Layers |
| --- | --- | ---: | --- | --- |
| railway | halt | 15 | visible | Station |
| railway | station | 29 | visible | Station |

### transportation

| Class | Subclass | Features | Coverage | Layers |
| --- | --- | ---: | --- | --- |
| aerialway | cable_car | 21 | visible | Cablecar, Cablecar dash |
| aerialway | chair_lift | 39 | visible | Cablecar, Cablecar dash |
| aerialway | drag_lift | 1 | visible | Cablecar, Cablecar dash |
| aerialway | gondola | 22 | visible | Cablecar, Cablecar dash |
| aerialway | mixed_lift | 2 | visible | Cablecar, Cablecar dash |
| aerialway | platter | 7 | visible | Cablecar, Cablecar dash |
| aerialway | t-bar | 10 | visible | Cablecar, Cablecar dash |
| bridge | (none) | 7 | visible | Bridge |
| ferry | (none) | 187 | hidden only | Ferry line |
| minor | (none) | 215 | visible | Minor road outline, Minor road, Bridge, Bridge for minor roads, Tunnel hatching, Tunnel |
| motorway | (none) | 1519 | visible | Bridge, Motorway outline, Motorway, Bridge for motorway, Tunnel hatching, Tunnel |
| motorway_construction | (none) | 96 | visible | Bridge, Road under construction |
| path | cycleway | 4 | other zoom | Cycleway outline, Cycleway |
| path | footway | 68 | visible | Footway, Pedestrian polygons, Footway tunnel outline, Footway tunnel, Bridge, Footway on bridges |
| path | path | 753 | visible | Path, Bridge, Path on bridges, Footway tunnel outline, Footway tunnel |
| path | pedestrian | 31 | visible | Pedestrian polygons, Pedestrian ways, Footway, Bridge, Footway on bridges |
| path | platform | 24 | visible | Pedestrian polygons |
| path | steps | 43 | visible | Steps, Footway tunnel outline, Footway tunnel, Bridge |
| pier | (none) | 3 | visible | Pier road |
| primary | (none) | 2649 | visible | Major road outline, Major road, Bridge, Bridge for major roads, Tunnel hatching, Tunnel |
| primary_construction | (none) | 118 | visible | Road under construction, Bridge |
| rail | narrow_gauge | 354 | visible | Major rail, Railway tunnel, Bridge |
| rail | rail | 1500 | visible | Railway tunnel, Major rail, Bridge |
| secondary | (none) | 2378 | visible | Major road outline, Major road, Tunnel hatching, Tunnel, Bridge, Bridge for major roads |
| secondary_construction | (none) | 62 | visible | Road under construction |
| service | (none) | 214 | visible | Minor road, Bridge, Bridge for minor roads, Tunnel hatching, Tunnel |
| tertiary | (none) | 62 | visible | Tunnel hatching, Tunnel, Minor road outline, Minor road, Bridge, Bridge for minor roads |
| tertiary_construction | (none) | 1 | visible | Road under construction |
| track | (none) | 382 | visible | Track, Track dasharray, Bridge, Tunnel hatching, Tunnel |
| trunk | (none) | 1440 | visible | Motorway outline, Motorway, Tunnel hatching, Tunnel, Bridge, Bridge for motorway |
| trunk_construction | (none) | 90 | visible | Road under construction, Bridge |

### transportation_name

| Class | Subclass | Features | Coverage | Layers |
| --- | --- | ---: | --- | --- |
| aerialway | cable_car | 5 | visible | Gondola, Road labels |
| aerialway | chair_lift | 24 | visible | Road labels |
| aerialway | gondola | 10 | visible | Gondola, Road labels |
| aerialway | platter | 4 | visible | Road labels |
| aerialway | t-bar | 6 | visible | Road labels |
| minor | (none) | 30 | visible | Road labels |
| minor | junction | 3 | visible | Road labels |
| motorway | (none) | 683 | visible | Road labels |
| motorway | junction | 3744 | visible | Road labels |
| motorway_construction | (none) | 5 | visible | Road labels |
| path | path | 193 | visible | Road labels |
| path | pedestrian | 1 | visible | Road labels |
| primary | junction | 400 | visible | Road labels |
| secondary | (none) | 17 | visible | Road labels |
| secondary | junction | 10 | visible | Road labels |
| service | (none) | 3 | missing |  |
| tertiary | (none) | 5 | visible | Road labels |
| tertiary | junction | 7 | visible | Road labels |
| track | (none) | 48 | visible | Road labels |
| trunk | (none) | 461 | visible | Road labels |
| trunk | junction | 2012 | visible | Road labels |
| trunk_construction | (none) | 24 | visible | Road labels |

### water

| Class | Subclass | Features | Coverage | Layers |
| --- | --- | ---: | --- | --- |
| dock | (none) | 1 | visible | Water lake |
| lake | (none) | 5126 | visible | Water lake, Water intermittent |
| ocean | (none) | 274 | visible | Water ocean |
| pond | (none) | 1083 | visible | Water lake, Water intermittent |
| river | (none) | 3670 | visible | Water lake, Water intermittent |
| swimming_pool | (none) | 1 | visible | Water lake |

### water_name

| Class | Subclass | Features | Coverage | Layers |
| --- | --- | ---: | --- | --- |
| bay | (none) | 599 | visible | Ocean labels |
| lake | (none) | 594 | visible | River labels, Lake labels |
| sea | (none) | 363 | visible | Ocean labels |
| strait | (none) | 63 | visible | Ocean labels |

### waterway

| Class | Subclass | Features | Coverage | Layers |
| --- | --- | ---: | --- | --- |
| canal | (none) | 30 | visible | River |
| ditch | (none) | 47 | visible | River |
| drain | (none) | 20 | visible | River |
| river | (none) | 3712 | visible | River |
| stream | (none) | 2216 | visible | River |

## Notes

- This checks values observed in sampled vector tiles, not an official exhaustive schema. If a rare class is absent from these samples, it will not appear here.
- A pair is considered covered when at least one visible style layer for the same source layer matches the feature filter.
- Layers with `layout.visibility: none` do not count as visible coverage.
