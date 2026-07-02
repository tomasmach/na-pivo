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
import { View, Text, Pressable, ScrollView, StyleSheet, Linking, Alert, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  useReducedMotion,
} from 'react-native-reanimated';

import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { amberGlow, amberGlowStrong } from '@/theme/shadows';
import { cs } from '@/i18n/cs';
import { beerCountLabel } from '@/i18n/plural';
import { GlowButton } from '@/components/shared/GlowButton';
import { BeerBubbles } from '@/components/celebration/BeerBubbles';
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
} from '@/components/shared/IconGlyph';

import { geohash8 } from '@/data/geohash';
import { generateUuidV4 } from '@/data/account';
import { mergeBeerIntoMenu, type CommunityBeer } from '@/data/communityHours';
import { fetchPubHours } from '@/data/hoursClient';
import { buildDrinkEntry } from '@/data/drinksClient';
import { enqueueDrink, flushDrinksQueue, isDrinkQueued, removeQueuedDrink } from '@/data/drinksQueue';
import { enqueueDelete } from '@/data/deleteDrinksQueue';
import { deleteVisitByClientId, syncVisit } from '@/data/visitsSync';
import { shareFriendPubActivity } from '@/data/friendsClient';
import { trackCounterTabOpened } from '@/data/counterTelemetry';
import { trackClientEvent } from '@/data/telemetryClient';
import { fireSuccessHaptic, fireLightImpactHaptic } from '@/utils/haptics';
import { useCommunityStore } from '@/stores/communityStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToastStore } from '@/stores/toastStore';
import { formatPrice, pricePlaceholder, type PriceCurrency } from '@/utils/currency';
import {
  useTallyStore,
  sessionCount,
  sessionTotalCzk,
  sessionBeerCounts,
  resumableSession,
} from '@/stores/tallyStore';
import type { Pub } from '@/data/pubs';

import { useNearbyPub } from '@/counter/useNearbyPub';
import { PubPickerModal } from '@/counter/PubPickerModal';
import { BeerFormModal, type BeerFormMode, type BeerFormResult } from '@/counter/BeerFormModal';
import { MapPubEntry } from '@/components/amenities/MapPubEntry';
import { pubInfoFromPub } from '@/components/amenities/pubInfoContext';

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
  embedded,
}: {
  permissionState: 'denied' | 'undetermined';
  requestPermission: () => Promise<void>;
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

function NoPubScreen({ onRetry, embedded }: { onRetry: () => void; embedded: boolean }) {
  return (
    <CenteredScreen embedded={embedded}>
      <View style={styles.permIconWrap}>
        <BeerIcon size={56} color={Colors.amber} />
      </View>
      <Text style={styles.bigTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
        {cs.counter.noPubTitle}
      </Text>
      <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
        {cs.counter.noPubBody}
      </Text>
      <View style={styles.permButtonWrap}>
        <GlowButton
          label={cs.counter.retry}
          onPress={onRetry}
          glow="soft"
          icon={<RefreshCwIcon size={20} color={Colors.stout} />}
          accessibilityLabel={cs.a11y.counterRetry}
        />
      </View>
    </CenteredScreen>
  );
}

// ─── Menu card ────────────────────────────────────────────────────────────────

interface MenuCardProps {
  beer: CommunityBeer;
  count: number;
  /** Increments each time THIS beer is counted; drives the bounce. */
  pulseToken: number;
  onCount: () => void;
  onDecrement: () => void;
  onEdit: () => void;
  priceCurrency: PriceCurrency;
}

function MenuCard({ beer, count, pulseToken, onCount, onDecrement, onEdit, priceCurrency }: MenuCardProps) {
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const hasPrice = typeof beer.priceCzk === 'number';

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  // Springy bounce each time this beer is counted. Keyed purely on pulseToken
  // (which only ever increments on a +1 for this beer), the effect body is a
  // single shared-value write — the BeerBubbles pattern the React Compiler /
  // immutability lint accepts. pulseToken starts at 0 so mount never pulses, and
  // an undo never bumps it.
  useEffect(() => {
    if (pulseToken === 0 || reducedMotion) return;
    // Writing a reanimated shared value drives the bounce on the UI thread; the
    // experimental immutability rule misfires on this valid pattern.
    // eslint-disable-next-line react-hooks/immutability
    scale.value = withSequence(
      withSpring(1.04, { damping: 12, stiffness: 320 }),
      withSpring(1, { damping: 14, stiffness: 260 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulseToken]);

  const meta = hasPrice
    ? cs.counter.beerMeta(formatPrice(beer.priceCzk as number, priceCurrency), beer.volumeMl)
    : pricePlaceholder(priceCurrency);

  const countA11yLabel = hasPrice
    ? cs.a11y.counterCountBeer(beer.name, formatPrice(beer.priceCzk as number, priceCurrency))
    : cs.a11y.counterCountBeerNoPrice(beer.name);

  return (
    <Animated.View style={animatedStyle}>
      <View style={[styles.menuCard, count > 0 && styles.menuCardCounted]}>
        {/* Name + price doubles as the edit target (long-press) — counting and
            removing live in the explicit stepper so taps never feel ambiguous. */}
        <Pressable
          onLongPress={onEdit}
          delayLongPress={300}
          style={({ pressed }) => [styles.menuCardText, pressed && styles.menuCardPressed]}
          accessibilityRole="button"
          accessibilityLabel={beer.name}
          accessibilityHint={cs.a11y.counterEditBeer(beer.name)}
        >
          <Text style={styles.menuCardName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
            {beer.name}
          </Text>
          <Text
            style={[styles.menuCardMeta, !hasPrice && styles.menuCardMetaMissing]}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {meta}
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
                accessibilityLabel={cs.a11y.counterRemoveBeer(beer.name)}
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
    </Animated.View>
  );
}

// ─── Active counter ───────────────────────────────────────────────────────────

interface ActiveCounterProps {
  pub: Pub;
  candidatesCount: number;
  onChangePub: () => void;
  /** Hosted inside the merged "Pivo" tab: the parent owns the top safe-area
   *  inset and the segment header, so the counter drops its own top padding. */
  embedded: boolean;
}

/** A stable identity key for a menu beer (normalized name + volume). */
function beerKey(beer: CommunityBeer): string {
  return `${beer.name.trim().toLowerCase()}|${beer.volumeMl ?? ''}`;
}

const RAPID_DRINK_WARNING_MS = 5 * 60 * 1000;

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

export function shouldWarnRapidDrink(lastDrinkAt: string | undefined, nowMs: number = Date.now()): boolean {
  if (!lastDrinkAt) return false;
  const atMs = Date.parse(lastDrinkAt);
  if (!Number.isFinite(atMs)) return false;
  const elapsedMs = nowMs - atMs;
  return elapsedMs >= 0 && elapsedMs < RAPID_DRINK_WARNING_MS;
}

function ActiveCounter({ pub, candidatesCount, onChangePub, embedded }: ActiveCounterProps) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const hapticEnabled = useSettingsStore((s) => s.hapticEnabled);
  const priceCurrency = useSettingsStore((s) => s.priceCurrency);
  const showToast = useToastStore((s) => s.show);
  // The top edge the parent has NOT already padded: 0 when embedded (the "Pivo"
  // tab owns the inset + segment), the safe-area inset when standalone.
  const topInset = embedded ? 0 : insets.top;

  const cell = useMemo(() => geohash8(pub.lat, pub.lng), [pub.lat, pub.lng]);

  const setOverride = useCommunityStore((s) => s.setOverride);
  const override = useCommunityStore((s) => s.overrides[cell]);

  const current = useTallyStore((s) => s.current);
  const history = useTallyStore((s) => s.history);
  const addDrink = useTallyStore((s) => s.addDrink);
  const removeDrink = useTallyStore((s) => s.removeDrink);
  const markDrinkSynced = useTallyStore((s) => s.markDrinkSynced);
  const archiveCurrent = useTallyStore((s) => s.archiveCurrent);
  const resumeLast = useTallyStore((s) => s.resumeLast);

  const [formMode, setFormMode] = useState<BeerFormMode | null>(null);
  const [formBeer, setFormBeer] = useState<CommunityBeer | null>(null);
  // Bumped on each open so the form body remounts with fresh, prop-seeded state.
  const [formNonce, setFormNonce] = useState(0);
  // Per-beer pulse counter (key → token); bumped on each count to bounce a card.
  const [pulses, setPulses] = useState<Record<string, number>>({});
  const [backendMenu, setBackendMenu] = useState<{ pubId: string; beers: CommunityBeer[] } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [sharingWithFriends, setSharingWithFriends] = useState(false);
  // The pub cell I've broadcast to; once it matches the active pub the button
  // flips to a calm "already live" state so the verb never doubles up (rich
  // compose lives on Parta). Derived, so switching pubs resets it for free.
  const [broadcastCell, setBroadcastCell] = useState<string | null>(null);
  // Deferred-send timers per drink id; a count schedules delivery for the end of
  // the undo window, and undo cancels its drink's timer before it fires.
  const sendTimers = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

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
    const controller = new AbortController();

    fetchPubHours([pub], controller.signal).then((resultMap) => {
      if (controller.signal.aborted) return;
      setBackendMenu({ pubId: pub.id, beers: resultMap.get(pub.id)?.beers ?? [] });
    });

    return () => controller.abort();
  }, [pub]);

  const broadcasted = broadcastCell === cell;

  // Session totals — only count drinks for THIS pub's session.
  const isThisPubSession = current?.pubKey === cell;
  const count = isThisPubSession ? sessionCount(current) : 0;
  const totalCzk = isThisPubSession ? sessionTotalCzk(current) : 0;
  const latestDrink = isThisPubSession ? current?.drinks[current.drinks.length - 1] : undefined;
  const latestDrinkAt = latestDrink?.at;
  const latestDrinkText = latestDrinkAt ? lastDrinkAgoText(latestDrinkAt, nowMs) : null;
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

  // The menu shown = pub.beers (backend/enriched) merged with the local
  // community override (the authoritative local copy). The override already
  // folds in every beer counted this session (we setOverride on each count), so
  // it is the single source of truth for the visible menu.
  const menu = useMemo<CommunityBeer[]>(() => {
    const backendBeers = backendMenu?.pubId === pub.id ? backendMenu.beers : [];
    if (override?.beers && override.beers.length > 0) return override.beers;
    if (backendBeers.length > 0) return backendBeers;
    return pub.beers ?? [];
  }, [backendMenu, override, pub.beers, pub.id]);

  // — Count one beer (writes tally + queue + menu override) —
  const countBeer = useCallback(
    (beer: CommunityBeer & { priceCzk: number }) => {
      const id = generateUuidV4();
      const at = new Date().toISOString();
      const startsSession = count === 0;
      setNowMs(Date.parse(at));

      addDrink(
        { pubKey: cell, pubName: pub.name },
        { id, beerName: beer.name, priceCzk: beer.priceCzk, volumeMl: beer.volumeMl, at },
      );
      // Push/refresh the visit ("evening") record. addDrink writes synchronously,
      // so the freshest session — with this beer and its bumped ended_at — is on
      // the store now; the visit POST is idempotent on the session clientId.
      syncVisit(useTallyStore.getState().current);
      if (startsSession) {
        void trackClientEvent({ event: 'counter_session_started' });
      }
      void trackClientEvent({
        event: 'drink_added',
        context: { had_active_session: !startsSession },
      });

      // Merge into the local community menu so the price shows instantly across
      // the app (same rule as the backend merge).
      const mergedMenu = mergeBeerIntoMenu(menu, beer);
      setOverride(cell, { beers: mergedMenu });

      // Bounce the matching menu card.
      const key = beerKey(beer);
      setPulses((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));

      // Persist + best-effort deliver the drink.
      const entry = buildDrinkEntry(
        {
          externalId: pub.id || null,
          name: pub.name,
          lat: pub.lat,
          lng: pub.lng,
          city: pub.city,
          beer: { name: beer.name, priceCzk: beer.priceCzk, volumeMl: beer.volumeMl },
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
    },
    [addDrink, cell, count, hapticEnabled, markDrinkSynced, menu, pub, setOverride],
  );

  const requestCountBeer = useCallback(
    (beer: CommunityBeer & { priceCzk: number }) => {
      if (!shouldWarnRapidDrink(latestDrinkAt)) {
        countBeer(beer);
        return;
      }

      const body = cs.counter.rapidDrinkBody(latestDrinkText ?? cs.counter.lastDrinkJustNow);
      Alert.alert(cs.counter.rapidDrinkTitle, body, [
        { text: cs.counter.cancel, style: 'cancel' },
        { text: cs.counter.rapidDrinkConfirm, onPress: () => countBeer(beer) },
      ]);
    },
    [countBeer, latestDrinkAt, latestDrinkText],
  );

  // Tap a menu card: priced → instant +1; unpriced → ask price first.
  const openForm = useCallback((mode: BeerFormMode, beer: CommunityBeer | null) => {
    setFormBeer(beer);
    setFormMode(mode);
    setFormNonce((n) => n + 1);
    void trackClientEvent({
      event: 'beer_form_opened',
      context: { mode },
    });
  }, []);

  const handleTapBeer = useCallback(
    (beer: CommunityBeer) => {
      if (typeof beer.priceCzk === 'number') {
        requestCountBeer({ ...beer, priceCzk: beer.priceCzk });
      } else {
        openForm('price', beer);
      }
    },
    [openForm, requestCountBeer],
  );

  const handleEditBeer = useCallback(
    (beer: CommunityBeer) => {
      openForm('edit', beer);
    },
    [openForm],
  );

  const handleAddBeer = useCallback(() => {
    openForm('add', null);
  }, [openForm]);

  const handleFormSubmit = useCallback(
    (result: BeerFormResult) => {
      const mode = formMode;
      setFormMode(null);
      setFormBeer(null);
      const beer = { name: result.name, priceCzk: result.priceCzk, volumeMl: result.volumeMl };
      void trackClientEvent({
        event: 'beer_price_added',
        context: { mode: mode ?? 'unknown' },
      });
      if (mode === 'edit') {
        // Edit just updates the menu price; the NEXT tap counts it.
        const mergedMenu = mergeBeerIntoMenu(menu, beer);
        setOverride(cell, { beers: mergedMenu });
      } else {
        // 'add' and 'price' both count the beer immediately.
        requestCountBeer(beer);
      }
    },
    [cell, formMode, menu, requestCountBeer, setOverride],
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
      const nextSession = useTallyStore.getState().current;
      if (nextSession && nextSession.drinks.length > 0) {
        syncVisit(nextSession, visitUpdatedAt);
      } else if (currentVisitClientId) {
        deleteVisitByClientId(currentVisitClientId);
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
    [cell, current, hapticEnabled, removeDrink],
  );

  // "Dopito" — confirm, then archive the evening into history. The deferred
  // sends already in flight still deliver; we only close the local session.
  const handleDone = useCallback(() => {
    Alert.alert(cs.counter.doneTitle, cs.counter.doneBody, [
      { text: cs.counter.cancel, style: 'cancel' },
      {
        text: cs.counter.doneConfirm,
        onPress: () => {
          archiveCurrent('manual');
          void trackClientEvent({ event: 'counter_session_closed', context: { reason: 'manual' } });
          if (hapticEnabled) fireLightImpactHaptic();
        },
      },
    ]);
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
    if (sharingWithFriends || broadcasted) return;
    setSharingWithFriends(true);
    const shareClientId = isThisPubSession ? current?.clientId : undefined;
    // One-tap quick broadcast: empty message (the rich compose with a message
    // lives on Parta). The "already live" flip keeps the verb from doubling up.
    const result = await shareFriendPubActivity(pub, '', shareClientId);
    setSharingWithFriends(false);
    if (result.ok) {
      setBroadcastCell(cell);
      showToast(cs.friends.shareSuccess, { icon: <BellRingIcon size={20} color={Colors.amber} /> });
      if (hapticEnabled) fireLightImpactHaptic();
    } else {
      showToast(result.detail || cs.friends.shareError, { icon: <BellRingIcon size={20} color={Colors.amber} /> });
    }
  }, [broadcasted, cell, current?.clientId, hapticEnabled, isThisPubSession, pub, sharingWithFriends, showToast]);

  const hasMenu = menu.length > 0;
  const bubbleFieldWidth = Math.min(screenWidth - Spacing.lg * 2, 340);

  return (
    <View style={[styles.root, { paddingTop: topInset + 8 }]}>
      {count > 0 && !reducedMotion && (
        <View style={[styles.counterBubbleOverlay, { top: topInset + 58 }]} pointerEvents="none">
          <View style={[styles.counterBubbleField, { width: bubbleFieldWidth }]}>
            <BeerBubbles width={bubbleFieldWidth} height={310} bubbleCount={20} overflowVisible />
          </View>
        </View>
      )}

      {/* Header: pub name + session actions. "Změnit" (when several candidates)
          and "Dopito" live here as compact chips — both act on the SESSION, sit
          above the scroll so they're always discoverable, and stay subordinate
          to the big amber +/- counting in the body. */}
      <View style={styles.header}>
        <MapPinIcon size={18} color={Colors.amber} />
        <Text style={styles.headerPub} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
          {pub.name}
        </Text>
        {candidatesCount > 1 && (
          <Pressable
            onPress={onChangePub}
            style={styles.changeButton}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={cs.a11y.counterChangePub}
          >
            <Text style={styles.changeButtonText} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.counter.changePub}
            </Text>
          </Pressable>
        )}
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

      {/* "Zmapuj hospodu" — the community pub-amenities entry for the CURRENT pub.
          Sits directly under the header so it's the first thing visible without
          scrolling; opens the same MapPubSheet keyed on this pub's geohash-8. */}
      <View style={styles.mapPubWrap}>
        <MapPubEntry pubKey={cell} pubName={pub.name} info={pubInfoFromPub(pub)} />
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
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom + 16, 28) }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <Hero
          count={count}
          totalCzk={totalCzk}
          latestDrinkText={latestDrinkText}
          reducedMotion={reducedMotion}
          priceCurrency={priceCurrency}
          onResume={resumable ? handleResume : undefined}
          resumeSummary={resumeSummary}
        />

        {/* Flexible gap — pushes the menu down so a short session doesn't
            leave a dead void at the bottom; collapses when the menu is long. */}
        <View style={styles.flexSpacer} />

        {/* Menu */}
        {hasMenu ? (
          <>
            <Text style={styles.menuHeader} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.counter.menuHeader}
            </Text>
            <View style={styles.menuList}>
              {menu.map((beer) => (
                <MenuCard
                  key={beerKey(beer)}
                  beer={beer}
                  count={beerCounts.get(beerKey(beer)) ?? 0}
                  pulseToken={pulses[beerKey(beer)] ?? 0}
                  onCount={() => handleTapBeer(beer)}
                  onDecrement={() => decrementBeer(beer)}
                  onEdit={() => handleEditBeer(beer)}
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
          </>
        ) : (
          <View style={styles.emptyMenu}>
            <Text style={styles.emptyMenuTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.counter.emptyMenuTitle}
            </Text>
            <Text style={styles.emptyMenuBody} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.counter.emptyMenuBody}
            </Text>
            <View style={styles.emptyMenuButton}>
              <GlowButton
                label={cs.counter.emptyMenuCta}
                onPress={handleAddBeer}
                glow="soft"
                icon={<PlusIcon size={20} color={Colors.stout} />}
                accessibilityLabel={cs.a11y.counterAddBeer}
              />
            </View>
          </View>
        )}
      </ScrollView>

      <BeerFormModal
        visible={formMode !== null}
        mode={formMode ?? 'add'}
        beer={formBeer}
        formKey={formNonce}
        onCancel={() => {
          setFormMode(null);
          setFormBeer(null);
        }}
        onSubmit={handleFormSubmit}
      />
    </View>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function Hero({
  count,
  totalCzk,
  latestDrinkText,
  reducedMotion,
  priceCurrency,
  onResume,
  resumeSummary,
}: {
  count: number;
  totalCzk: number;
  latestDrinkText: string | null;
  reducedMotion: boolean;
  priceCurrency: PriceCurrency;
  /** Resume a recent auto-completed evening — only shown when count === 0. */
  onResume?: () => void;
  /** Short "3 piva" recap of the resumable evening, for the hint line. */
  resumeSummary?: string | null;
}) {
  if (count === 0) {
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
      <View style={styles.spentPill}>
        <Text style={styles.spentPillText} maxFontSizeMultiplier={FontScaleCap.heading}>
          {cs.counter.totalSpent(formatPrice(totalCzk, priceCurrency))}
        </Text>
      </View>
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
  const hadActiveSessionOnOpen = React.useRef(
    (useTallyStore.getState().current?.drinks.length ?? 0) > 0,
  );

  useEffect(() => {
    void trackCounterTabOpened(hadActiveSessionOnOpen.current);
  }, []);

  // Active pub: an explicit selection, else the nearest candidate.
  const activePub = selected ?? candidates[0]?.pub ?? null;
  const activeKey = activePub ? geohash8(activePub.lat, activePub.lng) : null;

  if (permissionState !== 'granted') {
    return (
      <PermissionScreen
        permissionState={permissionState}
        requestPermission={requestPermission}
        embedded={embedded}
      />
    );
  }

  if (loading) {
    return <DetectingScreen embedded={embedded} />;
  }

  if (!activePub) {
    return <NoPubScreen onRetry={retry} embedded={embedded} />;
  }

  return (
    <>
      <ActiveCounter
        pub={activePub}
        candidatesCount={candidates.length}
        onChangePub={() => setPickerOpen(true)}
        embedded={embedded}
      />
      <PubPickerModal
        visible={pickerOpen}
        candidates={candidates}
        selectedKey={activeKey}
        onSelect={(pub) => {
          selectPub(pub);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
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

  // — Header —
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
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

  // "Zmapuj hospodu" entry — full-width pill under the header, on the same
  // gutter as the header + scroll content so it reads as a primary, always-
  // visible action for the current pub (never buried below the fold).
  mapPubWrap: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
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
    paddingTop: Spacing.sm,
  },
  // Eats leftover height on a short session (1–2 beers) so the menu docks
  // toward the thumb instead of stranding a void at the bottom; the minHeight
  // keeps a breath of separation, and flex collapses it once the menu is long.
  flexSpacer: {
    flex: 1,
    minHeight: Spacing.xl,
  },
  counterBubbleOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 310,
    alignItems: 'center',
    overflow: 'visible',
    zIndex: 0,
  },
  counterBubbleField: {
    height: 310,
    overflow: 'visible',
  },

  // — Hero —
  // The top padding gives the centered glow room to bloom above the digit
  // without the ScrollView clipping its halo (the cause of the "uříznutý" glow).
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 88,
    paddingBottom: Spacing.lg,
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
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 2,
    overflow: 'visible',
  },
  heroCount: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 120,
    // Keep the line box tall enough that the extrabold digit never clips at the
    // top; the gap to "piv" is closed by the noun's negative margin instead, so
    // we don't trade a bottom gap for a top crop.
    lineHeight: 142,
    color: Colors.amber,
    includeFontPadding: false,
  },
  heroNoun: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 28,
    color: Colors.foam,
    // Pull up into the digit's empty descender/leading space (which has no
    // glyph for a number) to tighten the number↔word gap without clipping.
    marginTop: -30,
  },
  // The spent total lives in a contained pill so it reads as a deliberate
  // stat chip rather than text floating under the hero.
  spentPill: {
    marginTop: Spacing.md,
    paddingHorizontal: 16,
    paddingVertical: 8,
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
    marginTop: 10,
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

  // — Menu —
  menuHeader: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  menuList: {
    gap: 10,
  },
  menuCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  menuCardCounted: {
    borderColor: Colors.amber,
  },
  menuCardPressed: {
    opacity: 0.85,
  },
  menuCardText: {
    flex: 1,
    gap: 3,
  },
  menuCardName: {
    fontFamily: Fonts.display.bold,
    fontSize: 17,
    color: Colors.foam,
  },
  menuCardMeta: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.amber,
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
