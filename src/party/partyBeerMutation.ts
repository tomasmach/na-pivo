export type PartyBeerMutationResult =
  | 'removed'
  | 'updated'
  | 'missing'
  | 'storage-error';

export type PartyBeerMutationGate = (
  drinkId: string,
  mutate: () => Promise<PartyBeerMutationResult>,
) => Promise<boolean>;

/** Serialize every mutation of one drink and turn account-boundary rejects
 * into an explicit failure instead of an unhandled Promise. */
export function createPartyBeerMutationGate(
  onFailure: () => void,
): PartyBeerMutationGate {
  const active = new Set<string>();
  return async (
    drinkId: string,
    mutate: () => Promise<PartyBeerMutationResult>,
  ): Promise<boolean> => {
    if (active.has(drinkId)) return false;
    active.add(drinkId);
    try {
      const result = await mutate();
      if (result === 'removed' || result === 'updated') return true;
      onFailure();
      return false;
    } catch {
      onFailure();
      return false;
    } finally {
      active.delete(drinkId);
    }
  };
}

/** Keep an editor open until its mutation is durably accepted. */
export async function closeAfterDurablePartyBeerMutation(
  run: PartyBeerMutationGate,
  drinkId: string,
  mutate: () => Promise<PartyBeerMutationResult>,
  close: () => void,
  isCurrentForm: () => boolean = () => true,
): Promise<boolean> {
  const stored = await run(drinkId, mutate);
  if (stored && isCurrentForm()) close();
  return stored;
}
