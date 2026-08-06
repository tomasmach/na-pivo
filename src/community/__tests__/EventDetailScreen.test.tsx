import React from 'react';

import { generateUuidV4 } from '@/data/account';
import {
  createCommunityEventTeam,
  decideCommunityJoinRequest,
  fetchCommunityEvent,
  fetchCommunityEventTeams,
  joinCommunityEventTeam,
  leaveCommunityEventTeam,
  type CommunityEvent,
  type CommunityEventTeamRoster,
} from '@/data/communityEventsClient';

import { EventDetailScreen } from '../EventDetailScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/community/EventCover', () => ({ EventCover: () => null }));
jest.mock('@/components/shared/IconGlyph', () => {
  const stub = () => null;
  return new Proxy({}, { get: () => stub });
});
jest.mock('@/components/shared/KeyboardAwareScrollView', () => ({
  KeyboardAwareScrollView: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('KeyboardAwareScrollView', props, children),
}));
jest.mock('@/components/shared/TabBar', () => ({ TAB_CHROME: 80 }));
jest.mock('@/data/account', () => ({ generateUuidV4: jest.fn(() => 'client-team-1') }));
jest.mock('@/data/communityEventsClient', () => ({
  createCommunityEventTeam: jest.fn(),
  decideCommunityJoinRequest: jest.fn(),
  fetchCommunityEvent: jest.fn(),
  fetchCommunityEventTeams: jest.fn(),
  joinCommunityEventTeam: jest.fn(),
  leaveCommunityEvent: jest.fn(),
  leaveCommunityEventTeam: jest.fn(),
  requestCommunityEventJoin: jest.fn(),
}));
jest.mock('@/profile/Avatar', () => ({
  Avatar: (props: Record<string, unknown>) => React.createElement('Avatar', props),
}));
jest.mock('@/theme/fonts', () => ({ FontScaleCap: { heading: 1.2, body: 1.3 } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

const createTeamMock = createCommunityEventTeam as jest.MockedFunction<typeof createCommunityEventTeam>;
const decideRequestMock = decideCommunityJoinRequest as jest.MockedFunction<typeof decideCommunityJoinRequest>;
const fetchEventMock = fetchCommunityEvent as jest.MockedFunction<typeof fetchCommunityEvent>;
const fetchTeamsMock = fetchCommunityEventTeams as jest.MockedFunction<typeof fetchCommunityEventTeams>;
const joinTeamMock = joinCommunityEventTeam as jest.MockedFunction<typeof joinCommunityEventTeam>;
const leaveTeamMock = leaveCommunityEventTeam as jest.MockedFunction<typeof leaveCommunityEventTeam>;
const uuidMock = generateUuidV4 as jest.MockedFunction<typeof generateUuidV4>;

const BASE_ROSTER: CommunityEventTeamRoster = {
  maxTeamSize: 4,
  participantCount: 3,
  assignedCount: 2,
  unassignedCount: 1,
  myTeamId: null,
  teams: [
    {
      id: 'team-1',
      name: 'Chmelouni',
      capacity: 4,
      memberCount: 2,
      availableSpots: 2,
      isMine: false,
      createdAt: '2026-08-20T15:00:00.000Z',
      members: [
        {
          account: {
            id: 'host-1',
            nickname: 'host',
            displayName: 'Host',
            avatarUrl: null,
          },
          joinedAt: '2026-08-20T15:01:00.000Z',
        },
        {
          account: {
            id: 'guest-1',
            nickname: 'jana',
            displayName: 'Jana',
            avatarUrl: null,
          },
          joinedAt: '2026-08-20T15:02:00.000Z',
        },
      ],
    },
  ],
};

function communityEvent(overrides: Partial<CommunityEvent> = {}): CommunityEvent {
  return {
    id: 'event-1',
    host: { id: 'host-1', nickname: 'host', displayName: 'Host', avatarUrl: null },
    title: 'Pivo a deskovky',
    description: 'Komorní večer.',
    city: 'Praha',
    areaLabel: 'Vinohrady',
    startsAt: '2026-08-20T18:00:00.000Z',
    endsAt: '2026-08-20T22:00:00.000Z',
    capacity: 6,
    availableSpots: 3,
    adultsOnly: true,
    status: 'upcoming',
    distanceBand: '1_3_km',
    isHost: false,
    membershipStatus: null,
    exactAddress: null,
    joinRequests: [],
    teamRoster: null,
    ...overrides,
  };
}

function flatTexts(renderer: {
  root: { findAllByType: (type: string) => { props: { children: unknown } }[] };
}): string[] {
  return renderer.root.findAllByType('Text').flatMap((node) => {
    const value = node.props.children;
    if (typeof value === 'string' || typeof value === 'number') return [String(value)];
    if (Array.isArray(value)) {
      return [value.filter((item) => typeof item === 'string' || typeof item === 'number').join('')];
    }
    return [];
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  uuidMock.mockReturnValue('client-team-1');
  fetchTeamsMock.mockResolvedValue({ ok: true, roster: BASE_ROSTER });
});

describe('EventDetailScreen', () => {
  it('shows private teams and pending moderation only to the host', () => {
    const event = communityEvent({
      isHost: true,
      exactAddress: 'Testovací 12',
      teamRoster: BASE_ROSTER,
      joinRequests: [
        {
          id: 'request-1',
          account: { id: 'waiting-1', nickname: 'karel', displayName: 'Karel', avatarUrl: null },
          message: 'Vezmu karty.',
          status: 'pending',
          requestedAt: '2026-08-20T15:00:00.000Z',
        },
      ],
    });
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<EventDetailScreen event={event} />);
    });

    expect(flatTexts(renderer!)).toEqual(
      expect.arrayContaining(['Žádosti o místo', '@karel', 'Vezmu karty.', 'Týmy', 'Chmelouni']),
    );
    expect(renderer!.root.findByType('KeyboardAwareScrollView')).toBeTruthy();
  });

  it('approves a pending request and refreshes the authoritative detail', async () => {
    const original = communityEvent({
      isHost: true,
      teamRoster: BASE_ROSTER,
      joinRequests: [
        {
          id: 'request-1',
          account: { id: 'waiting-1', nickname: 'karel', displayName: 'Karel', avatarUrl: null },
          message: '',
          status: 'pending',
          requestedAt: '2026-08-20T15:00:00.000Z',
        },
      ],
    });
    const refreshed = communityEvent({
      isHost: true,
      availableSpots: 2,
      teamRoster: { ...BASE_ROSTER, participantCount: 4, unassignedCount: 2 },
      joinRequests: [{ ...original.joinRequests[0], status: 'approved' }],
    });
    decideRequestMock.mockResolvedValue({ ok: true });
    fetchEventMock.mockResolvedValue({ ok: true, event: refreshed });
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<EventDetailScreen event={original} />);
    });

    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'Schválit žádost @karel' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(decideRequestMock).toHaveBeenCalledWith('event-1', 'request-1', 'approve');
    expect(fetchEventMock).toHaveBeenCalledWith('event-1');
    expect(flatTexts(renderer!)).toContain('Nikdo teď nečeká.');
  });

  it('reuses the same client id when creating a team is retried', async () => {
    const event = communityEvent({ isHost: true, teamRoster: BASE_ROSTER });
    const createdRoster: CommunityEventTeamRoster = {
      ...BASE_ROSTER,
      assignedCount: 3,
      unassignedCount: 0,
      myTeamId: 'team-2',
      teams: [
        ...BASE_ROSTER.teams,
        {
          id: 'team-2',
          name: 'Pěna',
          capacity: 4,
          memberCount: 1,
          availableSpots: 3,
          isMine: true,
          createdAt: '2026-08-20T16:00:00.000Z',
          members: [],
        },
      ],
    };
    createTeamMock
      .mockResolvedValueOnce({ ok: false, code: 'network', detail: 'Síť se netváří.' })
      .mockResolvedValueOnce({
        ok: true,
        roster: createdRoster,
        team: createdRoster.teams[1],
        created: true,
      });
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<EventDetailScreen event={event} />);
    });
    act(() => {
      renderer!.root.findByProps({ accessibilityLabel: 'Název nového týmu' }).props.onChangeText('Pěna');
    });

    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'Založit tým' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'Založit tým' }).props.onPress();
      await Promise.resolve();
    });

    expect(createTeamMock).toHaveBeenNthCalledWith(1, 'event-1', {
      clientId: 'client-team-1',
      name: 'Pěna',
    });
    expect(createTeamMock).toHaveBeenNthCalledWith(2, 'event-1', {
      clientId: 'client-team-1',
      name: 'Pěna',
    });
    expect(uuidMock).toHaveBeenCalledTimes(1);
  });

  it('does not expose a team roster to an unapproved viewer', () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<EventDetailScreen event={communityEvent()} />);
    });

    expect(flatTexts(renderer!)).not.toEqual(expect.arrayContaining(['Týmy', 'Chmelouni', '@jana']));
    expect(fetchTeamsMock).not.toHaveBeenCalled();
  });

  it('joins and leaves through the team membership endpoints', async () => {
    const event = communityEvent({ membershipStatus: 'approved', teamRoster: BASE_ROSTER });
    const joinedRoster = {
      ...BASE_ROSTER,
      assignedCount: 3,
      unassignedCount: 0,
      myTeamId: 'team-1',
      teams: BASE_ROSTER.teams.map((team) => ({ ...team, isMine: true, memberCount: 3, availableSpots: 1 })),
    };
    joinTeamMock.mockResolvedValue({
      ok: true,
      roster: joinedRoster,
      team: joinedRoster.teams[0],
      joined: true,
    });
    leaveTeamMock.mockResolvedValue({ ok: true, roster: BASE_ROSTER, left: true });
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<EventDetailScreen event={event} />);
    });

    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'Přidat se' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'Opustit tým' }).props.onPress();
      await Promise.resolve();
    });

    expect(joinTeamMock).toHaveBeenCalledWith('event-1', 'team-1');
    expect(leaveTeamMock).toHaveBeenCalledWith('event-1', 'team-1');
  });
});
