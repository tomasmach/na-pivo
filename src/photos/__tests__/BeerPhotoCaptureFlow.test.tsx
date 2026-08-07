/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPick = jest.fn(async () => ({ status: 'picked' as const, uri: 'file:///picked.jpg' }));

jest.mock('@/data/beerPhotoPicker', () => ({
  pickAndPrepareBeerPhoto: mockPick,
}));
jest.mock('@/components/shared/AppDialog', () => ({ showAppDialog: jest.fn() }));
jest.mock('@/components/shared/IconGlyph', () => ({
  CameraIcon: () => null,
  InfoIcon: () => null,
}));
jest.mock('@/compass/permissions', () => ({ openSystemSettings: jest.fn() }));
jest.mock('@/photos/BeerPhotoSourceSheet', () => ({ BeerPhotoSourceSheet: () => null }));
jest.mock('@/photos/BeerPhotoComposeSheet', () => {
  const ReactModule: typeof import('react') = jest.requireActual('react');
  return {
    BeerPhotoComposeSheet: (props: Record<string, unknown>) =>
      ReactModule.createElement('BeerPhotoComposeSheet', props),
  };
});
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: unknown) => unknown) => selector({ show: jest.fn() }),
}));
jest.mock('@/stores/beerPhotosStore', () => ({
  useBeerPhotosStore: { getState: () => ({ photos: [] }) },
}));

import { BeerPhotoCaptureFlow } from '@/photos/BeerPhotoCaptureFlow';

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

describe('BeerPhotoCaptureFlow Party context', () => {
  it('forwards an offline drinking day to the compose sheet', async () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      renderer = TestRenderer.create(
        <BeerPhotoCaptureFlow
          open
          directSource="camera"
          onClose={jest.fn()}
          partyCode={null}
          pendingPartyCode="PIVOXY"
          partyDrinkingDay="2026-08-05"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renderer!.root.findByType('BeerPhotoComposeSheet').props).toMatchObject({
      pickedUri: 'file:///picked.jpg',
      partyCode: null,
      pendingPartyCode: 'PIVOXY',
      partyDrinkingDay: '2026-08-05',
    });
  });
});
