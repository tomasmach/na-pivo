import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  AccessibilityInfo,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import MapView, {
  PROVIDER_GOOGLE,
  type MapPressEvent,
  type Region,
} from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { pubInfoFromPub } from '@/components/amenities/pubInfoContext';
import { MapPubSheet } from '@/components/amenities/MapPubSheet';
import { PubFilterSheet } from '@/components/compass/PubFilterSheet';
import { ReportPubModal } from '@/components/compass/ReportPubModal';
import { haversineMeters } from '@/compass/distance';
import {
  BeerIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MenuIcon,
  FlagIcon,
  HeartFilledIcon,
  HeartIcon,
  ListFilterIcon,
  LayoutListIcon,
  LocateFixedIcon,
  MapPinPlusIcon,
  MapPinnedIcon,
  RefreshCwIcon,
  StarIcon,
  TrophyIcon,
  XIcon,
} from '@/components/shared/IconGlyph';
import { CardSheen, CardSurface } from '@/components/shared/CardSurface';
import { PubSearchButton } from '@/search/PubSearchButton';
import { ExploreSwitch } from '@/components/shared/ExploreSwitch';
import { MoreSheet, type MoreRow } from '@/components/shared/MoreSheet';
import { NudgeSlot, type Nudge } from '@/counter/NudgeSlot';
import type { Pub } from '@/data/pubs';
import { enqueuePubReport } from '@/data/pubReportQueue';
import type { PubReportReason } from '@/data/pubReportsClient';
import { isSameVenue, usePubFavoritesStore } from '@/stores/pubFavoritesStore';
import { usePubStore } from '@/stores/pubStore';
import { useToastStore } from '@/stores/toastStore';
import { fetchPubHours, type PubHoursResult } from '@/data/hoursClient';
import { fetchPubBeersLastWeek, type PubBeersByKey } from '@/data/pubBeersClient';
import {
  EMPTY_PUB_SEARCH_FILTERS,
  activePubSearchFilterCount,
  type PubSearchFilters,
} from '@/data/pubSearchFilters';
import type { FocusedPub } from '@/stores/focusedPubStore';
import { useFocusedPubStore } from '@/stores/focusedPubStore';
import { fireLightImpactHaptic } from '@/utils/haptics';
import { useReduceMotion } from '@/utils/useReduceMotion';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAccountStore } from '@/stores/accountStore';
import { openPubInMaps } from '@/utils/maps';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { t, intlLocale } from '@/i18n';
import {
  buildMapPubPoints,
  clusterCoordinates,
  type LivePubSummary,
  type MapPubPoint,
  type VisitedCitySummary,
} from './mapModel';
import { useBeerMap } from './useBeerMap';
import { StaticMapMarker, useMarkerSnapshotRefresh } from './StaticMapMarker';
import { openPubPage } from '@/pubPage/openPubPage';

const DEFAULT_REGION: Region = {
  latitude: 49.8175,
  longitude: 15.473,
  latitudeDelta: 4.7,
  longitudeDelta: 4.2,
};

const PUB_DETAIL_LOADING_TIMEOUT_MS = 3_000;
const SHEET_DISMISS_MS = 260;

type Layer = 'all' | 'visited' | 'friends';
type MapSelection =
  | { kind: 'pub'; key: string; accountId: string | null }
  | { kind: 'live'; key: string; accountId: string | null }
  | { kind: 'city'; key: string; accountId: string | null };

let rememberedRegion: Region | null = null;
/** A fresher locate fix closer than this does not re-animate the map. */
const LOCATE_FOLLOW_UP_M = 25;
let rememberedLayer: Layer = 'all';
let rememberedBeersOnly = false;
let rememberedSelection: MapSelection | null = null;
const layerListeners = new Set<() => void>();

function setRememberedLayer(layer: Layer): void {
  if (rememberedLayer === layer) return;
  rememberedLayer = layer;
  for (const listener of layerListeners) listener();
}

function subscribeRememberedLayer(listener: () => void): () => void {
  layerListeners.add(listener);
  return () => layerListeners.delete(listener);
}

/** Return map-pin additions to the catalogue layer without moving the aimed viewport. */
export function resetBeerMapLayerForAddedPub(): void {
  setRememberedLayer('all');
}

export interface BeerMapScreenProps {
  initialPub?: Pub | null;
  focusInitialPub?: boolean;
  onSearch?: () => void;
  /** Set when the map is opened over another screen, which it returns to. */
  onBack?: () => void;
  /** Overrides opening the pub page, e.g. when the map sits over that page. */
  onOpenPub?: (pub: Pub) => void;
  filters: PubSearchFilters;
  onApplyFilters: (filters: PubSearchFilters) => void;
  onShowCompass: () => void;
}

function friendName(live: LivePubSummary): string {
  const first = live.activities[0]?.account;
  return first?.displayName?.trim() || first?.nickname?.trim() || t.map.friendFallback;
}

function formatRating(value: number): string {
  return value.toLocaleString(intlLocale, {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 1,
  });
}

function localTimeFromIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const tIndex = iso.indexOf('T');
  if (tIndex === -1) return null;
  const hhmm = iso.slice(tIndex + 1, tIndex + 6);
  return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : null;
}

type MetaTone = 'open' | 'closed' | 'unknown' | 'neutral';

function openingMeta(
  pub: Pub,
  status: Pub['hoursStatus'] | 'loading' | undefined,
): { text: string; tone: MetaTone } {
  if ((status === 'loading' || status === 'pending') && pub.isOpenNow == null) {
    return { text: t.compass.detailsLoading, tone: 'neutral' };
  }

  const time = localTimeFromIso(pub.nextChange);
  if (pub.isOpenNow === true) {
    return {
      text: time ? t.compass.openUntil(time) : t.compass.openNow,
      tone: 'open',
    };
  }
  if (pub.isOpenNow === false) {
    return {
      text: time ? t.compass.closedUntil(time) : t.compass.closedNow,
      tone: 'closed',
    };
  }
  // 'unknown' still earns the dot: the line is about opening hours either way,
  // and the compass card draws it the same. 'neutral' is for lines that are not
  // hours at all (the viewport summary, a city, a friend).
  return { text: t.compass.hoursUnknown, tone: 'unknown' };
}

function metaToneColor(tone: MetaTone): string {
  if (tone === 'open') return Colors.open;
  if (tone === 'closed') return Colors.closed;
  return Colors.mutedText;
}

/** Only an hours line gets the status dot. */
function showsStatusDot(tone: MetaTone): boolean {
  return tone !== 'neutral';
}

/** Above this text size the action gets its own row; beside it the hours would be a few words wide. */
const STACKED_ACTION_FONT_SCALE = 1.1;

interface PlaceCardProps {
  /** The selected pub, friend or city. The name owns the full card width. */
  title: string;
  /** Opening hours, with the status dot. Null when the card is not about a pub. */
  meta: string | null;
  metaTone: MetaTone;
  /** The quiet tail of the same line (city, "navštíveno"), or null. */
  fact: string | null;
  /** How many beers the selected pub poured last week, on its own quiet line. */
  beers?: string | null;
  /** Star rating, rendered with a ★ glyph ahead of the fact text. */
  rating?: { value: string; count: string | null } | null;
  /** Opens the pub detail. Only a pub has one; a friend or a city leaves it out. */
  open?: {
    onPress: () => void;
    accessibilityLabel: string;
  };
  action: {
    label: string;
    onPress: () => void;
    accessibilityLabel: string;
  };
  /** Clears the selection and brings the layer switch back. */
  onClose: () => void;
}

/**
 * The card of a selection. It replaces the layer switch at the bottom of the
 * map instead of stacking on it, and it carries its own primary action, so a
 * selection costs one short card rather than a card, a switch and a 62pt button.
 */
function PlaceCard({
  title,
  meta,
  metaTone,
  fact,
  beers,
  rating,
  open,
  action,
  onClose,
}: PlaceCardProps) {
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale > STACKED_ACTION_FONT_SCALE;
  const ratingText = rating
    ? rating.count
      ? `${rating.value} (${rating.count})`
      : rating.value
    : null;
  const detailText = [ratingText, fact].filter(Boolean).join(' · ');

  return (
    <View style={styles.placeCard}>
      <CardSheen />

      <View style={styles.placeTitleRow}>
        <Pressable
          onPress={open?.onPress}
          disabled={!open}
          accessible={Boolean(open)}
          style={({ pressed }) => [styles.placeTitlePress, pressed && styles.pressedSoft]}
          accessibilityRole={open ? 'button' : undefined}
          accessibilityLabel={open ? `${title}, ${open.accessibilityLabel}` : undefined}
        >
          <Text
            style={styles.placeTitle}
            numberOfLines={2}
            maxFontSizeMultiplier={FontScaleCap.heading}
          >
            {title}
          </Text>
          {open ? <ChevronRightIcon size={18} color={Colors.mutedText} /> : null}
        </Pressable>
        {/* Tapping the empty map does the same, but a screen reader lands on
            the centred pin instead, and nobody else knows the gesture. */}
        <Pressable
          onPress={onClose}
          hitSlop={6}
          style={({ pressed }) => [styles.placeClose, pressed && styles.pressedSoft]}
          accessibilityRole="button"
          accessibilityLabel={t.a11y.mapSelectionClear}
        >
          <XIcon size={16} color={Colors.foamMuted} />
        </Pressable>
      </View>

      <View style={stacked ? styles.placeBottomStacked : styles.placeBottomRow}>
        {/* The same door as the title, for thumbs; VoiceOver reads the lines
            as text and opens the detail from the title button. */}
        <Pressable
          onPress={open?.onPress}
          disabled={!open}
          accessible={false}
          style={({ pressed }) => [
            !stacked && styles.placeDetailsBeside,
            pressed && styles.pressedSoft,
          ]}
        >
          {/* §5.4: the hours are what the person on the street came for, so
              they wrap instead of truncating first. */}
          {meta ? (
            <View style={styles.placeMetaRow}>
              <View style={styles.placeLead}>
                {showsStatusDot(metaTone) ? (
                  <View style={[styles.placeDot, { backgroundColor: metaToneColor(metaTone) }]} />
                ) : null}
              </View>
              <Text
                style={[styles.placeMeta, { color: metaToneColor(metaTone) }]}
                numberOfLines={2}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {meta}
              </Text>
            </View>
          ) : null}

          {beers ? (
            <View style={styles.placeMetaRow}>
              <View style={styles.placeLead}>
                <BeerIcon size={13} color={Colors.mutedText} />
              </View>
              <Text
                style={styles.placeFact}
                numberOfLines={2}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {beers}
              </Text>
            </View>
          ) : null}

          {detailText ? (
            <View style={styles.placeMetaRow}>
              <View style={styles.placeLead}>
                {ratingText ? <StarIcon size={13} color={Colors.amber} /> : null}
              </View>
              <Text
                style={styles.placeFact}
                numberOfLines={2}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {detailText}
              </Text>
            </View>
          ) : null}
        </Pressable>

        <Pressable
          onPress={action.onPress}
          style={({ pressed }) => [styles.placeAction, pressed && styles.pressedSoft]}
          accessibilityRole="button"
          accessibilityLabel={action.accessibilityLabel}
        >
          <Text
            style={styles.placeActionLabel}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.heading}
          >
            {action.label}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Which slice of the map you are looking at, as a control instead of a caption.
 *
 * It used to be three rows inside the "…" sheet, and the card only printed the
 * name of the active one — so the map's main mode switch was two taps deep and
 * looked like a label. Same segmented track as the Kompas/Mapa switch: neutral
 * foam, never a second amber surface.
 *
 * Segments are as wide as their labels plus an equal share of what is left, so
 * the count after "Parta teď" takes room from "V okolí" instead of squeezing
 * its own label.
 */
function LayerSwitch({
  layer,
  liveCount,
  onSelect,
}: {
  layer: Layer;
  liveCount: number;
  onSelect: (next: Layer) => void;
}) {
  const segments: { key: Layer; label: string; badge?: number }[] = [
    { key: 'all', label: t.map.layerAll },
    { key: 'visited', label: t.map.layerVisited },
    { key: 'friends', label: t.map.layerFriends, badge: liveCount },
  ];

  return (
    <View style={styles.layerTrack} accessibilityRole="tablist">
      {segments.map((segment) => {
        const active = segment.key === layer;
        return (
          <Pressable
            key={segment.key}
            onPress={() => onSelect(segment.key)}
            disabled={active}
            style={({ pressed }) => [
              styles.layerSegment,
              active && styles.layerSegmentActive,
              pressed && styles.pressedSoft,
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active, disabled: active }}
            accessibilityLabel={segment.label}
          >
            <Text
              style={[styles.layerLabel, active && styles.layerLabelActive]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
              maxFontSizeMultiplier={FontScaleCap.heading}
            >
              {segment.label}
            </Text>
            {segment.badge ? (
              <Text
                style={[styles.layerBadge, active && styles.layerLabelActive]}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.display}
              >
                {segment.badge > 9 ? '9+' : segment.badge}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function pubWithDetails(pub: Pub, details: PubHoursResult | undefined): Pub {
  if (!details) return pub;
  return {
    ...pub,
    openingHours: details.openingHours,
    isOpenNow: details.isOpenNow,
    nextChange: details.nextChange,
    hoursStatus: details.status,
    ...(details.source ? { hoursSource: details.source } : {}),
    communityHours: details.communityHours ?? undefined,
    beers: details.beers,
    historicalBeers: details.historicalBeers,
    beersUpdatedAt: details.beersUpdatedAt,
    beerMenuRotates: details.beerMenuRotates,
    hoursUpdatedAt: details.hoursUpdatedAt,
    rating: details.rating,
    ratingCount: details.ratingCount,
    ratingLabel: details.ratingLabel,
    hasGarden: details.hasGarden,
    venueKind: details.venueKind,
  };
}

function PubMarker({
  visited,
  selected,
  beers,
  favorite = false,
}: {
  visited: boolean;
  selected: boolean;
  beers?: number;
  favorite?: boolean;
}) {
  return (
    <View style={[styles.pinHit, beers ? styles.pinHitWide : null]}>
      {selected ? <View style={styles.pubPinRing} /> : null}
      <View style={[styles.pubPin, visited && styles.pubPinVisited, selected && styles.pubPinSelected]}>
        <BeerIcon size={selected ? 18 : 15} color={visited ? Colors.stout : Colors.foam} />
      </View>
      {visited ? <View style={styles.visitedNotch} /> : null}
      {favorite ? (
        <View
          style={[
            styles.pinHeartBadge,
            beers ? styles.pinHeartBadgeWide : null,
            selected && (beers ? styles.pinHeartBadgeSelectedWide : styles.pinHeartBadgeSelected),
          ]}
        >
          <HeartFilledIcon size={10} color={Colors.amber} />
        </View>
      ) : null}
      {beers ? (
        <BeersBadge
          beers={beers}
          style={[styles.pinBeersBadge, selected && styles.pinBeersBadgeSelected]}
        />
      ) : null}
    </View>
  );
}

function BeersBadge({
  beers,
  style,
}: {
  beers: number;
  style: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.beersBadge, style]}>
      <BeerIcon size={10} color={Colors.stout} />
      <Text style={styles.beersBadgeText} maxFontSizeMultiplier={FontScaleCap.display}>
        {beers > 99 ? '99+' : beers}
      </Text>
    </View>
  );
}

function clusterTier(count: number): { size: number; fontSize: number } {
  if (count >= 30) return { size: 52, fontSize: 16 };
  if (count >= 10) return { size: 42, fontSize: 14 };
  return { size: 34, fontSize: 13 };
}

function ClusterMarker({
  count,
  visited,
  beers,
}: {
  count: number;
  visited: boolean;
  beers: number;
}) {
  const { size, fontSize } = clusterTier(count);
  return (
    <View style={[styles.clusterHit, beers ? styles.clusterHitWithBadge : null]}>
      <View
        style={[
          styles.clusterPin,
          { minWidth: size, height: size, borderRadius: size / 2 },
          visited && styles.clusterPinVisited,
        ]}
      >
        <Text
          style={[
            styles.clusterText,
            { fontSize },
            visited && styles.clusterTextVisited,
          ]}
          maxFontSizeMultiplier={FontScaleCap.display}
        >
          {count}
        </Text>
      </View>
      {beers ? (
        <BeersBadge beers={beers} style={styles.clusterBeersBadge} />
      ) : null}
    </View>
  );
}

function LiveMarker({ live, selected }: { live: LivePubSummary; selected: boolean }) {
  const account = live.activities[0]?.account;
  const avatarUrl = account?.avatarUrl;
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const showAvatar = Boolean(avatarUrl && avatarUrl !== failedAvatarUrl);
  const refreshSnapshot = useMarkerSnapshotRefresh();

  return (
    <View style={styles.liveMarkerHit}>
      <View style={[styles.livePin, selected && styles.livePinSelected]}>
        {showAvatar && avatarUrl ? (
          <Image
            source={{ uri: avatarUrl }}
            style={styles.liveAvatar}
            onLoad={refreshSnapshot}
            onError={() => {
              setFailedAvatarUrl(avatarUrl);
              refreshSnapshot();
            }}
            accessibilityIgnoresInvertColors
            testID="live-map-avatar"
          />
        ) : (
          <Text
            style={styles.liveInitial}
            maxFontSizeMultiplier={FontScaleCap.heading}
          >
            {friendName(live).charAt(0).toLocaleUpperCase(intlLocale)}
          </Text>
        )}
      </View>
      <View style={styles.liveCount}>
        <Text
          style={styles.liveCountText}
          maxFontSizeMultiplier={FontScaleCap.display}
        >
          {live.activities.length}
        </Text>
      </View>
    </View>
  );
}

export default function BeerMapScreen({
  initialPub,
  focusInitialPub = false,
  onSearch,
  onBack,
  onOpenPub,
  filters,
  onApplyFilters,
  onShowCompass,
}: BeerMapScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const mapColorScheme = colorScheme === 'dark' ? 'dark' : 'light';
  const mapRef = useRef<MapView>(null);
  const reduceMotion = useReduceMotion();
  const hapticEnabled = useSettingsStore((state) => state.hapticEnabled);
  const showPubBeers = useSettingsStore((state) => state.showPubBeers);
  const setShowPubBeers = useSettingsStore((state) => state.setShowPubBeers);
  const accountId = useAccountStore((state) => state.session?.accountId ?? null);
  const {
    pubs,
    nearbyPrices,
    searchArea,
    visitedPubs,
    visitedCities,
    livePubs,
    position,
    permissionState,
    loadingPubs,
    stale,
    requestPermission,
    refreshPosition,
    loadRegion,
    refresh,
    // The layer store re-renders this screen on every change, so reading the
    // remembered value here stays current for the live-friends poll gate.
  } = useBeerMap(filters, rememberedLayer === 'friends');
  const activeFilterCount = activePubSearchFilterCount(filters);
  const reportedPubIds = usePubStore((state) => state.reportedPubIds);
  const reportedCacheKeys = usePubStore((state) => state.reportedCacheKeys);
  const initialRegion = useMemo<Region>(
    () =>
      (!focusInitialPub && rememberedRegion) || (initialPub
        ? {
            latitude: initialPub.lat,
            longitude: initialPub.lng,
            latitudeDelta: 0.035,
            longitudeDelta: 0.035,
          }
        : DEFAULT_REGION),
    [focusInitialPub, initialPub],
  );
  const [region, setRegion] = useState<Region>(initialRegion);
  const layer = useSyncExternalStore(
    subscribeRememberedLayer,
    () => rememberedLayer,
    () => rememberedLayer,
  );
  const focusedPoint = useMemo(
    () => focusInitialPub && initialPub
      ? buildMapPubPoints([initialPub], [], false, false).points[0]
      : null,
    [focusInitialPub, initialPub],
  );
  const [selection, setSelection] = useState<MapSelection | null>(() => focusedPoint
    ? { kind: 'pub', key: focusedPoint.key, accountId: null }
    : rememberedSelection);
  const [detailOpen, setDetailOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [pubBeers, setPubBeers] = useState<PubBeersByKey | null>(null);
  const [beersOnlyChoice, setBeersOnlyChoice] = useState(rememberedBeersOnly);
  const [listOpen, setListOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [detailsByPubKey, setDetailsByPubKey] = useState<Record<string, PubHoursResult>>({});
  const [loadingDetailKey, setLoadingDetailKey] = useState<string | null>(null);
  const [timedOutDetailKey, setTimedOutDetailKey] = useState<string | null>(null);
  const didAutoLocate = useRef(Boolean(initialPub || rememberedRegion));
  const sheetActionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (sheetActionTimer.current) clearTimeout(sheetActionTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!focusedPoint) return;
    const next: MapSelection = { kind: 'pub', key: focusedPoint.key, accountId: null };
    setRememberedLayer('all');
    rememberedSelection = next;
    rememberedRegion = initialRegion;
    mapRef.current?.animateToRegion(initialRegion, 0);
  }, [focusedPoint, initialRegion]);

  useEffect(() => {
    loadRegion(initialRegion);
  }, [initialRegion, loadRegion]);

  // Retries ride on each catalogue load, so a failed first fetch (bad signal
  // in the pub) recovers without a restart; a loaded week is a cache hit. A
  // pan must not cancel a slow request, so only hiding or leaving aborts it.
  const beersRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!showPubBeers || beersRequest.current) return;
    const controller = new AbortController();
    beersRequest.current = controller;
    void fetchPubBeersLastWeek(controller.signal).then((beers) => {
      if (beersRequest.current === controller) beersRequest.current = null;
      if (!controller.signal.aborted && beers) setPubBeers(beers);
    });
  }, [pubs, showPubBeers]);
  useEffect(() => {
    if (showPubBeers) return;
    beersRequest.current?.abort();
    beersRequest.current = null;
  }, [showPubBeers]);
  useEffect(() => {
    const request = beersRequest;
    return () => request.current?.abort();
  }, []);

  // Last week's counts only mean something while they are shown and loaded.
  const visibleBeers = showPubBeers && layer !== 'friends' ? pubBeers : null;
  const beersOnly = beersOnlyChoice && visibleBeers != null;
  const setBeersOnly = useCallback((next: boolean) => {
    rememberedBeersOnly = next;
    setBeersOnlyChoice(next);
  }, []);

  useEffect(() => {
    if (!position || didAutoLocate.current) return;
    didAutoLocate.current = true;
    const next: Region = {
      latitude: position.lat,
      longitude: position.lng,
      latitudeDelta: 0.055,
      longitudeDelta: 0.055,
    };
    mapRef.current?.animateToRegion(next, reduceMotion ? 0 : 420);
    setRegion(next);
    rememberedRegion = next;
    loadRegion(next);
  }, [loadRegion, position, reduceMotion]);

  const points = useMemo(
    () => {
      let points = buildMapPubPoints(
        pubs,
        visitedPubs,
        layer === 'visited',
        false,
        activeFilterCount === 0,
      ).points;
      if (beersOnly && visibleBeers) {
        points = points.filter((point) => visibleBeers.has(point.key));
      }
      // Keep the searched place visible before its catalogue area is loaded.
      // Later filters, layers and reports still apply; updates of the same pub win.
      if (focusedPoint && (
        reportedPubIds.includes(focusedPoint.pub.id) ||
        reportedCacheKeys.includes(focusedPoint.key)
      )) {
        return points.filter((point) => point.key !== focusedPoint.key);
      }
      if (focusedPoint && layer === 'all' && activeFilterCount === 0) {
        const index = points.findIndex((point) => point.key === focusedPoint.key);
        if (index === -1) points.push(focusedPoint);
        else if (points[index].pub.id !== focusedPoint.pub.id) {
          // A matching cell can hold another cached pub or a historical visit.
          // Preserve the explicit selection instead of changing its identity.
          points[index] = { ...points[index], pub: focusedPoint.pub };
        }
      }
      return points;
    },
    [
      activeFilterCount,
      focusedPoint,
      layer,
      pubs,
      reportedCacheKeys,
      reportedPubIds,
      visibleBeers,
      visitedPubs,
      beersOnly,
    ],
  );

  const activeSelection =
    selection && selection.accountId && accountId && selection.accountId !== accountId
      ? null
      : selection;
  const selectedPub = useMemo(
    () =>
      activeSelection?.kind === 'pub'
        ? points.find((point) => point.key === activeSelection.key) ?? null
        : null,
    [activeSelection, points],
  );
  const selectedLive = useMemo(
    () =>
      activeSelection?.kind === 'live'
        ? livePubs.find((live) => live.cacheKey === activeSelection.key) ?? null
        : null,
    [activeSelection, livePubs],
  );
  const selectedCity = useMemo(
    () =>
      activeSelection?.kind === 'city'
        ? visitedCities.find((city) => city.key === activeSelection.key) ?? null
        : null,
    [activeSelection, visitedCities],
  );
  const selectedPubForLookup = selectedPub?.pub ?? null;

  useEffect(() => {
    if (!selectedPub || !selectedPubForLookup) return;
    const key = selectedPub.key;
    const controller = new AbortController();
    const loadingTimeout = setTimeout(() => {
      setTimedOutDetailKey(key);
      setLoadingDetailKey((current) => current === key ? null : current);
    }, PUB_DETAIL_LOADING_TIMEOUT_MS);
    void fetchPubHours([selectedPubForLookup], controller.signal)
      .then((result) => {
        const details = result.get(selectedPubForLookup.id);
        if (!controller.signal.aborted && details) {
          setDetailsByPubKey((current) => ({ ...current, [key]: details }));
        }
        if (!details || details.status !== 'pending') clearTimeout(loadingTimeout);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingDetailKey((current) => current === key ? null : current);
        }
      });
    return () => {
      clearTimeout(loadingTimeout);
      controller.abort();
    };
  }, [selectedPub, selectedPubForLookup]);

  const selectedDetailPub = selectedPub
    ? pubWithDetails(selectedPub.pub, detailsByPubKey[selectedPub.key])
    : null;
  const rawSelectedHoursStatus =
    selectedPub && loadingDetailKey === selectedPub.key && !selectedDetailPub?.hoursStatus
      ? 'loading'
      : selectedDetailPub?.hoursStatus;
  const selectedHoursStatus =
    selectedPub &&
    timedOutDetailKey === selectedPub.key &&
    (rawSelectedHoursStatus === 'loading' || rawSelectedHoursStatus === 'pending')
      ? 'unknown'
      : rawSelectedHoursStatus;
  const selectedRating =
    typeof selectedDetailPub?.rating === 'number' && Number.isFinite(selectedDetailPub.rating)
      ? formatRating(selectedDetailPub.rating)
      : null;
  const selectedRatingCount =
    typeof selectedDetailPub?.ratingCount === 'number' && selectedDetailPub.ratingCount > 0
      ? selectedDetailPub.ratingCount.toLocaleString(intlLocale)
      : null;
  const favorites = usePubFavoritesStore((state) => state.favorites);
  // A catalogue fix can move a saved pub to the next cell; its id still counts.
  const favoriteIds = useMemo(
    () =>
      new Set(
        Object.values(favorites)
          .map((favorite) => favorite.externalId)
          .filter((id): id is string => Boolean(id)),
      ),
    [favorites],
  );
  const isFavoritePoint = useCallback(
    (point: { key: string; pub: { id: string; name: string } }) => {
      const inCell = favorites[point.key];
      return (Boolean(inCell) && isSameVenue(inCell, point.pub)) || favoriteIds.has(point.pub.id);
    },
    [favoriteIds, favorites],
  );
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const visiblePoints = useMemo(() => {
    const latMargin = region.latitudeDelta * 0.65;
    const lngMargin = region.longitudeDelta * 0.65;
    return points.filter(
      (point) =>
        Math.abs(point.lat - region.latitude) <= latMargin &&
        Math.abs(point.lng - region.longitude) <= lngMargin,
    ).sort((a, b) => {
      const aDistance =
        (a.lat - region.latitude) ** 2 + (a.lng - region.longitude) ** 2;
      const bDistance =
        (b.lat - region.latitude) ** 2 + (b.lng - region.longitude) ** 2;
      return aDistance - bDistance;
    });
  }, [points, region]);
  const hasFavorites = Object.keys(favorites).length > 0;
  // With no favourites left the chip is gone, so the filter must not linger.
  const favoritesFilter = favoritesOnly && hasFavorites;
  const listedPoints = useMemo(
    () => (favoritesFilter ? visiblePoints.filter(isFavoritePoint) : visiblePoints),
    [favoritesFilter, isFavoritePoint, visiblePoints],
  );

  const visibleLivePubs = useMemo(() => {
    const latMargin = region.latitudeDelta * 0.65;
    const lngMargin = region.longitudeDelta * 0.65;
    return livePubs
      .filter(
        (live) =>
          Math.abs(live.lat - region.latitude) <= latMargin &&
          Math.abs(live.lng - region.longitude) <= lngMargin,
      )
      .sort((a, b) => {
        const aDistance =
          (a.lat - region.latitude) ** 2 + (a.lng - region.longitude) ** 2;
        const bDistance =
          (b.lat - region.latitude) ** 2 + (b.lng - region.longitude) ** 2;
        return aDistance - bDistance;
      });
  }, [livePubs, region]);

  const showCities = region.latitudeDelta > 0.85 && visitedCities.length > 0;
  const clusters = useMemo(() => {
    if (showCities || layer === 'friends') return [];
    // Cluster only the viewport-filtered points — clustering the full
    // accumulated catalogue (up to 600) and discarding offscreen clusters
    // afterwards wastes work on every pan. The selected pub always keeps its
    // own pin: a pub opened from elsewhere must not hide inside a bubble.
    const selectedKey = selectedPub?.key;
    const selected = selectedKey ? visiblePoints.find((point) => point.key === selectedKey) : undefined;
    if (!selected) return clusterCoordinates(visiblePoints, region);
    return [
      ...clusterCoordinates(visiblePoints.filter((point) => point !== selected), region),
      { id: `selected:${selected.key}`, lat: selected.lat, lng: selected.lng, items: [selected] },
    ];
  }, [layer, region, selectedPub?.key, showCities, visiblePoints]);

  const handleRegionChange = useCallback(
    (next: Region) => {
      setRegion(next);
      rememberedRegion = next;
      loadRegion(next);
    },
    [loadRegion],
  );

  const clearSelection = useCallback(() => {
    rememberedSelection = null;
    setSelection(null);
  }, []);

  // Report from the map detail — same semantics as the compass: hide locally by
  // both signals (id + geohash cell, via the persisted pubStore arrays that
  // useBeerMap filters against), then queue the durable report.
  const addReportedPub = usePubStore((s) => s.addReportedPub);
  const reportSelectedPub = (reason: PubReportReason) => {
    if (!selectedPub) return;
    const pub = selectedDetailPub ?? selectedPub.pub;
    addReportedPub(pub.id, selectedPub.key);
    setDetailOpen(false);
    clearSelection();
    void enqueuePubReport(pub, reason);
  };

  const openSelectedPubReport = useCallback(() => {
    if (selectedPub) setReportOpen(true);
  }, [selectedPub]);

  const addPubNearSelection = useCallback(() => {
    if (!selectedPub) return;
    router.push({
      pathname: '/add-pub' as never,
      params: { lat: String(selectedPub.pub.lat), lng: String(selectedPub.pub.lng) },
    });
  }, [router, selectedPub]);

  const renameSelectedPub = useCallback(() => setDetailOpen(true), []);

  // Same form as from the compass; the map center only seeds the pin picker
  // there, nothing is selected until the user aims it.
  const openAddPub = useCallback(() => {
    trackUiInteraction('map_add_pub_open');
    setDetailOpen(false);
    clearSelection();
    router.push({
      pathname: '/add-pub' as never,
      params: { lat: String(region.latitude), lng: String(region.longitude) },
    });
  }, [clearSelection, region.latitude, region.longitude, router]);

  const handleMapPress = useCallback(
    (event: MapPressEvent) => {
      if (event.nativeEvent.action !== 'marker-press') clearSelection();
    },
    [clearSelection],
  );

  const selectPub = useCallback(
    (point: MapPubPoint) => {
      trackUiInteraction('map_pub_select', 'select');
      if (hapticEnabled) fireLightImpactHaptic();
      const next: MapSelection = { kind: 'pub', key: point.key, accountId };
      rememberedSelection = next;
      setTimedOutDetailKey((current) => current === point.key ? current : null);
      setLoadingDetailKey(point.key);
      setSelection(next);
      void AccessibilityInfo.announceForAccessibility(point.pub.name);
      mapRef.current?.animateCamera(
        {
          center: {
            latitude: point.lat,
            longitude: point.lng,
          },
        },
        { duration: reduceMotion ? 0 : 220 },
      );
    },
    [accountId, hapticEnabled, reduceMotion],
  );

  const selectLive = useCallback(
    (live: LivePubSummary) => {
      trackUiInteraction('map_live_select', 'select');
      if (hapticEnabled) fireLightImpactHaptic();
      const next: MapSelection = { kind: 'live', key: live.cacheKey, accountId };
      rememberedSelection = next;
      setSelection(next);
      void AccessibilityInfo.announceForAccessibility(
        t.a11y.mapLive(friendName(live), live.name),
      );
      mapRef.current?.animateCamera(
        {
          center: {
            latitude: live.lat,
            longitude: live.lng,
          },
        },
        { duration: reduceMotion ? 0 : 220 },
      );
    },
    [accountId, hapticEnabled, reduceMotion],
  );

  const selectLayer = useCallback((next: Layer) => {
    trackUiInteraction(
      next === 'all'
        ? 'map_layer_all'
        : next === 'visited'
          ? 'map_layer_visited'
          : 'map_layer_friends',
      'select',
    );
    setRememberedLayer(next);
    rememberedSelection = null;
    setSelection(null);
  }, []);

  const aimCompass = useCallback(
    (target: FocusedPub) => {
      trackUiInteraction('map_aim_compass');
      useFocusedPubStore.getState().setFocusedPub(target);
      onShowCompass();
    },
    [onShowCompass],
  );

  const locate = useCallback(() => {
    trackUiInteraction('map_locate');
    const recenter = (target: { lat: number; lng: number }) => {
      const next = {
        latitude: target.lat,
        longitude: target.lng,
        // Recentring must not silently change the zoom. Cluster membership follows
        // the zoom level, so forcing a new delta here made unchanged pub markers
        // regroup whenever the user tapped the location button.
        latitudeDelta: region.latitudeDelta,
        longitudeDelta: region.longitudeDelta,
      };
      mapRef.current?.animateToRegion(next, reduceMotion ? 0 : 360);
      handleRegionChange(next);
    };
    // The map keeps no live GPS watcher: jump to the last fix right away, then
    // follow a fresh one-shot fix when the user has moved since.
    if (position) recenter(position);
    void refreshPosition().then((fresh) => {
      if (!fresh) {
        if (!position) void requestPermission();
        return;
      }
      if (!position || haversineMeters(position, fresh) > LOCATE_FOLLOW_UP_M) recenter(fresh);
    });
  }, [
    handleRegionChange,
    position,
    reduceMotion,
    refreshPosition,
    region.latitudeDelta,
    region.longitudeDelta,
    requestPermission,
  ]);

  const openCluster = useCallback(
    (lat: number, lng: number) => {
      const next = {
        latitude: lat,
        longitude: lng,
        latitudeDelta: Math.max(region.latitudeDelta * 0.42, 0.018),
        longitudeDelta: Math.max(region.longitudeDelta * 0.42, 0.018),
      };
      mapRef.current?.animateToRegion(next, reduceMotion ? 0 : 340);
      handleRegionChange(next);
    },
    [handleRegionChange, reduceMotion, region.latitudeDelta, region.longitudeDelta],
  );

  const focusCity = useCallback(
    (city: VisitedCitySummary) => {
      const next = {
        latitude: city.lat,
        longitude: city.lng,
        latitudeDelta: 0.22,
        longitudeDelta: 0.22,
      };
      clearSelection();
      mapRef.current?.animateToRegion(next, reduceMotion ? 0 : 360);
      handleRegionChange(next);
    },
    [clearSelection, handleRegionChange, reduceMotion],
  );

  // Two parts, not one sentence: the count is the card's loud line and the rest
  // is the quiet line under it.
  const visitedInView = visiblePoints.filter((point) => point.visit).length;
  const viewportHeadline =
    layer === 'friends'
      ? t.map.liveShort(visibleLivePubs.length)
      : t.map.viewportPubs(visiblePoints.length);
  const viewportDetail =
    layer === 'friends' || visiblePoints.length === 0
      ? null
      : visitedInView === 0
        ? t.map.viewportKnownNone
        : t.map.viewportKnown(visitedInView);

  const selectedBeers = selectedPub ? visibleBeers?.get(selectedPub.key) ?? 0 : 0;
  const cardState = useMemo(() => {
    if (selectedPub) {
      const hours = openingMeta(selectedDetailPub ?? selectedPub.pub, selectedHoursStatus);
      return {
        kind: 'pub' as const,
        title: selectedPub.pub.name,
        // Hours alone on the loud line, with the status dot. Everything else is
        // the quiet line under it — the old single sentence truncated the hours
        // first, which is the one thing worth reading here.
        meta: hours.text,
        metaTone: hours.tone,
        // City, rating, and "been here" — but never "Tady ještě nemáš čárku":
        // an absent tally is already what the pin says, and as a second stacked
        // sentence under the hours it just made the card noisy.
        rating: selectedRating
          ? { value: selectedRating, count: selectedRatingCount }
          : null,
        fact:
          [selectedPub.pub.city, selectedPub.visit ? t.map.visited : null]
            .filter(Boolean)
            .join(' · ') || null,
        beers: selectedBeers ? t.map.beersLastWeek(selectedBeers) : null,
      };
    }
    if (selectedLive) {
      return {
        kind: 'live' as const,
        title: selectedLive.name,
        meta: null,
        metaTone: 'neutral' as const,
        fact:
          selectedLive.activities.length === 1
            ? t.map.friendIsHere(friendName(selectedLive))
            : t.map.friendsAreHere(
                friendName(selectedLive),
                selectedLive.activities.length - 1,
              ),
      };
    }
    if (selectedCity) {
      return {
        kind: 'city' as const,
        title: selectedCity.name,
        meta: null,
        metaTone: 'neutral' as const,
        fact: t.map.citySummary(selectedCity.visitCount, selectedCity.pubCount),
      };
    }
    // Nothing selected: what the viewport holds is the whole message. The layer
    // switch below says which slice it is, so there is no title above it.
    return {
      kind: 'idle' as const,
      title: viewportHeadline,
      meta: null,
      metaTone: 'neutral' as const,
      fact: viewportDetail,
    };
  }, [
    selectedCity,
    selectedDetailPub,
    selectedHoursStatus,
    selectedLive,
    selectedPub,
    selectedRating,
    selectedRatingCount,
    selectedBeers,
    viewportDetail,
    viewportHeadline,
  ]);

  const nudge = useMemo<Nudge | null>(() => {
    if (stale) {
      return {
        kind: 'counted',
        text: t.map.offline,
        undoLabel: t.map.retry,
        onUndo: refresh,
      };
    }
    // Active filters are the chip under the header, not a strip: they last the
    // whole visit, and a full-width strip for that long was map taken away.
    if (loadingPubs) {
      return {
        kind: 'dopito',
        label: t.map.loading,
        onPress: () => undefined,
      };
    }
    if (region.latitudeDelta > 1.5 && layer !== 'friends') {
      return {
        kind: 'dopito',
        label: t.map.zoomForPubs,
        onPress: () => undefined,
      };
    }
    // Without the big "Najdi mě · potřebuju tvoji polohu" button, the permission
    // ask needs a home. The strip offers it and the glyph fires it.
    if (permissionState !== 'granted') {
      return { kind: 'dopito', label: t.map.permissionHint, onPress: locate };
    }
    return null;
  }, [layer, loadingPubs, locate, permissionState, refresh, region.latitudeDelta, stale]);

  const primaryAction = useMemo(() => {
    if (cardState.kind === 'pub' && selectedPub) {
      return {
        label: t.map.aimCompass,
        accessibilityLabel: t.map.aimCompass,
        onPress: () =>
          aimCompass({
            lat: selectedPub.pub.lat,
            lng: selectedPub.pub.lng,
            name: selectedPub.pub.name,
            cacheKey: selectedPub.key,
          }),
      };
    }
    if (cardState.kind === 'live' && selectedLive) {
      return {
        label: t.map.aimCompass,
        accessibilityLabel: t.map.aimCompass,
        onPress: () =>
          aimCompass({
            lat: selectedLive.lat,
            lng: selectedLive.lng,
            name: selectedLive.name,
            cacheKey: selectedLive.cacheKey,
          }),
      };
    }
    if (cardState.kind === 'city' && selectedCity) {
      return {
        label: t.map.showMyPubs,
        accessibilityLabel: t.map.showMyPubs,
        onPress: () => focusCity(selectedCity),
      };
    }
    // Nothing selected, nothing to promise: locating yourself is the glyph in the
    // header now, and the map gets the bottom of the screen back. The object is
    // still returned so the value stays non-nullable — the render below gates on
    // `cardState.kind`, because branching on this object itself makes the React
    // Compiler rules treat its ref-capturing closures as a ref read in render.
    return {
      label: t.map.findMe,
      accessibilityLabel: t.a11y.mapLocate,
      onPress: locate,
    };
  }, [aimCompass, cardState.kind, focusCity, locate, selectedCity, selectedLive, selectedPub]);

  const runAfterMoreClose = useCallback((action: () => void) => {
    setMoreOpen(false);
    if (sheetActionTimer.current) clearTimeout(sheetActionTimer.current);
    sheetActionTimer.current = setTimeout(() => {
      sheetActionTimer.current = null;
      action();
    }, SHEET_DISMISS_MS);
  }, []);

  const moreRows = useMemo<MoreRow[]>(() => {
    const rows: MoreRow[] = [
      {
        key: 'filters',
        label: t.compass.moreFilters,
        value:
          activeFilterCount > 0
            ? t.compass.moreFiltersActive(activeFilterCount)
            : null,
        icon: ListFilterIcon,
        onPress: () => runAfterMoreClose(() => setFilterSheetOpen(true)),
      },
      {
        key: 'beers',
        label: t.map.moreBeers,
        icon: BeerIcon,
        selected: showPubBeers,
        onPress: () => {
          setMoreOpen(false);
          // Hidden counts cannot narrow the map, so turning them back on starts unfiltered.
          if (showPubBeers) setBeersOnly(false);
          setShowPubBeers(!showPubBeers);
        },
      },
      ...(showPubBeers
        ? [
            {
              key: 'beers-only',
              label: t.map.moreBeersOnly,
              icon: MapPinnedIcon,
              selected: beersOnly,
              onPress: () => {
                setMoreOpen(false);
                setBeersOnly(!beersOnly);
              },
            },
          ]
        : []),
      // A map opened from the board goes back to it instead of stacking another.
      ...(onBack
        ? []
        : [
            {
              key: 'board',
              label: t.map.moreBoard,
              icon: TrophyIcon,
              onPress: () =>
                runAfterMoreClose(() =>
                  router.push({ pathname: '/leaderboards' as never, params: { board: 'venues', source: 'map' } }),
                ),
            },
          ]),
      {
        key: 'refresh',
        label: t.map.refresh,
        icon: RefreshCwIcon,
        onPress: () => {
          setMoreOpen(false);
          refresh();
        },
        accessibilityLabel: t.a11y.mapRefresh,
      },
      {
        key: 'add-pub',
        label: t.compass.moreAddPub,
        icon: MapPinPlusIcon,
        onPress: () => runAfterMoreClose(openAddPub),
      },
    ];
    return selectedPub
      ? [
          ...rows,
          {
            key: 'report',
            label: t.compass.moreReport,
            icon: FlagIcon,
            onPress: () => runAfterMoreClose(openSelectedPubReport),
            accessibilityLabel: t.a11y.mapReportClosed(selectedPub.pub.name),
          },
        ]
      : rows;
  }, [
    activeFilterCount,
    openSelectedPubReport,
    onBack,
    refresh,
    router,
    runAfterMoreClose,
    selectedPub,
    setShowPubBeers,
    setBeersOnly,
    showPubBeers,
    openAddPub,
    beersOnly,
  ]);

  // "Jen kde se pilo" narrows the map like any filter, so the chip counts it too.
  const filterCount = activeFilterCount + (beersOnly ? 1 : 0);
  const openFilters = useCallback(() => {
    // The beers toggle lives in the "…" sheet, next to the filters row.
    if (activeFilterCount > 0) setFilterSheetOpen(true);
    else setMoreOpen(true);
  }, [activeFilterCount]);
  const clearFilters = useCallback(() => {
    if (activeFilterCount > 0) onApplyFilters(EMPTY_PUB_SEARCH_FILTERS);
    setBeersOnly(false);
  }, [activeFilterCount, onApplyFilters, setBeersOnly]);

  return (
    <View style={styles.root}>
      <MapView
        key={mapColorScheme}
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        onRegionChangeComplete={handleRegionChange}
        onPress={handleMapPress}
        mapType="standard"
        userInterfaceStyle={mapColorScheme}
        showsUserLocation={permissionState === 'granted'}
        showsMyLocationButton={false}
        showsCompass={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
        loadingBackgroundColor={mapColorScheme === 'dark' ? Colors.stout : Colors.foam}
        loadingIndicatorColor={Colors.amber}
        accessibilityLabel={t.a11y.beerMap}
      >
        {showCities && layer !== 'friends'
          ? visitedCities.map((city) => (
              <StaticMapMarker
                key={`city:${city.key}:${city.name}:${city.visitCount}`}
                stopPropagation
                coordinate={{ latitude: city.lat, longitude: city.lng }}
                onPress={() => {
                  const next: MapSelection = { kind: 'city', key: city.key, accountId };
                  rememberedSelection = next;
                  setSelection(next);
                  void AccessibilityInfo.announceForAccessibility(
                    t.a11y.mapCity(city.name, city.visitCount),
                  );
                }}
                accessibilityLabel={t.a11y.mapCity(city.name, city.visitCount)}
              >
                <View style={styles.cityMarker}>
                  <MapPinnedIcon size={17} color={Colors.stout} />
                  <Text
                    style={styles.cityMarkerText}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.heading}
                  >
                    {city.name}
                  </Text>
                  <Text
                    style={styles.cityMarkerCount}
                    maxFontSizeMultiplier={FontScaleCap.display}
                  >
                    {city.visitCount}
                  </Text>
                </View>
              </StaticMapMarker>
            ))
          : null}

        {clusters.map((cluster) => {
          if (cluster.items.length === 1) {
            const point = cluster.items[0];
            const selected = selectedPub?.key === point.key;
            const beers = visibleBeers?.get(point.key) ?? 0;
            const favorite = isFavoritePoint(point);
            return (
              <StaticMapMarker
                key={`${point.key}:${point.visit?.visitCount ?? 0}:${beers}:${favorite ? 'fav' : ''}:${selected ? 'selected' : 'idle'}`}
                stopPropagation
                coordinate={{ latitude: point.lat, longitude: point.lng }}
                onPress={() => selectPub(point)}
                accessibilityLabel={[
                  t.a11y.mapPub(point.pub.name, point.visit?.visitCount ?? 0),
                  favorite ? t.map.favoriteA11y : null,
                  beers ? t.map.beersLastWeek(beers) : null,
                ].filter(Boolean).join(', ')}
              >
                <PubMarker
                  visited={Boolean(point.visit)}
                  selected={selected}
                  beers={beers}
                  favorite={favorite}
                />
              </StaticMapMarker>
            );
          }
          // Beers add up across the pubs of a cluster.
          const clusterBeers = visibleBeers
            ? cluster.items.reduce((sum, item) => sum + (visibleBeers.get(item.key) ?? 0), 0)
            : 0;
          return (
            <StaticMapMarker
              key={`cluster:${cluster.id}:${cluster.items.length}:${cluster.items.some((item) => item.visit != null)}:${clusterBeers}`}
              stopPropagation
              coordinate={{ latitude: cluster.lat, longitude: cluster.lng }}
              onPress={() => openCluster(cluster.lat, cluster.lng)}
              accessibilityLabel={[
                t.a11y.mapCluster(cluster.items.length),
                clusterBeers ? t.map.beersClusterLastWeek(clusterBeers) : null,
              ].filter(Boolean).join(', ')}
            >
              <ClusterMarker
                count={cluster.items.length}
                visited={cluster.items.some((item) => item.visit != null)}
                beers={clusterBeers}
              />
            </StaticMapMarker>
          );
        })}

        {layer !== 'visited' ? livePubs.map((live) => (
          <StaticMapMarker
            key={`live:${live.cacheKey}:${selectedLive?.cacheKey === live.cacheKey ? 'selected' : 'idle'}:${live.activities.length}:${friendName(live)}:${live.activities[0]?.account?.avatarUrl ?? ''}`}
            stopPropagation
            coordinate={{ latitude: live.lat, longitude: live.lng }}
            onPress={() => selectLive(live)}
            zIndex={10}
            accessibilityLabel={t.a11y.mapLive(friendName(live), live.name)}
          >
            <LiveMarker live={live} selected={selectedLive?.cacheKey === live.cacheKey} />
          </StaticMapMarker>
        )) : null}
      </MapView>

      <View
        style={[styles.topStack, { paddingTop: insets.top }]}
        pointerEvents="box-none"
      >
        <View style={styles.header}>
          {onBack ? (
            <Pressable
              onPress={onBack}
              style={({ pressed }) => [styles.moreButton, pressed && styles.pressedSoft]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t.leaderboards.back}
            >
              <ChevronLeftIcon size={22} color={Colors.foamMuted} />
            </Pressable>
          ) : null}
          <ExploreSwitch
            activeView="map"
            onSelectCompass={onShowCompass}
            onSelectMap={() => undefined}
          />
          <View style={styles.headerSpacer} />
          <View style={styles.moreButton}>
            <PubSearchButton onPress={onSearch} />
          </View>
          <Pressable
            onPress={() => {
              trackUiInteraction('map_more_open');
              setMoreOpen(true);
            }}
            style={({ pressed }) => [
              styles.moreButton,
              pressed && styles.pressedSoft,
            ]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t.a11y.compassMore}
          >
            <MenuIcon size={20} color={Colors.foamMuted} />
          </Pressable>
        </View>
        {filterCount > 0 ? (
          <View style={styles.filterChip}>
            <Pressable
              onPress={openFilters}
              hitSlop={{ top: 4, bottom: 4, left: 8 }}
              style={({ pressed }) => [styles.filterChipBody, pressed && styles.pressedSoft]}
              accessibilityRole="button"
              accessibilityLabel={`${t.compass.moreFilters}, ${t.compass.moreFiltersActive(filterCount)}`}
            >
              <ListFilterIcon size={15} color={Colors.amber} />
              <Text
                style={styles.filterChipLabel}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.heading}
              >
                {t.compass.moreFilters}
              </Text>
              <Text
                style={styles.filterChipCount}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.display}
              >
                {filterCount}
              </Text>
            </Pressable>
            <Pressable
              onPress={clearFilters}
              hitSlop={{ top: 4, bottom: 4, right: 8 }}
              style={({ pressed }) => [styles.filterChipClear, pressed && styles.pressedSoft]}
              accessibilityRole="button"
              accessibilityLabel={t.a11y.mapFiltersClear}
            >
              <XIcon size={15} color={Colors.amber} />
            </Pressable>
          </View>
        ) : null}
        <View style={styles.nudgeWrap} pointerEvents="box-none">
          <NudgeSlot nudge={nudge} collapseWhenEmpty />
        </View>
      </View>

      <View
        style={[
          styles.bottomStack,
          { paddingBottom: Math.max(insets.bottom, Spacing.sm) },
        ]}
        pointerEvents="box-none"
      >
        <Pressable
          onPress={locate}
          style={({ pressed }) => [styles.mapGlyphButton, pressed && styles.pressedSoft]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t.a11y.mapLocate}
        >
          <LocateFixedIcon size={20} color={Colors.amber} />
        </Pressable>
        {/* One row at the bottom, never two: the layers when nothing is picked,
            the selection once something is. Tapping the empty map goes back. */}
        {cardState.kind === 'idle' ? (
          <View style={styles.dock}>
            <LayerSwitch
              layer={layer}
              liveCount={visibleLivePubs.length}
              onSelect={selectLayer}
            />
            <Pressable
              onPress={() => {
                trackUiInteraction('map_list_open');
                setListOpen(true);
              }}
              style={({ pressed }) => [styles.dockListButton, pressed && styles.pressedSoft]}
              accessibilityRole="button"
              accessibilityLabel={`${t.a11y.mapList}, ${cardState.title}`}
            >
              <LayoutListIcon size={20} color={Colors.foamMuted} />
            </Pressable>
          </View>
        ) : (
          <PlaceCard
            title={cardState.title}
            meta={cardState.meta}
            metaTone={cardState.metaTone}
            fact={cardState.fact}
            beers={'beers' in cardState ? cardState.beers : null}
            rating={'rating' in cardState ? cardState.rating : null}
            open={
              cardState.kind === 'pub'
                ? {
                    onPress: () => {
                      if (!selectedPub) return;
                      trackUiInteraction('map_pub_detail_open');
                      const target = selectedDetailPub ?? selectedPub.pub;
                      if (onOpenPub) onOpenPub(target);
                      else openPubPage(router, target);
                    },
                    accessibilityLabel: t.compass.mapPubLink,
                  }
                : undefined
            }
            action={{
              label: primaryAction.label,
              onPress: primaryAction.onPress,
              accessibilityLabel: primaryAction.accessibilityLabel,
            }}
            onClose={clearSelection}
          />
        )}
      </View>

      <Modal
        visible={listOpen}
        transparent
        statusBarTranslucent
        presentationStyle="overFullScreen"
        animationType="fade"
        onRequestClose={() => setListOpen(false)}
      >
        <View style={styles.listBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setListOpen(false)}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <View
            style={[styles.listCardWrap, { marginBottom: -insets.bottom }]}
          >
            <Pressable
              style={[
                styles.listCard,
                { paddingBottom: insets.bottom + Spacing.lg },
              ]}
              onPress={() => undefined}
              accessible={false}
              focusable={false}
            >
              <View style={styles.listGrabber} />
              <View style={styles.listHeader}>
                <Text
                  style={styles.listTitle}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.heading}
                >
                  {layer === 'friends' ? t.map.layerFriends : viewportHeadline}
                </Text>
                <Pressable
                  onPress={() => setListOpen(false)}
                  style={({ pressed }) => [
                    styles.closeButton,
                    pressed && styles.pressedSoft,
                  ]}
                  accessibilityLabel={t.map.closeList}
                  accessibilityRole="button"
                >
                  <XIcon size={20} color={Colors.foamMuted} />
                </Pressable>
              </View>
              {layer !== 'friends' && viewportDetail ? (
                <Text
                  style={styles.listSubtitle}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {viewportDetail}
                </Text>
              ) : null}
              {layer !== 'friends' && hasFavorites ? (
                <View style={styles.listChips}>
                  <Pressable
                    onPress={() => setFavoritesOnly(!favoritesFilter)}
                    style={({ pressed }) => [
                      styles.listChip,
                      favoritesFilter && styles.listChipActive,
                      pressed && styles.pressedSoft,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: favoritesFilter }}
                    accessibilityLabel={t.map.favoritesOnly}
                  >
                    <HeartIcon size={15} color={favoritesFilter ? Colors.amber : Colors.mutedText} />
                    <Text
                      style={[styles.listChipText, favoritesFilter && styles.listChipTextActive]}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {t.map.favoritesOnly}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
              {layer === 'friends' ? (
                <FlatList
                  style={styles.list}
                  data={visibleLivePubs}
                  keyExtractor={(item) => item.cacheKey}
                  contentContainerStyle={styles.listContent}
                  showsVerticalScrollIndicator={false}
                  renderItem={({ item, index }) => (
                    <Pressable
                      onPress={() => {
                        setListOpen(false);
                        selectLive(item);
                        const next = {
                          latitude: item.lat,
                          longitude: item.lng,
                          latitudeDelta: 0.025,
                          longitudeDelta: 0.025,
                        };
                        mapRef.current?.animateToRegion(
                          next,
                          reduceMotion ? 0 : 300,
                        );
                        handleRegionChange(next);
                      }}
                      style={({ pressed }) => [
                        styles.listRow,
                        index > 0 && styles.listRowDivider,
                        pressed && styles.pressedSoft,
                      ]}
                      accessibilityLabel={t.a11y.mapLive(
                        friendName(item),
                        item.name,
                      )}
                      accessibilityRole="button"
                    >
                      <View style={styles.listRowCopy}>
                        <Text
                          style={styles.listRowTitle}
                          numberOfLines={1}
                          maxFontSizeMultiplier={FontScaleCap.body}
                        >
                          {item.name}
                        </Text>
                        <Text
                          style={styles.listRowMeta}
                          numberOfLines={1}
                          maxFontSizeMultiplier={FontScaleCap.body}
                        >
                          {t.map.friendIsHere(friendName(item))}
                        </Text>
                      </View>
                      <ChevronRightIcon size={18} color={Colors.mutedText} />
                    </Pressable>
                  )}
                  ListEmptyComponent={
                    <Text
                      style={styles.emptyList}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {t.map.emptyList}
                    </Text>
                  }
                />
              ) : (
                <FlatList
                  style={styles.list}
                  data={listedPoints}
                  keyExtractor={(item) => item.key}
                  contentContainerStyle={styles.listContent}
                  showsVerticalScrollIndicator={false}
                  renderItem={({ item, index }) => (
                    <Pressable
                      onPress={() => {
                        setListOpen(false);
                        selectPub(item);
                        const next = {
                          latitude: item.lat,
                          longitude: item.lng,
                          latitudeDelta: 0.025,
                          longitudeDelta: 0.025,
                        };
                        mapRef.current?.animateToRegion(
                          next,
                          reduceMotion ? 0 : 300,
                        );
                        handleRegionChange(next);
                      }}
                      style={({ pressed }) => [
                        styles.listRow,
                        index > 0 && styles.listRowDivider,
                        pressed && styles.pressedSoft,
                      ]}
                      accessibilityLabel={t.a11y.mapPub(
                        item.pub.name,
                        item.visit?.visitCount ?? 0,
                      )}
                      accessibilityRole="button"
                    >
                      <View style={styles.listRowCopy}>
                        <View style={styles.listRowTitleLine}>
                          <Text
                            style={[styles.listRowTitle, styles.listRowTitleShrink]}
                            numberOfLines={1}
                            maxFontSizeMultiplier={FontScaleCap.body}
                          >
                            {item.pub.name}
                          </Text>
                          {isFavoritePoint(item) ? (
                            <HeartFilledIcon size={13} color={Colors.amber} />
                          ) : null}
                        </View>
                        <Text
                          style={styles.listRowMeta}
                          numberOfLines={1}
                          maxFontSizeMultiplier={FontScaleCap.body}
                        >
                          {item.pub.city ||
                            (item.visit ? t.map.visited : t.map.notVisited)}
                        </Text>
                      </View>
                      <ChevronRightIcon size={18} color={Colors.mutedText} />
                    </Pressable>
                  )}
                  ListEmptyComponent={
                    <Text
                      style={styles.emptyList}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {favoritesFilter ? t.map.emptyFavorites : t.map.emptyList}
                    </Text>
                  }
                />
              )}
            </Pressable>
          </View>
        </View>
      </Modal>

      <MoreSheet
        visible={moreOpen}
        rows={moreRows}
        onClose={() => setMoreOpen(false)}
      />

      {filterSheetOpen ? (
        <PubFilterSheet
          visible
          value={filters}
          nearbyPrices={nearbyPrices}
          searchArea={searchArea}
          onClose={() => setFilterSheetOpen(false)}
          onApply={onApplyFilters}
        />
      ) : null}

      {selectedPub ? (
        <MapPubSheet
          visible={detailOpen}
          pubKey={selectedPub.key}
          pubName={selectedPub.pub.name}
          info={pubInfoFromPub(selectedDetailPub ?? selectedPub.pub)}
          hoursLabel={cardState.kind === 'pub' ? cardState.meta : null}
          hoursTone={
            cardState.metaTone === 'open' || cardState.metaTone === 'closed'
              ? cardState.metaTone
              : 'unknown'
          }
          onClose={() => setDetailOpen(false)}
          onNavigate={() => {
            void openPubInMaps(selectedDetailPub ?? selectedPub.pub).catch(() =>
              useToastStore.getState().show(t.pubSearch.navigationFailed),
            );
          }}
          onReport={() => {
            setDetailOpen(false);
            setTimeout(() => setReportOpen(true), 250);
          }}
        />
      ) : null}

      {selectedPub ? (
        <ReportPubModal
          visible={reportOpen}
          pubName={selectedPub.pub.name}
          onClose={() => setReportOpen(false)}
          onAddPub={addPubNearSelection}
          onRename={renameSelectedPub}
          onReportReason={reportSelectedPub}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.stout },
  pressedSoft: { opacity: 0.6 },

  topStack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  header: {
    minHeight: 40,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerSpacer: {
    flex: 1,
    minWidth: Spacing.sm,
  },
  // The only place in the app where the overflow glyph needs a surface under
  // it: everywhere else it sits on stout, here it floats over a light map and
  // a bare muted glyph simply disappears into the streets. Same dark pill as
  // the Kompas/Mapa switch beside it, so the header reads as one row.
  // Round glyph target that has to stay legible over the map, so unlike the
  // header buttons on the tácek screens it carries its own surface.
  mapGlyphButton: {
    alignSelf: 'flex-end',
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.stout, 0.94),
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.16),
    ...softDrop(),
  },
  moreButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.stout, 0.94),
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.16),
    ...softDrop(),
  },
  nudgeWrap: {
    paddingTop: Spacing.sm,
    paddingHorizontal: 24,
  },
  // A filter lasts the whole visit, so it is a chip in the corner, not a strip
  // across the map. The body opens the filters, the cross clears them.
  filterChip: {
    alignSelf: 'flex-start',
    marginTop: Spacing.sm,
    marginLeft: 12,
    height: 36,
    borderRadius: Radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: withAlpha(Colors.stout, 0.94),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.5),
    ...softDrop(),
  },
  filterChipBody: {
    height: '100%',
    paddingLeft: 12,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  filterChipLabel: {
    fontFamily: Fonts.display.bold,
    fontSize: 14,
    color: Colors.amber,
    includeFontPadding: false,
  },
  filterChipCount: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 14,
    color: Colors.amber,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  // 36 wide plus the slop is a full 44pt target, split from the body by a hairline.
  filterChipClear: {
    height: '100%',
    minWidth: 36,
    paddingLeft: 10,
    paddingRight: 12,
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: withAlpha(Colors.foam, 0.16),
  },

  pinHit: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  // Symmetric so the pin stays on the coordinate; the badge needs the right half.
  pinHitWide: { width: 80 },
  pinBeersBadge: { top: 5, left: 47 },
  // Top left of the pin, mirroring the beer badge on the right.
  pinHeartBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.foam,
    borderWidth: 1.5,
    borderColor: Colors.stout,
  },
  pinHeartBadgeWide: { left: 18 },
  pinHeartBadgeSelected: { top: 2, left: 2 },
  pinHeartBadgeSelectedWide: { top: 2, left: 14 },
  pinBeersBadgeSelected: { top: 2, left: 50 },
  clusterHitWithBadge: { paddingTop: 10, paddingHorizontal: 26 },
  clusterBeersBadge: { top: 0, right: 0 },
  beersBadge: {
    position: 'absolute',
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: Colors.foam,
    borderWidth: 1.5,
    borderColor: Colors.stout,
  },
  beersBadgeText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 10,
    color: Colors.stout,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  pubPin: {
    width: 31,
    height: 31,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.stout3, 0.96),
    borderWidth: 1.5,
    borderColor: withAlpha(Colors.foamMuted, 0.7),
  },
  pubPinVisited: { backgroundColor: Colors.amber, borderColor: Colors.stout, borderWidth: 3 },
  pubPinSelected: { width: 38, height: 38, borderRadius: 19, borderColor: Colors.foam },
  pubPinRing: {
    position: 'absolute',
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2.5,
    borderColor: Colors.amber,
  },
  visitedNotch: {
    position: 'absolute',
    bottom: 2,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.foam,
    borderWidth: 1,
    borderColor: Colors.stout,
  },
  clusterHit: {
    minWidth: HitArea.min,
    minHeight: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clusterPin: {
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.stout2, 0.92),
    borderWidth: 1.5,
    borderColor: withAlpha(Colors.foamMuted, 0.55),
  },
  clusterPinVisited: { borderColor: Colors.amber, borderWidth: 2.5 },
  clusterText: {
    fontFamily: Fonts.display.extrabold,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  clusterTextVisited: { color: Colors.amberLight },
  liveMarkerHit: {
    width: 57,
    height: 57,
    alignItems: 'center',
    justifyContent: 'center',
  },
  livePin: {
    width: 45,
    height: 45,
    borderRadius: 23,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
    borderWidth: 3,
    borderColor: Colors.foam,
  },
  livePinSelected: { transform: [{ scale: 1.14 }], borderColor: Colors.neon },
  liveAvatar: { width: '100%', height: '100%' },
  liveInitial: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 19,
    color: Colors.stout,
    includeFontPadding: false,
  },
  liveCount: {
    position: 'absolute',
    right: 0,
    top: 0,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: Colors.foam,
    borderWidth: 2,
    borderColor: Colors.stout,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveCountText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 10,
    color: Colors.stout,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  cityMarker: {
    maxWidth: 190,
    minHeight: 44,
    paddingHorizontal: 11,
    borderRadius: Radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: Colors.amber,
    borderWidth: 2,
    borderColor: Colors.foam,
  },
  cityMarkerText: {
    flexShrink: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 15,
    color: Colors.stout,
    includeFontPadding: false,
  },
  cityMarkerCount: {
    fontFamily: Fonts.ui.bold,
    fontSize: 12,
    color: withAlpha(Colors.stout, 0.72),
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },

  bottomStack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    gap: 12,
  },
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  dockListButton: {
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.stout, 0.94),
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.16),
    ...softDrop(),
  },
  // Same surface as every hero card, only shorter and floating over the map.
  // `minHeight`, not `height`: with the biggest system font the rows grow instead
  // of getting shaved off, and the stack is anchored to the bottom anyway.
  placeCard: {
    ...CardSurface.card,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 14,
  },
  placeBottomRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  placeBottomStacked: {
    marginTop: 2,
    gap: 12,
  },
  placeDetailsBeside: {
    flex: 1,
    minWidth: 0,
  },
  placeTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  placeTitlePress: {
    flex: 1,
    minWidth: 0,
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  placeClose: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.08),
  },
  // Every detail line starts at the same x, whatever glyph (or none) leads it.
  placeLead: {
    width: 13,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeTitle: {
    flexShrink: 1,
    minWidth: 0,
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    lineHeight: 23,
    color: Colors.foam,
    includeFontPadding: false,
  },
  // Top-aligned so a wrapped second line does not pull the glyph off the first.
  placeMetaRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  // The one dot allowed to be decoration-shaped, because it carries real state.
  placeDot: {
    width: 6,
    height: 6,
    borderRadius: Radius.pill,
  },
  placeMeta: {
    flex: 1,
    minWidth: 0,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  placeFact: {
    flexShrink: 1,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  // Shorter than HitArea.min so the quiet line stays a line — the 12 pt hitSlop
  // on the Pressable puts the real target back over the minimum.
  // Compact primary: the card's only amber surface, no glow (§6.1). Never
  // shrinks, so the label stays whole and the details column gives way.
  placeAction: {
    flexShrink: 0,
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeActionLabel: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 16,
    color: Colors.stout,
    includeFontPadding: false,
  },

  // — Layer switch (§2.2: neutral track, never a second amber surface) —
  layerTrack: {
    flex: 1,
    minWidth: 0,
    height: 48,
    padding: 4,
    borderRadius: Radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: withAlpha(Colors.stout, 0.94),
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.16),
    ...softDrop(),
  },
  layerSegment: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    minWidth: 0,
    height: 40,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  layerSegmentActive: {
    backgroundColor: withAlpha(Colors.foam, 0.1),
  },
  layerLabel: {
    flexShrink: 1,
    fontFamily: Fonts.display.bold,
    fontSize: 14,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  layerLabelActive: {
    color: Colors.foam,
  },
  layerBadge: {
    flexShrink: 0,
    fontFamily: Fonts.display.extrabold,
    fontSize: 12,
    color: Colors.amber,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },

  listBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: withAlpha(Colors.black, 0.6),
  },
  listCardWrap: {
    width: '100%',
    minHeight: '56%',
    maxHeight: '92%',
  },
  listCard: {
    flex: 1,
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    ...softDrop(),
  },
  listGrabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    marginBottom: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.border,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  listTitle: {
    flexShrink: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
    includeFontPadding: false,
  },
  listSubtitle: {
    marginTop: -Spacing.xs,
    fontFamily: Fonts.ui.medium,
    fontSize: 14,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  closeButton: {
    width: HitArea.min,
    height: HitArea.min,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flex: 1,
    marginTop: Spacing.sm,
  },
  listContent: {
    paddingBottom: Spacing.sm,
  },
  listRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: Spacing.sm,
  },
  listRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.border, 0.4),
  },
  listRowCopy: { flex: 1, minWidth: 0 },
  listChips: {
    flexDirection: 'row',
    marginTop: Spacing.sm,
  },
  listChip: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    // The list card is stout2 already; the chip sits one step lighter.
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  listChipActive: {
    borderColor: withAlpha(Colors.amber, 0.5),
  },
  listChipText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.mutedText,
  },
  listChipTextActive: {
    color: Colors.amber,
  },
  listRowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  listRowTitleShrink: {
    flexShrink: 1,
  },
  listRowTitle: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
  },
  listRowMeta: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  emptyList: {
    paddingVertical: 40,
    textAlign: 'center',
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
});
