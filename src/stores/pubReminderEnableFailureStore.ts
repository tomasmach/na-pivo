import { create } from 'zustand';

import type { PubReminderEnableResult } from '@/notifications/pubReminderNotifications';

export type PubReminderEnableFailureReason = Exclude<PubReminderEnableResult, { ok: true }>['reason'];

interface PubReminderEnableFailureState {
  reason: PubReminderEnableFailureReason | null;
  show: (reason: PubReminderEnableFailureReason) => void;
  hide: () => void;
}

export const usePubReminderEnableFailureStore = create<PubReminderEnableFailureState>((set) => ({
  reason: null,
  show: (reason) => set({ reason }),
  hide: () => set({ reason: null }),
}));
