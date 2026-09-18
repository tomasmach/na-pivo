import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRightIcon } from '@/components/shared/IconGlyph';
import { useToursStore } from '@/stores/toursStore';
import { t } from '@/i18n';
import { Colors } from '@/theme/colors';
import { Spacing } from '@/theme/layout';
import { TourButton, TourError, TourHeader, TourText, stopCount, tourDate, ui } from './TourChrome';
import { TourMap } from './TourMap';

export default function ToursScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const store = useToursStore();
  const creating = useRef(false);
  useEffect(() => { void useToursStore.getState().hydrate(); }, []);
  const open = (id: string) => router.push({ pathname: '/tours/[id]', params: { id } } as Href);
  async function create() {
    if (creating.current) return;
    creating.current = true;
    const result = await store.beginDraft();
    creating.current = false;
    if (result.ok) router.push('/tours/edit' as Href);
  }
  return <View style={[ui.screen, { paddingTop: insets.top }]}>
    <TourHeader title={t.tours.title} onBack={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/friends' as Href)} />
    <ScrollView contentContainerStyle={ui.content}>
      <TourText style={ui.heading}>{t.tours.mine}</TourText>
      <TourError code={store.error} />
      {store.draft && <TourButton label={t.tours.continueDraft} secondary onPress={() => router.push('/tours/edit' as Href)} />}
      {store.activeRun && <View style={{ gap: Spacing.sm }}>
        <TourText style={ui.section}>{t.tours.active}</TourText>
        <TourMap stops={store.activeRun.snapshot.stops} height={160} onSelect={() => open(store.activeRun!.planId)} />
        <Pressable onPress={() => open(store.activeRun!.planId)} accessibilityRole="button" accessibilityLabel={store.activeRun.snapshot.title} style={ui.stopRow}>
          <View style={ui.grow}><TourText style={ui.stopName}>{store.activeRun.snapshot.title}</TourText>
            <TourText style={ui.meta}>{Object.values(store.activeRun.statuses).filter((s) => s === 'visited').length} / {store.activeRun.snapshot.stops.length} {t.tours.visited.toLocaleLowerCase()}</TourText></View>
          <ChevronRightIcon color={Colors.foamMuted} size={20} />
        </Pressable>
      </View>}
      {store.hydrated && store.plans.length === 0 && !store.draft && <TourText style={{ marginVertical: Spacing.xxl }}>{t.tours.empty}</TourText>}
      <View>{store.plans.filter((p) => p.id !== store.activeRun?.planId).map((plan) => <Pressable key={plan.id} onPress={() => open(plan.id)}
        accessibilityRole="button" accessibilityLabel={plan.title} style={ui.stopRow}>
        <View style={[ui.grow, { paddingVertical: Spacing.md }]}>
          <TourText style={ui.stopName}>{plan.title}</TourText>
          <TourText style={ui.meta}>{stopCount(plan.stops.length)} · {tourDate(plan)}</TourText>
          {plan.source && <TourText style={ui.meta}>{t.tours.imported}</TourText>}
        </View><ChevronRightIcon color={Colors.foamMuted} size={20} />
      </Pressable>)}</View>
      <TourText style={ui.notice}>{t.tours.localNotice}</TourText>
      <TourButton label={t.tours.restore} secondary busy={store.busy} onPress={() => { void store.restorePublished(); }} />
    </ScrollView>
    <View style={[ui.footer, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
      <TourButton label={t.tours.create} onPress={() => { void create(); }} disabled={!store.hydrated || !!store.draft} />
    </View>
  </View>;
}
