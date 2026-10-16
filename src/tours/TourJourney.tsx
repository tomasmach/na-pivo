import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CheckIcon, ChevronRightIcon, HistoryIcon, MapIcon, MinusIcon, FootprintsIcon } from '@/components/shared/IconGlyph';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { t, intlLocale } from '@/i18n';
import { TourMap } from './TourMap';
import { TourChallengeText } from './TourChrome';
import type { TourRun, TourStop } from './model';

export interface StopFactsLine { hours?: string; closed?: boolean; beers?: string }

export function TourJourneyStop({ stop, index, count, status, caption, facts, here, next, selected, onPress }: {
  stop: TourStop; index: number; count: number; status?: 'visited' | 'skipped'; caption: string;
  facts?: StopFactsLine; here?: boolean; next: boolean; selected: boolean; onPress: () => void;
}) {
  const factsText = [facts?.hours, facts?.beers].filter(Boolean).join(' · ');
  return <View style={styles.stop}>
    <View pointerEvents="none" style={[styles.rail, index === 0 && styles.railFirst, index === count - 1 && styles.railLast]} />
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={[`${index + 1}. ${stop.name}`, caption, factsText, stop.challenge ? t.tours.challengeA11y(stop.challenge) : null].filter(Boolean).join('. ')}
      accessibilityState={{ selected }} style={({ pressed }) => [styles.stopPress, (selected || pressed) && styles.highlight]}>
      <View style={[styles.number, next && styles.nextNumber, status === 'visited' && styles.visitedNumber]}>
        {status === 'visited' ? <CheckIcon size={16} color={Colors.stout} /> : status === 'skipped' ? <MinusIcon size={15} color={Colors.foamMuted} /> :
          <Text allowFontScaling={false} style={[styles.digit, next && styles.accent]}>{index + 1}</Text>}
      </View>
      <View style={styles.words}>
        <Text maxFontSizeMultiplier={FontScaleCap.heading} style={[styles.name, next && styles.nextName]}>{stop.name}</Text>
        {!!caption && <Text maxFontSizeMultiplier={FontScaleCap.body} style={[styles.caption, next && styles.nextCaption, here && styles.here]}>{caption}</Text>}
        {!!factsText && <Text maxFontSizeMultiplier={FontScaleCap.body} numberOfLines={2} style={styles.facts}>
          {facts?.hours && <Text style={facts.closed ? styles.closed : styles.open}>{facts.hours}</Text>}
          {facts?.hours && facts.beers ? ' · ' : ''}{facts?.beers}
        </Text>}
        {/* The next stop reads in full; the others stay short so their number sits by the name. */}
        {!!stop.challenge && <TourChallengeText text={stop.challenge} emphasized={next} lines={next ? undefined : 2} />}
      </View>
      <ChevronRightIcon size={16} color={Colors.mutedText} />
    </Pressable>
  </View>;
}

export function TourLeg({ label, done }: { label: string; done: boolean }) {
  return <View style={[styles.leg, done && styles.dim]}>
    <View pointerEvents="none" style={styles.rail} />
    <FootprintsIcon size={13} color={Colors.mutedText} />
    <Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.legText}>{label}</Text>
  </View>;
}

export function TourMapPreview({ stops, onPress }: { stops: readonly TourStop[]; onPress: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={t.tours.openMap}
    style={({ pressed }) => [styles.mapLink, pressed && styles.dim]}>
    <View style={styles.thumbnail} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <TourMap key={stops.map((stop) => `${stop.id}:${stop.lat}:${stop.lon}`).join('|')} stops={stops} onSelect={() => {}} height={76} preview />
    </View>
    <Text maxFontSizeMultiplier={FontScaleCap.heading} style={styles.mapLabel}>{t.tours.openMap}</Text>
    <MapIcon size={20} color={Colors.foam} />
  </Pressable>;
}

export function TourHistoryRow({ run, selected, onPress }: { run: TourRun; selected: boolean; onPress: () => void }) {
  const crew = run.crew ? t.tours.crewHistory(run.crew.members?.length ?? 1, run.crew.completion === 'sent' && !!run.crew.counted) : null;
  const summary = [`${new Date(run.startedAt).toLocaleDateString(intlLocale)} · ${Object.values(run.statuses).filter((s) => s === 'visited').length} / ${run.snapshot.stops.length}`, crew].filter(Boolean).join(' · ');
  return <Pressable accessibilityRole="button" accessibilityLabel={`${t.tours.pastRun}. ${summary}`} accessibilityState={{ selected }} onPress={onPress}
    style={({ pressed }) => [styles.history, pressed && styles.dim]}>
    <HistoryIcon size={18} color={Colors.foamMuted} />
    <View style={styles.words}><Text maxFontSizeMultiplier={FontScaleCap.heading} style={styles.historyTitle}>{t.tours.pastRun}</Text>
      <Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.caption}>{summary}</Text></View>
    <ChevronRightIcon size={16} color={Colors.mutedText} />
  </Pressable>;
}

const styles = StyleSheet.create({
  stop: { position: 'relative' },
  stopPress: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md, borderRadius: Radius.small },
  rail: { position: 'absolute', left: 14.5, width: StyleSheet.hairlineWidth, top: 0, bottom: 0, backgroundColor: withAlpha(Colors.foam, .22) },
  railFirst: { top: '50%' }, railLast: { bottom: '50%' },
  number: { width: 30, height: 30, borderRadius: Radius.pill, backgroundColor: Colors.stout, borderWidth: 1, borderColor: withAlpha(Colors.foam, .25), alignItems: 'center', justifyContent: 'center' },
  nextNumber: { borderColor: Colors.amber }, visitedNumber: { backgroundColor: Colors.foam, borderColor: Colors.foam },
  digit: { fontSize: 14, lineHeight: 20, fontWeight: '700', color: Colors.foam, includeFontPadding: false, fontVariant: ['tabular-nums'] },
  accent: { color: Colors.amber },
  words: { flex: 1, minWidth: 0 },
  name: { fontSize: 17, lineHeight: 23, fontWeight: '600', letterSpacing: -.2, color: Colors.foam },
  nextName: { fontSize: 21, lineHeight: 27, fontWeight: '700', letterSpacing: -.4 },
  caption: { fontSize: 12, lineHeight: 18, color: Colors.mutedText, marginTop: Spacing.xs },
  nextCaption: { color: Colors.foamMuted },
  here: { color: Colors.foamMuted, fontWeight: '600' },
  facts: { fontSize: 12, lineHeight: 18, color: Colors.mutedText, marginTop: 2 },
  open: { color: Colors.open }, closed: { color: Colors.closed },
  leg: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 30 + Spacing.md },
  legText: { fontSize: 12, lineHeight: 18, color: Colors.mutedText },
  highlight: { backgroundColor: withAlpha(Colors.foam, .04) },
  mapLink: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingRight: Spacing.md, borderRadius: Radius.medium, backgroundColor: Colors.stout3, overflow: 'hidden' },
  thumbnail: { width: 104, height: 76 },
  mapLabel: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '600', color: Colors.foam },
  history: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(Colors.foam, .12) },
  historyTitle: { fontSize: 14, lineHeight: 20, fontWeight: '500', color: Colors.foamMuted },
  dim: { opacity: .65 },
});
