import React, { useCallback, useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { nvBack } from '@/newlook/navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../components/Icon';
import { StatusCard } from '../../components/StatusCard';
import { Chip, ChipWrap, D, IconButton, Kicker, Press, Stack, T } from '../../components/ui';
import { TopFade } from '../../components/chrome';
import { dialog, toast } from '../../ui/store';
import { C, SCREEN_X, s } from '../../theme';
import { RundaButton } from '../vycep/VycepScreen';
import { enqueueBeerCheckInOp } from '@/data/beerCheckinsQueue';
import {
  fetchBeerPage,
  fetchBeerReviews,
  reportBeerReview,
  type BeerPage,
  type BeerRef,
  type BeerReview,
  type BeerReviewsPage,
  type ReviewFilter,
} from '@/data/beersClient';
import { t } from '@/i18n';
import { findBeerWatch, useBeerWatchStore } from '@/stores/beerWatchStore';
import { useKompasState } from '../kompas/state';

import { fmtCount, fmtDistance, fmtRating, kindLine, lastKnownPosition, myLatestRating, reviewDay, saveBeerRating, savedRating, toggleWatch } from './model';
import { Stars } from './PivaScreen';
import { Loading, useLoad } from './states';
import { useNvParams, useNvRouter } from '../../duo/details';

const REVIEW_FILTERS: ReviewFilter[] = ['newest', 'party', 'photo'];

function Review({ r }: { r: BeerReview }) {
  const rv = t.nv.piva.review;
  const [given, setGiven] = useState(r.cheered);
  const toggle = () => {
    const next = !given;
    setGiven(next);
    void enqueueBeerCheckInOp(next ? { op: 'cheer', checkInId: r.id } : { op: 'cheer-clear', checkInId: r.id });
  };
  const report = () =>
    dialog({
      title: rv.reportTitle,
      body: rv.reportBody,
      actions: [
        { label: rv.reportBack },
        {
          label: rv.report,
          kind: 'danger',
          onPress: () =>
            void reportBeerReview(r).then((ok) =>
              toast(ok ? { kind: 'saved', title: rv.reported, sub: rv.reportedSub, icon: 'flag' } : { kind: 'error', title: rv.reportFailed }),
            ),
        },
      ],
    });
  const where = [r.pubName, reviewDay(r.day)].filter(Boolean).join(' · ');
  return (
    <View style={{ gap: 12, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.hairline }}>
      <View style={[s.row, { gap: 12 }]}>
        <View style={[{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.control }, s.center]}>
          <T s={14} w={800} c={C.yellow}>
            {(r.authorName.replace(/^@/, '')[0] ?? '?').toUpperCase()}
          </T>
        </View>
        <View style={[s.fill, { gap: 2 }]}>
          <View style={[s.row, { gap: 6 }]}>
            <T s={15} w={700} numberOfLines={1}>
              {r.authorName}
            </T>
            {r.inParty ? (
              <T s={12} w={600} c={C.yellow}>
                {rv.inParty}
              </T>
            ) : null}
          </View>
          <View style={[s.row, { gap: 6 }]}>
            {r.rating !== null ? <Stars n={Math.round(r.rating)} size={12} /> : null}
            <T s={12} c={C.muted} numberOfLines={1} style={s.fill}>
              {where}
            </T>
          </View>
        </View>
        <Press hitSlop={10} accessibilityLabel={rv.reportA11y} onPress={report}>
          <Icon name="flag" size={16} color={C.muted} />
        </Press>
      </View>
      <T s={15} c={C.text2} lh={1.45}>
        {r.note}
      </T>
      {r.photoUrl ? <Image source={{ uri: r.photoUrl }} style={{ width: '100%', height: 180, borderRadius: 16 }} /> : null}
      <RundaButton count={r.cheers - (r.cheered ? 1 : 0) + (given ? 1 : 0)} given={given} onPress={toggle} />
    </View>
  );
}

const refKey = (ref: BeerRef) => `${ref.productKey ?? ''}|${ref.beerName ?? ''}|${ref.breweryName ?? ''}`;

function useBeerPage(ref: BeerRef) {
  return useLoad<BeerPage>(refKey(ref), (signal) => lastKnownPosition().then((position) => fetchBeerPage(ref, position, signal)), true, 'beer');
}

function useReviews(ref: BeerRef, filter: ReviewFilter) {
  const key = `${refKey(ref)}:${filter}`;
  const first = useLoad<BeerReviewsPage>(key, (signal) => fetchBeerReviews(ref, { filter, limit: 3 }, signal), true, 'beer-reviews');
  const [extra, setExtra] = useState<{ key: string; items: BeerReview[]; cursor: string | null } | null>(null);
  const page = first.state.status === 'ready' ? first.state.data : null;
  const more = extra?.key === key ? extra : null;
  const items = page ? [...page.items, ...(more?.items ?? []).filter((item) => !page.items.some((p) => p.id === item.id))] : [];
  const cursor = more ? more.cursor : (page?.nextCursor ?? null);
  const loadMore = () => {
    if (!cursor) return;
    void fetchBeerReviews(ref, { filter, cursor, limit: 20 }).then((next) => {
      if (next) setExtra({ key, items: [...(more?.items ?? []), ...next.items], cursor: next.nextCursor });
    });
  };
  return { items, total: page?.total ?? 0, status: first.state.status, hasMore: cursor !== null, more: loadMore };
}

export function BeerScreen() {
  const router = useNvRouter();
  const insets = useSafeAreaInsets();
  const params = useNvParams<{ id: string; name?: string; brewery?: string }>();
  const ref: BeerRef = { productKey: params.id && params.id !== '-' ? params.id : null, beerName: params.name ?? null, breweryName: params.brewery ?? null };
  const page = useBeerPage(ref);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {page.state.status === 'ready' ? (
        <BeerBody beer={page.state.data} beerRef={ref} reload={page.retry} />
      ) : (
        <View style={{ paddingTop: insets.top + 8, paddingHorizontal: SCREEN_X }}>
          <IconButton icon="chevron-left" size={40} iconSize={18} onPress={() => nvBack(router)} label={t.nv.piva.back} />
          {page.state.status === 'loading' ? <Loading pad={80} /> : <StatusCard text={t.nv.piva.beer.failed} action={t.nv.piva.retry} onAction={page.retry} style={{ marginTop: 24 }} />}
        </View>
      )}
    </View>
  );
}

function BeerBody({ beer, beerRef, reload }: { beer: BeerPage; beerRef: BeerRef; reload: () => void }) {
  const router = useNvRouter();
  const insets = useSafeAreaInsets();
  const p = t.nv.piva;
  const b = p.beer;
  const [mine, setMine] = useState(() => {
    const rating = savedRating(beer.beerName) ?? myLatestRating(beer.myHistory)?.rating;
    return rating ? Math.round(rating) : 0;
  });
  const [filter, setFilter] = useState<ReviewFilter>('newest');
  const reviewRef: BeerRef = beer.productKey ? { productKey: beer.productKey } : beerRef;
  const reviews = useReviews(reviewRef, filter);
  const watched = useBeerWatchStore((st) =>
    beer.productKey ? st.watches.some((w) => w.productKey === beer.productKey) : findBeerWatch(st.watches, beer.beerName, beer.breweryName) !== null,
  );
  const [watchBusy, setWatchBusy] = useState(false);
  // Coming back from the rating sheet shows what was saved there.
  useFocusEffect(
    useCallback(() => {
      const rating = savedRating(beer.beerName);
      if (rating) setMine(Math.round(rating));
    }, [beer.beerName]),
  );

  const rate = (n: number) => {
    const first = !mine;
    setMine(n);
    void saveBeerRating({ beerName: beer.beerName, breweryName: beer.breweryName, history: beer.myHistory }, { rating: n }).then(() => {
      if (first) toast({ kind: 'saved', title: b.ratingSaved, icon: 'star' });
    });
  };

  const nearest = beer.nearestPub;
  const subtitle = [beer.brandName, kindLine(beer.styles, beer.degree)].filter(Boolean).join(' · ');
  const stats: [string, string][] = [
    [fmtCount(beer.drunkTotal), b.drunkTotal],
    [fmtCount(beer.drinkers), b.drinkers],
    [fmtCount(beer.drunkWeek), b.thisWeek],
  ];
  const sheetParams = { id: beer.productKey ?? '-', name: beer.beerName, brewery: beer.breweryName };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: SCREEN_X, gap: 22, paddingBottom: insets.bottom + 40 }}>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <IconButton icon="chevron-left" size={40} iconSize={18} onPress={() => nvBack(router)} label={p.back} />
          <View style={[s.row, { gap: 10 }]}>
            <IconButton
              icon={watched ? 'bell-ring' : 'bell'}
              size={40}
              iconSize={18}
              color={C.yellow}
              label={watched ? b.unwatch : b.watch}
              onPress={() => {
                if (watchBusy) return;
                setWatchBusy(true);
                void toggleWatch(beer.beerName, beer.breweryName).finally(() => setWatchBusy(false));
              }}
            />
            <IconButton icon="share" size={40} iconSize={18} label={b.share} onPress={() => router.push('/nv/nalepky')} />
          </View>
        </View>
        <View style={{ gap: 6 }}>
          <D s={44}>{beer.beerName}</D>
          {subtitle ? <T s={15} c={C.muted}>{subtitle}</T> : null}
        </View>
        {beer.globalRating !== null ? (
          <View style={[s.row, { gap: 14 }]}>
            <D s={96} lh={0.9} c={C.yellow}>
              {fmtRating(beer.globalRating)}
            </D>
            <View style={{ gap: 6 }}>
              <Stars n={Math.round(beer.globalRating)} size={20} />
              <T s={14} c={C.text2}>
                {b.ratings(fmtCount(beer.globalRatingCount))}
              </T>
              {beer.nationalRank !== null ? (
                <Press onPress={() => router.dismissTo('/nv/piva')} style={[s.row, { gap: 4 }]}>
                  <T s={14} w={700}>
                    {b.rank(beer.nationalRank)}
                  </T>
                  <Icon name="chevron-right" size={14} color={C.text2} />
                </Press>
              ) : null}
            </View>
          </View>
        ) : null}
        {beer.drunkTotal > 0 ? (
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            {stats.map(([v, l]) => (
              <View key={l} style={{ gap: 2 }}>
                <D s={26} lh={1}>
                  {v}
                </D>
                <T s={12} c={C.muted}>
                  {l}
                </T>
              </View>
            ))}
          </View>
        ) : null}
        {beer.pubsPouring > 0 ? (
          <View style={[s.row, { gap: 12, padding: 16, borderRadius: 22, backgroundColor: C.card }]}>
            <View style={[{ width: 44, height: 44, borderRadius: 12, backgroundColor: '#FFC40026' }, s.center]}>
              <Icon name="map-pin" size={20} color={C.yellow} />
            </View>
            <View style={[s.fill, { gap: 3 }]}>
              <Kicker>{nearest ? b.nearest : b.pouring}</Kicker>
              <T s={16} w={700} numberOfLines={1}>
                {nearest ? `${nearest.name} · ${fmtDistance(nearest.distanceM)}` : b.pouringIn(beer.pubsPouring)}
              </T>
              {nearest ? (
                <T s={12} c={C.muted}>
                  {b.priceAndMore(nearest.priceCzk !== null ? String(nearest.priceCzk) : null, beer.pubsPouring - 1)}
                </T>
              ) : null}
            </View>
            <Press
              haptic
              onPress={() => {
                useKompasState.getState().set({ view: 'map' });
                router.dismissTo({ pathname: '/nv/kompas', params: { beer: beer.beerName, pub: nearest?.cacheKey ?? '' } });
              }}
              style={[s.row, { height: 42, borderRadius: 21, paddingHorizontal: 16, gap: 6, backgroundColor: C.yellow }]}
            >
              <Icon name="map" size={16} color={C.black} />
              <T s={15} w={700} c={C.black}>
                {b.map}
              </T>
            </Press>
          </View>
        ) : null}
        <View style={{ backgroundColor: C.card, borderRadius: 24, paddingHorizontal: 16 }}>
          <View style={[s.row, { height: 58, justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: C.hairline }]}>
            <T s={16} w={500}>
              {b.yourRating}
            </T>
            <View style={[s.row, { gap: 4 }]}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Press key={n} haptic hitSlop={4} accessibilityLabel={p.rating.starsA11y(n)} onPress={() => rate(n)}>
                  <Icon name="star" size={26} color={n <= mine ? C.yellow : C.muted} fill={n <= mine ? C.yellow : 'none'} />
                </Press>
              ))}
            </View>
          </View>
          <Press
            onPress={() => router.push({ pathname: '/nv/hodnoceni', params: { ...sheetParams, stars: String(mine || '') } })}
            style={[s.row, { height: 50, gap: 8, borderBottomWidth: beer.partyCount ? 1 : 0, borderBottomColor: C.hairline }]}
          >
            <Icon name="camera" size={16} color={C.yellow} />
            <T s={15} w={600} c={C.yellow}>
              {b.addPhotoAndWords}
            </T>
          </Press>
          {beer.partyCount ? (
            <View style={[s.row, { height: 56, gap: 12 }]}>
              <Stack initials={beer.partyDrinkers.slice(0, 3).map((f) => (f.nickname ?? f.displayName)[0]?.toUpperCase() ?? '?')} />
              <T s={15} w={600} style={s.fill}>
                {b.party}
              </T>
              <T s={12} c={C.muted}>
                {b.ratings(fmtCount(beer.partyCount))}
              </T>
              {beer.partyAverageRating !== null ? <D s={24}>{fmtRating(beer.partyAverageRating)}</D> : null}
            </View>
          ) : null}
        </View>
        {beer.tagShares.length ? (
          <View style={{ gap: 12 }}>
            <T s={17} w={700}>
              {b.whatPeopleSay}
            </T>
            <ChipWrap>
              {beer.tagShares.slice(0, 4).map(({ tag, percent }) => (
                <View key={tag} style={[s.row, { height: 32, borderRadius: 16, paddingHorizontal: 12, gap: 6, backgroundColor: C.card, borderWidth: 1, borderColor: C.hairline }]}>
                  <T s={13} w={600}>
                    {p.rating.tags[tag]}
                  </T>
                  <T s={13} c={C.muted}>{`${percent} %`}</T>
                </View>
              ))}
            </ChipWrap>
          </View>
        ) : null}
        {beer.photoCount ? (
          <Press
            onPress={() =>
              router.push({ pathname: '/nv/pivni-fotky', params: beer.productKey ? { beer: beer.productKey } : { name: beer.beerName } })
            } style={[s.row, { justifyContent: 'space-between' }]}>
            <T s={17} w={700}>
              {b.photos}
            </T>
            <View style={[s.row, { gap: 4 }]}>
              <T s={14} c={C.muted}>
                {fmtCount(beer.photoCount)}
              </T>
              <Icon name="chevron-right" size={14} color={C.muted} />
            </View>
          </Press>
        ) : null}
        <View style={{ gap: 12 }}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <T s={17} w={700}>
              {b.whatPeopleWrite}
            </T>
            {reviews.total ? (
              <T s={14} c={C.muted}>
                {fmtCount(reviews.total)}
              </T>
            ) : null}
          </View>
          <View style={[s.row, { gap: 8 }]}>
            {REVIEW_FILTERS.map((f) => (
              <Chip key={f} label={b.reviewFilters[f]} active={filter === f} plain height={34} onPress={() => setFilter(f)} />
            ))}
          </View>
          <View style={{ backgroundColor: C.card, borderRadius: 24, paddingHorizontal: 16 }}>
            {reviews.status === 'loading' ? (
              <Loading pad={24} />
            ) : reviews.status === 'error' ? (
              <Press onPress={reload} style={[s.row, { height: 52, justifyContent: 'center' }]}>
                <T s={14} w={700}>
                  {p.retry}
                </T>
              </Press>
            ) : reviews.items.length ? (
              <>
                {reviews.items.map((r) => (
                  <Review key={r.id} r={r} />
                ))}
                {reviews.hasMore ? (
                  <Press onPress={reviews.more} style={[s.row, { height: 52, justifyContent: 'center', gap: 4 }]}>
                    <T s={14} w={700}>
                      {b.allReviews(fmtCount(reviews.total))}
                    </T>
                    <Icon name="chevron-right" size={14} />
                  </Press>
                ) : null}
              </>
            ) : (
              <View style={[s.row, { height: 52, justifyContent: 'center' }]}>
                <T s={14} c={C.muted}>
                  {b.noReviews}
                </T>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
      <TopFade />
    </View>
  );
}
