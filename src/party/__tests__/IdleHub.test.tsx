import React from 'react';
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

const handlers = () => ({ onOpenTable: jest.fn() });

beforeEach(() => {
  push.mockClear();
});

it('offers the table as one quiet pill, with no amber word beside it', () => {
  const h = handlers();
  const screen = render(<IdleHub lastSession={null} {...h} />);
  expect(screen.getByText('Stůl')).toBeTruthy();
  // The two doors live in the sheet behind it, not on the hub.
  expect(screen.queryByText('Pozvat ke stolu')).toBeNull();
  expect(screen.queryByText('Přisednout kódem')).toBeNull();
  expect(screen.queryByText('Naposledy')).toBeNull();
  fireEvent.press(screen.getByLabelText('Stůl. Pozvat ke stolu, nebo přisednout kódem.'));
  expect(h.onOpenTable).toHaveBeenCalledTimes(1);
});

it('keeps the games and the parta off the screen before the first beer', () => {
  const screen = render(<IdleHub lastSession={lastSession} {...handlers()} />);
  expect(screen.queryByText('Kdo už sedí')).toBeNull();
  expect(screen.queryByText(/Hry|Pub kvíz/)).toBeNull();
});

it('names the last night with the diary date label and honest drink counts', () => {
  const screen = render(<IdleHub lastSession={lastSession} {...handlers()} />);
  expect(screen.getByText('Naposledy')).toBeTruthy();
  expect(screen.getByText('Včera · U Kotvy')).toBeTruthy();
  expect(screen.getByText('1 pivo · 1 víno')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Poslední večer, Včera · U Kotvy. Otevřít.'));
  expect(push).toHaveBeenCalledWith({
    pathname: '/evening',
    params: { startedAt: lastSession.startedAt },
  });
});


