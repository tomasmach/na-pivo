import { Alert, Linking, Platform } from 'react-native';

import { cs } from '@/i18n/cs';
import type { PubReminderEnableResult } from '@/notifications/pubReminderNotifications';

type PubReminderEnableFailureReason = Exclude<PubReminderEnableResult, { ok: true }>['reason'];

export function showPubReminderEnableFailureAlert(reason: PubReminderEnableFailureReason): void {
  const copy = cs.settings.pubReminders.denied[reason];
  const canOpenSettings = Platform.OS === 'ios' || Platform.OS === 'android';

  Alert.alert(
    copy.title,
    copy.body,
    canOpenSettings
      ? [
          { text: cs.common.ok, style: 'cancel' },
          {
            text: cs.settings.pubReminders.openSettings,
            onPress: () => void Linking.openSettings(),
          },
        ]
      : [{ text: cs.common.ok, style: 'cancel' }],
  );
}
