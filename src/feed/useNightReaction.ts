import { useCallback, useEffect, useRef, useState } from 'react';

import {
  clearNightReaction,
  isRetriableNightError,
  reactToNight,
  type PublishedNight,
} from '@/data/nightsClient';
import { enqueueNightOp } from '@/data/nightsQueue';
import { t } from '@/i18n';

type ApplyReaction = (nightId: string, rounds: number, myRound: boolean) => void;
type ShowToast = (message: string) => void;

/**
 * One backend-backed reaction controller shared by every surface rendering a
 * FeedCard. Counts change from the authoritative response; while offline they
 * change only after the operation has entered the durable night queue.
 */
export function useNightReaction(
  applyReaction: ApplyReaction,
  showToast: ShowToast,
): {
  reactingIds: ReadonlySet<string>;
  toggleReaction: (night: PublishedNight) => void;
} {
  const [reactingIds, setReactingIds] = useState<Set<string>>(() => new Set());
  const busyRef = useRef(new Set<string>());
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const finish = useCallback((nightId: string) => {
    busyRef.current.delete(nightId);
    if (!mountedRef.current) return;
    setReactingIds((current) => {
      const next = new Set(current);
      next.delete(nightId);
      return next;
    });
  }, []);

  const toggleReaction = useCallback((night: PublishedNight) => {
    if (night.isMine || busyRef.current.has(night.id)) return;

    const turningOn = !night.myRound;
    const queuedRounds = Math.max(0, night.rounds + (turningOn ? 1 : -1));
    busyRef.current.add(night.id);
    setReactingIds((current) => new Set(current).add(night.id));

    const request = turningOn ? reactToNight(night.id) : clearNightReaction(night.id);
    void request.then(async (result) => {
      if (result.ok) {
        if (mountedRef.current) {
          applyReaction(night.id, result.rounds, result.myRound);
          showToast(turningOn ? t.vycep.roundSentToast : t.vycep.roundUndoneToast);
        }
        finish(night.id);
        return;
      }

      if (isRetriableNightError(result)) {
        const operation = turningOn
          ? { op: 'round' as const, nightId: night.id }
          : { op: 'round-clear' as const, nightId: night.id };
        const queued = await enqueueNightOp(operation).catch(() => false);
        if (mountedRef.current) {
          if (queued) {
            applyReaction(night.id, queuedRounds, turningOn);
            showToast(t.vycep.roundQueuedToast);
          } else {
            applyReaction(night.id, night.rounds, night.myRound);
            showToast(t.vycep.roundErrorToast);
          }
        }
      } else if (mountedRef.current) {
        showToast(t.vycep.roundErrorToast);
      }
      finish(night.id);
    });
  }, [applyReaction, finish, showToast]);

  return { reactingIds, toggleReaction };
}
