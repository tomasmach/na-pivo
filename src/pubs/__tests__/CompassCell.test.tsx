import React from 'react';

import { presentPub } from '@/pubs/pubPresentation';
import { useCompassRotation } from '@/pubs/useCompassRotation';
import { CompassCell } from '@/pubs/CompassCell';

const mockSettings = { hidePubNames: false };
jest.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: { hidePubNames: boolean }) => unknown) =>
    selector(mockSettings),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/components/compass/CompassContainer', () => ({
  CompassContainer: (props: Record<string, unknown>) => {

    const ReactModule = jest.requireActual('react');
    return ReactModule.createElement('CompassContainer', props);
  },
}));
jest.mock('@/pubs/useCompassRotation', () => ({ useCompassRotation: jest.fn() }));
jest.mock('@/mocks/mockTheme', () => ({
  MockLayout: { cardRadius: 16 },
  MockType: { bodySmall: {}, titleS: {} },
}));
jest.mock('@/theme/fonts', () => ({ FontScaleCap: { body: 1.3 } }));


const TestRenderer = jest.requireActual('react-test-renderer');
const { act } = TestRenderer;

const position = { lat: 50.08, lng: 14.41 };
const rawPub = {
  id: 'pub-1',
  name: 'U Tygra',
  lat: 50.087,
  lng: 14.42,
  isOpenNow: true,
  nextChange: '2026-08-06T23:00:00+02:00',
  hoursStatus: 'ok' as const,
  beers: [{ name: 'Únětická 12°', priceCzk: 59 }],
};

function textOf(renderer: { root: { findAllByType: (type: string) => unknown[] } }): string {
  return (renderer.root.findAllByType('Text') as { props: { children: unknown } }[])
    .map((node) => node.props.children)
    .flat(Infinity)
    .filter((value: unknown) => typeof value === 'string')
    .join(' ');
}

afterEach(() => {
  mockSettings.hidePubNames = false;
});

describe('CompassCell', () => {
  it('points from the supplied current position and renders backend facts', () => {
    const model = presentPub(rawPub, position);
    const rotation = { value: 42 };
    jest.mocked(useCompassRotation).mockReturnValue(rotation as never);

    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(
        <CompassCell pub={model} position={position} badge="Nejbližší" />,
      );
    });

    expect(useCompassRotation).toHaveBeenCalledWith(
      position,
      { lat: rawPub.lat, lng: rawPub.lng },
    );
    expect(renderer!.root.findByType('CompassContainer').props.rotation).toBe(rotation);
    const text = textOf(renderer!);
    expect(text).toContain('U Tygra');
    expect(text).toContain('Nejbližší');
    expect(text).toContain('Otevřeno do 23:00');
    expect(text).toContain('Únětická 12°  (59 Kč)');
  });

  it('keeps the pub a secret until you tap it when names are hidden', () => {
    mockSettings.hidePubNames = true;
    const model = presentPub(rawPub, position);
    jest.mocked(useCompassRotation).mockReturnValue({ value: 0 } as never);
    const onPress = jest.fn();

    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(
        <CompassCell pub={model} position={position} badge="Nejbližší" onPress={onPress} />,
      );
    });

    const hiddenText = textOf(renderer!);
    expect(hiddenText).toContain('Tajná hospoda');
    expect(hiddenText).toContain('Ťukni pro odhalení');
    expect(hiddenText).not.toContain('U Tygra');
    // The distance still counts down — only the identity waits.
    expect(hiddenText).toContain(model.distanceValue!);

    act(() => {
      renderer!.root.findByProps({ accessibilityRole: 'button' }).props.onPress();
    });

    const revealedText = textOf(renderer!);
    expect(revealedText).toContain('U Tygra');
    expect(revealedText).toContain('Otevřeno do 23:00');
    // The first tap only reveals; it must not also open the detail.
    expect(onPress).not.toHaveBeenCalled();
  });
});
