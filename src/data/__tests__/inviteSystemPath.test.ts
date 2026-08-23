import { canonicalizeInviteSystemPath } from '../inviteSystemPath';

describe('canonicalizeInviteSystemPath', () => {
  it.each([
    ['napivo://parta/pozvanka?code=Ab3xK9_pQ2sT', '/parta/pozvanka?code=Ab3xK9_pQ2sT'],
    ['https://na-pivo.cz/p/Ab3xK9_pQ2sT', '/parta/pozvanka?code=Ab3xK9_pQ2sT'],
  ])('canonicalizes friend invite %s', (path, expected) => {
    expect(canonicalizeInviteSystemPath(path, 'request-1')).toBe(expected);
  });

  it.each([
    'napivo://party-live?code=EFJ66G',
    'https://na-pivo.cz/party/efj66g',
  ])('canonicalizes party invite %s and gives each delivery an id', (path) => {
    expect(canonicalizeInviteSystemPath(path, 'warm-2')).toBe(
      '/party-live?joinCode=EFJ66G&invite=warm-2',
    );
  });

  it.each([
    '/friends/parta',
    '/parta/pozvanka?code=already-canonical',
    'https://na-pivo.cz/privacy',
    'napivo://party-live?code=50%',
    'not a url at all',
  ])('leaves unrelated or already canonical path unchanged: %s', (path) => {
    expect(canonicalizeInviteSystemPath(path, 'request-1')).toBe(path);
  });

  it('never throws on malformed percent encoding', () => {
    const malformed = 'napivo://parta/pozvanka?code=broken%';
    expect(() => canonicalizeInviteSystemPath(malformed, 'request-1')).not.toThrow();
    expect(canonicalizeInviteSystemPath(malformed, 'request-1')).toBe(malformed);
  });
});
