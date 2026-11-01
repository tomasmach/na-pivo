import { create } from 'zustand';

import { useToastStore } from '@/stores/toastStore';

import type { IconName } from '../components/Icon';

export type ToastKind = 'saved' | 'offline' | 'error' | 'xp' | 'info' | 'medal';
export type Toast = {
  id: number;
  kind: ToastKind;
  title: string;
  sub?: string;
  icon?: IconName;
  xp?: number;
  at?: 'top' | 'bottom';
  href?: string;
  onPress?: () => void;
};

export type DialogAction = { label: string; kind?: 'primary' | 'raised' | 'danger'; onPress?: () => void };
export type Dialog = { title: string; body?: string; actions: DialogAction[] };

type UiState = {
  toast: Toast | null;
  dialog: Dialog | null;
  showToast: (t: Omit<Toast, 'id'>) => void;
  hideToast: () => void;
  showDialog: (d: Dialog) => void;
  hideDialog: () => void;
};

let toastSeq = 0;

export const useNvUi = create<UiState>((set) => ({
  toast: null,
  dialog: null,
  showToast: (t) => set({ toast: { ...t, id: ++toastSeq } }),
  hideToast: () => set({ toast: null }),
  showDialog: (d) => set({ dialog: d }),
  hideDialog: () => set({ dialog: null }),
}));

export const toast = (t: Omit<Toast, 'id'>) => useNvUi.getState().showToast(t);
export const dialog = (d: Dialog) => useNvUi.getState().showDialog(d);

/**
 * Shared data-layer code (queues, clients) reports through the old app's
 * toast store. The new look has its own toast, so it mirrors those messages.
 */
export function bridgeAppToasts(): () => void {
  return useToastStore.subscribe((state, prev) => {
    if (!state.message || state.token === prev.token) return;
    const onPress = state.onPress ?? undefined;
    toast({ kind: 'info', title: state.message, sub: state.subtitle ?? undefined, onPress });
    useToastStore.getState().hide();
  });
}
