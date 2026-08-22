import { mergeRecentSearches } from '@/search/recentSearches';

describe('mergeRecentSearches', () => {
  it('trims, deduplicates case-insensitively and keeps the newest eight', () => {
    expect(
      mergeRecentSearches(
        ['Lokál', 'Matuška', 'Pepa', 'A', 'B', 'C', 'D', 'E'],
        '  lokál  ',
      ),
    ).toEqual(['lokál', 'Matuška', 'Pepa', 'A', 'B', 'C', 'D', 'E']);
  });

  it('ignores an empty query', () => {
    expect(mergeRecentSearches(['Lokál'], '  ')).toEqual(['Lokál']);
  });
});
