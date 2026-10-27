/**
 * Stránka hospody — one page per pub, opened from every place that shows a pub
 * name (compass, map, list, search, board, tours).
 *
 * It only shows what the app already knows: today's hours, a small map, the
 * public rating, last week's beers, what they pour, events for the next two
 * weeks, the week's opening hours, confirmed amenities and the user's own
 * visits. Community mapping keeps its existing sheet behind one row, so voting,
 * XP and the contribute editor work exactly as before.
 *
 * Layout follows the approved flat style (DESIGN.md "Stránka hospody"): rows on
 * the canvas, dark bands between sections, one amber action in a fixed bar.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedRef,
  useAnimatedStyle,
  useScrollViewOffset,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import {
  useFocusEffect,
  useNavigation,
  useRouter,
  type Href,
} from 'expo-router';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MapPubSheet } from '@/components/amenities/MapPubSheet';
import { pubInfoFromPub, usePubInfoFacts } from '@/components/amenities/pubInfoContext';
import { submitPubRename } from '@/components/amenities/pubRename';
import { RenamePubModal } from '@/components/compass/RenamePubModal';
import { ReportPubModal } from '@/components/compass/ReportPubModal';
import { useShowAppDialog } from '@/components/shared/AppDialog';
import { EdgeFade } from '@/components/shared/EdgeFade';
import { GlassSurface } from '@/components/shared/Glass';
import { Band, PAGE_PAD, RoundButton, SectionTitle } from '@/components/shared/FlatPage';
import {
  BeerIcon,
  ClockIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CompassIcon,
  EllipsisIcon,
  HeartFilledIcon,
  HeartIcon,
  FlagIcon,
  FootprintsIcon,
  MapIcon,
  MapPinIcon,
  PencilIcon,
  PlusIcon,
  StarIcon,
} from '@/components/shared/IconGlyph';
import { MoreSheet, type MoreRow } from '@/components/shared/MoreSheet';
import { checkLocationPermission } from '@/compass/permissions';
import { haversineMeters } from '@/compass/distance';
import { getAmenityDef } from '@/data/amenities';
import {
  computeOpenState,
  isSameBeerIdentity,
  parseOsmOpeningHoursToWeeklyHours,
  type CommunityBeer,
  type WeeklyHours,
} from '@/data/communityHours';
import { geohash8 } from '@/data/geohash';
import { fetchPubHours } from '@/data/hoursClient';
import {
  fetchPubAmenities,
  type WireAmenityAggregate,
  type WireAmenityCompleteness,
} from '@/data/pubAmenitiesClient';
import { readPubAmenitiesSnapshot, writePubAmenitiesSnapshot } from '@/data/pubAmenitiesSnapshot';
import { buildAmenityRows, selectPubInfoCompleteness } from '@/data/pubAmenitiesView';
import { fetchPubBeersLastWeek } from '@/data/pubBeersClient';
import { fetchUpcomingPubEvents, type PubEvent } from '@/data/pubEventsClient';
import { pubIdentityKey } from '@/data/pubIdentity';
import { replacePubMenu } from '@/data/pubMenuWrite';
import { enqueuePubReport } from '@/data/pubReportQueue';
import type { PubReportReason } from '@/data/pubReportsClient';
import { EMPTY_PUB_SEARCH_FILTERS, type PubSearchFilters } from '@/data/pubSearchFilters';
import { getAllLoadedPubs, type Pub } from '@/data/pubs';
import { formatVolume, intlLocale, t } from '@/i18n';
import BeerMapScreen from '@/map/BeerMapScreen';
import { BeerFormModal, type BeerFormResult } from '@/counter/BeerFormModal';
import { MenuBeerActionsSheet, confirmRemoveFromMenu } from '@/counter/MenuBeerActionsSheet';
import { helpedCountFor, useBeerWatchStore } from '@/stores/beerWatchStore';
import { selectIsSignedIn, useAccountStore } from '@/stores/accountStore';
import {
  isBeerListOverrideCurrent,
  isBeerMenuTypeOverrideCurrent,
  useCommunityStore,
} from '@/stores/communityStore';
import { useFocusedPubStore } from '@/stores/focusedPubStore';
import { selectPubVotes, usePubAmenitiesStore } from '@/stores/pubAmenitiesStore';
import { findFavoriteKey, usePubFavoritesStore } from '@/stores/pubFavoritesStore';
import { pubPageRef, usePubPageStore } from '@/stores/pubPageStore';
import { selectPubRating, usePubRatingsStore } from '@/stores/pubRatingsStore';
import { usePubStore } from '@/stores/pubStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { formatPrice } from '@/utils/currency';
import { dateTimeFormat } from '@/utils/intlFormat';
import { openPubInMaps } from '@/utils/maps';
import { priceAgeLabel } from '@/utils/priceAge';
import { pubHoursLine, type PubHoursTone } from '@/utils/pubHoursLine';

import { openPubPage, pubPageParams } from './openPubPage';
import { useDetailNav, useDetailParams } from '@/layout/detail';
import { useTone } from '@/layout/pane';
import { useBottomInset } from '@/navigation/TabScreen';
import {
  calendarDaysBetween,
  confirmedAmenityKeys,
  inPubTime,
  isEventOfPub,
  isSamePubRecord,
  sharesCell,
  withCatalogDetails,
  pubWallClock,
  currentTaps,
  dayKeyOf,
  eventDay,
  eventStartTime,
  groupWeeklyHours,
  roundedDistance,
  visibleEvents,
} from './pubPageModel';
import { usePubVisitSummary } from './usePubVisitSummary';

const BAR_BUTTON = 48;
const TAPS_COLLAPSED = 5;
const POSITION_MAX_AGE_MS = 5 * 60 * 1000;
// One modal leaves before the next arrives (DESIGN.md §7.4).
const SHEET_DISMISS_MS = 260;
const NAV_HEIGHT = 52;
// The page scrolls under the header and the bar; this much of it fades out at their edges.
const EDGE_FADE = 28;
// The small title takes over the moment the big name has faded, so a short page that
// scrolls only a little never shows both or neither; the status line follows later.
const TITLE_AFTER_SCROLL = 26;
const STATUS_GONE_AT = 56;
const NOW_TICK_MS = 60 * 1000;
const HOURS_RETRY_MS = 4000;
const HOURS_RETRY_LIMIT = 4;
// Same quiet style as the tour previews: no landmarks or labels next to the
// pin, so nobody reads a monument's name as the pub's.
const PREVIEW_MAP_STYLE = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels', stylers: [{ visibility: 'off' }] },
];

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** A link without coordinates must not open a pub at 0,0. */
function coordinate(value: string, limit: number): number {
  const parsed = value.trim() ? Number(value) : NaN;
  return Math.abs(parsed) <= limit ? parsed : NaN;
}

function toneColor(tone: PubHoursTone): string {
  if (tone === 'open') return Colors.open;
  if (tone === 'closed') return Colors.closed;
  return Colors.mutedText;
}

function formatRatingValue(value: number): string {
  return value.toLocaleString(intlLocale, {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 1,
  });
}

function formatDistance(meters: number): string {
  const { unit, value } = roundedDistance(meters);
  const text = value.toLocaleString(intlLocale);
  return unit === 'm' ? t.pubSearch.distanceMeters(text) : t.pubSearch.distanceKm(text);
}

function eventWhenLabel(event: PubEvent, now: Date): string {
  const day = eventDay(event, now);
  if (day.kind === 'running') return t.pubDetail.eventRunning;
  const time = eventStartTime(event);
  if (day.kind === 'today') return `${t.pubDetail.eventTodayShort} ${time}`;
  if (day.kind === 'tomorrow') return `${t.pubDetail.eventTomorrow} ${time}`;
  const date = dateTimeFormat({ day: 'numeric', month: 'numeric' }).format(day.date);
  return `${t.contribute.daysShort[day.day]} ${date} ${time}`;
}

/** The last position the OS already has; opening a pub never asks for a new fix. */
function useRecentPosition(): { lat: number; lng: number } | null {
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if ((await checkLocationPermission()) !== 'granted') return;
        const fix = await Location.getLastKnownPositionAsync({
          maxAge: POSITION_MAX_AGE_MS,
          requiredAccuracy: 100,
        });
        if (active && fix) setPosition({ lat: fix.coords.latitude, lng: fix.coords.longitude });
      } catch {
        // The page reads fine without a distance.
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  return position;
}

/**
 * The page's clock. It ticks every minute and on return to the app, so an
 * event that ends, starts or crosses midnight while the page stays open moves
 * to its new state instead of keeping the time the page was opened.
 */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), NOW_TICK_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(new Date());
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);
  return now;
}

/** Resolve the pub from the opener's hand-off, the loaded catalog, or the params. */
function useInitialPub(
  key: string,
  ref: string,
  name: string,
  lat: number,
  lng: number,
): Pub | null {
  const remembered = usePubPageStore((s) => (ref ? s.pubs[ref] : undefined));
  return useMemo(() => {
    const loaded = getAllLoadedPubs().find(
      (pub) =>
        (remembered?.id && pub.id === remembered.id) ||
        // Same cell and name, unless both carry different provider ids.
        (geohash8(pub.lat, pub.lng) === key &&
          isSamePubRecord(
            { name: pub.name, externalId: pub.id },
            { id: remembered?.id ?? '', name: remembered?.name ?? name },
          )),
    );
    if (remembered) return withCatalogDetails(remembered, loaded);
    if (!key || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return loaded ?? { id: '', name, lat, lng };
  }, [remembered, key, name, lat, lng]);
}

export default function PubPageScreen() {
  const showAppDialog = useShowAppDialog();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  // Set when the page sits in a tab's right half instead of on the stack.
  const pane = useDetailNav();
  const quiet = useTone() === 'quiet';
  // Clears the tab bar when the page sits in a tab's right half; the home indicator otherwise.
  const barBottom = useBottomInset(Spacing.sm);
  const params = useDetailParams<{
    key?: string;
    ref?: string;
    name?: string;
    lat?: string;
    lng?: string;
  }>();
  const key = firstParam(params.key);
  const ref = firstParam(params.ref);
  const initialPub = useInitialPub(
    key,
    ref,
    firstParam(params.name),
    coordinate(firstParam(params.lat), 90),
    coordinate(firstParam(params.lng), 180),
  );

  const [pub, setPub] = useState<Pub | null>(initialPub);
  const [showTitle, setShowTitle] = useState(false);
  const [tapsExpanded, setTapsExpanded] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // — One "Na čepu" beer: its options sheet and the price form —
  const [beerActionsOpen, setBeerActionsOpen] = useState(false);
  const [actionBeer, setActionBeer] = useState<CommunityBeer | null>(null);
  const [priceFormOpen, setPriceFormOpen] = useState(false);
  const [priceFormNonce, setPriceFormNonce] = useState(0);
  /** The menu a fix or a delete rewrites for everyone: this pub's menu as the
   *  server answered it on this page, kept in step with the user's own writes.
   *  Without an answer there is none, so nothing is written for everyone from
   *  the opener's older copy or another pub's local list. */
  const [tapsBase, setTapsBase] = useState<{
    pubId: string;
    beers: CommunityBeer[];
    historicalBeers: CommunityBeer[];
    /** Epoch ms of the user's last write here; an older answer lags behind it. */
    writtenAt: number | null;
  } | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapFilters, setMapFilters] = useState<PubSearchFilters>(EMPTY_PUB_SEARCH_FILTERS);
  const [events, setEvents] = useState<PubEvent[]>([]);
  const [beersLastWeek, setBeersLastWeek] = useState<number | null>(null);
  const [aggregates, setAggregates] = useState<WireAmenityAggregate[] | undefined>(undefined);
  const [serverCompleteness, setServerCompleteness] = useState<WireAmenityCompleteness | null>(
    null,
  );

  const showToast = useToastStore((s) => s.show);
  // A catalogue fix can move a saved pub to the next cell; its provider id still
  // finds the heart, so it shows as saved and taps remove that same entry.
  const favoriteKey = usePubFavoritesStore((state) =>
    pub ? findFavoriteKey(state.favorites, geohash8(pub.lat, pub.lng), pub) : undefined,
  );
  const isFavorite = Boolean(favoriteKey);
  const priceCurrency = useSettingsStore((s) => s.priceCurrency);
  const isSignedIn = useAccountStore(selectIsSignedIn);
  const position = useRecentPosition();
  const visit = usePubVisitSummary(pub, key);
  const rating = usePubRatingsStore(selectPubRating(key));
  const identityKey = useMemo(() => pubIdentityKey(key, pub?.name ?? ''), [key, pub?.name]);
  const myVotes = usePubAmenitiesStore(selectPubVotes(identityKey));
  const info = useMemo(() => (pub ? pubInfoFromPub(pub) : undefined), [pub]);
  const facts = usePubInfoFacts(info);
  const override = useCommunityStore((s) => (key ? s.overrides[key] : undefined));

  // Editing an own pub writes the catalog and returns here: pick up the new
  // name or position, and reopen under the new cell if the pin moved.
  const ownClientId = pub?.userAddedClientId;
  useEffect(() => {
    if (!ownClientId) return;
    return usePubStore.subscribe((state, previous) => {
      if (state.catalogRevision === previous.catalogRevision) return;
      const fresh = getAllLoadedPubs().find((item) => item.userAddedClientId === ownClientId);
      if (!fresh) return;
      if (geohash8(fresh.lat, fresh.lng) !== key) {
        if (pane) pane.replace({ kind: 'pub', params: pubPageParams(fresh) });
        else openPubPage(router, fresh, { replace: true });
        return;
      }
      setPub((current) =>
        current
          ? {
              ...current,
              id: fresh.id,
              name: fresh.name,
              lat: fresh.lat,
              lng: fresh.lng,
              address: fresh.address,
              city: fresh.city,
            }
          : current,
      );
    });
  }, [key, ownClientId, pane, router]);

  // The map covers the page; an edge swipe or Android back must close it, not
  // pop the page.
  useEffect(() => {
    // In a right half the navigation belongs to the tab, not to this page.
    if (pane) return;
    navigation.setOptions({ gestureEnabled: !mapOpen });
  }, [mapOpen, navigation, pane]);
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!mapOpen) return false;
        setMapOpen(false);
        return true;
      });
      return () => sub.remove();
    }, [mapOpen]),
  );

  // Fill in hours, taps and the rating. Runs even when the opener had hours:
  // fixing or deleting a beer needs the server's current menu.
  const pubId = pub?.id ?? '';
  useEffect(() => {
    if (!pub) return;
    const controller = new AbortController();
    const opened = pub;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    // A cache miss answers "pending" while the server fills the pub in, so ask
    // again a few times instead of leaving hours and taps empty for good.
    const load = () => {
      attempts += 1;
      void fetchPubHours([opened], controller.signal).then(apply);
    };
    const apply = (response: Awaited<ReturnType<typeof fetchPubHours>>) => {
      if (controller.signal.aborted) return;
      const details = response.get(opened.id);
      if (!details) return;
      const answeredAt = details.beersUpdatedAt ? Date.parse(details.beersUpdatedAt) : 0;
      setTapsBase((prev) =>
        prev?.pubId === opened.id && prev.writtenAt !== null && !(answeredAt > prev.writtenAt)
          ? prev
          : {
              pubId: opened.id,
              beers: details.beers,
              historicalBeers: details.historicalBeers,
              writtenAt: null,
            },
      );
      if (details.status === 'pending' && attempts < HOURS_RETRY_LIMIT) {
        retryTimer = setTimeout(load, HOURS_RETRY_MS);
      }
      setPub((current) =>
        current
          ? {
              ...current,
              openingHours: details.openingHours,
              isOpenNow: details.isOpenNow,
              nextChange: details.nextChange,
              hoursStatus: details.status,
              communityHours: details.communityHours ?? current.communityHours,
              beers: details.beers,
              historicalBeers: details.historicalBeers,
              beerMenuRotates: details.beerMenuRotates,
              beersUpdatedAt: details.beersUpdatedAt,
              hoursUpdatedAt: details.hoursUpdatedAt,
              rating: details.rating ?? current.rating,
              ratingCount: details.ratingCount ?? current.ratingCount,
              ratingLabel: details.ratingLabel ?? current.ratingLabel,
            }
          : current,
      );
    };
    load();
    return () => {
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
    // Refresh once per opened pub, not after filling it in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubId, key]);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    void fetchUpcomingPubEvents(key, controller.signal).then((result) => {
      if (!controller.signal.aborted && result) setEvents(result);
    });
    void fetchPubBeersLastWeek(controller.signal).then((beers) => {
      if (!controller.signal.aborted) setBeersLastWeek(beers?.get(key) ?? null);
    });
    return () => controller.abort();
  }, [key]);

  const pubName = pub?.name ?? '';
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const controller = new AbortController();
    void readPubAmenitiesSnapshot(identityKey).then((cached) => {
      if (cancelled || !cached) return;
      setAggregates(cached.amenities);
      setServerCompleteness(cached.completeness);
    });
    void fetchPubAmenities([key], controller.signal, pubName).then((pubs) => {
      if (cancelled || !pubs) return;
      const found = pubs.find((p) => p.cache_key === key) ?? pubs[0];
      if (!found) {
        setAggregates([]);
        return;
      }
      setAggregates(found.amenities);
      setServerCompleteness(found.completeness ?? null);
      void writePubAmenitiesSnapshot(identityKey, {
        amenities: found.amenities,
        completeness: found.completeness,
        mapperCount: found.mapper_count,
      });
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // The mapping sheet refreshes the aggregate itself; reload on reopen only.
  }, [key, identityKey, pubName, mappingOpen]);

  const now = useNow();
  // Filter on real instants, then show in Prague time.
  const shownEvents = useMemo(
    () =>
      visibleEvents(pub ? events.filter((event) => isEventOfPub(event, pub)) : events, now).map(
        inPubTime,
      ),
    [events, now, pub],
  );
  const cellIsShared = useMemo(
    () => Boolean(pub) && sharesCell(getAllLoadedPubs(), key, pub as Pub, geohash8),
    [pub, key],
  );

  const weeklyHours = useMemo<WeeklyHours | null>(() => {
    if (!pub) return null;
    return (
      override?.hours ??
      pub.communityHours ??
      parseOsmOpeningHoursToWeeklyHours(pub.openingHours) ??
      null
    );
  }, [override?.hours, pub]);
  const pubNow = useMemo(() => pubWallClock(now), [now]);
  const hoursRows = useMemo(
    () => (weeklyHours ? groupWeeklyHours(weeklyHours, dayKeyOf(pubNow)) : []),
    [weeklyHours, pubNow],
  );

  const taps = useMemo(() => {
    if (!pub) return [];
    return currentTaps(
      override,
      isBeerListOverrideCurrent(override, pub.beersUpdatedAt),
      pub.beers,
    );
  }, [override, pub]);
  const rotates = pub
    ? ((isBeerMenuTypeOverrideCurrent(override, pub.beersUpdatedAt)
        ? override?.beerMenuRotates
        : undefined) ??
      pub.beerMenuRotates ??
      false)
    : false;

  const editableTaps = pub && tapsBase?.pubId === pub.id ? tapsBase.beers : null;
  const historicalTaps = editableTaps && tapsBase ? tapsBase.historicalBeers : null;
  const tapsPubId = pub?.id ?? null;
  /** A dialog or the form confirms later: write over the menu as it is then. */
  const liveTapsRef = useRef({ key, pubId: tapsPubId, menu: editableTaps, historical: historicalTaps });
  useEffect(() => {
    liveTapsRef.current = { key, pubId: tapsPubId, menu: editableTaps, historical: historicalTaps };
  }, [editableTaps, historicalTaps, key, tapsPubId]);
  // Only a beer of the menu a write would start from can be changed.
  const actionBeerEditable =
    !!actionBeer && !!editableTaps?.some((b) => isSameBeerIdentity(b, actionBeer));
  const beerHelped = useBeerWatchStore((s) => s.helped);
  // After a login the launch pull belongs to the previous account.
  useEffect(() => {
    if (useAccountStore.getState().session && !useBeerWatchStore.getState().loaded) {
      void useBeerWatchStore.getState().refresh();
    }
  }, []);
  /** The pub a beer's options were opened for: a write never lands elsewhere. */
  const tapsTargetRef = useRef<{ key: string | undefined; pubId: string | null } | null>(null);

  const completenessPct = useMemo(() => {
    const rows = buildAmenityRows({ aggregates, myVotes });
    const snap = serverCompleteness
      ? {
          mappedCount: serverCompleteness.mapped_count,
          totalKinds: serverCompleteness.total_kinds,
          pct: serverCompleteness.pct,
        }
      : null;
    const view = facts ? selectPubInfoCompleteness(rows, facts, snap) : null;
    return Math.round((view?.pct ?? 0) * 100);
  }, [aggregates, myVotes, serverCompleteness, facts]);

  const amenityLabels = useMemo(
    () =>
      confirmedAmenityKeys(aggregates)
        .map((amenityKey) => getAmenityDef(amenityKey)?.label)
        .filter((label): label is string => Boolean(label)),
    [aggregates],
  );

  // ── Actions ──
  const goBack = useCallback(() => {
    if (pane) pane.back();
    else if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [pane, router]);

  const showCompass = useCallback(() => {
    if (pane) {
      pane.showCompass();
      return;
    }
    router.dismissTo({
      pathname: '/',
      params: { view: 'compass' },
    } as unknown as Href);
  }, [pane, router]);

  const navigateToPub = useCallback(() => {
    if (!pub) return;
    void openPubInMaps(pub).catch(() => showToast(t.pubSearch.navigationFailed));
  }, [pub, showToast]);

  const aimCompass = useCallback(() => {
    if (!pub) return;
    useFocusedPubStore.getState().setFocusedPub({
      lat: pub.lat,
      lng: pub.lng,
      name: pub.name,
      cacheKey: key,
    });
    showCompass();
  }, [key, pub, showCompass]);

  const suggestEvent = useCallback(() => {
    if (!info) return;
    if (!isSignedIn) {
      router.push('/auth' as Href);
      return;
    }
    router.push({
      pathname: '/suggest-pub-event',
      params: {
        pubKey: key,
        name: info.name,
        lat: String(info.lat),
        lng: String(info.lng),
        city: info.city ?? '',
        externalId: info.externalId ?? '',
      },
    } as unknown as Href);
  }, [info, isSignedIn, key, router]);

  const afterSheet = useCallback((action: () => void) => {
    setTimeout(action, SHEET_DISMISS_MS);
  }, []);

  /** The user's own write is the newest menu this page knows. */
  const recordTapsWrite = useCallback(
    (pubId: string, beers: CommunityBeer[], historicalBeers: CommunityBeer[]) => {
      setTapsBase((prev) =>
        prev?.pubId === pubId ? { pubId, beers, historicalBeers, writtenAt: Date.now() } : prev,
      );
    },
    [],
  );

  const openBeerActions = useCallback(
    (beer: CommunityBeer) => {
      tapsTargetRef.current = { key, pubId: tapsPubId };
      setActionBeer(beer);
      setBeerActionsOpen(true);
    },
    [key, tapsPubId],
  );

  const editBeerPrice = useCallback(
    (beer: CommunityBeer) => {
      setBeerActionsOpen(false);
      afterSheet(() => {
        setActionBeer(beer);
        setPriceFormNonce((n) => n + 1);
        setPriceFormOpen(true);
      });
    },
    [afterSheet],
  );

  /** Fix one row in place (a volume change must not leave the old row behind)
   *  and save the whole menu for everyone, as the contribute editor does. */
  const saveBeerPrice = useCallback(
    (result: BeerFormResult) => {
      setPriceFormOpen(false);
      const edited = actionBeer;
      const live = liveTapsRef.current;
      const target = tapsTargetRef.current;
      if (!pub || !key || !edited || !live.menu) return;
      if (target?.key !== live.key || target.pubId !== live.pubId) return;
      if (!live.menu.some((b) => isSameBeerIdentity(b, edited))) return;
      if (typeof result.priceCzk !== 'number') return;
      const beer: CommunityBeer = { name: edited.name };
      if (typeof result.priceCzk === 'number') beer.priceCzk = result.priceCzk;
      if (typeof result.volumeMl === 'number') beer.volumeMl = result.volumeMl;
      const next = live.menu
        .map((b) => (isSameBeerIdentity(b, edited) ? beer : b))
        .filter((b) => b === beer || !isSameBeerIdentity(b, beer));
      const nextHistory = replacePubMenu(key, pub, live.menu, next, live.historical ?? [], {
        action: 'update',
        name: edited.name,
        volumeMl: edited.volumeMl,
        priceCzk: result.priceCzk,
        newVolumeMl: result.volumeMl,
      });
      recordTapsWrite(pub.id, next, nextHistory);
    },
    [actionBeer, key, pub, recordTapsWrite],
  );

  const removeBeer = useCallback(
    (removed: CommunityBeer) => {
      setBeerActionsOpen(false);
      const target = tapsTargetRef.current;
      afterSheet(() =>
        confirmRemoveFromMenu(removed, () => {
          const live = liveTapsRef.current;
          if (!pub || !key || !live.menu) return;
          if (target?.key !== live.key || target.pubId !== live.pubId) return;
          if (!live.menu.some((b) => isSameBeerIdentity(b, removed))) return;
          const next = live.menu.filter((b) => !isSameBeerIdentity(b, removed));
          const nextHistory = replacePubMenu(key, pub, live.menu, next, live.historical ?? [], {
            action: 'remove',
            name: removed.name,
            volumeMl: removed.volumeMl,
          });
          recordTapsWrite(pub.id, next, nextHistory);
          showToast(t.counter.removedFromMenuToast);
        }, undefined, showAppDialog),
      );
    },
    [afterSheet, key, pub, recordTapsWrite, showAppDialog, showToast],
  );

  const startRename = useCallback(() => {
    if (!pub) return;
    setRenameDraft(pub.name);
    setRenameOpen(true);
  }, [pub]);

  const submitRename = useCallback(() => {
    if (!info || !pub || renameSubmitting) return;
    const trimmed = renameDraft.trim().slice(0, 200);
    if (!trimmed || trimmed === pub.name.trim()) return;
    setRenameSubmitting(true);
    const previousName = pub.name;
    setPub({ ...pub, name: trimmed });
    if (ref) usePubPageStore.getState().rename(ref, pub, trimmed);
    submitPubRename(info, previousName, trimmed)
      .then((synced) => {
        setRenameOpen(false);
        showToast(synced ? t.compass.renameSavedToast : t.compass.renameQueuedToast);
      })
      .finally(() => setRenameSubmitting(false));
  }, [info, pub, ref, renameDraft, renameSubmitting, showToast]);

  const toggleFavorite = useCallback(() => {
    if (!pub) return;
    const store = usePubFavoritesStore.getState();
    if (favoriteKey) {
      store.toggleFavorite(favoriteKey, pub);
      showToast(t.pubDetail.favoriteRemoved);
      return;
    }
    // One heart per cell on the server: saving here replaces a neighbour's.
    // The key is the cell of the saved point, which the catalogue may have
    // moved away from the cell this page was opened for.
    store.saveFavorite(geohash8(pub.lat, pub.lng), {
      name: pub.name,
      lat: pub.lat,
      lng: pub.lng,
      city: pub.city,
      externalId: pub.id || undefined,
    });
    showToast(t.pubDetail.favoriteSaved);
  }, [favoriteKey, pub, showToast]);

  const submitReport = useCallback(
    (reason: PubReportReason) => {
      if (!pub) return;
      // A pub without a provider id is hidden by its cell alone; an empty id
      // would match other id-less results.
      if (pub.id) usePubStore.getState().addReportedPub(pub.id, key);
      else if (!usePubStore.getState().reportedCacheKeys.includes(key)) {
        usePubStore.setState((state) => ({ reportedCacheKeys: [...state.reportedCacheKeys, key] }));
      }
      void enqueuePubReport(pub, reason).then((synced) =>
        useToastStore.getState().show(synced ? t.pubDetail.reportSaved : t.pubDetail.reportQueued),
      );
      goBack();
    },
    [goBack, key, pub],
  );

  // A report can hide the pub for everyone, so it asks once more.
  const reportReason = useCallback(
    (reason: PubReportReason) => {
      if (!pub) return;
      setReportOpen(false);
      afterSheet(() =>
        showAppDialog({
          title: t.pubDetail.reportConfirmTitle(pub.name),
          message: t.pubDetail.reportConfirmBody,
          buttons: [
            { text: t.pubDetail.reportConfirmCancel, style: 'cancel' },
            {
              text: t.pubDetail.reportConfirmAction,
              style: 'destructive',
              onPress: () => submitReport(reason),
            },
          ],
        }),
      );
    },
    [afterSheet, pub, showAppDialog, submitReport],
  );

  const addPubNear = useCallback(() => {
    if (!pub) return;
    router.push({
      pathname: '/add-pub',
      params: { lat: String(pub.lat), lng: String(pub.lng) },
    } as unknown as Href);
  }, [pub, router]);

  const editOwnedPub = useCallback(() => {
    if (!pub?.userAddedClientId) return;
    router.push({
      pathname: '/add-pub',
      params: {
        clientId: pub.userAddedClientId,
        name: pub.name,
        city: pub.city ?? '',
        address: pub.address ?? '',
        lat: String(pub.lat),
        lng: String(pub.lng),
      },
    } as unknown as Href);
  }, [pub, router]);

  const moreRows = useMemo<MoreRow[]>(() => {
    const rows: MoreRow[] = [
      {
        key: 'rename',
        label: t.mapPub.renameRowLabel,
        icon: PencilIcon,
        onPress: () => {
          setMoreOpen(false);
          afterSheet(startRename);
        },
      },
    ];
    if (pub?.userAddedClientId) {
      rows.push({
        key: 'edit-owned',
        label: t.addPub.edit,
        icon: MapPinIcon,
        onPress: () => {
          setMoreOpen(false);
          afterSheet(editOwnedPub);
        },
      });
    }
    rows.push({
      key: 'report',
      label: t.mapPub.reportRowLabel,
      icon: FlagIcon,
      onPress: () => {
        setMoreOpen(false);
        afterSheet(() => setReportOpen(true));
      },
    });
    return rows;
  }, [afterSheet, editOwnedPub, pub?.userAddedClientId, startRename]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = event.nativeEvent.contentOffset.y >= TITLE_AFTER_SCROLL;
    setShowTitle((current) => (current === next ? current : next));
  }, []);
  // A short page must still scroll far enough to hand the name over to the header.
  const [scrollHeight, setScrollHeight] = useState(0);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useScrollViewOffset(scrollRef);
  const nameFade = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, TITLE_AFTER_SCROLL], [1, 0], Extrapolation.CLAMP),
  }));
  const statusFade = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.value,
      [TITLE_AFTER_SCROLL, STATUS_GONE_AT],
      [1, 0],
      Extrapolation.CLAMP,
    ),
  }));

  const handleMapPub = useCallback(
    (target: Pub) => {
      // The same cell can hold a neighbour; only this very pub just closes the map.
      const samePub = pubPageRef(target) === ref || (Boolean(pub?.id) && target.id === pub?.id);
      if (samePub) setMapOpen(false);
      else if (pane) pane.push({ kind: 'pub', params: pubPageParams(target) });
      else openPubPage(router, target);
    },
    [pane, pub?.id, ref, router],
  );

  const barHeight = Spacing.md + BAR_BUTTON + barBottom;
  // In the right half of a wide window the left inset is the fold margin.
  const navInsets = { paddingLeft: Math.max(16, insets.left), paddingRight: Math.max(16, insets.right) };
  // The big map covers the page; screen readers must not reach what is under it.
  const hiddenUnderMap = {
    accessibilityElementsHidden: mapOpen,
    importantForAccessibility: mapOpen ? ('no-hide-descendants' as const) : ('auto' as const),
  };

  if (!pub) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={[styles.nav, navInsets]}>
          <RoundButton onPress={goBack} label={t.pubDetail.backA11y}>
            <ChevronLeftIcon size={24} color={Colors.foam} />
          </RoundButton>
        </View>
        <Text style={styles.failed} maxFontSizeMultiplier={FontScaleCap.body}>
          {t.pubDetail.stateFailed}
        </Text>
      </View>
    );
  }

  // Work the header out from the same week the table below shows, including a
  // fresh local edit, so the two never disagree and the header follows the
  // clock. Only without a readable week does the server's answer stand.
  const hours = pubHoursLine(
    weeklyHours ? { ...pub, ...computeOpenState(weeklyHours, pubNow) } : pub,
  );
  const distance = position ? formatDistance(haversineMeters(position, pub)) : null;
  const firstEvent = shownEvents[0];
  const hasRating = typeof pub.rating === 'number' && pub.rating > 0;
  const hasBeers = !cellIsShared && typeof beersLastWeek === 'number' && beersLastWeek > 0;
  const shownTaps = tapsExpanded ? taps : taps.slice(0, TAPS_COLLAPSED);
  const hiddenTaps = taps.length - shownTaps.length;
  // A local edit of the list is newer than the server's date: its age is the
  // edit's own, never the old menu's.
  const localTaps =
    Boolean(override?.beers) && isBeerListOverrideCurrent(override, pub.beersUpdatedAt);
  const localTapsAt = override?.beersOverrideUpdatedAt ?? override?.updatedAt;
  const tapsAge = localTaps
    ? localTapsAt
      ? priceAgeLabel(new Date(localTapsAt).toISOString())
      : null
    : pub.beersUpdatedAt
      ? priceAgeLabel(pub.beersUpdatedAt)
      : null;
  const verdictLabel =
    rating?.verdict === 'like'
      ? t.myBeers.verdictLike
      : rating?.verdict === 'dislike'
        ? t.myBeers.verdictDislike
        : null;

  return (
    <View style={styles.root}>
      <Animated.ScrollView
        ref={scrollRef}
        {...hiddenUnderMap}
        style={styles.scroll}
        onLayout={(event) => setScrollHeight(event.nativeEvent.layout.height)}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + NAV_HEIGHT + Spacing.xs,
            paddingBottom: barHeight + Spacing.xl,
            minHeight: scrollHeight + TITLE_AFTER_SCROLL + Spacing.sm,
          },
        ]}
        onScroll={handleScroll}
        scrollEventThrottle={32}
        showsVerticalScrollIndicator={false}
      >
        <Animated.Text
          style={[styles.name, nameFade]}
          accessibilityRole="header"
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {pub.name}
        </Animated.Text>
        <Animated.Text style={[styles.status, statusFade]} maxFontSizeMultiplier={FontScaleCap.body}>
          {hours.label ? <Text style={{ color: toneColor(hours.tone) }}>{hours.label}</Text> : null}
          {[distance, pub.city]
            .filter(Boolean)
            .map((part, index) => `${index === 0 && !hours.label ? '' : ' · '}${part}`)
            .join('')}
        </Animated.Text>

        <Pressable
          onPress={() => setMapOpen(true)}
          style={({ pressed }) => [styles.mapStrip, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t.pubDetail.mapA11y(pub.name)}
        >
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <MapView
              provider={PROVIDER_GOOGLE}
              style={StyleSheet.absoluteFill}
              initialRegion={{
                latitude: pub.lat,
                longitude: pub.lng,
                latitudeDelta: 0.004,
                longitudeDelta: 0.004,
              }}
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              toolbarEnabled={false}
              showsPointsOfInterests={false}
              showsCompass={false}
              // Android draws a lite-mode or JSON-styled map light whatever the color scheme.
              customMapStyle={Platform.OS === 'ios' ? PREVIEW_MAP_STYLE : undefined}
              userInterfaceStyle="dark"
              loadingBackgroundColor={Colors.stout2}
              loadingIndicatorColor={Colors.amber}
            />
          </View>
          <View style={styles.mapPin} pointerEvents="none">
            <BeerIcon size={17} color={Colors.stout} />
          </View>
          <View style={styles.mapLabel} pointerEvents="none">
            <MapIcon size={14} color={Colors.amber} />
            <Text style={styles.mapLabelText} maxFontSizeMultiplier={FontScaleCap.body}>
              {t.pubSearch.showMap}
            </Text>
          </View>
        </Pressable>

        {firstEvent || hasRating || hasBeers ? (
          <View style={styles.reasons}>
            {firstEvent ? (
              <ReasonRow
                first
                amber
                icon={<ClockIcon size={18} color={Colors.amber} />}
                title={t.pubDetail.eventLine(eventWhenLabel(firstEvent, pubNow), firstEvent.title)}
                subtitle={
                  shownEvents.length > 1
                    ? t.pubDetail.eventsMore(shownEvents.length - 1)
                    : firstEvent.details || null
                }
              />
            ) : null}
            {hasRating ? (
              <ReasonRow
                first={!firstEvent}
                icon={<StarIcon size={18} color={Colors.foamMuted} />}
                title={t.pubDetail.ratingLine(
                  formatRatingValue(pub.rating as number),
                  pub.ratingCount ?? null,
                )}
                subtitle={pub.ratingLabel ?? null}
              />
            ) : null}
            {hasBeers ? (
              <ReasonRow
                first={!firstEvent && !hasRating}
                icon={<BeerIcon size={18} color={Colors.foamMuted} />}
                title={t.pubDetail.beersLastWeek(beersLastWeek as number)}
              />
            ) : null}
          </View>
        ) : null}

        {taps.length > 0 || pub.price ? (
          <>
            <Band />
            <SectionTitle
              title={t.pubDetail.tapsTitle}
              aside={
                rotates
                  ? t.pubDetail.tapsRotating
                  : tapsAge
                    ? t.pubDetail.tapsVerified(tapsAge)
                    : null
              }
            />
            {shownTaps.map((beer, index) => {
              const helpedCount = helpedCountFor(beerHelped, key, beer.name);
              return (
                <Pressable
                  key={`${beer.name}-${index}`}
                  onPress={() => openBeerActions(beer)}
                  style={({ pressed }) => [
                    styles.row,
                    index === 0 && styles.rowFirst,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={[
                    beer.name,
                    typeof beer.volumeMl === 'number' ? formatVolume(beer.volumeMl) : null,
                    typeof beer.priceCzk === 'number' ? formatPrice(beer.priceCzk, priceCurrency) : null,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                  accessibilityHint={t.a11y.counterBeerOptions(beer.name)}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} maxFontSizeMultiplier={FontScaleCap.body}>
                      {beer.name}
                    </Text>
                    {typeof beer.volumeMl === 'number' ? (
                      <Text style={styles.rowSub} maxFontSizeMultiplier={FontScaleCap.body}>
                        {formatVolume(beer.volumeMl)}
                      </Text>
                    ) : null}
                    {helpedCount > 0 ? (
                      <Text
                        testID="menu-beer-helped"
                        style={styles.rowSub}
                        maxFontSizeMultiplier={FontScaleCap.body}
                      >
                        {t.beerWatch.helped(helpedCount)}
                      </Text>
                    ) : null}
                  </View>
                  {typeof beer.priceCzk === 'number' ? (
                    <Text style={styles.rowValue} maxFontSizeMultiplier={FontScaleCap.body}>
                      {formatPrice(beer.priceCzk, priceCurrency)}
                    </Text>
                  ) : null}
                  <EllipsisIcon size={20} color={Colors.mutedText} />
                </Pressable>
              );
            })}
            {hiddenTaps > 0 ? (
              <LinkRow
                muted
                label={t.pubDetail.tapsMore(hiddenTaps)}
                onPress={() => setTapsExpanded(true)}
                trailing={<ChevronRightIcon size={18} color={Colors.mutedText} />}
              />
            ) : null}
            {taps.length === 0 && pub.price ? (
              <View style={[styles.row, styles.rowFirst]}>
                <Text
                  style={[styles.rowTitle, styles.rowText]}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {t.pubDetail.beerFrom}
                </Text>
                <Text style={styles.rowValue} maxFontSizeMultiplier={FontScaleCap.body}>
                  {formatPrice(pub.price.czk, priceCurrency)}
                </Text>
              </View>
            ) : null}
          </>
        ) : null}

        <Band />
        <SectionTitle title={t.pubDetail.eventsHeading} />
        {shownEvents.map((event, index) => (
          <EventRow key={event.id} event={event} now={pubNow} first={index === 0} />
        ))}
        <LinkRow
          first={shownEvents.length === 0}
          label={isSignedIn ? t.pubDetail.eventSuggest : t.pubDetail.eventSuggestSignedOut}
          onPress={suggestEvent}
        />

        {hoursRows.length > 0 || pub.openingHours ? (
          <>
            <Band />
            <SectionTitle title={t.pubDetail.openingTitle} />
            {hoursRows.length > 0 ? (
              hoursRows.map((row) => (
                <View key={row.from} style={styles.hoursRow}>
                  <Text
                    style={[styles.hoursDay, row.today && styles.hoursToday]}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {row.from === row.to
                      ? t.contribute.daysShort[row.from]
                      : `${t.contribute.daysShort[row.from]}–${t.contribute.daysShort[row.to]}`}
                    {row.today ? (
                      <Text style={styles.hoursTodayMark}>{` · ${t.pubDetail.hoursToday}`}</Text>
                    ) : null}
                  </Text>
                  <Text
                    style={[styles.hoursValue, row.today && styles.hoursToday]}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {row.intervals.length > 0
                      ? row.intervals.join(', ')
                      : t.pubDetail.openingClosed}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.rawHours} maxFontSizeMultiplier={FontScaleCap.body}>
                {pub.openingHours}
              </Text>
            )}
          </>
        ) : null}

        <Band />
        <SectionTitle title={t.pubDetail.aboutTitle} />
        {amenityLabels.length > 0 ? (
          <ReasonRow
            first
            icon={<CheckIcon size={18} color={Colors.foamMuted} />}
            title={amenityLabels.slice(0, 3).join(' · ')}
            subtitle={
              amenityLabels.length > 3
                ? t.pubDetail.amenitiesMore(amenityLabels.length - 3)
                : t.pubDetail.amenitiesConfirmed
            }
          />
        ) : null}
        {visit ? (
          <ReasonRow
            first={amenityLabels.length === 0}
            icon={<FootprintsIcon size={18} color={Colors.foamMuted} />}
            title={t.map.visitedSummary(
              visit.visitCount,
              dateTimeFormat({ day: 'numeric', month: 'numeric' }).format(
                new Date(visit.lastVisitedAt),
              ),
            )}
            subtitle={
              verdictLabel ? t.pubDetail.privateVerdict(verdictLabel) : t.pubDetail.privateOnly
            }
          />
        ) : null}
        <Pressable
          onPress={() => setMappingOpen(true)}
          style={({ pressed }) => [
            styles.reason,
            (amenityLabels.length > 0 || visit) && styles.reasonDivided,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${t.pubDetail.mappedLine(completenessPct)}. ${t.pubDetail.mappedHint}`}
        >
          <MappedRing pct={completenessPct} />
          <View style={styles.reasonText}>
            <Text style={styles.reasonTitle} maxFontSizeMultiplier={FontScaleCap.body}>
              {t.pubDetail.mappedLine(completenessPct)}
            </Text>
            <Text style={styles.reasonSub} maxFontSizeMultiplier={FontScaleCap.body}>
              {t.pubDetail.mappedHint}
            </Text>
          </View>
          <ChevronRightIcon size={18} color={Colors.mutedText} />
        </Pressable>
      </Animated.ScrollView>

      <View
        style={[styles.navLayer, { paddingTop: insets.top }]}
        pointerEvents="box-none"
        {...hiddenUnderMap}
      >
        <EdgeFade
          edge="top"
          solid={(insets.top + NAV_HEIGHT) / (insets.top + NAV_HEIGHT + EDGE_FADE)}
          style={[styles.navFade, { height: insets.top + NAV_HEIGHT + EDGE_FADE }]}
        />
        <View style={[styles.nav, navInsets]}>
          <RoundButton onPress={goBack} label={t.pubDetail.backA11y} glass>
            <ChevronLeftIcon size={24} color={Colors.foam} />
          </RoundButton>
          <Text
            style={[styles.navTitle, !showTitle && styles.hidden]}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.heading}
            accessibilityElementsHidden={!showTitle}
            importantForAccessibility={showTitle ? 'auto' : 'no-hide-descendants'}
          >
            {pub.name}
          </Text>
          <RoundButton
            onPress={toggleFavorite}
            label={isFavorite ? t.pubDetail.favoriteRemoveA11y : t.pubDetail.favoriteAddA11y}
            selected={isFavorite}
            glass
          >
            {isFavorite ? (
              <HeartFilledIcon size={22} color={Colors.amber} />
            ) : (
              <HeartIcon size={22} color={Colors.foam} />
            )}
          </RoundButton>
          <RoundButton onPress={() => setMoreOpen(true)} label={t.pubDetail.moreA11y} glass>
            <EllipsisIcon size={22} color={Colors.foam} />
          </RoundButton>
        </View>
      </View>

      <View
        style={[styles.bar, { paddingBottom: barBottom }]}
        {...hiddenUnderMap}
      >
        <EdgeFade
          edge="bottom"
          solid={barHeight / (barHeight + EDGE_FADE)}
          style={styles.barFade}
        />
        <Pressable
          onPress={navigateToPub}
          style={({ pressed }) => [styles.cta, quiet && styles.ctaQuiet, pressed && styles.ctaPressed]}
          accessibilityRole="button"
          accessibilityLabel={t.compass.navigateCta}
        >
          <Text
            style={[styles.ctaLabel, quiet && styles.ctaLabelQuiet]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            maxFontSizeMultiplier={FontScaleCap.display}
          >
            {t.compass.navigateCta}
          </Text>
        </Pressable>
        <GlassSurface style={styles.aim} fallbackColor={Colors.stout3}>
          <Pressable
            onPress={aimCompass}
            style={({ pressed }) => [styles.aimHit, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t.pubDetail.aimA11y(pub.name)}
          >
            <CompassIcon size={22} color={Colors.amber} />
          </Pressable>
        </GlassSurface>
      </View>

      {mapOpen ? (
        <View style={styles.mapLayer} accessibilityViewIsModal>
          <BeerMapScreen
            initialPub={pub}
            focusInitialPub
            onBack={() => setMapOpen(false)}
            onOpenPub={handleMapPub}
            filters={mapFilters}
            onApplyFilters={setMapFilters}
            onSearch={() => router.push('/pub-search' as Href)}
            onShowCompass={showCompass}
          />
        </View>
      ) : null}

      <MapPubSheet
        visible={mappingOpen}
        pubKey={key}
        pubName={pub.name}
        info={info}
        showEvents={false}
        onClose={() => setMappingOpen(false)}
        onRenamed={(name) => {
          setPub((current) => (current ? { ...current, name } : current));
          if (ref) usePubPageStore.getState().rename(ref, pub, name);
        }}
        onReport={() => {
          setMappingOpen(false);
          afterSheet(() => setReportOpen(true));
        }}
      />
      <MoreSheet visible={moreOpen} rows={moreRows} onClose={() => setMoreOpen(false)} />
      <MenuBeerActionsSheet
        visible={beerActionsOpen}
        beer={actionBeer}
        canEdit={actionBeerEditable}
        canRemove={actionBeerEditable}
        onClose={() => setBeerActionsOpen(false)}
        onEditPrice={editBeerPrice}
        onRemove={removeBeer}
      />
      <BeerFormModal
        visible={priceFormOpen}
        mode="edit"
        beer={actionBeer}
        formKey={priceFormNonce}
        onCancel={() => setPriceFormOpen(false)}
        onSubmit={saveBeerPrice}
      />
      <ReportPubModal
        visible={reportOpen}
        pubName={pub.name}
        onClose={() => setReportOpen(false)}
        onAddPub={() => {
          setReportOpen(false);
          afterSheet(addPubNear);
        }}
        onRename={() => {
          setReportOpen(false);
          afterSheet(startRename);
        }}
        onReportReason={reportReason}
      />
      <RenamePubModal
        visible={renameOpen}
        currentName={pub.name}
        value={renameDraft}
        submitting={renameSubmitting}
        onChange={setRenameDraft}
        onCancel={() => {
          if (!renameSubmitting) setRenameOpen(false);
        }}
        onSubmit={submitRename}
      />
    </View>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

function ReasonRow({
  icon,
  title,
  subtitle,
  amber = false,
  first = false,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string | null;
  amber?: boolean;
  first?: boolean;
}) {
  return (
    <View style={[styles.reason, !first && styles.reasonDivided]}>
      <View style={[styles.reasonIcon, amber && styles.reasonIconAmber]}>{icon}</View>
      <View style={styles.reasonText}>
        <Text style={styles.reasonTitle} maxFontSizeMultiplier={FontScaleCap.body}>
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={styles.reasonSub}
            numberOfLines={2}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function LinkRow({
  label,
  onPress,
  first = false,
  muted = false,
  trailing,
}: {
  label: string;
  onPress: () => void;
  first?: boolean;
  muted?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.linkRow,
        !first && styles.rowDivided,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {muted ? null : <PlusIcon size={18} color={Colors.amber} />}
      <Text
        style={[styles.linkLabel, muted && styles.linkLabelMuted]}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {label}
      </Text>
      {trailing}
    </Pressable>
  );
}

function EventRow({ event, now, first }: { event: PubEvent; now: Date; first: boolean }) {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const day = eventDay(event, now);
  // A running event belongs to today, even when it started days ago.
  const tileDate = day.kind === 'running' ? now : start;
  const dayLabel =
    day.kind === 'running' || day.kind === 'today'
      ? t.pubDetail.eventTodayShort
      : t.contribute.daysShort[dayKeyOf(start)];
  const startTime = eventStartTime(event);
  const endTime = eventStartTime({ ...event, startsAt: event.endsAt });
  const sameDay = calendarDaysBetween(start, end) === 0;
  const shortDate = (date: Date) =>
    dateTimeFormat({ day: 'numeric', month: 'numeric' }).format(date);
  // Multi-day events (the server allows up to 14 days) show both ends.
  const time = sameDay
    ? `${startTime}–${endTime}`
    : `${shortDate(start)} ${startTime} – ${shortDate(end)} ${endTime}`;
  return (
    <View
      style={[styles.eventRow, !first && styles.rowDivided]}
      accessibilityLabel={`${event.title}. ${eventWhenLabel(event, now)}`}
    >
      <View style={styles.dateTile}>
        <Text style={styles.dateTileDay} maxFontSizeMultiplier={FontScaleCap.body}>
          {dayLabel}
        </Text>
        <Text style={styles.dateTileNum} maxFontSizeMultiplier={FontScaleCap.body}>
          {tileDate.getDate()}
        </Text>
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} maxFontSizeMultiplier={FontScaleCap.body}>
          {event.title}
        </Text>
        <Text style={styles.rowSub} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
          {[time, event.details].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </View>
  );
}

function MappedRing({ pct }: { pct: number }) {
  const size = 36;
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <Svg width={size} height={size}>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={withAlpha(Colors.foam, 0.12)}
        strokeWidth={stroke}
        fill="none"
      />
      {clamped > 0 ? (
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={Colors.amber}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${(circumference * clamped) / 100} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      ) : null}
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
  },
  navLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  navFade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  nav: {
    height: NAV_HEIGHT,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  navTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: Colors.foam,
  },
  hidden: {
    opacity: 0,
  },
  pressed: {
    opacity: 0.65,
  },
  failed: {
    marginTop: Spacing.xl,
    paddingHorizontal: PAGE_PAD,
    fontSize: 16,
    color: Colors.mutedText,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: PAGE_PAD,
    paddingTop: Spacing.xs,
  },
  name: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: Colors.foam,
  },
  status: {
    marginTop: Spacing.xs,
    fontSize: 15,
    lineHeight: 20,
    color: Colors.mutedText,
  },
  mapStrip: {
    marginTop: 18,
    height: 112,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: Colors.stout2,
  },
  mapPin: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 36,
    height: 36,
    marginLeft: -18,
    marginTop: -24,
    borderRadius: Radius.pill,
    borderWidth: 3,
    borderColor: Colors.foam,
    backgroundColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Bottom right: the Google logo in the bottom left must stay visible.
  mapLabel: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.stout, 0.88),
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mapLabelText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.foam,
  },
  reasons: {
    marginTop: Spacing.sm,
  },
  reason: {
    minHeight: 60,
    paddingVertical: Spacing.sm + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  reasonDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  reasonIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.07),
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasonIconAmber: {
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  reasonText: {
    flex: 1,
    minWidth: 0,
  },
  reasonTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.foam,
  },
  reasonSub: {
    marginTop: 2,
    fontSize: 14,
    color: Colors.mutedText,
  },
  row: {
    minHeight: 52,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  rowFirst: {
    borderTopWidth: 0,
  },
  rowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: Colors.foam,
  },
  rowSub: {
    marginTop: 2,
    fontSize: 14,
    color: Colors.mutedText,
  },
  rowValue: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.foamMuted,
    fontVariant: ['tabular-nums'],
  },
  linkRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  linkLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: Colors.amber,
  },
  linkLabelMuted: {
    fontWeight: '500',
    color: Colors.foamMuted,
  },
  eventRow: {
    minHeight: 62,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dateTile: {
    width: 36,
    height: 42,
    borderRadius: 10,
    backgroundColor: Colors.stout2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateTileDay: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.mutedText,
  },
  dateTileNum: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },
  hoursRow: {
    paddingVertical: 7,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  hoursDay: {
    fontSize: 16,
    color: Colors.foamMuted,
  },
  hoursValue: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: 16,
    color: Colors.foamMuted,
    fontVariant: ['tabular-nums'],
  },
  hoursToday: {
    fontWeight: '700',
    color: Colors.foam,
  },
  hoursTodayMark: {
    fontWeight: '600',
    color: Colors.open,
  },
  rawHours: {
    paddingVertical: Spacing.sm,
    fontSize: 16,
    color: Colors.foamMuted,
  },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: Spacing.md,
    paddingHorizontal: PAGE_PAD,
    flexDirection: 'row',
    gap: 10,
  },
  barFade: {
    position: 'absolute',
    top: -EDGE_FADE,
    left: 0,
    right: 0,
    bottom: 0,
  },
  cta: {
    flex: 1,
    minHeight: BAR_BUTTON,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  ctaPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.97 }],
  },
  ctaLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.stout,
  },
  // In a right half the amber belongs to the left one.
  ctaQuiet: { backgroundColor: Colors.stout3 },
  ctaLabelQuiet: { color: Colors.foam },
  mapLayer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: Colors.stout,
  },
  aim: {
    width: BAR_BUTTON,
    height: BAR_BUTTON,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  aimHit: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
