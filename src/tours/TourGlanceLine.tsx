import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { ChevronRightIcon } from '@/components/shared/IconGlyph';
import { useToursStore } from '@/stores/toursStore';
import { t } from '@/i18n';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { tourDate } from './TourChrome';
import { runGlance, upcomingPlan } from './glance';

/** One line under the Parta doors: the tour being walked, or the next planned one. */
export function TourGlanceLine() {
  const router = useRouter();
  const activeRun = useToursStore((s) => s.activeRun);
  const plans = useToursStore((s) => s.plans);
  useEffect(() => { void useToursStore.getState().hydrate(); }, []);
  const run = runGlance(activeRun);
  const plan = run ? undefined : upcomingPlan(plans, activeRun?.planId);
  if (!run && !plan) return null;
  const title = run ? `${t.tours.active} · ${t.tours.runOf(run.visited, run.total)}` : plan!.title;
  const detail = run ? run.next ? t.tours.nextPub(run.next.name, run.minutes) : run.title : tourDate(plan!);
  return <Pressable onPress={() => router.push({ pathname: '/tours/[id]', params: { id: run?.planId ?? plan!.id } } as Href)}
    accessibilityRole="button" accessibilityLabel={`${title}. ${detail}`} style={({ pressed }) => [styles.line, pressed && styles.pressed]}>
    <View style={styles.words}>
      <Text maxFontSizeMultiplier={FontScaleCap.body} numberOfLines={1} style={styles.title}>{title}</Text>
      <Text maxFontSizeMultiplier={FontScaleCap.body} numberOfLines={1} style={styles.detail}>{detail.charAt(0).toLocaleUpperCase() + detail.slice(1)}</Text>
    </View>
    <ChevronRightIcon size={16} color={Colors.mutedText} />
  </Pressable>;
}

const styles = StyleSheet.create({
  line: { marginTop: Spacing.md, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.small, backgroundColor: Colors.stout3 },
  pressed: { opacity: 0.65 },
  words: { flex: 1, minWidth: 0 },
  title: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: Colors.foam },
  detail: { fontSize: 12, lineHeight: 17, color: Colors.foamMuted },
});
