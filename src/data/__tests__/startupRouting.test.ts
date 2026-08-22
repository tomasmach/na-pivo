import {
  shouldAutoClaimPendingInvite,
  isStartupFlushOwnedByAccountInitialization,
  runAfterAccountInitialization,
  shouldShowOnboardingForPath,
} from '../startupRouting';

describe('startup routing', () => {
  it.each(['/auth/reset', '/auth/verify'])(
    'keeps the cold auth link %s ahead of onboarding',
    (pathname) => {
      expect(shouldShowOnboardingForPath(pathname)).toBe(false);
    },
  );

  it('does not auto-claim an invite while its explicit confirmation screen is open', () => {
    expect(shouldAutoClaimPendingInvite('/parta/pozvanka')).toBe(false);
  });

  it('keeps a cold table invite ahead of onboarding', () => {
    expect(shouldShowOnboardingForPath('/party-live')).toBe(false);
  });

  it('does not auto-claim a cold invite before the router pathname catches up', () => {
    expect(shouldAutoClaimPendingInvite('/', true)).toBe(false);
  });

  it('still takes over an ordinary fresh-install route', () => {
    expect(shouldShowOnboardingForPath('/')).toBe(true);
  });

  it('settles launch work even when account initialization rejects', async () => {
    const after = jest.fn(async () => undefined);

    await expect(
      runAfterAccountInitialization(Promise.reject(new Error('secure store unavailable')), after),
    ).resolves.toBeUndefined();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it.each(['drinks', 'visits', 'nights', 'party-games', 'party-game-starts'] as const)(
    'does not schedule %s twice during launch',
    (name) => {
      expect(isStartupFlushOwnedByAccountInitialization(name)).toBe(true);
    },
  );
});
