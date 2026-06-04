/**
 * Small DOM helpers for the layer side panel.
 */

export function getLayerPanelLabel(label) {
    return String(label || '').trim().replace(/\s+/g, '\n');
}

export function setLayerPanelButtonLabel(button, label, placement = 'top') {
    if (!button) return;
    button.dataset.layerLabel = getLayerPanelLabel(label);
    button.dataset.layerLabelPlacement = placement;
}

export function createLayerPanelSection(id, title) {
    const section = document.createElement('section');
    section.className = 'layer-side-panel__section';
    section.dataset.layerSection = id;

    const header = document.createElement('div');
    header.className = 'layer-side-panel__section-header';

    const heading = document.createElement('h3');
    heading.className = 'layer-side-panel__section-title';
    heading.textContent = title;
    header.appendChild(heading);

    const content = document.createElement('div');
    content.className = 'layer-side-panel__section-content';
    section.append(header, content);

    return { section, content };
}
