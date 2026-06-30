import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import type { Pub } from '@/data/pubs';
import { useTargetBearing, type TargetBearingResult } from '../useTargetBearing';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const USER_POS = { lat: 50.0876, lng: 14.4214 };

const TARGET_EAST: Pub = {
  id: 'same-pub',
  name: 'Hospoda',
  lat: 50.0876,
  lng: 14.4314,
};

const TARGET_NORTH: Pub = {
  ...TARGET_EAST,
  lat: 50.0976,
  lng: 14.4214,
};

function renderTargetBearingHook(
  userPos: { lat: number; lng: number } | null,
  targetPub: Pub | null,
) {
  let latestResult: TargetBearingResult | undefined;
  let props = { userPos, targetPub };
  let renderer: TestRenderer.ReactTestRenderer;

  function Harness({ userPos, targetPub }: typeof props) {
    latestResult = useTargetBearing(userPos, targetPub);
    return null;
  }

  act(() => {
    renderer = TestRenderer.create(React.createElement(Harness, props));
  });

  return {
    get result() {
      if (!latestResult) throw new Error('Hook result was not captured.');
      return latestResult;
    },
    update(nextUserPos: typeof userPos, nextTargetPub: typeof targetPub) {
      props = { userPos: nextUserPos, targetPub: nextTargetPub };
      act(() => {
        renderer.update(React.createElement(Harness, props));
      });
    },
    unmount() {
      act(() => {
        renderer.unmount();
      });
    },
  };
}

describe('useTargetBearing', () => {
  it('returns null values without a user position or target pub', () => {
    const hook = renderTargetBearingHook(null, TARGET_EAST);
    expect(hook.result).toEqual({ bearing: null, distanceMeters: null });

    hook.update(USER_POS, null);
    expect(hook.result).toEqual({ bearing: null, distanceMeters: null });
    hook.unmount();
  });

  it('recomputes when the same target id receives corrected coordinates', () => {
    const hook = renderTargetBearingHook(USER_POS, TARGET_EAST);
    const first = hook.result;

    hook.update(USER_POS, TARGET_NORTH);

    expect(first.bearing).toBeGreaterThan(85);
    expect(first.bearing).toBeLessThan(95);
    expect(hook.result.bearing).toBeGreaterThanOrEqual(0);
    expect(hook.result.bearing).toBeLessThan(5);
    expect(hook.result.distanceMeters).not.toBe(first.distanceMeters);
    hook.unmount();
  });
});
