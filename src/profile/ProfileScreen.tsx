/**
 * Profile tab — the 4th tab, the user's beer-social identity surface.
 *
 * Signed in: identity header (avatar + @nickname + display name + edit pencil),
 * a public/private visibility badge, a 2×2 stats grid, a dedicated achievement
 * showcase entry, recent activity, and account/settings rows.
 *
 * Signed out: a "Založ si profil" hero with a primary CTA to /auth, but the
 * stats grid STAYS visible (local-first) so an anonymous user still sees their
 * real counts and a reason to claim an account.
 *
 * Stats use backend account history when available, with local tally/rating
 * stores as the offline/anonymous fallback.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Linking } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { amberGlow } from '@/theme/shadows';
import { cs } from '@/i18n/cs';
import { formatPrice } from '@/utils/currency';
import {
  PencilIcon,
  EyeIcon,
  EyeOffIcon,
  ChevronRightIcon,
  SettingsIcon,
  BeerIcon,
  MapPinIcon,
  ThumbsUpIcon,
  RadiusIcon,
  CoinsIcon,
  SproutIcon,
  CompassIcon,
  MapPinnedIcon,
  StarIcon,
  TrophyIcon,
  QrCodeIcon,
  UsersIcon,
} from '@/components/shared/IconGlyph';
import { PhotoDiarySection } from '@/photos/PhotoDiarySection';
import { useReduceMotion } from '@/utils/useReduceMotion';
import { type AccountMapper } from '@/data/auth';
import { accountXpProgress, type AccountXpProgress } from '@/data/accountXp';
import { DiscordIcon, InstagramIcon, LinkedinIcon } from '@/components/shared/BrandIcon';
import { GlowButton } from '@/components/shared/GlowButton';
import CodeSheet from '@/friends/CodeSheet';
import { loadFriendsDashboardSnapshot } from '@/data/friendsSnapshot';
import { Avatar } from '@/profile/Avatar';
import {
  useAccountStore,
  selectIsSignedIn,
  selectNickname,
  selectAvatarUrl,
  selectIsPublic,
} from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';
import {
  useTallyStore,
  sessionCount,
  sessionTotalCzk,
  allSessionsNewestFirst,
  type TallySession,
} from '@/stores/tallyStore';
import { isContextPubKey } from '@/drinks/drinkTypes';
import { deriveReconciledDiaryStats } from '@/data/diarySync';
import { usePubRatingsStore } from '@/stores/pubRatingsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { eveningDateLabel, sessionDrinkSummary } from '@/myBeers/eveningModel';

// ─── Local stat derivations ─────────────────────────────────────────────────

interface DerivedStats {
  /** Total beers counted across every evening (current + history). */
  totalBeers: number;
  /** Distinct pubs visited (by pubKey). */
  distinctPubs: number;
  /** Most visits (distinct evenings) to a single pub — drives the "Stálý host" badge. */
  maxVisitsToOnePub: number;
  /** Total spent (CZK) across every evening. */
  totalSpentCzk: number;
}

function deriveStats(sessions: TallySession[]): DerivedStats {
  let totalBeers = 0;
  let totalSpentCzk = 0;
  const pubKeys = new Set<string>();
  // Each TallySession is one evening/visit, so count sessions per pub — not beers.
  const perPubVisits = new Map<string, number>();

  for (const session of sessions) {
    totalBeers += sessionCount(session);
    totalSpentCzk += sessionTotalCzk(session);
    // Outside evenings ("ctx:*") count as beers/spend but never as a pub —
    // distinct pubs and the Stálý host badge stay pub-only.
    if (isContextPubKey(session.pubKey)) continue;
    pubKeys.add(session.pubKey);
    perPubVisits.set(session.pubKey, (perPubVisits.get(session.pubKey) ?? 0) + 1);
  }

  let maxVisitsToOnePub = 0;
  for (const n of perPubVisits.values()) maxVisitsToOnePub = Math.max(maxVisitsToOnePub, n);

  return { totalBeers, distinctPubs: pubKeys.size, maxVisitsToOnePub, totalSpentCzk };
}

/** Walked distance in metres → Czech km string, or the "—" fallback when null. */
function formatWalked(metres: number | null): string {
  if (metres == null) return cs.profile.notAvailable;
  const km = metres / 1000;
  const text = km
    .toLocaleString('cs-CZ', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
    .replace(/ /g, ' ');
  return `${text} ${cs.profile.kmShort}`;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatTile({
  icon,
  value,
  caption,
}: {
  icon: React.ReactNode;
  value: string;
  caption: string;
}) {
  return (
    <View style={styles.statTile}>
      <View style={styles.statIconWell}>{icon}</View>
      <Text
        style={styles.statValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        maxFontSizeMultiplier={FontScaleCap.display}
      >
        {value}
      </Text>
      <Text style={styles.statCaption} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
        {caption}
      </Text>
    </View>
  );
}

/**
 * Featured "signature" stat — the lifetime beer count, the metric the whole app
 * is built around. Full-width with an oversized numeral so the eye lands here
 * first, before scanning the supporting grid below.
 */
function HeroStat({ value }: { value: number }) {
  return (
    <View style={styles.heroStat}>
      <View style={styles.heroStatIcon}>
        <BeerIcon size={26} color={Colors.amber} />
      </View>
      <View style={styles.heroStatText}>
        <Text
          style={styles.heroStatValue}
          numberOfLines={1}
          adjustsFontSizeToFit
          maxFontSizeMultiplier={FontScaleCap.display}
        >
          {value}
        </Text>
        <Text style={styles.heroStatCaption} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.profile.statBeers}
        </Text>
      </View>
    </View>
  );
}


/** The amber XP progress bar inside the account level card. Width animates from 0
 *  to the fill fraction, gated by reduce-motion. */
function XpBar({ fraction }: { fraction: number }) {
  const reduceMotion = useReduceMotion();
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const progress = useSharedValue(reduceMotion ? clamped : 0);
  useEffect(() => {
    progress.value = reduceMotion ? clamped : withTiming(clamped, { duration: 320 });
  }, [clamped, reduceMotion, progress]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  return (
    <View style={styles.xpTrack}>
      <Animated.View style={[styles.xpFill, amberGlow(6), fillStyle]} />
    </View>
  );
}

/**
 * Mapping stays a specialization with useful counters and badges, not a second
 * competing XP ladder. Its server-owned XP is included in the single account
 * level rendered above this section.
 */
function MapperSection({ mapper, signedIn }: { mapper: AccountMapper; signedIn: boolean }) {
  return (
    <>
      <Text style={styles.sectionHeader}>{cs.mapPub.mapperHeader}</Text>
      <View style={styles.statsGrid}>
        <StatTile
          icon={<MapPinnedIcon size={18} color={Colors.amber} />}
          value={String(mapper.distinctMappedPubs)}
          caption={cs.mapPub.mapperStatMappedPubs}
        />
        <StatTile
          icon={<CompassIcon size={18} color={Colors.amber} />}
          value={String(mapper.amenityVotesCount)}
          caption={cs.mapPub.mapperStatAnswers}
        />
        <StatTile
          icon={<SproutIcon size={18} color={Colors.amber} />}
          value={String(mapper.firstMapperCount)}
          caption={cs.mapPub.mapperStatFirstMaps}
        />
        <StatTile
          icon={<StarIcon size={18} color={Colors.amber} />}
          value={String(mapper.completedPubsCount)}
          caption={cs.mapPub.mapperStatCompleted}
        />
      </View>

      {/* The signed-out hint doubles as a reason to claim an account. */}
      {!signedIn && (
        <Text style={styles.mapperHint} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.mapPub.mapperSignedOut}
        </Text>
      )}
    </>
  );
}

/**
 * One account level fed by both diary and mapping contributions. The two legacy
 * server counters stay additive for released clients, but the product presents
 * one total, one bar and one title.
 */
function AccountLevelSection({ progress }: { progress: AccountXpProgress }) {
  const xpForNext = progress.xpForNextLevel;
  const isMaxed = xpForNext == null || xpForNext <= 0;
  const fraction = isMaxed ? 1 : progress.xpIntoLevel / xpForNext;
  const cur = progress.xpIntoLevel;
  const next = isMaxed ? progress.xpIntoLevel : xpForNext;
  const remaining = isMaxed ? 0 : Math.max(0, xpForNext - progress.xpIntoLevel);
  const progressText = isMaxed
    ? cs.mapPub.mapperXpTotal(progress.xp)
    : cs.mapPub.mapperXpProgress(cur, next);

  return (
    <>
      <Text style={styles.sectionHeader}>{cs.pivar.header}</Text>

      <View
        style={styles.levelCard}
        accessibilityLabel={cs.a11y.pivarLevel(
          progress.level,
          progress.title,
          isMaxed ? progress.xp : progress.xpIntoLevel,
          isMaxed ? null : xpForNext,
        )}
      >
        <View style={styles.levelHeaderRow}>
          <View style={styles.levelIconWell}>
            <BeerIcon size={22} color={Colors.amber} />
          </View>
          <Text style={styles.levelTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.pivar.level(progress.level, progress.title)}
          </Text>
        </View>

        <XpBar fraction={fraction} />

        <View style={styles.xpRow}>
          <Text style={styles.xpProgress} maxFontSizeMultiplier={FontScaleCap.body}>
            {progressText}
          </Text>
          <Text style={styles.xpToNext} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {isMaxed ? cs.mapPub.mapperXpMaxed : cs.mapPub.mapperXpToNext(remaining)}
          </Text>
        </View>
      </View>
    </>
  );
}

/** The empty MAPÉR state — shown when no backend mapper block exists yet. */
function MapperEmptySection({ signedIn }: { signedIn: boolean }) {
  return (
    <>
      <Text style={styles.sectionHeader}>{cs.mapPub.mapperHeader}</Text>
      <View style={styles.mapperEmptyCard}>
        <View style={styles.levelIconWell}>
          <SproutIcon size={22} color={Colors.amber} />
        </View>
        <Text style={styles.mapperEmptyText} maxFontSizeMultiplier={FontScaleCap.body}>
          {signedIn ? cs.mapPub.mapperEmpty : cs.mapPub.mapperSignedOut}
        </Text>
      </View>
    </>
  );
}

function RecentRow({
  session,
  now,
  onPress,
  borderTop,
}: {
  session: TallySession;
  now: Date;
  onPress: () => void;
  borderTop: boolean;
}) {
  const priceCurrency = useSettingsStore((s) => s.priceCurrency);
  const totalCzk = sessionTotalCzk(session);
  const summary = cs.myBeers.summary(sessionDrinkSummary(session), formatPrice(totalCzk, priceCurrency));

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.recentRow, borderTop && styles.rowBorderTop, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={cs.a11y.myBeersEvening(session.pubName, summary)}
    >
      <View style={styles.recentText}>
        <Text style={styles.recentDate} maxFontSizeMultiplier={FontScaleCap.body}>
          {eveningDateLabel(session.startedAt, now)}
        </Text>
        <Text style={styles.recentPub} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
          {session.pubName}
        </Text>
        <Text style={styles.recentSummary} maxFontSizeMultiplier={FontScaleCap.body}>
          {summary}
        </Text>
      </View>
      <ChevronRightIcon size={18} color={Colors.mutedText} />
    </Pressable>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const isSignedIn = useAccountStore(selectIsSignedIn);
  const profile = useAccountStore((s) => s.profile);
  const nickname = useAccountStore(selectNickname);
  const avatarUrl = useAccountStore(selectAvatarUrl);
  const isPublic = useAccountStore(selectIsPublic);
  const updateProfile = useAccountStore((s) => s.updateProfile);
  const showToast = useToastStore((s) => s.show);

  // Inline visibility flip — distinct from the edit pencil (full edit). The store
  // commits only on a successful PATCH, so the pill reflects the server truth; a
  // failure surfaces a toast and leaves the previous state untouched.
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  // Parta cross-link (§A2 entry point): "Můj kód" sheet + a friend-count row that
  // routes to the Správa party screen (see everyone / manage). The count is read
  // from the last dashboard snapshot so this stays a zero-network, offline-safe surface.
  const [codeVisible, setCodeVisible] = useState(false);
  const [partaCount, setPartaCount] = useState(0);
  useEffect(() => {
    let alive = true;
    void loadFriendsDashboardSnapshot().then((snap) => {
      if (alive && snap) setPartaCount(snap.dashboard.friends.length);
    });
    return () => {
      alive = false;
    };
  }, []);
  const handleToggleVisibility = useCallback(async () => {
    if (visibilityBusy) return;
    setVisibilityBusy(true);
    try {
      const result = await updateProfile({ isPublic: !isPublic });
      if (!result.ok) showToast(result.detail || cs.profile.edit.errorGeneric);
    } finally {
      setVisibilityBusy(false);
    }
  }, [visibilityBusy, isPublic, updateProfile, showToast]);

  const current = useTallyStore((s) => s.current);
  const history = useTallyStore((s) => s.history);
  const priceCurrency = useSettingsStore((s) => s.priceCurrency);
  const ratingsCount = usePubRatingsStore((s) => Object.keys(s.ratings).length);
  const diarySnapshot = useAccountStore((s) => {
    const snapshot = s.diarySnapshot;
    if (!snapshot || snapshot.accountId !== s.session?.accountId) return null;
    return snapshot.data;
  });

  const sessions = useMemo(
    () => allSessionsNewestFirst(current, history),
    [current, history],
  );
  const localStats = useMemo(() => deriveStats(sessions), [sessions]);
  const reconciledStats = useMemo(
    () => (diarySnapshot ? deriveReconciledDiaryStats(diarySnapshot, sessions) : null),
    [diarySnapshot, sessions],
  );
  const stats = useMemo(() => {
    const backend = profile?.stats;
    if (!isSignedIn) return localStats;
    if (reconciledStats) {
      return {
        ...reconciledStats,
        // The snapshot carries visits and drinks, while the profile aggregate
        // remains the compatibility fallback for accounts predating visit sync.
        distinctPubs: Math.max(reconciledStats.distinctPubs, backend?.distinctPubs ?? 0),
        maxVisitsToOnePub: Math.max(
          reconciledStats.maxVisitsToOnePub,
          backend?.maxVisitsToOnePub ?? 0,
        ),
      };
    }
    if (!backend) return localStats;
    return {
      // Local queues are intentionally offline-first. Right after a reconnect or
      // sign-in the backend snapshot can lag behind them, so totals must never
      // visibly shrink while those records are still waiting to sync.
      totalBeers: Math.max(backend.totalBeers, localStats.totalBeers),
      distinctPubs: Math.max(backend.distinctPubs, localStats.distinctPubs),
      maxVisitsToOnePub: Math.max(backend.maxVisitsToOnePub, localStats.maxVisitsToOnePub),
      totalSpentCzk: Math.max(backend.totalSpentCzk, localStats.totalSpentCzk),
    };
  }, [isSignedIn, localStats, profile?.stats, reconciledStats]);
  const totalRatings =
    isSignedIn && profile?.stats
      ? Math.max(profile.stats.ratingsCount, ratingsCount)
      : ratingsCount;
  const mapper = profile?.mapper;
  const pivar = profile?.pivar;
  const xpProgress = useMemo(() => accountXpProgress(mapper, pivar), [mapper, pivar]);
  const walkedM = isSignedIn ? profile?.usage?.walkedDistanceM ?? null : null;
  const recent = useMemo(() => sessions.slice(0, 3), [sessions]);
  const now = useMemo(() => new Date(), []);

  const displayName = profile?.displayName?.trim() || '';

  return (
    <View style={styles.root}>
      {/* Header — a tab screen, so no back button. The gear is the single entry
          into the unified settings hub (account management lives inside it). */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Text style={styles.headerTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
          {cs.profile.title}
        </Text>
        <Pressable
          onPress={() => router.push('/settings')}
          style={({ pressed }) => [styles.settingsButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.profileSettings}
          hitSlop={4}
        >
          <SettingsIcon size={22} color={Colors.foam} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + Spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        {isSignedIn ? (
          <>
            {/* ── Identity hero card ── */}
            <View style={styles.identityCard}>
              <View style={styles.avatarHalo}>
                <Avatar uri={avatarUrl} nickname={nickname} displayName={displayName} size={76} />
              </View>
              <Text
                style={styles.nickname}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.heading}
              >
                {nickname ? `@${nickname}` : cs.profile.noDisplayName}
              </Text>
              {!!displayName && (
                <Text
                  style={styles.displayName}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {displayName}
                </Text>
              )}

              {/* Action pair: full edit + inline visibility flip. */}
              <View style={styles.identityActions}>
                <Pressable
                  onPress={() => router.push('/profile/edit' as Href)}
                  style={({ pressed }) => [styles.editPill, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={cs.a11y.profileEdit}
                  hitSlop={4}
                >
                  <PencilIcon size={15} color={Colors.amber} />
                  <Text style={styles.editPillText} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.profile.editProfile}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleToggleVisibility}
                  disabled={visibilityBusy}
                  style={({ pressed }) => [
                    styles.visibilityPill,
                    isPublic ? styles.visibilityPublic : styles.visibilityPrivate,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: isPublic, busy: visibilityBusy }}
                  accessibilityLabel={cs.a11y.profileVisibility}
                  hitSlop={4}
                >
                  {isPublic ? (
                    <EyeIcon size={15} color={Colors.amber} />
                  ) : (
                    <EyeOffIcon size={15} color={Colors.mutedText} />
                  )}
                  <Text
                    style={[styles.visibilityText, !isPublic && styles.visibilityTextPrivate]}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {isPublic ? cs.profile.visibilityPublic : cs.profile.visibilityPrivate}
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* ── Parta cross-link: friend count → Správa party · "Můj kód" sheet ── */}
            <View style={styles.partaRow}>
              <Pressable
                onPress={() => router.push('/profile/parta' as Href)}
                style={({ pressed }) => [styles.partaCountArea, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={cs.profile.partaCount(partaCount)}
                hitSlop={4}
              >
                <UsersIcon size={17} color={Colors.amber} />
                <Text style={styles.partaCountText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.profile.partaCount(partaCount)}
                </Text>
                <ChevronRightIcon size={16} color={Colors.mutedText} />
              </Pressable>
              <Pressable
                onPress={() => setCodeVisible(true)}
                style={({ pressed }) => [styles.myCodePill, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={cs.profile.myCode}
                hitSlop={4}
              >
                <QrCodeIcon size={15} color={Colors.amber} />
                <Text style={styles.myCodePillText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.profile.myCode}
                </Text>
              </Pressable>
            </View>

          </>
        ) : (
          /* ── Signed-out hero ── */
          <View style={styles.heroCard}>
            <Avatar size={72} />
            <Text style={styles.heroTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.profile.signedOutTitle}
            </Text>
            <Text style={styles.heroBody} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.profile.signedOutBody}
            </Text>
            <View style={styles.heroCta}>
              <GlowButton
                label={cs.profile.signedOutCta}
                onPress={() => router.push('/auth' as Href)}
                glow="soft"
                accessibilityLabel={cs.a11y.profileSignUp}
              />
            </View>
          </View>
        )}

        <View style={styles.creatorCard}>
          <View style={styles.creatorCopy}>
            <Text style={styles.creatorEyebrow}>{cs.profile.creator.header}</Text>
            <Text style={styles.creatorTitle}>{cs.profile.creator.title}</Text>
            <Text style={styles.creatorBody}>{cs.profile.creator.subtitle}</Text>
          </View>
          <View style={styles.creatorLinks}>
            <Pressable
              onPress={() => void Linking.openURL(cs.profile.creator.instagramUrl)}
              style={({ pressed }) => [styles.creatorLink, pressed && styles.pressed]}
              accessibilityRole="link"
              accessibilityLabel={cs.profile.creator.instagram}
            >
              <InstagramIcon size={18} color={Colors.foam} />
              <Text style={styles.creatorLinkText}>{cs.profile.creator.instagram}</Text>
            </Pressable>
            <Pressable
              onPress={() => void Linking.openURL(cs.profile.creator.linkedinUrl)}
              style={({ pressed }) => [styles.creatorLink, pressed && styles.pressed]}
              accessibilityRole="link"
              accessibilityLabel={cs.profile.creator.linkedin}
            >
              <LinkedinIcon size={18} color={Colors.foam} />
              <Text style={styles.creatorLinkText}>{cs.profile.creator.linkedin}</Text>
            </Pressable>
            <Pressable
              onPress={() => void Linking.openURL(cs.profile.creator.discordUrl)}
              style={({ pressed }) => [styles.creatorLink, pressed && styles.pressed]}
              accessibilityRole="link"
              accessibilityLabel={cs.profile.creator.discord}
            >
              <DiscordIcon size={18} color={Colors.foam} />
              <Text style={styles.creatorLinkText}>{cs.profile.creator.discord}</Text>
            </Pressable>
          </View>
        </View>

        {/* ── Stats (always visible — local-first) ── */}
        <Text style={styles.sectionHeader}>{cs.profile.statsHeader}</Text>
        {/* Signature metric leads; supporting figures follow in a 2×2 grid. */}
        <HeroStat value={stats.totalBeers} />
        <View style={styles.statsGrid}>
          <StatTile
            icon={<MapPinIcon size={18} color={Colors.amber} />}
            value={String(stats.distinctPubs)}
            caption={cs.profile.statPubs}
          />
          <StatTile
            icon={<ThumbsUpIcon size={18} color={Colors.amber} />}
            value={String(totalRatings)}
            caption={cs.profile.statRatings}
          />
          <StatTile
            icon={<RadiusIcon size={18} color={Colors.amber} />}
            value={formatWalked(isSignedIn ? walkedM : null)}
            caption={cs.profile.statWalked}
          />
          <StatTile
            icon={<CoinsIcon size={18} color={Colors.amber} />}
            value={formatPrice(stats.totalSpentCzk, priceCurrency)}
            caption={cs.profile.statSpent}
          />
        </View>

        {/* Cross-link: where do these numbers put me countrywide? */}
        <Pressable
          onPress={() =>
            router.push({ pathname: '/leaderboards', params: { source: 'profile' } } as Href)
          }
          style={({ pressed }) => [styles.boardsLink, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.leaderboardsOpen}
        >
          <View style={styles.boardsLinkIcon}>
            <TrophyIcon size={20} color={Colors.amber} />
          </View>
          <View style={styles.boardsLinkText}>
            <Text style={styles.boardsLinkTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.leaderboards.entryProfileTitle}
            </Text>
            <Text
              style={styles.boardsLinkSubtitle}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {cs.leaderboards.entryProfileSubtitle}
            </Text>
          </View>
          <ChevronRightIcon size={18} color={Colors.mutedText} />
        </Pressable>

        {/* One account level: diary XP + mapping XP. */}
        {xpProgress ? <AccountLevelSection progress={xpProgress} /> : null}

        {/* ── Mapér (between TVOJE ČÍSLA and ODZNAKY) ── */}
        {mapper ? (
          <MapperSection mapper={mapper} signedIn={isSignedIn} />
        ) : (
          <MapperEmptySection signedIn={isSignedIn} />
        )}

        {/* ── Achievements are a destination, not a wall in the profile feed. */}
        <Pressable
          onPress={() => router.push('/profile/badges' as Href)}
          style={({ pressed }) => [styles.achievementCard, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={cs.profile.badgeCollectionTitle}
        >
          <View style={styles.achievementIconWell}>
            <TrophyIcon size={22} color={Colors.amber} />
          </View>
          <View style={styles.achievementText}>
            <Text style={styles.achievementEyebrow}>{cs.profile.achievementsHeader}</Text>
            <Text style={styles.achievementTitle}>{cs.profile.badgeCollectionTitle}</Text>
            <Text style={styles.achievementSubtitle}>{cs.profile.badgeCollectionCta}</Text>
          </View>
          <ChevronRightIcon size={18} color={Colors.mutedText} />
        </Pressable>

        {/* ── Pivní fotky (photo diary strip + capture flow) ── */}
        <PhotoDiarySection />

        {/* ── Recent activity (hidden when empty) ── */}
        {recent.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>{cs.profile.recentHeader}</Text>
            <View style={styles.listCard}>
              {recent.map((session, i) => (
                <RecentRow
                  key={`${session.pubKey}|${session.startedAt}`}
                  session={session}
                  now={now}
                  borderTop={i > 0}
                  onPress={() =>
                    router.push({ pathname: '/evening', params: { startedAt: session.startedAt } })
                  }
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {codeVisible ? <CodeSheet onClose={() => setCodeVisible(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  headerTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 28,
    color: Colors.foam,
  },
  settingsButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Scroll ──
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm + 2,
  },

  // ── Identity hero card ──
  identityCard: {
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  avatarHalo: {
    marginBottom: Spacing.xs,
  },
  nickname: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
    textAlign: 'center',
  },
  displayName: {
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    color: Colors.foamMuted,
    textAlign: 'center',
  },
  identityActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },

  // ── Parta cross-link row ──
  partaRow: {
    marginTop: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  partaCountArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
  },
  partaCountText: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.foam,
  },
  myCodePill: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.medium,
    backgroundColor: withAlpha(Colors.amber, 0.14),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.4),
  },
  myCodePillText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.amber,
  },

  creatorCard: {
    gap: Spacing.md,
    backgroundColor: Colors.stout3,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.3),
    padding: Spacing.lg,
  },
  creatorCopy: { gap: 3 },
  creatorEyebrow: {
    fontFamily: Fonts.ui.bold,
    fontSize: 10,
    letterSpacing: 1.3,
    color: Colors.amber,
  },
  creatorTitle: { fontFamily: Fonts.display.extrabold, fontSize: 20, color: Colors.foam },
  creatorBody: { fontFamily: Fonts.ui.regular, fontSize: 13, lineHeight: 18, color: Colors.foamMuted },
  creatorLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  creatorLink: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 42,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 7,
    borderRadius: Radius.medium,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  creatorLinkText: { fontFamily: Fonts.ui.semibold, fontSize: 13, color: Colors.foam },

  editPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.14),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.4),
  },
  editPillText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.amber,
  },

  // ── Visibility pill ──
  visibilityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  visibilityPublic: {
    backgroundColor: withAlpha(Colors.amber, 0.14),
    borderColor: withAlpha(Colors.amber, 0.4),
  },
  visibilityPrivate: {
    backgroundColor: Colors.stout3,
    borderColor: Colors.border,
  },
  visibilityText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.amber,
  },
  visibilityTextPrivate: {
    color: Colors.mutedText,
  },

  // ── Signed-out hero ──
  heroCard: {
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  heroTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    color: Colors.foam,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  heroBody: {
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    lineHeight: 21,
    color: Colors.foamMuted,
    textAlign: 'center',
    maxWidth: 300,
  },
  heroCta: {
    alignSelf: 'stretch',
    marginTop: Spacing.sm,
  },

  // ── Section header ──
  sectionHeader: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: Colors.amber,
    marginTop: Spacing.sm,
    marginLeft: 4,
  },

  // ── Hero stat (signature beer count) ──
  heroStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.35),
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  heroStatIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: withAlpha(Colors.amber, 0.16),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.4),
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroStatText: {
    flex: 1,
  },
  heroStatValue: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 44,
    lineHeight: 56,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  heroStatCaption: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: Colors.mutedText,
    marginTop: 2,
  },

  // ── Stats grid ──
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm + 2,
  },
  statTile: {
    // Two per row: half the row width minus half the gap.
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    gap: 6,
  },
  statIconWell: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: withAlpha(Colors.amber, 0.14),
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Value spans the full tile width (not inline beside the icon) so a wide
  // figure like "9 999,9 km" or "10 535 Kč" stays at full size instead of
  // shrinking — keeps numerals visually consistent across all tiles.
  statValue: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 28,
    color: Colors.foam,
    marginTop: 6,
    fontVariant: ['tabular-nums'],
  },
  statCaption: {
    fontFamily: Fonts.ui.bold,
    fontSize: 10,
    letterSpacing: 1,
    color: Colors.mutedText,
  },

  // ── Leaderboards cross-link ──
  boardsLink: {
    marginTop: Spacing.sm + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  boardsLinkIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: withAlpha(Colors.amber, 0.14),
    alignItems: 'center',
    justifyContent: 'center',
  },
  boardsLinkText: {
    flex: 1,
    gap: 2,
  },
  boardsLinkTitle: {
    fontFamily: Fonts.display.bold,
    fontSize: 16,
    color: Colors.foam,
  },
  boardsLinkSubtitle: {
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: Colors.mutedText,
  },

  // ── Mapér level card ──
  levelCard: {
    backgroundColor: Colors.stout3,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.25),
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  levelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  levelIconWell: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: withAlpha(Colors.amber, 0.16),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.4),
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelTitle: {
    flex: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
  },
  xpTrack: {
    height: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout,
    overflow: 'hidden',
  },
  xpFill: {
    height: '100%',
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  xpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  xpProgress: {
    fontFamily: Fonts.display.bold,
    fontSize: 13,
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },
  xpToNext: {
    flexShrink: 1,
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: Colors.mutedText,
    textAlign: 'right',
  },
  mapperHint: {
    fontFamily: Fonts.ui.regular,
    fontSize: 12,
    lineHeight: 17,
    color: Colors.mutedText,
    marginLeft: 4,
  },
  mapperEmptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
  },
  mapperEmptyText: {
    flex: 1,
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.mutedText,
  },

  achievementCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.sm,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.35),
    padding: Spacing.md,
  },
  achievementIconWell: { width: 48, height: 48, borderRadius: 15, backgroundColor: withAlpha(Colors.amber, 0.14), alignItems: 'center', justifyContent: 'center' },
  achievementText: { flex: 1, gap: 2 },
  achievementEyebrow: { fontFamily: Fonts.ui.bold, fontSize: 10, letterSpacing: 1.2, color: Colors.amber },
  achievementTitle: { fontFamily: Fonts.display.bold, fontSize: 17, color: Colors.foam },
  achievementSubtitle: { fontFamily: Fonts.ui.regular, fontSize: 12, color: Colors.mutedText },

  // ── List cards (recent + nav) ──
  listCard: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  rowBorderTop: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },

  // ── Recent rows ──
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    minHeight: 64,
  },
  recentText: {
    flex: 1,
    gap: 2,
  },
  recentDate: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 0.5,
    color: Colors.mutedText,
    textTransform: 'uppercase',
  },
  recentPub: {
    fontFamily: Fonts.display.bold,
    fontSize: 16,
    color: Colors.foam,
  },
  recentSummary: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.amber,
  },

  pressed: {
    opacity: 0.7,
  },
});
