import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import PartyGameRoute from '../party-game';
import { GAMES_COMING_SOON } from '@/party/gameCatalog';

const mockGameRuntime = jest.fn(() => null);
jest.mock('@/party/PartyGameScreen', () => ({
  __esModule: true,
  default: () => mockGameRuntime(),
}));
jest.mock('expo-router', () => ({ Redirect: () => null }));

test('mounts the game runtime through a direct route when games are released', () => {
  expect(GAMES_COMING_SOON).toBe(false);
  act(() => { TestRenderer.create(<PartyGameRoute />); });
  expect(mockGameRuntime).toHaveBeenCalled();
});
