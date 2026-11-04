import React from 'react';

import { fetchMyStats } from '@/data/statsClient';

import { useMyStatsState } from '../useMyStats';

jest.mock('@/data/statsClient', () => ({ fetchMyStats: jest.fn() }));
jest.mock('@/data/deleteDrinksQueue', () => ({ getConfirmedDeleteIds: () => new Set(), getQueuedDeleteIds: async () => [] }));
jest.mock('@/stores/accountStore', () => {
  const state = { session: { accountId: 'a1' }, removedDrinkIds: new Set() };
  return { useAccountStore: (select: (s: typeof state) => unknown) => select(state) };
});

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

function probe() {
  const seen: { stats: unknown; settled: boolean }[] = [];
  function Probe() {
    seen.push(useMyStatsState());
    return null;
  }
  return { seen, Probe };
}

it('reports a failed fetch as settled without stats, so the screen does not claim there is nothing', async () => {
  (fetchMyStats as jest.Mock).mockResolvedValue(null);
  const { seen, Probe } = probe();

  await act(async () => {
    TestRenderer.create(React.createElement(Probe));
  });

  expect(seen[0]).toEqual({ stats: null, settled: false });
  expect(seen[seen.length - 1]).toEqual({ stats: null, settled: true });
});
