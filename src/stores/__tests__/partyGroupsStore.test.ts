import { sanitizePartyGroups } from '../partyGroupsStore';

describe('party groups persisted schema', () => {
  it('keeps valid legacy groups and drops malformed nested rows', () => {
    const valid = {
      id: 'group-1',
      name: 'Štamgasti',
      memberIds: ['friend-1'],
      updatedAt: '2026-08-21T12:00:00.000Z',
    };

    expect(sanitizePartyGroups([valid, null, {}, { ...valid, memberIds: 'friend-1' }]))
      .toEqual([valid]);
  });
});
