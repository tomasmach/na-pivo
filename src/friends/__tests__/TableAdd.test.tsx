import React from 'react';
import { AppState } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import type { FriendTable, FriendTablePerson } from '@/data/friendsClient';
import { closeFriendTable, fetchFriendTable, openFriendTable } from '@/data/friendsClient';
import { t } from '@/i18n';

import { TABLE_POLL_MS, TableAdd } from '../TableAdd';

jest.mock('@/data/friendsClient', () => ({
  closeFriendTable: jest.fn().mockResolvedValue(undefined),
  fetchFriendTable: jest.fn(),
  openFriendTable: jest.fn(),
}));
jest.mock('@/profile/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/shared/IconGlyph', () => ({
  CheckIcon: () => null,
  PlusIcon: () => null,
  UsersIcon: () => null,
}));

const person = (id: string, friendshipStatus: FriendTablePerson['friendshipStatus']): FriendTablePerson => ({
  id,
  nickname: id,
  displayName: '',
  avatarUrl: null,
  isPublic: true,
  friendshipStatus,
});

const visible = (people: FriendTablePerson[]): FriendTable => ({
  eligible: true,
  reason: null,
  visibleUntil: '2026-09-28T21:10:00+00:00',
  people,
});

const hidden: FriendTable = { eligible: true, reason: null, visibleUntil: null, people: [] };

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function setup(autoStart = false, onRequest = jest.fn().mockResolvedValue(true)) {
  const onOpenProfile = jest.fn();
  const screen = render(
    <TableAdd autoStart={autoStart} requestingKey={null} onRequest={onRequest} onOpenProfile={onOpenProfile} />,
  );
  return { screen, onRequest, onOpenProfile };
}

describe('TableAdd', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    (AppState as { currentState: string }).currentState = 'active';
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('waits for the explicit tap unless opened from the table entry', async () => {
    const { screen } = setup(false);
    await flush();
    expect(openFriendTable).not.toHaveBeenCalled();
    expect(screen.getByText(t.friends.tableExplainer)).toBeTruthy();

    jest.mocked(openFriendTable).mockResolvedValue(visible([]));
    fireEvent.press(screen.getByLabelText(t.friends.tableShowCta));
    await flush();
    expect(openFriendTable).toHaveBeenCalledTimes(1);
    expect(screen.getByText(t.friends.tableWaiting)).toBeTruthy();
  });

  it('auto-starts, lists people by status and hides me again on unmount', async () => {
    jest
      .mocked(openFriendTable)
      .mockResolvedValue(visible([person('bara', 'none'), person('pepa', 'incoming'), person('jana', 'outgoing')]));
    const { screen, onOpenProfile } = setup(true);
    await flush();

    expect(screen.getByLabelText(t.friends.addByNickname)).toBeTruthy();
    expect(screen.getByLabelText(t.friends.accept)).toBeTruthy();
    expect(screen.getAllByText(t.friends.tableSent)).toHaveLength(1);
    fireEvent.press(screen.getByText('@bara'));
    expect(onOpenProfile).toHaveBeenCalledWith('bara');

    jest.mocked(closeFriendTable).mockClear();
    screen.unmount();
    expect(closeFriendTable).not.toHaveBeenCalled();
    jest.runOnlyPendingTimers();
    expect(closeFriendTable).toHaveBeenCalledTimes(1);
  });

  it('polls only while the app is in the foreground and goes idle when the window ends', async () => {
    jest.mocked(openFriendTable).mockResolvedValue(visible([person('bara', 'none')]));
    jest.mocked(fetchFriendTable).mockResolvedValue(visible([person('bara', 'none')]));
    const { screen } = setup(true);
    await flush();

    (AppState as { currentState: string }).currentState = 'background';
    act(() => {
      jest.advanceTimersByTime(TABLE_POLL_MS);
    });
    expect(fetchFriendTable).not.toHaveBeenCalled();

    (AppState as { currentState: string }).currentState = 'active';
    jest.mocked(fetchFriendTable).mockResolvedValue(hidden);
    act(() => {
      jest.advanceTimersByTime(TABLE_POLL_MS);
    });
    await flush();
    expect(fetchFriendTable).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(t.friends.tableShowCta)).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(TABLE_POLL_MS * 3);
    });
    expect(fetchFriendTable).toHaveBeenCalledTimes(1);
  });

  it('marks a tapped person as sent and refreshes at once', async () => {
    jest.mocked(openFriendTable).mockResolvedValue(visible([person('bara', 'none')]));
    jest.mocked(fetchFriendTable).mockResolvedValue(visible([person('bara', 'outgoing')]));
    const { screen, onRequest } = setup(true);
    await flush();

    fireEvent.press(screen.getByLabelText(t.friends.addByNickname));
    await flush();
    expect(onRequest).toHaveBeenCalledWith(expect.objectContaining({ id: 'bara' }));
    expect(fetchFriendTable).toHaveBeenCalledTimes(1);
    expect(screen.getByText(t.friends.tableSent)).toBeTruthy();
  });

  it.each([
    ['too_soon', t.friends.tableTooSoon],
    ['no_visit', t.friends.tableNoVisit],
    ['ghost', t.friends.tableGhost],
    ['private', t.friends.tablePrivate],
  ] as const)('explains the %s refusal and stays idle', async (reason, line) => {
    jest.mocked(openFriendTable).mockResolvedValue({ eligible: false, reason, visibleUntil: null, people: [] });
    const { screen } = setup(true);
    await flush();
    expect(screen.getByText(line)).toBeTruthy();
    expect(screen.getByLabelText(t.friends.tableShowCta)).toBeTruthy();
  });

  it('shows one offline line when the table does not load', async () => {
    jest.mocked(openFriendTable).mockResolvedValue(null);
    const { screen } = setup(true);
    await flush();
    expect(screen.getByText(t.friends.tableOffline)).toBeTruthy();
  });
});
