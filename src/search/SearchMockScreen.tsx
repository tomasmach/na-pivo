import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PeopleSuggestions } from '@/community/PeopleSuggestions';
import {
  ChevronRightIcon,
  ClockIcon,
  SearchIcon,
  XIcon,
} from '@/components/shared/IconGlyph';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { UnderlineTabs } from '@/components/shared/UnderlineTabs';
import { suggestBeerBrands, type BeerBrandSuggestion } from '@/data/beerSuggestionsClient';
import { searchFriends, type FriendProfile } from '@/data/friendsClient';
import { suggestPubLocations } from '@/data/mapyClient';
import { getAllLoadedPubs, hydratePubsSnapshot, type Pub } from '@/data/pubs';
import SkeletonBlock from '@/friends/SkeletonBlock';
import { SectionBreak } from '@/mocks/SectionBreak';
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import { Avatar } from '@/profile/Avatar';
import { loadRecentSearches, saveRecentSearch } from '@/search/recentSearches';
import { usePubStore } from '@/stores/pubStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

const TABS = ['Hospody', 'Piva', 'Pivaři'] as const;
type SearchTab = (typeof TABS)[number];

function normalize(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('cs-CZ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function pubMatches(pub: Pub, query: string): boolean {
  const needle = normalize(query);
  return (
    normalize(pub.name).includes(needle) ||
    (pub.beers ?? []).some((beer) => normalize(beer.name).includes(needle))
  );
}

function personLabel(person: FriendProfile): string {
  return person.nickname ? `@${person.nickname}` : person.displayName;
}

function SearchLoading() {
  const reduceMotion = useReducedMotion();
  return (
    <View style={styles.loading} accessibilityLabel="Hledám">
      <SkeletonBlock width="100%" height={56} reduceMotion={reduceMotion} />
      <SkeletonBlock width="100%" height={56} reduceMotion={reduceMotion} />
      <SkeletonBlock width="100%" height={56} reduceMotion={reduceMotion} />
    </View>
  );
}

export default function SearchMockScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const setRevealedPub = usePubStore((state) => state.setRevealedPub);
  const [query, setQuery] = React.useState('');
  const [tab, setTab] = React.useState<SearchTab>('Hospody');
  const [recent, setRecent] = React.useState<string[]>([]);
  const [pubs, setPubs] = React.useState<Pub[]>([]);
  const [beers, setBeers] = React.useState<BeerBrandSuggestion[]>([]);
  const [people, setPeople] = React.useState<FriendProfile[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const term = query.trim();
  const searching = term.length > 0;
  const canSearch = term.length >= 2;

  React.useEffect(() => {
    void loadRecentSearches().then(setRecent);
    void hydratePubsSnapshot();
  }, []);

  React.useEffect(() => {
    if (!canSearch) {
      const reset = setTimeout(() => {
        setLoading(false);
        setFailed(false);
        setPubs([]);
        setBeers([]);
        setPeople([]);
      }, 0);
      return () => clearTimeout(reset);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setFailed(false);
      if (tab === 'Hospody') {
        const local = getAllLoadedPubs().filter((pub) => pubMatches(pub, term)).slice(0, 20);
        void suggestPubLocations({ name: term }, controller.signal)
          .then((suggestions) => {
            if (controller.signal.aborted) return;
            const merged = local.slice();
            const seen = new Set(local.map((pub) => pub.id));
            for (const suggestion of suggestions) {
              const lat = suggestion.lat;
              const lng = suggestion.lng;
              if (
                typeof lat !== 'number' ||
                typeof lng !== 'number' ||
                !Number.isFinite(lat) ||
                !Number.isFinite(lng) ||
                lat < -90 ||
                lat > 90 ||
                lng < -180 ||
                lng > 180
              ) {
                continue;
              }
              if (seen.has(suggestion.id)) continue;
              seen.add(suggestion.id);
              merged.push({
                id: suggestion.id,
                name: suggestion.name,
                lat,
                lng,
                ...(suggestion.city ? { city: suggestion.city } : {}),
                ...(suggestion.address ? { address: suggestion.address } : {}),
              });
            }
            setPubs(merged.slice(0, 20));
            setLoading(false);
          })
          .catch(() => {
            if (controller.signal.aborted) return;
            setPubs(local);
            setFailed(local.length === 0);
            setLoading(false);
          });
        return;
      }

      if (tab === 'Piva') {
        void suggestBeerBrands(term, controller.signal, 20).then((results) => {
          if (controller.signal.aborted) return;
          setBeers(results);
          setLoading(false);
        });
        return;
      }

      void searchFriends(term.replace(/^@/, ''), controller.signal).then((results) => {
        if (controller.signal.aborted) return;
        setPeople(results ?? []);
        setFailed(results === null);
        setLoading(false);
      });
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [canSearch, tab, term]);

  const remember = React.useCallback(
    (value: string) => {
      void saveRecentSearch(recent, value).then(setRecent);
    },
    [recent],
  );

  const openPub = (pub: Pub) => {
    remember(pub.name);
    setRevealedPub(pub);
    router.push(`/pub/${encodeURIComponent(pub.id)}` as Href);
  };

  const openPerson = (person: FriendProfile) => {
    remember(personLabel(person));
    router.push(`/user?accountId=${encodeURIComponent(person.id)}` as Href);
  };

  const empty = failed
    ? 'Hledání se teď nedotáhlo.'
    : canSearch
      ? 'Nic. Zkus to jinak.'
      : 'Napiš aspoň dvě písmena.';

  return (
    <View style={styles.screen}>
      <View style={[styles.searchWrap, { paddingTop: insets.top + Spacing.sm }]}>
        <View style={styles.field}>
          <SearchIcon size={17} color={Colors.mutedText} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => remember(term)}
            placeholder="Hospodu, pivo nebo pivaře"
            placeholderTextColor={MockColors.fieldHint}
            style={styles.input}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            maxFontSizeMultiplier={FontScaleCap.body}
          />
          {searching ? (
            <Pressable
              onPress={() => setQuery('')}
              accessibilityRole="button"
              accessibilityLabel="Smazat"
              hitSlop={8}
            >
              <XIcon size={15} color={Colors.mutedText} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Zrušit hledání"
          hitSlop={8}
        >
          <Text style={styles.cancel} maxFontSizeMultiplier={FontScaleCap.body}>
            Zrušit
          </Text>
        </Pressable>
      </View>

      {searching ? (
        <UnderlineTabs options={TABS} value={tab} onChange={setTab} inset={MockLayout.screenPad} />
      ) : null}

      <KeyboardAwareScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {!searching ? (
          <>
            {recent.length > 0 ? (
              <>
                <Text style={styles.section} maxFontSizeMultiplier={FontScaleCap.heading}>
                  Nedávno
                </Text>
                {recent.map((entry) => (
                  <Pressable
                    key={entry}
                    onPress={() => setQuery(entry)}
                    style={({ pressed }) => [styles.recentRow, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={entry}
                  >
                    <ClockIcon size={16} color={Colors.mutedText} />
                    <Text style={styles.recentText} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                      {entry}
                    </Text>
                  </Pressable>
                ))}
              </>
            ) : null}
            <SectionBreak title="Pivaři, co bys mohl znát" />
            <PeopleSuggestions />
          </>
        ) : null}

        {searching && loading ? <SearchLoading /> : null}
        {searching && !loading && tab === 'Hospody' ? (
          pubs.length === 0 ? (
            <Empty text={empty} />
          ) : (
            pubs.map((pub) => (
              <Pressable
                key={pub.id}
                onPress={() => openPub(pub)}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={pub.name}
              >
                <View style={styles.grow}>
                  <Text style={styles.rowTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                    {pub.name}
                  </Text>
                  {pub.address || pub.city || pub.beers?.[0]?.name ? (
                    <Text style={styles.rowMeta} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                      {pub.address || pub.city || pub.beers?.[0]?.name}
                    </Text>
                  ) : null}
                </View>
                <ChevronRightIcon size={16} color={Colors.mutedText} />
              </Pressable>
            ))
          )
        ) : null}

        {searching && !loading && tab === 'Piva' ? (
          beers.length === 0 ? (
            <Empty text={empty} />
          ) : (
            beers.map((beer) => (
              <Pressable
                key={beer.slug}
                onPress={() => {
                  remember(beer.name);
                  router.push({
                    pathname: '/beer-detail',
                    params: {
                      beer: beer.name,
                      ...(beer.brandName ? { brewery: beer.brandName } : {}),
                    },
                  } as Href);
                }}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={beer.name}
              >
                <View style={styles.grow}>
                  <Text style={styles.rowTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                    {beer.name}
                  </Text>
                  {beer.brandName && beer.brandName !== beer.name ? (
                    <Text style={styles.rowMeta} maxFontSizeMultiplier={FontScaleCap.body}>
                      {beer.brandName}
                    </Text>
                  ) : null}
                </View>
                <ChevronRightIcon size={16} color={Colors.mutedText} />
              </Pressable>
            ))
          )
        ) : null}

        {searching && !loading && tab === 'Pivaři' ? (
          people.length === 0 ? (
            <Empty text={empty} />
          ) : (
            people.map((person) => (
              <Pressable
                key={person.id}
                onPress={() => openPerson(person)}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={personLabel(person)}
              >
                <Avatar
                  uri={person.avatarUrl}
                  nickname={person.nickname}
                  displayName={person.displayName}
                  size={40}
                  border="quiet"
                />
                <Text style={[styles.rowTitle, styles.grow]} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                  {personLabel(person)}
                </Text>
                <ChevronRightIcon size={16} color={Colors.mutedText} />
              </Pressable>
            ))
          )
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  grow: { flex: 1 },
  pressed: { opacity: 0.65 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: MockLayout.screenPad,
    paddingBottom: Spacing.sm,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    height: HitArea.min,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: MockColors.field,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: MockColors.fieldBorder,
  },
  input: { flex: 1, fontSize: 16, fontWeight: '500', color: Colors.foam },
  cancel: { fontSize: 16, fontWeight: '600', color: Colors.amber },
  body: { paddingHorizontal: MockLayout.screenPad, paddingTop: Spacing.md },
  section: { ...MockType.titleS, color: Colors.foam, marginBottom: Spacing.xs },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: HitArea.min },
  recentText: { flex: 1, fontSize: 16, fontWeight: '500', color: Colors.foam },
  row: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: withAlpha(Colors.foam, 0.08),
  },
  rowTitle: { fontSize: 16, fontWeight: '600', color: Colors.foam },
  rowMeta: { fontSize: 13, fontWeight: '400', color: Colors.mutedText, marginTop: 1 },
  loading: { gap: Spacing.sm, paddingTop: Spacing.sm },
  empty: { fontSize: 15, fontWeight: '500', color: Colors.mutedText, paddingTop: Spacing.xl, textAlign: 'center' },
});
