import { useCallback, useEffect, useRef } from 'react';

import { MODAL_DISMISS_MS } from '@/stores/launchModalMutex';

/**
 * Runs a sibling-modal action after the native dismissal safety window.
 * Accessibility Reduce Motion changes animation only, never this lifecycle.
 */
export function useAfterModalDismiss(): (action: () => void) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  return useCallback(
    (action: () => void) => {
      cancel();
      timer.current = setTimeout(() => {
        timer.current = null;
        action();
      }, MODAL_DISMISS_MS);
    },
    [cancel],
  );
}
