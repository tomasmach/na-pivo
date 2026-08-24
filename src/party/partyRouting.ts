export interface PartyRouter {
  canGoBack(): boolean;
  back(): void;
  replace(path: '/friends'): void;
}

export interface FinishedPartyRouter {
  canDismiss(): boolean;
  dismissAll(): void;
  replace(path: '/friends/party-recap'): void;
  navigate(path: '/friends/party-recap'): void;
}

type PartyFinishPath = '/party-live' | '/party-finish';
let pendingRecapSourcePath: PartyFinishPath | null = null;

/** Minimize the Party hub without trapping a cold-start deep link. */
export function minimizeParty(router: PartyRouter): void {
  if (router.canGoBack()) router.back();
  else router.replace('/friends');
}

/**
 * Remove the whole full-screen Party stack, then replace its root with recap.
 * The task deliberately survives FinishNightScreen unmounting: that unmount is
 * the first half of the navigation operation, not a reason to cancel it.
 */
export function finishPartyToRecap(
  router: FinishedPartyRouter,
  sourcePath: PartyFinishPath,
): void {
  if (pendingRecapSourcePath) return;
  pendingRecapSourcePath = sourcePath;
  if (!router.canDismiss()) {
    router.replace('/friends/party-recap');
    return;
  }
  // The recap is committed by RootLayout only after Expo confirms which route
  // the pop reached. A timer can race the native transition and leave the
  // already-finished party-live card underneath the recap on Android.
  router.dismissAll();
}

/** Commit recap after the native Party-stack dismissal changed the pathname. */
export function completePendingPartyRecapNavigation(
  router: Pick<FinishedPartyRouter, 'navigate' | 'replace'>,
  pathname: string,
): boolean {
  if (!pendingRecapSourcePath || pathname === pendingRecapSourcePath) return false;
  pendingRecapSourcePath = null;
  if (pathname === '/friends/party-recap') return true;
  if (pathname.startsWith('/party-')) {
    // Cold-start finish has party-live as its root. Replace that last Party
    // card so Back cannot resurrect an empty, already-finished evening.
    router.replace('/friends/party-recap');
  } else {
    // A normal in-app finish returned to the tab stack. Navigate within the
    // Friends stack so Back from recap has one ordinary destination: Friends.
    router.navigate('/friends/party-recap');
  }
  return true;
}

/** Account/invite-boundary cleanup for a navigation that has not committed. */
export function cancelPendingPartyRecapNavigation(): void {
  pendingRecapSourcePath = null;
}
