class ShadowTuner {
    constructor(map) {
        this.map = map;
        this.container = null;
        this.visible = false;
        this.currentKeyframeZoom = 12; // Default
        this.isDraggingSlider = false;

        // Define default keyframes if not exists
        if (!window.shadowConfig) {
            window.shadowConfig = {};
        }

        // Default Keyframes (Zoom Level -> Settings)
        this.keyframes = {
            5: { stepSizePixels: 2.0, maxSteps: 24.0, k: 5.0, acceleration: 0.038, maxDistC: 600.0 },
            10: { stepSizePixels: 3.5, maxSteps: 96.0, k: 1.0, acceleration: 0.0, maxDistC: 1100.0 },
            12: { stepSizePixels: 4.0, maxSteps: 256.0, k: 1.0, acceleration: 0.0, maxDistC: 2000.0 },
            14: { stepSizePixels: 1.0, maxSteps: 256.0, k: 1.0, acceleration: 0.001, maxDistC: 1200.0 }
        };

        // Store reference to keyframes in window for persistence/debugging
        window.shadowConfig.keyframes = this.keyframes;

        // Bind methods
        this.update = this.update.bind(this);
        this.toggleUI = this.toggleUI.bind(this);

        // Start update loop
        this.map.on('move', this.update);

        this.createUI();
        this.update(); // Initial update
    }

    // Interpolate values between keyframes based on current zoom
    update() {
        const zoom = this.map.getZoom();

        // 1. Find Interpolation Range
        const zooms = Object.keys(this.keyframes).map(Number).sort((a, b) => a - b);
        let lowerZoom = zooms[0];
        let upperZoom = zooms[zooms.length - 1];

        for (let i = 0; i < zooms.length - 1; i++) {
            if (zoom >= zooms[i] && zoom < zooms[i + 1]) {
                lowerZoom = zooms[i];
                upperZoom = zooms[i + 1];
                break;
            }
        }

        // 2. Identify "Nearest" Keyframe for Editing
        // Find which keyframe Z is closest to current Z
        let minDiff = Infinity;
        let nearestZ = lowerZoom;
        zooms.forEach(z => {
            const diff = Math.abs(zoom - z);
            if (diff < minDiff) {
                minDiff = diff;
                nearestZ = z;
            }
        });

        // Update current editing target
        this.currentKeyframeZoom = nearestZ;

        // 3. Interpolate & Apply Settings
        if (zoom <= lowerZoom) {
            this.applySettings(this.keyframes[lowerZoom]);
            this.updateUI(lowerZoom, lowerZoom, 0);
        } else if (zoom >= upperZoom) {
            this.applySettings(this.keyframes[upperZoom]);
            this.updateUI(upperZoom, upperZoom, 0);
        } else {
            // Interpolate
            const t = (zoom - lowerZoom) / (upperZoom - lowerZoom);
            const lower = this.keyframes[lowerZoom];
            const upper = this.keyframes[upperZoom];

            const settings = {
                stepSizePixels: this.lerp(lower.stepSizePixels, upper.stepSizePixels, t),
                maxSteps: this.lerp(lower.maxSteps, upper.maxSteps, t),
                k: this.lerp(lower.k, upper.k, t),
                acceleration: this.lerp(lower.acceleration, upper.acceleration, t),
                maxDistC: this.lerp(lower.maxDistC, upper.maxDistC, t)
            };

            this.applySettings(settings);
            this.updateUI(lowerZoom, upperZoom, t);
        }

        // Trigger repaint to apply new uniforms
        this.map.triggerRepaint();
    }

    lerp(start, end, t) {
        return start * (1 - t) + end * t;
    }

    applySettings(settings) {
        window.shadowConfig.stepSizePixels = settings.stepSizePixels;
        window.shadowConfig.maxSteps = settings.maxSteps;
        window.shadowConfig.k = settings.k;
        window.shadowConfig.acceleration = settings.acceleration;
        window.shadowConfig.maxDistC = settings.maxDistC;
    }

    createUI() {
        this.container = document.createElement('div');
        this.container.style.cssText = `
            position: absolute;
            top: 60px;
            right: 60px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px;
            border-radius: 4px;
            font-family: monospace;
            font-size: 11px;
            z-index: 10000;
            width: 250px;
            pointer-events: auto;
            display: none;
            backdrop-filter: blur(4px);
            border: 1px solid rgba(255,255,255,0.2);
        `;

        this.container.innerHTML = `
            <div style="font-weight:bold; margin-bottom:8px; display:flex; justify-content:space-between;">
                <span>Shadow Tuner</span>
                <span id="st-zoom">Z: 0.00</span>
            </div>
            
            <!-- Controls Interpolated live values (Read-only) -->
            <div style="border-top:1px solid #444; padding-top:5px; margin-bottom:10px;">
                <div style="color:#4f9; display:flex; justify-content:space-between;">
                    <span>Live Values</span>
                    <span id="st-interpolation-factor" style="color:#aaa;"></span>
                </div>
                <div id="st-live-vals"></div>
            </div>
            
            <!-- Keyframe Editor -->
            <div style="border-top:1px solid #444; padding-top:5px; background:rgba(255,255,255,0.05); padding:5px; border-radius:4px;">
                <div style="margin-bottom:5px; color:#fce; font-weight:bold; border-bottom:1px solid #666; padding-bottom:2px;">
                    Editing Nearest Keyframe: <span id="st-current-keyframe">Z12</span>
                </div>
                
                <div class="st-control">
                    <div>Step Size (px) <span id="val-stepSizePixels" style="float:right"></span></div>
                    <input type="range" id="in-stepSizePixels" min="1" max="32" step="0.5" style="width:100%">
                </div>
                <div class="st-control">
                    <div>Max Steps <span id="val-maxSteps" style="float:right"></span></div>
                    <input type="range" id="in-maxSteps" min="16" max="256" step="8" style="width:100%">
                </div>
                <div class="st-control">
                    <div>Penumbra (k) <span id="val-k" style="float:right"></span></div>
                    <input type="range" id="in-k" min="1" max="64" step="1" style="width:100%">
                </div>
                <div class="st-control">
                    <div>Accel <span id="val-acceleration" style="float:right"></span></div>
                    <input type="range" id="in-acceleration" min="0" max="0.1" step="0.001" style="width:100%">
                </div>
                <div class="st-control">
                    <div>MaxDistC <span id="val-maxDistC" style="float:right"></span></div>
                    <input type="range" id="in-maxDistC" min="100" max="2000" step="50" style="width:100%">
                </div>
                
                <div style="margin-top:10px; text-align:right;">
                    <button id="st-save" style="background:#444; color:white; border:none; padding:4px 8px; cursor:pointer;">Log Config</button>
                    <button id="st-close" style="background:#444; color:white; border:none; padding:4px 8px; cursor:pointer;">Close</button>
                </div>
            </div>
        `;

        document.body.appendChild(this.container);
        this.makeDraggable(this.container);

        // Event Listeners
        ['stepSizePixels', 'maxSteps', 'k', 'acceleration', 'maxDistC'].forEach(key => {
            const input = document.getElementById(`in-${key}`);

            // Track dragging state to prevent UI updates from overwriting user input while dragging
            input.addEventListener('mousedown', () => { this.isDraggingSlider = true; });
            input.addEventListener('mouseup', () => { this.isDraggingSlider = false; });

            input.addEventListener('input', (e) => {
                const val = Number(e.target.value);

                // Update the NEAREST keyframe
                this.keyframes[this.currentKeyframeZoom][key] = val;
                document.getElementById(`val-${key}`).textContent = val.toFixed(3);

                // Trigger immediate map update
                this.update();
            });
        });

        document.getElementById('st-close').addEventListener('click', () => this.toggleUI());

        document.getElementById('st-save').addEventListener('click', () => {
            console.log('Current Shadow Config:', JSON.stringify(this.keyframes, null, 2));
            alert('Config logged to console! Copy it to save.');
        });

        // Load initial values based on start zoom
        this.update();
    }

    makeDraggable(element) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        const header = element.querySelector('div:first-child');
        if (header) {
            header.style.cursor = 'grab';
            header.onmousedown = dragMouseDown;
        } else {
            element.onmousedown = dragMouseDown;
        }

        function dragMouseDown(e) {
            e = e || window.event;
            // Use closest to ensure we don't block inputs
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;

            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
            if (header) header.style.cursor = 'grabbing';
        }

        function elementDrag(e) {
            e = e || window.event;
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
            element.style.right = 'auto'; // Clear right
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
            if (header) header.style.cursor = 'grab';
        }
    }

    updateUI(lowerZ, upperZ, t) {
        if (!this.visible) return;

        document.getElementById('st-zoom').textContent = `Z: ${this.map.getZoom().toFixed(2)}`;

        // Show interpolation factor
        const pct = Math.round(t * 100);
        document.getElementById('st-interpolation-factor').textContent =
            lowerZ === upperZ ? '(Exact)' : `${pct}% to Z${upperZ}`;

        // Show Live Values
        const lv = window.shadowConfig;
        document.getElementById('st-live-vals').innerHTML = `
            Step: ${lv.stepSizePixels.toFixed(2)}px<br>
            MaxSteps: ${lv.maxSteps.toFixed(0)}<br>
            K: ${lv.k.toFixed(1)}<br>
            Accel: ${lv.acceleration.toFixed(4)}<br>
            DistC: ${lv.maxDistC.toFixed(0)}
        `;

        // Update Editor UI (only if NOT dragging)
        document.getElementById('st-current-keyframe').textContent = `Z${this.currentKeyframeZoom}`;

        if (!this.isDraggingSlider) {
            const s = this.keyframes[this.currentKeyframeZoom];
            ['stepSizePixels', 'maxSteps', 'k', 'acceleration', 'maxDistC'].forEach(key => {
                const input = document.getElementById(`in-${key}`);
                if (document.activeElement !== input) { // Double check focus
                    input.value = s[key];
                    document.getElementById(`val-${key}`).textContent = s[key].toFixed(3);
                }
            });
        }
    }

    toggleUI() {
        this.visible = !this.visible;
        this.container.style.display = this.visible ? 'block' : 'none';
        if (this.visible) this.update();
    }
}

// Export to global scope
window.ShadowTuner = ShadowTuner;
