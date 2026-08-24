/**
 * PartaPlans — the other way to spend an evening with the party, on the surface
 * instead of behind the "…" door.
 *
 * "Cinknout partě" (the screen's amber button) covers "I'm going for one", and
 * sitting together in a pub needs no button at all — the counter already tells
 * the party where everyone is. What is left is the one evening the app cannot
 * infer, because it happens in somebody's living room and nobody checks into a
 * kitchen: "Pivo u někoho". It sits at the tail of the stream, so you scroll
 * into it instead of having to know it exists.
 *
 * A hairline row in a stream card, same anatomy as every other row here: amber
 * medallion, name, one line of what it actually is. Navigation only — the row
 * counts nothing, so the one-action rule stands.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import {
  ChevronRightIcon,
  HouseIcon,
  type IconProps,
} from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

import HairlineRow from './HairlineRow';

interface PlanRow {
  key: string;
  title: string;
  body: string;
  Icon: React.ComponentType<IconProps>;
  onPress: () => void;
}

export function PartaPlans() {
  const router = useRouter();

  const rows: PlanRow[] = [
    {
      key: 'home-party',
      title: cs.friends.planHomePartyTitle,
      body: cs.friends.planHomePartyBody,
      Icon: HouseIcon,
      onPress: () => router.push('/community-events' as Href),
    },
  ];

  return (
    <View>
      <Text style={styles.header} maxFontSizeMultiplier={FontScaleCap.body}>
        {cs.friends.planHeader}
      </Text>
      <View style={styles.card}>
        {rows.map((row, index) => (
          <HairlineRow key={row.key} onPress={row.onPress} first={index === 0}>
            <View style={styles.row}>
              <View style={styles.medallion}>
                <row.Icon size={19} color={Colors.amber} />
              </View>
              <View style={styles.textCol}>
                <Text
                  style={styles.title}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.heading}
                >
                  {row.title}
                </Text>
                <Text
                  style={styles.body}
                  numberOfLines={2}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {row.body}
                </Text>
              </View>
              <ChevronRightIcon size={18} color={Colors.mutedText} />
            </View>
          </HairlineRow>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Same quiet label as "Co se děje" above it: a name for the group, not a
  // headline competing with the card.
  header: {
    marginTop: 24,
    marginBottom: 8,
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  card: {
    overflow: 'hidden',
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.07),
    paddingHorizontal: 16,
  },
  row: {
    minHeight: HitArea.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  medallion: {
    width: 38,
    height: 38,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontWeight: '700',
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
  },
  body: {
    marginTop: 1,
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
});
