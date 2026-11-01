import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeInDown, runOnJS } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glass, GlassButton, LevelAvatar, useTabBarSpace } from '../../components/chrome';
import { Icon, type IconName } from '../../components/Icon';
import { Button, Chip, D, Dot, IconButton, Press, T } from '../../components/ui';
import { PUBS, beerById, formatDistance, type Pub } from '../../mock/data';
import { matchingPubs, toast, useMock } from '../../mock/store';
import { C, SCREEN_X, s, shadow } from '../../theme';
import { TOUR, nextStopIndex, stopAsPub } from '../../mock/tour';
import { CITIES, NvMap } from './NvMap';
import { Dial } from './Dial';

const CATEGORIES: { key: string; label: string; icon: IconName; beer?: string }[] = [
  { key: 'plzen', label: 'Pilsner Urquell', icon: 'beer', beer: 'pilsner' },
  { key: 'craft', label: 'Craft', icon: 'flask-conical' },
  { key: 'sipky', label: 'Šipky', icon: 'target' },
  { key: 'zahradka', label: 'Zahrádka', icon: 'trees' },
  { key: 'tv', label: 'Sport v TV', icon: 'tv' },
];

function useFilters() {
  const st = useMock();
  const pubs = matchingPubs(st);
  const target = pubs.find((p) => p.id === st.targetId) ?? pubs[0];
  const parts: string[] = [];
  if (st.openNow) parts.push('Otevřeno teď');
  if (st.beerFilter) parts.push(`${pubs.length} hospod`);
  else if (st.maxPrice) parts.push(`do ${st.maxPrice} Kč`);
  const count = (st.openNow ? 1 : 0) + (st.maxPrice ? 1 : 0) + st.tags.length + (st.beerFilter ? 1 : 0);
  return { st, pubs, target, summary: parts.join(' · ') || 'Všechny hospody', count };
}

function subLine(p: Pub, mode: 'price' | 'count') {
  if (mode === 'count' && p.lastWeekBeers) return `minulý týden tu padlo ${Math.round(p.lastWeekBeers / 4)} piv`;
  const beer = beerById(p.mainBeerId);
  if (!beer) return 'co čepují, zatím nevím';
  return `${beer.name} · ${p.price} Kč`;
}

export function KompasScreen() {
  const [mode, setMode] = useState<'map' | 'compass'>('map');
  return mode === 'map' ? <MapMode onCompass={() => setMode('compass')} /> : <CompassMode onMap={() => setMode('map')} />;
}

function goThere(router: ReturnType<typeof useRouter>, pub: Pub) {
  toast({ kind: 'info', title: 'Vedu tě do Map', sub: `${pub.name}, ${formatDistance(pub.distance).value} ${formatDistance(pub.distance).unit} pěšky`, icon: 'navigation' });
  setTimeout(() => router.push({ pathname: '/nv/prichod', params: { id: pub.id } }), 1600);
}

function MapMode({ onCompass }: { onCompass: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const { st, target, summary, count } = useFilters();
  const [collapsed, setCollapsed] = useState(false);
  const [city, setCity] = useState('Praha');
  const layersDot = st.mapView !== 'okoli' || st.pinMode !== 'price' || st.onlyDrunk;
  const cityInfo = CITIES.find((c) => c.name === city);

  const swipe = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .onEnd((e) => {
      if (e.translationY > 30) runOnJS(setCollapsed)(true);
    });

  const activeChip = st.mapView === 'stopy' ? 'Moje stopy' : st.onlyDrunk ? 'Jen kde se pilo' : st.beerFilter ? beerById(st.beerFilter)?.name : null;
  const clearActive = () => {
    if (st.mapView === 'stopy') st.set({ mapView: 'okoli' });
    else if (st.onlyDrunk) st.set({ onlyDrunk: false });
    else st.set({ beerFilter: null });
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <NvMap
        pubs={PUBS.filter((p) => p.distance < 2000 && (!st.onlyDrunk || (p.lastWeekBeers ?? 0) > 0) && (!st.beerFilter || p.taps.some((x) => x.beerId === st.beerFilter) || !p.taps.length))}
        targetId={target?.id ?? null}
        view={st.mapView}
        pinMode={st.pinMode}
        selectedCity={city}
        onPub={(id) => {
          st.set({ targetId: id });
          setCollapsed(false);
        }}
        onCity={setCity}
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
          <Press haptic onPress={onCompass} accessibilityLabel="Kompas" style={{ width: 54, height: 54 }}>
            <MiniCompass />
          </Press>
          <Press
            haptic
            onPress={() => router.push('/nv/hledani')}
            accessibilityRole="search"
            style={[
              s.fill,
              s.row,
              { height: 54, borderRadius: 27, paddingLeft: 18, paddingRight: 8, gap: 12, backgroundColor: '#141414F0', borderWidth: 1, borderColor: '#FFFFFF24' },
              shadow.raised,
            ]}
          >
            <Icon name="search" size={19} />
            <View style={[s.fill, { gap: 1 }]}>
              <T s={15} w={700}>
                Kam na pivo?
              </T>
              <T s={12} w={500} c={C.yellow} numberOfLines={1}>
                {summary}
              </T>
            </View>
            <IconButton icon="sliders-horizontal" size={38} iconSize={17} badge={count || undefined} onPress={() => router.push('/nv/filtry')} label="Filtry" />
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
            style={[s.row, { height: 34, borderRadius: 17, paddingLeft: 13, paddingRight: 10, gap: 6, backgroundColor: '#3A2E08F0', borderWidth: 1, borderColor: '#FFC40099' }]}
          >
            {st.beerFilter && st.mapView !== 'stopy' && !st.onlyDrunk ? <Icon name="beer" size={15} color={C.yellow} /> : null}
            <T s={13} w={700} c={C.yellow}>
              {activeChip}
            </T>
            <Icon name="x" size={14} color={C.yellow} />
          </Press>
        ) : null}
        {CATEGORIES.filter((c) => !(c.beer && st.beerFilter === c.beer)).map((c) => {
          const on = c.beer ? st.beerFilter === c.beer : st.tags.includes(c.key);
          return (
            <Press
              key={c.key}
              haptic
              onPress={() => (c.beer ? st.set({ beerFilter: on ? null : c.beer }) : st.toggleTag(c.key))}
              style={[
                s.row,
                {
                  height: 34,
                  borderRadius: 17,
                  paddingHorizontal: 13,
                  gap: 6,
                  backgroundColor: on ? '#3A2E08F0' : '#141414F0',
                  borderWidth: 1,
                  borderColor: on ? '#FFC40099' : '#FFFFFF1F',
                },
              ]}
            >
              <Icon name={c.icon} size={15} color={C.yellow} />
              <T s={13} w={on ? 700 : 600} c={on ? C.yellow : C.white}>
                {c.label}
              </T>
            </Press>
          );
        })}
      </ScrollView>

      <View style={{ position: 'absolute', right: SCREEN_X - 8, bottom: tabSpace + (collapsed ? 64 : 160) + 12, gap: 8 }}>
        <View>
          <GlassButton icon="layers" label="Vrstvy mapy" onPress={() => router.push('/nv/vrstvy')} />
          {layersDot ? (
            <View style={{ position: 'absolute', right: 1, top: 1, width: 12, height: 12, borderRadius: 6, backgroundColor: C.yellow, borderWidth: 2.5, borderColor: C.black }} />
          ) : null}
        </View>
        <GlassButton icon="locate-fixed" label="Moje poloha" onPress={() => st.set({ mapView: 'okoli' })} />
      </View>

      <View style={{ position: 'absolute', left: 12, right: 12, bottom: tabSpace + 4 }}>
        {st.mapView === 'stopy' && cityInfo ? (
          <Animated.View entering={FadeInDown} style={[{ backgroundColor: C.yellow, borderRadius: 26, paddingTop: 20, paddingHorizontal: 16, paddingBottom: 16, gap: 14 }]}>
            <Grabber />
            <View style={{ gap: 3, paddingLeft: 2 }}>
              <T s={18} w={600} c={C.black}>
                {cityInfo.name}
              </T>
              <T s={13} c={C.onYellowMuted}>{`${cityInfo.evenings} večerů · ${cityInfo.pubs} hospod`}</T>
            </View>
            <Button label="Ukázat moje hospody" icon="map-pinned" kind="onYellow" height={46} onPress={() => router.push('/nv/moje-hospody')} />
          </Animated.View>
        ) : target && !collapsed ? (
          <GestureDetector gesture={swipe}>
            <Animated.View entering={FadeInDown.duration(220)} style={[{ backgroundColor: C.yellow, borderRadius: 26, paddingTop: 20, paddingHorizontal: 16, paddingBottom: 16, gap: 14 }]}>
              <Press onPress={() => setCollapsed(true)} hitSlop={12} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 20 }}>
                <Grabber />
              </Press>
              <Press onPress={() => router.push({ pathname: '/nv/hospoda/[id]', params: { id: target.id } })} style={[s.row, { justifyContent: 'space-between', paddingLeft: 2 }]}>
                <View style={[s.fill, { gap: 3 }]}>
                  <T s={18} w={600} c={C.black} style={{ letterSpacing: -0.2 }}>
                    {target.name}
                  </T>
                  <View style={[s.row, { gap: 5 }]}>
                    <Dot color={C.black} />
                    <T s={13} w={600} c={C.black}>{`do ${target.openUntil}`}</T>
                    <T s={13} c={C.onYellowMuted} numberOfLines={1} style={s.fill}>{`· ${subLine(target, st.pinMode)}`}</T>
                  </View>
                </View>
                <View style={[s.row, { alignItems: 'flex-end', gap: 3 }]}>
                  <D s={24} c={C.black} lh={1.15}>
                    {formatDistance(target.distance).value}
                  </D>
                  <T s={14} w={600} c={C.onYellowMuted} style={{ marginBottom: 3 }}>
                    {formatDistance(target.distance).unit}
                  </T>
                </View>
              </Press>
              <View style={[s.row, { gap: 10 }]}>
                <Button label="Doveď mě tam" icon="navigation" kind="onYellow" height={46} flex onPress={() => goThere(router, target)} />
                <Button label="Jinou" icon="shuffle" kind="onYellowGhost" height={46} style={{ paddingHorizontal: 16 }} onPress={st.nextTarget} />
              </View>
            </Animated.View>
          </GestureDetector>
        ) : target ? (
          <Animated.View entering={FadeIn} style={{ alignItems: 'center' }}>
            <Press haptic onPress={() => setCollapsed(false)}>
              <Glass style={[s.row, { height: 44, borderRadius: 22, paddingHorizontal: 16, gap: 8 }]}>
                <T s={15} w={800} c={C.yellow}>{`${formatDistance(target.distance).value} ${formatDistance(target.distance).unit}`}</T>
                <T s={15} c={C.muted}>
                  ·
                </T>
                <T s={15} w={700}>
                  {target.name}
                </T>
                <Icon name="chevron-up" size={16} color={C.text2} />
              </Glass>
            </Press>
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

function Grabber() {
  return <View style={{ position: 'absolute', top: 7, alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: '#0000004D' }} />;
}

function MiniCompass() {
  return (
    <View style={[{ width: 54, height: 54, borderRadius: 27, backgroundColor: C.card, borderWidth: 1.5, borderColor: '#FFFFFF33' }, s.center, shadow.raised]}>
      <View style={{ width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderBottomWidth: 19, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: C.yellow }} />
      <View style={{ width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 19, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#FFFFFF33' }} />
    </View>
  );
}

function CompassMode({ onMap }: { onMap: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const { st, pubs, target: filtered } = useFilters();
  const tourNext = st.tourActive ? nextStopIndex(st.tourStops) : -1;
  const tour = tourNext >= 0;
  const target = tour ? stopAsPub(tourNext) : filtered;
  const nearest = pubs[0];
  const scenario = tour ? 'normal' : pubs.length === 0 && st.kompas === 'normal' ? 'noresults' : st.kompas;
  const others = pubs.filter((p) => p.id !== target?.id);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 8, paddingHorizontal: SCREEN_X, paddingBottom: tabSpace + 14 }}>
      <View style={[s.row, { justifyContent: 'space-between', height: 44 }]}>
        <IconButton icon="map" color={C.yellow} onPress={onMap} label="Mapa" iconSize={20} />
        <View style={[s.row, { gap: 10 }]}>
          <IconButton icon="search" onPress={() => router.push('/nv/hledani')} label="Hledat" iconSize={20} />
          <LevelAvatar />
        </View>
      </View>
      <View style={[s.row, { gap: 8, marginTop: 12, opacity: tour ? 0 : 1 }]} pointerEvents={tour ? 'none' : 'auto'}>
        <Chip label="Filtry" icon="sliders-horizontal" onPress={() => router.push('/nv/filtry')} />
        {st.openNow ? <Chip label="Otevřeno teď" active onPress={() => st.set({ openNow: false })} /> : null}
        {st.maxPrice && scenario === 'noresults' ? <Chip label={`Do ${st.maxPrice} Kč`} active onPress={() => st.set({ maxPrice: null })} /> : null}
      </View>
      <View style={{ flex: 1, justifyContent: 'space-evenly' }}>
        {scenario === 'normal' && target ? (
          <>
            <Dial target={target} others={others} />
            <View style={{ alignItems: 'center', gap: 6 }}>
              <Press onPress={() => router.push({ pathname: '/nv/hospoda/[id]', params: { id: target.id } })} style={[s.row, { gap: 6 }]}>
                <T s={22} w={700}>
                  {target.name}
                </T>
                <Icon name="chevron-right" size={18} color={C.muted} />
              </Press>
              <View style={[s.row, { gap: 6 }]}>
                <Dot color={C.open} size={7} />
                <T s={15} w={600} c={C.open}>{`Otevřeno do ${target.openUntil}`}</T>
                <T s={15} c={C.muted} numberOfLines={1}>
                  {tour ? `· ${tourNext + 1}. zastávka tour · ${TOUR.stops[tourNext].beer}` : `· ${subLine(target, 'price')}`}
                </T>
              </View>
              {!tour && nearest && target.id !== nearest.id ? (
                <Press
                  haptic
                  onPress={() => st.set({ targetId: nearest.id })}
                  style={[s.row, { marginTop: 14, height: 40, borderRadius: 20, paddingHorizontal: 16, gap: 8, backgroundColor: C.control }]}
                >
                  <Icon name="undo-2" size={16} color={C.yellow} />
                  <T s={15} w={700}>
                    Zpět na nejbližší
                  </T>
                  <T s={15} c={C.muted}>{`${nearest.distance} m`}</T>
                </Press>
              ) : null}
            </View>
          </>
        ) : (
          <>
            <Dial dim centerIcon={scenario === 'error' ? 'wifi-off' : scenario === 'empty' ? 'beer-off' : 'funnel-x'} />
            <View style={{ gap: 10 }}>
              <D s={48} lh={0.95}>
                {scenario === 'error' ? 'Hledání\nspadlo' : scenario === 'empty' ? 'Tady se\nnenapiješ' : 'Tahle kombinace\nje vzácná'}
              </D>
              <T s={15} w={500} c={C.muted} lh={1.4}>
                {scenario === 'error'
                  ? 'Nepovedlo se mi stáhnout hospody. Zkontroluj připojení a zkus to znovu.'
                  : scenario === 'empty'
                    ? 'V tvém okolí jsem nenašel žádnou hospodu. Zkus to znovu nebo uprav dosah v nastavení.'
                    : 'V okolí zatím nemám zmapovanou hospodu, která splní všechno.'}
              </T>
            </View>
          </>
        )}
      </View>
      {scenario === 'normal' && target ? (
        <View style={{ gap: 10 }}>
          <Button label="Doveď mě tam" icon="navigation" onPress={() => goThere(router, target)} />
          <View style={[s.row, { gap: 10 }]}>
            {tour ? (
              <Button label="Přeskočit" icon="skip-forward" kind="raised" flex onPress={() => st.markStop(tourNext, 'skipped')} />
            ) : (
              <Button label="Jinou" icon="shuffle" kind="raised" flex onPress={st.nextTarget} />
            )}
            <Button
              label="Za partou"
              icon="users"
              kind="raised"
              flex
              onPress={() => {
                st.set({ targetId: 'pinkas' });
                toast({ kind: 'info', title: 'Míříš za Klárou', sub: 'Sedí U Pinkasů, má za sebou 2 piva.', icon: 'users' });
              }}
            />
          </View>
        </View>
      ) : scenario === 'error' ? (
        <Button label="Zkusit znovu" icon="refresh-cw" onPress={() => st.set({ kompas: 'normal' })} />
      ) : scenario === 'empty' ? (
        <View style={[s.row, { gap: 10 }]}>
          <Button label="Zkusit znovu" icon="refresh-cw" flex onPress={() => st.set({ kompas: 'normal' })} />
          <Button label="Přidat hospodu" icon="plus" kind="raised" flex onPress={() => router.push('/nv/pridat-hospodu')} />
        </View>
      ) : (
        <View style={[s.row, { gap: 10 }]}>
          <Button label="Upravit filtry" icon="sliders-horizontal" flex onPress={() => router.push('/nv/filtry')} />
          <Button
            label="Zrušit filtry"
            icon="x"
            kind="raised"
            flex
            onPress={() => st.set({ openNow: false, maxPrice: null, tags: [], beerFilter: null, onlyDrunk: false })}
          />
        </View>
      )}
    </View>
  );
}

