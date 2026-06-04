/**
 * Lightweight runtime performance audit for XploreMap.
 *
 * Enable with `?perf=1` or:
 *   localStorage.setItem('xplore_perf_enabled', 'true')
 *   localStorage.setItem('xplore_perf_collect_resource_timing', 'true')
 */

const PERF_ENABLED_STORAGE_KEY = 'xplore_perf_enabled';
const PERF_RESOURCE_TIMING_STORAGE_KEY = 'xplore_perf_collect_resource_timing';
const PERF_PANEL_STORAGE_KEY = 'xplore_perf_panel';
const WORKER_AUDIT_KEY = '__xploreWorkerAudit';
const MAX_RING_EVENTS = 2000;
const MAX_SAMPLE_COUNT = 600;

const MAPLIBRE_MESSAGE_LABELS = Object.freeze({
    LDT: 'loadDEMTile',
    GCEZ: 'getClusterExpansionZoom',
    GCC: 'getClusterChildren',
    GCL: 'getClusterLeaves',
    LD: 'loadData',
    LT: 'loadTile',
    RT: 'reloadTile',
    GG: 'getGlyphs',
    GDA: 'getDashes',
    GI: 'getImages',
    SI: 'setImages',
    UGS: 'updateGlobalState',
    SL: 'setLayers',
    UL: 'updateLayers',
    SRPS: 'syncRTLPluginState',
    SR: 'setReferrer',
    RS: 'removeSource',
    RM: 'removeMap',
    IS: 'importScript',
    RMT: 'removeTile',
    AT: 'abortTile',
    RDT: 'removeDEMTile',
    GR: 'getResource',
});

function readBoolStorage(key, fallback = false) {
    try {
        const value = localStorage.getItem(key);
        if (value === null) return fallback;
        return value === 'true' || value === '1' || value === 'yes' || value === 'on';
    } catch (_) {
        return fallback;
    }
}

function hasPerfQueryFlag() {
    try {
        const value = new URLSearchParams(window.location.search).get('perf');
        if (value === null) return false;
        return value === '' || value === '1' || value === 'true' || value === 'yes' || value === 'on';
    } catch (_) {
        return false;
    }
}

export function shouldAutoStartPerformanceAudit() {
    return hasPerfQueryFlag() || readBoolStorage(PERF_ENABLED_STORAGE_KEY, false);
}

export function shouldCollectMapResourceTiming() {
    return shouldAutoStartPerformanceAudit() || readBoolStorage(PERF_RESOURCE_TIMING_STORAGE_KEY, false);
}

function nowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function createRing(limit = MAX_RING_EVENTS) {
    const values = [];
    return {
        push(value) {
            values.push(value);
            if (values.length > limit) values.shift();
        },
        clear() {
            values.length = 0;
        },
        values() {
            return values.slice();
        },
        get length() {
            return values.length;
        }
    };
}

function pushLimited(values, value, limit = MAX_SAMPLE_COUNT) {
    values.push(value);
    if (values.length > limit) values.shift();
}

function percentile(values, ratio) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
    return sorted[index];
}

function summarizeSamples(values) {
    if (!values.length) return { count: 0, avg: 0, p50: 0, p95: 0, p99: 0, max: 0 };
    const total = values.reduce((sum, value) => sum + value, 0);
    return {
        count: values.length,
        avg: total / values.length,
        p50: percentile(values, 0.50),
        p95: percentile(values, 0.95),
        p99: percentile(values, 0.99),
        max: Math.max(...values),
    };
}

function formatMs(value) {
    return `${Number(value || 0).toFixed(1)}ms`;
}

function formatRate(value) {
    return Number(value || 0).toFixed(1);
}

function classifyUrl(url = '') {
    const value = String(url || '');
    if (!value) return 'unknown';
    if (value.includes('mapterhorn') || value.includes('terrarium')) return 'dem';
    if (value.includes('ign.fr') || value.includes('wxs.ign') || value.includes('geoportail')) return 'ign';
    if (value.includes('openfreemap') || value.includes('.pmtiles')) return 'vector';
    if (value.includes('wikimedia') || value.includes('commons')) return 'photos';
    try {
        return new URL(value, window.location.href).hostname || 'resource';
    } catch (_) {
        return 'resource';
    }
}

function describeWorkerUrl(url) {
    const value = String(url || '');
    if (!value) return 'worker';
    if (value.includes('maplibre') || value.startsWith('blob:')) return 'maplibre';
    if (value.includes('photo-thumbnail-worker')) return 'photo-thumbnails';
    return value.split('/').pop() || value;
}

function labelWorkerMessage(type) {
    if (!type) return 'unknown';
    return MAPLIBRE_MESSAGE_LABELS[type] || String(type);
}

function estimatePayloadBytes(value, depth = 0, seen = new WeakSet()) {
    if (value == null) return 0;
    const type = typeof value;
    if (type === 'string') return value.length * 2;
    if (type === 'number' || type === 'boolean') return 8;
    if (type !== 'object') return 0;
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    if (value instanceof Blob) return value.size;
    if (seen.has(value) || depth > 3) return 0;
    seen.add(value);
    if (Array.isArray(value)) {
        return value.slice(0, 40).reduce((sum, item) => sum + estimatePayloadBytes(item, depth + 1, seen), 0);
    }
    let total = 0;
    let count = 0;
    for (const [key, item] of Object.entries(value)) {
        total += key.length * 2 + estimatePayloadBytes(item, depth + 1, seen);
        count += 1;
        if (count >= 40) break;
    }
    return total;
}

function getWorkerAuditState() {
    if (typeof window === 'undefined') return null;
    if (!window[WORKER_AUDIT_KEY]) {
        window[WORKER_AUDIT_KEY] = {
            installed: false,
            nextId: 1,
            workers: new Map(),
            events: createRing(MAX_RING_EVENTS),
            totals: {
                created: 0,
                terminated: 0,
                messagesToWorker: 0,
                messagesFromWorker: 0,
                bytesToWorker: 0,
                bytesFromWorker: 0,
            },
        };
    }
    return window[WORKER_AUDIT_KEY];
}

function resetWorkerAuditCounters() {
    const state = getWorkerAuditState();
    if (!state) return;
    state.events.clear();
    state.totals = {
        created: state.workers.size,
        terminated: 0,
        messagesToWorker: 0,
        messagesFromWorker: 0,
        bytesToWorker: 0,
        bytesFromWorker: 0,
    };
    for (const info of state.workers.values()) {
        info.messagesToWorker = 0;
        info.messagesFromWorker = 0;
        info.bytesToWorker = 0;
        info.bytesFromWorker = 0;
        info.pending.clear();
        info.byType.clear();
        info.roundTrips.length = 0;
    }
}

function recordWorkerEvent(info, direction, message, sizeBytes) {
    const state = getWorkerAuditState();
    if (!state || !info) return;
    const rawType = message?.type || message?.data?.type || 'unknown';
    const type = labelWorkerMessage(rawType);
    const timestamp = nowMs();
    const id = message?.id || message?.data?.id || null;
    let roundTripMs = null;
    let attributedType = type;

    if (direction === 'to-worker' && id) {
        info.pending.set(id, { type, timestamp, sizeBytes });
    } else if (direction === 'from-worker' && id) {
        const pending = info.pending.get(id);
        if (pending) {
            info.pending.delete(id);
            roundTripMs = timestamp - pending.timestamp;
            attributedType = pending.type === 'unknown' ? type : pending.type;
            pushLimited(info.roundTrips, roundTripMs, MAX_SAMPLE_COUNT);
            const typeStats = info.byType.get(attributedType) || {
                count: 0,
                totalRoundTripMs: 0,
                roundTrips: [],
                bytesToWorker: 0,
                bytesFromWorker: 0,
            };
            typeStats.count += 1;
            typeStats.totalRoundTripMs += roundTripMs;
            typeStats.bytesToWorker += pending.sizeBytes || 0;
            typeStats.bytesFromWorker += sizeBytes || 0;
            pushLimited(typeStats.roundTrips, roundTripMs, MAX_SAMPLE_COUNT);
            info.byType.set(attributedType, typeStats);
        }
    }

    if (direction === 'to-worker') {
        info.messagesToWorker += 1;
        info.bytesToWorker += sizeBytes;
        state.totals.messagesToWorker += 1;
        state.totals.bytesToWorker += sizeBytes;
    } else {
        info.messagesFromWorker += 1;
        info.bytesFromWorker += sizeBytes;
        state.totals.messagesFromWorker += 1;
        state.totals.bytesFromWorker += sizeBytes;
    }

    state.events.push({
        timestamp,
        workerId: info.id,
        workerKind: info.kind,
        direction,
        type: attributedType,
        sizeBytes,
        roundTripMs,
    });
}

export function installWorkerAudit() {
    if (typeof window === 'undefined' || typeof window.Worker !== 'function') return null;
    const state = getWorkerAuditState();
    if (!state || state.installed) return state;

    const NativeWorker = window.Worker;
    function InstrumentedWorker(scriptURL, options) {
        const worker = new NativeWorker(scriptURL, options);
        const id = state.nextId++;
        const url = typeof scriptURL === 'string' ? scriptURL : String(scriptURL);
        const info = {
            id,
            url,
            kind: describeWorkerUrl(url),
            createdAt: nowMs(),
            terminatedAt: null,
            messagesToWorker: 0,
            messagesFromWorker: 0,
            bytesToWorker: 0,
            bytesFromWorker: 0,
            pending: new Map(),
            byType: new Map(),
            roundTrips: [],
        };
        state.workers.set(id, info);
        state.totals.created += 1;

        const originalPostMessage = worker.postMessage.bind(worker);
        worker.postMessage = function instrumentedPostMessage(message, transfer) {
            recordWorkerEvent(info, 'to-worker', message, estimatePayloadBytes(message));
            return originalPostMessage(message, transfer);
        };

        const originalTerminate = typeof worker.terminate === 'function' ? worker.terminate.bind(worker) : null;
        if (originalTerminate) {
            worker.terminate = function instrumentedTerminate() {
                info.terminatedAt = nowMs();
                state.totals.terminated += 1;
                return originalTerminate();
            };
        }

        worker.addEventListener('message', (event) => {
            recordWorkerEvent(info, 'from-worker', event.data, estimatePayloadBytes(event.data));
        });
        worker.addEventListener('error', (event) => {
            state.events.push({
                timestamp: nowMs(),
                workerId: info.id,
                workerKind: info.kind,
                direction: 'error',
                type: event?.message || 'worker-error',
                sizeBytes: 0,
                roundTripMs: null,
            });
        });

        return worker;
    }
    Object.setPrototypeOf(InstrumentedWorker, NativeWorker);
    InstrumentedWorker.prototype = NativeWorker.prototype;
    InstrumentedWorker.__xploreNativeWorker = NativeWorker;
    window.Worker = InstrumentedWorker;
    state.installed = true;
    state.nativeWorker = NativeWorker;
    return state;
}

class XplorePerformanceAudit {
    constructor(map, options = {}) {
        this.map = map;
        this.options = options;
        this.running = false;
        this.startedAt = 0;
        this.stoppedAt = 0;
        this.frameSamples = [];
        this.renderIntervals = [];
        this.longFrames = [];
        this.longTasks = [];
        this.longAnimationFrames = [];
        this.dataEvents = createRing(MAX_RING_EVENTS);
        this.resourceEvents = createRing(MAX_RING_EVENTS);
        this.events = createRing(MAX_RING_EVENTS);
        this.marks = [];
        this.timings = new Map();
        this.layerTimings = new Map();
        this.glStats = {
            drawCalls: 0,
            drawElements: 0,
            drawArrays: 0,
            textureUploads: 0,
            framebufferAttachments: 0,
            useProgram: 0,
            bindTexture: 0,
        };
        this.glFrameSamples = [];
        this.patchRestorers = [];
        this.eventUnsubscribers = [];
        this.observers = [];
        this.panel = null;
        this.panelBody = null;
        this.panelTimer = null;
        this.rafId = null;
        this.lastFrameAt = 0;
        this.lastRenderAt = 0;
        this.previousRepaint = null;
        this.previousGlSnapshot = { ...this.glStats };
        this.glEnabled = false;
    }

    start(config = {}) {
        if (this.running) return this.snapshot();
        this.clear();
        this.running = true;
        this.startedAt = nowMs();
        this.stoppedAt = 0;
        this.previousRepaint = this.map?.repaint;

        const repaint = config.repaint ?? true;
        if (this.map && repaint) this.map.repaint = true;

        this.installMapListeners();
        this.installObservers();
        this.patchTargets();
        this.glEnabled = config.gl === true;
        if (this.glEnabled) this.patchWebGL();
        this.startRafLoop();

        const showPanel = config.panel ?? readBoolStorage(PERF_PANEL_STORAGE_KEY, true);
        if (showPanel) this.showPanel();

        const durationMs = Number(config.durationMs || 0);
        if (durationMs > 0) {
            window.setTimeout(() => this.stop(), durationMs);
        }

        this.recordEvent('audit', 'start', { repaint });
        return this.snapshot();
    }

    stop() {
        if (!this.running) return this.snapshot();
        this.running = false;
        this.stoppedAt = nowMs();
        if (this.map && this.previousRepaint !== null) this.map.repaint = this.previousRepaint;
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.eventUnsubscribers.forEach((unsubscribe) => unsubscribe());
        this.eventUnsubscribers = [];
        this.observers.forEach((observer) => {
            try { observer.disconnect(); } catch (_) { }
        });
        this.observers = [];
        this.patchRestorers.forEach((restore) => restore());
        this.patchRestorers = [];
        if (this.panelTimer) {
            window.clearInterval(this.panelTimer);
            this.panelTimer = null;
        }
        this.recordEvent('audit', 'stop', {});
        this.renderPanel();
        return this.snapshot();
    }

    clear() {
        this.frameSamples.length = 0;
        this.renderIntervals.length = 0;
        this.longFrames.length = 0;
        this.longTasks.length = 0;
        this.longAnimationFrames.length = 0;
        this.dataEvents.clear();
        this.resourceEvents.clear();
        this.events.clear();
        resetWorkerAuditCounters();
        this.marks.length = 0;
        this.timings.clear();
        this.layerTimings.clear();
        this.glStats = {
            drawCalls: 0,
            drawElements: 0,
            drawArrays: 0,
            textureUploads: 0,
            framebufferAttachments: 0,
            useProgram: 0,
            bindTexture: 0,
        };
        this.glFrameSamples.length = 0;
        this.previousGlSnapshot = { ...this.glStats };
        this.lastFrameAt = 0;
        this.lastRenderAt = 0;
    }

    mark(label = 'mark') {
        const camera = this.map ? {
            center: this.map.getCenter?.()?.toArray?.() || null,
            zoom: this.map.getZoom?.() ?? null,
            pitch: this.map.getPitch?.() ?? null,
            bearing: this.map.getBearing?.() ?? null,
        } : null;
        const entry = { label, timestamp: nowMs(), camera };
        this.marks.push(entry);
        this.recordEvent('mark', label, camera);
        return entry;
    }

    installMapListeners() {
        if (!this.map || typeof this.map.on !== 'function') return;
        const bind = (type, handler) => {
            this.map.on(type, handler);
            this.eventUnsubscribers.push(() => this.map.off(type, handler));
        };
        bind('render', () => {
            const now = nowMs();
            if (this.lastRenderAt) pushLimited(this.renderIntervals, now - this.lastRenderAt, MAX_SAMPLE_COUNT);
            this.lastRenderAt = now;
        });
        bind('data', (event) => this.recordDataEvent('data', event));
        bind('sourcedata', (event) => this.recordDataEvent('sourcedata', event));
        bind('styledata', (event) => this.recordDataEvent('styledata', event));
        bind('idle', () => this.recordEvent('map', 'idle', {}));
        bind('error', (event) => this.recordEvent('map', 'error', { error: String(event?.error || event || '') }));
        bind('style.load', () => {
            this.recordEvent('map', 'style.load', {});
            this.patchTargets();
        });
    }

    installObservers() {
        if (typeof PerformanceObserver !== 'function') return;
        const observe = (type, callback) => {
            try {
                const observer = new PerformanceObserver((list) => callback(list.getEntries()));
                observer.observe({ type, buffered: true });
                this.observers.push(observer);
            } catch (_) { }
        };
        observe('longtask', (entries) => {
            entries.forEach((entry) => {
                if (entry.startTime < this.startedAt) return;
                const item = {
                    timestamp: entry.startTime,
                    durationMs: entry.duration,
                    name: entry.name,
                    attribution: Array.from(entry.attribution || []).map((a) => ({
                        name: a.name,
                        entryType: a.entryType,
                        containerType: a.containerType,
                    })),
                };
                this.longTasks.push(item);
                this.recordEvent('longtask', entry.name || 'longtask', { durationMs: entry.duration });
            });
        });
        observe('long-animation-frame', (entries) => {
            entries.forEach((entry) => {
                if (entry.startTime < this.startedAt) return;
                this.longAnimationFrames.push({
                    timestamp: entry.startTime,
                    durationMs: entry.duration,
                    blockingDuration: entry.blockingDuration,
                    renderStart: entry.renderStart,
                    styleAndLayoutStart: entry.styleAndLayoutStart,
                    scripts: Array.from(entry.scripts || []).slice(0, 8).map((script) => ({
                        duration: script.duration,
                        sourceURL: script.sourceURL,
                        invoker: script.invoker,
                    })),
                });
            });
        });
        observe('resource', (entries) => {
            entries.forEach((entry) => {
                if (!entry.name) return;
                if (entry.startTime < this.startedAt) return;
                this.resourceEvents.push({
                    timestamp: entry.startTime,
                    name: entry.name,
                    kind: classifyUrl(entry.name),
                    initiatorType: entry.initiatorType,
                    durationMs: entry.duration,
                    transferSize: entry.transferSize || 0,
                    encodedBodySize: entry.encodedBodySize || 0,
                    decodedBodySize: entry.decodedBodySize || 0,
                });
            });
        });
    }

    startRafLoop() {
        const tick = (timestamp) => {
            if (!this.running) return;
            if (this.lastFrameAt) {
                const delta = timestamp - this.lastFrameAt;
                pushLimited(this.frameSamples, delta, MAX_SAMPLE_COUNT);
                if (delta > 33.4) {
                    const entry = { timestamp, deltaMs: delta };
                    this.longFrames.push(entry);
                    this.recordEvent('frame', 'slow-frame', entry);
                }
                this.recordGlFrame();
            }
            this.lastFrameAt = timestamp;
            this.rafId = requestAnimationFrame(tick);
        };
        this.rafId = requestAnimationFrame(tick);
    }

    recordGlFrame() {
        const current = { ...this.glStats };
        const previous = this.previousGlSnapshot || current;
        const sample = {
            drawCalls: current.drawCalls - previous.drawCalls,
            drawElements: current.drawElements - previous.drawElements,
            drawArrays: current.drawArrays - previous.drawArrays,
            textureUploads: current.textureUploads - previous.textureUploads,
            framebufferAttachments: current.framebufferAttachments - previous.framebufferAttachments,
            useProgram: current.useProgram - previous.useProgram,
            bindTexture: current.bindTexture - previous.bindTexture,
        };
        pushLimited(this.glFrameSamples, sample, MAX_SAMPLE_COUNT);
        this.previousGlSnapshot = current;
    }

    patchTargets() {
        this.patchMethod(this.map, '_render', 'map._render');
        this.patchMethod(this.map?.painter, 'render', 'painter.render');
        this.patchMethod(this.map?.style, 'update', 'style.update');
        this.patchMethod(this.map?.style, '_updateSources', 'style._updateSources');
        this.patchMethod(this.map?.style, '_updatePlacement', 'style._updatePlacement');
        this.patchMethod(this.map?.terrain?.tileManager, 'update', 'terrain.tileManager.update');
        this.patchMethod(this.map?.terrain?.tileManager, 'getRenderableTiles', 'terrain.tileManager.getRenderableTiles');
        this.patchMethod(this.map?.terrain?.tileManager, 'getTerrainCoords', 'terrain.tileManager.getTerrainCoords');
        Object.entries(this.map?.style?.tileManagers || {}).forEach(([sourceId, tileManager]) => {
            this.patchMethod(tileManager, 'getVisibleCoordinates', `tileManager.${sourceId}.getVisibleCoordinates`);
        });
        this.patchMethod(this.map?.painter?.renderToTexture, 'prepareForRender', 'renderToTexture.prepare');
        this.patchMethod(this.map?.painter?.renderToTexture, 'renderLayer', 'renderToTexture.renderLayer');
        this.patchMethod(this.map?.painter?.renderToTexture, '_renderStack', 'renderToTexture._renderStack');
        this.patchRenderLayer(this.map?.painter);
    }

    patchMethod(target, methodName, label) {
        if (!target || typeof target[methodName] !== 'function') return;
        const original = target[methodName];
        if (original.__xplorePerfWrapped) return;
        const audit = this;
        const wrapped = function wrappedForPerfAudit(...args) {
            const start = nowMs();
            try {
                return original.apply(this, args);
            } finally {
                audit.recordTiming(label, nowMs() - start);
            }
        };
        wrapped.__xplorePerfWrapped = true;
        wrapped.__xplorePerfOriginal = original;
        target[methodName] = wrapped;
        this.patchRestorers.push(() => {
            if (target[methodName] === wrapped) target[methodName] = original;
        });
    }

    patchRenderLayer(painter) {
        if (!painter || typeof painter.renderLayer !== 'function') return;
        const original = painter.renderLayer;
        if (original.__xplorePerfWrapped) return;
        const audit = this;
        const wrapped = function wrappedRenderLayerForPerfAudit(painterArg, tileManager, layer, coords, renderOptions) {
            const start = nowMs();
            const pass = renderOptions?.isRenderingToTexture
                ? 'rtt'
                : (this.renderPass || 'main');
            const layerId = layer?.id || 'unknown';
            const layerType = layer?.type || 'unknown';
            const coordCount = Array.isArray(coords) ? coords.length : 0;
            try {
                return original.apply(this, arguments);
            } finally {
                audit.recordLayerTiming(`${pass}:${layerId}`, layerId, layerType, pass, coordCount, nowMs() - start);
            }
        };
        wrapped.__xplorePerfWrapped = true;
        wrapped.__xplorePerfOriginal = original;
        painter.renderLayer = wrapped;
        this.patchRestorers.push(() => {
            if (painter.renderLayer === wrapped) painter.renderLayer = original;
        });
    }

    recordLayerTiming(key, layerId, layerType, pass, coordCount, durationMs) {
        const stats = this.layerTimings.get(key) || {
            key,
            layerId,
            layerType,
            pass,
            count: 0,
            totalMs: 0,
            maxMs: 0,
            totalCoords: 0,
            samples: [],
        };
        stats.count += 1;
        stats.totalMs += durationMs;
        stats.maxMs = Math.max(stats.maxMs, durationMs);
        stats.totalCoords += coordCount || 0;
        pushLimited(stats.samples, durationMs, MAX_SAMPLE_COUNT);
        this.layerTimings.set(key, stats);
    }

    patchWebGL() {
        const gl = this.map?.painter?.context?.gl || this.map?.getCanvas?.()?.getContext?.('webgl2') || this.map?.getCanvas?.()?.getContext?.('webgl');
        if (!gl || gl.__xplorePerfGlWrapped) return;
        const wrapGl = (name, counter, increment = 1) => {
            if (typeof gl[name] !== 'function') return;
            const original = gl[name].bind(gl);
            const audit = this;
            gl[name] = function wrappedGlCall(...args) {
                audit.glStats[counter] += increment;
                return original(...args);
            };
            this.patchRestorers.push(() => {
                gl[name] = original;
            });
        };
        wrapGl('drawElements', 'drawElements');
        wrapGl('drawArrays', 'drawArrays');
        wrapGl('texImage2D', 'textureUploads');
        wrapGl('texSubImage2D', 'textureUploads');
        wrapGl('framebufferTexture2D', 'framebufferAttachments');
        wrapGl('useProgram', 'useProgram');
        wrapGl('bindTexture', 'bindTexture');
        const originalDrawElements = gl.drawElements;
        const originalDrawArrays = gl.drawArrays;
        gl.drawElements = (...args) => {
            this.glStats.drawCalls += 1;
            return originalDrawElements(...args);
        };
        gl.drawArrays = (...args) => {
            this.glStats.drawCalls += 1;
            return originalDrawArrays(...args);
        };
        gl.__xplorePerfGlWrapped = true;
        this.patchRestorers.push(() => {
            delete gl.__xplorePerfGlWrapped;
        });
    }

    recordTiming(label, durationMs) {
        const stats = this.timings.get(label) || {
            count: 0,
            totalMs: 0,
            maxMs: 0,
            samples: [],
        };
        stats.count += 1;
        stats.totalMs += durationMs;
        stats.maxMs = Math.max(stats.maxMs, durationMs);
        pushLimited(stats.samples, durationMs, MAX_SAMPLE_COUNT);
        this.timings.set(label, stats);
    }

    recordDataEvent(type, event) {
        const resourceTiming = Array.isArray(event?.resourceTiming) ? event.resourceTiming : [];
        const entry = {
            timestamp: nowMs(),
            type,
            dataType: event?.dataType || null,
            sourceId: event?.sourceId || event?.source?.id || null,
            sourceDataType: event?.sourceDataType || null,
            isSourceLoaded: event?.isSourceLoaded ?? null,
            tile: event?.tile?.tileID?.canonical || event?.coord?.canonical || null,
            resourceTimingCount: resourceTiming.length,
            resourceTimingMs: resourceTiming.reduce((sum, item) => sum + (item.duration || 0), 0),
        };
        this.dataEvents.push(entry);
    }

    recordEvent(category, name, detail = {}) {
        this.events.push({
            timestamp: nowMs(),
            category,
            name,
            detail,
        });
    }

    summarizeTimings() {
        const out = {};
        for (const [label, stats] of this.timings.entries()) {
            const summary = summarizeSamples(stats.samples);
            out[label] = {
                count: stats.count,
                totalMs: stats.totalMs,
                avgMs: stats.count ? stats.totalMs / stats.count : 0,
                p95Ms: summary.p95,
                p99Ms: summary.p99,
                maxMs: stats.maxMs,
            };
        }
        return out;
    }

    summarizeLayerTimings() {
        return Array.from(this.layerTimings.values())
            .map((stats) => {
                const summary = summarizeSamples(stats.samples);
                return {
                    key: stats.key,
                    layerId: stats.layerId,
                    layerType: stats.layerType,
                    pass: stats.pass,
                    count: stats.count,
                    totalMs: stats.totalMs,
                    avgMs: stats.count ? stats.totalMs / stats.count : 0,
                    p95Ms: summary.p95,
                    maxMs: stats.maxMs,
                    avgCoords: stats.count ? stats.totalCoords / stats.count : 0,
                };
            })
            .sort((a, b) => b.totalMs - a.totalMs);
    }

    summarizeGl() {
        const get = (key) => summarizeSamples(this.glFrameSamples.map((sample) => sample[key] || 0));
        return {
            drawCallsPerFrame: get('drawCalls'),
            drawElementsPerFrame: get('drawElements'),
            drawArraysPerFrame: get('drawArrays'),
            textureUploadsPerFrame: get('textureUploads'),
            framebufferAttachmentsPerFrame: get('framebufferAttachments'),
            useProgramPerFrame: get('useProgram'),
            bindTexturePerFrame: get('bindTexture'),
            totals: { ...this.glStats },
        };
    }

    summarizeWorkers() {
        const state = getWorkerAuditState();
        if (!state) return { totals: {}, workers: [] };
        const workers = Array.from(state.workers.values()).map((info) => {
            const byType = {};
            for (const [type, stats] of info.byType.entries()) {
                const summary = summarizeSamples(stats.roundTrips);
                byType[type] = {
                    count: stats.count,
                    avgRoundTripMs: stats.count ? stats.totalRoundTripMs / stats.count : 0,
                    p95RoundTripMs: summary.p95,
                    maxRoundTripMs: summary.max,
                    bytesToWorker: stats.bytesToWorker,
                    bytesFromWorker: stats.bytesFromWorker,
                };
            }
            return {
                id: info.id,
                kind: info.kind,
                url: info.url,
                active: info.terminatedAt == null,
                messagesToWorker: info.messagesToWorker,
                messagesFromWorker: info.messagesFromWorker,
                bytesToWorker: info.bytesToWorker,
                bytesFromWorker: info.bytesFromWorker,
                pending: info.pending.size,
                roundTrip: summarizeSamples(info.roundTrips),
                byType,
            };
        });
        return {
            totals: { ...state.totals },
            workers,
            recentEvents: state.events.values().slice(-80),
        };
    }

    summarizeResources() {
        const byKind = {};
        this.resourceEvents.values().forEach((entry) => {
            const group = byKind[entry.kind] || { count: 0, totalMs: 0, totalTransferSize: 0, maxMs: 0 };
            group.count += 1;
            group.totalMs += entry.durationMs || 0;
            group.totalTransferSize += entry.transferSize || 0;
            group.maxMs = Math.max(group.maxMs, entry.durationMs || 0);
            byKind[entry.kind] = group;
        });
        Object.values(byKind).forEach((group) => {
            group.avgMs = group.count ? group.totalMs / group.count : 0;
        });
        return byKind;
    }

    summarizeTileCaches() {
        const tileManagers = this.map?.style?.tileManagers || {};
        return Object.entries(tileManagers).map(([sourceId, tileManager]) => {
            const source = tileManager?.getSource?.();
            const outOfViewCache = tileManager?._outOfViewCache;
            const inViewIds = tileManager?._inViewTiles?.getAllIds?.() || [];
            const tileSize = tileManager?.usedForTerrain && tileManager?.tileSize ? tileManager.tileSize : source?.tileSize;
            return {
                sourceId,
                type: source?.type,
                used: tileManager?.used === true,
                usedForTerrain: tileManager?.usedForTerrain === true,
                tileSize,
                inViewCount: inViewIds.length,
                cacheCount: outOfViewCache?.order?.length || 0,
                cacheMax: outOfViewCache?.max || 0,
            };
        }).sort((a, b) => {
            if (a.usedForTerrain !== b.usedForTerrain) return a.usedForTerrain ? -1 : 1;
            if (a.used !== b.used) return a.used ? -1 : 1;
            return (b.cacheCount + b.inViewCount) - (a.cacheCount + a.inViewCount);
        });
    }

    snapshot() {
        const elapsedMs = (this.running ? nowMs() : (this.stoppedAt || nowMs())) - (this.startedAt || nowMs());
        const frame = summarizeSamples(this.frameSamples);
        const renderInterval = summarizeSamples(this.renderIntervals);
        return {
            running: this.running,
            startedAt: this.startedAt,
            elapsedMs,
            fps: {
                avg: frame.avg ? 1000 / frame.avg : 0,
                p95FrameMs: frame.p95,
                p99FrameMs: frame.p99,
                maxFrameMs: frame.max,
                renderIntervalAvgMs: renderInterval.avg,
                renderIntervalP95Ms: renderInterval.p95,
                slowFrames: this.longFrames.length,
            },
            timings: this.summarizeTimings(),
            layers: this.summarizeLayerTimings(),
            gl: this.summarizeGl(),
            workers: this.summarizeWorkers(),
            resources: this.summarizeResources(),
            tileCaches: this.summarizeTileCaches(),
            dataEvents: {
                count: this.dataEvents.length,
                recent: this.dataEvents.values().slice(-80),
            },
            longTasks: this.longTasks.slice(-80),
            longAnimationFrames: this.longAnimationFrames.slice(-40),
            marks: this.marks.slice(),
            recentEvents: this.events.values().slice(-120),
        };
    }

    log() {
        const snapshot = this.snapshot();
        console.log('[XplorePerf] snapshot', snapshot);
        console.table(snapshot.timings);
        console.table(snapshot.workers.workers.map((worker) => ({
            id: worker.id,
            kind: worker.kind,
            active: worker.active,
            to: worker.messagesToWorker,
            from: worker.messagesFromWorker,
            pending: worker.pending,
            avgRoundTripMs: worker.roundTrip.avg,
            p95RoundTripMs: worker.roundTrip.p95,
            maxRoundTripMs: worker.roundTrip.max,
        })));
        console.table(snapshot.tileCaches);
        return snapshot;
    }

    exportJson(filename = null) {
        const snapshot = this.snapshot();
        const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename || `xplore-perf-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 500);
        return snapshot;
    }

    showPanel() {
        if (this.panel) return;
        const panel = document.createElement('section');
        panel.setAttribute('aria-label', 'Xplore performance audit');
        panel.style.cssText = [
            'position:fixed',
            'left:12px',
            'bottom:54px',
            'z-index:2200',
            'width:min(390px,calc(100vw - 24px))',
            'max-height:min(70vh,620px)',
            'overflow:auto',
            'box-sizing:border-box',
            'border:1px solid rgba(255,255,255,.16)',
            'border-radius:10px',
            'background:rgba(10,16,24,.9)',
            'box-shadow:0 16px 44px rgba(0,0,0,.38)',
            'color:rgba(255,255,255,.9)',
            'font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace',
            'padding:10px',
            'backdrop-filter:blur(14px)',
        ].join(';');

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px';
        const title = document.createElement('strong');
        title.textContent = 'Xplore Perf';
        title.style.cssText = 'font-size:13px;color:#fff';
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:6px;align-items:center';

        const makeButton = (label, onClick) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.style.cssText = 'border:1px solid rgba(255,255,255,.18);border-radius:7px;background:rgba(255,255,255,.09);color:#fff;padding:4px 7px;font:inherit;cursor:pointer';
            button.addEventListener('click', onClick);
            return button;
        };
        actions.append(
            makeButton('log', () => this.log()),
            makeButton('json', () => this.exportJson()),
            makeButton('stop', () => this.stop()),
        );
        header.append(title, actions);

        this.panelBody = document.createElement('pre');
        this.panelBody.style.cssText = 'margin:0;white-space:pre-wrap;color:rgba(255,255,255,.86)';
        panel.append(header, this.panelBody);
        document.body.appendChild(panel);
        this.panel = panel;
        this.renderPanel();
        this.panelTimer = window.setInterval(() => this.renderPanel(), 500);
    }

    hidePanel() {
        if (this.panelTimer) {
            window.clearInterval(this.panelTimer);
            this.panelTimer = null;
        }
        if (this.panel) this.panel.remove();
        this.panel = null;
        this.panelBody = null;
    }

    renderPanel() {
        if (!this.panelBody) return;
        const snapshot = this.snapshot();
        const timings = snapshot.timings;
        const render = timings['map._render'] || {};
        const painter = timings['painter.render'] || {};
        const updateSources = timings['style._updateSources'] || {};
        const placement = timings['style._updatePlacement'] || {};
        const gl = snapshot.gl;
        const topLayers = snapshot.layers.slice(0, 4).map((layer) => {
            const label = layer.key.length > 30 ? `${layer.key.slice(0, 27)}...` : layer.key;
            return `${label} ${formatMs(layer.p95Ms)} x${layer.count}`;
        });
        const activeWorkers = snapshot.workers.workers.filter((worker) => worker.active);
        const topTileCaches = snapshot.tileCaches
            .filter((cache) => cache.used || cache.usedForTerrain || cache.cacheCount > 0 || cache.inViewCount > 0)
            .slice(0, 4)
            .map((cache) => {
                const label = cache.sourceId.length > 24 ? `${cache.sourceId.slice(0, 21)}...` : cache.sourceId;
                return `${label} ${cache.cacheCount}/${cache.cacheMax} iv${cache.inViewCount}${cache.usedForTerrain ? ' terrain' : ''}`;
            });
        const topWorkers = activeWorkers.slice(0, 4).map((worker) => {
            const topTypes = Object.entries(worker.byType)
                .sort((a, b) => (b[1].p95RoundTripMs || 0) - (a[1].p95RoundTripMs || 0))
                .slice(0, 2)
                .map(([type, stats]) => `${type}:${formatMs(stats.p95RoundTripMs)}`)
                .join(' ');
            return `W${worker.id} ${worker.kind} ${worker.pending}p ${topTypes}`;
        });
        const lines = [
            `${snapshot.running ? 'RUN' : 'STOP'} ${formatRate(snapshot.fps.avg)} fps  p95 ${formatMs(snapshot.fps.p95FrameMs)}  max ${formatMs(snapshot.fps.maxFrameMs)}`,
            `render p95 ${formatMs(render.p95Ms)}  painter ${formatMs(painter.p95Ms)}  sources ${formatMs(updateSources.p95Ms)}  placement ${formatMs(placement.p95Ms)}`,
            this.glEnabled
                ? `gl draw p95 ${formatRate(gl.drawCallsPerFrame.p95)}  texUpload p95 ${formatRate(gl.textureUploadsPerFrame.p95)}  fbo p95 ${formatRate(gl.framebufferAttachmentsPerFrame.p95)}`
                : 'gl counters off  enable with xplorePerf.start({gl:true})',
            ...topLayers,
            ...topTileCaches,
            `workers ${activeWorkers.length}/${snapshot.workers.totals.created || 0}  to ${snapshot.workers.totals.messagesToWorker || 0}  from ${snapshot.workers.totals.messagesFromWorker || 0}`,
            ...topWorkers,
            `data ${snapshot.dataEvents.count}  resources ${Object.values(snapshot.resources).reduce((sum, group) => sum + group.count, 0)}  longTasks ${snapshot.longTasks.length}  slowFrames ${snapshot.fps.slowFrames}`,
            'console: xplorePerf.log(), xplorePerf.snapshot(), xploreTileCaches(), xplorePerf.exportJson()',
        ];
        this.panelBody.textContent = lines.join('\n');
    }
}

export function initPerformanceAudit(map, options = {}) {
    installWorkerAudit();
    const existing = typeof window !== 'undefined' ? window.xplorePerf : null;
    if (existing && existing.map === map) return existing;
    const audit = new XplorePerformanceAudit(map, options);
    if (typeof window !== 'undefined') {
        window.xplorePerf = audit;
        window.xplorePerfStart = (config = {}) => audit.start(config);
        window.xplorePerfStop = () => audit.stop();
        window.xploreTileCaches = () => audit.summarizeTileCaches();
    }
    if (options.autoStart) {
        audit.start({
            repaint: options.repaint ?? true,
            panel: options.panel ?? true,
        });
    }
    return audit;
}
