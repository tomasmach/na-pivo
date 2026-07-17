/**
 * Privacy-safe app telemetry.
 *
 * This is the only client-side module that may send diagnostic/product events.
 * Keep the event and context whitelists narrow: no bearer tokens, no request or
 * response bodies, no GPS coordinates, no pub names, no feedback text/contact.
 */

import { Platform } from 'react-native';

import type { AccountSession } from './account';
import { getBackendEndpoint } from './backendConfig';
import { getAppVersionLabel } from '@/utils/appVersion';

export type ClientTelemetryEvent =
  | 'app_open'
  | 'app_foreground'
  | 'onboarding_started'
  | 'onboarding_completed'
  | 'onboarding_skipped'
  | 'onboarding_auth_opened'
  | 'walking_distance'
  | 'counter_tab_opened'
  | 'counter_session_started'
  | 'counter_session_closed'
  | 'counter_session_resumed'
  | 'drink_added'
  | 'drink_removed'
  | 'drink_synced'
  | 'drink_sync_failed'
  | 'rating_synced'
  | 'rating_sync_failed'
  | 'amenity_vote_synced'
  | 'amenity_vote_failed'
  | 'visit_synced'
  | 'visit_sync_failed'
  | 'beer_form_opened'
  | 'beer_form_scan_opened'
  | 'leaderboards_opened'
  | 'beer_price_added'
  | 'counter_returned_same_day'
  | 'counter_returned_later'
  | 'console_warn'
  | 'console_error'
  | 'unhandled_error'
  | 'api_failure';

export type ClientTelemetrySeverity = 'info' | 'warning' | 'error';

type TelemetryContextValue = string | number | boolean | null | undefined;

export interface ClientTelemetryInput {
  event: ClientTelemetryEvent;
  severity?: ClientTelemetrySeverity;
  message?: unknown;
  context?: Record<string, TelemetryContextValue>;
}

const REQUEST_TIMEOUT_MS = 4000;
const MAX_EVENTS_PER_SESSION = 120;
const MAX_REPEATS_PER_MESSAGE = 3;
const CONTEXT_KEYS = new Set([
  'operation',
  'endpoint',
  'status',
  'reason',
  'error_name',
  'error_message',
  'stack',
  'source',
  'mode',
  'queue',
  'pending_count',
  'sync_result',
  'delivery_state',
  'return_days',
  'had_active_session',
  'retryable',
  'distance_m',
  'duration_ms',
  'slide',
]);

const EMAIL_RE = /[\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+\.[A-Za-z]{2,}/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const LONG_TOKEN_RE = /\b[A-Za-z0-9._~+/=-]{32,}\b/g;

let sessionToken: string | null = null;
let installed = false;
let sentThisSession = 0;
const messageRepeats = new Map<string, number>();

export function setTelemetrySession(session: AccountSession | null): void {
  sessionToken = session?.token ?? null;
}

export function resetTelemetryForTests(): void {
  sessionToken = null;
  sentThisSession = 0;
  messageRepeats.clear();
}

function sanitizeText(value: unknown, maxLen: number): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text
    .replace(BEARER_RE, 'Bearer [redacted]')
    .replace(EMAIL_RE, '[redacted-email]')
    .replace(UUID_RE, '[redacted-uuid]')
    .replace(LONG_TOKEN_RE, '[redacted-token]')
    .slice(0, maxLen);
}

function sanitizeEndpoint(value: unknown): string {
  const raw = sanitizeText(value, 240);
  if (!raw) return '';
  try {
    const parsed = new URL(raw.includes('://') ? raw : `https://na-pivo.local${raw}`);
    return parsed.pathname;
  } catch {
    return raw.split('?')[0].slice(0, 240);
  }
}

function sanitizeError(error: unknown): {
  message: string;
  errorName: string;
  errorMessage: string;
  stack: string;
} {
  if (error instanceof Error) {
    return {
      message: sanitizeText(`${error.name}: ${error.message}`, 300),
      errorName: sanitizeText(error.name, 80),
      errorMessage: sanitizeText(error.message, 240),
      stack: sanitizeText(error.stack ?? '', 800),
    };
  }
  return {
    message: sanitizeText(error, 300),
    errorName: '',
    errorMessage: sanitizeText(error, 240),
    stack: '',
  };
}

function sanitizeConsoleMessage(args: unknown[]): {
  message: string;
  context: Record<string, TelemetryContextValue>;
} {
  const parts: string[] = [];
  const context: Record<string, TelemetryContextValue> = {};

  for (const arg of args.slice(0, 4)) {
    if (arg instanceof Error) {
      const clean = sanitizeError(arg);
      if (clean.message) parts.push(clean.message);
      if (clean.errorName) context.error_name = clean.errorName;
      if (clean.errorMessage) context.error_message = clean.errorMessage;
      if (clean.stack) context.stack = clean.stack;
      continue;
    }
    if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean') {
      const clean = sanitizeText(arg, 160);
      if (clean) parts.push(clean);
    } else if (arg !== null && arg !== undefined) {
      parts.push(`[${Object.prototype.toString.call(arg).slice(8, -1)}]`);
    }
  }

  return {
    message: parts.join(' ').slice(0, 300),
    context,
  };
}

function sanitizeContext(
  context: Record<string, TelemetryContextValue> | undefined,
): Record<string, TelemetryContextValue> {
  if (!context) return {};
  const out: Record<string, TelemetryContextValue> = {};
  for (const [key, value] of Object.entries(context)) {
    if (!CONTEXT_KEYS.has(key) || value === undefined || value === null) continue;
    if (key === 'endpoint') {
      const endpoint = sanitizeEndpoint(value);
      if (endpoint) out[key] = endpoint;
      continue;
    }
    if (
      key === 'distance_m' ||
      key === 'status' ||
      key === 'pending_count' ||
      key === 'return_days' ||
      key === 'duration_ms' ||
      key === 'slide'
    ) {
      const numberValue = Number(value);
      if (Number.isFinite(numberValue)) out[key] = Math.max(0, Math.round(numberValue));
      continue;
    }
    if (typeof value === 'boolean') {
      out[key] = value;
    } else {
      const maxLen = key === 'stack' ? 800 : 240;
      const text = sanitizeText(value, maxLen);
      if (text) out[key] = text;
    }
  }
  return out;
}

function shouldSend(input: ClientTelemetryInput): boolean {
  if (sentThisSession >= MAX_EVENTS_PER_SESSION) return false;
  if (input.event === 'console_warn' || input.event === 'console_error') {
    const key = `${input.event}:${sanitizeText(input.message, 120)}`;
    const count = messageRepeats.get(key) ?? 0;
    if (count >= MAX_REPEATS_PER_MESSAGE) return false;
    messageRepeats.set(key, count + 1);
  }
  sentThisSession += 1;
  return true;
}

function telemetryHeaders(): Record<string, string> {
  const appVersion = getAppVersionLabel();
  const platform = Platform.OS;
  const osVersion = String(Platform.Version);
  return {
    'Content-Type': 'application/json',
    'X-Na-Pivo-App-Version': appVersion,
    'X-Na-Pivo-Platform': platform,
    'X-Na-Pivo-OS-Version': osVersion,
    ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
  };
}

export async function trackClientEvent(input: ClientTelemetryInput): Promise<void> {
  if (!shouldSend(input)) return;

  const endpoint = getBackendEndpoint('/v1/client-events');
  if (!endpoint) return;

  const appVersion = getAppVersionLabel();
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);

  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: telemetryHeaders(),
      body: JSON.stringify({
        event: input.event,
        severity: input.severity ?? 'info',
        message: sanitizeText(input.message, 300),
        context: sanitizeContext(input.context),
        app_version: appVersion,
        platform: Platform.OS,
        os_version: String(Platform.Version),
      }),
      signal: timeoutController.signal,
    });
  } catch {
    // Telemetry must never affect the app or log recursively.
  } finally {
    clearTimeout(timeoutId);
  }
}

export function trackApiFailure(
  operation: string,
  details: {
    status?: number;
    reason?: string;
    endpoint?: string;
    error?: unknown;
    sync_result?: string;
    retryable?: boolean;
  } = {},
): void {
  const cleanError = details.error ? sanitizeError(details.error) : null;
  void trackClientEvent({
    event: 'api_failure',
    severity: 'warning',
    message: cleanError?.message || details.reason || operation,
    context: {
      operation,
      endpoint: details.endpoint,
      status: details.status,
      reason: details.reason,
      error_name: cleanError?.errorName,
      error_message: cleanError?.errorMessage,
      stack: cleanError?.stack,
      sync_result: details.sync_result,
      retryable: details.retryable,
    },
  });
}

export function installClientTelemetry(): void {
  if (installed) return;
  installed = true;

  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    const clean = sanitizeConsoleMessage(args);
    void trackClientEvent({
      event: 'console_warn',
      severity: 'warning',
      message: clean.message,
      context: clean.context,
    });
  };

  console.error = (...args: unknown[]) => {
    originalError(...args);
    const clean = sanitizeConsoleMessage(args);
    void trackClientEvent({
      event: 'console_error',
      severity: 'error',
      message: clean.message,
      context: clean.context,
    });
  };

  const globalWithErrors = globalThis as typeof globalThis & {
    ErrorUtils?: {
      getGlobalHandler?: () => (error: Error, isFatal?: boolean) => void;
      setGlobalHandler?: (handler: (error: Error, isFatal?: boolean) => void) => void;
    };
  };
  const previousHandler = globalWithErrors.ErrorUtils?.getGlobalHandler?.();

  globalWithErrors.ErrorUtils?.setGlobalHandler?.((error, isFatal) => {
    const clean = sanitizeError(error);
    void trackClientEvent({
      event: 'unhandled_error',
      severity: 'error',
      message: clean.message,
      context: {
        error_name: clean.errorName,
        error_message: clean.errorMessage,
        stack: clean.stack,
        reason: isFatal ? 'fatal' : 'non_fatal',
      },
    });
    previousHandler?.(error, isFatal);
  });
}
