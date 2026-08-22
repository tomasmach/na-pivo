import type { PartyEvening } from '@/data/partyClient';

export interface PartyGamePlacementInput {
  catalogKey: string;
  name: string;
  scoring?: 'points' | 'drinks';
}

interface PlacePartyGameAfterTableConfirmationOptions {
  confirmedPartyCode: string | null;
  startTable: () => Promise<PartyEvening | null>;
  readConfirmedPartyCode: () => string | null;
  place: (code: string, input: PartyGamePlacementInput) => Promise<unknown>;
  input: PartyGamePlacementInput;
}

/**
 * Put a selected game on the shared table only after that table exists.
 *
 * The local game cover can be added immediately by the caller. This helper
 * guards only the backend child write: sending it against the join code reserved
 * by an in-flight create would get `party_not_active` and terminally discard an
 * otherwise valid offline placement.
 */
export async function placePartyGameAfterTableConfirmation({
  confirmedPartyCode,
  startTable,
  readConfirmedPartyCode,
  place,
  input,
}: PlacePartyGameAfterTableConfirmationOptions): Promise<boolean> {
  const table = confirmedPartyCode ? null : await startTable();
  const code = confirmedPartyCode ?? table?.joinCode ?? readConfirmedPartyCode();
  if (!code) return false;
  await place(code, input);
  return true;
}
