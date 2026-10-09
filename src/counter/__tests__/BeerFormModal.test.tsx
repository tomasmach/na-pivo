/**
 * The fix sheet for a rejected drink opens without the keyboard unless the name
 * is what needs fixing, so the size and price the hint asks about stay visible.
 */

import React from 'react';
import { TextInput } from 'react-native';
import { BeerFormModal } from '../BeerFormModal';
import { t } from '@/i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/utils/useKeyboardHeight', () => ({ useKeyboardHeight: () => 0 }));
jest.mock('@/utils/haptics', () => ({ fireLightImpactHaptic: jest.fn() }));
jest.mock('@/data/beerSuggestionsClient', () => ({ suggestBeerBrands: jest.fn(async () => []) }));
jest.mock('@/components/shared/GlowButton', () => {
  const ReactModule = require('react');
  return { GlowButton: () => ReactModule.createElement('GlowButton') };
});
jest.mock('@/components/shared/BetaBadge', () => ({ BetaBadge: () => null }));
jest.mock('@/components/shared/KeyboardAwareScrollView', () => {
  const ReactModule = require('react');
  return {
    KeyboardAwareScrollView: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement('Scroll', null, children),
  };
});
jest.mock('@/components/shared/IconGlyph', () => {
  const ReactModule = require('react');
  const icon = () => ReactModule.createElement('Icon');
  return new Proxy({}, { get: () => icon });
});
jest.mock('@/theme/fonts', () => ({
  Fonts: {
    display: { bold: 'display-bold', extrabold: 'display-extrabold' },
    ui: { regular: 'ui-regular', medium: 'ui-medium', semibold: 'ui-semibold', bold: 'ui-bold' },
  },
  FontScaleCap: { display: 1.1, heading: 1.2, body: 1.3 },
}));
jest.mock('@/theme/shadows', () => ({ softDrop: () => ({}) }));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

function nameAutoFocus(props: Partial<React.ComponentProps<typeof BeerFormModal>>): boolean {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  act(() => {
    renderer = TestRenderer.create(
      <BeerFormModal
        visible
        mode="add"
        beer={{ name: 'Pilsner Urquell', priceCzk: 55, volumeMl: 500 }}
        onCancel={() => undefined}
        onSubmit={() => undefined}
        {...props}
      />,
    );
  });
  const focused = renderer.root.findAllByType(TextInput)[0].props.autoFocus;
  act(() => renderer.unmount());
  return focused;
}

describe('BeerFormModal name autofocus', () => {
  it('keeps focusing the name in the normal add form', () => {
    expect(nameAutoFocus({})).toBe(true);
  });

  it('opens a fix sheet without the keyboard when the name is fine', () => {
    expect(nameAutoFocus({ autoFocusName: false })).toBe(false);
  });
});

describe('BeerFormModal price edit', () => {
  it('stays about the price: no delete action in the form', () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(
        <BeerFormModal
          visible
          mode="edit"
          beer={{ name: 'Primátor 11', priceCzk: 55, volumeMl: 500 }}
          onCancel={() => undefined}
          onSubmit={() => undefined}
        />,
      );
    });
    const texts = renderer.root
      .findAll((n: any) => n.type === 'Text')
      .map((n: any) => String(n.props.children));
    expect(texts.some((text: string) => text.startsWith("Smazat"))).toBe(false);
    act(() => renderer.unmount());
  });

  it('keeps the contribute editor delete in menu mode', () => {
    const onRemove = jest.fn();
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(
        <BeerFormModal
          visible
          mode="menu"
          beer={{ name: 'Primátor 11', priceCzk: 55, volumeMl: 500 }}
          onCancel={() => undefined}
          onSubmit={() => undefined}
          onRemove={onRemove}
        />,
      );
    });
    const [button] = renderer.root.findAll(
      (n: any) => n.props?.accessibilityRole === 'button' && n.props?.accessibilityLabel === t.a11y.contributeRemoveBeer && typeof n.props?.onPress === 'function',
    );
    act(() => button.props.onPress());
    expect(onRemove).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });
});
