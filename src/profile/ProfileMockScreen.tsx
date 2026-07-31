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

import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StatGrid } from '@/mocks/StatGrid';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { useAccountStore } from '@/stores/accountStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

const AVATAR = 'https://i.pravatar.cc/240?img=57';

/** Recent nights. Real data comes from PartyEvening / PublishedNight. */
const NIGHTS = [
  { id: 'n1', title: 'Čtvrteční jízda', when: 'včera', beers: 27, pubs: 3, duration: '6h 42m' },
  { id: 'n2', title: 'Rychlovka po práci', when: 'út 28. 7.', beers: 4, pubs: 1, duration: '48m' },
  { id: 'n3', title: 'Po zápase', when: 'so 25. 7.', beers: 11, pubs: 2, duration: '4h 10m' },
  { id: 'n4', title: 'Objevovačka na Žižkově', when: 'čt 23. 7.', beers: 9, pubs: 2, duration: '3h 05m' },
];

export default function ProfileMockScreen() {
  const insets = useSafeAreaInsets();
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

      <View style={styles.stats}>
        <StatGrid
          columns={4}
          compact
          stats={[
            { label: 'Piv', value: '312' },
            { label: 'Večerů', value: '54' },
            { label: 'Hospod', value: '38' },
            { label: 'Série', value: '3 t' },
          ]}
        />
      </View>

      <Text style={styles.section} maxFontSizeMultiplier={FontScaleCap.heading}>
        Večery
      </Text>

      {NIGHTS.map((night, index) => (
        <Pressable
          key={night.id}
          style={({ pressed }) => [
            styles.night,
            index === 0 && styles.nightFirst,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={night.title}
        >
          <View style={styles.grow}>
            <Text style={styles.nightWhen} maxFontSizeMultiplier={FontScaleCap.body}>
              {night.when}
            </Text>
            <Text
              style={styles.nightTitle}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {night.title}
            </Text>
            <Text style={styles.nightMeta} maxFontSizeMultiplier={FontScaleCap.body}>
              {night.beers} piv · {night.duration} · {night.pubs} hospody
            </Text>
          </View>
        </Pressable>
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

  night: {
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  nightFirst: { borderTopWidth: 0 },
  nightWhen: { fontSize: 12, fontWeight: '500', color: Colors.mutedText },
  nightTitle: { fontSize: 18, fontWeight: '700', color: Colors.foam, marginTop: 1 },
  nightMeta: { fontSize: 13, fontWeight: '400', color: Colors.mutedText, marginTop: 2 },

  mockNote: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.mutedText,
    textAlign: 'center',
    marginTop: MockLayout.sectionGap,
  },
});
