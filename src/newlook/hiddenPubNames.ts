import { useEffect, useState } from 'react';

import { useSettingsStore } from '@/stores/settingsStore';

export const REVEAL_SECONDS = 5;

export function useHidePubNames(): boolean {
  return useSettingsStore((s) => s.hidePubNames);
}

/** A tap shows the pub behind `key` for a few seconds, then it is a secret again. */
export function usePubNameReveal(key: string | null) {
  const hide = useHidePubNames();
  const [shown, setShown] = useState<{ key: string; until: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const until = shown !== null && shown.key === key ? shown.until : null;

  useEffect(() => {
    if (until === null) return;
    const timer = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (at >= until) setShown(null);
    }, 250);
    return () => clearInterval(timer);
  }, [until]);

  const active = until !== null && now < until;
  return {
    secret: hide && !active && key !== null,
    secondsLeft: hide && active ? Math.ceil((until - now) / 1000) : null,
    reveal: () => {
      if (!key) return;
      const at = Date.now();
      setNow(at);
      setShown({ key, until: at + REVEAL_SECONDS * 1000 });
    },
  };
}
