import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import FriendProfileScreen from '@/friends/FriendProfileScreen';
import { DetailContext, type DetailContextValue, type PaneNav } from '@/layout/detail';
import type { BookTab } from '@/layout/pane';
import EveningDetailScreen from '@/myBeers/EveningDetailScreen';
import PubPageScreen from '@/pubPage/PubPageScreen';
import { useBookStore, type PageEntry } from '@/stores/bookStore';
import { Colors } from '@/theme/colors';

function paramsFor(entry: PageEntry): Record<string, string> {
  if (entry.kind === 'pub') return { ...entry.params };
  if (entry.kind === 'evening') return { startedAt: entry.startedAt };
  return { id: entry.id };
}

function identity(entry: PageEntry): string {
  if (entry.kind === 'pub') return `pub:${entry.params.ref ?? entry.params.key}`;
  if (entry.kind === 'evening') return `evening:${entry.startedAt}`;
  return `friend:${entry.id}`;
}

/**
 * The top page of a tab's right-half stack, laid over whatever the half shows
 * underneath (the map, the diary, the second column), which stays mounted.
 */
export function RightPage({ tab }: { tab: BookTab }) {
  const router = useRouter();
  const entries = useBookStore((state) => state.pages[tab]);
  const top = entries.at(-1);

  const nav = useMemo<PaneNav>(
    () => ({
      back: () => useBookStore.getState().back(tab),
      push: (entry) => useBookStore.getState().push(tab, entry),
      replace: (entry) => useBookStore.getState().replace(tab, entry),
      showCompass: () => {
        useBookStore.getState().clear(tab);
        router.navigate({ pathname: '/', params: { view: 'compass' } } as unknown as Href);
      },
    }),
    [router, tab],
  );
  const value = useMemo<DetailContextValue | null>(
    () => (top ? { params: paramsFor(top), nav } : null),
    [nav, top],
  );

  if (!top || !value) return null;
  return (
    <View style={styles.page} collapsable={false}>
      <DetailContext.Provider key={`${entries.length}:${identity(top)}`} value={value}>
        {top.kind === 'pub' ? (
          <PubPageScreen />
        ) : top.kind === 'evening' ? (
          <EveningDetailScreen />
        ) : (
          <FriendProfileScreen />
        )}
      </DetailContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    ...StyleSheet.absoluteFill,
    backgroundColor: Colors.stout,
  },
});
