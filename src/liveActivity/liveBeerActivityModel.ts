import { normalizeDrinkType, type ServingType } from '@/drinks/drinkTypes';
import type { TallySession } from '@/stores/tallyStore';
import { sessionCount, sessionTotalCzk } from '@/stores/tallyStore';
import { formatPrice, type PriceCurrency } from '@/utils/currency';

export interface BeerEveningLiveActivityProps {
  sessionId: string;
  pubName: string;
  beerCount: number;
  totalPrice: string;
  latestBeerName: string;
  /** Localized wall-clock time such as "21:47" of the latest counted beer. */
  latestBeerAt: string;
  /** Exact metadata repeated by a native `+ pivo` action. Not rendered. */
  repeatBeerName: string;
  repeatBeerPriceCzk?: number;
  repeatBeerVolumeMl?: number;
  repeatBeerServingType?: ServingType;
  /** iOS only: AppIntent buttons require iOS 17; older versions deep-link. */
  supportsInteractiveAdd?: boolean;
  /** iOS only: `file://` URI of the staged app icon in the app-group container. */
  iconUri?: string;
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

function formatWallClock(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('cs-CZ', { hour: 'numeric', minute: '2-digit' });
}

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

  const props: BeerEveningLiveActivityProps = {
    sessionId: session.clientId,
    pubName: preferences.hidePubNames
      ? 'Pivní večer'
      : compactLabel(session.pubName, 'Pivní večer'),
    beerCount,
    totalPrice: hasKnownPrice
      ? formatPrice(sessionTotalCzk(session), preferences.priceCurrency)
      : '',
    latestBeerName: latestBeer ? compactLabel(latestBeer.beerName, 'Pivo') : '',
    latestBeerAt: formatWallClock(latestBeer?.at),
    repeatBeerName: latestBeer?.beerName.trim().slice(0, 120) || 'Pivo',
  };
  if (typeof latestBeer?.priceCzk === 'number') props.repeatBeerPriceCzk = latestBeer.priceCzk;
  if (typeof latestBeer?.volumeMl === 'number') props.repeatBeerVolumeMl = latestBeer.volumeMl;
  if (latestBeer?.servingType) props.repeatBeerServingType = latestBeer.servingType;
  return props;
}
