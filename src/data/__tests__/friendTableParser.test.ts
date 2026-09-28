import { parseFriendTable } from '../friendsClient';

describe('parseFriendTable', () => {
  it('reads people with their request state and no place data', () => {
    const table = parseFriendTable({
      eligible: true,
      reason: null,
      visible_until: '2026-09-28T21:10:00+00:00',
      people: [
        { id: 'a', nickname: 'bara', display_name: 'Bára', avatar_url: null, is_public: true, friendship_status: 'incoming' },
        { id: 'b', nickname: 'pepa', display_name: '', avatar_url: 'https://x/a.webp', friendship_status: 'weird' },
        { nickname: 'no-id' },
      ],
    });
    expect(table).toEqual({
      eligible: true,
      reason: null,
      visibleUntil: '2026-09-28T21:10:00+00:00',
      availableAt: null,
      people: [
        { id: 'a', nickname: 'bara', displayName: 'Bára', avatarUrl: null, isPublic: true, friendshipStatus: 'incoming' },
        { id: 'b', nickname: 'pepa', displayName: '', avatarUrl: 'https://x/a.webp', isPublic: true, friendshipStatus: 'none' },
      ],
    });
  });

  it('keeps a known refusal and treats an unknown one as not eligible', () => {
    expect(
      parseFriendTable({
        eligible: false,
        reason: 'too_soon',
        visible_until: null,
        available_at: '2026-09-28T21:07:00+00:00',
        people: [],
      }),
    ).toEqual({
      eligible: false,
      reason: 'too_soon',
      visibleUntil: null,
      availableAt: '2026-09-28T21:07:00+00:00',
      people: [],
    });
    expect(parseFriendTable({ eligible: false, reason: 'future_reason' })?.eligible).toBe(false);
  });

  it('survives malformed bodies', () => {
    expect(parseFriendTable(null)).toBeNull();
    expect(parseFriendTable('nope')).toBeNull();
    expect(parseFriendTable({ eligible: true, visible_until: 'garbage', available_at: 3, people: 'x' })).toEqual({
      eligible: true,
      reason: null,
      visibleUntil: null,
      availableAt: null,
      people: [],
    });
  });
});
