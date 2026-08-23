import { readFileSync } from 'node:fs';
import path from 'node:path';

import { redirectSystemPath } from '../+native-intent';
import {
  getProcessInitialNotificationNavigationTicket,
  getProcessInviteNavigationCoordinator,
  resetProcessInviteNavigationCoordinatorForTests,
} from '@/data/inviteNavigation';

const ROOT = path.join(__dirname, '..', '..');

describe('native invite routing', () => {
  beforeEach(() => resetProcessInviteNavigationCoordinatorForTests());
  it.each([true, false])('uses the same canonical friend route on initial=%s', (initial) => {
    expect(
      redirectSystemPath({
        path: 'napivo://parta/pozvanka?code=Ab3xK9_pQ2sT',
        initial,
      }),
    ).toBe('/parta/pozvanka?code=Ab3xK9_pQ2sT');
  });

  it.each([true, false])('opens the party join sheet on initial=%s', (initial) => {
    expect(
      redirectSystemPath({ path: 'https://na-pivo.cz/party/EFJ66G', initial }),
    ).toMatch(/^\/party-live\?joinCode=EFJ66G&invite=[a-z0-9]+-[a-z0-9]+$/);
  });

  it('records a cold party URL before a pending friend restore can resolve', () => {
    const coordinator = getProcessInviteNavigationCoordinator();
    const restore = coordinator.beginRestoreLookup();

    redirectSystemPath({ path: 'napivo://party-live?code=EFJ66G', initial: true });

    expect(coordinator.resolveRestoreLookup(restore, 'stashed-friend-code').action).toBe('none');
  });

  it('lets a cold URL beat the older process-level initial-notification lookup', () => {
    const coordinator = getProcessInviteNavigationCoordinator();
    const notificationTicket = getProcessInitialNotificationNavigationTicket();

    redirectSystemPath({ path: 'napivo://party-live?code=EFJ66G', initial: true });

    expect(
      coordinator.resolveExplicitEntry(notificationTicket, 'notification:initial'),
    ).toBe(false);
  });

  it('does not restore a pending friend after the explicit party route was consumed and left', () => {
    const coordinator = getProcessInviteNavigationCoordinator();

    redirectSystemPath({ path: 'napivo://party-live?code=EFJ66G', initial: true });
    coordinator.leaveConfirmation();
    const restore = coordinator.beginRestoreLookup();

    expect(coordinator.resolveRestoreLookup(restore, 'stashed-friend-code')).toEqual({
      action: 'none',
      code: null,
    });
  });

  it('does not consume unmatched routes or loop an already canonical route', () => {
    expect(redirectSystemPath({ path: '/friends/parta', initial: false })).toBe('/friends/parta');
    expect(
      redirectSystemPath({
        path: '/parta/pozvanka?code=Ab3xK9_pQ2sT',
        initial: false,
      }),
    ).toBe('/parta/pozvanka?code=Ab3xK9_pQ2sT');
  });

  it('keeps RootLayout out of native URL subscription and second navigation', () => {
    const source = readFileSync(path.join(ROOT, 'app', '_layout.tsx'), 'utf8');
    expect(source).not.toContain('Linking.getInitialURL');
    expect(source).not.toContain("Linking.addEventListener('url'");
    expect(source).not.toContain('parsePartyInviteCodeFromUrl');
    expect(source).toContain('useGlobalSearchParams');
    expect(source).toContain('handleExplicitInviteCode(routeInviteCode)');
    expect(source).toContain('stashPendingInviteCode(routeInviteCode)');
    expect(source).toContain('if (!inviteRouteWasVisibleRef.current) return;');
    expect(source).toContain('getProcessInitialNotificationNavigationTicket');
    expect(source).toContain('prepareExplicitEntry(intentKey)');

    const warmNotificationSetup = source.slice(
      source.indexOf('const prepareWarmNotificationNavigation'),
      source.indexOf('return () => {', source.indexOf('const prepareWarmNotificationNavigation')),
    );
    expect(warmNotificationSetup.indexOf('prepareWarmNotificationNavigation')).toBeLessThan(
      warmNotificationSetup.indexOf('subscribePubReminderTap'),
    );
    expect(warmNotificationSetup.indexOf('prepareWarmNotificationNavigation')).toBeLessThan(
      warmNotificationSetup.indexOf('subscribeBeerCountReminderTap'),
    );

    const canonicalOwner = source.slice(
      source.indexOf('// Expo Router is the sole URL consumer.'),
      source.indexOf('useEffect(() => {\n    routerRef.current = router;'),
    );
    expect(canonicalOwner).not.toContain('router.push');
    expect(canonicalOwner).not.toContain('router.replace');
  });

  it('keeps invite back navigation safe on a cold-start stack', () => {
    const source = readFileSync(path.join(ROOT, 'app', 'parta', 'pozvanka.tsx'), 'utf8');
    expect(source).toContain('if (router.canGoBack()) router.back()');
    expect(source).toContain("else router.replace('/friends/parta'");
  });
});
