import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { nvBack } from '@/newlook/navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { suggestBeerBrands, type BeerBrandSuggestion } from '@/data/beerSuggestionsClient';
import { normalizeBeerName } from '@/data/communityHours';
import { fetchFriendsLive } from '@/data/friendsClient';
import { geohash8 } from '@/data/geohash';
import type { Pub } from '@/data/pubs';
import { localPubSearch, resolvePubSearchResult, searchPubNames, type PubSearchResult } from '@/data/pubSearchClient';
import { BEER_NAME_FILTER_PREFIX } from '@/data/pubSearchFilters';
import { t } from '@/i18n';
import { buildLivePubs, type LivePubSummary } from '@/map/mapModel';
import { loadRecentSearches, saveRecentSearch } from '@/search/recentSearches';
import { usePubSuggestions } from '@/search/usePubSuggestions';
import { isSameVenue, usePubFavoritesStore } from '@/stores/pubFavoritesStore';
import { usePubStore } from '@/stores/pubStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { formatPrice } from '@/utils/currency';

import { Icon } from '../../components/Icon';
import { Card, Person, Press, Row, Spinner, T, Tile } from '../../components/ui';
import { C, SCREEN_X, font, s } from '../../theme';
import { distanceLabel, hoursNow } from './format';
import { openNvPub, useKompasState } from './state';

const L = () => t.nv.kompas;

function Distance({ meters }: { meters: number | null | undefined }) {
  if (meters == null) return null;
  return (
    <T s={15} w={600}>
      {distanceLabel(meters)}
    </T>
  );
}

function areaLine(pub: { city?: string; address?: string; hoursStatus?: string; isOpenNow?: boolean | null; nextChange?: string | null }): string | undefined {
  const area = pub.city || pub.address || '';
  const hours = hoursNow(pub);
  if (hours.tone === 'open' && hours.until) return area ? L().areaOpenUntil(area, hours.until) : L().openUntil(hours.until);
  return area || undefined;
}

/** Friends sitting at a pub right now, from the same live feed as the map's "Parta teď". */
function useLiveFriends(): LivePubSummary[] {
  const [live, setLive] = useState<LivePubSummary[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    void fetchFriendsLive(controller.signal).then((slice) => {
      if (!controller.signal.aborted && slice) setLive(buildLivePubs(slice.activeFriends));
    });
    return () => controller.abort();
  }, []);
  return live;
}

export function HledaniScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [response, setResponse] = useState<{ term: string; pubs: PubSearchResult[]; failed: boolean } | null>(null);
  const [beer, setBeer] = useState<{ term: string; suggestion: BeerBrandSuggestion | null } | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openFailed, setOpenFailed] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const resolving = useRef<AbortController | null>(null);
  const suggestions = usePubSuggestions();
  const live = useLiveFriends();
  const favoriteMap = usePubFavoritesStore((st) => st.favorites);
  const reportedIds = usePubStore((st) => st.reportedPubIds);
  const reportedKeys = usePubStore((st) => st.reportedCacheKeys);
  const currency = useSettingsStore((st) => st.priceCurrency);
  const setFilters = useKompasState((st) => st.setFilters);
  const pick = useKompasState((st) => st.pick);
  const term = q.trim();
  const canSearch = term.length >= 2;

  useEffect(() => {
    let active = true;
    void loadRecentSearches().then((value) => {
      if (active) setRecent(value);
    });
    return () => {
      active = false;
      resolving.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!canSearch) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchPubNames(term, controller.signal).then((result) => {
        if (!controller.signal.aborted) setResponse({ term, ...result });
      });
      void suggestBeerBrands(term, controller.signal, 1).then((found) => {
        if (!controller.signal.aborted) setBeer({ term, suggestion: found[0] ?? null });
      });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [canSearch, term]);

  const notReported = (r: { id: string; lat?: number; lng?: number }) =>
    !reportedIds.includes(r.id) && !(typeof r.lat === 'number' && typeof r.lng === 'number' && reportedKeys.includes(geohash8(r.lat, r.lng)));
  const results = (canSearch ? (response?.term === term ? response.pubs : localPubSearch(term)) : []).filter(notReported);
  const searching = canSearch && response?.term !== term;
  const failed = canSearch && response?.term === term && response.failed;

  const favorites = useMemo(
    () =>
      Object.entries(favoriteMap)
        .filter(([key, f]) => !reportedKeys.includes(key) && !(f.externalId && reportedIds.includes(f.externalId)))
        .map(([, f]): Pub => suggestions.pubs.find((p) => f.externalId && p.id === f.externalId) ?? suggestions.pubs.find((p) => isSameVenue(f, p)) ?? {
          id: f.externalId || '',
          name: f.name,
          lat: f.lat,
          lng: f.lng,
          ...(f.city ? { city: f.city } : {}),
        }),
    [favoriteMap, reportedIds, reportedKeys, suggestions.pubs],
  );
  const beerSuggestion = canSearch && beer?.term === term ? beer.suggestion : null;
  const pouring = useMemo(() => {
    if (!beerSuggestion) return [];
    const wanted = normalizeBeerName(beerSuggestion.brandName ?? beerSuggestion.name);
    return suggestions.pubs
      .flatMap((pub) => {
        const tap = pub.beers?.find((b) => normalizeBeerName(b.name).includes(wanted));
        return tap ? [{ pub, tap }] : [];
      })
      .slice(0, 5);
  }, [beerSuggestion, suggestions.pubs]);

  const remember = () => {
    if (!term) return;
    void saveRecentSearch(recent, term);
  };

  const openPub = (pub: Pub) => {
    remember();
    openNvPub(router, pub);
  };

  const openResult = async (result: PubSearchResult) => {
    resolving.current?.abort();
    const controller = new AbortController();
    resolving.current = controller;
    setOpeningId(result.id);
    setOpenFailed(false);
    Keyboard.dismiss();
    const pub = await resolvePubSearchResult(result, controller.signal);
    if (controller.signal.aborted) return;
    setOpeningId(null);
    if (!pub) {
      setOpenFailed(true);
      return;
    }
    openPub(pub);
  };

  const beerFilter = (s: BeerBrandSuggestion) =>
    s.kind === 'menu' ? { key: `${BEER_NAME_FILTER_PREFIX}${s.slug}`, label: s.name } : { key: s.brandSlug ?? s.slug, label: s.brandName ?? s.name };
  const beerLabel = beerSuggestion ? (beerSuggestion.brandName ?? beerSuggestion.name).replace(/ \d+°$/, '') : '';
  const nearbyRows = suggestions.nearby.slice(0, 3);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 8 }}>
      <View style={[s.row, { paddingHorizontal: SCREEN_X, gap: 12, height: 48 }]}>
        <View style={[s.fill, s.row, { height: 48, borderRadius: 24, paddingHorizontal: 16, gap: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.yellowStrong }]}>
          <Icon name="search" size={18} color={C.text2} />
          <TextInput
            autoFocus
            value={q}
            onChangeText={(next) => {
              resolving.current?.abort();
              setOpeningId(null);
              setOpenFailed(false);
              setQ(next);
            }}
            placeholder={L().searchPrompt}
            placeholderTextColor={C.muted}
            selectionColor={C.yellow}
            cursorColor={C.yellow}
            keyboardAppearance="dark"
            returnKeyType="search"
            style={[font(16, 600), { flex: 1, padding: 0 }]}
          />
          {searching ? <Spinner size="small" /> : null}
        </View>
        <Press onPress={() => nvBack(router)} hitSlop={10}>
          <T s={15} w={700} c={C.yellow}>
            {L().cancelSearch}
          </T>
        </Press>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: SCREEN_X, gap: 16, paddingBottom: insets.bottom + 40 }}>
        {!canSearch && live.length ? (
          <>
            <T s={19} w={700}>
              {L().partyNow}
            </T>
            <Card>
              {live.map((p, i) => {
                const first = p.activities[0]?.account;
                const name = first?.displayName || first?.nickname || '';
                const near = suggestions.nearby.find((n) => geohash8(n.pub.lat, n.pub.lng) === p.cacheKey);
                const here = near?.pub ?? suggestions.pubs.find((pub) => geohash8(pub.lat, pub.lng) === p.cacheKey);
                return (
                  <Row
                    key={p.cacheKey}
                    last={i === live.length - 1}
                    leading={<Person initial={(name || '?').slice(0, 1).toUpperCase()} />}
                    title={p.name}
                    sub={L().friendsHere(name, p.activities.length - 1)}
                    trailing={<Distance meters={near?.distanceMeters} />}
                    onPress={() => (here ? openPub(here) : openPub({ id: '', name: p.name, lat: p.lat, lng: p.lng, city: p.city }))}
                  />
                );
              })}
            </Card>
          </>
        ) : null}
        {favorites.length && (!canSearch || results.length === 0) ? (
          <>
            <T s={19} w={700}>
              {L().favorites}
            </T>
            <Card>
              {favorites.map((p, i) => (
                <Row key={`${p.id}-${p.lat}-${p.lng}`} last={i === favorites.length - 1} leading={<Tile icon="heart" />} title={p.name} sub={areaLine(p)} onPress={() => openPub(p)} />
              ))}
            </Card>
          </>
        ) : null}
        {results.length ? (
          <>
            <T s={19} w={700}>
              {L().pubsSection}
            </T>
            <Card>
              {results.map((r, i) => (
                <Row
                  key={r.id}
                  last={i === results.length - 1}
                  leading={<Tile icon="beer" />}
                  title={r.name}
                  sub={r.pub ? areaLine(r.pub) : r.location || [r.address, r.city].filter(Boolean).join(', ') || undefined}
                  trailing={openingId === r.id ? <Spinner /> : null}
                  onPress={() => void openResult(r)}
                />
              ))}
            </Card>
          </>
        ) : null}
        {beerSuggestion ? (
          <>
            <T s={19} w={700}>
              {L().pouring(beerLabel)}
            </T>
            <Card>
              {pouring.map(({ pub, tap }) => (
                <Row
                  key={`${pub.id}-${pub.lat}`}
                  leading={<Tile icon="beer" />}
                  title={pub.name}
                  sub={tap.priceCzk ? L().beerPrice(tap.name, formatPrice(tap.priceCzk, currency)) : tap.name}
                  onPress={() => {
                    setFilters({ beerBrand: beerFilter(beerSuggestion) });
                    pick(pub);
                    openPub(pub);
                  }}
                />
              ))}
              <Row
                last
                leading={<Tile icon="map" />}
                title={L().findPouring}
                sub={L().findPouringSub}
                chevron
                onPress={() => {
                  remember();
                  setFilters({ beerBrand: beerFilter(beerSuggestion) });
                  pick(null);
                  router.navigate('/nv/kompas');
                }}
              />
            </Card>
          </>
        ) : null}
        {!canSearch && nearbyRows.length ? (
          <>
            <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-end' }]}>
              <T s={19} w={700}>
                {L().inView}
              </T>
              <T s={13} c={C.muted}>
                {L().inViewCount(suggestions.pubs.length)}
              </T>
            </View>
            <Card>
              {nearbyRows.map(({ pub, distanceMeters }, i) => {
                const tap = pub.beers?.[0];
                const czk = tap?.priceCzk ?? pub.price?.czk;
                return (
                  <Row
                    key={`${pub.id}-${pub.lat}`}
                    last={i === nearbyRows.length - 1}
                    leading={<Tile icon="beer" />}
                    title={pub.name}
                    sub={tap ? (czk ? L().beerPrice(tap.name, formatPrice(czk, currency)) : tap.name) : L().unknownMenu}
                    trailing={<Distance meters={distanceMeters} />}
                    onPress={() => openPub(pub)}
                  />
                );
              })}
            </Card>
          </>
        ) : null}
        {failed ? (
          <T s={14} c={C.muted}>
            {L().searchFailed}
          </T>
        ) : null}
        {openFailed ? (
          <T s={14} c={C.muted}>
            {L().openFailed}
          </T>
        ) : null}
        {canSearch && !searching && !results.length && !beerSuggestion ? (
          <T s={15} c={C.muted} style={{ paddingVertical: 8 }}>
            {L().notFound(term)}
          </T>
        ) : null}
        <Press onPress={() => router.push('/nv/pridat-hospodu')} style={[s.row, { gap: 12, padding: 16, borderRadius: 24, borderWidth: 1, borderColor: C.hairline }]}>
          <Tile icon="map-pin-plus" />
          <View style={[s.fill, { gap: 2 }]}>
            <T s={16} w={700}>
              {L().missingPub}
            </T>
            <T s={13} c={C.muted}>
              {L().missingPubSub}
            </T>
          </View>
          <Icon name="chevron-right" size={16} color={C.muted} />
        </Press>
      </ScrollView>
    </View>
  );
}
