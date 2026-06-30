/**
 * FriendsScreen — the premium "Parta 2.0" surface (layout spec §1–§12).
 *
 * One living table you watch fill: only what is happening *tonight* is elevated
 * and amber (my own broadcast card, friends' live cards), everything else breathes
 * in hairline rows on the bare stout ground. The screen is a single ScrollView with
 * an amber RefreshControl; every top-level group is wrapped in <Reveal> for a
 * mount-driven staggered entrance, and the inter-group rhythm is Spacing.xl while
 * stacks breathe at Spacing.sm.
 *
 * Section order (§1): Hero → OfflineBanner → MyActivityCard → TEĎ NA PIVU →
 * ČEKAJÍ NA TEBE → ŽEBŘÍČEK PARTY → PŘIDAT DO PARTY → KÁMOŠI → CINKLO V PARTĚ.
 *
 * State carries a dedicated `loadError` flag distinct from `dashboard` so a failed
 * fetch (OfflineBanner) is never misread as "you have no friends" — the last-known
 * dashboard stays rendered below the banner. Every mutating action (RSVP, accept,
 * decline, remove, end broadcast, settings change) reloads the dashboard silently.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  DEFAULT_FRIEND_SOCIAL_SETTINGS,
  fetchFriendsDashboard,
  markFriendNotificationsRead,
  removeFriend,
  respondFriendRequest,
  searchFriends,
  sendFriendRequest,
  type FriendProfile,
  type FriendsDashboard,
} from '@/data/friendsClient';
import { Avatar } from '@/profile/Avatar';
import {
  BellRingIcon,
  CheckIcon,
  EyeOffIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  Trash2Icon,
  TrophyIcon,
  UserPlusIcon,
  UsersIcon,
  XIcon,
} from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { useToastStore } from '@/stores/toastStore';

import FriendActiveCard from './FriendActiveCard';
import FriendSettingsSheet from './FriendSettingsSheet';
import FriendsSkeleton from './FriendsSkeleton';
import HairlineRow from './HairlineRow';
import { LeaderboardRow } from './LeaderboardRow';
import LiveDot from './LiveDot';
import LoopEmptyState from './LoopEmptyState';
import MyActivityCard from './MyActivityCard';
import OfflineBanner from './OfflineBanner';
import Reveal from './Reveal';
import SectionHeader from './SectionHeader';
import StreakBadge from './StreakBadge';

/** Leaderboard rows shown before the "+N dalších" cut (my row is always pinned). */
const LEADERBOARD_CAP = 8;
const ROUND_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 } as const;

/** `@nickname` (preferred) → display name → a friendly fallback. */
function displayName(profile: FriendProfile | null | undefined): string {
  if (!profile) return 'Kamarád';
  if (profile.nickname) return `@${profile.nickname}`;
  return profile.displayName || 'Kamarád';
}

/** Short cs-CZ "29. 6. 23:45" stamp for the notification feed. */
function timeLabel(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Avatar + resolved name — reused in requests, search results and the friend list. */
function FriendMini({ profile }: { profile: FriendProfile }) {
  return (
    <View style={styles.friendMini}>
      <Avatar
        uri={profile.avatarUrl}
        nickname={profile.nickname}
        displayName={profile.displayName}
        size={34}
      />
      <Text
        style={styles.friendMiniText}
        numberOfLines={1}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {displayName(profile)}
      </Text>
    </View>
  );
}

/** Crafted empty strip: icon + one organic line on bare stout, zero amber. */
function EmptyStrip({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <View style={styles.emptyStrip}>
      <View
        importantForAccessibility="no"
        accessibilityElementsHidden
        pointerEvents="none"
      >
        {icon}
      </View>
      <Text
        style={styles.emptyStripText}
        numberOfLines={3}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {text}
      </Text>
    </View>
  );
}

export default function FriendsScreen() {
  const insets = useSafeAreaInsets();
  const showToast = useToastStore((s) => s.show);

  const [dashboard, setDashboard] = useState<FriendsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Distinct from `dashboard`: a failed fetch must never read as "no friends".
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<FriendProfile[]>([]);
  const [settingsVisible, setSettingsVisible] = useState(false);

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // Last locally-confirmed social settings. `load()` prefers this over a
  // possibly-stale GET so a quiet-hours / ghost edit can't flash back to the
  // pre-edit value while the close-time reload races the just-sent PATCH.
  const settingsOverrideRef = useRef<FriendsDashboard['settings'] | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
      if (mode === 'refresh') setRefreshing(true);
      const next = await fetchFriendsDashboard();
      if (!mountedRef.current) return;
      if (next) {
        // Prefer the locally-confirmed settings over the fetched ones so an
        // in-flight settings edit never flashes back to a stale server value.
        const override = settingsOverrideRef.current;
        setDashboard(override ? { ...next, settings: override } : next);
        setLoadError(false);
        // Read-on-open only: silent post-mutation reloads must not consume the
        // unread feed (that's the open/refresh path's job).
        if (
          next.notifications.length &&
          (mode === 'initial' || mode === 'refresh')
        ) {
          void markFriendNotificationsRead(next.notifications.map((n) => n.id));
        }
      } else {
        // Keep the last-known dashboard rendered; only flip the error flag.
        setLoadError(true);
      }
      if (mode === 'initial') setLoading(false);
      if (mode === 'refresh') setRefreshing(false);
    },
    [],
  );

  useEffect(() => {
    // Kick the initial fetch off the synchronous effect pass (its setState resolves
    // after the await, inside a scheduled task) so the React Compiler doesn't read
    // it as a cascading-render trigger. The skeleton covers the one-tick gap.
    const kickoff = setTimeout(() => void load('initial'), 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  /** Stable "reload the dashboard" used by every mutating child (RSVP / end). */
  const reload = useCallback(() => {
    void load();
  }, [load]);

  const doSearch = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    const found = await searchFriends(q);
    if (!mountedRef.current) return;
    setSearching(false);
    setResults(found ?? []);
    if (found === null) {
      showToast(cs.friends.offline, {
        icon: <UsersIcon size={20} color={Colors.amber} />,
      });
    }
  }, [query, showToast]);

  const requestFriend = useCallback(
    async (profile?: FriendProfile) => {
      const result = profile
        ? await sendFriendRequest({ accountId: profile.id })
        : await sendFriendRequest({ nickname: query.trim().replace(/^@/, '') });
      if (!mountedRef.current) return;
      if (result.ok) {
        showToast(cs.friends.requestSent, {
          icon: <UserPlusIcon size={20} color={Colors.amber} />,
        });
        setQuery('');
        setResults([]);
        await load();
      } else {
        showToast(result.detail, { icon: <XIcon size={20} color={Colors.amber} /> });
      }
    },
    [load, query, showToast],
  );

  const respond = useCallback(
    async (id: string, action: 'accept' | 'decline') => {
      const result = await respondFriendRequest(id, action);
      if (result.ok) {
        showToast(
          action === 'accept' ? cs.friends.requestAccepted : cs.friends.requestDeclined,
          {
            icon:
              action === 'accept' ? (
                <CheckIcon size={20} color={Colors.amber} />
              ) : (
                <XIcon size={20} color={Colors.amber} />
              ),
          },
        );
        await load();
      } else {
        showToast(result.detail, { icon: <XIcon size={20} color={Colors.amber} /> });
      }
    },
    [load, showToast],
  );

  const confirmRemove = useCallback(
    (friend: FriendProfile) => {
      const name = displayName(friend);
      Alert.alert(cs.friends.removeTitle, cs.friends.removeBody(name), [
        { text: cs.common.cancel, style: 'cancel' },
        {
          text: cs.friends.removeConfirm,
          style: 'destructive',
          onPress: () => {
            void removeFriend(friend.id).then(async (result) => {
              if (!mountedRef.current) return;
              if (result.ok) {
                showToast(cs.friends.friendRemoved, {
                  icon: <Trash2Icon size={20} color={Colors.amber} />,
                });
                await load();
              } else {
                showToast(result.detail, {
                  icon: <XIcon size={20} color={Colors.amber} />,
                });
              }
            });
          },
        },
      ]);
    },
    [load, showToast],
  );

  const handleSettingsSaved = useCallback((next: FriendsDashboard['settings']) => {
    // Reflect the change locally at once and remember it as the override so the
    // close-time reload can't clobber it with a stale GET.
    settingsOverrideRef.current = next;
    setDashboard((prev) => (prev ? { ...prev, settings: next } : prev));
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsVisible(false);
    // Ghost mode flips active-feed visibility / streak server-side → resync.
    void load();
  }, [load]);

  // Dynamic hero sub-line: folds the live social-proof and the streak loss-aversion
  // into one line (priority order per §2), since the hero stays compact.
  const heroSub = useMemo<{ text: string; color: string }>(() => {
    if (!dashboard) return { text: '', color: Colors.mutedText };
    const myGoing = dashboard.myActiveActivity
      ? dashboard.myActiveActivity.responses.going
      : 0;
    const friendsLive = dashboard.activeFriends.length;
    const iAmLive = dashboard.myActiveActivity != null;

    if (iAmLive && myGoing > 0) {
      return { text: cs.friends.heroLiveMine(myGoing), color: Colors.foam };
    }
    if (
      dashboard.streak.currentWeeks > 0 &&
      !dashboard.streak.thisWeekLit &&
      friendsLive === 0 &&
      !iAmLive
    ) {
      return { text: cs.friends.heroStreakRisk, color: Colors.amberLight };
    }
    if (friendsLive >= 1) {
      return friendsLive === 1
        ? {
            text: cs.friends.heroFriendLive(displayName(dashboard.activeFriends[0].account)),
            color: Colors.foamMuted,
          }
        : { text: cs.friends.heroManyLive(friendsLive), color: Colors.foamMuted };
    }
    return { text: cs.friends.heroQuiet, color: Colors.mutedText };
  }, [dashboard]);

  const liveNow =
    dashboard != null &&
    (dashboard.activeFriends.length > 0 || dashboard.myActiveActivity != null);

  if (loading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
        <FriendsSkeleton />
      </View>
    );
  }

  const d = dashboard;
  const friendsLive = d ? d.activeFriends.length : 0;

  // Leaderboard slicing: top rows + a "+N dalších" line, but ALWAYS pin my row.
  const leaderboard = d?.leaderboard ?? [];
  const maxVisits = leaderboard.reduce((m, e) => Math.max(m, e.visits30d), 0);
  const visibleBoard = leaderboard.slice(0, LEADERBOARD_CAP);
  const hiddenCount = leaderboard.length - visibleBoard.length;
  const myIndex = leaderboard.findIndex((e) => e.isMe);
  const myPinned = hiddenCount > 0 && myIndex >= LEADERBOARD_CAP;

  // Running reveal index so the stagger stays tight regardless of absent sections.
  // A fresh per-render counter object (its property is mutated, the binding is
  // never reassigned) numbers only the sections that actually render while keeping
  // the React Compiler's immutability rule satisfied.
  const revealCounter = { next: 0 };
  const nextReveal = () => revealCounter.next++;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom + 18, 32) },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load('refresh')}
            tintColor={Colors.amber}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* §2 — Hero (compact masthead, no card, drawn straight on stout) */}
        <Reveal index={nextReveal()}>
          <View style={[styles.hero, { paddingTop: insets.top + 8 }]}>
            <View style={styles.heroRow1}>
              <View style={styles.heroTitleWrap}>
                <Text
                  style={styles.heroTitle}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.heading}
                >
                  {cs.friends.title}
                </Text>
                {/* The live pulse trails the wordmark — "Parta •" reads as alive,
                    instead of a stray dot stranded at the screen edge. */}
                {liveNow ? <LiveDot size={9} /> : null}
              </View>

              <View style={styles.heroRight}>
                {d ? <StreakBadge streak={d.streak} /> : null}
                {/* Ghost is a passive status, not a CTA — a compact amber-tinted
                    eye, not a wide pill that hijacks the masthead. Full label
                    still lives in the settings sheet it opens. */}
                {d?.settings.ghostMode ? (
                  <Pressable
                    onPress={() => setSettingsVisible(true)}
                    hitSlop={ROUND_HIT_SLOP}
                    accessibilityRole="button"
                    accessibilityLabel={cs.friends.ghostActive}
                    style={({ pressed }) => [styles.ghostIconBtn, pressed && styles.dim]}
                  >
                    <EyeOffIcon size={18} color={Colors.amberLight} />
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => setSettingsVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel={cs.friends.settingsOpen}
                  style={({ pressed }) => [styles.gear, pressed && styles.dim]}
                >
                  <SettingsIcon size={22} color={Colors.mutedText} />
                </Pressable>
              </View>
            </View>

            {d ? (
              <Text
                style={[styles.heroSubline, { color: heroSub.color }]}
                numberOfLines={2}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {heroSub.text}
              </Text>
            ) : null}

            <View style={styles.heroRule} />
          </View>
        </Reveal>

        {/* §11 — OfflineBanner (only on a failed/stale fetch; data stays below) */}
        {loadError ? (
          <Reveal index={nextReveal()}>
            <View style={styles.section}>
              <OfflineBanner onRetry={() => void load('refresh')} />
            </View>
          </Reveal>
        ) : null}

        {/* §3 — MyActivityCard: my own live broadcast, the one card with a glow */}
        {d?.myActiveActivity ? (
          <Reveal index={nextReveal()}>
            <View style={styles.section}>
              <MyActivityCard activity={d.myActiveActivity} onEnded={reload} />
            </View>
          </Reveal>
        ) : null}

        {/* §4 — TEĎ NA PIVU: the decision surface (friends' live cards) */}
        {d ? (
          <Reveal index={nextReveal()}>
            <View style={styles.section}>
              <SectionHeader label={cs.friends.activeHeader} live={friendsLive > 0} />
              {friendsLive > 0 ? (
                <View style={styles.stack}>
                  {d.activeFriends.map((activity) => (
                    <FriendActiveCard
                      key={activity.id}
                      activity={activity}
                      onResponded={reload}
                    />
                  ))}
                </View>
              ) : d.myActiveActivity ? (
                <Text
                  style={styles.subtleNote}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {cs.friends.emptyActiveBroadcasting}
                </Text>
              ) : (
                <LoopEmptyState />
              )}
            </View>
          </Reveal>
        ) : null}

        {/* §5 — ČEKAJÍ NA TEBE: incoming requests (a11y accept / decline) */}
        {d && d.incomingRequests.length > 0 ? (
          <Reveal index={nextReveal()}>
            <View style={styles.section}>
              <SectionHeader label={cs.friends.requestsHeader} />
              <View>
                {d.incomingRequests.map((request, i) => (
                  <HairlineRow key={request.id} first={i === 0}>
                    <View style={styles.requestRow}>
                      <FriendMini profile={request.requester} />
                      <View style={styles.requestActions}>
                        <Pressable
                          onPress={() => void respond(request.id, 'decline')}
                          hitSlop={ROUND_HIT_SLOP}
                          accessibilityRole="button"
                          accessibilityLabel={cs.friends.decline}
                          style={({ pressed }) => [styles.declineBtn, pressed && styles.dim]}
                        >
                          <XIcon size={18} color={Colors.foam} />
                        </Pressable>
                        <Pressable
                          onPress={() => void respond(request.id, 'accept')}
                          hitSlop={ROUND_HIT_SLOP}
                          accessibilityRole="button"
                          accessibilityLabel={cs.friends.accept}
                          style={({ pressed }) => [styles.acceptBtn, pressed && styles.dim]}
                        >
                          <CheckIcon size={18} color={Colors.stout} />
                        </Pressable>
                      </View>
                    </View>
                  </HairlineRow>
                ))}
              </View>
            </View>
          </Reveal>
        ) : null}

        {/* §8 — ŽEBŘÍČEK PARTY: hairline rows on bare stout, my row pinned */}
        {d ? (
          <Reveal index={nextReveal()}>
            <View style={styles.section}>
              <SectionHeader label={cs.friends.leaderboardHeader} />
              {leaderboard.length <= 1 ? (
                <EmptyStrip
                  icon={<TrophyIcon size={28} color={Colors.mutedText} />}
                  text={cs.friends.leaderboardEmpty}
                />
              ) : (
                <View>
                  {visibleBoard.map((entry, i) => (
                    <LeaderboardRow
                      key={entry.account.id || `rank-${i}`}
                      entry={entry}
                      rank={i + 1}
                      maxVisits={maxVisits}
                    />
                  ))}
                  {hiddenCount > 0 ? (
                    <Text
                      style={styles.moreLine}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {cs.friends.leaderboardMore(hiddenCount)}
                    </Text>
                  ) : null}
                  {myPinned && myIndex >= 0 ? (
                    <>
                      <Text
                        style={styles.dividerDots}
                        allowFontScaling={false}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      >
                        …
                      </Text>
                      <LeaderboardRow
                        key="me-pinned"
                        entry={leaderboard[myIndex]}
                        rank={myIndex + 1}
                        maxVisits={maxVisits}
                      />
                    </>
                  ) : null}
                </View>
              )}
            </View>
          </Reveal>
        ) : null}

        {/* §7 — PŘIDAT DO PARTY: search/add, restyled to the hairline rhythm */}
        {d ? (
          <Reveal index={nextReveal()}>
            <View style={styles.section}>
              <SectionHeader label={cs.friends.addHeader} />
              <View style={styles.searchRow}>
                <SearchIcon size={19} color={Colors.mutedText} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={cs.friends.searchPlaceholder}
                  placeholderTextColor={Colors.mutedText}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.searchInput}
                  returnKeyType="search"
                  onSubmitEditing={() => void doSearch()}
                  maxFontSizeMultiplier={FontScaleCap.body}
                />
                <Pressable
                  onPress={() => void doSearch()}
                  accessibilityRole="button"
                  accessibilityLabel={cs.friends.searchCta}
                  style={({ pressed }) => [styles.searchButton, pressed && styles.dim]}
                >
                  {searching ? (
                    <ActivityIndicator color={Colors.stout} size="small" />
                  ) : (
                    <Text
                      style={styles.searchButtonText}
                      maxFontSizeMultiplier={FontScaleCap.heading}
                    >
                      {cs.friends.searchCta}
                    </Text>
                  )}
                </Pressable>
              </View>

              {results.length > 0 ? (
                <View style={styles.searchResults}>
                  {results.map((profile, i) => (
                    <HairlineRow key={profile.id} first={i === 0}>
                      <View style={styles.searchResultRow}>
                        <FriendMini profile={profile} />
                        <Pressable
                          onPress={() => void requestFriend(profile)}
                          hitSlop={ROUND_HIT_SLOP}
                          accessibilityRole="button"
                          accessibilityLabel={cs.friends.addByNickname}
                          style={({ pressed }) => [styles.addBtn, pressed && styles.dim]}
                        >
                          <PlusIcon size={18} color={Colors.stout} />
                        </Pressable>
                      </View>
                    </HairlineRow>
                  ))}
                </View>
              ) : null}

              {query.trim().length >= 2 && results.length === 0 && !searching ? (
                <HairlineRow first onPress={() => void requestFriend()}>
                  <View style={styles.nicknameInvite}>
                    <UserPlusIcon size={18} color={Colors.amber} />
                    <Text
                      style={styles.nicknameInviteText}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {cs.friends.addByNickname}
                    </Text>
                  </View>
                </HairlineRow>
              ) : null}
            </View>
          </Reveal>
        ) : null}

        {/* §8 — KÁMOŠI: hairline row per friend; outgoing invites in the footer */}
        {d ? (
          <Reveal index={nextReveal()}>
            <View style={styles.section}>
              <SectionHeader label={cs.friends.friendsHeader} />
              {d.friends.length > 0 ? (
                <View>
                  {d.friends.map((friend, i) => {
                    const stats = d.friendStats[friend.id];
                    return (
                      <HairlineRow key={friend.id} first={i === 0}>
                        <View style={styles.friendRow}>
                          <View style={styles.friendRowTop}>
                            <FriendMini profile={friend} />
                            <Pressable
                              onPress={() => confirmRemove(friend)}
                              hitSlop={ROUND_HIT_SLOP}
                              accessibilityRole="button"
                              accessibilityLabel={cs.friends.remove}
                              style={({ pressed }) => [styles.removeBtn, pressed && styles.dim]}
                            >
                              <Trash2Icon size={18} color={Colors.mutedText} />
                            </Pressable>
                          </View>
                          <Text
                            style={styles.sharedCount}
                            numberOfLines={1}
                            maxFontSizeMultiplier={FontScaleCap.heading}
                          >
                            {cs.friends.sharedCount(stats?.sharedPubCount ?? 0)}
                          </Text>
                          {stats?.lastPubName ? (
                            <Text
                              style={styles.lastTogether}
                              numberOfLines={1}
                              maxFontSizeMultiplier={FontScaleCap.body}
                            >
                              {cs.friends.lastTogether(stats.lastPubName)}
                            </Text>
                          ) : null}
                          {stats?.rituals.length ? (
                            <View style={styles.ritualRow}>
                              {stats.rituals.map((ritual) => (
                                <View key={ritual.key} style={styles.ritualChip}>
                                  <Text
                                    style={styles.ritualText}
                                    maxFontSizeMultiplier={FontScaleCap.body}
                                  >
                                    {ritual.title}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          ) : null}
                        </View>
                      </HairlineRow>
                    );
                  })}
                </View>
              ) : (
                <EmptyStrip
                  icon={<UserPlusIcon size={28} color={Colors.mutedText} />}
                  text={cs.friends.emptyFriends}
                />
              )}

              {d.outgoingRequests.length > 0 ? (
                <View style={styles.outgoingWrap}>
                  <Text
                    style={styles.outgoingLabel}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.heading}
                  >
                    {cs.friends.outgoingHeader}
                  </Text>
                  <View style={styles.outgoingRow}>
                    {d.outgoingRequests.map((request) => (
                      <View key={request.id} style={styles.outgoingChip}>
                        <Text
                          style={styles.outgoingText}
                          numberOfLines={1}
                          maxFontSizeMultiplier={FontScaleCap.body}
                        >
                          {displayName(request.recipient)}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          </Reveal>
        ) : null}

        {/* §9 — CINKLO V PARTĚ: ambient notification feed (read-on-open, no badge) */}
        {d && d.notifications.length > 0 ? (
          <Reveal index={nextReveal()}>
            <View style={styles.section}>
              <SectionHeader label={cs.friends.feedHeader} />
              <View>
                {d.notifications.slice(0, 6).map((notification, i) => {
                  const when = timeLabel(notification.createdAt);
                  return (
                    <HairlineRow key={notification.id} first={i === 0}>
                      <View style={styles.feedRow}>
                        <BellRingIcon
                          size={18}
                          color={notification.readAt ? Colors.mutedText : Colors.amber}
                        />
                        <View style={styles.feedText}>
                          <View style={styles.feedTitleRow}>
                            <Text
                              style={styles.feedTitle}
                              numberOfLines={1}
                              maxFontSizeMultiplier={FontScaleCap.body}
                            >
                              {notification.title}
                            </Text>
                            {when ? (
                              <Text
                                style={styles.feedTime}
                                numberOfLines={1}
                                allowFontScaling={false}
                              >
                                {when}
                              </Text>
                            ) : null}
                          </View>
                          <Text
                            style={styles.feedBody}
                            numberOfLines={2}
                            maxFontSizeMultiplier={FontScaleCap.body}
                          >
                            {notification.body}
                          </Text>
                        </View>
                      </View>
                    </HairlineRow>
                  );
                })}
              </View>
            </View>
          </Reveal>
        ) : null}
      </ScrollView>

      <FriendSettingsSheet
        visible={settingsVisible}
        onClose={closeSettings}
        settings={d?.settings ?? DEFAULT_FRIEND_SOCIAL_SETTINGS}
        onSaved={handleSettingsSaved}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },

  // — Hero —
  hero: {
    paddingBottom: Spacing.md,
  },
  heroRow1: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  heroTitleWrap: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  heroTitle: {
    flexShrink: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -0.5,
    color: Colors.foam,
  },
  heroRight: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  gear: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostIconBtn: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.28),
  },
  heroSubline: {
    marginTop: Spacing.sm,
    fontFamily: Fonts.ui.medium,
    fontSize: 15,
    lineHeight: 21,
  },
  heroRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: withAlpha(Colors.border, 0.6),
    marginTop: Spacing.md,
    marginHorizontal: -Spacing.lg,
  },

  // — Section rhythm —
  section: {
    marginTop: Spacing.xl,
  },
  stack: {
    gap: Spacing.sm,
  },
  dim: {
    opacity: 0.6,
  },
  subtleNote: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
  },

  // — Requests —
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  requestActions: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  acceptBtn: {
    width: HitArea.min,
    height: HitArea.min,
    borderRadius: HitArea.min / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  declineBtn: {
    width: HitArea.min,
    height: HitArea.min,
    borderRadius: HitArea.min / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.08),
  },

  // — Empty strips (leaderboard / friends) —
  emptyStrip: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    gap: Spacing.sm,
  },
  emptyStripText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 14,
    lineHeight: 19,
    color: Colors.mutedText,
    textAlign: 'center',
  },

  // — Leaderboard —
  moreLine: {
    marginTop: Spacing.sm,
    paddingHorizontal: 10,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
  },
  dividerDots: {
    marginTop: Spacing.xs,
    textAlign: 'center',
    fontFamily: Fonts.display.semibold,
    fontSize: 16,
    color: Colors.mutedText,
  },

  // — Search / add —
  searchRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingLeft: Spacing.md,
    paddingRight: 6,
  },
  searchInput: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    color: Colors.foam,
    fontSize: 16,
    paddingVertical: 12,
  },
  searchButton: {
    minWidth: 76,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  searchButtonText: {
    fontFamily: Fonts.display.extrabold,
    color: Colors.stout,
    fontSize: 15,
  },
  searchResults: {
    marginTop: Spacing.sm,
  },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  addBtn: {
    width: HitArea.min,
    height: HitArea.min,
    borderRadius: HitArea.min / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  nicknameInvite: {
    minHeight: HitArea.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  nicknameInviteText: {
    fontFamily: Fonts.ui.semibold,
    color: Colors.amber,
    fontSize: 15,
  },

  // — Friends list —
  friendRow: {
    gap: Spacing.sm,
  },
  friendRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  removeBtn: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sharedCount: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
  },
  lastTogether: {
    fontFamily: Fonts.ui.medium,
    fontSize: 14,
    color: Colors.foamMuted,
  },
  ritualRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  ritualChip: {
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.25),
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  ritualText: {
    fontFamily: Fonts.ui.semibold,
    color: Colors.amber,
    fontSize: 12,
  },

  // — Outgoing invites (KÁMOŠI footer) —
  outgoingWrap: {
    marginTop: Spacing.md,
  },
  outgoingLabel: {
    marginBottom: Spacing.sm,
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: Colors.mutedText,
  },
  outgoingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  outgoingChip: {
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.08),
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  outgoingText: {
    fontFamily: Fonts.ui.semibold,
    color: Colors.foamMuted,
    fontSize: 13,
  },

  // — Notification feed —
  feedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  feedText: {
    flex: 1,
    minWidth: 0,
  },
  feedTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  feedTitle: {
    flex: 1,
    fontFamily: Fonts.ui.bold,
    color: Colors.foam,
    fontSize: 14,
  },
  feedTime: {
    flexShrink: 0,
    fontFamily: Fonts.ui.medium,
    color: Colors.mutedText,
    fontSize: 11,
  },
  feedBody: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    color: Colors.foamMuted,
    fontSize: 13,
    lineHeight: 18,
  },

  // — Local FriendMini —
  friendMini: {
    minWidth: 0,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  friendMiniText: {
    flexShrink: 1,
    fontFamily: Fonts.ui.bold,
    color: Colors.foam,
    fontSize: 15,
  },
});
