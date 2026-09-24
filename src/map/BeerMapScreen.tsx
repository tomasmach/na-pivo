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
  ChevronRightIcon,
  MenuIcon,
  ExternalLinkIcon,
  FlagIcon,
  ListFilterIcon,
  LocateFixedIcon,
  MapPinPlusIcon,
  MapPinnedIcon,
  RefreshCwIcon,
  StarIcon,
  UsersIcon,
  XIcon,
} from '@/components/shared/IconGlyph';
import { CardSheen, CardSurface } from '@/components/shared/CardSurface';
import { PubSearchButton } from '@/search/PubSearchButton';
import { ExploreSwitch } from '@/components/shared/ExploreSwitch';
import { GlowButton } from '@/components/shared/GlowButton';
import { MoreSheet, type MoreRow } from '@/components/shared/MoreSheet';
import { NudgeSlot, type Nudge } from '@/counter/NudgeSlot';
import type { Pub } from '@/data/pubs';
import { enqueuePubReport } from '@/data/pubReportQueue';
import type { PubReportReason } from '@/data/pubReportsClient';
import { usePubStore } from '@/stores/pubStore';
import { fetchPubHours, type PubHoursResult } from '@/data/hoursClient';
import { fetchPubVisitorsLastWeek, type PubVisitorsByKey } from '@/data/pubVisitorsClient';
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
let rememberedVisitorsOnly = false;
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

interface PlaceCardProps {
  /**
   * The loud line: the pub's name when one is selected, otherwise what the
   * viewport is showing. There is no separate section title — the layer switch
   * in the footer already names the mode, and "Parta teď" printed directly above
   * a highlighted "Parta teď" segment was the same word twice.
   */
  title: string;
  /** Opening hours, with the status dot. Null when the card is not about a pub. */
  meta: string | null;
  metaTone: MetaTone;
  /** The quiet tail of the same line (city, "navštíveno"), or null. */
  fact: string | null;
  /** How many people were in the selected pub last week, on its own quiet line. */
  people?: string | null;
  /** Star rating, rendered with a ★ glyph ahead of the fact text. */
  rating?: { value: string; count: string | null } | null;
  titlePress?: {
    onPress: () => void;
    accessibilityLabel: string;
  };
  door?: {
    label: string;
    onPress: () => void;
    accessibilityLabel: string;
  };
  /** The layer switch, rendered as the card's own footer. */
  layers: React.ReactNode;
}

function PlaceCard({
  title,
  meta,
  metaTone,
  fact,
  people,
  rating,
  titlePress,
  door,
  layers,
}: PlaceCardProps) {
  const ratingText = rating
    ? rating.count
      ? `${rating.value} (${rating.count})`
      : rating.value
    : null;
  // Rating and city share the hours line. Two stacked half-empty lines next to a
  // vertically centred door aligned with neither of them.
  const detailText = [ratingText, fact].filter(Boolean).join(' · ');
  const titleContent = (
    <>
      {/* The name owns the full card width. The door used to sit beside it and
          pushed two-word pub names onto a second line for no reason. */}
      <Text
        style={styles.placeTitle}
        numberOfLines={2}
        maxFontSizeMultiplier={FontScaleCap.heading}
      >
        {title}
      </Text>
      {titlePress ? <ExternalLinkIcon size={15} color={Colors.amber} /> : null}
    </>
  );

  return (
    <View style={styles.placeCard}>
      <CardSheen />

      {titlePress ? (
        <Pressable
          onPress={titlePress.onPress}
          hitSlop={12}
          style={({ pressed }) => [styles.placeTitleRow, pressed && styles.pressedSoft]}
          accessibilityRole="button"
          accessibilityLabel={titlePress.accessibilityLabel}
        >
          {titleContent}
        </Pressable>
      ) : (
        <View style={styles.placeTitleRow}>{titleContent}</View>
      )}

      {/* §5.4: the hours keep a line of their own, full width — they are what the
          person on the street came for and they must never truncate first. */}
      {meta ? (
        <View style={styles.placeMetaRow}>
          {showsStatusDot(metaTone) ? (
            <View style={[styles.placeDot, { backgroundColor: metaToneColor(metaTone) }]} />
          ) : null}
          <Text
            style={[styles.placeMeta, { color: metaToneColor(metaTone) }]}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {meta}
          </Text>
        </View>
      ) : null}

      {people ? (
        <View style={styles.placeMetaRow}>
          <UsersIcon size={13} color={Colors.mutedText} />
          <Text
            style={styles.placeFact}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {people}
          </Text>
        </View>
      ) : null}

      {/* The door sits on the quiet line, not beside the name and not centred
          against the whole block: it is the shortest line, so it has the room,
          and sharing one row means the two halves share one baseline. */}
      <View style={styles.placeInfoRow}>
        <View style={styles.placeFactRow}>
          {ratingText ? <StarIcon size={13} color={Colors.amber} /> : null}
          {detailText ? (
            <Text
              style={styles.placeFact}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {detailText}
            </Text>
          ) : null}
        </View>

        {door ? (
          <Pressable
            onPress={door.onPress}
            hitSlop={12}
            style={({ pressed }) => [styles.placeDoor, pressed && styles.pressedSoft]}
            accessibilityRole="button"
            accessibilityLabel={door.accessibilityLabel}
          >
            <Text
              style={styles.placeDoorLabel}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {door.label}
            </Text>
            <ChevronRightIcon size={15} color={Colors.amber} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.placeLayers}>{layers}</View>
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
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {segment.label}
            </Text>
            {segment.badge ? (
              <Text
                style={[styles.layerBadge, active && styles.layerLabelActive]}
                maxFontSizeMultiplier={FontScaleCap.body}
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
  visitors,
}: {
  visited: boolean;
  selected: boolean;
  visitors?: number;
}) {
  return (
    <View style={[styles.pinHit, visitors ? styles.pinHitWide : null]}>
      {selected ? <View style={styles.pubPinRing} /> : null}
      <View style={[styles.pubPin, visited && styles.pubPinVisited, selected && styles.pubPinSelected]}>
        <BeerIcon size={selected ? 18 : 15} color={visited ? Colors.stout : Colors.foam} />
      </View>
      {visited ? <View style={styles.visitedNotch} /> : null}
      {visitors ? (
        <VisitorsBadge
          visitors={visitors}
          style={[styles.pinVisitorsBadge, selected && styles.pinVisitorsBadgeSelected]}
        />
      ) : null}
    </View>
  );
}

function VisitorsBadge({
  visitors,
  style,
}: {
  visitors: number;
  style: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.visitorsBadge, style]}>
      <UsersIcon size={10} color={Colors.stout} />
      <Text style={styles.visitorsBadgeText} maxFontSizeMultiplier={FontScaleCap.display}>
        {visitors > 99 ? '99+' : visitors}
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
  visitors,
}: {
  count: number;
  visited: boolean;
  visitors: number;
}) {
  const { size, fontSize } = clusterTier(count);
  return (
    <View style={[styles.clusterHit, visitors ? styles.clusterHitWithBadge : null]}>
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
      {visitors ? (
        <VisitorsBadge visitors={visitors} style={styles.clusterVisitorsBadge} />
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
  const showPubVisitors = useSettingsStore((state) => state.showPubVisitors);
  const setShowPubVisitors = useSettingsStore((state) => state.setShowPubVisitors);
  const accountId = useAccountStore((state) => state.session?.accountId ?? null);
  const {
    pubs,
    nearbyPrices,
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
  const [pubVisitors, setPubVisitors] = useState<PubVisitorsByKey | null>(null);
  const [visitorsOnlyChoice, setVisitorsOnlyChoice] = useState(rememberedVisitorsOnly);
  const [listOpen, setListOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [placingPin, setPlacingPin] = useState(false);
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
  const visitorsRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!showPubVisitors || visitorsRequest.current) return;
    const controller = new AbortController();
    visitorsRequest.current = controller;
    void fetchPubVisitorsLastWeek(controller.signal).then((visitors) => {
      if (visitorsRequest.current === controller) visitorsRequest.current = null;
      if (!controller.signal.aborted && visitors) setPubVisitors(visitors);
    });
  }, [pubs, showPubVisitors]);
  useEffect(() => {
    if (showPubVisitors) return;
    visitorsRequest.current?.abort();
    visitorsRequest.current = null;
  }, [showPubVisitors]);
  useEffect(() => {
    const request = visitorsRequest;
    return () => request.current?.abort();
  }, []);

  // Last week's counts only mean something while they are shown and loaded.
  const visibleVisitors = showPubVisitors && layer !== 'friends' ? pubVisitors : null;
  const visitorsOnly = visitorsOnlyChoice && visibleVisitors != null;
  const setVisitorsOnly = useCallback((next: boolean) => {
    rememberedVisitorsOnly = next;
    setVisitorsOnlyChoice(next);
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
      if (visitorsOnly && visibleVisitors) {
        points = points.filter((point) => visibleVisitors.has(point.key));
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
      visibleVisitors,
      visitedPubs,
      visitorsOnly,
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
    // afterwards wastes work on every pan.
    return clusterCoordinates(visiblePoints, region);
  }, [layer, region, showCities, visiblePoints]);

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

  // Add-pub straight from the map: a fixed pin over the viewport center that
  // the user aims by panning the map, so the chosen point is explicit — no
  // silently inherited coordinates.
  const startPinPlacement = useCallback(() => {
    trackUiInteraction('map_add_pub_open');
    setDetailOpen(false);
    clearSelection();
    setPlacingPin(true);
  }, [clearSelection]);

  const cancelPinPlacement = useCallback(() => setPlacingPin(false), []);

  const confirmPinPlacement = useCallback(async () => {
    trackUiInteraction('map_add_pub_open', 'submit');
    // The settled region can lag one gesture behind; the camera is exact.
    let center = { latitude: region.latitude, longitude: region.longitude };
    try {
      const camera = await mapRef.current?.getCamera();
      if (camera?.center) center = camera.center;
    } catch {
      // Fall back to the last settled region.
    }
    setPlacingPin(false);
    router.push({
      pathname: '/add-pub' as never,
      params: {
        lat: String(center.latitude),
        lng: String(center.longitude),
        source: 'map',
      },
    });
  }, [region.latitude, region.longitude, router]);

  const handleMapPress = useCallback(
    (event: MapPressEvent) => {
      if (event.nativeEvent.action !== 'marker-press') clearSelection();
    },
    [clearSelection],
  );

  const selectPub = useCallback(
    (point: MapPubPoint) => {
      if (placingPin) return;
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
    [accountId, hapticEnabled, placingPin, reduceMotion],
  );

  const selectLive = useCallback(
    (live: LivePubSummary) => {
      if (placingPin) return;
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
    [accountId, hapticEnabled, placingPin, reduceMotion],
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

  const selectedVisitors = selectedPub ? visibleVisitors?.get(selectedPub.key) ?? 0 : 0;
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
        people: selectedVisitors ? t.map.visitorsLastWeek(selectedVisitors) : null,
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
    selectedVisitors,
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
    if (visitorsOnly) {
      return {
        kind: 'rapid',
        text: t.map.visitorsOnlyNudge,
        confirmLabel: t.compass.nudgeFiltersClear,
        onConfirm: () => setVisitorsOnly(false),
      };
    }
    if (activeFilterCount > 0) {
      return {
        kind: 'rapid',
        text: t.compass.nudgeFilters(activeFilterCount),
        confirmLabel: t.compass.nudgeFiltersClear,
        onConfirm: () => onApplyFilters(EMPTY_PUB_SEARCH_FILTERS),
      };
    }
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
  }, [
    activeFilterCount,
    layer,
    loadingPubs,
    locate,
    onApplyFilters,
    permissionState,
    refresh,
    region.latitudeDelta,
    setVisitorsOnly,
    stale,
    visitorsOnly,
  ]);

  const primaryAction = useMemo(() => {
    if (cardState.kind === 'pub' && selectedPub) {
      return {
        label: t.map.aimCompass,
        subLabel: null as string | null,
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
        subLabel: null as string | null,
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
        subLabel: null as string | null,
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
      subLabel: null as string | null,
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
        key: 'visitors',
        label: t.map.moreVisitors,
        icon: UsersIcon,
        selected: showPubVisitors,
        onPress: () => {
          setMoreOpen(false);
          // Hidden counts cannot narrow the map, so turning them back on starts unfiltered.
          if (showPubVisitors) setVisitorsOnly(false);
          setShowPubVisitors(!showPubVisitors);
        },
      },
      ...(showPubVisitors
        ? [
            {
              key: 'visitors-only',
              label: t.map.moreVisitorsOnly,
              icon: BeerIcon,
              selected: visitorsOnly,
              onPress: () => {
                setMoreOpen(false);
                setVisitorsOnly(!visitorsOnly);
              },
            },
          ]
        : []),
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
        onPress: () => runAfterMoreClose(startPinPlacement),
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
    refresh,
    runAfterMoreClose,
    selectedPub,
    setShowPubVisitors,
    setVisitorsOnly,
    showPubVisitors,
    startPinPlacement,
    visitorsOnly,
  ]);

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
            const visitors = visibleVisitors?.get(point.key) ?? 0;
            return (
              <StaticMapMarker
                key={`${point.key}:${point.visit?.visitCount ?? 0}:${visitors}:${selected ? 'selected' : 'idle'}`}
                stopPropagation
                coordinate={{ latitude: point.lat, longitude: point.lng }}
                onPress={() => selectPub(point)}
                accessibilityLabel={[
                  t.a11y.mapPub(point.pub.name, point.visit?.visitCount ?? 0),
                  visitors ? t.map.visitorsLastWeek(visitors) : null,
                ].filter(Boolean).join(', ')}
              >
                <PubMarker
                  visited={Boolean(point.visit)}
                  selected={selected}
                  visitors={visitors}
                />
              </StaticMapMarker>
            );
          }
          // A sum over pubs: someone who went to two of them counts twice.
          const clusterVisitors = visibleVisitors
            ? cluster.items.reduce((sum, item) => sum + (visibleVisitors.get(item.key) ?? 0), 0)
            : 0;
          return (
            <StaticMapMarker
              key={`cluster:${cluster.id}:${cluster.items.length}:${cluster.items.some((item) => item.visit != null)}:${clusterVisitors}`}
              stopPropagation
              coordinate={{ latitude: cluster.lat, longitude: cluster.lng }}
              onPress={() => openCluster(cluster.lat, cluster.lng)}
              accessibilityLabel={[
                t.a11y.mapCluster(cluster.items.length),
                clusterVisitors ? t.map.visitorsClusterLastWeek(clusterVisitors) : null,
              ].filter(Boolean).join(', ')}
            >
              <ClusterMarker
                count={cluster.items.length}
                visited={cluster.items.some((item) => item.visit != null)}
                visitors={clusterVisitors}
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

      {placingPin ? (
        <View style={styles.pinOverlay} pointerEvents="none">
          <View style={styles.pinBalloon}>
            <View style={styles.pinHead}>
              <MapPinPlusIcon size={20} color={Colors.amber} />
            </View>
            <View style={styles.pinStem} />
          </View>
          <View style={styles.pinDot} />
        </View>
      ) : null}

      <View
        style={[styles.topStack, { paddingTop: insets.top }]}
        pointerEvents="box-none"
      >
        {placingPin ? (
          <View style={styles.header}>
            <Pressable
              onPress={cancelPinPlacement}
              style={({ pressed }) => [styles.mapGlyphButton, pressed && styles.pressedSoft]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t.a11y.mapPinCancel}
            >
              <XIcon size={19} color={Colors.foamMuted} />
            </Pressable>
            <View style={styles.pinHintWrap} pointerEvents="none">
              <View style={styles.pinHintPill}>
                <Text style={styles.pinHintText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {t.map.pinHint}
                </Text>
              </View>
            </View>
            <View style={styles.headerBalanceSpacer} />
          </View>
        ) : (
        <View style={styles.header}>
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
        )}
        {!placingPin ? (
          <View style={styles.mapStatusRow} pointerEvents="box-none">
            <View style={styles.nudgeWrap}>
              <NudgeSlot nudge={nudge} />
            </View>
            <Pressable
              onPress={locate}
              style={({ pressed }) => [styles.mapGlyphButton, pressed && styles.pressedSoft]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t.a11y.mapLocate}
            >
              <LocateFixedIcon size={19} color={Colors.amber} />
            </Pressable>
          </View>
        ) : null}
      </View>

      <View
        style={[
          styles.bottomStack,
          { paddingBottom: Math.max(insets.bottom, Spacing.sm) },
        ]}
        pointerEvents="box-none"
      >
        {placingPin ? (
          <GlowButton
            label={t.map.pinConfirm}
            onPress={() => void confirmPinPlacement()}
            variant="primary"
            glow="soft"
            height={62}
            accessibilityLabel={t.map.pinConfirm}
          />
        ) : (
        <>
        <PlaceCard
          title={cardState.title}
          meta={cardState.meta}
          metaTone={cardState.metaTone}
          fact={cardState.fact}
          people={'people' in cardState ? cardState.people : null}
          rating={'rating' in cardState ? cardState.rating : null}
          titlePress={
            cardState.kind === 'pub' && selectedPub
              ? {
                  onPress: () =>
                    void openPubInMaps(selectedDetailPub ?? selectedPub.pub),
                  accessibilityLabel: t.a11y.pubPillRevealed(
                    selectedPub.pub.name,
                  ),
                }
              : undefined
          }
          door={
            cardState.kind === 'pub'
              ? {
                  label: t.compass.mapPubLink,
                  onPress: () => {
                    trackUiInteraction('map_pub_detail_open');
                    setDetailOpen(true);
                  },
                  accessibilityLabel: t.compass.mapPubLink,
                }
              : cardState.kind === 'idle'
                ? {
                    label: t.map.listLink,
                    onPress: () => {
                      trackUiInteraction('map_list_open');
                      setListOpen(true);
                    },
                    accessibilityLabel: t.a11y.mapList,
                  }
                : undefined
          }
          layers={
            <LayerSwitch
              layer={layer}
              liveCount={visibleLivePubs.length}
              onSelect={selectLayer}
            />
          }
        />
        {/* Only a selection earns a button. */}
        {cardState.kind !== 'idle' ? (
          <GlowButton
            label={primaryAction.label}
            subLabel={primaryAction.subLabel}
            onPress={primaryAction.onPress}
            variant="primary"
            glow="soft"
            height={62}
            accessibilityLabel={primaryAction.accessibilityLabel}
          />
        ) : null}
        </>
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
            >
              <View style={styles.listGrabber} />
              <View style={styles.listHeader}>
                <Text
                  style={styles.listTitle}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.heading}
                >
                  {layer === 'friends' ? t.map.layerFriends : t.map.listTitle}
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
                  data={visiblePoints}
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
                        <Text
                          style={styles.listRowTitle}
                          numberOfLines={1}
                          maxFontSizeMultiplier={FontScaleCap.body}
                        >
                          {item.pub.name}
                        </Text>
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
                      {t.map.emptyList}
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
  mapStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Spacing.sm,
    paddingRight: 12,
  },
  headerBalanceSpacer: {
    width: 40,
    height: 40,
  },
  // Pin-placement mode: the pin is a fixed overlay whose stem bottom touches
  // the exact viewport center — the user aims by panning the map underneath.
  pinOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinBalloon: {
    alignItems: 'center',
    // Head (40) + stem (12) column, shifted up so the stem tip anchors at the
    // overlay center where pinDot marks the exact spot.
    transform: [{ translateY: -26 }],
  },
  pinHead: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinStem: {
    width: 2,
    height: 12,
    backgroundColor: Colors.stout2,
  },
  pinDot: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 6,
    height: 6,
    marginTop: -3,
    marginLeft: -3,
    borderRadius: 3,
    backgroundColor: Colors.amber,
  },
  pinHintWrap: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: Spacing.sm,
  },
  pinHintPill: {
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  pinHintText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.foam,
  },
  // The only place in the app where the overflow glyph needs a surface under
  // it: everywhere else it sits on stout, here it floats over a light map and
  // a bare muted glyph simply disappears into the streets. Same dark pill as
  // the Kompas/Mapa switch beside it, so the header reads as one row.
  // Round glyph target that has to stay legible over the map, so unlike the
  // header buttons on the tácek screens it carries its own surface.
  mapGlyphButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.stout, 0.94),
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.16),
    marginRight: Spacing.sm,
    ...softDrop(),
  },
  moreButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.stout, 0.86),
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.12),
  },
  nudgeWrap: {
    flex: 1,
    paddingHorizontal: 24,
  },

  pinHit: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  // Symmetric so the pin stays on the coordinate; the badge needs the right half.
  pinHitWide: { width: 80 },
  pinVisitorsBadge: { top: 5, left: 47 },
  pinVisitorsBadgeSelected: { top: 2, left: 50 },
  clusterHitWithBadge: { paddingTop: 10, paddingHorizontal: 26 },
  clusterVisitorsBadge: { top: 0, right: 0 },
  visitorsBadge: {
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
  visitorsBadgeText: {
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
    paddingHorizontal: 24,
    gap: 12,
  },
  // Same surface as every hero card, only shorter and floating over the map.
  // `minHeight`, not `height`: with the biggest system font the rows grow instead
  // of getting shaved off, and the stack is anchored to the bottom anyway.
  placeCard: {
    ...CardSurface.card,
    paddingTop: 16,
    paddingBottom: 10,
  },
  placeInfoRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  placeFactRow: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  placeTitleRow: {
    flexShrink: 1,
    minWidth: 0,
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  placeTitle: {
    flexShrink: 1,
    minWidth: 0,
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
    includeFontPadding: false,
  },
  placeMetaRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
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
  placeLayers: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  // Shorter than HitArea.min so the quiet line stays a line — the 12 pt hitSlop
  // on the Pressable puts the real target back over the minimum.
  placeDoor: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  placeDoorLabel: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.amber,
    includeFontPadding: false,
  },

  // — Layer switch (§2.2: neutral track, never a second amber surface) —
  layerTrack: {
    height: 38,
    padding: 3,
    borderRadius: Radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.04),
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.08),
  },
  layerSegment: {
    flex: 1,
    minWidth: 0,
    height: 30,
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  layerSegmentActive: {
    backgroundColor: withAlpha(Colors.foam, 0.1),
  },
  layerLabel: {
    flexShrink: 1,
    fontFamily: Fonts.display.bold,
    fontSize: 13,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  layerLabelActive: {
    color: Colors.foam,
  },
  layerBadge: {
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
