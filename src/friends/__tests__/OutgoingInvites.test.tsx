import React from 'react';

import { cs } from '@/i18n/cs';
import type { Friendship } from '@/data/friendsClient';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// @/theme/fonts require()s .ttf assets jest can't parse; stub the family map.
jest.mock('@/theme/fonts', () => ({
  Fonts: {
    display: { extrabold: 'display-extrabold', semibold: 'display-semibold', bold: 'display-bold' },
    ui: {
      regular: 'ui-regular',
      medium: 'ui-medium',
      semibold: 'ui-semibold',
      bold: 'ui-bold',
    },
  },
  FontScaleCap: { display: 1.1, heading: 1.2, body: 1.3 },
}));
// Icon + Avatar pull in lucide/react-native-svg + RN Image — irrelevant here.
jest.mock('@/components/shared/IconGlyph', () => ({ XIcon: () => null }));
jest.mock('@/profile/Avatar', () => ({ Avatar: () => null }));

import { OutgoingInvites } from '../OutgoingInvites';

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

type Node = { props: Record<string, unknown> };
type Renderer = {
  root: {
    findAllByType: (type: unknown) => Node[];
  };
};

function render(element: React.ReactElement): Renderer {
  let renderer: Renderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  // @ts-expect-error assigned synchronously inside act
  return renderer;
}

/** Minimal Friendship with just the fields OutgoingInvites reads. */
function invite(id: string, nickname: string): Friendship {
  return {
    id,
    status: 'pending',
    requester: { id: 'me', nickname: 'me', displayName: '', avatarUrl: null, isPublic: true },
    recipient: { id: `acc-${id}`, nickname, displayName: '', avatarUrl: null, isPublic: true },
    requestedAt: '',
    respondedAt: null,
    updatedAt: '',
  };
}

describe('OutgoingInvites', () => {
  it('renders nothing when there are no outgoing requests', () => {
    const renderer = render(<OutgoingInvites requests={[]} onCancel={jest.fn()} />);
    expect(renderer.root.findAllByType('Text')).toHaveLength(0);
  });

  it('renders one @nickname chip per request under the header', () => {
    const renderer = render(
      <OutgoingInvites requests={[invite('1', 'pepa'), invite('2', 'jarda')]} onCancel={jest.fn()} />,
    );
    const texts = renderer.root.findAllByType('Text').map((n) => String(n.props.children));
    expect(texts).toContain(cs.friends.outgoingHeader);
    expect(texts).toContain('@pepa');
    expect(texts).toContain('@jarda');
  });

  it('fires onCancel with the tapped request', () => {
    const onCancel = jest.fn();
    const first = invite('1', 'pepa');
    const renderer = render(<OutgoingInvites requests={[first, invite('2', 'jarda')]} onCancel={onCancel} />);
    const chips = renderer.root.findAllByType('Pressable');
    expect(chips).toHaveLength(2);
    (chips[0].props.onPress as () => void)();
    expect(onCancel).toHaveBeenCalledWith(first);
  });
});
