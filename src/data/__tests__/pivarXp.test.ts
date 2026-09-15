const applyPivarSnapshot = jest.fn();

jest.mock('@/stores/accountStore', () => ({
  useAccountStore: { getState: () => ({ applyPivarSnapshot }) },
}));

import { notePivarSnapshot } from '../pivarXp';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('notePivarSnapshot', () => {
  it('patches the drink XP component used by the combined account level', () => {
    notePivarSnapshot({
      xp: 180,
      level: 2,
      title: 'Ochutnávač',
      xp_into_level: 30,
      xp_for_next_level: 350,
      xp_awarded: 20,
    });

    expect(applyPivarSnapshot).toHaveBeenCalledWith({
      xp: 180,
      level: 2,
      title: 'Ochutnávač',
      xpIntoLevel: 30,
      xpForNextLevel: 350,
    });
  });

  it('accepts a maxed level', () => {
    notePivarSnapshot({
      xp: 18000,
      level: 7,
      title: 'Pivní legenda',
      xp_into_level: 0,
      xp_for_next_level: null,
    });
    expect(applyPivarSnapshot).toHaveBeenCalledWith(expect.objectContaining({ xpForNextLevel: null }));
  });

  it('ignores malformed snapshots', () => {
    notePivarSnapshot(null);
    notePivarSnapshot({});
    notePivarSnapshot({ xp: 10, level: 1 });
    notePivarSnapshot({ xp: 'nope', level: 1, xp_into_level: 10 });
    expect(applyPivarSnapshot).not.toHaveBeenCalled();
  });
});
