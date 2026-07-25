/**
 * CompassScreen — main screen combining Pencil designs:
 *   Screen 01 (nDTP2)  — active compass, hidden pub
 *   Screen 02 (t7lhE)  — active compass, revealed pub
 *   Screen 04 (b45goy) — nothing nearby
 *   + Permission gate and loading state
 */

import React, { useEffect, useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Linking,
  KeyboardAvoidingView,
  Modal,
  Platform,
  TextInput,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  useAnimatedReaction,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { useCompass } from '@/hooks/useCompass';
import { getAllLoadedPubs, type Pub, type PubPrice } from '@/data/pubs';
import { isPriceApproximate, isPriceFresh, priceAgeLabel } from '@/utils/priceAge';
import type { CommunityBeer } from '@/data/communityClient';
import type { PubReportReason } from '@/data/pubReportsClient';
import { updateAccountPreferences } from '@/data/account';
import { PubFilterSheet } from '@/components/compass/PubFilterSheet';
import {
  EMPTY_PUB_SEARCH_FILTERS,
  activePubSearchFilterCount,
  freshPriceCzks,
  type PubSearchFilters,
} from '@/data/pubSearchFilters';
import { usePubStore } from '@/stores/pubStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { shortestRotationTarget } from '@/compass/rotation';
import { isHeadingAccuracyLow } from '@/compass/headingAccuracy';
import { openHomeInMaps, openPubInMaps } from '@/utils/maps';
import { formatPrice, type PriceCurrency } from '@/utils/currency';

import { CompassContainer } from '@/components/compass/CompassContainer';
import { ExploreSwitch } from '@/components/shared/ExploreSwitch';
import { GlowButton } from '@/components/shared/GlowButton';
import {
  BeerIcon,
  BeerOffIcon,
  RefreshCwIcon,
  SettingsIcon,
  PencilIcon,
  MapPinIcon,
  MapPinPlusIcon,
  MapIcon,
  XIcon,
  ListFilterIcon,
  HouseIcon,
  EllipsisIcon,
  FlagIcon,
  TargetIcon,
  SparklesIcon,
} from '@/components/shared/IconGlyph';
import { MapPubSheet } from '@/components/amenities/MapPubSheet';
import { CompassCard } from '@/compassui/CompassCard';
import { MoreSheet, type MoreRow } from '@/components/shared/MoreSheet';
import { NudgeSlot, type Nudge } from '@/counter/NudgeSlot';
import { CounterCta, CounterSecondary } from '@/counter/CounterCta';
import { ReportPubModal } from '@/components/compass/ReportPubModal';
import { pubInfoFromPub } from '@/components/amenities/pubInfoContext';
import { geohash8 } from '@/data/geohash';
import type { FocusedPub } from '@/stores/focusedPubStore';
import { useToastStore } from '@/stores/toastStore';
import BeerMapScreen from '@/map/BeerMapScreen';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing, CompassSize } from '@/theme/layout';
import { amberGlowStrong } from '@/theme/shadows';
import { cs, formatVolume } from '@/i18n/cs';

// Android's heading samples arrive as discrete jumps (see the rotation
// reaction in CompassScreen); animate between them. The spring is essentially
// critically damped (damping ≈ 2·√stiffness) so the needle settles without
// overshooting — overshoot would read as more wobble, not less.
const ANIMATE_ARROW = Platform.OS === 'android';
const ARROW_SPRING_CONFIG = {
  damping: 26,
  stiffness: 180,
  mass: 1,
  overshootClamping: true,
} as const;

interface RenamePubModalProps {
  visible: boolean;
  currentName: string;
  value: string;
  submitting: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

function RenamePubModal({
  visible,
  currentName,
  value,
  submitting,
  onChange,
  onCancel,
  onSubmit,
}: RenamePubModalProps) {
  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== currentName.trim() && !submitting;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior="padding"
        style={styles.renameOverlay}
      >
        <Pressable style={styles.renameScrim} onPress={onCancel} />
        <View style={styles.renamePanel}>
          <View style={styles.renameIconWell}>
            <PencilIcon size={19} color={Colors.amber} />
          </View>
          <Text style={styles.renameTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.compass.renameTitle}
          </Text>
          <Text style={styles.renameBody} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.compass.renameBody(currentName)}
          </Text>
          <TextInput
            value={value}
            onChangeText={onChange}
            style={styles.renameInput}
            placeholder={cs.compass.renamePlaceholder}
            placeholderTextColor={Colors.mutedText}
            maxLength={200}
            autoFocus
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (canSubmit) onSubmit();
            }}
            accessibilityLabel={cs.a11y.renamePubInput}
          />
          <View style={styles.renameActions}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [styles.renameSecondaryButton, pressed && { opacity: 0.72 }]}
              accessibilityRole="button"
              accessibilityLabel={cs.common.cancel}
            >
              <Text style={styles.renameSecondaryText} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.common.cancel}
              </Text>
            </Pressable>
            <Pressable
              onPress={onSubmit}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.renamePrimaryButton,
                !canSubmit && styles.renamePrimaryDisabled,
                pressed && canSubmit && { opacity: 0.86, transform: [{ scale: 0.98 }] },
              ]}
              accessibilityRole="button"
              accessibilityLabel={cs.a11y.renamePubSaveButton}
            >
              <Text style={styles.renamePrimaryText} maxFontSizeMultiplier={FontScaleCap.body}>
                {submitting ? cs.compass.renameSaving : cs.compass.renameSave}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Permission screen ────────────────────────────────────────────────────────

interface PermissionScreenProps {
  permissionState: 'denied' | 'undetermined';
  requestPermission: () => Promise<void>;
  onShowMap: () => void;
}

function PermissionScreen({ permissionState, requestPermission, onShowMap }: PermissionScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.permCard}>
        {/* Beer decoration */}
        <View style={styles.permIconWrap}>
          <BeerIcon size={56} color={Colors.amber} />
        </View>

        <Text style={styles.permTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
          {cs.permissions.title}
        </Text>
        <Text style={styles.permBody} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.permissions.body}
        </Text>

        <GlowButton
          label={cs.permissions.cta}
          onPress={requestPermission}
          glow="soft"
          accessibilityLabel={cs.permissions.cta}
        />

        {permissionState === 'denied' && (
          <View style={styles.permSecondaryWrap}>
            <GlowButton
              label={cs.permissions.openSettings}
              onPress={() => Linking.openSettings()}
              variant="secondary"
              glow="none"
              height={50}
              accessibilityLabel={cs.permissions.openSettings}
            />
          </View>
        )}

        <Pressable
          onPress={onShowMap}
          style={({ pressed }) => [styles.permissionMapButton, pressed && { opacity: 0.72 }]}
          accessibilityRole="button"
          accessibilityLabel={cs.map.openWithoutLocation}
        >
          <MapIcon size={18} color={Colors.amber} />
          <Text style={styles.permissionMapText}>{cs.map.openWithoutLocation}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Loading screen ────────────────────────────────────────────────────────────

interface LoadingScreenProps {
  rotation: ReturnType<typeof useSharedValue<number>>;
}

function LoadingScreen({ rotation }: LoadingScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.loadingCompassWrap}>
        <CompassContainer rotation={rotation} size={CompassSize} />
      </View>
      <Text style={styles.loadingText} maxFontSizeMultiplier={FontScaleCap.body}>
        Hledáme hospodu…
      </Text>
    </View>
  );
}

// ─── Empty screen (Screen 04) ────────────────────────────────────────────────

interface EmptyScreenProps {
  onSettings: () => void;
  onRetry: () => void;
  onAddPub: () => void;
  searchFailed: boolean;
  filtersActive: boolean;
  onEditFilters: () => void;
  onClearFilters: () => void;
}

function EmptyScreen({
  onSettings,
  onRetry,
  onAddPub,
  searchFailed,
  filtersActive,
  onEditFilters,
  onClearFilters,
}: EmptyScreenProps) {
  const headlineLine1 = searchFailed
    ? cs.empty.searchFailedHeadlineLine1
    : filtersActive
      ? cs.empty.filteredHeadlineLine1
    : cs.empty.headlineLine1;
  const headlineLine2 = searchFailed
    ? cs.empty.searchFailedHeadlineLine2
    : filtersActive
      ? cs.empty.filteredHeadlineLine2
    : cs.empty.headlineLine2;
  const body = searchFailed
    ? cs.empty.searchFailedBody
    : filtersActive
      ? cs.empty.filteredBody
      : cs.empty.body;

  return (
    <View style={styles.emptyContainer}>
      {/* Top group — icon, headline, body, centered vertically */}
      <View style={styles.emptyTopGroup}>
        <View style={[styles.emptyIconWrap, amberGlowStrong(36)]}>
          <BeerOffIcon size={120} color={Colors.amber} />
        </View>

        <View style={styles.emptyHeadlineWrap}>
          <Text style={styles.emptyHeadlineFoam} maxFontSizeMultiplier={FontScaleCap.display}>
            {headlineLine1}
          </Text>
          <Text style={styles.emptyHeadlineAmber} maxFontSizeMultiplier={FontScaleCap.display}>
            {headlineLine2}
          </Text>
        </View>

        <Text style={styles.emptyBody} maxFontSizeMultiplier={FontScaleCap.body}>
          {body}
        </Text>
      </View>

      {/* Bottom group — primary CTA and retry pinned to bottom */}
      <View style={styles.emptyBottomGroup}>
        <View style={styles.emptyButtonWrap}>
          <GlowButton
            label={searchFailed ? cs.empty.retry : filtersActive ? cs.empty.editFilters : cs.empty.addPub}
            onPress={searchFailed ? onRetry : filtersActive ? onEditFilters : onAddPub}
            icon={searchFailed
              ? <RefreshCwIcon size={20} color={Colors.stout} />
              : filtersActive
              ? <ListFilterIcon size={20} color={Colors.stout} />
              : <MapPinIcon size={20} color={Colors.stout} />}
            glow="soft"
            accessibilityLabel={
              searchFailed
                ? cs.empty.retry
                : filtersActive
                  ? cs.empty.editFilters
                  : cs.a11y.addPubButton
            }
          />
        </View>

        <View style={styles.emptySecondaryActions}>
          {filtersActive && !searchFailed ? (
            <Pressable
              onPress={onClearFilters}
              style={styles.emptyRetry}
              hitSlop={12}
              accessibilityLabel={cs.empty.clearFilters}
              accessibilityRole="button"
            >
              <XIcon size={16} color={Colors.mutedText} />
              <Text style={styles.emptyRetryText} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.empty.clearFilters}
              </Text>
            </Pressable>
          ) : null}
          {searchFailed || !filtersActive ? (
            <Pressable
              onPress={onSettings}
              style={styles.emptyRetry}
              hitSlop={12}
              accessibilityLabel={cs.empty.openSettings}
              accessibilityRole="button"
            >
              <SettingsIcon size={16} color={Colors.mutedText} />
              <Text style={styles.emptyRetryText} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.empty.openSettings}
              </Text>
            </Pressable>
          ) : null}

          {!searchFailed && !filtersActive ? (
            <Pressable
              onPress={onRetry}
              style={styles.emptyRetry}
              hitSlop={12}
              accessibilityLabel={cs.empty.retry}
              accessibilityRole="button"
            >
              <RefreshCwIcon size={16} color={Colors.mutedText} />
              <Text style={styles.emptyRetryText} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.empty.retry}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// ─── Hidden pub pill ─────────────────────────────────────────────────────────

/** A compact one-liner for the cheapest/first beer, with "a další" when more.
 *  A priced line carries the observation age ("· před 3 týdny"); observations
 *  older than ~6 months render as approximate ("≈ 42 Kč") so a stale price
 *  never poses as today's truth. */
function formatBeerLine(
  beers: CommunityBeer[],
  priceCurrency: PriceCurrency,
  referencePrice?: PubPrice | null,
  beersUpdatedAt?: string | null,
  /**
   * Card-footer mode: name and price only. The volume, the freshness label and
   * "a další" are real information, but on a single-line footer that shares its
   * row with the opening hours they push the sentence past the edge — and they
   * all live one tap away in the pub hub anyway.
   */
  compact = false,
): string | null {
  if (beers.length === 0) return null;
  const freshReference =
    referencePrice && isPriceFresh(referencePrice.observedAt) ? referencePrice : null;
  const fallbackObservedAt =
    beersUpdatedAt && isPriceFresh(beersUpdatedAt) ? beersUpdatedAt : null;
  const observedAt = freshReference?.observedAt ?? fallbackObservedAt;
  // Match the server contract: only a large beer (unknown volume = Czech 0.5 l
  // default) can carry the reference price in the pub preview.
  const priced = beers.filter(
    (beer) =>
      typeof beer.priceCzk === 'number' &&
      (beer.volumeMl == null || beer.volumeMl >= 400),
  );
  const matchingReference = freshReference
    ? priced.find(
        (beer) =>
          beer.priceCzk === freshReference.czk &&
          (beer.volumeMl ?? 500) === (freshReference.volumeMl ?? 500),
      )
    : undefined;
  const lead = matchingReference ?? (
    priced.length
      ? priced.reduce((a, b) => ((b.priceCzk ?? 0) < (a.priceCzk ?? 0) ? b : a))
      : beers[0]
  );
  let base: string;
  const displayedPrice = freshReference?.czk ?? lead.priceCzk;
  const displayedVolume = freshReference?.volumeMl ?? lead.volumeMl;
  if (typeof displayedPrice === 'number' && observedAt) {
    const formatted = formatPrice(displayedPrice, priceCurrency);
    const volume =
      !compact && displayedVolume != null && displayedVolume !== 500
        ? ` / ${formatVolume(displayedVolume)}`
        : '';
    const approx = isPriceApproximate(observedAt);
    base = cs.compass.beerWithPrice(
      freshReference && !matchingReference ? cs.compass.referenceBeer : lead.name,
      `${approx ? cs.compass.priceApprox(formatted) : formatted}${volume}`,
    );
    const age = compact ? null : priceAgeLabel(observedAt);
    if (age) base = `${base} · ${age}`;
  } else {
    base = cs.compass.beerNoPrice(lead.name);
  }
  if (compact) return base;
  return beers.length > 1 ? `${base} · ${cs.compass.beerAndMore}` : base;
}

// ─── Tácek helpers ────────────────────────────────────────────────────────────

/**
 * Split "320 m" / "2,5 km" into the big numeral and its declined uppercase unit.
 * The unit used to hang beside the number as a separate amber glyph; it is now
 * the wide caption underneath, exactly like "PIV" under the counter's tally.
 */
function splitDistance(formatted: string | null): { value: string; unit: string } | null {
  if (!formatted) return null;
  const spaceIdx = formatted.lastIndexOf(' ');
  if (spaceIdx === -1) return { value: formatted, unit: cs.compass.distanceUnitMeters };
  const value = formatted.slice(0, spaceIdx);
  const rawUnit = formatted.slice(spaceIdx + 1);
  if (rawUnit === 'km') {
    const numeric = Number(value.replace(',', '.'));
    return { value, unit: cs.compass.distanceUnitKm(numeric) };
  }
  return { value, unit: cs.compass.distanceUnitMeters };
}

/**
 * The opening hours for the card footer, as their own line.
 *
 * They used to be the first clause of a single sentence that also carried the
 * beer and its price, which meant the one thing you want while standing on the
 * street was the thing that got truncated first. Now: hours on their own line
 * with their own tone, beer underneath. While the lookup is in flight the line
 * is empty — nobody reads "Načítám" — but once it comes back empty we say so,
 * because "neznám" is an invitation to map it, and the door is right there.
 */
function pubHoursLine(pub: Pub): { label: string | null; tone: 'open' | 'closed' | 'unknown' } {
  const loading = pub.hoursStatus === 'loading' || pub.hoursStatus === 'pending';
  if (loading && pub.isOpenNow == null) return { label: null, tone: 'unknown' };

  const time = hoursTimeFromIso(pub.nextChange);
  if (pub.isOpenNow === true) {
    return { label: time ? cs.compass.openUntil(time) : cs.compass.openNow, tone: 'open' };
  }
  if (pub.isOpenNow === false) {
    return { label: time ? cs.compass.closedUntil(time) : cs.compass.closedNow, tone: 'closed' };
  }
  return { label: cs.compass.hoursUnknown, tone: 'unknown' };
}

/** `HH:MM` straight out of a Europe/Prague ISO stamp — no `Intl`, see OpenStatusChip. */
function hoursTimeFromIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const tIndex = iso.indexOf('T');
  if (tIndex === -1) return null;
  const hhmm = iso.slice(tIndex + 1, tIndex + 6);
  return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : null;
}

// ─── Main CompassScreen ───────────────────────────────────────────────────────

export default function CompassScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  useWindowDimensions();
  const [, setSceneSize] = useState<{ width: number; height: number } | null>(null);
  const [pubFilters, setPubFilters] = useState<PubSearchFilters>(EMPTY_PUB_SEARCH_FILTERS);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [mapPubOpen, setMapPubOpen] = useState(false);
  // The dial is sized from the card, never the other way round (§5.3).
  const [dialSize, setDialSize] = useState(260);
  const showToast = useToastStore((s) => s.show);

  const {
    arrowRotation,
    distanceFormatted,
    pub,
    revealed,
    reveal,
    mode,
    setMode,
    reroll,
    skip,
    reportCurrentPub,
    renameCurrentPub,
    retrySearch,
    arrived,
    dismissArrival,
    headingAccuracy,
    hasMagnetometer,
    permissionState,
    requestPermission,
    isLoading,
    searchFailed,
    currentPosition,
    focusedPub,
    clearFocusedPub,
  } = useCompass(
    pubFilters.beerBrand?.key ?? null,
    pubFilters.amenityKeys,
    pubFilters.priceMinCzk,
    pubFilters.priceMaxCzk,
    !mapOpen,
    pubFilters.includeOtherPlaces === true,
  );
  const activeFilterCount = activePubSearchFilterCount(pubFilters);
  const hidePubNames = useSettingsStore((s) => s.hidePubNames);
  const homePoint = useSettingsStore((s) => s.homePoint);
  const priceCurrency = useSettingsStore((s) => s.priceCurrency);
  const showPubDetails = !hidePubNames || revealed;
  const handleModeChange = useCallback(
    (next: 'nearest' | 'surprise') => {
      setMode(next);
      void updateAccountPreferences({ mode: next });
    },
    [setMode],
  );
  const handleSceneLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    const next = { width: Math.round(width), height: Math.round(height) };
    if (next.width <= 0 || next.height <= 0) return;

    setSceneSize((current) => {
      if (current?.width === next.width && current.height === next.height) {
        return current;
      }
      return next;
    });
  }, []);

  // Reanimated shared value for compass rotation
  const rotation = useSharedValue(0);
  const lastRotationTarget = useSharedValue(0);
  const hasRotationTarget = useSharedValue(false);

  // Keep the hot heading -> arrow path inside Reanimated instead of React
  // state/effects. iOS delivers a dense, pre-fused heading stream, so the
  // shared value is assigned directly instead of restarting an animation.
  // Android's stream is sparse and quantized (raw sensors + a native ~2°
  // deadband), so direct assignment reads as visible twitching there — a
  // near-critically-damped spring turns those discrete jumps into continuous
  // motion instead.
  useAnimatedReaction(
    () => arrowRotation.value,
    (target, previousTarget) => {
      if (target === null || target === previousTarget) return;

      const current = hasRotationTarget.value ? lastRotationTarget.value : rotation.value;
      const nextTarget = shortestRotationTarget(current, target);

      hasRotationTarget.value = true;
      lastRotationTarget.value = nextTarget;
      rotation.value = ANIMATE_ARROW
        ? withSpring(nextTarget, ARROW_SPRING_CONFIG)
        : nextTarget;
    },
  );

  // Arrival handling: persist revealed pub, push to celebration, dismiss
  useEffect(() => {
    if (!arrived) return;
    if (pub) {
      usePubStore.getState().setRevealedPub(pub);
    }
    router.push('/celebration');
    dismissArrival();
  }, [arrived, pub, router, dismissArrival]);

  const handleSettings = useCallback(() => {
    router.push('/settings');
  }, [router]);

  const handleOpenFilter = useCallback(() => setFilterSheetOpen(true), []);
  const handleCloseFilter = useCallback(() => setFilterSheetOpen(false), []);
  const handleClearFilter = useCallback(
    () => setPubFilters(EMPTY_PUB_SEARCH_FILTERS),
    [],
  );
  // Snapshot the known prices when the sheet opens — the histogram should show
  // the distribution around the CURRENT loaded area, not live-shift mid-drag.
  const nearbyPrices = useMemo(
    () => (filterSheetOpen ? freshPriceCzks(getAllLoadedPubs()) : []),
    [filterSheetOpen],
  );
  const handleShowMap = useCallback(() => setMapOpen(true), []);
  const handleShowCompass = useCallback(() => setMapOpen(false), []);

  const handleAddPub = useCallback(() => {
    router.push({
      pathname: '/add-pub' as never,
      params: {
        ...(currentPosition ? { lat: String(currentPosition.lat), lng: String(currentPosition.lng) } : {}),
      },
    });
  }, [currentPosition, router]);

  // Dev-only shortcut: long-press the settings gear to simulate arrival at the
  // current pub. Compiled out of release builds since `__DEV__` is false there.
  const handleDevArrival = useCallback(() => {
    if (!__DEV__) return;
    if (pub) usePubStore.getState().setRevealedPub(pub);
    router.push('/celebration');
  }, [pub, router]);

  const handleOpenMaps = useCallback(() => {
    if (pub) openPubInMaps(pub);
  }, [pub]);
  const handleNavigateHome = useCallback(() => {
    if (homePoint) void openHomeInMaps(homePoint);
  }, [homePoint]);

  const handleReportReason = useCallback((reason: PubReportReason) => {
    reportCurrentPub(reason).catch(() => undefined);
  }, [reportCurrentPub]);

  const handleReportClose = useCallback(() => {
    setReportOpen(false);
  }, []);

  const handleRenamePress = useCallback(() => {
    if (!pub) return;
    setRenameDraft(pub.name);
    setRenameOpen(true);
  }, [pub]);

  const handleRenameCancel = useCallback(() => {
    if (renameSubmitting) return;
    setRenameOpen(false);
  }, [renameSubmitting]);

  const handleRenameSubmit = useCallback(() => {
    if (!pub || renameSubmitting) return;
    const trimmedName = renameDraft.trim();
    if (!trimmedName || trimmedName === pub.name.trim()) return;

    setRenameSubmitting(true);
    renameCurrentPub(trimmedName)
      .then((synced) => {
        setRenameOpen(false);
        showToast(synced ? cs.compass.renameSavedToast : cs.compass.renameQueuedToast);
      })
      .finally(() => setRenameSubmitting(false));
  }, [pub, renameCurrentPub, renameDraft, renameSubmitting, showToast]);

  const handleReport = useCallback(() => {
    if (!pub) return;
    setReportOpen(true);
  }, [pub]);


  // ── Tácek composition state ───────────────────────────────────────────────
  // The pub the needle is actually aimed at: a friend's handoff wins over the
  // local search, which is why the focused mode no longer needs its own screen.
  // A friend's handoff wins over the local search. It carries only a name and a
  // coarse cell, so anything that needs real pub data keys off `pub` instead.
  const targetPub: Pub | FocusedPub | null = focusedPub ?? pub;
  const distanceParts = splitDistance(distanceFormatted);
  // A friend's handoff carries only a name and a coarse cell, so it has neither
  // hours nor a tap list to show.
  const hours =
    !focusedPub && pub ? pubHoursLine(pub) : { label: null, tone: 'unknown' as const };
  const beerLine =
    !focusedPub && pub
      ? formatBeerLine(pub.beers ?? [], priceCurrency, pub.price, pub.beersUpdatedAt, true)
      : null;
  // The sheet has the width the card's footer does not, so it gets the full
  // sentence: volume, price age and "a další".
  const sheetBeerLine =
    !focusedPub && pub
      ? formatBeerLine(pub.beers ?? [], priceCurrency, pub.price, pub.beersUpdatedAt)
      : null;

  // Tapping the card footer opens what you'd want next: the pub hub when the
  // name is visible, the reveal when it isn't.
  const handleCardFooterPress = useCallback(() => {
    if (!showPubDetails) {
      reveal();
      return;
    }
    if (focusedPub) return; // a coarse friend target has nothing to map
    setMapPubOpen(true);
  }, [focusedPub, reveal, showPubDetails]);

  // One nudge, one priority, never two — the slot is 52 pt whether it speaks or
  // not, so the button below it never moves under the thumb.
  const compassNudge: Nudge | null = useMemo(() => {
    if (isHeadingAccuracyLow(headingAccuracy, Platform.OS)) {
      return { kind: 'dopito', label: cs.compass.nudgeCalibrate, onPress: () => undefined };
    }
    if (activeFilterCount > 0) {
      return {
        kind: 'rapid',
        text: cs.compass.nudgeFilters(activeFilterCount),
        confirmLabel: cs.compass.nudgeFiltersClear,
        onConfirm: () => setPubFilters(EMPTY_PUB_SEARCH_FILTERS),
      };
    }
    if (focusedPub) {
      return { kind: 'dopito', label: cs.compass.nudgeFocused, onPress: () => undefined };
    }
    // Surprise mode speaks for itself through "Dej mi jinou" in the thumb arc,
    // so it gets no strip of its own; the way back is the overflow sheet.
    if (hasMagnetometer === false) {
      return { kind: 'dopito', label: cs.compass.nudgeNoMagnetometer, onPress: () => undefined };
    }
    return null;
  }, [activeFilterCount, focusedPub, hasMagnetometer, headingAccuracy]);

  // Everything that used to live in the header and the bottom bar — minus the
  // map, which is now a visible half of the header. One door per place.
  const moreRows: MoreRow[] = useMemo(() => {
    const rows: MoreRow[] = [
      {
        key: 'filters',
        label: cs.compass.moreFilters,
        value: activeFilterCount > 0 ? cs.compass.moreFiltersActive(activeFilterCount) : null,
        icon: ListFilterIcon,
        onPress: () => { setMoreOpen(false); handleOpenFilter(); },
      },
    ];
    if (homePoint) {
      rows.push({ key: 'home', label: cs.compass.moreHome, icon: HouseIcon, onPress: () => { setMoreOpen(false); handleNavigateHome(); } });
    }
    rows.push(
      {
        key: 'nearest',
        label: cs.compass.moreModeNearest,
        icon: TargetIcon,
        selected: mode === 'nearest',
        onPress: () => { setMoreOpen(false); handleModeChange('nearest'); },
      },
      {
        key: 'surprise',
        label: cs.compass.moreModeSurprise,
        icon: SparklesIcon,
        selected: mode === 'surprise',
        onPress: () => { setMoreOpen(false); handleModeChange('surprise'); },
      },
    );
    rows.push({
      key: 'add-pub',
      label: cs.compass.moreAddPub,
      icon: MapPinPlusIcon,
      onPress: () => { setMoreOpen(false); handleAddPub(); },
    });
    if (targetPub && !focusedPub) {
      rows.push({ key: 'report', label: cs.compass.moreReport, icon: FlagIcon, onPress: () => { setMoreOpen(false); handleReport(); } });
    }
    return rows;
  }, [
    activeFilterCount,
    focusedPub,
    handleAddPub,
    handleModeChange,
    handleNavigateHome,
    handleOpenFilter,
    handleReport,
    homePoint,
    mode,
    targetPub,
  ]);

  if (mapOpen) {
    return (
      <BeerMapScreen
        initialPub={pub}
        filters={pubFilters}
        onApplyFilters={setPubFilters}
        onShowCompass={handleShowCompass}
      />
    );
  }

  // ── State A: permission not granted ──────────────────────────────────────
  if (permissionState === 'denied' || permissionState === 'undetermined') {
    return (
      <PermissionScreen
        permissionState={permissionState}
        requestPermission={requestPermission}
        onShowMap={handleShowMap}
      />
    );
  }

  // ── State B: loading ──────────────────────────────────────────────────────
  if (isLoading) {
    return <LoadingScreen rotation={rotation} />;
  }

  // ── State D: nothing nearby / pub lookup failed ───────────────────────────
  // Aiming at a friend's pub used to be its own screen (State F). It is now a
  // state of the one composition below: a strip in the nudge slot and a quiet
  // "Zpět na nejbližší" in the thumb arc.
  if (pub === null && !focusedPub) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {/* Nothing within reach is exactly when the map earns its place, so the
            switch stays in the header here too. */}
        <View style={[styles.headerRow, styles.headerRowEmpty]}>
          <ExploreSwitch
            activeView="compass"
            variant="flat"
            onSelectCompass={() => undefined}
            onSelectMap={handleShowMap}
          />
        </View>
        <EmptyScreen
          onSettings={handleSettings}
          onRetry={retrySearch}
          onAddPub={handleAddPub}
          searchFailed={searchFailed}
          filtersActive={activeFilterCount > 0}
          onEditFilters={handleOpenFilter}
          onClearFilters={handleClearFilter}
        />
        {filterSheetOpen ? (
          <PubFilterSheet
            visible
            value={pubFilters}
            nearbyPrices={nearbyPrices}
            onClose={handleCloseFilter}
            onApply={setPubFilters}
          />
        ) : null}
      </View>
    );
  }

  // ── State C: active compass ───────────────────────────────────────────────
  // Four blocks and nothing else: header, one card, one nudge slot, one amber
  // button. Everything the header and the bottom bar used to carry — the map,
  // the filters, walking home, the search mode, reporting a wrong pub — is one
  // tap away behind "…".
  return (
    <View
      onLayout={handleSceneLayout}
      style={[
        styles.root,
        styles.surface,
        { paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, Spacing.sm) },
      ]}
    >
      {/* The map is not a menu item. It is the compass's twin, so it lives where
          you cannot miss it: half of the screen's title. */}
      <View style={styles.headerRow}>
        <ExploreSwitch
          activeView="compass"
          variant="flat"
          onSelectCompass={() => undefined}
          onSelectMap={handleShowMap}
        />
        <View style={styles.headerSpacer} />
        <Pressable
          onPress={() => setMoreOpen(true)}
          onLongPress={handleDevArrival}
          delayLongPress={800}
          style={({ pressed }) => [styles.moreButton, pressed && styles.pressedSoft]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.compassMore}
        >
          <EllipsisIcon size={20} color={Colors.mutedText} />
        </Pressable>
      </View>

      <CompassCard
        dial={<CompassContainer rotation={rotation} size={dialSize} />}
        onDialSize={setDialSize}
        distanceValue={distanceParts?.value ?? null}
        distanceUnit={distanceParts?.unit ?? ''}
        pubName={showPubDetails ? (targetPub?.name ?? null) : null}
        hoursLabel={showPubDetails ? hours.label : null}
        hoursTone={hours.tone}
        beerLine={showPubDetails ? beerLine : null}
        hidden={!showPubDetails}
        showDetailLink={showPubDetails && !focusedPub && targetPub !== null}
        onPressFooter={handleCardFooterPress}
        accessibilityLabel={
          showPubDetails
            ? cs.a11y.compassCard(
                targetPub?.name ?? '',
                distanceFormatted ?? '',
                [hours.label, beerLine].filter(Boolean).join(' · '),
              )
            : cs.a11y.compassCardHidden
        }
      />

      <NudgeSlot nudge={compassNudge} />

      <CounterCta
        label={cs.compass.navigateCta}
        subLabel={cs.compass.navigateCtaSub}
        onPress={handleOpenMaps}
        accessibilityLabel={cs.a11y.compassNavigate(targetPub?.name ?? '')}
      />

      {focusedPub ? (
        <CounterSecondary
          label={cs.compass.backToNearest}
          onPress={clearFocusedPub}
          accessibilityLabel={cs.a11y.compassBackToNearest}
        />
      ) : (
        <CounterSecondary
          label={cs.compass.anotherPub}
          onPress={mode === 'surprise' ? reroll : skip}
          accessibilityLabel={cs.a11y.compassAnother}
        />
      )}

      <MoreSheet visible={moreOpen} rows={moreRows} onClose={() => setMoreOpen(false)} />

      {filterSheetOpen ? (
        <PubFilterSheet
          visible
          value={pubFilters}
          nearbyPrices={nearbyPrices}
          onClose={handleCloseFilter}
          onApply={setPubFilters}
        />
      ) : null}
      {pub ? (
        <MapPubSheet
          visible={mapPubOpen}
          pubKey={geohash8(pub.lat, pub.lng)}
          pubName={pub.name}
          info={pubInfoFromPub(pub)}
          hoursLabel={hours.label}
          hoursTone={hours.tone}
          beerLine={sheetBeerLine}
          onClose={() => setMapPubOpen(false)}
        />
      ) : null}
      {pub ? (
        <ReportPubModal
          visible={reportOpen}
          pubName={pub.name}
          onClose={handleReportClose}
          onAddPub={handleAddPub}
          onRename={handleRenamePress}
          onReportReason={handleReportReason}
        />
      ) : null}
      {pub ? (
        <RenamePubModal
          visible={renameOpen}
          currentName={pub.name}
          value={renameDraft}
          submitting={renameSubmitting}
          onChange={setRenameDraft}
          onCancel={handleRenameCancel}
          onSubmit={handleRenameSubmit}
        />
      ) : null}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
  },

  // — Tácek surface: four fixed blocks, never scrolls, 8-point spacing —
  surface: {
    paddingHorizontal: 24,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    marginBottom: 8,
  },
  // The empty state owns its own horizontal padding, so the header borrows the
  // surface's gutter instead of the surface's whole style.
  headerRowEmpty: {
    paddingHorizontal: 24,
  },
  headerSpacer: { flex: 1, minWidth: Spacing.sm },
  // Quiet on purpose: an outlined circle beside an amber button is two frames
  // competing. This one is just a glyph.
  moreButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressedSoft: { opacity: 0.6 },
  renameOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  renameScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: withAlpha(Colors.black, 0.58),
  },
  renamePanel: {
    marginHorizontal: 14,
    marginBottom: 14,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.32),
    backgroundColor: Colors.stout2,
    padding: 20,
    gap: 14,
  },
  renameIconWell: {
    width: 42,
    height: 42,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.28),
  },
  renameTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    lineHeight: 30,
    color: Colors.foam,
  },
  renameBody: {
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.foamMuted,
  },
  renameInput: {
    minHeight: 54,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.38),
    backgroundColor: Colors.stout3,
    paddingHorizontal: 14,
    fontFamily: Fonts.ui.medium,
    fontSize: 17,
    color: Colors.foam,
  },
  renameActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },
  renameSecondaryButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: withAlpha(Colors.stout, 0.42),
  },
  renameSecondaryText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 15,
    color: Colors.foamMuted,
  },
  renamePrimaryButton: {
    flex: 1.35,
    minHeight: 50,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  renamePrimaryDisabled: {
    opacity: 0.42,
  },
  renamePrimaryText: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 16,
    color: Colors.stout,
  },

  // ── Permission ──
  permCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: Spacing.lg,
  },
  permIconWrap: {
    marginBottom: 4,
  },
  permTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 28,
    color: Colors.foam,
    textAlign: 'center',
    lineHeight: 36,
  },
  permBody: {
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    color: Colors.mutedText,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 8,
  },
  permSecondaryWrap: {
    width: '100%',
    marginTop: -8,
  },
  permissionMapButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  permissionMapText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.foamMuted,
  },

  // ── Loading ──
  loadingCompassWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  loadingText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 15,
    color: Colors.mutedText,
    textAlign: 'center',
  },

  // ── Compass area (State C) ──

  // ── Focused compass (friend handoff) ──

  // ── Distance ──

  // ── No magnetometer ──

  // ── Pub pill (shared) ──

  // ── Hidden pill internals ──

  // ── Revealed pill internals ──
  // Open-status (shrinks first) on the left, rating pinned to the right.
  // ── Mode toggle ──

  // ── Reroll button ──

  // ── Empty state (State D) ──
  emptyContainer: {
    flex: 1,
    alignItems: 'stretch',
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.lg,
  },
  emptyTopGroup: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
  },
  emptyBottomGroup: {
    alignItems: 'center',
    gap: Spacing.lg,
  },
  emptyIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyHeadlineWrap: {
    alignItems: 'center',
    gap: 0,
  },
  emptyHeadlineFoam: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 38,
    color: Colors.foam,
    letterSpacing: -0.5,
    lineHeight: 44,
  },
  emptyHeadlineAmber: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 38,
    color: Colors.amber,
    letterSpacing: -0.5,
    lineHeight: 44,
  },
  emptyBody: {
    fontFamily: Fonts.ui.medium,
    fontSize: 15,
    color: Colors.mutedText,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 300,
  },
  emptyButtonWrap: {
    alignSelf: 'stretch',
    marginTop: 4,
  },
  emptyRetry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  emptySecondaryActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: Spacing.lg,
  },
  emptyRetryText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.mutedText,
  },
});
