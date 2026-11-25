/**
 * Auto-publish after Dopito: when the user chose "Samo celému světu" or
 * "Samo partě", a finished night goes on the Výčep without a tap. It runs
 * through the durable nights queue, so it lands even when the night ended
 * without signal. A pub change mid-night is not an ending and never publishes,
 * so the feed does not follow the user from pub to pub.
 */

import { drinkingDayKey, useTallyStore, type ArchivedReason, type TallySession } from '@/stores/tallyStore';
import { useVycepStore } from '@/stores/vycepStore';
import { buildNightSummary, nightPublishPayload, sessionsOfNight } from '@/vycep/nightModel';

import { enqueueNightOp } from './nightsQueue';

const NIGHT_ENDINGS: readonly ArchivedReason[] = ['manual', 'timeout', 'day-rollover'];

export function autopublishClosedNight(session: TallySession, reason: ArchivedReason): void {
  if (!NIGHT_ENDINGS.includes(reason)) return;
  const vycep = useVycepStore.getState();
  const setting = vycep.nightAutopublish;
  if (setting !== 'friends' && setting !== 'public') return;

  const dayKey = drinkingDayKey(new Date(session.startedAt));
  const { current, history } = useTallyStore.getState();
  const night = buildNightSummary(sessionsOfNight(current, history, dayKey));
  if (!night) return;

  // A night the user already hung up keeps the audience they picked for it.
  const visibility = vycep.published[night.clientKey]?.visibility ?? setting;
  vycep.markPublished(night.clientKey, visibility);
  void enqueueNightOp({ op: 'publish', payload: nightPublishPayload(night, visibility) });
}
