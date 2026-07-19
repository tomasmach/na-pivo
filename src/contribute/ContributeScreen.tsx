/**
 * Contribute screen — lets the user fill in a pub's opening hours and the beers
 * on tap. Both sections are independently editable; only the touched parts are
 * submitted. On submit it writes an optimistic local override (so the edit shows
 * instantly, even offline), enqueues the contribution fire-and-forget (the queue
 * persists + retries), then pops straight back — a haptic + toast confirm the
 * save, since the override already shows the edit on the screen underneath.
 *
 * The pub to describe arrives via router params (JSON-string-encoded fields).
 * Prefill comes from the enriched pub's communityHours/beers, threaded through
 * the same params, or the local override store.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  InteractionManager,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import {
  ChevronLeftIcon,
  PlusIcon,
  Trash2Icon,
  CopyIcon,
  CompassIcon,
  CameraIcon,
  SparklesIcon,
  CheckIcon,
  SearchIcon,
  InfoIcon,
  ClockIcon,
  HistoryIcon,
} from '@/components/shared/IconGlyph';
import { GlowButton } from '@/components/shared/GlowButton';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { ScanMenuButton } from '@/components/contribute/ScanMenuButton';
import { ScanMenuSheet, type MenuScanSource } from '@/components/contribute/ScanMenuSheet';
import { geohash8 } from '@/data/geohash';
import {
  DAY_KEYS,
  emptyWeeklyHours,
  isAllowedBeerVolume,
  historicalBeersAfterMenuReplacement,
  isSameBeerIdentity,
  normalizeBeerName,
  normalizeEditableHhMm,
  normalizeEditableHoursInterval,
  type DayKey,
  type WeeklyHours,
  type HoursInterval,
} from '@/data/communityHours';
import type { MenuPhotoSource } from '@/data/menuPhotoPicker';
import { scanMenuPhoto } from '@/data/menuScanClient';
import { generateUuidV4 } from '@/data/account';
import { buildCommunityEntry, type CommunityBeer } from '@/data/communityClient';
import { enqueuePubCommunity } from '@/data/communityQueue';
import { suggestBeerBrands, type BeerBrandSuggestion } from '@/data/beerSuggestionsClient';
import { useCommunityStore } from '@/stores/communityStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToastStore } from '@/stores/toastStore';
import { useAccountStore } from '@/stores/accountStore';
import { fireSuccessHaptic } from '@/utils/haptics';
import {
  formatPriceInputFromCzk,
  formatPrice,
  parsePriceInputToCzk,
  currencyFractionDigits,
  pricePlaceholder,
  sanitizePriceInput,
  type PriceCurrency,
} from '@/utils/currency';

/** Volumes the backend accepts; the picker offers the two common ones + "jiné". */
const VOLUME_SMALL = 300;
const VOLUME_DEFAULT = 500;
const MAX_BEERS = 12;
const MAX_INTERVALS = 3;
let beerRowIdSequence = 0;

/** Editable beer row — strings while typing, parsed on submit. */
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

/** Convert a scanned/community beer into a fresh editable row. */
function communityBeerToRow(beer: CommunityBeer, priceCurrency: PriceCurrency): BeerRow {
  return {
    id: nextBeerRowId(),
    name: beer.name,
    priceText:
      typeof beer.priceCzk === 'number' ? formatPriceInputFromCzk(beer.priceCzk, priceCurrency) : '',
    volumeMl: beer.volumeMl,
  };
}

/**
 * Fold OCR-extracted beers into the editor's current rows, mirroring
 * mergeBeerIntoMenu's rule (dedup by normalized name + volume, refresh the price
 * on a match, append new rows up to MAX_BEERS). Existing rows and their ids are
 * preserved so in-progress edits survive the merge. Returns the next rows plus
 * how many beers were actually pulled in (appended OR price-updated) for the toast.
 */
function mergeScannedIntoRows(
  rows: BeerRow[],
  scanned: readonly CommunityBeer[],
  priceCurrency: PriceCurrency,
): { rows: BeerRow[]; count: number } {
  let next = rows;
  let count = 0;
  for (const beer of scanned) {
    if (!normalizeBeerName(beer.name)) continue;
    const idx = next.findIndex((r) => isSameBeerIdentity(r, beer));
    if (idx >= 0) {
      // Same name+volume already present → refresh its price when the scan has one.
      if (typeof beer.priceCzk === 'number') {
        const priceText = formatPriceInputFromCzk(beer.priceCzk, priceCurrency);
        if (next[idx].priceText !== priceText) {
          next = next.map((r, i) => (i === idx ? { ...r, priceText } : r));
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

function sanitizeTimePart(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 2);
}

function splitTimeInput(value: string): [string, string] {
  const [hours = '', minutes = ''] = value.split(':');
  return [sanitizeTimePart(hours), sanitizeTimePart(minutes)];
}

function withTimePart(value: string, which: 0 | 1, part: string): string {
  const next = splitTimeInput(value);
  next[which] = sanitizeTimePart(part);
  return `${next[0]}:${next[1]}`;
}

function parseFloatParam(value: string | string[] | undefined): number {
  const v = Array.isArray(value) ? value[0] : value;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseStringParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

/** Decode a JSON-encoded param, returning fallback on any failure. */
function decodeJsonParam<T>(value: string | string[] | undefined, fallback: T): T {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
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
    [params.id, params.name, params.lat, params.lng, params.city],
  );

  // The hub deep-links to ONE section ("hours" / "beers"); render only that one
  // so the editor matches what the user tapped. No focus param (e.g. the compass
  // beers line, or a legacy entry) → the full both-sections editor.
  const focus = parseStringParam(params.focus);
  const showHours = focus !== 'beers';
  const showBeers = focus !== 'hours';

  const cell = useMemo(() => geohash8(pub.lat, pub.lng), [pub.lat, pub.lng]);
  const setOverride = useCommunityStore((s) => s.setOverride);
  const storedOverride = useCommunityStore((s) => s.overrides[cell]);
  const priceCurrency = useSettingsStore((s) => s.priceCurrency);

  // Prefill: prefer params (from the enriched pub), then the local override.
  const prefillHours = useMemo<WeeklyHours>(() => {
    const fromParam = decodeJsonParam<WeeklyHours | null>(params.hours, null);
    return fromParam ?? storedOverride?.hours ?? emptyWeeklyHours();
    // params/storedOverride are read once at mount; the form owns state after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initialCurrentBeers = useMemo<CommunityBeer[]>(() => {
    const fromParam = decodeJsonParam<CommunityBeer[] | null>(params.beers, null);
    return fromParam ?? storedOverride?.beers ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prefillBeers = useMemo<BeerRow[]>(
    () => initialCurrentBeers.map((beer) => communityBeerToRow(beer, priceCurrency)),
    [initialCurrentBeers, priceCurrency],
  );

  const historicalBeers = useMemo<CommunityBeer[]>(
    () => decodeJsonParam<CommunityBeer[]>(params.historicalBeers, []),
    // History is a server-owned restore source; the form owns current rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [hours, setHours] = useState<WeeklyHours>(prefillHours);
  const [beers, setBeers] = useState<BeerRow[]>(prefillBeers);
  const [hoursTouched, setHoursTouched] = useState(false);
  const [beersTouched, setBeersTouched] = useState(false);
  const [activeBeerId, setActiveBeerId] = useState<string | null>(null);
  const [beerSuggestions, setBeerSuggestions] = useState<BeerBrandSuggestion[]>([]);
  const [beerSuggestionsLoading, setBeerSuggestionsLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanSourceVisible, setScanSourceVisible] = useState(false);
  const beersRef = useRef(beers);

  useEffect(() => {
    beersRef.current = beers;
  }, [beers]);

  // Deep-linked from the counter's add-beer form ("vyfoť celý lístek"): open the
  // scan source sheet so the user lands one tap from the camera. Deferred until
  // the push transition (and the counter's dismissing form modal) settles — iOS
  // won't reliably present a Modal mid-transition.
  useEffect(() => {
    if (parseStringParam(params.autoScan) !== '1') return;
    const task = InteractionManager.runAfterInteractions(() => setScanSourceVisible(true));
    return () => task.cancel();
    // one-shot on mount — params never change for a mounted editor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Hours editing ─────────────────────────────────────────────────────────

  const updateDay = useCallback((day: DayKey, intervals: HoursInterval[]) => {
    setHoursTouched(true);
    setHours((prev) => ({ ...prev, [day]: intervals }));
  }, []);

  const toggleClosed = useCallback(
    (day: DayKey) => {
      const isClosed = hours[day].length === 0;
      updateDay(day, isClosed ? [['11:00', '23:00']] : []);
    },
    [hours, updateDay],
  );

  const addInterval = useCallback(
    (day: DayKey) => {
      if (hours[day].length >= MAX_INTERVALS) return;
      updateDay(day, [...hours[day], ['11:00', '23:00']]);
    },
    [hours, updateDay],
  );

  const removeInterval = useCallback(
    (day: DayKey, index: number) => {
      updateDay(
        day,
        hours[day].filter((_, i) => i !== index),
      );
    },
    [hours, updateDay],
  );

  const setIntervalValue = useCallback(
    (day: DayKey, index: number, which: 0 | 1, value: string) => {
      const next = hours[day].map((iv, i) => {
        if (i !== index) return iv;
        const copy: HoursInterval = [iv[0], iv[1]];
        copy[which] = value;
        return copy;
      });
      updateDay(day, next);
    },
    [hours, updateDay],
  );

  const copyMondayToAll = useCallback(() => {
    setHoursTouched(true);
    setHours((prev) => {
      const monday = prev.mo.map((iv): HoursInterval => [iv[0], iv[1]]);
      const next = { ...prev };
      for (const day of DAY_KEYS) {
        next[day] = monday.map((iv): HoursInterval => [iv[0], iv[1]]);
      }
      return next;
    });
  }, []);

  // ── Beers editing ─────────────────────────────────────────────────────────

  const addBeer = useCallback(() => {
    if (beers.length >= MAX_BEERS) return;
    setBeersTouched(true);
    const row = { id: nextBeerRowId(), name: '', priceText: '', volumeMl: VOLUME_DEFAULT };
    setBeers((prev) => {
      const next = [...prev, row];
      beersRef.current = next;
      return next;
    });
    setActiveBeerId(row.id);
  }, [beers.length]);

  const removeBeer = useCallback((index: number) => {
    setBeersTouched(true);
    setBeers((prev) => {
      const next = prev.filter((_, i) => i !== index);
      beersRef.current = next;
      return next;
    });
  }, []);

  const updateBeer = useCallback((index: number, patch: Partial<BeerRow>) => {
    setBeersTouched(true);
    setBeers((prev) => {
      const next = prev.map((b, i) => (i === index ? { ...b, ...patch } : b));
      beersRef.current = next;
      return next;
    });
  }, []);

  const addSmallBeerVariant = useCallback((index: number) => {
    const source = beers[index];
    if (!source || beers.length >= MAX_BEERS) return;
    const name = source.name.trim();
    if (!name) return;
    const exists = beers.some(
      (beer, i) =>
        i !== index &&
        normalizeBeerName(beer.name) === normalizeBeerName(name) &&
        beer.volumeMl === VOLUME_SMALL,
    );
    if (exists) return;

    setBeersTouched(true);
    const row: BeerRow = {
      id: nextBeerRowId(),
      name,
      priceText: '',
      volumeMl: VOLUME_SMALL,
    };
    setBeers((prev) => {
      const insertAt = Math.min(index + 1, prev.length);
      const next = [...prev.slice(0, insertAt), row, ...prev.slice(insertAt)];
      beersRef.current = next;
      return next;
    });
    setActiveBeerId(row.id);
  }, [beers]);

  const availableHistoricalBeers = useMemo(
    () =>
      historicalBeers.filter(
        (historical) => !beers.some((beer) => isSameBeerIdentity(beer, historical)),
      ),
    [beers, historicalBeers],
  );

  const restoreHistoricalBeer = useCallback(
    (beer: CommunityBeer) => {
      if (beersRef.current.length >= MAX_BEERS) return;
      const row = communityBeerToRow(beer, priceCurrency);
      setBeersTouched(true);
      setBeers((previous) => {
        if (previous.some((current) => isSameBeerIdentity(current, beer))) return previous;
        const next = [...previous, row];
        beersRef.current = next;
        return next;
      });
    },
    [priceCurrency],
  );

  // ── Scan menu (AI OCR prefill) ───────────────────────────────────────────--
  // Pick/snap a menu photo, upload it to the OCR helper, then MERGE the extracted
  // beers into the current rows for the user to review. Never auto-submits — the
  // existing Save button still does the real write.

  // Guards against a double-fire: the source sheet's rows stay tappable through
  // its fade-out, and `scanning` only flips true after the picker resolves — so a
  // synchronous ref is what actually prevents two concurrent pickers/uploads.
  const scanInFlightRef = useRef(false);

  const runScan = useCallback(
    async (source: MenuPhotoSource) => {
      if (scanInFlightRef.current) return;
      scanInFlightRef.current = true;
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
          toast(cs.contribute.scanMenu.errorToast, {
            icon: <InfoIcon size={18} color={Colors.foamMuted} />,
          });
          return;
        }

        setScanning(true);
        const result = await scanMenuPhoto(picked.uri);
        switch (result.status) {
          case 'ok': {
            // Merge against the latest committed rows so edits made during the
            // multi-second scan are not clobbered by the pre-scan render.
            const { rows, count } = mergeScannedIntoRows(beersRef.current, result.beers, priceCurrency);
            if (count > 0) {
              beersRef.current = rows;
              setBeers(rows);
              setBeersTouched(true);
              fireSuccessHaptic();
              toast(cs.contribute.scanMenu.successToast(count), {
                icon: <SparklesIcon size={18} color={Colors.amber} />,
              });
            } else {
              // Everything found was already in the list (or the list was full).
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

  // Stable so the memoized ScanMenuSheet does not re-render on every form keystroke.
  const closeScanSheet = useCallback(() => setScanSourceVisible(false), []);

  const activeBeer = useMemo(
    () => beers.find((beer) => beer.id === activeBeerId) ?? null,
    [activeBeerId, beers],
  );

  useEffect(() => {
    const query = activeBeer?.name.trim() ?? '';
    if (!activeBeer || query.length < 2) {
      const reset = setTimeout(() => {
        setBeerSuggestions([]);
        setBeerSuggestionsLoading(false);
      }, 0);
      return () => clearTimeout(reset);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      if (!controller.signal.aborted) setBeerSuggestionsLoading(true);
      suggestBeerBrands(query, controller.signal, 6)
        .then((items) => {
          if (!controller.signal.aborted) setBeerSuggestions(items);
        })
        .finally(() => {
          if (!controller.signal.aborted) setBeerSuggestionsLoading(false);
        });
    }, 220);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [activeBeer]);

  // ── Validation + submit ───────────────────────────────────────────────────

  // Accept natural shorthand such as 0:00 in the editor, but always persist the
  // canonical HH:MM contract. Empty days remain valid and mean closed.
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
  const hoursValid = normalizedHours !== null;

  // Clean the beer rows into the exact shape the write endpoint accepts: drop
  // empty names, cap at MAX_BEERS, and only keep values within the endpoint's
  // bounds. parsePriceInputToCzk already nulls out prices outside 1–1000, and we
  // drop any volume not in the allowed set (a menu scan can surface 250/700/750)
  // so a single bad value can never turn the whole contribution into a permanent
  // 400 that the retry queue re-sends on every launch.
  const cleanedBeers = useMemo<CommunityBeer[]>(() => {
    return beers
      .map((b): CommunityBeer | null => {
        const name = b.name.trim();
        if (!name) return null;
        const out: CommunityBeer = { name: name.slice(0, 80) };
        const priceCzk = parsePriceInputToCzk(b.priceText, priceCurrency);
        if (priceCzk !== null) {
          out.priceCzk = priceCzk;
        }
        if (isAllowedBeerVolume(b.volumeMl)) out.volumeMl = b.volumeMl;
        return out;
      })
      .filter((b): b is CommunityBeer => b !== null)
      .slice(0, MAX_BEERS);
  }, [beers, priceCurrency]);

  // Hours validity only blocks the submit when the hours section is actually
  // shown — a beers-only editor must never be gated by (hidden) prefill hours.
  const canSubmit = (hoursTouched || beersTouched) && (!showHours || hoursValid);

  const handleSubmit = useCallback(() => {
    const sendHours = hoursTouched;
    const sendBeers = beersTouched;
    if (!sendHours && !sendBeers) return;
    if (sendHours && !normalizedHours) return;
    const submittedHours: WeeklyHours | undefined = sendHours
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

    // Optimistic local override so the edit shows instantly, even offline.
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

    // Fire-and-forget: the queue persists before the first send and retries. Its
    // resolved value carries the Mapér XP envelope when delivery succeeds, so a
    // first-time hours/beers contribution nudges Mapér progress + a +XP toast
    // (the same lifetime-achievement reward amenity votes earn).
    void enqueuePubCommunity(entry).then((res) => {
      if (!res) return;
      if (res.mapper) {
        useAccountStore.getState().applyMapperSnapshot({
          xp: res.mapper.xp,
          level: res.mapper.level,
          title: res.mapper.title,
          xpIntoLevel: res.mapper.xp_into_level,
          xpForNextLevel: res.mapper.xp_for_next_level,
          distinctMappedPubs: res.mapper.distinct_mapped_pubs,
          amenityVotesCount: res.mapper.amenity_votes_count,
          firstMapperCount: res.mapper.first_mapper_count,
          completedPubsCount: res.mapper.completed_pubs_count,
        });
      }
      if (res.xpAwarded > 0) {
        useToastStore.getState().show(cs.contribute.xpToast(res.xpAwarded), {
          icon: <CompassIcon size={18} color={Colors.amber} />,
        });
      }
    });

    // No success screen: the edit already shows instantly via the optimistic
    // override, so just confirm with a haptic + toast and pop back to it.
    if (useSettingsStore.getState().hapticEnabled) fireSuccessHaptic();
    useToastStore.getState().show(cs.contribute.savedToast);
    router.back();
  }, [
    beersTouched,
    cell,
    cleanedBeers,
    hoursTouched,
    historicalBeers,
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.backButton}
          hitSlop={4}
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

      {/* Android is edge-to-edge, so `adjustResize` no longer pushes content
          above the keyboard — pad it here (iOS pads via keyboard insets below). */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding" enabled={Platform.OS === 'android'}>
      <KeyboardAwareScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom + 24, 32) },
          ]}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {pub.name ? (
            <Text style={styles.pubName} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.heading}>
              {pub.name}
            </Text>
          ) : null}
          <Text style={styles.intro} maxFontSizeMultiplier={FontScaleCap.body}>
            {showHours && showBeers
              ? cs.contribute.intro
              : showHours
                ? cs.contribute.introHours
                : cs.contribute.introBeers}
          </Text>

          {/* ── Otevírací doba ── */}
          {showHours && (
            <>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeader} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {cs.contribute.hoursHeader}
                </Text>
                <Pressable
                  onPress={copyMondayToAll}
                  style={styles.copyButton}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={cs.a11y.contributeCopyToAll}
                >
                  <CopyIcon size={14} color={Colors.amber} />
                  <Text style={styles.copyButtonText} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.contribute.copyToAll}
                  </Text>
                </Pressable>
              </View>

              {DAY_KEYS.map((day) => (
                <DayRow
                  key={day}
                  day={day}
                  intervals={hours[day]}
                  onToggleClosed={() => toggleClosed(day)}
                  onAddInterval={() => addInterval(day)}
                  onRemoveInterval={(i) => removeInterval(day, i)}
                  onChangeTime={(i, which, value) => setIntervalValue(day, i, which, value)}
                />
              ))}
            </>
          )}

          {/* ── Piva na čepu ── */}
          {showBeers && (
            <>
              <Text
                style={[styles.sectionHeader, showHours && styles.sectionHeaderSpaced]}
                maxFontSizeMultiplier={FontScaleCap.heading}
              >
                {cs.contribute.beersHeader}
              </Text>
              <Text style={styles.beersLifecycleHint} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.contribute.beersLifecycleHint}
              </Text>

              <ScanMenuButton scanning={scanning} onPress={handleScanMenu} />

              {beers.map((beer, index) => (
                <BeerRowView
                  key={beer.id}
                  beer={beer}
                  onFocusName={() => setActiveBeerId(beer.id)}
                  onChangeName={(name) => {
                    setActiveBeerId(beer.id);
                    setBeerSuggestions([]);
                    setBeerSuggestionsLoading(name.trim().length >= 2);
                    updateBeer(index, { name });
                  }}
                  suggestions={activeBeerId === beer.id ? beerSuggestions : []}
                  suggesting={activeBeerId === beer.id && beerSuggestionsLoading}
                  onSelectSuggestion={(suggestion) => {
                    setBeerSuggestions([]);
                    setBeerSuggestionsLoading(false);
                    setActiveBeerId(null);
                    updateBeer(index, { name: suggestion.name });
                  }}
                  onChangePrice={(priceText) =>
                    updateBeer(index, { priceText: sanitizePriceInput(priceText, priceCurrency) })
                  }
                  onChangeVolume={(volumeMl) => updateBeer(index, { volumeMl })}
                  canAddSmallVariant={
                    beers.length < MAX_BEERS &&
                    !!beer.name.trim() &&
                    beer.volumeMl !== VOLUME_SMALL &&
                    !beers.some(
                      (other, otherIndex) =>
                        otherIndex !== index &&
                        normalizeBeerName(other.name) === normalizeBeerName(beer.name) &&
                        other.volumeMl === VOLUME_SMALL,
                    )
                  }
                  onAddSmallVariant={() => addSmallBeerVariant(index)}
                  onRemove={() => removeBeer(index)}
                  priceCurrency={priceCurrency}
                />
              ))}

              {beers.length < MAX_BEERS ? (
                <Pressable
                  onPress={addBeer}
                  style={styles.addRow}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={cs.a11y.contributeAddBeer}
                >
                  <PlusIcon size={16} color={Colors.amber} />
                  <Text style={styles.addRowText} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.contribute.addBeer}
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.maxHint} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.contribute.maxBeersReached}
                </Text>
              )}

              {availableHistoricalBeers.length > 0 && (
                <View style={styles.historicalSection}>
                  <View style={styles.historicalHeaderRow}>
                    <HistoryIcon size={15} color={Colors.mutedText} />
                    <Text
                      style={styles.historicalHeader}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {cs.contribute.historicalBeersHeader}
                    </Text>
                  </View>
                  <Text style={styles.historicalHint} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.contribute.historicalBeersHint}
                  </Text>
                  <View style={styles.historicalList}>
                    {availableHistoricalBeers.map((beer) => {
                      const detail = [
                        beer.volumeMl ? `${(beer.volumeMl / 1000).toLocaleString('cs-CZ')} l` : null,
                        typeof beer.priceCzk === 'number'
                          ? formatPrice(beer.priceCzk, priceCurrency)
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ');
                      return (
                        <Pressable
                          key={`${normalizeBeerName(beer.name)}:${beer.volumeMl ?? ''}`}
                          onPress={() => restoreHistoricalBeer(beer)}
                          disabled={beers.length >= MAX_BEERS}
                          style={({ pressed }) => [
                            styles.historicalBeer,
                            pressed && styles.historicalBeerPressed,
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={cs.a11y.contributeRestoreHistoricalBeer(beer.name)}
                        >
                          <View style={styles.historicalBeerCopy}>
                            <Text
                              style={styles.historicalBeerName}
                              numberOfLines={1}
                              maxFontSizeMultiplier={FontScaleCap.body}
                            >
                              {beer.name}
                            </Text>
                            {detail ? (
                              <Text
                                style={styles.historicalBeerDetail}
                                maxFontSizeMultiplier={FontScaleCap.body}
                              >
                                {detail}
                              </Text>
                            ) : null}
                          </View>
                          <PlusIcon size={16} color={Colors.amber} />
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}
            </>
          )}

          {showHours && !hoursValid && (
            <Text style={styles.invalidHint} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.contribute.invalidHint}
            </Text>
          )}

          {/* ── Submit ── */}
          <View style={styles.submitButton}>
            <GlowButton
              label={cs.contribute.save}
              onPress={handleSubmit}
              glow={canSubmit ? 'soft' : 'none'}
              accessibilityLabel={cs.a11y.contributeSaveButton}
            />
            {!canSubmit && <View style={styles.submitDisabledOverlay} />}
          </View>
        </KeyboardAwareScrollView>
        </KeyboardAvoidingView>

        <ScanMenuSheet
          visible={scanSourceVisible}
          onClose={closeScanSheet}
          onPick={handlePickScanSource}
        />
    </View>
  );
}

// ─── Day row ──────────────────────────────────────────────────────────────────

interface DayRowProps {
  day: DayKey;
  intervals: HoursInterval[];
  onToggleClosed: () => void;
  onAddInterval: () => void;
  onRemoveInterval: (index: number) => void;
  onChangeTime: (index: number, which: 0 | 1, value: string) => void;
}

function DayRow({
  day,
  intervals,
  onToggleClosed,
  onAddInterval,
  onRemoveInterval,
  onChangeTime,
}: DayRowProps) {
  const dayName = cs.contribute.days[day];
  const isClosed = intervals.length === 0;

  return (
    <View style={styles.dayRow}>
      <View style={styles.dayHeaderRow}>
        <Text style={styles.dayName} maxFontSizeMultiplier={FontScaleCap.body}>
          {dayName}
        </Text>
        <Pressable
          onPress={onToggleClosed}
          style={[styles.closedPill, isClosed && styles.closedPillActive]}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityState={{ selected: isClosed }}
          accessibilityLabel={cs.a11y.contributeDayClosedToggle(dayName)}
        >
          <Text
            style={[styles.closedPillText, isClosed && styles.closedPillTextActive]}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {cs.contribute.closedToggle}
          </Text>
        </Pressable>
      </View>

      {!isClosed && (
        <View style={styles.intervalsWrap}>
          {intervals.map((iv, i) => (
            <View key={i} style={styles.intervalRow}>
              <SplitTimeInput
                value={iv[0]}
                onChange={(v) => onChangeTime(i, 0, v)}
                hourPlaceholder="11"
                minutePlaceholder="00"
                accessibilityLabel={`${dayName} ${cs.contribute.from}`}
              />
              <Text style={styles.timeDash} maxFontSizeMultiplier={FontScaleCap.body}>
                –
              </Text>
              <SplitTimeInput
                value={iv[1]}
                onChange={(v) => onChangeTime(i, 1, v)}
                hourPlaceholder="23"
                minutePlaceholder="00"
                accessibilityLabel={`${dayName} ${cs.contribute.to}`}
              />
              <Pressable
                onPress={() => onRemoveInterval(i)}
                style={styles.iconButton}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={cs.a11y.contributeRemoveInterval(dayName)}
              >
                <Trash2Icon size={16} color={Colors.mutedText} />
              </Pressable>
            </View>
          ))}
          {intervals.length < MAX_INTERVALS && (
            <Pressable
              onPress={onAddInterval}
              style={styles.addRowSmall}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={cs.a11y.contributeAddInterval(dayName)}
            >
              <PlusIcon size={14} color={Colors.amber} />
              <Text style={styles.addRowSmallText} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.contribute.addInterval}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Beer row ─────────────────────────────────────────────────────────────────

interface BeerRowViewProps {
  beer: BeerRow;
  suggestions: BeerBrandSuggestion[];
  suggesting: boolean;
  onFocusName: () => void;
  onChangeName: (name: string) => void;
  onSelectSuggestion: (suggestion: BeerBrandSuggestion) => void;
  onChangePrice: (price: string) => void;
  onChangeVolume: (volumeMl: number | undefined) => void;
  onRemove: () => void;
  priceCurrency: PriceCurrency;
  canAddSmallVariant: boolean;
  onAddSmallVariant: () => void;
}

const VOLUME_OPTIONS: { value: number | undefined; labelKey: 'volumeSmall' | 'volumeLarge' | 'volumeOther' }[] = [
  { value: VOLUME_SMALL, labelKey: 'volumeSmall' },
  { value: VOLUME_DEFAULT, labelKey: 'volumeLarge' },
  { value: undefined, labelKey: 'volumeOther' },
];

function BeerRowView({
  beer,
  suggestions,
  suggesting,
  onFocusName,
  onChangeName,
  onSelectSuggestion,
  onChangePrice,
  onChangeVolume,
  onRemove,
  priceCurrency,
  canAddSmallVariant,
  onAddSmallVariant,
}: BeerRowViewProps) {
  const placeholder = pricePlaceholder(priceCurrency);

  return (
    <View style={styles.beerRow}>
      <View style={styles.beerTopRow}>
        <TextInput
          style={styles.beerNameInput}
          value={beer.name}
          onFocus={onFocusName}
          onChangeText={onChangeName}
          placeholder={cs.contribute.beerNamePlaceholder}
          placeholderTextColor={Colors.mutedText}
          maxLength={80}
          accessibilityLabel={cs.contribute.beerNamePlaceholder}
        />
        <Pressable
          onPress={onRemove}
          style={styles.iconButton}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.contributeRemoveBeer}
        >
          <Trash2Icon size={16} color={Colors.mutedText} />
        </Pressable>
      </View>
      {(suggestions.length > 0 || suggesting) && (
        <View style={styles.suggestionsWrap}>
          {suggestions.map((suggestion) => (
            <Pressable
              key={suggestion.slug}
              onPress={() => onSelectSuggestion(suggestion)}
              style={styles.suggestionPill}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={suggestion.name}
            >
              <Text style={styles.suggestionPillText} maxFontSizeMultiplier={FontScaleCap.body}>
                {suggestion.name}
              </Text>
            </Pressable>
          ))}
          {suggesting && suggestions.length === 0 ? (
            <Text style={styles.suggestingText} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.contribute.beerSuggestionsLoading}
            </Text>
          ) : null}
        </View>
      )}
      <View style={styles.beerBottomRow}>
        <TextInput
          style={styles.priceInput}
          value={beer.priceText}
          onChangeText={onChangePrice}
          placeholder={placeholder}
          placeholderTextColor={Colors.mutedText}
          keyboardType={currencyFractionDigits(priceCurrency) > 0 ? 'decimal-pad' : 'number-pad'}
          maxLength={currencyFractionDigits(priceCurrency) > 0 ? 10 : 7}
          accessibilityLabel={placeholder}
        />
        <View style={styles.volumeGroup}>
          {VOLUME_OPTIONS.map((opt) => {
            const selected = beer.volumeMl === opt.value;
            return (
              <Pressable
                key={opt.labelKey}
                onPress={() => onChangeVolume(opt.value)}
                style={[styles.volumePill, selected && styles.volumePillSelected]}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={cs.contribute[opt.labelKey]}
              >
                <Text
                  style={[styles.volumePillText, selected && styles.volumePillTextSelected]}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {cs.contribute[opt.labelKey]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {canAddSmallVariant && (
        <Pressable
          onPress={onAddSmallVariant}
          style={styles.smallVariantButton}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={cs.contribute.addSmallBeer}
        >
          <PlusIcon size={14} color={Colors.amber} />
          <Text style={styles.smallVariantButtonText} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.contribute.addSmallBeer}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function SplitTimeInput({
  value,
  onChange,
  hourPlaceholder,
  minutePlaceholder,
  accessibilityLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  hourPlaceholder: string;
  minutePlaceholder: string;
  accessibilityLabel: string;
}) {
  const [hours, minutes] = splitTimeInput(value);

  return (
    <View style={styles.splitTimeInput}>
      <TextInput
        style={styles.timePartInput}
        value={hours}
        onChangeText={(part) => onChange(withTimePart(value, 0, part))}
        onBlur={() => {
          const normalized = normalizeEditableHhMm(value);
          if (normalized && normalized !== value) onChange(normalized);
        }}
        placeholder={hourPlaceholder}
        placeholderTextColor={Colors.mutedText}
        keyboardType="number-pad"
        maxLength={2}
        selectTextOnFocus
        accessibilityLabel={`${accessibilityLabel} hodiny`}
      />
      <Text style={styles.timeColon} maxFontSizeMultiplier={FontScaleCap.body}>
        :
      </Text>
      <TextInput
        style={styles.timePartInput}
        value={minutes}
        onChangeText={(part) => onChange(withTimePart(value, 1, part))}
        onBlur={() => {
          const normalized = normalizeEditableHhMm(value);
          if (normalized && normalized !== value) onChange(normalized);
        }}
        placeholder={minutePlaceholder}
        placeholderTextColor={Colors.mutedText}
        keyboardType="number-pad"
        maxLength={2}
        selectTextOnFocus
        accessibilityLabel={`${accessibilityLabel} minuty`}
      />
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.stout },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    color: Colors.foam,
  },
  headerSpacer: { width: 44, height: 44 },

  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  pubName: {
    fontFamily: Fonts.display.bold,
    fontSize: 18,
    color: Colors.foam,
    marginBottom: 4,
  },
  intro: {
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    color: Colors.foamMuted,
    lineHeight: 14 * 1.5,
    marginBottom: Spacing.lg,
  },

  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: Spacing.sm,
  },
  sectionHeader: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
  },
  sectionHeaderSpaced: {
    marginTop: Spacing.xl,
    marginBottom: Spacing.md,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
  },
  copyButtonText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    color: Colors.amber,
  },

  // ── Day row ──
  dayRow: {
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.medium,
    padding: 12,
    marginBottom: 10,
  },
  dayHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dayName: {
    fontFamily: Fonts.ui.bold,
    fontSize: 15,
    color: Colors.foam,
    flexShrink: 1,
  },
  closedPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  closedPillActive: {
    backgroundColor: Colors.amber,
    borderColor: Colors.amber,
  },
  closedPillText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    color: Colors.foamMuted,
  },
  closedPillTextActive: {
    color: Colors.stout,
  },
  intervalsWrap: {
    marginTop: 10,
    gap: 8,
  },
  intervalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  splitTimeInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.stout2,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.small,
    paddingHorizontal: 8,
    minWidth: 78,
    minHeight: 42,
  },
  timePartInput: {
    width: 24,
    color: Colors.foam,
    fontFamily: Fonts.ui.medium,
    fontSize: 15,
    paddingVertical: 8,
    textAlign: 'center',
  },
  timeColon: {
    fontFamily: Fonts.ui.bold,
    fontSize: 15,
    color: Colors.foamMuted,
    paddingBottom: 1,
  },
  timeDash: {
    fontFamily: Fonts.ui.regular,
    fontSize: 16,
    color: Colors.foamMuted,
  },
  iconButton: {
    marginLeft: 'auto',
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addRowSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  addRowSmallText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.amber,
  },

  // ── Beer row ──
  beersLifecycleHint: {
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.foamMuted,
    marginTop: -4,
    marginBottom: 12,
  },
  beerRow: {
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.medium,
    padding: 12,
    marginBottom: 10,
    gap: 10,
  },
  beerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  beerNameInput: {
    flex: 1,
    backgroundColor: Colors.stout2,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.small,
    color: Colors.foam,
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  suggestionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  suggestionPill: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.amber,
  },
  suggestionPillText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.amber,
  },
  suggestingText: {
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    color: Colors.mutedText,
    paddingVertical: 7,
  },
  beerBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  priceInput: {
    backgroundColor: Colors.stout2,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.small,
    color: Colors.foam,
    fontFamily: Fonts.ui.medium,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 92,
  },
  volumeGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    flexShrink: 1,
  },
  volumePill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  volumePillSelected: {
    backgroundColor: Colors.amber,
    borderColor: Colors.amber,
  },
  volumePillText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.foamMuted,
  },
  volumePillTextSelected: {
    color: Colors.stout,
  },
  smallVariantButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.36),
  },
  smallVariantButtonText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.amber,
  },

  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    marginBottom: Spacing.md,
  },
  addRowText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.amber,
  },
  maxHint: {
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    color: Colors.mutedText,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  historicalSection: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  historicalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  historicalHeader: {
    fontFamily: Fonts.ui.bold,
    fontSize: 13,
    color: Colors.foamMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  historicalHint: {
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    color: Colors.mutedText,
    lineHeight: 18,
    marginTop: 5,
    marginBottom: 10,
  },
  historicalList: {
    gap: 7,
  },
  historicalBeer: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
  },
  historicalBeerPressed: {
    borderColor: withAlpha(Colors.amber, 0.55),
    backgroundColor: withAlpha(Colors.amber, 0.08),
  },
  historicalBeerCopy: {
    flex: 1,
    minWidth: 0,
  },
  historicalBeerName: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.foam,
  },
  historicalBeerDetail: {
    fontFamily: Fonts.ui.regular,
    fontSize: 12,
    color: Colors.mutedText,
    marginTop: 2,
  },
  invalidHint: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.closed,
    textAlign: 'center',
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
  },

  submitButton: {
    position: 'relative',
    marginTop: Spacing.lg,
  },
  submitDisabledOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: Colors.stout,
    opacity: 0.55,
    borderRadius: Radius.pill,
  },
});
