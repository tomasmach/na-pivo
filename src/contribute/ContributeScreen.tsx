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
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { leaveRoute } from '@/navigation/leaveRoute';

import { HistoricalBeersSheet } from '@/components/contribute/HistoricalBeersSheet';
import { SplitTimeInput } from '@/components/contribute/SplitTimeInput';
import { showAppDialog } from '@/components/shared/AppDialog';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
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
  CopyIcon,
  InfoIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
  Trash2Icon,
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
import { showMenuScanPermissionBlocked } from '@/contribute/menuScanPermission';
import { menuPhotoPickFeedback, menuScanFailureCopy } from '@/contribute/menuScanFeedback';
import { enqueuePubCommunity } from '@/data/communityQueue';
import { geohash8 } from '@/data/geohash';
import type { MenuPhotoSource } from '@/data/menuPhotoPicker';
import { scanMenuPhoto } from '@/data/menuScanClient';
import { t, formatVolume } from '@/i18n';
import { useAccountStore } from '@/stores/accountStore';
import { useCommunityStore } from '@/stores/communityStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import {
  formatPrice,
  formatPriceInputFromCzk,
  parsePriceInputToCzk,
  type PriceCurrency,
} from '@/utils/currency';
import { fireSuccessHaptic } from '@/utils/haptics';

const VOLUME_SMALL = 300;
const MAX_BEERS = 12;
const MAX_INTERVALS = 3;
const DEFAULT_INTERVAL: HoursInterval = ['11:00', '23:00'];
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
  if (volume) return `${volume} · ${t.contribute.priceMissing}`;
  if (price) return `${t.contribute.volumeMissing} · ${price}`;
  return t.contribute.volumeMissing;
}

// ─── Inline day row (opening hours) ──────────────────────────────────────────

interface HoursDayRowProps {
  day: DayKey;
  intervals: HoursInterval[];
  divider: boolean;
  onToggleClosed: () => void;
  onAddInterval: () => void;
  onRemoveInterval: (index: number) => void;
  onChangeTime: (index: number, which: 0 | 1, value: string) => void;
}

/** One tight row per day. Closed → a quiet "Zavřeno" that opens the day in one
 *  tap. Open → compact HH:MM chips on the day's own line; a second interval wraps
 *  to a right-aligned sub-line. The trash removes an interval (removing the last
 *  one closes the day); a small "+" on the last interval adds another. */
function HoursDayRow({
  day,
  intervals,
  divider,
  onToggleClosed,
  onAddInterval,
  onRemoveInterval,
  onChangeTime,
}: HoursDayRowProps) {
  const dayName = t.contribute.days[day];
  const isClosed = intervals.length === 0;
  const canAdd = intervals.length < MAX_INTERVALS;

  return (
    <View style={[styles.dayRow, divider && styles.rowDivider]}>
      <View
        style={[
          styles.dayDot,
          { backgroundColor: isClosed ? Colors.closed : Colors.open },
        ]}
      />
      <Text
        style={styles.dayName}
        numberOfLines={1}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {dayName}
      </Text>

      {isClosed ? (
        <Pressable
          onPress={onToggleClosed}
          hitSlop={8}
          style={({ pressed }) => [styles.closedLabelWrap, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityState={{ selected: true }}
          accessibilityLabel={t.a11y.contributeDayClosedToggle(dayName)}
        >
          <Text style={styles.closedLabel} maxFontSizeMultiplier={FontScaleCap.body}>
            {t.contribute.closedToggle}
          </Text>
        </Pressable>
      ) : (
        intervals.map((interval, index) => {
          const isLast = index === intervals.length - 1;
          return (
            <View
              key={index}
              style={index === 0 ? styles.intervalInline : styles.intervalSubline}
            >
              <SplitTimeInput
                value={interval[0]}
                onChange={(value) => onChangeTime(index, 0, value)}
                accessibilityLabel={`${dayName} ${t.contribute.from}`}
              />
              <Text style={styles.timeDash} maxFontSizeMultiplier={FontScaleCap.body}>
                -
              </Text>
              <SplitTimeInput
                value={interval[1]}
                onChange={(value) => onChangeTime(index, 1, value)}
                accessibilityLabel={`${dayName} ${t.contribute.to}`}
              />
              <Pressable
                onPress={() => onRemoveInterval(index)}
                hitSlop={6}
                style={({ pressed }) => [styles.timeIcon, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={t.a11y.contributeRemoveInterval(dayName)}
              >
                <Trash2Icon size={15} color={Colors.mutedText} />
              </Pressable>
              {isLast && canAdd ? (
                <Pressable
                  onPress={onAddInterval}
                  hitSlop={6}
                  style={({ pressed }) => [styles.timeIcon, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={t.a11y.contributeAddInterval(dayName)}
                >
                  <PlusIcon size={16} color={Colors.amber} />
                </Pressable>
              ) : (
                <View style={styles.timeIcon} />
              )}
            </View>
          );
        })
      )}
    </View>
  );
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

  const initialBeerMenuRotates = useMemo(() => {
    const fromParam = parseStringParam(params.beerMenuRotates);
    return fromParam ? fromParam === '1' : storedOverride?.beerMenuRotates === true;
    // The form owns this value after mount, like the beer rows above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [hours, setHours] = useState<WeeklyHours>(prefillHours);
  const [beers, setBeers] = useState<BeerRow[]>(prefillBeers);
  const [hoursTouched, setHoursTouched] = useState(false);
  const [beersTouched, setBeersTouched] = useState(false);
  const [beerMenuRotates, setBeerMenuRotates] = useState(initialBeerMenuRotates);
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

  const chooseBeerMenuType = useCallback((rotates: boolean) => {
    setBeerMenuRotates(rotates);
    setBeersTouched(true);
  }, []);

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

  const toggleClosed = useCallback((day: DayKey) => {
    setHoursTouched(true);
    setHours((previous) => ({
      ...previous,
      // One tap flips the whole day: closed → a default 11–23, open → closed.
      [day]: previous[day].length === 0 ? [[...DEFAULT_INTERVAL]] : [],
    }));
  }, []);

  const addInterval = useCallback((day: DayKey) => {
    setHoursTouched(true);
    setHours((previous) =>
      previous[day].length >= MAX_INTERVALS
        ? previous
        : { ...previous, [day]: [...previous[day], [...DEFAULT_INTERVAL]] },
    );
  }, []);

  const removeInterval = useCallback((day: DayKey, index: number) => {
    setHoursTouched(true);
    setHours((previous) => ({
      ...previous,
      [day]: previous[day].filter((_, i) => i !== index),
    }));
  }, []);

  const setIntervalValue = useCallback(
    (day: DayKey, index: number, which: 0 | 1, value: string) => {
      setHoursTouched(true);
      setHours((previous) => ({
        ...previous,
        [day]: previous[day].map((interval, i) => {
          if (i !== index) return interval;
          const next: HoursInterval = [interval[0], interval[1]];
          next[which] = value;
          return next;
        }),
      }));
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

  const removeBeer = useCallback((id: string) => {
    setBeersTouched(true);
    setBeers((previous) => {
      const next = previous.filter((beer) => beer.id !== id);
      beersRef.current = next;
      return next;
    });
  }, []);

  const canAddSmallVariant = useCallback(
    (beer: BeerRow) => {
      if (beers.length >= MAX_BEERS) return false;
      const name = beer.name.trim();
      if (!name || beer.volumeMl === VOLUME_SMALL) return false;
      return !beers.some(
        (candidate) =>
          candidate.id !== beer.id &&
          normalizeBeerName(candidate.name) === normalizeBeerName(name) &&
          candidate.volumeMl === VOLUME_SMALL,
      );
    },
    [beers],
  );

  const addSmallBeerVariant = useCallback(
    (beer: BeerRow) => {
      if (!canAddSmallVariant(beer)) return;
      const row: BeerRow = {
        id: nextBeerRowId(),
        name: beer.name.trim(),
        priceText: '',
        volumeMl: VOLUME_SMALL,
      };
      setBeersTouched(true);
      setBeers((previous) => {
        const sourceIndex = previous.findIndex(
          (candidate) => candidate.id === beer.id,
        );
        if (sourceIndex < 0 || previous.length >= MAX_BEERS) return previous;
        const alreadyHasSmallVariant = previous.some(
          (candidate) =>
            candidate.id !== beer.id &&
            normalizeBeerName(candidate.name) === normalizeBeerName(beer.name) &&
            candidate.volumeMl === VOLUME_SMALL,
        );
        if (alreadyHasSmallVariant) return previous;
        const insertAt = sourceIndex + 1;
        const next = [
          ...previous.slice(0, insertAt),
          row,
          ...previous.slice(insertAt),
        ];
        beersRef.current = next;
        return next;
      });
    },
    [canAddSmallVariant],
  );

  const confirmRemoveBeer = useCallback(
    (beer: BeerRow) => {
      showAppDialog({
        title: t.contribute.removeBeer,
        buttons: [
          { text: t.common.cancel, style: 'cancel' },
          {
            text: t.contribute.removeBeer,
            style: 'destructive',
            onPress: () => removeBeer(beer.id),
          },
        ],
      });
    },
    [removeBeer],
  );

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
      // Set this before handing control to the native picker. When the user
      // confirms a large camera photo, preprocessing can take a moment; the
      // editor must already show that the scan is alive as soon as it returns.
      setScanning(true);
      const toast = useToastStore.getState().show;

      try {
        const { pickAndPrepareMenuPhoto } = await import(
          '@/data/menuPhotoPicker'
        );
        const picked = await pickAndPrepareMenuPhoto(source);
        const pickFeedback = menuPhotoPickFeedback(picked.status, source);
        if (pickFeedback.action === 'cancel') return;
        if (pickFeedback.action === 'settings') {
          showMenuScanPermissionBlocked(source);
          return;
        }
        if (pickFeedback.action === 'toast') {
          toast(pickFeedback.message, {
            icon:
              picked.status === 'denied'
                ? <CameraIcon size={18} color={Colors.amber} />
                : <InfoIcon size={18} color={Colors.foamMuted} />,
          });
          return;
        }
        if (picked.status !== 'picked') return;

        const result = await scanMenuPhoto(picked.uri);
        if (result.status === 'ok') {
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
            toast(t.contribute.scanMenu.successToast(count), {
              icon: <SparklesIcon size={18} color={Colors.amber} />,
            });
          } else {
            toast(t.contribute.scanMenu.nothingNewToast, {
              icon: <CheckIcon size={18} color={Colors.amber} />,
            });
          }
          return;
        }
        const FailureIcon =
          result.status === 'empty'
            ? SearchIcon
            : result.status === 'daily-cap' || result.status === 'rate-limited'
              ? ClockIcon
              : result.status === 'bad-image'
                ? CameraIcon
                : InfoIcon;
        toast(menuScanFailureCopy(result.status), {
          icon: (
            <FailureIcon
              size={18}
              color={result.status === 'bad-image' ? Colors.amber : Colors.foamMuted}
            />
          ),
        });
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
        beerMenuRotates: sendBeers ? beerMenuRotates : undefined,
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
      beerMenuRotates: sendBeers ? beerMenuRotates : undefined,
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
          .show(t.contribute.xpToast(response.xpAwarded), {
            icon: <CompassIcon size={18} color={Colors.amber} />,
          });
      }
    });

    if (useSettingsStore.getState().hapticEnabled) {
      fireSuccessHaptic();
    }
    useToastStore.getState().show(t.contribute.savedToast);
    leaveRoute(router);
  }, [
    beersTouched,
    beerMenuRotates,
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
      ? t.contribute.hoursOpenNow(openStateTime)
      : t.contribute.hoursOpenNoChange
    : openStateTime
      ? t.contribute.hoursClosedNow(openStateTime)
      : t.contribute.hoursClosedNoChange;

  // "Stejně celý týden" copies the first day that has hours onto every day.
  const firstOpenDay = useMemo<DayKey | null>(
    () => DAY_KEYS.find((day) => hours[day].length > 0) ?? null,
    [hours],
  );

  const nudge = useMemo<Nudge | null>(() => {
    if (hoursTouched && invalidDay) {
      return {
        kind: 'counted',
        text: t.contribute.invalidDayNudge(
          t.contribute.daysAt[invalidDay],
        ),
        undoLabel: t.contribute.fix,
        actionAccessibilityLabel: t.contribute.fixHoursA11y,
        onUndo: () => {
          setSection('hours');
        },
      };
    }
    if (scanning) {
      return {
        kind: 'dopito',
        label: t.contribute.scanningNudge,
        onPress: () => undefined,
      };
    }
    if (section === 'beers' && beers.length >= MAX_BEERS) {
      return {
        kind: 'dopito',
        label: t.contribute.maxBeersNudge,
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
          paddingTop: insets.top,
          paddingBottom: Math.max(insets.bottom, Spacing.sm),
        },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => leaveRoute(router)}
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.pressed,
            ]}
            hitSlop={2}
            accessibilityRole="button"
            accessibilityLabel={t.a11y.backButton}
          >
            <ChevronLeftIcon size={22} color={Colors.foam} />
          </Pressable>
          <Text
            style={styles.headerTitle}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.heading}
          >
            {t.contribute.title}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.segment}>
          {(['hours', 'beers'] as const).map((value) => {
            const selected = section === value;
            const label =
              value === 'hours'
                ? t.contribute.hoursTab
                : t.contribute.beersTab;
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
          {pub.name || t.contribute.unknownPub}
        </Text>

        <KeyboardAwareScrollView
          style={styles.cardScroll}
          contentContainerStyle={styles.cardScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {section === 'hours'
            ? DAY_KEYS.map((day, index) => (
                <HoursDayRow
                  key={day}
                  day={day}
                  intervals={hours[day]}
                  divider={index > 0}
                  onToggleClosed={() => toggleClosed(day)}
                  onAddInterval={() => addInterval(day)}
                  onRemoveInterval={(i) => removeInterval(day, i)}
                  onChangeTime={(i, which, value) =>
                    setIntervalValue(day, i, which, value)
                  }
                />
              ))
            : (
              <>
                <View style={styles.menuTypeCard}>
                  <View style={styles.menuTypeTitleRow}>
                    <RefreshCwIcon
                      size={16}
                      color={beerMenuRotates ? Colors.amber : Colors.foamMuted}
                    />
                    <Text style={styles.menuTypeLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                      {t.contribute.beerMenuTypeLabel}
                    </Text>
                  </View>
                  <View style={styles.menuTypeSegment}>
                    {([false, true] as const).map((rotates) => {
                      const selected = beerMenuRotates === rotates;
                      const label = rotates
                        ? t.contribute.beerMenuRotating
                        : t.contribute.beerMenuFixed;
                      return (
                        <Pressable
                          key={String(rotates)}
                          onPress={() => chooseBeerMenuType(rotates)}
                          style={[
                            styles.menuTypeOption,
                            rotates && styles.menuTypeOptionRight,
                            selected && styles.menuTypeOptionSelected,
                          ]}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          accessibilityLabel={t.a11y.contributeBeerMenuType(label)}
                        >
                          <Text
                            style={[
                              styles.menuTypeOptionText,
                              selected && styles.menuTypeOptionTextSelected,
                            ]}
                            numberOfLines={1}
                            maxFontSizeMultiplier={FontScaleCap.body}
                          >
                            {label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={styles.menuTypeHint} maxFontSizeMultiplier={FontScaleCap.body}>
                    {beerMenuRotates
                      ? t.contribute.beerMenuRotatingHint
                      : t.contribute.beerMenuFixedHint}
                  </Text>
                </View>

                {beers.length === 0 ? (
                  <Text
                    style={styles.emptyText}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {t.contribute.beersEmpty}
                  </Text>
                ) : (
                  beers.map((beer, index) => (
                    <View
                      key={beer.id}
                      style={[styles.beerRow, index > 0 && styles.rowDivider]}
                    >
                      <Pressable
                        onPress={() => openBeer(beer.id)}
                        style={({ pressed }) => [styles.beerEdit, pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel={t.contribute.editBeerA11y(
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
                        <ChevronRightIcon size={15} color={Colors.mutedText} />
                      </Pressable>
                      {canAddSmallVariant(beer) ? (
                        <Pressable
                          onPress={() => addSmallBeerVariant(beer)}
                          style={({ pressed }) => [
                            styles.beerSmallAction,
                            pressed && styles.pressed,
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={t.contribute.addSmallBeer}
                        >
                          <PlusIcon size={15} color={Colors.amber} />
                          <Text
                            style={styles.beerSmallActionLabel}
                            maxFontSizeMultiplier={FontScaleCap.body}
                          >
                            {formatVolume(VOLUME_SMALL)}
                          </Text>
                        </Pressable>
                      ) : null}
                      <Pressable
                        onPress={() => confirmRemoveBeer(beer)}
                        style={({ pressed }) => [styles.beerRowAction, pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel={t.a11y.contributeRemoveBeer}
                      >
                        <Trash2Icon size={17} color={Colors.mutedText} />
                      </Pressable>
                    </View>
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
                    accessibilityLabel={t.a11y.contributeAddBeer}
                  >
                    <PlusIcon size={16} color={Colors.amber} />
                    <Text
                      style={styles.addBeerLabel}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {t.contribute.addBeer}
                    </Text>
                  </Pressable>
                ) : null}
              </>
            )}
        </KeyboardAwareScrollView>

        <View style={styles.cardFooter}>
          {section === 'hours' ? (
            <View style={styles.hoursFooterRow}>
              <Text
                style={[
                  styles.footerFact,
                  {
                    color: openState.isOpenNow ? Colors.open : Colors.closed,
                  },
                ]}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {hoursFooter}
              </Text>
              {firstOpenDay ? (
                <Pressable
                  onPress={() => copyDayToAll(firstOpenDay)}
                  hitSlop={8}
                  style={({ pressed }) => [styles.copyWeek, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={t.a11y.contributeCopyToAll}
                >
                  <CopyIcon size={14} color={Colors.mutedText} />
                  <Text
                    style={styles.copyWeekLabel}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {t.contribute.copyWeek}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : availableHistoricalBeers.length > 0 ? (
            <Pressable
              onPress={() => setHistoryOpen(true)}
              style={({ pressed }) => [
                styles.historyDoor,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={t.contribute.historicalBeersDoor(
                availableHistoricalBeers.length,
              )}
            >
              <Text
                style={styles.historyDoorLabel}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {t.contribute.historicalBeersDoor(
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
              {t.contribute.beersLifecycleHintShort}
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
            ? t.contribute.scanningNudge
            : undefined
        }
      >
        <NudgeSlot nudge={nudge} />
      </View>

      <CounterCta
        label={t.contribute.save}
        subLabel={t.contribute.publicSubmitHint}
        onPress={handleSubmit}
        disabled={!canSubmit}
        accessibilityLabel={t.a11y.contributeSaveButton}
      />

      {section === 'beers' ? (
        <CounterSecondary
          label={t.contribute.scanMenuSecondary}
          onPress={handleScanMenu}
          accessibilityLabel={t.contribute.scanMenuSecondary}
        />
      ) : null}

      <MenuBeerSheet
        visible={beerEditorOpen}
        beer={editingBeerSeed}
        formKey={beerFormNonce}
        onClose={closeBeerEditor}
        onSubmit={submitBeerEditor}
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
    marginBottom: 4,
  },
  headerRow: {
    minHeight: 40,
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
    fontWeight: '800',
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
    fontWeight: '700',
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
    fontWeight: '800',
    fontSize: 18,
    color: Colors.foam,
    includeFontPadding: false,
  },
  cardScroll: {
    flex: 1,
    marginTop: 16,
  },
  cardScrollContent: {
    paddingBottom: Spacing.sm,
  },
  dayRow: {
    minHeight: 46,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 5,
  },
  dayDot: {
    width: 8,
    height: 8,
    borderRadius: Radius.pill,
  },
  dayName: {
    flex: 1,
    minWidth: 0,
    fontWeight: '600',
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
  },
  closedLabelWrap: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  closedLabel: {
    fontWeight: '600',
    fontSize: 14,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  intervalInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  intervalSubline: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    marginTop: 6,
  },
  timeDash: {
    fontWeight: '400',
    fontSize: 14,
    color: Colors.foamMuted,
    includeFontPadding: false,
    marginHorizontal: -1,
  },
  timeIcon: {
    width: 28,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.border, 0.4),
  },
  emptyText: {
    marginBottom: 8,
    fontWeight: '400',
    fontSize: 14,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  menuTypeCard: {
    marginBottom: Spacing.sm,
    padding: 12,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.24),
    borderRadius: Radius.medium,
    backgroundColor: Colors.stout3,
  },
  menuTypeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 10,
  },
  menuTypeLabel: {
    fontWeight: '700',
    fontSize: 14,
    color: Colors.foam,
  },
  menuTypeSegment: {
    flexDirection: 'row',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
  },
  menuTypeOption: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  menuTypeOptionRight: {
    borderLeftWidth: 1,
    borderLeftColor: Colors.border,
  },
  menuTypeOptionSelected: {
    backgroundColor: Colors.amber,
  },
  menuTypeOptionText: {
    fontWeight: '700',
    fontSize: 13,
    color: Colors.foamMuted,
  },
  menuTypeOptionTextSelected: {
    color: Colors.stout,
  },
  menuTypeHint: {
    marginTop: 9,
    fontWeight: '400',
    fontSize: 12,
    lineHeight: 17,
    color: Colors.mutedText,
  },
  beerRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  beerEdit: {
    flex: 1,
    minWidth: 0,
    minHeight: HitArea.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  beerRowAction: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  beerSmallAction: {
    minHeight: HitArea.min,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 6,
  },
  beerSmallActionLabel: {
    fontWeight: '600',
    fontSize: 12,
    color: Colors.amber,
  },
  beerCopy: {
    flex: 1,
    minWidth: 0,
  },
  beerName: {
    flexShrink: 1,
    fontWeight: '600',
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
  },
  beerMeta: {
    marginTop: 2,
    fontWeight: '500',
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
    fontWeight: '600',
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
  hoursFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  footerFact: {
    flexShrink: 1,
    fontWeight: '500',
    fontSize: 13,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  copyWeek: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  copyWeekLabel: {
    fontWeight: '600',
    fontSize: 12.5,
    color: Colors.mutedText,
    includeFontPadding: false,
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
    fontWeight: '600',
    fontSize: 15,
    color: Colors.amber,
    includeFontPadding: false,
  },
  footerHint: {
    flexShrink: 1,
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  pressed: {
    opacity: 0.6,
  },
});
