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

test('does not mount the game runtime through a direct route while games are disabled', () => {
  expect(GAMES_COMING_SOON).toBe(true);
  act(() => { TestRenderer.create(<PartyGameRoute />); });
  expect(mockGameRuntime).not.toHaveBeenCalled();
});
