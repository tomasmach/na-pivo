import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Icon, type IconName } from '../../components/Icon';
import { D, Press, T } from '../../components/ui';
import { C, s } from '../../theme';
import { t } from '@/i18n';

export function Loading({ pad = 40 }: { pad?: number }) {
  return (
    <View style={[s.center, { paddingVertical: pad }]}>
      <ActivityIndicator color={C.muted} />
    </View>
  );
}

/** The mock's empty look (round icon, display title, line of text), also for errors with a retry. */
export function EmptyState({ icon, title, body, onRetry }: { icon: IconName; title: string; body?: string; onRetry?: () => void }) {
  return (
    <View style={{ alignItems: 'center', gap: 12, paddingTop: 50 }}>
      <View style={[{ width: 64, height: 64, borderRadius: 32, backgroundColor: C.control }, s.center]}>
        <Icon name={icon} size={26} color={C.text2} />
      </View>
      <D s={30} style={{ textAlign: 'center' }}>
        {title}
      </D>
      {body ? (
        <T s={15} c={C.text2} style={{ textAlign: 'center' }}>
          {body}
        </T>
      ) : null}
      {onRetry ? (
        <Press onPress={onRetry} style={{ height: 38, paddingHorizontal: 16, borderRadius: 19, justifyContent: 'center', backgroundColor: C.control }}>
          <T s={14} w={700}>
            {t.nv.piva.retry}
          </T>
        </Press>
      ) : null}
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
