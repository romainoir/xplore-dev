import { StyleLayer } from '../style_layer';

import properties, { type ShadowPaintPropsPossiblyEvaluated } from './shadow_style_layer_properties.g';
import { type Transitionable, type Transitioning, type PossiblyEvaluated } from '../properties';

import type { ShadowPaintProps } from './shadow_style_layer_properties.g';
import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { EvaluationParameters } from '../evaluation_parameters';

const DEG_TO_RAD = Math.PI / 180;

export const isShadowStyleLayer = (layer: StyleLayer): layer is ShadowStyleLayer => (layer.type as string) === 'shadow';

export class ShadowStyleLayer extends StyleLayer {
    _transitionablePaint: Transitionable<ShadowPaintProps>;
    _transitioningPaint: Transitioning<ShadowPaintProps>;
    paint: PossiblyEvaluated<ShadowPaintProps, ShadowPaintPropsPossiblyEvaluated>;

    constructor(layer: LayerSpecification, globalState: Record<string, any>) {
        super(layer, properties, globalState);
        this.recalculate({ zoom: 0, zoomHistory: {} } as EvaluationParameters, undefined);
    }

    getShadowProperties(): { directionRadians: number; altitudeRadians: number; maxDistance: number } {
        const direction = (this.paint.get('shadow-direction') as number) ?? 315;
        const altitude = (this.paint.get('shadow-altitude') as number) ?? 45;
        const maxDistance = (this.paint.get('shadow-max-distance') as number) ?? 500;

        return {
            directionRadians: direction * DEG_TO_RAD,
            altitudeRadians: altitude * DEG_TO_RAD,
            maxDistance,
        };
    }

    hasOffscreenPass() {
        // Shadow layer requires an offscreen pass to build the H4 Horizon Map
        return true;
    }
}
