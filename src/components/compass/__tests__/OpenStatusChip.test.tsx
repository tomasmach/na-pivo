import React from 'react';
import { cs } from '@/i18n/cs';
import { Colors } from '@/theme/colors';
import { OpenStatusChip } from '../OpenStatusChip';
import type { HoursStatus } from '../OpenStatusChip';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// @/theme/fonts require()s .ttf assets jest can't parse; stub the family map.
jest.mock('@/theme/fonts', () => ({
  Fonts: {
    display: { extrabold: 'display-extrabold' },
    ui: {
      regular: 'ui-regular',
      medium: 'ui-medium',
      semibold: 'ui-semibold',
      bold: 'ui-bold',
    },
  },
  FontScaleCap: { display: 1.1, heading: 1.2, body: 1.3 },
}));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

type Renderer = {
  root: {
    findAllByType: (type: unknown) => Array<{ props: Record<string, unknown> }>;
    findByProps: (props: Record<string, unknown>) => { props: Record<string, unknown> };
    findAllByProps: (props: Record<string, unknown>) => Array<{ props: Record<string, unknown> }>;
  };
  toJSON: () => unknown;
};

function render(element: React.ReactElement): Renderer {
  let renderer: Renderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  // @ts-expect-error assigned synchronously inside act
  return renderer;
}

/** The chip renders a single <Text> node; return its rendered string + color. */
function readLabel(renderer: Renderer): { text: string; color: unknown } {
  // The react-native mock renders <Text> as a host element literally named "Text".
  const textNodes = renderer.root.findAllByType('Text');
  expect(textNodes).toHaveLength(1);
  const node = textNodes[0];
  const children = node.props.children;
  const style = (Array.isArray(node.props.style) ? node.props.style : [node.props.style]) as Array<
    Record<string, unknown> | undefined
  >;
  const color = style.reduce<unknown>((acc, s) => (s && 'color' in s ? s.color : acc), undefined);
  return { text: String(children), color };
}

describe('OpenStatusChip', () => {
  it('renders the open label in green when the pub is open', () => {
    const renderer = render(<OpenStatusChip isOpenNow={true} status="ok" />);

    const { text, color } = readLabel(renderer);
    expect(text).toBe(cs.compass.openNow);
    expect(text).toBe('Otevřeno');
    expect(color).toBe(Colors.open);
  });

  it('renders the closed label in the closed color when the pub is closed', () => {
    const renderer = render(<OpenStatusChip isOpenNow={false} status="ok" />);

    const { text, color } = readLabel(renderer);
    expect(text).toBe(cs.compass.closedNow);
    expect(text).toBe('Zavřeno');
    expect(color).toBe(Colors.closed);
  });

  it('shows the close time pulled from nextChange when open (… T23:00 …)', () => {
    // Local HH:MM is the 5 chars after the T — no timezone math, no Intl.
    const renderer = render(
      <OpenStatusChip isOpenNow={true} status="ok" nextChange="2026-06-08T23:00:00+02:00" />
    );

    const { text, color } = readLabel(renderer);
    expect(text).toBe(cs.compass.openUntil('23:00'));
    expect(text).toBe('Otevřeno do 23:00');
    expect(color).toBe(Colors.open);
  });

  it('shows the open time pulled from nextChange when closed (… T17:00 …)', () => {
    const renderer = render(
      <OpenStatusChip isOpenNow={false} status="ok" nextChange="2026-06-08T17:00:00+02:00" />
    );

    const { text, color } = readLabel(renderer);
    expect(text).toBe(cs.compass.closedUntil('17:00'));
    expect(text).toBe('Zavřeno · otevře v 17:00');
    // Closed must stay muted — never an alarming red.
    expect(color).toBe(Colors.closed);
  });

  it('falls back to the no-time open label when nextChange is absent', () => {
    const renderer = render(<OpenStatusChip isOpenNow={true} status="ok" nextChange={null} />);

    const { text } = readLabel(renderer);
    expect(text).toBe(cs.compass.openNow);
    expect(text).toBe('Otevřeno');
  });

  it('falls back to the no-time closed label when nextChange is absent', () => {
    const renderer = render(<OpenStatusChip isOpenNow={false} status="ok" nextChange={null} />);

    const { text } = readLabel(renderer);
    expect(text).toBe(cs.compass.closedNow);
    expect(text).toBe('Zavřeno');
  });

  it('falls back to the no-time label when nextChange is malformed', () => {
    // No "T", garbage after "T", and an empty string must all degrade gracefully.
    for (const bad of ['not-a-timestamp', '2026-06-08Tzz:zz:00', '', '2026-06-08T9:5']) {
      const renderer = render(<OpenStatusChip isOpenNow={true} status="ok" nextChange={bad} />);
      const { text } = readLabel(renderer);
      expect(text).toBe(cs.compass.openNow);
    }
  });

  it('uses the close time even when nextChange carries a Z (UTC) suffix', () => {
    // The chip trusts the literal time portion — it never converts timezones.
    const renderer = render(
      <OpenStatusChip isOpenNow={true} status="ok" nextChange="2026-06-08T22:30:00Z" />
    );

    const { text } = readLabel(renderer);
    expect(text).toBe(cs.compass.openUntil('22:30'));
  });

  it('renders the unknown label in the muted color when openness is null', () => {
    const renderer = render(<OpenStatusChip isOpenNow={null} status="unknown" />);

    const { text, color } = readLabel(renderer);
    expect(text).toBe(cs.compass.hoursUnknown);
    expect(text).toBe('Otevírací doba neznámá');
    expect(color).toBe(Colors.mutedText);
  });

  it('renders the unknown label even without an explicit status when openness is null', () => {
    const renderer = render(<OpenStatusChip isOpenNow={null} />);

    const { text } = readLabel(renderer);
    expect(text).toBe(cs.compass.hoursUnknown);
  });

  it('renders a loading label while loading with no resolved openness yet', () => {
    const renderer = render(<OpenStatusChip isOpenNow={null} status="loading" />);

    const { text, color } = readLabel(renderer);
    expect(text).toBe(cs.compass.detailsLoading);
    expect(color).toBe(Colors.mutedText);
  });

  it('renders a loading label while pending with no resolved openness yet', () => {
    const renderer = render(<OpenStatusChip isOpenNow={null} status="pending" />);

    const { text, color } = readLabel(renderer);
    expect(text).toBe(cs.compass.detailsLoading);
    expect(color).toBe(Colors.mutedText);
  });

  it('still shows a result if openness resolves while status is loading/pending', () => {
    // If the backend gives us isOpenNow but the client status lingers, prefer the data.
    const renderer = render(<OpenStatusChip isOpenNow={true} status="loading" />);

    const { text } = readLabel(renderer);
    expect(text).toBe(cs.compass.openNow);
  });

  it('exposes the label as an accessibility label for each state', () => {
    const cases: Array<{ isOpenNow: boolean | null; status: HoursStatus; label: string }> = [
      { isOpenNow: true, status: 'ok', label: cs.compass.openNow },
      { isOpenNow: false, status: 'ok', label: cs.compass.closedNow },
      { isOpenNow: null, status: 'unknown', label: cs.compass.hoursUnknown },
    ];

    for (const { isOpenNow, status, label } of cases) {
      const renderer = render(<OpenStatusChip isOpenNow={isOpenNow} status={status} />);
      expect(renderer.root.findAllByProps({ accessibilityLabel: label }).length).toBeGreaterThan(0);
    }
  });
});
