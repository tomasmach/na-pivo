import { useEffect, useRef, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRightIcon, EllipsisIcon, HistoryIcon, SearchIcon } from '@/components/shared/IconGlyph';
import { showAppDialog } from '@/components/shared/AppDialog';
import { useToursStore } from '@/stores/toursStore';
import { t, intlLocale } from '@/i18n';
import { Colors, withAlpha } from '@/theme/colors';
import { Radius, Spacing } from '@/theme/layout';
import { FontScaleCap } from '@/theme/fonts';
import { TourButton, TourError, TourHeader, TourText, pubCount, tourDate, ui } from './TourChrome';
import { TourJourneyIllustration } from './TourJourneyIllustration';
import { describeRun, sortPlans, upcomingPlan } from './glance';
import { formatWalkDistance, walkingDistance } from './stopFacts';
import type { TourPlan, TourRun } from './model';

const SAMPLE_STOPS = [{ id: 'sample-1' }, { id: 'sample-2' }, { id: 'sample-3' }];

function planMeta(plan: TourPlan) {
  return [plan.scheduledDate ? tourDate(plan) : t.tours.optional, t.tours.summary(pubCount(plan.stops.length), formatWalkDistance(walkingDistance(plan.stops))),
    plan.source ? t.tours.imported : plan.publicSource ? t.tours.fromPublic : plan.publication?.status === 'active' ? t.tours.publicState : null].filter(Boolean).join(' · ');
}

function Row({ title, meta, onPress, icon, first }: { title: string; meta: string; onPress: () => void; icon?: ReactNode; first?: boolean }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}. ${meta}`} style={({ pressed }) => [styles.row, first && styles.first, pressed && styles.pressed]}>
    {icon}
    <View style={ui.grow}><TourText maxFontSizeMultiplier={FontScaleCap.heading} style={ui.stopName}>{title}</TourText><TourText style={ui.meta}>{meta}</TourText></View>
    <ChevronRightIcon color={Colors.mutedText} size={18} />
  </Pressable>;
}

function Hero({ run, plan, upcoming, onPress }: { run: TourRun | null; plan?: TourPlan; upcoming: boolean; onPress: () => void }) {
  const glance = run ? describeRun(run) : null;
  const shown = run?.snapshot ?? plan;
  if (!shown) return null;
  const line = glance
    ? [t.tours.runOf(glance.visited, glance.total), glance.next ? t.tours.nextPub(glance.next.name, glance.minutes) : null].filter(Boolean).join(' · ')
    : planMeta(shown);
  const kicker = run ? t.tours.active : upcoming ? t.tours.upNext : null;
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={[kicker, shown.title, line].filter(Boolean).join('. ')}
    style={({ pressed }) => [styles.hero, pressed && styles.pressed]}>
    <TourJourneyIllustration stops={shown.stops} statuses={run?.statuses} nextStopId={glance?.next?.id} />
    {kicker && <TourText style={styles.kicker}>{kicker}</TourText>}
    <TourText maxFontSizeMultiplier={FontScaleCap.heading} style={styles.heroTitle}>{shown.title}</TourText>
    <TourText style={styles.heroLine}>{line}</TourText>
  </Pressable>;
}

export default function ToursScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const store = useToursStore();
  const creating = useRef(false);
  useEffect(() => { void useToursStore.getState().hydrate(); }, []);
  const open = (id: string, run?: string) => router.push({ pathname: '/tours/[id]', params: run ? { id, run } : { id } } as Href);
  const editDraft = () => router.push('/tours/edit' as Href);
  async function create() {
    if (creating.current) return;
    creating.current = true;
    const result = await store.beginDraft();
    creating.current = false;
    if (result.ok) editDraft();
  }
  const active = store.activeRun;
  const upcoming = active ? undefined : upcomingPlan(store.plans);
  const heroPlan = active ? undefined : upcoming ?? sortPlans(store.plans)[0];
  const others = sortPlans(store.plans.filter((plan) => plan.id !== active?.planId && plan.id !== heroPlan?.id));
  const empty = store.hydrated && !active && !store.draft && store.plans.length === 0;
  async function restore() {
    const result = await store.restorePublished();
    if (result.ok) showAppDialog({ title: t.tours.restored, buttons: [{ text: t.tours.close, style: 'cancel' }] });
  }
  const more = () => showAppDialog({ title: t.tours.mine, message: t.tours.localNotice, buttons: [
    { text: t.tours.restore, onPress: () => { void restore(); } },
    { text: t.tours.close, style: 'cancel' },
  ] });

  return <View style={[ui.screen, { paddingTop: insets.top }]}>
    <TourHeader title={t.tours.title} onBack={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/friends' as Href)}
      right={<>
        {/* Search works with an empty list and offline too, so the magnifier is always there. */}
        <Pressable style={ui.iconButton} accessibilityRole="button" accessibilityLabel={t.tours.discoverOpen} onPress={() => router.push('/tours/discover' as Href)}><SearchIcon color={Colors.foam} size={21} /></Pressable>
        {!empty && <Pressable style={ui.iconButton} accessibilityRole="button" accessibilityLabel={t.tours.more} onPress={more}><EllipsisIcon color={Colors.foam} size={23} /></Pressable>}
      </>} />
    <ScrollView contentContainerStyle={styles.content}>
      <TourText style={ui.heading}>{t.tours.mine}</TourText>
      <TourError code={store.error} />
      {empty ? <View style={styles.empty}>
        <View style={styles.muted}><TourJourneyIllustration stops={SAMPLE_STOPS} /></View>
        <TourText maxFontSizeMultiplier={FontScaleCap.heading} style={styles.heroTitle}>{t.tours.emptyTitle}</TourText>
        <TourText>{t.tours.empty}</TourText>
      </View> : <>
        <Hero run={active} plan={heroPlan} upcoming={!!upcoming} onPress={() => open(active?.planId ?? heroPlan!.id)} />
        {(store.draft || others.length > 0) && <View>
          {(active || heroPlan) && <TourText style={styles.section}>{t.tours.otherTours}</TourText>}
          {store.draft && <Row first title={store.draft.title.trim() || t.tours.untitled} meta={`${t.tours.draft} · ${pubCount(store.draft.stops.length)}`} onPress={editDraft} />}
          {others.map((plan, index) => <Row key={plan.id} first={!store.draft && index === 0} title={plan.title} meta={planMeta(plan)} onPress={() => open(plan.id)} />)}
        </View>}
        {store.runs.length > 0 && <View>
          <TourText style={styles.section}>{t.tours.pastRuns}</TourText>
          {store.runs.map((run, index) => {
            const glance = describeRun(run);
            return <Row key={run.id} first={index === 0} title={run.snapshot.title} icon={<HistoryIcon size={18} color={Colors.foamMuted} />}
              meta={`${new Date(run.startedAt).toLocaleDateString(intlLocale)} · ${t.tours.runOf(glance.visited, glance.total)}`} onPress={() => open(run.planId, run.id)} />;
          })}
        </View>}
      </>}
    </ScrollView>
    <View style={[ui.footer, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
      {active ? <>
        <TourButton label={t.tours.continueRun} onPress={() => open(active.planId)} />
        <TourButton label={store.draft ? t.tours.continueDraft : t.tours.createNew} quiet onPress={() => { if (store.draft) editDraft(); else void create(); }} />
      </> : store.draft ? <TourButton label={t.tours.continueDraft} onPress={editDraft} />
        : <TourButton label={t.tours.create} onPress={() => { void create(); }} disabled={!store.hydrated} />}
      {empty && <TourButton label={t.tours.restore} quiet busy={store.busy} onPress={() => { void restore(); }} />}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xl, gap: Spacing.xl },
  hero: { backgroundColor: Colors.stout2, borderRadius: Radius.card, padding: Spacing.lg, paddingTop: Spacing.md },
  pressed: { opacity: 0.65 },
  kicker: { fontFamily: undefined, fontSize: 12, lineHeight: 18, fontWeight: '600', color: Colors.mutedText, marginTop: Spacing.sm },
  heroTitle: { fontFamily: undefined, fontSize: 21, lineHeight: 27, fontWeight: '700', letterSpacing: -.4, color: Colors.foam, marginTop: Spacing.xs },
  heroLine: { fontFamily: undefined, fontSize: 13, lineHeight: 19, color: Colors.foamMuted, marginTop: Spacing.xs },
  section: { fontFamily: undefined, fontSize: 14, lineHeight: 20, fontWeight: '600', color: Colors.foam, marginBottom: Spacing.xs },
  row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm + 2, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(Colors.foam, 0.1) },
  first: { borderTopWidth: 0 },
  empty: { gap: Spacing.sm, marginTop: Spacing.lg },
  muted: { opacity: 0.35, marginBottom: Spacing.md },
});
