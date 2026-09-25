import { useState } from 'react';
import { Keyboard, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { XIcon } from '@/components/shared/IconGlyph';
import { t } from '@/i18n';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { useKeyboardHeight } from '@/utils/useKeyboardHeight';
import { TourButton, TourText, ui } from './TourChrome';
import { CHALLENGE_MAX, cleanChallenge, type TourStop } from './model';

/** One field for one stop's challenge. Mount it with `key={stop.id}` so a new stop starts clean. */
export function TourChallengeSheet({ stop, onSave, onClose }: {
  stop: TourStop | null; onSave: (text: string) => Promise<boolean>; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  // A Modal hosts its own window, so lift the card above the keyboard manually.
  const keyboardHeight = useKeyboardHeight();
  const [text, setText] = useState(stop?.challenge ?? '');
  const [saving, setSaving] = useState(false);
  const cleaned = cleanChallenge(text);
  const existing = !!stop?.challenge;
  const disabled = !cleaned && !existing;
  // Clearing the field removes the challenge only through a quiet, deliberate tap.
  const removing = !cleaned && existing;
  const label = cleaned ? t.tours.saveChallenge : existing ? t.tours.removeChallenge : t.tours.writeChallenge;
  async function save() {
    if (disabled || saving) return;
    setSaving(true);
    const ok = await onSave(cleaned);
    setSaving(false);
    if (ok) onClose();
  }
  return <Modal visible={!!stop} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.backdrop}>
      {/* A tap above the card first only hides the keyboard, so typed text is not lost by accident. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={() => { if (keyboardHeight) Keyboard.dismiss(); else onClose(); }} accessible={false} accessibilityElementsHidden importantForAccessibility="no" />
      <View style={[styles.card, { marginBottom: keyboardHeight, paddingBottom: keyboardHeight ? Spacing.md : Math.max(insets.bottom, Spacing.md) + Spacing.sm }]}>
        <View style={styles.grabber} />
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.heading}>{stop?.name}</Text>
          <Pressable onPress={onClose} style={({ pressed }) => [styles.close, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={t.tours.close}>
            <XIcon size={20} color={Colors.foamMuted} />
          </Pressable>
        </View>
        <TourText style={[ui.section, styles.label]}>{t.tours.challenge}</TourText>
        <TextInput testID="tour-challenge" autoFocus multiline submitBehavior="blurAndSubmit" returnKeyType="done"
          value={text} onChangeText={setText} onSubmitEditing={() => { if (cleaned) void save(); else Keyboard.dismiss(); }} maxLength={CHALLENGE_MAX}
          placeholder={t.tours.challengePlaceholder} placeholderTextColor={Colors.foamMuted} accessibilityLabel={t.tours.challenge}
          style={[ui.input, styles.input]} maxFontSizeMultiplier={1.3} />
        <View style={styles.hintRow}>
          <Text style={styles.hint} maxFontSizeMultiplier={FontScaleCap.body}>{t.tours.challengeHint}</Text>
          {text.length >= CHALLENGE_MAX - 20 && <Text style={styles.hint} allowFontScaling={false} accessibilityLabel={t.tours.challengeCountA11y(CHALLENGE_MAX - text.length)}>{t.tours.challengeCount(text.length, CHALLENGE_MAX)}</Text>}
        </View>
        <TourButton testID="tour-challenge-save" label={label} secondary={removing} disabled={disabled} busy={saving} onPress={() => { void save(); }} />
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: withAlpha(Colors.black, 0.6) },
  card: { backgroundColor: Colors.stout, borderTopLeftRadius: Radius.cardLarge, borderTopRightRadius: Radius.cardLarge, paddingTop: Spacing.sm, paddingHorizontal: Spacing.lg },
  grabber: { alignSelf: 'center', width: 44, height: 4, borderRadius: Radius.pill, backgroundColor: withAlpha(Colors.foam, 0.22), marginBottom: Spacing.md },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  title: { flex: 1, fontSize: 21, lineHeight: 27, fontWeight: '700', letterSpacing: -0.4, color: Colors.foam, paddingTop: Spacing.sm },
  close: { width: HitArea.min, height: HitArea.min, alignItems: 'center', justifyContent: 'center', marginRight: -Spacing.sm },
  pressed: { opacity: 0.65 },
  label: { marginTop: Spacing.md, marginBottom: Spacing.sm },
  input: { minHeight: 52, maxHeight: 120, paddingTop: Spacing.md, paddingBottom: Spacing.md, textAlignVertical: 'top' },
  hintRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, marginTop: Spacing.sm, marginBottom: Spacing.lg },
  hint: { flexShrink: 1, fontSize: 12, lineHeight: 18, color: Colors.mutedText, fontVariant: ['tabular-nums'] },
});
