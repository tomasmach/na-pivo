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
  ScrollView,
  Pressable,
  TextInput,
  Platform,
  StyleSheet,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import {
  ChevronLeftIcon,
  PlusIcon,
  Trash2Icon,
  CopyIcon,
} from '@/components/shared/IconGlyph';
import { GlowButton } from '@/components/shared/GlowButton';
import { geohash8 } from '@/data/geohash';
import {
  DAY_KEYS,
  emptyWeeklyHours,
  isValidHoursInterval,
  type DayKey,
  type WeeklyHours,
  type HoursInterval,
} from '@/data/communityHours';
import { generateUuidV4 } from '@/data/account';
import { buildCommunityEntry, type CommunityBeer } from '@/data/communityClient';
import { enqueuePubCommunity, flushCommunityQueue } from '@/data/communityQueue';
import { suggestBeerBrands, type BeerBrandSuggestion } from '@/data/beerSuggestionsClient';
import { useCommunityStore } from '@/stores/communityStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToastStore } from '@/stores/toastStore';
import { fireSuccessHaptic } from '@/utils/haptics';
import {
  formatPriceInputFromCzk,
  parsePriceInputToCzk,
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

/** Coerce typed text toward an HH:MM shape without fighting the user: keep only
 *  digits, cap at 4, and insert the colon after the hour pair. */
function formatTimeInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
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

  // When the hub deep-links straight to a section ("piva"), scroll there once the
  // beers header has measured its position in the scroll content.
  const focus = parseStringParam(params.focus);
  const scrollRef = useRef<ScrollView>(null);
  const beersHeaderY = useRef(0);
  const didFocusScroll = useRef(false);
  const maybeFocusBeers = useCallback(() => {
    if (focus !== 'beers' || didFocusScroll.current) return;
    if (beersHeaderY.current <= 0) return;
    didFocusScroll.current = true;
    scrollRef.current?.scrollTo({ y: Math.max(beersHeaderY.current - 12, 0), animated: true });
  }, [focus]);

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

  const prefillBeers = useMemo<BeerRow[]>(() => {
    const fromParam = decodeJsonParam<CommunityBeer[] | null>(params.beers, null);
    const source = fromParam ?? storedOverride?.beers ?? [];
    return source.map((b) => ({
      id: nextBeerRowId(),
      name: b.name,
      priceText: typeof b.priceCzk === 'number' ? formatPriceInputFromCzk(b.priceCzk, priceCurrency) : '',
      volumeMl: b.volumeMl,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceCurrency]);

  const [hours, setHours] = useState<WeeklyHours>(prefillHours);
  const [beers, setBeers] = useState<BeerRow[]>(prefillBeers);
  const [hoursTouched, setHoursTouched] = useState(false);
  const [beersTouched, setBeersTouched] = useState(false);
  const [activeBeerId, setActiveBeerId] = useState<string | null>(null);
  const [beerSuggestions, setBeerSuggestions] = useState<BeerBrandSuggestion[]>([]);
  const [beerSuggestionsLoading, setBeerSuggestionsLoading] = useState(false);

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
        copy[which] = formatTimeInput(value);
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
    setBeers((prev) => [...prev, row]);
    setActiveBeerId(row.id);
  }, [beers.length]);

  const removeBeer = useCallback((index: number) => {
    setBeersTouched(true);
    setBeers((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateBeer = useCallback((index: number, patch: Partial<BeerRow>) => {
    setBeersTouched(true);
    setBeers((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  }, []);

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

  // Every typed interval must parse to HH:MM; empty days are fine (closed).
  const hoursValid = useMemo(
    () =>
      DAY_KEYS.every((day) =>
        hours[day].every((interval) => isValidHoursInterval(interval)),
      ),
    [hours],
  );

  // Clean the beer rows: drop empty names, parse prices, cap at MAX_BEERS.
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
        if (typeof b.volumeMl === 'number') out.volumeMl = b.volumeMl;
        return out;
      })
      .filter((b): b is CommunityBeer => b !== null)
      .slice(0, MAX_BEERS);
  }, [beers, priceCurrency]);

  const canSubmit = (hoursTouched || beersTouched) && hoursValid;

  const handleSubmit = useCallback(() => {
    const sendHours = hoursTouched;
    const sendBeers = beersTouched;
    if (!sendHours && !sendBeers) return;
    if (sendHours && !hoursValid) return;

    const entry = buildCommunityEntry(
      {
        externalId: pub.id || null,
        name: pub.name,
        lat: pub.lat,
        lng: pub.lng,
        city: pub.city,
        hours: sendHours ? hours : undefined,
        beers: sendBeers ? cleanedBeers : undefined,
      },
      generateUuidV4(),
    );

    // Optimistic local override so the edit shows instantly, even offline.
    setOverride(cell, {
      hours: sendHours ? hours : undefined,
      beers: sendBeers ? cleanedBeers : undefined,
    });

    // Fire-and-forget: the queue persists before the first send and retries.
    void enqueuePubCommunity(entry);
    void flushCommunityQueue();

    // No success screen: the edit already shows instantly via the optimistic
    // override, so just confirm with a haptic + toast and pop back to it.
    if (useSettingsStore.getState().hapticEnabled) fireSuccessHaptic();
    useToastStore.getState().show(cs.contribute.savedToast);
    router.back();
  }, [
    beersTouched,
    cell,
    cleanedBeers,
    hours,
    hoursTouched,
    hoursValid,
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

      <ScrollView
          ref={scrollRef}
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
            {cs.contribute.intro}
          </Text>

          {/* ── Otevírací doba ── */}
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

          {/* ── Piva na čepu ── */}
          <Text
            style={[styles.sectionHeader, styles.sectionHeaderSpaced]}
            maxFontSizeMultiplier={FontScaleCap.heading}
            onLayout={(e) => {
              beersHeaderY.current = e.nativeEvent.layout.y;
              maybeFocusBeers();
            }}
          >
            {cs.contribute.beersHeader}
          </Text>

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

          {!hoursValid && (
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
        </ScrollView>
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
              <TextInput
                style={styles.timeInput}
                value={iv[0]}
                onChangeText={(v) => onChangeTime(i, 0, v)}
                placeholder="11:00"
                placeholderTextColor={Colors.mutedText}
                keyboardType="number-pad"
                maxLength={5}
                accessibilityLabel={`${dayName} ${cs.contribute.from}`}
              />
              <Text style={styles.timeDash} maxFontSizeMultiplier={FontScaleCap.body}>
                –
              </Text>
              <TextInput
                style={styles.timeInput}
                value={iv[1]}
                onChangeText={(v) => onChangeTime(i, 1, v)}
                placeholder="23:00"
                placeholderTextColor={Colors.mutedText}
                keyboardType="number-pad"
                maxLength={5}
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
          keyboardType={priceCurrency === 'EUR' ? 'decimal-pad' : 'number-pad'}
          maxLength={priceCurrency === 'EUR' ? 6 : 4}
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
  timeInput: {
    backgroundColor: Colors.stout2,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.small,
    color: Colors.foam,
    fontFamily: Fonts.ui.medium,
    fontSize: 15,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 70,
    textAlign: 'center',
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
