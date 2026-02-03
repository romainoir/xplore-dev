export const ASCENT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.5 6a1 1 0 0 1 .7 1.7l-6.3 6.3a1 1 0 0 1-1.4 0l-3.3-3.3-4.9 6.7H7a1 1 0 0 1 0 2H2a1 1 0 0 1-1-1v-5a1 1 0 0 1 2 0v3.59l5.6-7.6a1 1 0 0 1 1.5-.12l3.3 3.3 5.6-5.6a1 1 0 0 1 .7-.27Z"/></svg>';
export const DESCENT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.5 6a1 1 0 0 1 .7 1.7l-6.3 6.3a1 1 0 0 1-1.4 0l-3.3-3.3-4.9 6.7H7a1 1 0 0 1 0 2H2a1 1 0 0 1-1-1v-5a1 1 0 0 1 2 0v3.59l5.6-7.6a1 1 0 0 1 1.5-.12l3.3 3.3 5.6-5.6a1 1 0 0 1 .7-.27Z"/></svg>';
export const DISTANCE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><circle cx="6" cy="6" r="2.4"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="18" r="2.4"/><path d="M8.95 7.05 10.36 5.64 18.36 13.64 16.95 15.05 8.95 7.05Z"/></svg>';
export const ELEVATION_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 18h18l-6.2-9.3-4.1 6.3-2.8-3.9L3 18Zm8.1-4.3 2.1-3.3 3.5 5.3H8.7Z"/></svg>';
export const SLOPE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 18h16v-2H9.83l8.58-8.59L17 5l-9 9H6z"/><path d="m7 7.5-2.5-2.5L3 6.5 5.5 9z"/></svg>';
export const TIME_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2Zm0 18a8 8 0 1 1 8-8 8.009 8.009 0 0 1-8 8Z"/><path d="M12.75 7h-1.5v5l4.5 2.7.75-1.23-3.75-2.22Z"/></svg>';
export const ROUTE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="6" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.8"/><path d="M8.6 7.7 12.8 12a3 3 0 0 1 .9 2.14V17a1 1 0 0 0 2 0v-2.86a5 5 0 0 0-1.5-3.56L11 9.2A3.94 3.94 0 0 0 13 8h2a3 3 0 0 0 3-3V4a1 1 0 0 0-2 0v1a1 1 0 0 1-1 1h-2a5.94 5.94 0 0 0-4.24 1.76L7.41 8.1A4.94 4.94 0 0 0 6 12.73V17a1 1 0 0 0 2 0v-4.27A2.94 2.94 0 0 1 8.6 7.7Z"/></svg>';

export const SUMMARY_ICONS = {
    ascent: ASCENT_ICON,
    descent: DESCENT_ICON,
    distance: DISTANCE_ICON,
    elevation: ELEVATION_ICON,
    slope: SLOPE_ICON,
    time: TIME_ICON,
    trace: ROUTE_ICON,
    difficulty: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 18h3v-4H4v4zm5 0h3v-8H9v8zm5 0h3v-6h-3v6zm5 0h3V6h-3v12z"/></svg>',
    weather: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM19 18H6c-2.21 0-4-1.79-4-4s1.79-4 4-4h.71C7.37 7.69 9.48 6 12 6a5.5 5.5 0 0 1 5.5 5.5v.5H19a3 3 0 0 1 0 6z"/></svg>',
    waypoint: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>'
};

// Inline SVG bivouac icon for elevation chart markers (matches the new tent design)
// Includes white halo/outline for better visibility against any background
export const BIVOUAC_ELEVATION_ICON = `<svg class="elevation-marker__icon" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
  <!-- White halo/outline (drawn first, thicker) -->
  <line x1="44" y1="0" x2="50" y2="12" stroke="rgba(255,255,255,0.95)" stroke-width="12" stroke-linecap="round"/>
  <line x1="56" y1="0" x2="50" y2="12" stroke="rgba(255,255,255,0.95)" stroke-width="12" stroke-linecap="round"/>
  <path d="M50 12 L5 88 L38 88 L50 60 L62 88 L95 88 Z" fill="rgba(255,255,255,0.95)" stroke="rgba(255,255,255,0.95)" stroke-width="8" stroke-linejoin="round"/>
  <line x1="3" y1="93" x2="97" y2="93" stroke="rgba(255,255,255,0.95)" stroke-width="14" stroke-linecap="round"/>
  <!-- Colored icon on top -->
  <line x1="44" y1="0" x2="50" y2="12" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
  <line x1="56" y1="0" x2="50" y2="12" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
  <path d="M50 12 L5 88 L38 88 L50 60 L62 88 L95 88 Z" fill="currentColor"/>
  <line x1="3" y1="93" x2="97" y2="93" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>
</svg>`;

export const DISTANCE_MARKER_PREFIX = 'distance-marker-';
export const DEFAULT_DISTANCE_MARKER_COLOR = '#f38b1c';

export const SEGMENT_MARKER_SOURCE_ID = 'segment-markers';
export const SEGMENT_MARKER_LAYER_ID = 'segment-markers';
export const SEGMENT_MARKER_COLORS = {
    start: '#2f8f3b',
    bivouac: '#2d7bd6',
    end: '#d64545'
};
export const START_MARKER_ICON_ID = 'segment-marker-start';
export const BIVOUAC_MARKER_ICON_ID = 'segment-marker-bivouac';
export const END_MARKER_ICON_ID = 'segment-marker-end';
export const SEGMENT_MARKER_ICONS = {
    start: START_MARKER_ICON_ID,
    bivouac: BIVOUAC_MARKER_ICON_ID,
    end: END_MARKER_ICON_ID
};



export const SEGMENT_COLOR_PALETTE = [
    '#5a8f7b',  // Sage green
    '#b87f5a',  // Terracotta
    '#6b8fa3',  // Slate blue
    '#8b7355',  // Warm brown
    '#7a9e7e',  // Forest green
    '#a8857a',  // Dusty rose
    '#6a8d92',  // Teal gray
    '#9b8567'   // Ochre
];
