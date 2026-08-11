/**
 * PlanCard — a scheduled "Dnes v 20:00" plan in PLÁN NA DNES (Parta 3.0 §B3).
 *
 * A cooler sibling of FriendActiveCard: the border sits at
 * `withAlpha(amber, 0.28)` — warmer than a hairline, cooler than a live card's
 * 0.42 — with NO glow and NO LiveDot, so it reads as "naplánováno, ještě to
 * nežije" without eroding the "amber = alive" law. A ClockIcon + "Dnes v HH:MM"
 * chip replaces the live relative-time.
 *
 * Two shapes:
 *   - mine  → "TVŮJ PLÁN" kicker, a read-only roster, and a low-emphasis
 *             "Zrušit plán" ghost pill (clone of the MyActivityCard end pill).
 *   - friend → identity header, the RSVP control (RSVP forward — "kdo PŮJDE"),
 *              the going roster, and a "Na zdraví" reaction pill.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { showAppDialog } from '@/components/shared/AppDialog';
import { ClockIcon, CompassIcon, MapPinIcon, XIcon } from '@/components/shared/IconGlyph';
import {
  endFriendPubActivity,
  type FriendProfile,
  type FriendPubActivity,
} from '@/data/friendsClient';
import { enqueueFriendOp, isRetriableFriendError } from '@/data/friendsQueue';
import { Avatar } from '@/profile/Avatar';
import { cs } from '@/i18n/cs';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

import CheersPill from './CheersPill';
import { focusPubFromActivity } from './focusPubHandoff';
import { useFriendSafety } from './friendSafety';
import GoingRoster from './GoingRoster';
import RsvpControl from './RsvpControl';

interface PlanCardProps {
  activity: FriendPubActivity;
  /** My own plan (read-only roster + cancel) vs a friend's plan (RSVP + react). */
  mine: boolean;
  /** Fired after a successful RSVP/react so the parent reloads the dashboard. */
  onResponded: () => void;
  /** Fired once my plan is successfully cancelled so the parent drops it. */
  onCanceled: () => void;
}

const PILL_HIT_SLOP = { top: 6, bottom: 6, left: 6, right: 6 } as const;

function nameOf(profile: FriendProfile | null | undefined): string {
  if (!profile) return 'Kámoš';
  if (profile.nickname) return `@${profile.nickname}`;
  return profile.displayName || 'Kámoš';
}

/** "20:00" from the plan's scheduled ISO time; '' when unparseable. */
function planTimeLabel(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}

function PlanCardBase({ activity, mine, onResponded, onCanceled }: PlanCardProps) {
  const showToast = useToastStore((s) => s.show);
  const router = useRouter();
  const { account, responses } = activity;

  const openSafetyMenu = useFriendSafety(onResponded);
  const openProfile = useCallback(() => {
    if (account.id) router.push(`/parta/${account.id}` as Href);
  }, [account.id, router]);
  const handleLongPress = useCallback(() => {
    openSafetyMenu(account);
  }, [openSafetyMenu, account]);
  const showOnCompass = useCallback(() => {
    if (focusPubFromActivity(activity)) router.push('/' as Href);
  }, [activity, router]);

  const [cancelling, setCancelling] = useState(false);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const time = planTimeLabel(activity.scheduledFor ?? activity.startedAt);

  const confirmCancel = useCallback(() => {
    setCancelling(true);
    void endFriendPubActivity(activity.id).then((res) => {
      if (!mountedRef.current) return;
      if (res.ok) {
        showToast(cs.friends.planCanceled, { icon: <XIcon size={20} color={Colors.amber} /> });
        onCanceled();
      } else {
        if (isRetriableFriendError(res)) {
          void enqueueFriendOp({ op: 'end', clientId: activity.id, activityId: activity.id });
          showToast(cs.friends.planCancelQueued, {
            icon: <XIcon size={20} color={Colors.amber} />,
          });
          onCanceled();
          return;
        }
        setCancelling(false);
        showToast(res.detail);
      }
    });
  }, [activity.id, onCanceled, showToast]);

  const handleCancelPress = useCallback(() => {
    showAppDialog({
      title: cs.friends.planCancelConfirmTitle,
      message: cs.friends.planCancelConfirmBody,
      buttons: [
        { text: cs.common.cancel, style: 'cancel' },
        { text: cs.friends.planCancel, style: 'destructive', onPress: confirmCancel },
      ],
    });
  }, [confirmCancel]);

  if (cancelling) return null;

  const timeChip = time ? (
    <View style={styles.timeChip}>
      <ClockIcon size={13} color={Colors.amber} />
      <Text style={styles.timeChipText} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
        {cs.friends.planAt(time)}
      </Text>
    </View>
  ) : null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        {mine ? (
          <Text style={styles.mineKicker} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.friends.planMineTitle}
          </Text>
        ) : (
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
        )}
        {timeChip}
      </View>

      <Text style={styles.pubName} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.heading}>
        {activity.name}
      </Text>

      {activity.city ? (
        <View style={styles.cityRow}>
          <MapPinIcon size={14} color={Colors.mutedText} />
          <Text style={styles.cityText} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {activity.city}
          </Text>
        </View>
      ) : null}

      {activity.message ? (
        <Text style={styles.message} numberOfLines={3} maxFontSizeMultiplier={FontScaleCap.body}>
          {activity.message}
        </Text>
      ) : null}

      {!mine ? (
        <View style={styles.rsvp}>
          <RsvpControl
            activityId={activity.id}
            myResponse={activity.myResponse}
            onResponded={onResponded}
          />
        </View>
      ) : null}

      <View style={styles.roster}>
        <GoingRoster
          profiles={responses.goingProfiles}
          goingCount={responses.going}
          maybeCount={responses.maybe}
          cantCount={responses.cant}
          size="standard"
          surfaceColor={Colors.stout2}
          iAmGoing={activity.myResponse === 'going'}
          isMyCard={mine}
        />
      </View>

      <View style={styles.footer}>
        {mine ? (
          <>
            {activity.reactions.cheers > 0 ? (
              <Text style={styles.cheersLine} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.friends.cheersCount(activity.reactions.cheers)}
              </Text>
            ) : (
              <View />
            )}
            <Pressable
              onPress={handleCancelPress}
              hitSlop={PILL_HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel={cs.friends.planCancel}
              style={({ pressed }) => [styles.cancelPill, pressed && styles.cancelPillPressed]}
            >
              <XIcon size={15} color={Colors.foamMuted} />
              <Text style={styles.cancelLabel} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
                {cs.friends.planCancel}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
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
              onChanged={onResponded}
            />
          </>
        )}
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
  mineKicker: {
    flexShrink: 1,
    fontWeight: '800',
    fontSize: 14,
    color: Colors.amber,
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
  timeChip: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.12),
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  timeChipText: {
    fontWeight: '600',
    fontSize: 12,
    color: Colors.amber,
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
  footer: {
    marginTop: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  cheersLine: {
    flexShrink: 1,
    fontWeight: '500',
    fontSize: 12,
    color: Colors.mutedText,
  },
  cancelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: HitArea.min - 8,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.06),
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.6),
  },
  cancelPillPressed: {
    opacity: 0.6,
  },
  cancelLabel: {
    fontWeight: '600',
    fontSize: 14,
    color: Colors.foamMuted,
  },
});

export default memo(PlanCardBase);
