import { useSettingsStore } from '@/stores/settingsStore';
import { fireRigidImpactHaptic, fireSelectionHaptic } from '@/utils/haptics';

import { dialog } from '../../../ui/store';
import { logDrink } from '../counterActions';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/utils/haptics', () => ({ fireSelectionHaptic: jest.fn(), fireRigidImpactHaptic: jest.fn() }));
jest.mock('@/counter/countDrink', () => ({ countDrink: jest.fn(() => ({ session: null })), isRapidDrink: jest.fn(() => true) }));
jest.mock('../../../ui/store', () => ({ dialog: jest.fn(), toast: jest.fn() }));

const place = { kind: 'outside', context: 'private' } as const;
const beer = { name: 'Kozel 11°', drinkType: 'beer' } as const;

describe('a beer logged soon after the last one buzzes once', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSettingsStore.setState({ hapticEnabled: true });
  });

  it('a silent tap buzzes when the question opens, and confirming buzzes only for the count', () => {
    logDrink(place, beer, undefined, { silentTap: true });
    expect(fireSelectionHaptic).toHaveBeenCalledTimes(1);
    const confirm = jest.mocked(dialog).mock.calls[0][0].actions.at(-1)!;
    expect(confirm.haptic).toBe(false);
    confirm.onPress?.();
    expect(fireRigidImpactHaptic).toHaveBeenCalledTimes(1);
  });

  it('a tap that buzzed on its own adds no second buzz before the question', () => {
    logDrink(place, beer);
    expect(fireSelectionHaptic).not.toHaveBeenCalled();
  });
});
