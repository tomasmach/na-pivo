import {
  buildBeerEveningLiveActivityProps,
  shouldRequestAndroidNotificationPermission,
  type BeerEveningLiveActivityProps,
} from '@/liveActivity/liveBeerActivityModel';
import { intlLocale, t } from '@/i18n';
import type { TallySession } from '@/stores/tallyStore';

function session(overrides: Partial<TallySession> = {}): TallySession {
  return {
    clientId: 'session-1',
    pubKey: 'u-tygra',
    pubName: 'U Zlatého tygra',
    startedAt: '2026-07-21T18:00:00.000Z',
    drinks: [
      {
        id: 'beer-1',
        beerName: 'Plzeň 12°',
        priceCzk: 65,
        at: '2026-07-21T18:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

describe('buildBeerEveningLiveActivityProps', () => {
  it('builds the shared lock-screen payload from a live beer evening', () => {
    const result = buildBeerEveningLiveActivityProps(session(), {
      hidePubNames: false,
      priceCurrency: 'CZK',
    });

    const latestBeerAt = new Date('2026-07-21T18:00:00.000Z').toLocaleTimeString(intlLocale, {
      hour: 'numeric',
      minute: '2-digit',
    });
    expect(result).toEqual<BeerEveningLiveActivityProps>({
      sessionId: 'session-1',
      pubName: 'U Zlatého tygra',
      beerCount: 1,
      totalPrice: '65 Kč',
      latestBeerName: 'Plzeň 12°',
      latestBeerAt,
      // The widget runtime has no strings file, so every word it draws is
      // built here and travels with the payload.
      beerWordLabel: t.liveActivity.beerWord(1),
      beerCountA11yLabel: t.liveActivity.beerCountA11y(1),
      totalPriceLabel: t.liveActivity.total('65 Kč'),
      latestBeerLabel: 'Plzeň 12°',
      latestTimeLabel: t.liveActivity.latestAt(latestBeerAt),
      addBeerLabel: t.liveActivity.addBeer,
      addBeerA11yLabel: t.liveActivity.addBeerA11y,
      openCounterLabel: t.liveActivity.openCounter,
      repeatBeerName: 'Plzeň 12°',
      repeatBeerPriceCzk: 65,
    });
  });

  it('does not start for an empty or non-beer-only evening', () => {
    expect(
      buildBeerEveningLiveActivityProps(null, {
        hidePubNames: false,
        priceCurrency: 'CZK',
      }),
    ).toBeNull();
    expect(
      buildBeerEveningLiveActivityProps(
        session({
          drinks: [
            {
              id: 'water-1',
              beerName: 'Voda',
              drinkType: 'soft_drink',
              at: '2026-07-21T18:00:00.000Z',
            },
          ],
        }),
        { hidePubNames: false, priceCurrency: 'CZK' },
      ),
    ).toBeNull();
  });

  it('hides the pub name and omits an unknown total', () => {
    const result = buildBeerEveningLiveActivityProps(
      session({ drinks: [{ id: 'beer-1', beerName: 'Domácí ležák', at: '2026-07-21T18:00:00.000Z' }] }),
      { hidePubNames: true, priceCurrency: 'CZK' },
    );

    expect(result).toMatchObject({
      pubName: t.liveActivity.pubFallback,
      totalPrice: '',
      totalPriceLabel: '',
      latestBeerName: 'Domácí ležák',
      repeatBeerName: 'Domácí ležák',
    });
  });

  it('uses the newest beer even when another drink was logged after it', () => {
    const result = buildBeerEveningLiveActivityProps(
      session({
        drinks: [
          { id: 'beer-1', beerName: 'Kozel', priceCzk: 50, at: '2026-07-21T18:00:00.000Z' },
          {
            id: 'shot-1',
            beerName: 'Slivovice',
            drinkType: 'shot',
            priceCzk: 60,
            at: '2026-07-21T18:10:00.000Z',
          },
        ],
      }),
      { hidePubNames: false, priceCurrency: 'CZK' },
    );

    expect(result).toMatchObject({
      beerCount: 1,
      totalPrice: '110 Kč',
      latestBeerName: 'Kozel',
    });
  });
});

describe('shouldRequestAndroidNotificationPermission', () => {
  const oneBeer = buildBeerEveningLiveActivityProps(session(), {
    hidePubNames: false,
    priceCurrency: 'CZK',
  })!;

  it('stays silent on cold restore but prompts for a foreground beer transition', () => {
    expect(shouldRequestAndroidNotificationPermission(undefined, oneBeer)).toBe(false);
    expect(shouldRequestAndroidNotificationPermission(null, oneBeer)).toBe(true);
    expect(
      shouldRequestAndroidNotificationPermission(oneBeer, {
        ...oneBeer,
        beerCount: 2,
      }),
    ).toBe(true);
  });

  it('does not prompt for a display-only update', () => {
    expect(
      shouldRequestAndroidNotificationPermission(oneBeer, {
        ...oneBeer,
        pubName: t.liveActivity.pubFallback,
      }),
    ).toBe(false);
  });
});
