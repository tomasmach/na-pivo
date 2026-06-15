/**
 * Profile tab — the 4th tab, the user's beer-social identity surface.
 *
 * Signed in: identity header (avatar + @nickname + display name + edit pencil),
 * a public/private visibility badge, a 2×2 stats grid, real local-threshold
 * achievement badges, recent activity, and account/settings rows.
 *
 * Signed out: a "Založ si profil" hero with a primary CTA to /auth, but the
 * stats grid STAYS visible (local-first) so an anonymous user still sees their
 * real counts and a reason to claim an account.
 *
 * Stats are local-first (tallyStore + pubRatingsStore) so they work offline and
 * without an account; only NACHOZENO ("walked") is server-only, read off the raw
 * GET /v1/account/me usage block — absent → "—" so it never masquerades as a 0.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import { beerCountLabel } from '@/i18n/plural';
import { formatPrice } from '@/utils/currency';
import {
  PencilIcon,
  EyeIcon,
  EyeOffIcon,
  ChevronRightIcon,
  UserIcon,
  SettingsIcon,
  BeerIcon,
  MapPinIcon,
  ThumbsUpIcon,
  RadiusIcon,
  CoinsIcon,
  LockKeyholeIcon,
} from '@/components/shared/IconGlyph';
import { GlowButton } from '@/components/shared/GlowButton';
import { Avatar } from '@/profile/Avatar';
import {
  useAccountStore,
  selectIsSignedIn,
  selectNickname,
  selectAvatarUrl,
  selectIsPublic,
} from '@/stores/accountStore';
import { fetchWalkedDistanceM } from '@/data/auth';
import {
  useTallyStore,
  sessionCount,
  sessionTotalCzk,
  allSessionsNewestFirst,
  type TallySession,
} from '@/stores/tallyStore';
import { usePubRatingsStore } from '@/stores/pubRatingsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { eveningDateLabel } from '@/myBeers/eveningModel';

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
      <Text style={styles.statValue} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.display}>
        {value}
      </Text>
      <Text style={styles.statCaption} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
        {caption}
      </Text>
    </View>
  );
}

function Badge({
  icon,
  title,
  subtitle,
  unlocked,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  unlocked: boolean;
}) {
  return (
    <View style={styles.badge}>
      <View style={[styles.medallion, unlocked ? styles.medallionOn : styles.medallionOff]}>
        {unlocked ? (
          icon
        ) : (
          <LockKeyholeIcon size={20} color={Colors.mutedText} />
        )}
      </View>
      <Text
        style={[styles.badgeTitle, !unlocked && styles.badgeTitleLocked]}
        numberOfLines={2}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {title}
      </Text>
      <Text style={styles.badgeSubtitle} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
        {subtitle}
      </Text>
    </View>
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
  const count = sessionCount(session);
  const totalCzk = sessionTotalCzk(session);
  const summary = cs.myBeers.summary(beerCountLabel(count), formatPrice(totalCzk, priceCurrency));

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

function NavRow({
  icon,
  title,
  onPress,
  accessibilityLabel,
  borderTop,
}: {
  icon: React.ReactNode;
  title: string;
  onPress: () => void;
  accessibilityLabel: string;
  borderTop?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.navRow, borderTop && styles.rowBorderTop, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.navIconWell}>{icon}</View>
      <Text style={styles.navTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
        {title}
      </Text>
      <ChevronRightIcon size={16} color={Colors.mutedText} />
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

  const current = useTallyStore((s) => s.current);
  const history = useTallyStore((s) => s.history);
  const priceCurrency = useSettingsStore((s) => s.priceCurrency);
  const ratingsCount = usePubRatingsStore((s) => Object.keys(s.ratings).length);

  // Server-only walked distance, fetched once when signed in. Null until known;
  // gated by `isSignedIn` at render so a stale value never shows after sign-out
  // (the effect only ever performs the async fetch — no synchronous resets).
  const [walkedM, setWalkedM] = useState<number | null>(null);
  useEffect(() => {
    if (!isSignedIn) return;
    let active = true;
    void fetchWalkedDistanceM().then((m) => {
      if (active) setWalkedM(m);
    });
    return () => {
      active = false;
    };
  }, [isSignedIn]);

  const sessions = useMemo(
    () => allSessionsNewestFirst(current, history),
    [current, history],
  );
  const stats = useMemo(() => deriveStats(sessions), [sessions]);
  const recent = useMemo(() => sessions.slice(0, 3), [sessions]);
  const now = useMemo(() => new Date(), []);

  const displayName = profile?.displayName?.trim() || '';

  return (
    <View style={styles.root}>
      {/* Header — a tab screen, so no back button. */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.headerTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
          {cs.profile.title}
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + Spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        {isSignedIn ? (
          <>
            {/* ── Identity header card ── */}
            <View style={styles.identityCard}>
              <Avatar uri={avatarUrl} nickname={nickname} displayName={displayName} size={72} />
              <View style={styles.identityText}>
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
              </View>
              <Pressable
                onPress={() => router.push('/profile/edit')}
                style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={cs.a11y.profileEdit}
                hitSlop={6}
              >
                <PencilIcon size={18} color={Colors.amber} />
              </Pressable>
            </View>

            {/* ── Visibility badge ── */}
            <Pressable
              onPress={() => router.push('/profile/edit')}
              style={({ pressed }) => [
                styles.visibilityPill,
                isPublic ? styles.visibilityPublic : styles.visibilityPrivate,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
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
                onPress={() => router.push('/auth')}
                glow="soft"
                accessibilityLabel={cs.a11y.profileSignUp}
              />
            </View>
          </View>
        )}

        {/* ── Stats grid (always visible — local-first) ── */}
        <Text style={styles.sectionHeader}>{cs.profile.statsHeader}</Text>
        <View style={styles.statsGrid}>
          <StatTile
            icon={<BeerIcon size={18} color={Colors.amber} />}
            value={String(stats.totalBeers)}
            caption={cs.profile.statBeers}
          />
          <StatTile
            icon={<MapPinIcon size={18} color={Colors.amber} />}
            value={String(stats.distinctPubs)}
            caption={cs.profile.statPubs}
          />
          <StatTile
            icon={<ThumbsUpIcon size={18} color={Colors.amber} />}
            value={String(ratingsCount)}
            caption={cs.profile.statRatings}
          />
          <StatTile
            icon={<RadiusIcon size={18} color={Colors.amber} />}
            value={formatWalked(isSignedIn ? walkedM : null)}
            caption={cs.profile.statWalked}
          />
        </View>
        {/* Wide UTRACENO tile — the lifetime spend across every evening. */}
        <View style={styles.statWideTile}>
          <View style={styles.statIconWell}>
            <CoinsIcon size={18} color={Colors.amber} />
          </View>
          <Text style={styles.statWideValue} maxFontSizeMultiplier={FontScaleCap.display}>
            {formatPrice(stats.totalSpentCzk, priceCurrency)}
          </Text>
          <Text style={styles.statWideCaption} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.profile.statSpent}
          </Text>
        </View>

        {/* ── Achievements ── */}
        <Text style={styles.sectionHeader}>{cs.profile.achievementsHeader}</Text>
        <View style={styles.badgeRow}>
          <Badge
            icon={<BeerIcon size={20} color={Colors.amber} />}
            title={cs.profile.badgeFirstTenTitle}
            subtitle={cs.profile.badgeFirstTenLocked}
            unlocked={stats.totalBeers >= 10}
          />
          <Badge
            icon={<MapPinIcon size={20} color={Colors.amber} />}
            title={cs.profile.badgeRegularTitle}
            subtitle={cs.profile.badgeRegularLocked}
            unlocked={stats.maxVisitsToOnePub >= 5}
          />
          <Badge
            icon={<ThumbsUpIcon size={20} color={Colors.amber} />}
            title={cs.profile.badgeReviewerTitle}
            subtitle={cs.profile.badgeReviewerLocked}
            unlocked={ratingsCount >= 10}
          />
        </View>

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

        {/* ── Account & settings ── */}
        <View style={styles.listCard}>
          <NavRow
            icon={<UserIcon size={18} color={Colors.foamMuted} />}
            title={isSignedIn ? cs.profile.manageAccount : cs.profile.signedOutCta}
            onPress={() => router.push((isSignedIn ? '/account' : '/auth'))}
            accessibilityLabel={isSignedIn ? cs.a11y.profileManageAccount : cs.a11y.profileSignUp}
          />
          <NavRow
            icon={<SettingsIcon size={18} color={Colors.foamMuted} />}
            title={cs.profile.settingsRow}
            onPress={() => router.push('/settings')}
            accessibilityLabel={cs.a11y.profileSettings}
            borderTop
          />
        </View>
      </ScrollView>
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
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  headerTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 28,
    color: Colors.foam,
  },

  // ── Scroll ──
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm + 2,
  },

  // ── Identity card ──
  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 18,
  },
  identityText: {
    flex: 1,
    gap: 2,
  },
  nickname: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    color: Colors.foam,
  },
  displayName: {
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    color: Colors.foamMuted,
  },
  editButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.14),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.4),
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Visibility pill ──
  visibilityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    borderWidth: 1,
    marginLeft: 2,
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
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: withAlpha(Colors.amber, 0.14),
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 30,
    color: Colors.foam,
    marginTop: 2,
  },
  statCaption: {
    fontFamily: Fonts.ui.bold,
    fontSize: 10,
    letterSpacing: 1,
    color: Colors.mutedText,
  },
  statWideTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  statWideValue: {
    flex: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 26,
    color: Colors.foam,
  },
  statWideCaption: {
    fontFamily: Fonts.ui.bold,
    fontSize: 10,
    letterSpacing: 1,
    color: Colors.mutedText,
  },

  // ── Achievements ──
  badgeRow: {
    flexDirection: 'row',
    gap: Spacing.sm + 2,
  },
  badge: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
  },
  medallion: {
    width: 52,
    height: 52,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  medallionOn: {
    backgroundColor: withAlpha(Colors.amber, 0.18),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.5),
  },
  medallionOff: {
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  badgeTitle: {
    fontFamily: Fonts.display.bold,
    fontSize: 13,
    color: Colors.foam,
    textAlign: 'center',
  },
  badgeTitleLocked: {
    color: Colors.mutedText,
  },
  badgeSubtitle: {
    fontFamily: Fonts.ui.regular,
    fontSize: 11,
    lineHeight: 15,
    color: Colors.mutedText,
    textAlign: 'center',
  },

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

  // ── Nav rows ──
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    minHeight: 56,
  },
  navIconWell: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: Colors.stout3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
  },

  pressed: {
    opacity: 0.7,
  },
});
