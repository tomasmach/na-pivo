import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { BellRingIcon } from '@/components/shared/IconGlyph';
import { t } from '@/i18n';
import { askTourReminderPermission, notificationPermissionStatus, tourReminderAskText, tourReminderFor } from '@/notifications/tourReminder';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToursStore } from '@/stores/toursStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Spacing } from '@/theme/layout';
import { TourText, ui } from './TourChrome';
import type { TourPlan } from './model';

/** One quiet offer to remind the meetup, shown only while the phone was never asked for notifications. */
export function TourReminderAsk({ plan }: { plan: TourPlan }) {
  const enabled = useSettingsStore((s) => s.tourRemindersEnabled);
  const dismissed = useSettingsStore((s) => s.tourReminderAskDismissed);
  const activeRun = useToursStore((s) => s.activeRun);
  const runs = useToursStore((s) => s.runs);
  const [undetermined, setUndetermined] = useState(false);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!enabled || dismissed) return;
    let alive = true;
    const check = () => void notificationPermissionStatus().then((status) => { if (alive) setUndetermined(status === 'undetermined'); });
    check();
    // Notifications allowed in the system Settings meanwhile hide the offer on return.
    const subscription = AppState.addEventListener('change', (next) => { if (next === 'active') check(); });
    return () => { alive = false; subscription.remove(); };
  }, [enabled, dismissed]);
  const reminder = enabled && !dismissed && undetermined ? tourReminderFor(plan, { activeRun, runs }) : null;
  if (!reminder) return null;
  // Not now or a no from the system leaves reminders off, so Settings shows what will really happen.
  const dismiss = () => {
    const settings = useSettingsStore.getState();
    settings.setTourReminderAskDismissed(true);
    settings.setTourRemindersEnabled(false);
  };
  async function accept() {
    setAsking(true);
    const answer = await askTourReminderPermission();
    setAsking(false);
    // A no from the system is final here too; the row never comes back. Without an answer it stays for another try.
    if (answer === 'granted') setUndetermined(false);
    else if (answer === 'denied') dismiss();
  }
  return <View style={styles.row}>
    <BellRingIcon size={17} color={Colors.amber} />
    <View style={ui.grow}>
      <TourText style={styles.text}>{tourReminderAskText(plan, reminder.fireAtMs)}</TourText>
      <View style={styles.actions}>
        <Pressable style={[ui.link, styles.action]} accessibilityRole="button" accessibilityState={{ disabled: asking }} disabled={asking} onPress={() => { void accept(); }}>
          <TourText style={ui.linkText}>{t.tourReminders.askAccept}</TourText>
        </Pressable>
        <Pressable style={[ui.link, styles.action]} accessibilityRole="button" disabled={asking} onPress={dismiss}>
          <TourText style={styles.dismiss}>{t.tourReminders.askDismiss}</TourText>
        </Pressable>
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, paddingTop: Spacing.sm + 2, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: withAlpha(Colors.foam, .1) },
  text: { fontSize: 14, lineHeight: 20, color: Colors.foam, marginTop: 1 },
  actions: { flexDirection: 'row', gap: Spacing.md, marginLeft: -Spacing.sm },
  action: { alignItems: 'flex-start' },
  dismiss: { color: Colors.foamMuted },
});
