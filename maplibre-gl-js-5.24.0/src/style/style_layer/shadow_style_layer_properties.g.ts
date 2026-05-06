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

export type ShadowPaintProps = {
    "shadow-opacity": DataConstantProperty<number>,
    "shadow-color": DataConstantProperty<Color>,
    "shadow-max-distance": DataConstantProperty<number>,
    "shadow-direction": DataConstantProperty<number>,
    "shadow-altitude": DataConstantProperty<number>,
    "shadow-penumbra": DataConstantProperty<number>,
    "shadow-shadow-color": DataConstantProperty<Color>,
    "shadow-highlight-color": DataConstantProperty<Color>,
};

export type ShadowPaintPropsPossiblyEvaluated = {
    "shadow-opacity": number,
    "shadow-color": Color,
    "shadow-max-distance": number,
    "shadow-direction": number,
    "shadow-altitude": number,
    "shadow-penumbra": number,
    "shadow-shadow-color": Color,
    "shadow-highlight-color": Color,
};

// Since shadow is a custom layer type not yet in the style-spec,
// we define fallback specs inline.
const shadowPaintSpec: Record<string, StylePropertySpecification> = {
    "shadow-opacity": {
        type: "number",
        default: 0.5,
        minimum: 0,
        maximum: 1,
        transition: true,
        expression: { interpolated: true, parameters: ["zoom"] },
        "property-type": "data-constant",
    } as any,
    "shadow-color": {
        type: "color",
        default: "#000000",
        transition: true,
        expression: { interpolated: true, parameters: ["zoom"] },
        "property-type": "data-constant",
    } as any,
    "shadow-max-distance": {
        type: "number",
        default: 500,
        minimum: 0,
        transition: false,
        expression: { interpolated: true, parameters: ["zoom"] },
        "property-type": "data-constant",
    } as any,
    "shadow-direction": {
        type: "number",
        default: 315,
        minimum: 0,
        maximum: 360,
        transition: false,
        expression: { interpolated: true, parameters: ["zoom"] },
        "property-type": "data-constant",
    } as any,
    "shadow-altitude": {
        type: "number",
        default: 45,
        minimum: 0,
        maximum: 90,
        transition: false,
        expression: { interpolated: true, parameters: ["zoom"] },
        "property-type": "data-constant",
    } as any,
    "shadow-penumbra": {
        type: "number",
        default: 0.2,
        minimum: 0,
        maximum: 1,
        transition: true,
        expression: { interpolated: true, parameters: ["zoom"] },
        "property-type": "data-constant",
    } as any,
    "shadow-shadow-color": {
        type: "color",
        default: "#000000",
        transition: true,
        expression: { interpolated: true, parameters: ["zoom"] },
        "property-type": "data-constant",
    } as any,
    "shadow-highlight-color": {
        type: "color",
        default: "#ffffff",
        transition: true,
        expression: { interpolated: true, parameters: ["zoom"] },
        "property-type": "data-constant",
    } as any,
};

let paint: Properties<ShadowPaintProps>;
const getPaint = () => paint = paint || new Properties({
    "shadow-opacity": new DataConstantProperty(shadowPaintSpec["shadow-opacity"]),
    "shadow-color": new DataConstantProperty(shadowPaintSpec["shadow-color"]),
    "shadow-max-distance": new DataConstantProperty(shadowPaintSpec["shadow-max-distance"]),
    "shadow-direction": new DataConstantProperty(shadowPaintSpec["shadow-direction"]),
    "shadow-altitude": new DataConstantProperty(shadowPaintSpec["shadow-altitude"]),
    "shadow-penumbra": new DataConstantProperty(shadowPaintSpec["shadow-penumbra"]),
    "shadow-shadow-color": new DataConstantProperty(shadowPaintSpec["shadow-shadow-color"]),
    "shadow-highlight-color": new DataConstantProperty(shadowPaintSpec["shadow-highlight-color"]),
});

export default ({ get paint() { return getPaint() } });
