import { useCallback, useEffect, useRef, useState } from 'react';
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
import {
  cancelFriendRequest,
  respondFriendRequest,
  type Friendship,
} from '@/data/friendsClient';
import { cs } from '@/i18n/cs';
import { MockLayout } from '@/mocks/mockTheme';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

import { FriendListRow } from './FriendListRow';
import { FriendMini, friendDisplayName } from './FriendMini';
import FriendsSkeleton from './FriendsSkeleton';
import OfflineBanner from './OfflineBanner';
import { PartaScreenHeader } from './PartaScreenHeader';
import { useFriendSafety } from './friendSafety';
import { usePartaDashboard } from './usePartaDashboard';

function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.sectionTitle} maxFontSizeMultiplier={FontScaleCap.heading}>{children}</Text>;
}

export default function PartaPeopleScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ focus?: string; friendshipId?: string }>();
  const focus = params.focus;
  const friendshipId = params.friendshipId;
  const showToast = useToastStore((state) => state.show);
  const { dashboard, loading, refreshing, stale, reload, refresh } = usePartaDashboard({ markRead: true });
  const [working, setWorking] = useState<Record<string, 'accept' | 'decline' | 'cancel'>>({});
  const mountedRef = useRef(true);
  const scrollRef = useRef<ScrollView>(null);
  const outgoingYRef = useRef(0);
  const friendsYRef = useRef(0);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const openSafety = useFriendSafety(reload);

  useEffect(() => {
    if (!dashboard || loading || focus === 'requests' || !focus) return;
    const target = focus === 'outgoing' ? outgoingYRef.current : friendsYRef.current;
    const timer = setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, target - 12), animated: true }), 60);
    return () => clearTimeout(timer);
  }, [dashboard, focus, loading]);

  const respond = useCallback(async (request: Friendship, action: 'accept' | 'decline') => {
    if (working[request.id]) return;
    setWorking((current) => ({ ...current, [request.id]: action }));
    const result = await respondFriendRequest(request.id, action);
    if (!mountedRef.current) return;
    setWorking((current) => {
      const next = { ...current };
      delete next[request.id];
      return next;
    });
    if (result.ok) {
      showToast(action === 'accept' ? cs.friends.requestAccepted : cs.friends.requestDeclined);
      reload();
    } else showToast(result.detail);
  }, [reload, showToast, working]);

  const cancel = useCallback((request: Friendship) => {
    showAppDialog({
      title: cs.friends.cancelInviteTitle,
      buttons: [
        { text: cs.common.cancel, style: 'cancel' },
        {
          text: cs.friends.cancelInviteConfirm,
          style: 'destructive',
          onPress: () => {
            setWorking((current) => ({ ...current, [request.id]: 'cancel' }));
            void cancelFriendRequest(request.recipient.id).then((result) => {
              if (!mountedRef.current) return;
              setWorking((current) => {
                const next = { ...current };
                delete next[request.id];
                return next;
              });
              if (result.ok) {
                showToast(cs.friends.inviteCanceled);
                reload();
              } else showToast(result.detail);
            });
          },
        },
      ],
    });
  }, [reload, showToast]);

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

          <SectionTitle>{cs.friends.requestsHeader}</SectionTitle>
          {(dashboard?.incomingRequests ?? []).length === 0 ? (
            <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>{cs.friends.requestsEmpty}</Text>
          ) : (dashboard?.incomingRequests ?? []).map((request) => (
            <View key={request.id} style={[styles.requestRow, request.id === friendshipId && styles.targetRow]}>
              <View style={styles.requestIdentity}><FriendMini profile={request.requester} /></View>
              <Pressable
                onPress={() => void respond(request, 'decline')}
                disabled={working[request.id] != null}
                accessibilityRole="button"
                accessibilityLabel={`${cs.friends.decline}: ${friendDisplayName(request.requester)}`}
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
              >
                <XIcon size={19} color={Colors.foamMuted} />
              </Pressable>
              <Pressable
                onPress={() => void respond(request, 'accept')}
                disabled={working[request.id] != null}
                accessibilityRole="button"
                accessibilityLabel={`${cs.friends.accept}: ${friendDisplayName(request.requester)}`}
                style={({ pressed }) => [styles.acceptButton, pressed && styles.pressed]}
              >
                {working[request.id] ? <ActivityIndicator color={Colors.stout} size="small" /> : <CheckIcon size={19} color={Colors.stout} />}
              </Pressable>
            </View>
          ))}

          <View onLayout={(event) => { outgoingYRef.current = event.nativeEvent.layout.y; }}>
          <View style={styles.sectionBreak} />
          <SectionTitle>{cs.friends.outgoingHeader}</SectionTitle>
          {(dashboard?.outgoingRequests ?? []).length === 0 ? (
            <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>{cs.friends.outgoingEmpty}</Text>
          ) : (dashboard?.outgoingRequests ?? []).map((request) => (
            <Pressable
              key={request.id}
              onPress={() => cancel(request)}
              accessibilityRole="button"
              accessibilityLabel={`${cs.friends.cancelInviteConfirm}: ${friendDisplayName(request.recipient)}`}
              style={({ pressed }) => [styles.outgoingRow, pressed && styles.pressed]}
            >
              <View style={styles.requestIdentity}><FriendMini profile={request.recipient} /></View>
              {working[request.id] ? <ActivityIndicator color={Colors.amber} size="small" /> : <XIcon size={18} color={Colors.mutedText} />}
            </Pressable>
          ))}
          </View>

          <View onLayout={(event) => { friendsYRef.current = event.nativeEvent.layout.y; }}>
          <View style={styles.sectionBreak} />
          <SectionTitle>{cs.friends.friendsHeader}</SectionTitle>
          {(dashboard?.friends ?? []).length === 0 ? (
            <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>{cs.friends.emptyFriends}</Text>
          ) : (dashboard?.friends ?? []).map((friend, index) => (
            <FriendListRow
              key={friend.id}
              friend={friend}
              stats={dashboard?.friendStats[friend.id]}
              first={index === 0}
              onOpenProfile={(id) => router.push(`/parta/${id}` as Href)}
              onLongPress={openSafety}
            />
          ))}
          </View>

          <Pressable
            onPress={() => router.push('/friends/parta/add' as Href)}
            accessibilityRole="button"
            accessibilityLabel={cs.friends.addHeader}
            style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
          >
            <PlusIcon size={20} color={Colors.stout} />
            <Text style={styles.primaryText} maxFontSizeMultiplier={FontScaleCap.heading}>{cs.friends.addHeader}</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: MockLayout.screenPad, backgroundColor: Colors.stout },
  content: { paddingTop: Spacing.sm },
  sectionTitle: { marginTop: Spacing.lg, marginBottom: Spacing.sm, color: Colors.foam, fontSize: 20, fontWeight: '800' },
  sectionBreak: { height: 10, marginHorizontal: -MockLayout.screenPad, marginTop: Spacing.lg, backgroundColor: '#0F0A05' },
  empty: { color: Colors.mutedText, fontSize: 14, lineHeight: 20, paddingVertical: Spacing.md },
  requestRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: withAlpha(Colors.foam, 0.12) },
  requestIdentity: { flex: 1, minWidth: 0 },
  iconButton: { width: HitArea.min, height: HitArea.min, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.pill, backgroundColor: Colors.stout3 },
  acceptButton: { width: HitArea.min, height: HitArea.min, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.pill, backgroundColor: Colors.amber },
  outgoingRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: withAlpha(Colors.foam, 0.12) },
  primary: { minHeight: 54, marginTop: Spacing.xl, borderRadius: Radius.medium, backgroundColor: Colors.amber, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  primaryText: { color: Colors.stout, fontSize: 16, fontWeight: '800' },
  primaryPressed: { opacity: 0.82 },
  pressed: { opacity: 0.62 },
  targetRow: { borderLeftWidth: 2, borderLeftColor: Colors.amber, paddingLeft: Spacing.sm },
});
