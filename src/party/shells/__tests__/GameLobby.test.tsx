import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { GameLobby, type LobbyPlayer } from '@/party/shells/GameLobby';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('@/party/GameCover', () => ({ GameCover: () => null }));
jest.mock('@/components/shared/PersonAvatar', () => ({ PersonAvatar: () => null }));
jest.mock('@/components/shared/IconGlyph', () => ({ CheckIcon: () => null }));

it('tracks and keys same-name players by stable account id', () => {
  const table: LobbyPlayer[] = [
    { id: 'honza-a', name: 'Honza', tint: '#111' },
    { id: 'honza-b', name: 'Honza', tint: '#222' },
    { id: 'petra', name: 'Petra', tint: '#333' },
  ];
  const onStart = jest.fn();
  render(<GameLobby def={undefined} table={table} onStart={onStart} />);

  fireEvent.press(screen.getAllByLabelText('Honza')[0]);
  fireEvent.press(screen.getByLabelText('Začít, hraje 2'));

  expect(onStart).toHaveBeenCalledWith([table[1], table[2]]);
});

it('exposes headings and start button disabled state for accessibility', () => {
  render(
    <GameLobby
      def={undefined}
      table={[{ id: 'me', name: 'Ty', tint: '#111' }]}
      onStart={jest.fn()}
    />,
  );

  expect(screen.getByText('Hra')).toHaveProp('accessibilityRole', 'header');
  expect(screen.getByText('Kdo hraje')).toHaveProp('accessibilityRole', 'header');

  const start = screen.getByLabelText('Potřebuješ aspoň dva hráče');
  expect(start).toHaveProp('accessibilityState', expect.objectContaining({ disabled: true }));
});

it('enables the start button once at least two players are in', () => {
  const table: LobbyPlayer[] = [
    { id: 'a', name: 'Honza', tint: '#111' },
    { id: 'b', name: 'Petra', tint: '#222' },
  ];
  render(<GameLobby def={undefined} table={table} onStart={jest.fn()} />);

  const start = screen.getByLabelText('Začít, hraje 2');
  expect(start).toHaveProp('accessibilityState', expect.objectContaining({ disabled: false }));
});

it('keeps roster checkbox state and invite button queryable', () => {
  const table: LobbyPlayer[] = [
    { id: 'a', name: 'Honza', tint: '#111' },
    { id: 'b', name: 'Petra', tint: '#222' },
  ];
  render(
    <GameLobby def={undefined} table={table} onStart={jest.fn()} onInvite={jest.fn()} />,
  );

  expect(screen.getAllByLabelText('Honza')[0]).toHaveProp(
    'accessibilityState',
    expect.objectContaining({ checked: true }),
  );
  fireEvent.press(screen.getAllByLabelText('Honza')[0]);
  expect(screen.getAllByLabelText('Honza')[0]).toHaveProp(
    'accessibilityState',
    expect.objectContaining({ checked: false }),
  );
  fireEvent.press(screen.getAllByLabelText('Honza')[0]);

  expect(screen.getByLabelText('Přizvat ke stolu')).toBeTruthy();
});

it('can invite a missing second player without leaving the lobby', () => {
  const onInvite = jest.fn();
  render(
    <GameLobby
      def={undefined}
      table={[{ id: 'me', name: 'Ty', tint: '#111' }]}
      onStart={jest.fn()}
      onInvite={onInvite}
    />,
  );

  fireEvent.press(screen.getByLabelText('Přizvat ke stolu'));
  expect(onInvite).toHaveBeenCalledTimes(1);
});
