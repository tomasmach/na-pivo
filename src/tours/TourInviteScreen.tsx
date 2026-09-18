import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchSharedTour } from '@/data/toursClient';
import { tourBoundary } from '@/data/toursBoundary';
import { useToursStore } from '@/stores/toursStore';
import { openPubInMaps } from '@/utils/maps';
import { t } from '@/i18n';
import { Spacing } from '@/theme/layout';
import { TourButton, TourError, TourHeader, TourStopRow, TourText, stopCount, tourDate, ui } from './TourChrome';
import { TourMap } from './TourMap';
import type { TourPlan } from './model';

export default function TourInviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return <TourInvite key={token} token={token} />;
}
function TourInvite({ token }: { token: string }) {
  const router = useRouter(); const insets = useSafeAreaInsets(); const store = useToursStore();
  const [plan, setPlan] = useState<TourPlan | null>(null); const [error, setError] = useState<string | null>(null);
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
      if (result.ok) setPlan(result.tour); else setError(result.error === 'expired' ? t.tours.invalidLink : t.tours.errors.network);
    });
    return () => { alive = false; };
  }, [token, retry]);
  const existing = plan ? store.plans.find((p) => p.source?.tourId === plan.id) : undefined;
  const update = !!existing?.source && existing.source.revision < (plan?.revision ?? 0);
  async function save() {
    const result = await store.importShared(token, update);
    if (result.ok && result.id) router.replace({ pathname: '/tours/[id]', params: { id: result.id } } as Href);
  }
  return <View style={[ui.screen, { paddingTop: insets.top }]}>
    <TourHeader title={t.tours.invite} onBack={() => router.canGoBack() ? router.back() : router.replace('/tours' as Href)} />
    <ScrollView ref={scroll} contentContainerStyle={ui.content}>
      <TourError message={error} code={store.error} />
      {loading && <TourText>{t.tours.loading}</TourText>}
      {error && <TourButton label={t.tours.retry} secondary onPress={() => { setError(null); setLoading(true); setRetry((r) => r + 1); }} />}
      {plan && <>
        <View><TourText style={ui.heading}>{plan.title}</TourText><TourText style={ui.meta}>{tourDate(plan)}</TourText></View>
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
      <TourButton label={update ? t.tours.update : existing ? t.tours.openSaved : t.tours.import} busy={store.busy} onPress={() => { void save(); }} />
    </View>}
  </View>;
}
