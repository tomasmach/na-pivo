import React from 'react';

import HourStepper from '@/friends/HourStepper';
import SegmentedControl from '@/friends/SegmentedControl';
import { t } from '@/i18n';
import BoardSegmented from '@/leaderboards/BoardSegmented';
import PeriodChips from '@/leaderboards/PeriodChips';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockSelection = jest.fn();
const mockLightImpact = jest.fn();
let mockHapticEnabled = true;

jest.mock('@/utils/haptics', () => ({
  fireSelectionHaptic: () => mockSelection(),
  fireLightImpactHaptic: () => mockLightImpact(),
}));
jest.mock('@/stores/settingsStore', () => {
  const state = () => ({ hapticEnabled: mockHapticEnabled });
  const useSettingsStore = (selector: (s: ReturnType<typeof state>) => unknown) => selector(state());
  useSettingsStore.getState = state;
  return { useSettingsStore };
});
jest.mock('@/components/shared/IconGlyph', () => new Proxy({}, { get: () => () => null }));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

function tap(element: React.ReactElement, label: string) {
  let renderer: any;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  const target = renderer.root.find(
    (node: any) => typeof node.type === 'string' && node.props.accessibilityLabel === label,
  );
  act(() => target.props.onPress());
  act(() => renderer.unmount());
}

const controls: [string, () => React.ReactElement, string][] = [
  ['SegmentedControl', () => <SegmentedControl options={['Poblíž', 'Nedávné']} value={0} onChange={jest.fn()} />, 'Nedávné'],
  ['BoardSegmented', () => <BoardSegmented options={['Pivaři', 'Mapéři']} value={0} onChange={jest.fn()} />, 'Mapéři'],
  [
    'PeriodChips',
    () => (
      <PeriodChips
        options={[{ key: 'week', label: 'Týden' }, { key: 'all', label: 'Celkem' }]}
        value="week"
        onChange={jest.fn()}
      />
    ),
    'Celkem',
  ],
];

beforeEach(() => {
  jest.clearAllMocks();
  mockHapticEnabled = true;
});

describe('switches give the selection haptic', () => {
  it.each(controls)('%s clicks once on a new value, not with an impact', (_name, element, other) => {
    tap(element(), other);
    expect(mockSelection).toHaveBeenCalledTimes(1);
    expect(mockLightImpact).not.toHaveBeenCalled();
  });

  it.each(controls)('%s stays silent with haptics off', (_name, element, other) => {
    mockHapticEnabled = false;
    tap(element(), other);
    expect(mockSelection).not.toHaveBeenCalled();
  });

  it('the hour stepper clicks on every step', () => {
    const onChange = jest.fn();
    tap(
      <HourStepper value={19} onChange={onChange} accessibilityLabel="Od" />,
      `Od: ${t.friends.hourStepperIncrement}`,
    );
    expect(onChange).toHaveBeenCalledWith(20);
    expect(mockSelection).toHaveBeenCalledTimes(1);
    expect(mockLightImpact).not.toHaveBeenCalled();
  });
});
