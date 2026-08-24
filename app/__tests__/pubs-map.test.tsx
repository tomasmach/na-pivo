import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import PubsMapRoute from '../pubs-map';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('expo-router', () => ({
  Redirect: (props: Record<string, unknown>) =>
    React.createElement('View', { ...props, mockComponent: 'Redirect' }),
}));

jest.mock('@/pubs/NearestMapMockScreen', () => ({
  __esModule: true,
  default: () => React.createElement('View', { mockComponent: 'NearestMapMockScreen' }),
}));

describe('/pubs-map compatibility route', () => {
  it('redirects old deep links to the real compass instead of exposing a design mock', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<PubsMapRoute />);
    });

    expect(renderer.root.findByProps({ mockComponent: 'Redirect' }).props.href).toBe('/');
    expect(renderer.root.findAllByProps({ mockComponent: 'NearestMapMockScreen' })).toHaveLength(0);
  });
});
