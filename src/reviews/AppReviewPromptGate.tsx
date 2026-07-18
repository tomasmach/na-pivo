import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { usePathname } from 'expo-router';

import { requestAppReviewIfEligible } from './appReview';
import { useReleaseStore } from '@/stores/releaseStore';

const LAUNCH_DELAY_MS = 4500;
const FOREGROUND_DELAY_MS = 1500;

/** Schedules policy evaluation only on a calm launch/foreground, never mid-flow. */
export function AppReviewPromptGate() {
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const releaseSettled = useReleaseStore((state) => state.checkSettled);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!releaseSettled) return;

    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      void requestAppReviewIfEligible(pathnameRef.current);
    }, LAUNCH_DELAY_MS);

    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        if (timer) clearTimeout(timer);
        timer = null;
        return;
      }
      timer = setTimeout(() => {
        void requestAppReviewIfEligible(pathnameRef.current);
      }, FOREGROUND_DELAY_MS);
    });

    return () => {
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, [releaseSettled]);

  return null;
}
