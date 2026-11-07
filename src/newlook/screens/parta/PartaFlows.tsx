import React, { useCallback, useEffect, useState } from 'react';
import { Share, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { nvBack } from '@/newlook/navigation';

import { generateUuidV4 } from '@/data/account';
import {
  blockFriend,
  endFriendPubActivity,
  fetchFriendProfile,
  removeFriend,
  type FriendProfile,
  type FriendProfileDetail,
} from '@/data/friendsClient';
import { enqueueFriendOp, isRetriableFriendError } from '@/data/friendsQueue';
import { fetchLeaderboard, type BoardPeriod, type Leaderboard } from '@/data/leaderboardsClient';
import { fetchFriendDuel, fetchPlanDetail, remindPlan, type FriendDuel, type PlanDetail } from '@/data/partaPlansClient';
import { fetchPubBoard, type PubBoard } from '@/data/pubBoardClient';
import { t } from '@/i18n';
import { badgeStates, PUBLIC_BADGE_KEYS } from '@/profile/badgeModel';
import { useHomeEveningStore } from '@/stores/homeEveningStore';

import { BackHeader, Screen } from '../../components/chrome';
import { Icon } from '../../components/Icon';
import { D, T, Button, Card, Chip, Dot, IconButton, Person, Row, Segmented } from '../../components/ui';
import { NO_VALUE } from '../../format';
import { dialog, toast } from '../../ui/store';
import { C, s } from '../../theme';
import { PlanTicket } from './PartaScreen';
import { useNvPlaceStore } from '../stamgast/placeStore';
import { useMe } from '../profil/profilModel';
import { joinNames, personInitial, personName, planTitle, shortDay } from './partaModel';
import { CheerButton } from './cheer';
import { usePartaStore } from './partaStore';
import { addPlanToCalendar, openNavigation } from './planActions';
import { FriendPhotosSection } from './PartaPhotos';

export { NovaPozvankaScreen } from './NovaPozvanka';
export { PivoUNekohoScreen, SetkaniScreen } from './Meetups';

const PUBLIC_PROFILE_ORIGIN = 'https://na-pivo.cz/u/';

function Loading({ failed, onRetry, failedText }: { failed: boolean; onRetry: () => void; failedText: string }) {
  return (
    <View style={{ paddingVertical: 40, gap: 12, alignItems: 'center' }}>
      <T s={15} c={C.muted}>
        {failed ? failedText : t.nv.parta.loading}
      </T>
      {failed ? <Button label={t.nv.parta.retry} kind="raised" height={42} onPress={onRetry} /> : null}
    </View>
  );
}

export function KamosScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [detail, setDetail] = useState<FriendProfileDetail | null>(null);
  const [duel, setDuel] = useState<FriendDuel | null>(null);
  const [failed, setFailed] = useState(false);
  const presence = usePartaStore((st) => st.dashboard?.presence.find((p) => p.account.id === id) ?? null);
  const atHome = usePartaStore((st) => st.dashboard?.homePresence?.some((p) => p.account.id === id) ?? false);

  const fetchAll = useCallback(() => {
    if (!id) return;
    void fetchFriendProfile(id).then((next) => {
      if (next) setDetail(next);
      setFailed(!next);
    });
    void fetchFriendDuel(id, 'month').then(setDuel);
  }, [id]);
  useEffect(() => {
    fetchAll();
  }, [fetchAll]);
  const retry = () => {
    setFailed(false);
    fetchAll();
  };

  const profile = detail?.profile;
  const name = personName(profile);
  const stats = detail?.publicStats;
  const badges = detail?.badgeProgress
    ? badgeStates(detail.badgeProgress).filter((b) => PUBLIC_BADGE_KEYS.has(b.key) && b.tier > 0).length
    : null;
  const shareUrl = profile?.isPublic && profile.nickname ? `${PUBLIC_PROFILE_ORIGIN}${encodeURIComponent(profile.nickname)}` : null;

  if (!detail || !profile) {
    return (
      <Screen header={<BackHeader />}>
        <Loading failed={failed} onRetry={retry} failedText={t.nv.parta.profileFailed} />
      </Screen>
    );
  }

  const mine = duel?.available ? duel.me?.beers ?? 0 : null;
  const theirs = duel?.available ? duel.them?.beers ?? 0 : null;
  const max = Math.max(mine ?? 0, theirs ?? 0, 1);
  const month = t.nv.parta.monthsIn[new Date().getMonth()];

  return (
    <Screen
      header={
        <BackHeader
          right={shareUrl ? <IconButton icon="share" size={40} iconSize={18} label={t.nv.parta.share} onPress={() => void Share.share({ message: shareUrl })} /> : undefined}
        />
      }
      footer={detail.isFriend ? <Button label={t.nv.parta.ping} icon="bell-ring" onPress={() => router.push({ pathname: '/nv/cinknout', params: { friend: profile.id } })} /> : undefined}
    >
      <View style={[s.row, { gap: 16 }]}>
        <Person initial={personInitial(profile)} uri={profile.avatarUrl} size={84} />
        <View style={[s.fill, { gap: 4 }]}>
          <D s={34}>{name}</D>
          {profile.nickname && stats ? <T s={14} c={C.muted}>{t.nv.parta.levelLine(profile.nickname, stats.mapperTitle, stats.mapperLevel)}</T> : null}
        </View>
      </View>
      {presence || atHome ? (
        <View style={[s.row, { gap: 10, height: 54, borderRadius: 16, paddingLeft: 16, paddingRight: 10, backgroundColor: '#FFC40014', borderWidth: 1, borderColor: '#FFC40026' }]}>
          <Dot />
          <T s={15} w={600} numberOfLines={1} style={s.fill}>
            {presence ? t.nv.parta.sitsNow(presence.pubName, presence.beers) : t.nv.parta.sitsAtHome}
          </T>
          {presence && detail.isFriend ? <CheerButton presence={presence} /> : null}
        </View>
      ) : null}
      {stats ? (
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          {[
            [String(stats.totalBeers), t.nv.parta.beersTotal(stats.totalBeers)],
            [String(stats.distinctPubs), t.nv.parta.pubsTotal(stats.distinctPubs)],
            ...(badges !== null ? [[String(badges), t.nv.parta.badgesTotal(badges)]] : []),
          ].map(([v, l], i, arr) => (
            <View key={l} style={{ gap: 2, alignItems: i === arr.length - 1 && i > 0 ? 'flex-end' : i === 1 ? 'center' : 'flex-start' }}>
              <D s={34} lh={1}>
                {v}
              </D>
              <T s={12} c={C.muted}>
                {l}
              </T>
            </View>
          ))}
        </View>
      ) : null}
      {mine !== null && theirs !== null ? (
        <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 16, gap: 14 }}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <T s={16} w={700}>
              {t.nv.parta.beersIn(month)}
            </T>
            <T s={13} c={C.muted}>
              {theirs > mine ? t.nv.parta.theyLead(name, theirs - mine) : mine > theirs ? t.nv.parta.youLead(mine - theirs) : t.nv.parta.tie}
            </T>
          </View>
          {(
            [
              [t.nv.parta.you, mine, C.yellow],
              [name, theirs, C.white],
            ] as const
          ).map(([l, n, c]) => (
            <View key={`${l}-${c}`} style={[s.row, { gap: 12 }]}>
              <T s={14} w={600} style={{ width: 104 }} numberOfLines={1}>
                {l}
              </T>
              <View style={[s.fill, { height: 8, borderRadius: 4, backgroundColor: C.control }]}>
                <View style={{ width: `${(n / max) * 100}%`, height: 8, borderRadius: 4, backgroundColor: c }} />
              </View>
              <D s={22} c={c} style={{ width: 28, textAlign: 'right' }}>
                {String(n)}
              </D>
            </View>
          ))}
        </View>
      ) : null}
      {detail.isFriend ? <FriendPhotosSection id={profile.id} name={name} /> : null}
      {detail.recentTogether.length ? (
        <>
          <T s={19} w={700}>
            {t.nv.parta.lastTogetherTitle}
          </T>
          <Card>
            {detail.recentTogether.map((r, i) => (
              <Row
                key={`${r.cacheKey}-${r.at}`}
                last={i === detail.recentTogether.length - 1}
                title={shortDay(r.at)}
                sub={r.pubName}
                trailing={r.beers != null ? <D s={24}>{String(r.beers)}</D> : undefined}
              />
            ))}
          </Card>
        </>
      ) : null}
      <Card>
        {detail.isFriend ? (
          <Row
            leading={<Icon name="user-minus" size={18} color={C.text2} />}
            title={t.nv.parta.removeFromParty}
            titleColor={C.text2}
            onPress={() =>
              dialog({
                title: t.nv.parta.removeTitle(name),
                body: t.nv.parta.removeBody,
                actions: [
                  { label: t.nv.parta.keep },
                  {
                    label: t.nv.parta.remove,
                    kind: 'danger',
                    onPress: () =>
                      void removeFriend(profile.id).then((res) => {
                        if (!res.ok) return toast({ kind: 'error', title: res.detail, icon: 'circle-alert' });
                        void usePartaStore.getState().load();
                        nvBack(router);
                        toast({ kind: 'info', title: t.nv.parta.removed(name), icon: 'user-minus' });
                      }),
                  },
                ],
              })
            }
          />
        ) : null}
        <Row
          last
          leading={<Icon name="ban" size={18} color={C.text2} />}
          title={t.nv.parta.block}
          titleColor={C.text2}
          onPress={() =>
            void blockFriend(profile.id).then((res) => {
              if (!res.ok) return toast({ kind: 'error', title: res.detail, icon: 'circle-alert' });
              void usePartaStore.getState().load();
              nvBack(router);
              toast({ kind: 'info', title: t.nv.parta.blocked, sub: t.nv.parta.blockedSub, icon: 'ban' });
            })
          }
        />
      </Card>
    </Screen>
  );
}

type BoardTab = 'piva' | 'objevitele' | 'maperi' | 'hospody';
type BoardPeriodKey = Extract<BoardPeriod, 'week' | 'month' | 'all'>;
type BoardRow = { key: string; initial: string; uri?: string | null; name: string; sub: string; score: string; me: boolean; rank: number };
type BoardView = { rank: string; title: string; sub: string; rows: BoardRow[]; empty: boolean };

function personBoard(tab: Exclude<BoardTab, 'hospody'>, board: Leaderboard, period: BoardPeriodKey): BoardView {
  const score = (n: number) => (tab === 'piva' ? t.nv.parta.scoreBeers(n) : tab === 'objevitele' ? t.nv.parta.scorePubs(n) : t.nv.parta.scoreXp(n));
  const race = tab === 'maperi' ? '' : period === 'week' ? t.nv.parta.nextRaceWeek : period === 'month' ? t.nv.parta.nextRaceMonth : '';
  const rows: BoardRow[] = board.entries.slice(0, 10).map((e) => ({
    key: e.account.id,
    rank: e.rank,
    initial: personInitial(e.account),
    uri: e.account.avatarUrl,
    name: e.isMe ? t.nv.parta.you : e.account.nickname ? `@${e.account.nickname}` : personName(e.account),
    sub: e.isFriend ? t.nv.parta.inParty : '',
    score: String(e.score),
    me: e.isMe,
  }));
  if (board.me.rank && !rows.some((r) => r.me)) {
    rows.push({ key: 'me', rank: board.me.rank, initial: t.nv.parta.you.slice(0, 1), name: t.nv.parta.you, sub: '', score: String(board.me.score), me: true });
  }
  return {
    rank: board.me.rank ? `${board.me.rank}.` : NO_VALUE,
    title: board.me.rank ? (tab === 'piva' ? t.nv.parta.rankBeers : tab === 'objevitele' ? t.nv.parta.rankExplorers : t.nv.parta.rankMappers) : t.nv.parta.noRank,
    sub: !board.me.eligible ? t.nv.parta.privateRank : [score(board.me.score), race].filter(Boolean).join(' · '),
    rows,
    empty: rows.length === 0,
  };
}

function pubsBoard(board: PubBoard, period: BoardPeriodKey): BoardView {
  const top = board.entries[0];
  return {
    rank: top ? '1.' : NO_VALUE,
    title: top?.name ?? t.nv.parta.boardEmpty,
    sub: top ? t.nv.parta.pubBoardSub(top.beers, period) : '',
    // The leader already sits in the card above.
    rows: board.entries.slice(1, 10).map((e) => ({
      key: e.key,
      rank: e.rank,
      initial: e.name.slice(0, 1).toUpperCase(),
      name: e.name,
      sub: e.city,
      score: String(e.beers),
      me: false,
    })),
    // The card above already says when no pub made it.
    empty: false,
  };
}

export function ZebrickyScreen() {
  const myAvatar = useMe().avatarUrl;
  const [tab, setTab] = useState<BoardTab>('piva');
  const [period, setPeriod] = useState<BoardPeriodKey>('week');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; view: BoardView | null } | null>(null);
  const key = `${tab}:${period}:${attempt}`;
  const view = result?.key === key ? result.view : null;
  const failed = result?.key === key && !result.view;

  useEffect(() => {
    let alive = true;
    const done = (next: BoardView | null) => {
      if (alive) setResult({ key, view: next });
    };
    if (tab === 'hospody') {
      void fetchPubBoard(period, null).then((board) => done(board ? pubsBoard(board, period) : null));
    } else {
      const category = tab === 'piva' ? 'beers' : tab === 'objevitele' ? 'pubs' : 'mapper';
      void fetchLeaderboard(category, period).then((board) => done(board ? personBoard(tab, board, period) : null));
    }
    return () => {
      alive = false;
    };
  }, [tab, period, key]);

  const periods: { key: BoardPeriodKey; label: string }[] = [
    // The pub board counts the last finished week.
    { key: 'week', label: tab === 'hospody' ? t.nv.parta.periodLastWeek : t.nv.parta.periodWeek },
    { key: 'month', label: t.nv.parta.periodMonth },
    { key: 'all', label: t.nv.parta.periodAll },
  ];

  return (
    <Screen header={<BackHeader heading={t.nv.parta.boards} />} gap={16} padTop={20}>
      <Segmented
        height={38}
        options={[
          { key: 'piva', label: t.nv.parta.tabBeers },
          { key: 'objevitele', label: t.nv.parta.tabExplorers },
          { key: 'maperi', label: t.nv.parta.tabMappers },
          { key: 'hospody', label: t.nv.parta.tabPubs },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'maperi' ? null : (
        <View style={[s.row, { gap: 8 }]}>
          {periods.map((p) => (
            <Chip key={p.key} label={p.label} active={period === p.key} plain onPress={() => setPeriod(p.key)} />
          ))}
        </View>
      )}
      {!view ? (
        <Loading failed={failed} onRetry={() => setAttempt((n) => n + 1)} failedText={t.nv.parta.failed} />
      ) : (
        <>
          <View style={[s.row, { gap: 16, padding: 18, borderRadius: 24, backgroundColor: C.yellowWash, borderWidth: 1, borderColor: C.yellowEdge }]}>
            <D s={64} lh={0.9} c={C.yellow}>
              {view.rank}
            </D>
            <View style={[s.fill, { gap: 2 }]}>
              <T s={17} w={700}>
                {view.title}
              </T>
              {view.sub ? (
                <T s={13} c={C.muted}>
                  {view.sub}
                </T>
              ) : null}
            </View>
          </View>
          {view.rows.length ? (
            <Card>
              {view.rows.map((r, idx) => (
                <Row
                  key={r.key}
                  last={idx === view.rows.length - 1}
                  leading={
                    <View style={[s.row, { gap: 14 }]}>
                      <D s={22} c={r.me ? C.yellow : C.muted} style={{ minWidth: 16 }}>
                        {String(r.rank)}
                      </D>
                      <Person initial={r.initial} uri={r.uri ?? (r.me ? myAvatar : null)} size={36} ring={r.me} />
                    </View>
                  }
                  title={r.name}
                  titleColor={r.me ? C.yellow : C.white}
                  titleWeight={700}
                  sub={r.sub || undefined}
                  trailing={
                    <D s={24} c={r.me ? C.yellow : C.white}>
                      {r.score}
                    </D>
                  }
                />
              ))}
            </Card>
          ) : !view.empty ? null : (
            <T s={14} c={C.muted}>
              {t.nv.parta.boardEmpty}
            </T>
          )}
        </>
      )}
    </Screen>
  );
}

function PeopleRow({ label, people, last, trailing }: { label: string; people: FriendProfile[] | string; last?: boolean; trailing?: React.ReactNode }) {
  const names = typeof people === 'string' ? people : people.length ? joinNames(people) : t.nv.parta.nobody;
  return (
    <Row
      last={last}
      title={<T s={15} c={C.muted} numberOfLines={1}>{label}</T>}
      trailing={
        <View style={[s.row, { gap: 12, flexShrink: 1, maxWidth: '78%' }]}>
          <T s={15} w={700} numberOfLines={2} style={{ flexShrink: 1, textAlign: 'right' }}>
            {names}
          </T>
          {trailing}
        </View>
      }
    />
  );
}

export function PlanScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const cached = usePartaStore((st) => st.plans?.find((p) => p.id === id) ?? null);
  const ping = usePartaStore((st) => !!id && st.pingIds.includes(id));
  const [detail, setDetail] = useState<PlanDetail | null>(null);
  const [gone, setGone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reminding, setReminding] = useState(false);

  const fetchDetail = useCallback(() => {
    if (!id) return;
    void fetchPlanDetail(id).then((next) => {
      if (next === 'gone') {
        setGone(true);
        usePartaStore.getState().removePlan(id);
      } else if (next) {
        setDetail(next);
        usePartaStore.getState().upsertPlan(next.plan);
      }
      setFailed(next === null);
    });
  }, [id]);
  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  // RSVPs and edits land in the store first; every detail fetch writes there too.
  const plan = cached ?? detail?.plan ?? null;
  const inviteUrl = plan?.isMine ? plan.inviteUrl : null;
  const share = inviteUrl ? (
    <IconButton icon="share" size={40} iconSize={18} label={t.nv.parta.shareInvite} onPress={() => void Share.share({ message: t.nv.parta.inviteMessage(plan?.name ?? '', inviteUrl) })} />
  ) : (
    <IconButton icon="share" size={40} iconSize={18} label={t.nv.parta.share} onPress={() => router.push('/nv/nalepky')} />
  );

  if (gone) {
    return (
      <Screen header={<BackHeader />}>
        <Loading failed onRetry={() => nvBack(router)} failedText={t.nv.parta.planGone} />
      </Screen>
    );
  }
  if (!plan) {
    return (
      <Screen header={<BackHeader />}>
        <Loading
          failed={failed}
          onRetry={() => {
            setFailed(false);
            fetchDetail();
          }}
          failedText={t.nv.parta.failed}
        />
      </Screen>
    );
  }
  const people = detail?.people;
  const host = personName(plan.account);

  if (plan.isMine) {
    const going = [t.nv.parta.you, ...(people?.going ?? []).map(personName)].join(', ');
    const guests = (people?.guests ?? [])
      .filter((g) => g.response !== 'cant')
      .map((g) => (g.response === 'maybe' ? t.nv.parta.guestMaybe(g.name) : g.name))
      .join(', ');
    const remind = () => {
      setReminding(true);
      void remindPlan(plan.id).then((res) => {
        setReminding(false);
        if (res.ok) toast({ kind: 'saved', title: t.nv.parta.reminded, sub: t.nv.parta.remindedSub(joinNames(people?.silent ?? [])), icon: 'bell' });
        else toast({ kind: 'error', title: res.detail, icon: 'circle-alert' });
      });
    };
    return (
      <Screen header={<BackHeader right={share} />} gap={18}>
        <PlanTicket plan={plan} big onEnded={() => nvBack(router)} />
        <Card>
          <PeopleRow label={t.nv.parta.goingLabel} people={going} />
          <PeopleRow label={t.nv.parta.maybeLabel} people={people?.maybe ?? []} />
          {guests ? <PeopleRow label={t.nv.parta.guestsLabel} people={guests} /> : null}
          <PeopleRow
            last
            label={t.nv.parta.silentLabel}
            people={people?.silent ?? []}
            trailing={people?.silent.length ? <Chip label={t.nv.parta.remind} icon="bell" height={34} onPress={reminding ? undefined : remind} /> : undefined}
          />
        </Card>
        {/* A pub ping cannot be edited; the ticket above carries the way to end it. */}
        <Card>
          {ping ? null : (
            <Row leading={<Icon name="pencil-line" size={18} color={C.text2} />} title={t.nv.parta.editPlan} onPress={() => router.push({ pathname: '/nv/nova-pozvanka', params: { id: plan.id } })} />
          )}
          <Row last={ping} leading={<Icon name="sticker" size={18} color={C.text2} />} title={t.nv.parta.sendSticker} onPress={() => router.push('/nv/nalepky')} />
          {ping ? null : (
            <Row
              last
              leading={<Icon name="circle-x" size={18} color={C.text2} />}
              title={t.nv.parta.cancelPlan}
              onPress={() =>
                dialog({
                  title: t.nv.parta.cancelTitle,
                  body: t.nv.parta.cancelBody,
                  actions: [
                    { label: t.nv.parta.keep },
                    {
                      label: t.nv.parta.cancel,
                      kind: 'danger',
                      onPress: () =>
                        void endFriendPubActivity(plan.id).then(async (res) => {
                          if (!res.ok && !isRetriableFriendError(res)) return toast({ kind: 'error', title: res.detail, icon: 'circle-alert' });
                          if (!res.ok) await enqueueFriendOp({ op: 'end', clientId: plan.id, activityId: plan.id });
                          usePartaStore.getState().removePlan(plan.id);
                          nvBack(router);
                          toast({ kind: 'info', title: t.nv.parta.cancelled, icon: 'circle-x' });
                        }),
                    },
                  ],
                })
              }
            />
          )}
        </Card>
      </Screen>
    );
  }

  const home = detail?.home;
  const goingPeople = [plan.account, ...(people?.going ?? plan.responses.goingProfiles).filter((p) => p.id !== plan.account.id)];
  const goingGuests = (people?.guests ?? []).filter((g) => g.response === 'going');
  const goingTotal = goingPeople.length + goingGuests.length;
  const where =
    plan.placeKind === 'pub'
      ? { title: plan.name, sub: plan.city }
      : { title: plan.address || t.nv.parta.addressLater(host), sub: plan.placeKind === 'home' ? planTitle(plan) : plan.name };
  const checkIn = () => {
    const clientId = generateUuidV4();
    useHomeEveningStore.getState().setEvening({ activityId: plan.id, hostName: host, startedAt: plan.scheduledFor || plan.startedAt });
    // The next beer counts at the friend's place, even when a pub was picked by hand earlier.
    useNvPlaceStore.getState().setOutside('private');
    void enqueueFriendOp({ op: 'home-checkin', activityId: plan.id, clientId });
    toast({ kind: 'saved', title: t.nv.parta.checkedIn(host), icon: 'house' });
    router.dismissTo('/nv/stamgast');
  };

  return (
    <Screen header={<BackHeader right={share} />} gap={18}>
      <PlanTicket plan={plan} big />
      <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 16, gap: 14 }}>
        <View style={[s.row, { gap: 12, alignItems: 'flex-start' }]}>
          <Icon name="map-pin" size={20} color={C.yellow} />
          <View style={[s.fill, { gap: 2 }]}>
            <T s={16} w={700}>
              {where.title}
            </T>
            {where.sub ? (
              <T s={13} c={C.muted}>
                {where.sub}
              </T>
            ) : null}
          </View>
        </View>
        <View style={[s.row, { gap: 10 }]}>
          <Button
            label={t.nv.parta.navigate}
            icon="navigation"
            kind="raised"
            height={40}
            flex
            onPress={() => void openNavigation(plan)}
          />
          <Button
            label={t.nv.parta.toCalendar}
            icon="calendar-plus"
            kind="raised"
            height={40}
            flex
            onPress={() =>
              void addPlanToCalendar(plan).then((result) => {
                if (result === 'saved') toast({ kind: 'saved', title: t.nv.parta.inCalendar, icon: 'calendar-check' });
                else if (result === 'failed') toast({ kind: 'error', title: t.nv.parta.calendarFailed, icon: 'circle-alert' });
              })
            }
          />
        </View>
      </View>
      <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-end' }]}>
        <View style={[s.row, { alignItems: 'flex-end', gap: 6 }]}>
          <D s={30} lh={1}>
            {String(goingTotal)}
          </D>
          <T s={17} w={700}>
            {t.nv.parta.goingWord(goingTotal)}
          </T>
        </View>
        {people?.maybeCount ? (
          <T s={13} c={C.muted}>
            {t.nv.parta.maybeCount(people.maybeCount)}
          </T>
        ) : null}
      </View>
      <View style={[s.row, { gap: 18, flexWrap: 'wrap' }]}>
        {goingPeople.slice(0, 5).map((p, i) => (
          <View key={p.id} style={{ alignItems: 'center', gap: 6 }}>
            <Person initial={personInitial(p)} uri={p.avatarUrl} size={46} filled={false} />
            <T s={12} w={600} c={i === 0 ? C.yellow : C.text2} numberOfLines={1}>
              {personName(p)}
            </T>
          </View>
        ))}
        {goingGuests.slice(0, Math.max(0, 5 - goingPeople.length)).map((g) => (
          <View key={g.id} style={{ alignItems: 'center', gap: 6 }}>
            <Person initial={g.name.slice(0, 1).toLocaleUpperCase()} size={46} filled={false} />
            <T s={12} w={600} c={C.muted} numberOfLines={1} style={{ maxWidth: 72 }}>
              {g.name}
            </T>
          </View>
        ))}
      </View>
      {plan.placeKind === 'home' && plan.myResponse === 'going' && home?.canCheckIn && !home.myCheckin ? (
        <Button label={t.nv.parta.imAt} icon="house" kind="raised" onPress={checkIn} />
      ) : null}
    </Screen>
  );
}
