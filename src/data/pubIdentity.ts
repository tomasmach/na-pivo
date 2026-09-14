const SPACE_RE = /\s+/g;
const IDENTITY_SEPARATOR = '::';

/**
 * The locale is pinned to 'cs-CZ' on purpose and must NOT follow the UI language:
 * this feeds a persisted identity key, so the same pub name has to fold to the
 * same string on every phone, in every language, forever.
 */
export function normalizePubNameForIdentity(name: string | null | undefined): string {
  return (name ?? '').trim().toLocaleLowerCase('cs-CZ').replace(SPACE_RE, ' ');
}

export function pubIdentityKey(cacheKey: string, name: string | null | undefined): string {
  const normalizedName = normalizePubNameForIdentity(name);
  return normalizedName ? `${cacheKey}${IDENTITY_SEPARATOR}${normalizedName}` : cacheKey;
}

export function cacheKeyFromPubIdentityKey(identityKey: string): string {
  const separatorIndex = identityKey.indexOf(IDENTITY_SEPARATOR);
  return separatorIndex >= 0 ? identityKey.slice(0, separatorIndex) : identityKey;
}

export function nameFromPubIdentityKey(identityKey: string): string | null {
  const separatorIndex = identityKey.indexOf(IDENTITY_SEPARATOR);
  if (separatorIndex < 0) return null;
  const name = identityKey.slice(separatorIndex + IDENTITY_SEPARATOR.length).trim();
  return name || null;
}
