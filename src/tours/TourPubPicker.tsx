import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Region } from 'react-native-maps';
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon, XIcon } from '@/components/shared/IconGlyph';
import { MapPubSheet } from '@/components/amenities/MapPubSheet';
import { pubInfoFromPub } from '@/components/amenities/pubInfoContext';
import { geohash8 } from '@/data/geohash';
import type { Pub } from '@/data/pubs';
import { cachedTourPubs, searchTourPubs, type TourPubSearchResult } from '@/data/tourPubSearch';
import { t } from '@/i18n';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import type { TourStop } from './model';
import { TourMap, tourRegion } from './TourMap';

export interface TourPubPickerProps {
  visible: boolean;
  stops: readonly TourStop[];
  onSelect: (pub: Pub) => void;
  onClose: () => void;
  replaceStop?: TourStop | null;
}

export function TourPubPicker(props: TourPubPickerProps) {
  return props.visible ? <TourPubPickerContent {...props} /> : null;
}

function TourPubPickerContent({ stops, onSelect, onClose, replaceStop }: TourPubPickerProps) {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const [query, setQuery] = useState('');
  const [pubs, setPubs] = useState<Pub[]>([]);
  const [status, setStatus] = useState<TourPubSearchResult['status']>('ok');
  const [loading, setLoading] = useState(false);
  const [region, setRegion] = useState<Region>(() => tourRegion(stops));
  const [preview, setPreview] = useState<Pub | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
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
    if (text.trim().length < 2) {
      void cachedTourPubs(text).then((items) => { if (id === requestId.current) setPubs(items); });
    }
  }

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const alreadyAdded = (pub: Pub) => stops.some((stop) => stop.id !== replaceStop?.id && (stop.pubId === pub.id || (stop.cacheKey === geohash8(pub.lat, pub.lng) && stop.name.trim().toLocaleLowerCase() === pub.name.trim().toLocaleLowerCase())));
  const choosePreview = (pub: Pub) => {
    Keyboard.dismiss();
    if (!preview) beforePreview.current = viewport.current;
    moveMap({ latitude: pub.lat, longitude: pub.lng, latitudeDelta: Math.min(viewport.current.latitudeDelta, 0.035), longitudeDelta: Math.min(viewport.current.longitudeDelta, 0.035) });
    setPreview(pub);
  };
  const backToSearch = useCallback(() => {
    setPreview(null);
    if (beforePreview.current) moveMap(beforePreview.current);
  }, [moveMap]);
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
  const map = <TourMap stops={stops} selectedId={stops.find((stop) => stop.pubId === preview?.id)?.id ?? null} selectedCandidateId={preview?.id} onSelect={stopPreview} height={mapExpanded ? 420 : 215} region={region} onRegionChange={moveMap} candidates={pubs.filter((pub) => !alreadyAdded(pub)).slice(0, 40)} onCandidate={choosePreview} onExpand={() => setMapExpanded((value) => !value)} />;

  return <View accessibilityViewIsModal style={[styles.screen, StyleSheet.absoluteFill, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={preview ? t.tours.backToSearch : t.tours.close} style={styles.iconButton} onPress={() => preview ? backToSearch() : onClose()}><ChevronLeftIcon size={24} color={Colors.foam} /></Pressable>
        <Text maxFontSizeMultiplier={1.3} style={styles.headerTitle}>{replaceStop ? t.tours.replaceStop : t.tours.addStop}</Text>
        <View style={styles.iconButton} />
      </View>
      {!preview && <View style={styles.searchField}>
        <SearchIcon size={20} color={Colors.foamMuted} />
        <TextInput maxFontSizeMultiplier={1.3} style={styles.input} placeholder={t.tours.searchPlaceholder} placeholderTextColor={Colors.mutedText} value={query} onChangeText={changeQuery} autoCorrect={false} returnKeyType="search" onSubmitEditing={() => { Keyboard.dismiss(); if (query.trim().length >= 2) void search(query); }} accessibilityLabel={t.tours.searchPlaceholder} maxLength={120} />
        {!!query && <Pressable accessibilityRole="button" accessibilityLabel={t.tours.clearSearch} style={styles.clear} onPress={() => changeQuery('')}><XIcon size={18} color={Colors.foamMuted} /></Pressable>}
      </View>}
      <ScrollView style={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets>
        {!keyboardVisible && map}
        {preview ? <View style={styles.preview}>
          <Text maxFontSizeMultiplier={1.3} style={styles.pubTitle}>{preview.name}</Text>
          {!!(preview.address || preview.city) && <Text maxFontSizeMultiplier={1.3} style={styles.address}>{[preview.address, preview.city].filter(Boolean).join(', ')}</Text>}
          <View style={styles.hours}><Text maxFontSizeMultiplier={1.3} style={styles.meta}>{preview.openingHours || t.tours.openingHoursUnknown}</Text></View>
          <Pressable accessibilityRole="button" style={styles.detailRow} onPress={() => setDetailVisible(true)}><Text maxFontSizeMultiplier={1.3} style={styles.actionText}>{t.tours.fullPubDetail}</Text><ChevronRightIcon size={18} color={Colors.amber} /></Pressable>
        </View> : <View style={styles.list}>
          {loading && <ActivityIndicator accessibilityLabel={t.tours.search} color={Colors.amber} style={styles.loading} />}
          {status === 'cached' && <Text maxFontSizeMultiplier={1.3} style={styles.notice}>{t.tours.searchOffline}</Text>}
          {status === 'error' && <Text maxFontSizeMultiplier={1.3} style={styles.notice}>{t.tours.searchError}</Text>}
          {!loading && !pubs.length && <Text maxFontSizeMultiplier={1.3} style={styles.notice}>{t.tours.searchEmpty}</Text>}
          {pubs.map((pub) => <Pressable key={pub.id} accessibilityRole="button" accessibilityLabel={pub.name} style={styles.pubRow} onPress={() => choosePreview(pub)}>
            <View style={styles.rowBody}><Text maxFontSizeMultiplier={1.3} style={styles.pubName}>{pub.name}</Text><Text maxFontSizeMultiplier={1.3} style={styles.meta}>{alreadyAdded(pub) ? t.tours.inTour : [pub.address, pub.city].filter(Boolean).join(', ')}</Text></View>
            <ChevronRightIcon size={19} color={Colors.foamMuted} />
          </Pressable>)}
        </View>}
      </ScrollView>
      {!keyboardVisible && <View style={styles.footer}>
        {preview ? <>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: alreadyAdded(preview) }} disabled={alreadyAdded(preview)} style={[styles.primary, alreadyAdded(preview) && styles.disabled]} onPress={() => onSelect(preview)}><Text maxFontSizeMultiplier={1.3} style={styles.primaryText}>{alreadyAdded(preview) ? t.tours.inTour : replaceStop ? t.tours.replaceWithPub : t.tours.addThisPub}</Text></Pressable>
          <Pressable accessibilityRole="button" style={styles.back} onPress={backToSearch}><Text maxFontSizeMultiplier={1.3} style={styles.backText}>{t.tours.backToSearch}</Text></Pressable>
        </> : <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => { setQuery(''); void search('', true); }}><Text maxFontSizeMultiplier={1.3} style={styles.secondaryText}>{t.tours.searchArea}</Text></Pressable>}
      </View>}
      {preview && <MapPubSheet visible={detailVisible} pubKey={geohash8(preview.lat, preview.lng)} pubName={preview.name} info={pubInfoFromPub(preview)} onClose={() => setDetailVisible(false)} onRenamed={(name) => setPreview({ ...preview, name })} />}
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
  pubRow: { flexDirection: 'row', alignItems: 'center', minHeight: 78, paddingVertical: Spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: withAlpha(Colors.foam, 0.14) },
  rowBody: { flex: 1, paddingRight: Spacing.sm },
  pubName: { fontFamily: Fonts.ui.semibold, fontSize: 16, color: Colors.foam, marginBottom: 5 },
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
