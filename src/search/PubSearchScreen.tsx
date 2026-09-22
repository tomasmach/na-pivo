import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRightIcon, ClockIcon, SearchIcon, XIcon } from '@/components/shared/IconGlyph';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { MapPubSheet } from '@/components/amenities/MapPubSheet';
import { pubInfoFromPub } from '@/components/amenities/pubInfoContext';
import { geohash8 } from '@/data/geohash';
import { fetchPubHours } from '@/data/hoursClient';
import { hydratePubsSnapshot, type Pub } from '@/data/pubs';
import { localPubSearch, resolvePubSearchResult, searchPubNames, type PubSearchResult } from '@/data/pubSearchClient';
import { EMPTY_PUB_SEARCH_FILTERS, type PubSearchFilters } from '@/data/pubSearchFilters';
import BeerMapScreen from '@/map/BeerMapScreen';
import { useAccountStore } from '@/stores/accountStore';
import { usePubStore } from '@/stores/pubStore';
import { useToastStore } from '@/stores/toastStore';
import { openPubInMaps } from '@/utils/maps';
import { t } from '@/i18n';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { loadRecentSearches, mergeRecentSearches, saveRecentSearch } from './recentSearches';

export default function PubSearchScreen() {
  const accountId = useAccountStore((state) => state.session?.accountId ?? 'anonymous');
  return <SearchContent key={accountId} />;
}

function SearchContent() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const resolveController = useRef<AbortController | null>(null);
  const reportedIds = usePubStore((state) => state.reportedPubIds);
  const reportedKeys = usePubStore((state) => state.reportedCacheKeys);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [response, setResponse] = useState<{ term: string; pubs: PubSearchResult[]; failed: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openFailed, setOpenFailed] = useState(false);
  const [selectedPub, setSelectedPub] = useState<Pub | null>(null);
  const [mapPub, setMapPub] = useState<Pub | null>(null);
  const [mapFilters, setMapFilters] = useState<PubSearchFilters>(EMPTY_PUB_SEARCH_FILTERS);
  const term = query.trim();
  const canSearch = term.length >= 2;
  const localResults = useMemo(() => {
    void snapshotReady;
    return canSearch ? localPubSearch(term) : [];
  }, [canSearch, term, snapshotReady]);
  const loading = canSearch && response?.term !== term;
  const failed = canSearch && response?.term === term && response.failed;
  const results = canSearch ? (response?.term === term ? response.pubs : localResults) : [];
  const changeQuery = (next: string) => {
    resolveController.current?.abort();
    setOpeningId(null);
    setOpenFailed(false);
    setQuery(next);
  };

  const leave = useCallback(() => {
    resolveController.current?.abort();
    Keyboard.dismiss();
    if (router.canGoBack()) router.back();
    else router.replace('/' as Href);
  }, [router]);

  useEffect(() => {
    let active = true;
    void loadRecentSearches().then((value) => { if (active) setRecent((current) => current.length ? current : value); });
    void hydratePubsSnapshot().then(() => { if (active) setSnapshotReady(true); });
    return () => { active = false; resolveController.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!canSearch) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchPubNames(term, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        setResponse({ term, ...result });
      });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [canSearch, term, retry, snapshotReady]);

  useEffect(() => {
    if (!selectedPub) return;
    const controller = new AbortController();
    const pub = selectedPub;
    void fetchPubHours([pub], controller.signal).then((response) => {
      const details = response.get(pub.id);
      if (!details || controller.signal.aborted) return;
      setSelectedPub((current) => current?.id === pub.id ? {
        ...current,
        openingHours: details.openingHours,
        isOpenNow: details.isOpenNow,
        nextChange: details.nextChange,
        hoursStatus: details.status,
        communityHours: details.communityHours ?? undefined,
        beers: details.beers,
        historicalBeers: details.historicalBeers,
        beerMenuRotates: details.beerMenuRotates,
        beersUpdatedAt: details.beersUpdatedAt,
        hoursUpdatedAt: details.hoursUpdatedAt,
      } : current);
    });
    return () => controller.abort();
    // Refresh only when opening a different pub, not after enriching it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPub?.id]);

  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (mapPub) { setMapPub(null); return true; }
      return false;
    });
    return () => sub.remove();
  }, [mapPub]));

  const openResult = async (result: PubSearchResult) => {
    resolveController.current?.abort();
    const controller = new AbortController();
    resolveController.current = controller;
    setOpeningId(result.id);
    setOpenFailed(false);
    Keyboard.dismiss();
    const pub = await resolvePubSearchResult(result, controller.signal);
    if (controller.signal.aborted) return;
    setOpeningId(null);
    if (!pub) { setOpenFailed(true); return; }
    void saveRecentSearch(recent, term);
    setRecent((current) => mergeRecentSearches(current, term));
    setSelectedPub(pub);
  };

  const visibleResults = results.filter((result) => !reportedIds.includes(result.id) &&
    !(typeof result.lat === 'number' && typeof result.lng === 'number' && reportedKeys.includes(geohash8(result.lat, result.lng))));

  return (
    <View style={styles.root}>
      <View style={[styles.screen, { paddingTop: insets.top + Spacing.sm }, mapPub && styles.hidden]}>
        <View style={styles.header}>
          <View style={styles.field}>
            <SearchIcon size={18} color={Colors.mutedText} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={changeQuery}
              accessibilityLabel={t.pubSearch.open}
              placeholder={t.pubSearch.placeholder}
              placeholderTextColor={Colors.mutedText}
              style={styles.input}
              maxLength={150}
              autoFocus
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={Keyboard.dismiss}
              maxFontSizeMultiplier={FontScaleCap.body}
            />
            {query ? <Pressable accessibilityRole="button" accessibilityLabel={t.pubSearch.clear}
              onPress={() => { changeQuery(''); inputRef.current?.focus(); }} style={styles.clear}>
              <XIcon size={18} color={Colors.foamMuted} />
            </Pressable> : null}
          </View>
          <Pressable accessibilityRole="button" onPress={leave} style={styles.cancel}>
            <Text style={styles.cancelText} maxFontSizeMultiplier={FontScaleCap.body}>{t.pubSearch.cancel}</Text>
          </Pressable>
        </View>
        <KeyboardAwareScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + Spacing.xl }]}
          keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {!term && recent.length > 0 ? <>
            <Text style={styles.heading}>{t.pubSearch.recent}</Text>
            {recent.map((item) => <Pressable key={item} accessibilityRole="button" onPress={() => { changeQuery(item); inputRef.current?.focus(); }} style={styles.recentRow}>
              <ClockIcon size={18} color={Colors.mutedText} /><Text style={styles.recentText}>{item}</Text>
            </Pressable>)}
          </> : null}
          {term && !canSearch ? <Text style={styles.status}>{t.pubSearch.tooShort}</Text> : null}
          {loading ? <View style={styles.statusRow} accessibilityLiveRegion="polite"><ActivityIndicator color={Colors.amber} /><Text style={styles.statusText}>{t.pubSearch.loading}</Text></View> : null}
          {failed ? <View style={styles.failure} accessibilityLiveRegion="polite">
            <Text style={styles.heading}>{t.pubSearch.unavailable}</Text>
            <Text style={styles.statusText}>{visibleResults.length ? t.pubSearch.savedOnly : t.pubSearch.noSaved}</Text>
            <Pressable accessibilityRole="button" onPress={() => { setResponse(null); setRetry((value) => value + 1); }} style={styles.textButton}><Text style={styles.action}>{t.pubSearch.retry}</Text></Pressable>
          </View> : null}
          {openFailed ? <Text style={styles.status} accessibilityLiveRegion="polite">{t.pubSearch.openFailed}</Text> : null}
          {visibleResults.map((result) => <Pressable key={result.id} accessibilityRole="button"
            accessibilityLabel={[result.name, result.location || [result.address, result.city].filter(Boolean).join(', ')].filter(Boolean).join(', ')}
            accessibilityState={{ busy: openingId === result.id }} onPress={() => void openResult(result)}
            style={({ pressed }) => [styles.result, pressed && styles.pressed]}>
            <View style={styles.resultText}>
              <Text style={styles.name} maxFontSizeMultiplier={FontScaleCap.heading}>{result.name}</Text>
              {result.location || result.city || result.address ? <Text style={styles.address} maxFontSizeMultiplier={FontScaleCap.body}>{result.location || [result.address, result.city].filter(Boolean).join(', ')}</Text> : null}
              {result.providerPlaceId && !result.pub ? <Text style={styles.address}>{t.pubSearch.external}</Text> : null}
            </View>
            {openingId === result.id ? <ActivityIndicator color={Colors.amber} accessibilityLabel={t.pubSearch.opening} /> : <ChevronRightIcon size={20} color={Colors.foamMuted} />}
          </Pressable>)}
          {canSearch && !loading && !failed && visibleResults.length === 0 ? <View style={styles.failure}>
            <Text style={styles.heading}>{t.pubSearch.empty}</Text><Text style={styles.statusText}>{t.pubSearch.emptyHint}</Text>
            <Pressable accessibilityRole="button" onPress={() => { Keyboard.dismiss(); router.push('/add-pub' as Href); }} style={styles.textButton}><Text style={styles.action}>{t.pubSearch.add}</Text></Pressable>
          </View> : null}
        </KeyboardAwareScrollView>
      </View>
      {mapPub ? <BeerMapScreen initialPub={mapPub} focusInitialPub filters={mapFilters} onApplyFilters={setMapFilters}
        onSearch={() => { setMapPub(null); requestAnimationFrame(() => inputRef.current?.focus()); }} onShowCompass={() => { Keyboard.dismiss(); router.dismissTo({ pathname: '/', params: { view: 'compass' } }); }} /> : null}
      {selectedPub ? <MapPubSheet visible pubKey={geohash8(selectedPub.lat, selectedPub.lng)} pubName={selectedPub.name}
        info={pubInfoFromPub(selectedPub)} onClose={() => setSelectedPub(null)}
        onRenamed={(name) => setSelectedPub((pub) => pub ? { ...pub, name } : pub)}
        hoursLabel={typeof selectedPub.isOpenNow === 'boolean' ? (selectedPub.isOpenNow ? t.compass.openNow : t.compass.closedNow) : null}
        hoursTone={selectedPub.isOpenNow === true ? 'open' : selectedPub.isOpenNow === false ? 'closed' : 'unknown'}
        onShowMap={() => { setMapFilters(EMPTY_PUB_SEARCH_FILTERS); setMapPub(selectedPub); setSelectedPub(null); }}
        onNavigate={() => { void openPubInMaps(selectedPub).catch(() => useToastStore.getState().show(t.pubSearch.navigationFailed)); }}
      /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.stout },
  screen: { flex: 1 },
  hidden: { display: 'none' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.sm },
  field: { flex: 1, minWidth: 0, minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingLeft: Spacing.md, backgroundColor: Colors.stout3, borderRadius: Radius.medium, borderWidth: 1, borderColor: withAlpha(Colors.foam, 0.1) },
  input: { flex: 1, minWidth: 0, minHeight: 46, paddingVertical: Spacing.sm, fontFamily: Fonts.ui.regular, fontSize: 15, color: Colors.foam },
  clear: { width: HitArea.min, height: HitArea.min, alignItems: 'center', justifyContent: 'center' },
  cancel: { minHeight: HitArea.min, minWidth: HitArea.min, justifyContent: 'center' },
  cancelText: { fontFamily: Fonts.ui.medium, fontSize: 14, color: Colors.foamMuted },
  body: { paddingHorizontal: Spacing.lg },
  heading: { fontFamily: Fonts.display.bold, fontSize: 22, color: Colors.foam, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  recentRow: { minHeight: 54, flexDirection: 'row', gap: Spacing.md, alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: withAlpha(Colors.foam, 0.12), paddingVertical: Spacing.md },
  recentText: { flex: 1, fontFamily: Fonts.ui.regular, fontSize: 16, color: Colors.foamMuted },
  result: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: withAlpha(Colors.foam, 0.12) },
  resultText: { flex: 1, gap: Spacing.xs },
  name: { fontFamily: Fonts.display.bold, fontSize: 20, color: Colors.foam },
  address: { fontFamily: Fonts.ui.regular, fontSize: 13, color: Colors.mutedText },
  status: { fontFamily: Fonts.ui.regular, fontSize: 15, color: Colors.foamMuted, paddingVertical: Spacing.lg },
  statusText: { fontFamily: Fonts.ui.regular, fontSize: 15, color: Colors.foamMuted },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  failure: { paddingBottom: Spacing.md },
  textButton: { minHeight: HitArea.min, justifyContent: 'center', alignSelf: 'flex-start' },
  action: { color: Colors.amber, fontFamily: Fonts.ui.semibold, fontSize: 15 },
  pressed: { opacity: 0.65 },
});
