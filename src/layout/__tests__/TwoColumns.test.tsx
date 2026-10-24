import React from 'react';
import { useWindowDimensions } from 'react-native';

import { useModalFrame } from '@/components/shared/Modal';
import { PaneContext, usePane, type PaneInfo } from '@/layout/pane';
import { TwoColumns } from '@/layout/TwoColumns';
import { useBookStore } from '@/stores/bookStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaInsetsContext: jest.requireActual<typeof import('react')>('react').createContext(null),
}));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

function setWindow(width: number, height: number) {
  (useWindowDimensions as jest.Mock).mockReturnValue({ width, height, scale: 3, fontScale: 1 });
}

/** Shows what a column sees: its half, and where a sheet opened from it goes. */
function Probe({ name }: { name: string }) {
  return React.createElement('Probe', { name, pane: usePane(), sheetOnLeft: useModalFrame().left });
}

const seen = (renderer: any, name: string) => {
  const { pane, sheetOnLeft } = renderer.root.find((node: any) => node.type === 'Probe' && node.props.name === name).props;
  return { pane, sheetOnLeft };
};

const PARTA: PaneInfo = { tab: 'parta', side: 'primary' };

const mounted: any[] = [];

function render() {
  let renderer: any;
  act(() => {
    renderer = TestRenderer.create(
      <PaneContext.Provider value={PARTA}>
        <TwoColumns first={<Probe name="first" />} second={<Probe name="second" />} />
      </PaneContext.Provider>,
    );
  });
  mounted.push(renderer);
  return renderer;
}

/** The host view of the second column. */
const secondColumn = (renderer: any) =>
  renderer.root.find((node: any) => node.type === 'View' && node.props.importantForAccessibility !== undefined)
    .props;

describe('TwoColumns', () => {
  beforeEach(() => {
    useBookStore.setState(useBookStore.getInitialState(), true);
  });

  afterEach(() => {
    act(() => mounted.splice(0).forEach((renderer) => renderer.unmount()));
  });

  afterAll(() => setWindow(390, 844));

  it('makes the second column the right half of a book, so its sheets open there', () => {
    // A photo tapped in Parta's right column.
    setWindow(951, 669);
    const renderer = render();
    expect(seen(renderer, 'first')).toEqual({ pane: PARTA, sheetOnLeft: true });
    expect(seen(renderer, 'second')).toEqual({ pane: { tab: 'parta', side: 'secondary' }, sheetOnLeft: false });
  });

  it('keeps one column on a phone and on a table', () => {
    for (const [width, height] of [
      [402, 874],
      [669, 951],
    ]) {
      setWindow(width, height);
      expect(seen(render(), 'second').pane).toBe(PARTA);
    }
  });

  it('hides the right column from VoiceOver while a page is open over it', () => {
    setWindow(951, 669);
    const renderer = render();
    expect(secondColumn(renderer).accessibilityElementsHidden).toBe(false);

    act(() => useBookStore.getState().show('parta', { kind: 'friend', id: 'acc-1' }));
    expect(secondColumn(renderer)).toMatchObject({
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    });

    setWindow(466, 678);
    act(() => renderer.update(
      <PaneContext.Provider value={PARTA}>
        <TwoColumns first={<Probe name="first" />} second={<Probe name="second" />} />
      </PaneContext.Provider>,
    ));
    expect(secondColumn(renderer).accessibilityElementsHidden).toBe(false);
  });
});
