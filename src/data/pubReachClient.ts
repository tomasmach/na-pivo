/**
 * Pub reach for the pilot with pubs: pins seen on the map, pub pages opened and
 * navigation taps, sent in batches to POST /v1/pub-reach. Only the pub's geohash
 * cell and the action leave the phone; the account goes as the usual bearer token.
 *
 * A pin counts once per pub and app session, so panning the map cannot inflate it.
 * Batches wait in memory: killing the app loses at most the last half minute, and
 * a failed send never blocks anything.
 */

import { AppState } from 'react-native';

import { getBackendEndpoint } from './backendConfig';
import { telemetryHeaders, telemetrySessionGeneration } from './telemetryClient';

export type PubReachType = 'map_impression' | 'detail_view' | 'navigation';

const ENDPOINT = '/v1/pub-reach';
const FLUSH_DELAY_MS = 30_000;
const MAX_BATCH = 200;
const MAX_PENDING = 1000;
const REQUEST_TIMEOUT_MS = 8000;
/** Back after this long in the background, the app starts a new session and pins count again. */
const SESSION_GAP_MS = 30 * 60_000;
const CACHE_KEY_RE = /^[0-9b-hjkmnp-z]{8}$/;

type ReachEvent = { type: PubReachType; pub: string; at: string };

let pending: ReachEvent[] = [];
let seenPins = new Set<string>();
let generation = telemetrySessionGeneration();
let timer: ReturnType<typeof setTimeout> | null = null;
let sending = false;
let backgroundSince: number | null = null;
let listening = false;

/** A new account on this phone neither inherits the previous one's events nor its seen pins. */
function followAccount(): void {
  const current = telemetrySessionGeneration();
  if (current === generation) return;
  generation = current;
  pending = [];
  seenPins = new Set();
}

function listen(): void {
  if (listening) return;
  listening = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'background') {
      backgroundSince = Date.now();
      void flushPubReach();
    } else if (state === 'active') {
      if (backgroundSince !== null && Date.now() - backgroundSince >= SESSION_GAP_MS) seenPins = new Set();
      backgroundSince = null;
    }
  });
}

function schedule(delay = FLUSH_DELAY_MS): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flushPubReach();
  }, delay);
}

export function trackPubReach(type: PubReachType, cacheKey: string): void {
  const pub = cacheKey.toLowerCase();
  if (!CACHE_KEY_RE.test(pub)) return;
  listen();
  followAccount();
  if (type === 'map_impression') {
    if (seenPins.has(pub)) return;
    seenPins.add(pub);
  }
  if (pending.length >= MAX_PENDING) return;
  pending.push({ type, pub, at: new Date().toISOString() });
  if (pending.length >= MAX_BATCH) void flushPubReach();
  else schedule();
}

/** Pins of the map that are on screen now; each pub counts once per session. */
export function trackPinsSeen(cacheKeys: Iterable<string>): void {
  for (const key of cacheKeys) trackPubReach('map_impression', key);
}

export async function flushPubReach(): Promise<void> {
  followAccount();
  if (sending || pending.length === 0) return;
  const endpoint = getBackendEndpoint(ENDPOINT);
  if (!endpoint) return;
  const batch = pending.slice(0, MAX_BATCH);
  const sentFor = generation;
  pending = pending.slice(batch.length);
  sending = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let retry = false;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: telemetryHeaders(),
      body: JSON.stringify({ events: batch }),
      signal: controller.signal,
    });
    // A rejected batch never gets better; throttling and server errors pass.
    retry = response.status === 429 || response.status >= 500;
  } catch {
    retry = true;
  } finally {
    clearTimeout(timeout);
    sending = false;
  }
  if (retry && telemetrySessionGeneration() === sentFor) {
    pending = [...batch, ...pending].slice(0, MAX_PENDING);
    schedule();
  } else if (pending.length > 0) {
    schedule(pending.length >= MAX_BATCH ? 0 : FLUSH_DELAY_MS);
  }
}

export function resetPubReachForTests(): void {
  pending = [];
  seenPins = new Set();
  generation = telemetrySessionGeneration();
  if (timer) clearTimeout(timer);
  timer = null;
  sending = false;
  backgroundSince = null;
}
