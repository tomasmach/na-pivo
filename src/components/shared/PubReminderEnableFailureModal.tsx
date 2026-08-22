import { useEffect } from 'react';
import { Linking, Platform } from 'react-native';

import { showAppDialog } from '@/components/shared/AppDialog';
import { cs } from '@/i18n/cs';
import { usePubReminderEnableFailureStore } from '@/stores/pubReminderEnableFailureStore';

/** Bridges the reminder failure store into the app's single canonical dialog host. */
export function PubReminderEnableFailureModal() {
  const reason = usePubReminderEnableFailureStore((s) => s.reason);
  const hide = usePubReminderEnableFailureStore((s) => s.hide);

  useEffect(() => {
    if (!reason) return;
    const copy = cs.settings.pubReminders.denied[reason];
    const canOpenSettings = Platform.OS === 'ios' || Platform.OS === 'android';

    hide();
    showAppDialog({
      title: copy.title,
      message: copy.body,
      buttons: [
        { text: cs.common.ok, style: 'cancel' },
        ...(canOpenSettings
          ? [
              {
                text: cs.settings.pubReminders.openSettings,
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
