import React, { useLayoutEffect, useRef } from 'react';

import { usePagerAnchor } from '@/layout/usePagerAnchor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

const scrollToOffset = jest.fn();

function Pager({ width, index }: { width: number; index: number }) {
  const listRef = useRef({ scrollToOffset });
  const indexRef = useRef(index);
  useLayoutEffect(() => {
    indexRef.current = index;
  });
  usePagerAnchor(listRef, indexRef, width);
  return null;
}

describe('usePagerAnchor', () => {
  beforeEach(() => scrollToOffset.mockClear());

  it('leaves the pager alone until the width changes', () => {
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(<Pager width={402} index={1} />);
    });
    act(() => renderer.update(<Pager width={402} index={2} />));
    expect(scrollToOffset).not.toHaveBeenCalled();
  });

  it('puts the current page back at its new offset when the window resizes', () => {
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(<Pager width={466} index={2} />);
    });
    act(() => renderer.update(<Pager width={951} index={2} />));
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 2 * 951, animated: false });
    act(() => renderer.update(<Pager width={669} index={2} />));
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 2 * 669, animated: false });
    expect(scrollToOffset).toHaveBeenCalledTimes(2);
  });
});
