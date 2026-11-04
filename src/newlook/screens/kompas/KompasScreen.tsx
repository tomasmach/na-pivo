import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { LayoutAnimationConfig, runOnJS } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haversineMeters } from '@/compass/distance';
import type { AmenityKey } from '@/data/amenities';
import { CRAFT_BEER_FILTER_KEY } from '@/data/pubSearchFilters';
import { geohash8 } from '@/data/geohash';
import type { Pub } from '@/data/pubs';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { buildVisitedCities } from '@/map/mapModel';
import { t } from '@/i18n';
import { useFocusedPubStore } from '@/stores/focusedPubStore';
import { usePubStore } from '@/stores/pubStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToursStore } from '@/stores/toursStore';
import { formatPrice } from '@/utils/currency';
import { openPubInMaps } from '@/utils/maps';

import { Glass, GlassButton, LevelAvatar, useTabBarSpace } from '../../components/chrome';
import { Icon, type IconName } from '../../components/Icon';
import { Button, Chip, D, Dot, IconButton, Press, T } from '../../components/ui';
import { usePubNameReveal } from '../../hiddenPubNames';
import { toast } from '../../ui/store';
import { DURATION, enter, fadeIn, riseIn } from '../../motion';
import { C, SCREEN_X, s, shadow } from '../../theme';
import { Dial } from './Dial';
import { distanceLabel, formatDistance, hoursNow } from './format';
import { NvMap, type NvMapHandle } from './NvMap';
import { openNvPub, setOpenOnly, useKompasState } from './state';
import { pinId, useKompas, type Kompas, type KompasTarget } from './useKompas';

const L = () => t.nv.kompas;
// "Jinou" swaps the pub inside the card in place; the card itself stays put.
const SWAP_IN = enter(0, DURATION.fast);

const PILSNER = { key: 'pilsner-urquell', label: 'Pilsner Urquell' };
const CRAFT = { key: CRAFT_BEER_FILTER_KEY, label: 'Craft' };
const CATEGORIES: { key: string; icon: IconName; label: () => string; amenity?: AmenityKey; beer?: typeof PILSNER }[] = [
  { key: 'pilsner', icon: 'beer', label: () => L().categories.pilsner, beer: PILSNER },
  { key: 'craft', icon: 'flask-conical', label: () => L().categories.craft, beer: CRAFT },
  { key: 'game_darts', icon: 'target', label: () => L().categories.darts, amenity: 'game_darts' },
  { key: 'seating_garden', icon: 'trees', label: () => L().categories.garden, amenity: 'seating_garden' },
  { key: 'atmosphere_sports_tv', icon: 'tv', label: () => L().categories.sportsTv, amenity: 'atmosphere_sports_tv' },
];

function toggleAmenity(key: AmenityKey) {
  const { filters, setFilters } = useKompasState.getState();
  const has = filters.amenityKeys.includes(key);
  setFilters({ amenityKeys: has ? filters.amenityKeys.filter((k) => k !== key) : [...filters.amenityKeys, key] });
}

function summaryLine(k: Kompas): string {
  const { filters } = useKompasState.getState();
  const parts: string[] = [];
  if (k.hideClosed) parts.push(L().summaryOpen);
  if (filters.beerBrand) parts.push(L().summaryPubs(k.mapPubs.length));
  else if (filters.priceMaxCzk) parts.push(L().summaryMaxPrice(filters.priceMaxCzk));
  return parts.join(' · ') || L().summaryAll;
}

/** The beer line under a pub: last week's count on the count layer, else the first tap with its price. */
function subLine(target: KompasTarget, mode: 'price' | 'count', k: Kompas): string {
  if (target.kind === 'friend') return L().partyHere;
  if (target.kind === 'tour') return L().tourStop(target.stopNumber ?? 1);
  const pub = target.pub;
  if (mode === 'count') {
    const n = k.beersLastWeek?.get(target.key);
    if (n) return L().lastWeekLine(n);
  }
  const currency = useSettingsStore.getState().priceCurrency;
  const beer = pub?.beers?.[0];
  const czk = beer?.priceCzk ?? pub?.price?.czk;
  if (beer) return czk ? L().beerPrice(beer.name, formatPrice(czk, currency)) : beer.name;
  if (czk) return formatPrice(czk, currency);
  return L().unknownTaps;
}

type NameReveal = ReturnType<typeof usePubNameReveal>;

function goThere(target: KompasTarget, secret: boolean) {
  trackUiInteraction('compass_directions_open');
  const name = secret ? t.nv.common.secretPub : target.name;
  const sub = target.distance != null ? L().guideSub(name, distanceLabel(target.distance)) : name;
  toast({ kind: 'info', title: L().guideTitle, sub, icon: 'navigation' });
  void openPubInMaps({ lat: target.lat, lng: target.lng, name: target.name, googlePlaceId: target.pub?.googlePlaceId });
}

function openTarget(router: ReturnType<typeof useRouter>, target: KompasTarget, from: 'map' | 'compass', name: NameReveal) {
  if (name.secret) {
    trackUiInteraction('compass_pub_reveal');
    name.reveal();
    return;
  }
  trackUiInteraction(from === 'map' ? 'map_pub_detail_open' : 'compass_pub_card_open');
  openNvPub(router, target.pub ?? { id: '', name: target.name, lat: target.lat, lng: target.lng });
}

function openFilters(router: ReturnType<typeof useRouter>) {
  trackUiInteraction('compass_filters_open');
  router.push('/nv/filtry');
}

function toParty(k: Kompas) {
  const live = k.map.livePubs;
  if (!live.length) {
    toast({ kind: 'info', title: L().noPartyLive, icon: 'users' });
    return;
  }
  const from = k.position;
  const nearest = [...live].sort((a, b) => (from ? haversineMeters(from, a) - haversineMeters(from, b) : 0))[0];
  const friend = nearest.activities[0]?.account;
  useKompasState.getState().pick(null);
  useFocusedPubStore.getState().setFocusedPub({ lat: nearest.lat, lng: nearest.lng, name: nearest.name, cacheKey: nearest.cacheKey });
  toast({
    kind: 'info',
    title: L().toPartyTitle,
    sub: L().toPartySub(friend?.displayName || friend?.nickname || '', nearest.name),
    icon: 'users',
  });
}

export function KompasScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<'map' | 'compass'>('map');
  const k = useKompas();
  const { arrived, target, dismissArrival } = k;
  const picked = useKompasState((st) => st.picked);
  // A pub you picked on the map or in search is no secret to you.
  const name = usePubNameReveal(target && target.kind !== 'tour' && !(picked && target.kind === 'pub') ? target.key : null);

  useEffect(() => {
    if (!arrived || !target) return;
    if (target.pub) usePubStore.getState().setRevealedPub(target.pub);
    router.push({ pathname: '/nv/prichod', params: { name: target.name, lat: String(target.lat), lng: String(target.lng) } });
    dismissArrival();
  }, [arrived, dismissArrival, router, target]);

  const showCompass = () => {
    trackUiInteraction('compass_return');
    setMode('compass');
  };
  const showMap = () => {
    trackUiInteraction('compass_map_open');
    setMode('map');
  };
  return mode === 'map' ? <MapMode k={k} name={name} onCompass={showCompass} /> : <CompassMode k={k} name={name} onMap={showMap} />;
}

function MapMode({ k, name, onCompass }: { k: Kompas; name: NameReveal; onCompass: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const mapRef = useRef<NvMapHandle>(null);
  const st = useKompasState();
  const { target } = k;
  const [collapsed, setCollapsed] = useState(false);
  const [cityKey, setCityKey] = useState<string | null>(null);
  const layersDot = st.mapView !== 'okoli' || st.pinMode !== 'price' || st.onlyDrunk;
  const city = k.map.visitedCities.find((c) => c.key === cityKey) ?? k.map.visitedCities[0];

  const swipe = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .onEnd((e) => {
      if (e.translationY > 30) runOnJS(setCollapsed)(true);
    });

  const beerFilter = st.filters.beerBrand;
  const activeChip = st.mapView === 'stopy' ? L().chipTraces : st.onlyDrunk ? L().chipOnlyDrunk : beerFilter?.label ?? null;
  const clearActive = () => {
    if (st.mapView === 'stopy') st.set({ mapView: 'okoli' });
    else if (st.onlyDrunk) st.set({ onlyDrunk: false });
    else st.setFilters({ beerBrand: null });
  };

  const onPub = (id: string) => {
    const pub = k.mapPubs.find((p) => pinId(p) === id) ?? (st.picked && pinId(st.picked) === id ? st.picked : null);
    if (pub) {
      trackUiInteraction('map_pub_select', 'select');
      st.pick(pub);
    }
    setCollapsed(false);
  };

  const locate = async () => {
    trackUiInteraction('map_locate');
    st.set({ mapView: 'okoli' });
    if (k.map.permissionState !== 'granted') {
      await k.map.requestPermission();
      return;
    }
    const fix = (await k.map.refreshPosition()) ?? k.position;
    if (fix) mapRef.current?.centerOn(fix);
  };

  const showCityPubs = () => {
    if (!city) return;
    // The same key the map grouped the city by.
    const pubs = k.map.visitedPubs.filter((p) => buildVisitedCities([p])[0]?.key === city.key);
    st.set({ cityPubs: { name: city.name, pubs } });
    router.push({ pathname: '/nv/moje-hospody', params: { city: city.name } });
  };

  const hours = target?.pub ? hoursNow(target.pub) : null;
  const { livePubs, visitedCities } = k.map;
  const friends = useMemo(
    () =>
      livePubs.map((p) => ({
        key: p.cacheKey,
        lat: p.lat,
        lng: p.lng,
        initial: (p.activities[0]?.account.displayName || p.activities[0]?.account.nickname || '?').slice(0, 1).toUpperCase(),
      })),
    [livePubs],
  );
  const cities = useMemo(() => visitedCities.map((c) => ({ key: c.key, name: c.name, lat: c.lat, lng: c.lng, count: c.visitCount })), [visitedCities]);

  // The map buttons sit just above whatever card is showing, or above the tab bar when none is.
  const cardSpace = st.mapView === 'stopy' ? (city ? 160 : 0) : target ? (collapsed ? 64 : 160) : 0;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <NvMap
        ref={mapRef}
        pins={k.pins}
        me={k.position}
        target={target}
        friends={friends}
        cities={cities}
        view={st.mapView}
        pinMode={st.pinMode}
        selectedCity={city?.key}
        onPub={onPub}
        onCity={setCityKey}
        onRegion={k.map.loadRegion}
        bottomPadding={tabSpace + 140}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 210,
          experimental_backgroundImage: 'linear-gradient(180deg, #0A0A0AF5 0%, #0A0A0AB3 60%, #0A0A0A00 100%)',
        }}
      />
      <View style={{ position: 'absolute', top: insets.top + 4, left: SCREEN_X, right: SCREEN_X, gap: 12 }}>
        <View style={[s.row, { gap: 10 }]}>
          <Press haptic onPress={onCompass} accessibilityLabel={L().compassA11y} style={{ width: 54, height: 54 }}>
            <MiniCompass />
          </Press>
          <Press
            haptic
            onPress={() => router.push('/nv/hledani')}
            accessibilityRole="search"
            style={[
              s.fill,
              s.row,
              { height: 54, borderRadius: 27, paddingLeft: 18, paddingRight: 8, gap: 12, backgroundColor: '#141414F0', borderWidth: 1, borderColor: C.ring },
              shadow.raised,
            ]}
          >
            <Icon name="search" size={19} />
            <View style={[s.fill, { gap: 1 }]}>
              <T s={15} w={700}>
                {L().searchPrompt}
              </T>
              <T s={12} w={500} c={C.yellow} numberOfLines={1}>
                {summaryLine(k)}
              </T>
            </View>
            <IconButton icon="sliders-horizontal" size={38} iconSize={17} badge={k.filterCount || undefined} onPress={() => openFilters(router)} label={L().filters} />
          </Press>
          <LevelAvatar />
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ position: 'absolute', top: insets.top + 70, left: 0, right: 0 }}
        contentContainerStyle={{ paddingHorizontal: SCREEN_X, gap: 8 }}
      >
        {activeChip ? (
          <Press
            haptic
            onPress={clearActive}
            style={[s.row, { height: 34, borderRadius: 17, paddingLeft: 13, paddingRight: 10, gap: 6, backgroundColor: '#3A2E08F0', borderWidth: 1, borderColor: C.yellowStrong }]}
          >
            {beerFilter && st.mapView !== 'stopy' && !st.onlyDrunk ? <Icon name="beer" size={15} color={C.yellow} /> : null}
            <T s={13} w={700} c={C.yellow}>
              {activeChip}
            </T>
            <Icon name="x" size={14} color={C.yellow} />
          </Press>
        ) : null}
        {CATEGORIES.filter((c) => !(c.beer && beerFilter?.key === c.beer.key)).map((c) => {
          const on = c.beer ? beerFilter?.key === c.beer.key : !!c.amenity && st.filters.amenityKeys.includes(c.amenity);
          return (
            <Press
              key={c.key}
              haptic
              onPress={() => (c.beer ? st.setFilters({ beerBrand: on ? null : c.beer }) : c.amenity && toggleAmenity(c.amenity))}
              style={[
                s.row,
                {
                  height: 34,
                  borderRadius: 17,
                  paddingHorizontal: 13,
                  gap: 6,
                  backgroundColor: on ? '#3A2E08F0' : '#141414F0',
                  borderWidth: 1,
                  borderColor: on ? C.yellowStrong : C.line,
                },
              ]}
            >
              <Icon name={c.icon} size={15} color={C.yellow} />
              <T s={13} w={on ? 700 : 600} c={on ? C.yellow : C.white}>
                {c.label()}
              </T>
            </Press>
          );
        })}
      </ScrollView>

      <View style={{ position: 'absolute', right: SCREEN_X - 8, bottom: tabSpace + cardSpace + 12, gap: 8 }}>
        <View>
          <GlassButton icon="layers" label={L().layers} onPress={() => router.push('/nv/vrstvy')} />
          {layersDot ? (
            <View style={{ position: 'absolute', right: 1, top: 1, width: 12, height: 12, borderRadius: 6, backgroundColor: C.yellow, borderWidth: 2.5, borderColor: C.black }} />
          ) : null}
        </View>
        <GlassButton icon="locate-fixed" label={L().myLocation} onPress={() => void locate()} />
      </View>

      <View style={{ position: 'absolute', left: 12, right: 12, bottom: tabSpace + 4 }}>
        {/* The card is already there when the tab opens; it only rises in when it shows up later. */}
        <LayoutAnimationConfig skipEntering>
          {st.mapView === 'stopy' && city ? (
            <Animated.View entering={riseIn} style={[{ backgroundColor: C.yellow, borderRadius: 26, paddingTop: 20, paddingHorizontal: 16, paddingBottom: 16, gap: 14 }]}>
              <Grabber />
              <View style={{ gap: 3, paddingLeft: 2 }}>
                <T s={18} w={600} c={C.black}>
                  {city.name}
                </T>
                <T s={13} c={C.onYellowMuted}>{L().cityStats(city.visitCount, city.pubCount)}</T>
              </View>
              <Button label={L().showMyPubs} icon="map-pinned" kind="onYellow" height={46} onPress={showCityPubs} />
            </Animated.View>
          ) : st.mapView !== 'stopy' && target && !collapsed ? (
            <GestureDetector gesture={swipe}>
              <Animated.View entering={riseIn} style={[{ backgroundColor: C.yellow, borderRadius: 26, paddingTop: 20, paddingHorizontal: 16, paddingBottom: 16, gap: 14 }]}>
                <Press onPress={() => setCollapsed(true)} hitSlop={12} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 20 }}>
                  <Grabber />
                </Press>
                <Animated.View key={target.key} entering={SWAP_IN}>
                  <Press onPress={() => openTarget(router, target, 'map', name)} style={[s.row, { justifyContent: 'space-between', paddingLeft: 2 }]}>
                    <View style={[s.fill, { gap: 3 }]}>
                      <View style={[s.row, { gap: 6 }]}>
                        {name.secret ? <Icon name="eye-off" size={17} color={C.black} /> : null}
                        <T s={18} w={600} c={C.black} style={{ letterSpacing: -0.2, flexShrink: 1 }} numberOfLines={1}>
                          {name.secret ? t.nv.common.secretPub : target.name}
                        </T>
                      </View>
                      {name.secret || name.secondsLeft ? (
                        <View style={[s.row, { gap: 5 }]}>
                          {name.secondsLeft ? <Icon name="eye-off" size={13} color={C.onYellowMuted} /> : null}
                          <T s={13} w={600} c={name.secret ? C.black : C.onYellowMuted} numberOfLines={1} style={s.fill}>
                            {name.secondsLeft ? t.nv.common.secretHidesIn(name.secondsLeft) : t.nv.common.secretReveal}
                          </T>
                        </View>
                      ) : (
                      <View style={[s.row, { gap: 5 }]}>
                        {hours ? (
                          <>
                            <Dot color={hours.tone === 'open' ? C.black : C.onYellowMuted} />
                            <T s={13} w={600} c={C.black}>
                              {hours.tone === 'open' ? (hours.until ? L().openUntilShort(hours.until) : L().openShort) : hours.tone === 'closed' ? L().closedShort : L().hoursUnknownShort}
                            </T>
                          </>
                        ) : null}
                        <T s={13} c={C.onYellowMuted} numberOfLines={1} style={s.fill}>{`${hours ? '· ' : ''}${subLine(target, st.pinMode, k)}`}</T>
                      </View>
                      )}
                    </View>
                    {target.distance != null ? (
                      <View style={[s.row, { alignItems: 'flex-end', gap: 3 }]}>
                        <D s={24} c={C.black} lh={1.15}>
                          {formatDistance(target.distance).value}
                        </D>
                        <T s={14} w={600} c={C.onYellowMuted} style={{ marginBottom: 3 }}>
                          {formatDistance(target.distance).unit}
                        </T>
                      </View>
                    ) : null}
                  </Press>
                </Animated.View>
                <View style={[s.row, { gap: 10 }]}>
                  <Button label={L().guideMe} icon="navigation" kind="onYellow" height={46} flex onPress={() => goThere(target, name.secret)} />
                  {target.kind !== 'tour' ? (
                    <Button label={L().another} icon="shuffle" kind="onYellowGhost" height={46} style={{ paddingHorizontal: 16 }} onPress={k.nextTarget} />
                  ) : null}
                </View>
              </Animated.View>
            </GestureDetector>
          ) : st.mapView !== 'stopy' && target ? (
            <Animated.View entering={fadeIn} style={{ alignItems: 'center' }}>
              <Press haptic onPress={() => setCollapsed(false)}>
                <Glass style={[s.row, { height: 44, borderRadius: 22, paddingHorizontal: 16, gap: 8 }]}>
                  {target.distance != null ? (
                    <>
                      <T s={15} w={800} c={C.yellow}>
                        {distanceLabel(target.distance)}
                      </T>
                      <T s={15} c={C.muted}>
                        ·
                      </T>
                    </>
                  ) : null}
                  {name.secret ? <Icon name="eye-off" size={15} color={C.yellow} /> : null}
                  <T s={15} w={700} numberOfLines={1}>
                    {name.secret ? t.nv.common.secretPub : target.name}
                  </T>
                  <Icon name="chevron-up" size={16} color={C.text2} />
                </Glass>
              </Press>
            </Animated.View>
          ) : null}
        </LayoutAnimationConfig>
      </View>
    </View>
  );
}

function Grabber() {
  return <View style={{ position: 'absolute', top: 7, alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: '#0000004D' }} />;
}

function MiniCompass() {
  return (
    <View style={[{ width: 54, height: 54, borderRadius: 27, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.lineBright }, s.center, shadow.raised]}>
      <View style={{ width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderBottomWidth: 19, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: C.yellow }} />
      <View style={{ width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 19, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: C.lineBright }} />
    </View>
  );
}

const EMPTY_ICON: Record<Exclude<Kompas['state'], 'normal'>, IconName> = {
  loading: 'compass',
  location: 'map-pin',
  error: 'wifi-off',
  empty: 'beer-off',
  noresults: 'funnel-x',
};

function emptyCopy(state: Exclude<Kompas['state'], 'normal'>): { title: string; body: string } {
  switch (state) {
    case 'loading':
      return { title: L().loadingTitle, body: L().loadingBody };
    case 'location':
      return { title: L().locationTitle, body: t.permissions.body };
    case 'error':
      return { title: L().errorTitle, body: L().errorBody };
    case 'empty':
      return { title: L().emptyTitle, body: L().emptyBody };
    default:
      return { title: L().noResultsTitle, body: L().noResultsBody };
  }
}

function CompassMode({ k, name, onMap }: { k: Kompas; name: NameReveal; onMap: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const st = useKompasState();
  const { target, state } = k;
  const tour = target?.kind === 'tour';
  const nearest = k.nearest;
  const hours = target?.pub ? hoursNow(target.pub) : null;
  const backToNearest: Pub | null =
    target?.kind !== 'tour' && nearest && geohash8(nearest.lat, nearest.lng) !== target?.key ? nearest : null;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 8, paddingHorizontal: SCREEN_X, paddingBottom: tabSpace + 14 }}>
      <View style={[s.row, { justifyContent: 'space-between', height: 44 }]}>
        <IconButton icon="map" color={C.yellow} onPress={onMap} label={L().map} iconSize={20} />
        <View style={[s.row, { gap: 10 }]}>
          <IconButton icon="search" onPress={() => router.push('/nv/hledani')} label={L().search} iconSize={20} />
          <LevelAvatar />
        </View>
      </View>
      <View style={[s.row, { gap: 8, marginTop: 12, opacity: tour ? 0 : 1 }]} pointerEvents={tour ? 'none' : 'auto'}>
        <Chip label={L().filters} icon="sliders-horizontal" onPress={() => openFilters(router)} />
        {k.hideClosed ? (
          <Chip
            label={L().openNowChip}
            active
            onPress={() => {
              trackUiInteraction('settings_hide_closed', 'toggle_off');
              setOpenOnly(false);
            }}
          />
        ) : null}
        {st.filters.priceMaxCzk && state === 'noresults' ? (
          <Chip label={L().maxPriceChip(st.filters.priceMaxCzk)} active onPress={() => st.setFilters({ priceMaxCzk: null })} />
        ) : null}
      </View>
      <View style={{ flex: 1, justifyContent: 'space-evenly' }}>
        {state === 'normal' && target ? (
          <>
            <Dial
              target={{ id: target.key, coord: { latitude: target.lat, longitude: target.lng }, distance: target.distance ?? 0 }}
              others={k.others}
              from={k.position ? { latitude: k.position.lat, longitude: k.position.lng } : null}
              heading={k.compass.heading}
            />
            <View style={{ alignItems: 'center', gap: 6 }}>
              <Press onPress={() => openTarget(router, target, 'compass', name)} style={{ alignItems: 'center', gap: 6 }}>
                <View style={[s.row, { gap: 8 }]}>
                  {name.secret ? <Icon name="eye-off" size={20} color={C.yellow} /> : null}
                  <T s={22} w={700} numberOfLines={1} style={{ flexShrink: 1 }}>
                    {name.secret ? t.nv.common.secretPub : target.name}
                  </T>
                  {name.secret ? null : <Icon name="chevron-right" size={18} color={C.muted} />}
                </View>
                {name.secret ? (
                  <T s={15} w={600} c={C.yellow}>
                    {t.nv.common.secretReveal}
                  </T>
                ) : name.secondsLeft ? (
                  <View style={[s.row, { gap: 6 }]}>
                    <Icon name="eye-off" size={15} color={C.muted} />
                    <T s={15} c={C.muted}>
                      {t.nv.common.secretHidesIn(name.secondsLeft)}
                    </T>
                  </View>
                ) : null}
              </Press>
              <View style={[s.row, { gap: 6 }]}>
                {hours ? (
                  <>
                    <Dot color={hours.tone === 'open' ? C.open : C.muted} size={7} />
                    <T s={15} w={600} c={hours.tone === 'open' ? C.open : C.muted}>
                      {hours.tone === 'open' ? (hours.until ? L().openUntil(hours.until) : L().openNow) : hours.tone === 'closed' ? L().closedNow : L().hoursUnknown}
                    </T>
                  </>
                ) : null}
                <T s={15} c={C.muted} numberOfLines={1} style={{ flexShrink: 1 }}>
                  {`${hours ? '· ' : ''}${subLine(target, 'price', k)}`}
                </T>
              </View>
              {backToNearest ? (
                <Press
                  haptic
                  onPress={() => st.pick(backToNearest)}
                  style={[s.row, { marginTop: 14, height: 40, borderRadius: 20, paddingHorizontal: 16, gap: 8, backgroundColor: C.control }]}
                >
                  <Icon name="undo-2" size={16} color={C.yellow} />
                  <T s={15} w={700}>
                    {L().backToNearest}
                  </T>
                  {k.position ? <T s={15} c={C.muted}>{distanceLabel(haversineMeters(k.position, backToNearest))}</T> : null}
                </Press>
              ) : null}
            </View>
          </>
        ) : (
          <>
            <Dial dim centerIcon={EMPTY_ICON[state === 'normal' ? 'empty' : state]} />
            <View style={{ gap: 10 }}>
              <D s={48} lh={0.95}>
                {emptyCopy(state === 'normal' ? 'empty' : state).title}
              </D>
              <T s={15} w={500} c={C.muted} lh={1.4}>
                {emptyCopy(state === 'normal' ? 'empty' : state).body}
              </T>
            </View>
          </>
        )}
      </View>
      {state === 'normal' && target ? (
        <View style={{ gap: 10 }}>
          <Button label={L().guideMe} icon="navigation" onPress={() => goThere(target, name.secret)} />
          <View style={[s.row, { gap: 10 }]}>
            {tour ? (
              <Button label={L().skip} icon="skip-forward" kind="raised" flex onPress={() => target.stopId && void useToursStore.getState().markStop(target.stopId, 'skipped')} />
            ) : (
              <Button label={L().another} icon="shuffle" kind="raised" flex onPress={k.nextTarget} />
            )}
            <Button label={L().toParty} icon="users" kind="raised" flex onPress={() => toParty(k)} />
          </View>
        </View>
      ) : state === 'location' ? (
        <Button label={L().locationCta} icon="map-pin" onPress={() => void k.compass.requestPermission()} />
      ) : state === 'loading' ? null : state === 'error' ? (
        <Button label={L().retry} icon="refresh-cw" onPress={k.compass.retrySearch} />
      ) : state === 'empty' ? (
        <View style={[s.row, { gap: 10 }]}>
          <Button label={L().retry} icon="refresh-cw" flex onPress={k.compass.retrySearch} />
          <Button
            label={L().addPub}
            icon="plus"
            kind="raised"
            flex
            onPress={() => {
              trackUiInteraction('compass_add_pub_open');
              router.push('/nv/pridat-hospodu');
            }}
          />
        </View>
      ) : (
        <View style={[s.row, { gap: 10 }]}>
          <Button label={L().editFilters} icon="sliders-horizontal" flex onPress={() => openFilters(router)} />
          <Button
            label={L().clearFilters}
            icon="x"
            kind="raised"
            flex
            onPress={() => {
              trackUiInteraction('compass_filters_clear');
              st.clearFilters();
            }}
          />
        </View>
      )}
    </View>
  );
}
