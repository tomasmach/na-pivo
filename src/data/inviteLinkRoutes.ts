/** Only links issued by Na pivo may become friend invitations. */
function parseAppUrl(value: string | null | undefined): { url: URL; path: string } | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.port) return null;
    if (url.protocol === 'napivo:') {
      return { url, path: url.hostname ? `/${url.hostname}${url.pathname}` : url.pathname };
    }
    if (url.protocol === 'https:' && url.hostname === 'na-pivo.cz') {
      return { url, path: url.pathname };
    }
  } catch {
    // Malformed external links must not crash startup.
  }
  return null;
}

export function parseInviteCodeFromUrl(value: string | null | undefined): string | null {
  const parsed = parseAppUrl(value);
  if (!parsed) return null;
  const { url, path } = parsed;
  const candidate = path === '/parta/pozvanka'
    ? url.searchParams.get('code')
    : /^\/p\/([A-Za-z0-9_-]+)\/?$/.exec(path)?.[1];
  const code = candidate?.trim();
  return code && /^[A-Za-z0-9_-]+$/.test(code) ? code : null;
}

export function isLegacyTableInviteUrl(value: string | null | undefined): boolean {
  const parsed = parseAppUrl(value);
  return !!parsed && (
    parsed.path === '/party-live' || /^\/party\/[^/]+\/?$/.test(parsed.path)
  );
}

/** A tour token is opaque; accept only our own domains and exact path. */
export function parseTourTokenFromUrl(value: string | null | undefined): string | null {
  const parsed = parseAppUrl(value);
  if (!parsed) return null;
  return /^\/t\/([A-Za-z0-9_-]{20,128})\/?$/.exec(parsed.path)?.[1] ?? null;
}

/** The joint-run id a party QR adds to a public tour link (`?r=`). */
export function parseTourRunFromUrl(value: string | null | undefined): string | null {
  const parsed = parseAppUrl(value);
  if (!parsed || !/^\/t\/[A-Za-z0-9_-]{20,128}\/?$/.test(parsed.path)) return null;
  const run = parsed.url.searchParams.get('r');
  return run && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(run) ? run.toLowerCase() : null;
}
