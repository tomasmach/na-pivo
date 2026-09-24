import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, BackHandler, Pressable, ScrollView, Share, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter, useIsFocused, type Href } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Region } from 'react-native-maps';
import * as Clipboard from 'expo-clipboard';
import { CheckIcon, CompassIcon, EllipsisIcon, LockKeyholeIcon } from '@/components/shared/IconGlyph';
import { showAppDialog } from '@/components/shared/AppDialog';
import { MapPubSheet } from '@/components/amenities/MapPubSheet';
import { pubInfoFromPub } from '@/components/amenities/pubInfoContext';
import { geohash8 } from '@/data/geohash';
import { useToursStore, tourContentSignature } from '@/stores/toursStore';
import { openPubInMaps } from '@/utils/maps';
import { t, intlLocale } from '@/i18n';
import { Colors, withAlpha } from '@/theme/colors';
import { Radius, Spacing } from '@/theme/layout';
import { FontScaleCap } from '@/theme/fonts';
import { TourButton, TourError, TourHeader, TourText, pubCount, tourDate, ui } from './TourChrome';
import { TourMap } from './TourMap';
import { TourJourneyIllustration } from './TourJourneyIllustration';
import { TourHistoryRow, TourJourneyStop, TourLeg, TourMapPreview, type StopFactsLine } from './TourJourney';
import { formatWalkDistance, hoursOnDay, planDay, useTourStopFacts, walkingLeg } from './stopFacts';
import type { TourResult, TourStop } from './model';

export default function TourDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TourDetail key={id} id={id} />;
}
function TourDetail({ id }: { id: string }) {
  const focused = useIsFocused();
  const router = useRouter(); const insets = useSafeAreaInsets(); const dimensions = useWindowDimensions();
  const store = useToursStore();
  const [historyId, setHistoryId] = useState<string | null>(null);
  const active = store.activeRun?.planId === id ? store.activeRun : null;
  const history = store.runs.find((run) => run.id === historyId && run.planId === id);
  const run = history ?? active;
  const plan = store.plans.find((p) => p.id === id);
  const displayed = run?.snapshot ?? plan;
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<TourStop | null>(null); const [pubDetail, setPubDetail] = useState(false);
  const [largeMap, setLargeMap] = useState(false); const [shareMode, setShareMode] = useState(false);
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
  const [openedAt] = useState(() => Date.now());
  async function action(operation: () => Promise<TourResult>, after?: (result: { ok: true; id?: string }) => void) {
    if (actionLock.current) return;
    actionLock.current = true; setActing(true); setNotice(null);
    try { const result = await operation(); if (result.ok) after?.(result); }
    finally { actionLock.current = false; setActing(false); }
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
    showAppDialog({ title: t.tours.endTitle, message: t.tours.endMessage, buttons: [
      { text: t.tours.cancel, style: 'cancel' },
      { text: t.tours.end, onPress: () => { void action(() => store.endRun(), () => { setHistoryId(useToursStore.getState().runs[0]?.id ?? null); setUndo(null); }); } },
    ] });
  }
  function start() {
    if (store.activeRun) {
      showAppDialog({ title: t.tours.anotherRun, message: t.tours.anotherRunMessage, buttons: [
        { text: t.tours.cancel, style: 'cancel' },
        { text: t.tours.endAndStart, onPress: () => { void action(async () => { const ended = await store.endRun(); return ended.ok ? store.startRun(id) : ended; }, () => { setHistoryId(null); setUndo(null); }); } },
      ] });
    } else void action(() => store.startRun(id), () => { setHistoryId(null); setUndo(null); });
  }
  function more() {
    if (!plan) return;
    showAppDialog({ title: plan.title, buttons: [
      ...(!plan.source && !active ? [{ text: t.tours.edit, onPress: () => { void edit(); } }] : []),
      { text: t.tours.repeat, onPress: () => { void action(() => store.copyPlan(id, shareMode ? undefined : history?.id), (r) => { if (r.id) router.push({ pathname: '/tours/[id]', params: { id: r.id } } as Href); }); } },
      ...(plan.source ? [{ text: t.tours.checkUpdate, onPress: () => router.push(`/t/${plan.source!.token}` as Href) }] : [{ text: t.tours.share, onPress: () => setShareMode(true) }]),
      ...(active ? [{ text: t.tours.end, onPress: end }] : [{ text: t.tours.delete, style: 'destructive' as const, onPress: () => showAppDialog({ title: t.tours.deleteTitle, message: t.tours.deleteMessage, buttons: [
        { text: t.tours.cancel, style: 'cancel' }, { text: t.tours.delete, style: 'destructive', onPress: () => { void action(() => store.deletePlan(id), () => router.replace('/tours' as Href)); } },
      ] }) }]),
      { text: t.tours.cancel, style: 'cancel' },
    ] });
  }
  const next = active?.snapshot.stops.find((s) => !active.statuses[s.id]);
  const facts = useTourStopFacts(history && !shareMode ? [] : (shareMode ? plan : displayed)?.stops ?? []);

  if (!plan || !displayed) return <View style={[ui.screen, { paddingTop: insets.top }]}><TourHeader title={t.tours.title} onBack={() => router.replace('/tours' as Href)} /><TourError code={store.error} message={store.hydrated ? t.tours.invalidLink : t.tours.loading} /></View>;
  const current = shareMode ? plan : displayed;
  const localNewer = !!store.published[id] && store.published[id] !== tourContentSignature(plan);
  const expires = plan.share?.expiresAt ?? new Date(Math.max(openedAt + 30 * 86400000, plan.scheduledDate ? new Date(`${plan.scheduledDate}T12:00:00Z`).getTime() + 7 * 86400000 : 0)).toISOString();
  const shared = !!plan.share && new Date(plan.share.expiresAt).getTime() > openedAt;
  const runView = !shareMode && run ? run : null;
  const live = !!runView && !history;
  const stops = current.stops;
  const legs = stops.slice(1).map((stop, index) => walkingLeg(stops[index], stop));
  const nextIndex = live && next ? stops.findIndex((stop) => stop.id === next.id) : -1;
  // Skipped stops do not move the group; the last visited one before the next stop does.
  const hereStop = live ? stops.slice(0, next ? nextIndex : stops.length).reverse().find((stop) => runView?.statuses[stop.id] === 'visited') : undefined;
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
      if (status) return stop.id === hereId ? t.tours.youAreHere : t.tours[status];
      if (history) return t.tours.pending;
      return stop.id === next?.id ? [t.tours.nextStop, stop.address].filter(Boolean).join(' · ') : stop.address;
    }
    return index === 0 ? `${t.tours.firstStop}${current.scheduledTime ? ` ${current.scheduledTime}` : ''}${stop.address ? ` · ${stop.address}` : ''}` : stop.address;
  }
  const visitedCount = runView ? Object.values(runView.statuses).filter((s) => s === 'visited').length : 0;
  const editable = !shareMode && !run && !plan.source;
  const meta = runView
    ? [history ? new Date(runView.startedAt).toLocaleDateString(intlLocale) : t.tours.onTheWaySince(new Date(runView.startedAt).toLocaleTimeString(intlLocale, { hour: 'numeric', minute: '2-digit' })), t.tours.progress(visitedCount, stops.length)].join(' · ')
    : [current.scheduledDate ? tourDate(current) : editable ? null : t.tours.optional, t.tours.summary(pubCount(stops.length), formatWalkDistance(legs.reduce((sum, leg) => sum + leg.meters, 0)))].filter(Boolean).join(' · ');
  const closedOnMeetup = !runView && current.scheduledDate ? stops.filter((stop) => factsLine(stop, true)?.closed).map((stop) => stop.name) : [];
  return <View style={[ui.screen, { paddingTop: insets.top }]}>
    <View style={ui.grow} accessibilityElementsHidden={overlayVisible} importantForAccessibility={overlayVisible ? 'no-hide-descendants' : 'auto'}>
    <TourHeader title={shareMode ? t.tours.sharedPlan : run ? t.tours.run : t.tours.title} onBack={() => shareMode ? setShareMode(false) : history ? setHistoryId(null) : router.canGoBack() ? router.back() : router.replace('/tours' as Href)}
      right={<Pressable style={ui.iconButton} accessibilityRole="button" accessibilityLabel={t.tours.more} onPress={more}><EllipsisIcon color={Colors.foam} size={23} /></Pressable>} />
    <ScrollView ref={scroll} contentContainerStyle={styles.content}>
      <View><TourText maxFontSizeMultiplier={FontScaleCap.heading} style={styles.title}>{current.title}</TourText><TourText style={styles.date}>{meta}</TourText>
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
        {run && <Pressable accessibilityRole="button" accessibilityLabel={t.tours.privateRun} style={styles.privacy}
          onPress={() => showAppDialog({ title: t.tours.privateRun, message: t.tours.runPrivacy, buttons: [{ text: t.tours.close, style: 'cancel' }] })}>
          <LockKeyholeIcon size={13} color={Colors.mutedText} /><TourText style={styles.privacyText}>{t.tours.privateRun}</TourText>
        </Pressable>}
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
          : active ? <><TourButton label={next ? hereLeg ? t.tours.navigateMinutes(hereLeg.minutes) : t.tours.navigate : t.tours.end} icon={next ? <CompassIcon size={19} color={Colors.stout} /> : undefined} onPress={() => next ? navigate(next) : end()} />{next && <TourButton label={t.tours.arrivedAt(nextIndex + 1)} quiet icon={<CheckIcon size={17} color={Colors.foam} />} disabled={acting} onPress={() => mark(next, 'visited')} />}</>
            : <><TourButton label={t.tours.start} disabled={acting} onPress={start} />{!plan.source && <TourButton label={t.tours.share} quiet onPress={() => setShareMode(true)} />}</>}
    </View>
    </View>
    {overlayVisible && <View accessibilityViewIsModal style={[ui.screen, StyleSheet.absoluteFill, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <TourHeader title={detail?.name ?? t.tours.map} onBack={() => { setLargeMap(false); setDetail(null); }} />
        <ScrollView contentContainerStyle={[ui.content, { flexGrow: 1 }]}>
          <TourMap key={detail ? "stop-detail" : "overview"} stops={current.stops} selectedId={detail?.id ?? selected} onSelect={(stopId) => { setSelected(stopId); setDetail(current.stops.find((s) => s.id === stopId) ?? null); }} height={detail ? 160 : Math.max(240, dimensions.height - insets.top - insets.bottom - 150)} region={region} onRegionChange={setRegion} />
          {detail && <><TourText style={ui.heading}>{current.stops.findIndex((s) => s.id === detail.id) + 1}. {detail.name}</TourText><TourText>{detail.address}</TourText><TourText style={ui.notice}>{factsLine(detail, true)?.hours ?? t.tours.openingHoursUnknown}</TourText>
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
  privacy: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', minHeight: 44, gap: Spacing.xs },
  privacyText: { fontFamily: undefined, fontSize: 12, lineHeight: 18, color: Colors.mutedText },
  footer: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(Colors.foam, .1), backgroundColor: Colors.stout },
  undo: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingLeft: Spacing.md, paddingVertical: Spacing.xs, borderRadius: Radius.medium, backgroundColor: Colors.stout3, marginBottom: Spacing.sm },
  undoName: { fontFamily: undefined, fontWeight: '600', fontSize: 13, lineHeight: 18, color: Colors.foam },
  undoStatus: { fontFamily: undefined, fontSize: 12, lineHeight: 17, color: Colors.foamMuted },
});
