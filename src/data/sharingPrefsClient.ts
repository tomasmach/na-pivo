/**
 * Account sharing defaults: who sees my nights, ratings and photos by default
 * (`share_default`) and whether a finished night hangs on the Výčep by itself
 * (`night_autopublish`). Both live on GET/PATCH /v1/account/me.
 *
 * The device copy in the Výčep store is what the app reads, so the choice
 * works offline. A local change is marked dirty and pushed on the next sync;
 * a clean device adopts the server value from every account profile the app
 * reads anyway (launch, return to the app, sign-in). Never throws.
 */

import { t } from '@/i18n';
import { useToastStore } from '@/stores/toastStore';
import { useVycepStore, type NightAutopublish, type SharingPrefs } from '@/stores/vycepStore';

import { ensureAccount, getSessionToken, runAccountMeWrite } from './account';
import { chainAbortSignal, classifyQueueHttpFailure } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';
import type { NightVisibility } from './nightsClient';

const PATH = '/v1/account/me';

/** Bumped at every account boundary; a reply that straddles one belongs to the previous account. */
let boundaryGeneration = 0;
/** Bumped at every local change; a profile read that straddles one may still hold the old value. */
let localChanges = 0;

export function forgetSharingPrefsForAccountBoundary(): void {
  boundaryGeneration += 1;
}

export interface ServerSharing {
  shareDefault: NightVisibility;
  nightAutopublish: NightAutopublish;
}

export interface SharingReadTicket {
  generation: number;
  changes: number;
}

export function parseServerSharing(data: Record<string, unknown>): ServerSharing | null {
  const share = data.share_default;
  const auto = data.night_autopublish;
  if (share !== 'friends' && share !== 'public') return null;
  if (auto !== 'off' && auto !== 'friends' && auto !== 'public') return null;
  return { shareDefault: share, nightAutopublish: auto };
}

async function request(body?: Record<string, unknown>): Promise<ServerSharing | 'refused' | null> {
  if (!body) return send();
  const generation = boundaryGeneration;
  const owner = await getSessionToken();
  return runAccountMeWrite(async () => (generation === boundaryGeneration ? send(body, owner) : null));
}

async function send(body?: Record<string, unknown>, onlyAsToken?: string | null): Promise<ServerSharing | 'refused' | null> {
  const endpoint = getBackendEndpoint(PATH);
  if (!endpoint) return null;
  const session = await ensureAccount();
  if (!session || (onlyAsToken !== undefined && session.token !== onlyAsToken)) return null;
  const abort = chainAbortSignal(undefined, 9000);
  try {
    const resp = await fetch(endpoint, {
      method: body ? 'PATCH' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: abort.signal,
    });
    if (resp.status === 401) {
      await classifyQueueHttpFailure(401, session, { source: 'sharing_prefs', endpoint: PATH });
      return null;
    }
    if (!resp.ok) {
      const refused = (await classifyQueueHttpFailure(resp.status, session, { source: 'sharing_prefs', endpoint: PATH })) === 'permanent-error';
      return refused && (await getSessionToken()) === session.token ? 'refused' : null;
    }
    const remote = parseServerSharing((await resp.json()) as Record<string, unknown>);
    // A sign-in or claim while this was in flight swapped the account; the reply describes the previous one.
    return (await getSessionToken()) === session.token ? remote : null;
  } catch {
    return null;
  } finally {
    abort.cleanup();
  }
}

function adopt(remote: ServerSharing): void {
  const local = useVycepStore.getState();
  useVycepStore.getState().setSharing({
    shareDefault: remote.shareDefault,
    // The server cannot tell "chose manual" from "never chose", so a server
    // "off" keeps an unanswered device unanswered.
    nightAutopublish:
      remote.nightAutopublish === 'off' && local.nightAutopublish === null
        ? null
        : remote.nightAutopublish,
    sharingDirty: false,
  });
}

function wire(prefs: SharingPrefs): Record<string, unknown> {
  return {
    share_default: prefs.shareDefault,
    night_autopublish: prefs.nightAutopublish ?? 'off',
  };
}

function whenHydrated(): Promise<void> {
  if (useVycepStore.persist.hasHydrated()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const stop = useVycepStore.persist.onFinishHydration(() => {
      stop();
      resolve();
    });
    if (useVycepStore.persist.hasHydrated()) {
      stop();
      resolve();
    }
  });
}

/** Take before reading the account profile. Null while a local change waits for the server. */
export function sharingReadTicket(): SharingReadTicket | null {
  if (useVycepStore.getState().sharingDirty) return null;
  return { generation: boundaryGeneration, changes: localChanges };
}

/** Adopt the sharing values of an account profile read, unless something changed here since the read began. */
export function adoptServerSharing(remote: ServerSharing | undefined, ticket: SharingReadTicket | null): void {
  if (!remote || !ticket) return;
  void whenHydrated().then(() => {
    if (ticket.generation !== boundaryGeneration || ticket.changes !== localChanges) return;
    if (!useVycepStore.getState().sharingDirty) adopt(remote);
  });
}

async function pullServerSharing(): Promise<void> {
  const generation = boundaryGeneration;
  const changes = localChanges;
  const remote = await request();
  if (!remote || remote === 'refused' || generation !== boundaryGeneration || changes !== localChanges) return;
  if (!useVycepStore.getState().sharingDirty) adopt(remote);
}

/** Push a pending local change. The server value arrives with the account profile. */
export async function syncSharingPrefs(): Promise<void> {
  const generation = boundaryGeneration;
  const local = useVycepStore.getState();
  if (!local.sharingDirty) return;
  const sent = wire(local);
  const remote = await request(sent);
  const now = useVycepStore.getState();
  // A newer local change made while this PATCH was in flight stays dirty.
  if (!remote || generation !== boundaryGeneration || JSON.stringify(wire(now)) !== JSON.stringify(sent)) return;
  if (remote !== 'refused') {
    adopt(remote);
    return;
  }
  useVycepStore.getState().setSharing({ sharingDirty: false });
  useToastStore.getState().show(t.nv.profil.settings.savedSettingRefused);
  await pullServerSharing();
}

export async function flushSharingPrefs(): Promise<void> {
  await whenHydrated();
  if (useVycepStore.getState().sharingDirty) await syncSharingPrefs();
}

/** Change the defaults on this device right away and tell the server. */
export function updateSharingPrefs(
  patch: Partial<Pick<SharingPrefs, 'shareDefault' | 'nightAutopublish'>>,
): Promise<void> {
  localChanges += 1;
  useVycepStore.getState().setSharing({ ...patch, sharingDirty: true });
  return syncSharingPrefs();
}
