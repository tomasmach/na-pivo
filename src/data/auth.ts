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
  getSessionToken,
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
import { clearLocalPrivateAccountData } from './privateAccountData';
import { disableCachedPushDeviceWithBearer } from './pushDeviceClient';
import { getAppleCredential, getGoogleIdToken, SocialAuthError } from './socialAuth';
import { trackApiFailure } from './telemetryClient';

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
}

/** Success carries the fresh account state; failure carries a code + message. */
export type AuthResult =
  | { ok: true; profile: AccountProfile }
  | { ok: false; code: string; detail: string };

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
  opts: { method?: string; body?: unknown; bearer?: 'current' | 'ensure' | 'claim' | 'none' },
): Promise<FetchOutcome | { networkError: true }> {
  const endpoint = getBackendEndpoint(path);
  if (!endpoint) return { networkError: true };

  let token: string | null = null;
  if (opts.bearer === 'ensure') {
    const session = await ensureAccount();
    token = session?.token ?? null;
  } else if (opts.bearer === 'claim') {
    const session = await ensureAccount();
    token = session && !session.authenticated ? session.token : null;
  } else if (opts.bearer === 'current') {
    token = await getSessionToken();
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
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

async function disablePushDeviceForCurrentSession(): Promise<void> {
  try {
    await disableCachedPushDeviceWithBearer(await getSessionToken());
  } catch {
    // Logout/delete must still proceed if push cleanup is offline or unavailable.
  }
}

/** Apply a successful auth response: persist the new session, return the profile. */
async function applyAuthSuccess(
  data: RawAccount,
  options?: { clearLocalPrivateData?: boolean },
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

  if (options?.clearLocalPrivateData) {
    await clearLocalPrivateAccountData();
  }
  try {
    await setSession({
      deviceId: profile.deviceId || undefined,
      accountId: profile.id,
      token: data.token,
      authenticated: true,
    });
  } catch (err) {
    trackApiFailure('auth_session_persist', { reason: 'secure_store', error: err });
    return {
      ok: false,
      code: 'session_storage',
      detail: 'Přihlášení se nepodařilo bezpečně uložit. Odemkni telefon a zkus to znovu.',
    };
  }
  return { ok: true, profile };
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
  const res = await authFetch('/v1/auth/register', {
    bearer: 'ensure', // claim the current anonymous account
    body: {
      email: params.email,
      password: params.password,
      display_name: params.displayName ?? '',
    },
  });
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok) return { ok: false, ...extractError(res.data, res.status) };
  return applyAuthSuccess(res.data);
}

export async function loginEmail(params: { email: string; password: string }): Promise<AuthResult> {
  const res = await authFetch('/v1/auth/login', {
    bearer: 'claim',
    body: { email: params.email, password: params.password },
  });
  if ('networkError' in res) return NETWORK_ERROR;
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
    return { ok: false, ...extractError(res.data, res.status) };
  }
  return applyAuthSuccess(res.data);
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
  const res = await authFetch('/v1/auth/google', { bearer: 'ensure', body: { id_token: idToken } });
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok) return { ok: false, ...extractError(res.data, res.status) };
  return applyAuthSuccess(res.data);
}

export async function signInWithApple(): Promise<AuthResult> {
  let credential;
  try {
    credential = await getAppleCredential();
  } catch (err) {
    return mapSocialError(err);
  }
  const res = await authFetch('/v1/auth/apple', {
    bearer: 'ensure',
    body: {
      identity_token: credential.identityToken,
      authorization_code: credential.authorizationCode,
      full_name: credential.fullName,
    },
  });
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok) return { ok: false, ...extractError(res.data, res.status) };
  return applyAuthSuccess(res.data);
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
export async function logout(options?: { all?: boolean }): Promise<AuthActionResult> {
  await disablePushDeviceForCurrentSession();
  const res = await authFetch('/v1/auth/logout', {
    bearer: 'current',
    body: { all: options?.all === true },
  });
  // Even if the network call fails, drop the local session so the UI signs out.
  await clearLocalPrivateAccountData();
  await revertToAnonymous();
  if ('networkError' in res) return { ok: true };
  return { ok: true };
}

export async function deleteAccount(): Promise<AuthActionResult> {
  const res = await authFetch('/v1/account/me', { method: 'DELETE', bearer: 'current' });
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok && res.status !== 204) {
    return { ok: false, ...extractError(res.data, res.status) };
  }
  await clearLocalPrivateAccountData();
  await revertToAnonymous();
  return { ok: true };
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
  const res = await authFetch('/v1/auth/reset-password', {
    bearer: 'none',
    body: { token: params.token, password: params.password },
  });
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok) return { ok: false, ...extractError(res.data, res.status) };
  return applyAuthSuccess(res.data, { clearLocalPrivateData: true });
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
}): Promise<AuthActionResult> {
  const res = await authFetch('/v1/content-reports', {
    method: 'POST',
    bearer: 'current',
    body: {
      target_account_id: params.targetAccountId,
      reason: params.reason,
      comment: params.comment ?? '',
      ...(params.photoId ? { photo_id: params.photoId } : {}),
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
