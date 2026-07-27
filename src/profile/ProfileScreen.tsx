/**
 * Profile tab — one identity, one lifetime card, one nudge and one amber action.
 *
 * The profile is a fixed Tácek composition. Lifetime stats, mapping, photos,
 * recent evenings and secondary navigation still exist, but each now has one
 * named home instead of competing on this surface.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  MenuIcon,
  ExternalLinkIcon,
  SettingsIcon,
  TrophyIcon,
  UsersIcon,
} from '@/components/shared/IconGlyph';
import { MoreSheet, type MoreRow } from '@/components/shared/MoreSheet';
import { CounterCta, CounterSecondary } from '@/counter/CounterCta';
import { NudgeSlot, type Nudge } from '@/counter/NudgeSlot';
import { accountXpProgress } from '@/data/accountXp';
import { enqueueBeerPhoto } from '@/data/beerPhotosQueue';
import { deriveReconciledDiaryStats } from '@/data/diarySync';
import { loadFriendsDashboardSnapshot } from '@/data/friendsSnapshot';
import CodeSheet from '@/friends/CodeSheet';
import { isContextPubKey, normalizeDrinkType } from '@/drinks/drinkTypes';
import { cs } from '@/i18n/cs';
import { beerCountLabel } from '@/i18n/plural';
import { Avatar } from '@/profile/Avatar';
import {
  dailyBeerAverage,
  earliestTimestamp,
  formatDailyBeerAverage,
} from '@/profile/dailyBeerAverage';
import { ProfileCard } from '@/profile/ProfileCard';
import {
  selectAvatarUrl,
  selectIsPublic,
  selectIsSignedIn,
  selectNickname,
  useAccountStore,
} from '@/stores/accountStore';
import { loadBeerPhotos, useBeerPhotosStore } from '@/stores/beerPhotosStore';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  allSessionsNewestFirst,
  sessionCount,
  sessionTotalCzk,
  useTallyStore,
  type TallySession,
} from '@/stores/tallyStore';
import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { formatPrice } from '@/utils/currency';

function lifetimeBeerCount(sessions: TallySession[]): number {
  return sessions.reduce((total, session) => total + sessionCount(session), 0);
}

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const isSignedIn = useAccountStore(selectIsSignedIn);
  const profile = useAccountStore((state) => state.profile);
  const nickname = useAccountStore(selectNickname);
  const avatarUrl = useAccountStore(selectAvatarUrl);
  const isPublic = useAccountStore(selectIsPublic);
  const diarySnapshot = useAccountStore((state) => {
    const snapshot = state.diarySnapshot;
    if (!snapshot || snapshot.accountId !== state.session?.accountId) return null;
    return snapshot.data;
  });

  const current = useTallyStore((state) => state.current);
  const history = useTallyStore((state) => state.history);
  const photos = useBeerPhotosStore((state) => state.photos);
  const priceCurrency = useSettingsStore((state) => state.priceCurrency);

  const [codeVisible, setCodeVisible] = useState(false);
  const [moreVisible, setMoreVisible] = useState(false);
  const [partaCount, setPartaCount] = useState(0);
  const [dismissedNudge, setDismissedNudge] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadFriendsDashboardSnapshot().then((snapshot) => {
      if (alive && snapshot) setPartaCount(snapshot.dashboard.friends.length);
    });
    return () => {
      alive = false;
    };
  }, []);

  // This bootstrap used to happen when the photo strip was mounted directly on
  // the profile. Keep it here so a failed upload can still own the first nudge.
  useEffect(() => {
    const controller = new AbortController();
    void loadBeerPhotos(controller.signal);
    return () => controller.abort();
  }, []);

  const sessions = useMemo(
    () => allSessionsNewestFirst(current, history),
    [current, history],
  );
  const localBeers = useMemo(() => lifetimeBeerCount(sessions), [sessions]);
  const reconciledStats = useMemo(
    () => (diarySnapshot ? deriveReconciledDiaryStats(diarySnapshot, sessions) : null),
    [diarySnapshot, sessions],
  );
  let beers = localBeers;
  if (isSignedIn && reconciledStats) {
    beers = reconciledStats.totalBeers;
  } else if (isSignedIn && profile?.stats) {
    beers = Math.max(profile.stats.totalBeers, localBeers);
  }

  // The lifetime trio in the card. Local sessions are the floor; the reconciled
  // account snapshot wins for pubs and money once it's there, because it also
  // knows the evenings this phone never had.
  const lifetime = useMemo(() => {
    const evenings = sessions.filter((session) => session.drinks.length > 0).length;
    const localPubs = new Set(
      sessions
        .filter((session) => session.drinks.length > 0 && !isContextPubKey(session.pubKey))
        .map((session) => session.pubKey),
    ).size;
    const localSpent = sessions.reduce((total, session) => total + sessionTotalCzk(session), 0);
    return {
      evenings,
      pubs: Math.max(reconciledStats?.distinctPubs ?? 0, localPubs),
      spentCzk: Math.max(reconciledStats?.totalSpentCzk ?? 0, localSpent),
    };
  }, [reconciledStats, sessions]);
  const now = useMemo(() => new Date(), []);
  const firstBeerAt = useMemo(
    () =>
      earliestTimestamp([
        isSignedIn ? profile?.stats?.firstBeerAt : null,
        ...(diarySnapshot?.drinks ?? [])
          .filter(
            (drink) =>
              !drink.is_suspect && normalizeDrinkType(drink.drink_type) === 'beer',
          )
          .map((drink) => drink.drank_at),
        ...sessions.flatMap((session) =>
          session.drinks
            .filter((drink) => normalizeDrinkType(drink.drinkType) === 'beer')
            .map((drink) => drink.at),
        ),
      ]),
    [diarySnapshot, isSignedIn, profile?.stats?.firstBeerAt, sessions],
  );
  const averageBeersPerDay = formatDailyBeerAverage(
    dailyBeerAverage(beers, firstBeerAt, now),
  );

  const xpProgress = useMemo(
    () => accountXpProgress(profile?.mapper, profile?.pivar),
    [profile?.mapper, profile?.pivar],
  );
  const level = isSignedIn && xpProgress ? xpProgress.level : null;
  const levelTitle = isSignedIn && xpProgress ? xpProgress.title : cs.profile.levelRingCaption;
  // Null = full ring: a maxed rung has nothing left to fill, and a rung with a
  // zero-XP span cannot be divided.
  const levelProgress =
    isSignedIn && xpProgress && xpProgress.xpForNextLevel != null && xpProgress.xpForNextLevel > 0
      ? xpProgress.xpIntoLevel / xpProgress.xpForNextLevel
      : null;
  const levelHint = !isSignedIn
    ? cs.profile.levelNoAccount
    : xpProgress
      ? xpProgress.xpForNextLevel == null
        ? cs.profile.levelMaxed
        : cs.profile.levelToNext(
            Math.max(0, xpProgress.xpForNextLevel - xpProgress.xpIntoLevel),
          )
      : null;

  const displayName = profile?.displayName?.trim() || '';
  const identityNick = isSignedIn
    ? nickname?.trim()
      ? `@${nickname.trim()}`
      : cs.profile.noDisplayName
    : cs.profile.noAccountNick;
  const visibility = isPublic
    ? cs.profile.visibilityPublic
    : cs.profile.visibilityPrivate;
  const identityCaption = isSignedIn
    ? [displayName, visibility].filter(Boolean).join(' · ')
    : cs.profile.noAccountCaption;

  const lastEvening = useMemo(
    () => sessions.find((session) => session.drinks.length > 0) ?? null,
    [sessions],
  );
  const failedPhoto = useMemo(
    () => photos.find((photo) => photo.syncState === 'failed') ?? null,
    [photos],
  );

  const openFailedPhoto = useCallback(() => {
    if (!failedPhoto) return;
    if (failedPhoto.localUri && failedPhoto.failureCode !== 'photo_limit_reached') {
      void enqueueBeerPhoto({
        clientId: failedPhoto.clientId,
        localUri: failedPhoto.localUri,
        caption: failedPhoto.caption,
        pubCacheKey: failedPhoto.pubCacheKey || undefined,
        pubName: failedPhoto.pubName || undefined,
        pubCity: failedPhoto.pubCity || undefined,
        visibility: failedPhoto.visibility,
        takenAt: failedPhoto.takenAt,
      });
      return;
    }
    router.push({
      pathname: '/photo/[key]',
      params: { key: failedPhoto.clientId },
    } as Href);
  }, [failedPhoto, router]);

  // Exactly one nudge, selected in one place and in product priority order.
  const nudge: Nudge | null = useMemo(() => {
    if (failedPhoto) {
      return {
        kind: 'counted',
        text: cs.profile.nudgePhotoFailed,
        undoLabel: cs.profile.nudgePhotoRetry,
        onUndo: openFailedPhoto,
      };
    }
    if (isSignedIn && !nickname?.trim()) {
      return {
        kind: 'counted',
        text: cs.profile.nudgeNickname,
        undoLabel: cs.profile.nudgeNicknameFix,
        onUndo: () => router.push('/profile/edit' as Href),
      };
    }
    if (lastEvening) {
      const key = `evening:${lastEvening.startedAt}`;
      if (dismissedNudge === key) return null;
      return {
        kind: 'checkin',
        text: cs.profile.nudgeLastNight(
          lastEvening.pubName,
          beerCountLabel(sessionCount(lastEvening)),
        ),
        ctaLabel: cs.profile.nudgeLastNightOpen,
        onPress: () =>
          router.push({
            pathname: '/evening',
            params: { startedAt: lastEvening.startedAt },
          }),
        onDismiss: () => setDismissedNudge(key),
      };
    }
    if (beers === 0) {
      if (dismissedNudge === 'empty') return null;
      return {
        kind: 'checkin',
        text: cs.profile.nudgeEmpty,
        ctaLabel: cs.profile.nudgeEmptyCta,
        onPress: () => router.navigate('/beer' as Href),
        onDismiss: () => setDismissedNudge('empty'),
      };
    }
    return null;
  }, [
    beers,
    dismissedNudge,
    failedPhoto,
    isSignedIn,
    lastEvening,
    nickname,
    openFailedPhoto,
    router,
  ]);

  const moreRows = useMemo<MoreRow[]>(
    () => [
      {
        key: 'settings',
        label: cs.profile.moreSettings,
        icon: SettingsIcon,
        onPress: () => {
          setMoreVisible(false);
          router.push('/settings' as Href);
        },
      },
      {
        key: 'leaderboards',
        label: cs.profile.moreLeaderboards,
        icon: TrophyIcon,
        onPress: () => {
          setMoreVisible(false);
          router.push({
            pathname: '/leaderboards',
            params: { source: 'profile' },
          } as Href);
        },
      },
      {
        key: 'parta',
        label: cs.profile.moreParta,
        value:
          partaCount > 0
            ? cs.profile.morePartaCount(partaCount.toLocaleString('cs-CZ'))
            : cs.profile.morePartaEmpty,
        icon: UsersIcon,
        onPress: () => {
          setMoreVisible(false);
          router.push('/profile/parta' as Href);
        },
      },
      {
        key: 'follow',
        label: cs.profile.moreFollow,
        icon: ExternalLinkIcon,
        onPress: () => {
          setMoreVisible(false);
          router.push('/about' as Href);
        },
      },
    ],
    [partaCount, router],
  );

  const beersLabel = beers.toLocaleString('cs-CZ');
  const identityContent = (
    <>
      <Avatar
        uri={isSignedIn ? avatarUrl : null}
        nickname={isSignedIn ? nickname : null}
        displayName={isSignedIn ? displayName : null}
        size={40}
        border="quiet"
      />
      <View style={styles.identityText}>
        <Text
          style={styles.identityNick}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {identityNick}
        </Text>
        <Text
          style={styles.identityCaption}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {identityCaption}
        </Text>
      </View>
    </>
  );

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top + 8,
          paddingBottom: Math.max(insets.bottom, Spacing.sm),
        },
      ]}
    >
      <View style={styles.identityRow}>
        {isSignedIn ? (
          <Pressable
            onPress={() => router.push('/profile/edit' as Href)}
            style={({ pressed }) => [styles.identity, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={cs.a11y.profileIdentity}
          >
            {identityContent}
          </Pressable>
        ) : (
          <View style={styles.identity}>{identityContent}</View>
        )}

        <Pressable
          onPress={() => setMoreVisible(true)}
          style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.profileMore}
        >
          <MenuIcon size={20} color={Colors.mutedText} />
        </Pressable>
      </View>

      <ProfileCard
        beersLabel={beersLabel}
        caption={
          beers > 0
            ? cs.profile.lifetimeCaption
            : cs.profile.lifetimeCaptionEmpty
        }
        level={level}
        levelTitle={levelTitle}
        levelProgress={levelProgress}
        levelHint={levelHint}
        stats={[
          {
            key: 'pubs',
            value: lifetime.pubs.toLocaleString('cs-CZ'),
            label: cs.profile.cardStatPubs,
          },
          {
            key: 'evenings',
            value: lifetime.evenings.toLocaleString('cs-CZ'),
            label: cs.profile.cardStatEvenings,
          },
          {
            key: 'spent',
            value: formatPrice(lifetime.spentCzk, priceCurrency),
            label: cs.profile.cardStatSpent,
          },
          {
            key: 'daily-average',
            value: averageBeersPerDay,
            label: cs.profile.cardStatDailyAverage,
          },
        ]}
        linkLabel={cs.profile.badgesLink}
        onPressLink={() => router.push('/profile/badges' as Href)}
        accessibilityLabel={cs.a11y.profileCard(
          beersLabel,
          level !== null && xpProgress
            ? cs.profile.levelLine(level, xpProgress.title)
            : levelHint ?? '',
        )}
      />

      <NudgeSlot nudge={nudge} />

      <CounterCta
        label={isSignedIn ? cs.profile.ctaCode : cs.profile.ctaSignUp}
        subLabel={isSignedIn ? cs.profile.ctaCodeSub : cs.profile.ctaSignUpSub}
        onPress={() => {
          if (isSignedIn) setCodeVisible(true);
          else router.push('/auth' as Href);
        }}
        accessibilityLabel={
          isSignedIn ? cs.profile.ctaCode : cs.a11y.profileSignUp
        }
      />

      <CounterSecondary
        label={cs.profile.secondaryPhotos}
        onPress={() => router.push('/profile/photos' as Href)}
      />

      <MoreSheet
        visible={moreVisible}
        title={cs.profile.moreTitle}
        rows={moreRows}
        onClose={() => setMoreVisible(false)}
      />

      {codeVisible ? <CodeSheet onClose={() => setCodeVisible(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
    paddingHorizontal: 24,
    gap: 12,
  },
  identityRow: {
    minHeight: 44,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  identityText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  identityNick: {
    flexShrink: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
    includeFontPadding: false,
  },
  identityCaption: {
    flexShrink: 1,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  moreButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
