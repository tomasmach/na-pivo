import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadRecentSearches, mergeRecentSearches, saveRecentSearch } from '../recentSearches';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

beforeEach(async () => { await AsyncStorage.clear(); });
it('loads the old storage key and ignores malformed rows', async () => {
  await AsyncStorage.setItem('na-pivo-search-recent-v1', '[null,12,"  U Jelena  ","",{}]');
  expect(await loadRecentSearches()).toEqual(['U Jelena']);
  await AsyncStorage.setItem('na-pivo-search-recent-v1', '{broken');
  expect(await loadRecentSearches()).toEqual([]);
});
it('moves repeated searches to the front and caps the list', async () => {
  const recent = ['U Jelena', ...Array.from({ length: 10 }, (_, i) => `Hospoda ${i}`)];
  expect(mergeRecentSearches(recent, 'u jelena')).toHaveLength(8);
  await saveRecentSearch(recent, 'u jelena');
  expect(await loadRecentSearches()).toEqual(mergeRecentSearches(recent, 'u jelena'));
});
