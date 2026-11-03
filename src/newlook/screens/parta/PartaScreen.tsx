import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { generateUuidV4 } from '@/data/account';
import {
  respondFriendRequest,
  shareFriendPubActivity,
  updateFriendSettings,
  type FriendProfile,
} from '@/data/friendsClient';
import { enqueueFriendOp, isRetriableFriendError } from '@/data/friendsQueue';
import type { PartaPlan } from '@/data/partaPlansClient';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { t } from '@/i18n';
import { useAccountStore } from '@/stores/accountStore';
import { usePartaSignalStore } from '@/stores/partaSignalStore';

import { BottomFade, TabHeader, useTabBarSpace } from '../../components/chrome';
import { StatusCard } from '../../components/StatusCard';
import { Ticket } from '../../components/forms';
import { Icon, type IconName } from '../../components/Icon';
import { Button, Card, IconButton, Person, Press, Row, SectionTitle, Stack, T, Tile, Toggle } from '../../components/ui';
import { dialog, toast } from '../../ui/store';
import { fadeIn } from '../../motion';
import { C, SCREEN_X, s } from '../../theme';
import { lastTogetherLabel, personInitial, personName, planTime, planTitle, ticketDay } from './partaModel';
import { usePartaStore } from './partaStore';
import { pingPerson, respondToPlan } from './planActions';

const RSVP: { key: 'going' | 'maybe' | 'cant'; label: () => string; icon: IconName }[] = [
  { key: 'going', label: () => t.nv.parta.rsvpGoing, icon: 'check' },
  { key: 'maybe', label: () => t.nv.parta.rsvpMaybe, icon: 'circle-question-mark' },
  { key: 'cant', label: () => t.nv.parta.rsvpCant, icon: 'x' },
];

export function RsvpRow({ plan, dark }: { plan: PartaPlan; dark?: boolean }) {
  return (
    <View style={[s.row, { gap: 6 }]}>
      {RSVP.map((r) => (
        <Press
          key={r.key}
          haptic
          onPress={() => {
            void respondToPlan(plan, r.key).then((ok) => {
              if (ok && r.key === 'going') toast({ kind: 'saved', title: t.nv.parta.goingToast(personName(plan.account)), icon: 'check' });
            });
          }}
          style={[s.fill, s.row, { height: 40, borderRadius: 20, justifyContent: 'center', gap: 6, backgroundColor: dark ? C.control : '#0A0A0A1A' }]}
        >
          <Icon name={r.icon} size={16} color={dark ? C.white : C.black} />
          <T s={15} w={700} c={dark ? C.white : C.black}>
            {r.label()}
          </T>
        </Press>
      ))}
    </View>
  );
}

export function PlanStub({ plan }: { plan: PartaPlan }) {
  const router = useRouter();
  const partySize = usePartaStore((st) => st.dashboard?.friends.length);
  if (plan.isMine) {
    const n = plan.inviteeCount ?? 0;
    return (
      <View style={[s.row, { gap: 8, height: 40, paddingHorizontal: 4 }]}>
        <Icon name="users" size={16} color={C.muted} />
        <T s={14} w={600} c={C.text2}>
          {n === partySize ? t.nv.parta.invitedAll(n) : t.nv.parta.invitedSome(n)}
        </T>
      </View>
    );
  }
  if (!plan.myResponse) return <RsvpRow plan={plan} />;
  if (plan.myResponse === 'going') {
    return (
      <View style={[s.row, { height: 40, gap: 10, paddingHorizontal: 4 }]}>
        <Icon name="circle-check" size={18} color={C.yellow} />
        <T s={15} w={700} style={s.fill}>
          {t.nv.parta.goingToast(personName(plan.account))}
        </T>
        <Press onPress={() => void respondToPlan(plan, null)} hitSlop={8}>
          <T s={14} w={600} c={C.text2}>
            {t.nv.parta.change}
          </T>
        </Press>
      </View>
    );
  }
  return (
    <Press onPress={() => router.push({ pathname: '/nv/plan/[id]', params: { id: plan.id } })} style={[s.row, { height: 40, gap: 10, paddingHorizontal: 4 }]}>
      <Icon name={plan.myResponse === 'maybe' ? 'circle-question-mark' : 'circle-x'} size={18} color={C.muted} />
      <T s={15} w={700} c={C.text2} style={s.fill}>
        {plan.myResponse === 'maybe' ? t.nv.parta.maybeNote : t.nv.parta.cantNote}
      </T>
      <T s={14} w={600} c={C.text2}>
        {t.nv.parta.change}
      </T>
    </Press>
  );
}

function GoingStub({ plan }: { plan: PartaPlan }) {
  return (
    <View style={[s.row, { gap: 10, height: 40 }]}>
      <Stack initials={plan.responses.goingProfiles.slice(0, 4).map(personInitial)} />
      <T s={14} w={600} c={C.text2} style={s.fill}>
        {t.nv.parta.goingCount(plan.responses.going)}
      </T>
      {plan.myResponse === 'going' ? (
        <View style={[s.row, { height: 30, borderRadius: 15, paddingHorizontal: 12, gap: 6, backgroundColor: C.white }]}>
          <Icon name="check" size={15} color={C.black} />
          <T s={14} w={800} c={C.black}>
            {t.nv.parta.rsvpGoing}
          </T>
        </View>
      ) : null}
    </View>
  );
}

export function PlanTicket({ plan, width, big }: { plan: PartaPlan; width?: number; big?: boolean }) {
  const yellow = !plan.myResponse && !plan.isMine;
  const day = ticketDay(planTime(plan));
  return (
    <Ticket
      width={width}
      big={big}
      yellow={yellow}
      kicker={plan.isMine ? t.nv.parta.yourPlan : t.nv.parta.inviteFrom(personName(plan.account))}
      kickerIcon={plan.placeKind === 'pub' ? 'beer' : 'house'}
      dayNum={day.dayNum}
      dayName={day.dayName}
      time={day.time}
      title={planTitle(plan)}
      quote={plan.message || undefined}
      stub={yellow || big || plan.isMine ? <PlanStub plan={plan} /> : <GoingStub plan={plan} />}
    />
  );
}

function LiveRow({ profile, sub, last }: { profile: FriendProfile; sub: string; last?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <Row
      last={last}
      height={66}
      leading={<Person initial={personInitial(profile)} />}
      title={personName(profile)}
      titleWeight={700}
      sub={sub}
      trailing={
        <Press
          haptic
          disabled={done}
          onPress={() => {
            setDone(true);
            void pingPerson(profile).then((ok) => {
              if (!ok) setDone(false);
            });
          }}
          style={[s.row, { height: 34, borderRadius: 18, paddingHorizontal: 14, gap: 6, backgroundColor: done ? C.yellowTint : C.card, borderWidth: 1, borderColor: done ? C.yellowLine : C.hairline }]}
        >
          <Icon name="beer" size={16} color={C.yellow} />
          <T s={14} w={600} c={done ? C.yellow : C.white}>
            {done ? t.nv.parta.pinged : t.nv.parta.ping}
          </T>
        </Press>
      }
    />
  );
}

export function PartaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const { width } = useWindowDimensions();
  const dashboard = usePartaStore((st) => st.dashboard);
  const plans = usePartaStore((st) => st.plans);
  const failed = usePartaStore((st) => st.failed);
  const loading = usePartaStore((st) => st.loading);
  const load = usePartaStore((st) => st.load);
  const myProfile = useAccountStore((st) => st.profile);
  const [page, setPage] = useState(0);
  const ticketW = Math.min(300, width - SCREEN_X * 2 - 50);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // A push tap or invite claim asks for fresh data even when Parta is already open, and may name a plan to open.
  const pendingRefresh = usePartaSignalStore((st) => st.pendingRefresh);
  useEffect(() => {
    if (!pendingRefresh) return;
    const target = usePartaSignalStore.getState().consumeRefresh();
    void load().then(() => {
      const id = target?.activityId;
      if (id && usePartaStore.getState().plans?.some((plan) => plan.id === id)) {
        router.push({ pathname: '/nv/plan/[id]', params: { id } });
      }
    });
  }, [pendingRefresh, load, router]);

  const friends = dashboard?.friends ?? [];
  const settings = dashboard?.settings;
  const visible = !!settings && settings.shareDrinksWithParta && !settings.ghostMode;
  const me = dashboard?.myPresence ?? null;
  const presence = dashboard?.presence ?? [];
  const homePresence = (dashboard?.homePresence ?? []).filter((row) => !presence.some((p) => p.account.id === row.account.id));
  const liveIds = new Set([...presence.map((p) => p.account.id), ...homePresence.map((p) => p.account.id)]);
  const rest = friends.filter((f) => !liveIds.has(f.id));
  const outCount = liveIds.size + (me && me.visibleToParta ? 1 : 0);

  const setVisible = (value: boolean) => {
    const patch = value ? { shareDrinksWithParta: true, ...(settings?.ghostMode ? { ghostMode: false } : {}) } : { shareDrinksWithParta: false };
    const previous = settings;
    usePartaStore.getState().setDashboard((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
    void updateFriendSettings(patch).then((res) => {
      if (res.ok) return;
      if (previous) usePartaStore.getState().setDashboard((d) => ({ ...d, settings: previous }));
      toast({ kind: 'error', title: res.detail, icon: 'circle-alert' });
    });
  };

  const callParty = () => {
    if (!me || me.lat == null || me.lng == null) return;
    const pub = { id: '', name: me.pubName, lat: me.lat, lng: me.lng, city: me.pubCity };
    const clientId = generateUuidV4();
    trackUiInteraction('parta_activity_share', 'submit');
    void shareFriendPubActivity(pub, '', clientId).then(async (res) => {
      trackUiInteraction('parta_activity_share', res.ok || isRetriableFriendError(res) ? 'success' : 'failure');
      if (res.ok) {
        toast({ kind: 'saved', title: t.nv.parta.called, sub: t.nv.parta.calledSub, icon: 'megaphone' });
      } else if (isRetriableFriendError(res)) {
        await enqueueFriendOp({ op: 'activity', clientId, payload: { pub } });
        toast({ kind: 'offline', title: t.nv.parta.calledOffline, icon: 'cloud-off' });
      } else {
        toast({ kind: 'error', title: res.detail, icon: 'circle-alert' });
      }
    });
  };

  const answerRequest = (id: string, name: string, action: 'accept' | 'decline') => {
    trackUiInteraction(action === 'accept' ? 'friends_request_accept' : 'friends_request_decline', action);
    usePartaStore.getState().setDashboard((d) => ({ ...d, incomingRequests: d.incomingRequests.filter((r) => r.id !== id) }));
    void respondFriendRequest(id, action).then((res) => {
      if (res.ok) {
        if (action === 'accept') toast({ kind: 'saved', title: t.nv.parta.joined(name), icon: 'user-plus' });
        void load();
      } else {
        toast({ kind: 'error', title: res.detail, icon: 'circle-alert' });
        void load();
      }
    });
  };

  const openPlan = (id: string) => router.push({ pathname: '/nv/plan/[id]', params: { id } });
  const openFriend = (id: string) => {
    trackUiInteraction('friends_profile_open');
    router.push({ pathname: '/nv/kamos/[id]', params: { id } });
  };
  const plansList = plans ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: SCREEN_X, gap: 20, paddingBottom: tabSpace + 30 }}>
        <TabHeader title={t.nv.parta.title}>
          <IconButton icon="qr-code" iconSize={20} onPress={() => router.push('/nv/sprava-party')} label={t.nv.parta.qrLabel} />
          <Button label={t.nv.parta.add} icon="user-plus" kind="raised" height={44} style={{ paddingHorizontal: 16 }} onPress={() => router.push('/nv/sprava-party')} />
        </TabHeader>
        {failed && dashboard ? (
          <Press onPress={() => void load()} style={[s.row, { gap: 10, paddingHorizontal: 4 }]}>
            <Icon name="wifi-off" size={16} color={C.muted} />
            <T s={13} c={C.muted} style={s.fill}>
              {t.nv.parta.offline}
            </T>
            <T s={13} w={700} c={C.yellow}>
              {t.nv.parta.retry}
            </T>
          </Press>
        ) : null}
        <SectionTitle title={t.nv.parta.invitations} action={plansList.length ? t.nv.parta.plan : undefined} onAction={() => router.push('/nv/nova-pozvanka')} />
        {plansList.length ? (
          <View style={{ gap: 12 }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={ticketW + 12}
              decelerationRate="fast"
              style={{ marginHorizontal: -SCREEN_X }}
              contentContainerStyle={{ paddingHorizontal: SCREEN_X, gap: 12 }}
              onScroll={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / (ticketW + 12)))}
              scrollEventThrottle={32}
            >
              {plansList.map((p) => (
                <Press key={p.id} onPress={() => openPlan(p.id)}>
                  <PlanTicket plan={p} width={ticketW} />
                </Press>
              ))}
              <Press onPress={() => router.push('/nv/nova-pozvanka')} style={[{ width: ticketW, minHeight: 242, borderRadius: 24, borderWidth: 1.5, borderColor: C.lineStrong, gap: 10 }, s.center]}>
                <View style={[{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.control }, s.center]}>
                  <Icon name="plus" size={20} />
                </View>
                <T s={16} w={700}>
                  {t.nv.parta.newInvite}
                </T>
              </Press>
            </ScrollView>
            <View style={[s.row, { justifyContent: 'center', gap: 6 }]}>
              {[...plansList, null].map((_, i) => (
                <View key={i} style={{ width: i === page ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i === page ? C.white : '#FFFFFF40' }} />
              ))}
            </View>
          </View>
        ) : plans === null && loading ? (
          <StatusCard text={t.nv.parta.loading} action={t.nv.parta.newInvite} actionIcon="plus" reserve />
        ) : plans === null && failed ? (
          <StatusCard text={t.nv.parta.loadFailed} action={t.nv.parta.retry} onAction={() => void load()} />
        ) : (
          <StatusCard text={t.nv.parta.nothingPlanned} action={t.nv.parta.newInvite} actionIcon="plus" onAction={() => router.push('/nv/nova-pozvanka')} />
        )}
        {dashboard ? (
          <Animated.View entering={fadeIn} style={{ gap: 20 }}>
            <SectionTitle title={t.nv.parta.outNow} action={t.nv.parta.outCount(outCount, friends.length + 1)} />
            <Card>
              <Row
                height={66}
                last={presence.length + homePresence.length === 0}
                leading={<Person initial={myProfile ? personInitial(myProfile) : t.nv.parta.you.slice(0, 1)} />}
                title={t.nv.parta.you}
                titleWeight={700}
                sub={!visible ? t.nv.parta.invisible : me ? t.nv.parta.visibleAt(me.pubName) : t.nv.parta.visibleNotOut}
                onPress={
                  me && visible && me.lat != null
                    ? () =>
                        dialog({
                          title: t.nv.parta.callTitle,
                          body: t.nv.parta.callBody(me.pubName),
                          actions: [{ label: t.nv.parta.back }, { label: t.nv.parta.call, kind: 'primary', onPress: callParty }],
                        })
                    : undefined
                }
                trailing={<Toggle value={visible} onChange={setVisible} />}
              />
              {presence.map((p, i) => (
                <LiveRow key={p.account.id} profile={p.account} last={i === presence.length - 1 && homePresence.length === 0} sub={t.nv.parta.liveSub(p.pubName, p.beers)} />
              ))}
              {homePresence.map((p, i) => (
                <LiveRow key={p.account.id} profile={p.account} last={i === homePresence.length - 1} sub={t.nv.parta.atSomeonesHome} />
              ))}
            </Card>
            {dashboard.incomingRequests.map((req) => (
              <View key={req.id} style={{ paddingHorizontal: 16, borderRadius: 24, borderWidth: 1, borderColor: C.hairline }}>
                <Row
                  last
                  leading={<Person initial={personInitial(req.requester)} ring={false} />}
                  title={t.nv.parta.wantsIn(personName(req.requester))}
                  titleWeight={700}
                  sub={req.requester.nickname ? `@${req.requester.nickname}` : undefined}
                  trailing={
                    <View style={[s.row, { gap: 8 }]}>
                      <IconButton icon="x" size={36} iconSize={16} label={t.nv.parta.decline} onPress={() => answerRequest(req.id, personName(req.requester), 'decline')} />
                      <IconButton
                        icon="check"
                        size={36}
                        iconSize={16}
                        bg={C.white}
                        color={C.black}
                        label={t.nv.parta.accept}
                        onPress={() => answerRequest(req.id, personName(req.requester), 'accept')}
                      />
                    </View>
                  }
                />
              </View>
            ))}
            {friends.length === 0 || rest.length ? (
              <>
                <SectionTitle
                  title={t.nv.parta.wholeParty}
                  action={String(friends.length)}
                  onAction={() => {
                    trackUiInteraction('friends_manage_open');
                    router.push('/nv/sprava-party');
                  }}
                />
                <Card>
                  {friends.length === 0 ? (
                    <Row last leading={<Tile icon="user-plus" />} title={t.nv.parta.inviteFirst} chevron onPress={() => router.push('/nv/sprava-party')} />
                  ) : (
                    rest.map((f, i, arr) => {
                      const stats = dashboard.friendStats[f.id];
                      return (
                        <Row
                          key={f.id}
                          last={i === arr.length - 1}
                          leading={<Person initial={personInitial(f)} />}
                          title={personName(f)}
                          sub={lastTogetherLabel(stats?.lastSharedAt ?? null, stats?.lastPubName ?? '')}
                          chevron
                          onPress={() => openFriend(f.id)}
                        />
                      );
                    })
                  )}
                </Card>
              </>
            ) : null}
          </Animated.View>
        ) : failed && plans !== null ? (
          // Without plans the invitations card above already says the load failed.
          <StatusCard text={t.nv.parta.loadFailed} action={t.nv.parta.retry} onAction={() => void load()} />
        ) : null}
        {/* Waits for the first load, so it doesn't show up under the loading card and then jump down. */}
        {dashboard || failed ? (
          <Animated.View entering={fadeIn}>
            <Card>
              <Row
                last
                height={72}
                leading={<Tile icon="house" size={46} radius={14} />}
                title={t.nv.parta.homeMeetups}
                titleWeight={700}
                sub={t.nv.parta.homeMeetupsSub}
                chevron
                onPress={() => router.push('/nv/pivo-u-nekoho')}
              />
            </Card>
          </Animated.View>
        ) : null}
      </ScrollView>
      <BottomFade height={tabSpace + 40} />
    </View>
  );
}
