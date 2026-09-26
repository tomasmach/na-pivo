import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showAppDialog } from '@/components/shared/AppDialog';
import { useToastStore } from '@/stores/toastStore';
import { useToursStore } from '@/stores/toursStore';
import { t } from '@/i18n';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Spacing } from '@/theme/layout';
import { TourButton, TourError, TourHeader, TourText, pubCount, tourError, ui } from './TourChrome';
import { formatWalkDistance, walkingDistance } from './stopFacts';
import type { TourPlan, TourResult } from './model';

type Failure = Extract<TourResult, { ok: false }>;

function failureText(failure: Failure, plan: TourPlan): string {
  const e = t.tours.errors;
  const name = failure.stop !== undefined ? plan.stops[failure.stop]?.name : undefined;
  if (failure.error === 'text_rejected')
    return name && failure.field === 'challenge' ? e.publicChallenge(name) : failure.field === 'title' ? e.publicTitle(plan.title) : e.publicText;
  if (failure.error === 'unknown_pub' && name) return e.publicUnknownPub(name);
  if (failure.error === 'hidden_pub' && name) return e.publicHiddenPub(name);
  if (failure.error === 'limit') return e.publicLimit(failure.limit ?? 10);
  if (failure.error === 'throttled') return e.publicThrottled;
  if (failure.error === 'network') return e.publicNetwork;
  return tourError(failure.error) ?? e.publicNetwork;
}

/** Everyone sees exactly what this screen lists; the meetup and the author's night stay private. */
export default function TourPublishScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter(); const insets = useSafeAreaInsets();
  const store = useToursStore();
  const plan = store.plans.find((p) => p.id === id);
  const [failure, setFailure] = useState<Failure | null>(null);
  // The store keeps the last error for other screens; this one explains its own.
  useEffect(() => () => useToursStore.getState().clearError(), []);
  // Back from signing in or fixing the tour, the old refusal no longer holds.
  useFocusEffect(useCallback(() => { setFailure(null); }, []));
  if (!plan) return <View style={[ui.screen, { paddingTop: insets.top }]}>
    <TourHeader title={t.tours.publishPublic} onBack={() => router.back()} /><TourError message={t.tours.errors.unavailable} />
  </View>;
  const current = plan;
  const updating = current.publication?.status === 'active';
  const challenges = current.stops.filter((stop) => stop.challenge).length;
  async function publish() {
    setFailure(null);
    const result = await useToursStore.getState().publishPublic(current.id);
    if (result.ok) {
      useToastStore.getState().show(t.tours.publishedNotice);
      router.back();
      return;
    }
    setFailure(result);
    AccessibilityInfo.announceForAccessibility(failureText(result, current));
  }
  async function editTour() {
    const result = await useToursStore.getState().beginDraft(current.id);
    // Replace this screen, so leaving the editor does not land on a stale preview.
    if (result.ok) router.replace('/tours/edit' as Href);
    else if (result.error === 'busy') showAppDialog({ title: t.tours.continueDraft, buttons: [
      { text: t.tours.continueDraft, onPress: () => router.replace('/tours/edit' as Href) }, { text: t.tours.cancel, style: 'cancel' },
    ] });
  }
  const fix = !failure ? null
    : failure.error === 'sign_in' ? { label: t.tours.signIn, onPress: () => router.push('/auth' as Href) }
      : failure.error === 'nickname' ? { label: t.tours.pickNickname, onPress: () => router.push('/profile/edit' as Href) }
        : failure.error === 'profile_private' ? { label: t.tours.openPrivacy, onPress: () => router.push('/profile/privacy' as Href) }
          : ['text_rejected', 'unknown_pub', 'hidden_pub', 'duplicate'].includes(failure.error) ? { label: t.tours.editTour, onPress: () => { void editTour(); } }
            : null;
  return <View style={[ui.screen, { paddingTop: insets.top }]}>
    <TourHeader title={updating ? t.tours.updatePublic : t.tours.publishPublic} onBack={() => router.back()} />
    <ScrollView contentContainerStyle={styles.content}>
      {/* A refusal sits on top, where the author looks after tapping. */}
      {failure && <TourError message={failureText(failure, current)} />}
      <TourText accessibilityRole="header" maxFontSizeMultiplier={FontScaleCap.heading} style={styles.heading}>{t.tours.seenByAll}</TourText>
      <View>
        {[t.tours.seenTitle(current.title), t.tours.seenStops(pubCount(current.stops.length), formatWalkDistance(walkingDistance(current.stops))),
          challenges ? t.tours.seenChallenges(challenges) : null, t.tours.seenProfile].filter((line): line is string => !!line)
          .map((line, index) => <TourText key={line} style={[styles.row, index === 0 && styles.first]}>{line}</TourText>)}
      </View>
      <TourText accessibilityRole="header" maxFontSizeMultiplier={FontScaleCap.heading} style={styles.heading}>{t.tours.notSeenByOthers}</TourText>
      <View>
        {[t.tours.hiddenMeetup, t.tours.hiddenPrivate].map((line, index) =>
          <TourText key={line} style={[styles.row, styles.muted, index === 0 && styles.first]}>{line}</TourText>)}
      </View>
      <TourText style={ui.notice}>{t.tours.publishNameNote}</TourText>
      <TourText style={ui.notice}>{t.tours.publishUndoNote}</TourText>
    </ScrollView>
    <View style={[ui.footer, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
      {/* Every publish records consent again, so every publish shows what is agreed to. */}
      <Pressable accessibilityRole="link" accessibilityLabel={`${t.tours.rulesPrefix}${t.tours.rulesLink}`} style={styles.legal}
        onPress={() => { void Linking.openURL(t.tours.rulesUrl).catch(() => undefined); }}>
        <Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.legalText}>
          {t.tours.rulesPrefix}<Text style={styles.link}>{t.tours.rulesLink}</Text>{t.tours.rulesSuffix}
        </Text>
      </Pressable>
      {/* When a fix exists, retrying would fail the same way; the fix is the one action. */}
      {fix ? <TourButton testID="tour-publish-fix" label={fix.label} onPress={fix.onPress} />
        : <TourButton testID="tour-publish" label={updating ? t.tours.updatePublic : t.tours.publishAction} busy={store.busy} onPress={() => { void publish(); }} />}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xl, gap: Spacing.md },
  heading: { fontFamily: undefined, fontSize: 21, lineHeight: 27, fontWeight: '700', letterSpacing: -0.4, color: Colors.foam, marginTop: Spacing.sm },
  row: { fontSize: 16, lineHeight: 22, color: Colors.foam, paddingVertical: Spacing.sm + 2, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(Colors.foam, 0.1) },
  first: { borderTopWidth: 0 },
  muted: { color: Colors.foamMuted },
  legal: { minHeight: HitArea.min, justifyContent: 'center' },
  legalText: { fontSize: 12, lineHeight: 18, color: Colors.mutedText, textAlign: 'center' },
  link: { color: Colors.amber, fontWeight: '600' },
});
