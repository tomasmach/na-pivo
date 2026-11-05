import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useFocusEffect, useRouter } from 'expo-router';
import { nvBack } from '@/newlook/navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomFade, TabHeader, TopFade, useTabBarSpace, useTabHeaderScroll } from '../../components/chrome';
import { Ghost, StatusCard } from '../../components/StatusCard';
import { Icon } from '../../components/Icon';
import { D, T, Card, Chip, IconButton, Press, Row, Segmented, Tile } from '../../components/ui';
import { NO_VALUE } from '../../format';
import { Input } from '../../components/forms';
import { fadeIn } from '../../motion';
import { C, SCREEN_X, s } from '../../theme';
import {
  fetchBeerCollection,
  fetchBeerRanking,
  searchBeers,
  type BeerCollection,
  type BeerDegree,
  type BeerRankingPage,
  type CzRegion,
  type BeerSearchItem,
  type BeerStyle,
  type RankedBeer,
} from '@/data/beersClient';
import { t } from '@/i18n';
import { useBeerWatchStore } from '@/stores/beerWatchStore';

import { STYLE_FILTERS, fmtCount, fmtDistance, fmtRating, kindLine, lastKnownPosition, styleFilterLabel } from './model';
import { degreeLabel, regionLabel, useRankingRegion } from './RankingFilterSheets';
import { useLoad, type Load } from './states';

const SHADES = [C.yellow, '#F7F7F2B3', '#F7F7F273', '#F7F7F242', '#F7F7F229'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
// Loading stand-ins at the size of what replaces them: ranking rows, the collection's count and taster card, a page of search rows.
const RANK_ROW_HEIGHT = 77;
const GHOST_ROWS = [0, 1, 2, 3, 4, 5];
const COLLECTION_HERO_HEIGHT = 79;
const COLLECTION_TASTER_HEIGHT = 174;
const SEARCH_GHOST_HEIGHT = 5 * 62 + 8;

/** Share of raters per star, 5★ first, as one bar. */
export function DistBar({ shares, width = 230, flip }: { shares: number[]; width?: number; flip?: boolean }) {
  const parts = shares.map((x, i) => ({ x, c: SHADES[i] }));
  const ordered = flip ? [...parts].reverse() : parts;
  const usable = width - 8;
  return (
    <View style={[s.row, { width, height: 6, gap: 2, borderRadius: 3, overflow: 'hidden' }]}>
      {ordered.map((p, i) => (
        <View key={i} style={{ width: Math.max(2, p.x * usable), height: 6, backgroundColor: p.c }} />
      ))}
    </View>
  );
}

export function openBeer(router: ReturnType<typeof useRouter>, productKey: string, replace = false) {
  const href = { pathname: '/nv/pivo/[id]' as const, params: { id: productKey } };
  if (replace) router.replace(href);
  else router.push(href);
}

function RankRow({ b, bottom, onPress, early, inRegion }: { b: RankedBeer; bottom?: boolean; onPress: () => void; early?: boolean; inRegion?: boolean }) {
  const p = t.nv.piva;
  const sub = inRegion
    ? [b.brandName, b.drunkTotal ? p.drunkInRegion(b.drunkTotal) : ''].filter(Boolean).join(' · ')
    : bottom && b.topTag
      ? p.mostOften(p.rating.tags[b.topTag])
      : [b.brandName, kindLine(b.styles, b.degree)].filter(Boolean).join(' · ');
  return (
    <Press onPress={onPress} style={[s.row, { paddingVertical: 12, gap: 12, borderBottomWidth: 1, borderBottomColor: C.hairline }]}>
      <View style={{ width: 34, alignItems: 'center', gap: 2 }}>
        <D s={34} c={b.position === 1 && !bottom ? C.yellow : C.muted} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          {String(b.position)}
        </D>
        {early ? (
          <T s={11} w={700} c={C.muted}>
            {p.rankNew}
          </T>
        ) : b.move ? (
          <View style={[s.row, { gap: 1 }]}>
            <Icon name={b.move > 0 ? 'arrow-up' : 'arrow-down'} size={11} color={b.move > 0 ? C.yellow : C.muted} />
            <T s={11} w={700} c={b.move > 0 ? C.yellow : C.muted}>
              {String(Math.abs(b.move))}
            </T>
          </View>
        ) : (
          <T s={11} w={700} c={C.muted}>
            {NO_VALUE}
          </T>
        )}
      </View>
      <View style={[s.fill, { gap: 6 }]}>
        <T s={16} w={700} numberOfLines={1}>
          {b.name}
        </T>
        <T s={12} w={500} c={C.muted} numberOfLines={1}>
          {sub}
        </T>
        <DistBar shares={b.stars} flip={bottom} />
      </View>
      <View style={{ alignItems: 'flex-end', gap: 1 }}>
        <D s={30}>{b.ratingAvg !== null ? fmtRating(b.ratingAvg) : NO_VALUE}</D>
        <View style={[s.row, { gap: 3 }]}>
          <Icon name="users" size={11} color={C.muted} />
          <T s={11} w={600} c={C.muted}>
            {fmtCount(b.ratingCount)}
          </T>
        </View>
      </View>
    </Press>
  );
}

function useRanking(order: 'best' | 'bottom', style: BeerStyle | null, degree: BeerDegree | null, region: CzRegion | null, enabled: boolean) {
  return useLoad<BeerRankingPage>(`${order}:${style ?? ''}:${degree ?? ''}:${region ?? ''}`, (signal) => fetchBeerRanking({ order, style, degree, region }, signal), enabled, 'beer-ranking');
}

function useCollection() {
  const [state, setState] = useState<Load<BeerCollection>>({ status: 'loading' });
  const load = useCallback(() => {
    let alive = true;
    void lastKnownPosition()
      .then((position) => fetchBeerCollection(position))
      .then((data) => {
        if (!alive) return;
        setState((prev) => (data ? { status: 'ready', data } : prev.status === 'ready' ? prev : { status: 'error' }));
      });
    return () => {
      alive = false;
    };
  }, []);
  useFocusEffect(load);
  return {
    state,
    retry: () => {
      setState({ status: 'loading' });
      load();
    },
  };
}

export function PivaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const p = t.nv.piva;
  const [tab, setTab] = useState<'best' | 'bottom' | 'mine'>('best');
  const [style, setStyle] = useState<BeerStyle | null>(null);
  const region = useRankingRegion((st) => st.region);
  const degree = useRankingRegion((st) => st.degree);
  const ranking = useRanking(tab === 'bottom' ? 'bottom' : 'best', style, degree, region, tab !== 'mine');
  const collection = useCollection();
  const watchedCount = useBeerWatchStore((st) => st.watches.length);
  const watchesLoaded = useBeerWatchStore((st) => st.loaded);
  useEffect(() => {
    if (!watchesLoaded) void useBeerWatchStore.getState().refresh();
  }, [watchesLoaded]);

  const page = ranking.state.status === 'ready' ? ranking.state.data : null;
  const early = page?.early === true && tab === 'best';
  const unrated = collection.state.status === 'ready' ? collection.state.data.unrated : [];
  const onScroll = useTabHeaderScroll('piva');

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: SCREEN_X, gap: 16, paddingBottom: tabSpace + 30 }}
      >
        <TabHeader title={p.title}>
          <IconButton icon="search" iconSize={20} onPress={() => router.push('/nv/hledat-pivo')} label={p.searchA11y} />
        </TabHeader>
        <Segmented
          height={38}
          options={[
            { key: 'best', label: p.tabs.best },
            { key: 'bottom', label: p.tabs.bottom },
            { key: 'mine', label: p.tabs.mine },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab !== 'mine' ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -SCREEN_X }} contentContainerStyle={{ paddingHorizontal: SCREEN_X, gap: 8 }}>
              <Chip label={regionLabel(region)} trailing="chevron-down" active={!!region} plain onPress={() => router.push('/nv/kraj')} />
              <Chip label={degreeLabel(degree)} trailing="chevron-down" active={!!degree} plain onPress={() => router.push('/nv/stupen')} />
              {STYLE_FILTERS.map((f) => (
                <Chip key={f ?? 'all'} label={styleFilterLabel(f)} active={style === f} plain onPress={() => setStyle(f)} />
              ))}
            </ScrollView>
            {page?.items.length ? (
              <View style={[s.row, { gap: 6, marginTop: -4 }]}>
                <T s={12} w={500} c={C.muted}>
                  {p.legendLead}
                </T>
                <T s={12} w={700} c={C.text2}>
                  {p.legendTop}
                </T>
                <View style={[s.row, { gap: 2 }]}>
                  {SHADES.map((c) => (
                    <View key={c} style={{ width: 12, height: 6, borderRadius: 1, backgroundColor: c }} />
                  ))}
                </View>
                <T s={12} w={700} c={C.text2}>
                  {p.legendBottom}
                </T>
              </View>
            ) : null}
            {ranking.state.status === 'loading' ? (
              <View>
                {GHOST_ROWS.map((i) => (
                  <Ghost key={i} height={RANK_ROW_HEIGHT - 8} radius={16} style={{ marginVertical: 4 }} />
                ))}
              </View>
            ) : ranking.state.status === 'error' ? (
              <StatusCard text={p.rankingFailed} action={p.retry} onAction={ranking.retry} />
            ) : page && page.items.length ? (
              <Animated.View entering={fadeIn}>
                {page.items.map((b) => (
                  <RankRow key={b.productKey} b={b} bottom={tab === 'bottom'} early={early && !region} inRegion={!!region} onPress={() => openBeer(router, b.productKey)} />
                ))}
              </Animated.View>
            ) : (
              <StatusCard
                text={region ? p.regionEmpty : p.rankingEmpty}
                action={region ? undefined : p.findBeer}
                actionIcon="search"
                onAction={() => router.push('/nv/hledat-pivo')}
              />
            )}
            {tab === 'best' && (early || (page && !page.items.length)) && unrated.length ? (
              <>
                <View style={[s.row, { justifyContent: 'space-between' }]}>
                  <T s={17} w={700}>
                    {p.unratedTitle}
                  </T>
                  <T s={13} c={C.muted}>
                    {p.unratedHint}
                  </T>
                </View>
                {unrated.map((beer) => (
                  <Row
                    key={beer.productKey}
                    leading={<Icon name="beer" size={18} color={C.muted} />}
                    title={beer.name}
                    titleWeight={700}
                    sub={p.drankTimes(beer.count)}
                    trailing={
                      <Press
                        haptic
                        onPress={() => router.push({ pathname: '/nv/hodnoceni', params: { id: beer.productKey, name: beer.name, brewery: beer.brandName } })}
                        style={[s.row, { height: 38, borderRadius: 19, paddingHorizontal: 12, gap: 6, backgroundColor: C.control }]}
                      >
                        <Icon name="star" size={15} color={C.yellow} />
                        <T s={14} w={700}>
                          {p.rate}
                        </T>
                      </Press>
                    }
                  />
                ))}
              </>
            ) : null}
          </>
        ) : collection.state.status === 'loading' ? (
          <>
            <Ghost height={COLLECTION_HERO_HEIGHT} radius={16} />
            <Ghost height={COLLECTION_TASTER_HEIGHT} />
          </>
        ) : collection.state.status === 'error' ? (
          <StatusCard text={p.collection.failed} action={p.retry} onAction={collection.retry} />
        ) : (
          <Animated.View entering={fadeIn} style={{ gap: 16 }}>
            <Collection data={collection.state.data} watchedCount={watchedCount} />
          </Animated.View>
        )}
      </Animated.ScrollView>
      <TopFade />
      <BottomFade height={tabSpace + 40} tabBar />
    </View>
  );
}

export function Stars({ n, size = 16 }: { n: number; size?: number }) {
  return (
    <View style={[s.row, { gap: 1 }]}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon key={i} name="star" size={size} color={i <= n ? C.yellow : C.muted} fill={i <= n ? C.yellow : 'none'} />
      ))}
    </View>
  );
}

function Collection({ data, watchedCount }: { data: BeerCollection; watchedCount: number }) {
  const router = useRouter();
  const c = t.nv.piva.collection;
  const taster = data.taster;
  const progress = taster && taster.target ? taster.have / taster.target : 0;
  return (
    <>
      <View style={[s.row, { gap: 14 }]}>
        <D s={88} lh={0.9} c={C.yellow}>
          {fmtCount(data.distinctBeers)}
        </D>
        <View style={{ gap: 2 }}>
          <T s={19} w={700}>
            {c.distinct(data.distinctBeers)}
          </T>
          <T s={13} c={C.muted}>
            {c.fromDrunk(data.drunkTotal, data.breweries)}
          </T>
        </View>
      </View>
      {taster ? (
        <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 16, gap: 14 }}>
          <View style={[s.row, { gap: 12 }]}>
            <View style={{ width: 44, height: 44 }}>
              <View style={[{ width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: C.yellow, backgroundColor: C.yellowSoft }, s.center]}>
                <Icon name="medal" size={20} color={C.yellow} />
              </View>
            </View>
            <View style={[s.fill, { gap: 2 }]}>
              <T s={16} w={700}>
                {c.taster(ROMAN[taster.level - 1] ?? String(taster.level))}
              </T>
              <T s={12} c={C.muted}>
                {c.tasterSub(taster.tier)}
              </T>
            </View>
            <D s={26}>{`${taster.have}/${taster.target}`}</D>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: C.control }}>
            <View style={{ width: `${Math.round(progress * 100)}%`, height: 8, borderRadius: 4, backgroundColor: C.yellow }} />
          </View>
          {taster.missing ? (
            <Row
              last
              title={taster.missing.name}
              sub={taster.missing.nearestDistanceM !== null ? c.missingNear(fmtDistance(taster.missing.nearestDistanceM)) : c.missing}
              chevron
              onPress={() => openBeer(router, taster.missing!.productKey)}
            />
          ) : (
            <Row last title={c.tasterDone} />
          )}
        </View>
      ) : null}
      {data.against.length ? (
        <>
          <T s={17} w={700}>
            {c.against}
          </T>
          <Card>
            {data.against.map((beer, i) => (
              <Row
                key={beer.productKey}
                last={i === data.against.length - 1}
                title={beer.name}
                sub={c.national(fmtRating(beer.ratingAvg))}
                onPress={() => openBeer(router, beer.productKey)}
                trailing={
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <Stars n={Math.round(beer.myRating)} />
                    <T s={11} c={C.muted}>
                      {c.yours}
                    </T>
                  </View>
                }
              />
            ))}
          </Card>
        </>
      ) : null}
      <Card>
        <Row
          last
          leading={<Tile icon="bell" />}
          title={c.watched}
          trailing={
            <T s={15} w={600}>
              {String(watchedCount)}
            </T>
          }
          chevron
          onPress={() => router.push('/nv/hlidana-piva')}
        />
      </Card>
    </>
  );
}

export function HledatPivoScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const p = t.nv.piva.search;
  const [q, setQ] = useState('');
  const [state, setState] = useState<Load<BeerSearchItem[]>>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchBeers(q, controller.signal).then((items) => {
        if (!controller.signal.aborted) setState(items ? { status: 'ready', data: items } : { status: 'error' });
      });
    }, q ? 250 : 0);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [q]);
  const list = state.status === 'ready' ? state.data : [];
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 8 }}>
      <View style={[s.row, { paddingHorizontal: SCREEN_X, gap: 12 }]}>
        <View style={s.fill}>
          <Input icon="search" value={q} onChangeText={setQ} placeholder={p.placeholder} autoFocus height={48} />
        </View>
        <Press onPress={() => nvBack(router)} hitSlop={10}>
          <T s={15} w={700} c={C.yellow}>
            {p.cancel}
          </T>
        </Press>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: SCREEN_X, paddingBottom: insets.bottom + 30 }}>
        {state.status === 'loading' ? (
          <Ghost height={SEARCH_GHOST_HEIGHT} />
        ) : state.status === 'error' ? (
          <StatusCard text={p.failed} />
        ) : !list.length ? (
          <StatusCard text={p.empty} />
        ) : (
          <Card>
            {list.map((b, i) => (
              <Row
                key={b.productKey}
                last={i === list.length - 1}
                leading={<Tile icon="beer" />}
                title={b.name}
                sub={[b.brandName, kindLine(b.styles, null)].filter(Boolean).join(' · ')}
                trailing={b.ratingAvg !== null ? <D s={22}>{fmtRating(b.ratingAvg)}</D> : undefined}
                onPress={() => openBeer(router, b.productKey, true)}
              />
            ))}
          </Card>
        )}
      </ScrollView>
    </View>
  );
}
