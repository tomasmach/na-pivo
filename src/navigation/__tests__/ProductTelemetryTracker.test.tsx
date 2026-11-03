import React from 'react';
import { usePathname } from 'expo-router';

import { trackScreenViewed } from '@/data/productTelemetry';
import { ProductTelemetryTracker } from '@/navigation/ProductTelemetryTracker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('expo-router', () => ({ usePathname: jest.fn(() => '/') }));
jest.mock('@/data/telemetryClient', () => ({ trackClientEvent: jest.fn(async () => undefined) }));
jest.mock('@/data/productTelemetry', () => ({
  ...jest.requireActual('@/data/productTelemetry'),
  trackScreenViewed: jest.fn(),
}));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

let renderer: any;
function show(pathname: string, enabled = true) {
  (usePathname as jest.Mock).mockReturnValue(pathname);
  act(() => {
    if (renderer) renderer.update(<ProductTelemetryTracker enabled={enabled} />);
    else renderer = TestRenderer.create(<ProductTelemetryTracker enabled={enabled} />);
  });
}

const views = () => (trackScreenViewed as jest.Mock).mock.calls;

describe('ProductTelemetryTracker', () => {
  beforeEach(() => jest.clearAllMocks());

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('counts each new screen with the one before it', () => {
    show('/');
    show('/pub');
    show('/pub');
    show('/');
    expect(views()).toEqual([
      ['compass', undefined],
      ['pub_page', 'compass'],
      ['compass', 'pub_page'],
    ]);
  });

  it('waits for account hydration', () => {
    show('/pub', false);
    expect(views()).toEqual([]);
    show('/pub', true);
    expect(views()).toEqual([['pub_page', undefined]]);
  });
});
