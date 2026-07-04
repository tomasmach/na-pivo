/**
 * Minimal react-native mock for jest tests.
 * Only mocks the subset actually used in this project's tests.
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

export const View = createComponent('View');
export const Text = createComponent('Text');
export const Pressable = createComponent('Pressable');
export const ScrollView = createComponent('ScrollView');
export const ActivityIndicator = createComponent('ActivityIndicator');

export const StyleSheet = {
  absoluteFill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
  flatten: (style: unknown): Record<string, unknown> =>
    Array.isArray(style)
      ? Object.assign({}, ...style.flat(Infinity).filter(Boolean))
      : ((style as Record<string, unknown>) ?? {}),
};

export const Dimensions = {
  get: jest.fn(() => ({
    width: 390,
    height: 844,
    scale: 3,
    fontScale: 1,
  })),
};

export const useWindowDimensions = jest.fn(() => ({
  width: 390,
  height: 844,
  scale: 3,
  fontScale: 1,
}));

export const Platform = {
  OS: 'ios',
  Version: '18.1',
  select: (options: Record<string, unknown>) =>
    options['ios'] ?? options['default'] ?? undefined,
};

export const Linking = {
  openSettings: jest.fn().mockResolvedValue(undefined),
  openURL: jest.fn().mockResolvedValue(undefined),
  canOpenURL: jest.fn().mockResolvedValue(true),
  getInitialURL: jest.fn().mockResolvedValue(null),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
};

export const Alert = {
  alert: jest.fn(),
};

export const AppState = {
  currentState: 'active',
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
};

export const AccessibilityInfo = {
  isReduceMotionEnabled: jest.fn().mockResolvedValue(false),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
};

export const KeyboardAvoidingView = createComponent('KeyboardAvoidingView');
export const TextInput = createComponent('TextInput');
// Modal renders its children inline in tests (visibility is a prop, not gated).
export const Modal = createComponent('Modal');

export const NativeModules = {};
export const NativeEventEmitter = jest.fn(() => ({
  addListener: jest.fn(),
  removeAllListeners: jest.fn(),
}));
