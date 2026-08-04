/**
 * Počítadlo — the "Tácek" surface.
 *
 * The screen is four blocks and nothing else:
 *   1. place chip (tap = change place) + a "…" overflow button,
 *   2. the coaster: čárky for tonight's beers + one meta line + the "Účet" door,
 *   3. one nudge slot — never two nudges at once, fixed height so nothing jumps,
 *   4. ONE amber button in the thumb arc whose label always states exactly what
 *      a tap will do ("Co si dáš?" / "Ještě jedno" / "Zapiš první pivo" / …).
 *
 * Everything else is a named sheet one tap deep: "Co si dáš?" only adds,
 * "Tvůj účet" only removes and closes, "Co ještě?" holds the rest. That split is
 * the whole design: at any moment there is exactly one obvious thing to press,
 * and adding a beer exists exactly once on the surface.
 *
 * The data rules are unchanged from the old counter: every count writes to the
 * local tally store, enqueues a /v1/drinks POST (held back for the undo window,
 * then flushed), merges the beer into the local community menu so the price
 * shows everywhere instantly, and refreshes the evening's visit record. Nothing
 * here awaits the network — the whole flow works offline.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { cs, formatVolume } from '@/i18n/cs';
import {
  beerCountLabel,
  beerNoun,
  shotCountLabel,
  softDrinkCountLabel,
  wineCountLabel,
} from '@/i18n/plural';
import { GlowButton } from '@/components/shared/GlowButton';
import {
  BeerIcon,
  HouseIcon,
  MenuIcon,
  CameraIcon,
  InfoIcon,
  GlassWaterIcon,
  WineIcon,
  CircleDotIcon,
} from '@/components/shared/IconGlyph';

import { geohash8 } from '@/data/geohash';
import { generateUuidV4 } from '@/data/account';
import {
  mergeBeerIntoMenu,
  isSameBeerIdentity,
  normalizeBeerName,
  type CommunityBeer,
} from '@/data/communityHours';
import { fetchPubHours } from '@/data/hoursClient';
import { buildDrinkEntry } from '@/data/drinksClient';
import { scanMenuPhoto, type ScannedDrink } from '@/data/menuScanClient';
import type { MenuPhotoSource } from '@/data/menuPhotoPicker';
import { enqueueDrink, flushDrinksQueue, isDrinkQueued, removeQueuedDrink } from '@/data/drinksQueue';
import { enqueueDelete } from '@/data/deleteDrinksQueue';
import { deleteVisitByClientId, syncVisit } from '@/data/visitsSync';
import { shareFriendPubActivity } from '@/data/friendsClient';
import { enqueueFriendOp, isRetriableFriendError } from '@/data/friendsQueue';
import { trackCounterTabOpened } from '@/data/counterTelemetry';
import { BeerPhotoCaptureFlow } from '@/photos/BeerPhotoCaptureFlow';
import { ShareNightModal } from '@/vycep/ShareNightModal';
import type { NightSummary } from '@/vycep/nightModel';
import { trackClientEvent } from '@/data/telemetryClient';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { fireSuccessHaptic, fireLightImpactHaptic } from '@/utils/haptics';
import {
  isBeerListOverrideCurrent,
  isBeerMenuTypeOverrideCurrent,
  useCommunityStore,
} from '@/stores/communityStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToastStore } from '@/stores/toastStore';
import { formatPrice, pricePlaceholder } from '@/utils/currency';
import {
  useTallyStore,
  sessionCount,
  sessionTotalCzk,
  sessionDrinkTypeCounts,
  resumableSession,
  isPastEveningBackdate,
  type TallyDrink,
  type TallySession,
} from '@/stores/tallyStore';
import {
  contextFromPubKey,
  contextPubKey,
  normalizeDrinkType,
  type DrinkType,
  type OutsidePlaceContext,
  type ServingType,
} from '@/drinks/drinkTypes';
import { MIN_PLAUSIBLE_BEER_GAP_MS } from '@/drinks/drinkTiming';
import type { Pub } from '@/data/pubs';

import { useNearbyPub } from '@/counter/useNearbyPub';
import { PubPickerModal } from '@/counter/PubPickerModal';
import { BeerFormModal, type BeerFormMode, type BeerFormResult } from '@/counter/BeerFormModal';
import { showAppDialog } from '@/components/shared/AppDialog';
import { BeerCheckInSheet } from '@/counter/BeerCheckInSheet';
import { MapPubSheet } from '@/components/amenities/MapPubSheet';
import { pubInfoFromPub } from '@/components/amenities/pubInfoContext';
import { ScanMenuSheet } from '@/components/contribute/ScanMenuSheet';
import { ScannedDrinkPicker } from '@/counter/ScannedDrinkPicker';
import { CounterMoreSheet } from '@/counter/CounterMoreSheet';
import { PlaceChip, type PlaceChipKind } from '@/counter/PlaceChip';
import { CoasterCard } from '@/counter/CoasterCard';
import { CounterQuickActions } from '@/counter/CounterQuickActions';
import { CounterCta } from '@/counter/CounterCta';
import { NudgeSlot, type Nudge } from '@/counter/NudgeSlot';
import { DrinkPickSheet, type DrinkPickRow } from '@/counter/DrinkPickSheet';
import { ReceiptSheet, type ReceiptItem } from '@/counter/ReceiptSheet';
import { WeeklyRankChip } from '@/leaderboards/WeeklyRankChip';
import { refreshBeerCountReminderAfterBeer } from '@/notifications/beerCountReminder';

// ─── Timings ──────────────────────────────────────────────────────────────────

/** How long a freshly-counted drink stays undoable before we deliver it. We
 *  defer the backend send by this window so the queued payload remains
 *  retractable (removeQueuedDrink only works pre-delivery) — otherwise a fast
 *  POST marks the drink 'sent' within a fraction of a second and the undo strip
 *  would offer something we can no longer pull. The launch/foreground flush
 *  still delivers anything left waiting, so a deferred drink is never stranded. */
export const UNDO_WINDOW_MS = 6000;

/** How long we let a sheet slide away before running the action a row picked —
 *  iOS refuses to present a modal while another is still dismissing. */
const SHEET_DISMISS_MS = 260;

/** How long the inline "už jsi pil před chvílí" confirmation waits. Letting it
 *  time out means NO: a tap that trips the guard never writes a drink. */
const RAPID_DECISION_MS = 5000;

/** Idle time after which the surface quietly asks whether the evening is over. */
const DOPITO_IDLE_MS = 90 * 60 * 1000;

// ─── Pure helpers (exported for tests) ────────────────────────────────────────

export function minutesSinceDrink(at: string, nowMs: number = Date.now()): number | null {
  const atMs = Date.parse(at);
  if (!Number.isFinite(atMs)) return null;
  return Math.max(0, Math.floor((nowMs - atMs) / 60000));
}

export function shouldWarnRapidDrink(lastDrinkAt: string | undefined, nowMs: number = Date.now()): boolean {
  if (!lastDrinkAt) return false;
  const atMs = Date.parse(lastDrinkAt);
  if (!Number.isFinite(atMs)) return false;
  const elapsedMs = nowMs - atMs;
  return elapsedMs >= 0 && elapsedMs < MIN_PLAUSIBLE_BEER_GAP_MS;
}

/** A stable identity key for a beer (normalized name + volume). Drinks and menu
 *  rows are matched on it everywhere: counts, the receipt, undo targeting. */
function beerKey(beer: { name: string; volumeMl?: number }): string {
  return `${beer.name.trim().toLowerCase()}|${beer.volumeMl ?? ''}`;
}

function drinkKey(drink: TallyDrink): string {
  return `${drink.beerName.trim().toLowerCase()}|${drink.volumeMl ?? ''}`;
}

interface MenuBeerGroup {
  key: string;
  name: string;
  beers: CommunityBeer[];
}

/** Keep one group per beer name, servings sorted small → large, menu order
 *  otherwise. The pick sheet flattens these back into rows. */
export function groupMenuBeers(menu: CommunityBeer[]): MenuBeerGroup[] {
  const groups = new Map<string, MenuBeerGroup>();

  for (const beer of menu) {
    const key = normalizeBeerName(beer.name);
    const existing = groups.get(key);
    if (existing) {
      existing.beers.push(beer);
    } else {
      groups.set(key, { key, name: beer.name.trim(), beers: [beer] });
    }
  }

  return [...groups.values()].map((group) => ({
    ...group,
    beers: [...group.beers].sort(
      (a, b) => (a.volumeMl ?? Number.POSITIVE_INFINITY) - (b.volumeMl ?? Number.POSITIVE_INFINITY),
    ),
  }));
}

/** "Pilsner Urquell · 0,5 l" — the CTA's sub-line and the receipt's meta. */
function beerLine(beer: { name: string; volumeMl?: number; servingType?: ServingType }): string {
  const serving =
    beer.servingType && beer.servingType !== 'unknown' && beer.servingType !== 'draft'
      ? cs.counter.servingTypeLabel(beer.servingType).toLowerCase()
      : null;
  return [beer.name, serving, beer.volumeMl ? formatVolume(beer.volumeMl) : null]
    .filter(Boolean)
    .join(' · ');
}

/** Leading glyph of the "counted" toast — the drink you just logged, not a
 *  generic beer, so a shot doesn't get confirmed with a half-litre. */
function DrinkToastIcon({ drinkType }: { drinkType: DrinkType }) {
  if (drinkType === 'soft_drink') return <GlassWaterIcon size={18} color={Colors.amber} />;
  if (drinkType === 'wine') return <WineIcon size={18} color={Colors.amber} />;
  if (drinkType === 'shot') return <CircleDotIcon size={18} color={Colors.amber} />;
  return <BeerIcon size={18} color={Colors.amber} />;
}

// ─── Permission gate ──────────────────────────────────────────────────────────

/** The only full-screen state left. It fires once per install, and it always
 *  offers a way past it — counting must never be blocked by a permission. */
function PermissionGate({
  permissionState,
  requestPermission,
  onLogOutside,
  embedded,
}: {
  permissionState: 'denied' | 'undetermined';
  requestPermission: () => Promise<void>;
  onLogOutside: () => void;
  embedded: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.root,
        styles.gate,
        { paddingTop: embedded ? 0 : insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <View style={styles.gateIcon}>
        <BeerIcon size={48} color={Colors.amber} />
      </View>
      <Text style={styles.gateTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
        {cs.counter.permTitle}
      </Text>
      <Text style={styles.gateBody} maxFontSizeMultiplier={FontScaleCap.body}>
        {cs.counter.permBody}
      </Text>
      <View style={styles.gateButton}>
        <GlowButton
          label={cs.counter.permCta}
          onPress={requestPermission}
          glow="soft"
          accessibilityLabel={cs.a11y.counterRequestLocation}
        />
      </View>
      {permissionState === 'denied' && (
        <View style={styles.gateButtonSecondary}>
          <GlowButton
            label={cs.counter.permOpenSettings}
            onPress={() => Linking.openSettings()}
            variant="secondary"
            glow="none"
            height={50}
          />
        </View>
      )}
      <Pressable
        onPress={onLogOutside}
        style={styles.gateLink}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={cs.counter.outsideNoLocationCta}
      >
        <HouseIcon size={16} color={Colors.mutedText} />
        <Text style={styles.gateLinkText} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.counter.outsideNoLocationCta}
        </Text>
      </Pressable>
    </View>
  );
}

// ─── Surface ──────────────────────────────────────────────────────────────────

/** Where the counter counts: a real pub, or one of the "Mimo hospodu" contexts
 *  (home / outdoors / elsewhere) with no pub identity at all. */
export type CounterPlace =
  | { kind: 'pub'; pub: Pub }
  | { kind: 'outside'; context: OutsidePlaceContext };

const OUTSIDE_CHIP_KIND: Record<OutsidePlaceContext, PlaceChipKind> = {
  private: 'private',
  outdoors: 'outdoors',
  other: 'other',
};

/** A beer the surface can count: menu row, repeat target or form result. */
type CountableBeer = CommunityBeer & {
  priceCzk?: number;
  drinkType?: DrinkType;
  servingType?: ServingType;
};

interface TacekProps {
  /** null while GPS is still deciding, or when nothing is close enough. */
  place: CounterPlace | null;
  /** How the place chip should read when `place` is null. */
  unresolvedKind: 'detecting' | 'unknown';
  onChangePlace: () => void;
  onPubRenamed: (newName: string) => void;
  /** Hosted inside the "Štamgast" tab: the parent owns the top inset + segment. */
  embedded: boolean;
  /** Set when the host owns the "…" door (it sits in the segment row up there);
   *  undefined keeps the glyph — and its state — on this screen. */
  moreOpen?: boolean;
  onMoreClose?: () => void;
}

function Tacek({
  place,
  unresolvedKind,
  onChangePlace,
  onPubRenamed,
  embedded,
  moreOpen: moreOpenProp,
  onMoreClose,
}: TacekProps) {
  const insets = useSafeAreaInsets();
  const hapticEnabled = useSettingsStore((s) => s.hapticEnabled);
  const waterNudgeEnabled = useSettingsStore((s) => s.waterNudgeEnabled);
  const priceCurrency = useSettingsStore((s) => s.priceCurrency);
  const showToast = useToastStore((s) => s.show);
  const topInset = embedded ? 0 : insets.top;

  const pub = place?.kind === 'pub' ? place.pub : null;
  const outsideContext = place?.kind === 'outside' ? place.context : null;
  const placeLabel = place
    ? pub
      ? pub.name
      : cs.counter.outsideLabel(outsideContext as OutsidePlaceContext)
    : unresolvedKind === 'detecting'
      ? cs.counter.detecting
      : cs.counter.placeUnknown;
  const chipKind: PlaceChipKind = place
    ? pub
      ? 'pub'
      : OUTSIDE_CHIP_KIND[outsideContext as OutsidePlaceContext]
    : unresolvedKind;

  /** The tally identity of this place — null until a place is resolved. */
  const cell = useMemo(() => {
    if (!place) return null;
    return place.kind === 'pub' ? geohash8(place.pub.lat, place.pub.lng) : contextPubKey(place.context);
  }, [place]);

  const setOverride = useCommunityStore((s) => s.setOverride);
  const override = useCommunityStore((s) => (cell ? s.overrides[cell] : undefined));

  const current = useTallyStore((s) => s.current);
  const history = useTallyStore((s) => s.history);
  const addDrink = useTallyStore((s) => s.addDrink);
  const addBackdatedDrink = useTallyStore((s) => s.addBackdatedDrink);
  const removeDrink = useTallyStore((s) => s.removeDrink);
  const markDrinkSynced = useTallyStore((s) => s.markDrinkSynced);
  const archiveCurrent = useTallyStore((s) => s.archiveCurrent);
  const resumeLast = useTallyStore((s) => s.resumeLast);

  // — Sheets and modals —
  const [pickOpen, setPickOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [ownMoreOpen, setOwnMoreOpen] = useState(false);
  const [mapPubOpen, setMapPubOpen] = useState(false);
  const [scanSourceVisible, setScanSourceVisible] = useState(false);
  const [photoCaptureOpen, setPhotoCaptureOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [checkInSheetOpen, setCheckInSheetOpen] = useState(false);

  // — Beer form —
  const [formMode, setFormMode] = useState<BeerFormMode | null>(null);
  const [formBeer, setFormBeer] = useState<CommunityBeer | null>(null);
  const [formDrinkType, setFormDrinkType] = useState<DrinkType>('beer');
  const [formNonce, setFormNonce] = useState(0);
  /** Outside a pub: the serving the user last picked, seeding the next form. */
  const [lastServingType, setLastServingType] = useState<ServingType>('bottle');
  /** Set when the form was opened via "zapsat zpětně" — the ISO timestamp the
   *  next added drink is counted at. Cleared on submit AND on cancel. */
  const [backdateAt, setBackdateAt] = useState<string | null>(null);

  // — Nudge slot occupants —
  /** A tap that tripped the rapid guard, waiting for an explicit yes. Nothing
   *  has been written; a timeout is a no. */
  const [pendingRapid, setPendingRapid] = useState<{ beer: CountableBeer; minutes: number | null } | null>(null);
  /** The drink counted within the last UNDO_WINDOW_MS, undoable from the strip. */
  const [lastCounted, setLastCounted] = useState<{ id: string; ordinal: number; isBeer: boolean } | null>(null);
  const [checkInBeerName, setCheckInBeerName] = useState<string | null>(null);
  /** Session clientId whose "Dopito?" nudge was already shown and answered. */
  const [dopitoNudgedFor, setDopitoNudgedFor] = useState<string | null>(null);

  // — Menu / scan —
  const [backendMenu, setBackendMenu] = useState<{
    pubId: string;
    beers: CommunityBeer[];
    historicalBeers: CommunityBeer[];
    beersUpdatedAt: string | null;
    beerMenuRotates: boolean;
  } | null>(null);
  const [scanningDrinks, setScanningDrinks] = useState(false);
  const [scannedDrinks, setScannedDrinks] = useState<ScannedDrink[]>([]);

  // — Friends broadcast —
  const [sharingWithFriends, setSharingWithFriends] = useState(false);
  const [broadcastCell, setBroadcastCell] = useState<string | null>(null);
  const broadcasted = cell !== null && broadcastCell === cell;

  const [nowMs, setNowMs] = useState(() => Date.now());

  // Deferred-send timers per drink id; a count schedules delivery for the end of
  // the undo window, and undo cancels its drink's timer before it fires.
  const sendTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  /** The single slot a sheet row hands its action to while the sheet closes. */
  const sheetActionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rapidTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** `${clientId}:${count}` of the last water nudge, so rapid taps sharing a
   *  threshold can't double-fire while a fresh evening still nudges. */
  const waterNudgeKeyRef = useRef('');

  useEffect(() => {
    const timers = sendTimers.current;
    const sheetTimer = sheetActionTimer;
    const rapid = rapidTimer;
    return () => {
      // Leaving the screen ends the undo window: cancel pending timers and hand
      // off to a single flush so nothing held for undo is left undelivered.
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      if (sheetTimer.current) clearTimeout(sheetTimer.current);
      if (rapid.current) clearTimeout(rapid.current);
      void flushDrinksQueue();
    };
  }, []);

  useEffect(() => {
    if (!pub) return undefined;
    const controller = new AbortController();
    const pubId = pub.id;

    void fetchPubHours([pub], controller.signal).then((resultMap) => {
      if (controller.signal.aborted) return;
      const result = resultMap.get(pubId);
      setBackendMenu({
        pubId,
        beers: result?.beers ?? [],
        historicalBeers: result?.historicalBeers ?? [],
        beersUpdatedAt: result?.beersUpdatedAt ?? null,
        beerMenuRotates: result?.beerMenuRotates ?? false,
      });
    });

    return () => controller.abort();
  }, [pub]);

  // Changing place ends the moment the nudges belong to. Without this the undo
  // strip from a beer counted at the pub would still be sitting there after
  // switching to "Doma", and pressing "Vrátit" would empty that pub's evening
  // while skipping the visit reconciliation (which keys off the CURRENT place).
  // Done during render (not in an effect) so the stale strip never paints.
  const [nudgeCell, setNudgeCell] = useState(cell);
  if (nudgeCell !== cell) {
    setNudgeCell(cell);
    setLastCounted(null);
    setCheckInBeerName(null);
    setCheckInSheetOpen(false);
    setPendingRapid(null);
  }

  const moreControlled = moreOpenProp !== undefined;
  const moreVisible = moreControlled ? moreOpenProp : ownMoreOpen;
  const closeMore = useCallback(() => {
    if (moreControlled) onMoreClose?.();
    else setOwnMoreOpen(false);
  }, [moreControlled, onMoreClose]);

  /** Close the overflow sheet, then run the row's action. */
  const runAfterSheetClose = useCallback(
    (action: () => void) => {
      closeMore();
      setPickOpen(false);
      setReceiptOpen(false);
      if (sheetActionTimer.current) clearTimeout(sheetActionTimer.current);
      sheetActionTimer.current = setTimeout(() => {
        sheetActionTimer.current = null;
        action();
      }, SHEET_DISMISS_MS);
    },
    [closeMore],
  );

  // ── Session state ───────────────────────────────────────────────────────────

  const isThisSession = cell !== null && current?.pubKey === cell;
  const count = isThisSession ? sessionCount(current) : 0;
  const totalCzk = isThisSession ? sessionTotalCzk(current) : 0;
  const sessionDrinks = useMemo(
    () => (isThisSession ? current?.drinks ?? [] : []),
    [isThisSession, current],
  );
  const latestBeer = useMemo(
    () => [...sessionDrinks].reverse().find((drink) => normalizeDrinkType(drink.drinkType) === 'beer'),
    [sessionDrinks],
  );
  const latestAlcohol = useMemo(
    () => [...sessionDrinks].reverse().find((drink) => normalizeDrinkType(drink.drinkType) !== 'soft_drink'),
    [sessionDrinks],
  );
  const latestDrinkAt = latestAlcohol?.at;
  const drinkTypeCounts = useMemo(
    () => sessionDrinkTypeCounts(isThisSession ? current : null),
    [isThisSession, current],
  );

  useEffect(() => {
    if (!latestDrinkAt) return undefined;
    const timer = setInterval(() => setNowMs(Date.now()), 60 * 1000);
    if (typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') {
      timer.unref();
    }
    return () => clearInterval(timer);
  }, [latestDrinkAt]);

  /** The beer "Ještě jedno" repeats — the same pour, same serving, same price. */
  const repeatBeer = useMemo<CountableBeer | null>(() => {
    if (!latestBeer) return null;
    return {
      name: latestBeer.beerName,
      ...(typeof latestBeer.priceCzk === 'number' ? { priceCzk: latestBeer.priceCzk } : {}),
      ...(typeof latestBeer.volumeMl === 'number' ? { volumeMl: latestBeer.volumeMl } : {}),
      ...(latestBeer.servingType ? { servingType: latestBeer.servingType } : {}),
      drinkType: 'beer',
    };
  }, [latestBeer]);

  // A recently auto-completed evening HERE that can be picked back up instead of
  // starting a fresh count. Only offered while this place has no live count.
  const resumable = useMemo(
    () => (cell && count === 0 ? resumableSession(current, history, cell) : null),
    [cell, count, current, history],
  );

  // A fresh/offline edit wins optimistically. A newer confirmed backend menu
  // replaces the persisted override after sync or another mapper correction.
  const currentBackendMenu = backendMenu?.pubId === pub?.id ? backendMenu : null;
  const backendBeersUpdatedAt = currentBackendMenu?.beersUpdatedAt ?? pub?.beersUpdatedAt;
  const currentBeerListOverride = isBeerListOverrideCurrent(
    override,
    backendBeersUpdatedAt,
  )
    ? override
    : undefined;
  const currentMenuTypeOverride = isBeerMenuTypeOverrideCurrent(
    override,
    backendBeersUpdatedAt,
  )
    ? override
    : undefined;

  const menu = useMemo<CommunityBeer[]>(() => {
    if (!place) return [];
    if (!pub) return [];
    if (currentBeerListOverride?.beers) return currentBeerListOverride.beers;
    if (currentBackendMenu?.beers.length) return currentBackendMenu.beers;
    return pub.beers ?? [];
  }, [currentBackendMenu, currentBeerListOverride, place, pub]);

  const historicalBeers = useMemo<CommunityBeer[]>(() => {
    if (!pub) return [];
    if (currentBeerListOverride?.historicalBeers) {
      return currentBeerListOverride.historicalBeers;
    }
    if (currentBackendMenu?.historicalBeers.length) {
      return currentBackendMenu.historicalBeers;
    }
    return pub.historicalBeers ?? [];
  }, [currentBackendMenu, currentBeerListOverride, pub]);

  const beerMenuRotates = pub
    ? currentMenuTypeOverride?.beerMenuRotates ??
      currentBackendMenu?.beerMenuRotates ??
      pub.beerMenuRotates ??
      false
    : false;

  /** Every beer identity from the menu, flattened, small → large per name. */
  const menuBeers = useMemo(
    () => groupMenuBeers(menu).flatMap((group) => group.beers),
    [menu],
  );

  /** Tonight's drinks folded to one row per identity, latest first. */
  const tonightBeers = useMemo(() => {
    const seen = new Map<string, { beer: CommunityBeer & { servingType?: ServingType }; count: number }>();
    for (const drink of sessionDrinks) {
      const key = drinkKey(drink);
      const entry = seen.get(key);
      if (entry) {
        entry.count += 1;
        continue;
      }
      seen.set(key, {
        beer: {
          name: drink.beerName,
          ...(typeof drink.priceCzk === 'number' ? { priceCzk: drink.priceCzk } : {}),
          ...(typeof drink.volumeMl === 'number' ? { volumeMl: drink.volumeMl } : {}),
          ...(drink.servingType ? { servingType: drink.servingType } : {}),
        },
        count: 1,
      });
    }
    // Insertion order follows the session; reverse so the last pour leads.
    return [...seen.entries()].reverse().map(([key, value]) => ({ key, ...value }));
  }, [sessionDrinks]);

  /** Identity → the beer object a pick-sheet row counts. */
  const rowBeers = useMemo(() => {
    const map = new Map<string, CommunityBeer & { servingType?: ServingType }>();
    for (const entry of tonightBeers) map.set(entry.key, entry.beer);
    for (const beer of menuBeers) if (!map.has(beerKey(beer))) map.set(beerKey(beer), beer);
    return map;
  }, [menuBeers, tonightBeers]);

  const priceMeta = useCallback(
    (beer: CommunityBeer) => {
      const price =
        typeof beer.priceCzk === 'number'
          ? formatPrice(beer.priceCzk, priceCurrency)
          : pricePlaceholder(priceCurrency);
      return beer.volumeMl ? `${formatVolume(beer.volumeMl)} · ${price}` : price;
    },
    [priceCurrency],
  );

  const tonightRows = useMemo<DrinkPickRow[]>(
    () =>
      tonightBeers.map((entry) => ({
        key: entry.key,
        name: entry.beer.name,
        meta: priceMeta(entry.beer),
        count: entry.count,
        hasPrice: typeof entry.beer.priceCzk === 'number',
      })),
    [priceMeta, tonightBeers],
  );

  const tonightKeys = useMemo(() => new Set(tonightBeers.map((entry) => entry.key)), [tonightBeers]);

  const menuRows = useMemo<DrinkPickRow[]>(
    () =>
      menuBeers
        .filter((beer) => !tonightKeys.has(beerKey(beer)))
        .map((beer) => ({
          key: beerKey(beer),
          name: beer.name,
          meta: priceMeta(beer),
          count: 0,
          hasPrice: typeof beer.priceCzk === 'number',
        })),
    [menuBeers, priceMeta, tonightKeys],
  );

  const hasSomethingToPick = tonightRows.length > 0 || menuRows.length > 0;

  // ── Coaster meta ────────────────────────────────────────────────────────────

  const otherDrinkSummary = [
    drinkTypeCounts.wine > 0 ? wineCountLabel(drinkTypeCounts.wine) : null,
    drinkTypeCounts.soft_drink > 0 ? softDrinkCountLabel(drinkTypeCounts.soft_drink) : null,
    drinkTypeCounts.shot > 0 ? shotCountLabel(drinkTypeCounts.shot) : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  // Outside a pub the price is optional; a "0 Kč" line would claim knowledge we
  // don't have — unknown stays unknown.
  const showSpent = !outsideContext || totalCzk > 0;
  const spentLabel = showSpent && count > 0 ? formatPrice(totalCzk, priceCurrency) : null;
  const sinceLastBeer = latestBeer ? minutesSinceDrink(latestBeer.at, nowMs) : null;
  // The numeral says how many; the card's footer carries money, any non-beer
  // drinks and how long ago — never a repeat of the count.
  const sinceLabel =
    sinceLastBeer === null
      ? null
      : [
          sinceLastBeer === 0
            ? cs.counter.lastDrinkShortJustNow
            : cs.counter.lastDrinkShortMinutesAgo(sinceLastBeer),
          otherDrinkSummary || null,
        ]
          .filter((part): part is string => !!part)
          .join(' · ');

  // Live story sticker ("come join me"): tonight's tally so far at THIS pub.
  const liveNight = useMemo<NightSummary | null>(() => {
    if (!pub) return null;
    const startedAt = isThisSession && current ? current.startedAt : new Date().toISOString();
    return {
      clientKey: 'live-sticker',
      drinkingDay: '',
      startedAt,
      endedAt: startedAt,
      beerCount: drinkTypeCounts.beer,
      wineCount: drinkTypeCounts.wine,
      softDrinkCount: drinkTypeCounts.soft_drink,
      shotCount: drinkTypeCounts.shot,
      pubNames: [pub.name],
      ...(pub.city ? { city: pub.city } : {}),
    };
  }, [current, drinkTypeCounts, isThisSession, pub]);

  // ── Counting ────────────────────────────────────────────────────────────────

  const countBeer = useCallback(
    (beer: CountableBeer, atOverride?: string) => {
      if (!place || !cell) return;
      const id = generateUuidV4();
      const at = atOverride ?? new Date().toISOString();
      const drinkType = beer.drinkType ?? 'beer';
      const startsSession = !isThisSession || (current?.drinks.length ?? 0) === 0;
      setNowMs(atOverride ? Date.now() : Date.parse(at));

      const label = pub ? pub.name : cs.counter.outsideLabel(outsideContext as OutsidePlaceContext);
      const tallyPlace = pub
        ? { pubKey: cell, pubName: pub.name, pubCity: pub.city, pubExternalId: pub.id }
        : { pubKey: cell, pubName: label, placeContext: outsideContext as OutsidePlaceContext };
      const tallyBeer = {
        id,
        beerName: beer.name,
        drinkType,
        priceCzk: beer.priceCzk,
        volumeMl: beer.volumeMl,
        servingType: beer.servingType,
        at,
      };

      // A backdate to an earlier drinking day is a past evening: file it into
      // history so it never becomes/clobbers the live session.
      const backdateToPast = !!atOverride && isPastEveningBackdate(at);

      let landedSession: TallySession | null;
      if (backdateToPast) {
        landedSession = addBackdatedDrink(tallyPlace, tallyBeer);
      } else {
        addDrink(tallyPlace, tallyBeer);
        landedSession = useTallyStore.getState().current;
      }

      if (!atOverride && drinkType === 'beer' && landedSession) {
        void refreshBeerCountReminderAfterBeer(landedSession.clientId);
      }
      // An outside evening is NOT a pub visit — skip the visit record there.
      if (pub) syncVisit(landedSession);
      if (!atOverride && startsSession) {
        void trackClientEvent({ event: 'counter_session_started' });
      }
      void trackClientEvent({
        event: 'drink_added',
        context: {
          had_active_session: !startsSession,
          backdated: !!atOverride,
          ...(drinkType === 'beer' ? {} : { drink_type: drinkType }),
          ...(outsideContext ? { place_context: outsideContext } : {}),
        },
      });

      // Merge into the local community menu so the price shows instantly across
      // the app. Pub only — an outside beer must never enter community data.
      if (pub && drinkType === 'beer' && typeof beer.priceCzk === 'number') {
        setOverride(cell, { beers: mergeBeerIntoMenu(menu, { ...beer, priceCzk: beer.priceCzk }) });
      }
      // The check-in prompt is now-semantic and pub-bound — skip it for a
      // backdated or outside log.
      if (pub && !atOverride && drinkType === 'beer') setCheckInBeerName(beer.name);

      const entry = buildDrinkEntry(
        {
          ...(pub
            ? { externalId: pub.id || null, name: pub.name, lat: pub.lat, lng: pub.lng, city: pub.city }
            : { placeContext: outsideContext as OutsidePlaceContext }),
          drinkType,
          beer: {
            name: beer.name,
            priceCzk: beer.priceCzk,
            volumeMl: beer.volumeMl,
            servingType: beer.servingType,
          },
          drankAt: at,
        },
        id,
      );
      // Persist now (crash-safe) but hold the send for the undo window so the
      // queued payload stays retractable; deliver + mark synced when it ends.
      void enqueueDrink(entry, { deliver: false });
      const timer = setTimeout(() => {
        sendTimers.current.delete(id);
        setLastCounted((prev) => (prev?.id === id ? null : prev));
        void flushDrinksQueue()
          .then(() => isDrinkQueued(id))
          .then((stillQueued) => {
            if (!stillQueued) markDrinkSynced(id);
          });
      }, UNDO_WINDOW_MS);
      sendTimers.current.set(id, timer);

      // The undo strip owns the nudge slot for the whole window. A backdated
      // drink is not "the beer you just had", so it gets no strip.
      if (!atOverride) {
        const liveCountAfter = sessionCount(useTallyStore.getState().current);
        setLastCounted({ id, ordinal: liveCountAfter, isBeer: drinkType === 'beer' });
      }

      if (hapticEnabled) fireSuccessHaptic();

      // Gentle water nudge every 4th beer in a row (4, 8, 12…). Local-only.
      const liveSession = useTallyStore.getState().current;
      const liveCount = sessionCount(liveSession);
      const nudgeKey = liveSession ? `${liveSession.clientId}:${liveCount}` : '';
      const waterNudged =
        !atOverride &&
        drinkType === 'beer' &&
        waterNudgeEnabled &&
        liveCount > 0 &&
        liveCount % 4 === 0 &&
        waterNudgeKeyRef.current !== nudgeKey;
      if (waterNudged) {
        waterNudgeKeyRef.current = nudgeKey;
        showToast(cs.counter.waterNudge(liveCount), {
          icon: <GlassWaterIcon size={20} color={Colors.amber} />,
        });
      } else if (!atOverride) {
        // The small pat on the back for the tap itself. One toast slot, so the
        // water nudge wins whenever both would fire — and a backdated entry gets
        // neither, it isn't "the beer you just had".
        showToast(
          drinkType === 'beer' ? cs.counter.countedToast(liveCount) : cs.counter.countedToastOther,
          { icon: <DrinkToastIcon drinkType={drinkType} /> },
        );
      }
    },
    [
      addBackdatedDrink,
      addDrink,
      cell,
      current,
      hapticEnabled,
      isThisSession,
      markDrinkSynced,
      menu,
      outsideContext,
      place,
      pub,
      setOverride,
      showToast,
      waterNudgeEnabled,
    ],
  );

  // The pending confirmation never outlives its place: when `cell` changes the
  // state above drops it, and this effect cancels the timer that would have
  // fired for it.
  useEffect(() => {
    if (pendingRapid) return undefined;
    if (rapidTimer.current) {
      clearTimeout(rapidTimer.current);
      rapidTimer.current = null;
    }
    return undefined;
  }, [pendingRapid]);

  const clearRapid = useCallback(() => {
    if (rapidTimer.current) {
      clearTimeout(rapidTimer.current);
      rapidTimer.current = null;
    }
    setPendingRapid(null);
  }, []);

  /** The ONLY count path. A tap that lands suspiciously soon after the last one
   *  does not write anything — it asks first, inline, and a timeout means no. */
  const requestCountBeer = useCallback(
    (beer: CountableBeer, atOverride?: string) => {
      if (atOverride || beer.drinkType === 'soft_drink' || !shouldWarnRapidDrink(latestDrinkAt)) {
        clearRapid();
        countBeer(beer, atOverride);
        return;
      }
      if (rapidTimer.current) clearTimeout(rapidTimer.current);
      setPendingRapid({ beer, minutes: latestDrinkAt ? minutesSinceDrink(latestDrinkAt) : null });
      rapidTimer.current = setTimeout(() => {
        rapidTimer.current = null;
        setPendingRapid(null);
      }, RAPID_DECISION_MS);
    },
    [clearRapid, countBeer, latestDrinkAt],
  );

  const confirmRapid = useCallback(() => {
    const pending = pendingRapid;
    clearRapid();
    if (pending) countBeer(pending.beer);
  }, [clearRapid, countBeer, pendingRapid]);

  // ── Removing ────────────────────────────────────────────────────────────────

  /** Drop one drink from the tally and reconcile delivery: pull the payload if
   *  it is still queued, otherwise enqueue a durable backend DELETE. */
  const removeDrinkById = useCallback(
    (targetId: string) => {
      const timer = sendTimers.current.get(targetId);
      if (timer) {
        clearTimeout(timer);
        sendTimers.current.delete(targetId);
      }
      setLastCounted((prev) => (prev?.id === targetId ? null : prev));

      const visitUpdatedAt = new Date().toISOString();
      const currentVisitClientId = current?.clientId;
      removeDrink(targetId);

      // Outside evenings never had a visit record, so there's none to touch.
      if (pub) {
        const nextSession = useTallyStore.getState().current;
        if (nextSession && nextSession.drinks.length > 0) {
          syncVisit(nextSession, visitUpdatedAt);
        } else if (currentVisitClientId) {
          deleteVisitByClientId(currentVisitClientId);
        }
      }

      void removeQueuedDrink(targetId).then((pulledFromQueue) => {
        void trackClientEvent({
          event: 'drink_removed',
          context: { delivery_state: pulledFromQueue ? 'queued' : 'delivered' },
        });
        if (!pulledFromQueue) {
          void flushDrinksQueue()
            .then(() => enqueueDelete(targetId))
            .catch(() => undefined);
        }
      });

      if (hapticEnabled) fireLightImpactHaptic();
    },
    [current, hapticEnabled, pub, removeDrink],
  );

  /** Receipt minus: drop the most recent drink of that identity. */
  const removeIdentity = useCallback(
    (key: string) => {
      for (let i = sessionDrinks.length - 1; i >= 0; i--) {
        if (drinkKey(sessionDrinks[i]) === key) {
          removeDrinkById(sessionDrinks[i].id);
          return;
        }
      }
    },
    [removeDrinkById, sessionDrinks],
  );

  // ── Receipt ─────────────────────────────────────────────────────────────────

  const receipt = useMemo(() => {
    const beers = new Map<string, ReceiptItem & { czk: number; known: boolean }>();
    const others = new Map<string, ReceiptItem & { czk: number; known: boolean }>();
    for (const drink of sessionDrinks) {
      const isBeer = normalizeDrinkType(drink.drinkType) === 'beer';
      const bucket = isBeer ? beers : others;
      const key = drinkKey(drink);
      const priced = typeof drink.priceCzk === 'number';
      const existing = bucket.get(key);
      if (existing) {
        existing.count += 1;
        existing.czk += priced ? (drink.priceCzk as number) : 0;
        existing.known = existing.known && priced;
      } else {
        bucket.set(key, {
          key,
          name: drink.beerName,
          meta: drink.volumeMl ? formatVolume(drink.volumeMl) : null,
          count: 1,
          czk: priced ? (drink.priceCzk as number) : 0,
          known: priced,
          totalLabel: null,
        });
      }
    }
    const finish = (bucket: Map<string, ReceiptItem & { czk: number; known: boolean }>) =>
      [...bucket.values()].map((item) => ({
        key: item.key,
        name: item.name,
        meta: item.meta,
        count: item.count,
        totalLabel: item.known ? formatPrice(item.czk, priceCurrency) : null,
      }));
    return { beerItems: finish(beers), otherItems: finish(others) };
  }, [priceCurrency, sessionDrinks]);

  const startedAtLabel = useMemo(() => {
    if (!isThisSession || !current) return null;
    const started = new Date(current.startedAt);
    if (Number.isNaN(started.getTime())) return null;
    const time = `${started.getHours()}:${String(started.getMinutes()).padStart(2, '0')}`;
    return cs.counter.receiptStarted(time);
  }, [current, isThisSession]);

  // ── Beer form ───────────────────────────────────────────────────────────────

  const openForm = useCallback(
    (mode: BeerFormMode, beer: CommunityBeer | null, drinkType: DrinkType = 'beer') => {
      setFormBeer(beer);
      setFormDrinkType(drinkType);
      setFormMode(mode);
      setFormNonce((n) => n + 1);
      void trackClientEvent({ event: 'beer_form_opened', context: { mode } });
    },
    [],
  );

  const handleAddBeer = useCallback(() => {
    trackUiInteraction('counter_add_drink_open');
    setBackdateAt(null);
    openForm('add', null, 'beer');
  }, [openForm]);

  const handleAddOtherDrink = useCallback(() => {
    trackUiInteraction('counter_add_drink_open');
    setBackdateAt(null);
    openForm('add', null, 'soft_drink');
  }, [openForm]);

  const handleFormSubmit = useCallback(
    (result: BeerFormResult) => {
      trackUiInteraction('counter_drink_form_submit', 'submit');
      const mode = formMode;
      // Capture the row being edited BEFORE clearing form state — identity is
      // name+volume, so a volume edit must replace this exact row in place.
      const editedBeer = formBeer;
      const at = backdateAt ?? undefined;
      setFormMode(null);
      setFormBeer(null);
      setBackdateAt(null);
      const beer: CountableBeer = {
        name: result.name,
        priceCzk: result.priceCzk,
        volumeMl: result.volumeMl,
        drinkType: result.drinkType,
        servingType: result.servingType,
      };
      if (result.servingType) setLastServingType(result.servingType);
      if (result.drinkType === 'beer' && typeof result.priceCzk === 'number' && pub) {
        void trackClientEvent({ event: 'beer_price_added', context: { mode: mode ?? 'unknown' } });
      }
      if (mode === 'edit') {
        // Community-menu edit is a pub concept; outside rows are session-derived.
        if (!pub || !cell) return;
        // Replace the edited row in place: mergeBeerIntoMenu matches on
        // name+volume, so a volume change would otherwise append a NEW row and
        // orphan the original (PIV-33).
        const nextMenu = editedBeer
          ? menu
              .map((b) => (isSameBeerIdentity(b, editedBeer) ? beer : b))
              .filter((b) => b === beer || !isSameBeerIdentity(b, beer))
          : mergeBeerIntoMenu(menu, beer);
        setOverride(cell, { beers: nextMenu });
      } else {
        requestCountBeer(beer, at);
      }
    },
    [backdateAt, cell, formBeer, formMode, menu, pub, requestCountBeer, setOverride],
  );

  // ── Pick sheet ──────────────────────────────────────────────────────────────

  const handlePickRow = useCallback(
    (row: DrinkPickRow) => {
      const beer = rowBeers.get(row.key);
      if (!beer) return;
      setPickOpen(false);
      if (!pub) {
        // Outside a pub a repeat tap counts straight away — price optional, no
        // price prompt. Reuse the serving of the last logged drink of this beer.
        requestCountBeer({
          ...beer,
          drinkType: 'beer',
          servingType: beer.servingType ?? lastServingType,
        });
        return;
      }
      if (typeof beer.priceCzk === 'number') {
        requestCountBeer({ ...beer, priceCzk: beer.priceCzk, drinkType: 'beer' });
        return;
      }
      // Unpriced menu beer: ask the price first — that answer is what fills the
      // pub's community menu for everyone else.
      runAfterSheetClose(() => openForm('price', beer));
    },
    [lastServingType, openForm, pub, requestCountBeer, rowBeers, runAfterSheetClose],
  );

  const handleEditRow = useCallback(
    (row: DrinkPickRow) => {
      const beer = rowBeers.get(row.key);
      if (!beer || !pub) return;
      runAfterSheetClose(() => openForm('edit', beer));
    },
    [openForm, pub, rowBeers, runAfterSheetClose],
  );

  // ── Menu scan ───────────────────────────────────────────────────────────────

  const router = useRouter();

  /** "Vyfoť celý lístek" inside the add form: hand over to the contribute
   *  editor's AI scan with the current menu prefilled. */
  const handleScanMenu = useCallback(() => {
    if (!pub) return;
    trackUiInteraction('counter_menu_scan_open');
    setFormMode(null);
    setFormBeer(null);
    setBackdateAt(null);
    void trackClientEvent({ event: 'beer_form_scan_opened' });
    router.push({
      pathname: '/contribute',
      params: {
        focus: 'beers',
        autoScan: '1',
        ...(pub.id ? { id: pub.id } : {}),
        name: pub.name,
        lat: String(pub.lat),
        lng: String(pub.lng),
        ...(pub.city ? { city: pub.city } : {}),
        ...(menu.length > 0 ? { beers: JSON.stringify(menu) } : {}),
        ...(historicalBeers.length > 0 ? { historicalBeers: JSON.stringify(historicalBeers) } : {}),
        beerMenuRotates: beerMenuRotates ? '1' : '0',
      },
    });
  }, [beerMenuRotates, historicalBeers, menu, pub, router]);

  const runDrinkScan = useCallback(async (source: MenuPhotoSource) => {
    setScanSourceVisible(false);
    setScanningDrinks(true);
    const toast = useToastStore.getState().show;
    try {
      const { pickAndPrepareMenuPhoto } = await import('@/data/menuPhotoPicker');
      const picked = await pickAndPrepareMenuPhoto(source);
      if (picked.status === 'cancelled') return;
      if (picked.status === 'denied' || picked.status === 'denied-permanent') {
        toast(cs.contribute.scanMenu.permissionDenied, {
          icon: <CameraIcon size={18} color={Colors.amber} />,
        });
        return;
      }
      if (picked.status === 'error') {
        toast(cs.contribute.scanMenu.errorToast, { icon: <InfoIcon size={18} color={Colors.foamMuted} /> });
        return;
      }
      const result = await scanMenuPhoto(picked.uri);
      if (result.status === 'ok') {
        setScannedDrinks(result.drinks);
        if (result.drinks.length > 0) {
          fireSuccessHaptic();
          return;
        }
      }
      const message =
        result.status === 'daily-cap'
          ? cs.contribute.scanMenu.dailyCapToast
          : result.status === 'rate-limited'
            ? cs.contribute.scanMenu.rateLimitedToast
            : result.status === 'unavailable'
              ? cs.contribute.scanMenu.unavailableToast
              : result.status === 'bad-image'
                ? cs.contribute.scanMenu.badImageToast
                : result.status === 'empty'
                  ? cs.counter.scanDrinksEmpty
                  : cs.contribute.scanMenu.errorToast;
      toast(message, { icon: <InfoIcon size={18} color={Colors.foamMuted} /> });
    } finally {
      setScanningDrinks(false);
    }
  }, []);

  const handleSelectScannedDrink = useCallback(
    (drink: ScannedDrink) => {
      setScannedDrinks([]);
      openForm('add', drink, drink.drinkType);
    },
    [openForm],
  );

  // ── Backdating ──────────────────────────────────────────────────────────────

  const openBackdateForm = useCallback(
    (at: string) => {
      setBackdateAt(at);
      openForm('add', null);
    },
    [openForm],
  );

  const handleBackdatePress = useCallback(() => {
    const now = Date.now();
    const CAP_MS = 48 * 60 * 60 * 1000;
    const clamp = (ms: number) => new Date(Math.max(ms, now - CAP_MS)).toISOString();
    const yesterdayEvening = new Date(now);
    yesterdayEvening.setDate(yesterdayEvening.getDate() - 1);
    yesterdayEvening.setHours(20, 0, 0, 0);

    showAppDialog({
      title: cs.counter.backdateTitle,
      buttons: [
        { text: cs.counter.backdateHourAgo, onPress: () => openBackdateForm(clamp(now - 60 * 60 * 1000)) },
        {
          text: cs.counter.backdateTwoHoursAgo,
          onPress: () => openBackdateForm(clamp(now - 2 * 60 * 60 * 1000)),
        },
        {
          text: cs.counter.backdateYesterdayEvening,
          onPress: () => openBackdateForm(clamp(yesterdayEvening.getTime())),
        },
        { text: cs.counter.cancel, style: 'cancel' },
      ],
    });
  }, [openBackdateForm]);

  // ── Closing / resuming the evening ──────────────────────────────────────────

  const handleDone = useCallback(() => {
    trackUiInteraction('counter_finish_open');
    const clientId = current?.clientId ?? null;
    showAppDialog({
      title: cs.counter.doneTitle,
      message: cs.counter.doneBody,
      buttons: [
        { text: cs.counter.cancel, style: 'cancel', onPress: () => setDopitoNudgedFor(clientId) },
        {
          text: cs.counter.doneConfirm,
          onPress: () => {
            archiveCurrent('manual');
            setDopitoNudgedFor(clientId);
            setLastCounted(null);
            setCheckInBeerName(null);
            void trackClientEvent({ event: 'counter_session_closed', context: { reason: 'manual' } });
            if (hapticEnabled) fireLightImpactHaptic();
          },
        },
      ],
    });
  }, [archiveCurrent, current, hapticEnabled]);

  const handleResume = useCallback(() => {
    if (!cell) return;
    trackUiInteraction('counter_resume');
    if (resumeLast(cell)) {
      void trackClientEvent({ event: 'counter_session_resumed' });
      if (hapticEnabled) fireLightImpactHaptic();
    }
  }, [cell, hapticEnabled, resumeLast]);

  // ── Friends ─────────────────────────────────────────────────────────────────

  const handleShareWithFriends = useCallback(async () => {
    if (!pub || !cell || sharingWithFriends || broadcasted) return;
    trackUiInteraction('counter_share_friends', 'share');
    setSharingWithFriends(true);
    const shareClientId = isThisSession && current?.clientId ? current.clientId : generateUuidV4();
    const result = await shareFriendPubActivity(pub, '', shareClientId);
    setSharingWithFriends(false);
    if (result.ok) {
      setBroadcastCell(cell);
      showToast(cs.friends.shareSuccess);
      if (hapticEnabled) fireLightImpactHaptic();
    } else if (isRetriableFriendError(result)) {
      await enqueueFriendOp({ op: 'activity', clientId: shareClientId, payload: { pub, message: '' } });
      setBroadcastCell(cell);
      showToast(cs.friends.composeQueued);
    } else {
      showToast(result.detail || cs.friends.shareError);
    }
  }, [broadcasted, cell, current, hapticEnabled, isThisSession, pub, sharingWithFriends, showToast]);

  // ── The one button ──────────────────────────────────────────────────────────

  const handlePlaceOpen = useCallback(() => {
    trackUiInteraction('counter_place_open');
    onChangePlace();
  }, [onChangePlace]);

  const handlePickOpen = useCallback(() => {
    trackUiInteraction('counter_add_drink_open');
    setPickOpen(true);
  }, []);

  const handleRepeatDrink = useCallback(() => {
    if (!repeatBeer) return;
    trackUiInteraction('counter_repeat_drink');
    requestCountBeer(repeatBeer);
  }, [repeatBeer, requestCountBeer]);

  const cta = useMemo(() => {
    // No place yet: the button is how you say where you are. It never guesses a
    // beer and it never counts.
    if (!place) {
      return {
        label: cs.counter.ctaLogBeer,
        subLabel: null as string | null,
        a11y: cs.counter.ctaLogBeer,
        onPress: handlePlaceOpen,
      };
    }
    if (resumable) {
      return {
        label: cs.counter.resumeEvening,
        subLabel: cs.counter.resumeSub(beerCountLabel(sessionCount(resumable))),
        a11y: cs.a11y.counterResume,
        onPress: handleResume,
      };
    }
    if (repeatBeer) {
      return {
        label: cs.counter.repeatCta,
        subLabel: beerLine(repeatBeer),
        a11y: cs.a11y.counterRepeat(repeatBeer.name),
        onPress: handleRepeatDrink,
      };
    }
    if (hasSomethingToPick) {
      return {
        label: cs.counter.ctaPick,
        subLabel: null as string | null,
        a11y: cs.counter.ctaPick,
        onPress: handlePickOpen,
      };
    }
    return {
      label: cs.counter.ctaFirstBeer,
      subLabel: null as string | null,
      a11y: cs.a11y.counterAddBeer,
      onPress: handleAddBeer,
    };
  }, [
    handleAddBeer,
    handlePickOpen,
    handlePlaceOpen,
    handleRepeatDrink,
    handleResume,
    hasSomethingToPick,
    place,
    repeatBeer,
    resumable,
  ]);

  // "Jiné pivo" only makes sense while the CTA repeats a beer — in every other
  // state the CTA already leads to the pick sheet or the form. It used to be a
  // separate outline button under the CTA; it now lives in the card, where it is
  // visible without adding a fifth block to the screen.
  const showQuickOtherBeer = !!place && !resumable && !!repeatBeer;

  // ── The one nudge ───────────────────────────────────────────────────────────

  const dopitoVisible =
    count > 0 &&
    !!latestDrinkAt &&
    nowMs - Date.parse(latestDrinkAt) > DOPITO_IDLE_MS &&
    dopitoNudgedFor !== (current?.clientId ?? null);

  const nudge = useMemo<Nudge | null>(() => {
    if (pendingRapid) {
      return {
        kind: 'rapid',
        text:
          pendingRapid.minutes === null || pendingRapid.minutes === 0
            ? cs.counter.rapidInlineJustNow
            : cs.counter.rapidInline(pendingRapid.minutes),
        confirmLabel: cs.counter.rapidInlineConfirm,
        onConfirm: confirmRapid,
      };
    }
    if (lastCounted) {
      return {
        kind: 'counted',
        text: lastCounted.isBeer
          ? cs.counter.countedStrip(lastCounted.ordinal)
          : cs.counter.countedStripOther,
        undoLabel: cs.counter.undo,
        onUndo: () => removeDrinkById(lastCounted.id),
      };
    }
    if (dopitoVisible) {
      return { kind: 'dopito', label: cs.counter.dopitoNudge, onPress: handleDone };
    }
    if (checkInBeerName && pub) {
      return {
        kind: 'checkin',
        text: cs.counter.checkinNudge,
        ctaLabel: cs.counter.checkinNudgeCta,
        onPress: () => setCheckInSheetOpen(true),
        onDismiss: () => setCheckInBeerName(null),
      };
    }
    if (count > 0) {
      return { kind: 'rank', node: <WeeklyRankChip sessionBeerCount={count} /> };
    }
    return null;
  }, [
    checkInBeerName,
    confirmRapid,
    count,
    dopitoVisible,
    handleDone,
    lastCounted,
    pendingRapid,
    pub,
    removeDrinkById,
  ]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View
      style={[
        styles.root,
        styles.surface,
        { paddingTop: topInset, paddingBottom: Math.max(insets.bottom, Spacing.sm) },
      ]}
    >
      <View style={styles.header}>
        <PlaceChip kind={chipKind} label={placeLabel} onPress={handlePlaceOpen} />
        <View style={styles.headerSpacer} />
        {/* Cvakni pivo. It feeds the Parta strip and the photo contest, so it is
            the one social action that earns a permanent glyph up here instead of
            a row inside "…" that nobody opens with a beer in hand. */}
        <Pressable
          onPress={() => setPhotoCaptureOpen(true)}
          style={({ pressed }) => [styles.moreButton, pressed && styles.pressedSoft]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={cs.photoDiary.counterCta}
        >
          <CameraIcon size={20} color={Colors.amber} />
        </Pressable>
        {/* Hosted in the Štamgast tab the "…" door lives in the segment row, so
            this header keeps only the place chip and the camera. */}
        {moreControlled ? null : (
          <Pressable
            onPress={() => setOwnMoreOpen(true)}
            style={({ pressed }) => [styles.moreButton, pressed && styles.pressedSoft]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={cs.a11y.counterMore}
          >
            <MenuIcon size={20} color={Colors.mutedText} />
          </Pressable>
        )}
      </View>

      <CoasterCard
        count={count}
        nounLabel={beerNoun(count)}
        spentLabel={spentLabel}
        sinceLabel={sinceLabel}
        showReceipt={sessionDrinks.length > 0}
        onOpenReceipt={() => setReceiptOpen(true)}
        accessibilityLabel={
          count > 0
            ? cs.a11y.counterCoaster(beerCountLabel(count), spentLabel ?? undefined)
            : cs.a11y.counterCoasterEmpty
        }
      >
        {/* The room the drawn mug used to take, spent on the two shortcuts
            people actually reach for with a beer in hand. The community doors
            that used to sit here moved to the Parta tab, which owns them: three
            doors to Parta from a screen about my own drinking was noise. */}
        <CounterQuickActions
          // Only while the button repeats the last beer. In every other state the
          // CTA itself already leads to the pick sheet, and two doors to one
          // sheet is the mistake the old counter was built out of.
          onPickOther={showQuickOtherBeer ? handlePickOpen : undefined}
          onMapPub={pub ? () => setMapPubOpen(true) : undefined}
        />
      </CoasterCard>

      <NudgeSlot nudge={nudge} />

      <CounterCta
        label={cta.label}
        subLabel={cta.subLabel}
        onPress={cta.onPress}
        accessibilityLabel={cta.a11y}
      />

      <DrinkPickSheet
        visible={pickOpen}
        isPub={!!pub}
        beerMenuRotates={beerMenuRotates}
        tonightRows={tonightRows}
        menuRows={menuRows}
        onCountRow={handlePickRow}
        onEditRow={handleEditRow}
        onAddBeer={() => runAfterSheetClose(handleAddBeer)}
        onAddOther={() => runAfterSheetClose(handleAddOtherDrink)}
        onClose={() => setPickOpen(false)}
      />

      <ReceiptSheet
        visible={receiptOpen}
        startedAtLabel={startedAtLabel}
        beerItems={receipt.beerItems}
        otherItems={receipt.otherItems}
        totalLabel={showSpent && totalCzk > 0 ? formatPrice(totalCzk, priceCurrency) : null}
        onRemove={(item) => removeIdentity(item.key)}
        onDone={() => runAfterSheetClose(handleDone)}
        onClose={() => setReceiptOpen(false)}
      />

      <CounterMoreSheet
        visible={moreVisible}
        onClose={closeMore}
        onDone={count > 0 ? () => runAfterSheetClose(handleDone) : undefined}
        onSticker={liveNight ? () => runAfterSheetClose(() => setStickerOpen(true)) : undefined}
        onPingFriends={pub ? () => runAfterSheetClose(() => void handleShareWithFriends()) : undefined}
        broadcasted={broadcasted}
        onBackdate={() => runAfterSheetClose(handleBackdatePress)}
        onScanMenu={pub ? () => runAfterSheetClose(() => setScanSourceVisible(true)) : undefined}
        scanning={scanningDrinks}
      />

      <BeerFormModal
        visible={formMode !== null}
        mode={formMode ?? 'add'}
        beer={formBeer}
        initialDrinkType={formDrinkType}
        placeContext={outsideContext ?? 'pub'}
        initialServingType={lastServingType}
        formKey={formNonce}
        onCancel={() => {
          setFormMode(null);
          setFormBeer(null);
          setBackdateAt(null);
        }}
        onSubmit={handleFormSubmit}
        // Hidden in the backdate flow (the scan hands over to the contribute
        // editor, which would drop the picked past timestamp) and outside a pub
        // (there is no pub menu to fill).
        onScanMenu={backdateAt || !pub ? undefined : handleScanMenu}
      />

      <ScanMenuSheet
        visible={scanSourceVisible}
        onClose={() => setScanSourceVisible(false)}
        onPick={(source) => void runDrinkScan(source)}
      />
      <ScannedDrinkPicker
        visible={scannedDrinks.length > 0}
        drinks={scannedDrinks}
        priceCurrency={priceCurrency}
        onClose={() => setScannedDrinks([])}
        onSelect={handleSelectScannedDrink}
      />
      <BeerPhotoCaptureFlow open={photoCaptureOpen} onClose={() => setPhotoCaptureOpen(false)} />
      {liveNight ? (
        <ShareNightModal
          visible={stickerOpen}
          night={liveNight}
          mode="live"
          onClose={() => setStickerOpen(false)}
        />
      ) : null}
      {pub ? (
        <MapPubSheet
          visible={mapPubOpen}
          pubKey={cell ?? ''}
          pubName={pub.name}
          info={pubInfoFromPub(pub)}
          onClose={() => setMapPubOpen(false)}
          onRenamed={onPubRenamed}
        />
      ) : null}
      {pub && cell && checkInBeerName && checkInSheetOpen ? (
        <BeerCheckInSheet
          visible={checkInSheetOpen}
          key={checkInBeerName}
          beerName={checkInBeerName}
          pub={pub}
          pubKey={cell}
          visitClientId={isThisSession ? current?.clientId : null}
          onClose={() => setCheckInSheetOpen(false)}
          onSubmitted={() => setCheckInBeerName(null)}
        />
      ) : null}
    </View>
  );
}

// ─── Screen root ──────────────────────────────────────────────────────────────

export interface CounterScreenProps {
  embedded?: boolean;
  /** Set by the host when the "…" door sits in its header row instead of ours. */
  moreOpen?: boolean;
  onMoreClose?: () => void;
  /** Called with `false` while the permission gate is up: the counter has no
   *  overflow sheet in that state, so a host-owned glyph would be a dead one. */
  onMoreAvailability?: (available: boolean) => void;
}

export default function CounterScreen({
  embedded = false,
  moreOpen,
  onMoreClose,
  onMoreAvailability,
}: CounterScreenProps = {}) {
  const router = useRouter();
  const { candidates, selected, selectPub, permissionState, requestPermission, loading, retry } =
    useNearbyPub();
  const [pickerOpen, setPickerOpen] = useState(false);
  // "Mimo hospodu" mode, restored from a live outside session so returning to
  // the tab mid-evening lands back in it (useNearbyPub ignores ctx sessions).
  const [outsideContext, setOutsideContext] = useState<OutsidePlaceContext | null>(() => {
    const current = useTallyStore.getState().current;
    if (!current || current.drinks.length === 0) return null;
    return contextFromPubKey(current.pubKey);
  });
  const hadActiveSessionOnOpen = useRef((useTallyStore.getState().current?.drinks.length ?? 0) > 0);

  useEffect(() => {
    void trackCounterTabOpened(hadActiveSessionOnOpen.current);
  }, []);

  // Active pub: ONLY an explicit selection (auto-pick within 120 m, a pinned
  // session, or a manual pick). We never silently attribute drinks to a pub the
  // user might not be sitting in — the place chip asks instead.
  const activePub = outsideContext ? null : selected;
  const place: CounterPlace | null = useMemo(() => {
    if (outsideContext) return { kind: 'outside', context: outsideContext };
    if (activePub) return { kind: 'pub', pub: activePub };
    return null;
  }, [activePub, outsideContext]);
  const activeKey = outsideContext
    ? contextPubKey(outsideContext)
    : activePub
      ? geohash8(activePub.lat, activePub.lng)
      : null;

  // The gate replaces the whole counter, sheets included — tell the host so its
  // "…" glyph disappears with them instead of turning into a no-op.
  const gated = permissionState !== 'granted' && !outsideContext;
  useEffect(() => {
    onMoreAvailability?.(!gated);
  }, [gated, onMoreAvailability]);

  if (gated) {
    return (
      <>
        <PermissionGate
          permissionState={permissionState}
          requestPermission={requestPermission}
          onLogOutside={() => setOutsideContext('other')}
          embedded={embedded}
        />
        <PubPickerModal
          visible={pickerOpen}
          candidates={candidates}
          selectedKey={activeKey}
          onSelect={(pub) => {
            setOutsideContext(null);
            selectPub(pub);
            setPickerOpen(false);
          }}
          onSelectOutside={(context) => {
            setOutsideContext(context);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      </>
    );
  }

  return (
    <>
      <Tacek
        place={place}
        unresolvedKind={loading ? 'detecting' : 'unknown'}
        onChangePlace={() => setPickerOpen(true)}
        onPubRenamed={(name) => {
          if (!activePub) return;
          // Re-pin the renamed Pub so the chip updates now, and keep the live
          // evening's display name in step with it.
          selectPub({ ...activePub, name });
          useTallyStore.getState().renameCurrentPub(geohash8(activePub.lat, activePub.lng), name);
        }}
        embedded={embedded}
        moreOpen={moreOpen}
        onMoreClose={onMoreClose}
      />
      <PubPickerModal
        visible={pickerOpen}
        candidates={candidates}
        selectedKey={activeKey}
        onSelect={(pub) => {
          setOutsideContext(null);
          selectPub(pub);
          setPickerOpen(false);
        }}
        onSelectOutside={(context) => {
          setOutsideContext(context);
          setPickerOpen(false);
        }}
        onRetry={retry}
        onAddPub={() => {
          setPickerOpen(false);
          router.push('/add-pub');
        }}
        onClose={() => setPickerOpen(false)}
      />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.stout },
  // The surface never scrolls: it is a fixed composition of four blocks, and the
  // button must stay exactly where the thumb left it. Spacing runs on the
  // 8-point grid: 12 between the button pair, 24 around the header.
  surface: {
    paddingHorizontal: 24,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    marginBottom: 4,
  },
  headerSpacer: { flex: 1, minWidth: Spacing.sm },
  // Quiet on purpose: an outlined circle next to an outlined chip next to an
  // amber button is three competing frames. This one is just a glyph.
  moreButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressedSoft: { opacity: 0.6 },

  // — Permission gate —
  gate: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: Spacing.md,
  },
  gateIcon: { marginBottom: 4 },
  gateTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 26,
    color: Colors.foam,
    textAlign: 'center',
    lineHeight: 32,
  },
  gateBody: {
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    color: Colors.mutedText,
    textAlign: 'center',
    lineHeight: 22,
  },
  gateButton: { alignSelf: 'stretch', marginTop: Spacing.sm },
  gateButtonSecondary: { alignSelf: 'stretch', marginTop: -Spacing.xs },
  gateLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.xs,
    minHeight: 44,
  },
  gateLinkText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.mutedText,
  },
});
