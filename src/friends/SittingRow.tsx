/**
 * One sitting in the automatic Výčep feed: one person, one evening, one place.
 *
 * The row the feedback described — "Jarek včera v Restauraci Cisterna vypil
 * 6 piv Pilsner Urquell" — minus the verb, which Czech cannot conjugate without
 * guessing a gender (see partaFeedCopy for the full reasoning). What is left is
 * the same three facts in the order they get read: who, what, where and when.
 *
 * Deliberately not a card: the feed is a stream of these, and a bordered box per
 * evening turns a night's history into a wall of frames. The stack lives in one
 * card and the rows are separated by hairlines, like every other list here.
 */

import React, { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { BeerTagChips } from '@/components/shared/BeerTagChips';
import type { BeerCheckIn } from '@/data/beerCheckinsClient';
import type { PartaFeedSitting } from '@/data/partaFeedClient';
import { cs } from '@/i18n/cs';
import { Avatar } from '@/profile/Avatar';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Spacing } from '@/theme/layout';

import CheersPill from './CheersPill';
import HairlineRow from './HairlineRow';
import { friendDisplayName } from './FriendMini';
import { dayLabel, sittingDetail, sittingHeadline, sittingPlace } from './partaFeedCopy';

export interface SittingRowProps {
  sitting: PartaFeedSitting;
  /**
   * Anything anyone wrote about the beers in this sitting. The loudest one
   * (the first) gets its rating, note and tags shown inline — that is where the
   * old standalone ratings feed went, and it reads better here than as its own
   * row two evenings away from the beer it is about.
   */
  checkIns?: BeerCheckIn[];
  first?: boolean;
  /** Long-press opens the block/report menu, same as every other friend row. */
  onLongPress?: (sitting: PartaFeedSitting) => void;
  /** Fired after a cheers so the screen can reconcile the count. */
  onChanged?: () => void;
}

function SittingRowComponent({
  sitting,
  checkIns,
  first,
  onLongPress,
  onChanged,
}: SittingRowProps) {
  const router = useRouter();
  const { account } = sitting;

  const open = useCallback(() => {
    if (sitting.mine) router.push('/profile' as Href);
    else if (account.id) router.push(`/parta/${account.id}` as Href);
  }, [account.id, router, sitting.mine]);

  const handleLongPress = useCallback(() => {
    if (!sitting.mine) onLongPress?.(sitting);
  }, [onLongPress, sitting]);

  const name = sitting.mine ? cs.friends.presenceMe : friendDisplayName(account);
  const when = dayLabel(sitting.endedAt);
  const headline = sittingHeadline(sitting);
  const detail = sittingDetail(sitting);
  const where = [sittingPlace(sitting), when].filter(Boolean).join(' · ');
  const rated = checkIns?.find((item) => item.rating != null || item.note || item.tags.length > 0);
  const reactable = checkIns?.[0];

  return (
    <HairlineRow first={first}>
      <View style={styles.row}>
        <Pressable
          onPress={open}
          onLongPress={handleLongPress}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.sittingRow(name, headline, sittingPlace(sitting), when)}
          style={({ pressed }) => [styles.identity, pressed && styles.dim]}
        >
          <Avatar
            uri={account.avatarUrl}
            nickname={account.nickname}
            displayName={account.displayName}
            size={34}
          />
          <View style={styles.textCol}>
            <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
              {name}
            </Text>
            <Text
              style={styles.headline}
              numberOfLines={2}
              maxFontSizeMultiplier={FontScaleCap.heading}
            >
              {headline}
            </Text>
            {detail ? (
              <Text
                style={styles.detail}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {detail}
              </Text>
            ) : null}
            <Text style={styles.where} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
              {where}
            </Text>

            {rated?.rating != null ? (
              <Text style={styles.rating} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.friends.sittingRating(rated.rating, rated.beerName)}
              </Text>
            ) : null}
            {rated?.note ? (
              <Text style={styles.note} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
                {rated.note}
              </Text>
            ) : null}
            {rated && rated.tags.length > 0 ? (
              <View style={styles.tags}>
                <BeerTagChips tags={rated.tags} />
              </View>
            ) : null}
          </View>
        </Pressable>

        {reactable ? (
          <CheersPill
            activityId={reactable.id}
            target="beerCheckIn"
            count={reactable.reactions.cheers}
            mine={reactable.myReaction === 'cheers'}
            compact
            ownerName={name}
            onChanged={onChanged}
          />
        ) : null}
      </View>
    </HairlineRow>
  );
}

export const SittingRow = memo(SittingRowComponent);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    minHeight: HitArea.min,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  // The count and the beer are what the row is for; everything else is context.
  headline: {
    marginTop: 1,
    fontWeight: '700',
    fontSize: 16,
    lineHeight: 21,
    color: Colors.foam,
    includeFontPadding: false,
  },
  detail: {
    marginTop: 2,
    fontWeight: '500',
    fontSize: 13,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  where: {
    marginTop: 2,
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  rating: {
    marginTop: 6,
    fontWeight: '700',
    fontSize: 13,
    color: Colors.amber,
    includeFontPadding: false,
  },
  note: {
    marginTop: 2,
    fontWeight: '500',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.foam,
    includeFontPadding: false,
  },
  tags: {
    marginTop: 8,
  },
  dim: {
    opacity: 0.6,
  },
});

export default SittingRow;
