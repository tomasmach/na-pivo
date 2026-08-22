export interface PartyRouter {
  canGoBack(): boolean;
  back(): void;
  replace(path: '/friends'): void;
}

export interface FinishedPartyRouter {
  dismiss(count?: number): void;
  navigate(path: '/friends/party-recap'): void;
}

const ROOT_MODAL_DISMISS_MS = 260;
let recapNavigationTimer: ReturnType<typeof setTimeout> | null = null;

/** Minimize the Party hub without trapping a cold-start deep link. */
export function minimizeParty(router: PartyRouter): void {
  if (router.canGoBack()) router.back();
  else router.replace('/friends');
}

/**
 * Remove both full-screen Party modals, then open recap inside the Kocoviny tab.
 * The task deliberately survives FinishNightScreen unmounting: that unmount is
 * the first half of the navigation operation, not a reason to cancel it.
 */
export function finishPartyToRecap(
  router: FinishedPartyRouter,
  screensToDismiss: 1 | 2 = 1,
): void {
  if (recapNavigationTimer) return;
  router.dismiss(screensToDismiss);
  recapNavigationTimer = setTimeout(() => {
    recapNavigationTimer = null;
    // Reuse a recap already present in the Friends stack. Pushing a second
    // copy makes Back reveal the previous recap instead of Kocoviny.
    router.navigate('/friends/party-recap');
  }, ROOT_MODAL_DISMISS_MS);
}

/** Test/account-boundary cleanup for a navigation that has not fired yet. */
export function cancelPendingPartyRecapNavigation(): void {
  if (!recapNavigationTimer) return;
  clearTimeout(recapNavigationTimer);
  recapNavigationTimer = null;
}
