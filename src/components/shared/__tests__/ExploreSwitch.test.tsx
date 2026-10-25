import React from 'react';
import { useWindowDimensions } from 'react-native';

import { ExploreSwitch } from '@/components/shared/ExploreSwitch';
import { t } from '@/i18n';
import { PaneContext, type PaneInfo } from '@/layout/pane';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/components/shared/IconGlyph', () => new Proxy({}, { get: () => () => null }));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

function setWindow(width: number, height: number) {
  (useWindowDimensions as jest.Mock).mockReturnValue({ width, height, scale: 3, fontScale: 1 });
}

/** The map's floating switch, rendered in the given half; true when its "to compass" door is there. */
function mapHasCompassDoor(pane: PaneInfo | null): boolean {
  let renderer: any;
  act(() => {
    renderer = TestRenderer.create(
      <PaneContext.Provider value={pane}>
        <ExploreSwitch activeView="map" onSelectCompass={jest.fn()} onSelectMap={jest.fn()} />
      </PaneContext.Provider>,
    );
  });
  const found = renderer.root.findAll(
    (node: any) => typeof node.type === 'string' && node.props.accessibilityLabel === t.a11y.mapSwitchCompass,
  ).length;
  act(() => renderer.unmount());
  return found > 0;
}

describe('ExploreSwitch on the open iPhone Duo', () => {
  afterAll(() => setWindow(390, 844));

  it.each([
    ['on its side', 951, 669],
    ['on a table', 669, 951],
  ])('drops the switch only on the map beside the compass (%s)', (_pose, width, height) => {
    setWindow(width, height);
    // The Kompas tab's map, and a pub page's map opened over it.
    expect(mapHasCompassDoor({ tab: 'kompas', side: 'secondary' })).toBe(false);
    // A pub page's map over another tab or over the whole window (from leaderboards).
    expect(mapHasCompassDoor({ tab: 'parta', side: 'secondary' })).toBe(true);
    expect(mapHasCompassDoor(null)).toBe(true);
  });

  it('keeps the switch everywhere on a phone', () => {
    setWindow(402, 874);
    expect(mapHasCompassDoor({ tab: 'kompas', side: 'primary' })).toBe(true);
    expect(mapHasCompassDoor(null)).toBe(true);
  });
});
