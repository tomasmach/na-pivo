import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  fetchFriendsDashboard,
  markFriendNotificationsRead,
  removeFriend,
  respondFriendRequest,
  searchFriends,
  sendFriendRequest,
  type FriendNotification,
  type FriendProfile,
  type FriendsDashboard,
} from '@/data/friendsClient';
import { Avatar } from '@/profile/Avatar';
import { GlowButton } from '@/components/shared/GlowButton';
import {
  BellRingIcon,
  CheckIcon,
  MessageSquareIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  UserPlusIcon,
  UsersIcon,
  XIcon,
} from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { amberGlow, softDrop } from '@/theme/shadows';
import { useToastStore } from '@/stores/toastStore';

function displayName(profile: FriendProfile | null | undefined): string {
  if (!profile) return 'Kamarád';
  if (profile.nickname) return `@${profile.nickname}`;
  return profile.displayName || 'Kamarád';
}

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

function FriendMini({ profile }: { profile: FriendProfile }) {
  return (
    <View style={styles.friendMini}>
      <Avatar
        uri={profile.avatarUrl}
        nickname={profile.nickname}
        displayName={profile.displayName}
        size={34}
      />
      <Text style={styles.friendMiniText} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
        {displayName(profile)}
      </Text>
    </View>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyText} maxFontSizeMultiplier={FontScaleCap.body}>
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
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<FriendProfile[]>([]);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'refresh') => {
    if (mode !== 'initial') setRefreshing(true);
    const next = await fetchFriendsDashboard();
    setDashboard(next);
    setLoading(false);
    setRefreshing(false);
    if (next?.notifications.length) {
      void markFriendNotificationsRead(next.notifications.map((n) => n.id));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchFriendsDashboard().then((next) => {
      if (cancelled) return;
      setDashboard(next);
      setLoading(false);
      if (next?.notifications.length) {
        void markFriendNotificationsRead(next.notifications.map((n) => n.id));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const doSearch = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    const found = await searchFriends(q);
    setSearching(false);
    setResults(found ?? []);
    if (found === null) showToast(cs.friends.offline, { icon: <UsersIcon size={20} color={Colors.amber} /> });
  }, [query, showToast]);

  const requestFriend = useCallback(
    async (profile?: FriendProfile) => {
      const result = profile
        ? await sendFriendRequest({ accountId: profile.id })
        : await sendFriendRequest({ nickname: query.trim().replace(/^@/, '') });
      if (result.ok) {
        showToast(cs.friends.requestSent, { icon: <UserPlusIcon size={20} color={Colors.amber} /> });
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
        showToast(action === 'accept' ? cs.friends.requestAccepted : cs.friends.requestDeclined, {
          icon: action === 'accept' ? <CheckIcon size={20} color={Colors.amber} /> : <XIcon size={20} color={Colors.amber} />,
        });
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
              if (result.ok) {
                showToast(cs.friends.friendRemoved, { icon: <Trash2Icon size={20} color={Colors.amber} /> });
                await load();
              } else {
                showToast(result.detail, { icon: <XIcon size={20} color={Colors.amber} /> });
              }
            });
          },
        },
      ]);
    },
    [load, showToast],
  );

  const activeNames = useMemo(() => {
    const active = dashboard?.activeFriends ?? [];
    return active.slice(0, 3).map((a) => displayName(a.account));
  }, [dashboard]);

  if (loading) {
    return (
      <View style={[styles.root, styles.loading, { paddingTop: insets.top }]}>
        <ActivityIndicator color={Colors.amber} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 18, 32) }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load()}
            tintColor={Colors.amber}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, softDrop()]}>
          <View style={styles.heroTop}>
            <View style={[styles.heroIcon, amberGlow(12)]}>
              <UsersIcon size={26} color={Colors.amber} />
            </View>
            <Text style={styles.heroKicker} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.friends.title}
            </Text>
          </View>
          <Text style={styles.heroTitle} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.friends.heroTitle}
          </Text>
          <Text style={styles.heroBody} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.friends.heroBody}
          </Text>
          {activeNames.length > 0 && (
            <View style={styles.liveStrip}>
              <BellRingIcon size={17} color={Colors.amber} />
              <Text style={styles.liveStripText} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                {activeNames.join(', ')}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.searchBlock}>
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
              onSubmitEditing={doSearch}
            />
            <Pressable onPress={doSearch} style={styles.searchButton} accessibilityRole="button">
              {searching ? (
                <ActivityIndicator color={Colors.stout} size="small" />
              ) : (
                <Text style={styles.searchButtonText}>{cs.friends.searchCta}</Text>
              )}
            </Pressable>
          </View>
          {results.length > 0 && (
            <View style={styles.searchResults}>
              {results.map((profile) => (
                <View key={profile.id} style={styles.searchResultRow}>
                  <FriendMini profile={profile} />
                  <Pressable
                    onPress={() => void requestFriend(profile)}
                    style={styles.iconButton}
                    accessibilityRole="button"
                  >
                    <PlusIcon size={18} color={Colors.stout} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          {query.trim().length >= 2 && results.length === 0 && !searching && (
            <Pressable
              onPress={() => void requestFriend()}
              style={styles.nicknameInvite}
              accessibilityRole="button"
            >
              <UserPlusIcon size={18} color={Colors.amber} />
              <Text style={styles.nicknameInviteText}>{cs.friends.addByNickname}</Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.sectionHeader}>{cs.friends.activeHeader}</Text>
        {dashboard?.activeFriends.length ? (
          <View style={styles.stack}>
            {dashboard.activeFriends.map((activity) => (
              <View key={activity.id} style={styles.activeCard}>
                <View style={styles.activeHeader}>
                  <FriendMini profile={activity.account} />
                  <Text style={styles.activeTime}>{timeLabel(activity.startedAt)}</Text>
                </View>
                <Text style={styles.activeTitle} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {activity.name}
                </Text>
                <Text style={styles.activeBody} maxFontSizeMultiplier={FontScaleCap.body}>
                  {activity.message || cs.friends.inviteLine(displayName(activity.account), activity.name)}
                </Text>
                <View style={styles.tableBadge}>
                  <MessageSquareIcon size={16} color={Colors.amber} />
                  <Text style={styles.tableBadgeText}>{cs.friends.atPubMessage}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <EmptyState text={cs.friends.emptyActive} />
        )}

        {dashboard?.incomingRequests.length ? (
          <>
            <Text style={styles.sectionHeader}>{cs.friends.requestsHeader}</Text>
            <View style={styles.stack}>
              {dashboard.incomingRequests.map((request) => (
                <View key={request.id} style={styles.requestCard}>
                  <FriendMini profile={request.requester} />
                  <View style={styles.requestActions}>
                    <Pressable onPress={() => void respond(request.id, 'decline')} style={styles.secondaryRound}>
                      <XIcon size={18} color={Colors.foam} />
                    </Pressable>
                    <Pressable onPress={() => void respond(request.id, 'accept')} style={styles.primaryRound}>
                      <CheckIcon size={18} color={Colors.stout} />
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.sectionHeader}>{cs.friends.friendsHeader}</Text>
        {dashboard?.friends.length ? (
          <View style={styles.stack}>
            {dashboard.friends.map((friend) => {
              const stats = dashboard.friendStats[friend.id];
              return (
                <View key={friend.id} style={styles.friendCard}>
                  <View style={styles.friendCardTop}>
                    <FriendMini profile={friend} />
                    <Pressable onPress={() => confirmRemove(friend)} hitSlop={8}>
                      <Trash2Icon size={18} color={Colors.mutedText} />
                    </Pressable>
                  </View>
                  <Text style={styles.sharedCount}>{cs.friends.sharedCount(stats?.sharedPubCount ?? 0)}</Text>
                  {!!stats?.lastPubName && <Text style={styles.lastTogether}>{cs.friends.lastTogether(stats.lastPubName)}</Text>}
                  {!!stats?.rituals.length && (
                    <View style={styles.ritualRow}>
                      {stats.rituals.map((ritual) => (
                        <View key={ritual.key} style={styles.ritualChip}>
                          <Text style={styles.ritualText}>{ritual.title}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        ) : (
          <EmptyState text={dashboard ? cs.friends.emptyFriends : cs.friends.offline} />
        )}

        {!!dashboard?.outgoingRequests.length && (
          <>
            <Text style={styles.sectionHeader}>{cs.friends.outgoingHeader}</Text>
            <View style={styles.outgoingRow}>
              {dashboard.outgoingRequests.map((request) => (
                <View key={request.id} style={styles.outgoingChip}>
                  <Text style={styles.outgoingText}>{displayName(request.recipient)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {!!dashboard?.notifications.length && (
          <>
            <Text style={styles.sectionHeader}>{cs.friends.feedHeader}</Text>
            <View style={styles.stack}>
              {dashboard.notifications.slice(0, 6).map((notification: FriendNotification) => (
                <View key={notification.id} style={styles.notificationRow}>
                  <BellRingIcon size={18} color={notification.readAt ? Colors.mutedText : Colors.amber} />
                  <View style={styles.notificationText}>
                    <Text style={styles.notificationTitle}>{notification.title}</Text>
                    <Text style={styles.notificationBody} numberOfLines={2}>
                      {notification.body}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        <View style={styles.footerButton}>
          <GlowButton
            label={cs.friends.refresh}
            onPress={() => void load()}
            variant="secondary"
            glow="none"
            height={50}
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
  loading: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  hero: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.2),
    padding: Spacing.lg,
    overflow: 'hidden',
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  heroKicker: {
    fontFamily: Fonts.display.extrabold,
    color: Colors.amber,
    fontSize: 18,
  },
  heroTitle: {
    fontFamily: Fonts.display.black,
    color: Colors.foam,
    fontSize: 34,
    lineHeight: 37,
    letterSpacing: 0,
  },
  heroBody: {
    marginTop: Spacing.sm,
    fontFamily: Fonts.ui.medium,
    color: Colors.foamMuted,
    fontSize: 15,
    lineHeight: 21,
  },
  liveStrip: {
    marginTop: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: withAlpha(Colors.amber, 0.1),
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  liveStripText: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    color: Colors.foam,
    fontSize: 14,
  },
  searchBlock: {
    gap: Spacing.sm,
  },
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
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  searchButtonText: {
    fontFamily: Fonts.display.extrabold,
    color: Colors.stout,
    fontSize: 16,
  },
  searchResults: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
  },
  nicknameInvite: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  nicknameInviteText: {
    fontFamily: Fonts.ui.semibold,
    color: Colors.amber,
    fontSize: 15,
  },
  sectionHeader: {
    marginTop: Spacing.sm,
    fontFamily: Fonts.display.extrabold,
    color: Colors.amber,
    fontSize: 17,
    letterSpacing: 0,
  },
  stack: {
    gap: Spacing.sm,
  },
  friendMini: {
    minWidth: 0,
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
  emptyState: {
    minHeight: 84,
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.stout2, 0.72),
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
  },
  emptyText: {
    fontFamily: Fonts.ui.medium,
    color: Colors.foamMuted,
    fontSize: 15,
    lineHeight: 21,
  },
  activeCard: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.32),
    padding: Spacing.lg,
  },
  activeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.md,
  },
  activeTime: {
    fontFamily: Fonts.ui.medium,
    color: Colors.mutedText,
    fontSize: 12,
  },
  activeTitle: {
    marginTop: Spacing.md,
    fontFamily: Fonts.display.extrabold,
    color: Colors.foam,
    fontSize: 25,
    lineHeight: 28,
  },
  activeBody: {
    marginTop: Spacing.xs,
    fontFamily: Fonts.ui.medium,
    color: Colors.foamMuted,
    fontSize: 15,
    lineHeight: 21,
  },
  tableBadge: {
    alignSelf: 'flex-start',
    marginTop: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: withAlpha(Colors.amber, 0.1),
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  tableBadgeText: {
    fontFamily: Fonts.ui.semibold,
    color: Colors.foam,
    fontSize: 13,
  },
  requestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
  requestActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  primaryRound: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  secondaryRound: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.08),
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  friendCard: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
  },
  friendCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  sharedCount: {
    marginTop: Spacing.md,
    fontFamily: Fonts.display.extrabold,
    color: Colors.foam,
    fontSize: 22,
  },
  lastTogether: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    color: Colors.foamMuted,
    fontSize: 14,
  },
  ritualRow: {
    marginTop: Spacing.md,
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
  notificationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: withAlpha(Colors.stout2, 0.7),
    borderRadius: Radius.medium,
    padding: Spacing.md,
  },
  notificationText: {
    flex: 1,
  },
  notificationTitle: {
    fontFamily: Fonts.ui.bold,
    color: Colors.foam,
    fontSize: 14,
  },
  notificationBody: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    color: Colors.foamMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  footerButton: {
    marginTop: Spacing.sm,
  },
});
