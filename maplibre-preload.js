(function (global) {
  const DEFAULTS = {
    text: 'Loading map…',
    logoSrc: null,
    logoAlt: '',
    background: 'linear-gradient(135deg, #0b1620 0%, #0d2433 50%, #0e1b29 100%)',
    minDuration: 500,
    transitionFallback: 600,
    timeout: 15000
  };

  function createOverlay(map, options) {
    const container = map && typeof map.getContainer === 'function' ? map.getContainer() : null;
    if (!container) throw new Error('maplibre-preload requires a valid MapLibre GL JS map instance.');

    const overlay = document.createElement('div');
    overlay.className = 'maplibre-preload';
    if (options.background) overlay.style.background = options.background;

    const content = document.createElement('div');
    content.className = 'maplibre-preload__content';

    if (typeof options.logoSrc === 'string' && options.logoSrc.trim().length) {
      const logoWrapper = document.createElement('div');
      logoWrapper.className = 'maplibre-preload__logo';

      const logo = document.createElement('img');
      logo.src = options.logoSrc;
      logo.alt = options.logoAlt || '';
      logo.loading = 'eager';
      logo.decoding = 'async';

      logoWrapper.appendChild(logo);
      content.appendChild(logoWrapper);
    }

    if (options.text) {
      const text = document.createElement('div');
      text.className = 'maplibre-preload__text';
      text.textContent = options.text;
      content.appendChild(text);
    }

    overlay.appendChild(content);
    container.appendChild(overlay);
    return overlay;
  }

  class MaplibrePreload {
    constructor(map, opts = {}) {
      if (!map || typeof map.once !== 'function') {
        throw new Error('maplibre-preload requires a MapLibre GL JS map instance.');
      }

      this.map = map;
      this.options = Object.assign({}, DEFAULTS, opts);
      this.overlay = createOverlay(map, this.options);
      this.startTime = performance.now();
      this.hidden = false;

      this.handleIdle = this.handleIdle.bind(this);
      this.handleRemove = this.handleRemove.bind(this);
      this.handleError = this.handleError.bind(this);
      this.cleanupOverlay = this.cleanupOverlay.bind(this);

      this.map.once('load', () => {
        if (this.hidden) return;
        this.map.once('idle', this.handleIdle);
      });

      if (this.map.loaded()) {
        this.map.once('idle', this.handleIdle);
      }

      this.map.on('remove', this.handleRemove);
      this.map.on('error', this.handleError);

      if (this.options.timeout > 0) {
        this.timeoutId = window.setTimeout(() => this.hide(), this.options.timeout);
      }
    }

    handleIdle() {
      this.hide();
    }

    handleError() {
      this.hide();
    }

    handleRemove() {
      this.hide(true);
    }

    hide(force = false) {
      if (this.hidden) return;
      this.hidden = true;

      if (this.timeoutId) {
        window.clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }

      this.map.off('idle', this.handleIdle);
      this.map.off('remove', this.handleRemove);
      this.map.off('error', this.handleError);

      const finalize = () => {
        if (!this.overlay) return;
        this.overlay.removeEventListener('transitionend', finalize);
        this.cleanupOverlay();
      };

      if (force) {
        finalize();
        return;
      }

      const elapsed = performance.now() - this.startTime;
      const delay = Math.max(this.options.minDuration - elapsed, 0);

      window.setTimeout(() => {
        if (!this.overlay) return;
        this.overlay.classList.add('maplibre-preload--hidden');
        this.overlay.addEventListener('transitionend', finalize, { once: true });
        this.fallbackTimer = window.setTimeout(finalize, this.options.transitionFallback);
      }, delay);
    }

    cleanupOverlay() {
      if (this.fallbackTimer) {
        window.clearTimeout(this.fallbackTimer);
        this.fallbackTimer = null;
      }

      if (this.overlay && this.overlay.parentNode) {
        this.overlay.parentNode.removeChild(this.overlay);
      }
      this.overlay = null;
    }
  }

  function maplibrePreload(map, options) {
    return new MaplibrePreload(map, options);
  }

  global.MaplibrePreload = MaplibrePreload;
  global.maplibrePreload = maplibrePreload;
})(typeof window !== 'undefined' ? window : globalThis);
