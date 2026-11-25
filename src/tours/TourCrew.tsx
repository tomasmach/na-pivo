
import type { TourCrew } from './model';

/** The last cinknutí from this run, so the same pub is not offered again. */
export type CrewPingState = { runId: string; stopId: string; status: 'sent' | 'queued'; clientId: string };

export const crewLink = (crew: Pick<TourCrew, 'token' | 'runId'>) => `https://na-pivo.cz/t/${crew.token}?r=${crew.runId}`;
export const going = (crew: TourCrew) => (crew.members ?? []).filter((member) => !member.left);
/** The QR only while the run still takes new walkers. */
export const inviting = (crew?: TourCrew) => !!crew && !crew.closed && !crew.refused;
