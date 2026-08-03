/**
 * DESIGN MOCK — Feed home, Strava's activity feed shape.
 *
 * One card per NIGHT, never per beer. The card is readable without opening it:
 * who, where, and the three numbers. That is the whole Strava trick — the feed
 * is not a list of links to activities, it IS the activities.
 *
 * Card order, top to bottom:
 *   author + when          who is talking, and how fresh it is
 *   title                  the night, named
 *   pub chain              the route, in amber, like a Strava map
 *   three numbers          piva / čas / hospody, hairline-separated
 *   people                 overlapping initials, the table
 *   cheers · comments      the social floor
 *
 * A live night gets a pill instead of a timestamp and skips the numbers that
 * are not final yet.
 *
 * System font throughout (see PartyRecapScreen's header for why).
 */

import React from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, type Href } from "expo-router";

import { MessageSquareIcon, SearchIcon } from "@/components/shared/IconGlyph";
import { GlassIconButton } from "@/components/shared/GlassIconButton";
import { CheersButton } from "@/feed/CheersButton";
import { cs } from "@/i18n/cs";
import { MOCK_FEED, type FeedEntry } from "@/feed/mockFeed";
import { usePublishedStore } from "@/mocks/publishedStore";
import { PartyHighlight } from "@/feed/PartyHighlight";
import { buildRoast } from "@/feed/roast";
import { StatGrid } from "@/mocks/StatGrid";
import { MockColors, MockLayout, MockType } from "@/mocks/mockTheme";
import { TAB_CHROME } from '@/components/shared/TabBar';
import { Colors, withAlpha } from "@/theme/colors";
import { FontScaleCap, Fonts } from "@/theme/fonts";
import { HitArea, Radius, Spacing } from "@/theme/layout";

/** "Honza, Petr a ty" — the table, named the way you would say it out loud. */
function namesLine(people: { name: string }[]): string {
  const names = people.map((p) => p.name);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} a ${names[names.length - 1]}`;
}

/** A face when there is one, the initial when there is not. The ring is the
 *  card ground, so overlapping faces punch out of each other cleanly.
 *
 *  Exported because the recap's byline IS this byline — the detail is the post
 *  opened, so a second implementation there could only ever drift from it. */
export function Face({
  name,
  tint,
  avatar,
  size = 28,
}: {
  name: string;
  tint: string;
  avatar?: string;
  size?: number;
}) {
  const shape = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };

  if (avatar) {
    return <Image source={{ uri: avatar }} style={[styles.avatar, shape]} />;
  }

  return (
    <View style={[styles.avatar, shape, { backgroundColor: tint, borderColor: MockColors.surface }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.42 }]} allowFontScaling={false}>
        {name.replace('@', '').slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

export function FeedCard({
  entry,
  first = false,
}: {
  entry: FeedEntry;
  /** The band separates posts FROM EACH OTHER. Above the first one there is no
   *  previous post to separate it from, only the title — so it reads as a rule
   *  under the header instead of a gap, which is a different thing. */
  first?: boolean;
}) {
  const router = useRouter();

  // Derived, not written: every roast is a true observation about THIS night,
  // and the rules stay silent when there is nothing fair to say (see roast.ts).
  const roast = buildRoast({
    beers: entry.beers,
    duration: entry.durationMinutes,
    pubs: entry.stops.length,
    people: entry.people.length,
    photos: entry.photos,
    games: entry.games,
    gamesWon: entry.gamesWon,
    usualPerHour: entry.usualPerHour,
    visitsToSamePub: entry.visitsToSamePub,
  });

  return (
    // The card is a View, not one big Pressable.
    //
    // Wrapping the whole post in a Pressable meant it claimed the touch on
    // press-down and never let go, so the horizontal strip inside it could not
    // take over the pan — the hero simply would not scroll. It also made a
    // button that contained two other buttons, which is malformed for
    // VoiceOver.
    //
    // So only the text block opens the detail. The strip scrolls, the cheers and
    // comment buttons are their own targets, and each thing on the card does
    // exactly one thing.
    <View style={[styles.card, first && styles.cardFirst]}>
      <Pressable
        style={({ pressed }) => [pressed && styles.cardPressed]}
        onPress={() => router.push("/friends/party-recap" as Href)}
        accessibilityRole="button"
        accessibilityLabel={`${entry.title}, detail večera`}
      >
      {/* The party owns the post, not one author. A night is the same object on
          everybody's wall, so the header is the table: every face, then who they
          are. "Honza přidal" would make four other people spectators at their
          own evening. */}
      {/* The faces open the person, not the night — the one place in the feed
          where you can get from a table to somebody's profile. */}
      <Pressable
        style={({ pressed }) => [styles.cardHead, pressed && styles.pressed]}
        onPress={() =>
          router.push(
            `/user?handle=${encodeURIComponent(entry.people[0]?.name.replace('@', '') ?? '')}` as Href,
          )
        }
        accessibilityRole="button"
        accessibilityLabel={`Profil: ${namesLine(entry.people)}`}
      >
        <View style={styles.headAvatars}>
          {entry.people.slice(0, 4).map((person, index) => (
            <View
              key={person.name}
              style={index === 0 ? undefined : styles.peopleOverlap}
            >
              <Face
                name={person.name}
                tint={person.tint}
                avatar={person.avatar}
                size={30}
              />
            </View>
          ))}
        </View>
        <View style={styles.grow}>
          <Text
            style={styles.author}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {namesLine(entry.people)}
          </Text>
          <Text style={styles.when} maxFontSizeMultiplier={FontScaleCap.body}>
            {entry.when}
          </Text>
        </View>
      </Pressable>

      {/* When the app has something to say about the night, IT is the
          headline — a roast printed under the stats is a caption, and captions
          do not get screenshotted. The party's own title steps aside. */}
      <Text
        style={styles.title}
        numberOfLines={3}
        maxFontSizeMultiplier={FontScaleCap.heading}
      >
        {roast ? roast.line : entry.title}
      </Text>
      {/* The line under it says WHY. A roast with no basis is the app being
          rude at you; with the fact printed under it, it is the app being rude
          about a thing that actually happened, which is the whole joke. When
          there is no roast this is the night's own note. */}
      {roast || entry.note ? (
        <Text
          style={styles.description}
          numberOfLines={2}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {roast ? roast.basis : entry.note}
        </Text>
      ) : null}
      {/* The stat block: a heavy value with a muted label under it, no dividers —
          the grid spacing separates them. Order is set once in `StatGrid`. */}
      <View style={styles.statsRow}>
        <StatGrid
          columns={3}
          stats={[
            { label: "Piva", value: String(entry.beers) },
            // "Zatím" was a label nobody could parse under a number — zatím
            // WHAT. A running night says it is running; a finished one names the
            // thing being measured.
            { label: entry.live ? "Běží" : "Večer", value: entry.duration },
            { label: "Hospody", value: String(entry.stops.length) },
          ]}
        />
      </View>
      </Pressable>

      {/* The hero is whatever this night actually produced — photos, a game
          scoreboard, the tempo, a record, or a roast built from the numbers.
          The map is the fallback, not the default: it is the one output that
          says nothing about what the evening was like. */}
      <View style={styles.hero}>
        <PartyHighlight entry={entry} />
      </View>

      <View style={styles.cardFoot}>
        {/* Cheers, not a heart: you clink a glass, you do not like a night. And
            the mugs actually clink on tap — §10's one allowed pop. */}
        <CheersButton
          count={entry.cheers}
          cheered={Boolean(entry.cheered)}
          label={cs.friends.cheersCount(entry.cheers)}
        />
        <Pressable
          style={({ pressed }) => [
            styles.footAction,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Komentáře"
        >
          <MessageSquareIcon size={19} color={Colors.foam} />
          <Text style={styles.footText} allowFontScaling={false}>
            {entry.comments}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function FeedMockScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const published = usePublishedStore((s) => s.entries);

  return (
    // The ScrollView is the ROOT, not wrapped in a View: react-native-screens
    // binds the native large title to the screen's scrollable, and a wrapper
    // hides it — which is why the title sat pinned instead of scrolling away.
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + TAB_CHROME },
      ]}
      contentInsetAdjustmentBehavior="never"
    >
      {/* The brand, as CONTENT. It scrolls away with the first post instead of
          sitting on a bar forever — you know which app you opened. The spacer
          on the left is the width of the search button, so the mark is centred
          on the SCREEN rather than on what is left over beside the button. */}
      <View style={[styles.brandRow, { paddingTop: insets.top + Spacing.sm }]}>
        <View style={styles.brandSpacer} />
        <View style={styles.brand}>
          <Image
            source={require("../../assets/images/icon.png")}
            style={styles.mark}
          />
          <Text style={styles.wordmark} allowFontScaling={false}>
            Na pivo
          </Text>
        </View>
        <GlassIconButton
          size={40}
          accessibilityLabel="Hledat"
          onPress={() => router.push("/search" as Href)}
        >
          <SearchIcon size={19} color={Colors.amber} />
        </GlassIconButton>
      </View>

      {/* Yours first. A night you just published has to be the thing you land
          on, or "Zveřejnit" is a button that appears to do nothing. */}
      {[...published, ...MOCK_FEED].map((entry, index) => (
        <FeedCard key={entry.id} entry={entry} first={index === 0} />
      ))}

      <Text style={styles.mockNote} maxFontSizeMultiplier={FontScaleCap.body}>
        Design mock — data jsou napevno.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  content: { paddingHorizontal: MockLayout.screenPad },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: Spacing.md,
  },
  brandSpacer: { width: 40 },
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  mark: { width: 28, height: 28, borderRadius: 7 },
  // Baloo, the one place a display face belongs: a wordmark is a picture of the
  // name, not text. Everything else on the screen is the system font (§3).
  wordmark: { fontFamily: Fonts.numeral, fontSize: 19, color: Colors.foam },
  grow: { flex: 1 },
  pressed: { opacity: 0.6 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  screenTitle: { ...MockType.titleXL, color: Colors.foam },
  searchButton: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: "center",
    justifyContent: "center",
  },

  // — Nudge —
  // Not a card. Only posts get a surface; the nudge is a line of copy and a
  // button, and wrapping it panelled the first thing you see on the screen.
  nudge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.sm,
  },
  nudgeTitle: { fontWeight: "700", fontSize: 15, color: Colors.foam },
  nudgeBody: {
    fontWeight: "400",
    fontSize: 13,
    color: Colors.mutedText,
    marginTop: 2,
  },
  nudgeCta: {
    paddingHorizontal: Spacing.md,
    height: 34,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.amber,
  },
  nudgeCtaText: { fontWeight: "700", fontSize: 13, color: Colors.stout },

  // — Card —
  // No panel. A post wrapped in a card gives away the screen's width to a
  // border on both sides, and the feed is the one place that wants every pixel
  // for the content. Posts sit on the ground, separated by a hairline.
  // Posts are separated by a dark BAND, not a hairline. Strava does the same
  // and it is why its feed reads as a stack of separate things — a 1px line
  // between two panels of the same colour just makes one long panel with a
  // scratch in it. The band is darker than the ground, so it reads as the gap
  // between cards rather than a border on them.
  card: {
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    borderTopWidth: 10,
    borderTopColor: '#0F0A05',
    marginHorizontal: -Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  // No band above the first post — but it still needs air, or the byline sits
  // on the large title's baseline and reads as its subtitle.
  cardFirst: { borderTopWidth: 0, paddingTop: Spacing.xl },
  cardPressed: { opacity: 0.92 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  headAvatars: { flexDirection: "row", alignItems: "center" },

  // — Hero —
  hero: { marginTop: Spacing.md, marginHorizontal: -Spacing.md },
  photoStrip: {
    position: "absolute",
    left: Spacing.md,
    right: Spacing.md,
    top: 12,
    flexDirection: "row",
    gap: 6,
  },
  photo: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.14),
  },
  photoMore: { backgroundColor: MockColors.surfaceHigh },
  photoMoreText: { fontSize: 12, fontWeight: "700", color: Colors.foam },
  author: { fontWeight: "700", fontSize: 15, color: Colors.foam },
  when: {
    fontWeight: "400",
    fontSize: 12,
    color: Colors.mutedText,
    marginTop: 1,
  },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    height: 24,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.14),
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.amber,
  },
  liveText: {
    fontWeight: "800",
    fontSize: 10,
    letterSpacing: 0.8,
    color: Colors.amber,
  },

  description: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.mutedText,
    lineHeight: 19,
    marginTop: 4,
  },
  title: {
    fontWeight: "800",
    fontSize: 21,
    color: Colors.foam,
    marginTop: Spacing.md,
    letterSpacing: -0.3,
  },
  route: {
    fontWeight: "500",
    fontSize: 13,
    color: withAlpha(Colors.amber, 0.85),
    marginTop: 3,
  },

  // — Numbers —
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.12),
  },
  stat: { flex: 1 },
  statValue: {
    fontWeight: "800",
    fontSize: 22,
    color: Colors.foam,
    letterSpacing: -0.5,
    fontVariant: ["tabular-nums"],
  },
  statLabel: {
    fontWeight: "500",
    fontSize: 11,
    color: Colors.mutedText,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    backgroundColor: withAlpha(Colors.foam, 0.12),
    marginHorizontal: Spacing.sm,
  },

  // — People —
  peopleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: Spacing.md,
  },
  peopleOverlap: { marginLeft: -9 },
  // A 2pt ring in the card colour punches each face out of the one behind it.
  avatar: { alignItems: "center", justifyContent: "center", borderWidth: 2 },
  avatarText: { fontWeight: "700", color: Colors.stout },
  peopleLabel: {
    flex: 1,
    fontWeight: "400",
    fontSize: 12,
    color: Colors.mutedText,
    marginLeft: Spacing.sm,
  },

  // — Floor —
  cardFoot: {
    flexDirection: "row",
    gap: Spacing.lg,
    marginTop: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.12),
  },
  footAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 28,
  },
  // The floor carries the card's only two actions, so it reads at full
  // strength — muted grey made them look like metadata you cannot press.
  footText: { fontWeight: "600", fontSize: 15, color: Colors.foam },
  footTextOn: { color: Colors.amber },

  mockNote: {
    fontWeight: "400",
    fontSize: 12,
    color: Colors.mutedText,
    textAlign: "center",
    marginTop: Spacing.md,
  },
});
