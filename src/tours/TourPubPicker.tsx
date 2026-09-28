import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, BackHandler, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useIsFocused, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Region } from 'react-native-maps';
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, SearchIcon, XIcon } from '@/components/shared/IconGlyph';
import { haversineMeters } from '@/compass/distance';
import { checkLocationPermission } from '@/compass/permissions';
import type { Pub } from '@/data/pubs';
import { openPubPage } from '@/pubPage/openPubPage';
import { pubPageRef, usePubPageStore } from '@/stores/pubPageStore';
import { cachedTourPubs, filterTourPubs, searchTourPubs, type TourPubSearchResult } from '@/data/tourPubSearch';
import { t } from '@/i18n';
import { usePubStore } from '@/stores/pubStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { fireLightImpactHaptic } from '@/utils/haptics';
import { useKeyboardHeight } from '@/utils/useKeyboardHeight';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { samePub, type TourStop } from './model';
import { geohash8 } from '@/data/geohash';
import { TourMap, tourRegion } from './TourMap';
import { pubCount } from './TourChrome';
import { planDay, pubHoursOnDay, walkingLeg } from './stopFacts';

const MAX_STOPS = 8;
/** What makes two places the same pub, without minting a stop id for every row. */
const pubIdentity = (pub: Pub) => ({ pubId: pub.id, cacheKey: geohash8(pub.lat, pub.lng), name: pub.name });
/** Suggestions after the last stop stay within a walk; farther pubs still come up by search. */
const NEAR_METERS = 3000;

const NEARBY_LIMIT = 50;

export interface TourPubPickerProps {
  visible: boolean;
  stops: readonly TourStop[];
  /** The meetup day decides which opening hours the rows show. */
  scheduledDate?: string | null;
  /** Adds the pub, or takes it out when it is already a stop. Resolves whether the tour changed. */
  onToggle: (pub: Pub) => Promise<boolean>;
  /** Replacing one stop is a single pick that closes the picker. */
  onReplace: (pub: Pub) => void;
  onClose: () => void;
  replaceStop?: TourStop | null;
}

export function TourPubPicker(props: TourPubPickerProps) {
  return props.visible ? <TourPubPickerContent {...props} /> : null;
}

function TourPubPickerContent({ stops, scheduledDate, onToggle, onReplace, onClose, replaceStop }: TourPubPickerProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // The map no longer scrolls away, so even expanded it leaves room for the list and the button.
  const expandedMapHeight = Math.min(420, Math.round(useWindowDimensions().height / 2));
  const focused = useIsFocused();
  const [query, setQuery] = useState('');
  const [pubs, setPubs] = useState<Pub[]>([]);
  const reportedPubIds = usePubStore((state) => state.reportedPubIds);
  const reportedCacheKeys = usePubStore((state) => state.reportedCacheKeys);
  const [status, setStatus] = useState<TourPubSearchResult['status']>('ok');
  const [loading, setLoading] = useState(false);
  const [region, setRegion] = useState<Region>(() => tourRegion(stops));
  // Without a typed name, the pubs nearest the middle of the map come first and follow it as you pan.
  const browsing = query.trim().length < 2;
  const allowed = useMemo(() => filterTourPubs(pubs, { reportedPubIds, reportedCacheKeys }), [pubs, reportedCacheKeys, reportedPubIds]);
  const visiblePubs = useMemo(() => {
    if (!browsing) return allowed;
    const center = { lat: region.latitude, lng: region.longitude };
    return allowed.map((pub) => ({ pub, meters: haversineMeters(center, pub) }))
      .sort((a, b) => a.meters - b.meters).slice(0, NEARBY_LIMIT).map(({ pub }) => pub);
  }, [allowed, browsing, region.latitude, region.longitude]);
  const list = useRef<ScrollView>(null);
  // A moved map reorders the list, so show its new nearest pubs from the top.
  useEffect(() => {
    if (browsing) list.current?.scrollTo({ y: 0, animated: false });
  }, [browsing, region.latitude, region.longitude]);
  const [previewCandidate, setPreview] = useState<Pub | null>(null);
  const visiblePreview = previewCandidate && filterTourPubs([previewCandidate], { reportedPubIds, reportedCacheKeys }).length ? previewCandidate : null;
  // A rename made on the pub page must reach the stop that gets added.
  const pagePub = usePubPageStore((state) => (visiblePreview ? state.pubs[pubPageRef(visiblePreview)] : undefined));
  const preview = useMemo(() => (visiblePreview && pagePub && pagePub.id === visiblePreview.id && pagePub.name !== visiblePreview.name
    ? { ...visiblePreview, name: pagePub.name } : visiblePreview), [pagePub, visiblePreview]);
  const keyboardHeight = useKeyboardHeight();
  const keyboardVisible = keyboardHeight > 0;
  // An area search is about that area, not about the walk from the last stop.
  const [areaSearch, setAreaSearch] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const strip = useRef<ScrollView>(null);
  // Nearby rows reorder around each new stop; a second tap landing on the new top row must not add it by accident.
  const settling = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (settling.current) clearTimeout(settling.current); }, []);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);
  const [mapExpanded, setMapExpanded] = useState(false);
  const request = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const viewport = useRef(region);
  const beforePreview = useRef<Region | null>(null);
  const currentStops = useRef(stops);
  useEffect(() => { currentStops.current = stops; }, [stops]);
  const moveMap = useCallback((next: Region) => { viewport.current = next; setRegion(next); }, []);

  const search = useCallback(async (text: string, area = false) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const id = ++requestId.current;
    setLoading(true);
    const known = currentStops.current.map((stop) => ({ id: stop.pubId, name: stop.name, lat: stop.lat, lng: stop.lon, address: stop.address }));
    const result = await searchTourPubs({ query: text, center: viewport.current, area, signal: controller.signal, known });
    if (id !== requestId.current || controller.signal.aborted) return;
    setLoading(false);
    if (result.status === 'cancelled') return;
    setPubs(result.pubs);
    setStatus(result.status);
    if (result.center) moveMap({ ...result.center, latitudeDelta: 0.055, longitudeDelta: 0.055 });
  }, [moveMap]);

  // A new tour starts where you are, not over the whole country. Never asks for permission here.
  useEffect(() => {
    if (currentStops.current.length) return;
    const start = viewport.current;
    const startRequest = requestId.current;
    let active = true;
    void (async () => {
      try {
        if (await checkLocationPermission() !== 'granted') return;
        // Prefer a recent fix, then a fresh one; an old one still beats the whole country.
        const fix = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 })
          ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced, mayShowUserSettingsDialog: false }).catch(() => Location.getLastKnownPositionAsync());
        if (!fix || !active || viewport.current !== start || requestId.current !== startRequest) return; // you moved or searched first
        moveMap({ latitude: fix.coords.latitude, longitude: fix.coords.longitude, latitudeDelta: 0.055, longitudeDelta: 0.055 });
      } catch {
        // The country view stays.
      }
    })();
    return () => { active = false; };
  }, [moveMap]);

  useEffect(() => {
    let active = true;
    const id = requestId.current;
    void cachedTourPubs().then((items) => { if (active && id === requestId.current) setPubs(items); });
    return () => { active = false; request.current?.abort(); requestId.current += 1; };
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) return;
    const timer = setTimeout(() => { void search(query); }, 350);
    return () => clearTimeout(timer);
  }, [query, search]);

  function changeQuery(text: string) {
    request.current?.abort();
    const id = ++requestId.current;
    setLoading(false);
    setQuery(text);
    setAreaSearch(false);
    if (text.trim().length < 2) {
      void cachedTourPubs(text).then((items) => { if (id === requestId.current) setPubs(items); });
    }
  }


  const inTour = (pub: Pub) => {
    const candidate = pubIdentity(pub);
    return stops.findIndex((stop) => stop.id !== replaceStop?.id && samePub(stop, candidate));
  };
  const full = !replaceStop && stops.length >= MAX_STOPS;
  const { day, today } = planDay({ scheduledDate: scheduledDate ?? null });
  const dayLabel = today ? t.tours.today : t.tours.onDay[day];
  const last = !replaceStop && query.trim().length < 2 && !areaSearch ? stops[stops.length - 1] : undefined;
  // The same pub can come back from search and from the phone's cache under two ids.
  const seenIds = new Set<string>();
  const seenPlaces = new Set<string>();
  // Suggestions after the last stop rank the whole known catalogue, not just what sits near the map centre.
  const listed = (last ? allowed : visiblePubs).filter((pub) => {
    const { cacheKey, name } = pubIdentity(pub);
    const place = `${cacheKey}|${name.trim().toLocaleLowerCase()}`;
    if (seenIds.has(pub.id) || seenPlaces.has(place)) return false;
    seenIds.add(pub.id);
    seenPlaces.add(place);
    return true;
  });
  const rows = !last ? listed.map((pub) => ({ pub, minutes: null as number | null })) : listed
    .filter((pub) => inTour(pub) < 0)
    .map((pub) => ({ pub, leg: walkingLeg(last, { lat: pub.lat, lon: pub.lng }) }))
    .filter(({ leg }) => leg.meters <= NEAR_METERS)
    .sort((a, b) => a.leg.meters - b.leg.meters)
    .slice(0, 30)
    .map(({ pub, leg }) => ({ pub, minutes: leg.minutes as number | null }));

  // Suggestions start at the newest stop, so the map goes there too; opening keeps the whole tour framed.
  const followed = useRef(last?.id);
  useEffect(() => {
    if (!last || followed.current === last.id) return;
    followed.current = last.id;
    const delta = Math.min(viewport.current.latitudeDelta, 0.025);
    moveMap({ latitude: last.lat, longitude: last.lon, latitudeDelta: delta, longitudeDelta: delta });
  }, [last, moveMap]);
  function flash(text: string) {
    setNotice(text);
    AccessibilityInfo.announceForAccessibility(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 3000);
  }
  async function toggle(pub: Pub, fromRow = false) {
    if (replaceStop) { onReplace(pub); return; }
    const index = inTour(pub);
    if (fromRow && last && settling.current) return;
    if (index < 0 && full) { flash(t.tours.pickerFull); return; }
    if (!(await onToggle(pub))) return;
    if (last && index < 0) settling.current = setTimeout(() => { settling.current = null; }, 600);
    if (useSettingsStore.getState().hapticEnabled) fireLightImpactHaptic();
    AccessibilityInfo.announceForAccessibility(index < 0 ? t.tours.pubAdded(stops.length + 1) : t.tours.pubRemoved);
  }
  const choosePreview = (pub: Pub) => {
    Keyboard.dismiss();
    if (!preview) beforePreview.current = viewport.current;
    moveMap({ latitude: pub.lat, longitude: pub.lng, latitudeDelta: Math.min(viewport.current.latitudeDelta, 0.035), longitudeDelta: Math.min(viewport.current.longitudeDelta, 0.035) });
    setPreview(pub);
  };
  const backToSearch = useCallback(() => {
    setPreview(null);
    if (beforePreview.current) moveMap(beforePreview.current);
  }, [moveMap, setPreview]);
  useEffect(() => {
    if (!focused) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (preview) backToSearch(); else onClose();
      return true;
    });
    return () => listener.remove();
  }, [focused, preview, backToSearch, onClose]);
  const stopPreview = (id: string) => {
    const stop = stops.find((item) => item.id === id);
    if (stop) choosePreview({ id: stop.pubId, name: stop.name, lat: stop.lat, lng: stop.lon, address: stop.address });
  };
  function hoursText(pub: Pub) {
    const intervals = pubHoursOnDay(pub, day);
    return intervals ? intervals.length ? `${dayLabel} ${intervals.join(', ')}` : t.tours.closedOn(dayLabel) : null;
  }
  const previewIndex = preview ? inTour(preview) : -1;
  const map = <View>
    <TourMap caption={false} stops={stops} selectedId={previewIndex >= 0 ? stops[previewIndex].id : null} selectedCandidateId={preview?.id} onSelect={stopPreview} height={mapExpanded ? expandedMapHeight : 215} region={region} onRegionChange={moveMap} candidates={rows.map(({ pub }) => pub).filter((pub) => inTour(pub) < 0).slice(0, 40)} onCandidate={choosePreview} onExpand={() => setMapExpanded((value) => !value)} />
    {!preview && <Pressable accessibilityRole="button" style={({ pressed }) => [styles.areaButton, pressed && styles.pressed]} onPress={() => { setQuery(''); setAreaSearch(true); void search('', true); }}>
      <SearchIcon size={15} color={Colors.foam} /><Text maxFontSizeMultiplier={1.2} style={styles.areaText}>{t.tours.searchArea}</Text>
    </Pressable>}
  </View>;
  const hint = notice ?? (replaceStop ? null : stops.length === 0 ? t.tours.needTwo : stops.length === 1 ? t.tours.needOne : null);

  return <View accessibilityViewIsModal style={[styles.screen, StyleSheet.absoluteFill, { paddingTop: insets.top, paddingBottom: keyboardVisible ? keyboardHeight : insets.bottom }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={preview ? t.tours.backToSearch : t.tours.close} style={styles.iconButton} onPress={() => preview ? backToSearch() : onClose()}><ChevronLeftIcon size={24} color={Colors.foam} /></Pressable>
        <Text maxFontSizeMultiplier={1.3} style={styles.headerTitle}>{replaceStop ? t.tours.replaceStop : t.tours.addPubs}</Text>
        <View style={styles.iconButton} />
      </View>
      {!preview && <View style={styles.searchField}>
        <SearchIcon size={20} color={Colors.foamMuted} />
        <TextInput maxFontSizeMultiplier={1.3} style={styles.input} placeholder={t.tours.searchPlaceholder} placeholderTextColor={Colors.mutedText} value={query} onChangeText={changeQuery} autoCorrect={false} returnKeyType="search" onSubmitEditing={() => { Keyboard.dismiss(); if (query.trim().length >= 2) void search(query); }} accessibilityLabel={t.tours.searchPlaceholder} maxLength={120} />
        {!!query && <Pressable accessibilityRole="button" accessibilityLabel={t.tours.clearSearch} style={styles.clear} onPress={() => changeQuery('')}><XIcon size={18} color={Colors.foamMuted} /></Pressable>}
      </View>}
      {!keyboardVisible && map}
      <ScrollView ref={list} style={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {preview ? <View style={styles.preview}>
          <Text maxFontSizeMultiplier={1.3} style={styles.pubTitle}>{preview.name}</Text>
          {!!(preview.address || preview.city) && <Text maxFontSizeMultiplier={1.3} style={styles.address}>{[preview.address, preview.city].filter(Boolean).join(', ')}</Text>}
          <View style={styles.hours}><Text maxFontSizeMultiplier={1.3} style={styles.meta}>{hoursText(preview) ?? t.tours.openingHoursUnknown}</Text></View>
          <Pressable accessibilityRole="button" style={styles.detailRow} onPress={() => openPubPage(router, preview)}><Text maxFontSizeMultiplier={1.3} style={styles.actionText}>{t.tours.fullPubDetail}</Text><ChevronRightIcon size={18} color={Colors.amber} /></Pressable>
        </View> : <View style={styles.list}>
          {loading && <ActivityIndicator accessibilityLabel={t.tours.search} color={Colors.amber} style={styles.loading} />}
          {status === 'cached' && <Text maxFontSizeMultiplier={1.3} style={styles.notice}>{t.tours.searchOffline}</Text>}
          {status === 'error' && <Text maxFontSizeMultiplier={1.3} style={styles.notice}>{t.tours.searchError}</Text>}
          {!!last && rows.length > 0 && <Text maxFontSizeMultiplier={1.3} style={styles.sectionLabel}>{t.tours.nearStop(stops.length)}</Text>}
          {!loading && !rows.length && <Text maxFontSizeMultiplier={1.3} style={styles.notice}>{t.tours.searchEmpty}</Text>}
          {rows.map(({ pub, minutes }) => {
            const index = inTour(pub);
            const added = index >= 0 && !replaceStop;
            const blocked = !added && full;
            const meta = [minutes ? t.tours.walkMinutes(minutes) : null, hoursText(pub), minutes ? null : replaceStop && index >= 0 ? t.tours.inTour : [pub.address, pub.city].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
            return <View key={pub.id} style={[styles.pubRow, blocked && styles.blocked]}>
              <Pressable accessibilityRole="button" accessibilityState={{ selected: added, disabled: replaceStop ? index >= 0 : false }} disabled={!!replaceStop && index >= 0}
                accessibilityLabel={replaceStop ? pub.name : added ? t.tours.removePubA11y(pub.name, index + 1) : t.tours.addPubA11y(pub.name)}
                style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]} onPress={() => { void toggle(pub, true); }}>
                {!replaceStop && <View style={[styles.mark, added && styles.markAdded]}>
                  {added ? <Text allowFontScaling={false} style={styles.markNumber}>{index + 1}</Text> : <PlusIcon size={16} color={Colors.amber} />}
                </View>}
                <View style={styles.rowBody}><Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.pubName}>{pub.name}</Text>{!!meta && <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={styles.meta}>{meta}</Text>}</View>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={t.tours.pubDetailA11y(pub.name)} style={({ pressed }) => [styles.more, pressed && styles.pressed]} onPress={() => choosePreview(pub)}>
                <ChevronRightIcon size={19} color={Colors.foamMuted} />
              </Pressable>
            </View>;
          })}
        </View>}
      </ScrollView>
      {(!!preview || !replaceStop) && <View style={styles.footer}>
        {preview ? replaceStop
          ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: previewIndex >= 0 }} disabled={previewIndex >= 0} style={({ pressed }) => [styles.primary, (pressed || previewIndex >= 0) && styles.disabled]} onPress={() => onReplace(preview)}><Text maxFontSizeMultiplier={1.3} style={styles.primaryText}>{previewIndex >= 0 ? t.tours.inTour : t.tours.replaceWithPub}</Text></Pressable>
          : <Pressable accessibilityRole="button" accessibilityState={{ disabled: previewIndex < 0 && full }} disabled={previewIndex < 0 && full}
            style={({ pressed }) => [previewIndex >= 0 ? styles.secondary : styles.primary, (pressed || (previewIndex < 0 && full)) && styles.disabled]}
            onPress={() => { void toggle(preview).then(backToSearch); }}>
            <Text maxFontSizeMultiplier={1.3} style={previewIndex >= 0 ? styles.secondaryText : styles.primaryText}>{previewIndex >= 0 ? t.tours.removeFromTour : full ? t.tours.pickerFull : t.tours.addAsStop(stops.length + 1)}</Text>
          </Pressable>
        : <>
          {!replaceStop && !keyboardVisible && stops.length > 0 && <ScrollView ref={strip} horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={styles.stripFrame} contentContainerStyle={styles.strip}
            onContentSizeChange={() => strip.current?.scrollToEnd({ animated: true })}>
            {stops.map((stop, index) => <View key={stop.id} style={styles.chip}>
              <View style={styles.chipNumber}><Text allowFontScaling={false} style={styles.chipNumberText}>{index + 1}</Text></View>
              <Text maxFontSizeMultiplier={1.2} numberOfLines={1} style={styles.chipText}>{stop.name}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={t.tours.removeChipA11y(stop.name)} hitSlop={8} style={styles.chipRemove}
                onPress={() => { void toggle({ id: stop.pubId, name: stop.name, lat: stop.lat, lng: stop.lon, address: stop.address }); }}>
                <XIcon size={14} color={Colors.foamMuted} />
              </Pressable>
            </View>)}
          </ScrollView>}
          {!!hint && <Text maxFontSizeMultiplier={1.3} style={styles.hint} accessibilityLiveRegion="polite">{hint}</Text>}
          {!replaceStop && <Pressable testID="tour-picker-done" accessibilityRole="button" style={({ pressed }) => [stops.length ? styles.primary : styles.secondary, pressed && styles.disabled]} onPress={onClose}>
            <Text maxFontSizeMultiplier={1.3} style={stops.length ? styles.primaryText : styles.secondaryText}>{stops.length ? t.tours.pickerDone(pubCount(stops.length)) : t.tours.whenDone}</Text>
          </Pressable>}
        </>}
        {preview && <Pressable accessibilityRole="button" style={styles.back} onPress={backToSearch}><Text maxFontSizeMultiplier={1.3} style={styles.backText}>{t.tours.backToSearch}</Text></Pressable>}
      </View>}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  header: { minHeight: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.sm },
  iconButton: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: Fonts.ui.bold, fontSize: 17, color: Colors.foam },
  searchField: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.stout3, borderRadius: Radius.pill, marginHorizontal: Spacing.lg, marginBottom: Spacing.md, paddingLeft: Spacing.md, minHeight: 48 },
  input: { flex: 1, minWidth: 0, fontFamily: Fonts.ui.regular, fontSize: 15, color: Colors.foam, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.md },
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1 },
  list: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg },
  loading: { marginVertical: Spacing.md },
  notice: { fontFamily: Fonts.ui.regular, fontSize: 14, lineHeight: 21, color: Colors.foamMuted, paddingVertical: Spacing.lg },
  pubRow: { flexDirection: 'row', alignItems: 'center', minHeight: 72, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: withAlpha(Colors.foam, 0.14) },
  blocked: { opacity: 0.45 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md, minHeight: 72 },
  rowBody: { flex: 1, minWidth: 0 },
  mark: { width: 30, height: 30, borderRadius: Radius.pill, borderWidth: 1.5, borderColor: withAlpha(Colors.amber, 0.6), alignItems: 'center', justifyContent: 'center' },
  markAdded: { backgroundColor: Colors.amber, borderColor: Colors.amber },
  markNumber: { fontWeight: '700', fontSize: 15, lineHeight: 20, color: Colors.stout, fontVariant: ['tabular-nums'], includeFontPadding: false },
  more: { width: HitArea.min, alignSelf: 'stretch', alignItems: 'flex-end', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  sectionLabel: { fontFamily: Fonts.ui.semibold, fontSize: 13, lineHeight: 20, color: Colors.mutedText, paddingTop: Spacing.lg, paddingBottom: Spacing.xs },
  areaButton: { position: 'absolute', top: Spacing.md, left: Spacing.lg, minHeight: HitArea.min, flexDirection: 'row', alignItems: 'center', gap: Spacing.xs + 2, paddingHorizontal: Spacing.md, borderRadius: Radius.pill, backgroundColor: Colors.stout },
  areaText: { fontFamily: Fonts.ui.semibold, fontSize: 13, color: Colors.foam },
  stripFrame: { marginHorizontal: -Spacing.lg },
  strip: { gap: Spacing.sm, paddingBottom: Spacing.sm, paddingHorizontal: Spacing.lg },
  chip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, height: 36, paddingLeft: 5, paddingRight: Spacing.xs, borderRadius: Radius.pill, backgroundColor: Colors.stout3 },
  chipNumber: { width: 26, height: 26, borderRadius: Radius.pill, backgroundColor: Colors.amber, alignItems: 'center', justifyContent: 'center' },
  chipNumberText: { fontWeight: '700', fontSize: 13, lineHeight: 16, color: Colors.stout, fontVariant: ['tabular-nums'], includeFontPadding: false },
  chipText: { maxWidth: 150, fontFamily: Fonts.ui.semibold, fontSize: 13, color: Colors.foam },
  chipRemove: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  hint: { fontFamily: Fonts.ui.medium, fontSize: 13, lineHeight: 19, color: Colors.foamMuted, textAlign: 'center', paddingBottom: Spacing.sm },
  pubName: { fontFamily: Fonts.ui.semibold, fontSize: 16, color: Colors.foam, marginBottom: 3 },
  meta: { fontFamily: Fonts.ui.regular, fontSize: 13, lineHeight: 20, color: Colors.foamMuted },
  preview: { padding: Spacing.lg },
  pubTitle: { fontFamily: Fonts.display.extrabold, fontSize: 28, lineHeight: 34, color: Colors.foam },
  address: { fontFamily: Fonts.ui.regular, fontSize: 15, lineHeight: 23, color: Colors.foamMuted, marginTop: Spacing.xs },
  hours: { paddingVertical: Spacing.lg, marginTop: Spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: withAlpha(Colors.foam, 0.14) },
  detailRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actionText: { fontFamily: Fonts.ui.semibold, fontSize: 14, color: Colors.amber },
  footer: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderColor: withAlpha(Colors.foam, 0.12) },
  primary: { minHeight: 52, borderRadius: Radius.pill, backgroundColor: Colors.amber, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.md, paddingVertical: 10 },
  primaryText: { fontFamily: Fonts.display.bold, fontSize: 19, color: Colors.stout, textAlign: 'center' },
  disabled: { opacity: 0.45 },
  secondary: { minHeight: 50, borderRadius: Radius.pill, backgroundColor: Colors.stout3, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.md, paddingVertical: 10 },
  secondaryText: { fontFamily: Fonts.display.bold, fontSize: 18, color: Colors.foam, textAlign: 'center' },
  back: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { fontFamily: Fonts.ui.semibold, fontSize: 13, color: Colors.foamMuted },
});
