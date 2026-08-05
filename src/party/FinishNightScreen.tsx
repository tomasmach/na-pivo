/**
 * DESIGN MOCK — the screen between the last beer and the post.
 *
 * Strava's save-activity screen, in a pub: the night's numbers, then the few
 * things only you can add — what to call it, photos, a note — and then publish.
 *
 * The one thing that is ours is the ROAST TOGGLE. With it on, the caption is
 * written from the data rather than by you, and it takes the piss. That is the
 * product's voice, and it is also the honest framing of an automatic caption:
 * you are handing the mic over, so it is a switch you flip, defaulted ON because
 * it is why the feed is worth reading — but one tap to take back.
 *
 * The generator itself is `roast.ts`, the same rules the feed card uses, so the
 * line you approve here IS the line that gets posted. Nothing regenerates behind
 * your back. When the rules have nothing fair to say, the toggle is disabled and
 * says so rather than inventing something — a roast that is not true about this
 * night is just a random insult.
 */

import React from 'react';
import { Image, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { CameraIcon, SparklesIcon, XIcon } from '@/components/shared/IconGlyph';
import { buildRoast } from '@/feed/roast';
import { usePublishedStore } from '@/mocks/publishedStore';
import { nightByBeer, nightMe, nightTally } from '@/party/nightRecord';
import { useNightRecord } from '@/party/useNightRecord';
import { usePartyEveningStore } from '@/stores/partyEveningStore';
import { StatGrid } from '@/mocks/StatGrid';
import {
  formatElapsed,
  useLivePartyStore,
  useNightClock,
} from '@/mocks/livePartyStore';
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

/** Illustrative only — real ones come from `BeerPhoto`. MUST NOT ship. */
const PHOTOS = [
  'https://picsum.photos/seed/napivo-1/300/300',
  'https://picsum.photos/seed/napivo-2/300/300',
  'https://picsum.photos/seed/napivo-3/300/300',
  'https://picsum.photos/seed/napivo-4/300/300',
];

export default function FinishNightScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const startedAt = useLivePartyStore((s) => s.startedAt);
  const minutes = useNightClock(startedAt);
  const photos = useLivePartyStore((s) => s.photos);
  const games = useLivePartyStore((s) => s.games);
  const pubName = useLivePartyStore((s) => s.pubName);
  const endParty = useLivePartyStore((s) => s.end);
  // Closing the shared evening too, when there is one. Leaving it open would
  // leave the table joinable by a code for a night that is already published.
  const endEvening = usePartyEveningStore((s) => s.end);
  const publishNight = usePublishedStore((s) => s.publish);

  const [title, setTitle] = React.useState('');
  const [note, setNote] = React.useState('');
  const [roastOn, setRoastOn] = React.useState(true);

  const played = games.filter((game) => game.result);
  // The night as data — the same record the hub was showing a moment ago, so
  // what you publish is what you were looking at.
  const night = useNightRecord();
  const me = nightMe(night);
  const people = night.people.slice(1);
  const beerCount = nightTally(night).beers;
  const byType = nightByBeer({
    ...night,
    drinks: night.drinks.filter((drink) => drink.by === me?.id),
  }).map((row) => ({ beer: row.beer, count: row.count }));

  // The same rules the feed card runs, on this night's real numbers.
  const roast = buildRoast({
    beers: beerCount,
    duration: minutes,
    pubs: 1,
    people: people.length + 1,
    photos,
    games: played.length,
    gamesWon: played.filter((game) => game.result?.winner === 'Ty').length,
    // No history in the mock, so the tempo rules stay silent — which is exactly
    // what should happen on a first night.
    usualPerHour: 1.6,
    visitsToSamePub: 1,
  });

  const fallbackTitle = `Večer v ${pubName || 'hospodě'}`;
  const caption = roastOn && roast ? roast.line : title.trim() || fallbackTitle;

  const publish = () => {
    // Built BEFORE `endParty()`, which resets the live store — the whole point
    // of publishing is that the evening outlives the night that made it.
    publishNight({
      id: `mine-${startedAt ?? 0}`,
      author: 'Ty',
      authorTint: Colors.amber,
      when: 'právě teď',
      title: title.trim() || fallbackTitle,
      note: note.trim() || undefined,
      stops: [{ name: pubName, lat: 50.0785, lng: 14.42 }],
      beers: beerCount,
      duration: formatElapsed(minutes),
      people: [
        // No avatar url: `Face` falls back to the initial on a tint, which is
        // what a real table looks like anyway — half of them never set a photo.
        { name: 'Ty', tint: Colors.amber, avatar: '' },
        ...people.map((person) => ({ name: person.name, tint: person.tint, avatar: '' })),
      ],
      photos,
      cheers: 0,
      comments: 0,
      highlight:
        played.length > 0 && played[0].result
          ? {
              kind: 'game',
              game: played[0].name,
              winner: played[0].result.winner ?? '—',
              scores: played[0].result.scores,
            }
          : { kind: 'map' },
      durationMinutes: minutes,
      games: played.length,
      gamesWon: played.filter((game) => game.result?.winner === 'Ty').length,
      // Roast off means the night keeps its own words: the rules read this and
      // stay silent, rather than the card having to know about a toggle.
      usualPerHour: roastOn ? 1.6 : null,
      visitsToSamePub: 1,
    });
    endParty();
    void endEvening();
    // Into Kocoviny, not back to a recap: you published to a feed, so the feed
    // with your night at the top of it is the proof that it worked.
    router.replace('/friends' as Href);
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.top, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Zpátky do večera"
          hitSlop={8}
        >
          <XIcon size={18} color={Colors.foam} />
        </Pressable>
        <Text style={styles.topTitle} maxFontSizeMultiplier={FontScaleCap.body}>
          Ukončit večer
        </Text>
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* The numbers first, because that is what you are here to confirm. */}
        <StatGrid
          columns={4}
          compact
          stats={[
            { label: 'Piva', value: String(beerCount) },
            { label: 'Večer', value: formatElapsed(minutes) },
            { label: 'U stolu', value: String(people.length + 1) },
            { label: 'Druhů', value: String(byType.length) },
          ]}
        />

        {/* The switch that hands the caption over. */}
        <View style={styles.roastCard}>
          <View style={styles.roastHead}>
            <View style={styles.medallion}>
              <SparklesIcon size={17} color={Colors.amber} />
            </View>
            <View style={styles.grow}>
              <Text style={styles.roastTitle} maxFontSizeMultiplier={FontScaleCap.body}>
                Roast
              </Text>
              <Text style={styles.roastSub} maxFontSizeMultiplier={FontScaleCap.body}>
                {roast
                  ? 'Popisek napíšeme z dat. A nebudeme se šetřit.'
                  : 'Dneska nemáme co vyčítat. Napiš si to sám.'}
              </Text>
            </View>
            <Switch
              value={roastOn && Boolean(roast)}
              onValueChange={setRoastOn}
              disabled={!roast}
              trackColor={{ false: withAlpha(Colors.foam, 0.16), true: Colors.amber }}
              thumbColor={Colors.foam}
              accessibilityLabel="Nechat popisek napsat z dat"
            />
          </View>

          {roastOn && roast ? (
            <View style={styles.roastPreview}>
              <Text style={styles.roastLine} maxFontSizeMultiplier={FontScaleCap.heading}>
                {roast.line}
              </Text>
              <Text style={styles.roastBasis} maxFontSizeMultiplier={FontScaleCap.body}>
                {roast.basis}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Only offered when the roast is off — two captions competing for one
            slot is the ambiguity the toggle exists to remove. */}
        {roastOn && roast ? null : (
          <View style={styles.field}>
            <Text style={styles.label} maxFontSizeMultiplier={FontScaleCap.body}>
              Jak to nazveme
            </Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={fallbackTitle}
              placeholderTextColor={MockColors.fieldHint}
              style={styles.input}
              maxFontSizeMultiplier={FontScaleCap.body}
            />
          </View>
        )}

        <View style={styles.field}>
          <Text style={styles.label} maxFontSizeMultiplier={FontScaleCap.body}>
            Fotky
          </Text>
          <View style={styles.photoRow}>
            {/* Round, like the hub's controls — adding a photo is an action, and
                actions in this product are discs. */}
            <Pressable
              style={({ pressed }) => [styles.addPhoto, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Přidat fotku"
            >
              <CameraIcon size={20} color={Colors.stout} />
            </Pressable>
            {Array.from({ length: Math.max(photos, 3) }).map((_, index) => (
              <Image
                key={index}
                source={{ uri: PHOTOS[index % PHOTOS.length] }}
                style={styles.photo}
              />
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label} maxFontSizeMultiplier={FontScaleCap.body}>
            Poznámka
          </Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Co se stalo, co se nesmí opakovat…"
            placeholderTextColor={MockColors.fieldHint}
            style={[styles.input, styles.noteInput]}
            multiline
            maxFontSizeMultiplier={FontScaleCap.body}
          />
        </View>

        {played.length > 0 ? (
          <View style={styles.field}>
            <Text style={styles.label} maxFontSizeMultiplier={FontScaleCap.body}>
              Hry
            </Text>
            {played.map((game) => (
              <Text
                key={game.key}
                style={styles.gameLine}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {game.result?.winner
                  ? `${game.name} — vyhrál ${game.result.winner}`
                  : `${game.name} — odehráno`}
              </Text>
            ))}
          </View>
        ) : null}
      </KeyboardAwareScrollView>

      <View style={[styles.foot, { paddingBottom: insets.bottom + Spacing.md }]}>
        <Text style={styles.captionPreview} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {caption}
        </Text>
        <Pressable
          onPress={publish}
          style={({ pressed }) => [styles.publish, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Zveřejnit večer"
        >
          <Text style={styles.publishText} maxFontSizeMultiplier={FontScaleCap.heading}>
            Zveřejnit
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: MockColors.bg },
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },

  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.09),
  },
  topTitle: { fontSize: 17, fontWeight: '700', color: Colors.foam },

  body: { paddingHorizontal: MockLayout.screenPad, paddingTop: Spacing.md, gap: Spacing.xl },

  // — Roast —
  roastCard: { padding: Spacing.md, borderRadius: 22, backgroundColor: MockColors.surfaceHigh },
  roastHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  medallion: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.14),
  },
  roastTitle: { ...MockType.bodySemibold, color: Colors.foam },
  roastSub: { fontSize: 12, fontWeight: '400', color: Colors.mutedText, marginTop: 1 },
  roastPreview: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  roastLine: { fontSize: 21, fontWeight: '800', color: Colors.foam, letterSpacing: -0.4 },
  roastBasis: { fontSize: 13, fontWeight: '500', color: Colors.mutedText, marginTop: 4 },

  // — Fields —
  field: { gap: Spacing.sm },
  label: { fontSize: 13, fontWeight: '600', color: Colors.mutedText },
  input: {
    minHeight: MockLayout.buttonHeight,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 18,
    backgroundColor: MockColors.surfaceHigh,
    color: Colors.foam,
    fontSize: 16,
    fontWeight: '600',
  },
  noteInput: { minHeight: 90, textAlignVertical: 'top' },

  photoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  addPhoto: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  photo: { width: 62, height: 62, borderRadius: 18 },

  gameLine: { fontSize: 15, fontWeight: '600', color: Colors.foam },

  // — Foot —
  foot: {
    paddingHorizontal: MockLayout.screenPad,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  captionPreview: { fontSize: 13, fontWeight: '500', color: Colors.mutedText },
  publish: {
    height: MockLayout.sheetButtonHeight,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
    minWidth: HitArea.min,
  },
  publishText: { ...MockType.buttonLabel, color: Colors.stout },
});
