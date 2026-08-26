/**
 * PartaPeopleScreen — "S kým chodíš na pivo".
 *
 * This screen used to open with two sections about the *paperwork* of a
 * friendship — "Čekají na tebe" and "Odeslané pozvánky" — so a fresh install
 * read as three headings and three apologies, and a person had to find a
 * nickname, send an invite and wait for a stranger to confirm before seeing a
 * single friend. All of that to record a bond the app can work out on its own:
 * the usual friendship now comes from sitting at the same table (the backend
 * promotes it when someone joins an evening), not from a form.
 *
 * The normal screen is still two lists. People you actually drink with, ordered by how
 * often — the numeral on the right is the count, so the list is scanned rather
 * than read. And people you follow, which is one-way, carries no location, and
 * only shows up once you follow someone. Incoming requests appear only while
 * somebody is genuinely waiting, because a push must end at the decision it
 * announced instead of at a list that cannot accept it.
 *
 * "Odeslané pozvánky" is back for the same reason, and under the same
 * condition: it is rendered only while somebody has actually been asked. An
 * invite that vanishes the moment it is sent cannot be taken back, and
 * `?focus=outgoing` — which the invite-claim screen still hands out — has to
 * land on something.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showAppDialog } from '@/components/shared/AppDialog';
import { CheckIcon, PlusIcon, XIcon } from '@/components/shared/IconGlyph';
import { TAB_CHROME } from '@/components/shared/TabBar';
import { cancelFriendRequest, respondFriendRequest } from '@/data/friendsClient';
import { runPrivateAccountMutation } from '@/data/privateAccountBoundary';
import { cs } from '@/i18n/cs';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { SectionBreak } from '@/mocks/SectionBreak';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { useToastStore } from '@/stores/toastStore';
import { useAccountStore } from '@/stores/accountStore';

import { FollowingRow } from './FollowingRow';
import { FriendMini, friendDisplayName } from './FriendMini';
import { FriendListRow } from './FriendListRow';
import FriendsSkeleton from './FriendsSkeleton';
import OfflineBanner from './OfflineBanner';
import { PartaScreenHeader } from './PartaScreenHeader';
import { useFriendSafety } from './friendSafety';
import { sortByEveningsTogether } from './peopleOrder';
import { usePartaDashboard } from './usePartaDashboard';

function PartaPeopleScreenContent() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ focus?: string; friendshipId?: string }>();
  const showToast = useToastStore((state) => state.show);
  const { dashboard, loading, refreshing, stale, reload, refresh } = usePartaDashboard({ markRead: true });
  const openSafety = useFriendSafety(reload);
  const scrollRef = useRef<ScrollView>(null);
  const requestsYRef = useRef(0);
  const outgoingYRef = useRef(0);
  const cancelingRef = useRef<string | null>(null);
  const [canceling, setCanceling] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const respondingRef = useRef<Record<string, 'accept' | 'decline'>>({});
  const [responding, setResponding] = useState<Record<string, 'accept' | 'decline'>>({});

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const openProfile = useCallback((id: string) => router.push(`/parta/${id}` as Href), [router]);

  const friends = useMemo(
    () => sortByEveningsTogether(dashboard?.friends ?? [], dashboard?.friendStats ?? {}),
    [dashboard?.friends, dashboard?.friendStats],
  );

  const following = dashboard?.following ?? [];
  const incomingRequests = useMemo(() => {
    const requests = dashboard?.incomingRequests ?? [];
    if (!params.friendshipId) return requests;
    return [...requests].sort(
      (left, right) =>
        Number(right.id === params.friendshipId) - Number(left.id === params.friendshipId),
    );
  }, [dashboard?.incomingRequests, params.friendshipId]);

  // People you have asked and who have not answered yet. Without this section
  // an invite disappeared the moment it was sent — and `?focus=outgoing`, which
  // the claim screen still hands out, landed on a list that did not have it.
  const outgoingRequests = dashboard?.outgoingRequests ?? [];

  useEffect(() => {
    if (!dashboard) return undefined;
    const target =
      params.focus === 'requests'
        ? requestsYRef
        : params.focus === 'outgoing'
          ? outgoingYRef
          : null;
    if (!target) return undefined;
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(0, target.current - Spacing.sm),
        animated: true,
      });
    }, 60);
    return () => clearTimeout(timer);
  }, [dashboard, params.focus]);

  const respond = useCallback(
    async (requestId: string, action: 'accept' | 'decline') => {
      if (respondingRef.current[requestId]) return;
      respondingRef.current = { ...respondingRef.current, [requestId]: action };
      setResponding(respondingRef.current);
      let result;
      try {
        result = await runPrivateAccountMutation(async () =>
          respondFriendRequest(requestId, action),
        );
      } catch {
        // A credential transition invalidates the whole response. The keyed
        // replacement screen owns its own controls and must not see A's result.
        if (mountedRef.current) {
          const next = { ...respondingRef.current };
          delete next[requestId];
          respondingRef.current = next;
          setResponding(next);
        }
        return;
      }
      if (!mountedRef.current) return;
      const next = { ...respondingRef.current };
      delete next[requestId];
      respondingRef.current = next;
      setResponding(next);
      if (!result.ok) {
        showToast(result.detail || cs.friends.requestActionError);
        return;
      }
      showToast(action === 'accept' ? cs.friends.requestAccepted : cs.friends.requestDeclined);
      reload();
    },
    [reload, showToast],
  );

  const confirmCancel = useCallback(
    (requestId: string, recipientId: string) => {
      showAppDialog({
        title: cs.friends.cancelInviteTitle,
        buttons: [
          { text: cs.common.cancel, style: 'cancel' },
          {
            text: cs.friends.cancelInviteConfirm,
            style: 'destructive',
            onPress: () => {
              if (cancelingRef.current) return;
              cancelingRef.current = requestId;
              setCanceling(requestId);
              void cancelFriendRequest(recipientId).then((result) => {
                if (!mountedRef.current) return;
                cancelingRef.current = null;
                setCanceling(null);
                if (!result.ok) {
                  showToast(result.detail || cs.friends.requestActionError);
                  return;
                }
                showToast(cs.friends.inviteCanceled);
                reload();
              });
            },
          },
        ],
      });
    },
    [reload, showToast],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + Spacing.sm }]}>
      <PartaScreenHeader title={cs.friends.peopleTitle} />
      {loading && !dashboard ? <FriendsSkeleton /> : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + TAB_CHROME }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.amber} />}
          showsVerticalScrollIndicator={false}
        >
          {stale ? <OfflineBanner onRetry={refresh} /> : null}

          {incomingRequests.length > 0 ? (
            <View
              onLayout={(event) => {
                requestsYRef.current = event.nativeEvent.layout.y;
              }}
            >
              <Text style={styles.sectionTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                {cs.friends.requestsHeader}
              </Text>
              <View style={styles.requests}>
                {incomingRequests.map((request, index) => (
                  <View
                    key={request.id}
                    style={[styles.requestRow, index > 0 && styles.requestRowBorder]}
                  >
                    <FriendMini profile={request.requester} />
                    <View style={styles.requestActions}>
                      <Pressable
                        onPress={() => void respond(request.id, 'decline')}
                        disabled={responding[request.id] != null}
                        accessibilityRole="button"
                        accessibilityLabel={cs.friends.decline}
                        accessibilityState={{
                          disabled: responding[request.id] != null,
                          busy: responding[request.id] != null,
                        }}
                        style={({ pressed }) => [
                          styles.requestButton,
                          pressed && styles.primaryPressed,
                        ]}
                      >
                        {responding[request.id] === 'decline' ? (
                          <ActivityIndicator size="small" color={Colors.foam} />
                        ) : (
                          <XIcon size={18} color={Colors.foam} />
                        )}
                      </Pressable>
                      <Pressable
                        onPress={() => void respond(request.id, 'accept')}
                        disabled={responding[request.id] != null}
                        accessibilityRole="button"
                        accessibilityLabel={cs.friends.accept}
                        accessibilityState={{
                          disabled: responding[request.id] != null,
                          busy: responding[request.id] != null,
                        }}
                        style={({ pressed }) => [
                          styles.requestButton,
                          styles.acceptButton,
                          pressed && styles.primaryPressed,
                        ]}
                      >
                        {responding[request.id] === 'accept' ? (
                          <ActivityIndicator size="small" color={Colors.stout} />
                        ) : (
                          <CheckIcon size={18} color={Colors.stout} />
                        )}
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
              <SectionBreak title={cs.friends.togetherHeader} />
            </View>
          ) : null}

          {incomingRequests.length === 0 ? (
            <Text style={styles.sectionTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.friends.togetherHeader}
            </Text>
          ) : null}
          {friends.length === 0 ? (
            <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>{cs.friends.togetherEmpty}</Text>
          ) : friends.map((friend, index) => (
            <FriendListRow
              key={friend.id}
              friend={friend}
              stats={dashboard?.friendStats[friend.id]}
              first={index === 0}
              onOpenProfile={openProfile}
              onLongPress={openSafety}
            />
          ))}

          {outgoingRequests.length > 0 ? (
            <View
              onLayout={(event) => {
                outgoingYRef.current = event.nativeEvent.layout.y;
              }}
            >
              <SectionBreak title={cs.friends.outgoingHeader} />
              <View style={styles.requests}>
                {outgoingRequests.map((request, index) => (
                  <View
                    key={request.id}
                    style={[styles.requestRow, index > 0 && styles.requestRowBorder]}
                  >
                    <FriendMini profile={request.recipient} />
                    <Pressable
                      onPress={() => confirmCancel(request.id, request.recipient.id)}
                      disabled={canceling != null}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`${cs.friends.cancelInviteConfirm}: ${friendDisplayName(request.recipient)}`}
                      accessibilityState={{
                        disabled: canceling != null,
                        busy: canceling === request.id,
                      }}
                      style={({ pressed }) => [pressed && styles.dim]}
                    >
                      {canceling === request.id ? (
                        <ActivityIndicator size="small" color={Colors.mutedText} />
                      ) : (
                        <Text
                          style={styles.cancelInvite}
                          maxFontSizeMultiplier={FontScaleCap.body}
                        >
                          {cs.common.cancel}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {following.length > 0 ? (
            <>
              <SectionBreak title={cs.friends.followingHeader} />
              {following.map((profile, index) => (
                <FollowingRow
                  key={profile.id}
                  profile={profile}
                  first={index === 0}
                  onOpenProfile={openProfile}
                />
              ))}
            </>
          ) : null}

          <Pressable
            onPress={() => router.push('/friends/parta/add' as Href)}
            accessibilityRole="button"
            accessibilityLabel={cs.friends.addPersonCta}
            style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
          >
            <PlusIcon size={20} color={Colors.stout} />
            <Text style={styles.primaryText} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.friends.addPersonCta}
            </Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

export default function PartaPeopleScreen() {
  const accountId = useAccountStore((state) => state.session?.accountId ?? null);
  return <PartaPeopleScreenContent key={accountId ?? 'account-pending'} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: MockLayout.screenPad, backgroundColor: Colors.stout },
  content: { paddingTop: Spacing.sm },
  sectionTitle: {
    ...MockType.titleS,
    color: Colors.foam,
    marginBottom: MockLayout.controlGap,
  },
  empty: { color: Colors.mutedText, fontSize: 14, lineHeight: 20, paddingVertical: Spacing.sm },
  requests: {
    borderRadius: Radius.medium,
    backgroundColor: Colors.stout2,
    overflow: 'hidden',
  },
  requestRow: {
    minHeight: 60,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  requestRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  requestActions: { flexDirection: 'row', gap: Spacing.sm },
  requestButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.stout3,
  },
  acceptButton: { backgroundColor: Colors.amber },
  cancelInvite: { fontSize: 14, fontWeight: '600', color: Colors.mutedText },
  dim: { opacity: 0.6 },
  primary: {
    minHeight: 54,
    marginTop: MockLayout.sectionGap,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  primaryText: { ...MockType.buttonLabel, color: Colors.stout },
  primaryPressed: { opacity: 0.82 },
});
