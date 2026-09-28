import { fireEvent, render } from '@testing-library/react-native';

jest.mock('@/leaderboards/BoardSkeleton', () => ({
  HeroSkeleton: () => null,
  HeroFooterSkeleton: () => null,
  RowsSkeleton: () => null,
}));
jest.mock('@/leaderboards/PodiumMats', () => ({ PodiumMats: () => null }));
jest.mock('@/components/shared/IconGlyph', () => ({ ChevronRightIcon: () => null }));

import type { PubBoard } from '@/data/pubBoardClient';
import { t } from '@/i18n';
import { PubBoardContent } from '@/leaderboards/PubBoardContent';

function entry(rank: number, name: string, beers: number) {
  return { rank, key: `key-${rank}`, name, city: 'Brno', lat: 49.19, lng: 16.6, beers };
}

const BOARD: PubBoard = {
  period: 'week',
  periodStart: '2026-09-21',
  periodEnd: '2026-09-27',
  city: null,
  cities: [],
  totalRanked: 2,
  entries: [entry(1, 'Pegas', 143), entry(2, 'Lokál U Caipla', 97)],
};

describe('PubBoardContent', () => {
  it('puts the winner in the card and opens any pub', () => {
    const onOpen = jest.fn();
    const screen = render(
      <PubBoardContent state="loaded" board={BOARD} period="week" reduceMotion onOpen={onOpen} />,
    );

    expect(screen.getByText('Pegas')).toBeTruthy();
    expect(screen.getByText(t.leaderboards.venuesSubtitle('week'))).toBeTruthy();
    fireEvent.press(screen.getByText('Lokál U Caipla'));
    expect(onOpen).toHaveBeenCalledWith(BOARD.entries[1]);
    fireEvent.press(screen.getByText('Pegas'));
    expect(onOpen).toHaveBeenCalledWith(BOARD.entries[0]);
  });

  it('explains the rules when no pub made the board', () => {
    const screen = render(
      <PubBoardContent
        state="loaded"
        board={{ ...BOARD, entries: [], totalRanked: 0 }}
        period="year"
        reduceMotion
        onOpen={jest.fn()}
      />,
    );

    expect(screen.getByText(t.leaderboards.venuesEmptyTitle('year'))).toBeTruthy();
    expect(screen.getByText(t.leaderboards.venuesRules('year')[1])).toBeTruthy();
  });
});
