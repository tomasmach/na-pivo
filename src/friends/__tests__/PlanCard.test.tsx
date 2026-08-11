import React from 'react';

import type { FriendPubActivity } from '@/data/friendsClient';

import PlanCard from '../PlanCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/components/shared/AppDialog', () => ({ showAppDialog: jest.fn() }));
jest.mock('@/components/shared/IconGlyph', () => ({
  ClockIcon: () => null,
  CompassIcon: () => null,
  MapPinIcon: () => null,
  XIcon: () => null,
}));
jest.mock('@/data/friendsClient', () => ({ endFriendPubActivity: jest.fn() }));
jest.mock('@/data/friendsQueue', () => ({
  enqueueFriendOp: jest.fn(),
  isRetriableFriendError: jest.fn(),
}));
jest.mock('@/profile/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: jest.Mock }) => unknown) =>
    selector({ show: jest.fn() }),
}));
jest.mock('../CheersPill', () => () => null);
jest.mock('../GoingRoster', () => () => null);
jest.mock('../RsvpControl', () => () => null);
jest.mock('../focusPubHandoff', () => ({ focusPubFromActivity: jest.fn(() => true) }));
jest.mock('../friendSafety', () => ({ useFriendSafety: () => jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

const activity: FriendPubActivity = {
  id: 'plan-1',
  account: {
    id: 'me',
    nickname: 'MachNaPivu',
    displayName: 'Mach',
    avatarUrl: null,
    isPublic: true,
  },
  cacheKey: 'u2fkbnjm',
  name: 'U Zlatého tygra',
  city: 'Praha',
  externalId: '',
  message: 'První stůl vlevo.',
  startedAt: '2026-08-11T18:00:00Z',
  expiresAt: '2026-08-12T02:00:00Z',
  active: true,
  createdAt: '2026-08-11T18:00:00Z',
  updatedAt: '2026-08-11T18:00:00Z',
  responses: { going: 2, maybe: 1, cant: 0, goingProfiles: [] },
  myResponse: null,
  kind: 'plan',
  scheduledFor: '2026-08-11T21:00:00Z',
  reactions: { cheers: 0 },
  myReaction: null,
};

describe('PlanCard', () => {
  it('keeps compass and cancel actions together on my plan', () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(
        <PlanCard
          activity={activity}
          mine
          onResponded={jest.fn()}
          onCanceled={jest.fn()}
        />,
      );
    });

    expect(renderer!.root.findByProps({ accessibilityLabel: 'Ukaž na kompasu' })).toBeTruthy();
    expect(renderer!.root.findByProps({ accessibilityLabel: 'Zrušit plán' })).toBeTruthy();
  });
});
