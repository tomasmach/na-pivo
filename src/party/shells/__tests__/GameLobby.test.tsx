import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { GameLobby, type LobbyPlayer } from '@/party/shells/GameLobby';

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
