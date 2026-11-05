import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated';
import * as Linking from 'expo-linking';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { formatClock, formatPromile, useAlcoholEstimate } from '@/counter/useAlcoholEstimate';
import { placeKey, removeCountedDrink, type CountableDrink } from '@/counter/countDrink';
import { fetchBeerPage, submitBeerStyle, type BeerDegree, type StyleAnswer } from '@/data/beersClient';
import { trackCounterTabOpened } from '@/data/counterTelemetry';
import { trackClientEvent } from '@/data/telemetryClient';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { normalizeDrinkType } from '@/drinks/drinkTypes';
import { useNowTick } from '@/friends/useNowTick';
import { beerCountLabel, formatVolume, t } from '@/i18n';
import { useHomeTransitStore } from '@/stores/homeTransitStore';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  drinkingDayKey,
  resumableSession,
  sessionCount,
  sessionTotalCzk,
  useTallyStore,
  type TallyDrink,
  type TallySession,
} from '@/stores/tallyStore';
import { useToursStore } from '@/stores/toursStore';
import { pubFromStop } from '@/tours/counterLink';
import { runGlance } from '@/tours/glance';
import { formatDepartureTime, idosConnectionUrl, isUpcomingDeparture } from '@/transit/homeTransit';
import { formatPrice } from '@/utils/currency';

import { BottomFade, LevelAvatar, TopFade, useTabBarSpace } from '../../components/chrome';
import { Icon, type IconName } from '../../components/Icon';
import { Button, D, Press, Segmented, T, Tile } from '../../components/ui';
import { fadeIn, fadeOut, riseIn, sinkOut } from '../../motion';
import { C, SCREEN_X, s, shadow } from '../../theme';
import { useHidePubNames } from '../../hiddenPubNames';
import { toast } from '../../ui/store';
import { TourRunContent } from '../tour/TourScreens';
import { useTourSegment } from '../tour/tourSegment';
import { useCounterSegment } from './counterSegment';
import { logDrink, useCounterNudges } from './counterActions';
import { DegreePicker, KindPicker } from '../piva/StylePicker';
import { FriendEveningCard, leaveFriendHome, useFriendHomeEvening } from '../parta/FriendEveningCard';
import { DiaryView } from './DiaryView';
import { durationLabel, nameStatesDegree, servingLine } from './stamgastFormat';
import { currentCountPlace, useCountPlace, useCountPlaceHost, useNvPlaceStore } from './placeStore';

type Mode = 'pocitat' | 'denik' | 'tour';

function useTourGlance() {
  const activeRun = useToursStore((st) => st.activeRun);
  const now = useNowTick();
  useEffect(() => {
    void useToursStore.getState().hydrate();
  }, []);
  return useMemo(() => ({ run: activeRun, glance: runGlance(activeRun, now) }), [activeRun, now]);
}

// What I already answered about the beer just logged, so a question does not come back.
const useBeerAnswered = create<{ name: string | null; kind: boolean; degree: boolean }>(() => ({ name: null, kind: false, degree: false }));

type BeerQuestion = { key: string; step: 'kind' | 'degree' };

/** The next question about the beer just logged: its kind, then its degrees, only while nobody settled them. */
function useBeerQuestion(beerName: string | null): BeerQuestion | null {
  const [known, setKnown] = useState<{ name: string; key: string; kind: boolean; degree: boolean } | null>(null);
  const answered = useBeerAnswered();
  useEffect(() => {
    if (!beerName) return;
    const controller = new AbortController();
    void fetchBeerPage({ beerName }, null, controller.signal).then((page) => {
      if (controller.signal.aborted || !page?.productKey) return;
      setKnown({ name: beerName, key: page.productKey, kind: !page.styleSettled && !page.myStyle, degree: !page.degree && !page.myDegree && !nameStatesDegree(beerName) });
    });
    return () => controller.abort();
  }, [beerName]);
  if (!known || known.name !== beerName) return null;
  const done = answered.name === beerName ? answered : { kind: false, degree: false };
  if (known.kind && !done.kind) return { key: known.key, step: 'kind' };
  if (known.degree && !done.degree) return { key: known.key, step: 'degree' };
  return null;
}

export function StamgastScreen() {
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  useCountPlaceHost();
  const { glance } = useTourGlance();
  const tourActive = !!glance;
  const [stored, setStored] = useState<Mode>('pocitat');
  const [headerH, setHeaderH] = useState(0);
  const tourRequested = useTourSegment((st) => st.requested);
  const [seenTourRequest, setSeenTourRequest] = useState(0);
  if (tourRequested !== seenTourRequest) {
    setSeenTourRequest(tourRequested);
    setStored('tour');
  }
  const counterRequested = useCounterSegment((st) => st.requested);
  const [seenCounterRequest, setSeenCounterRequest] = useState(counterRequested);
  if (counterRequested !== seenCounterRequest) {
    setSeenCounterRequest(counterRequested);
    setStored('pocitat');
  }
  const mode = stored === 'tour' && !tourActive ? 'pocitat' : stored;
  // The tab mounts before the tally may have loaded; the counter counts as opened the first time it is on screen.
  const counterOpened = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (mode !== 'pocitat' || counterOpened.current) return;
      counterOpened.current = true;
      void trackCounterTabOpened((useTallyStore.getState().current?.drinks.length ?? 0) > 0);
    }, [mode]),
  );
  const changeMode = (next: Mode) => {
    if (next !== mode && next !== 'tour') trackUiInteraction(next === 'pocitat' ? 'beer_counter_segment' : 'beer_diary_segment', 'select');
    setStored(next);
  };
  const copy = t.nv.stamgast;
  const options: { key: Mode; label: string; dot?: boolean }[] = [
    { key: 'pocitat', label: copy.segCount },
    { key: 'denik', label: copy.segDiary },
    ...(tourActive ? [{ key: 'tour' as const, label: copy.segTour, dot: true }] : []),
  ];
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={[s.row, { paddingTop: insets.top + 8, paddingHorizontal: SCREEN_X, gap: 12, zIndex: 2 }]} onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}>
        <Segmented style={s.fill} options={options} value={mode} onChange={changeMode} />
        <LevelAvatar />
      </View>
      {mode === 'pocitat' ? (
        // The count, a new row and the nudge animate when they change, not when the counter opens.
        <LayoutAnimationConfig skipEntering>
          <CounterView />
        </LayoutAnimationConfig>
      ) : mode === 'denik' ? (
        <DiaryView onToday={() => setStored('pocitat')} />
      ) : (
        <TourTab tabSpace={tabSpace} />
      )}
      {headerH > 0 ? <TopFade below={headerH} /> : null}
    </View>
  );
}

/** The beer "Ještě jedno" repeats: the same pour, serving and price. */
function repeatOf(drink: TallyDrink | undefined): CountableDrink | null {
  if (!drink) return null;
  return {
    name: drink.beerName,
    drinkType: 'beer',
    ...(typeof drink.priceCzk === 'number' ? { priceCzk: drink.priceCzk } : {}),
    ...(typeof drink.volumeMl === 'number' ? { volumeMl: drink.volumeMl } : {}),
    ...(drink.servingType ? { servingType: drink.servingType } : {}),
  };
}

function lastBeerOf(session: TallySession | null): TallyDrink | undefined {
  const drinks = session?.drinks ?? [];
  for (let i = drinks.length - 1; i >= 0; i--) {
    if (normalizeDrinkType(drinks[i].drinkType) === 'beer') return drinks[i];
  }
  return undefined;
}

function TourTab({ tabSpace }: { tabSpace: number }) {
  const router = useRouter();
  const { run, glance } = useTourGlance();
  const current = useTallyStore((st) => st.current);
  const copy = t.nv.stamgast;
  const next = glance?.next;
  const index = next && run ? run.snapshot.stops.findIndex((stop) => stop.id === next.id) : -1;

  const logAtStop = () => {
    if (!next) return;
    const pub = pubFromStop(next);
    useNvPlaceStore.getState().pickPub(pub);
    const repeat = repeatOf(lastBeerOf(current));
    if (repeat) {
      // Another pub pours at its own price; the stop's price is asked in the drink sheet.
      logDrink({ kind: 'pub', pub }, { name: repeat.name, drinkType: 'beer', volumeMl: repeat.volumeMl });
    } else {
      router.push('/nv/zapis');
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: SCREEN_X, paddingTop: 18, paddingBottom: tabSpace + 100 }}>
        <TourRunContent embedded />
      </ScrollView>
      <BottomFade height={tabSpace + 110} />
      <View style={[s.row, { position: 'absolute', left: SCREEN_X, right: SCREEN_X, bottom: tabSpace + 12, gap: 10 }]}>
        {next && index >= 0 ? (
          <>
            <Button label={copy.tourLogAt(index)} icon="beer" flex height={56} onPress={logAtStop} />
            {typeof glance?.minutes === 'number' ? (
              <Button label={copy.tourWalk(glance.minutes)} icon="navigation" kind="raised" height={56} onPress={() => router.push('/nv/tour-mapa')} />
            ) : null}
          </>
        ) : (
          <Button label={copy.tourEnd} icon="flag" flex height={56} onPress={() => router.push('/nv/tour-ukoncit')} />
        )}
      </View>
    </View>
  );
}

function Stat({ value, label, color = C.white, onPress }: { value: string; label: string; color?: string; onPress?: () => void }) {
  const body = (
    <View style={{ alignItems: 'center', gap: 1 }}>
      <T s={16} w={700} c={color}>
        {value}
      </T>
      <T s={12} c={C.dim}>
        {label}
      </T>
    </View>
  );
  return onPress ? (
    <Press onPress={onPress} hitSlop={8}>
      {body}
    </Press>
  ) : (
    body
  );
}

function QuickAction({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Press haptic onPress={onPress} accessibilityLabel={label} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
      <View style={[{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.control }, s.center, shadow.raised]}>
        <Icon name={icon} size={22} />
      </View>
      <T s={12} w={600} c={C.text2}>
        {label}
      </T>
    </Press>
  );
}

function CounterView() {
  const router = useRouter();
  const tabSpace = useTabBarSpace();
  const copy = t.nv.stamgast;
  const place = useCountPlace();
  const current = useTallyStore((st) => st.current);
  const history = useTallyStore((st) => st.history);
  const priceCurrency = useSettingsStore((st) => st.priceCurrency);
  const hidePubNames = useHidePubNames();
  const profile = useSettingsStore((st) => st.bodyProfile);
  const { estimate } = useAlcoholEstimate();
  const now = useNowTick();
  const nudges = useCounterNudges();
  const question = useBeerQuestion(nudges.newBeer?.name ?? null);
  const answer = (reply: { style?: StyleAnswer; degree?: BeerDegree }, skip = false) => {
    if (!question) return;
    const prev = useBeerAnswered.getState();
    const name = nudges.newBeer?.name ?? null;
    const base = prev.name === name ? prev : { name, kind: false, degree: false };
    // "Nevím" on the kind skips the degree too; one shrug is enough.
    useBeerAnswered.setState({ ...base, name, kind: true, degree: base.degree || question.step === 'degree' || skip });
    if (!reply.style && !reply.degree) return;
    void submitBeerStyle({ productKey: question.key }, reply).then((ok) => {
      if (ok && !skip) toast({ kind: 'saved', title: t.nv.piva.stylePick.thanks, icon: 'check' });
    });
  };
  const { run } = useTourGlance();
  const friendHome = useFriendHomeEvening();
  const atFriend = !!friendHome && place?.kind === 'outside';
  useEffect(() => {
    const st = useNvPlaceStore.getState();
    if (friendHome && !st.picked && !st.outside) st.setOutside('private');
  }, [friendHome]);

  const key = place ? placeKey(place) : null;
  const session = key && current?.pubKey === key ? current : null;
  const inPub = place?.kind === 'pub';
  const count = sessionCount(session);
  const spent = sessionTotalCzk(session);
  const drinks = useMemo(() => [...(session?.drinks ?? [])].reverse(), [session]);
  const lastBeer = lastBeerOf(session);
  const repeat = repeatOf(lastBeer);
  const resumable = key && count === 0 ? resumableSession(current, history, key, now) : null;
  const sittingMinutes = session ? Math.max(0, Math.round((now - Date.parse(session.startedAt)) / 60000)) : 0;

  const openPlace = () => {
    trackUiInteraction('counter_place_open');
    router.push('/nv/zmenit-misto');
  };

  const openAddDrink = () => {
    trackUiInteraction('counter_add_drink_open');
    router.push('/nv/zapis');
  };

  const oneMore = () => {
    const target = currentCountPlace();
    if (!target) {
      openPlace();
      return;
    }
    if (resumable) {
      trackUiInteraction('counter_resume');
      if (useTallyStore.getState().resumeLast(placeKey(target))) {
        void trackClientEvent({ event: 'counter_session_resumed' });
        return;
      }
    }
    if (!repeat) {
      openAddDrink();
      return;
    }
    trackUiInteraction('counter_repeat_drink');
    logDrink(target, repeat, undefined, { silentTap: true });
  };

  const finish = () => {
    trackUiInteraction('counter_finish_open');
    const live = useTallyStore.getState().current;
    if (!live || live.drinks.length === 0) {
      toast({ kind: 'info', title: copy.nothingYet, icon: 'beer' });
      return;
    }
    const day = drinkingDayKey(new Date(live.startedAt));
    useTallyStore.getState().archiveCurrent('manual');
    leaveFriendHome();
    useCounterNudges.getState().set({ stickerFor: null, tourBanner: null, newBeer: null });
    void trackClientEvent({ event: 'counter_session_closed', context: { reason: 'manual' } });
    router.push({ pathname: '/nv/uctenka', params: { day } });
  };

  const promile = profile ? (estimate ? copy.estimateValue(formatPromile(estimate.now)) : copy.estimateValue(formatPromile(0))) : copy.estimateSetup;
  const secretPlace = hidePubNames && !atFriend && place?.kind === 'pub';
  const placeName = secretPlace
    ? t.nv.common.secretPub
    : atFriend && friendHome
    ? t.nv.parta.homePlace(friendHome.hostName)
    : place?.kind === 'outside'
      ? t.counter.outsideLabel(place.context)
      : place?.pub.name ?? copy.placeUnknown;
  const stickerShown = !!session && nudges.stickerFor === session.clientId && count >= 3;
  const tourBanner = nudges.tourBanner && run?.statuses[nudges.tourBanner.stopId] === 'visited' ? nudges.tourBanner : null;

  // A direct log gives its own impact; a second buzz from the button would double it.
  const logsDirectly = !!place && !resumable && !!repeat;
  const ctaLabel = !place || (!repeat && !resumable) ? copy.logBeer : resumable ? t.counter.resumeEvening : copy.oneMore;
  const ctaSub = resumable
    ? t.counter.resumeSub(beerCountLabel(sessionCount(resumable)))
    : lastBeer
      ? [lastBeer.beerName, lastBeer.volumeMl ? formatVolume(lastBeer.volumeMl) : null].filter(Boolean).join(' · ')
      : undefined;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: SCREEN_X, paddingTop: 20, gap: 20, paddingBottom: tabSpace + 100 }}>
        <View style={{ alignItems: 'center' }}>
          <Press
            haptic
            testID="counter-place"
            onPress={openPlace}
            style={[s.row, { height: 34, borderRadius: 17, paddingHorizontal: 14, gap: 6, backgroundColor: C.tint }]}
          >
            <Icon name={secretPlace ? 'eye-off' : atFriend || place?.kind === 'outside' ? 'house' : 'map-pin'} size={15} color={C.yellow} />
            <T s={14} w={700} numberOfLines={1} style={{ maxWidth: 260 }}>
              {placeName}
            </T>
            <Icon name="chevron-down" size={15} color={C.text2} />
          </Press>
        </View>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Animated.View key={count} entering={fadeIn} exiting={fadeOut}>
            <D s={120} lh={1} c={C.yellow} style={{ letterSpacing: -2 }} accessibilityLabel={copy.tonightA11y(count)}>
              {String(count)}
            </D>
          </Animated.View>
          <T s={17} w={600} c={C.text2}>
            {atFriend && friendHome ? copy.atFriend(count) : copy.tonight(count)}
          </T>
          <View style={[s.row, { gap: 28, paddingTop: 8 }]}>
            {atFriend ? null : <Stat value={formatPrice(spent, priceCurrency)} label={copy.statSpent} />}
            <Stat value={durationLabel(sittingMinutes)} label={copy.statTable} />
            <Stat value={promile} label={profile ? copy.statEstimate : copy.statEstimateSetup} color={profile ? C.white : C.yellow} onPress={() => router.push('/nv/odhad')} />
          </View>
        </View>
        <View style={[s.row, { paddingTop: 4 }]}>
          <QuickAction icon="plus" label={copy.quickOther} onPress={openAddDrink} />
          <QuickAction icon="history" label={copy.quickBackfill} onPress={() => router.push('/nv/dopsat')} />
          <QuickAction icon="camera" label={copy.quickPhoto} onPress={() => router.push('/nv/do-denicku')} />
          <QuickAction icon="circle-check" label={copy.quickDone} onPress={finish} />
        </View>
        {nudges.newBeer && question ? (
          <Animated.View key={question.step} entering={riseIn} exiting={sinkOut}>
            <View style={{ gap: 10 }}>
              <T s={15} w={700} style={{ paddingHorizontal: 4 }}>
                {question.step === 'kind' ? t.nv.piva.stylePick.nudgeTitle(nudges.newBeer.name) : t.nv.piva.stylePick.nudgeDegree(nudges.newBeer.name)}
              </T>
              {question.step === 'kind' ? (
                <KindPicker onPick={(style) => answer({ style })} onUnknown={() => answer({ style: 'unknown' }, true)} />
              ) : (
                <DegreePicker onPick={(degree) => answer({ degree })} onUnknown={() => answer({}, true)} />
              )}
            </View>
          </Animated.View>
        ) : nudges.newBeer ? (
          <Animated.View key="rate" entering={riseIn} exiting={sinkOut}>
            <View style={[s.row, { padding: 14, paddingRight: 16, borderRadius: 22, backgroundColor: C.card, gap: 12 }]}>
              <View style={[s.fill, { gap: 2 }]}>
                <T s={15} w={700}>
                  {copy.newBeerTitle}
                </T>
                {nudges.newBeer ? (
                  <T s={13} c={C.muted} numberOfLines={1}>
                    {nudges.newBeer.name}
                  </T>
                ) : null}
              </View>
              <Press
                haptic
                onPress={() => {
                  const beer = nudges.newBeer;
                  nudges.set({ newBeer: null });
                  if (beer) router.push({ pathname: '/nv/hodnoceni', params: { id: '-', name: beer.name, pub: beer.pubName } });
                }}
                style={[s.row, { height: 40, borderRadius: 20, paddingHorizontal: 14, gap: 6, backgroundColor: C.control }]}
              >
                <Icon name="star" size={16} color={C.yellow} />
                <T s={15} w={700}>
                  {copy.rate}
                </T>
                <Icon name="chevron-right" size={14} color={C.text2} />
              </Press>
              <Press onPress={() => nudges.set({ newBeer: null })} hitSlop={10} accessibilityLabel={copy.close}>
                <Icon name="x" size={16} color={C.muted} />
              </Press>
            </View>
          </Animated.View>
        ) : null}
        {stickerShown ? (
          <Animated.View entering={fadeIn} style={[s.row, { gap: 12, padding: 12, borderRadius: 22, backgroundColor: C.yellowWash, borderWidth: 1, borderColor: C.yellowEdge }]}>
            <View style={[{ width: 52, height: 52, borderRadius: 26, backgroundColor: C.white, borderWidth: 3, borderColor: C.yellow }, s.center]}>
              <T s={22} w={900} c={C.black} style={{ letterSpacing: 2 }}>
                III
              </T>
            </View>
            <View style={[s.fill, { gap: 2 }]}>
              <T s={15} w={700}>{copy.stickerTitle(count)}</T>
              <T s={12} c={C.muted}>
                {copy.stickerSub}
              </T>
            </View>
            <Press
              haptic
              onPress={() => {
                nudges.set({ stickerFor: null });
                router.push('/nv/nalepky');
              }}
              style={{ height: 36, borderRadius: 18, paddingHorizontal: 14, justifyContent: 'center', backgroundColor: C.white }}
            >
              <T s={14} w={800} c={C.black}>
                {copy.stickerCta}
              </T>
            </Press>
            <Press onPress={() => nudges.set({ stickerFor: null })} hitSlop={10} accessibilityLabel={copy.close}>
              <Icon name="x" size={16} color={C.muted} />
            </Press>
          </Animated.View>
        ) : null}
        {tourBanner ? (
          <Animated.View entering={fadeIn} style={[s.row, { gap: 12, padding: 16, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.hairline }]}>
            <Icon name="route" size={18} color={C.yellow} />
            <T s={15} w={700} style={s.fill}>{copy.tourChecked(tourBanner.beers, tourBanner.index)}</T>
            <Press
              onPress={() => {
                void useToursStore.getState().markStop(tourBanner.stopId, null);
                nudges.set({ tourBanner: null });
              }}
            >
              <T s={15} w={700} c={C.yellow}>
                {copy.undo}
              </T>
            </Press>
          </Animated.View>
        ) : null}
        {atFriend ? <FriendEveningCard /> : null}
        {session && count > 0 && !atFriend ? <TransitCard session={session} /> : null}
        <View style={{ backgroundColor: C.card, borderRadius: 24, paddingTop: 4, paddingHorizontal: 16, paddingBottom: 8 }}>
          <View style={[s.row, { height: 50, justifyContent: 'space-between' }]}>
            <T s={16} w={700}>
              {copy.tonightList}
            </T>
            {spent > 0 && !atFriend ? <T s={14} w={600} c={C.muted}>{formatPrice(spent, priceCurrency)}</T> : null}
          </View>
          {drinks.length ? (
            drinks.map((d, i) => (
              <Animated.View key={d.id} entering={i === 0 ? fadeIn : undefined} style={[s.row, { height: 62, gap: 12 }]}>
                <Tile icon={normalizeDrinkType(d.drinkType) === 'beer' ? 'beer' : 'circle-dot'} />
                <View style={[s.fill, { gap: 2 }]}>
                  <T s={15} w={600} numberOfLines={1}>
                    {d.beerName}
                  </T>
                  <T s={13} c={C.muted}>{servingLine(d, inPub)}</T>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  {typeof d.priceCzk === 'number' ? <T s={15} w={600}>{formatPrice(d.priceCzk, priceCurrency)}</T> : null}
                  <T s={12} c={C.muted}>
                    {formatClock(new Date(d.at))}
                  </T>
                </View>
              </Animated.View>
            ))
          ) : (
            <T s={14} c={C.muted} style={{ paddingVertical: 14 }}>
              {copy.tonightEmpty}
            </T>
          )}
          {drinks.length ? (
            <Press
              onPress={() => {
                const last = session?.drinks[session.drinks.length - 1];
                if (last) removeCountedDrink(last.id);
              }}
              style={[s.row, { height: 44, gap: 8 }]}
            >
              <Icon name="undo-2" size={15} color={C.muted} />
              <T s={13} w={600} c={C.muted}>
                {copy.undoLast}
              </T>
            </Press>
          ) : null}
        </View>
      </ScrollView>
      <BottomFade height={tabSpace + 130} />
      <View style={{ position: 'absolute', left: SCREEN_X, right: SCREEN_X, bottom: tabSpace + 12 }}>
        <Button testID="counter-primary" height={60} label={ctaLabel} sub={ctaSub} haptic={!logsDirectly} onPress={oneMore} />
      </View>
    </View>
  );
}

/** Tonight's last direct ride home; nothing without a home point, outside PID or once it left. */
function TransitCard({ session }: { session: TallySession }) {
  const departure = useHomeTransitStore((state) => (state.lookupKey?.startsWith(`${session.clientId}|`) ? state.departure : null));
  const now = useNowTick();
  if (!isUpcomingDeparture(departure, now)) return null;
  const minutes = Math.ceil((departure.departsAtMs - now) / 60_000);
  const line = departure.line ? t.homeTransit.vehicleLine(departure.routeType, departure.line) : '';
  return (
    <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 16, gap: 12 }}>
      <View style={[s.row, { gap: 12, alignItems: 'flex-start' }]}>
        <Tile icon="tram-front" color={C.white} />
        <View style={[s.fill, { gap: 2 }]}>
          <T s={16} w={700}>
            {t.homeTransit.title}
          </T>
          <T s={13} c={C.muted}>
            {t.homeTransit.route(line, departure.fromStopName, departure.toStopName)}
          </T>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <D s={28} lh={1}>
            {formatDepartureTime(departure.departsAtMs)}
          </D>
          <T s={13} w={700} c={C.white}>
            {t.homeTransit.leavesIn(minutes)}
          </T>
        </View>
      </View>
      <View style={[s.row, { justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: C.hairline, paddingTop: 10 }]}>
        <T s={11} c={C.muted} style={s.fill}>
          {t.homeTransit.footnote}
        </T>
        <Press
          onPress={() => void Linking.openURL(idosConnectionUrl(departure)).catch(() => undefined)}
          accessibilityRole="link"
          accessibilityLabel={t.homeTransit.openIdosA11y}
          style={[s.row, { gap: 4 }]}
        >
          <T s={13} w={700}>
            {t.homeTransit.openIdos}
          </T>
          <Icon name="arrow-up-right" size={14} />
        </Press>
      </View>
    </View>
  );
}
