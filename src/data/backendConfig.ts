import Constants from 'expo-constants';
import { Platform } from 'react-native';

const DEFAULT_LOCAL_BACKEND_PORT = '8000';
const LOCAL_BACKEND_MODES = new Set(['local', 'auto']);
const REMOTE_BACKEND_MODES = new Set(['remote', 'production', 'prod']);

function isDevRuntime(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

export function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function normalizeBackendUrl(url: string): string {
  return trimTrailingSlash(url.trim());
}

function normalizePort(port: string): string {
  const trimmed = port.trim();
  return /^\d{1,5}$/.test(trimmed) ? trimmed : DEFAULT_LOCAL_BACKEND_PORT;
}

function hostIsLoopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function formatHostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function extractHost(candidate: string | undefined | null): string | null {
  const raw = candidate?.trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw.includes('://') ? raw : `http://${raw}`);
    return parsed.hostname.replace(/^\[(.*)\]$/, '$1');
  } catch {
    return null;
  }
}

function getExpoDevServerHost(): string | null {
  const expoConfigHost = extractHost(Constants.expoConfig?.hostUri);
  if (expoConfigHost) return expoConfigHost;

  const expoGoHost = extractHost(Constants.expoGoConfig?.debuggerHost);
  if (expoGoHost) return expoGoHost;

  const manifest = Constants.manifest as { debuggerHost?: string; hostUri?: string } | null;
  return extractHost(manifest?.debuggerHost) ?? extractHost(manifest?.hostUri);
}

function getLocalBackendUrl(): string {
  const port = normalizePort(
    (process.env.EXPO_PUBLIC_BACKEND_PORT ?? '').trim() || DEFAULT_LOCAL_BACKEND_PORT,
  );
  let host = (process.env.EXPO_PUBLIC_BACKEND_HOST ?? '').trim() || getExpoDevServerHost();

  if (!host) {
    host = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
  } else if (Platform.OS === 'android' && hostIsLoopback(host)) {
    host = '10.0.2.2';
  }

  return `http://${formatHostForUrl(host)}:${port}`;
}

export function getBackendUrl(): string {
  const rawConfiguredUrl = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim();
  const configuredUrl = normalizeBackendUrl(rawConfiguredUrl);
  const mode = (process.env.EXPO_PUBLIC_BACKEND_MODE ?? '').trim().toLowerCase();
  const configuredUrlMode = rawConfiguredUrl.toLowerCase();

  if (REMOTE_BACKEND_MODES.has(mode)) {
    return configuredUrl;
  }

  if (
    isDevRuntime() &&
    (LOCAL_BACKEND_MODES.has(mode) || LOCAL_BACKEND_MODES.has(configuredUrlMode))
  ) {
    return getLocalBackendUrl();
  }

  if (LOCAL_BACKEND_MODES.has(configuredUrlMode)) {
    return '';
  }

  return configuredUrl;
}

export function getBackendEndpoint(path: string): string | null {
  const baseUrl = getBackendUrl();
  if (!baseUrl) return null;

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimTrailingSlash(baseUrl)}${normalizedPath}`;
}
