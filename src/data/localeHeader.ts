/**
 * Tell the backend which language the UI runs in. There is no central HTTP
 * client (each feature owns its fetch calls), so the header is added once
 * here for every request that targets the backend base URL. Released app
 * versions send nothing and the server keeps defaulting to Czech.
 */

import { locale } from '@/i18n';

import { getBackendUrl, trimTrailingSlash } from './backendConfig';

let installed = false;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export function installBackendLocaleHeader(): void {
  if (installed) return;
  installed = true;
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const base = trimTrailingSlash(getBackendUrl());
    if (!base || !requestUrl(input).startsWith(base)) return original(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has('Accept-Language')) headers.set('Accept-Language', locale);
    return original(input, { ...init, headers });
  }) as typeof fetch;
}
