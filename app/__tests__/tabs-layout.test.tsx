import React from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('expo-router/native-tabs', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const leaf = (name: string) =>
    function Leaf(props: { children?: React.ReactNode }) {
      return React.createElement(name, props, props.children);
    };
  const Trigger = Object.assign(leaf('Trigger'), {
    Icon: leaf('Icon'),
    Label: leaf('Label'),
    Badge: leaf('Badge'),
  });
  return { NativeTabs: Object.assign(leaf('NativeTabs'), { Trigger }) };
});
jest.mock('@/navigation/tabs', () => ({ handleTabPress: jest.fn(), partaBadge: () => null }));
jest.mock('@/navigation/TabScreen', () => ({
  TabsInsetsRoot: ({ children }: { children: React.ReactNode }) => children,
}));

import TabsLayout from '../(tabs)/_layout';

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

it('keeps every tab label visible on Android', () => {
  let renderer: any;
  act(() => {
    renderer = TestRenderer.create(<TabsLayout />);
  });
  // Material hides inactive labels with four items unless told otherwise.
  expect(renderer.root.findByType('NativeTabs').props.labelVisibilityMode).toBe('labeled');
  act(() => renderer.unmount());
});

it('draws the iOS tab bar dark in the light system appearance', () => {
  let renderer: any;
  act(() => {
    renderer = TestRenderer.create(<TabsLayout />);
  });
  const styles = renderer.root
    .findAllByType('Trigger')
    .map((trigger: any) => trigger.props.unstable_nativeProps?.ios?.experimental_userInterfaceStyle);
  expect(styles).toEqual(['dark', 'dark', 'dark', 'dark']);
  act(() => renderer.unmount());
});
