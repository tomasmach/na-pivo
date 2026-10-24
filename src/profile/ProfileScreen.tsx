/**
 * Profile tab — who you are, your lifetime numbers and what you have collected:
 * srdcovky, badges, photos and the pubs you added. Evening history and records
 * stay in Deník; settings sit behind the gear in the header.
 */

import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Band,
  ListRow,
  PAGE_PAD,
  RoundButton,
  SectionTitle,
} from '@/components/shared/FlatPage';
import { ChevronRightIcon, SettingsIcon } from '@/components/shared/IconGlyph';
import { accountXpProgress } from '@/data/accountXp';
import { loadAddedPubSubmissions, type AddedPubSubmission } from '@/data/addedPubsQueue';
import { enqueueBeerPhoto } from '@/data/beerPhotosQueue';
import { deriveReconciledDiaryStats } from '@/data/diarySync';
import { loadFriendsDashboardSnapshot } from '@/data/friendsSnapshot';
import { fetchLeaderboard } from '@/data/leaderboardsClient';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { isContextPubKey, normalizeDrinkType } from '@/drinks/drinkTypes';
import { t, intlLocale } from '@/i18n';
import { openPubPage } from '@/pubPage/openPubPage';
import { Avatar } from '@/profile/Avatar';
import { BadgeMedal, medalLook } from '@/profile/BadgeMedal';
import { nearestGoals, type BadgeKey } from '@/profile/badgeModel';
import { BadgeGoalRow } from '@/profile/BadgeRows';
import { badgeName } from '@/profile/badgeText';
import { useAccountBadges, useRefreshBadgesOnFocus } from '@/profile/useAccountBadges';
import {
  dailyBeerAverage,
  earliestTimestamp,
  formatDailyBeerAverage,
} from '@/profile/dailyBeerAverage';
import { LevelRing } from '@/profile/LevelRing';
import { favoriteBeerName, savedFavoritePubs } from '@/profile/profileModel';
import { useMyStats } from '@/stats/useMyStats';
import {
  selectAvatarUrl,
  selectIsPublic,
  selectIsSignedIn,
  selectNickname,
  useAccountStore,
} from '@/stores/accountStore';
import { loadBeerPhotos, useBeerPhotosStore } from '@/stores/beerPhotosStore';
import { useBadgeStore } from '@/stores/badgeStore';
import { useBeerWatchStore } from '@/stores/beerWatchStore';
import { usePubFavoritesStore } from '@/stores/pubFavoritesStore';
import { usePubStore } from '@/stores/pubStore';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  allSessionsNewestFirst,
  sessionCount,
  sessionTotalCzk,
  useTallyStore,
} from '@/stores/tallyStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { formatPrice } from '@/utils/currency';
import { dateTimeFormat } from '@/utils/intlFormat';
import { useBottomInset, useFirstFocus } from '@/navigation/TabScreen';

// The QR code pulls in ~450 KB of SVG/CSS parsing; load it when the sheet opens.
const CodeSheet = lazy(() => import('@/friends/CodeSheet'));

const FAVORITES_COLLAPSED = 5;
const BADGES_SHOWN = 4;
const PHOTOS_SHOWN = 3;

/** The tab outlives logout and sign-in; a new account gets a fresh screen. */
export default function ProfileScreen() {
  const accountId = useAccountStore((state) => state.session?.accountId ?? null);
  return <AccountProfileScreen key={accountId ?? ''} />;
}

function AccountProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bottomInset = useBottomInset(Spacing.xl);

  const isSignedIn = useAccountStore(selectIsSignedIn);
  const profile = useAccountStore((state) => state.profile);
  const nickname = useAccountStore(selectNickname);
  const avatarUrl = useAccountStore(selectAvatarUrl);
  const isPublic = useAccountStore(selectIsPublic);
  const accountId = useAccountStore((state) => state.session?.accountId ?? null);
  const diarySnapshot = useAccountStore((state) => {
    const snapshot = state.diarySnapshot;
    if (!snapshot || snapshot.accountId !== state.session?.accountId) return null;
    return snapshot.data;
  });

  const current = useTallyStore((state) => state.current);
  const history = useTallyStore((state) => state.history);
  const photos = useBeerPhotosStore((state) => state.photos);
  const priceCurrency = useSettingsStore((state) => state.priceCurrency);
  const favoriteMap = usePubFavoritesStore((state) => state.favorites);
  const reportedKeys = usePubStore((state) => state.reportedCacheKeys);
  const reportedIds = usePubStore((state) => state.reportedPubIds);
  const beerWatchCount = useBeerWatchStore((state) => state.watches.length);

  const opened = useFirstFocus();
  const remoteStats = useMyStats(opened);
  const [codeVisible, setCodeVisible] = useState(false);
  const [allFavorites, setAllFavorites] = useState(false);
  const [partaCount, setPartaCount] = useState<number | null>(null);
  const [addedPubs, setAddedPubs] = useState<AddedPubSubmission[]>([]);
  const [weeklyRank, setWeeklyRank] = useState<number | null>(null);

  // Refreshed on every visit: the friend list, added pubs and rank change on
  // other screens while this tab stays mounted.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void loadFriendsDashboardSnapshot().then((snapshot) => {
        if (alive && snapshot) setPartaCount(snapshot.dashboard.friends.length);
      });
      void loadAddedPubSubmissions().then((submissions) => {
        if (alive) setAddedPubs(submissions);
      });
      void fetchLeaderboard('beers', 'week').then((board) => {
        if (alive) setWeeklyRank(board?.me.rank ?? null);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  // The tab outlives logout and sign-in, so the photos follow the account.
  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController();
    void loadBeerPhotos(controller.signal);
    return () => controller.abort();
  }, [opened, accountId]);

  const sessions = useMemo(
    () => allSessionsNewestFirst(current, history),
    [current, history],
  );
  const localBeers = useMemo(
    () => sessions.reduce((total, session) => total + sessionCount(session), 0),
    [sessions],
  );
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

  // Local sessions are the floor; the server knows evenings this phone never had,
  // so its numbers win once they are larger, as in Deník.
  const lifetime = useMemo(() => {
    const evenings = sessions.filter((session) => session.drinks.length > 0).length;
    const localPubs = new Set(
      sessions
        .filter((session) => session.drinks.length > 0 && !isContextPubKey(session.pubKey))
        .map((session) => session.pubKey),
    ).size;
    const localSpent = sessions.reduce((total, session) => total + sessionTotalCzk(session), 0);
    return {
      evenings: Math.max(remoteStats?.totalEvenings ?? 0, evenings),
      pubs: Math.max(reconciledStats?.distinctPubs ?? 0, localPubs),
      spentCzk: Math.max(reconciledStats?.totalSpentCzk ?? 0, localSpent),
    };
  }, [reconciledStats, remoteStats, sessions]);

  // The server snapshot holds the whole drink history; scan it only when the
  // snapshot changes, not on every local drink.
  const remoteFirstBeerAt = useMemo(
    () =>
      earliestTimestamp(
        (diarySnapshot?.drinks ?? [])
          .filter((drink) => !drink.is_suspect && normalizeDrinkType(drink.drink_type) === 'beer')
          .map((drink) => drink.drank_at),
      ),
    [diarySnapshot],
  );
  const firstBeerAt = useMemo(
    () =>
      earliestTimestamp([
        // The filtered drink snapshot already drops beers removed on this
        // phone; the cached profile date would still count them.
        isSignedIn && !diarySnapshot ? profile?.stats?.firstBeerAt : null,
        remoteFirstBeerAt,
        ...sessions.flatMap((session) =>
          session.drinks
            .filter((drink) => normalizeDrinkType(drink.drinkType) === 'beer')
            .map((drink) => drink.at),
        ),
      ]),
    [diarySnapshot, isSignedIn, profile?.stats?.firstBeerAt, remoteFirstBeerAt, sessions],
  );
  const now = useMemo(() => new Date(), []);
  const average = dailyBeerAverage(beers, firstBeerAt, now);
  const favoriteBeer = useMemo(
    () => favoriteBeerName(diarySnapshot?.drinks ?? null, sessions),
    [diarySnapshot, sessions],
  );
  const facts =
    beers > 0
      ? [
          average != null
            ? t.profile.factDailyAverage(formatDailyBeerAverage(average), Math.round(average * 10) / 10)
            : null,
          firstBeerAt ? t.profile.factSince(dateTimeFormat({ day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(firstBeerAt))) : null,
          favoriteBeer ? t.profile.factFavoriteBeer(favoriteBeer) : null,
        ].filter(Boolean).join(' · ')
      : '';

  const xpProgress = useMemo(
    () => accountXpProgress(profile?.mapper, profile?.pivar),
    [profile?.mapper, profile?.pivar],
  );
  const level = isSignedIn && xpProgress ? xpProgress.level : null;
  // Null = full ring: a maxed rung has nothing left to fill, and a rung with a
  // zero-XP span cannot be divided.
  const levelProgress =
    isSignedIn && xpProgress && xpProgress.xpForNextLevel != null && xpProgress.xpForNextLevel > 0
      ? xpProgress.xpIntoLevel / xpProgress.xpForNextLevel
      : null;
  const levelHint = !isSignedIn
    ? t.profile.levelNoAccount
    : xpProgress
      ? xpProgress.xpForNextLevel == null
        ? t.profile.levelMaxed
        : t.profile.levelToNext(Math.max(0, xpProgress.xpForNextLevel - xpProgress.xpIntoLevel))
      : null;

  const displayName = profile?.displayName?.trim() || '';
  const missingNickname = isSignedIn && !nickname?.trim();
  const identityNick = isSignedIn
    ? nickname?.trim()
      ? `@${nickname.trim()}`
      : displayName || t.profile.noDisplayName
    : t.profile.noAccountNick;
  const identityCaption = isSignedIn
    ? [displayName, isPublic ? t.profile.visibilityPublic : t.profile.visibilityPrivate]
        .filter(Boolean)
        .join(' · ')
    : t.profile.noAccountCaption;

  const favorites = useMemo(
    () => savedFavoritePubs(favoriteMap, reportedKeys, reportedIds),
    [favoriteMap, reportedIds, reportedKeys],
  );
  const shownFavorites = allFavorites ? favorites : favorites.slice(0, FAVORITES_COLLAPSED);

  useRefreshBadgesOnFocus();
  const badges = useAccountBadges();
  const ownLedger = useBadgeStore((s) => s.accountId != null && s.accountId === profile?.id);
  const recentBadges = useBadgeStore((s) => s.recent);
  const unopenedBadges = useBadgeStore((s) => s.unopened);
  const shelf = useMemo(() => {
    if (!badges) return null;
    const recent: readonly BadgeKey[] = ownLedger ? recentBadges : [];
    const rank = (key: BadgeKey) => {
      const index = recent.indexOf(key);
      return index === -1 ? recent.length : index;
    };
    const earned = badges.filter((state) => state.tier > 0);
    return {
      earned: earned.length,
      shown: [...earned]
        .sort((a, b) => rank(a.key) - rank(b.key) || b.tier - a.tier)
        .slice(0, BADGES_SHOWN),
      goal: nearestGoals(badges, 1)[0] ?? null,
    };
  }, [badges, ownLedger, recentBadges]);

  const failedPhoto = useMemo(
    () => photos.find((photo) => photo.syncState === 'failed') ?? null,
    [photos],
  );
  const retryFailedPhoto = useCallback(() => {
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
    router.push({ pathname: '/photo/[key]', params: { key: failedPhoto.clientId } } as Href);
  }, [failedPhoto, router]);

  const waitingPubs = addedPubs.filter((submission) => submission.syncState !== 'synced').length;
  const beersLabel = beers.toLocaleString(intlLocale);

  const openPhotos = () => {
    trackUiInteraction('profile_photos_open');
    router.push('/profile/photos' as Href);
  };
  const openBadges = () => {
    trackUiInteraction('profile_badges_open');
    router.push('/profile/badges' as Href);
  };
  const openSignUp = () => {
    trackUiInteraction('profile_signup_open');
    router.push('/auth' as Href);
  };

  const primary = isSignedIn
    ? {
        label: t.profile.ctaCode,
        onPress: () => {
          trackUiInteraction('profile_code_open');
          setCodeVisible(true);
        },
      }
    : beers === 0
      ? { label: t.profile.ctaFirstBeer, onPress: () => router.navigate('/beer' as Href) }
      : { label: t.profile.ctaSignUp, sub: t.profile.ctaSignUpSub, onPress: openSignUp };

  const identity = (
    <>
      <Avatar
        uri={isSignedIn ? avatarUrl : null}
        nickname={isSignedIn ? nickname : null}
        displayName={isSignedIn ? displayName : null}
        size={56}
        border="quiet"
      />
      <View style={styles.identityText}>
        <Text style={styles.nick} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
          {identityNick}
        </Text>
        <Text
          style={[styles.caption, missingNickname && styles.captionAction]}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {missingNickname ? t.profile.nicknameMissing : identityCaption}
        </Text>
      </View>
    </>
  );

  return (
    // Not collapsable, so the scroll view stays first in the native tree, where
    // a second tap on the tab looks for it to scroll back to the top.
    <View style={[styles.root, { paddingTop: insets.top }]} collapsable={false}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.identityRow}>
          {isSignedIn ? (
            <Pressable
              onPress={() => {
                trackUiInteraction('profile_edit_open');
                router.push('/profile/edit' as Href);
              }}
              style={({ pressed }) => [styles.identity, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t.a11y.profileIdentity}
            >
              {identity}
            </Pressable>
          ) : (
            <View style={styles.identity}>{identity}</View>
          )}
          <RoundButton
            testID="profile-settings"
            label={t.a11y.profileSettings}
            onPress={() => {
              trackUiInteraction('profile_settings_open');
              router.push('/settings' as Href);
            }}
          >
            <SettingsIcon size={20} color={Colors.foam} />
          </RoundButton>
        </View>

        <View
          accessible
          accessibilityLabel={t.a11y.profileCard(
            beersLabel,
            level !== null && xpProgress ? t.profile.levelLine(level, xpProgress.title) : levelHint ?? '',
          )}
        >
          <View style={styles.hero}>
            <View style={styles.heroCount}>
              <Text
                style={styles.count}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
                maxFontSizeMultiplier={FontScaleCap.display}
              >
                {beersLabel}
              </Text>
              <Text style={styles.countLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                {beers > 0 ? t.profile.lifetimeLabel(beers) : t.profile.lifetimeEmpty}
              </Text>
            </View>
            <LevelRing
              level={level}
              title={isSignedIn && xpProgress ? xpProgress.title : null}
              progress={levelProgress}
              size={72}
            />
          </View>
          {levelHint ? (
            <Text style={styles.hint} maxFontSizeMultiplier={FontScaleCap.body}>
              {levelHint}
            </Text>
          ) : null}
          {beers > 0 ? (
            <View style={styles.stats}>
              <Stat value={lifetime.pubs.toLocaleString(intlLocale)} label={t.profile.statPubsLabel(lifetime.pubs)} />
              <Stat
                value={lifetime.evenings.toLocaleString(intlLocale)}
                label={t.profile.statEveningsLabel(lifetime.evenings)}
                align={lifetime.spentCzk > 0 ? 'center' : 'right'}
              />
              {lifetime.spentCzk > 0 ? (
                <Stat value={formatPrice(lifetime.spentCzk, priceCurrency)} label={t.profile.statSpentLabel} align="right" />
              ) : null}
            </View>
          ) : null}
          {facts ? (
            <Text style={styles.facts} maxFontSizeMultiplier={FontScaleCap.body}>
              {facts}
            </Text>
          ) : null}
        </View>

        <Pressable
          onPress={primary.onPress}
          style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
          accessibilityRole="button"
          accessibilityLabel={primary.label}
        >
          <Text style={styles.primaryLabel} maxFontSizeMultiplier={FontScaleCap.body}>
            {primary.label}
          </Text>
          {'sub' in primary ? (
            <Text style={styles.primarySub} maxFontSizeMultiplier={FontScaleCap.body}>
              {primary.sub}
            </Text>
          ) : null}
        </Pressable>

        {favorites.length > 0 ? (
          <>
            <Band />
            <SectionTitle title={t.profile.favoritesTitle} aside={favorites.length.toLocaleString(intlLocale)} />
            {shownFavorites.map((pub, index) => (
              <ListRow
                key={`${pub.lat},${pub.lng}`}
                first={index === 0}
                title={pub.name}
                subtitle={pub.city}
                onPress={() => openPubPage(router, pub)}
              />
            ))}
            {favorites.length > FAVORITES_COLLAPSED ? (
              <TextLink
                label={allFavorites ? t.profile.favoritesShowLess : t.profile.favoritesShowAll(favorites.length)}
                onPress={() => setAllFavorites((value) => !value)}
              />
            ) : null}
          </>
        ) : null}

        {shelf && badges ? (
          <>
            <Band />
            <SectionTitle title={t.badges.title} aside={t.badges.earnedOf(shelf.earned, badges.length)} />
            {shelf.shown.length > 0 ? (
              <Pressable
                onPress={openBadges}
                style={({ pressed }) => [styles.badges, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`${t.a11y.profileBadges}: ${shelf.shown.map((state) => badgeName(state)).join(', ')}`}
              >
                {shelf.shown.map((state) => (
                  <View key={state.key} style={styles.badge}>
                    <BadgeMedal
                      badge={state.key}
                      look={medalLook(state)}
                      size={56}
                      dot={ownLedger && unopenedBadges.includes(state.key)}
                    />
                    <Text style={styles.badgeTitle} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.display}>
                      {badgeName(state)}
                    </Text>
                  </View>
                ))}
                <View style={styles.badgesMore}>
                  <ChevronRightIcon size={16} color={Colors.mutedText} />
                </View>
              </Pressable>
            ) : null}
            {shelf.goal && (shelf.shown.length > 0 || shelf.goal.value > 0) ? (
              <BadgeGoalRow state={shelf.goal} first={shelf.shown.length === 0} prefixed onPress={openBadges} />
            ) : shelf.shown.length === 0 ? (
              <ListRow first title={t.badges.empty} onPress={openBadges} />
            ) : null}
          </>
        ) : null}

        <Band />
        <SectionTitle
          title={t.profile.photosTitle}
          aside={photos.length > 0 ? photos.length.toLocaleString(intlLocale) : null}
        />
        {photos.length > 0 ? (
          <>
            <View style={styles.thumbs}>
              {photos.slice(0, PHOTOS_SHOWN).map((photo) => {
                const uri = photo.imageUrl ?? photo.localUri;
                return (
                  <Pressable
                    key={photo.clientId}
                    onPress={() =>
                      router.push({ pathname: '/photo/[key]', params: { key: photo.clientId } } as Href)
                    }
                    style={({ pressed }) => [styles.thumb, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={t.a11y.photoTile(photo.caption || photo.pubName || t.profile.photosTitle)}
                  >
                    {uri ? (
                      <Image
                        source={{ uri }}
                        style={StyleSheet.absoluteFill}
                        resizeMode="cover"
                        resizeMethod="resize"
                        accessibilityIgnoresInvertColors
                      />
                    ) : null}
                  </Pressable>
                );
              })}
              {Array.from({ length: Math.max(0, PHOTOS_SHOWN - photos.length) }).map((_, index) => (
                <View key={index} style={styles.thumbSpacer} />
              ))}
            </View>
            {failedPhoto ? (
              <View style={styles.failedRow}>
                <Text style={styles.failedText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {t.profile.photoFailed}
                </Text>
                <Pressable onPress={retryFailedPhoto} hitSlop={10} accessibilityRole="button">
                  <Text style={styles.link} maxFontSizeMultiplier={FontScaleCap.body}>
                    {t.profile.photoRetry}
                  </Text>
                </Pressable>
              </View>
            ) : null}
            <TextLink label={t.profile.photosAll} onPress={openPhotos} />
          </>
        ) : (
          <>
            <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>
              {t.profile.photosEmpty}
            </Text>
            <TextLink label={t.profile.photosAdd} onPress={openPhotos} divided={false} />
          </>
        )}

        <Band />
        <SectionTitle
          title={t.profile.addedPubsTitle}
          aside={addedPubs.length > 0 ? addedPubs.length.toLocaleString(intlLocale) : null}
        />
        {/* Always reachable: after a sign-in the list is only on the server until the screen loads it. */}
        <ListRow
          first
          title={t.profile.myAddedPubs}
          value={waitingPubs > 0 ? t.profile.addedPubsWaiting(waitingPubs) : null}
          onPress={() => router.push('/my-added-pubs' as Href)}
        />
        <ListRow title={t.profile.addPub} onPress={() => router.push('/add-pub' as Href)} />

        <Band />
        <SectionTitle title={t.profile.moreTitle} />
        {!isSignedIn && beers === 0 ? (
          <ListRow first title={t.profile.ctaSignUp} subtitle={t.profile.ctaSignUpSub} onPress={openSignUp} />
        ) : null}
        <ListRow
          first={isSignedIn || beers > 0}
          title={t.profile.partaRow}
          value={
            partaCount === null
              ? null
              : partaCount > 0
                ? partaCount.toLocaleString(intlLocale)
                : t.profile.partaEmpty
          }
          onPress={() => {
            trackUiInteraction('profile_friends_manage_open');
            router.push('/profile/parta' as Href);
          }}
        />
        <ListRow
          testID="profile-beer-watches"
          title={t.profile.beerWatchesRow}
          value={beerWatchCount > 0 ? beerWatchCount.toLocaleString(intlLocale) : null}
          onPress={() => router.push('/profile/beer-watches' as Href)}
        />
        <ListRow
          title={t.profile.leaderboardsRow}
          value={weeklyRank != null ? t.profile.weeklyRank(weeklyRank) : null}
          onPress={() => {
            trackUiInteraction('profile_leaderboards_open');
            router.push({ pathname: '/leaderboards', params: { source: 'profile' } } as Href);
          }}
        />
        {!shelf ? <ListRow title={t.badges.title} onPress={openBadges} /> : null}
      </ScrollView>

      {codeVisible ? (
        <Suspense fallback={null}>
          <CodeSheet onClose={() => setCodeVisible(false)} />
        </Suspense>
      ) : null}
    </View>
  );
}

function Stat({ value, label, align = 'left' }: { value: string; label: string; align?: 'left' | 'center' | 'right' }) {
  const alignItems = align === 'left' ? 'flex-start' : align === 'center' ? 'center' : 'flex-end';
  return (
    <View style={[styles.stat, { alignItems }]}>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={FontScaleCap.body}>
        {value}
      </Text>
      <Text style={styles.statLabel} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
        {label}
      </Text>
    </View>
  );
}

function TextLink({ label, onPress, divided = true }: { label: string; onPress: () => void; divided?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.linkRow, divided && styles.linkRowDivided, pressed && styles.pressed]}
      accessibilityRole="button"
    >
      <Text style={styles.link} maxFontSizeMultiplier={FontScaleCap.body}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
  },
  content: {
    paddingHorizontal: PAGE_PAD,
  },
  pressed: {
    opacity: 0.65,
  },
  identityRow: {
    minHeight: 64,
    marginTop: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  identityText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  nick: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: Colors.foam,
  },
  caption: {
    fontSize: 15,
    color: Colors.mutedText,
  },
  captionAction: {
    fontWeight: '700',
    color: Colors.amber,
  },
  hero: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  heroCount: {
    flex: 1,
    minWidth: 0,
  },
  count: {
    fontSize: 72,
    lineHeight: 80,
    fontWeight: '800',
    letterSpacing: -2.5,
    color: Colors.amber,
    fontVariant: ['tabular-nums'],
  },
  countLabel: {
    fontSize: 15,
    color: Colors.mutedText,
  },
  hint: {
    marginTop: 10,
    fontSize: 14,
    color: Colors.mutedText,
  },
  stats: {
    marginTop: 18,
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  stat: {
    flex: 1,
    minWidth: 0,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    marginTop: 2,
    fontSize: 13,
    color: Colors.mutedText,
  },
  facts: {
    marginTop: Spacing.md,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.mutedText,
  },
  primary: {
    marginTop: Spacing.lg,
    minHeight: 48,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.97 }],
  },
  primaryLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.stout,
  },
  primarySub: {
    marginTop: 2,
    fontSize: 13,
    color: withAlpha(Colors.stout, 0.75),
  },
  badges: {
    minHeight: 60,
    paddingTop: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
  },
  badge: {
    width: 80,
    alignItems: 'center',
    gap: 6,
  },
  badgeTitle: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.foamMuted,
    textAlign: 'center',
  },
  badgesMore: {
    flex: 1,
    height: 56,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  thumbs: {
    paddingTop: Spacing.sm,
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  thumb: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: Colors.stout3,
  },
  thumbSpacer: {
    flex: 1,
  },
  failedRow: {
    marginTop: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  failedText: {
    flex: 1,
    fontSize: 14,
    color: Colors.foamMuted,
  },
  empty: {
    marginTop: Spacing.xs,
    fontSize: 15,
    color: Colors.mutedText,
  },
  linkRow: {
    minHeight: 48,
    justifyContent: 'center',
  },
  linkRowDivided: {
    marginTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  link: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.amber,
  },
});
