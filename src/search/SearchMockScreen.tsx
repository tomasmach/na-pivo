import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import { ChevronRightIcon, SearchIcon, XIcon } from '@/components/shared/IconGlyph';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { PeopleSuggestions } from '@/community/PeopleSuggestions';
import {
  fetchFriendsDashboard,
  type FriendProfile,
  type FriendsDashboard,
} from '@/data/friendsClient';
import { loadFriendsDashboardSnapshot } from '@/data/friendsSnapshot';
import { SectionBreak } from '@/mocks/SectionBreak';
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import { Avatar } from '@/profile/Avatar';
import { EMPTY_NEARBY_PUB_FILTERS, useNearbyPubs } from '@/pubs/useNearbyPubs';
import { UnderlineTabs } from '@/components/shared/UnderlineTabs';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

const TABS = ['Hospody', 'Piva', 'Pivaři'] as const;

function normalized(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('cs-CZ');
}

function matches(haystack: string | null | undefined, needle: string): boolean {
  return normalized(haystack ?? '').includes(normalized(needle));
}

function personLabel(person: FriendProfile): string {
  return person.nickname ? `@${person.nickname}` : person.displayName;
}

export default function SearchMockScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const nearby = useNearbyPubs(EMPTY_NEARBY_PUB_FILTERS);
  const [query, setQuery] = React.useState('');
  const [tab, setTab] = React.useState<(typeof TABS)[number]>('Hospody');
  const [dashboard, setDashboard] = React.useState<FriendsDashboard | null>(null);
  const [friendsLoading, setFriendsLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      const cached = await loadFriendsDashboardSnapshot();
      if (!cancelled && cached) setDashboard(cached.dashboard);
      const fresh = await fetchFriendsDashboard(controller.signal);
      if (!cancelled && fresh) setDashboard(fresh);
      if (!cancelled) setFriendsLoading(false);
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const term = query.trim();
  const searching = term.length > 0;
  const friends = dashboard?.friends ?? [];
  const pubs = nearby.pubs.filter(
    (pub) =>
      matches(pub.name, term) ||
      matches(pub.addressLine, term) ||
      pub.beers?.some((beer) => matches(beer.name, term)),
  );
  const people = friends.filter(
    (person) => matches(person.nickname, term) || matches(person.displayName, term),
  );
  const groupedBeers = new Map<string, { name: string; pubIds: Set<string> }>();
  for (const pub of nearby.pubs) {
    for (const beer of pub.beers ?? []) {
      const key = normalized(beer.name);
      const row = groupedBeers.get(key) ?? { name: beer.name, pubIds: new Set<string>() };
      row.pubIds.add(pub.id);
      groupedBeers.set(key, row);
    }
  }
  const beers = [...groupedBeers.values()]
    .filter((beer) => matches(beer.name, term))
    .sort((a, b) => b.pubIds.size - a.pubIds.size);

  const openPerson = React.useCallback(
    (person: FriendProfile) => {
      router.push(`/user?handle=${encodeURIComponent(person.nickname ?? person.id)}` as Href);
    },
    [router],
  );

  return (
    <View style={styles.screen}>
      <View style={[styles.searchWrap, { paddingTop: insets.top + Spacing.sm }]}>
        <View style={styles.field}>
          <SearchIcon size={17} color={Colors.mutedText} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Hospodu, pivo nebo pivaře"
            placeholderTextColor={MockColors.fieldHint}
            style={styles.input}
            autoFocus
            returnKeyType="search"
            maxFontSizeMultiplier={FontScaleCap.body}
          />
          {searching ? (
            <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Smazat" hitSlop={8}>
              <XIcon size={15} color={Colors.mutedText} />
            </Pressable>
          ) : null}
        </View>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Zrušit hledání" hitSlop={8}>
          <Text style={styles.cancel} maxFontSizeMultiplier={FontScaleCap.body}>Zrušit</Text>
        </Pressable>
      </View>

      {searching ? <UnderlineTabs options={TABS} value={tab} onChange={setTab} inset={MockLayout.screenPad} /> : null}

      <KeyboardAwareScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {!searching ? (
          <>
            {nearby.loading && nearby.pubs.length === 0 ? <SearchSkeleton /> : null}
            {nearby.pubs.length > 0 ? (
              <>
                <Text style={styles.section} maxFontSizeMultiplier={FontScaleCap.heading}>Hospody kolem tebe</Text>
                {nearby.pubs.slice(0, 3).map((pub) => (
                  <PubResult key={pub.id} pub={pub} onPress={() => router.push(`/(tabs)/(pubs)/pub/${encodeURIComponent(pub.id)}` as Href)} />
                ))}
              </>
            ) : null}
            {friends.length > 0 ? <SectionBreak title="Tvoje parta" /> : null}
            <PeopleSuggestions people={friends} onPress={openPerson} />
          </>
        ) : null}

        {searching && tab === 'Hospody' ? (
          nearby.loading && nearby.pubs.length === 0 ? <SearchSkeleton /> : pubs.length === 0 ? (
            <Empty label="Takovou hospodu kolem tebe nevidím." />
          ) : pubs.map((pub) => (
            <PubResult key={pub.id} pub={pub} onPress={() => router.push(`/(tabs)/(pubs)/pub/${encodeURIComponent(pub.id)}` as Href)} />
          ))
        ) : null}

        {searching && tab === 'Piva' ? (
          nearby.loading && nearby.pubs.length === 0 ? <SearchSkeleton /> : beers.length === 0 ? (
            <Empty label="Takové pivo tu zatím nikdo nezmapoval." />
          ) : beers.map((beer) => (
            <View key={normalized(beer.name)} style={styles.row}>
              <View style={styles.grow}>
                <Text style={styles.rowTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>{beer.name}</Text>
                <Text style={styles.rowMeta} maxFontSizeMultiplier={FontScaleCap.body}>
                  Na čepu v {beer.pubIds.size} {beer.pubIds.size === 1 ? 'hospodě' : 'hospodách'} kolem tebe
                </Text>
              </View>
            </View>
          ))
        ) : null}

        {searching && tab === 'Pivaři' ? (
          friendsLoading ? <SearchSkeleton /> : people.length === 0 ? (
            <Empty label="V partě nikoho takového nemáš." />
          ) : people.map((person) => (
            <Pressable key={person.id} onPress={() => openPerson(person)} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={personLabel(person)}>
              <Avatar uri={person.avatarUrl} nickname={person.nickname} displayName={person.displayName} size={40} border="quiet" />
              <View style={styles.grow}>
                <Text style={styles.rowTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>{personLabel(person)}</Text>
                {person.nickname && person.displayName ? <Text style={styles.rowMeta} maxFontSizeMultiplier={FontScaleCap.body}>{person.displayName}</Text> : null}
              </View>
              <ChevronRightIcon size={16} color={Colors.mutedText} />
            </Pressable>
          ))
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}

function PubResult({ pub, onPress }: { pub: ReturnType<typeof useNearbyPubs>['pubs'][number]; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={pub.name}>
      <View style={styles.grow}>
        <Text style={styles.rowTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>{pub.name}</Text>
        <Text style={styles.rowMeta} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>{pub.distance} · {pub.beerLabel}</Text>
      </View>
      <ChevronRightIcon size={16} color={Colors.mutedText} />
    </Pressable>
  );
}

function SearchSkeleton() {
  return (
    <View accessibilityLabel="Načítám výsledky">
      {[0, 1, 2].map((item) => (
        <View key={item} style={styles.skeletonRow}>
          <View style={styles.skeletonTitle} />
          <View style={styles.skeletonLine} />
        </View>
      ))}
    </View>
  );
}

function Empty({ label }: { label: string }) {
  return <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>{label}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  grow: { flex: 1 },
  pressed: { opacity: 0.65 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: MockLayout.screenPad, paddingBottom: Spacing.sm },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, height: HitArea.min, paddingHorizontal: Spacing.md, borderRadius: Radius.pill, backgroundColor: MockColors.field, borderWidth: StyleSheet.hairlineWidth, borderColor: MockColors.fieldBorder },
  input: { flex: 1, fontSize: 16, fontWeight: '500', color: Colors.foam },
  cancel: { fontSize: 16, fontWeight: '600', color: Colors.amber },
  body: { paddingHorizontal: MockLayout.screenPad, paddingTop: Spacing.md },
  section: { ...MockType.titleS, color: Colors.foam, marginBottom: Spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 58, paddingVertical: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(Colors.foam, 0.1) },
  rowTitle: { ...MockType.bodySemibold, color: Colors.foam },
  rowMeta: { fontSize: 13, fontWeight: '400', color: Colors.mutedText, marginTop: 2 },
  empty: { marginTop: Spacing.xl, fontSize: 15, fontWeight: '500', color: Colors.mutedText, textAlign: 'center' },
  skeletonRow: { minHeight: 58, justifyContent: 'center', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(Colors.foam, 0.1) },
  skeletonTitle: { width: '58%', height: 14, borderRadius: 7, backgroundColor: Colors.stout3 },
  skeletonLine: { width: '76%', height: 10, borderRadius: 5, backgroundColor: Colors.stout3 },
});
