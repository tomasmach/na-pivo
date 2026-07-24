/**
 * "Doplnit info" — a fixed Tácek composition for two public pub facts.
 *
 * The surface only reads: one section at a time, one fact list, one nudge and
 * one save action. Editing lives in the sheet that owns the field. The write
 * path remains the original one: touched sections only, optimistic local
 * override, persistent retry queue, Mapér XP response, haptic, toast and back.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  InteractionManager,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DayHoursSheet } from '@/components/contribute/DayHoursSheet';
import { HistoricalBeersSheet } from '@/components/contribute/HistoricalBeersSheet';
import { MenuBeerSheet } from '@/components/contribute/MenuBeerSheet';
import {
  ScanMenuSheet,
  type MenuScanSource,
} from '@/components/contribute/ScanMenuSheet';
import {
  CameraIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  CompassIcon,
  InfoIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
} from '@/components/shared/IconGlyph';
import {
  CounterCta,
  CounterSecondary,
} from '@/counter/CounterCta';
import type { BeerFormResult } from '@/counter/BeerFormModal';
import { NudgeSlot, type Nudge } from '@/counter/NudgeSlot';
import { generateUuidV4 } from '@/data/account';
import {
  buildCommunityEntry,
  type CommunityBeer,
} from '@/data/communityClient';
import {
  computeOpenState,
  DAY_KEYS,
  emptyWeeklyHours,
  historicalBeersAfterMenuReplacement,
  isAllowedBeerVolume,
  isSameBeerIdentity,
  normalizeBeerName,
  normalizeEditableHoursInterval,
  type DayKey,
  type HoursInterval,
  type WeeklyHours,
} from '@/data/communityHours';
import { enqueuePubCommunity } from '@/data/communityQueue';
import { geohash8 } from '@/data/geohash';
import type { MenuPhotoSource } from '@/data/menuPhotoPicker';
import { scanMenuPhoto } from '@/data/menuScanClient';
import { cs, formatVolume } from '@/i18n/cs';
import { useAccountStore } from '@/stores/accountStore';
import { useCommunityStore } from '@/stores/communityStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import {
  formatPrice,
  formatPriceInputFromCzk,
  parsePriceInputToCzk,
  type PriceCurrency,
} from '@/utils/currency';
import { fireSuccessHaptic } from '@/utils/haptics';

const VOLUME_SMALL = 300;
const MAX_BEERS = 12;
let beerRowIdSequence = 0;

type Section = 'hours' | 'beers';

interface BeerRow {
  id: string;
  name: string;
  priceText: string;
  volumeMl: number | undefined;
}

function nextBeerRowId(): string {
  beerRowIdSequence += 1;
  return `beer-row-${beerRowIdSequence}`;
}

function communityBeerToRow(
  beer: CommunityBeer,
  priceCurrency: PriceCurrency,
): BeerRow {
  return {
    id: nextBeerRowId(),
    name: beer.name,
    priceText:
      typeof beer.priceCzk === 'number'
        ? formatPriceInputFromCzk(beer.priceCzk, priceCurrency)
        : '',
    volumeMl: beer.volumeMl,
  };
}

function beerRowToCommunityBeer(
  beer: BeerRow,
  priceCurrency: PriceCurrency,
): CommunityBeer {
  const result: CommunityBeer = { name: beer.name };
  const priceCzk = parsePriceInputToCzk(beer.priceText, priceCurrency);
  if (priceCzk !== null) result.priceCzk = priceCzk;
  if (isAllowedBeerVolume(beer.volumeMl)) result.volumeMl = beer.volumeMl;
  return result;
}

function mergeScannedIntoRows(
  rows: BeerRow[],
  scanned: readonly CommunityBeer[],
  priceCurrency: PriceCurrency,
): { rows: BeerRow[]; count: number } {
  let next = rows;
  let count = 0;
  for (const beer of scanned) {
    if (!normalizeBeerName(beer.name)) continue;
    const index = next.findIndex((row) => isSameBeerIdentity(row, beer));
    if (index >= 0) {
      if (typeof beer.priceCzk === 'number') {
        const priceText = formatPriceInputFromCzk(
          beer.priceCzk,
          priceCurrency,
        );
        if (next[index].priceText !== priceText) {
          next = next.map((row, rowIndex) =>
            rowIndex === index ? { ...row, priceText } : row,
          );
          count += 1;
        }
      }
      continue;
    }
    if (next.length >= MAX_BEERS) continue;
    next = [...next, communityBeerToRow(beer, priceCurrency)];
    count += 1;
  }
  return { rows: next, count };
}

function parseFloatParam(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseStringParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function decodeJsonParam<T>(
  value: string | string[] | undefined,
  fallback: T,
): T {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function formatDayIntervals(intervals: HoursInterval[]): string {
  if (intervals.length === 0) return cs.contribute.closedToggle;
  return intervals.map(([from, to]) => `${from}–${to}`).join(' · ');
}

function nextChangeTime(nextChange: string | null): string | null {
  if (!nextChange) return null;
  const date = new Date(nextChange);
  if (Number.isNaN(date.getTime())) return null;
  return `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
}

function beerMeta(
  beer: BeerRow,
  priceCurrency: PriceCurrency,
): string {
  const volume =
    typeof beer.volumeMl === 'number' ? formatVolume(beer.volumeMl) : null;
  const priceCzk = parsePriceInputToCzk(beer.priceText, priceCurrency);
  const price =
    priceCzk !== null ? formatPrice(priceCzk, priceCurrency) : null;
  if (volume && price) return `${volume} · ${price}`;
  if (volume) return `${volume} · ${cs.contribute.priceMissing}`;
  if (price) return `${cs.contribute.volumeMissing} · ${price}`;
  return cs.contribute.volumeMissing;
}

export default function ContributeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();

  const pub = useMemo(
    () => ({
      id: parseStringParam(params.id),
      name: parseStringParam(params.name),
      lat: parseFloatParam(params.lat),
      lng: parseFloatParam(params.lng),
      city: parseStringParam(params.city) || undefined,
    }),
    [
      params.city,
      params.id,
      params.lat,
      params.lng,
      params.name,
    ],
  );

  const initialSection: Section =
    parseStringParam(params.focus) === 'beers' ||
    parseStringParam(params.autoScan) === '1'
      ? 'beers'
      : 'hours';
  const [section, setSection] = useState<Section>(initialSection);

  const cell = useMemo(
    () => geohash8(pub.lat, pub.lng),
    [pub.lat, pub.lng],
  );
  const setOverride = useCommunityStore((state) => state.setOverride);
  const storedOverride = useCommunityStore(
    (state) => state.overrides[cell],
  );
  const priceCurrency = useSettingsStore(
    (state) => state.priceCurrency,
  );

  const prefillHours = useMemo<WeeklyHours>(() => {
    const fromParam = decodeJsonParam<WeeklyHours | null>(
      params.hours,
      null,
    );
    return fromParam ?? storedOverride?.hours ?? emptyWeeklyHours();
    // Router prefill is read once; after mount the form owns its draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initialCurrentBeers = useMemo<CommunityBeer[]>(() => {
    const fromParam = decodeJsonParam<CommunityBeer[] | null>(
      params.beers,
      null,
    );
    return fromParam ?? storedOverride?.beers ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prefillBeers = useMemo(
    () =>
      initialCurrentBeers.map((beer) =>
        communityBeerToRow(beer, priceCurrency),
      ),
    [initialCurrentBeers, priceCurrency],
  );

  const historicalBeers = useMemo(
    () =>
      decodeJsonParam<CommunityBeer[]>(
        params.historicalBeers,
        [],
      ),
    // History is a server-owned restore source; the form owns current rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [hours, setHours] = useState<WeeklyHours>(prefillHours);
  const [beers, setBeers] = useState<BeerRow[]>(prefillBeers);
  const [hoursTouched, setHoursTouched] = useState(false);
  const [beersTouched, setBeersTouched] = useState(false);
  const [activeDay, setActiveDay] = useState<DayKey | null>(null);
  const [beerEditorOpen, setBeerEditorOpen] = useState(false);
  const [editingBeerId, setEditingBeerId] = useState<string | null>(
    null,
  );
  const [beerFormNonce, setBeerFormNonce] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanSourceVisible, setScanSourceVisible] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const beersRef = useRef(beers);

  useEffect(() => {
    beersRef.current = beers;
  }, [beers]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60 * 1000);
    if (
      typeof timer === 'object' &&
      'unref' in timer &&
      typeof timer.unref === 'function'
    ) {
      timer.unref();
    }
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (parseStringParam(params.autoScan) !== '1') return;
    const task = InteractionManager.runAfterInteractions(() => {
      setScanSourceVisible(true);
    });
    return () => task.cancel();
    // One-shot after the route transition and the previous modal settle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateDay = useCallback(
    (day: DayKey, intervals: HoursInterval[]) => {
      setHoursTouched(true);
      setHours((previous) => ({ ...previous, [day]: intervals }));
    },
    [],
  );

  const copyDayToAll = useCallback((sourceDay: DayKey) => {
    setHoursTouched(true);
    setHours((previous) => {
      const source = previous[sourceDay].map(
        (interval): HoursInterval => [interval[0], interval[1]],
      );
      const next = { ...previous };
      for (const day of DAY_KEYS) {
        next[day] = source.map(
          (interval): HoursInterval => [interval[0], interval[1]],
        );
      }
      return next;
    });
  }, []);

  const openNewBeer = useCallback(() => {
    if (beersRef.current.length >= MAX_BEERS) return;
    setEditingBeerId(null);
    setBeerFormNonce((nonce) => nonce + 1);
    setBeerEditorOpen(true);
  }, []);

  const openBeer = useCallback((id: string) => {
    setEditingBeerId(id);
    setBeerFormNonce((nonce) => nonce + 1);
    setBeerEditorOpen(true);
  }, []);

  const closeBeerEditor = useCallback(() => {
    setBeerEditorOpen(false);
    setEditingBeerId(null);
  }, []);

  const editingBeer = useMemo(
    () =>
      editingBeerId
        ? beers.find((beer) => beer.id === editingBeerId) ?? null
        : null,
    [beers, editingBeerId],
  );

  const editingBeerSeed = useMemo(
    () =>
      editingBeer
        ? beerRowToCommunityBeer(editingBeer, priceCurrency)
        : null,
    [editingBeer, priceCurrency],
  );

  const submitBeerEditor = useCallback(
    (result: BeerFormResult) => {
      const nextRow: BeerRow = {
        id: editingBeerId ?? nextBeerRowId(),
        name: result.name,
        priceText:
          typeof result.priceCzk === 'number'
            ? formatPriceInputFromCzk(
                result.priceCzk,
                priceCurrency,
              )
            : '',
        volumeMl: result.volumeMl,
      };
      setBeersTouched(true);
      setBeers((previous) => {
        const next = editingBeerId
          ? previous.map((beer) =>
              beer.id === editingBeerId ? nextRow : beer,
            )
          : previous.length < MAX_BEERS
            ? [...previous, nextRow]
            : previous;
        beersRef.current = next;
        return next;
      });
      closeBeerEditor();
    },
    [closeBeerEditor, editingBeerId, priceCurrency],
  );

  const removeBeer = useCallback(
    (id: string) => {
      setBeersTouched(true);
      setBeers((previous) => {
        const next = previous.filter((beer) => beer.id !== id);
        beersRef.current = next;
        return next;
      });
      closeBeerEditor();
    },
    [closeBeerEditor],
  );

  const canAddSmallVariant = useMemo(() => {
    if (!editingBeer || beers.length >= MAX_BEERS) return false;
    const name = editingBeer.name.trim();
    if (!name || editingBeer.volumeMl === VOLUME_SMALL) return false;
    return !beers.some(
      (beer) =>
        beer.id !== editingBeer.id &&
        normalizeBeerName(beer.name) === normalizeBeerName(name) &&
        beer.volumeMl === VOLUME_SMALL,
    );
  }, [beers, editingBeer]);

  const addSmallBeerVariant = useCallback(() => {
    if (!editingBeer || !canAddSmallVariant) return;
    const row: BeerRow = {
      id: nextBeerRowId(),
      name: editingBeer.name.trim(),
      priceText: '',
      volumeMl: VOLUME_SMALL,
    };
    setBeersTouched(true);
    setBeers((previous) => {
      const sourceIndex = previous.findIndex(
        (beer) => beer.id === editingBeer.id,
      );
      if (sourceIndex < 0 || previous.length >= MAX_BEERS) {
        return previous;
      }
      const insertAt = sourceIndex + 1;
      const next = [
        ...previous.slice(0, insertAt),
        row,
        ...previous.slice(insertAt),
      ];
      beersRef.current = next;
      return next;
    });
    closeBeerEditor();
  }, [canAddSmallVariant, closeBeerEditor, editingBeer]);

  const availableHistoricalBeers = useMemo(
    () =>
      historicalBeers.filter(
        (historical) =>
          !beers.some((beer) =>
            isSameBeerIdentity(beer, historical),
          ),
      ),
    [beers, historicalBeers],
  );

  const restoreHistoricalBeer = useCallback(
    (beer: CommunityBeer) => {
      if (beersRef.current.length >= MAX_BEERS) return;
      const row = communityBeerToRow(beer, priceCurrency);
      setBeersTouched(true);
      setBeers((previous) => {
        if (
          previous.some((current) =>
            isSameBeerIdentity(current, beer),
          )
        ) {
          return previous;
        }
        const next = [...previous, row];
        beersRef.current = next;
        return next;
      });
    },
    [priceCurrency],
  );

  const scanInFlightRef = useRef(false);

  const runScan = useCallback(
    async (source: MenuPhotoSource) => {
      if (scanInFlightRef.current) return;
      scanInFlightRef.current = true;
      const toast = useToastStore.getState().show;

      try {
        const { pickAndPrepareMenuPhoto } = await import(
          '@/data/menuPhotoPicker'
        );
        const picked = await pickAndPrepareMenuPhoto(source);
        if (picked.status === 'cancelled') return;
        if (
          picked.status === 'denied' ||
          picked.status === 'denied-permanent'
        ) {
          toast(cs.contribute.scanMenu.permissionDenied, {
            icon: <CameraIcon size={18} color={Colors.amber} />,
          });
          return;
        }
        if (picked.status === 'error') {
          toast(cs.contribute.scanMenu.errorToast, {
            icon: <InfoIcon size={18} color={Colors.foamMuted} />,
          });
          return;
        }

        setScanning(true);
        const result = await scanMenuPhoto(picked.uri);
        switch (result.status) {
          case 'ok': {
            const { rows, count } = mergeScannedIntoRows(
              beersRef.current,
              result.beers,
              priceCurrency,
            );
            if (count > 0) {
              beersRef.current = rows;
              setBeers(rows);
              setBeersTouched(true);
              fireSuccessHaptic();
              toast(cs.contribute.scanMenu.successToast(count), {
                icon: <SparklesIcon size={18} color={Colors.amber} />,
              });
            } else {
              toast(cs.contribute.scanMenu.nothingNewToast, {
                icon: <CheckIcon size={18} color={Colors.amber} />,
              });
            }
            break;
          }
          case 'empty':
            toast(cs.contribute.scanMenu.emptyToast, {
              icon: <SearchIcon size={18} color={Colors.foamMuted} />,
            });
            break;
          case 'unavailable':
            toast(cs.contribute.scanMenu.unavailableToast, {
              icon: <InfoIcon size={18} color={Colors.foamMuted} />,
            });
            break;
          case 'daily-cap':
            toast(cs.contribute.scanMenu.dailyCapToast, {
              icon: <ClockIcon size={18} color={Colors.foamMuted} />,
            });
            break;
          case 'rate-limited':
            toast(cs.contribute.scanMenu.rateLimitedToast, {
              icon: <ClockIcon size={18} color={Colors.foamMuted} />,
            });
            break;
          case 'bad-image':
            toast(cs.contribute.scanMenu.badImageToast, {
              icon: <CameraIcon size={18} color={Colors.amber} />,
            });
            break;
          default:
            toast(cs.contribute.scanMenu.errorToast, {
              icon: <InfoIcon size={18} color={Colors.foamMuted} />,
            });
        }
      } finally {
        scanInFlightRef.current = false;
        setScanning(false);
      }
    },
    [priceCurrency],
  );

  const handleScanMenu = useCallback(() => {
    if (scanning) return;
    setScanSourceVisible(true);
  }, [scanning]);

  const handlePickScanSource = useCallback(
    (source: MenuScanSource) => {
      setScanSourceVisible(false);
      void runScan(source);
    },
    [runScan],
  );

  const closeScanSheet = useCallback(
    () => setScanSourceVisible(false),
    [],
  );

  const normalizedHours = useMemo<WeeklyHours | null>(() => {
    const next = emptyWeeklyHours();
    for (const day of DAY_KEYS) {
      for (const interval of hours[day]) {
        const normalized = normalizeEditableHoursInterval(interval);
        if (!normalized) return null;
        next[day].push(normalized);
      }
    }
    return next;
  }, [hours]);

  const invalidDay = useMemo<DayKey | null>(() => {
    for (const day of DAY_KEYS) {
      for (const interval of hours[day]) {
        if (!normalizeEditableHoursInterval(interval)) return day;
      }
    }
    return null;
  }, [hours]);

  const hoursValid = normalizedHours !== null;

  const cleanedBeers = useMemo<CommunityBeer[]>(
    () =>
      beers
        .map((beer): CommunityBeer | null => {
          const name = beer.name.trim();
          if (!name) return null;
          const result: CommunityBeer = {
            name: name.slice(0, 80),
          };
          const priceCzk = parsePriceInputToCzk(
            beer.priceText,
            priceCurrency,
          );
          if (priceCzk !== null) result.priceCzk = priceCzk;
          if (isAllowedBeerVolume(beer.volumeMl)) {
            result.volumeMl = beer.volumeMl;
          }
          return result;
        })
        .filter((beer): beer is CommunityBeer => beer !== null)
        .slice(0, MAX_BEERS),
    [beers, priceCurrency],
  );

  const canSubmit =
    (hoursTouched || beersTouched) &&
    (!hoursTouched || hoursValid);

  const handleSubmit = useCallback(() => {
    const sendHours = hoursTouched;
    const sendBeers = beersTouched;
    if (!sendHours && !sendBeers) return;
    if (sendHours && !normalizedHours) return;
    const submittedHours = sendHours
      ? (normalizedHours ?? undefined)
      : undefined;

    const entry = buildCommunityEntry(
      {
        externalId: pub.id || null,
        name: pub.name,
        lat: pub.lat,
        lng: pub.lng,
        city: pub.city,
        hours: submittedHours,
        beers: sendBeers ? cleanedBeers : undefined,
      },
      generateUuidV4(),
    );

    setOverride(cell, {
      hours: submittedHours,
      beers: sendBeers ? cleanedBeers : undefined,
      historicalBeers: sendBeers
        ? historicalBeersAfterMenuReplacement(
            initialCurrentBeers,
            cleanedBeers,
            historicalBeers,
          )
        : undefined,
    });

    void enqueuePubCommunity(entry).then((response) => {
      if (!response) return;
      if (response.mapper) {
        useAccountStore.getState().applyMapperSnapshot({
          xp: response.mapper.xp,
          level: response.mapper.level,
          title: response.mapper.title,
          xpIntoLevel: response.mapper.xp_into_level,
          xpForNextLevel: response.mapper.xp_for_next_level,
          distinctMappedPubs: response.mapper.distinct_mapped_pubs,
          amenityVotesCount: response.mapper.amenity_votes_count,
          firstMapperCount: response.mapper.first_mapper_count,
          completedPubsCount: response.mapper.completed_pubs_count,
        });
      }
      if (response.xpAwarded > 0) {
        useToastStore
          .getState()
          .show(cs.contribute.xpToast(response.xpAwarded), {
            icon: <CompassIcon size={18} color={Colors.amber} />,
          });
      }
    });

    if (useSettingsStore.getState().hapticEnabled) {
      fireSuccessHaptic();
    }
    useToastStore.getState().show(cs.contribute.savedToast);
    router.back();
  }, [
    beersTouched,
    cell,
    cleanedBeers,
    historicalBeers,
    hoursTouched,
    initialCurrentBeers,
    normalizedHours,
    pub.city,
    pub.id,
    pub.lat,
    pub.lng,
    pub.name,
    router,
    setOverride,
  ]);

  const openState = useMemo(
    () =>
      computeOpenState(
        normalizedHours ?? hours,
        new Date(nowMs),
      ),
    [hours, normalizedHours, nowMs],
  );
  const openStateTime = nextChangeTime(openState.nextChange);
  const hoursFooter = openState.isOpenNow
    ? openStateTime
      ? cs.contribute.hoursOpenNow(openStateTime)
      : cs.contribute.hoursOpenNoChange
    : openStateTime
      ? cs.contribute.hoursClosedNow(openStateTime)
      : cs.contribute.hoursClosedNoChange;

  const nudge = useMemo<Nudge | null>(() => {
    if (hoursTouched && invalidDay) {
      return {
        kind: 'counted',
        text: cs.contribute.invalidDayNudge(
          cs.contribute.daysAt[invalidDay],
        ),
        undoLabel: cs.contribute.fix,
        actionAccessibilityLabel: cs.contribute.fixHoursA11y,
        onUndo: () => {
          setSection('hours');
          setActiveDay(invalidDay);
        },
      };
    }
    if (scanning) {
      return {
        kind: 'dopito',
        label: cs.contribute.scanningNudge,
        onPress: () => undefined,
      };
    }
    if (section === 'beers' && beers.length >= MAX_BEERS) {
      return {
        kind: 'dopito',
        label: cs.contribute.maxBeersNudge,
        onPress: () => undefined,
      };
    }
    return null;
  }, [beers.length, hoursTouched, invalidDay, scanning, section]);
  const scanningNudgeVisible =
    scanning && !(hoursTouched && invalidDay);

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top + 8,
          paddingBottom: Math.max(insets.bottom, Spacing.sm),
        },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.pressed,
            ]}
            hitSlop={2}
            accessibilityRole="button"
            accessibilityLabel={cs.a11y.backButton}
          >
            <ChevronLeftIcon size={22} color={Colors.foam} />
          </Pressable>
          <Text
            style={styles.headerTitle}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.heading}
          >
            {cs.contribute.title}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.segment}>
          {(['hours', 'beers'] as const).map((value) => {
            const selected = section === value;
            const label =
              value === 'hours'
                ? cs.contribute.hoursTab
                : cs.contribute.beersTab;
            return (
              <Pressable
                key={value}
                onPress={() => setSection(value)}
                hitSlop={{ top: 2, bottom: 2 }}
                style={({ pressed }) => [
                  styles.segmentButton,
                  selected && styles.segmentButtonSelected,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={label}
              >
                <Text
                  style={[
                    styles.segmentLabel,
                    selected && styles.segmentLabelSelected,
                  ]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.heading}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.card}>
        <Text
          style={styles.pubName}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {pub.name || cs.contribute.unknownPub}
        </Text>
        <Text
          style={styles.eyebrow}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {section === 'hours'
            ? cs.contribute.hoursHeader
            : cs.contribute.beersHeader}
        </Text>

        <ScrollView
          style={styles.cardScroll}
          contentContainerStyle={styles.cardScrollContent}
          showsVerticalScrollIndicator={false}
        >
          {section === 'hours'
            ? DAY_KEYS.map((day, index) => {
                const summary = formatDayIntervals(hours[day]);
                const closed = hours[day].length === 0;
                const multiple = hours[day].length > 1;
                return (
                  <Pressable
                    key={day}
                    onPress={() => setActiveDay(day)}
                    style={({ pressed }) => [
                      styles.hoursRow,
                      index > 0 && styles.rowDivider,
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={cs.contribute.editDayA11y(
                      cs.contribute.days[day],
                      summary,
                    )}
                  >
                    <Text
                      style={styles.dayName}
                      numberOfLines={1}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {cs.contribute.days[day]}
                    </Text>
                    <Text
                      style={[
                        multiple
                          ? styles.hoursValueMultiple
                          : styles.hoursValue,
                        closed && styles.hoursValueClosed,
                      ]}
                      numberOfLines={1}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {summary}
                    </Text>
                  </Pressable>
                );
              })
            : (
              <>
                {beers.length === 0 ? (
                  <Text
                    style={styles.emptyText}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {cs.contribute.beersEmpty}
                  </Text>
                ) : (
                  beers.map((beer, index) => (
                    <Pressable
                      key={beer.id}
                      onPress={() => openBeer(beer.id)}
                      style={({ pressed }) => [
                        styles.beerRow,
                        index > 0 && styles.rowDivider,
                        pressed && styles.pressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={cs.contribute.editBeerA11y(
                        beer.name,
                        beerMeta(beer, priceCurrency),
                      )}
                    >
                      <View style={styles.beerCopy}>
                        <Text
                          style={styles.beerName}
                          numberOfLines={1}
                          maxFontSizeMultiplier={FontScaleCap.body}
                        >
                          {beer.name}
                        </Text>
                        <Text
                          style={styles.beerMeta}
                          numberOfLines={1}
                          maxFontSizeMultiplier={FontScaleCap.body}
                        >
                          {beerMeta(beer, priceCurrency)}
                        </Text>
                      </View>
                      <ChevronRightIcon
                        size={15}
                        color={Colors.mutedText}
                      />
                    </Pressable>
                  ))
                )}

                {beers.length < MAX_BEERS ? (
                  <Pressable
                    onPress={openNewBeer}
                    style={({ pressed }) => [
                      styles.addBeerRow,
                      beers.length > 0 && styles.rowDivider,
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={cs.a11y.contributeAddBeer}
                  >
                    <PlusIcon size={16} color={Colors.amber} />
                    <Text
                      style={styles.addBeerLabel}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {cs.contribute.addBeer}
                    </Text>
                  </Pressable>
                ) : null}
              </>
            )}
        </ScrollView>

        <View style={styles.cardFooter}>
          {section === 'hours' ? (
            <Text
              style={[
                styles.footerFact,
                {
                  color: openState.isOpenNow
                    ? Colors.open
                    : Colors.closed,
                },
              ]}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {hoursFooter}
            </Text>
          ) : availableHistoricalBeers.length > 0 ? (
            <Pressable
              onPress={() => setHistoryOpen(true)}
              style={({ pressed }) => [
                styles.historyDoor,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={cs.contribute.historicalBeersDoor(
                availableHistoricalBeers.length,
              )}
            >
              <Text
                style={styles.historyDoorLabel}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {cs.contribute.historicalBeersDoor(
                  availableHistoricalBeers.length,
                )}
              </Text>
              <ChevronRightIcon size={15} color={Colors.amber} />
            </Pressable>
          ) : (
            <Text
              style={styles.footerHint}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {cs.contribute.beersLifecycleHintShort}
            </Text>
          )}
        </View>
      </View>

      <View
        accessible={scanningNudgeVisible}
        accessibilityRole={
          scanningNudgeVisible ? 'progressbar' : undefined
        }
        accessibilityLabel={
          scanningNudgeVisible
            ? cs.contribute.scanningNudge
            : undefined
        }
      >
        <NudgeSlot nudge={nudge} />
      </View>

      <CounterCta
        label={cs.contribute.save}
        subLabel={cs.contribute.publicSubmitHint}
        onPress={handleSubmit}
        disabled={!canSubmit}
        accessibilityLabel={cs.a11y.contributeSaveButton}
      />

      {section === 'beers' ? (
        <CounterSecondary
          label={cs.contribute.scanMenuSecondary}
          onPress={handleScanMenu}
          accessibilityLabel={cs.contribute.scanMenuSecondary}
        />
      ) : null}

      <DayHoursSheet
        visible={activeDay !== null}
        day={activeDay ?? 'mo'}
        intervals={hours[activeDay ?? 'mo']}
        onChange={(intervals) =>
          updateDay(activeDay ?? 'mo', intervals)
        }
        onCopyToAll={() => copyDayToAll(activeDay ?? 'mo')}
        onClose={() => setActiveDay(null)}
      />

      <MenuBeerSheet
        visible={beerEditorOpen}
        beer={editingBeerSeed}
        formKey={beerFormNonce}
        canAddSmallVariant={canAddSmallVariant}
        onClose={closeBeerEditor}
        onSubmit={submitBeerEditor}
        onRemove={
          editingBeerId
            ? () => removeBeer(editingBeerId)
            : undefined
        }
        onAddSmallVariant={
          canAddSmallVariant ? addSmallBeerVariant : undefined
        }
      />

      <HistoricalBeersSheet
        visible={historyOpen}
        beers={availableHistoricalBeers}
        priceCurrency={priceCurrency}
        canRestore={beers.length < MAX_BEERS}
        onRestore={restoreHistoricalBeer}
        onClose={() => setHistoryOpen(false)}
      />

      <ScanMenuSheet
        visible={scanSourceVisible}
        onClose={closeScanSheet}
        onPick={handlePickScanSource}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
    paddingHorizontal: 24,
    gap: 12,
  },
  header: {
    gap: 8,
    marginBottom: 8,
  },
  headerRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    textAlign: 'center',
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
    includeFontPadding: false,
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
  segment: {
    height: 40,
    flexDirection: 'row',
    padding: 2,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.04),
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.08),
  },
  segmentButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  segmentButtonSelected: {
    backgroundColor: withAlpha(Colors.foam, 0.1),
  },
  segmentLabel: {
    fontFamily: Fonts.display.bold,
    fontSize: 14,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  segmentLabelSelected: {
    color: Colors.foam,
  },
  card: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: Colors.stout2,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.07),
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 8,
  },
  pubName: {
    flexShrink: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
    includeFontPadding: false,
  },
  eyebrow: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  cardScroll: {
    flex: 1,
    marginTop: 16,
  },
  cardScrollContent: {
    paddingBottom: Spacing.sm,
  },
  hoursRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dayName: {
    flexShrink: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
  },
  hoursValue: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    fontFamily: Fonts.ui.medium,
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  hoursValueMultiple: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  hoursValueClosed: {
    color: Colors.closed,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.border, 0.4),
  },
  emptyText: {
    marginBottom: 8,
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  beerRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: Spacing.sm,
  },
  beerCopy: {
    flex: 1,
    minWidth: 0,
  },
  beerName: {
    flexShrink: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
  },
  beerMeta: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  addBeerRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addBeerLabel: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.amber,
    includeFontPadding: false,
  },
  cardFooter: {
    minHeight: 44,
    marginTop: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
    justifyContent: 'center',
  },
  footerFact: {
    flexShrink: 1,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  historyDoor: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
  },
  historyDoorLabel: {
    flexShrink: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.amber,
    includeFontPadding: false,
  },
  footerHint: {
    flexShrink: 1,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  pressed: {
    opacity: 0.6,
  },
});
