import React from 'react';
import { View } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { GamesSheet } from '@/party/GamesSheet';
import { GAMES_COMING_SOON, GAME_CATALOG } from '@/party/gameCatalog';
import { cs } from '@/i18n/cs';

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return { ...actual, Share: { share: jest.fn(async () => ({ action: 'sharedAction' })) } };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/shared/BottomSheetModal', () => ({
  BottomSheetModal: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
    visible ? <View>{children}</View> : null,
}));
jest.mock('@/components/shared/CloseButton', () => ({ CloseButton: () => null }));
jest.mock('@/components/shared/IconGlyph', () => ({ CheckIcon: () => null, LockKeyholeIcon: () => null }));
jest.mock('@/party/GameCover', () => ({ GameCover: () => null }));

describe('GamesSheet while games are coming soon', () => {
  it('locks every tile and never lets a game be picked', () => {
    expect(GAMES_COMING_SOON).toBe(true);
    const onPick = jest.fn();
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(
        <GamesSheet visible onTable={[]} onClose={() => {}} onPick={onPick} />,
      );
    });
    const tiles = renderer!.root.findAll(
      (node) =>
        typeof node.type !== 'string' &&
        node.props.accessibilityRole === 'button' &&
        typeof node.props.accessibilityLabel === 'string' &&
        node.props.accessibilityLabel.includes(cs.party.gamesComingSoon),
    );
    expect(tiles.length).toBe(GAME_CATALOG.length);
    for (const tile of tiles) {
      expect(tile.props.disabled).toBe(true);
      expect(tile.props.onPress).toBeUndefined();
    }
    expect(onPick).not.toHaveBeenCalled();
    const badges = renderer!.root.findAll((node) => node.props.children === cs.party.gamesSoonBadge);
    expect(badges.length).toBeGreaterThanOrEqual(GAME_CATALOG.length);
  });
});
