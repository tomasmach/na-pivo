import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, BackHandler, Pressable, ScrollView, Share, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter, useIsFocused, type Href } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Region } from 'react-native-maps';
import * as Clipboard from 'expo-clipboard';
import { EllipsisIcon } from '@/components/shared/IconGlyph';
import { showAppDialog } from '@/components/shared/AppDialog';
import { MapPubSheet } from '@/components/amenities/MapPubSheet';
import { pubInfoFromPub } from '@/components/amenities/pubInfoContext';
import { geohash8 } from '@/data/geohash';
import { useToursStore, tourContentSignature } from '@/stores/toursStore';
import { openPubInMaps } from '@/utils/maps';
import { t, intlLocale } from '@/i18n';
import { Colors } from '@/theme/colors';
import { Spacing } from '@/theme/layout';
import { TourButton, TourError, TourHeader, TourStopRow, TourText, stopCount, tourDate, ui } from './TourChrome';
import { TourMap } from './TourMap';
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
  const scroll = useRef<ScrollView>(null); const rowsY = useRef<Record<string, number>>({}); const listY = useRef(0);
  useEffect(() => { void useToursStore.getState().hydrate(); }, []);
  const [openedAt] = useState(() => Date.now());
  async function action(operation: () => Promise<TourResult>, after?: (result: { ok: true; id?: string }) => void) {
    if (actionLock.current) return;
    actionLock.current = true; setActing(true); setNotice(null);
    try { const result = await operation(); if (result.ok) after?.(result); }
    finally { actionLock.current = false; setActing(false); }
  }
  function select(stopId: string) { setSelected(stopId); const row = rowsY.current[stopId]; if (row !== undefined) scroll.current?.scrollTo({ y: Math.max(0, listY.current + row - 8), animated: true }); }
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
      { text: t.tours.repeat, onPress: () => { void action(() => store.copyPlan(id), (r) => { if (r.id) router.push({ pathname: '/tours/[id]', params: { id: r.id } } as Href); }); } },
      ...(plan.source ? [{ text: t.tours.checkUpdate, onPress: () => router.push(`/t/${plan.source!.token}` as Href) }] : [{ text: t.tours.share, onPress: () => setShareMode(true) }]),
      ...(active ? [{ text: t.tours.end, onPress: end }] : [{ text: t.tours.delete, style: 'destructive' as const, onPress: () => showAppDialog({ title: t.tours.deleteTitle, message: t.tours.deleteMessage, buttons: [
        { text: t.tours.cancel, style: 'cancel' }, { text: t.tours.delete, style: 'destructive', onPress: () => { void action(() => store.deletePlan(id), () => router.replace('/tours' as Href)); } },
      ] }) }]),
      { text: t.tours.cancel, style: 'cancel' },
    ] });
  }
  const next = active?.snapshot.stops.find((s) => !active.statuses[s.id]);

  if (!plan || !displayed) return <View style={[ui.screen, { paddingTop: insets.top }]}><TourHeader title={t.tours.title} onBack={() => router.replace('/tours' as Href)} /><TourError code={store.error} message={store.hydrated ? t.tours.invalidLink : t.tours.loading} /></View>;
  const current = shareMode ? plan : displayed;
  const localNewer = !!store.published[id] && store.published[id] !== tourContentSignature(plan);
  const expires = plan.share?.expiresAt ?? new Date(Math.max(openedAt + 30 * 86400000, plan.scheduledDate ? new Date(`${plan.scheduledDate}T12:00:00Z`).getTime() + 7 * 86400000 : 0)).toISOString();
  const shared = !!plan.share && new Date(plan.share.expiresAt).getTime() > openedAt;
  return <View style={[ui.screen, { paddingTop: insets.top }]}>
    <View style={ui.grow} accessibilityElementsHidden={overlayVisible} importantForAccessibility={overlayVisible ? 'no-hide-descendants' : 'auto'}>
    <TourHeader title={shareMode ? t.tours.sharedPlan : run ? t.tours.run : t.tours.title} onBack={() => shareMode ? setShareMode(false) : router.canGoBack() ? router.back() : router.replace('/tours' as Href)}
      right={<Pressable style={ui.iconButton} accessibilityRole="button" accessibilityLabel={t.tours.more} onPress={more}><EllipsisIcon color={Colors.foam} size={23} /></Pressable>} />
    <ScrollView ref={scroll} contentContainerStyle={ui.content}>
      <View><TourText style={ui.heading}>{current.title}</TourText><TourText style={ui.meta}>{tourDate(current)}</TourText></View>
      <TourError code={store.error} message={notice} />
      {plan.conflict && (<View style={{ gap: Spacing.md }}><TourText style={ui.section}>{t.tours.conflict}</TourText><TourText>{t.tours.conflictMessage}</TourText>
      <TourButton label={t.tours.useServer} secondary onPress={() => { void action(() => store.chooseServerVersion(plan.id)); }} />
      <TourButton label={t.tours.keepBoth} secondary onPress={() => { void action(() => store.copyLocalConflict(plan.id), (r) => { if (r.id) router.replace({ pathname: '/tours/[id]', params: { id: r.id } } as Href); }); }} />
    </View>)}
      {!shareMode && active && !history && <View><TourText style={ui.meta}>{next ? t.tours.nextStop : t.tours.allDone}</TourText>{next && <TourText style={ui.section}>{next.name}</TourText>}</View>}
      <TourMap stops={current.stops} selectedId={selected} onSelect={select} height={run ? 150 : 180} region={region} onRegionChange={setRegion} onExpand={() => setLargeMap(true)} />
      <View onLayout={(event) => { listY.current = event.nativeEvent.layout.y; }}>
        <View style={ui.row}><TourText style={ui.section}>{run && !shareMode ? `${Object.values(run.statuses).filter((s) => s === 'visited').length} / ${run.snapshot.stops.length} ${t.tours.visited.toLocaleLowerCase()}` : stopCount(current.stops.length)}</TourText>
          {!shareMode && !run && !plan.source && <Pressable onPress={() => { void edit(); }} style={ui.link} accessibilityRole="button" accessibilityLabel={t.tours.edit}><TourText style={ui.linkText}>{t.tours.edit}</TourText></Pressable>}
          {history && <TourText style={ui.meta}>{t.tours.ended}</TourText>}
        </View>
        {current.stops.map((stop, index) => <View key={stop.id} onLayout={(event) => { rowsY.current[stop.id] = event.nativeEvent.layout.y; }}>
          <TourStopRow stop={stop} index={index} selected={selected === stop.id} onPress={() => { setSelected(stop.id); setDetail(stop); }}
            status={!shareMode && run ? run.statuses[stop.id] ? t.tours[run.statuses[stop.id]] : stop.id === next?.id && !history ? t.tours.nextStop : t.tours.pending : index === 0 ? `${t.tours.firstStop}${current.scheduledTime ? ` ${current.scheduledTime}` : ''} · ${stop.address}` : undefined} />
        </View>)}
      </View>
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
        {undo && active && <View style={ui.row}><TourText style={ui.grow}>{active.snapshot.stops.find((stop) => stop.id === undo.id)?.name}</TourText><TourButton label={t.tours.undo} secondary onPress={() => { void action(() => store.markStop(undo.id, undo.status), () => setUndo(null)); }} /></View>}
        {run && <TourText style={ui.notice}>{t.tours.runPrivacy}</TourText>}
        {!run && plan.source && <TourButton label={t.tours.checkUpdate} secondary onPress={() => router.push(`/t/${plan.source!.token}` as Href)} />}
        {store.runs.filter((r) => r.planId === id).length > 0 && <View style={{ gap: Spacing.sm }}><TourText style={ui.section}>{t.tours.history}</TourText>
          {store.runs.filter((r) => r.planId === id).map((r) => <TourButton key={r.id} secondary label={`${new Date(r.startedAt).toLocaleDateString(intlLocale)} · ${Object.values(r.statuses).filter((s) => s === 'visited').length}/${r.snapshot.stops.length}`} onPress={() => { setHistoryId(r.id); setSelected(null); scroll.current?.scrollTo({ y: 0, animated: true }); }} />)}
        </View>}
      </>}
    </ScrollView>
    <View style={[ui.footer, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
      {shareMode ? ((!shared || localNewer || !!store.pending[id]) && <TourButton label={shared ? t.tours.publishChanges : t.tours.createLink} busy={acting || store.busy} onPress={() => { void action(() => store.publish(id)); }} />)
        : history ? <TourButton label={t.tours.repeat} onPress={() => { void action(() => store.copyPlan(id), (r) => { if (r.id) router.replace({ pathname: '/tours/[id]', params: { id: r.id } } as Href); }); }} />
          : active ? <><TourButton label={next ? t.tours.navigate : t.tours.end} onPress={() => next ? navigate(next) : end()} />{next && <TourButton label={t.tours.markVisited} secondary disabled={acting} onPress={() => mark(next, 'visited')} />}</>
            : <><TourButton label={t.tours.start} disabled={acting} onPress={start} />{!plan.source && <TourButton label={t.tours.share} secondary onPress={() => setShareMode(true)} />}</>}
    </View>
    </View>
    {overlayVisible && <View accessibilityViewIsModal style={[ui.screen, StyleSheet.absoluteFill, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <TourHeader title={detail?.name ?? t.tours.map} onBack={() => { setLargeMap(false); setDetail(null); }} />
        <ScrollView contentContainerStyle={[ui.content, { flexGrow: 1 }]}>
          <TourMap key={detail ? "stop-detail" : "overview"} stops={current.stops} selectedId={detail?.id ?? selected} onSelect={(stopId) => { setSelected(stopId); setDetail(current.stops.find((s) => s.id === stopId) ?? null); }} height={detail ? 160 : Math.max(240, dimensions.height - insets.top - insets.bottom - 150)} region={region} onRegionChange={setRegion} />
          {detail && <><TourText style={ui.heading}>{current.stops.findIndex((s) => s.id === detail.id) + 1}. {detail.name}</TourText><TourText>{detail.address}</TourText><TourText style={ui.notice}>{t.tours.openingHoursUnknown}</TourText>
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
