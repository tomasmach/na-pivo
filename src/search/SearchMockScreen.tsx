/**
 * DESIGN MOCK — search, the one screen the magnifier on three tabs was pointing
 * at and which did not exist.
 *
 * One field, three kinds of answer, because those are the three kinds of thing
 * in this product:
 *
 *   Hospody   places you can go
 *   Piva      what is in the glass
 *   Pivaři    people
 *
 * Empty is the important state. A search screen that opens on nothing is a dead
 * end you have to type your way out of, so before you type it shows what it can
 * offer: recent searches, and PEOPLE SUGGESTIONS — which is why they moved here
 * out of Komunita. Suggesting someone belongs where you are already looking for
 * someone, not on a leaderboard screen where it is an interruption.
 *
 * Filtering is client-side on the mock's three lists. The real one hits
 * `PubSearchFilters` and `FriendSearchView`, which is also why the tabs match
 * those endpoints rather than being invented categories.
 */

import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import {
  ChevronRightIcon,
  ClockIcon,
  SearchIcon,
  XIcon,
} from '@/components/shared/IconGlyph';
import { PeopleSuggestions } from '@/community/PeopleSuggestions';
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import { SectionBreak } from '@/mocks/SectionBreak';
import { MOCK_PUBS } from '@/pubs/mockPubs';
import { UnderlineTabs } from '@/components/shared/UnderlineTabs';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

const TABS = ['Hospody', 'Piva', 'Pivaři'] as const;

const RECENT = ['Zlý časy', 'Matuška', '@chmelák', 'tankové'];

const BEERS = [
  { name: 'Matuška Raptor', style: 'IPA 15°', pubs: 4 },
  { name: 'Únětická 12°', style: 'Ležák', pubs: 9 },
  { name: 'Pilsner Urquell', style: 'Ležák 12°', pubs: 31 },
  { name: 'Kacíř 11°', style: 'Světlé výčepní', pubs: 6 },
  { name: 'Flekovský ležák 13°', style: 'Tmavý ležák', pubs: 1 },
];

const AVATARS = 'https://i.pravatar.cc/160?img=';
const PEOPLE = [
  { handle: '@chmelák', meta: '27 piv tenhle týden', avatar: `${AVATARS}50` },
  { handle: '@pěna', meta: '24 piv · 5 hospod', avatar: `${AVATARS}41` },
  { handle: '@klárka', meta: 'Máte 3 společné hospody', avatar: `${AVATARS}64` },
];

function matches(haystack: string, needle: string): boolean {
  return haystack.toLocaleLowerCase('cs').includes(needle.toLocaleLowerCase('cs'));
}

export default function SearchMockScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [query, setQuery] = React.useState('');
  const [tab, setTab] = React.useState<(typeof TABS)[number]>('Hospody');

  const term = query.trim();
  const searching = term.length > 0;

  const pubs = MOCK_PUBS.filter((pub) => matches(pub.name, term) || matches(pub.beer, term));
  const beers = BEERS.filter((beer) => matches(beer.name, term) || matches(beer.style, term));
  const people = PEOPLE.filter((person) => matches(person.handle, term));

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

      {/* The tabs only appear once there is something to sort into them. Before
          that they are three empty promises across the top of a blank screen. */}
      {searching ? (
        <UnderlineTabs
                options={TABS}
                value={tab}
                onChange={setTab}
                inset={MockLayout.screenPad}
              />
      ) : null}

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {!searching ? (
          <>
            <Text style={styles.section} maxFontSizeMultiplier={FontScaleCap.heading}>
              Nedávno
            </Text>
            {RECENT.map((entry) => (
              <Pressable
                key={entry}
                onPress={() => setQuery(entry)}
                style={({ pressed }) => [styles.recentRow, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={entry}
              >
                <ClockIcon size={16} color={Colors.mutedText} />
                <Text
                  style={styles.recentText}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {entry}
                </Text>
              </Pressable>
            ))}

            {/* Moved out of Komunita: a suggestion belongs where you are already
                trying to find someone. */}
            <SectionBreak title="Pivaři, co bys mohl znát" />
            <PeopleSuggestions />
          </>
        ) : null}

        {searching && tab === 'Hospody' ? (
          pubs.length === 0 ? (
            <Empty />
          ) : (
            pubs.map((pub) => (
              <Pressable
                key={pub.id}
                onPress={() => router.push(`/pub/${pub.id}` as Href)}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={pub.name}
              >
                <View style={styles.grow}>
                  <Text
                    style={styles.rowTitle}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {pub.name}
                  </Text>
                  <Text
                    style={styles.rowMeta}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {pub.distance} · {pub.beer}
                  </Text>
                </View>
                <ChevronRightIcon size={16} color={Colors.mutedText} />
              </Pressable>
            ))
          )
        ) : null}

        {searching && tab === 'Piva' ? (
          beers.length === 0 ? (
            <Empty />
          ) : (
            beers.map((beer) => (
              <View key={beer.name} style={styles.row}>
                <View style={styles.grow}>
                  <Text
                    style={styles.rowTitle}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {beer.name}
                  </Text>
                  <Text style={styles.rowMeta} maxFontSizeMultiplier={FontScaleCap.body}>
                    {beer.style} · na čepu v {beer.pubs} hospodách
                  </Text>
                </View>
              </View>
            ))
          )
        ) : null}

        {searching && tab === 'Pivaři' ? (
          people.length === 0 ? (
            <Empty />
          ) : (
            people.map((person) => (
              <View key={person.handle} style={styles.row}>
                <Image source={{ uri: person.avatar }} style={styles.avatar} />
                <View style={styles.grow}>
                  <Text
                    style={styles.rowTitle}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {person.handle}
                  </Text>
                  <Text style={styles.rowMeta} maxFontSizeMultiplier={FontScaleCap.body}>
                    {person.meta}
                  </Text>
                </View>
                <ChevronRightIcon size={16} color={Colors.mutedText} />
              </View>
            ))
          )
        ) : null}
      </ScrollView>
    </View>
  );
}

/** One sentence, no illustration. An empty result is not an occasion. */
function Empty() {
  return (
    <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>
      Nic. Zkus to jinak.
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

  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: HitArea.min,
  },
  recentText: { flex: 1, fontSize: 16, fontWeight: '500', color: Colors.foam },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: withAlpha(Colors.foam, 0.08),
  },
  avatar: { width: 40, height: 40, borderRadius: Radius.pill },
  rowTitle: { fontSize: 16, fontWeight: '600', color: Colors.foam },
  rowMeta: { fontSize: 13, fontWeight: '400', color: Colors.mutedText, marginTop: 1 },

  empty: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.mutedText,
    paddingTop: Spacing.xl,
    textAlign: 'center',
  },
});
