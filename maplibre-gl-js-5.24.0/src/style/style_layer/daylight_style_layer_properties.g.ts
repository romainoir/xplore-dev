// This file is generated. Edit build/generate-style-code.ts, then run 'npm run codegen'.
/* eslint-disable */

import { latest as styleSpec } from '@maplibre/maplibre-gl-style-spec';

import {
    Properties,
    DataConstantProperty,
    DataDrivenProperty,
    CrossFadedDataDrivenProperty,
    CrossFadedProperty,
    ColorRampProperty,
    PossiblyEvaluatedPropertyValue,
    CrossFaded
} from '../properties';

import type { Color, Formatted, Padding, NumberArray, ColorArray, ResolvedImage, VariableAnchorOffsetCollection } from '@maplibre/maplibre-gl-style-spec';
import { StylePropertySpecification } from '@maplibre/maplibre-gl-style-spec';

export type DaylightPaintProps = {
    "daylight-opacity": DataConstantProperty<number>,
    "daylight-color-ramp": ColorRampProperty,
};

export type DaylightPaintPropsPossiblyEvaluated = {
    "daylight-opacity": number,
    "daylight-color-ramp": Color,
};

// Since daylight is a custom layer type not yet in the style-spec,
// we define fallback specs inline.
const daylightPaintSpec: Record<string, StylePropertySpecification> = {
    "daylight-opacity": {
        type: "number",
        default: 0.5,
        minimum: 0,
        maximum: 1,
        transition: true,
        expression: { interpolated: true, parameters: ["zoom"] },
        "property-type": "data-constant",
    } as any,
    "daylight-color-ramp": {
        type: "color",
        default: "#000000",
        expression: { interpolated: true, parameters: ["line-progress"] },
        "property-type": "color-ramp"
    } as any,
};

let paint: Properties<DaylightPaintProps>;
const getPaint = () => paint = paint || new Properties({
    "daylight-opacity": new DataConstantProperty(daylightPaintSpec["daylight-opacity"]),
    "daylight-color-ramp": new ColorRampProperty(daylightPaintSpec["daylight-color-ramp"]),
});

export default ({ get paint() { return getPaint() } });
