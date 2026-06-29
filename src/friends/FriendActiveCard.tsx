/**
 * FriendActiveCard — a friend's live "jsem na pivu" card in TEĎ NA PIVU (spec §4).
 *
 * The decision surface: the only place on the screen where you can *act* on
 * tonight. A warm-bordered card (cooler than the my-card's border, and crucially
 * with NO glow — the lone amberGlow belongs to MyActivityCard alone) holding a
 * friend identity header, the pub, the signature `RsvpControl`, and the
 * social-proof `GoingRoster`.
 *
 * Memoized: a card re-renders only when its `activity` (or `onResponded`)
 * identity changes, so a pulsing LiveDot or a sibling card's RSVP never re-runs
 * this one. The relative "před N min" header time is driven off the single shared
 * 1-minute ticker (`useNowTick`), not a per-card timer.
 */

import { memo, useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MapPinIcon } from '@/components/shared/IconGlyph';
import type { FriendProfile, FriendPubActivity } from '@/data/friendsClient';
import { Avatar } from '@/profile/Avatar';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import GoingRoster from './GoingRoster';
import LiveDot from './LiveDot';
import RsvpControl from './RsvpControl';
import { formatRelative, useNowTick } from './useNowTick';

interface FriendActiveCardProps {
  activity: FriendPubActivity;
  /** Fired after a successful RSVP/clear — the parent should reload the dashboard. */
  onResponded: (activity: FriendPubActivity) => void;
}

/** FriendMini stays in FriendsScreen; mirror its name resolution locally. */
function nameOf(profile: FriendProfile | null | undefined): string {
  if (!profile) return 'Kamarád';
  if (profile.nickname) return `@${profile.nickname}`;
  return profile.displayName || 'Kamarád';
}

function FriendActiveCard({ activity, onResponded }: FriendActiveCardProps) {
  const now = useNowTick();
  const { account, responses } = activity;

  // RsvpControl resolves to a "reload now" signal (no fresh activity); bubble the
  // current activity up so the parent reloads the dashboard and reconciles the
  // roster from server truth.
  const handleResponded = useCallback(() => {
    onResponded(activity);
  }, [onResponded, activity]);

  const relative = formatRelative(activity.startedAt, now);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        {/* FriendMini-equivalent (built inline; FriendMini stays in FriendsScreen). */}
        <View style={styles.identity}>
          <Avatar
            uri={account.avatarUrl}
            nickname={account.nickname}
            displayName={account.displayName}
            size={34}
          />
          <Text
            style={styles.identityName}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {nameOf(account)}
          </Text>
        </View>

        <View style={styles.headerMeta}>
          <LiveDot />
          {relative ? (
            <Text
              style={styles.relativeTime}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {relative}
            </Text>
          ) : null}
        </View>
      </View>

      <Text
        style={styles.pubName}
        numberOfLines={2}
        maxFontSizeMultiplier={FontScaleCap.heading}
      >
        {activity.name}
      </Text>

      {activity.city ? (
        <View style={styles.cityRow}>
          <MapPinIcon size={14} color={Colors.mutedText} />
          <Text
            style={styles.cityText}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {activity.city}
          </Text>
        </View>
      ) : null}

      {activity.message ? (
        <Text
          style={styles.message}
          numberOfLines={3}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {activity.message}
        </Text>
      ) : null}

      <View style={styles.rsvp}>
        <RsvpControl
          activityId={activity.id}
          myResponse={activity.myResponse}
          onResponded={handleResponded}
        />
      </View>

      <View style={styles.roster}>
        <GoingRoster
          profiles={responses.goingProfiles}
          goingCount={responses.going}
          maybeCount={responses.maybe}
          cantCount={responses.cant}
          size="standard"
          surfaceColor={Colors.stout2}
          iAmGoing={activity.myResponse === 'going'}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    // Warm, but deliberately cooler than MyActivityCard's 0.45 — and no glow.
    borderColor: withAlpha(Colors.amber, 0.32),
    padding: Spacing.lg,
    ...softDrop(),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  identity: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  identityName: {
    flexShrink: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
  },
  headerMeta: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  relativeTime: {
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: Colors.mutedText,
  },
  pubName: {
    marginTop: Spacing.md,
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    lineHeight: 22,
    color: Colors.foam,
  },
  cityRow: {
    marginTop: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  cityText: {
    flexShrink: 1,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
  },
  message: {
    marginTop: Spacing.sm,
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    color: Colors.foamMuted,
  },
  rsvp: {
    marginTop: Spacing.md,
  },
  roster: {
    marginTop: Spacing.md,
  },
});

export default memo(FriendActiveCard);
