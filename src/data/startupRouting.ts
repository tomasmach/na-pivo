/** Pure launch-routing decisions, kept out of the root component for regression tests. */
export function shouldShowOnboardingForPath(pathname: string): boolean {
  return (
    pathname !== '/onboarding' &&
    !pathname.startsWith('/auth') &&
    !pathname.startsWith('/parta/pozvanka') &&
    !pathname.startsWith('/party-live')
  );
}

/** Run launch work after account initialization, regardless of its result. */
export function runAfterAccountInitialization(
  initialization: Promise<unknown>,
  after: () => void | Promise<void>,
): Promise<void> {
  return initialization
    .then(after, after)
    .then(() => undefined)
    .catch(() => undefined);
}

export type AccountOwnedStartupFlush =
  | 'drinks'
  | 'visits'
  | 'nights'
  | 'party-games'
  | 'party-game-starts';

const ACCOUNT_OWNED_STARTUP_FLUSHES = new Set<AccountOwnedStartupFlush>([
  'drinks',
  'visits',
  'nights',
  'party-games',
  'party-game-starts',
]);

/** Mirrors the current duplicate launch schedule until its regression is fixed. */
export function isStartupFlushOwnedByAccountInitialization(
  name: AccountOwnedStartupFlush,
): boolean {
  return ACCOUNT_OWNED_STARTUP_FLUSHES.has(name);
}
