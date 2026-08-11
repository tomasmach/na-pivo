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
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { CompassIcon, MapPinIcon } from '@/components/shared/IconGlyph';
import type { FriendProfile, FriendPubActivity } from '@/data/friendsClient';
import { Avatar } from '@/profile/Avatar';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import CheersPill from './CheersPill';
import { focusPubFromActivity } from './focusPubHandoff';
import { useFriendSafety } from './friendSafety';
import GoingRoster from './GoingRoster';
import LiveDot from './LiveDot';
import RsvpControl from './RsvpControl';
import { formatRelative, useNowTick } from './useNowTick';

interface FriendActiveCardProps {
  activity: FriendPubActivity;
  /** Fired after a successful RSVP/clear — the parent should reload the dashboard. */
  onResponded: (activity: FriendPubActivity) => void;
  /** Dim the live dot to a static 0.4 while the dashboard is stale (§2C). */
  stale?: boolean;
}

/** FriendMini stays in FriendsScreen; mirror its name resolution locally. */
function nameOf(profile: FriendProfile | null | undefined): string {
  if (!profile) return 'Kámoš';
  if (profile.nickname) return `@${profile.nickname}`;
  return profile.displayName || 'Kámoš';
}

function FriendActiveCard({ activity, onResponded, stale = false }: FriendActiveCardProps) {
  const now = useNowTick();
  const router = useRouter();
  const { account, responses } = activity;

  // RsvpControl resolves to a "reload now" signal (no fresh activity); bubble the
  // current activity up so the parent reloads the dashboard and reconciles the
  // roster from server truth.
  const handleResponded = useCallback(() => {
    onResponded(activity);
  }, [onResponded, activity]);

  const openSafetyMenu = useFriendSafety(handleResponded);
  const openProfile = useCallback(() => {
    if (account.id) router.push(`/parta/${account.id}` as Href);
  }, [account.id, router]);
  const handleLongPress = useCallback(() => {
    openSafetyMenu(account);
  }, [openSafetyMenu, account]);
  const showOnCompass = useCallback(() => {
    if (focusPubFromActivity(activity)) router.push('/' as Href);
  }, [activity, router]);

  const relative = formatRelative(activity.startedAt, now);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        {/* FriendMini-equivalent — the whole identity opens the friend profile;
            a long-press pops the safety menu (block / report, §G1). */}
        <Pressable
          onPress={openProfile}
          onLongPress={handleLongPress}
          accessibilityRole="button"
          accessibilityLabel={nameOf(account)}
          style={({ pressed }) => [styles.identity, pressed && styles.dim]}
        >
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
        </Pressable>

        <View style={styles.headerMeta}>
          <LiveDot stale={stale} />
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

      {/* Footer: "Ukaž na kompasu" handoff on the leading edge (§F2), one-tap
          "Na zdraví" reaction on the trailing edge (§C1). */}
      <View style={styles.reactionRow}>
        <Pressable
          onPress={showOnCompass}
          accessibilityRole="button"
          accessibilityLabel={cs.friends.showOnCompass}
          hitSlop={{ top: 6, bottom: 6, left: 4, right: 8 }}
          style={({ pressed }) => [styles.compassAction, pressed && styles.dim]}
        >
          <CompassIcon size={16} color={Colors.mutedText} />
          <Text
            style={styles.compassLabel}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {cs.friends.showOnCompass}
          </Text>
        </Pressable>
        <CheersPill
          activityId={activity.id}
          count={activity.reactions.cheers}
          mine={activity.myReaction === 'cheers'}
          ownerName={nameOf(account)}
          onChanged={handleResponded}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.1),
    padding: Spacing.lg,
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
  dim: {
    opacity: 0.6,
  },
  identityName: {
    flexShrink: 1,
    fontWeight: '600',
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
    fontWeight: '500',
    fontSize: 12,
    color: Colors.mutedText,
  },
  pubName: {
    marginTop: Spacing.md,
    fontWeight: '800',
    fontSize: 21,
    lineHeight: 25,
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
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
  },
  message: {
    marginTop: Spacing.sm,
    fontWeight: '400',
    fontSize: 14,
    color: Colors.foamMuted,
  },
  rsvp: {
    marginTop: Spacing.md,
  },
  roster: {
    marginTop: Spacing.md,
  },
  reactionRow: {
    marginTop: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  compassAction: {
    flexShrink: 1,
    minHeight: HitArea.min - 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  compassLabel: {
    flexShrink: 1,
    fontWeight: '600',
    fontSize: 13,
    color: Colors.mutedText,
  },
});

export default memo(FriendActiveCard);
