import {
  usePubReminderEnableFailureStore,
  type PubReminderEnableFailureReason,
} from '@/stores/pubReminderEnableFailureStore';

export function showPubReminderEnableFailure(reason: PubReminderEnableFailureReason): void {
  usePubReminderEnableFailureStore.getState().show(reason);
}
