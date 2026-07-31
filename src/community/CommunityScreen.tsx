/**
 * Community — the 3.0 tab that collects everything the whole pub does together
 * (§17.1): žebříčky, komunitní akce, foto soutěž and contributing pub data.
 *
 * It is a hub, not a fifth feed. Each of these already has a finished screen as
 * a pushed route; before 3.0 they were reachable only from the bottom of other
 * screens, which is exactly the "okrajová akce schovaná v cizí obrazovce"
 * §0.4 warns about. The hub gives them one address.
 *
 * Deliberately plain: hairline rows on the bare stout ground (§5 keeps cards for
 * hero content), no illustration, and — per §6.1 — not a single amber surface,
 * because every row here is equal and none of them is THE action of the screen.
 * The amber medallions under the glyphs are the 12 % row idiom from §2.2.
 */

import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import HairlineRow from '@/friends/HairlineRow';
import {
  ChevronRightIcon,
  ImagesIcon,
  MapPinPlusIcon,
  SparklesIcon,
  TrophyIcon,
} from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

interface HubEntry {
  key: string;
  Icon: typeof TrophyIcon;
  title: string;
  subtitle: string;
  href: Href;
}

const ENTRIES: readonly HubEntry[] = [
  {
    key: 'leaderboards',
    Icon: TrophyIcon,
    title: cs.community.leaderboardsTitle,
    subtitle: cs.community.leaderboardsSubtitle,
    href: '/leaderboards' as Href,
  },
  {
    key: 'events',
    Icon: SparklesIcon,
    title: cs.community.eventsTitle,
    subtitle: cs.community.eventsSubtitle,
    href: '/community-events' as Href,
  },
  {
    key: 'photoContest',
    Icon: ImagesIcon,
    title: cs.community.photoContestTitle,
    subtitle: cs.community.photoContestSubtitle,
    href: '/photo-contest' as Href,
  },
  {
    key: 'contribute',
    Icon: MapPinPlusIcon,
    title: cs.community.contributeTitle,
    subtitle: cs.community.contributeSubtitle,
    href: '/contribute' as Href,
  },
] as const;

function HubRow({ entry, first }: { entry: HubEntry; first: boolean }) {
  const router = useRouter();
  const { Icon } = entry;
  const onPress = useCallback(() => router.push(entry.href), [router, entry.href]);

  return (
    <HairlineRow onPress={onPress} first={first}>
      <View style={styles.row}>
        <View style={styles.medallion}>
          <Icon size={20} color={Colors.amber} />
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} maxFontSizeMultiplier={FontScaleCap.body}>
            {entry.title}
          </Text>
          <Text
            style={styles.rowSubtitle}
            numberOfLines={2}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {entry.subtitle}
          </Text>
        </View>
        <ChevronRightIcon size={18} color={Colors.mutedText} />
      </View>
    </HairlineRow>
  );
}

export default function CommunityScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.md, paddingBottom: insets.bottom + Spacing.xl },
        ]}
      >
        <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
          {cs.community.title}
        </Text>
        <Text style={styles.lede} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.community.lede}
        </Text>

        <View style={styles.list}>
          {ENTRIES.map((entry, index) => (
            <HubRow key={entry.key} entry={entry} first={index === 0} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.stout,
  },
  content: {
    paddingHorizontal: Spacing.md,
  },
  title: {
    fontFamily: Fonts.display.bold,
    fontSize: 28,
    color: Colors.foam,
  },
  lede: {
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.mutedText,
    marginTop: Spacing.xs,
    marginBottom: Spacing.lg,
  },
  list: {
    // Rows carry their own hairlines; the group needs no border of its own
    // (§14.10 — no frame around a frame).
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  medallion: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontFamily: Fonts.display.bold,
    fontSize: 16,
    color: Colors.foam,
  },
  rowSubtitle: {
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
  },
});
