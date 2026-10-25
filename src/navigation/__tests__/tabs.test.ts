import { handleTabPress, partaBadge } from '../tabs';

const mockTrackUiInteraction = jest.fn();
const mockFireLightImpactHaptic = jest.fn();
let mockHapticEnabled = true;

jest.mock('@/data/uxTelemetry', () => ({
  trackUiInteraction: (...args: unknown[]) => mockTrackUiInteraction(...args),
}));
jest.mock('@/utils/haptics', () => ({
  fireLightImpactHaptic: () => mockFireLightImpactHaptic(),
}));
jest.mock('@/stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ hapticEnabled: mockHapticEnabled }) },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockHapticEnabled = true;
});

describe('handleTabPress', () => {
  it('buzzes and counts one select when switching to another tab', () => {
    handleTabPress('friends', false);
    expect(mockFireLightImpactHaptic).toHaveBeenCalledTimes(1);
    expect(mockTrackUiInteraction).toHaveBeenCalledTimes(1);
    expect(mockTrackUiInteraction).toHaveBeenCalledWith('tab_friends', 'select');
  });

  it('keeps the whitelisted target names', () => {
    for (const [route, target] of [
      ['index', 'tab_compass'],
      ['beer', 'tab_beer'],
      ['friends', 'tab_friends'],
      ['profile', 'tab_profile'],
    ]) {
      handleTabPress(route, false);
      expect(mockTrackUiInteraction).toHaveBeenLastCalledWith(target, 'select');
    }
  });

  it('buzzes on a tap of the open tab without counting it', () => {
    handleTabPress('profile', true);
    expect(mockFireLightImpactHaptic).toHaveBeenCalledTimes(1);
    expect(mockTrackUiInteraction).not.toHaveBeenCalled();
  });

  it('stays still when haptics are off', () => {
    mockHapticEnabled = false;
    handleTabPress('beer', false);
    expect(mockFireLightImpactHaptic).not.toHaveBeenCalled();
    expect(mockTrackUiInteraction).toHaveBeenCalledWith('tab_beer', 'select');
  });
});

describe('partaBadge', () => {
  it('shows pending requests as a count capped at 9+', () => {
    expect(partaBadge(3, 5, true)).toBe('3');
    expect(partaBadge(9, 0, false)).toBe('9');
    expect(partaBadge(12, 0, false)).toBe('9+');
  });

  it('falls back to an empty badge for unread items or a live friend', () => {
    expect(partaBadge(0, 2, false)).toBe('');
    expect(partaBadge(0, 0, true)).toBe('');
  });

  it('shows nothing when nothing waits', () => {
    expect(partaBadge(0, 0, false)).toBeNull();
  });
});
