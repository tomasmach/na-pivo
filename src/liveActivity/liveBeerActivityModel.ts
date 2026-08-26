import { normalizeDrinkType, type ServingType } from '@/drinks/drinkTypes';
import { intlLocale, t } from '@/i18n';
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
  // — Everything the iOS widget renders as words. The widget runtime is
  //   isolated and has no access to the strings file, so the labels are built
  //   here and travel with the payload. Keep them short: 4 KB for the lot.
  /** The noun under the numeral, already declined: "piva" / "beers". */
  beerWordLabel: string;
  /** VoiceOver label for the bare number in the compact/minimal presentations. */
  beerCountA11yLabel: string;
  /** "Celkem 245 Kč"; empty when the total is unknown. */
  totalPriceLabel: string;
  /** The latest beer's name, or a fallback when it has none. */
  latestBeerLabel: string;
  /** "naposled v 21:47", or the line for an evening with no beer time yet. */
  latestTimeLabel: string;
  addBeerLabel: string;
  addBeerA11yLabel: string;
  openCounterLabel: string;
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
  return date.toLocaleTimeString(intlLocale, { hour: 'numeric', minute: '2-digit' });
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

  const totalPrice = hasKnownPrice
    ? formatPrice(sessionTotalCzk(session), preferences.priceCurrency)
    : '';
  const latestBeerName = latestBeer
    ? compactLabel(latestBeer.beerName, t.liveActivity.beerFallback)
    : '';
  const latestBeerAt = formatWallClock(latestBeer?.at);

  const props: BeerEveningLiveActivityProps = {
    sessionId: session.clientId,
    pubName: preferences.hidePubNames
      ? t.liveActivity.pubFallback
      : compactLabel(session.pubName, t.liveActivity.pubFallback),
    beerCount,
    totalPrice,
    latestBeerName,
    latestBeerAt,
    beerWordLabel: t.liveActivity.beerWord(beerCount),
    beerCountA11yLabel: t.liveActivity.beerCountA11y(beerCount),
    totalPriceLabel: totalPrice ? t.liveActivity.total(totalPrice) : '',
    latestBeerLabel: latestBeerName || t.liveActivity.latestBeerFallback,
    latestTimeLabel: latestBeerAt
      ? t.liveActivity.latestAt(latestBeerAt)
      : t.liveActivity.firstBeerPouring,
    addBeerLabel: t.liveActivity.addBeer,
    addBeerA11yLabel: t.liveActivity.addBeerA11y,
    openCounterLabel: t.liveActivity.openCounter,
    repeatBeerName: latestBeer?.beerName.trim().slice(0, 120) || t.liveActivity.beerFallback,
  };
  if (typeof latestBeer?.priceCzk === 'number') props.repeatBeerPriceCzk = latestBeer.priceCzk;
  if (typeof latestBeer?.volumeMl === 'number') props.repeatBeerVolumeMl = latestBeer.volumeMl;
  if (latestBeer?.servingType) props.repeatBeerServingType = latestBeer.servingType;
  return props;
}
