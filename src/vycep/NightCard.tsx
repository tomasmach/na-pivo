/**
 * NightCard — one published night in the Výčep feed. The layout leads with the
 * tally marks (the "čárky na tácku" signature), not with the author: the feed
 * celebrates nights, profiles are one tap away. Foreign nights carry the
 * RoundPill; my own night gets a quiet state row instead (nobody buys a round
 * for themselves) plus the unpublish/report affordances behind an ellipsis.
 */

import { memo, useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { showAppDialog } from '@/components/shared/AppDialog';
import { EllipsisIcon } from '@/components/shared/IconGlyph';
import { reportProfileContent } from '@/data/auth';
import {
  isRetriableNightError,
  unpublishNight,
  type PublishedNight,
} from '@/data/nightsClient';
import { enqueueNightOp } from '@/data/nightsQueue';
import { cs } from '@/i18n/cs';
import { beerCountLabel, shotCountLabel, softDrinkCountLabel, wineCountLabel } from '@/i18n/plural';
import { formatEveningDate } from '@/myBeers/eveningModel';
import { Avatar } from '@/profile/Avatar';
import { useToastStore } from '@/stores/toastStore';
import { useVycepStore } from '@/stores/vycepStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
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
  return cs.vycep.anonymousAuthor;
}

function NightCardBase({ night, onRemoved, onChanged }: NightCardProps) {
  const showToast = useToastStore((s) => s.show);
  const markUnpublished = useVycepStore((s) => s.markUnpublished);
  const now = useMemo(() => new Date(), []);

  const metaLine = useMemo(
    () =>
      [
        night.pubNames.length > 0 ? night.pubNames.slice(0, 5).join(' → ') : null,
        night.durationMinutes != null && night.durationMinutes > 0
          ? cs.vycep.nightDuration(
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

  const handleUnpublish = useCallback(() => {
    showAppDialog({
      title: cs.vycep.unpublishCta,
      message: cs.vycep.publishBody,
      buttons: [
        { text: cs.common.cancel, style: 'cancel' },
        {
          text: cs.vycep.unpublishCta,
          style: 'destructive',
          onPress: () => {
            const clientId = night.clientId;
            if (!clientId) return;
            void unpublishNight(clientId).then((res) => {
              if (!res.ok) {
                if (isRetriableNightError(res)) {
                  // Offline / transient: keep the removal intent in the durable
                  // queue so the night really comes down once we're back online.
                  void enqueueNightOp({ op: 'unpublish', clientId });
                } else {
                  showToast(cs.vycep.roundErrorToast);
                  return;
                }
              }
              markUnpublished(clientId);
              showToast(cs.vycep.unpublishedToast);
              onRemoved?.(clientId);
            });
          },
        },
      ],
    });
  }, [markUnpublished, night.clientId, onRemoved, showToast]);

  const handleReport = useCallback(() => {
    showAppDialog({
      title: cs.vycep.reportTitle,
      message: cs.vycep.reportBody,
      buttons: [
        { text: cs.common.cancel, style: 'cancel' },
        {
          text: cs.vycep.reportConfirm,
          style: 'destructive',
          onPress: () => {
            void reportProfileContent({
              targetAccountId: night.author.id,
              reason: 'spam',
              nightId: night.id,
            }).then((res) => {
              showToast(res.ok ? cs.vycep.reportSentToast : cs.vycep.reportErrorToast);
            });
          },
        },
      ],
    });
  }, [night.author.id, night.id, showToast]);

  const openMenu = useCallback(() => {
    if (night.isMine) handleUnpublish();
    else handleReport();
  }, [handleReport, handleUnpublish, night.isMine]);

  const owner = authorLabel(night);
  const dateCaption = [
    formatEveningDate(night.startedAt, now),
    night.isMine
      ? (
          night.visibility === 'public'
            ? cs.vycep.visibilityChipWorld
            : cs.vycep.visibilityChipFriends
        ).toLocaleLowerCase('cs-CZ')
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  return (
    <View
      style={styles.card}
      accessibilityRole="text"
      accessibilityLabel={cs.a11y.nightCard(owner)}
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
          accessibilityLabel={cs.a11y.nightMenu}
          style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}
        >
          <EllipsisIcon size={18} color={Colors.mutedText} />
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
              {cs.vycep.roundCount(night.rounds)}
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
    fontFamily: Fonts.display.bold,
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
  },
  date: {
    marginTop: 1,
    fontFamily: Fonts.ui.medium,
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
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
    includeFontPadding: false,
  },
  metaText: {
    fontFamily: Fonts.ui.medium,
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
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.amber,
    includeFontPadding: false,
  },
});

export const NightCard = memo(NightCardBase);
