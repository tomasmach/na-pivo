import { parsePartyInviteCodeFromUrl } from '../partyInviteLink';

describe('parsePartyInviteCodeFromUrl', () => {
  it.each([
    ['napivo://party-live?code=EFJ66G', 'EFJ66G'],
    ['https://na-pivo.cz/party/2jw642', '2JW642'],
  ])('reads a table code from %s', (url, code) => {
    expect(parsePartyInviteCodeFromUrl(url)).toBe(code);
  });

  it.each([
    'napivo://parta/pozvanka?code=EFJ66G',
    'https://na-pivo.cz/p/EFJ66G',
    'https://example.com/party/EFJ66G',
    'https://na-pivo.cz/party/SHORT',
    'https://na-pivo.cz/privacy?code=EFJ66G',
    'napivo://party-live?code=50%',
    // A friend-invite link must never be mistaken for a table code on cold start.
    'https://na-pivo.cz/p/Ab3xK9_pQ2sT?code=EFJ66G',
    // Trailing junk and empty query forms carry no code.
    'napivo://party-live',
    'napivo://party-live?',
  ])('rejects non-table link %s', (url) => {
    expect(parsePartyInviteCodeFromUrl(url)).toBeNull();
  });

  it('reads a code from push-shaped links on cold start', () => {
    expect(parsePartyInviteCodeFromUrl('napivo://party-live?code=EFJ66G&source=push')).toBe(
      'EFJ66G',
    );
    expect(parsePartyInviteCodeFromUrl('https://na-pivo.cz/party/EFJ66G?utm_source=qr')).toBe(
      'EFJ66G',
    );
  });

  it('keeps the friend-invite parser and table parser from colliding', async () => {
    const { parseInviteCodeFromUrl } = await import('../friendInviteLink');
    const tableUrl = 'https://na-pivo.cz/party/EFJ66G';
    const friendUrl = 'https://na-pivo.cz/p/Ab3xK9_pQ2sT';

    expect(parsePartyInviteCodeFromUrl(tableUrl)).toBe('EFJ66G');
    expect(parseInviteCodeFromUrl(tableUrl)).toBeNull();
    expect(parsePartyInviteCodeFromUrl(friendUrl)).toBeNull();
    expect(parseInviteCodeFromUrl(friendUrl)).toBe('Ab3xK9_pQ2sT');
  });
});
