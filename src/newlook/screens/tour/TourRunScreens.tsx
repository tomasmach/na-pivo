import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useIsFocused, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { nvBack } from '@/newlook/navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadPartyFriends, type FriendProfile, type PartyFriends } from '@/data/friendsClient';
import { DAY_KEYS } from '@/data/communityHours';
import { beerCountLabel, intlLocale, t } from '@/i18n';
import { selectIsSignedIn, selectNickname, useAccountStore } from '@/stores/accountStore';
import { useTallyStore } from '@/stores/tallyStore';
import { useToursStore } from '@/stores/toursStore';
import { useActiveTourRun } from '@/tours/activeRun';
import { beersAtStop } from '@/tours/counterLink';
import { loadLastPing, pingStop, saveLastPing, sendPing } from '@/tours/crewPing';
import { upcomingPlan } from '@/tours/glance';
import { runPosition, type TourPlan, type TourRun, type TourStop } from '@/tours/model';
import { formatWalkDistance, planDay, useTourStopFacts, walkingLeg } from '@/tours/stopFacts';
import { tourError } from '@/tours/TourChrome';
import { crewLink, going, inviting, type CrewPingState } from '@/tours/TourCrew';
import { inviteDetail } from '@/tours/TourInviteSheet';
import { inviteFriends, shareTourLink } from '@/tours/tourInvites';
import { fetchTourRoster, type TourInviteRow } from '@/data/tourInvitesClient';

import { BackHeader, Glass, GlassButton, Screen } from '../../components/chrome';
import { PageTitle } from '../../components/forms';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/overlays';
import { Button, Card, D, IconButton, Kicker, Person, Press, Row, Spinner, Stack, T } from '../../components/ui';
import { useNvRouter } from '../../duo/details';
import { dialog, toast } from '../../ui/store';
import { C, SCREEN_X, s } from '../../theme';
import { openEditor, planHref, RosterStub, useRoster } from './TourListScreen';
import { StopHours, StopRail, StopSquare, TourMap } from './TourParts';
import { factsLines, logBeerAtStop, markRunStop, navigateToStop, nextStopIndex, openStopPub, planSummary, stopStates, useLastMark, whenText, type FactsLine } from './tourView';

const initial = (name: string | null | undefined) => (name || '?').charAt(0).toUpperCase();
const navigationFailed = () => toast({ kind: 'error', title: t.tours.errors.navigation });

function useSignedInWithNickname() {
  return useAccountStore((st) => selectIsSignedIn(st) && !!selectNickname(st));
}

/** Beers counted at each stop during a run, from the counter's sittings. */
function useRunBeers(run: TourRun | null): Record<string, number> {
  const live = useTallyStore((st) => st.current);
  const past = useTallyStore((st) => st.history);
  return useMemo(() => {
    if (!run) return {};
    const sessions = live ? [live, ...past] : past;
    return Object.fromEntries(run.snapshot.stops.map((stop) => [stop.id, beersAtStop(stop, run, sessions)]));
  }, [run, live, past]);
}

function useFacts(stops: readonly TourStop[], scheduledDate: string | null, live: boolean): Record<string, FactsLine> {
  const facts = useTourStopFacts(stops);
  return useMemo(() => factsLines(stops, facts, scheduledDate, live), [stops, facts, scheduledDate, live]);
}

/** What a walk shares, and the "count me" switch when the walk has a party. */
export function showRunPrivacy(run: TourRun, live: boolean) {
  if (!run.crew) {
    dialog({ title: t.tours.privateRun, body: t.tours.runPrivacy, actions: [{ label: t.tours.close, kind: 'primary' }] });
    return;
  }
  const optedOut = !!run.crew.optOut;
  dialog({
    title: t.tours.crewPrivacyTitle,
    body: optedOut ? t.tours.crewPrivacyOptedOut : t.tours.crewPrivacyBody,
    actions: [
      { label: t.tours.close },
      ...(live || !optedOut
        ? [{ label: optedOut ? t.tours.crewOptIn : t.tours.crewOptOut, kind: 'primary' as const, onPress: () => void useToursStore.getState().setCrewOptOut(!optedOut, run.id) }]
        : []),
    ],
  });
}

function PrivacyLink({ onPress, style }: { onPress: () => void; style?: object }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" style={[s.row, { gap: 6 }, style]}>
      <Icon name="lock" size={13} color={C.muted} />
      <T s={13} c={C.muted}>
        {t.tours.crewPrivacyTitle}
      </T>
    </Press>
  );
}

export function TourRunScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const active = useActiveTourRun();
  const plans = useToursStore((st) => st.plans);
  const hydrated = useToursStore((st) => st.hydrated);
  const planId = id ?? active?.planId ?? upcomingPlan(plans)?.id;
  const plan = plans.find((p) => p.id === planId);
  if (active && active.planId === planId) return <LiveRun run={active} />;
  if (plan) return <PlanDetail plan={plan} />;
  return (
    <Screen header={<BackHeader />}>
      {hydrated ? (
        <T s={15} c={C.text2}>
          {t.tours.invalidLink}
        </T>
      ) : (
        <Spinner />
      )}
    </Screen>
  );
}

function PlanDetail({ plan }: { plan: TourPlan }) {
  const router = useRouter();
  const tx = t.nv.tour;
  const focused = useIsFocused();
  const eligible = useSignedInWithNickname();
  const busy = useToursStore((st) => st.busy);
  const roster = useRoster(plan);
  const facts = useFacts(plan.stops, plan.scheduledDate, false);
  const [starting, setStarting] = useState(false);
  const publication = plan.publication;
  const publicToken = publication?.status === 'active' ? publication.token : null;
  useEffect(() => {
    if (focused && publicToken) void useToursStore.getState().refreshPublicCount(plan.id);
  }, [focused, publicToken, plan.id]);

  async function go(endFirst: boolean) {
    setStarting(true);
    const store = useToursStore.getState();
    const ended = endFirst ? await store.endRun() : ({ ok: true } as const);
    const result = ended.ok ? await store.startRun(plan.id, { eligible }) : ended;
    setStarting(false);
    if (!result.ok) {
      toast({ kind: 'error', title: tourError(result.error) ?? t.tours.errors.storage });
      return;
    }
    toast({ kind: 'saved', title: tx.started, sub: tx.startedSub, icon: 'footprints' });
  }
  function start() {
    if (useToursStore.getState().activeRun) {
      dialog({
        title: t.tours.anotherRun,
        body: t.tours.anotherRunMessage,
        actions: [{ label: t.tours.cancel }, { label: t.tours.endAndStart, kind: 'primary', onPress: () => void go(true) }],
      });
    } else void go(false);
  }

  const when = whenText(plan);
  const publicLine =
    publication && publication.status !== 'unpublished'
      ? publication.status === 'hidden'
        ? t.tours.publicHiddenState
        : publication.peopleCount > 0
          ? t.tours.publicWithPeople(publication.peopleCount)
          : tx.publicNobody
      : null;
  return (
    <Screen
      header={<BackHeader actions={[{ icon: 'ellipsis', label: t.tours.more, onPress: () => router.push({ pathname: '/nv/tour-akce', params: { plan: plan.id } } as unknown as Href) }]} />}
      footer={
        <View style={{ gap: 10 }}>
          <Button label={t.tours.start} icon="footprints" height={56} disabled={starting || busy} onPress={start} />
          {!plan.source ? <Button label={t.tourInvites.invite} icon="user-plus" kind="raised" onPress={() => router.push({ pathname: '/nv/tour-pozvat', params: { id: plan.id } } as unknown as Href)} /> : null}
        </View>
      }
      gap={14}
    >
      <D s={44}>{plan.title}</D>
      <T s={15} c={C.text2} style={{ marginTop: -6 }}>
        {[when ?? t.tours.optional, planSummary(plan.stops)].join(' · ')}
      </T>
      {publicLine ? (
        <View style={[s.row, { gap: 8 }]}>
          <Icon name="globe" size={15} color={C.text2} />
          <T s={14} c={C.text2}>
            {publicLine}
          </T>
        </View>
      ) : null}
      {plan.conflict ? (
        <Card>
          <View style={{ gap: 10, paddingVertical: 12 }}>
            <T s={16} w={700}>
              {t.tours.conflict}
            </T>
            <T s={14} c={C.text2} lh={1.4}>
              {t.tours.conflictMessage}
            </T>
            <View style={[s.row, { gap: 10 }]}>
              <Button label={t.tours.useServer} kind="raised" flex onPress={() => void useToursStore.getState().chooseServerVersion(plan.id)} />
              <Button
                label={t.tours.keepBoth}
                kind="raised"
                flex
                onPress={() =>
                  void useToursStore.getState().copyLocalConflict(plan.id).then((r) => {
                    if (r.ok && r.id) router.replace(planHref(r.id));
                  })
                }
              />
            </View>
          </View>
        </Card>
      ) : null}
      {!plan.source ? (
        <Card>
          <RosterStub roster={roster} onPress={() => router.push({ pathname: '/nv/tour-pozvat', params: { id: plan.id } } as unknown as Href)} />
        </Card>
      ) : null}
      <TourMap stops={plan.stops} height={100} planning onExpand={() => router.push({ pathname: '/nv/tour-mapa', params: { id: plan.id } } as unknown as Href)} />
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <T s={17} w={700}>
          {t.tours.stops}
        </T>
        {!plan.source ? (
          <Press onPress={() => void openEditor(router, plan.id)} hitSlop={8}>
            <T s={15} w={600} c={C.yellow}>
              {t.tours.edit}
            </T>
          </Press>
        ) : null}
      </View>
      <StopRail
        stops={plan.stops}
        planning
        meetTime={plan.scheduledTime}
        facts={facts}
        onStop={(stop) => router.push({ pathname: '/nv/tour-zastavka', params: { stop: stop.id, plan: plan.id } } as unknown as Href)}
      />
    </Screen>
  );
}

function PartyBar({ run }: { run: TourRun }) {
  const router = useRouter();
  const crew = run.crew && !run.crew.refused ? run.crew : undefined;
  const members = crew ? going(crew) : [];
  const left = crew ? (crew.members ?? []).filter((member) => member.left) : [];
  const qr = inviting(run.crew);
  const allDone = run.snapshot.stops.every((stop) => run.statuses[stop.id]);
  const note = run.crew?.refused
    ? run.crew.organizer
      ? t.tours.crewRefusedOrganizer
      : t.tours.crewRefused
    : !allDone && left.length
      ? t.tours.crewLeftMember(left.map((member) => member.nickname))
      : crew?.closed && !crew.organizer
        ? t.tours.crewClosed
        : null;
  return (
    <View style={{ padding: 14, gap: 8, borderRadius: 22, backgroundColor: C.card }}>
      <View style={[s.row, { gap: 12 }]}>
        {members.length > 1 ? <Stack initials={members.slice(0, 4).map((member) => initial(member.nickname))} /> : <Person initial={initial(members[0]?.nickname ?? useAccountStore.getState().profile?.nickname)} size={32} ring={false} />}
        <T s={16} w={700} style={s.fill}>
          {members.length > 1 ? t.tours.crewGoing(members.length) : t.tours.crewAlone}
        </T>
        <Press
          onPress={() => router.push(qr ? '/nv/tour-prizvat' : '/nv/tour-cinknout')}
          style={[s.row, { height: 36, borderRadius: 18, paddingHorizontal: 12, gap: 6, backgroundColor: C.control }]}
        >
          <Icon name={qr ? 'qr-code' : 'bell'} size={15} color={C.yellow} />
          <T s={14} w={700}>
            {qr ? (members.length > 1 ? t.tours.crewInviteMore : t.tours.crewInvite) : t.tours.crewPingShort}
          </T>
        </Press>
      </View>
      {note ? (
        <T s={13} c={C.muted}>
          {note}
        </T>
      ) : null}
    </View>
  );
}

/** The whole run on one screen; Štamgast's Tour segment shows the same content. */
export function TourRunContent({ embedded }: { embedded?: boolean }) {
  const router = useRouter();
  const focused = useIsFocused();
  const run = useActiveTourRun();
  const beers = useRunBeers(run);
  const facts = useFacts(run?.snapshot.stops ?? [], null, true);
  const hasCrew = !!run?.crew;
  // Back on the run, see who joined or left meanwhile.
  useEffect(() => {
    if (focused && hasCrew) void useToursStore.getState().refreshCrew();
  }, [focused, hasCrew]);
  if (!run) return null;
  const stops = run.snapshot.stops;
  const states = stopStates(stops, run.statuses);
  const next = nextStopIndex(states);
  const done = states.filter((x) => x !== 'todo').length;
  const allDone = next < 0;
  const visited = states.filter((x) => x === 'visited').length;
  const since = new Date(run.startedAt).toLocaleTimeString(intlLocale, { hour: 'numeric', minute: '2-digit' });
  const crewStatus = run.crew?.completion === 'sent' && run.crew.counted ? t.tours.crewCounted : run.crew?.completion === 'pending' ? t.tours.crewPending : null;
  return (
    <View style={{ gap: 16 }}>
      {embedded ? (
        <View style={[s.row, { justifyContent: 'space-between', gap: 10 }]}>
          <D s={30} style={s.fill} numberOfLines={1}>
            {run.snapshot.title}
          </D>
          <View style={[s.row, { gap: 8 }]}>
            <IconButton icon="map" size={40} iconSize={18} onPress={() => router.push('/nv/tour-mapa')} label={t.tours.map} />
            <IconButton icon="ellipsis" size={40} iconSize={18} onPress={() => router.push('/nv/tour-ukoncit')} label={t.tours.more} />
          </View>
        </View>
      ) : null}
      <View style={[s.row, { gap: 12 }]}>
        <D s={64} lh={0.9} c={C.yellow}>
          {String(allDone ? visited : Math.max(done, 1))}
        </D>
        <View style={{ gap: 2 }}>
          <T s={17} w={800}>
            {t.nv.tour.ofPubs(stops.length)}
          </T>
          <T s={14} c={C.text2}>
            {allDone ? t.tours.allDone : t.tours.onTheWaySince(since)}
          </T>
        </View>
      </View>
      <PartyBar run={run} />
      {allDone && crewStatus ? (
        <View style={[s.row, { gap: 8, marginTop: -8, paddingHorizontal: 4 }]}>
          <Icon name="circle-check" size={14} color={C.muted} />
          <T s={13} c={C.muted} style={s.fill}>
            {crewStatus}
          </T>
        </View>
      ) : (
        <PrivacyLink onPress={() => showRunPrivacy(run, true)} style={{ marginTop: -6, paddingHorizontal: 4 }} />
      )}
      <StopRail
        stops={stops}
        states={states}
        next={next}
        beers={beers}
        facts={facts}
        onStop={(stop) => router.push({ pathname: '/nv/tour-zastavka', params: { stop: stop.id } } as unknown as Href)}
      />
    </View>
  );
}

function LiveRun({ run }: { run: TourRun }) {
  const router = useNvRouter();
  const insets = useSafeAreaInsets();
  const mark = useLastMark((st) => st.mark);
  const stops = run.snapshot.stops;
  const { next, nextIndex, here } = runPosition(run);
  const undo = mark && mark.runId === run.id && (run.statuses[mark.stopId] ?? null) === mark.status ? mark : null;
  const undoStop = undo ? stops.find((stop) => stop.id === undo.stopId) : undefined;
  const leg = here && next ? walkingLeg(here, next) : null;
  return (
    <Screen
      header={
        <BackHeader
          right={
            <>
              <IconButton icon="map" size={40} iconSize={18} label={t.tours.map} onPress={() => router.push({ pathname: '/nv/tour-mapa', params: { id: run.planId } } as unknown as Href)} />
              <IconButton icon="ellipsis" size={40} iconSize={18} label={t.tours.crewPing} onPress={() => router.push('/nv/tour-cinknout')} />
            </>
          }
        />
      }
      footer={
        !next ? (
          <Button label={t.tours.end} icon="flag" onPress={() => router.push('/nv/tour-ukoncit')} />
        ) : (
          <View style={{ gap: 10 }}>
            {undo && undoStop ? (
              <View style={[s.row, { padding: 12, paddingHorizontal: 16, borderRadius: 18, backgroundColor: C.toast, borderWidth: 1, borderColor: C.line, gap: 10 }]}>
                <Icon name="circle-check" size={18} />
                <View style={s.fill}>
                  <T s={14} w={700} numberOfLines={1}>
                    {undoStop.name}
                  </T>
                  <T s={12} c={C.muted}>
                    {undo.status ? t.tours[undo.status] : t.tours.undoMark}
                  </T>
                </View>
                <Press
                  onPress={() => {
                    useLastMark.setState({ mark: null });
                    void markRunStop(undo.stopId, undo.previous).then(() => useLastMark.setState({ mark: null }));
                  }}
                >
                  <T s={15} w={700} c={C.yellow}>
                    {t.tours.undo}
                  </T>
                </Press>
              </View>
            ) : null}
            <Button label={leg ? t.tours.navigateMinutes(leg.minutes) : t.tours.navigate} icon="navigation" onPress={() => navigateToStop(next, navigationFailed)} />
            <Button label={t.tours.logBeerAt(nextIndex + 1)} icon="beer" kind="raised" onPress={() => logBeerAtStop(router, next)} />
          </View>
        )
      }
      gap={6}
    >
      <Kicker>{t.tours.active}</Kicker>
      <D s={36}>{run.snapshot.title}</D>
      <View style={{ height: 10 }} />
      <TourRunContent />
      <View style={{ height: insets.bottom }} />
    </Screen>
  );
}

/** One stop: of the running tour, or of a plan (`plan`) before anyone walks it. */
export function TourStopSheet() {
  const router = useRouter();
  const { stop: stopId, plan: planId } = useLocalSearchParams<{ stop: string; plan?: string }>();
  const active = useActiveTourRun();
  const plan = useToursStore((st) => (planId ? st.plans.find((p) => p.id === planId) : undefined));
  const run = active && (!planId || active.planId === planId) ? active : null;
  const stops = run?.snapshot.stops ?? plan?.stops ?? [];
  const idx = stops.findIndex((st) => st.id === stopId);
  const stop = idx >= 0 ? stops[idx] : undefined;
  const one = useMemo(() => (stop ? [stop] : []), [stop]);
  const facts = useFacts(one, plan && !run ? plan.scheduledDate : null, !!run);
  if (!stop) return <Sheet title={t.tours.errors.unavailable} scroll={false}>{null}</Sheet>;
  const states = run ? stopStates(stops, run.statuses) : undefined;
  const status = run?.statuses[stop.id];
  const line = facts[stop.id];
  async function setStatus(next: 'visited' | 'skipped' | null) {
    if (await markRunStop(stop!.id, next)) nvBack(router);
  }
  return (
    <Sheet title={stop.name} scroll={false}>
      <View style={{ gap: 4, marginTop: -12 }}>
        <T s={15} c={C.text2}>
          {t.nv.tour.stopAt(idx + 1, stop.address)}
        </T>
        {line?.hours || line?.beers ? (
          <StopHours facts={line} />
        ) : (
          <T s={13} c={C.muted}>
            {t.tours.openingHoursUnknown}
          </T>
        )}
      </View>
      <TourMap stops={stops} height={110} states={states} next={idx} planning={!run} />
      {stop.challenge ? (
        <View style={{ padding: 16, gap: 6, borderRadius: 18, backgroundColor: C.card }}>
          <View style={[s.row, { gap: 6 }]}>
            <Icon name="flag" size={14} color={C.yellow} />
            <Kicker color={C.yellow}>{t.tours.challenge}</Kicker>
          </View>
          <T s={18} w={600}>
            {stop.challenge}
          </T>
        </View>
      ) : null}
      {run ? (
        <>
          <View style={[s.row, { gap: 8 }]}>
            <Icon name="lock" size={13} color={C.muted} />
            <T s={12} c={C.muted} style={s.fill}>
              {t.tours.runPrivacy}
            </T>
          </View>
          {status ? (
            <Button label={t.tours.undoMark} icon="undo-2" onPress={() => void setStatus(null)} />
          ) : (
            <Button label={t.tours.markVisited} icon="check" onPress={() => void setStatus('visited')} />
          )}
          <View style={[s.row, { gap: 10 }]}>
            {!status ? <Button label={t.nv.tour.skip} icon="skip-forward" kind="raised" flex onPress={() => void setStatus('skipped')} /> : null}
            <Button label={t.tours.navigate} icon="navigation" kind="raised" flex onPress={() => navigateToStop(stop, navigationFailed)} />
          </View>
        </>
      ) : (
        <Button label={t.tours.navigate} icon="navigation" kind="raised" onPress={() => navigateToStop(stop, navigationFailed)} />
      )}
      <Press onPress={() => openStopPub(router, stop, true)} style={[s.row, { justifyContent: 'center', gap: 4, paddingBottom: 4 }]}>
        <T s={15} w={700} c={C.text2}>
          {t.tours.fullPubDetail}
        </T>
        <Icon name="chevron-right" size={14} color={C.text2} />
      </Press>
    </Sheet>
  );
}

export function TourMapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tx = t.nv.tour;
  const { id, draft: ofDraft } = useLocalSearchParams<{ id?: string; draft?: string }>();
  const active = useActiveTourRun();
  const plan = useToursStore((st) => (id ? st.plans.find((p) => p.id === id) : undefined));
  const draft = useToursStore((st) => (ofDraft ? st.draft : null));
  const run = active && !ofDraft && (!id || active.planId === id) ? active : null;
  const stops = run?.snapshot.stops ?? plan?.stops ?? draft?.stops ?? [];
  const title = run?.snapshot.title ?? plan?.title ?? (draft?.title || t.tours.map);
  const states = run ? stopStates(stops, run.statuses) : undefined;
  const position = run ? runPosition(run) : null;
  const target = run ? position!.nextIndex : stops.length ? 0 : -1;
  const stop = target >= 0 ? stops[target] : undefined;
  const one = useMemo(() => (stop ? [stop] : []), [stop]);
  const rawFacts = useTourStopFacts(one);
  const from = run ? position!.here : undefined;
  const leg = from && stop ? walkingLeg(from, stop) : null;
  const { day } = planDay({ scheduledDate: run ? null : (plan?.scheduledDate ?? null) }, !!run);
  const intervals = stop ? rawFacts[stop.id]?.hours?.[DAY_KEYS[day]] : undefined;
  const until = intervals?.length ? intervals[intervals.length - 1][1] : null;
  const distance = leg ? formatWalkDistance(leg.meters).split(' ') : null;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TourMap stops={stops} height="100%" interactive states={states} next={run ? target : undefined} planning={!run} />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: insets.top + 110,
          experimental_backgroundImage: 'linear-gradient(180deg, #0A0A0AF5 0%, #0A0A0AB3 60%, #0A0A0A00 100%)',
        }}
      />
      <View style={[s.row, { position: 'absolute', top: insets.top + 3, left: SCREEN_X, right: SCREEN_X, gap: 10 }]}>
        <GlassButton icon="chevron-left" size={54} label={t.tours.back} onPress={() => nvBack(router)} />
        <Glass style={[s.fill, { height: 54, borderRadius: 27, paddingHorizontal: 18, justifyContent: 'center' }]}>
          <T s={15} w={700} numberOfLines={1}>
            {title}
          </T>
          <T s={12} c={C.muted} numberOfLines={1}>
            {tx.mapSub(Math.max(target, 0) + 1, stops.length)}
          </T>
        </Glass>
      </View>
      {stop ? (
        <View style={{ position: 'absolute', left: 12, right: 12, bottom: Math.max(insets.bottom, 12), backgroundColor: C.yellow, borderRadius: 26, padding: 16, paddingTop: 20, gap: 14 }}>
          <View style={[s.row, { justifyContent: 'space-between', gap: 10 }]}>
            <View style={[s.fill, { gap: 3 }]}>
              <T s={18} w={600} c={C.black} numberOfLines={1}>{`${target + 1}. ${stop.name}`}</T>
              <T s={13} c={C.onYellowMuted} numberOfLines={1}>
                {[until ? tx.until(until) : null, run ? t.tours.nextStop : t.tours.firstStop, leg ? tx.aboutMinutes(leg.minutes) : null].filter(Boolean).join(' · ')}
              </T>
            </View>
            {distance ? (
              <View style={[s.row, { alignItems: 'flex-end', gap: 3 }]}>
                <D s={24} c={C.black}>
                  {distance[0]}
                </D>
                <T s={14} w={600} c={C.onYellowMuted}>
                  {distance[1]}
                </T>
              </View>
            ) : null}
          </View>
          <View style={[s.row, { gap: 10 }]}>
            <Button label={t.tours.navigate} icon="navigation" kind="onYellow" height={46} flex onPress={() => navigateToStop(stop, navigationFailed)} />
            {run ? (
              <Button
                label={tx.mark}
                icon="check"
                kind="onYellowGhost"
                height={46}
                onPress={() => void markRunStop(stop.id, 'visited').then((ok) => { if (ok) nvBack(router); })}
              />
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function TourPrizvatSheet() {
  const router = useRouter();
  const tx = t.nv.tour;
  const run = useActiveTourRun();
  const crew = run?.crew;
  const hasCrew = !!crew && !crew.refused;
  useEffect(() => {
    if (hasCrew) void useToursStore.getState().refreshCrew();
  }, [hasCrew]);
  if (!run) return <Sheet title={t.tours.crewInvite} scroll={false}><T s={15} c={C.text2}>{tx.noRun}</T></Sheet>;
  const members = hasCrew ? going(crew!) : [];
  const target = pingStop(run);
  const together = members.length > 1;
  return (
    <Sheet title={t.tours.crewInvite} scroll={false}>
      {inviting(crew) ? (
        <>
          <View style={{ alignSelf: 'center', padding: 16, borderRadius: 24, backgroundColor: C.white }} accessible accessibilityRole="image" accessibilityLabel={t.tours.crewQrA11y}>
            <QRCode value={crewLink(crew!)} size={200} color={C.black} backgroundColor={C.white} />
          </View>
          <T s={14} c={C.text2} lh={1.4} style={{ textAlign: 'center' }}>
            {t.tours.crewSheetNote}
          </T>
        </>
      ) : (
        <T s={14} c={C.text2} lh={1.4}>
          {crew?.refused ? (crew.organizer ? t.tours.crewRefusedOrganizer : t.tours.crewRefused) : crew?.closed ? t.tours.crewClosed : tx.noCrewQr}
        </T>
      )}
      {members.length ? (
        <View style={[s.row, { justifyContent: 'center', gap: 8 }]}>
          <Stack initials={members.slice(0, 4).map((member) => initial(member.nickname))} />
          <T s={14} w={600} numberOfLines={2} style={{ flexShrink: 1 }}>
            {members.map((member) => `@${member.nickname}`).join(', ')}
          </T>
        </View>
      ) : null}
      {target ? (
        <>
          <View style={{ height: 1, backgroundColor: C.hairline }} />
          <T s={17} w={700}>
            {t.tours.crewPingAway}
          </T>
          <T s={14} c={C.muted} style={{ marginTop: -10 }}>
            {t.tours.crewPingNote(run.snapshot.title, target.stop.name, target.heading, together)}
          </T>
          <Button label={t.tours.crewPingThem} icon="bell" kind="raised" onPress={() => router.replace('/nv/tour-cinknout')} />
        </>
      ) : null}
      {inviting(crew) ? (
        <Press onPress={() => router.replace({ pathname: '/nv/tour-verejna', params: { token: crew!.token, r: crew!.runId } } as unknown as Href)} style={{ alignItems: 'center' }}>
          <T s={13} w={600} c={C.muted}>
            {tx.whatTheySee}
          </T>
        </Press>
      ) : null}
    </Sheet>
  );
}

export function CheckRow({ friend, sub, selected, disabled, last, onPress }: { friend: FriendProfile; sub: string; selected: boolean; disabled?: boolean; last: boolean; onPress: () => void }) {
  const name = friend.displayName || friend.nickname || '?';
  return (
    <Row
      last={last}
      leading={<Person initial={initial(name)} size={36} ring={false} />}
      title={name}
      titleWeight={700}
      titleColor={disabled ? C.muted : C.white}
      sub={sub}
      trailing={
        <View style={[{ width: 26, height: 26, borderRadius: 13, borderWidth: selected || disabled ? 0 : 1.5, borderColor: C.muted, backgroundColor: selected ? C.white : disabled ? C.control : 'transparent' }, s.center]}>
          {selected || disabled ? <Icon name="check" size={15} color={disabled ? C.muted : C.black} /> : null}
        </View>
      }
      onPress={disabled ? undefined : onPress}
    />
  );
}

export function useParty(): PartyFriends | null | undefined {
  const [party, setParty] = useState<PartyFriends | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const show = (next: PartyFriends | null) => { if (alive) setParty(next); };
    void loadPartyFriends(undefined, show).then(show);
    return () => { alive = false; };
  }, []);
  return party;
}

/** Ping friends where the walk is now; with `plan` and no walk of it yet, invite them to the plan instead. */
export function TourCinknoutSheet() {
  const { plan: planId } = useLocalSearchParams<{ plan?: string }>();
  const run = useActiveTourRun();
  const plan = useToursStore((st) => (planId ? st.plans.find((p) => p.id === planId) : undefined));
  if (plan && run?.planId !== plan.id) return <InviteFriends plan={plan} />;
  return <PingFriends run={run} />;
}

function PingFriends({ run }: { run: TourRun | null }) {
  const router = useRouter();
  const party = useParty();
  const [picked, setPicked] = useState<string[] | null>(null);
  const [sending, setSending] = useState(false);
  const [last, setLast] = useState<CrewPingState | null>(null);
  useEffect(() => { void loadLastPing().then(setLast); }, []);
  const target = run ? pingStop(run) : null;
  const crewIds = run?.crew && !run.crew.refused ? going(run.crew).map((member) => member.id) : [];
  const friends = party?.friends ?? [];
  const away = friends.filter((friend) => !crewIds.includes(friend.id));
  const chosen = (picked ?? away.map((friend) => friend.id)).filter((id) => away.some((friend) => friend.id === id));
  const already = last && run && target && last.runId === run.id && last.stopId === target.stop.id ? last.status : null;
  const quiet = !run || !target ? t.nv.tour.noRun : party === null ? t.tourInvites.friendsOffline : party?.ghost ? t.tours.crewPingGhost : party && !friends.length ? t.tourInvites.noFriends : party && !away.length ? t.tours.crewPingAllHere : null;

  const together = (r: TourRun) => !!r.crew && !r.crew.refused && going(r.crew).length > 1;
  async function send() {
    if (!run || !target || sending) return;
    setSending(true);
    // Everyone picked means the whole party, as the server reads a missing list.
    const ids = chosen.length === friends.length ? undefined : chosen;
    const result = await sendPing(run.snapshot.title, target, ids);
    setSending(false);
    if ('error' in result) {
      toast({ kind: 'error', title: result.error });
      return;
    }
    const state = { runId: run.id, stopId: target.stop.id, ...result };
    saveLastPing(state);
    nvBack(router);
    const names = away.filter((friend) => chosen.includes(friend.id)).map((friend) => friend.displayName || friend.nickname || '');
    toast(result.status === 'sent' ? { kind: 'saved', title: t.nv.tour.pinged, sub: t.nv.tour.pingedSub(names, together(run)), icon: 'bell-ring' } : { kind: 'info', title: t.tours.crewPingQueued, icon: 'bell' });
  }
  return (
    <Sheet title={t.tours.crewPing} scroll={false}>
      {run && target ? (
        <T s={14} c={C.text2} lh={1.4} style={{ marginTop: -10 }}>
          {t.tours.crewPingNote(run.snapshot.title, target.stop.name, target.heading, together(run))}
        </T>
      ) : null}
      {party === undefined ? <Spinner /> : null}
      {quiet ? (
        <T s={14} c={C.muted} lh={1.4}>
          {quiet}
        </T>
      ) : away.length ? (
        <Card>
          {away.map((friend, i) => {
            const selected = chosen.includes(friend.id);
            return (
              <CheckRow
                key={friend.id}
                friend={friend}
                sub={friend.nickname ? `@${friend.nickname}` : ''}
                selected={selected}
                last={i === away.length - 1}
                onPress={() => setPicked(selected ? chosen.filter((id) => id !== friend.id) : [...chosen, friend.id])}
              />
            );
          })}
        </Card>
      ) : null}
      {already ? (
        <T s={13} c={C.muted}>
          {already === 'sent' ? t.tours.crewPingSent : t.tours.crewPingQueued}
        </T>
      ) : null}
      <Button label={t.tours.crewPingShort} icon="bell" disabled={!!quiet || !chosen.length || sending || !!already} onPress={() => void send()} />
    </Sheet>
  );
}

function InviteFriends({ plan }: { plan: TourPlan }) {
  const router = useRouter();
  const tx = t.nv.tour;
  const party = useParty();
  const [roster, setRoster] = useState<TourInviteRow[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState<'invite' | 'link' | null>(null);
  const onServer = !plan.source && plan.revision > 0;
  useEffect(() => {
    if (!onServer) return;
    let alive = true;
    void fetchTourRoster(plan.id).then((result) => { if (alive && result.ok) setRoster(result.value); });
    return () => { alive = false; };
  }, [onServer, plan.id]);
  const friends = party?.friends ?? [];
  const stateOf = (id: string) => {
    const row = roster.find((item) => item.friend.id === id);
    return row ? (row.stale ? 'stale' : 'invited') : null;
  };
  const chosen = picked.filter((id) => friends.some((friend) => friend.id === id) && stateOf(id) !== 'invited');
  const note = party === null ? t.tourInvites.friendsOffline : party?.ghost ? t.tourInvites.ghost : party && !friends.length ? t.tourInvites.noFriends : null;

  async function invite() {
    setBusy('invite');
    const outcome = await inviteFriends(plan.id, chosen);
    setBusy(null);
    if ('error' in outcome) {
      toast({ kind: 'error', title: outcome.error });
      return;
    }
    nvBack(router);
    toast({ kind: 'saved', title: t.tourInvites.sent(outcome.invited), icon: 'user-plus' });
  }
  async function link() {
    setBusy('link');
    const error = await shareTourLink(plan.id);
    setBusy(null);
    if (error) toast({ kind: 'error', title: error });
  }
  return (
    <Sheet title={tx.sendInvite} scroll={false}>
      <T s={14} c={C.text2} lh={1.4} style={{ marginTop: -10 }}>
        {[plan.title, inviteDetail(plan)].filter(Boolean).join(' · ')}
      </T>
      {party === undefined ? <Spinner /> : null}
      {note ? (
        <T s={14} c={C.muted} lh={1.4}>
          {note}
        </T>
      ) : friends.length ? (
        <Card>
          {friends.map((friend, i) => {
            const state = stateOf(friend.id);
            const selected = chosen.includes(friend.id);
            return (
              <CheckRow
                key={friend.id}
                friend={friend}
                sub={state === 'invited' ? t.tourInvites.alreadyInvited : state === 'stale' ? t.tourInvites.linkChanged : friend.nickname ? `@${friend.nickname}` : ''}
                selected={selected}
                disabled={state === 'invited'}
                last={i === friends.length - 1}
                onPress={() => setPicked(selected ? picked.filter((id) => id !== friend.id) : [...picked, friend.id])}
              />
            );
          })}
        </Card>
      ) : null}
      {!note && friends.length ? <Button label={t.tourInvites.send(chosen.length)} icon="user-plus" disabled={!chosen.length || !!busy} onPress={() => void invite()} /> : null}
      <Press onPress={busy ? undefined : () => void link()} style={{ alignItems: 'center', paddingBottom: 4 }}>
        <T s={15} w={700} c={C.text2}>
          {busy === 'link' ? t.tours.loading : t.tourInvites.shareElsewhere}
        </T>
      </Press>
    </Sheet>
  );
}

export function TourUkoncitSheet() {
  const router = useRouter();
  const run = useActiveTourRun();
  const [busy, setBusy] = useState(false);
  if (!run) return <Sheet title={t.tours.endTitle} scroll={false}><T s={15} c={C.text2}>{t.nv.tour.noRun}</T></Sheet>;
  // Someone who walked their half is done, not walking out on the party.
  const leaving = !!run.crew && !run.crew.organizer && !run.crew.refused && !run.crew.completion;
  const organizer = !!run.crew?.organizer && !run.crew.refused;
  async function end() {
    setBusy(true);
    const result = await useToursStore.getState().endRun();
    setBusy(false);
    if (!result.ok) {
      toast({ kind: 'error', title: tourError(result.error) ?? t.tours.errors.storage });
      return;
    }
    useLastMark.setState({ mark: null });
    const ended = useToursStore.getState().runs[0];
    router.dismissAll();
    if (ended) router.push({ pathname: '/nv/tour-historie', params: { run: ended.id } } as unknown as Href);
  }
  return (
    <Sheet title={leaving ? t.tours.crewLeaveTitle : t.tours.endTitle} scroll={false}>
      <T s={16} c={C.text2} style={{ marginTop: -8 }}>
        {leaving ? t.tours.crewLeaveMessage : t.tours.endMessage}
      </T>
      {organizer ? (
        <View style={[s.row, { gap: 8 }]}>
          <Icon name="users" size={14} color={C.muted} />
          <T s={13} c={C.muted} style={s.fill}>
            {t.nv.tour.crewGoesOn}
          </T>
        </View>
      ) : null}
      <Button label={leaving ? t.tours.crewLeave : t.tours.end} icon="flag" disabled={busy} onPress={() => void end()} />
      <Press onPress={() => nvBack(router)} style={{ alignItems: 'center', paddingBottom: 4 }}>
        <T s={15} w={700} c={C.text2}>
          {t.tours.cancel}
        </T>
      </Press>
    </Sheet>
  );
}

export function TourHistoryScreen() {
  const router = useRouter();
  const { run: runId } = useLocalSearchParams<{ run?: string }>();
  const run = useToursStore((st) => st.runs.find((r) => r.id === runId) ?? (runId ? undefined : st.runs[0]));
  const planExists = useToursStore((st) => !!run && st.plans.some((p) => p.id === run.planId));
  const beers = useRunBeers(run ?? null);
  const [copying, setCopying] = useState(false);
  if (!run) {
    return (
      <Screen header={<BackHeader />}>
        <T s={15} c={C.text2}>
          {t.tours.errors.unavailable}
        </T>
      </Screen>
    );
  }
  const current = run;
  const stops = run.snapshot.stops;
  const states = stopStates(stops, run.statuses);
  const visited = states.filter((x) => x === 'visited').length;
  const crew = run.crew && !run.crew.refused ? going(run.crew) : [];
  async function copy() {
    setCopying(true);
    const store = useToursStore.getState();
    const copied = await store.copyPlan(current.planId, current.id);
    if (!copied.ok || !copied.id) {
      setCopying(false);
      if (!copied.ok) toast({ kind: 'error', title: tourError(copied.error) ?? t.tours.errors.storage });
      return;
    }
    const draft = await store.beginDraft(copied.id);
    setCopying(false);
    if (draft.ok) router.replace('/nv/tour-editor');
    else router.replace(planHref(copied.id));
    toast({ kind: 'saved', title: t.nv.tour.copyReady, icon: 'copy' });
  }
  return (
    <Screen
      header={<BackHeader actions={planExists ? [{ icon: 'ellipsis', label: t.tours.more, onPress: () => router.push({ pathname: '/nv/tour-akce', params: { plan: current.planId } } as unknown as Href) }] : undefined} />}
      footer={planExists ? <Button label={t.tours.repeat} icon="copy" disabled={copying} onPress={() => void copy()} /> : undefined}
      gap={12}
    >
      <PageTitle kicker={t.tours.run} title={run.snapshot.title} />
      <T s={15} c={C.text2}>{`${new Date(run.startedAt).toLocaleDateString(intlLocale)} · ${t.tours.progress(visited, stops.length)}`}</T>
      {run.crew && !run.crew.refused ? (
        <View style={[s.row, { gap: 8 }]}>
          {crew.length ? <Stack initials={crew.slice(0, 4).map((member) => initial(member.nickname))} /> : null}
          <T s={14} c={C.text2}>
            {t.tours.crewHistory(crew.length, !!run.crew.counted)}
          </T>
        </View>
      ) : null}
      <View style={[s.row, { justifyContent: 'space-between', marginTop: 10, paddingHorizontal: 4 }]}>
        <T s={17} w={700}>
          {t.tours.stops}
        </T>
        <T s={14} c={C.muted}>
          {t.tours.ended}
        </T>
      </View>
      <Card>
        {stops.map((stop, i) => {
          const state = states[i];
          const count = beers[stop.id] ?? 0;
          return (
            <Row
              key={stop.id}
              last={i === stops.length - 1}
              leading={<StopSquare i={i} state={state === 'todo' ? 'skipped' : state} next={false} />}
              title={stop.name}
              titleColor={state === 'visited' ? C.white : C.muted}
              sub={state === 'visited' ? [t.tours.visited, count ? beerCountLabel(count) : null].filter(Boolean).join(' · ') : state === 'skipped' ? t.tours.skipped : t.nv.tour.notVisited}
              chevron
              onPress={() => openStopPub(router, stop)}
            />
          );
        })}
      </Card>
      <PrivacyLink onPress={() => showRunPrivacy(current, false)} style={{ justifyContent: 'center' }} />
    </Screen>
  );
}
