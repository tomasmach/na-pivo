import React from 'react';
import { AppState, Pressable } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import type { FriendTable, FriendTablePerson } from '@/data/friendsClient';
import { closeFriendTable, fetchFriendTable, openFriendTable } from '@/data/friendsClient';
import { t } from '@/i18n';

import { TABLE_POLL_MS, TableAdd } from '../TableAdd';

const NOW = Date.parse('2026-09-28T21:00:00Z');

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
jest.mock('../useNowTick', () => ({ useNowTick: () => Date.parse('2026-09-28T21:00:00Z') }));

const person = (id: string, friendshipStatus: FriendTablePerson['friendshipStatus']): FriendTablePerson => ({
  id,
  nickname: id,
  displayName: '',
  avatarUrl: null,
  isPublic: true,
  friendshipStatus,
});

const inMinutes = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

const visible = (people: FriendTablePerson[]): FriendTable => ({
  eligible: true,
  reason: null,
  visibleUntil: inMinutes(8),
  availableAt: null,
  people,
});

const hidden: FriendTable = { eligible: true, reason: null, visibleUntil: null, availableAt: null, people: [] };

const refused = (reason: FriendTable['reason'], availableAt: string | null = null): FriendTable => ({
  eligible: false,
  reason,
  visibleUntil: null,
  availableAt,
  people: [],
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function setup(autoStart = false, onRequest = jest.fn().mockResolvedValue(true)) {
  const screen = render(<TableAdd autoStart={autoStart} requestingKey={null} onRequest={onRequest} />);
  return { screen, onRequest };
}

describe('TableAdd', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    (AppState as { currentState: string }).currentState = 'active';
    jest.mocked(fetchFriendTable).mockResolvedValue(hidden);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('only probes on mount and waits for the explicit tap', async () => {
    const { screen } = setup(false);
    await flush();
    expect(fetchFriendTable).toHaveBeenCalledTimes(1);
    expect(openFriendTable).not.toHaveBeenCalled();
    expect(screen.getByText(t.friends.tableExplainer)).toBeTruthy();

    jest.mocked(openFriendTable).mockResolvedValue(visible([]));
    fireEvent.press(screen.getByLabelText(t.friends.tableEntry));
    await flush();
    expect(openFriendTable).toHaveBeenCalledTimes(1);
    expect(screen.getByText(t.friends.tableVisibleFor(8))).toBeTruthy();
    expect(screen.getByText(t.friends.tableWaiting)).toBeTruthy();
  });

  it('auto-starts, labels each action with the name and hides me again on unmount', async () => {
    jest
      .mocked(openFriendTable)
      .mockResolvedValue(visible([person('bara', 'none'), person('pepa', 'incoming'), person('jana', 'outgoing')]));
    const { screen } = setup(true);
    await flush();

    expect(screen.getByLabelText(t.friends.tableAddA11y('@bara'))).toBeTruthy();
    expect(screen.getByLabelText(t.friends.tableAcceptA11y('@pepa'))).toBeTruthy();
    expect(screen.getAllByText(t.friends.tableSent)).toHaveLength(1);
    // Rows themselves are not pressable: a profile push would close the sheet.
    expect(screen.UNSAFE_getAllByType(Pressable)).toHaveLength(2);

    jest.mocked(closeFriendTable).mockClear();
    screen.unmount();
    expect(closeFriendTable).not.toHaveBeenCalled();
    jest.runOnlyPendingTimers();
    expect(closeFriendTable).toHaveBeenCalledTimes(1);
  });

  it('polls every 5 s only in the foreground and says so when the window ends', async () => {
    jest.mocked(openFriendTable).mockResolvedValue(visible([person('bara', 'none')]));
    jest.mocked(fetchFriendTable).mockResolvedValue(visible([person('bara', 'none')]));
    const { screen } = setup(true);
    await flush();
    expect(TABLE_POLL_MS).toBe(5_000);

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
    expect(screen.getByText(t.friends.tableHiddenAgain)).toBeTruthy();
    expect(screen.getByLabelText(t.friends.tableEntry)).toBeTruthy();

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

    fireEvent.press(screen.getByLabelText(t.friends.tableAddA11y('@bara')));
    await flush();
    expect(onRequest).toHaveBeenCalledWith(expect.objectContaining({ id: 'bara' }));
    expect(fetchFriendTable).toHaveBeenCalledTimes(1);
    expect(screen.getByText(t.friends.tableSent)).toBeTruthy();
  });

  it('shows how long until too_soon opens and keeps the row disabled', async () => {
    jest.mocked(fetchFriendTable).mockResolvedValue(refused('too_soon', inMinutes(6.5)));
    const { screen } = setup(false);
    await flush();
    expect(screen.getByText(t.friends.tableTooSoonIn(7))).toBeTruthy();
    expect(screen.getByLabelText(t.friends.tableEntry).props.accessibilityState).toEqual({ disabled: true });
  });

  it('unlocks too_soon once its time has passed', async () => {
    jest.mocked(fetchFriendTable).mockResolvedValue(refused('too_soon', inMinutes(-1)));
    const { screen } = setup(false);
    await flush();
    expect(screen.getByText(t.friends.tableExplainer)).toBeTruthy();
    expect(screen.getByLabelText(t.friends.tableEntry).props.accessibilityState).toEqual({ disabled: false });
  });

  it.each([
    ['no_visit', t.friends.tableNoVisit],
    ['ghost', t.friends.tableGhost],
    ['private', t.friends.tablePrivate],
  ] as const)('explains the %s refusal and stays disabled', async (reason, line) => {
    jest.mocked(openFriendTable).mockResolvedValue(refused(reason));
    const { screen } = setup(true);
    await flush();
    expect(screen.getByText(line)).toBeTruthy();
    expect(screen.getByLabelText(t.friends.tableEntry).props.accessibilityState).toEqual({ disabled: true });
  });

  it('shows one offline line when the table does not load', async () => {
    jest.mocked(openFriendTable).mockResolvedValue(null);
    const { screen } = setup(true);
    await flush();
    expect(screen.getByText(t.friends.tableOffline)).toBeTruthy();
  });
});
