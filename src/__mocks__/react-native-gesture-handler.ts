/**
 * Minimal react-native-gesture-handler mock for jest tests. A gesture hook
 * returns its config, and `GestureDetector` hands it on as a prop, so a test
 * can drive the callbacks itself.
 */

import React from 'react';
import { FlatList as RNFlatList, ScrollView as RNScrollView } from 'react-native';

export const State = { UNDETERMINED: 0, FAILED: 1, BEGAN: 2, CANCELLED: 3, ACTIVE: 4, END: 5 };

export const GestureStateManager = {
  activate: jest.fn(),
  fail: jest.fn(),
  deactivate: jest.fn(),
};

export const usePanGesture = <T,>(config: T): T => config;

export const GestureDetector = ({ gesture, children }: { gesture: unknown; children?: React.ReactNode }) =>
  React.createElement('GestureDetector', { gesture }, children);

export const GestureHandlerRootView = ({ children, ...props }: { children?: React.ReactNode }) =>
  React.createElement('GestureHandlerRootView', props, children);

const withoutRelations = (Component: React.ElementType) => {
  const Wrapped = React.forwardRef(({ requireToFail: _wait, ...props }: { requireToFail?: unknown }, ref) =>
    React.createElement(Component, { ...props, ref }),
  );
  Wrapped.displayName = 'GestureHandlerScroll';
  return Wrapped;
};

export const ScrollView = withoutRelations(RNScrollView);
export const FlatList = withoutRelations(RNFlatList);
