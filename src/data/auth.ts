/**
 * Auth client — email/password + Google + Apple sign-in, account linking, and
 * account deletion against the na-pivo backend (/v1/auth/*, /v1/account/me).
 *
 * Layered on the session plumbing in src/data/account.ts: the anonymous device
 * account is the bootstrap, and signing in CLAIMS it (the backend re-parents the
 * device account's data onto the credential) so the user's drinks/ratings/visits
 * follow them. On success we persist the new bearer token via setSession(); on
 * sign-out / deletion we revertToAnonymous().
 *
 * Every call resolves to a discriminated AuthResult — never throws — so screens
 * can render an error message without try/catch. Provider tokens come from the
 * native SDK wrappers in src/data/socialAuth.ts.
 */

import { File, UploadType } from 'expo-file-system';

import {
  ensureAccount,
  ensureCredentialBindingForSession,
  generateUuidV4,
  getSessionToken,
  readDurableAccountSession,
  revertToAnonymous,
  setSession,
  type AccountSession,
} from './account';
import {
  parseAchievementsBlock,
  type AccountAchievements,
  type RawAchievementsBlock,
} from './achievements';
import { getBackendEndpoint } from './backendConfig';
import {
  flushBeerPhotoDeletionsForAccountMerge,
  flushBeerPhotoDeletionsBeforeSessionEnd,
} from './beerPhotoDeletionSync';
import {
  beginBeerPhotoSessionTransition,
  setBeerPhotoDeletionRecoveryBlocked,
  type BeerPhotoSessionTransition,
} from './beerPhotoSessionBoundary';
import {
  archiveAccountDeletionReceipt,
  clearAccountDeletionReceipt,
  completeAccountDeletionReceipt,
  readAccountDeletionReceipt,
  retireAccountDeletionOrphan,
  retireQuarantinedAccountDeletionReceipt,
  writeAccountDeletionReceipt,
  type AccountDeletionOrphan,
} from './accountDeletionReceipt';
import {
  clearLocalPrivateAccountData,
  rehydratePrivateStoresAfterBoundary,
} from './privateAccountData';
import { rekeyAccountPreferencesQueueOwner } from './accountPreferencesQueue';
import { rekeyPartyEveningIdentityOwner } from './partyEveningIdentityCache';
import {
  beginPrivateAccountTransition,
  readPrivateAccountMergeIntent,
  setPrivateAccountDeletionRecoveryBlocked,
  setPrivateAccountRehydrationRecoveryBlocked,
  type PrivateAccountTransition,
} from './privateAccountBoundary';
import {
  cancelUncommittedPartyGameAccountMerge,
  finalizePartyGameQueuesForAccountMerge,
  preflightPartyGameQueuesForAccountMerge,
  promotePartyGameQueuesAccountMerge,
} from './partyGameStartsQueue';
import {
  disableCachedPushDeviceWithBearer,
  registerCachedPushDeviceWithBearer,
} from './pushDeviceClient';
import { getAppleCredential, getGoogleIdToken, SocialAuthError } from './socialAuth';
import { trackApiFailure } from './telemetryClient';
import {
  parseUgcConsentSnapshot,
  rememberUgcConsent,
  type UgcConsentSnapshot,
} from './ugcConsent';
import { refreshPartyGamesAfterAccountMerge } from '@/stores/partyGamesStore';

const REQUEST_TIMEOUT_MS = 12000;

export type AuthProvider = 'email' | 'google' | 'apple';

export interface AccountSettings {
  mode?: 'nearest' | 'surprise';
  maxDistanceKm?: number | null;
  priceCurrency?: 'CZK' | 'EUR';
  hapticEnabled?: boolean;
  soundEnabled?: boolean;
  hideClosedPubs?: boolean;
  hidePubNames?: boolean;
  marketingEmailsEnabled?: boolean;
}

export interface AccountSubscription {
  tier: 'free' | 'plus';
  status: 'inactive' | 'pending_verification' | 'active' | 'grace_period' | 'expired';
  platform: string;
  productId: string;
  originalTransactionId: string;
  expiresAt: string | null;
  updatedAt: string | null;
}

export interface AccountStats {
  totalBeers: number;
  firstBeerAt: string | null;
  distinctPubs: number;
  ratingsCount: number;
  totalSpentCzk: number;
  maxVisitsToOnePub: number;
}

export { EMPTY_ACHIEVEMENTS, parseAchievementsBlock } from './achievements';
export type { AccountAchievements, RawAchievementsBlock } from './achievements';

/** One level rung of the Mapér ladder (server copy of the locked table). */
export interface MapperLevel {
  level: number;
  title: string;
  xp: number;
}

/** Env-default XP constants exposed so the optimistic toast estimates from a
 *  shared source of truth (spec §5.1/§5.4). */
export interface MapperXpRules {
  firstFact: number;
  firstMapperBonus: number;
  confirm: number;
  pubCompleteBonus: number;
}

/** The Mapér gamification block off GET /v1/account/me (spec §5.4). */
export interface AccountMapper {
  /** Durable XP total. */
  xp: number;
  level: number;
  title: string;
  xpIntoLevel: number;
  xpForNextLevel: number | null;
  amenityVotesCount: number;
  distinctMappedPubs: number;
  firstMapperCount: number;
  completedPubsCount: number;
  levels: MapperLevel[];
  xpRules: MapperXpRules;
}

/** The Pivař gamification block off GET /v1/account/me — the drink-logging
 *  ladder, parallel to the Mapér block. Level rungs share MapperLevel's shape. */
export interface AccountPivar {
  /** Durable XP total. */
  xp: number;
  level: number;
  title: string;
  xpIntoLevel: number;
  xpForNextLevel: number | null;
  levels: MapperLevel[];
}

export interface AccountProfile {
  id: string;
  deviceId: string;
  /** Unique public handle (without the leading @). Null until the user picks one. */
  nickname: string | null;
  /** Optional real/display name. */
  displayName: string;
  /** Absolute, loadable avatar URL minted by the backend, or null. */
  avatarUrl: string | null;
  /** Public-by-default visibility. */
  isPublic: boolean;
  email: string;
  emailVerified: boolean;
  providers: AuthProvider[];
  isAnonymous: boolean;
  status: string;
  /** Present on auth responses: whether this provider sign-in created a new account. */
  created?: boolean;
  settings?: AccountSettings;
  subscription?: AccountSubscription;
  stats?: AccountStats;
  achievements?: AccountAchievements;
  usage?: { walkedDistanceM: number };
  /** Mapér gamification snapshot — attached only when the backend returns it. */
  mapper?: AccountMapper;
  /** Pivař gamification snapshot — attached only when the backend returns it. */
  pivar?: AccountPivar;
  /** UGC consent snapshot — attached only when the backend returns it. */
  ugcConsent?: UgcConsentSnapshot;
}

/** Success carries the fresh account state; failure carries a code + message. */
export type AuthResult =
  | { ok: true; profile: AccountProfile }
  | {
      ok: false;
      code: string;
      detail: string;
      /** B is already durable; the store must publish it despite this UI failure. */
      committedProfile?: AccountProfile;
    };

/** Lightweight ok/err result for calls that don't return a profile. */
export type AuthActionResult = { ok: true } | { ok: false; code: string; detail: string };

/** Result of explicitly checking a credential-backed session on app resume. */
export type SessionValidationResult =
  | { status: 'valid'; profile: AccountProfile }
  | { status: 'invalid' }
  | { status: 'unavailable' };

interface RawAccount {
  id?: string;
  device_id?: string;
  nickname?: string | null;
  display_name?: string;
  is_public?: boolean;
  created?: boolean;
  avatar_url?: string | null;
  /** Defensive alias some providers/responses use instead of avatar_url. */
  picture?: string | null;
  has_avatar?: boolean;
  settings?: {
    mode?: string;
    max_distance_km?: number | null;
    price_currency?: string;
    haptic_enabled?: boolean;
    sound_enabled?: boolean;
    hide_closed_pubs?: boolean;
    hide_pub_names?: boolean;
    marketing_emails_enabled?: boolean;
  };
  subscription?: {
    tier?: string;
    status?: string;
    platform?: string;
    product_id?: string;
    original_transaction_id?: string;
    expires_at?: string | null;
    updated_at?: string | null;
  };
  stats?: {
    total_beers?: number;
    first_beer_at?: string | null;
    distinct_pubs?: number;
    ratings_count?: number;
    total_spent_czk?: number;
    max_visits_to_one_pub?: number;
  };
  achievements?: RawAchievementsBlock;
  usage?: { walked_distance_m?: number };
  mapper?: {
    xp?: number;
    level?: number;
    title?: string;
    xp_into_level?: number;
    xp_for_next_level?: number | null;
    amenity_votes_count?: number;
    distinct_mapped_pubs?: number;
    first_mapper_count?: number;
    completed_pubs_count?: number;
    levels?: { level?: number; title?: string; xp?: number }[];
    xp_rules?: {
      first_fact?: number;
      first_mapper_bonus?: number;
      confirm?: number;
      pub_complete_bonus?: number;
    };
  };
  pivar?: {
    xp?: number;
    level?: number;
    title?: string;
    xp_into_level?: number;
    xp_for_next_level?: number | null;
    levels?: { level?: number; title?: string; xp?: number }[];
  };
  ugc_consent?: unknown;
  email?: string;
  email_verified?: boolean;
  providers?: string[];
  is_anonymous?: boolean;
  status?: string;
  token?: string;
}

const CANCELLED: AuthResult = { ok: false, code: 'cancelled', detail: '' };

function parseSettings(data: RawAccount): AccountSettings | undefined {
  const raw = data.settings;
  if (!raw) return undefined;
  return {
    mode: raw.mode === 'nearest' || raw.mode === 'surprise' ? raw.mode : undefined,
    maxDistanceKm:
      typeof raw.max_distance_km === 'number' || raw.max_distance_km === null
        ? raw.max_distance_km
        : undefined,
    priceCurrency:
      raw.price_currency === 'CZK' || raw.price_currency === 'EUR'
        ? raw.price_currency
        : undefined,
    hapticEnabled: typeof raw.haptic_enabled === 'boolean' ? raw.haptic_enabled : undefined,
    soundEnabled: typeof raw.sound_enabled === 'boolean' ? raw.sound_enabled : undefined,
    hideClosedPubs:
      typeof raw.hide_closed_pubs === 'boolean' ? raw.hide_closed_pubs : undefined,
    hidePubNames: typeof raw.hide_pub_names === 'boolean' ? raw.hide_pub_names : undefined,
    marketingEmailsEnabled:
      typeof raw.marketing_emails_enabled === 'boolean'
        ? raw.marketing_emails_enabled
        : undefined,
  };
}

function parseSubscription(data: RawAccount): AccountSubscription | undefined {
  const raw = data.subscription;
  if (!raw) return undefined;
  const tier = raw.tier === 'plus' ? 'plus' : 'free';
  const allowedStatus: AccountSubscription['status'][] = [
    'inactive',
    'pending_verification',
    'active',
    'grace_period',
    'expired',
  ];
  const status = allowedStatus.includes(raw.status as AccountSubscription['status'])
    ? (raw.status as AccountSubscription['status'])
    : 'inactive';
  return {
    tier,
    status,
    platform: typeof raw.platform === 'string' ? raw.platform : '',
    productId: typeof raw.product_id === 'string' ? raw.product_id : '',
    originalTransactionId:
      typeof raw.original_transaction_id === 'string' ? raw.original_transaction_id : '',
    expiresAt: typeof raw.expires_at === 'string' ? raw.expires_at : null,
    updatedAt: typeof raw.updated_at === 'string' ? raw.updated_at : null,
  };
}

function parseStats(data: RawAccount): AccountStats | undefined {
  const raw = data.stats;
  if (!raw) return undefined;
  return {
    totalBeers: typeof raw.total_beers === 'number' ? raw.total_beers : 0,
    firstBeerAt: typeof raw.first_beer_at === 'string' ? raw.first_beer_at : null,
    distinctPubs: typeof raw.distinct_pubs === 'number' ? raw.distinct_pubs : 0,
    ratingsCount: typeof raw.ratings_count === 'number' ? raw.ratings_count : 0,
    totalSpentCzk: typeof raw.total_spent_czk === 'number' ? raw.total_spent_czk : 0,
    maxVisitsToOnePub:
      typeof raw.max_visits_to_one_pub === 'number' ? raw.max_visits_to_one_pub : 0,
  };
}

function parseAchievements(data: RawAccount): AccountAchievements | undefined {
  const raw = data.achievements;
  if (!raw) return undefined;
  // Every badge is additive; absent fields (older backends) stay false.
  return parseAchievementsBlock(raw);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Parse the Mapér block off GET /v1/account/me (spec §5.4). Returns undefined when
 * the block is absent so the Profile can distinguish "no Mapér data yet" from a
 * real zero. The `xp` key (NOT `mapper_xp`) is the durable XP total; level/title/
 * xp_into_level/xp_for_next_level are server-derived; `levels` is the server copy
 * of the locked ladder; `xp_rules` is required so the optimistic toast estimates
 * from a shared source of truth.
 */
function parseMapper(data: RawAccount): AccountMapper | undefined {
  const raw = data.mapper;
  if (!raw) return undefined;
  const levels: MapperLevel[] = Array.isArray(raw.levels)
    ? raw.levels.map((l) => ({
        level: numberOr(l?.level, 0),
        title: typeof l?.title === 'string' ? l.title : '',
        xp: numberOr(l?.xp, 0),
      }))
    : [];
  const rules = raw.xp_rules ?? {};
  return {
    xp: numberOr(raw.xp, 0),
    level: numberOr(raw.level, 1),
    title: typeof raw.title === 'string' ? raw.title : '',
    xpIntoLevel: numberOr(raw.xp_into_level, 0),
    xpForNextLevel: raw.xp_for_next_level === null ? null : numberOr(raw.xp_for_next_level, 0),
    amenityVotesCount: numberOr(raw.amenity_votes_count, 0),
    distinctMappedPubs: numberOr(raw.distinct_mapped_pubs, 0),
    firstMapperCount: numberOr(raw.first_mapper_count, 0),
    completedPubsCount: numberOr(raw.completed_pubs_count, 0),
    levels,
    xpRules: {
      firstFact: numberOr(rules.first_fact, 0),
      firstMapperBonus: numberOr(rules.first_mapper_bonus, 0),
      confirm: numberOr(rules.confirm, 0),
      pubCompleteBonus: numberOr(rules.pub_complete_bonus, 0),
    },
  };
}

/** Parse the Pivař block off GET /v1/account/me — parallel to parseMapper.
 *  Returns undefined when absent (older backend) so the Profile can hide the
 *  section instead of showing a fake zero. */
function parsePivar(data: RawAccount): AccountPivar | undefined {
  const raw = data.pivar;
  if (!raw) return undefined;
  const levels: MapperLevel[] = Array.isArray(raw.levels)
    ? raw.levels.map((l) => ({
        level: numberOr(l?.level, 0),
        title: typeof l?.title === 'string' ? l.title : '',
        xp: numberOr(l?.xp, 0),
      }))
    : [];
  return {
    xp: numberOr(raw.xp, 0),
    level: numberOr(raw.level, 1),
    title: typeof raw.title === 'string' ? raw.title : '',
    xpIntoLevel: numberOr(raw.xp_into_level, 0),
    xpForNextLevel: raw.xp_for_next_level === null ? null : numberOr(raw.xp_for_next_level, 0),
    levels,
  };
}

function parseUsage(data: RawAccount): AccountProfile['usage'] | undefined {
  const walked = data.usage?.walked_distance_m;
  if (typeof walked !== 'number' || !Number.isFinite(walked)) return undefined;
  return { walkedDistanceM: walked };
}

function parseProfile(data: RawAccount): AccountProfile {
  const profile: AccountProfile = {
    id: data.id ?? '',
    deviceId: data.device_id ?? '',
    // An empty/missing nickname means the user hasn't picked a handle yet.
    nickname: typeof data.nickname === 'string' && data.nickname.length > 0 ? data.nickname : null,
    displayName: data.display_name ?? '',
    // Public-by-default: only an explicit false makes the profile private.
    isPublic: data.is_public !== false,
    // Backend guarantees an absolute, loadable URL; `picture` is a defensive alias.
    avatarUrl: (data.avatar_url ?? data.picture) || null,
    email: data.email ?? '',
    emailVerified: data.email_verified === true,
    providers: (data.providers ?? []) as AuthProvider[],
    // Treat a missing flag as anonymous; only an explicit false means signed in.
    isAnonymous: data.is_anonymous !== false,
    status: data.status ?? 'active',
  };
  if (typeof data.created === 'boolean') profile.created = data.created;
  const settings = parseSettings(data);
  const subscription = parseSubscription(data);
  const stats = parseStats(data);
  const achievements = parseAchievements(data);
  const usage = parseUsage(data);
  const mapper = parseMapper(data);
  const pivar = parsePivar(data);
  if (settings) profile.settings = settings;
  if (subscription) profile.subscription = subscription;
  if (stats) profile.stats = stats;
  if (achievements) profile.achievements = achievements;
  if (usage) profile.usage = usage;
  if (mapper) profile.mapper = mapper;
  if (pivar) profile.pivar = pivar;
  const ugcConsent = parseUgcConsentSnapshot(data.ugc_consent);
  if (ugcConsent) {
    profile.ugcConsent = ugcConsent;
    // Prime the per-account policy header cache only for a real owner.
    if (profile.id) rememberUgcConsent(profile.id, ugcConsent);
  }
  return profile;
}

/** Turn a backend error body into a stable {code, detail}. Handles both our
 *  {detail, code} shape and DRF's field-error dict ({field: [msg, ...]}). */
function extractError(data: unknown, status: number): { code: string; detail: string } {
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (typeof obj.detail === 'string') {
      return { code: typeof obj.code === 'string' ? obj.code : `http_${status}`, detail: obj.detail };
    }
    // DRF field errors: take the first message.
    for (const value of Object.values(obj)) {
      if (Array.isArray(value) && typeof value[0] === 'string') {
        return { code: `http_${status}`, detail: value[0] };
      }
      if (typeof value === 'string') {
        return { code: `http_${status}`, detail: value };
      }
    }
  }
  return { code: `http_${status}`, detail: 'Něco se pokazilo. Zkus to prosím znovu.' };
}

interface FetchOutcome {
  status: number;
  ok: boolean;
  data: RawAccount & Record<string, unknown>;
}

/**
 * POST/DELETE a JSON body to an auth endpoint. `bearer`:
 *  - 'current'  → attach the current session token (authenticated calls);
 *  - 'ensure'   → ensure an anonymous account first, attach its token (claim);
 *  - 'claim'    → attach only an anonymous session token (best-effort merge hint);
 *  - 'none'     → no Authorization header.
 * Returns a network-error sentinel instead of throwing.
 */
async function authFetch(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    bearer?: 'current' | 'ensure' | 'claim' | 'none';
    /** Additional non-secret/capability headers for the exact endpoint. */
    headers?: Record<string, string>;
    /** Captured before a credential transition so auth and privacy flush agree. */
    session?: AccountSession | null;
  },
): Promise<FetchOutcome | { networkError: true }> {
  const endpoint = getBackendEndpoint(path);
  if (!endpoint) return { networkError: true };

  let token: string | null = null;
  try {
    if (opts.bearer === 'ensure') {
      const session = Object.prototype.hasOwnProperty.call(opts, 'session')
        ? opts.session
        : await ensureAccount();
      token = session?.token ?? null;
    } else if (opts.bearer === 'claim') {
      const session = Object.prototype.hasOwnProperty.call(opts, 'session')
        ? opts.session
        : await ensureAccount();
      token = session && !session.authenticated ? session.token : null;
    } else if (opts.bearer === 'current') {
      token = Object.prototype.hasOwnProperty.call(opts, 'session')
        ? opts.session?.token ?? null
        : await getSessionToken();
    }
  } catch (error) {
    trackApiFailure('auth_request', {
      endpoint: path,
      reason: 'session_unavailable',
      error,
    });
    return { networkError: true };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...opts.headers,
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const resp = await fetch(endpoint, {
      method: opts.method ?? 'POST',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    let data: Record<string, unknown> = {};
    try {
      // 204 / empty bodies parse to {}.
      const text = await resp.text();
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      data = {};
    }
    return { status: resp.status, ok: resp.ok, data };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (!isAbort) {
      trackApiFailure('auth_request', { endpoint: path, reason: 'exception', error: err });
    }
    return { networkError: true };
  } finally {
    clearTimeout(timeoutId);
  }
}

const NETWORK_ERROR = {
  ok: false as const,
  code: 'network',
  detail: 'Nepodařilo se spojit se serverem. Zkontroluj připojení a zkus to znovu.',
};

const PHOTO_DELETIONS_PENDING = {
  ok: false as const,
  code: 'photo_deletions_pending',
  detail:
    'Nejdřív potřebujeme dosmazat fotky. Připoj se k internetu a zkus to znovu.',
};

const PHOTO_DELETIONS_REKEY_FAILED = {
  ok: false as const,
  code: 'photo_deletions_storage',
  detail:
    'Rozpracované mazání fotek se nepodařilo bezpečně převést. Uvolni místo v telefonu a zkus to znovu.',
};

const SESSION_BOUNDARY_FAILED = {
  ok: false as const,
  code: 'session_storage',
  detail:
    'Odhlášení se nepodařilo bezpečně dokončit. Odemkni telefon a zkus to znovu.',
};

const CREDENTIAL_BOUNDARY_FAILED = {
  ok: false as const,
  code: 'session_storage',
  detail:
    'Přihlášení nejde bezpečně dokončit, dokud se nesmažou stará data v telefonu. Uvolni místo a zkus to znovu.',
};

const ACCOUNT_DELETION_RECEIPT_FAILED = {
  ok: false as const,
  code: 'account_deletion_storage',
  detail:
    'Žádost o smazání nejde v telefonu bezpečně dokončit. Uvolni místo, odemkni telefon a zkus to znovu.',
};

const ACCOUNT_DELETION_RECOVERED = {
  ok: false as const,
  code: 'account_deletion_recovered',
  detail:
    'Předchozí mazání jsme dokončili. Pokud chceš smazat i aktuální účet, potvrď to znovu.',
};

interface CredentialTransition {
  outgoingSession: AccountSession | null;
  photoSessionTransition: BeerPhotoSessionTransition;
  privateAccountTransition: PrivateAccountTransition | null;
  /** Login/social endpoints merge an anonymous source into their target. */
  mergesAnonymousAccount: boolean;
  /** Only true after a strict pre-auth read proved A has no pending marker. */
  strictMergePreflightClean: boolean;
  /** Phase-0 game queue freeze persisted before a merge-capable HTTP request. */
  partyGameMerge: {
    sourceAccountId: string;
    operationId: string;
    cancelSafe: boolean;
  } | null;
  /** Authorized rehydrate already succeeded while the durable marker was held. */
  privateStoresRehydrated?: boolean;
  blockingResult?: Extract<AuthActionResult, { ok: false }>;
}

async function prepareCredentialTransition(
  mergesAnonymousAccount: boolean,
): Promise<CredentialTransition> {
  const privateAccountTransition = beginPrivateAccountTransition('credential-auth');
  const photoSessionTransition = beginBeerPhotoSessionTransition();
  if (!privateAccountTransition) {
    return {
      outgoingSession: null,
      photoSessionTransition,
      privateAccountTransition: null,
      mergesAnonymousAccount,
      strictMergePreflightClean: false,
      partyGameMerge: null,
      blockingResult: CREDENTIAL_BOUNDARY_FAILED,
    };
  }
  let outgoingSession: AccountSession | null = null;
  let preflight: Awaited<ReturnType<typeof flushBeerPhotoDeletionsBeforeSessionEnd>>;
  try {
    await privateAccountTransition.drain();
    const durableSession = await readDurableAccountSession();
    if (!durableSession.available) throw new Error('Secure session is unavailable.');
    outgoingSession = durableSession.session;
    if (outgoingSession && !privateAccountTransition.bindOwner(outgoingSession.accountId)) {
      throw new Error('Credential boundary owner changed.');
    }

    const mergeIntent = await readPrivateAccountMergeIntent();
    if (
      !mergeIntent.ok ||
      (mergeIntent.intent &&
        (!mergesAnonymousAccount ||
          !outgoingSession ||
          outgoingSession.authenticated ||
          mergeIntent.intent.fromAccountId !== outgoingSession.accountId))
    ) {
      throw new Error('Anonymous account merge owner is unavailable.');
    }
    preflight = await flushBeerPhotoDeletionsBeforeSessionEnd({
      session: outgoingSession,
      preferProvidedSession: true,
    });
  } catch {
    // Public auth actions are deliberately never-throw. Keep the transition
    // handle alive until the caller returns the fail-closed result so photo
    // mutations cannot slip into the boundary between this catch and cleanup.
    return {
      outgoingSession,
      photoSessionTransition,
      privateAccountTransition,
      mergesAnonymousAccount,
      strictMergePreflightClean: false,
      partyGameMerge: null,
      blockingResult: CREDENTIAL_BOUNDARY_FAILED,
    };
  }
  const mustFinishAnonymousDeletes =
    mergesAnonymousAccount &&
    !!outgoingSession &&
    !outgoingSession.authenticated &&
    (preflight.remaining !== 0 || preflight.storageError);
  const missingOwnerCannotCrossBoundary =
    !outgoingSession && (preflight.remaining !== 0 || preflight.storageError);
  const preflightStorageCannotCrossBoundary = preflight.storageError;
  const blockingResult =
    mustFinishAnonymousDeletes ||
    missingOwnerCannotCrossBoundary ||
    preflightStorageCannotCrossBoundary
      ? preflight.storageError
        ? PHOTO_DELETIONS_REKEY_FAILED
        : PHOTO_DELETIONS_PENDING
      : undefined;
  if (blockingResult) {
    return {
      outgoingSession,
      photoSessionTransition,
      privateAccountTransition,
      mergesAnonymousAccount,
      strictMergePreflightClean: preflight.remaining === 0 && !preflight.storageError,
      partyGameMerge: null,
      blockingResult,
    };
  }

  let partyGameMerge: CredentialTransition['partyGameMerge'] = null;
  if (mergesAnonymousAccount && outgoingSession && !outgoingSession.authenticated) {
    try {
      const preflightResult = await preflightPartyGameQueuesForAccountMerge(
        outgoingSession.accountId,
        privateAccountTransition,
      );
      if (!preflightResult) {
        return {
          outgoingSession,
          photoSessionTransition,
          privateAccountTransition,
          mergesAnonymousAccount,
          strictMergePreflightClean: true,
          partyGameMerge: null,
          blockingResult: CREDENTIAL_BOUNDARY_FAILED,
        };
      }
      partyGameMerge = {
        sourceAccountId: outgoingSession.accountId,
        operationId: preflightResult.operationId,
        cancelSafe: preflightResult.cancelSafe,
      };
    } catch {
      return {
        outgoingSession,
        photoSessionTransition,
        privateAccountTransition,
        mergesAnonymousAccount,
        strictMergePreflightClean: true,
        partyGameMerge: null,
        blockingResult: CREDENTIAL_BOUNDARY_FAILED,
      };
    }
  }

  return {
    outgoingSession,
    photoSessionTransition,
    privateAccountTransition,
    mergesAnonymousAccount,
    strictMergePreflightClean: preflight.remaining === 0 && !preflight.storageError,
    partyGameMerge,
  };
}

async function abortCredentialTransition<T>(
  transition: CredentialTransition,
  result: T,
  options?: { cancelUncommittedPartyGameMerge?: boolean },
): Promise<T | Extract<AuthActionResult, { ok: false }>> {
  if (
    options?.cancelUncommittedPartyGameMerge &&
    transition.partyGameMerge?.cancelSafe
  ) {
    try {
      const cancelled = await cancelUncommittedPartyGameAccountMerge(
        transition.partyGameMerge.sourceAccountId,
        transition.partyGameMerge.operationId,
      );
      if (!cancelled) result = CREDENTIAL_BOUNDARY_FAILED as T;
    } catch {
      result = CREDENTIAL_BOUNDARY_FAILED as T;
    }
  }
  return (await finishCredentialTransitionRehydration(transition))
    ? result
    : CREDENTIAL_BOUNDARY_FAILED;
}

/**
 * A failed persisted-store read resets private memory. Freeze before releasing
 * the transition so no empty-memory write can overwrite the durable snapshot;
 * only a complete authorized rehydrate may thaw producers again.
 */
async function finishCredentialTransitionRehydration(
  transition: CredentialTransition,
): Promise<boolean> {
  setPrivateAccountRehydrationRecoveryBlocked(true);
  transition.photoSessionTransition.release();
  transition.privateAccountTransition?.release();
  if (transition.privateStoresRehydrated) {
    setPrivateAccountRehydrationRecoveryBlocked(false);
    return true;
  }
  try {
    const rehydrated = await rehydratePrivateStoresAfterBoundary();
    if (rehydrated) setPrivateAccountRehydrationRecoveryBlocked(false);
    return rehydrated;
  } catch {
    return false;
  }
}

function authFailureCanSafelyCancelMergePreflight(res: FetchOutcome): boolean {
  // Auth endpoints are atomic for validated client failures. A 5xx may have
  // lost a success response after committing the merge, so it stays frozen.
  return res.status >= 400 && res.status < 500;
}

/** Apply a successful auth response: persist the new session, return the profile. */
async function applyAuthSuccessInner(
  data: RawAccount,
  transition?: CredentialTransition,
  onSessionCommitted?: (profile: AccountProfile) => void,
): Promise<AuthResult> {
  const profile = parseProfile(data);
  if (!data.token || !profile.id) {
    trackApiFailure('auth_session', { reason: 'auth_success_missing_session' });
    return {
      ok: false,
      code: 'protocol',
      detail: 'Server neposlal platné přihlášení. Zkus to prosím znovu.',
    };
  }

  const outgoing = transition?.outgoingSession ?? null;
  const accountChanged = !!outgoing && outgoing.accountId !== profile.id;
  let shouldClearLocalPrivateData = false;
  const incomingSession = {
    deviceId: profile.deviceId || undefined,
    accountId: profile.id,
    token: data.token,
    authenticated: true,
  };
  const incomingDeletionSession: AccountSession = {
    ...incomingSession,
    deviceId: profile.deviceId || outgoing?.deviceId || '',
  };
  const partyGameMerge = transition?.partyGameMerge ?? null;
  if (partyGameMerge) {
    try {
      const targetBound = await promotePartyGameQueuesAccountMerge(
        partyGameMerge.sourceAccountId,
        profile.id,
        partyGameMerge.operationId,
      );
      if (!targetBound) return CREDENTIAL_BOUNDARY_FAILED;
    } catch {
      return CREDENTIAL_BOUNDARY_FAILED;
    }
  }

  const outgoingDeletionsRemain = async (): Promise<boolean> => {
    if (!outgoing) return false;
    const latest = await flushBeerPhotoDeletionsBeforeSessionEnd({
      session: outgoing,
      preferProvidedSession: true,
    });
    return latest.storageError || latest.remaining !== 0;
  };

  if (accountChanged && outgoing.authenticated) {
    // A credential-backed A is never merged into B. Do not let a login to the
    // wrong account discard the only bearer capable of finishing A's deletes.
    if (await outgoingDeletionsRemain()) {
      return PHOTO_DELETIONS_PENDING;
    }
    shouldClearLocalPrivateData = true;
  } else if (accountChanged && !outgoing.authenticated) {
    if (transition?.mergesAnonymousAccount) {
      // A strict empty preflight ran before the auth request. Any marker created
      // while that request was in flight is now sent directly with B's response
      // bearer before SecureStore can fail or the revoked A credential is lost.
      const mergeFlush = await flushBeerPhotoDeletionsForAccountMerge(
        outgoing.accountId,
        profile.id,
        incomingDeletionSession,
        { strictPreflightClean: transition.strictMergePreflightClean },
      );
      if (mergeFlush.storageError || mergeFlush.remaining !== 0) {
        return mergeFlush.storageError
          ? PHOTO_DELETIONS_REKEY_FAILED
          : PHOTO_DELETIONS_PENDING;
      }
    } else {
      if (await outgoingDeletionsRemain()) {
        return PHOTO_DELETIONS_PENDING;
      }
      shouldClearLocalPrivateData = true;
    }
  } else if (!outgoing && transition) {
    // Without a captured anonymous owner there was nothing the server could
    // claim/merge. Treat any local private state as unrelated before B lands.
    shouldClearLocalPrivateData = true;
  }

  if (shouldClearLocalPrivateData) {
    if (
      outgoing &&
      !(accountChanged && !outgoing.authenticated && transition?.mergesAnonymousAccount) &&
      !(await disableCachedPushDeviceWithBearer(outgoing.token))
    ) {
      trackApiFailure('auth_push_rebind', { reason: 'outgoing_disable_failed' });
      return CREDENTIAL_BOUNDARY_FAILED;
    }

    // Authenticated A is never merged into unrelated B. Clear and strictly
    // verify A while its credential is still installed; a kill at any point
    // therefore leaves either A + empty caches or the later durable B session,
    // never B with A's persisted queues. Anonymous claim/merge deliberately
    // skips this branch so its progress follows the user.
    try {
      const cleared = await clearLocalPrivateAccountData({ outgoingSession: outgoing });
      if (!cleared.ok) {
        trackApiFailure('auth_private_data_clear', {
          reason: 'local_clear_incomplete',
          errorName: `failed_operations_${cleared.failedOperations.length}`,
        });
        return CREDENTIAL_BOUNDARY_FAILED;
      }
    } catch (err) {
      trackApiFailure('auth_private_data_clear', {
        reason: 'local_clear_failed',
        error: err,
      });
      return CREDENTIAL_BOUNDARY_FAILED;
    }

  }

  try {
    await setSession(incomingSession);
    onSessionCommitted?.(profile);
  } catch (err) {
    trackApiFailure('auth_session_persist', { reason: 'secure_store', error: err });
    return {
      ok: false,
      code: 'session_storage',
      detail: 'Přihlášení se nepodařilo bezpečně uložit. Odemkni telefon a zkus to znovu.',
    };
  }

  // B must be durable before this installation can receive B's private push.
  // A failed rebind only delays notifications; normal launch/focus registration
  // retries it without ever routing B payloads to a durable A session.
  if (shouldClearLocalPrivateData && !(await registerCachedPushDeviceWithBearer(data.token))) {
    trackApiFailure('auth_push_rebind', { reason: 'incoming_register_deferred' });
  }

  let mergeFinalizationFailed = false;
  if (partyGameMerge && transition) {
    let finalized = false;
    try {
      finalized = await finalizePartyGameQueuesForAccountMerge(
        partyGameMerge.sourceAccountId,
        profile.id,
        partyGameMerge.operationId,
        async (intent) => {
          if (!(await rekeyAccountPreferencesQueueOwner(
            intent.fromAccountId,
            profile.id,
            { allowDuringPrivateTransition: true },
          ))) {
            trackApiFailure('account_preferences_queue', {
              reason: 'anonymous_merge_rekey_failed',
            });
            return false;
          }
          if (!(await rekeyPartyEveningIdentityOwner(
            intent.fromAccountId,
            profile.id,
          ))) {
            trackApiFailure('auth_party_evening_identity', {
              reason: 'anonymous_merge_rekey_failed',
            });
            return false;
          }
          let rehydrated = false;
          try {
            rehydrated = await rehydratePrivateStoresAfterBoundary();
          } catch {
            rehydrated = false;
          }
          if (!rehydrated) {
            trackApiFailure('auth_private_rehydrate', {
              reason: 'anonymous_merge_rehydrate_failed',
            });
            return false;
          }
          transition.privateStoresRehydrated = true;
          return true;
        },
      );
    } catch {
      finalized = false;
    }
    if (finalized) {
      try {
        refreshPartyGamesAfterAccountMerge();
      } catch (error) {
        trackApiFailure('auth_party_games_refresh', {
          reason: 'post_merge_refresh_failed',
          error,
        });
      }
    } else {
      // B is already the durable credential. Leave the exact A→B intent for
      // the queue's cold-boot recovery instead of presenting a false A session.
      trackApiFailure('auth_party_games_merge', {
        reason: 'post_session_finalize_deferred',
      });
      mergeFinalizationFailed = true;
    }
  }

  // Re-snapshot after every credential transition. This catches a Delete that
  // raced the auth request; same-account re-auth uses its fresh bearer and an
  // anonymous merge repeats the already-acknowledged B cleanup if needed.
  if (transition) {
    await flushBeerPhotoDeletionsBeforeSessionEnd({
      session: incomingDeletionSession,
      preferProvidedSession: true,
    });
  }
  if (mergeFinalizationFailed) return CREDENTIAL_BOUNDARY_FAILED;
  return { ok: true, profile };
}

/** Always reopen photo mutations under whichever credential remained durable. */
async function applyAuthSuccess(
  data: RawAccount,
  transition?: CredentialTransition,
): Promise<AuthResult> {
  let committedProfile: AccountProfile | undefined;
  let result: AuthResult;
  try {
    result = await applyAuthSuccessInner(data, transition, profile => {
      committedProfile = profile;
    });
  } catch (error) {
    trackApiFailure('auth_session', {
      reason: 'credential_boundary_exception',
      error,
    });
    result = CREDENTIAL_BOUNDARY_FAILED;
  }

  if (transition && !(await finishCredentialTransitionRehydration(transition))) {
    result = CREDENTIAL_BOUNDARY_FAILED;
  }
  if (!result.ok && committedProfile) {
    return { ...result, committedProfile };
  }
  return result;
}

/** Collapse a profile-returning call's outcome into an AuthResult. */
function resolveProfileResult(res: FetchOutcome | { networkError: true }): AuthResult {
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok) return { ok: false, ...extractError(res.data, res.status) };
  return { ok: true, profile: parseProfile(res.data) };
}

/** Collapse a no-payload call's outcome into an AuthActionResult. */
function resolveActionResult(res: FetchOutcome | { networkError: true }): AuthActionResult {
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok) return { ok: false, ...extractError(res.data, res.status) };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Email + password
// ---------------------------------------------------------------------------
export async function registerEmail(params: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<AuthResult> {
  const transition = await prepareCredentialTransition(true);
  if (transition.blockingResult) {
    return abortCredentialTransition(transition, transition.blockingResult);
  }
  const res = await authFetch('/v1/auth/register', {
    bearer: 'ensure', // claim the current anonymous account
    session: transition.outgoingSession,
    body: {
      email: params.email,
      password: params.password,
      display_name: params.displayName ?? '',
      ...(transition.partyGameMerge
        ? { merge_operation_id: transition.partyGameMerge.operationId }
        : {}),
    },
  });
  if ('networkError' in res) return abortCredentialTransition(transition, NETWORK_ERROR);
  if (!res.ok) {
    return abortCredentialTransition(
      transition,
      { ok: false, ...extractError(res.data, res.status) },
      { cancelUncommittedPartyGameMerge: authFailureCanSafelyCancelMergePreflight(res) },
    );
  }
  return applyAuthSuccess(res.data, transition);
}

export async function loginEmail(params: { email: string; password: string }): Promise<AuthResult> {
  const transition = await prepareCredentialTransition(true);
  if (transition.blockingResult) {
    return abortCredentialTransition(transition, transition.blockingResult);
  }
  const res = await authFetch('/v1/auth/login', {
    bearer: 'claim',
    session: transition.outgoingSession,
    body: {
      email: params.email,
      password: params.password,
      ...(transition.partyGameMerge
        ? { merge_operation_id: transition.partyGameMerge.operationId }
        : {}),
    },
  });
  if ('networkError' in res) return abortCredentialTransition(transition, NETWORK_ERROR);
  if (!res.ok) {
    if (res.status === 401) {
      trackApiFailure('auth_login', {
        endpoint: '/v1/auth/login',
        status: res.status,
        reason: 'login_invalid_credentials',
      });
    } else if (res.status >= 500) {
      trackApiFailure('auth_login', {
        endpoint: '/v1/auth/login',
        status: res.status,
        reason: 'login_server_error',
      });
    }
    return abortCredentialTransition(
      transition,
      { ok: false, ...extractError(res.data, res.status) },
      { cancelUncommittedPartyGameMerge: authFailureCanSafelyCancelMergePreflight(res) },
    );
  }
  return applyAuthSuccess(res.data, transition);
}

// ---------------------------------------------------------------------------
// Social sign-in / claim
// ---------------------------------------------------------------------------
function mapSocialError(err: unknown): AuthResult {
  if (err instanceof SocialAuthError) {
    if (err.code === 'cancelled') return CANCELLED;
    if (err.code === 'unsupported') {
      return { ok: false, code: 'unsupported', detail: 'Tato možnost není na tomto zařízení dostupná.' };
    }
    if (err.code === 'misconfigured') {
      return {
        ok: false,
        code: 'misconfigured',
        detail: 'Google přihlášení teď není správně nastavené. Zkus zatím přihlášení e-mailem.',
      };
    }
    if (err.code === 'play_services') {
      return {
        ok: false,
        code: err.code,
        detail: 'Google Play služby nejsou dostupné nebo potřebují aktualizaci. Aktualizuj je v Google Play, nebo se přihlas e-mailem.',
      };
    }
    if (err.code === 'account_picker') {
      return {
        ok: false,
        code: err.code,
        detail: 'Výběr Google účtu se nepodařilo otevřít. Zkontroluj účet v telefonu, zkus to znovu, nebo se přihlas e-mailem.',
      };
    }
    return {
      ok: false,
      code: err.code,
      detail: 'Přihlášení přes poskytovatele se nezdařilo. Zkus to prosím znovu.',
    };
  }
  return { ok: false, code: 'failed', detail: 'Přihlášení se nezdařilo.' };
}

export async function signInWithGoogle(): Promise<AuthResult> {
  let idToken: string;
  try {
    idToken = await getGoogleIdToken();
  } catch (err) {
    if (!(err instanceof SocialAuthError) || err.code !== 'cancelled') {
      trackApiFailure('social_auth', {
        reason: `google_${err instanceof SocialAuthError ? err.code : 'failed'}`,
        error: err,
      });
    }
    return mapSocialError(err);
  }
  const transition = await prepareCredentialTransition(true);
  if (transition.blockingResult) {
    return abortCredentialTransition(transition, transition.blockingResult);
  }
  const res = await authFetch('/v1/auth/google', {
    bearer: 'ensure',
    session: transition.outgoingSession,
    body: {
      id_token: idToken,
      ...(transition.partyGameMerge
        ? { merge_operation_id: transition.partyGameMerge.operationId }
        : {}),
    },
  });
  if ('networkError' in res) return abortCredentialTransition(transition, NETWORK_ERROR);
  if (!res.ok) {
    return abortCredentialTransition(
      transition,
      { ok: false, ...extractError(res.data, res.status) },
      { cancelUncommittedPartyGameMerge: authFailureCanSafelyCancelMergePreflight(res) },
    );
  }
  return applyAuthSuccess(res.data, transition);
}

export async function signInWithApple(): Promise<AuthResult> {
  let credential;
  try {
    credential = await getAppleCredential();
  } catch (err) {
    return mapSocialError(err);
  }
  const transition = await prepareCredentialTransition(true);
  if (transition.blockingResult) {
    return abortCredentialTransition(transition, transition.blockingResult);
  }
  const res = await authFetch('/v1/auth/apple', {
    bearer: 'ensure',
    session: transition.outgoingSession,
    body: {
      identity_token: credential.identityToken,
      authorization_code: credential.authorizationCode,
      full_name: credential.fullName,
      ...(transition.partyGameMerge
        ? { merge_operation_id: transition.partyGameMerge.operationId }
        : {}),
    },
  });
  if ('networkError' in res) return abortCredentialTransition(transition, NETWORK_ERROR);
  if (!res.ok) {
    return abortCredentialTransition(
      transition,
      { ok: false, ...extractError(res.data, res.status) },
      { cancelUncommittedPartyGameMerge: authFailureCanSafelyCancelMergePreflight(res) },
    );
  }
  return applyAuthSuccess(res.data, transition);
}

// ---------------------------------------------------------------------------
// Linking / unlinking (authenticated; session token is unchanged)
// ---------------------------------------------------------------------------
export async function linkGoogle(): Promise<AuthResult> {
  let idToken: string;
  try {
    idToken = await getGoogleIdToken();
  } catch (err) {
    return mapSocialError(err);
  }
  const res = await authFetch('/v1/auth/link', {
    bearer: 'current',
    body: { provider: 'google', id_token: idToken },
  });
  return resolveProfileResult(res);
}

export async function linkApple(): Promise<AuthResult> {
  let credential;
  try {
    credential = await getAppleCredential();
  } catch (err) {
    return mapSocialError(err);
  }
  const res = await authFetch('/v1/auth/link', {
    bearer: 'current',
    body: {
      provider: 'apple',
      identity_token: credential.identityToken,
      authorization_code: credential.authorizationCode,
      full_name: credential.fullName,
    },
  });
  return resolveProfileResult(res);
}

export async function unlinkProvider(provider: AuthProvider): Promise<AuthResult> {
  const res = await authFetch('/v1/auth/unlink', { bearer: 'current', body: { provider } });
  return resolveProfileResult(res);
}

export async function setPassword(params: { password: string; email?: string }): Promise<AuthResult> {
  const res = await authFetch('/v1/auth/set-password', {
    bearer: 'current',
    body: { password: params.password, email: params.email ?? '' },
  });
  return resolveProfileResult(res);
}

// ---------------------------------------------------------------------------
// Session / lifecycle
// ---------------------------------------------------------------------------
async function finishAnonymousSessionBoundary(
  outgoingSession: AccountSession | null,
): Promise<AuthActionResult> {
  try {
    await revertToAnonymous(undefined, async () => {
      const cleared = await clearLocalPrivateAccountData({ outgoingSession });
      if (!cleared.ok) throw new Error('Private account storage clear failed.');
    });
    return { ok: true };
  } catch (error) {
    trackApiFailure('auth_session_clear', {
      reason: 'secure_store',
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return SESSION_BOUNDARY_FAILED;
  }
}

async function logoutWithinPhotoBoundary(
  options?: { all?: boolean },
): Promise<AuthActionResult> {
  // A native multipart upload may still be committing after the user deleted
  // it. Put every durable by-client tombstone on the server before logout
  // revokes the only bearer that is authorized to delete account A's photo.
  const durableSession = await readDurableAccountSession();
  if (!durableSession.available) return SESSION_BOUNDARY_FAILED;
  const outgoingSession = durableSession.session;
  const deletionFlush = await flushBeerPhotoDeletionsBeforeSessionEnd({
    session: outgoingSession,
    preferProvidedSession: true,
  });
  if (deletionFlush.storageError || deletionFlush.remaining !== 0) {
    return deletionFlush.storageError
      ? PHOTO_DELETIONS_REKEY_FAILED
      : PHOTO_DELETIONS_PENDING;
  }
  if (!(await disableCachedPushDeviceWithBearer(outgoingSession?.token ?? null))) {
    return SESSION_BOUNDARY_FAILED;
  }
  if (outgoingSession) {
    await authFetch('/v1/auth/logout', {
      bearer: 'current',
      body: { all: options?.all === true },
    });
  }
  // Offline logout is intentionally local-first, but it is complete only when
  // SecureStore actually stopped exposing A. The boundary callback clears A's
  // private queues before any replacement anonymous identity can be observed.
  return finishAnonymousSessionBoundary(outgoingSession);
}

export async function logout(options?: { all?: boolean }): Promise<AuthActionResult> {
  const privateAccountTransition = beginPrivateAccountTransition('logout');
  const photoSessionTransition = beginBeerPhotoSessionTransition();
  if (!privateAccountTransition) {
    photoSessionTransition.release();
    return SESSION_BOUNDARY_FAILED;
  }
  try {
    await privateAccountTransition.drain();
    const mergeIntent = await readPrivateAccountMergeIntent();
    if (!mergeIntent.ok || mergeIntent.intent) return SESSION_BOUNDARY_FAILED;
    return await logoutWithinPhotoBoundary(options);
  } catch (error) {
    trackApiFailure('auth_logout', { reason: 'session_boundary_exception', error });
    return SESSION_BOUNDARY_FAILED;
  } finally {
    photoSessionTransition.release();
    privateAccountTransition.release();
    await rehydratePrivateStoresAfterBoundary();
  }
}

async function fetchAccountDeletionCompletion(
  operationId: string,
): Promise<boolean | null> {
  const res = await authFetch('/v1/account/deletion-status', {
    method: 'GET',
    bearer: 'none',
    // Keep the deletion capability out of query/access logs.
    headers: { 'X-Account-Deletion-Operation-Id': operationId },
  });
  if ('networkError' in res || !res.ok) return null;
  return typeof res.data.complete === 'boolean' ? res.data.complete : null;
}

async function recoverAccountDeletionOrphans(
  orphans: AccountDeletionOrphan[],
): Promise<boolean> {
  // Probe every durable capability, but cap simultaneous requests. A fixed
  // `slice(0, n)` permanently starves the fifth orphan because receipt order is
  // stable; this worker pool eventually proves/retire all of them without an
  // unbounded request burst.
  const completionProofs = new Array<{
    orphan: AccountDeletionOrphan;
    serverComplete: boolean | null;
  }>(orphans.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < orphans.length) {
      const index = nextIndex;
      nextIndex += 1;
      const orphan = orphans[index];
      completionProofs[index] = {
        orphan,
        serverComplete:
          orphan.phase === 'complete'
            ? true
            : await fetchAccountDeletionCompletion(orphan.operationId),
      };
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(4, orphans.length) }, () => worker()),
  );

  for (const { orphan, serverComplete } of completionProofs) {
    // An unavailable/false proof stays bounded and owner-scoped for a later
    // tap. It must not occupy or block the current account's active slot.
    if (serverComplete !== true) continue;
    const retired = await retireAccountDeletionOrphan(
      orphan.accountId,
      orphan.operationId,
    );
    if (!retired.ok) return false;
  }
  return true;
}

export type StartupAccountDeletionRecoveryResult =
  | 'none'
  | 'deferred'
  | 'recovered'
  | 'blocked';

/**
 * Resolve a crash-lost account DELETE before the cached A session is published.
 *
 * Only the opaque public completion proof is authoritative. A revoked bearer,
 * a local `complete` bit, or a generic 401 is never enough. False/unavailable
 * status deliberately leaves A intact for retry; proven completion freezes
 * photo mutations, strictly clears A, rotates to anonymous, then retires the
 * exact receipt.
 */
export async function recoverPendingAccountDeletionAtStartup(): Promise<
  StartupAccountDeletionRecoveryResult
> {
  setBeerPhotoDeletionRecoveryBlocked(true);
  setPrivateAccountDeletionRecoveryBlocked(true);
  const privateAccountTransition = beginPrivateAccountTransition('account-deletion-recovery');
  const photoSessionTransition = beginBeerPhotoSessionTransition();
  if (!privateAccountTransition) {
    photoSessionTransition.release();
    return 'blocked';
  }
  let safeToRehydrate = false;
  try {
    await privateAccountTransition.drain();
    const mergeIntent = await readPrivateAccountMergeIntent();
    if (!mergeIntent.ok || mergeIntent.intent) return 'blocked';

    const loaded = await readAccountDeletionReceipt();
    if (!loaded.ok) {
      // io/unsupported: storage itself is unreliable or ahead of this app
      // version. Touch nothing and keep every blocker engaged for a retry.
      if (loaded.failureKind !== 'corrupt') return 'blocked';

      // Corrupt: the receipt layer already quarantined the raw bytes with a
      // verified durable write, so the deletion boundary can finish fully
      // offline. No network probe may run against bytes we could not parse.
      const corruptDurableSession = await readDurableAccountSession();
      if (!corruptDurableSession.available) return 'blocked';
      const corruptOutgoingSession = corruptDurableSession.session;
      const boundary = await finishAnonymousSessionBoundary(corruptOutgoingSession);
      if (!boundary.ok) return 'blocked';
      const retired = await retireQuarantinedAccountDeletionReceipt(loaded.quarantineId);
      if (!retired.ok) return 'blocked';
      safeToRehydrate = true;
      return 'recovered';
    }
    const intent = loaded.intent;
    if (!intent) {
      safeToRehydrate = true;
      return 'none';
    }

    const serverComplete = await fetchAccountDeletionCompletion(intent.operationId);
    const durableSession = await readDurableAccountSession();
    if (!durableSession.available) return 'blocked';
    const outgoingSession = durableSession.session;

    if (serverComplete !== true) {
      const sameAccount =
        !!outgoingSession && outgoingSession.accountId === intent.accountId;
      const sameCredentialBinding =
        typeof intent.credentialBindingId === 'string' &&
        intent.credentialBindingId.length > 0 &&
        outgoingSession?.credentialBindingId === intent.credentialBindingId;
      const exactPendingCredential =
        intent.phase === 'pending' &&
        serverComplete === false &&
        sameAccount &&
        sameCredentialBinding;

      // The receipt belongs to an identity that is no longer the durable one.
      // Archive the capability for the manual flow instead of ever clearing or
      // reverting anything from startup recovery.
      const staleCurrentReceipt =
        !!outgoingSession &&
        (outgoingSession.accountId !== intent.accountId ||
          !intent.credentialBindingId ||
          !outgoingSession.credentialBindingId ||
          outgoingSession.credentialBindingId !== intent.credentialBindingId);
      if (
        staleCurrentReceipt &&
        (serverComplete === false || serverComplete === null)
      ) {
        const archived = await archiveAccountDeletionReceipt(
          intent.accountId,
          intent.operationId,
        );
        if (archived.ok) {
          safeToRehydrate = true;
          return 'recovered';
        }
        return 'blocked';
      }

      // A previously completed proof that now reads false means reactivation
      // explicitly invalidated the deletion epoch. Archive the capability for
      // the manual flow instead of ever deleting a live account again.
      if (
        intent.phase === 'complete' &&
        serverComplete === false &&
        sameAccount &&
        sameCredentialBinding
      ) {
        const archived = await archiveAccountDeletionReceipt(
          intent.accountId,
          intent.operationId,
        );
        if (!archived.ok) return 'blocked';
        safeToRehydrate = true;
        return 'recovered';
      }

      // With no readable durable identity, publishing hydrated private stores
      // could expose A while Keychain is merely locked. Hold the startup gate;
      // a later retry can distinguish that from a genuinely empty cache.
      if (!exactPendingCredential) return outgoingSession ? 'deferred' : 'blocked';

      // The proof says the account still exists. Finish A's photo tombstones
      // with the captured session, then repeat the exact DELETE (same
      // operationId). Any network or non-204 outcome stays deferred — never a
      // local wipe on an unproven deletion.
      const deletionFlush = await flushBeerPhotoDeletionsBeforeSessionEnd({
        session: outgoingSession,
        preferProvidedSession: true,
      });
      if (deletionFlush.storageError || deletionFlush.remaining !== 0) return 'deferred';
      const res = await authFetch('/v1/account/me', {
        method: 'DELETE',
        bearer: 'current',
        session: outgoingSession,
        headers: { 'X-Account-Deletion-Operation-Id': intent.operationId },
      });
      if ('networkError' in res) return 'deferred';
      if (res.status !== 204) {
        // Only the backend's canonical reactivation answers may retire the
        // receipt; anything opaque stays deferred for a later startup retry.
        // A DELETE 401 is terminal revoked auth regardless of body shape —
        // the bearer was invalidated because the account is gone.
        const canonicalReactivation =
          (res.status === 409 && res.data.code === 'deletion_epoch_cancelled') ||
          res.status === 401;
        if (!canonicalReactivation) return 'deferred';
        const archived = await archiveAccountDeletionReceipt(
          intent.accountId,
          intent.operationId,
        );
        if (!archived.ok) return 'blocked';
        safeToRehydrate = true;
        return 'recovered';
      }
    }

    if (intent.phase !== 'complete') {
      const completed = await completeAccountDeletionReceipt(
        intent.accountId,
        intent.operationId,
      );
      if (!completed.ok) return 'blocked';
    }

    if (outgoingSession && outgoingSession.accountId !== intent.accountId) {
      // B is already durable, so never clear B using A's receipt. A successful
      // account transition has its own strict boundary; retire only the proven
      // old completion capability.
      const cleared = await clearAccountDeletionReceipt(
        intent.accountId,
        intent.operationId,
      );
      if (cleared.ok) {
        safeToRehydrate = true;
        return 'recovered';
      }
      return 'blocked';
    }

    const boundary = await finishAnonymousSessionBoundary(outgoingSession);
    if (!boundary.ok) return 'blocked';

    const cleared = await clearAccountDeletionReceipt(
      intent.accountId,
      intent.operationId,
    );
    if (cleared.ok) {
      safeToRehydrate = true;
      return 'recovered';
    }
    return 'blocked';
  } catch (error) {
    trackApiFailure('auth_account_delete_startup', {
      reason: 'recovery_exception',
      error,
    });
    return 'blocked';
  } finally {
    photoSessionTransition.release();
    privateAccountTransition.release();
    // Deferred/blocked outcomes must keep private stores frozen for the next
    // startup attempt; only a proven-safe rehydrate may publish them.
    if (safeToRehydrate) {
      let rehydrated: boolean;
      try {
        rehydrated = await rehydratePrivateStoresAfterBoundary();
      } catch (error) {
        trackApiFailure('auth_account_delete_startup', {
          reason: 'rehydrate_exception',
          error,
        });
        return 'blocked';
      }
      if (rehydrated !== true) {
        trackApiFailure('auth_account_delete_startup', {
          reason: 'rehydrate_failed',
        });
        return 'blocked';
      }
      setPrivateAccountDeletionRecoveryBlocked(false);
      setBeerPhotoDeletionRecoveryBlocked(false);
    }
  }
}

async function deleteAccountWithinPhotoBoundary(): Promise<AuthActionResult> {
  const durableSession = await readDurableAccountSession();
  if (!durableSession.available) return ACCOUNT_DELETION_RECEIPT_FAILED;
  const outgoingSession = durableSession.session;
  if (!outgoingSession?.accountId) return NETWORK_ERROR;
  // Mutable because binding an exact credential may rotate the session object;
  // every later step must ride the SAME captured identity, never a re-read
  // that could pick up a concurrent token rotation.
  let deletionSession: AccountSession = outgoingSession;

  const loaded = await readAccountDeletionReceipt();
  if (!loaded.ok) {
    // io/unsupported: storage itself is unreliable or ahead of this app
    // version. Touch nothing and keep the existing fail-closed behavior.
    if (loaded.failureKind !== 'corrupt') return ACCOUNT_DELETION_RECEIPT_FAILED;

    // Corrupt: the receipt layer already durably verified the quarantined raw
    // bytes, so this tap may finish fully offline with local-only recovery:
    // strictly clear A, rotate to a fresh anonymous identity, retire the exact
    // quarantine — then require a second confirmation before any DELETE.
    const boundary = await finishAnonymousSessionBoundary(deletionSession);
    if (!boundary.ok) return ACCOUNT_DELETION_RECEIPT_FAILED;
    const retired = await retireQuarantinedAccountDeletionReceipt(loaded.quarantineId);
    if (!retired.ok) return ACCOUNT_DELETION_RECEIPT_FAILED;
    return ACCOUNT_DELETION_RECOVERED;
  }
  if (!(await recoverAccountDeletionOrphans(loaded.orphans))) {
    return ACCOUNT_DELETION_RECEIPT_FAILED;
  }
  let intent = loaded.intent;

  if (
    intent &&
    (intent.accountId !== deletionSession.accountId ||
      !intent.credentialBindingId ||
      !deletionSession.credentialBindingId ||
      intent.credentialBindingId !== deletionSession.credentialBindingId)
  ) {
    // The receipt belongs to another account or to a superseded credential of
    // the same account (a same-account re-login rotates the binding). A pending
    // proof still needs the public one-bit server status before it can be
    // upgraded/retired — and the local `complete` bit is re-probed too, because
    // a same-account reactivation atomically invalidated that old epoch.
    // Never DELETE, clear private data, or revert the current session here.
    const serverComplete = await fetchAccountDeletionCompletion(intent.operationId);
    if (serverComplete === true) {
      if (intent.phase === 'pending') {
        const completed = await completeAccountDeletionReceipt(
          intent.accountId,
          intent.operationId,
        );
        if (!completed.ok) return ACCOUNT_DELETION_RECEIPT_FAILED;
      }
      const cleared = await clearAccountDeletionReceipt(
        intent.accountId,
        intent.operationId,
      );
      if (!cleared.ok) return ACCOUNT_DELETION_RECEIPT_FAILED;
    } else {
      const archived = await archiveAccountDeletionReceipt(
        intent.accountId,
        intent.operationId,
      );
      if (!archived.ok) return ACCOUNT_DELETION_RECEIPT_FAILED;
    }
    // A receipt that was just retired belongs to a confirmation the user never
    // saw finish — this tap only settled A's stale receipt and must never imply
    // the current session (B) was deleted. Require a fresh second confirmation
    // before any DELETE can touch the current session, anonymous or
    // authenticated alike.
    return ACCOUNT_DELETION_RECOVERED;
  }

  let createdNow = false;
  if (!intent) {
    // A fresh receipt must be bound to the exact credential performing the
    // DELETE so token rotation can never strand it under a stale bearer.
    const boundSession = await ensureCredentialBindingForSession(deletionSession);
    const credentialBindingId = boundSession?.credentialBindingId;
    if (!boundSession || typeof credentialBindingId !== 'string' || !credentialBindingId) {
      return ACCOUNT_DELETION_RECEIPT_FAILED;
    }
    deletionSession = boundSession;
    intent = {
      accountId: deletionSession.accountId,
      operationId: generateUuidV4(),
      phase: 'pending',
      credentialBindingId,
    };
    const persisted = await writeAccountDeletionReceipt(
      intent.accountId,
      intent.operationId,
      credentialBindingId,
    );
    if (!persisted.ok) return ACCOUNT_DELETION_RECEIPT_FAILED;
    createdNow = true;
  }

  let serverDeletionConfirmed = false;
  if (!createdNow) {
    // A local `complete` bit is only a crash-recovery hint, never current server
    // truth. A later credential auth may have reactivated the same account and
    // atomically invalidated this deletion epoch while the old receipt survived
    // a client crash or storage failure.
    const complete = await fetchAccountDeletionCompletion(intent.operationId);
    if (complete === null) return NETWORK_ERROR;
    if (complete) {
      if (intent.phase !== 'complete') {
        const completed = await completeAccountDeletionReceipt(
          intent.accountId,
          intent.operationId,
        );
        if (!completed.ok) return ACCOUNT_DELETION_RECEIPT_FAILED;
        intent = { ...intent, phase: 'complete' };
      }
      serverDeletionConfirmed = true;
    }
  }

  if (!serverDeletionConfirmed) {
    // Establish every by-client photo delete while A's bearer is still valid.
    // The session barrier has already aborted native uploads, so once this is
    // empty the account-wide deletion cannot strand a late local tombstone.
    const deletionFlush = await flushBeerPhotoDeletionsBeforeSessionEnd({
      session: deletionSession,
      preferProvidedSession: true,
    });
    if (deletionFlush.storageError || deletionFlush.remaining !== 0) {
      return deletionFlush.storageError
        ? PHOTO_DELETIONS_REKEY_FAILED
        : PHOTO_DELETIONS_PENDING;
    }
    const res = await authFetch('/v1/account/me', {
      method: 'DELETE',
      bearer: 'current',
      session: deletionSession,
      headers: { 'X-Account-Deletion-Operation-Id': intent.operationId },
    });
    if ('networkError' in res) return NETWORK_ERROR;
    // Only canonical 204 or the public status proof upgrades the local intent.
    // Generic 401/404 and partial schedule failures remain errors.
    if (res.status !== 204) {
      return { ok: false, ...extractError(res.data, res.status) };
    }
    const completed = await completeAccountDeletionReceipt(
      intent.accountId,
      intent.operationId,
    );
    if (!completed.ok) return ACCOUNT_DELETION_RECEIPT_FAILED;
    intent = { ...intent, phase: 'complete' };
  }

  const boundary = await finishAnonymousSessionBoundary(deletionSession);
  if (!boundary.ok) return boundary;

  const clearedReceipt = await clearAccountDeletionReceipt(
    intent.accountId,
    intent.operationId,
  );
  if (!clearedReceipt.ok) return ACCOUNT_DELETION_RECEIPT_FAILED;
  return { ok: true };
}

export async function deleteAccount(): Promise<AuthActionResult> {
  const privateAccountTransition = beginPrivateAccountTransition('account-delete');
  const photoSessionTransition = beginBeerPhotoSessionTransition();
  if (!privateAccountTransition) {
    photoSessionTransition.release();
    return ACCOUNT_DELETION_RECEIPT_FAILED;
  }
  try {
    await privateAccountTransition.drain();
    const mergeIntent = await readPrivateAccountMergeIntent();
    if (!mergeIntent.ok || mergeIntent.intent) return ACCOUNT_DELETION_RECEIPT_FAILED;
    return await deleteAccountWithinPhotoBoundary();
  } catch (error) {
    trackApiFailure('auth_account_delete', {
      reason: 'deletion_boundary_exception',
      error,
    });
    return ACCOUNT_DELETION_RECEIPT_FAILED;
  } finally {
    photoSessionTransition.release();
    privateAccountTransition.release();
    await rehydratePrivateStoresAfterBoundary();
  }
}

export async function requestPasswordReset(email: string): Promise<AuthActionResult> {
  const res = await authFetch('/v1/auth/request-password-reset', {
    bearer: 'none',
    body: { email },
  });
  // The backend 202s without account enumeration; any real 2xx is success.
  return resolveActionResult(res);
}

export async function resetPassword(params: { token: string; password: string }): Promise<AuthResult> {
  const transition = await prepareCredentialTransition(false);
  if (transition.blockingResult) {
    return abortCredentialTransition(transition, transition.blockingResult);
  }
  const res = await authFetch('/v1/auth/reset-password', {
    bearer: 'none',
    body: { token: params.token, password: params.password },
  });
  if ('networkError' in res) return abortCredentialTransition(transition, NETWORK_ERROR);
  if (!res.ok) {
    return abortCredentialTransition(transition, {
      ok: false,
      ...extractError(res.data, res.status),
    });
  }
  return applyAuthSuccess(res.data, transition);
}

export async function requestEmailVerification(): Promise<AuthActionResult> {
  const res = await authFetch('/v1/auth/request-email-verify', { bearer: 'current', body: {} });
  return resolveActionResult(res);
}

export async function verifyEmail(token: string): Promise<AuthActionResult> {
  const res = await authFetch('/v1/auth/verify-email', { bearer: 'none', body: { token } });
  return resolveActionResult(res);
}

/** Fetch the current account state (GET /v1/account/me). Null when unavailable. */
export async function fetchAccountProfile(): Promise<AccountProfile | null> {
  const res = await authFetch('/v1/account/me', { method: 'GET', bearer: 'current' });
  if ('networkError' in res || !res.ok) return null;
  return parseProfile(res.data);
}

/** Result of accepting a UGC policy version (PUT /v1/account/me/ugc-consent). */
export type UgcConsentAcceptResult =
  | { ok: true; ugcConsent: UgcConsentSnapshot }
  | { ok: false; code: string; detail: string };

/**
 * Accept a UGC policy version for the current durable account. The exact
 * session is captured once so the account id we cache the snapshot under and
 * the bearer on the wire cannot race a credential transition. A missing or
 * malformed `ugc_consent` in the response fails closed without caching.
 */
export async function acceptUgcConsent(version: string): Promise<UgcConsentAcceptResult> {
  let session: AccountSession | null;
  try {
    session = await ensureAccount();
  } catch (error) {
    trackApiFailure('auth_ugc_consent', { reason: 'session_capture_failed', error });
    return NETWORK_ERROR;
  }
  if (!session) return NETWORK_ERROR;

  const res = await authFetch('/v1/account/me/ugc-consent', {
    method: 'PUT',
    bearer: 'current',
    session,
    body: { version },
  });
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok) return { ok: false, ...extractError(res.data, res.status) };

  const snapshot = parseUgcConsentSnapshot(res.data.ugc_consent);
  if (!snapshot) return NETWORK_ERROR;
  rememberUgcConsent(session.accountId, snapshot);
  return { ok: true, ugcConsent: snapshot };
}

/**
 * Validate the exact in-memory session that was active before the app went to
 * the background. Unlike `fetchAccountProfile`, this keeps a real 401 separate
 * from a timeout or server failure, so callers never turn a transient outage
 * into a logout. The token is used only as the Authorization header and is
 * never included in telemetry.
 */
export async function validateAccountSession(
  session: AccountSession,
): Promise<SessionValidationResult> {
  const endpoint = getBackendEndpoint('/v1/account/me');
  if (!endpoint) return { status: 'unavailable' };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${session.token}` },
      signal: controller.signal,
    });
    let data: Record<string, unknown> = {};
    try {
      const text = await resp.text();
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      data = {};
    }

    if (resp.status === 401) return { status: 'invalid' };
    if (!resp.ok) return { status: 'unavailable' };
    return { status: 'valid', profile: parseProfile(data) };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (!isAbort) {
      trackApiFailure('auth_session_validate', {
        endpoint: '/v1/account/me',
        reason: 'exception',
        error: err,
      });
    }
    return { status: 'unavailable' };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Server-only walked-distance counter (metres), read off the raw GET
 * /v1/account/me `usage` block for the profile stats tile. Returns `null` when
 * the field is absent so the UI can distinguish "not reported yet" (→ "—") from
 * a real 0. Never throws.
 */
export async function fetchWalkedDistanceM(): Promise<number | null> {
  const res = await authFetch('/v1/account/me', { method: 'GET', bearer: 'current' });
  if ('networkError' in res || !res.ok) return null;
  const walked = res.data.usage?.walked_distance_m;
  return typeof walked === 'number' && Number.isFinite(walked) ? walked : null;
}

export type AccountExportActionResult = AuthActionResult;

export async function exportAccountData(): Promise<AccountExportActionResult> {
  const res = await authFetch('/v1/account/export', { method: 'POST', bearer: 'current', body: {} });
  return resolveActionResult(res);
}

export async function restorePurchases(params: {
  platform: 'apple' | 'google';
  productId?: string;
  originalTransactionId?: string;
  transactionId?: string;
  expiresAt?: string | null;
}): Promise<AuthResult> {
  const res = await authFetch('/v1/account/me/purchases/restore', {
    method: 'POST',
    bearer: 'current',
    body: {
      platform: params.platform,
      product_id: params.productId ?? '',
      original_transaction_id: params.originalTransactionId ?? '',
      transaction_id: params.transactionId ?? '',
      expires_at: params.expiresAt ?? null,
    },
  });
  return resolveProfileResult(res);
}

export type ContentReportReason =
  | 'inappropriate_nickname'
  | 'inappropriate_avatar'
  | 'inappropriate_photo'
  | 'impersonation'
  | 'spam'
  | 'other';

export async function reportProfileContent(params: {
  targetAccountId: string;
  reason: ContentReportReason;
  comment?: string;
  /**
   * Beer-photo diary: pin the report to one specific photo (backend field
   * `photo_id`, additive). Only meaningful with reason 'inappropriate_photo'.
   */
  photoId?: string;
  /**
   * Výčep: pin the report to one published night (backend field `night_id`,
   * additive). Older backends ignore the extra field.
   */
  nightId?: string;
}): Promise<AuthActionResult> {
  const res = await authFetch('/v1/content-reports', {
    method: 'POST',
    bearer: 'current',
    body: {
      target_account_id: params.targetAccountId,
      reason: params.reason,
      comment: params.comment ?? '',
      ...(params.photoId ? { photo_id: params.photoId } : {}),
      ...(params.nightId ? { night_id: params.nightId } : {}),
    },
  });
  return resolveActionResult(res);
}

// ---------------------------------------------------------------------------
// Profile (nickname / display name / visibility / avatar)
// ---------------------------------------------------------------------------

/**
 * Narrow result for the (debounced, advisory) nickname availability check. The
 * authoritative check is `updateProfile` itself — a 409 there is the source of
 * truth, this just powers the inline UX hint.
 */
export type NicknameAvailability =
  | { ok: true; available: boolean; reason?: string }
  | { ok: false; code: string; detail: string };

/**
 * Write profile fields (PATCH /v1/account/me). Only the keys actually passed are
 * sent; `displayName` maps to `display_name`. Never throws — a taken nickname
 * (409) or invalid value (400) surfaces via `extractError` as {code, detail}.
 */
export async function updateProfile(params: {
  nickname?: string;
  displayName?: string;
  isPublic?: boolean;
}): Promise<AuthResult> {
  const body: Record<string, unknown> = {};
  if (params.nickname !== undefined) body.nickname = params.nickname;
  if (params.displayName !== undefined) body.display_name = params.displayName;
  if (params.isPublic !== undefined) body.is_public = params.isPublic;

  const res = await authFetch('/v1/account/me', { method: 'PATCH', bearer: 'current', body });
  return resolveProfileResult(res);
}

interface RawNicknameAvailability {
  available?: boolean;
  reason?: string;
}

/**
 * Advisory availability check (GET /v1/account/nickname-available?nickname=). Used
 * for the debounced inline hint while typing; `updateProfile` is authoritative.
 */
export async function checkNicknameAvailable(nickname: string): Promise<NicknameAvailability> {
  const res = await authFetch(
    `/v1/account/nickname-available?nickname=${encodeURIComponent(nickname)}`,
    { method: 'GET', bearer: 'current' },
  );
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok) return { ok: false, ...extractError(res.data, res.status) };
  const data = res.data as RawNicknameAvailability;
  return { ok: true, available: data.available === true, reason: data.reason };
}

/**
 * Upload an avatar image (POST /v1/account/me/avatar, multipart field `avatar`).
 *
 * MUST bypass `authFetch` — that helper hardcodes `Content-Type: application/json`,
 * which would corrupt a multipart body. We also CANNOT use the global `fetch` with
 * a FormData file part: Expo SDK 56 swaps in a WinterCG `fetch` whose
 * `convertFormDataAsync` rejects the legacy RN `{uri,name,type}` file object with
 * "Unsupported FormDataPart implementation" (it only accepts string/Blob/File).
 * Instead we hand the local file to expo-file-system's native multipart uploader,
 * which reads the file and builds the body in native code. Its own AbortSignal gives
 * a 30s budget (uploads are slower than the shared 12s API budget).
 */
export async function uploadAvatar(localUri: string): Promise<AuthResult> {
  const endpoint = getBackendEndpoint('/v1/account/me/avatar');
  if (!endpoint) return NETWORK_ERROR;

  const token = await getSessionToken();
  if (!token) return { ok: false, code: 'unauthenticated', detail: '' };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  try {
    const resp = await new File(localUri).upload(endpoint, {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'avatar',
      mimeType: 'image/jpeg',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    let data: Record<string, unknown> = {};
    try {
      data = resp.body ? (JSON.parse(resp.body) as Record<string, unknown>) : {};
    } catch {
      data = {};
    }
    if (resp.status < 200 || resp.status >= 300) {
      return { ok: false, ...extractError(data, resp.status) };
    }
    return { ok: true, profile: parseProfile(data) };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (!isAbort) {
      trackApiFailure('auth_request', {
        endpoint: '/v1/account/me/avatar',
        reason: 'exception',
        error: err,
      });
    }
    return NETWORK_ERROR;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Remove the current avatar (DELETE /v1/account/me/avatar). */
export async function removeAvatar(): Promise<AuthResult> {
  const res = await authFetch('/v1/account/me/avatar', { method: 'DELETE', bearer: 'current' });
  return resolveProfileResult(res);
}
