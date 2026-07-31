/**
 * DESIGN MOCK — the profile, rebuilt as Strava's "You".
 *
 * The Tácek profile stacked a hero card, a level ring, a four-up stat strip, a
 * nudge, a primary CTA and a secondary button — six competing blocks before you
 * reached anything you did. This is the same information in the order Strava
 * uses: who you are, your numbers, then your activities.
 *
 * What went, and why:
 *   level ring       a locked padlock is a screen advertising its own emptiness
 *   "Založ si profil" a CTA is only earned when there is no account (below)
 *   "Pivní fotky"    a button to a place; the photos belong IN the list
 *   nudge strip      one more thing shouting on a screen about your history
 *
 * The only CTA left is sign-in, and only when signed out — that is the one
 * moment the screen genuinely has something to ask for.
 */

import React, { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TrophyIcon } from '@/components/shared/IconGlyph';
import { FeedCard } from '@/feed/FeedMockScreen';
import { MOCK_FEED } from '@/feed/mockFeed';
import { StatGrid } from '@/mocks/StatGrid';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { useAccountStore } from '@/stores/accountStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

const AVATAR = 'https://i.pravatar.cc/240?img=57';

const TABS = ['Statistiky', 'Aktivita'] as const;

const BADGES = [
  { title: 'Sto piv', earned: true },
  { title: 'Deset hospod', earned: true },
  { title: 'Tři čtvrtky', earned: true },
  { title: 'První Oktoberfest', earned: false },
  { title: 'Padesát večerů', earned: false },
  { title: 'Mapér', earned: false },
];

export default function ProfileMockScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Statistiky');
  const session = useAccountStore((s) => s.session);
  const profile = useAccountStore((s) => s.profile);
  const signedIn = Boolean(session);

  const handle = profile?.nickname ? `@${profile.nickname}` : '@sudík';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      contentInsetAdjustmentBehavior="automatic"
    >
      {/* Who you are: a face and a handle. Nothing else competes up here. */}
      <View style={styles.identity}>
        <Image source={{ uri: AVATAR }} style={styles.avatar} />
        <View style={styles.grow}>
          <Text style={styles.handle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
            {handle}
          </Text>
          <Text style={styles.since} maxFontSizeMultiplier={FontScaleCap.body}>
            {signedIn ? 'Pije s Na pivo od června' : 'Zatím bez účtu'}
          </Text>
        </View>
      </View>

      {/* Sign-in is the one thing this screen may ask for, and only when there
          is genuinely nothing to ask twice. */}
      {signedIn ? null : (
        <Pressable
          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Založit profil"
        >
          <Text style={styles.ctaText} maxFontSizeMultiplier={FontScaleCap.heading}>
            Založ si profil
          </Text>
        </Pressable>
      )}

      {/* Two jobs, two tabs. Statistiky is the default because a profile is
          first a place you check where you stand; Aktivita is the same posts the
          feed shows, so a night looks identical wherever you meet it. */}
      <View style={styles.tabs}>
        {TABS.map((option) => (
          <Pressable
            key={option}
            onPress={() => setTab(option)}
            style={styles.tab}
            accessibilityRole="button"
            accessibilityState={{ selected: option === tab }}
            accessibilityLabel={option}
          >
            <Text
              style={[styles.tabText, option === tab && styles.tabTextOn]}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {option}
            </Text>
            <View style={[styles.tabRule, option === tab && styles.tabRuleOn]} />
          </Pressable>
        ))}
      </View>

      {tab === 'Statistiky' ? (
        <>
          <View style={styles.stats}>
            <StatGrid
              columns={2}
              stats={[
                { label: 'Piv celkem', value: '312' },
                { label: 'Večerů', value: '54' },
                { label: 'Hospod', value: '38' },
                { label: 'Nejdelší série', value: '3 týdny' },
              ]}
            />
          </View>

          <Text style={styles.section} maxFontSizeMultiplier={FontScaleCap.heading}>
            Odznaky
          </Text>
          <View style={styles.badges}>
            {BADGES.map((badge) => (
              <View key={badge.title} style={[styles.badge, !badge.earned && styles.badgeLocked]}>
                <View style={[styles.badgeDisc, !badge.earned && styles.badgeDiscLocked]}>
                  <TrophyIcon size={18} color={badge.earned ? Colors.stout : Colors.mutedText} />
                </View>
                <Text
                  style={[styles.badgeTitle, !badge.earned && styles.badgeTitleLocked]}
                  numberOfLines={2}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {badge.title}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : (
        MOCK_FEED.map((entry) => <FeedCard key={entry.id} entry={entry} />)
      )}

      <Text style={styles.mockNote} maxFontSizeMultiplier={FontScaleCap.body}>
        Design mock — data jsou napevno.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  content: { paddingHorizontal: MockLayout.screenPad },
  grow: { flex: 1 },
  pressed: { opacity: 0.65 },

  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingTop: Spacing.sm },
  avatar: { width: 68, height: 68, borderRadius: 34 },
  handle: { fontSize: 24, fontWeight: '800', color: Colors.foam, letterSpacing: -0.4 },
  since: { fontSize: 14, fontWeight: '400', color: Colors.mutedText, marginTop: 2 },

  cta: {
    height: MockLayout.buttonHeight,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
    marginTop: Spacing.lg,
  },
  ctaText: { ...MockType.buttonLabel, color: Colors.stout },

  stats: {
    marginTop: MockLayout.sectionGap,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.12),
  },

  section: { ...MockType.titleS, color: Colors.foam, marginTop: MockLayout.sectionGap },

  tabs: { flexDirection: 'row', marginTop: MockLayout.sectionGap },
  tab: { flex: 1, alignItems: 'center', gap: 6 },
  tabText: { fontSize: 17, fontWeight: '600', color: Colors.mutedText },
  tabTextOn: { color: Colors.foam, fontWeight: '700' },
  tabRule: { height: 2, alignSelf: 'stretch', backgroundColor: 'transparent', borderRadius: 1 },
  tabRuleOn: { backgroundColor: Colors.amber },

  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginTop: Spacing.sm },
  badge: { width: '28%', alignItems: 'center', gap: 6 },
  badgeLocked: { opacity: 0.45 },
  badgeDisc: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  badgeDiscLocked: { backgroundColor: withAlpha(Colors.foam, 0.08) },
  badgeTitle: { fontSize: 12, fontWeight: '600', color: Colors.foam, textAlign: 'center' },
  badgeTitleLocked: { color: Colors.mutedText },


  mockNote: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.mutedText,
    textAlign: 'center',
    marginTop: MockLayout.sectionGap,
  },
});
