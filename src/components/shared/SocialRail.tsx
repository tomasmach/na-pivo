/**
 * SocialRail — the three social surfaces, permanently on the main screen.
 *
 * Parta, the Pivaři board and the FotoPivař contest all used to live behind a
 * "…" sheet, which meant the community half of the product was invisible unless
 * you went looking for it. This rail sits in the counter card, in the room the
 * drawn mug used to take: three equal doors, one amber medallion each, no second
 * filled amber surface competing with the screen's button.
 *
 * It carries exactly one live fact, and only because it costs nothing: the
 * friends dashboard snapshot is already on disk, so the badge on Parta can say
 * how many of them are sitting in a pub right now without a request. Everything
 * else is a label, because a made-up number is worse than no number.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import {
  ImagesIcon,
  TrophyIcon,
  UsersIcon,
  type IconProps,
} from '@/components/shared/IconGlyph';
import { loadFriendsDashboardSnapshot } from '@/data/friendsSnapshot';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius } from '@/theme/layout';

/** Above this the badge stops being a count and becomes "a lot". */
const BADGE_CAP = 9;

interface RailTile {
  key: string;
  label: string;
  a11yLabel: string;
  Icon: React.ComponentType<IconProps>;
  onPress: () => void;
  /** Live count shown on the medallion; 0 draws no badge. */
  badge?: number;
}

export function SocialRail() {
  const router = useRouter();
  // Friends currently sitting in a pub, straight from the cached dashboard.
  const [liveFriends, setLiveFriends] = useState(0);

  useEffect(() => {
    let alive = true;
    void loadFriendsDashboardSnapshot().then((snapshot) => {
      if (!alive || !snapshot) return;
      setLiveFriends(snapshot.dashboard.activeFriends.length);
    });
    return () => {
      alive = false;
    };
  }, []);

  const tiles: RailTile[] = [
    {
      key: 'parta',
      label: cs.socialRail.parta,
      a11yLabel: cs.a11y.socialRailParta,
      Icon: UsersIcon,
      onPress: () => router.navigate('/friends' as Href),
      badge: liveFriends,
    },
    {
      key: 'pivari',
      label: cs.socialRail.pivari,
      a11yLabel: cs.a11y.socialRailPivari,
      Icon: TrophyIcon,
      onPress: () =>
        router.push({ pathname: '/leaderboards', params: { source: 'counter' } } as Href),
    },
    {
      key: 'foto',
      label: cs.socialRail.photoContest,
      a11yLabel: cs.a11y.photoContestLink,
      Icon: ImagesIcon,
      onPress: () => router.push('/photo-contest' as Href),
    },
  ];

  return (
    <View style={styles.rail}>
      {tiles.map((tile, index) => (
        <React.Fragment key={tile.key}>
          {index > 0 ? <View style={styles.divider} /> : null}
          <Pressable
            onPress={tile.onPress}
            style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={tile.a11yLabel}
          >
            <View style={styles.medallion}>
              <tile.Icon size={19} color={Colors.amber} />
              {tile.badge ? (
                <View style={styles.badge}>
                  <Text
                    style={styles.badgeText}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.display}
                  >
                    {tile.badge > BADGE_CAP ? `${BADGE_CAP}+` : tile.badge}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text
              style={styles.label}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {tile.label}
            </Text>
          </Pressable>
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Hairline above, hairlines between: the rail is separated by light, not by a
  // frame. Three boxes inside a card would be frame-on-frame (§14.10).
  rail: {
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  tile: {
    flex: 1,
    minHeight: HitArea.min + 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  pressed: {
    opacity: 0.6,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'center',
    height: 28,
    backgroundColor: withAlpha(Colors.foam, 0.1),
  },
  medallion: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  // Sits on the medallion's shoulder. Amber fill is allowed here for the same
  // reason the nudge strip's confirm pill is: it is tiny, and it only exists
  // while it has something to say.
  badge: {
    position: 'absolute',
    top: -3,
    right: -5,
    minWidth: 17,
    height: 17,
    borderRadius: Radius.pill,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
    borderWidth: 1.5,
    borderColor: Colors.stout2,
  },
  badgeText: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 10,
    lineHeight: 13,
    color: Colors.stout,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  label: {
    fontFamily: Fonts.display.bold,
    fontSize: 13,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
});
