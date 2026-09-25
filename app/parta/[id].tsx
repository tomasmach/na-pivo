/**
 * Friend profile — pushed route `/parta/<id>` (Parta 3.0 §F1).
 *
 * A back-navigable "place" (matches /profile/edit, /settings) backed by
 * `GET /v1/friends/<id>`. It surfaces the shared history that makes the party
 * feel real — three amber stat tiles (GoingRoster numeral idiom), "Naposledy
 * spolu", and the recent shared štace — plus the dead-end killers: a prominent
 * "Ukaž na kompasu" when the friend is live now (geohash-8 handoff, never raw
 * GPS), and an overflow menu that hosts the safety actions (block / report /
 * remove).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';

import { GlowButton } from '@/components/shared/GlowButton';
import { showAppDialog } from '@/components/shared/AppDialog';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CompassIcon,
  BeerIcon,
  MenuIcon,
  FlameIcon,
  MapPinIcon,
  XIcon,
  UserPlusIcon,
} from '@/components/shared/IconGlyph';
import { fetchFriendBeerPhotos, type BeerPhoto } from '@/data/beerPhotosClient';
import {
  blockFriend,
  fetchFriendProfile,
  removeFriend,
  respondFriendRequest,
  sendFriendRequest,
  type FriendProfile,
  type FriendProfileDetail,
} from '@/data/friendsClient';
import { ScalePressable } from '@/photos/ScalePressable';
import { unlockedBadges } from '@/profile/badgeCatalog';
import { focusPubFromActivity } from '@/friends/focusPubHandoff';
import HairlineRow from '@/friends/HairlineRow';
import SectionHeader from '@/friends/SectionHeader';
import SkeletonBlock from '@/friends/SkeletonBlock';
import { Avatar } from '@/profile/Avatar';
import { pubCount } from '@/tours/TourChrome';
import { t, intlLocale } from '@/i18n';
import { useAccountStore } from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { useReduceMotion } from '@/utils/useReduceMotion';

type LoadState = 'loading' | 'loaded' | 'error';

/** Strip cap — mirrors PhotoDiarySection; the viewer shows one photo anyway. */
const FRIEND_PHOTO_STRIP_LIMIT = 12;

/** `@nickname` (preferred) → display name → a friendly fallback. */
function nameOf(profile: FriendProfile | null | undefined): string {
  if (!profile) return t.common.friendFallback;
  if (profile.nickname) return `@${profile.nickname}`;
  return profile.displayName || t.common.friendFallback;
}

/** "29. 6." short shared-visit stamp for the recent-together rows. */
function shortDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString(intlLocale, { day: 'numeric', month: 'numeric' });
}

interface StatTileProps {
  value: number;
  label: string;
  flame?: boolean;
}

/** One amber-numeral stat tile — the GoingRoster count idiom, not a card. */
function StatTile({ value, label, flame }: StatTileProps) {
  return (
    <View style={styles.statTile}>
      <View style={styles.statNumeralRow}>
        {flame ? <FlameIcon size={18} color={Colors.amber} /> : null}
        <Text style={styles.statNumeral} allowFontScaling={false} maxFontSizeMultiplier={FontScaleCap.display}>
          {value}
        </Text>
      </View>
      <Text style={styles.statLabel} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
        {label}
      </Text>
    </View>
  );
}

export default function FriendProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const showToast = useToastStore((s) => s.show);
  const reportProfileContent = useAccountStore((s) => s.reportProfileContent);

  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const accountId = useMemo(() => {
    const raw = params.id;
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === 'string' ? value : '';
  }, [params.id]);

  // Lazy init from the presence of an id so the effect never needs a synchronous
  // "loading" setState (would trip the cascading-render lint rule).
  const [state, setState] = useState<LoadState>(() => (accountId ? 'loading' : 'error'));
  const [detail, setDetail] = useState<FriendProfileDetail | null>(null);
  // Friends-visible diary photos; null (not allowed / failed) hides the section.
  const [friendPhotos, setFriendPhotos] = useState<BeerPhoto[] | null>(null);
  const [viewerPhoto, setViewerPhoto] = useState<BeerPhoto | null>(null);

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const load = useCallback(async () => {
    if (!accountId) return; // state already 'error' from lazy init
    // The photo gallery is additive — its failure (404 for non-friends /
    // private diary) must never take down the profile, so both fetches run in
    // parallel and only the profile drives the load state.
    const [result, photos] = await Promise.all([
      fetchFriendProfile(accountId),
      fetchFriendBeerPhotos(accountId),
    ]);
    if (!mountedRef.current) return;
    setDetail(result);
    setFriendPhotos(photos);
    setState(result ? 'loaded' : 'error');
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Retry is a user event, so setting "loading" here is safe.
  const retry = useCallback(() => {
    setState('loading');
    void load();
  }, [load]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/friends' as Href);
  }, [router]);

  const name = nameOf(detail?.profile);

  // "Ukaž na kompasu": prefer the live row, fall back to today's plan.
  const compassTarget = detail?.liveActivity ?? detail?.plan ?? null;
  const handleShowOnCompass = useCallback(() => {
    if (!compassTarget) return;
    if (focusPubFromActivity(compassTarget)) {
      router.push({ pathname: '/', params: { view: 'compass' } });
    }
  }, [compassTarget, router]);

  const doReport = useCallback(() => {
    void reportProfileContent({ targetAccountId: accountId, reason: 'other', comment: name }).then(
      (res) => {
        if (!mountedRef.current) return;
        showToast(res.ok ? t.friends.reportDone : res.detail || t.profile.edit.errorGeneric);
      },
    );
  }, [accountId, name, reportProfileContent, showToast]);

  const doBlock = useCallback(() => {
    void blockFriend(accountId).then((res) => {
      if (!mountedRef.current) return;
      if (res.ok) {
        showToast(t.friends.blocked);
        goBack();
      } else {
        showToast(res.detail);
      }
    });
  }, [accountId, goBack, showToast]);

  const doRemove = useCallback(() => {
    void removeFriend(accountId).then((res) => {
      if (!mountedRef.current) return;
      if (res.ok) {
        showToast(t.friends.friendRemoved);
        goBack();
      } else {
        showToast(res.detail);
      }
    });
  }, [accountId, goBack, showToast]);

  const confirmReport = useCallback(() => {
    showAppDialog({
      title: t.profile.report.confirmTitle,
      message: t.profile.report.confirmBody(name),
      buttons: [
        { text: t.common.cancel, style: 'cancel' },
        { text: t.profile.report.confirmSubmit, style: 'destructive', onPress: doReport },
      ],
    });
  }, [doReport, name]);

  const confirmBlock = useCallback(() => {
    showAppDialog({
      title: t.friends.blockTitle(name),
      message: t.friends.blockBody,
      buttons: [
        { text: t.common.cancel, style: 'cancel' },
        { text: t.friends.blockConfirm, style: 'destructive', onPress: doBlock },
      ],
    });
  }, [doBlock, name]);

  const confirmRemove = useCallback(() => {
    showAppDialog({
      title: t.friends.removeTitle,
      message: t.friends.removeBody(name),
      buttons: [
        { text: t.common.cancel, style: 'cancel' },
        { text: t.friends.removeConfirm, style: 'destructive', onPress: doRemove },
      ],
    });
  }, [doRemove, name]);

  const isFriend = detail?.friendshipStatus === 'accepted';

  const openOverflow = useCallback(() => {
    showAppDialog({
      title: t.friends.rowActionsTitle,
      buttons: [
        { text: t.friends.reportAction, onPress: confirmReport },
        { text: t.friends.blockAction, style: 'destructive', onPress: confirmBlock },
        // "Vyhodit z party" only makes sense for an actual friend.
        ...(isFriend
          ? [{ text: t.friends.profileRemove, style: 'destructive' as const, onPress: confirmRemove }]
          : []),
        { text: t.common.cancel, style: 'cancel' },
      ],
    });
  }, [confirmBlock, confirmRemove, confirmReport, isFriend]);

  // — Party CTA on a public (non-friend) profile — reached from Žebříčky.
  const [requestBusy, setRequestBusy] = useState(false);
  const sendRequest = useCallback(() => {
    if (requestBusy) return;
    setRequestBusy(true);
    void sendFriendRequest({ accountId }).then((res) => {
      if (!mountedRef.current) return;
      setRequestBusy(false);
      if (res.ok) {
        showToast(t.friends.requestSentToast);
        setDetail((prev) => (prev ? { ...prev, friendshipStatus: 'outgoing_pending' } : prev));
      } else {
        showToast(res.detail);
      }
    });
  }, [accountId, requestBusy, showToast]);

  const acceptRequest = useCallback(() => {
    const requestId = detail?.incomingRequestId;
    if (!requestId || requestBusy) return;
    setRequestBusy(true);
    void respondFriendRequest(requestId, 'accept').then((res) => {
      if (!mountedRef.current) return;
      setRequestBusy(false);
      if (res.ok) {
        showToast(t.friends.requestAcceptedToast);
        void load();
      } else {
        showToast(res.detail);
      }
    });
  }, [detail?.incomingRequestId, load, requestBusy, showToast]);

  const stats = detail?.stats;
  const recent = detail?.recentTogether ?? [];
  const latestBeers = detail?.latestBeers ?? [];
  const publicStats = detail?.publicStats ?? null;
  const showcase = detail?.achievements ? unlockedBadges(detail.achievements) : [];

  return (
    <View style={[styles.root, { paddingTop: insets.top + Spacing.sm }]}>
      {/* Header — back · centred @nickname · overflow */}
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t.friends.claimBack}
          style={({ pressed }) => [styles.headerBtn, pressed && styles.dim]}
        >
          <ChevronLeftIcon size={26} color={Colors.foam} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
          {state === 'loaded' ? name : ''}
        </Text>
        {state === 'loaded' ? (
          <Pressable
            onPress={openOverflow}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t.friends.profileActionsA11y}
            style={({ pressed }) => [styles.headerBtn, pressed && styles.dim]}
          >
            <MenuIcon size={22} color={Colors.foamMuted} />
          </Pressable>
        ) : (
          <View style={styles.headerBtn} />
        )}
      </View>

      {state === 'error' ? (
        <View style={styles.centerBlock}>
          <Text style={styles.errorText} maxFontSizeMultiplier={FontScaleCap.body}>
            {t.friends.profileError}
          </Text>
          <View style={styles.errorCta}>
            <GlowButton
              label={t.friends.retry}
              onPress={retry}
              variant="secondary"
              glow="none"
              height={50}
            />
          </View>
        </View>
      ) : state === 'loading' ? (
        <View style={styles.loadingWrap}>
          <SkeletonBlock width={88} height={88} radius={44} reduceMotion={reduceMotion} />
          <SkeletonBlock width={160} height={22} reduceMotion={reduceMotion} />
          <SkeletonBlock width="100%" height={74} reduceMotion={reduceMotion} />
          <SkeletonBlock width="100%" height={48} reduceMotion={reduceMotion} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xl }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Identity hero */}
          <View style={styles.hero}>
            <Avatar
              uri={detail?.profile.avatarUrl}
              nickname={detail?.profile.nickname}
              displayName={detail?.profile.displayName}
              size={76}
            />
            <Text style={styles.heroName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
              {name}
            </Text>
            {detail?.profile.displayName ? (
              <Text style={styles.heroDisplay} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                {detail.profile.displayName}
              </Text>
            ) : null}
          </View>

          {/* Live-now handoff to the compass */}
          {compassTarget ? (
            <View style={styles.compassWrap}>
              <GlowButton
                label={t.friends.showOnCompass}
                onPress={handleShowOnCompass}
                variant="primary"
                glow="soft"
                icon={<CompassIcon size={20} color={Colors.stout} />}
              />
            </View>
          ) : null}

          {/* Party CTA — a public stranger found via Žebříčky can be recruited. */}
          {detail && !isFriend ? (
            detail.friendshipStatus === 'outgoing_pending' ? (
              <Text style={styles.pendingStrip} maxFontSizeMultiplier={FontScaleCap.body}>
                {t.friends.requestPendingStrip}
              </Text>
            ) : (
              <View style={styles.compassWrap}>
                <GlowButton
                  label={
                    detail.friendshipStatus === 'incoming_pending'
                      ? t.friends.acceptRequest
                      : t.friends.addToParty
                  }
                  onPress={
                    detail.friendshipStatus === 'incoming_pending' ? acceptRequest : sendRequest
                  }
                  variant="primary"
                  glow="soft"
                  loading={requestBusy}
                  icon={<UserPlusIcon size={20} color={Colors.stout} />}
                />
              </View>
            )
          ) : null}

          {/* Stat tiles — shared history for a friend, public diary numbers for
              a stranger (never location, never individual beers). */}
          {isFriend ? (
            <View style={styles.statsRow}>
              <StatTile value={stats?.sharedPubCount ?? 0} label={t.friends.statSharedBeers} />
              <StatTile value={stats?.nightsTogether ?? 0} label={t.friends.statNightsTogether} />
              <StatTile
                value={stats?.streakWeeks ?? 0}
                label={t.friends.statStreakTogether}
                flame={(stats?.streakWeeks ?? 0) > 0}
              />
            </View>
          ) : publicStats ? (
            <View style={styles.statsRow}>
              <StatTile
                value={publicStats.totalBeers}
                label={t.friends.publicStatBeers(publicStats.totalBeers)}
              />
              <StatTile
                value={publicStats.distinctPubs}
                label={t.friends.publicStatPubs(publicStats.distinctPubs)}
              />
              <StatTile value={publicStats.mapperLevel} label={t.friends.publicStatMapper} />
            </View>
          ) : null}

          {/* Vitrína — unlocked badges only; a locked grid is nobody's business. */}
          {showcase.length > 0 ? (
            <View style={styles.recentSection}>
              <SectionHeader label={t.friends.showcaseHeader} />
              <View style={styles.showcaseWrap}>
                {showcase.map(({ key, title, Icon }) => (
                  <View key={key} style={styles.showcaseChip}>
                    <Icon size={14} color={Colors.amber} />
                    <Text
                      style={styles.showcaseChipText}
                      numberOfLines={1}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {title}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* Veřejné tour — who made which Tour de pub; each row opens the public copy. */}
          {detail?.publicTours.length ? (
            <View style={styles.recentSection}>
              <SectionHeader label={t.friends.publicToursHeader} />
              {detail.publicTours.map((tour, i) => (
                <HairlineRow key={tour.id} first={i === 0}>
                  <Pressable
                    onPress={() => router.push(`/t/${tour.token}` as Href)}
                    accessibilityRole="button"
                    accessibilityLabel={`${tour.title}. ${[tour.city, pubCount(tour.stopCount)].filter(Boolean).join(' · ')}`}
                    style={({ pressed }) => [styles.tourRow, pressed && styles.tourRowPressed]}
                  >
                    <View style={styles.tourText}>
                      <Text style={styles.tourTitle} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
                        {tour.title}
                      </Text>
                      <Text style={styles.recentDate} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                        {[tour.city, pubCount(tour.stopCount)].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <ChevronRightIcon size={16} color={Colors.mutedText} />
                  </Pressable>
                </HairlineRow>
              ))}
            </View>
          ) : null}

          {/* Naposledy spolu + recent štace — shared history is friends-only. */}
          {isFriend ? (
            <View style={styles.recentSection}>
              <SectionHeader label={t.friends.profileRecentHeader} />
              {stats?.lastPubName ? (
                <HairlineRow first>
                  <View style={styles.recentRow}>
                    <MapPinIcon size={16} color={Colors.amber} />
                    <Text style={styles.recentLead} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                      {t.friends.lastTogether(stats.lastPubName)}
                    </Text>
                  </View>
                </HairlineRow>
              ) : null}

              {recent.length > 0 ? (
                recent.map((row, i) => (
                  <HairlineRow key={`${row.cacheKey}-${i}`} first={!stats?.lastPubName && i === 0}>
                    <View style={styles.recentRow}>
                      <MapPinIcon size={16} color={Colors.mutedText} />
                      <Text style={styles.recentPub} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                        {row.pubName || '-'}
                      </Text>
                      {shortDate(row.at) ? (
                        <Text style={styles.recentDate} allowFontScaling={false}>
                          {shortDate(row.at)}
                        </Text>
                      ) : null}
                    </View>
                  </HairlineRow>
                ))
              ) : !stats?.lastPubName ? (
                <Text style={styles.emptyHistory} maxFontSizeMultiplier={FontScaleCap.body}>
                  {t.friends.profileNoHistory}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* Pivní fotky — friends-visible diary strip (hidden when empty).
              Virtualized + capped: the endpoint may return up to ~200 photos
              and a plain map would mount every image at once. */}
          {friendPhotos && friendPhotos.length > 0 ? (
            <View style={styles.recentSection}>
              <SectionHeader label={t.photoDiary.friendHeader(name)} />
              <FlatList
                horizontal
                data={friendPhotos.slice(0, FRIEND_PHOTO_STRIP_LIMIT)}
                keyExtractor={(photo) => photo.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.photoStrip}
                renderItem={({ item: photo }) => (
                  <ScalePressable
                    onPress={() => setViewerPhoto(photo)}
                    style={styles.photoThumb}
                    accessibilityRole="button"
                    accessibilityLabel={t.a11y.friendPhotoTile(name)}
                  >
                    <Image
                      source={{ uri: photo.imageUrl }}
                      style={StyleSheet.absoluteFill}
                      resizeMode="cover"
                      resizeMethod="resize"
                      accessibilityIgnoresInvertColors
                    />
                  </ScalePressable>
                )}
              />
            </View>
          ) : null}

          {latestBeers.length > 0 ? (
            <View style={styles.recentSection}>
              <SectionHeader label={t.beerCheckins.lastBeersHeader} />
              {latestBeers.map((beer, i) => (
                <HairlineRow
                  key={beer.id}
                  first={i === 0}
                  onPress={() =>
                    router.push({
                      pathname: '/beer-detail',
                      params: { beer: beer.beerName, brewery: beer.breweryName },
                    } as Href)
                  }
                >
                  <View style={styles.recentRow}>
                    <BeerIcon size={16} color={Colors.amber} />
                    <View style={styles.latestBeerText}>
                      <Text style={styles.recentPub} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                        {beer.beerName}
                      </Text>
                      <Text style={styles.latestBeerMeta} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                        {[beer.rating != null ? `${beer.rating.toFixed(1)} / 5` : '', beer.pubName, shortDate(beer.checkedInAt)]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>
                  </View>
                </HairlineRow>
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}

      {/* Fullscreen photo viewer — read-only (no actions apply to a friend's
          photo), so a plain modal beats reusing the own-photo detail route. */}
      <Modal
        visible={viewerPhoto != null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setViewerPhoto(null)}
      >
        <View style={styles.viewerBackdrop}>
          <Pressable
            onPress={() => setViewerPhoto(null)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t.a11y.photoViewerClose}
            style={({ pressed }) => [
              styles.viewerClose,
              { top: insets.top + Spacing.sm },
              pressed && styles.dim,
            ]}
          >
            <XIcon size={22} color={Colors.foam} />
          </Pressable>
          {viewerPhoto ? (
            <>
              <Image
                source={{ uri: viewerPhoto.imageUrl }}
                style={styles.viewerImage}
                resizeMode="contain"
                accessibilityIgnoresInvertColors
              />
              <View style={[styles.viewerMeta, { paddingBottom: insets.bottom + Spacing.lg }]}>
                {viewerPhoto.caption ? (
                  <Text style={styles.viewerCaption} maxFontSizeMultiplier={FontScaleCap.body}>
                    {viewerPhoto.caption}
                  </Text>
                ) : null}
                {viewerPhoto.pubName ? (
                  <View style={styles.viewerPubRow}>
                    <MapPinIcon size={14} color={Colors.amber} />
                    <Text style={styles.viewerPub} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                      {[viewerPhoto.pubName, viewerPhoto.pubCity].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                ) : null}
              </View>
            </>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
    paddingHorizontal: Spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  headerBtn: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
  },
  dim: {
    opacity: 0.6,
  },

  content: {
    paddingTop: Spacing.md,
  },

  // — Loading / error —
  loadingWrap: {
    alignItems: 'center',
    gap: Spacing.md,
    paddingTop: Spacing.xxl,
  },
  centerBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  errorText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 15,
    lineHeight: 21,
    color: Colors.mutedText,
    textAlign: 'center',
  },
  errorCta: {
    alignSelf: 'stretch',
    paddingHorizontal: Spacing.xl,
  },

  // — Identity hero —
  hero: {
    alignItems: 'center',
    gap: Spacing.xs,
  },
  heroName: {
    marginTop: Spacing.sm,
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    color: Colors.foam,
  },
  heroDisplay: {
    fontFamily: Fonts.ui.medium,
    fontSize: 15,
    color: Colors.foamMuted,
  },

  // — Compass handoff / party CTA —
  compassWrap: {
    marginTop: Spacing.xl,
  },
  pendingStrip: {
    marginTop: Spacing.xl,
    textAlign: 'center',
    fontFamily: Fonts.ui.medium,
    fontStyle: 'italic',
    fontSize: 13,
    color: Colors.mutedText,
  },

  // — Badge showcase —
  showcaseWrap: {
    marginTop: Spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  showcaseChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: Spacing.md - 2,
    borderRadius: 999,
    backgroundColor: withAlpha(Colors.amber, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.35),
  },
  showcaseChipText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    color: Colors.foam,
  },

  // — Stat tiles —
  statsRow: {
    marginTop: Spacing.xl,
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  statTile: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    gap: Spacing.xs,
  },
  statNumeralRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  statNumeral: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 30,
    color: Colors.amber,
    includeFontPadding: false,
  },
  statLabel: {
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.mutedText,
    textAlign: 'center',
  },

  // — Recent together —
  recentSection: {
    marginTop: Spacing.xl,
  },
  recentRow: {
    minHeight: HitArea.min - 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  recentLead: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.foam,
  },
  recentPub: {
    flex: 1,
    fontFamily: Fonts.ui.medium,
    fontSize: 14,
    color: Colors.foamMuted,
  },
  latestBeerText: {
    flex: 1,
    minWidth: 0,
  },
  latestBeerMeta: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: Colors.mutedText,
  },
  tourRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 56,
  },
  tourRowPressed: {
    opacity: 0.65,
  },
  tourText: {
    flex: 1,
    minWidth: 0,
  },
  tourTitle: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
  },
  recentDate: {
    flexShrink: 0,
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: Colors.mutedText,
  },
  emptyHistory: {
    marginTop: Spacing.sm,
    fontFamily: Fonts.ui.medium,
    fontStyle: 'italic',
    fontSize: 14,
    lineHeight: 20,
    color: Colors.mutedText,
  },

  // — Pivní fotky strip —
  photoStrip: {
    gap: Spacing.sm + 2,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  photoThumb: {
    width: 104,
    height: 132,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout3,
    overflow: 'hidden',
  },

  // — Fullscreen viewer —
  viewerBackdrop: {
    flex: 1,
    backgroundColor: Colors.stout,
  },
  viewerClose: {
    position: 'absolute',
    right: Spacing.lg,
    zIndex: 2,
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  viewerImage: {
    flex: 1,
  },
  viewerMeta: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    gap: Spacing.sm,
  },
  viewerCaption: {
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.foam,
  },
  viewerPubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  viewerPub: {
    flex: 1,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.foamMuted,
  },
});
