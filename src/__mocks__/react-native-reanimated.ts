/**
 * Minimal react-native-reanimated mock for jest tests.
 *
 * The real package ships ESM that jest does not transform. Animations resolve
 * to their target value at once, so a test reads the end state. Tests that
 * need more mock the module themselves.
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

const identity = <T>(value: T) => value;

export function createAnimatedComponent<T>(component: T): T {
  return component;
}

export const Easing = {
  linear: identity,
  quad: identity,
  cubic: identity,
  in: identity,
  out: identity,
  inOut: identity,
};

export const useSharedValue = <T>(value: T) =>
  React.useState(() => {
    const shared = {
      value,
      get: () => shared.value,
      set: (next: T) => {
        shared.value = next;
      },
    };
    return shared;
  })[0];

/** Like the real one, the style reads the shared values live, not as of the render. */
export function useAnimatedStyle<T extends object>(factory: () => T): T {
  const live = {} as T;
  for (const key of Object.keys(factory())) {
    Object.defineProperty(live, key, { enumerable: true, get: () => factory()[key as keyof T] });
  }
  return live;
}

/** The animation lands at once, and its end callback hears that it finished. */
const land = <T>(value: T, _config?: unknown, callback?: (finished: boolean) => void) => {
  callback?.(true);
  return value;
};

export const withSpring = land;
export const withTiming = land;
export const withSequence = <T>(...values: T[]) => values[values.length - 1];
export const withDelay = <T>(_delay: number, value: T) => value;
export const withRepeat = identity;
export const cancelAnimation = () => undefined;
export const useReducedMotion = () => false;
export const useAnimatedProps = <T>(factory: () => T) => factory();
export const useAnimatedReaction = () => undefined;
export const runOnJS = identity;

export default {
  View: createComponent('AnimatedView'),
  Text: createComponent('AnimatedText'),
  createAnimatedComponent,
};
