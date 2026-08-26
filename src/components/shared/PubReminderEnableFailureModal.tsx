import { useEffect } from 'react';
import { Linking, Platform } from 'react-native';

import { showAppDialog } from '@/components/shared/AppDialog';
import { t } from '@/i18n';
import { usePubReminderEnableFailureStore } from '@/stores/pubReminderEnableFailureStore';

/** Bridges the reminder failure store into the app's single canonical dialog host. */
export function PubReminderEnableFailureModal() {
  const reason = usePubReminderEnableFailureStore((s) => s.reason);
  const hide = usePubReminderEnableFailureStore((s) => s.hide);

  useEffect(() => {
    if (!reason) return;
    const copy = t.settings.pubReminders.denied[reason];
    const canOpenSettings = Platform.OS === 'ios' || Platform.OS === 'android';

    hide();
    showAppDialog({
      title: copy.title,
      message: copy.body,
      buttons: [
        { text: t.common.ok, style: 'cancel' },
        ...(canOpenSettings
          ? [
              {
                text: t.settings.pubReminders.openSettings,
                onPress: () => {
                  void Linking.openSettings();
                },
              },
            ]
          : []),
      ],
    });
  }, [hide, reason]);

  return null;
}
