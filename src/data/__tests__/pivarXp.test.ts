import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const show = jest.fn();
jest.mock('@/stores/toastStore', () => ({
  useToastStore: { getState: () => ({ show }) },
}));

import { notePivarSnapshot } from '../pivarXp';
import { cs } from '@/i18n/cs';

const LEVEL_KEY = 'na-pivo-pivar-level';

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('notePivarSnapshot', () => {
  it('seeds the first seen level silently (no toast for history)', async () => {
    await notePivarSnapshot({ level: 4, title: 'Výčepní' });
    expect(show).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(LEVEL_KEY)).toBe('4');
  });

  it('toasts once when the level increases', async () => {
    await notePivarSnapshot({ level: 1, title: 'Zelenáč' });
    await notePivarSnapshot({ level: 2, title: 'Ochutnávač' });
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith(cs.pivar.levelUpToast('Ochutnávač'));
    expect(await AsyncStorage.getItem(LEVEL_KEY)).toBe('2');
  });

  it('stays quiet on the same or a lower level', async () => {
    await notePivarSnapshot({ level: 3, title: 'Pivní tovaryš' });
    await notePivarSnapshot({ level: 3, title: 'Pivní tovaryš' });
    await notePivarSnapshot({ level: 2, title: 'Ochutnávač' });
    expect(show).not.toHaveBeenCalled();
    // A lower level (e.g. server reset) re-seeds so a future climb toasts again.
    expect(await AsyncStorage.getItem(LEVEL_KEY)).toBe('2');
  });

  it('ignores malformed snapshots', async () => {
    await notePivarSnapshot(null);
    await notePivarSnapshot({});
    await notePivarSnapshot({ level: 'nope' });
    expect(show).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(LEVEL_KEY)).toBeNull();
  });

  it('serializes concurrent notes so one level-up toasts exactly once', async () => {
    await notePivarSnapshot({ level: 1, title: 'Zelenáč' });
    await Promise.all([
      notePivarSnapshot({ level: 2, title: 'Ochutnávač' }),
      notePivarSnapshot({ level: 2, title: 'Ochutnávač' }),
    ]);
    expect(show).toHaveBeenCalledTimes(1);
  });
});
