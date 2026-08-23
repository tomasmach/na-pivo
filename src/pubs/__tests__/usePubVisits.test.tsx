import React from 'react';

import { fetchVisits, type WireVisit } from '@/data/visitsClient';

import { usePubVisits } from '../usePubVisits';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/data/visitsClient', () => ({
  fetchVisits: jest.fn(),
}));

jest.mock('@/data/visitsSnapshot', () => {
  let generation = 0;
  const listeners = new Set<() => void>();
  return {
    // Mirrors clearVisitsSnapshot() at an account boundary: bump the generation
    // first, then notify mounted hooks so they drop the previous account's data.
    __bumpBoundary: () => {
      generation += 1;
      for (const listener of listeners) listener();
    },
    visitsSnapshotGeneration: () => generation,
    subscribeVisitsBoundary: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    loadVisitsSnapshot: jest.fn(() => Promise.resolve([])),
    saveVisitsSnapshot: jest.fn(async () => {}),
  };
});

jest.mock('@/stores/accountStore', () => {
  const React = jest.requireActual('react');
  const subscribers = new Set<() => void>();
  const session = { accountId: null as string | null };
  const state = { session };
  return {
    useAccountStore: <T,>(selector: (s: typeof state) => T): T =>
      React.useSyncExternalStore(
        (listener: () => void) => {
          subscribers.add(listener);
          return () => {
            subscribers.delete(listener);
          };
        },
        () => selector(state),
        () => selector(state),
      ),
    __setAccountId: (accountId: string | null) => {
      session.accountId = accountId;
      for (const listener of subscribers) listener();
    },
    __reset: () => {
      session.accountId = null;
      subscribers.clear();
    },
  };
});

const snapshotModule = jest.requireMock('@/data/visitsSnapshot') as {
  __bumpBoundary: () => void;
  loadVisitsSnapshot: jest.Mock;
  saveVisitsSnapshot: jest.Mock;
};

const accountStoreModule = jest.requireMock('@/stores/accountStore') as {
  __setAccountId: (accountId: string | null) => void;
  __reset: () => void;
};

function visit(id: string): WireVisit {
  return {
    client_id: id,
    cache_key: `cache-${id}`,
    name: `Hospoda ${id}`,
    lat: 50.08,
    lng: 14.43,
    city: 'Praha',
    external_id: null,
    started_at: '2026-08-01T19:00:00Z',
    ended_at: null,
    updated_at: '2026-08-01T22:00:00Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function Probe() {
  const visits = usePubVisits();
  return React.createElement('Probe', { visits });
}

function currentVisits(renderer: ReturnType<typeof TestRenderer.create>): WireVisit[] {
  return renderer.root.findByType('Probe').props.visits as WireVisit[];
}

async function settle(): Promise<void> {
  await TestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const TestRenderer = jest.requireActual('react-test-renderer');

describe('usePubVisits account boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchVisits as jest.Mock).mockResolvedValue(null);
    accountStoreModule.__reset();
    accountStoreModule.__setAccountId('account-a');
  });

  it('keeps a same-account cached list when its refresh is offline', async () => {
    snapshotModule.loadVisitsSnapshot.mockResolvedValueOnce([visit('a1')]);
    (fetchVisits as jest.Mock).mockResolvedValueOnce(null);

    let renderer: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });
    await settle();

    expect(currentVisits(renderer!)).toEqual([visit('a1')]);
    expect(fetchVisits).toHaveBeenCalledTimes(1);
    const signal = (fetchVisits as jest.Mock).mock.calls[0][0] as AbortSignal | undefined;
    expect(signal?.aborted).toBe(false);
  });

  it('never hydrates cache for account B after in-process A -> B while offline', async () => {
    // Account A mounts; its remote fetch stays pending across the switch.
    const cacheA = deferred<WireVisit[]>();
    const remoteA = deferred<WireVisit[] | null>();
    snapshotModule.loadVisitsSnapshot.mockReturnValueOnce(cacheA.promise);
    (fetchVisits as jest.Mock).mockReturnValueOnce(remoteA.promise);

    let renderer: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });
    await settle();
    expect(currentVisits(renderer!)).toEqual([]);

    cacheA.resolve([visit('a1')]);
    await settle();
    expect(currentVisits(renderer!)).toEqual([visit('a1')]);

    // Boundary to account B. Storage still hands out A's raw snapshot until
    // the real clear lands, so the hook must not read it for B at all.
    snapshotModule.loadVisitsSnapshot.mockResolvedValue([visit('b1')]);
    (fetchVisits as jest.Mock).mockResolvedValueOnce(null);

    await TestRenderer.act(async () => {
      snapshotModule.__bumpBoundary();
      accountStoreModule.__setAccountId('account-b');
    });
    await settle();

    // The loader ran only for A; B gets a fresh server fetch instead, with
    // A's request aborted and B's still live.
    expect(snapshotModule.loadVisitsSnapshot).toHaveBeenCalledTimes(1);
    expect((fetchVisits as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
    const firstSignal = (fetchVisits as jest.Mock).mock.calls[0][0] as AbortSignal | undefined;
    expect(firstSignal?.aborted).toBe(true);
    const secondSignal = (fetchVisits as jest.Mock).mock.calls[1][0] as AbortSignal | undefined;
    expect(secondSignal?.aborted).toBe(false);

    // Offline B sees nothing, never account A's data...
    expect(currentVisits(renderer!)).toEqual([]);

    // ...and A's late remote response must not change that.
    remoteA.resolve([visit('a2')]);
    await settle();
    expect(currentVisits(renderer!)).toEqual([]);
  });

  it('ignores a late account A cache resolution after switching to B', async () => {
    const cacheA = deferred<WireVisit[]>();
    snapshotModule.loadVisitsSnapshot.mockReturnValueOnce(cacheA.promise);
    (fetchVisits as jest.Mock).mockResolvedValueOnce(null); // A offline

    let renderer: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });

    // Switch to B before A's cache even reads back. B must not read storage.
    snapshotModule.loadVisitsSnapshot.mockResolvedValue([visit('b1')]);
    (fetchVisits as jest.Mock).mockResolvedValue(null); // B offline too
    await TestRenderer.act(async () => {
      snapshotModule.__bumpBoundary();
      accountStoreModule.__setAccountId('account-b');
    });
    await settle();

    // Offline B shows [], the loader ran only for A...
    expect(currentVisits(renderer!)).toEqual([]);
    expect(snapshotModule.loadVisitsSnapshot).toHaveBeenCalledTimes(1);

    // ...and A's late cache resolution changes nothing.
    cacheA.resolve([visit('a1')]);
    await settle();
    expect(currentVisits(renderer!)).toEqual([]);
    expect(snapshotModule.saveVisitsSnapshot).not.toHaveBeenCalledWith(
      [visit('a1')],
      expect.anything(),
    );
  });
});

describe('usePubVisits privacy ordering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchVisits as jest.Mock).mockResolvedValue(null);
    accountStoreModule.__reset();
    accountStoreModule.__setAccountId('account-a');
  });

  it('never flashes account A raw cache under B switched before the boundary', async () => {
    // Cold mount for A: same-account cache guard, A remote offline.
    snapshotModule.loadVisitsSnapshot.mockResolvedValueOnce([visit('a1')]);
    (fetchVisits as jest.Mock).mockResolvedValueOnce(null);

    let renderer: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });
    await settle();
    expect(currentVisits(renderer!)).toEqual([visit('a1')]);
    expect(fetchVisits).toHaveBeenCalledTimes(1);

    // Storage was never cleared yet: it still hands out A's raw snapshot,
    // and every later remote read is offline.
    snapshotModule.loadVisitsSnapshot.mockResolvedValue([visit('a1')]);
    (fetchVisits as jest.Mock).mockResolvedValue(null);

    // Account flips to B first, and the rerender/effects fully settle
    // BEFORE any boundary bump. B is a brand-new in-process account, so
    // no cache hydration is legitimate for it; offline means [].
    await TestRenderer.act(async () => {
      accountStoreModule.__setAccountId('account-b');
    });
    await settle();

    expect(currentVisits(renderer!)).toEqual([]);
    expect(snapshotModule.saveVisitsSnapshot).not.toHaveBeenCalledWith(
      [visit('a1')],
      expect.anything(),
    );

    // Only now the boundary fires — still no A under B.
    await TestRenderer.act(async () => {
      snapshotModule.__bumpBoundary();
    });
    await settle();

    expect(currentVisits(renderer!)).toEqual([]);
  });

  it('drops A data when the boundary settles before the switch to B', async () => {
    snapshotModule.loadVisitsSnapshot.mockResolvedValueOnce([visit('a1')]);
    (fetchVisits as jest.Mock).mockResolvedValueOnce(null);

    let renderer: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });
    await settle();
    expect(currentVisits(renderer!)).toEqual([visit('a1')]);

    // Boundary fires first and fully settles while A still owns the screen;
    // cleared storage yields nothing.
    snapshotModule.loadVisitsSnapshot.mockResolvedValue([]);
    (fetchVisits as jest.Mock).mockResolvedValue(null);
    await TestRenderer.act(async () => {
      snapshotModule.__bumpBoundary();
    });
    await settle();

    expect(currentVisits(renderer!)).toEqual([]);

    // Then the switch to a brand-new account B: no cache hydration expected,
    // remote offline, so [] — and no A snapshot saved under B.
    await TestRenderer.act(async () => {
      accountStoreModule.__setAccountId('account-b');
    });
    await settle();

    expect(currentVisits(renderer!)).toEqual([]);
    expect(snapshotModule.saveVisitsSnapshot).not.toHaveBeenCalledWith(
      [visit('a1')],
      expect.anything(),
    );
  });

  it('reads neither cache nor server for a signed-out session on mount', async () => {
    accountStoreModule.__reset();

    let renderer: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });
    await settle();

    expect(currentVisits(renderer!)).toEqual([]);
    expect(snapshotModule.loadVisitsSnapshot).not.toHaveBeenCalled();
    expect(fetchVisits).not.toHaveBeenCalled();
    expect(snapshotModule.saveVisitsSnapshot).not.toHaveBeenCalled();
  });
});
