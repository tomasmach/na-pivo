import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRightIcon, EllipsisIcon } from '@/components/shared/IconGlyph';
import { showAppDialog } from '@/components/shared/AppDialog';
import { fetchSharedTour, type PublicTourInfo } from '@/data/toursClient';
import { tourBoundary } from '@/data/toursBoundary';
import { Avatar } from '@/profile/Avatar';
import { useToursStore } from '@/stores/toursStore';
import { openPubInMaps } from '@/utils/maps';
import { t } from '@/i18n';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Spacing } from '@/theme/layout';
import { TourButton, TourError, TourHeader, TourStopRow, TourText, pubCount, stopCount, tourDate, ui } from './TourChrome';
import { TourMap } from './TourMap';
import { formatWalkDistance } from './stopFacts';
import type { TourPlan } from './model';

export default function TourInviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return <TourInvite key={token} token={token} />;
}
function TourInvite({ token }: { token: string }) {
  const router = useRouter(); const insets = useSafeAreaInsets(); const store = useToursStore();
  const [plan, setPlan] = useState<TourPlan | null>(null); const [error, setError] = useState<string | null>(null);
  const [publicInfo, setPublicInfo] = useState<PublicTourInfo | null>(null);
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
    return () => { alive = false; };
  }, [token, retry]);
  const own = publicInfo ? store.plans.find((p) => p.publication?.token === token) : undefined;
  const existing = plan ? store.plans.find((p) => publicInfo ? p.publicSource?.publicId === publicInfo.id : p.source?.tourId === plan.id) : undefined;
  const update = !publicInfo && !!existing?.source && existing.source.revision < (plan?.revision ?? 0);
  const reported = !!publicInfo && (store.hiddenPublic ?? []).includes(publicInfo.id);
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
        { text: t.tours.report, style: 'destructive', onPress: () => { void store.reportPublic(info.id).then((r) => { if (!r.ok) return; if (router.canGoBack()) router.back(); else router.replace('/tours' as Href); }); } },
      ] }) }]),
      { text: t.tours.cancel, style: 'cancel' },
    ] });
  }
  const meta = plan ? publicInfo ? t.tours.publicMeta(publicInfo.city, pubCount(plan.stops.length), formatWalkDistance(publicInfo.walkM)) : tourDate(plan) : '';
  return <View style={[ui.screen, { paddingTop: insets.top }]}>
    <TourHeader title={publicInfo ? t.tours.publicTour : t.tours.invite} onBack={() => router.canGoBack() ? router.back() : router.replace('/tours' as Href)}
      right={publicInfo ? <Pressable style={ui.iconButton} accessibilityRole="button" accessibilityLabel={t.tours.more} onPress={more}><EllipsisIcon color={Colors.foam} size={23} /></Pressable> : undefined} />
    <ScrollView ref={scroll} contentContainerStyle={ui.content}>
      <TourError message={reported ? t.tours.reported : error} code={store.error} />
      {loading && <TourText>{t.tours.loading}</TourText>}
      {error && <TourButton label={t.tours.retry} secondary onPress={() => { setError(null); setLoading(true); setRetry((r) => r + 1); }} />}
      {plan && !reported && <>
        <View><TourText style={ui.heading}>{plan.title}</TourText><TourText style={ui.meta}>{meta}</TourText>
          {publicInfo && <Pressable accessibilityRole="button" accessibilityLabel={t.tours.authorA11y(publicInfo.author.nickname)} style={({ pressed }) => [styles.author, pressed && styles.pressed]}
            onPress={() => router.push(`/parta/${publicInfo.author.id}` as Href)}>
            <Avatar uri={publicInfo.author.avatarUrl} nickname={publicInfo.author.nickname} displayName={publicInfo.author.displayName} size={32} />
            <View style={ui.grow}>
              <Text maxFontSizeMultiplier={FontScaleCap.heading} numberOfLines={1} style={styles.nickname}>@{publicInfo.author.nickname}</Text>
              {!!publicInfo.author.displayName && <Text maxFontSizeMultiplier={FontScaleCap.body} numberOfLines={1} style={styles.displayName}>{publicInfo.author.displayName}</Text>}
            </View>
            <ChevronRightIcon size={16} color={Colors.mutedText} />
          </Pressable>}
        </View>
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
    {plan && !reported && <View style={[ui.footer, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
      <TourButton label={own ? t.tours.open : update ? t.tours.update : existing ? t.tours.openSaved : t.tours.import} busy={store.busy} onPress={() => { void save(); }} />
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  author: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm + 2, minHeight: HitArea.min, marginTop: Spacing.sm },
  pressed: { opacity: 0.65 },
  nickname: { fontSize: 16, lineHeight: 21, fontWeight: '600', color: Colors.foam },
  displayName: { fontSize: 12, lineHeight: 17, color: Colors.mutedText },
});
