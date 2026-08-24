import React from 'react';
import { BeerFormModal } from '../BeerFormModal';
import { cs } from '@/i18n/cs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/utils/useKeyboardHeight', () => ({ useKeyboardHeight: () => 0 }));
jest.mock('@/utils/haptics', () => ({ fireLightImpactHaptic: jest.fn() }));
jest.mock('@/components/shared/BottomSheetModal', () => {
  const ReactModule = jest.requireActual('react');
  return {
    BottomSheetModal: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
      visible ? ReactModule.createElement('BottomSheetModal', null, children) : null,
  };
});
jest.mock('@/components/shared/CloseButton', () => {
  const ReactModule = jest.requireActual('react');
  return {
    CloseButton: (props: Record<string, unknown>) =>
      ReactModule.createElement('CloseButton', props),
  };
});
jest.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: { priceCurrency: string }) => unknown) =>
    selector({ priceCurrency: 'CZK' }),
}));
jest.mock('@/components/shared/KeyboardAwareScrollView', () => {
  const ReactModule = jest.requireActual('react');
  return {
    KeyboardAwareScrollView: ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactModule.createElement('ScrollView', props, children),
  };
});
jest.mock('@/components/shared/GlowButton', () => {
  const ReactModule = jest.requireActual('react');
  return {
    GlowButton: (props: Record<string, unknown>) => ReactModule.createElement('GlowButton', props),
  };
});
jest.mock('@/components/shared/BetaBadge', () => ({ BetaBadge: () => null }));
jest.mock('@/components/shared/IconGlyph', () => {
  const ReactModule = jest.requireActual('react');
  const Icon = () => ReactModule.createElement('Icon');
  return { CameraIcon: Icon, PlusIcon: Icon, Trash2Icon: Icon, XIcon: Icon };
});

const TestRenderer = jest.requireActual('react-test-renderer');
const { act } = TestRenderer;

it('keeps BeerForm controls separate instead of grouping the whole card', () => {
  let renderer: ReturnType<typeof TestRenderer.create>;
  act(() => {
    renderer = TestRenderer.create(
      <BeerFormModal
        visible
        mode="price"
        beer={{ id: 'beer-1', name: 'Ležák', volume_ml: 500 } as never}
        onCancel={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );
  });
  const noOpGroupingPressables = renderer!.root.findAll(
    (node: { props?: Record<string, unknown> }) =>
      typeof node.props?.onPress === 'function' &&
      node.props.accessibilityRole === undefined &&
      String(node.props.onPress).includes('undefined'),
    { deep: true },
  );
  expect(noOpGroupingPressables).toHaveLength(0);
});

it('exposes an incomplete form submit as disabled to assistive technology', () => {
  jest.useFakeTimers();
  let renderer: ReturnType<typeof TestRenderer.create>;
  act(() => {
    renderer = TestRenderer.create(
      <BeerFormModal
        visible
        mode="add"
        onCancel={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );
  });
  act(() => {
    jest.runOnlyPendingTimers();
  });

  expect(renderer!.root.findByType('GlowButton').props.disabled).toBe(true);
  act(() => renderer!.unmount());
  jest.useRealTimers();
});

it('keeps the editor to one save intent without glow or a duplicate cancel action', () => {
  jest.useFakeTimers();
  let renderer: ReturnType<typeof TestRenderer.create>;
  act(() => {
    renderer = TestRenderer.create(
      <BeerFormModal
        visible
        mode="menu"
        onCancel={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );
  });
  act(() => jest.runOnlyPendingTimers());

  expect(renderer!.root.findByType('GlowButton').props.glow).toBe('none');
  expect(renderer!.root.findAllByType('CloseButton')).toHaveLength(1);
  expect(renderer!.root.findAllByProps({ accessibilityLabel: cs.counter.cancel })).toHaveLength(0);
  expect(renderer!.root.findAllByProps({ accessibilityLabel: cs.contribute.addSmallBeer })).toHaveLength(0);
  expect(renderer!.root.findAllByProps({ accessibilityLabel: cs.a11y.contributeRemoveBeer })).toHaveLength(0);
  act(() => renderer!.unmount());
  jest.useRealTimers();
});
