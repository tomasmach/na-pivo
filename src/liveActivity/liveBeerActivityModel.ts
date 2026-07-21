import { normalizeDrinkType } from '@/drinks/drinkTypes';
import type { TallySession } from '@/stores/tallyStore';
import { sessionCount, sessionTotalCzk } from '@/stores/tallyStore';
import { formatPrice, type PriceCurrency } from '@/utils/currency';

export interface BeerEveningLiveActivityProps {
  sessionId: string;
  pubName: string;
  beerCount: number;
  totalPrice: string;
  latestBeerName: string;
}

export function shouldRequestAndroidNotificationPermission(
  previous: BeerEveningLiveActivityProps | null | undefined,
  next: BeerEveningLiveActivityProps | null,
): boolean {
  if (!next || previous === undefined) return false;
  return (
    previous === null ||
    previous.sessionId !== next.sessionId ||
    next.beerCount > previous.beerCount
  );
}

interface LiveBeerActivityPreferences {
  hidePubNames: boolean;
  priceCurrency: PriceCurrency;
}

const MAX_LABEL_LENGTH = 64;

function compactLabel(value: string, fallback: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return fallback;
  if (normalized.length <= MAX_LABEL_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_LABEL_LENGTH - 1).trimEnd()}…`;
}

/**
 * Builds the small, privacy-conscious payload shared by iOS and Android.
 * A session containing only wine/soft drinks/shots is not a beer-counting
 * activity and therefore stays off the lock screen.
 */
export function buildBeerEveningLiveActivityProps(
  session: TallySession | null,
  preferences: LiveBeerActivityPreferences,
): BeerEveningLiveActivityProps | null {
  const beerCount = sessionCount(session);
  if (!session || beerCount === 0) return null;

  const latestBeer = [...session.drinks]
    .reverse()
    .find((drink) => normalizeDrinkType(drink.drinkType) === 'beer');
  const hasKnownPrice = session.drinks.some((drink) => typeof drink.priceCzk === 'number');

  return {
    sessionId: session.clientId,
    pubName: preferences.hidePubNames
      ? 'Pivní večer'
      : compactLabel(session.pubName, 'Pivní večer'),
    beerCount,
    totalPrice: hasKnownPrice
      ? formatPrice(sessionTotalCzk(session), preferences.priceCurrency)
      : '',
    latestBeerName: latestBeer ? compactLabel(latestBeer.beerName, 'Pivo') : '',
  };
}
