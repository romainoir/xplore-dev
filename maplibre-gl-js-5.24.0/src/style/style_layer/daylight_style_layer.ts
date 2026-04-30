import { StyleLayer } from '../style_layer';

import properties, { type DaylightPaintPropsPossiblyEvaluated } from './daylight_style_layer_properties.g';
import { type Transitionable, type Transitioning, type PossiblyEvaluated } from '../properties';

import type { DaylightPaintProps } from './daylight_style_layer_properties.g';
import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { EvaluationParameters } from '../evaluation_parameters';
import type { Texture } from '../../webgl/texture';
import type { RGBAImage } from '../../util/image';
import { renderColorRamp } from '../../util/color_ramp';

export const isDaylightStyleLayer = (layer: StyleLayer): layer is DaylightStyleLayer => (layer.type as string) === 'daylight';

export class DaylightStyleLayer extends StyleLayer {
    _transitionablePaint: Transitionable<DaylightPaintProps>;
    _transitioningPaint: Transitioning<DaylightPaintProps>;
    paint: PossiblyEvaluated<DaylightPaintProps, DaylightPaintPropsPossiblyEvaluated>;

    colorRamp: RGBAImage;
    colorRampTexture: Texture | null;

    constructor(layer: LayerSpecification, globalState: Record<string, any>) {
        super(layer, properties, globalState);
        this.colorRampTexture = null;
        this._updateColorRamp();
        this.recalculate({ zoom: 0, zoomHistory: {} } as EvaluationParameters, undefined);
    }

    _handleSpecialPaintPropertyUpdate(name: string) {
        if (name === 'daylight-color-ramp') {
            this._updateColorRamp();
        }
    }

    _updateColorRamp() {
        if (!this._transitionablePaint || !this._transitionablePaint._values['daylight-color-ramp']) return;
        const value = this._transitionablePaint._values['daylight-color-ramp'].value as any;
        if (value && value.expression) {
            this.colorRamp = renderColorRamp({
                expression: value.expression,
                evaluationKey: 'lineProgress',
                image: this.colorRamp
            });
            this.colorRampTexture = null;
        }
    }

    hasOffscreenPass() {
        return this.paint.get('daylight-opacity') !== 0 && !this.isHidden();
    }
}
