/**
 * Toast System
 * Provides non-intrusive feedback matching the app aesthetic.
 */
export class Toast {
    static success(message) {
        this.show(message, 'success', '✓');
    }

    static error(message) {
        this.show(message, 'error', '✕');
    }

    static info(message) {
        this.show(message, 'info', 'ℹ');
    }

    static show(message, type = 'info', icon = 'ℹ', options = {}) {
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        container.className = `toast-container visible toast--${type}`;
        container.innerHTML = `
            <div class="toast-icon">${icon}</div>
            <div class="toast-message">${message}</div>
        `;

        // Clear existing timeout
        if (this._timeout) {
            clearTimeout(this._timeout);
            this._timeout = null;
        }

        // Auto-hide unless persistent option is true
        if (!options.persistent) {
            this._timeout = setTimeout(() => {
                container.classList.remove('visible');
            }, options.duration || 4000);
        }
    }

    static hide() {
        if (this._timeout) {
            clearTimeout(this._timeout);
            this._timeout = null;
        }
        const container = document.querySelector('.toast-container');
        if (container) {
            container.classList.remove('visible');
        }
    }
}
