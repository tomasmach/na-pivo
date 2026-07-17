import { buildFriendInviteWebUrl } from '../friendsClient';

describe('buildFriendInviteWebUrl', () => {
  it('builds the canonical public invite URL', () => {
    expect(buildFriendInviteWebUrl('Ab3xK9_pQ2sT')).toBe(
      'https://na-pivo.cz/p/Ab3xK9_pQ2sT',
    );
  });

  it('escapes unexpected path characters defensively', () => {
    expect(buildFriendInviteWebUrl('a/b')).toBe('https://na-pivo.cz/p/a%2Fb');
  });
});
