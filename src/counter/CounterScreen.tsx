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
import { View, Text, Pressable, ScrollView, StyleSheet, Linking, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  useReducedMotion,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { amberGlow, amberGlowStrong } from '@/theme/shadows';
import { cs } from '@/i18n/cs';
import { beerCountLabel } from '@/i18n/plural';
import { GlowButton } from '@/components/shared/GlowButton';
import { BeerBubbles } from '@/components/celebration/BeerBubbles';
import {
  BeerIcon,
  MapPinIcon,
  PlusIcon,
  Undo2Icon,
  RefreshCwIcon,
} from '@/components/shared/IconGlyph';

import { geohash8 } from '@/data/geohash';
import { generateUuidV4 } from '@/data/account';
import { mergeBeerIntoMenu, type CommunityBeer } from '@/data/communityHours';
import { fetchPubHours } from '@/data/hoursClient';
import { buildDrinkEntry } from '@/data/drinksClient';
import { enqueueDrink, flushDrinksQueue, removeQueuedDrink } from '@/data/drinksQueue';
import { useCommunityStore } from '@/stores/communityStore';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  useTallyStore,
  sessionCount,
  sessionTotalCzk,
  sessionBeerCounts,
} from '@/stores/tallyStore';
import type { Pub } from '@/data/pubs';

import { useNearbyPub } from '@/counter/useNearbyPub';
import { PubPickerModal } from '@/counter/PubPickerModal';
import { BeerFormModal, type BeerFormMode, type BeerFormResult } from '@/counter/BeerFormModal';

// ─── Permission gate ──────────────────────────────────────────────────────────

function PermissionScreen({
  permissionState,
  requestPermission,
}: {
  permissionState: 'denied' | 'undetermined';
  requestPermission: () => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, styles.centered, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
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
    </View>
  );
}

// ─── Detecting + empty ────────────────────────────────────────────────────────

function DetectingScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, styles.centered, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={[styles.permIconWrap, amberGlow(16)]}>
        <MapPinIcon size={48} color={Colors.amber} />
      </View>
      <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
        {cs.counter.detecting}
      </Text>
    </View>
  );
}

function NoPubScreen({ onRetry }: { onRetry: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, styles.centered, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
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
    </View>
  );
}

// ─── Menu card ────────────────────────────────────────────────────────────────

interface MenuCardProps {
  beer: CommunityBeer;
  count: number;
  /** Increments each time THIS beer is counted; drives the bounce. */
  pulseToken: number;
  onCount: () => void;
  onEdit: () => void;
}

function MenuCard({ beer, count, pulseToken, onCount, onEdit }: MenuCardProps) {
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

  const handlePress = () => {
    onCount();
  };

  const meta = hasPrice
    ? cs.counter.beerMeta(beer.priceCzk as number, beer.volumeMl)
    : cs.counter.pricePlaceholder;

  const a11yLabel = hasPrice
    ? cs.a11y.counterCountBeer(beer.name, cs.counter.price(beer.priceCzk as number))
    : cs.a11y.counterCountBeerNoPrice(beer.name);

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        onPress={handlePress}
        onLongPress={onEdit}
        delayLongPress={300}
        style={({ pressed }) => [styles.menuCard, count > 0 && styles.menuCardCounted, pressed && styles.menuCardPressed]}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityHint={cs.a11y.counterEditBeer(beer.name)}
      >
        <View style={styles.menuCardText}>
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
        </View>
        {count > 0 ? (
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.counter.perBeerCount(count)}
            </Text>
          </View>
        ) : (
          <View style={styles.plusBadge}>
            <PlusIcon size={20} color={Colors.amber} />
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

// ─── Active counter ───────────────────────────────────────────────────────────

interface ActiveCounterProps {
  pub: Pub;
  candidatesCount: number;
  onChangePub: () => void;
}

/** A stable identity key for a menu beer (normalized name + volume). */
function beerKey(beer: CommunityBeer): string {
  return `${beer.name.trim().toLowerCase()}|${beer.volumeMl ?? ''}`;
}

const RAPID_DRINK_WARNING_MS = 5 * 60 * 1000;

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

function ActiveCounter({ pub, candidatesCount, onChangePub }: ActiveCounterProps) {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const hapticEnabled = useSettingsStore((s) => s.hapticEnabled);

  const cell = useMemo(() => geohash8(pub.lat, pub.lng), [pub.lat, pub.lng]);

  const setOverride = useCommunityStore((s) => s.setOverride);
  const override = useCommunityStore((s) => s.overrides[cell]);

  const current = useTallyStore((s) => s.current);
  const addDrink = useTallyStore((s) => s.addDrink);
  const undoLast = useTallyStore((s) => s.undoLast);
  const markDrinkSynced = useTallyStore((s) => s.markDrinkSynced);

  const [formMode, setFormMode] = useState<BeerFormMode | null>(null);
  const [formBeer, setFormBeer] = useState<CommunityBeer | null>(null);
  // Bumped on each open so the form body remounts with fresh, prop-seeded state.
  const [formNonce, setFormNonce] = useState(0);
  // Per-beer pulse counter (key → token); bumped on each count to bounce a card.
  const [pulses, setPulses] = useState<Record<string, number>>({});
  const [backendMenu, setBackendMenu] = useState<{ pubId: string; beers: CommunityBeer[] } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const controller = new AbortController();

    fetchPubHours([pub], controller.signal).then((resultMap) => {
      if (controller.signal.aborted) return;
      setBackendMenu({ pubId: pub.id, beers: resultMap.get(pub.id)?.beers ?? [] });
    });

    return () => controller.abort();
  }, [pub]);

  // Session totals — only count drinks for THIS pub's session.
  const isThisPubSession = current?.pubKey === cell;
  const count = isThisPubSession ? sessionCount(current) : 0;
  const totalCzk = isThisPubSession ? sessionTotalCzk(current) : 0;
  const latestDrink = isThisPubSession ? current?.drinks[current.drinks.length - 1] : undefined;
  const latestDrinkAt = latestDrink?.at;
  const latestDrinkId = latestDrink?.id ?? null;
  const latestDrinkSyncStatus = latestDrink?.syncStatus ?? 'pending';
  const canUndo = latestDrinkId !== null && latestDrinkSyncStatus !== 'sent';
  const latestDrinkText = latestDrinkAt ? lastDrinkAgoText(latestDrinkAt, nowMs) : null;
  const beerCounts = useMemo(
    () => (isThisPubSession ? sessionBeerCounts(current) : new Map<string, number>()),
    [isThisPubSession, current],
  );

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
      setNowMs(Date.parse(at));

      addDrink(
        { pubKey: cell, pubName: pub.name },
        { id, beerName: beer.name, priceCzk: beer.priceCzk, volumeMl: beer.volumeMl, at },
      );

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
      void enqueueDrink(entry).then((leftQueue) => {
        if (leftQueue) markDrinkSynced(id);
      });
      void flushDrinksQueue();

      if (hapticEnabled) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      }
    },
    [addDrink, cell, hapticEnabled, markDrinkSynced, menu, pub, setOverride],
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

  const handleUndo = useCallback(() => {
    if (!canUndo || !latestDrinkId) return;
    void removeQueuedDrink(latestDrinkId).then((removed) => {
      if (removed) {
        undoLast(latestDrinkId);
      } else {
        markDrinkSynced(latestDrinkId);
      }
    });
  }, [canUndo, latestDrinkId, markDrinkSynced, undoLast]);

  const hasMenu = menu.length > 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      {/* Header: pub name + change */}
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
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom + 16, 28) }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <Hero count={count} totalCzk={totalCzk} latestDrinkText={latestDrinkText} reducedMotion={reducedMotion} />

        {count > 0 && canUndo && (
          <Pressable
            onPress={handleUndo}
            style={styles.undoRow}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={cs.a11y.counterUndo}
          >
            <Undo2Icon size={15} color={Colors.mutedText} />
            <Text style={styles.undoText} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.counter.undoLast}
            </Text>
          </Pressable>
        )}

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
                  onEdit={() => handleEditBeer(beer)}
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
}: {
  count: number;
  totalCzk: number;
  latestDrinkText: string | null;
  reducedMotion: boolean;
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
      </View>
    );
  }

  return (
    <View
      style={styles.hero}
      accessible
      accessibilityRole="text"
      accessibilityLabel={cs.a11y.counterTotal(beerCountLabel(count), cs.counter.price(totalCzk))}
    >
      {!reducedMotion && <BeerBubbles width={260} height={160} bubbleCount={16} />}
      <View style={amberGlowStrong(28)}>
        <Text style={styles.heroCount} maxFontSizeMultiplier={FontScaleCap.display}>
          {count}
        </Text>
      </View>
      <Text style={styles.heroNoun} maxFontSizeMultiplier={FontScaleCap.heading}>
        {beerCountLabel(count).split(' ')[1]}
      </Text>
      <Text style={styles.heroTotal} maxFontSizeMultiplier={FontScaleCap.heading}>
        {cs.counter.totalSpent(cs.counter.price(totalCzk))}
      </Text>
      {latestDrinkText && (
        <Text style={styles.heroLastDrink} maxFontSizeMultiplier={FontScaleCap.body}>
          {latestDrinkText}
        </Text>
      )}
    </View>
  );
}

// ─── Screen root ──────────────────────────────────────────────────────────────

export default function CounterScreen() {
  const { candidates, selected, selectPub, permissionState, requestPermission, loading, retry } =
    useNearbyPub();
  const [pickerOpen, setPickerOpen] = useState(false);

  // Active pub: an explicit selection, else the nearest candidate.
  const activePub = selected ?? candidates[0]?.pub ?? null;
  const activeKey = activePub ? geohash8(activePub.lat, activePub.lng) : null;

  if (permissionState !== 'granted') {
    return <PermissionScreen permissionState={permissionState} requestPermission={requestPermission} />;
  }

  if (loading) {
    return <DetectingScreen />;
  }

  if (!activePub) {
    return <NoPubScreen onRetry={retry} />;
  }

  return (
    <>
      <ActiveCounter pub={activePub} candidatesCount={candidates.length} onChangePub={() => setPickerOpen(true)} />
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

  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },

  // — Hero —
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    minHeight: 200,
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
  heroCount: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 120,
    lineHeight: 132,
    color: Colors.amber,
    includeFontPadding: false,
  },
  heroNoun: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 28,
    color: Colors.foam,
    marginTop: -8,
  },
  heroTotal: {
    fontFamily: Fonts.ui.bold,
    fontSize: 17,
    color: Colors.foamMuted,
    marginTop: Spacing.sm,
  },
  heroLastDrink: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.mutedText,
    marginTop: 6,
  },

  // — Undo —
  undoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
    marginBottom: Spacing.sm,
  },
  undoText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.mutedText,
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
  plusBadge: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
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
