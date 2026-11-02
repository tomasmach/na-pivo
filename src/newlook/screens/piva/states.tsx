import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { Spinner } from '../../components/ui';
import { s } from '../../theme';

export function Loading({ pad = 40 }: { pad?: number }) {
  return (
    <View style={[s.center, { paddingVertical: pad }]}>
      <Spinner />
    </View>
  );
}

export type Load<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T };

/**
 * Fetch once per `key` (and again on retry); the loader's null means failure.
 * Status reads as loading while the answer for the current key is out.
 */
export function useLoad<T>(key: string, loader: (signal: AbortSignal) => Promise<T | null>, enabled = true): { state: Load<T>; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const fullKey = `${key}#${attempt}`;
  const [result, setResult] = useState<{ key: string; data: T | null } | null>(null);
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void loaderRef.current(controller.signal).then((data) => {
      if (!controller.signal.aborted) setResult({ key: fullKey, data });
    });
    return () => controller.abort();
  }, [fullKey, enabled]);
  const state: Load<T> =
    !result || result.key !== fullKey ? { status: 'loading' } : result.data !== null ? { status: 'ready', data: result.data } : { status: 'error' };
  return { state, retry: () => setAttempt((n) => n + 1) };
}
