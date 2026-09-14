import React from 'react';

import { fetchPubHours, type PubHoursResult } from '@/data/hoursClient';
import type { Pub } from '@/data/pubs';

import { usePubDetails } from '../usePubDetails';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/data/hoursClient', () => ({ fetchPubHours: jest.fn() }));


const TestRenderer = jest.requireActual('react-test-renderer');
const { act } = TestRenderer;

const PUB: Pub = {
  id: 'pub-1',
  name: 'Hospoda U Testu',
  lat: 50.08,
  lng: 14.43,
  city: 'Praha',
  hoursStatus: 'pending',
  isOpenNow: null,
};

function result(overrides: Partial<PubHoursResult> = {}): PubHoursResult {
  return {
    openingHours: null,
    isOpenNow: null,
    nextChange: null,
    status: 'pending',
    source: null,
    communityHours: null,
    beers: [],
    historicalBeers: [],
    beersUpdatedAt: null,
    beerMenuRotates: false,
    hoursUpdatedAt: null,
    rating: null,
    ratingCount: null,
    ratingLabel: null,
    hasGarden: null,
    venueKind: 'unknown',
    ...overrides,
  };
}

function Probe() {
  const pub = usePubDetails(PUB);
  return React.createElement('Probe', { status: pub.hoursStatus, open: pub.isOpenNow });
}

describe('usePubDetails', () => {
  const mockedFetch = fetchPubHours as jest.MockedFunction<typeof fetchPubHours>;

  beforeEach(() => {
    jest.useFakeTimers();
    mockedFetch.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stops showing a pending lookup after the detail timeout', async () => {
    mockedFetch.mockResolvedValue(new Map([[PUB.id, result()]]));
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<Probe />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(renderer!.root.findByType('Probe').props.status).toBe('pending');

    act(() => {
      jest.advanceTimersByTime(3_000);
    });
    expect(renderer!.root.findByType('Probe').props.status).toBe('unknown');

    await act(async () => {
      jest.advanceTimersByTime(7_000);
      await Promise.resolve();
    });
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(renderer!.root.findByType('Probe').props.status).toBe('unknown');
  });

  it('replaces the fallback when a retry resolves the hours', async () => {
    mockedFetch
      .mockResolvedValueOnce(new Map([[PUB.id, result()]]))
      .mockResolvedValueOnce(
        new Map([
          [
            PUB.id,
            result({
              status: 'ok',
              isOpenNow: true,
              openingHours: 'Mo-Su 11:00-23:00',
            }),
          ],
        ]),
      );
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<Probe />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(renderer!.root.findByType('Probe').props).toMatchObject({ status: 'ok', open: true });
  });

  it('settles a pending input even when the backend response is empty', async () => {
    mockedFetch.mockResolvedValue(new Map());
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<Probe />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      jest.advanceTimersByTime(3_000);
    });

    expect(renderer!.root.findByType('Probe').props.status).toBe('unknown');
  });
});
