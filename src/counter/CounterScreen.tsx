/**
 * Počítadlo — the beer-counter tab.
 *
 * Once the user is at a pub (auto-detected from GPS, or picked manually) they
 * count beers with a single tap. Every count records WHICH beer and its PRICE,
 * which is how the app community-sources each pub's menu + prices:
 *   • tap a menu beer that already has a price  → instant +1,
 *   • tap one without a price                   → price prompt, then +1,
 *   • "Přidat pivo"                             → add a new beer (you are
 *                                                  drinking it) → counts it +1.
 *
 * Each count: writes to the local tally store, enqueues a /v1/drinks POST
 * (best-effort + retry queue), and merges the beer into the local community
 * menu override so the price shows instantly everywhere (compass card included).
 * When the backend is dormant, everything still works locally.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { amberGlow, amberGlowStrong } from '@/theme/shadows';
import { cs, formatVolume } from '@/i18n/cs';
import { beerCountLabel, shotCountLabel, softDrinkCountLabel, wineCountLabel } from '@/i18n/plural';
import { GlowButton } from '@/components/shared/GlowButton';
import { SoftGlow } from '@/components/celebration/SoftGlow';
import {
  BeerIcon,
  MapPinIcon,
  PlusIcon,
  MinusIcon,
  RefreshCwIcon,
  CheckIcon,
  Undo2Icon,
  BellRingIcon,
  GlassWaterIcon,
  HistoryIcon,
  HouseIcon,
  TreePineIcon,
  CameraIcon,
  InfoIcon,
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
import { trackClientEvent } from '@/data/telemetryClient';
import { fireSuccessHaptic, fireLightImpactHaptic } from '@/utils/haptics';
import {
  isBeerListOverrideCurrent,
  isBeerMenuTypeOverrideCurrent,
  useCommunityStore,
} from '@/stores/communityStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToastStore } from '@/stores/toastStore';
import { formatPrice, pricePlaceholder, type PriceCurrency } from '@/utils/currency';
import {
  useTallyStore,
  sessionCount,
  sessionTotalCzk,
  sessionBeerCounts,
  sessionDrinkTypeCounts,
  resumableSession,
  isPastEveningBackdate,
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
import { MapPubEntry } from '@/components/amenities/MapPubEntry';
import { pubInfoFromPub } from '@/components/amenities/pubInfoContext';
import { ScanMenuSheet } from '@/components/contribute/ScanMenuSheet';
import { ScannedDrinkPicker } from '@/counter/ScannedDrinkPicker';
import { WeeklyRankChip } from '@/leaderboards/WeeklyRankChip';
import { refreshBeerCountReminderAfterBeer } from '@/notifications/beerCountReminder';

// ─── Gate states (permission / detecting / no pub) ─────────────────────────────

/** Full-screen centered wrapper shared by the gate states. Owns the safe-area
 *  inset the parent hasn't already padded (none when embedded in the "Pivo" tab). */
function CenteredScreen({ embedded, children }: { embedded: boolean; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, styles.centered, { paddingTop: embedded ? 0 : insets.top, paddingBottom: insets.bottom }]}>
      {children}
    </View>
  );
}

function PermissionScreen({
  permissionState,
  requestPermission,
  onLogOutside,
  embedded,
}: {
  permissionState: 'denied' | 'undetermined';
  requestPermission: () => Promise<void>;
  /** "Zapsat pivo bez polohy" — the counter no longer hard-requires GPS. */
  onLogOutside: () => void;
  embedded: boolean;
}) {
  return (
    <CenteredScreen embedded={embedded}>
      <View style={styles.permIconWrap}>
        <BeerIcon size={56} color={Colors.amber} />
      </View>
      <Text style={styles.bigTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
        {cs.counter.permTitle}
      </Text>
      <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
        {cs.counter.permBody}
      </Text>
      <View style={styles.permButtonWrap}>
        <GlowButton
          label={cs.counter.permCta}
          onPress={requestPermission}
          glow="soft"
          accessibilityLabel={cs.a11y.counterRequestLocation}
        />
      </View>
      {permissionState === 'denied' && (
        <View style={styles.permSecondaryWrap}>
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
        style={styles.noPubAddLink}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={cs.counter.outsideNoLocationCta}
      >
        <HouseIcon size={16} color={Colors.mutedText} />
        <Text style={styles.noPubAddLinkText} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.counter.outsideNoLocationCta}
        </Text>
      </Pressable>
    </CenteredScreen>
  );
}

// ─── Detecting + empty ────────────────────────────────────────────────────────

function DetectingScreen({ embedded }: { embedded: boolean }) {
  return (
    <CenteredScreen embedded={embedded}>
      <View style={[styles.permIconWrap, amberGlow(16)]}>
        <MapPinIcon size={48} color={Colors.amber} />
      </View>
      <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
        {cs.counter.detecting}
      </Text>
    </CenteredScreen>
  );
}

function NoPubScreen({
  candidatesCount,
  onPickPlace,
  onLogOutside,
  onRetry,
  embedded,
}: {
  /** Nearby pubs found but none close enough to auto-pick. */
  candidatesCount: number;
  /** Opens the "Kde sedíš?" picker (nearby pubs + Mimo hospodu). */
  onPickPlace: () => void;
  /** Starts a generic outside-pub evening without routing through pub choices. */
  onLogOutside: () => void;
  onRetry: () => void;
  embedded: boolean;
}) {
  const router = useRouter();
  // With candidates in range we never silently guess a pub (the old behaviour
  // attributed home drinks to a pub up to 3 km away) — the user picks instead.
  const hasCandidates = candidatesCount > 0;
  return (
    <CenteredScreen embedded={embedded}>
      <View style={styles.permIconWrap}>
        <BeerIcon size={56} color={Colors.amber} />
      </View>
      <Text style={styles.bigTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
        {hasCandidates ? cs.counter.pickerTitle : cs.counter.noPubTitle}
      </Text>
      <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
        {hasCandidates ? cs.counter.noPubChooseBody : cs.counter.noPubBody}
      </Text>
      <View style={styles.permButtonWrap}>
        {hasCandidates ? (
          <GlowButton
            label={cs.counter.noPubChooseCta}
            onPress={onPickPlace}
            glow="soft"
            icon={<MapPinIcon size={20} color={Colors.stout} />}
            accessibilityLabel={cs.counter.noPubChooseCta}
          />
        ) : (
          <GlowButton
            label={cs.counter.retry}
            onPress={onRetry}
            glow="soft"
            icon={<RefreshCwIcon size={20} color={Colors.stout} />}
            accessibilityLabel={cs.a11y.counterRetry}
          />
        )}
      </View>
      <Pressable
        onPress={onLogOutside}
        style={styles.noPubAddLink}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={cs.counter.outsideNoPubCta}
      >
        <HouseIcon size={16} color={Colors.mutedText} />
        <Text style={styles.noPubAddLinkText} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.counter.outsideNoPubCta}
        </Text>
      </Pressable>
      {hasCandidates ? (
        <Pressable
          onPress={onRetry}
          style={styles.noPubAddLink}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.counterRetry}
        >
          <RefreshCwIcon size={16} color={Colors.mutedText} />
          <Text style={styles.noPubAddLinkText} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.counter.retry}
          </Text>
        </Pressable>
      ) : null}
      {/* Parity with the compass empty state: if it's not on the map yet, add it. */}
      <Pressable
        onPress={() => router.push('/add-pub')}
        style={styles.noPubAddLink}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={cs.counter.noPubAddPub}
      >
        <MapPinIcon size={16} color={Colors.mutedText} />
        <Text style={styles.noPubAddLinkText} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.counter.noPubAddPub}
        </Text>
      </Pressable>
    </CenteredScreen>
  );
}

// ─── Menu card ────────────────────────────────────────────────────────────────

interface MenuCardVariant {
  beer: CommunityBeer;
  count: number;
  onCount: () => void;
  onDecrement: () => void;
  onEdit: () => void;
}

interface MenuCardProps {
  name: string;
  variants: MenuCardVariant[];
  priceCurrency: PriceCurrency;
}

function MenuCard({ name, variants, priceCurrency }: MenuCardProps) {
  const hasCount = variants.some((variant) => variant.count > 0);

  return (
    <View style={[styles.menuCard, hasCount && styles.menuCardCounted]}>
      <Text style={styles.menuCardName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
        {name}
      </Text>

      <View style={styles.menuVariants}>
        {variants.map(({ beer, count, onCount, onDecrement, onEdit }, index) => {
          const hasPrice = typeof beer.priceCzk === 'number';
          const price = hasPrice
            ? formatPrice(beer.priceCzk as number, priceCurrency)
            : pricePlaceholder(priceCurrency);
          const volume = beer.volumeMl ? formatVolume(beer.volumeMl) : null;
          const baseCountLabel = hasPrice
            ? cs.a11y.counterCountBeer(beer.name, price)
            : cs.a11y.counterCountBeerNoPrice(beer.name);
          const countA11yLabel = variants.length > 1 && volume
            ? `${baseCountLabel}, ${volume}`
            : baseCountLabel;
          const removeA11yLabel = variants.length > 1 && volume
            ? `${cs.a11y.counterRemoveBeer(beer.name)}, ${volume}`
            : cs.a11y.counterRemoveBeer(beer.name);

          return (
            <View
              key={beerKey(beer)}
              style={[styles.menuVariantRow, index > 0 && styles.menuVariantRowDivided]}
            >
              {/* Each serving keeps its own edit target and stepper while the
                  shared beer name appears only once for the whole card. */}
              <Pressable
                onLongPress={onEdit}
                delayLongPress={300}
                style={({ pressed }) => [styles.menuVariantMeta, pressed && styles.menuCardPressed]}
                accessibilityRole="button"
                accessibilityLabel={[beer.name, volume, price].filter(Boolean).join(', ')}
                accessibilityHint={cs.a11y.counterEditBeer(beer.name)}
              >
                {volume ? (
                  <View style={styles.menuVariantVolumeChip}>
                    <Text style={styles.menuVariantVolume} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                      {volume}
                    </Text>
                  </View>
                ) : null}
                <Text
                  style={[styles.menuVariantPrice, !hasPrice && styles.menuCardMetaMissing]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {price}
                </Text>
              </Pressable>

              <View style={styles.stepper}>
                {count > 0 && (
                  <>
                    <Pressable
                      onPress={onDecrement}
                      style={({ pressed }) => [styles.stepButton, styles.stepButtonMinus, pressed && styles.stepButtonPressed]}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel={removeA11yLabel}
                    >
                      <MinusIcon size={18} color={Colors.mutedText} />
                    </Pressable>
                    <View style={styles.countBadge}>
                      <Text style={styles.countBadgeText} maxFontSizeMultiplier={FontScaleCap.body}>
                        {cs.counter.perBeerCount(count)}
                      </Text>
                    </View>
                  </>
                )}
                <Pressable
                  onPress={onCount}
                  style={({ pressed }) => [styles.stepButton, styles.stepButtonPlus, pressed && styles.stepButtonPressed]}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={countA11yLabel}
                >
                  <PlusIcon size={20} color={Colors.amber} />
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─── Active counter ───────────────────────────────────────────────────────────

/** Where the counter is counting: a real pub, or one of the "Mimo hospodu"
 *  contexts (home / outdoors / elsewhere) with no pub identity at all. */
export type CounterPlace =
  | { kind: 'pub'; pub: Pub }
  | { kind: 'outside'; context: OutsidePlaceContext };

interface ActiveCounterProps {
  place: CounterPlace;
  onChangePlace: () => void;
  /** The user renamed the active pub from the mapping hub — the owner of the
   *  selected Pub updates it so the header doesn't keep the old name. */
  onPubRenamed: (newName: string) => void;
  /** Hosted inside the merged "Pivo" tab: the parent owns the top safe-area
   *  inset and the segment header, so the counter drops its own top padding. */
  embedded: boolean;
}

const OUTSIDE_HEADER_ICONS: Record<OutsidePlaceContext, typeof HouseIcon> = {
  private: HouseIcon,
  outdoors: TreePineIcon,
  other: MapPinIcon,
};

/** A stable identity key for a menu beer (normalized name + volume). */
function beerKey(beer: CommunityBeer): string {
  return `${beer.name.trim().toLowerCase()}|${beer.volumeMl ?? ''}`;
}

interface MenuBeerGroup {
  key: string;
  name: string;
  beers: CommunityBeer[];
}

/** Keep one visual card per beer name while preserving each serving as an
 * independent count/edit target. Groups retain menu order; serving sizes run
 * from small to large so the choice is scannable at a glance. */
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

/** How long a freshly-counted drink stays undoable before we deliver it. We
 *  defer the backend send by this window so the queued payload remains
 *  retractable (removeQueuedDrink only works pre-delivery) — otherwise a fast
 *  POST marks the drink 'sent' within a fraction of a second and the undo row
 *  vanishes before the user can reach it. The launch/foreground flush still
 *  delivers anything left waiting, so a deferred drink is never stranded. */
const UNDO_WINDOW_MS = 6000;

export function minutesSinceDrink(at: string, nowMs: number = Date.now()): number | null {
  const atMs = Date.parse(at);
  if (!Number.isFinite(atMs)) return null;
  return Math.max(0, Math.floor((nowMs - atMs) / 60000));
}

function lastDrinkAgoText(at: string, nowMs: number): string | null {
  const minutes = minutesSinceDrink(at, nowMs);
  if (minutes === null) return null;
  return minutes === 0 ? cs.counter.lastDrinkJustNow : cs.counter.lastDrinkMinutesAgo(minutes);
}

function lastAlcoholAgoText(at: string, nowMs: number): string | null {
  const minutes = minutesSinceDrink(at, nowMs);
  if (minutes === null) return null;
  return minutes === 0 ? cs.counter.lastAlcoholJustNow : cs.counter.lastAlcoholMinutesAgo(minutes);
}

export function shouldWarnRapidDrink(lastDrinkAt: string | undefined, nowMs: number = Date.now()): boolean {
  if (!lastDrinkAt) return false;
  const atMs = Date.parse(lastDrinkAt);
  if (!Number.isFinite(atMs)) return false;
  const elapsedMs = nowMs - atMs;
  return elapsedMs >= 0 && elapsedMs < MIN_PLAUSIBLE_BEER_GAP_MS;
}

function ActiveCounter({ place, onChangePlace, onPubRenamed, embedded }: ActiveCounterProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const hapticEnabled = useSettingsStore((s) => s.hapticEnabled);
  const waterNudgeEnabled = useSettingsStore((s) => s.waterNudgeEnabled);
  const priceCurrency = useSettingsStore((s) => s.priceCurrency);
  const showToast = useToastStore((s) => s.show);
  // The top edge the parent has NOT already padded: 0 when embedded (the "Pivo"
  // tab owns the inset + segment), the safe-area inset when standalone.
  const topInset = embedded ? 0 : insets.top;

  // Null outside a pub — every pub-only affordance (menu, mapping, check-in,
  // visit sync, community merge, share-here) keys off this.
  const pub = place.kind === 'pub' ? place.pub : null;
  const outsideContext = place.kind === 'outside' ? place.context : null;
  const placeLabel = pub ? pub.name : cs.counter.outsideLabel(outsideContext as OutsidePlaceContext);

  const cell = useMemo(
    () =>
      place.kind === 'pub'
        ? geohash8(place.pub.lat, place.pub.lng)
        : contextPubKey(place.context),
    [place],
  );

  const setOverride = useCommunityStore((s) => s.setOverride);
  const override = useCommunityStore((s) => s.overrides[cell]);

  const current = useTallyStore((s) => s.current);
  const history = useTallyStore((s) => s.history);
  const addDrink = useTallyStore((s) => s.addDrink);
  const addBackdatedDrink = useTallyStore((s) => s.addBackdatedDrink);
  const removeDrink = useTallyStore((s) => s.removeDrink);
  const markDrinkSynced = useTallyStore((s) => s.markDrinkSynced);
  const archiveCurrent = useTallyStore((s) => s.archiveCurrent);
  const resumeLast = useTallyStore((s) => s.resumeLast);

  const [formMode, setFormMode] = useState<BeerFormMode | null>(null);
  const [formBeer, setFormBeer] = useState<CommunityBeer | null>(null);
  const [formDrinkType, setFormDrinkType] = useState<DrinkType>('beer');
  // Outside a pub: the serving the user last picked ("Jak je podané?"), seeding
  // the next add form so the second lahváč is a single confirm.
  const [lastServingType, setLastServingType] = useState<ServingType>('bottle');
  // Set when the add form was opened via "zapsat zpětně": the ISO timestamp the
  // next added beer is counted at. Cleared on submit/cancel.
  const [backdateAt, setBackdateAt] = useState<string | null>(null);
  // Bumped on each open so the form body remounts with fresh, prop-seeded state.
  const [formNonce, setFormNonce] = useState(0);
  const [backendMenu, setBackendMenu] = useState<{
    pubId: string;
    beers: CommunityBeer[];
    historicalBeers: CommunityBeer[];
    beersUpdatedAt: string | null;
    beerMenuRotates: boolean;
  } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [sharingWithFriends, setSharingWithFriends] = useState(false);
  // The pub cell I've broadcast to; once it matches the active pub the button
  // flips to a calm "already live" state so the verb never doubles up (rich
  // compose lives on Parta). Derived, so switching pubs resets it for free.
  const [broadcastCell, setBroadcastCell] = useState<string | null>(null);
  const [checkInBeerName, setCheckInBeerName] = useState<string | null>(null);
  const [checkInSheetOpen, setCheckInSheetOpen] = useState(false);
  const [scanSourceVisible, setScanSourceVisible] = useState(false);
  const [photoCaptureOpen, setPhotoCaptureOpen] = useState(false);
  const [scanningDrinks, setScanningDrinks] = useState(false);
  const [scannedDrinks, setScannedDrinks] = useState<ScannedDrink[]>([]);
  // Deferred-send timers per drink id; a count schedules delivery for the end of
  // the undo window, and undo cancels its drink's timer before it fires.
  const sendTimers = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // The `${clientId}:${count}` key we last fired the water nudge at. Keyed by
  // session identity (not just count) so rapid taps sharing a threshold don't
  // double-fire, yet a fresh evening reaching the same count in the same mounted
  // counter still nudges.
  const waterNudgeKeyRef = React.useRef('');

  useEffect(() => {
    const timers = sendTimers.current;
    return () => {
      // Leaving the screen ends the undo window: cancel the pending timers and
      // hand off to a single flush so nothing held for undo is left undelivered.
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      void flushDrinksQueue();
    };
  }, []);

  useEffect(() => {
    if (!pub) return;
    const controller = new AbortController();
    const pubId = pub.id;

    fetchPubHours([pub], controller.signal).then((resultMap) => {
      if (controller.signal.aborted) return;
      const result = resultMap.get(pubId);
      setBackendMenu(
        result
          ? {
              pubId,
              beers: result.beers ?? [],
              historicalBeers: result.historicalBeers ?? [],
              beersUpdatedAt: result.beersUpdatedAt ?? null,
              beerMenuRotates: result.beerMenuRotates ?? false,
            }
          : null,
      );
    });

    return () => controller.abort();
  }, [pub]);

  const broadcasted = broadcastCell === cell;

  // Session totals — only count drinks for THIS pub's session.
  const isThisPubSession = current?.pubKey === cell;
  const count = isThisPubSession ? sessionCount(current) : 0;
  const totalCzk = isThisPubSession ? sessionTotalCzk(current) : 0;
  const sessionDrinks = useMemo(
    () => (isThisPubSession ? current?.drinks ?? [] : []),
    [isThisPubSession, current],
  );
  const latestBeer = [...sessionDrinks].reverse().find((drink) => normalizeDrinkType(drink.drinkType) === 'beer');
  const latestAlcohol = [...sessionDrinks].reverse().find((drink) => normalizeDrinkType(drink.drinkType) !== 'soft_drink');
  const latestDrinkAt = latestAlcohol?.at;
  const latestDrinkText = latestBeer ? lastDrinkAgoText(latestBeer.at, nowMs) : null;
  const latestAlcoholText = latestAlcohol ? lastAlcoholAgoText(latestAlcohol.at, nowMs) : null;
  const drinkTypeCounts = useMemo(() => sessionDrinkTypeCounts(isThisPubSession ? current : null), [isThisPubSession, current]);
  const otherDrinkSummary = [
    drinkTypeCounts.wine > 0 ? wineCountLabel(drinkTypeCounts.wine) : null,
    drinkTypeCounts.soft_drink > 0 ? softDrinkCountLabel(drinkTypeCounts.soft_drink) : null,
    drinkTypeCounts.shot > 0 ? shotCountLabel(drinkTypeCounts.shot) : null,
  ].filter((part): part is string => part !== null).join(' · ');
  const beerCounts = useMemo(
    () => (isThisPubSession ? sessionBeerCounts(current) : new Map<string, number>()),
    [isThisPubSession, current],
  );

  // A recently auto-completed evening at THIS pub that the user can pick back up
  // instead of starting a fresh count. Only surfaced when this pub has no live
  // count (count === 0); recomputed when the session/history change.
  const resumable = useMemo(
    () => (count === 0 ? resumableSession(current, history, cell) : null),
    [count, current, history, cell],
  );
  const resumeSummary = resumable ? beerCountLabel(sessionCount(resumable)) : null;

  useEffect(() => {
    if (!latestDrinkAt) return undefined;
    const timer = setInterval(() => setNowMs(Date.now()), 60 * 1000);
    if (typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') {
      timer.unref();
    }
    return () => clearInterval(timer);
  }, [latestDrinkAt]);

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
    if (!pub) {
      // Outside a pub there is no community menu. The list holds what you've
      // logged tonight (one row per beer identity, latest first) so the next
      // one of the same beer is a single tap.
      const seen = new Map<string, CommunityBeer>();
      for (const drink of sessionDrinks) {
        if (normalizeDrinkType(drink.drinkType) !== 'beer') continue;
        const key = `${drink.beerName.trim().toLowerCase()}|${drink.volumeMl ?? ''}`;
        if (seen.has(key)) continue;
        seen.set(key, {
          name: drink.beerName,
          ...(typeof drink.priceCzk === 'number' ? { priceCzk: drink.priceCzk } : {}),
          ...(typeof drink.volumeMl === 'number' ? { volumeMl: drink.volumeMl } : {}),
        });
      }
      return [...seen.values()];
    }
    if (currentBeerListOverride?.beers) return currentBeerListOverride.beers;
    if (currentBackendMenu?.beers.length) return currentBackendMenu.beers;
    return pub.beers ?? [];
  }, [currentBackendMenu, currentBeerListOverride, pub, sessionDrinks]);
  const menuGroups = useMemo(() => groupMenuBeers(menu), [menu]);
  const beerMenuRotates = pub
    ? currentMenuTypeOverride?.beerMenuRotates ??
      currentBackendMenu?.beerMenuRotates ??
      pub.beerMenuRotates ??
      false
    : false;

  const historicalBeers = useMemo<CommunityBeer[]>(() => {
    if (!pub) return [];
    if (currentBeerListOverride?.historicalBeers) {
      return currentBeerListOverride.historicalBeers;
    }
    if (currentBackendMenu?.historicalBeers.length) return currentBackendMenu.historicalBeers;
    return pub.historicalBeers ?? [];
  }, [currentBackendMenu, currentBeerListOverride, pub]);

  // — Count one beer (writes tally + queue + menu override) —
  // `atOverride` backdates the drink (PIV-25). When the backdated timestamp
  // would roll over and archive the LIVE evening (different drinking day / pub),
  // we file it into a past evening via addBackdatedDrink so `current` is never
  // clobbered; otherwise it appends to the active session like a normal count.
  // Backdated drinks skip the "now"-relative touches (nowMs sync, rapid-drink
  // warning, check-in prompt, water nudge).
  const countBeer = useCallback(
    (
      beer: CommunityBeer & { priceCzk?: number; drinkType?: DrinkType; servingType?: ServingType },
      atOverride?: string,
    ) => {
      const id = generateUuidV4();
      const at = atOverride ?? new Date().toISOString();
      const drinkType = beer.drinkType ?? 'beer';
      const startsSession = !isThisPubSession || (current?.drinks.length ?? 0) === 0;
      setNowMs(atOverride ? Date.now() : Date.parse(at));

      // The tally place identity: a pub, or the synthetic outside context whose
      // display label doubles as the "pub name" everywhere the diary shows one.
      const tallyPlace = pub
        ? { pubKey: cell, pubName: pub.name, pubCity: pub.city, pubExternalId: pub.id }
        : { pubKey: cell, pubName: placeLabel, placeContext: outsideContext as OutsidePlaceContext };
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
      // history so it never becomes/clobbers the live session — regardless of
      // whether a `current` session exists. Same-day backdates count normally.
      const backdateToPast = !!atOverride && isPastEveningBackdate(at);

      let landedSession: TallySession | null;
      if (backdateToPast) {
        // Files into a past evening, leaving the live session untouched.
        landedSession = addBackdatedDrink(tallyPlace, tallyBeer);
      } else {
        addDrink(tallyPlace, tallyBeer);
        landedSession = useTallyStore.getState().current;
      }
      // Every real-time beer moves the evening's single reminder forward. It
      // never repeats by itself; only a new beer or a notification tap re-arms
      // it. The session id keeps the whole chain scoped to this one evening.
      if (!atOverride && drinkType === 'beer' && landedSession) {
        void refreshBeerCountReminderAfterBeer(landedSession.clientId);
      }
      // Push/refresh the visit ("evening") record for the session the drink
      // actually landed in. addDrink/addBackdatedDrink write synchronously, so
      // the freshest session is on the store now; the POST is idempotent on the
      // session clientId. An outside evening is NOT a pub visit — skip.
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
      // the app (same rule as the backend merge). Pub only — an outside beer
      // must never enter any pub's community data.
      if (pub && drinkType === 'beer' && typeof beer.priceCzk === 'number') {
        const mergedMenu = mergeBeerIntoMenu(menu, { ...beer, priceCzk: beer.priceCzk });
        setOverride(cell, { beers: mergedMenu });
      }
      // The check-in prompt ("I'm drinking this now") is now-semantic and
      // pub-bound — skip it for a backdated or outside log.
      if (pub && !atOverride && drinkType === 'beer') setCheckInBeerName(beer.name);

      // Persist + best-effort deliver the drink.
      const entry = buildDrinkEntry(
        {
          ...(pub
            ? {
                externalId: pub.id || null,
                name: pub.name,
                lat: pub.lat,
                lng: pub.lng,
                city: pub.city,
              }
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
      // Persist now (crash-safe) but hold the actual send for the undo window so
      // the queued payload stays retractable; deliver + mark synced when it ends.
      void enqueueDrink(entry, { deliver: false });
      const timer = setTimeout(() => {
        sendTimers.current.delete(id);
        void flushDrinksQueue()
          .then(() => isDrinkQueued(id))
          .then((stillQueued) => {
            if (!stillQueued) markDrinkSynced(id);
          });
      }, UNDO_WINDOW_MS);
      sendTimers.current.set(id, timer);

      if (hapticEnabled) {
        fireSuccessHaptic();
      }

      // Gentle water nudge every 4th beer in a row (4, 8, 12…). Local-only, no
      // notifications — just a mate at the table reminding you to hydrate.
      // Backdated drinks aren't part of the "now" streak, so they never nudge.
      // Read the count from the store (not the rendered closure) and guard by
      // session identity + count so rapid taps sharing a threshold can't
      // double-fire, while a fresh evening reaching 4 still nudges.
      const liveSession = useTallyStore.getState().current;
      const liveCount = sessionCount(liveSession);
      const nudgeKey = liveSession ? `${liveSession.clientId}:${liveCount}` : '';
      if (
        !atOverride &&
        drinkType === 'beer' &&
        waterNudgeEnabled &&
        liveCount > 0 &&
        liveCount % 4 === 0 &&
        waterNudgeKeyRef.current !== nudgeKey
      ) {
        waterNudgeKeyRef.current = nudgeKey;
        showToast(cs.counter.waterNudge(liveCount), {
          icon: <GlassWaterIcon size={20} color={Colors.amber} />,
        });
      }
    },
    [addDrink, addBackdatedDrink, cell, current, hapticEnabled, isThisPubSession, markDrinkSynced, menu, outsideContext, placeLabel, pub, setOverride, showToast, waterNudgeEnabled],
  );

  const requestCountBeer = useCallback(
    (
      beer: CommunityBeer & { priceCzk?: number; drinkType?: DrinkType; servingType?: ServingType },
      atOverride?: string,
    ) => {
      // A backdated beer can't be "too fast right now" — count it straight away.
      if (atOverride || beer.drinkType === 'soft_drink' || !shouldWarnRapidDrink(latestDrinkAt)) {
        countBeer(beer, atOverride);
        return;
      }

      const body = cs.counter.rapidDrinkBody(latestAlcoholText ?? cs.counter.lastAlcoholJustNow);
      showAppDialog({
        title: cs.counter.rapidDrinkTitle,
        message: body,
        buttons: [
          { text: cs.counter.cancel, style: 'cancel' },
          { text: cs.counter.rapidDrinkConfirm, onPress: () => countBeer(beer) },
        ],
      });
    },
    [countBeer, latestAlcoholText, latestDrinkAt],
  );

  // Tap a menu card: priced → instant +1; unpriced → ask price first.
  const openForm = useCallback((mode: BeerFormMode, beer: CommunityBeer | null, drinkType: DrinkType = 'beer') => {
    setFormBeer(beer);
    setFormDrinkType(drinkType);
    setFormMode(mode);
    setFormNonce((n) => n + 1);
    void trackClientEvent({
      event: 'beer_form_opened',
      context: { mode },
    });
  }, []);

  const handleTapBeer = useCallback(
    (beer: CommunityBeer) => {
      if (!pub) {
        // Outside a pub a repeat tap counts straight away — price optional, no
        // price prompt. Reuse the serving of the last logged drink of this beer.
        const key = `${beer.name.trim().toLowerCase()}|${beer.volumeMl ?? ''}`;
        const previous = [...sessionDrinks]
          .reverse()
          .find(
            (drink) => `${drink.beerName.trim().toLowerCase()}|${drink.volumeMl ?? ''}` === key,
          );
        requestCountBeer({
          ...beer,
          drinkType: 'beer',
          servingType: previous?.servingType ?? lastServingType,
        });
        return;
      }
      if (typeof beer.priceCzk === 'number') {
        requestCountBeer({ ...beer, priceCzk: beer.priceCzk, drinkType: 'beer' });
      } else {
        openForm('price', beer);
      }
    },
    [lastServingType, openForm, pub, requestCountBeer, sessionDrinks],
  );

  const handleEditBeer = useCallback(
    (beer: CommunityBeer) => {
      openForm('edit', beer);
    },
    [openForm],
  );

  const handleAddBeer = useCallback(() => {
    setBackdateAt(null);
    openForm('add', null, 'beer');
  }, [openForm]);

  const handleAddOtherDrink = useCallback(() => {
    setBackdateAt(null);
    openForm('add', null, 'soft_drink');
  }, [openForm]);

  // "Vyfoť celý lístek" inside the add form: hand over to the contribute
  // editor's AI scan with the current menu prefilled. The scanned beers land
  // back here through the community override the editor writes on save.
  const handleScanMenu = useCallback(() => {
    if (!pub) return;
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
        ...(historicalBeers.length > 0
          ? { historicalBeers: JSON.stringify(historicalBeers) }
          : {}),
        beerMenuRotates: beerMenuRotates ? '1' : '0',
      },
    });
  }, [beerMenuRotates, historicalBeers, menu, pub, router]);

  const runDrinkScan = useCallback(
    async (source: MenuPhotoSource) => {
      setScanSourceVisible(false);
      setScanningDrinks(true);
      const toast = useToastStore.getState().show;
      try {
        const { pickAndPrepareMenuPhoto } = await import('@/data/menuPhotoPicker');
        const picked = await pickAndPrepareMenuPhoto(source);
        if (picked.status === 'cancelled') return;
        if (picked.status === 'denied' || picked.status === 'denied-permanent') {
          toast(cs.contribute.scanMenu.permissionDenied, { icon: <CameraIcon size={18} color={Colors.amber} /> });
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
    },
    [],
  );

  const handleSelectScannedDrink = useCallback(
    (drink: ScannedDrink) => {
      setScannedDrinks([]);
      openForm('add', drink, drink.drinkType);
    },
    [openForm],
  );

  // "Zapsat zpětně" — pick a past time from quick chips, then the normal add
  // form. The chosen ISO timestamp rides `backdateAt` into the count so the
  // session-rollover logic files it into the right evening (PIV-25).
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
    // Clamp every option to the 48h cap so a chip can never file a drink older
    // than we allow.
    const clamp = (ms: number) => new Date(Math.max(ms, now - CAP_MS)).toISOString();
    // Yesterday at 20:00 local — a sensible "the evening I forgot to log" anchor.
    const yesterdayEvening = new Date(now);
    yesterdayEvening.setDate(yesterdayEvening.getDate() - 1);
    yesterdayEvening.setHours(20, 0, 0, 0);

    showAppDialog({
      title: cs.counter.backdateTitle,
      buttons: [
        { text: cs.counter.backdateHourAgo, onPress: () => openBackdateForm(clamp(now - 60 * 60 * 1000)) },
        { text: cs.counter.backdateTwoHoursAgo, onPress: () => openBackdateForm(clamp(now - 2 * 60 * 60 * 1000)) },
        {
          text: cs.counter.backdateYesterdayEvening,
          onPress: () => openBackdateForm(clamp(yesterdayEvening.getTime())),
        },
        { text: cs.counter.cancel, style: 'cancel' },
      ],
    });
  }, [openBackdateForm]);

  const handleFormSubmit = useCallback(
    (result: BeerFormResult) => {
      const mode = formMode;
      // Capture the row being edited BEFORE clearing form state — identity is
      // name+volume, so a volume edit must replace this exact row in place.
      const editedBeer = formBeer;
      // Consume any pending backdate (set by the "zapsat zpětně" flow).
      const at = backdateAt ?? undefined;
      setFormMode(null);
      setFormBeer(null);
      setBackdateAt(null);
      const beer = {
        name: result.name,
        priceCzk: result.priceCzk,
        volumeMl: result.volumeMl,
        drinkType: result.drinkType,
        servingType: result.servingType,
      };
      if (result.servingType) setLastServingType(result.servingType);
      if (result.drinkType === 'beer' && typeof result.priceCzk === 'number' && pub) {
        void trackClientEvent({
          event: 'beer_price_added',
          context: { mode: mode ?? 'unknown' },
        });
      }
      if (mode === 'edit') {
        // Community-menu edit is a pub concept; outside rows are session-derived
        // and never editable (the long-press target is disabled there).
        if (!pub) return;
        // Replace the edited row in place. mergeBeerIntoMenu matches on
        // name+volume, so a volume change would otherwise append a NEW row and
        // orphan the original — the PIV-33 bug. Editing the pre-change identity
        // keeps exactly one row per beer.
        const nextMenu = editedBeer
          ? menu
              .map((b) => (isSameBeerIdentity(b, editedBeer) ? beer : b))
              // A volume/name edit can collide with another existing row; drop
              // the duplicate so the menu keeps one row per identity.
              .filter((b) => b === beer || !isSameBeerIdentity(b, beer))
          : mergeBeerIntoMenu(menu, beer);
        setOverride(cell, { beers: nextMenu });
      } else {
        // 'add' and 'price' both count the beer immediately (or at `at` when the
        // add form was opened via the backdate flow).
        requestCountBeer(beer, at);
      }
    },
    [backdateAt, cell, formBeer, formMode, menu, pub, requestCountBeer, setOverride],
  );

  // Remove the most recently counted drink OF THIS BEER. Optimistically drops it
  // from the local tally, then reconciles delivery: if the payload is still
  // queued (caught inside the undo window, or just offline) we pull it before it
  // ever sends; if it already reached the backend we enqueue a durable DELETE so
  // the server drops the row too. The community menu/price is left untouched.
  const decrementBeer = useCallback(
    (beer: CommunityBeer) => {
      const key = beerKey(beer);
      const drinks = current?.pubKey === cell ? current.drinks : [];
      let targetId: string | null = null;
      for (let i = drinks.length - 1; i >= 0; i--) {
        const drinkKey = `${drinks[i].beerName.trim().toLowerCase()}|${drinks[i].volumeMl ?? ''}`;
        if (drinkKey === key) {
          targetId = drinks[i].id;
          break;
        }
      }
      if (!targetId) return;

      // Cancel the deferred send so a not-yet-delivered drink never goes out.
      const timer = sendTimers.current.get(targetId);
      if (timer) {
        clearTimeout(timer);
        sendTimers.current.delete(targetId);
      }

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
      const removedId = targetId;
      void removeQueuedDrink(removedId).then((pulledFromQueue) => {
        void trackClientEvent({
          event: 'drink_removed',
          context: { delivery_state: pulledFromQueue ? 'queued' : 'delivered' },
        });
        if (!pulledFromQueue) {
          void flushDrinksQueue()
            .then(() => enqueueDelete(removedId))
            .catch(() => undefined);
        }
      });

      if (hapticEnabled) {
        fireLightImpactHaptic();
      }
    },
    [cell, current, hapticEnabled, pub, removeDrink],
  );

  // "Dopito" — confirm, then archive the evening into history. The deferred
  // sends already in flight still deliver; we only close the local session.
  const handleDone = useCallback(() => {
    showAppDialog({
      title: cs.counter.doneTitle,
      message: cs.counter.doneBody,
      buttons: [
        { text: cs.counter.cancel, style: 'cancel' },
        {
          text: cs.counter.doneConfirm,
          onPress: () => {
            archiveCurrent('manual');
            void trackClientEvent({ event: 'counter_session_closed', context: { reason: 'manual' } });
            if (hapticEnabled) fireLightImpactHaptic();
          },
        },
      ],
    });
  }, [archiveCurrent, hapticEnabled]);

  // "Pokračovat ve večeru" — pop the auto-completed evening back to live so the
  // next count continues the same session (same backend visit).
  const handleResume = useCallback(() => {
    const ok = resumeLast(cell);
    if (ok) {
      void trackClientEvent({ event: 'counter_session_resumed' });
      if (hapticEnabled) fireLightImpactHaptic();
    }
  }, [cell, hapticEnabled, resumeLast]);

  const handleShareWithFriends = useCallback(async () => {
    if (!pub || sharingWithFriends || broadcasted) return;
    setSharingWithFriends(true);
    const shareClientId = isThisPubSession && current?.clientId ? current.clientId : generateUuidV4();
    // One-tap quick broadcast: empty message (the rich compose with a message
    // lives on Parta). The "already live" flip keeps the verb from doubling up.
    const result = await shareFriendPubActivity(pub, '', shareClientId);
    setSharingWithFriends(false);
    if (result.ok) {
      setBroadcastCell(cell);
      showToast(cs.friends.shareSuccess, { icon: <BellRingIcon size={20} color={Colors.amber} /> });
      if (hapticEnabled) fireLightImpactHaptic();
    } else if (isRetriableFriendError(result)) {
      await enqueueFriendOp({ op: 'activity', clientId: shareClientId, payload: { pub, message: '' } });
      setBroadcastCell(cell);
      showToast(cs.friends.composeQueued, { icon: <BellRingIcon size={20} color={Colors.amber} /> });
    } else {
      showToast(result.detail || cs.friends.shareError, { icon: <BellRingIcon size={20} color={Colors.amber} /> });
    }
  }, [broadcasted, cell, current, hapticEnabled, isThisPubSession, pub, sharingWithFriends, showToast]);

  const hasMenu = menu.length > 0;

  return (
    <View style={[styles.root, { paddingTop: topInset + 8 }]}>
      {/* Header: pub name + session actions. "Změnit" (when several candidates)
          and "Dopito" live here as compact chips — both act on the SESSION, sit
          above the scroll so they're always discoverable, and stay subordinate
          to the big amber +/- counting in the body. */}
      <View style={styles.header}>
        {outsideContext ? (
          (() => {
            const HeaderIcon = OUTSIDE_HEADER_ICONS[outsideContext];
            return <HeaderIcon size={18} color={Colors.amber} />;
          })()
        ) : (
          <MapPinIcon size={18} color={Colors.amber} />
        )}
        <Text style={styles.headerPub} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
          {placeLabel}
        </Text>
        {/* Always available: with the "Mimo hospodu" section the picker is
            meaningful even when GPS found a single (or no) candidate. */}
        <Pressable
          onPress={onChangePlace}
          style={styles.changeButton}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.counterChangePub}
        >
          <Text style={styles.changeButtonText} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.counter.changePub}
          </Text>
        </Pressable>
        {count > 0 && (
          <Pressable
            onPress={handleDone}
            style={({ pressed }) => [styles.doneButton, pressed && styles.doneButtonPressed]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={cs.a11y.counterDone}
          >
            <CheckIcon size={15} color={Colors.amber} />
            <Text style={styles.doneButtonText} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.counter.doneDrinking}
            </Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom + 16, 28) }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Keep the public mapping prompt in the motivation zone, but as one
            compact strip so it doesn't push the beer stepper below the fold.
            Pub only — there is nothing to map about a living room. */}
        {pub ? (
          <View style={styles.mapPubTop}>
            <MapPubEntry
              pubKey={cell}
              pubName={pub.name}
              info={pubInfoFromPub(pub)}
              onRenamed={onPubRenamed}
            />
          </View>
        ) : null}

        {/* Hero */}
        <Hero
          count={count}
          hasSessionDrinks={sessionDrinks.length > 0}
          otherDrinkSummary={otherDrinkSummary}
          totalCzk={totalCzk}
          // Outside a pub the price is optional; a wallet line of "0 Kč" would
          // claim knowledge we don't have — unknown stays unknown.
          showSpent={!outsideContext || totalCzk > 0}
          latestDrinkText={latestDrinkText}
          reducedMotion={reducedMotion}
          priceCurrency={priceCurrency}
          onResume={resumable ? handleResume : undefined}
          resumeSummary={resumeSummary}
        />

        {/* Weekly-race tie-in: projected countrywide rank + the post-log
            "posun v žebříčku" toast. Renders nothing until a beer is counted. */}
        <WeeklyRankChip sessionBeerCount={count} />

        {checkInBeerName ? (
          <View style={styles.checkInPrompt}>
            <Pressable
              onPress={() => setCheckInSheetOpen(true)}
              style={({ pressed }) => [styles.checkInCta, pressed && styles.friendShareButtonPressed]}
              accessibilityRole="button"
            >
              <BeerIcon size={17} color={Colors.stout} />
              <Text style={styles.checkInCtaText} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.beerCheckins.quickCta}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setCheckInBeerName(null)}
              style={({ pressed }) => [styles.checkInDismiss, pressed && styles.friendShareButtonPressed]}
              accessibilityRole="button"
            >
              <Text style={styles.checkInDismissText} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.beerCheckins.quickDismiss}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* Menu */}
        {hasMenu ? (
          <>
            <View style={styles.menuHeaderRow}>
              <Text style={styles.menuHeader} maxFontSizeMultiplier={FontScaleCap.heading}>
                {pub ? cs.counter.menuHeader : cs.counter.outsideMenuHeader}
              </Text>
              {beerMenuRotates ? (
                <View style={styles.rotatingMenuBadge}>
                  <RefreshCwIcon size={12} color={Colors.amber} />
                  <Text style={styles.rotatingMenuBadgeText} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.counter.rotatingMenuBadge}
                  </Text>
                </View>
              ) : null}
            </View>
            {beerMenuRotates ? (
              <Text style={styles.rotatingMenuHint} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.counter.rotatingMenuHint}
              </Text>
            ) : null}
            <View style={styles.menuList}>
              {menuGroups.map((group) => (
                <MenuCard
                  key={group.key}
                  name={group.name}
                  variants={group.beers.map((beer) => ({
                    beer,
                    count: beerCounts.get(beerKey(beer)) ?? 0,
                    onCount: () => handleTapBeer(beer),
                    onDecrement: () => decrementBeer(beer),
                    // Long-press edit rewrites the pub's community menu; the
                    // outside list is session-derived, nothing to edit.
                    onEdit: pub ? () => handleEditBeer(beer) : () => undefined,
                  }))}
                  priceCurrency={priceCurrency}
                />
              ))}
            </View>
            <Pressable
              onPress={handleAddBeer}
              style={styles.addBeerCard}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={cs.a11y.counterAddBeer}
            >
              <PlusIcon size={18} color={Colors.amber} />
              <Text style={styles.addBeerText} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.counter.addBeer}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleBackdatePress}
              style={({ pressed }) => [styles.backdateLink, pressed && styles.friendShareButtonPressed]}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={cs.counter.backdateTitle}
            >
              <HistoryIcon size={15} color={Colors.mutedText} />
              <Text style={styles.backdateLinkText} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.counter.backdateLink}
              </Text>
            </Pressable>
          </>
        ) : (
          <View style={styles.emptyMenu}>
            <Text style={styles.emptyMenuTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
              {pub && beerMenuRotates
                ? cs.counter.rotatingMenuBadge
                : pub
                  ? cs.counter.emptyMenuTitle
                  : cs.counter.outsideEmptyTitle}
            </Text>
            <Text style={styles.emptyMenuBody} maxFontSizeMultiplier={FontScaleCap.body}>
              {pub && beerMenuRotates
                ? cs.counter.rotatingMenuHint
                : pub
                  ? cs.counter.emptyMenuBody
                  : cs.counter.outsideEmptyBody}
            </Text>
            <View style={styles.emptyMenuButton}>
              <GlowButton
                label={pub ? cs.counter.emptyMenuCta : cs.counter.outsideEmptyCta}
                onPress={handleAddBeer}
                glow="soft"
                icon={<PlusIcon size={20} color={Colors.stout} />}
                accessibilityLabel={cs.a11y.counterAddBeer}
              />
            </View>
          </View>
        )}

        <View style={styles.secondaryDrinkActions}>
          <Pressable
            onPress={handleAddOtherDrink}
            style={({ pressed }) => [styles.secondaryDrinkButton, pressed && styles.friendShareButtonPressed]}
            accessibilityRole="button"
            accessibilityLabel={cs.counter.addOtherDrink}
          >
            <GlassWaterIcon size={17} color={Colors.foamMuted} />
            <Text style={styles.secondaryDrinkText} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.counter.addOtherDrink}
            </Text>
          </Pressable>
          {pub ? (
            <Pressable
              onPress={() => setScanSourceVisible(true)}
              disabled={scanningDrinks}
              style={({ pressed }) => [styles.secondaryDrinkButton, (pressed || scanningDrinks) && styles.friendShareButtonPressed]}
              accessibilityRole="button"
              accessibilityLabel={cs.counter.scanDrinks}
            >
              <CameraIcon size={17} color={Colors.foamMuted} />
              <Text style={styles.secondaryDrinkText} maxFontSizeMultiplier={FontScaleCap.body}>
                {scanningDrinks ? cs.counter.scanDrinksLoading : cs.counter.scanDrinks}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/* Secondary social actions. Mapping already lives near the top; these
            remain lower so the first screen is not a stack of chores. The photo
            pill drops into the diary capture flow with tonight's pub pre-tagged
            from this session. */}
        <View style={styles.pubActions}>
          <Pressable
            onPress={() => setPhotoCaptureOpen(true)}
            style={({ pressed }) => [styles.friendShareButton, pressed && styles.friendShareButtonPressed]}
            accessibilityRole="button"
            accessibilityLabel={cs.a11y.counterPhotoCta}
          >
            <CameraIcon size={18} color={Colors.amber} />
            <Text style={styles.friendShareText} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.photoDiary.counterCta}
            </Text>
          </Pressable>
          {pub ? (
            <Pressable
              onPress={() => void handleShareWithFriends()}
              disabled={sharingWithFriends || broadcasted}
              style={({ pressed }) => [
                styles.friendShareButton,
                (pressed || sharingWithFriends || broadcasted) && styles.friendShareButtonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={broadcasted ? cs.friends.counterAlreadyLive : cs.friends.shareHereShort}
            >
              {broadcasted ? (
                <CheckIcon size={18} color={Colors.amber} />
              ) : (
                <BellRingIcon size={18} color={Colors.amber} />
              )}
              <Text style={styles.friendShareText} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                {broadcasted ? cs.friends.counterAlreadyLive : cs.friends.shareHereShort}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

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
        // editor, which would silently drop the picked past timestamp) and
        // outside a pub (there is no pub menu to fill).
        onScanMenu={backdateAt || !pub ? undefined : handleScanMenu}
      />
      <ScanMenuSheet
        visible={scanSourceVisible}
        onClose={() => setScanSourceVisible(false)}
        onPick={(source) => void runDrinkScan(source)}
      />
      <BeerPhotoCaptureFlow open={photoCaptureOpen} onClose={() => setPhotoCaptureOpen(false)} />
      <ScannedDrinkPicker
        visible={scannedDrinks.length > 0}
        drinks={scannedDrinks}
        priceCurrency={priceCurrency}
        onClose={() => setScannedDrinks([])}
        onSelect={handleSelectScannedDrink}
      />
      {pub && checkInBeerName && checkInSheetOpen ? (
        <BeerCheckInSheet
          visible={checkInSheetOpen}
          key={checkInBeerName}
          beerName={checkInBeerName}
          pub={pub}
          pubKey={cell}
          visitClientId={isThisPubSession ? current?.clientId : null}
          onClose={() => setCheckInSheetOpen(false)}
          onSubmitted={() => setCheckInBeerName(null)}
        />
      ) : null}
    </View>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function Hero({
  count,
  hasSessionDrinks,
  otherDrinkSummary,
  totalCzk,
  latestDrinkText,
  reducedMotion,
  priceCurrency,
  showSpent = true,
  onResume,
  resumeSummary,
}: {
  count: number;
  hasSessionDrinks: boolean;
  otherDrinkSummary: string;
  totalCzk: number;
  latestDrinkText: string | null;
  reducedMotion: boolean;
  priceCurrency: PriceCurrency;
  /** Hide the "Utraceno" pill when the total is genuinely unknown (outside a
   *  pub with no prices entered) — unknown must not read as 0 Kč. */
  showSpent?: boolean;
  /** Resume a recent auto-completed evening — only shown when count === 0. */
  onResume?: () => void;
  /** Short "3 piva" recap of the resumable evening, for the hint line. */
  resumeSummary?: string | null;
}) {
  if (count === 0 && !hasSessionDrinks) {
    return (
      <View style={styles.hero}>
        <View style={[styles.heroEmptyIcon, amberGlow(14)]}>
          <BeerIcon size={64} color={Colors.amber} />
        </View>
        <Text style={styles.heroEmptyTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
          {cs.counter.heroEmptyTitle}
        </Text>
        {onResume && (
          <View style={styles.resumeWrap}>
            <GlowButton
              label={cs.counter.resumeEvening}
              onPress={onResume}
              glow="soft"
              icon={<Undo2Icon size={20} color={Colors.stout} />}
              accessibilityLabel={cs.a11y.counterResume}
            />
            {resumeSummary && (
              <Text style={styles.resumeHint} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.counter.resumeHint(resumeSummary)}
              </Text>
            )}
          </View>
        )}
      </View>
    );
  }

  return (
    <View
      style={styles.hero}
      accessible
      accessibilityRole="text"
      accessibilityLabel={cs.a11y.counterTotal(beerCountLabel(count), formatPrice(totalCzk, priceCurrency))}
    >
      <View style={styles.heroMetricFrame}>
        <View style={styles.heroGlowBlob} pointerEvents="none">
          <SoftGlow size={340} color={Colors.glow} opacity={0.42} />
        </View>
        <View style={[styles.heroCountGlow, amberGlowStrong(28)]}>
          <Text style={styles.heroCount} maxFontSizeMultiplier={FontScaleCap.display}>
            {count}
          </Text>
        </View>
      </View>
      <Text style={styles.heroNoun} maxFontSizeMultiplier={FontScaleCap.heading}>
        {beerCountLabel(count).split(' ')[1]}
      </Text>
      {showSpent ? (
        <View style={styles.spentPill}>
          <Text style={styles.spentPillText} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.counter.totalSpent(formatPrice(totalCzk, priceCurrency))}
          </Text>
        </View>
      ) : null}
      {otherDrinkSummary ? (
        <Text style={styles.otherDrinkSummary} maxFontSizeMultiplier={FontScaleCap.body}>
          {otherDrinkSummary}
        </Text>
      ) : null}
      {latestDrinkText && (
        <Text style={styles.heroLastDrink} maxFontSizeMultiplier={FontScaleCap.body}>
          {latestDrinkText}
        </Text>
      )}
    </View>
  );
}

// ─── Screen root ──────────────────────────────────────────────────────────────

export default function CounterScreen({ embedded = false }: { embedded?: boolean } = {}) {
  const { candidates, selected, selectPub, permissionState, requestPermission, loading, retry } =
    useNearbyPub();
  const [pickerOpen, setPickerOpen] = useState(false);
  // "Mimo hospodu" mode. Restored from a live outside session so returning to
  // the tab mid-evening lands back in it (useNearbyPub ignores ctx sessions).
  const [outsideContext, setOutsideContext] = useState<OutsidePlaceContext | null>(() => {
    const current = useTallyStore.getState().current;
    if (!current || current.drinks.length === 0) return null;
    return contextFromPubKey(current.pubKey);
  });
  const hadActiveSessionOnOpen = React.useRef(
    (useTallyStore.getState().current?.drinks.length ?? 0) > 0,
  );

  useEffect(() => {
    void trackCounterTabOpened(hadActiveSessionOnOpen.current);
  }, []);

  // Active pub: ONLY an explicit selection (auto-pick within 120 m, a pinned
  // session, or a manual pick). The old `?? candidates[0]` fallback silently
  // attributed drinks to a pub up to 3 km away — when nothing is close enough,
  // the user picks a place instead (NoPubScreen → picker).
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

  // One picker for every entry point: gates open it too (with no candidates it
  // is just the "Mimo hospodu" sheet).
  const picker = (
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
  );

  if (!place) {
    if (permissionState !== 'granted') {
      return (
        <>
          <PermissionScreen
            permissionState={permissionState}
            requestPermission={requestPermission}
            onLogOutside={() => setOutsideContext('other')}
            embedded={embedded}
          />
          {picker}
        </>
      );
    }

    if (loading) {
      return <DetectingScreen embedded={embedded} />;
    }

    return (
      <>
        <NoPubScreen
          candidatesCount={candidates.length}
          onPickPlace={() => setPickerOpen(true)}
          onLogOutside={() => setOutsideContext('other')}
          onRetry={retry}
          embedded={embedded}
        />
        {picker}
      </>
    );
  }

  return (
    <>
      <ActiveCounter
        place={place}
        onChangePlace={() => setPickerOpen(true)}
        onPubRenamed={(name) => {
          if (!activePub) return;
          // Re-pin the renamed Pub so the header updates now, and keep the live
          // evening's display name in step with it.
          selectPub({ ...activePub, name });
          useTallyStore.getState().renameCurrentPub(geohash8(activePub.lat, activePub.lng), name);
        }}
        embedded={embedded}
      />
      {picker}
    </>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.stout },
  flex: { flex: 1 },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: Spacing.md,
  },

  permIconWrap: { marginBottom: 4 },
  bigTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 26,
    color: Colors.foam,
    textAlign: 'center',
    lineHeight: 32,
  },
  body: {
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    color: Colors.mutedText,
    textAlign: 'center',
    lineHeight: 22,
  },
  permButtonWrap: { alignSelf: 'stretch', marginTop: Spacing.sm },
  permSecondaryWrap: { alignSelf: 'stretch', marginTop: -Spacing.xs },
  noPubAddLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.xs,
  },
  noPubAddLinkText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.mutedText,
  },
  // — Header —
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: Spacing.lg,
    paddingBottom: 6,
  },
  headerPub: {
    flex: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 20,
    color: Colors.foam,
  },
  changeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  changeButtonText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.amber,
  },

  pubActions: {
    marginTop: Spacing.lg,
    gap: Spacing.sm,
  },
  mapPubTop: {
    marginBottom: 6,
  },
  friendShareButton: {
    minHeight: 46,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  friendShareButtonPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
  friendShareText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.foam,
  },

  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: 2,
  },
  // — Hero —
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 238,
    paddingTop: 8,
    paddingBottom: 8,
  },
  heroEmptyIcon: {
    marginBottom: Spacing.md,
  },
  heroEmptyTitle: {
    fontFamily: Fonts.display.bold,
    fontSize: 20,
    color: Colors.foamMuted,
    textAlign: 'center',
    paddingHorizontal: Spacing.lg,
  },
  // Sized to the digit; the glow is an absolutely-centered sibling behind it so
  // the halo stays symmetric around the number on every count.
  heroMetricFrame: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  heroGlowBlob: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCountGlow: {
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 2,
    overflow: 'visible',
  },
  heroCount: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 96,
    // Keep the line box tall enough that the extrabold digit never clips at the
    // top; the gap to "piv" is closed by the noun's negative margin instead, so
    // we don't trade a bottom gap for a top crop.
    lineHeight: 112,
    color: Colors.amber,
    includeFontPadding: false,
  },
  heroNoun: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    color: Colors.foam,
    // Pull up into the digit's empty descender/leading space (which has no
    // glyph for a number) to tighten the number↔word gap without clipping.
    marginTop: -22,
  },
  // The spent total lives in a contained pill so it reads as a deliberate
  // stat chip rather than text floating under the hero.
  spentPill: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  spentPillText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 16,
    color: Colors.foamMuted,
  },
  heroLastDrink: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.mutedText,
    marginTop: 6,
  },
  otherDrinkSummary: {
    marginTop: 7,
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.foamMuted,
  },
  // "Dopito" — a compact session chip in the header. Same outline treatment as
  // "Změnit" (stout2 fill + border + amber label) so the two read as a matched
  // pair of secondary actions, never competing with the body's counting.
  doneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  doneButtonPressed: {
    opacity: 0.7,
  },
  doneButtonText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.amber,
  },
  // Resume CTA under the empty-state title when a recent evening can continue.
  resumeWrap: {
    alignSelf: 'stretch',
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  resumeHint: {
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    color: Colors.mutedText,
    textAlign: 'center',
    lineHeight: 19,
  },
  checkInPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  checkInCta: {
    flex: 1,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  checkInCtaText: {
    fontFamily: Fonts.display.bold,
    fontSize: 14,
    color: Colors.stout,
  },
  checkInDismiss: {
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
  },
  checkInDismissText: {
    fontFamily: Fonts.display.bold,
    fontSize: 13,
    color: Colors.foamMuted,
  },

  // — Menu —
  menuHeader: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
  },
  menuHeaderRow: {
    marginTop: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  rotatingMenuBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.32),
    backgroundColor: withAlpha(Colors.amber, 0.08),
  },
  rotatingMenuBadgeText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    color: Colors.amber,
  },
  rotatingMenuHint: {
    marginTop: -2,
    marginBottom: 10,
    fontFamily: Fonts.ui.regular,
    fontSize: 12,
    lineHeight: 17,
    color: Colors.foamMuted,
  },
  menuList: {
    gap: 10,
  },
  menuCard: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  menuCardCounted: {
    borderColor: Colors.amber,
  },
  menuCardPressed: {
    opacity: 0.85,
  },
  menuCardName: {
    fontFamily: Fonts.display.bold,
    fontSize: 17,
    color: Colors.foam,
  },
  menuVariants: {
    marginTop: 4,
  },
  menuVariantRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  menuVariantRowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.border, 0.55),
  },
  menuVariantMeta: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  // Serving size as a small amber tag so the 0,3/0,5 choice pops before the
  // price when both pours sit on one card.
  menuVariantVolumeChip: {
    minWidth: 48,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.35),
    alignItems: 'center',
  },
  menuVariantVolume: {
    fontFamily: Fonts.display.bold,
    fontSize: 13,
    color: Colors.amber,
  },
  menuVariantPrice: {
    flexShrink: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foamMuted,
  },
  menuCardMetaMissing: {
    color: Colors.mutedText,
    fontStyle: 'italic',
  },
  // — Per-beer stepper (− value +) —
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countBadge: {
    minWidth: 40,
    height: 40,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.stout,
  },
  stepButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The plus carries an amber outline so it reads as the primary "+1" action;
  // the muted minus sits quietly beside the count so removing never feels like
  // the headline gesture.
  stepButtonPlus: {
    borderColor: Colors.amber,
    backgroundColor: withAlpha(Colors.amber, 0.14),
  },
  stepButtonMinus: {
    borderColor: Colors.border,
  },
  stepButtonPressed: {
    opacity: 0.7,
  },
  addBeerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    marginTop: 10,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
  },
  addBeerText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 15,
    color: Colors.amber,
  },
  backdateLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 8,
  },
  backdateLinkText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.mutedText,
  },
  secondaryDrinkActions: {
    marginTop: Spacing.lg,
    gap: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
  },
  secondaryDrinkButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: Spacing.md,
  },
  secondaryDrinkText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.foamMuted,
  },

  // — Empty menu —
  emptyMenu: {
    alignItems: 'center',
    gap: Spacing.md,
    paddingTop: Spacing.md,
    paddingHorizontal: Spacing.sm,
  },
  emptyMenuTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
    textAlign: 'center',
    lineHeight: 28,
    alignSelf: 'stretch',
  },
  emptyMenuBody: {
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    color: Colors.mutedText,
    textAlign: 'center',
    lineHeight: 23,
    alignSelf: 'center',
    maxWidth: 320,
  },
  emptyMenuButton: {
    alignSelf: 'stretch',
    marginTop: Spacing.sm,
  },
});
