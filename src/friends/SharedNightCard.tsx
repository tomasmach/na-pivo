/** One merged live table: explicit participants and their beers from this pub night. */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { showAppDialog } from '@/components/shared/AppDialog';
import {
  BeerIcon,
  CompassIcon,
  MapPinIcon,
  Undo2Icon,
  UsersIcon,
  XIcon,
} from '@/components/shared/IconGlyph';
import { endFriendPubActivity, type FriendProfile, type SharedNight } from '@/data/friendsClient';
import { enqueueFriendOp, isRetriableFriendError } from '@/data/friendsQueue';
import { cs } from '@/i18n/cs';
import { Avatar } from '@/profile/Avatar';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { amberGlow, softDrop } from '@/theme/shadows';

import { focusPubFromActivity } from './focusPubHandoff';
import LiveDot from './LiveDot';
import RsvpControl from './RsvpControl';
import { formatExpiry, useNowTick } from './useNowTick';

interface SharedNightCardProps {
  night: SharedNight;
  onChanged: () => void;
  stale?: boolean;
}

function profileName(profile: FriendProfile, isMe: boolean): string {
  if (isMe) return cs.friends.sharedNightMe;
  if (profile.nickname) return `@${profile.nickname}`;
  return profile.displayName || 'Kámoš';
}

function SharedNightCard({ night, onChanged, stale = false }: SharedNightCardProps) {
  const now = useNowTick();
  const router = useRouter();
  const showToast = useToastStore((state) => state.show);
  const mountedRef = useRef(true);
  const [ending, setEnding] = useState(false);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const showOnCompass = useCallback(() => {
    if (focusPubFromActivity(night)) router.push('/' as Href);
  }, [night, router]);

  const confirmEnd = useCallback(() => {
    if (!night.myActivityId) return;
    setEnding(true);
    void endFriendPubActivity(night.myActivityId).then((result) => {
      if (!mountedRef.current) return;
      if (result.ok) {
        showToast(cs.friends.endedToast, {
          icon: <Undo2Icon size={20} color={Colors.amber} />,
        });
        onChanged();
        return;
      }
      if (isRetriableFriendError(result)) {
        void enqueueFriendOp({
          op: 'end',
          clientId: night.myActivityId!,
          activityId: night.myActivityId!,
        });
        showToast(cs.friends.endQueued, {
          icon: <Undo2Icon size={20} color={Colors.amber} />,
        });
        onChanged();
        return;
      }
      setEnding(false);
      showToast(result.detail);
    });
  }, [night.myActivityId, onChanged, showToast]);

  const handleEnd = useCallback(() => {
    showAppDialog({
      title: cs.friends.endActivityConfirmTitle,
      message: cs.friends.endActivityConfirmBody,
      buttons: [
        { text: cs.common.cancel, style: 'cancel' },
        {
          text: cs.friends.endActivityConfirmConfirm,
          style: 'destructive',
          onPress: confirmEnd,
        },
      ],
    });
  }, [confirmEnd]);

  const expiry = formatExpiry(night.expiresAt, now);
  const expiresAt = Date.parse(night.expiresAt);
  if (ending || (Number.isFinite(expiresAt) && expiresAt <= now)) return null;

  return (
    <View style={styles.glowLayer}>
      <View style={styles.card}>
        <View style={styles.kickerRow}>
          <View style={styles.kickerLeft}>
            <LiveDot stale={stale} />
            <View style={styles.groupDisk}>
              <UsersIcon size={16} color={Colors.amber} />
            </View>
            <Text style={styles.kicker} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.friends.sharedNightTitle}
            </Text>
          </View>
          <Text style={styles.expiry} maxFontSizeMultiplier={FontScaleCap.body}>
            {expiry || cs.friends.sharedNightLive}
          </Text>
        </View>

        <Text style={styles.pubName} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.heading}>
          {night.name}
        </Text>
        {night.city ? (
          <View style={styles.cityRow}>
            <MapPinIcon size={14} color={Colors.mutedText} />
            <Text style={styles.city} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
              {night.city}
            </Text>
          </View>
        ) : null}

        <View style={styles.totalRow}>
          <Text style={styles.peopleTotal} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.friends.sharedNightPeople(night.participants.length)}
          </Text>
          <View style={styles.totalBeers}>
            <BeerIcon size={16} color={Colors.amber} />
            <Text style={styles.totalBeerText} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.friends.sharedNightTotal(night.totalBeers)}
            </Text>
          </View>
        </View>

        <View style={styles.participants}>
          {night.participants.map((participant, index) => (
            <View
              key={participant.account.id || `${index}`}
              style={[styles.participant, index > 0 && styles.participantBorder]}
            >
              <Avatar
                uri={participant.account.avatarUrl}
                nickname={participant.account.nickname}
                displayName={participant.account.displayName}
                size={36}
              />
              <Text
                style={styles.participantName}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {profileName(participant.account, participant.isMe)}
              </Text>
              <View style={styles.beerCount}>
                <BeerIcon size={15} color={Colors.amberLight} />
                <Text style={styles.beerCountText} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {participant.beerCount}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {!night.myActivityId && night.joinActivityId ? (
          <View style={styles.rsvp}>
            <RsvpControl
              activityId={night.joinActivityId}
              myResponse={night.myResponse}
              onResponded={onChanged}
            />
          </View>
        ) : null}

        <View style={styles.footer}>
          <Pressable
            onPress={showOnCompass}
            accessibilityRole="button"
            accessibilityLabel={cs.friends.showOnCompass}
            style={({ pressed }) => [styles.footerAction, pressed && styles.pressed]}
          >
            <CompassIcon size={16} color={Colors.mutedText} />
            <Text style={styles.footerLabel} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.friends.showOnCompass}
            </Text>
          </Pressable>
          {night.myActivityId ? (
            <Pressable
              onPress={handleEnd}
              accessibilityRole="button"
              accessibilityLabel={cs.friends.endActivityA11y}
              style={({ pressed }) => [styles.endAction, pressed && styles.pressed]}
            >
              <XIcon size={15} color={Colors.foamMuted} />
              <Text style={styles.endLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.friends.endActivity}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  glowLayer: {
    borderRadius: Radius.cardLarge,
    ...amberGlow(16),
  },
  card: {
    padding: Spacing.lg,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.52),
    backgroundColor: Colors.stout2,
    ...softDrop(),
  },
  kickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  kickerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: Spacing.sm,
  },
  groupDisk: {
    width: 30,
    height: 30,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  kicker: {
    color: Colors.amberLight,
    fontFamily: Fonts.ui.bold,
    fontSize: 12,
    letterSpacing: 0.8,
  },
  expiry: {
    color: Colors.mutedText,
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
  },
  pubName: {
    marginTop: Spacing.md,
    color: Colors.foam,
    fontFamily: Fonts.display.bold,
    fontSize: 27,
    lineHeight: 31,
  },
  cityRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  city: {
    color: Colors.mutedText,
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
  },
  totalRow: {
    marginTop: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  peopleTotal: {
    color: Colors.foamMuted,
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
  },
  totalBeers: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  totalBeerText: {
    color: Colors.amberLight,
    fontFamily: Fonts.ui.bold,
    fontSize: 14,
  },
  participants: {
    marginTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.12),
  },
  participant: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  participantBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.1),
  },
  participantName: {
    flex: 1,
    color: Colors.foam,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
  },
  beerCount: {
    minWidth: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 7,
  },
  beerCountText: {
    minWidth: 18,
    color: Colors.foam,
    fontFamily: Fonts.display.bold,
    fontSize: 21,
    textAlign: 'right',
  },
  rsvp: {
    marginTop: Spacing.lg,
  },
  footer: {
    marginTop: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  footerAction: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  footerLabel: {
    color: Colors.mutedText,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
  },
  endAction: {
    minHeight: 38,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.14),
    borderRadius: Radius.pill,
  },
  endLabel: {
    color: Colors.foamMuted,
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
  },
  pressed: {
    opacity: 0.62,
  },
});

export default memo(SharedNightCard);
