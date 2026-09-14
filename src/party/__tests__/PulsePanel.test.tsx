/* eslint-disable import/first */

import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

jest.mock('@/mocks/livePartyStore', () => ({
  formatStopwatch: () => '12:34:56',
  useNightSeconds: () => 45296,
}));

import { PulsePanel } from '@/party/PulsePanel';

it('shrinks long stopwatch values instead of truncating them', () => {
  const view = render(
    <PulsePanel
      startedAt={Date.now() - 45296 * 1000}
      stats={[
        { value: '12', unit: 'tvoje piva' },
        { value: '34', unit: 'celkem piv' },
      ]}
    />,
  );

  const timer = view.UNSAFE_getAllByType(Text).find((node) => node.props.children === '12:34:56');
  expect(timer?.props).toMatchObject({
    adjustsFontSizeToFit: true,
    minimumFontScale: 0.7,
    numberOfLines: 1,
  });
});
