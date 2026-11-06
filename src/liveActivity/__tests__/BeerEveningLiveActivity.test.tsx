import type { ReactNode } from 'react';

import BeerEveningLiveActivity, {
  type BeerEveningLiveActivityProps,
} from '@/liveActivity/BeerEveningLiveActivity';
import { buildBeerEveningLiveActivityProps } from '@/liveActivity/liveBeerActivityModel';
import { t } from '@/i18n';

jest.mock('expo-widgets', () => ({
  createLiveActivity: (_name: string, layout: unknown) => layout,
}));
jest.mock('@expo/ui/swift-ui', () => {
  const component = (props: { children?: unknown }) => props.children ?? null;
  return {
    Button: component,
    HStack: component,
    Image: component,
    Link: component,
    Spacer: component,
    Text: component,
    VStack: component,
  };
});
jest.mock('@expo/ui/swift-ui/modifiers', () => {
  const anyModifier: object = new Proxy(() => ({}), { get: () => anyModifier });
  return anyModifier;
});

type Layout = (
  props: BeerEveningLiveActivityProps,
  environment: Record<string, unknown>,
) => Record<string, ReactNode>;

function texts(node: unknown): string[] {
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  if (node && typeof node === 'object' && 'props' in node) {
    return texts((node as { props: { children?: unknown } }).props.children);
  }
  return [];
}

describe('BeerEveningLiveActivity', () => {
  it('shows the count, time and hidden total the lock-screen + pivo wrote before the app reopens', () => {
    const layout = BeerEveningLiveActivity as unknown as Layout;
    const fromApp = buildBeerEveningLiveActivityProps(
      {
        clientId: 'session-1',
        pubKey: 'u-tygra',
        pubName: 'U Zlatého tygra',
        startedAt: '2026-07-21T18:00:00.000Z',
        drinks: [
          { id: 'beer-1', beerName: 'Plzeň 12°', priceCzk: 65, at: '2026-07-21T18:00:00.000Z' },
        ],
      },
      { hidePubNames: false, priceCurrency: 'CZK' },
    );
    // The native intent bumps the count, rewrites `latestBeerAt` and clears the
    // total it cannot recalculate.
    const afterIntent = { ...fromApp!, beerCount: 2, latestBeerAt: '22:10', totalPrice: '' };

    const rendered = layout(afterIntent, {});

    expect(texts(rendered.banner)).toEqual(
      expect.arrayContaining([t.liveActivity.beerWord(2), t.liveActivity.latestAt('22:10')]),
    );
    expect(texts(rendered.banner)).not.toContain(fromApp!.totalPriceLabel);
    expect(texts(rendered.expandedBottom)).toContain(t.liveActivity.latestAt('22:10'));
  });
});
