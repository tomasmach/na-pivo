/**
 * BeerTagChips — tiny, muted, read-only verdict chips shown wherever a beer
 * check-in is displayed (beer-detail rows + hero, the party feed). Purely
 * presentational; the interactive toggle chips live in BeerCheckInSheet.
 *
 * `counts` turns a chip into "Má říz ×7" (used by the detail hero summary);
 * omit it for a bare label. Renders nothing when there is nothing to show.
 */

import { StyleSheet, Text, View } from 'react-native';

import { BEER_TAGS, type BeerTag } from '@/data/beerCheckinsClient';
import { cs } from '@/i18n/cs';
import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

interface BeerTagChipsProps {
  tags: BeerTag[];
  counts?: Partial<Record<BeerTag, number>>;
  /** Cap how many chips render (spec keeps feed/detail rows scannable). */
  max?: number;
}

/** Enum-order index for stable, count-desc sorting. */
const TAG_ORDER = new Map<BeerTag, number>(BEER_TAGS.map((tag, i) => [tag, i]));

export function BeerTagChips({ tags, counts, max = 3 }: BeerTagChipsProps) {
  const shown = tags.slice(0, max);
  if (shown.length === 0) return null;
  return (
    <View style={styles.row}>
      {shown.map((tag) => {
        const count = counts?.[tag];
        const label = count ? `${cs.beerCheckins.tags[tag]} ×${count}` : cs.beerCheckins.tags[tag];
        return (
          <View key={tag} style={styles.chip}>
            <Text style={styles.text} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** Sort a `{tag: count}` map into tags by count desc, ties by enum order. */
export function sortTagsByCount(counts: Partial<Record<BeerTag, number>>): BeerTag[] {
  return (Object.keys(counts) as BeerTag[]).sort((a, b) => {
    const diff = (counts[b] ?? 0) - (counts[a] ?? 0);
    if (diff !== 0) return diff;
    return (TAG_ORDER.get(a) ?? 0) - (TAG_ORDER.get(b) ?? 0);
  });
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  chip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
  },
  text: {
    fontFamily: Fonts.ui.medium,
    fontSize: 11,
    color: Colors.foamMuted,
  },
});
