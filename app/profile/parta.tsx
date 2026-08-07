/**
 * Správa party — pushed route `/profile/parta` (Parta 3.0 §2).
 *
 * The calm management surface that the Parta tab hands its friend-admin work to:
 * the full friends list, the add-friend tools (Můj kód + invite + @nickname
 * search), and the cancellable outgoing invites. The Parta tab stays the live
 * plane (live cards, plans, RSVP, feed, leaderboard, incoming requests); this is
 * where you go to "see everyone" and grow the party.
 *
 * A back-navigable "place" cloned from `app/parta/[id].tsx` (own header, native
 * back-swipe). Data is the existing dashboard — snapshot hydrate on mount, then a
 * generation-guarded `fetchFriendsDashboard` — read-only here (no badge / mark-read;
 * that stays a Parta-tab concern). Incoming requests are surfaced only as a
 * cross-link back to Parta, where they are accepted.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import {
  cancelFriendRequest,
  fetchFriendsDashboard,
  type FriendsDashboard,
} from '@/data/friendsClient';
import { loadFriendsDashboardSnapshot } from '@/data/friendsSnapshot';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  UserPlusIcon,
} from '@/components/shared/IconGlyph';
import { showAppDialog } from '@/components/shared/AppDialog';
import { cs } from '@/i18n/cs';
import {
  selectNeedsNickname,
  selectNickname,
  useAccountStore,
} from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Spacing } from '@/theme/layout';

import { AddFriendTools } from '@/friends/AddFriendTools';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import CodeSheet from '@/friends/CodeSheet';
import { FriendListRow } from '@/friends/FriendListRow';
import { useFriendSafety } from '@/friends/friendSafety';
import FriendsSkeleton from '@/friends/FriendsSkeleton';
import OfflineBanner from '@/friends/OfflineBanner';
import { OutgoingInvites } from '@/friends/OutgoingInvites';
import SectionHeader from '@/friends/SectionHeader';

export default function ManagePartaScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const showToast = useToastStore((s) => s.show);

  const [dashboard, setDashboard] = useState<FriendsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [codeVisible, setCodeVisible] = useState(false);

  const nickname = useAccountStore(selectNickname);
  const needsNickname = useAccountStore(selectNeedsNickname);
  const hasIdentity = nickname != null;

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // Race guard: an out-of-order reload must never clobber a fresher one. Each load
  // bumps the generation and aborts the previous in-flight fetch (FriendsScreen §D2).
  const loadGenRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
      const gen = ++loadGenRef.current;
      loadAbortRef.current?.abort();
      const controller = new AbortController();
      loadAbortRef.current = controller;
      if (mode === 'refresh') setRefreshing(true);
      const next = await fetchFriendsDashboard(controller.signal);
      if (!mountedRef.current) return;
      if (gen === loadGenRef.current) {
        if (next) {
          setDashboard(next);
          setLoadError(false);
        } else {
          // Keep the last-known dashboard rendered; only flip the error flag.
          setLoadError(true);
        }
      }
      if (mode === 'initial') setLoading(false);
      if (mode === 'refresh') setRefreshing(false);
    },
    [],
  );

  // Hydrate the persisted snapshot before the network resolves so an offline open
  // shows the cached graph behind the OfflineBanner instead of a blank screen.
  useEffect(() => {
    let alive = true;
    void loadFriendsDashboardSnapshot().then((snap) => {
      if (!alive || !snap) return;
      setDashboard((prev) => prev ?? snap.dashboard);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(() => void load('initial'), 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  const openSafetyMenu = useFriendSafety(reload);
  const openFriendProfile = useCallback(
    (accountId: string) => {
      if (accountId) router.push(`/parta/${accountId}` as Href);
    },
    [router],
  );

  const confirmCancelInvite = useCallback(
    (request: FriendsDashboard['outgoingRequests'][number]) => {
      showAppDialog({
        title: cs.friends.cancelInviteTitle,
        buttons: [
          { text: cs.common.cancel, style: 'cancel' },
          {
            text: cs.friends.cancelInviteConfirm,
            style: 'destructive',
            onPress: () => {
              void cancelFriendRequest(request.recipient.id).then((result) => {
                if (!mountedRef.current) return;
                if (result.ok) {
                  showToast(cs.friends.inviteCanceled);
                  reload();
                } else {
                  showToast(result.detail);
                }
              });
            },
          },
        ],
      });
    },
    [reload, showToast],
  );

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile' as Href);
  }, [router]);

  const d = dashboard;
  const friends = d?.friends ?? [];
  const friendStats = d?.friendStats ?? {};
  const outgoing = d?.outgoingRequests ?? [];
  const incomingCount = d?.incomingRequests.length ?? 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top + Spacing.sm }]}>
      {/* Header — back · centred title · empty trailing (actions are per-row) */}
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.manageBack}
          style={({ pressed }) => [styles.headerBtn, pressed && styles.dim]}
        >
          <ChevronLeftIcon size={26} color={Colors.foam} />
        </Pressable>
        <Text
          style={styles.headerTitle}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {cs.friends.manageTitle}
        </Text>
        <View style={styles.headerBtn} />
      </View>

      {loading ? (
        <FriendsSkeleton />
      ) : (
        <KeyboardAwareScrollView
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
          keyboardShouldPersistTaps="handled"
          // KeyboardAwareScrollView already adds the keyboard clearance and
          // scrolls only when the focused field would be covered. A native
          // inset here would count the keyboard twice and jump the whole page.
          automaticallyAdjustKeyboardInsets={false}
        >
          {loadError ? (
            <View style={styles.section}>
              <OfflineBanner onRetry={() => void load('refresh')} />
            </View>
          ) : null}

          {/* SEŽEŇ PARTU — add-friend tools (identity gate when no nickname) */}
          <View style={styles.section}>
            <SectionHeader label={cs.friends.growthHeader} />
            <AddFriendTools
              hasIdentity={hasIdentity}
              needsNickname={needsNickname}
              onOpenCode={() => setCodeVisible(true)}
              onChanged={reload}
              showSearch
            />
          </View>

          {/* KÁMOŠI — the full friends list (empty → one calm line; the growth
              tools above already own the add action, so no duplicate CTA here) */}
          <View style={styles.section}>
            <SectionHeader label={cs.friends.friendsHeader} />
            {friends.length > 0 ? (
              <View>
                {friends.map((friend, i) => (
                  <FriendListRow
                    key={friend.id}
                    friend={friend}
                    stats={friendStats[friend.id]}
                    first={i === 0}
                    onOpenProfile={openFriendProfile}
                    onLongPress={openSafetyMenu}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.emptyFriends}>
                <UserPlusIcon size={28} color={Colors.mutedText} />
                <Text style={styles.emptyText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.friends.emptyFriends}
                </Text>
              </View>
            )}
          </View>

          {/* ODESLANÉ POZVÁNKY — cancellable chips */}
          {outgoing.length > 0 ? (
            <View style={styles.section}>
              <OutgoingInvites requests={outgoing} onCancel={confirmCancelInvite} />
            </View>
          ) : null}

          {/* Cross-link back to Parta — the one place incoming requests are accepted */}
          {incomingCount > 0 ? (
            <View style={styles.section}>
              <Pressable
                onPress={() => router.push('/friends' as Href)}
                accessibilityRole="button"
                accessibilityLabel={cs.friends.manageIncomingLink(incomingCount)}
                style={({ pressed }) => [styles.crossLink, pressed && styles.dim]}
              >
                <UserPlusIcon size={18} color={Colors.amber} />
                <Text style={styles.crossLinkText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.friends.manageIncomingLink(incomingCount)}
                </Text>
                <ChevronRightIcon size={16} color={Colors.mutedText} />
              </Pressable>
            </View>
          ) : null}
        </KeyboardAwareScrollView>
      )}

      {codeVisible ? <CodeSheet onClose={() => setCodeVisible(false)} /> : null}
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
    paddingTop: Spacing.sm,
  },
  section: {
    marginTop: Spacing.xl,
  },

  // — Empty friends —
  emptyFriends: {
    alignItems: 'center',
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  emptyText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 14,
    lineHeight: 19,
    color: Colors.mutedText,
    textAlign: 'center',
  },

  // — Cross-link to Parta —
  crossLink: {
    minHeight: HitArea.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  crossLinkText: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.foam,
  },
});
