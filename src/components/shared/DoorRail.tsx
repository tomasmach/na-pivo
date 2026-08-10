/**
 * DoorRail — the "row of doors in a card footer" recipe, in one place.
 *
 * The counter card has had this rail since the community half of the product
 * was buried in a "…" sheet (see SocialRail). The Parta screen needed the same
 * treatment for the same reason, so the presentation lives here and each screen
 * only decides which doors it shows.
 *
 * Rules it carries (docs/DESIGN.md §5.5): equal columns, one 34pt amber
 * medallion each, separated by light and never by a frame, and it navigates —
 * it never counts, mutates or competes with the screen's one amber button.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { type IconProps } from '@/components/shared/IconGlyph';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius } from '@/theme/layout';

/** Above this the badge stops being a count and becomes "a lot". */
const BADGE_CAP = 9;

export interface DoorRailTile {
  key: string;
  label: string;
  a11yLabel: string;
  Icon: React.ComponentType<IconProps>;
  onPress: () => void;
  /** Live count shown on the medallion; 0 or undefined draws no badge. */
  badge?: number;
}

export function DoorRail({ tiles }: { tiles: DoorRailTile[] }) {
  if (tiles.length === 0) return null;

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
  // frame. Boxed tiles inside a card would be frame-on-frame (§14.10).
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
    fontWeight: '800',
    fontSize: 10,
    lineHeight: 13,
    color: Colors.stout,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  label: {
    fontWeight: '700',
    fontSize: 13,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
});
