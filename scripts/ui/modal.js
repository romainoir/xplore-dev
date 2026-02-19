/**
 * Modal System
 * Flexible modals for prompts and confirmations.
 */
export class Modal {
    static async prompt({ title, message, defaultValue = '', placeholder = '' }) {
        return new Promise((resolve) => {
            const overlay = this._createOverlay();
            overlay.innerHTML = `
                <div class="modal-container">
                    <div class="modal-header">${title}</div>
                    <div class="modal-body">
                        ${message}
                        <input type="text" class="modal-input" value="${defaultValue}" placeholder="${placeholder}">
                    </div>
                    <div class="modal-actions">
                        <button class="modal-btn modal-btn--secondary action-cancel">Cancel</button>
                        <button class="modal-btn modal-btn--primary action-confirm">Save</button>
                    </div>
                </div>
            `;

            const input = overlay.querySelector('.modal-input');
            const cancelBtn = overlay.querySelector('.action-cancel');
            const confirmBtn = overlay.querySelector('.action-confirm');

            const close = (value) => {
                overlay.classList.remove('visible');
                setTimeout(() => overlay.remove(), 300);
                resolve(value);
            };

            cancelBtn.onclick = () => close(null);
            confirmBtn.onclick = () => close(input.value);
            input.onkeydown = (e) => {
                if (e.key === 'Enter') confirmBtn.click();
                if (e.key === 'Escape') cancelBtn.click();
            };

            document.body.appendChild(overlay);
            setTimeout(() => {
                overlay.classList.add('visible');
                input.focus();
                input.select();
            }, 10);
        });
    }

    static async confirm({ title, message, confirmText = 'Delete', confirmClass = 'modal-btn--danger' }) {
        return new Promise((resolve) => {
            const overlay = this._createOverlay();
            overlay.innerHTML = `
                <div class="modal-container">
                    <div class="modal-header">${title}</div>
                    <div class="modal-body">${message}</div>
                    <div class="modal-actions">
                        <button class="modal-btn modal-btn--secondary action-cancel">Cancel</button>
                        <button class="modal-btn ${confirmClass} action-confirm">${confirmText}</button>
                    </div>
                </div>
            `;

            const cancelBtn = overlay.querySelector('.action-cancel');
            const confirmBtn = overlay.querySelector('.action-confirm');

            const close = (value) => {
                overlay.classList.remove('visible');
                setTimeout(() => overlay.remove(), 300);
                resolve(value);
            };

            cancelBtn.onclick = () => close(false);
            confirmBtn.onclick = () => close(true);

            document.body.appendChild(overlay);
            setTimeout(() => overlay.classList.add('visible'), 10);
        });
    }

    static _createOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        return overlay;
    }
}
