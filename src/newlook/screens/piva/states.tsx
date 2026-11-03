import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { readScreenCache, screenCacheGeneration, writeScreenCache } from '@/data/screenCache';

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
 * Status reads as loading while the answer for the current key is out, unless
 * `cacheAs` names a cache: then the last answer for the key shows meanwhile.
 */
export function useLoad<T>(
  key: string,
  loader: (signal: AbortSignal) => Promise<T | null>,
  enabled = true,
  cacheAs?: string,
): { state: Load<T>; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const fullKey = `${key}#${attempt}`;
  const cacheKey = cacheAs ? `${cacheAs}:${key}` : null;
  const [result, setResult] = useState<{ key: string; data: T | null } | null>(null);
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const since = screenCacheGeneration();
    void loaderRef.current(controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      if (cacheKey && data !== null) writeScreenCache(cacheKey, data, since);
      setResult({ key: fullKey, data });
    });
    return () => controller.abort();
  }, [fullKey, enabled, cacheKey]);
  const fresh = result && result.key === fullKey ? result.data : undefined;
  const data = fresh ?? (cacheKey ? readScreenCache<T>(cacheKey) : undefined) ?? null;
  const state: Load<T> = data !== null ? { status: 'ready', data } : fresh === undefined ? { status: 'loading' } : { status: 'error' };
  return { state, retry: () => setAttempt((n) => n + 1) };
}
