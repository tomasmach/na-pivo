import React from 'react';

import { UnderlineTabs } from '../UnderlineTabs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TestRenderer = jest.requireActual('react-test-renderer');
const { act } = TestRenderer;

describe('UnderlineTabs', () => {
  it('exposes tabs and the selected state to assistive technology', () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(
        <UnderlineTabs options={['Parta', 'Akce']} value="Parta" onChange={jest.fn()} />,
      );
    });
    const tabs = renderer!.root.findAll(
      (node: { props?: Record<string, unknown> }) => node.props?.accessibilityRole === 'tab',
      { deep: true },
    );
    expect(tabs.length).toBeGreaterThanOrEqual(2);
    expect(tabs.find((node: { props: Record<string, unknown> }) => node.props.accessibilityLabel === 'Parta')?.props.accessibilityState).toEqual({ selected: true });
  });

  it('shrinks long labels instead of rendering an ellipsis at large text sizes', () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(
        <UnderlineTabs options={['Statistiky', 'Aktivita']} value="Statistiky" onChange={jest.fn()} />,
      );
    });
    for (const label of ['Statistiky', 'Aktivita']) {
      const text = renderer!.root.find(
        (node: { type: unknown; props?: Record<string, unknown> }) => node.type === 'Text' && node.props?.children === label,
      );
      expect(text.props.adjustsFontSizeToFit).toBe(true);
      expect(text.props.minimumFontScale).toBeLessThanOrEqual(0.8);
    }
  });
});
