/**
 * PingSheet — a quick cinknutí for a pub the caller already knows (the counter,
 * a tour stop): only "KOMU" to choose, then one button. The rich compose with
 * place, time and message stays on Parta.
 *
 * The host sends; the sheet only collects the audience and shows a hard error.
 */
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlowButton } from '@/components/shared/GlowButton';
import { XIcon } from '@/components/shared/IconGlyph';
import type { FriendProfile } from '@/data/friendsClient';
import { t } from '@/i18n';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import AudiencePicker, { EVERYONE, audienceIds, type Audience } from './AudiencePicker';

export interface PingSheetProps {
  title: string;
  /** One line under the title, e.g. which pub the party hears about. */
  detail: string;
  /** Who can hear it; the host leaves out anyone who should not (a tour crew at the table). */
  friends: FriendProfile[];
  /** Undefined means everyone in `friends`. Resolves to an error to show, or null when it went out or waits for signal. */
  onSend: (recipientIds: string[] | undefined) => Promise<string | null>;
  onClose: () => void;
}

export default function PingSheet({ title, detail, friends, onSend, onClose }: PingSheetProps) {
  const insets = useSafeAreaInsets();
  const [audience, setAudience] = useState<Audience>(EVERYONE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recipients = audienceIds(audience, friends);
  const empty = recipients?.length === 0;

  async function send() {
    setBusy(true);
    setError(null);
    const failure = await onSend(recipients);
    setBusy(false);
    if (failure) setError(failure);
    else onClose();
  }

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} accessibilityElementsHidden importantForAccessibility="no" />
        <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
          <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <View style={styles.grabber} />
            <View style={styles.header}>
              <Text accessibilityRole="header" maxFontSizeMultiplier={FontScaleCap.heading} style={styles.title}>{title}</Text>
              <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel={t.friends.settingsClose}>
                <XIcon size={20} color={Colors.foamMuted} />
              </Pressable>
            </View>
            <Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.detail}>{detail}</Text>
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <AudiencePicker friends={friends} value={audience} onChange={setAudience} />
            </ScrollView>
            <View style={styles.actions}>
              {error ? <Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
              <GlowButton label={t.friends.composeSubmitNow} onPress={() => { void send(); }} variant="primary" glow="none" loading={busy} disabled={busy || empty} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: withAlpha(Colors.black, 0.6) },
  cardWrap: { width: '100%', maxHeight: '92%' },
  card: {
    flexShrink: 1,
    backgroundColor: Colors.stout,
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    paddingTop: Spacing.sm,
    paddingHorizontal: 20,
  },
  grabber: { width: 44, height: 4, borderRadius: Radius.pill, backgroundColor: withAlpha(Colors.foam, 0.22), alignSelf: 'center', marginBottom: Spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flexShrink: 1, fontSize: 18, lineHeight: 24, fontWeight: '700', letterSpacing: -0.2, color: Colors.foam },
  close: { width: HitArea.min, height: HitArea.min, alignItems: 'center', justifyContent: 'center', marginRight: -Spacing.sm },
  detail: { fontSize: 14, lineHeight: 20, color: Colors.foamMuted },
  list: { flexGrow: 0, flexShrink: 1, marginTop: Spacing.md },
  listContent: { paddingBottom: Spacing.sm },
  actions: {
    gap: Spacing.sm,
    paddingTop: Spacing.md,
    marginTop: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  error: { fontSize: 13, lineHeight: 18, color: Colors.amberLight },
});
