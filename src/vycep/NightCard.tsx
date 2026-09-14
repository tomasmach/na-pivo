/**
 * NightCard — one published night in the Výčep feed. The layout leads with the
 * tally marks (the "čárky na tácku" signature), not with the author: the feed
 * celebrates nights, profiles are one tap away. Foreign nights carry the
 * RoundPill; my own night gets a quiet state row instead (nobody buys a round
 * for themselves) plus the unpublish/report affordances behind an ellipsis.
 */

import { memo, useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MenuIcon } from '@/components/shared/IconGlyph';
import type { PublishedNight } from '@/data/nightsClient';
import { useNightActions } from '@/feed/useNightActions';
import {
  beerCountLabel,
  intlLocale,
  shotCountLabel,
  softDrinkCountLabel,
  t,
  wineCountLabel,
} from '@/i18n';
import { formatEveningDate } from '@/myBeers/eveningModel';
import { Avatar } from '@/profile/Avatar';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { TallyMarks } from '@/vycep/TallyMarks';
import RoundPill from '@/vycep/RoundPill';

interface NightCardProps {
  night: PublishedNight;
  /** Fired after my own night is successfully unpublished. */
  onRemoved?: (nightClientId: string) => void;
  /** Fired after a server-confirmed reaction change. */
  onChanged?: () => void;
}

function authorLabel(night: PublishedNight): string {
  if (night.author.nickname) return `@${night.author.nickname}`;
  if (night.author.displayName) return night.author.displayName;
  return t.vycep.anonymousAuthor;
}

function NightCardBase({ night, onRemoved, onChanged }: NightCardProps) {
  const now = useMemo(() => new Date(), []);

  const metaLine = useMemo(
    () =>
      [
        night.pubNames.length > 0 ? night.pubNames.slice(0, 5).join(' → ') : null,
        night.durationMinutes != null && night.durationMinutes > 0
          ? t.vycep.nightDuration(
              Math.floor(night.durationMinutes / 60),
              night.durationMinutes % 60,
            )
          : null,
        night.wineCount > 0 ? wineCountLabel(night.wineCount) : null,
        night.shotCount > 0 ? shotCountLabel(night.shotCount) : null,
        night.beerCount === 0 && night.softDrinkCount > 0
          ? softDrinkCountLabel(night.softDrinkCount)
          : null,
      ]
        .filter((part): part is string => part !== null)
        .join(' · '),
    [
      night.beerCount,
      night.durationMinutes,
      night.pubNames,
      night.shotCount,
      night.softDrinkCount,
      night.wineCount,
    ],
  );

  const removed = useCallback(
    (value: PublishedNight) => {
      if (value.clientId) onRemoved?.(value.clientId);
    },
    [onRemoved],
  );
  const openNightActions = useNightActions(removed);
  const openMenu = useCallback(() => openNightActions(night), [night, openNightActions]);

  const owner = authorLabel(night);
  const dateCaption = [
    formatEveningDate(night.startedAt, now),
    night.isMine
      ? (
          night.visibility === 'public'
            ? t.vycep.visibilityChipWorld
            : t.vycep.visibilityChipFriends
        ).toLocaleLowerCase(intlLocale)
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  return (
    <View
      style={styles.card}
      accessibilityRole="text"
      accessibilityLabel={t.a11y.nightCard(owner)}
    >
      <View style={styles.header}>
        <Avatar
          uri={night.author.avatarUrl}
          nickname={night.author.nickname}
          displayName={night.author.displayName}
          size={36}
        />
        <View style={styles.headerText}>
          <Text style={styles.author} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
            {owner}
          </Text>
          <Text style={styles.date} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {dateCaption}
          </Text>
        </View>
        <Pressable
          onPress={openMenu}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t.a11y.nightMenu}
          style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}
        >
          <MenuIcon size={18} color={Colors.mutedText} />
        </Pressable>
      </View>

      <View style={styles.tallyBlock}>
        <TallyMarks count={night.beerCount} color={Colors.amber} markHeight={24} />
        <Text style={styles.tallyLabel} maxFontSizeMultiplier={FontScaleCap.heading}>
          {beerCountLabel(night.beerCount)}
        </Text>
      </View>

      {metaLine ? (
        <Text style={styles.metaText} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
          {metaLine}
        </Text>
      ) : null}

      <View style={styles.footer}>
        {night.isMine ? (
          night.rounds > 0 ? (
            <Text style={styles.mineRoundsText} maxFontSizeMultiplier={FontScaleCap.body}>
              {t.vycep.roundCount(night.rounds)}
            </Text>
          ) : (
            <View />
          )
        ) : (
          <RoundPill
            nightId={night.id}
            count={night.rounds}
            mine={night.myRound}
            ownerName={owner}
            onChanged={onChanged}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.07),
    padding: 20,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm + 2,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  author: {
    fontWeight: '700',
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
  },
  date: {
    marginTop: 1,
    fontWeight: '500',
    fontSize: 12,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  menuButton: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  tallyBlock: {
    gap: 4,
  },
  tallyLabel: {
    fontWeight: '800',
    fontSize: 22,
    color: Colors.foam,
    includeFontPadding: false,
  },
  metaText: {
    fontWeight: '500',
    fontSize: 13,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  mineRoundsText: {
    fontWeight: '600',
    fontSize: 13,
    color: Colors.amber,
    includeFontPadding: false,
  },
});

export const NightCard = memo(NightCardBase);
