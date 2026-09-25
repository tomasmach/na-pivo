import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRightIcon, EllipsisIcon, UsersIcon } from '@/components/shared/IconGlyph';
import { showAppDialog } from '@/components/shared/AppDialog';
import { fetchSharedTour, fetchTourRunPreview, type PublicTourInfo, type TourRunPreview } from '@/data/toursClient';
import { tourBoundary } from '@/data/toursBoundary';
import { Avatar } from '@/profile/Avatar';
import { selectIsSignedIn, selectNickname, useAccountStore } from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';
import { useToursStore } from '@/stores/toursStore';
import { openPubInMaps } from '@/utils/maps';
import { t } from '@/i18n';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Spacing } from '@/theme/layout';
import { TourButton, TourError, TourHeader, TourStopRow, TourText, pubCount, stopCount, tourDate, ui } from './TourChrome';
import { TourMap } from './TourMap';
import { TourJourneyIllustration } from './TourJourneyIllustration';
import { TourJourneyStop, TourLeg } from './TourJourney';
import { formatWalkDistance, walkingLeg } from './stopFacts';
import type { TourPlan } from './model';

export default function TourInviteScreen() {
  const { token, r } = useLocalSearchParams<{ token: string; r?: string }>();
  const runId = typeof r === 'string' && /^[0-9a-f-]{36}$/i.test(r) ? r : undefined;
  return <TourInvite key={`${token}:${runId ?? ''}`} token={token} runId={runId} />;
}
function TourInvite({ token, runId }: { token: string; runId?: string }) {
  const router = useRouter(); const insets = useSafeAreaInsets(); const store = useToursStore();
  const [plan, setPlan] = useState<TourPlan | null>(null); const [error, setError] = useState<string | null>(null);
  const [publicInfo, setPublicInfo] = useState<PublicTourInfo | null>(null);
  const [preview, setPreview] = useState<TourRunPreview | null>(null);
  const signedIn = useAccountStore(selectIsSignedIn);
  const crewEligible = useAccountStore((s) => selectIsSignedIn(s) && !!selectNickname(s));
  const [loading, setLoading] = useState(true); const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const listY = useRef(0);
  const rowY = useRef<Record<string, number>>({});
  function select(id: string) {
    setSelected(id);
    if (rowY.current[id] !== undefined) scroll.current?.scrollTo({ y: Math.max(0, listY.current + rowY.current[id] - 8), animated: true });
  }
  useEffect(() => {
    let alive = true; const generation = tourBoundary().generation;
    void useToursStore.getState().hydrate();
    void fetchSharedTour(token).then((result) => {
      if (!alive) return;
      if (generation !== tourBoundary().generation) { setLoading(false); setError(t.tours.errors.session); return; }
      setLoading(false);
      if (result.ok) { setPlan(result.tour); setPublicInfo(result.public ?? null); } else setError(result.error === 'expired' ? t.tours.invalidLink : t.tours.errors.network);
    });
    // Who invites is a nicety; an unknown run may still wait in the organizer's offline queue.
    if (runId) void fetchTourRunPreview(runId).then((next) => { if (alive) setPreview(next); });
    return () => { alive = false; };
  }, [token, runId, retry]);
  const own = publicInfo ? store.plans.find((p) => p.publication?.token === token) : undefined;
  const existing = plan ? store.plans.find((p) => publicInfo ? p.publicSource?.publicId === publicInfo.id : p.source?.tourId === plan.id) : undefined;
  const update = !publicInfo && !!existing?.source && existing.source.revision < (plan?.revision ?? 0);
  const reported = !!publicInfo && (store.hiddenPublic ?? []).includes(publicInfo.id);
  const joining = !!runId && !!publicInfo && !own && !reported;
  async function join() {
    if (!runId) return;
    // The party knows each other by nickname, so a signed-in walker without one picks it first.
    if (!crewEligible) { router.push((signedIn ? '/profile/edit' : '/auth') as Href); return; }
    const go = async () => {
      const result = await store.joinCrew(token, runId);
      if (result.ok && result.id) router.replace({ pathname: '/tours/[id]', params: { id: result.id } } as Href);
    };
    if (store.activeRun) showAppDialog({ title: t.tours.crewActiveRun, message: t.tours.crewActiveRunMessage, buttons: [
      { text: t.tours.cancel, style: 'cancel' },
      { text: t.tours.crewEndAndJoin, onPress: () => { void store.endRun().then((ended) => { if (ended.ok) void go(); }); } },
    ] });
    else await go();
  }
  async function save() {
    if (own) { router.replace({ pathname: '/tours/[id]', params: { id: own.id } } as Href); return; }
    const result = publicInfo ? await store.savePublic(token) : await store.importShared(token, update);
    if (result.ok && result.id) router.replace({ pathname: '/tours/[id]', params: { id: result.id } } as Href);
  }
  function more() {
    if (!publicInfo) return;
    const info = publicInfo;
    showAppDialog({ title: plan?.title ?? t.tours.publicTour, buttons: [
      { text: t.tours.shareLink, onPress: () => { void Share.share({ message: `https://na-pivo.cz/t/${token}` }).catch(() => setError(t.tours.errors.unavailable)); } },
      ...(own ? [] : [{ text: t.tours.report, style: 'destructive' as const, onPress: () => showAppDialog({ title: t.tours.reportTitle, message: t.tours.reportMessage, buttons: [
        { text: t.tours.cancel, style: 'cancel' },
        { text: t.tours.report, style: 'destructive', onPress: () => { void store.reportPublic(info.id).then((r) => {
          useToastStore.getState().show(r.ok ? t.tours.reported : t.tours.reportFailed);
          if (!r.ok) return;
          if (router.canGoBack()) router.back(); else router.replace('/tours' as Href);
        }); } },
      ] }) }]),
      { text: t.tours.cancel, style: 'cancel' },
    ] });
  }
  const meta = plan ? publicInfo ? t.tours.publicMeta(publicInfo.city, pubCount(plan.stops.length), formatWalkDistance(publicInfo.walkM)) : tourDate(plan) : '';
  return <View style={[ui.screen, { paddingTop: insets.top }]}>
    <TourHeader title={publicInfo ? t.tours.publicTour : t.tours.invite} onBack={() => router.canGoBack() ? router.back() : router.replace('/tours' as Href)}
      right={publicInfo && !reported ? <Pressable style={ui.iconButton} accessibilityRole="button" accessibilityLabel={t.tours.more} onPress={more}><EllipsisIcon color={Colors.foam} size={23} /></Pressable> : undefined} />
    <ScrollView ref={scroll} contentContainerStyle={ui.content}>
      <TourError message={error} code={store.error} />
      {/* A reported tour is gone from this phone, not broken; say so plainly. */}
      {reported && <TourText style={styles.reported}>{t.tours.reported}</TourText>}
      {loading && <TourText>{t.tours.loading}</TourText>}
      {error && <TourButton label={t.tours.retry} secondary onPress={() => { setError(null); setLoading(true); setRetry((r) => r + 1); }} />}
      {plan && publicInfo && !reported && <>
        <View>
          <Text maxFontSizeMultiplier={FontScaleCap.heading} style={styles.title}>{plan.title}</Text><TourText style={styles.meta}>{meta}</TourText>
          <Pressable accessibilityRole="button" accessibilityLabel={t.tours.authorA11y(publicInfo.author.nickname)} style={({ pressed }) => [styles.author, pressed && styles.pressed]}
            onPress={() => router.push(`/parta/${publicInfo.author.id}` as Href)}>
            <Avatar uri={publicInfo.author.avatarUrl} nickname={publicInfo.author.nickname} displayName={publicInfo.author.displayName} size={32} />
            <View style={ui.grow}>
              <Text maxFontSizeMultiplier={FontScaleCap.heading} numberOfLines={1} style={styles.nickname}>@{publicInfo.author.nickname}</Text>
              {!!publicInfo.author.displayName && <Text maxFontSizeMultiplier={FontScaleCap.body} numberOfLines={1} style={styles.displayName}>{publicInfo.author.displayName}</Text>}
            </View>
            <ChevronRightIcon size={16} color={Colors.mutedText} />
          </Pressable>
          {/* Who invites matters more here than how many walked it before. */}
          {joining && preview ? <View style={styles.people}>
            <View style={styles.coins}>{(preview.members.length ? preview.members : [preview.organizer]).slice(0, 4).map((member, index) => <View key={member.id} style={[styles.coin, index > 0 && styles.coinOverlap]}>
              <Avatar uri={member.avatarUrl} nickname={member.nickname} displayName={member.displayName} size={28} /></View>)}</View>
            <TourText style={styles.invitedText}>{preview.going > 1 ? t.tours.crewAlreadyGoing(preview.organizer.nickname, preview.going - 1) : t.tours.crewInvitedBy(preview.organizer.nickname)}</TourText>
          </View> : <View style={styles.people}>
            <UsersIcon size={16} color={Colors.foam} />
            <TourText style={styles.peopleText}>{t.tours.peopleCount(publicInfo.peopleCount)}</TourText>
          </View>}
        </View>
        <TourJourneyIllustration stops={plan.stops} />
        <View>
          <TourText style={styles.section}>{t.tours.stops}</TourText>
          {plan.stops.map((stop, index) => <View key={stop.id}>
            {index > 0 && <TourLeg label={t.tours.walkLeg(formatWalkDistance(walkingLeg(plan.stops[index - 1], stop).meters), walkingLeg(plan.stops[index - 1], stop).minutes)} done={false} />}
            <TourJourneyStop stop={stop} index={index} count={plan.stops.length} next={false} selected={selected === stop.id}
              caption={stop.address} onPress={() => setSelected(stop.id === selected ? null : stop.id)} />
          </View>)}
        </View>
        <TourMap stops={plan.stops} height={180} selectedId={selected} onSelect={setSelected} />
        {selected && <TourButton label={t.tours.navigate} secondary onPress={() => { const stop = plan.stops.find((s) => s.id === selected); if (stop) void openPubInMaps({ lat: stop.lat, lng: stop.lon }).catch(() => setError(t.tours.errors.navigation)); }} />}
        <TourText style={ui.notice}>{joining ? t.tours.crewJoinPrivacy : t.tours.runPrivacy}</TourText>
      </>}
      {plan && !publicInfo && <>
        <View><TourText style={ui.heading}>{plan.title}</TourText><TourText style={ui.meta}>{meta}</TourText></View>
        <TourMap stops={plan.stops} height={180} selectedId={selected} onSelect={select} />
        <View onLayout={(event) => { listY.current = event.nativeEvent.layout.y; }}><TourText style={ui.section}>{stopCount(plan.stops.length)}</TourText>
          {plan.stops.map((stop, index) => <View key={stop.id} onLayout={(event) => { rowY.current[stop.id] = event.nativeEvent.layout.y; }}><TourStopRow stop={stop} index={index} selected={selected === stop.id} onPress={() => { setSelected(stop.id); }} /></View>)}
        </View>
        {selected && <TourButton label={t.tours.navigate} secondary onPress={() => { const stop = plan.stops.find((s) => s.id === selected); if (stop) void openPubInMaps({ lat: stop.lat, lng: stop.lon }).catch(() => setError(t.tours.errors.navigation)); }} />}
        {update && <View style={{ gap: Spacing.sm }}><TourText style={ui.section}>{t.tours.importUpdate}</TourText><TourText>{t.tours.updateMessage}</TourText>
          <TourText>{existing!.stops.map((s) => s.name).join(' → ')}</TourText><TourText>{plan.stops.map((s) => s.name).join(' → ')}</TourText>
          <TourText>{tourDate(existing!)} → {tourDate(plan)}</TourText>
          <TourButton label={t.tours.keepVersion} secondary onPress={() => router.replace({ pathname: '/tours/[id]', params: { id: existing!.id } } as Href)} />
        </View>}
        <TourText style={ui.notice}>{t.tours.runPrivacy}</TourText>
      </>}
    </ScrollView>
    {plan && <View style={[ui.footer, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
      {joining ? <TourButton testID="tour-crew-join" label={crewEligible ? t.tours.crewJoin : signedIn ? t.tours.pickNickname : t.tours.crewSignInJoin} busy={store.busy} onPress={() => { void join(); }} />
        : reported && !existing ? <TourButton label={t.tours.backToTours} quiet onPress={() => router.replace('/tours' as Href)} />
        : <TourButton label={own ? t.tours.open : update ? t.tours.update : existing ? t.tours.openSaved : t.tours.import} busy={store.busy} onPress={() => { void save(); }} />}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  title: { fontWeight: '800', fontSize: 30, lineHeight: 34, letterSpacing: -0.7, color: Colors.foam },
  meta: { fontFamily: undefined, fontSize: 12, lineHeight: 18, color: Colors.foamMuted, marginTop: Spacing.sm },
  section: { fontFamily: undefined, fontWeight: '600', fontSize: 14, lineHeight: 20, color: Colors.foam, marginBottom: Spacing.xs },
  reported: { fontSize: 15, lineHeight: 22, color: Colors.foam },
  people: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 32, marginTop: Spacing.xs },
  invitedText: { fontFamily: undefined, fontSize: 16, lineHeight: 22, fontWeight: '700', color: Colors.foam, flexShrink: 1 },
  peopleText: { fontFamily: undefined, fontSize: 14, lineHeight: 20, fontWeight: '600', color: Colors.foam, flexShrink: 1 },
  coins: { flexDirection: 'row' },
  coin: { borderWidth: 2, borderColor: Colors.stout, borderRadius: 999 },
  coinOverlap: { marginLeft: -8 },
  author: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm + 2, minHeight: HitArea.min, marginTop: Spacing.sm },
  pressed: { opacity: 0.65 },
  nickname: { fontSize: 16, lineHeight: 21, fontWeight: '600', color: Colors.foam },
  displayName: { fontSize: 12, lineHeight: 17, color: Colors.mutedText },
});
