import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, BackHandler, Pressable, ScrollView, Share, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter, useIsFocused, type Href } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Region } from 'react-native-maps';
import * as Clipboard from 'expo-clipboard';
import { BeerIcon, CompassIcon, EllipsisIcon, GlobeIcon, LockKeyholeIcon } from '@/components/shared/IconGlyph';
import { showAppDialog } from '@/components/shared/AppDialog';
import { MapPubSheet } from '@/components/amenities/MapPubSheet';
import { pubInfoFromPub } from '@/components/amenities/pubInfoContext';
import { geohash8 } from '@/data/geohash';
import { useToursStore, tourContentSignature } from '@/stores/toursStore';
import { openPubInMaps } from '@/utils/maps';
import { beerCountLabel, t, intlLocale } from '@/i18n';
import { useCounterHandoffStore } from '@/stores/counterHandoffStore';
import { selectIsSignedIn, selectNickname, useAccountStore } from '@/stores/accountStore';
import { useTallyStore } from '@/stores/tallyStore';
import { beersAtStop, pubFromStop } from './counterLink';
import { Colors, withAlpha } from '@/theme/colors';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { FontScaleCap } from '@/theme/fonts';
import { TourButton, TourChallengeText, TourError, TourHeader, TourText, pubCount, tourDate, ui } from './TourChrome';
import { TourMap } from './TourMap';
import { TourCrewRow, TourCrewSheet, going, type CrewPingState, type CrewPingView } from './TourCrew';
import { pingRecipients, pingStop, sendPing } from './crewPing';
import { loadPartyFriends, type FriendProfile } from '@/data/friendsClient';
import { friendActivityState } from '@/data/friendsQueue';
import PingSheet from '@/friends/PingSheet';
import { TourJourneyIllustration } from './TourJourneyIllustration';
import { TourHistoryRow, TourJourneyStop, TourLeg, TourMapPreview, type StopFactsLine } from './TourJourney';
import { formatWalkDistance, hoursOnDay, planDay, useTourStopFacts, walkingDistance, walkingLeg } from './stopFacts';
import { runPosition, type TourResult, type TourStop } from './model';

export default function TourDetailScreen() {
  const { id, run } = useLocalSearchParams<{ id: string; run?: string }>();
  return <TourDetail key={id} id={id} initialRun={run} />;
}
function TourDetail({ id, initialRun }: { id: string; initialRun?: string }) {
  const focused = useIsFocused();
  const router = useRouter(); const insets = useSafeAreaInsets(); const dimensions = useWindowDimensions();
  const store = useToursStore();
  const [historyId, setHistoryId] = useState<string | null>(initialRun ?? null);
  const active = store.activeRun?.planId === id ? store.activeRun : null;
  const history = store.runs.find((run) => run.id === historyId && run.planId === id);
  const run = history ?? active;
  const plan = store.plans.find((p) => p.id === id);
  const displayed = run?.snapshot ?? plan;
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<TourStop | null>(null); const [pubDetail, setPubDetail] = useState(false);
  const [largeMap, setLargeMap] = useState(false); const [shareMode, setShareMode] = useState(false);
  const [crewSheet, setCrewSheet] = useState(false);
  const [friends, setFriends] = useState<{ friends: FriendProfile[]; ghost: boolean } | null>(null); const [ping, setPing] = useState<CrewPingState | null>(null);
  const [pingSheet, setPingSheet] = useState(false); const pingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only a signed-in walker with a nickname can be seen by a party and counted.
  const crewEligible = useAccountStore((s) => selectIsSignedIn(s) && !!selectNickname(s));
  const profile = useAccountStore((s) => s.profile);
  const crewSelf = useMemo(() => profile?.nickname ? { id: profile.id, nickname: profile.nickname, displayName: profile.displayName,
    avatarUrl: profile.avatarUrl, left: false, completed: false } : null, [profile]);
  const overlayVisible = largeMap || !!detail;
  usePreventRemove(overlayVisible, () => { setLargeMap(false); setDetail(null); });
  useEffect(() => {
    if (!focused || !overlayVisible) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      setLargeMap(false); setDetail(null);
      return true;
    });
    return () => listener.remove();
  }, [focused, overlayVisible]);
  const [region, setRegion] = useState<Region>();
  const [notice, setNotice] = useState<string | null>(null); const [undo, setUndo] = useState<{ id: string; status: 'visited' | 'skipped' | null } | null>(null);
  const [acting, setActing] = useState(false); const actionLock = useRef(false);
  const scroll = useRef<ScrollView>(null);
  useEffect(() => { void useToursStore.getState().hydrate(); }, []);
  // Back on the run, see who joined or left meanwhile.
  useEffect(() => { if (focused && useToursStore.getState().activeRun?.crew) void useToursStore.getState().refreshCrew(); }, [focused]);
  // Who could be pinged from the run, as the phone last saw the party.
  const walking = !!active && !history;
  useEffect(() => {
    if (!focused || !walking) return;
    let alive = true;
    void loadPartyFriends().then((next) => { if (alive) setFriends(next); });
    return () => { alive = false; };
  }, [focused, walking]);
  // A ping that waited for signal may have gone out since, or been dropped; only a delivered one says so.
  const waiting = ping?.status === 'queued' ? ping : null;
  useEffect(() => {
    if (!waiting || !focused) return;
    let alive = true;
    const check = () => void friendActivityState(waiting.clientId).then((state) => {
      // A newer ping may have replaced this one meanwhile; its state wins.
      if (alive && state !== 'queued') setPing(state === 'sent' ? { ...waiting, status: 'sent' } : null);
    });
    check();
    // The queue flushes when the app comes back to the front, which does not change focus.
    const foreground = AppState.addEventListener('change', (next) => { if (next === 'active') check(); });
    return () => { alive = false; foreground.remove(); };
  }, [waiting, focused, crewSheet, pingSheet]);
  // A ping sheet waiting for the crew sheet to leave must not open on another screen.
  useEffect(() => { if (!focused && pingTimer.current) { clearTimeout(pingTimer.current); pingTimer.current = null; } }, [focused]);
  useEffect(() => () => { if (pingTimer.current) clearTimeout(pingTimer.current); }, []);
  // In invisible mode a ping would reach nobody, so the row does not offer one.
  const canPing = !!friends?.friends.length && !friends.ghost;
  const publicToken = plan?.publication?.status === 'active' ? plan.publication.token : null;
  useEffect(() => { if (focused && publicToken) void useToursStore.getState().refreshPublicCount(id); }, [focused, publicToken, id]);
  const [openedAt] = useState(() => Date.now());
  async function action(operation: () => Promise<TourResult>, after?: (result: { ok: true; id?: string }) => void) {
    if (actionLock.current) return;
    actionLock.current = true; setActing(true); setNotice(null);
    try { const result = await operation(); if (result.ok) after?.(result); }
    finally { actionLock.current = false; setActing(false); }
  }
  // The counter checks the stop off once a beer is logged there.
  function logBeer(stop: TourStop) {
    useCounterHandoffStore.getState().handOff(pubFromStop(stop));
    // Back to the existing tabs, not a second copy of them on top of the tour.
    router.navigate('/(tabs)/beer' as Href);
  }
  function navigate(stop: TourStop) { void openPubInMaps({ lat: stop.lat, lng: stop.lon, name: stop.name }).catch(() => setNotice(t.tours.errors.navigation)); }
  function mark(stop: TourStop, status: 'visited' | 'skipped' | null) {
    const previous = active?.statuses[stop.id] ?? null;
    void action(() => store.markStop(stop.id, status), () => { setUndo({ id: stop.id, status: previous }); setDetail(null); setSelected(null); AccessibilityInfo.announceForAccessibility(status ? t.tours[status] : t.tours.undoMark); });
  }
  async function edit() {
    const result = await store.beginDraft(id);
    if (result.ok) router.push('/tours/edit' as Href);
    else if (result.error === 'busy') showAppDialog({ title: t.tours.continueDraft, buttons: [{ text: t.tours.continueDraft, onPress: () => router.push('/tours/edit' as Href) }, { text: t.tours.cancel, style: 'cancel' }] });
  }
  function end() {
    // Someone who walked their half is done, not walking out on the party.
    const leaving = !!active?.crew && !active.crew.organizer && !active.crew.refused && !active.crew.completion;
    showAppDialog({ title: leaving ? t.tours.crewLeaveTitle : t.tours.endTitle, message: leaving ? t.tours.crewLeaveMessage : t.tours.endMessage, buttons: [
      { text: t.tours.cancel, style: 'cancel' },
      { text: leaving ? t.tours.crewLeave : t.tours.end, onPress: () => { void action(() => store.endRun(), () => { setHistoryId(useToursStore.getState().runs[0]?.id ?? null); setUndo(null); }); } },
    ] });
  }
  function start() {
    if (store.activeRun) {
      showAppDialog({ title: t.tours.anotherRun, message: t.tours.anotherRunMessage, buttons: [
        { text: t.tours.cancel, style: 'cancel' },
        { text: t.tours.endAndStart, onPress: () => { void action(async () => { const ended = await store.endRun(); return ended.ok ? store.startRun(id, { eligible: crewEligible }) : ended; }, () => { setHistoryId(null); setUndo(null); }); } },
      ] });
    } else void action(() => store.startRun(id, { eligible: crewEligible }), () => { setHistoryId(null); setUndo(null); });
  }
  function more() {
    if (!plan) return;
    showAppDialog({ title: plan.title, buttons: [
      ...(!plan.source && !active ? [{ text: t.tours.edit, onPress: () => { void edit(); } }] : []),
      { text: t.tours.repeat, onPress: () => { void action(() => store.copyPlan(id, shareMode ? undefined : history?.id), (r) => { if (r.id) router.push({ pathname: '/tours/[id]', params: { id: r.id } } as Href); }); } },
      ...(plan.source ? [{ text: t.tours.checkUpdate, onPress: () => router.push(`/t/${plan.source!.token}` as Href) }] : [{ text: t.tours.share, onPress: () => setShareMode(true) }]),
      // A saved public tour is someone else's route until its pubs change; a hidden one waits for moderation.
      ...(!plan.source && !plan.publicSource && plan.publication?.status !== 'hidden' ? [
        { text: plan.publication?.status === 'active' ? t.tours.updatePublic : t.tours.publishPublic, onPress: () => router.push({ pathname: '/tours/publish', params: { id } } as Href) },
        ...(plan.publication?.status === 'active' ? [{ text: t.tours.sharePublic, onPress: () => { void Share.share({ message: plan.publication!.url }).catch(() => setNotice(t.tours.errors.unavailable)); } }] : []),
        ...(plan.publication?.status === 'active' ? [{ text: t.tours.unpublish, onPress: () => showAppDialog({ title: t.tours.unpublishTitle, message: t.tours.unpublishMessage, buttons: [
          { text: t.tours.cancel, style: 'cancel' }, { text: t.tours.unpublish, style: 'destructive', onPress: () => { void action(() => store.unpublishPublic(id)); } },
        ] }) }] : []),
      ] : []),
      ...(active ? [{ text: active.crew && !active.crew.organizer && !active.crew.refused && !active.crew.completion ? t.tours.crewLeave : t.tours.end, onPress: end }] : [{ text: t.tours.delete, style: 'destructive' as const, onPress: () => showAppDialog({ title: t.tours.deleteTitle, message: t.tours.deleteMessage, buttons: [
        { text: t.tours.cancel, style: 'cancel' }, { text: t.tours.delete, style: 'destructive', onPress: () => { void action(() => store.deletePlan(id), () => router.replace('/tours' as Href)); } },
      ] }) }]),
      { text: t.tours.cancel, style: 'cancel' },
    ] });
  }
  const next = active?.snapshot.stops.find((s) => !active.statuses[s.id]);
  const liveSession = useTallyStore((s) => s.current);
  const pastSessions = useTallyStore((s) => s.history);
  const sessions = liveSession ? [liveSession, ...pastSessions] : pastSessions;
  const facts = useTourStopFacts(history && !shareMode ? [] : (shareMode ? plan : displayed)?.stops ?? []);

  if (!plan || !displayed) return <View style={[ui.screen, { paddingTop: insets.top }]}><TourHeader title={t.tours.title} onBack={() => router.replace('/tours' as Href)} /><TourError code={store.error} message={store.hydrated ? t.tours.invalidLink : t.tours.loading} /></View>;
  const current = shareMode ? plan : displayed;
  const localNewer = !!store.published[id] && store.published[id] !== tourContentSignature(plan);
  const expires = plan.share?.expiresAt ?? new Date(Math.max(openedAt + 30 * 86400000, plan.scheduledDate ? new Date(`${plan.scheduledDate}T12:00:00Z`).getTime() + 7 * 86400000 : 0)).toISOString();
  const shared = !!plan.share && new Date(plan.share.expiresAt).getTime() > openedAt;
  const runView = !shareMode && run ? run : null;
  const live = !!runView && !history;
  // Pinging friends from the run: the pub they should head to, and who of the party is not at the table already.
  const pingTarget = active && !history ? pingStop(active) : null;
  const crewIds = active?.crew && !active.crew.refused ? going(active.crew).map((member) => member.id) : [];
  const awayFriends = friends ? friends.friends.filter((friend) => !crewIds.includes(friend.id)) : [];
  const pingDone = ping && active && pingTarget && ping.runId === active.id && ping.stopId === pingTarget.stop.id ? ping.status : null;
  const pingNote = pingTarget ? t.tours.crewPingNote(pingTarget.stop.name, pingTarget.heading, crewIds.length > 1) : '';
  const pingView: CrewPingView | null = pingTarget && friends?.friends.length
    ? { note: pingNote, state: friends.ghost ? 'ghost' : awayFriends.length === 0 ? 'allHere' : pingDone } : null;
  // The row offers a ping only while there is someone away to tell and this pub was not pinged yet.
  const rowPing = canPing && !!pingTarget && awayFriends.length > 0 && !pingDone;
  const rowPingStatus = pingDone === 'sent' ? t.tours.crewPingSent : pingDone === 'queued' ? t.tours.crewPingQueued
    : canPing && pingTarget && awayFriends.length === 0 ? t.tours.crewPingAllHere : null;
  // iOS will not present the ping sheet while the crew sheet is still leaving.
  function openPing() {
    if (!crewSheet) { setPingSheet(true); return; }
    setCrewSheet(false);
    if (pingTimer.current) clearTimeout(pingTimer.current);
    pingTimer.current = setTimeout(() => { pingTimer.current = null; setPingSheet(true); }, 300);
  }
  async function sendTourPing(recipientIds?: string[]): Promise<string | null> {
    if (!active || !pingTarget || !friends) return null;
    // "Everyone" here means everyone who is not walking along already.
    const ids = recipientIds ?? pingRecipients(friends.friends.map((friend) => friend.id), crewIds);
    const result = await sendPing(active.snapshot.title, pingTarget, ids);
    if ('error' in result) return result.error;
    setPing({ runId: active.id, stopId: pingTarget.stop.id, ...result });
    return null;
  }
  const stops = current.stops;
  const legs = stops.slice(1).map((stop, index) => walkingLeg(stops[index], stop));
  const position = live && runView ? runPosition(runView) : undefined;
  const nextIndex = position?.nextIndex ?? -1;
  const hereStop = position?.here;
  const hereId = hereStop?.id;
  const hereLeg = hereStop && next ? walkingLeg(hereStop, next) : undefined;
  // A running tour happens tonight; a plan is about its meetup day.
  const { day, today } = planDay({ scheduledDate: live ? null : current.scheduledDate }, live);
  const dayLabel = today ? t.tours.today : t.tours.onDay[day];
  function factsLine(stop: TourStop, withHours: boolean): StopFactsLine | undefined {
    const known = facts[stop.id];
    if (!known) return undefined;
    const intervals = withHours ? hoursOnDay(known.hours, day) : null;
    return {
      hours: intervals ? intervals.length ? `${dayLabel} ${intervals.join(', ')}` : t.tours.closedOn(dayLabel) : undefined,
      closed: !!intervals && !intervals.length,
      beers: known.beers.slice(0, 2).join(', ') || undefined,
    };
  }
  function caption(stop: TourStop, index: number) {
    if (runView) {
      const status = runView.statuses[stop.id];
      if (status) {
        const beers = status === 'visited' ? beersAtStop(stop, runView, sessions) : 0;
        return [stop.id === hereId ? t.tours.youAreHere : t.tours[status], beers ? beerCountLabel(beers) : null].filter(Boolean).join(' · ');
      }
      if (history) return t.tours.pending;
      return stop.id === next?.id ? [t.tours.nextStop, stop.address].filter(Boolean).join(' · ') : stop.address;
    }
    return index === 0 ? `${t.tours.firstStop}${current.scheduledTime ? ` ${current.scheduledTime}` : ''}${stop.address ? ` · ${stop.address}` : ''}` : stop.address;
  }
  const visitedCount = runView ? Object.values(runView.statuses).filter((s) => s === 'visited').length : 0;
  const editable = !shareMode && !run && !plan.source;
  const meta = runView
    ? [history ? new Date(runView.startedAt).toLocaleDateString(intlLocale) : t.tours.onTheWaySince(new Date(runView.startedAt).toLocaleTimeString(intlLocale, { hour: 'numeric', minute: '2-digit' })), t.tours.progress(visitedCount, stops.length)].join(' · ')
    : [current.scheduledDate ? tourDate(current) : editable ? null : t.tours.optional, t.tours.summary(pubCount(stops.length), formatWalkDistance(walkingDistance(stops)))].filter(Boolean).join(' · ');
  const closedOnMeetup = !runView && current.scheduledDate ? stops.filter((stop) => factsLine(stop, true)?.closed).map((stop) => stop.name) : [];
  return <View style={[ui.screen, { paddingTop: insets.top }]}>
    <View style={ui.grow} accessibilityElementsHidden={overlayVisible} importantForAccessibility={overlayVisible ? 'no-hide-descendants' : 'auto'}>
    <TourHeader title={shareMode ? t.tours.sharedPlan : run ? t.tours.run : t.tours.title} onBack={() => shareMode ? setShareMode(false) : history && history.id !== initialRun ? setHistoryId(null) : router.canGoBack() ? router.back() : router.replace('/tours' as Href)}
      right={<Pressable style={ui.iconButton} accessibilityRole="button" accessibilityLabel={t.tours.more} onPress={more}><EllipsisIcon color={Colors.foam} size={23} /></Pressable>} />
    <ScrollView ref={scroll} contentContainerStyle={styles.content}>
      <View><TourText maxFontSizeMultiplier={FontScaleCap.heading} style={styles.title}>{current.title}</TourText><TourText style={styles.date}>{meta}</TourText>
        {!shareMode && !history && plan.publication && plan.publication.status !== 'unpublished' && <Pressable style={styles.public}
          accessibilityRole={plan.publication.status === 'hidden' ? 'button' : 'text'} disabled={plan.publication.status !== 'hidden'}
          onPress={() => showAppDialog({ title: t.tours.publicHiddenState, message: t.tours.errors.publicHidden, buttons: [{ text: t.tours.close, style: 'cancel' }] })}>
          <GlobeIcon size={15} color={Colors.foam} />
          <TourText style={styles.publicText}>{plan.publication.status === 'hidden' ? t.tours.publicHiddenState
            : store.published[id] !== tourContentSignature(plan) || plan.revision > plan.publication.planRevision ? t.tours.publicNewer
              : plan.publication.peopleCount > 0 ? t.tours.publicWithPeople(plan.publication.peopleCount) : t.tours.publicState}</TourText>
        </Pressable>}
        {!shareMode && live && active && (active.crew || canPing) && <TourCrewRow crew={active.crew} self={crewSelf} ping={rowPing} pingStatus={rowPingStatus}
          onInvite={() => { if (pingTimer.current) { clearTimeout(pingTimer.current); pingTimer.current = null; } setCrewSheet(true); }} onPing={openPing} />}
        {editable && !current.scheduledDate && <Pressable onPress={() => { void edit(); }} style={styles.addMeetup} accessibilityRole="button" accessibilityLabel={t.tours.addMeetup}><TourText style={ui.linkText}>{t.tours.addMeetup}</TourText></Pressable>}
        {closedOnMeetup.length > 0 && <TourText style={styles.closed}>{t.tours.closedOnMeetup(closedOnMeetup.join(', '), closedOnMeetup.length)}</TourText>}</View>
      <TourJourneyIllustration stops={current.stops} statuses={!shareMode ? run?.statuses : undefined} nextStopId={!shareMode && active && !history ? next?.id : undefined} />
      <TourError code={store.error} message={notice} />
      {plan.conflict && (<View style={{ gap: Spacing.md }}><TourText style={ui.section}>{t.tours.conflict}</TourText><TourText>{t.tours.conflictMessage}</TourText>
      <TourButton label={t.tours.useServer} secondary onPress={() => { void action(() => store.chooseServerVersion(plan.id)); }} />
      <TourButton label={t.tours.keepBoth} secondary onPress={() => { void action(() => store.copyLocalConflict(plan.id), (r) => { if (r.id) router.replace({ pathname: '/tours/[id]', params: { id: r.id } } as Href); }); }} />
    </View>)}

      <View>
        <View style={[ui.row, styles.listHeading]}><TourText style={styles.section}>{t.tours.stops}</TourText>
          {editable && <Pressable onPress={() => { void edit(); }} style={ui.link} accessibilityRole="button" accessibilityLabel={t.tours.edit}><TourText style={ui.linkText}>{t.tours.edit}</TourText></Pressable>}
          {history && <TourText style={ui.meta}>{t.tours.ended}</TourText>}
        </View>
        {stops.map((stop, index) => <View key={stop.id}>
          {index > 0 && <TourLeg label={t.tours.walkLeg(formatWalkDistance(legs[index - 1].meters), legs[index - 1].minutes)} done={!!runView?.statuses[stop.id]} />}
          <TourJourneyStop stop={stop} index={index} count={stops.length} selected={selected === stop.id}
            next={live && stop.id === next?.id} status={runView?.statuses[stop.id]} here={stop.id === hereId}
            onPress={() => { setSelected(stop.id); setDetail(stop); }}
            caption={caption(stop, index)} facts={history ? undefined : factsLine(stop, !runView || !runView.statuses[stop.id])} />
        </View>)}
      </View>
      <TourMapPreview stops={current.stops} onPress={() => setLargeMap(true)} />
      {!shareMode && active && !history && !next && <TourText style={styles.section}>{t.tours.allDone}</TourText>}
      {shareMode ? <>
        <TourText style={ui.notice}>{t.tours.shareNotice}</TourText>
        <View><TourText style={ui.section}>{t.tours.expires}</TourText><TourText>{new Date(expires).toLocaleDateString(intlLocale)}</TourText></View>
        {localNewer && <TourText>{t.tours.unpublished}</TourText>}
        {shared && <>
          <TourButton label={t.tours.copyLink} secondary onPress={() => { void Clipboard.setStringAsync(plan.share!.url).then(() => setNotice(t.tours.copied)).catch(() => setNotice(t.tours.errors.unavailable)); }} />
          <TourButton label={t.tours.shareLink} secondary onPress={() => { void Share.share({ message: plan.share!.url }).catch(() => setNotice(t.tours.errors.unavailable)); }} />
          <TourButton label={t.tours.rotate} secondary onPress={() => showAppDialog({ title: t.tours.rotate, message: t.tours.rotateMessage, buttons: [
            { text: t.tours.cancel, style: 'cancel' }, { text: t.tours.rotate, onPress: () => { void action(() => store.publish(id, true)); } },
          ] })} />
          <TourButton label={t.tours.revoke} secondary onPress={() => showAppDialog({ title: t.tours.revokeTitle, message: t.tours.revokeMessage, buttons: [
            { text: t.tours.cancel, style: 'cancel' }, { text: t.tours.revoke, style: 'destructive', onPress: () => { void action(() => store.revoke(id), () => setNotice(t.tours.revoked)); } },
          ] })} />
        </>}
      </> : <>

        {!run && plan.source && <TourButton label={t.tours.checkUpdate} secondary onPress={() => router.push(`/t/${plan.source!.token}` as Href)} />}
        {store.runs.some((r) => r.planId === id) && <View>
          {store.runs.filter((r) => r.planId === id).map((r) => <TourHistoryRow key={r.id} run={r} selected={r.id === historyId} onPress={() => { setHistoryId(r.id); setSelected(null); scroll.current?.scrollTo({ y: 0, animated: true }); }} />)}
        </View>}
        {run && (run.crew ? <Pressable accessibilityRole="button" accessibilityLabel={t.tours.crewPrivacyTitle} style={styles.privacy}
          onPress={() => showAppDialog({ title: t.tours.crewPrivacyTitle, message: run.crew?.optOut ? t.tours.crewPrivacyOptedOut : t.tours.crewPrivacyBody, buttons: [
            ...(live ? [{ text: run.crew?.optOut ? t.tours.crewOptIn : t.tours.crewOptOut, onPress: () => { void store.setCrewOptOut(!run.crew?.optOut); } }] : []),
            { text: t.tours.close, style: 'cancel' as const },
          ] })}>
          <LockKeyholeIcon size={13} color={Colors.mutedText} /><TourText style={styles.privacyText}>{t.tours.crewPrivacyTitle}</TourText>
        </Pressable> : <Pressable accessibilityRole="button" accessibilityLabel={t.tours.privateRun} style={styles.privacy}
          onPress={() => showAppDialog({ title: t.tours.privateRun, message: t.tours.runPrivacy, buttons: [{ text: t.tours.close, style: 'cancel' }] })}>
          <LockKeyholeIcon size={13} color={Colors.mutedText} /><TourText style={styles.privacyText}>{t.tours.privateRun}</TourText>
        </Pressable>)}
      </>}
    </ScrollView>
    <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
      {undo && active && !history && !shareMode && <View style={styles.undo} accessibilityLiveRegion="polite">
        <View style={ui.grow}><TourText style={styles.undoName} numberOfLines={1}>{active.snapshot.stops.find((stop) => stop.id === undo.id)?.name}</TourText>
          <TourText style={styles.undoStatus}>{active.statuses[undo.id] ? t.tours[active.statuses[undo.id]] : t.tours.undoMark}</TourText></View>
        <Pressable accessibilityRole="button" accessibilityLabel={t.tours.undo} accessibilityState={{ disabled: acting }} disabled={acting} style={ui.link} onPress={() => { void action(() => store.markStop(undo.id, undo.status), () => setUndo(null)); }}><TourText style={ui.linkText}>{t.tours.undo}</TourText></Pressable>
      </View>}
      {shareMode ? ((!shared || localNewer || !!store.pending[id]) && <TourButton label={shared ? t.tours.publishChanges : t.tours.createLink} busy={acting || store.busy} onPress={() => { void action(() => store.publish(id)); }} />)
        : history ? <TourButton label={t.tours.repeat} onPress={() => { void action(() => store.copyPlan(id, history?.id), (r) => { if (r.id) router.replace({ pathname: '/tours/[id]', params: { id: r.id } } as Href); }); }} />
          : active ? <><TourButton label={next ? hereLeg ? t.tours.navigateMinutes(hereLeg.minutes) : t.tours.navigate : t.tours.end} icon={next ? <CompassIcon size={19} color={Colors.stout} /> : undefined} onPress={() => next ? navigate(next) : end()} />{next && <TourButton label={t.tours.logBeerAt(nextIndex + 1)} quiet icon={<BeerIcon size={17} color={Colors.foam} />} onPress={() => logBeer(next)} />}</>
            : <><TourButton label={t.tours.start} disabled={acting} onPress={start} />{!plan.source && <TourButton label={t.tours.share} quiet onPress={() => setShareMode(true)} />}</>}
    </View>
    </View>
    {crewSheet && active && <TourCrewSheet run={active} pingView={pingView} onPing={openPing} onClose={() => setCrewSheet(false)} />}
    {pingSheet && active && pingTarget && friends && <PingSheet title={t.tours.crewPing} detail={pingNote} friends={awayFriends} ghost={friends.ghost}
      onSend={sendTourPing} onClose={() => setPingSheet(false)} />}
    {overlayVisible && <View accessibilityViewIsModal style={[ui.screen, StyleSheet.absoluteFill, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <TourHeader title={detail?.name ?? t.tours.map} onBack={() => { setLargeMap(false); setDetail(null); }} />
        <ScrollView contentContainerStyle={[ui.content, { flexGrow: 1 }]}>
          <TourMap key={detail ? "stop-detail" : "overview"} stops={current.stops} selectedId={detail?.id ?? selected} onSelect={(stopId) => { setSelected(stopId); setDetail(current.stops.find((s) => s.id === stopId) ?? null); }} height={detail ? 160 : Math.max(240, dimensions.height - insets.top - insets.bottom - 150)} region={region} onRegionChange={setRegion} />
          {detail && <><TourText style={ui.heading}>{current.stops.findIndex((s) => s.id === detail.id) + 1}. {detail.name}</TourText><TourText>{detail.address}</TourText><TourText style={ui.notice}>{factsLine(detail, true)?.hours ?? t.tours.openingHoursUnknown}</TourText>{!!detail.challenge && <TourChallengeText text={detail.challenge} emphasized />}
            <TourButton label={t.tours.fullPubDetail} secondary onPress={() => setPubDetail(true)} />
            {!shareMode && active && !history && <><TourText style={ui.notice}>{t.tours.runPrivacy}</TourText>
              <TourButton label={active.statuses[detail.id] ? t.tours.undoMark : t.tours.markVisited} disabled={acting} onPress={() => mark(detail, active.statuses[detail.id] ? null : 'visited')} />
              {!active.statuses[detail.id] && <TourButton label={t.tours.skip} secondary disabled={acting} onPress={() => mark(detail, 'skipped')} />}
            </>}
            <TourButton label={t.tours.navigate} secondary onPress={() => navigate(detail)} />
          </>}
        </ScrollView>
        {detail && <MapPubSheet visible={pubDetail} pubKey={detail.cacheKey ?? geohash8(detail.lat, detail.lon)} pubName={detail.name}
          info={pubInfoFromPub({ id: detail.pubId, name: detail.name, address: detail.address, lat: detail.lat, lng: detail.lon })} onClose={() => setPubDetail(false)} />}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.md },
  title: { fontFamily: undefined, fontWeight: '800', fontSize: 30, lineHeight: 34, letterSpacing: -.7, color: Colors.foam },
  date: { fontFamily: undefined, fontSize: 12, lineHeight: 18, color: Colors.foamMuted, marginTop: Spacing.sm },
  listHeading: { minHeight: 28, flexWrap: 'wrap', marginBottom: Spacing.xs },
  section: { fontFamily: undefined, fontWeight: '600', fontSize: 14, lineHeight: 20, color: Colors.foam },
  addMeetup: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  closed: { fontFamily: undefined, fontSize: 12, lineHeight: 18, color: Colors.closed, marginTop: Spacing.xs },
  public: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs + 2, minHeight: HitArea.min, marginTop: Spacing.xs },
  publicText: { fontFamily: undefined, fontSize: 14, lineHeight: 20, fontWeight: '600', color: Colors.foam },
  privacy: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', minHeight: 44, gap: Spacing.xs },
  privacyText: { fontFamily: undefined, fontSize: 12, lineHeight: 18, color: Colors.mutedText },
  footer: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(Colors.foam, .1), backgroundColor: Colors.stout },
  undo: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingLeft: Spacing.md, paddingVertical: Spacing.xs, borderRadius: Radius.medium, backgroundColor: Colors.stout3, marginBottom: Spacing.sm },
  undoName: { fontFamily: undefined, fontWeight: '600', fontSize: 13, lineHeight: 18, color: Colors.foam },
  undoStatus: { fontFamily: undefined, fontSize: 12, lineHeight: 17, color: Colors.foamMuted },
});
