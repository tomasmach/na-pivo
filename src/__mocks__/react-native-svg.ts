/**
 * Minimal react-native-svg mock for jest tests.
 *
 * The real package ships untranspiled TS source that jest does not transform
 * (it is not in transformIgnorePatterns), so importing it pulls in
 * SvgTouchableMixin and blows up. Tests only need these elements to render as
 * inert host nodes, so we stub the subset the app actually imports.
 */

import React from 'react';

const createComponent = (name: string) => {
  const Component = ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement(name, props, children);
  Component.displayName = name;
  return Component;
};

const Svg = createComponent('Svg');

export const Circle = createComponent('Circle');
export const Defs = createComponent('Defs');
export const Ellipse = createComponent('Ellipse');
export const Path = createComponent('Path');
export const LinearGradient = createComponent('LinearGradient');
export const RadialGradient = createComponent('RadialGradient');
export const Rect = createComponent('Rect');
export const Stop = createComponent('Stop');
export const Text = createComponent('SvgText');
export const SvgXml = createComponent('SvgXml');

export default Svg;
