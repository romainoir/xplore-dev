/**
 * terrain-analysis-controller.js — Terrain hover info, slope/aspect calculation,
 * analytical legend rendering (aspect compass, slope/snow/shadow-depth gradient bars with sliders).
 */

/**
 * Calculate terrain analysis (slope, aspect, elevation) at a given point.
 * @param {maplibregl.Map} map
 * @param {{ lng: number, lat: number }} lngLat
 * @returns {{ ele: number, slope: number, aspect: number, aspectName: string } | null}
 */
export function calculateTerrainAnalysis(map, lngLat) {
    if (!map || typeof map.queryTerrainElevation !== 'function') return null;
    const ele = map.queryTerrainElevation([lngLat.lng, lngLat.lat]);
    if (ele === null || ele === undefined) return null;
    const d = 0.0001;
    const zN = map.queryTerrainElevation([lngLat.lng, lngLat.lat + d]);
    const zS = map.queryTerrainElevation([lngLat.lng, lngLat.lat - d]);
    const zE = map.queryTerrainElevation([lngLat.lng + d, lngLat.lat]);
    const zW = map.queryTerrainElevation([lngLat.lng - d, lngLat.lat]);
    if (ele === 0 && zN === 0 && zS === 0 && zE === 0 && zW === 0) return null;
    const latRad = lngLat.lat * Math.PI / 180;
    const dy = 2 * d * 111320;
    const dx = 2 * d * 111320 * Math.cos(latRad);
    const dzdx = (zE - zW) / dx;
    const dzdy = (zN - zS) / dy;
    const slopeRad = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
    const slopeDeg = slopeRad * 180 / Math.PI;
    const dx_shader = -dzdx;
    const dy_shader = -dzdy;
    let aspectDeg = (Math.atan2(dx_shader, dy_shader) * 180 / Math.PI + 180) % 360;
    if (aspectDeg < 0) aspectDeg += 360;
    const aspects = ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West', 'North'];
    const aspectName = aspects[Math.round(aspectDeg / 45)];
    return { ele, slope: slopeDeg, aspect: aspectDeg, aspectName };
}

/**
 * Initialize global slope/snow config defaults.
 */
export function initTerrainAnalysisConfig() {
    if (!window.slopeConfig) window.slopeConfig = { min: 0, max: 90 };
    if (!window.snowConfig) window.snowConfig = { altitude: 1000, maxSlope: 40 };
}

/**
 * Render analytical legends for active terrain analysis layers.
 * @param {maplibregl.Map} map
 * @param {Map} imageryState - imagery state map
 * @param {Function} updateShadowTime - callback for shadow time changes
 */
export function updateAnalyticalLegends(map, imageryState, updateShadowTime) {
    const container = document.getElementById('analyticalLegendContainer');
    if (!container) return;
    container.innerHTML = '';

    const activeAnalyzers = [];
    if (imageryState.get('aspect')?.enabled) activeAnalyzers.push('aspect');
    if (imageryState.get('slope')?.enabled) activeAnalyzers.push('slope');
    if (imageryState.get('avalanche')?.enabled) activeAnalyzers.push('avalanche');
    if (imageryState.get('snow')?.enabled) activeAnalyzers.push('snow');
    if (imageryState.get('snow-depth')?.enabled) activeAnalyzers.push('snow-depth');
    if (imageryState.get('shadow')?.enabled) activeAnalyzers.push('shadow');

    if (activeAnalyzers.length === 0) {
        container.style.opacity = '0';
        container.style.pointerEvents = 'none';
        return;
    }
    container.style.opacity = '1';
    container.style.pointerEvents = 'auto';

    activeAnalyzers.forEach(type => {
        const legend = document.createElement('div');
        legend.className = 'analytical-legend';

        if (type === 'aspect') {
            legend.appendChild(createAspectLegend());
        } else if (type === 'slope') {
            legend.appendChild(createSlopeLegend(map));
        } else if (type === 'snow') {
            legend.appendChild(createSnowLegend(map));
        } else if (type === 'snow-depth') {
            legend.appendChild(createSnowDepthLegend());
        } else if (type === 'shadow') {
            legend.appendChild(createShadowLegend(map, updateShadowTime));
        }
        container.appendChild(legend);
    });
}

// ─── Legend builders ───

function createAspectLegend() {
    const content = document.createElement('div');
    content.className = 'analytical-legend__content';
    content.innerHTML = `
    <svg viewBox="0 0 100 100" width="105" height="105" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3))">
      <circle cx="50" cy="50" r="38" fill="rgba(12, 24, 36, 0.4)" stroke="rgba(255,255,255,0.2)" stroke-width="1.5" />
      <g transform="rotate(-90, 50, 50)">
        <path d="M50,50 L85.1,35.5 A38,38 0 0,1 85.1,64.5 Z" fill="#78FFFF" opacity="0.8" />
        <path d="M50,50 L85.1,64.5 A38,38 0 0,1 64.5,85.1 Z" fill="#7AC2FF" opacity="0.8" />
        <path d="M50,50 L64.5,85.1 A38,38 0 0,1 35.5,85.1 Z" fill="#FFFFFF" opacity="0.8" />
        <path d="M50,50 L35.5,85.1 A38,38 0 0,1 14.9,64.5 Z" fill="#FFB285" opacity="0.8" />
        <path d="M50,50 L14.9,64.5 A38,38 0 0,1 14.9,35.5 Z" fill="#FF4C00" opacity="0.8" />
        <path d="M50,50 L14.9,35.5 A38,38 0 0,1 35.5,14.9 Z" fill="#7A2400" opacity="0.8" />
        <path d="M50,50 L35.5,14.9 A38,38 0 0,1 64.5,14.9 Z" fill="#292929" opacity="0.8" />
        <path d="M50,50 L64.5,14.9 A38,38 0 0,1 85.1,35.5 Z" fill="#003678" opacity="0.8" />
      </g>
      <circle cx="50" cy="50" r="3" fill="#fff" />
      <text x="50" y="8" text-anchor="middle" fill="#fff" font-size="9" font-weight="900" style="text-shadow: 0 1px 2px #000">N</text>
      <text x="50" y="98" text-anchor="middle" fill="#fff" font-size="9" font-weight="900" style="text-shadow: 0 1px 2px #000">S</text>
      <text x="94" y="53" text-anchor="middle" fill="#fff" font-size="9" font-weight="900" style="text-shadow: 0 1px 2px #000">E</text>
      <text x="6" y="53" text-anchor="middle" fill="#fff" font-size="9" font-weight="900" style="text-shadow: 0 1px 2px #000">W</text>
    </svg>`;
    return content;
}

function createSlopeLegend(map) {
    const content = document.createElement('div');
    content.className = 'slope-legend__content';
    const barWrapper = document.createElement('div');
    barWrapper.className = 'slope-bar-wrapper';
    barWrapper.innerHTML = `
    <div class="slope-gradient-bar"></div>
    <div class="slope-labels"><span>90°</span><span>45°</span><span>30°</span><span>0°</span></div>
    <div class="slope-range-inputs">
      <input type="range" id="slopeMinSlider" min="0" max="90" step="1" value="${window.slopeConfig.min}">
      <input type="range" id="slopeMaxSlider" min="0" max="90" step="1" value="${window.slopeConfig.max}">
    </div>`;
    content.appendChild(barWrapper);

    const minS = barWrapper.querySelector('#slopeMinSlider');
    const maxS = barWrapper.querySelector('#slopeMaxSlider');
    const updateSlope = (e) => {
        if (e) { minS.style.zIndex = (e.target === minS) ? '3' : '2'; maxS.style.zIndex = (e.target === maxS) ? '3' : '2'; }
        let min = parseInt(minS.value), max = parseInt(maxS.value);
        if (min > max) [min, max] = [max, min];
        window.slopeConfig.min = min; window.slopeConfig.max = max;
        if (map) {
            map.triggerRepaint();
            ['slope-native', 'avalanche-native'].forEach(l => {
                if (map.getLayer(l)) { const ex = map.getPaintProperty(l, 'hillshade-exaggeration') || 1.0; map.setPaintProperty(l, 'hillshade-exaggeration', ex === 1.0 ? 1.00001 : 1.0); }
            });
        }
    };
    minS.addEventListener('input', updateSlope);
    maxS.addEventListener('input', updateSlope);
    [minS, maxS].forEach(el => { el.addEventListener('mousedown', e => e.stopPropagation()); el.addEventListener('touchstart', e => e.stopPropagation()); });
    return content;
}

function createSnowLegend(map) {
    const content = document.createElement('div');
    content.className = 'snow-legend__content';
    const barWrapper = document.createElement('div');
    barWrapper.className = 'snow-bar-wrapper';
    barWrapper.innerHTML = `
    <div class="snow-gradient-bar"></div>
    <div class="snow-labels"><span>5000</span><span>2500</span><span>0</span></div>
    <div class="snow-range-inputs">
      <input type="range" id="snowAltitudeSlider" min="0" max="5000" step="50" value="${window.snowConfig.altitude}">
    </div>`;
    content.appendChild(barWrapper);
    const altS = barWrapper.querySelector('#snowAltitudeSlider');
    const updateAlt = () => {
        window.snowConfig.altitude = parseInt(altS.value);
        window.snowConfig.maxSlope = 40;
        if (map) {
            map.triggerRepaint();
            ['snow-native', 'avalanche-native', 'slope-native'].forEach(l => {
                if (map.getLayer(l)) { const ex = map.getPaintProperty(l, 'hillshade-exaggeration') || 1.0; map.setPaintProperty(l, 'hillshade-exaggeration', ex === 1.0 ? 1.00001 : 1.0); }
            });
        }
    };
    altS.addEventListener('input', updateAlt);
    altS.addEventListener('mousedown', e => e.stopPropagation());
    altS.addEventListener('touchstart', e => e.stopPropagation());
    return content;
}

function createSnowDepthLegend() {
    const content = document.createElement('div');
    content.className = 'snow-depth-legend__content';
    content.innerHTML = `
    <div class="snow-depth-bar"></div>
    <div class="snow-depth-labels">
      <span>0 cm</span><span>1 cm</span><span>20 cm</span><span>40 cm</span>
      <span>60 cm</span><span>80 cm</span><span>100 cm</span><span>150 cm</span>
      <span>200 cm</span><span>300 cm</span><span>500 cm</span>
    </div>`;
    return content;
}

function createShadowLegend(map, updateShadowTime) {
    const content = document.createElement('div');
    content.className = 'shadow-legend__content';

    const now = new Date(window.skySimulationDate || Date.now());
    const startOfYear = new Date(now.getFullYear(), 0, 0);
    const diff = now - startOfYear;
    const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
    const initialMins = now.getHours() * 60 + now.getMinutes();
    const formatDate = (date) => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

    content.innerHTML = `
    <div class="shadow-legend__header">
      <div class="shadow-legend__stats">
        <span id="shadowDateLabel">${formatDate(now)}</span>
        <span class="shadow-legend__separator">•</span>
        <span id="shadowTimeLabel">${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}</span>
      </div>
      <div class="shadow-legend__header-actions">
        <button id="shadowNowBtn" class="shadow-legend__btn-now">Now</button>
        ${window.XploreDebug ? `<button id="shadowDebugTgl" class="shadow-legend__btn-icon shadow-legend__btn-icon--small" title="Settings">⚙️</button>` : ''}
      </div>
    </div>
    <div class="shadow-legend__row"><span class="shadow-legend__row-icon">📅</span><input type="range" id="shadowDateSlider" class="shadow-legend__slider shadow-legend__slider--date" min="1" max="366" value="${dayOfYear}"></div>
    <div class="shadow-legend__row"><span class="shadow-legend__row-icon">🕒</span><input type="range" id="shadowTimeSlider" class="shadow-legend__slider" min="0" max="1440" step="1" value="${initialMins}"></div>
    ${window.XploreDebug ? `
    <div id="shadowDebugMenu" class="shadow-legend__debug-menu" style="display: none;">
      <button id="shdSkyTgl" class="shadow-legend__btn shadow-legend__btn--sky" data-off="${window._skyDisabled}">Sky ${window._skyDisabled ? 'OFF' : 'ON'}</button>
      <div class="shadow-legend__fog-group">
        <div class="shadow-legend__fog-row"><label>Ground</label><input type="range" id="fogGrnd" min="-5" max="5" step="0.1" value="0.1"></div>
        <div class="shadow-legend__fog-row"><label>Horizon</label><input type="range" id="fogHoriz" min="-1" max="5" step="0.1" value="0.5"></div>
      </div>
      <button id="shdDbgTgl" class="shadow-legend__btn shadow-legend__btn--debug" data-off="${!window._shadowDebugMode}">Debug ${window._shadowDebugMode ? 'ON' : 'OFF'}</button>
    </div>` : ''}`;

    // Wire up shadow time sliders
    const dSl = content.querySelector('#shadowDateSlider');
    const dLb = content.querySelector('#shadowDateLabel');
    const tSl = content.querySelector('#shadowTimeSlider');
    const tLb = content.querySelector('#shadowTimeLabel');
    const nBtn = content.querySelector('#shadowNowBtn');

    const updateTimeGradient = (date) => {
        if (!map || !date) return;
        try {
            const center = map.getCenter();
            const times = SunCalc.getTimes(date, center.lat, center.lng);
            const toPct = (d) => ((d.getHours() * 60 + d.getMinutes()) / 1440) * 100;
            const sunrise = toPct(times.sunrise);
            const sunset = toPct(times.sunset);
            const grad = `linear-gradient(to right, #1a1a2e 0%, #1a1a2e ${sunrise - 5}%, #f39c12 ${sunrise}%, #87ceeb ${sunrise + 5}%, #87ceeb ${sunset - 5}%, #f39c12 ${sunset}%, #1a1a2e ${sunset + 5}%, #1a1a2e 100%)`;
            if (tSl) tSl.style.background = grad;
        } catch (_) { }
    };

    const buildDate = () => {
        const year = new Date().getFullYear();
        const dayVal = parseInt(dSl?.value ?? dayOfYear);
        const minVal = parseInt(tSl?.value ?? initialMins);
        const d = new Date(year, 0, dayVal);
        d.setHours(0, minVal, 0, 0);
        return d;
    };

    const syncUi = () => {
        const d = buildDate();
        if (dLb) dLb.textContent = formatDate(d);
        if (tLb) tLb.textContent = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        updateTimeGradient(d);
        if (updateShadowTime) updateShadowTime(d);
    };

    if (dSl) { dSl.addEventListener('input', syncUi); dSl.addEventListener('mousedown', e => e.stopPropagation()); dSl.addEventListener('touchstart', e => e.stopPropagation()); }
    if (tSl) { tSl.addEventListener('input', syncUi); tSl.addEventListener('mousedown', e => e.stopPropagation()); tSl.addEventListener('touchstart', e => e.stopPropagation()); }
    if (nBtn) { nBtn.addEventListener('click', () => { const now = new Date(); const soy = new Date(now.getFullYear(), 0, 0); const dy = Math.floor((now - soy) / 864e5); if (dSl) dSl.value = String(dy); if (tSl) tSl.value = String(now.getHours() * 60 + now.getMinutes()); syncUi(); }); }

    // Debug menu wiring
    const debugTgl = content.querySelector('#shadowDebugTgl');
    const debugMenu = content.querySelector('#shadowDebugMenu');
    if (debugTgl && debugMenu) {
        debugTgl.addEventListener('click', () => { debugMenu.style.display = debugMenu.style.display === 'none' ? 'block' : 'none'; });
    }
    const skyTgl = content.querySelector('#shdSkyTgl');
    if (skyTgl) {
        skyTgl.addEventListener('click', () => {
            window._skyDisabled = !window._skyDisabled;
            skyTgl.dataset.off = String(window._skyDisabled);
            skyTgl.textContent = `Sky ${window._skyDisabled ? 'OFF' : 'ON'}`;
            if (map) map.triggerRepaint();
        });
    }
    const dbgTgl = content.querySelector('#shdDbgTgl');
    if (dbgTgl) {
        dbgTgl.addEventListener('click', () => {
            window._shadowDebugMode = !window._shadowDebugMode;
            dbgTgl.dataset.off = String(!window._shadowDebugMode);
            dbgTgl.textContent = `Debug ${window._shadowDebugMode ? 'ON' : 'OFF'}`;
            if (map) map.triggerRepaint();
        });
    }
    const fogGrnd = content.querySelector('#fogGrnd');
    const fogHoriz = content.querySelector('#fogHoriz');
    if (fogGrnd) {
        fogGrnd.addEventListener('input', () => { if (map?.setFog) map.setFog({ 'ground-radial-range': [parseFloat(fogGrnd.value), 5] }); });
        fogGrnd.addEventListener('mousedown', e => e.stopPropagation());
    }
    if (fogHoriz) {
        fogHoriz.addEventListener('input', () => { if (map?.setFog) map.setFog({ 'horizon-blend': parseFloat(fogHoriz.value) }); });
        fogHoriz.addEventListener('mousedown', e => e.stopPropagation());
    }

    // Initial gradient
    updateTimeGradient(now);

    return content;
}

/**
 * Setup terrain hover (mousemove) tooltip showing elevation, slope, aspect.
 * @param {maplibregl.Map} map
 */
export function setupTerrainHoverInfo(map) {
    const hoverEl = document.getElementById('terrainHoverInfo');
    if (!hoverEl) return;
    const hoverEle = hoverEl.querySelector('.terrain-hover__ele');
    const hoverSlope = hoverEl.querySelector('.terrain-hover__slope');
    const hoverAspect = hoverEl.querySelector('.terrain-hover__aspect');

    let isVisible = false;
    const show = (data) => {
        if (!data) { hide(); return; }
        if (hoverEle) hoverEle.textContent = `${Math.round(data.ele)} m`;
        if (hoverSlope) hoverSlope.textContent = `${data.slope.toFixed(1)}°`;
        if (hoverAspect) hoverAspect.textContent = `${data.aspectName} (${Math.round(data.aspect)}°)`;
        if (!isVisible) { hoverEl.style.opacity = '1'; hoverEl.style.pointerEvents = 'auto'; isVisible = true; }
    };
    const hide = () => {
        if (isVisible) { hoverEl.style.opacity = '0'; hoverEl.style.pointerEvents = 'none'; isVisible = false; }
    };

    let throttleTimer = null;
    map.on('mousemove', (e) => {
        if (throttleTimer) return;
        throttleTimer = setTimeout(() => { throttleTimer = null; }, 60);
        const data = calculateTerrainAnalysis(map, e.lngLat);
        if (data) show(data); else hide();
    });
    map.on('mouseout', hide);
}
