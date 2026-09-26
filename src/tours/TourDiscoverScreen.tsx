import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, SearchIcon, XIcon } from '@/components/shared/IconGlyph';
import { checkLocationPermission, ensureLocationPermission } from '@/compass/permissions';
import { searchPublicTours, type PublicTourHit, type TourStopsFilter } from '@/data/toursClient';
import { useToursStore } from '@/stores/toursStore';
import { intlLocale, t } from '@/i18n';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { TourHeader, TourText, pubCount, ui } from './TourChrome';
import { formatWalkDistance } from './stopFacts';

type Position = { lat: number; lon: number };
type Results = { hits: PublicTourHit[]; nextPage: number | null; nearby: boolean };
const STOPS: TourStopsFilter[] = ['2-3', '4-5', '6-8'];
const FIX_TIMEOUT_MS = 3000;

/** One fix for "Kolem mě". Indoors a fresh fix can take ages, so after a few seconds the search goes on without it. */
async function readPosition(): Promise<Position | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS));
  const fix = (async () => {
    try {
      const found = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000, requiredAccuracy: 200 })
        ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced, mayShowUserSettingsDialog: false });
      const { latitude, longitude } = found.coords;
      return Number.isFinite(latitude) && Number.isFinite(longitude) ? { lat: latitude, lon: longitude } : null;
    } catch {
      return null;
    }
  })();
  return Promise.race([fix, timeout]);
}

/** Far tours need no decimals; "187,5 km" would not fit the tile. */
const tileDistance = (meters: number) => meters >= 10000 ? `${Math.round(meters / 1000).toLocaleString(intlLocale)} km` : formatWalkDistance(meters);
/** The server searches letters and digits only, so "!!" is no search at all. */
const searchTerm = (query: string) => /[\p{L}\p{N}].*[\p{L}\p{N}]/u.test(query.trim()) ? query.trim() : '';

function Chip({ label, active, busy, dropdown, accessibilityLabel, onPress }: {
  label: string; active: boolean; busy?: boolean; dropdown?: boolean; accessibilityLabel?: string; onPress: () => void;
}) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ selected: active, busy: !!busy }}
    hitSlop={{ top: 6, bottom: 6 }} style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}>
    {busy && <ActivityIndicator size="small" color={Colors.amber} />}
    <Text maxFontSizeMultiplier={FontScaleCap.body} numberOfLines={1} style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    {dropdown && <ChevronDownIcon size={14} color={active ? Colors.amber : Colors.mutedText} />}
  </Pressable>;
}

function Hit({ hit, first, onPress }: { hit: PublicTourHit; first: boolean; onPress: () => void }) {
  const distance = hit.distanceM === null ? null : tileDistance(hit.distanceM);
  const meta = t.tours.publicMeta(hit.city, pubCount(hit.stopCount), formatWalkDistance(hit.walkM));
  // Nobody yet is left out; the row stays one line and the tour detail says it anyway.
  const byline = [hit.author.nickname, hit.peopleCount > 0 ? t.tours.discoverPeople(hit.peopleCount) : null, hit.hasChallenges ? t.tours.discoverWithChallenges : null].filter(Boolean).join(' · ');
  return <Pressable onPress={onPress} accessibilityRole="button"
    accessibilityLabel={[hit.title, distance ? t.tours.discoverDistanceA11y(distance) : null, meta, byline].filter(Boolean).join('. ')}
    style={({ pressed }) => [styles.hit, first && styles.first, pressed && styles.pressed]}>
    {distance && <View style={styles.distance}>
      <Text maxFontSizeMultiplier={FontScaleCap.body} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={styles.distanceText}>{distance}</Text>
    </View>}
    <View style={ui.grow}>
      <TourText maxFontSizeMultiplier={FontScaleCap.heading} style={ui.stopName}>{hit.title}</TourText>
      <TourText style={ui.meta}>{meta}</TourText>
      <TourText style={styles.byline}>{byline}</TourText>
    </View>
    <ChevronRightIcon color={Colors.mutedText} size={18} />
  </Pressable>;
}

function StopsSheet({ value, onPick, onClose }: { value: TourStopsFilter | null; onPick: (value: TourStopsFilter | null) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const options: [TourStopsFilter | null, string][] = [[null, t.tours.discoverStopsAny], ...STOPS.map((stops) => [stops, t.tours.discoverStopsRange[stops]] as [TourStopsFilter, string])];
  return <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} accessibilityElementsHidden importantForAccessibility="no" />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.md) + Spacing.sm }]} accessibilityViewIsModal onAccessibilityEscape={onClose}>
        <View style={styles.grabber} />
        <Text accessibilityRole="header" maxFontSizeMultiplier={FontScaleCap.heading} style={styles.sheetTitle}>{t.tours.discoverStopsTitle}</Text>
        {/* A tap applies the choice and closes; there is nothing else to confirm. */}
        {options.map(([option, label], index) => <Pressable key={label} onPress={() => onPick(option)} accessibilityRole="button" accessibilityState={{ selected: option === value }}
          style={({ pressed }) => [styles.option, index === 0 && styles.first, pressed && styles.pressed]}>
          <Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.optionText}>{label}</Text>
          {option === value && <CheckIcon size={18} color={Colors.amber} />}
        </Pressable>)}
      </View>
    </View>
  </Modal>;
}

export default function TourDiscoverScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const hidden = useToursStore((s) => s.hiddenPublic);
  const input = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<Position | null>(null);
  const [locating, setLocating] = useState(false);
  const [noLocation, setNoLocation] = useState(false);
  const [stops, setStops] = useState<TourStopsFilter | null>(null);
  const [challenges, setChallenges] = useState(false);
  const [stopsSheet, setStopsSheet] = useState(false);
  const [response, setResponse] = useState<{ key: string; results: Results | null; failure: 'offline' | 'failed' | null } | null>(null);
  // The last list that loaded stays on screen while the next one is on its way, so typing does not blank it.
  const [shown, setShown] = useState<Results | null>(null);
  const [more, setMore] = useState(false);
  // 0 until the location check settles, so the first request already knows where the walker is.
  const [retry, setRetry] = useState(0);
  const term = searchTerm(query);
  const filtered = !!stops || challenges;
  const key = JSON.stringify([term, position, stops, challenges, retry]);
  // A page that arrives after the search changed belongs to the old list.
  const liveKey = useRef(key);
  useEffect(() => { liveKey.current = key; }, [key]);
  // Opened straight from a link, the store may not know yet which tours this phone reported.
  useEffect(() => { void useToursStore.getState().hydrate(); }, []);
  const current = response?.key === key ? response : null;
  const loading = retry === 0 || !current;
  const failure = current?.failure ?? null;
  const results = current ? current.results : loading ? shown : null;

  // With location already allowed, nearby tours come first; asking waits for a tap on "Kolem mě".
  useEffect(() => {
    let alive = true;
    void checkLocationPermission().then(async (state) => {
      const fix = state === 'granted' ? await readPosition() : null;
      if (alive && fix) setPosition(fix);
    }).finally(() => { if (alive) setRetry((r) => r + 1); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (retry === 0) return;
    let alive = true;
    const timer = setTimeout(() => {
      void searchPublicTours({ q: term, ...(position ?? {}), stops, challenges }).then((result) => {
        if (!alive) return;
        if (result.ok) {
          const loaded = { hits: result.results, nextPage: result.nextPage, nearby: result.nearby };
          setResponse({ key, results: loaded, failure: null });
          setShown(loaded);
        } else setResponse({ key, results: null, failure: result.offline ? 'offline' : 'failed' });
      });
    }, term ? 300 : 0);
    return () => { alive = false; clearTimeout(timer); };
  }, [key, term, position, stops, challenges, retry]);

  async function loadMore() {
    if (!current?.results?.nextPage || more) return;
    const asked = key;
    setMore(true);
    const result = await searchPublicTours({ q: term, ...(position ?? {}), stops, challenges, page: current.results.nextPage });
    setMore(false);
    if (!result.ok || liveKey.current !== asked) return;
    const grow = (list: Results): Results => ({ ...list, nextPage: result.nextPage,
      hits: [...list.hits, ...result.results.filter((hit) => !list.hits.some((old) => old.id === hit.id))] });
    setResponse((latest) => !latest?.results ? latest : { ...latest, results: grow(latest.results) });
    setShown((list) => list && grow(list));
  }

  async function nearMe() {
    if (position) { setPosition(null); return; }
    setLocating(true);
    // A second tap after a refusal leads to the system settings, the only place to change it.
    const state = await ensureLocationPermission({ openSettingsIfDenied: noLocation });
    const fix = state === 'granted' ? await readPosition() : null;
    setLocating(false);
    if (fix) { setNoLocation(false); setPosition(fix); return; }
    // Without a position the city field is the way to go.
    setNoLocation(true);
    input.current?.focus();
  }

  const clearFilters = () => { setStops(null); setChallenges(false); };
  const hits = (results?.hits ?? []).filter((hit) => !(hidden ?? []).includes(hit.id));
  const settled = !loading && !failure && !!results;
  const planOwn = async () => {
    const started = await useToursStore.getState().beginDraft();
    if (started.ok) router.push('/tours/edit' as Href);
  };
  const link = (label: string, onPress: () => void) => <Pressable onPress={onPress} accessibilityRole="button" style={styles.link}>
    <Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.linkText}>{label}</Text>
  </Pressable>;

  return <View style={[ui.screen, { paddingTop: insets.top }]}>
    <TourHeader title={t.tours.discoverTitle} onBack={() => router.canGoBack() ? router.back() : router.replace('/tours' as Href)} />
    <View style={styles.controls}>
      <View style={[ui.input, styles.field]}>
        <SearchIcon size={18} color={Colors.foamMuted} />
        <TextInput ref={input} value={query} onChangeText={setQuery} placeholder={t.tours.discoverPlaceholder} placeholderTextColor={withAlpha(Colors.foam, 0.55)}
          accessibilityLabel={t.tours.discoverOpen} style={styles.input} maxLength={60} autoCorrect={false} returnKeyType="search"
          onSubmitEditing={() => Keyboard.dismiss()} maxFontSizeMultiplier={FontScaleCap.body} />
        {!!query && <Pressable onPress={() => { setQuery(''); input.current?.focus(); }} accessibilityRole="button" accessibilityLabel={t.tours.discoverClear} style={styles.clear}>
          <XIcon size={18} color={Colors.foamMuted} />
        </Pressable>}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRail} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
        <Chip label={t.tours.discoverNearMe} active={!!position} busy={locating} onPress={() => { void nearMe(); }} />
        <Chip label={stops ? t.tours.discoverStopsRange[stops] : t.tours.discoverStops} active={!!stops} dropdown
          accessibilityLabel={stops ? t.tours.discoverStopsA11y(t.tours.discoverStopsRange[stops]) : t.tours.discoverStops}
          onPress={() => { Keyboard.dismiss(); setStopsSheet(true); }} />
        <Chip label={t.tours.discoverChallenges} active={challenges} onPress={() => setChallenges((on) => !on)} />
      </ScrollView>
      {noLocation && !position && !query && <TourText style={ui.notice}>{t.tours.discoverNoLocation}</TourText>}
    </View>
    <FlatList data={failure ? [] : hits} keyExtractor={(hit) => hit.id} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + Spacing.xl }]}
      renderItem={({ item, index }) => <Hit hit={item} first={index === 0} onPress={() => router.push(`/t/${item.token}` as Href)} />}
      onEndReachedThreshold={0.5} onEndReached={() => { void loadMore(); }}
      ListHeaderComponent={<View accessibilityLiveRegion="polite">
        {loading && <View style={styles.status}><ActivityIndicator color={Colors.amber} />{!results && <TourText style={ui.notice}>{t.tours.loading}</TourText>}</View>}
        {failure && <View style={styles.message}>
          <TourText>{failure === 'offline' ? t.tours.discoverOffline : t.tours.discoverFailed}</TourText>
          {link(t.tours.retry, () => setRetry((r) => r + 1))}
        </View>}
        {settled && !results.nearby && hits.length > 0 && <View style={styles.message}>
          <TourText>{filtered ? t.tours.discoverNothingNearFiltered : t.tours.discoverNothingNear}</TourText>
          {filtered && link(t.tours.discoverClearFilters, clearFilters)}
        </View>}
        {settled && hits.length === 0 && <View style={styles.message}>
          <TourText>{term ? t.tours.discoverNothingFor(term) : filtered ? t.tours.discoverNothingFiltered : t.tours.discoverNothing}</TourText>
          {filtered ? link(t.tours.discoverClearFilters, clearFilters) : !term && link(t.tours.discoverPlanOwn, () => { void planOwn(); })}
        </View>}
      </View>}
      ListFooterComponent={more ? <ActivityIndicator style={styles.more} color={Colors.amber} />
        : settled && !results.nearby && hits.length > 0 ? link(t.tours.discoverPlanOwn, () => { void planOwn(); }) : null} />
    {stopsSheet && <StopsSheet value={stops} onClose={() => setStopsSheet(false)} onPick={(value) => { setStops(value); setStopsSheet(false); }} />}
  </View>;
}

const styles = StyleSheet.create({
  controls: { paddingHorizontal: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.sm },
  field: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 0, paddingRight: 0 },
  input: { flex: 1, minWidth: 0, minHeight: 46, color: Colors.foam, fontSize: 16 },
  clear: { width: HitArea.min, height: HitArea.min, alignItems: 'center', justifyContent: 'center' },
  // The rail runs to the screen edges so a chip scrolled aside is not cut at the margin.
  chipRail: { marginHorizontal: -Spacing.lg },
  chips: { gap: Spacing.sm, paddingVertical: Spacing.xs, paddingHorizontal: Spacing.lg },
  chip: { height: 32, paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, borderRadius: Radius.pill,
    backgroundColor: Colors.stout2, borderWidth: 1, borderColor: 'transparent' },
  chipActive: { borderColor: withAlpha(Colors.amber, 0.5) },
  chipText: { fontSize: 13, fontWeight: '600', color: Colors.mutedText },
  chipTextActive: { color: Colors.amber },
  list: { paddingHorizontal: Spacing.lg },
  hit: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(Colors.foam, 0.1) },
  first: { borderTopWidth: 0 },
  distance: { width: 56, minHeight: 44, borderRadius: Radius.small, backgroundColor: Colors.stout2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xs },
  distanceText: { fontSize: 13, fontWeight: '700', color: Colors.foam, textAlign: 'center' },
  byline: { fontSize: 12, lineHeight: 18, color: Colors.mutedText, marginTop: 2 },
  status: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  message: { gap: Spacing.xs, paddingVertical: Spacing.lg },
  link: { minHeight: HitArea.min, justifyContent: 'center', alignSelf: 'flex-start' },
  linkText: { fontSize: 14, fontWeight: '800', color: Colors.amber },
  more: { paddingVertical: Spacing.lg },
  pressed: { opacity: 0.65 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: withAlpha(Colors.black, 0.6) },
  sheet: { backgroundColor: Colors.stout, borderTopLeftRadius: Radius.cardLarge, borderTopRightRadius: Radius.cardLarge, paddingTop: Spacing.sm, paddingHorizontal: Spacing.lg },
  grabber: { alignSelf: 'center', width: 44, height: 4, borderRadius: Radius.pill, backgroundColor: withAlpha(Colors.foam, 0.22), marginBottom: Spacing.md },
  sheetTitle: { fontSize: 21, lineHeight: 27, fontWeight: '700', letterSpacing: -0.4, color: Colors.foam, marginBottom: Spacing.sm },
  option: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(Colors.foam, 0.1) },
  optionText: { fontSize: 16, color: Colors.foam },
});
