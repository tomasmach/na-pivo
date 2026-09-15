import { redirectSystemPath } from '../../../app/+native-intent';
import { isLegacyTableInviteUrl, parseInviteCodeFromUrl } from '../inviteLinkRoutes';

describe('restored app invitation routes', () => {
  it.each([
    'napivo://party-live?code=QATABLE',
    'napivo:///party-live?code=QATABLE',
    'https://na-pivo.cz/party/QATABLE',
  ])('opens the removed-table state without claiming a friend invite: %s', (path) => {
    expect(parseInviteCodeFromUrl(path)).toBeNull();
    expect(isLegacyTableInviteUrl(path)).toBe(true);
    for (const initial of [true, false]) {
      expect(redirectSystemPath({ path, initial })).toBe('/party-live');
    }
  });

  it.each([
    'napivo://parta/pozvanka?code=Ab3xK9_pQ2sT',
    'napivo:///parta/pozvanka?code=Ab3xK9_pQ2sT',
    'https://na-pivo.cz/p/Ab3xK9_pQ2sT',
  ])('preserves friend invitation codes: %s', (path) => {
    expect(parseInviteCodeFromUrl(path)).toBe('Ab3xK9_pQ2sT');
    expect(isLegacyTableInviteUrl(path)).toBe(false);
    expect(redirectSystemPath({ path, initial: false })).toBe(path);
  });

  it.each([
    'https://example.com/p/ABC',
    'https://example.com/?code=ABC',
    'https://na-pivo.cz.example.com/p/ABC',
    'https://na-pivo.cz@evil.example/p/ABC',
    'https://evil.example@na-pivo.cz/p/ABC',
    'https://na-pivo.cz/settings?code=ABC',
    'napivo://settings?code=ABC',
    'napivo://parta/pozvanka?code=%E0%A4%A',
    'napivo://parta/pozvanka?code=%2F',
    'https://na-pivo.cz/p/ABC/extra',
    'https://na-pivo.cz/p/%E0%A4%A',
    'not a url',
  ])('ignores unrelated or malformed links without throwing: %s', (path) => {
    expect(parseInviteCodeFromUrl(path)).toBeNull();
  });

  it('uses the web path code rather than an unrelated query parameter', () => {
    expect(parseInviteCodeFromUrl('https://na-pivo.cz/p/REAL?code=OTHER')).toBe('REAL');
  });

  it.each([
    'https://example.com/party/ABC',
    'napivo://settings?next=/party/ABC',
    'https://na-pivo.cz/party/ABC/extra',
    'not a url',
  ])('leaves unrelated system links alone: %s', (path) => {
    expect(isLegacyTableInviteUrl(path)).toBe(false);
    expect(redirectSystemPath({ path, initial: true })).toBe(path);
  });
});
