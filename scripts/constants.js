export const RELIEF_OPACITY = 0.40;
export const BASE_STYLE_RELIEF_OPACITY = 0.45;
export const COLOR_RELIEF_COLOR_RAMP = [
  'interpolate', ['linear'], ['elevation'],
  0, '#254a38',
  400, '#2f6b4a',
  800, '#5b8f5f',
  1200, '#7fa36e',
  1600, '#9eb17b',
  2000, '#b9bf8a',
  2300, '#c9c38f',
  2600, '#b6ab93',
  2900, '#9e978e',
  3200, '#8a8a8a',
  3500, '#aeb6c0',
  3800, '#cfd6de',
  4100, '#f2f3f5'
];
export const S2_OPACITY = 0.50;
export const VERSATILES_LOCAL_JSON = './osm_liberty.json';
export const MAPLIBRE_SPRITE_URL = 'https://demotiles.maplibre.org/styles/osm-bright-gl-style/sprite';
export const S2C_URL = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg';
export const TILE_FADE_DURATION = 800;
export const S2_FADE_DURATION = 700;
export const MAPTERHORN_TILE_URL = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
export const MAPTERHORN_ATTRIBUTION = '<a href="https://mapterhorn.com/attribution">© Mapterhorn</a>';

export const SKY_SETTINGS = {
  'sky-color': '#bcd0e6',
  'sky-horizon-blend': 0.35,
  'horizon-color': '#e6effa',
  'horizon-fog-blend': 0.35,
  'fog-color': '#bcd0e6',
  'fog-ground-blend': 0.15
};

export const VIEW_MODES = Object.freeze({ THREED: '3d', TWOD: '2d' });
export const DEFAULT_3D_ORIENTATION = Object.freeze({ pitch: 60, bearing: -18.6 });

export const GPX_SOURCE_ID = 'imported-gpx';
export const GPX_LINE_LAYER_ID = 'imported-gpx-line';
export const GPX_POINT_LAYER_ID = 'imported-gpx-points';
