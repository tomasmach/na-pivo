import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { IdleHub } from '@/party/IdleHub';
import type { TallySession } from '@/stores/tallyStore';

const push = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push }) }));
jest.mock('@/components/shared/IconGlyph', () => ({ ChevronRightIcon: () => null }));
jest.mock('@/mocks/SectionBreak', () => ({
  SectionBreak: ({ title }: { title?: string }) => {
    const { Text: T } = jest.requireActual('react-native');
    return title ? <T>{title}</T> : null;
  },
}));
jest.mock('@/friends/useNowTick', () => ({
  useNowTick: () => Date.parse('2026-08-27T10:00:00+02:00'),
}));

let session: { accountId: string } | null = { accountId: 'me' };
jest.mock('@/stores/accountStore', () => ({
  useAccountStore: (selector: (state: { session: unknown }) => unknown) =>
    selector({ session }),
}));

let presence: { account: { id: string; nickname: string } }[] = [];
const dashboardHook = jest.fn(() => ({
  dashboard: presence.length > 0 ? { presence } : null,
  stale: false,
  reload: jest.fn(),
}));
jest.mock('@/friends/usePartaDashboard', () => ({ usePartaDashboard: () => dashboardHook() }));
jest.mock('@/friends/PresenceList', () => ({
  PresenceList: ({ presence: rows, flat }: { presence: { account: { nickname: string } }[]; flat?: boolean }) => (
    <Text>{`${flat ? 'flat' : 'card'}:${rows.map((row) => row.account.nickname).join(',')}`}</Text>
  ),
}));

const lastSession: TallySession = {
  clientId: 'c1',
  pubKey: 'u2fkbnyx',
  pubName: 'U Kotvy',
  startedAt: '2026-08-26T19:00:00+02:00',
  drinks: [
    { id: 'd1', beerName: 'Plzeň', at: '2026-08-26T19:10:00+02:00' },
    { id: 'd2', beerName: 'Víno', at: '2026-08-26T20:10:00+02:00', drinkType: 'wine' },
  ] as TallySession['drinks'],
};

const handlers = () => ({
  onPickPub: jest.fn(),
  onInvite: jest.fn(),
  onOpenGames: jest.fn(),
  onJoinByCode: jest.fn(),
});

beforeEach(() => {
  push.mockClear();
  dashboardHook.mockClear();
  presence = [];
  session = { accountId: 'me' };
});

it('shows the three rows and no parta or history section when there is nothing', () => {
  const screen = render(
    <IdleHub pubName="U Kotvy" pubMeta={['40 m', 'Otevřeno']} lastSession={null} {...handlers()} />,
  );
  expect(screen.getByText('U Kotvy')).toBeTruthy();
  expect(screen.getByText('40 m · Otevřeno')).toBeTruthy();
  expect(screen.queryByText('Kdo už sedí')).toBeNull();
  expect(screen.queryByText('Naposledy')).toBeNull();
});

it('lists seated friends as flat rows only when somebody sits', () => {
  presence = [{ account: { id: 'f1', nickname: 'Tonda' } }];
  const screen = render(
    <IdleHub pubName="U Kotvy" pubMeta={[]} lastSession={null} {...handlers()} />,
  );
  expect(screen.getByText('Kdo už sedí')).toBeTruthy();
  expect(screen.getByText('flat:Tonda')).toBeTruthy();
});

it('does not ask for the parta without an account', () => {
  session = null;
  render(<IdleHub pubName="U Kotvy" pubMeta={[]} lastSession={null} {...handlers()} />);
  expect(dashboardHook).not.toHaveBeenCalled();
});

it('names the last night with the diary date label and honest drink counts', () => {
  const screen = render(
    <IdleHub pubName="U Kotvy" pubMeta={[]} lastSession={lastSession} {...handlers()} />,
  );
  expect(screen.getByText('Včera · U Kotvy')).toBeTruthy();
  expect(screen.getByText('1 pivo · 1 víno')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Poslední večer, Včera · U Kotvy. Otevřít.'));
  expect(push).toHaveBeenCalledWith({
    pathname: '/evening',
    params: { startedAt: lastSession.startedAt },
  });
});

it('opens the invite only from the amber word, not from the row', () => {
  const h = handlers();
  const screen = render(<IdleHub pubName="U Kotvy" pubMeta={[]} lastSession={null} {...h} />);
  fireEvent.press(screen.getByLabelText('Přizvat ke stolu'));
  expect(h.onInvite).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByText('Ty'));
  expect(h.onInvite).toHaveBeenCalledTimes(1);
});
