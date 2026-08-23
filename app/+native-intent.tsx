import {
  canonicalizeInviteSystemPath,
  inviteSystemIntent,
} from '@/data/inviteSystemPath';
import { getProcessInviteNavigationCoordinator } from '@/data/inviteNavigation';

let inviteSequence = 0;

function nextInviteRequestId(): string {
  inviteSequence += 1;
  return `${Date.now().toString(36)}-${inviteSequence.toString(36)}`;
}

/** Expo Router is the single owner of cold and warm system URLs. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const requestId = nextInviteRequestId();
    const intent = inviteSystemIntent(path);
    const coordinator = getProcessInviteNavigationCoordinator();
    if (intent?.kind === 'friend') coordinator.handleExplicitInviteCode(intent.code);
    else if (intent?.kind === 'party') coordinator.handleExplicitEntry(`party:${requestId}`);
    return canonicalizeInviteSystemPath(path, requestId, intent);
  } catch {
    return path;
  }
}
