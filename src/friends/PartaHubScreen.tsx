import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ClockIcon,
  ChevronRightIcon,
  UserPlusIcon,
  UsersIcon,
} from '@/components/shared/IconGlyph';
import { TAB_CHROME } from '@/components/shared/TabBar';
import { cs } from '@/i18n/cs';
import { MockLayout } from '@/mocks/mockTheme';
import {
  selectIsSignedIn,
  selectNeedsNickname,
  useAccountStore,
} from '@/stores/accountStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

import ComposeSheet from './ComposeSheet';
import FriendActiveCard from './FriendActiveCard';
import FriendsSkeleton from './FriendsSkeleton';
import MyActivityCard from './MyActivityCard';
import OfflineBanner from './OfflineBanner';
import { PartaScreenHeader } from './PartaScreenHeader';
import PlanCard from './PlanCard';
import { PresenceList } from './PresenceList';
import { usePartaDashboard } from './usePartaDashboard';

function SectionBreak() {
  return <View style={styles.sectionBreak} />;
}

export default function PartaHubScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ focus?: string; activityId?: string }>();
  const focus = params.focus;
  const activityId = params.activityId;
  const isSignedIn = useAccountStore(selectIsSignedIn);
  const needsNickname = useAccountStore(selectNeedsNickname);
  const { dashboard, loading, refreshing, stale, reload, refresh } = usePartaDashboard({ markRead: true });
  const [composeIntent, setComposeIntent] = useState<'live' | 'plan' | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const presenceYRef = useRef(0);
  const plansYRef = useRef(0);

  useEffect(() => {
    if (!dashboard || !focus) return;
    const activityIsPlan =
      activityId != null &&
      (dashboard.myPlan?.id === activityId || dashboard.plans.some((plan) => plan.id === activityId));
    const target = focus === 'plans' || (focus === 'activity' && activityIsPlan)
      ? plansYRef.current
      : presenceYRef.current;
    const timer = setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, target - 12), animated: true }), 60);
    return () => clearTimeout(timer);
  }, [activityId, dashboard, focus]);

  const broadcastIds = useMemo(
    () => new Set((dashboard?.activeFriends ?? []).map((activity) => activity.account.id)),
    [dashboard?.activeFriends],
  );
  const quietPresence = useMemo(
    () => (dashboard?.presence ?? []).filter((row) => !broadcastIds.has(row.account.id)),
    [broadcastIds, dashboard?.presence],
  );
  const activeFriends = useMemo(() => {
    const activities = dashboard?.activeFriends ?? [];
    if (!activityId) return activities;
    return [...activities].sort((left, right) => Number(right.id === activityId) - Number(left.id === activityId));
  }, [activityId, dashboard?.activeFriends]);
  const plans = useMemo(
    () => [
      ...(dashboard?.myPlan ? [{ activity: dashboard.myPlan, mine: true }] : []),
      ...(dashboard?.plans ?? []).map((activity) => ({ activity, mine: false })),
    ].sort((left, right) => Number(right.activity.id === activityId) - Number(left.activity.id === activityId)),
    [activityId, dashboard],
  );

  const openPeople = useCallback(
    (focus?: 'requests') =>
      router.push((focus ? '/friends/parta/people?focus=requests' : '/friends/parta/people') as Href),
    [router],
  );

  const primaryLabel = !isSignedIn
    ? cs.friends.ctaSignIn
    : needsNickname
      ? cs.friends.ctaNickname
      : dashboard?.myActiveActivity
        ? cs.friends.ctaWhoIsComing
        : (dashboard?.friends.length ?? 0) === 0
          ? cs.friends.ctaAddFriend
        : cs.friends.ctaPing;

  const primaryAction = useCallback(() => {
    if (!isSignedIn) router.push('/auth' as Href);
    else if (needsNickname) router.push('/profile/edit' as Href);
    else if (dashboard?.myActiveActivity) {
      scrollRef.current?.scrollTo({ y: Math.max(0, presenceYRef.current - 12), animated: true });
    }
    else if ((dashboard?.friends.length ?? 0) === 0) router.push('/friends/parta/add' as Href);
    else setComposeIntent('live');
  }, [dashboard?.friends.length, dashboard?.myActiveActivity, isSignedIn, needsNickname, router]);

  const hasPresence =
    dashboard?.myPresence != null ||
    dashboard?.myActiveActivity != null ||
    quietPresence.length > 0 ||
    (dashboard?.activeFriends.length ?? 0) > 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top + Spacing.sm }]}>
      <PartaScreenHeader
        title={cs.friends.hubTitle}
        trailing={
          <Pressable
            onPress={() => openPeople()}
            accessibilityRole="button"
            accessibilityLabel={cs.friends.peopleTitle}
            style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
          >
            <UsersIcon size={21} color={Colors.foam} />
          </Pressable>
        }
      />

      {loading && !dashboard ? (
        <FriendsSkeleton />
      ) : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + TAB_CHROME }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.amber} />}
          showsVerticalScrollIndicator={false}
        >
          {stale ? <OfflineBanner onRetry={refresh} /> : null}

          <Pressable
            onPress={primaryAction}
            accessibilityRole="button"
            accessibilityLabel={primaryLabel}
            style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
          >
            <Text style={styles.primaryText} maxFontSizeMultiplier={FontScaleCap.heading}>
              {primaryLabel}
            </Text>
          </Pressable>

          <View onLayout={(event) => { presenceYRef.current = event.nativeEvent.layout.y; }}>
          <SectionBreak />
          <Text style={styles.sectionTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.friends.presenceHeader}
          </Text>
          {dashboard?.myActiveActivity ? (
            <View style={dashboard.myActiveActivity.id === activityId ? styles.targetRow : undefined}>
              <MyActivityCard activity={dashboard.myActiveActivity} stale={stale} onEnded={reload} />
            </View>
          ) : null}
          {activeFriends.map((activity) => (
            <View key={activity.id} style={[styles.cardGap, activity.id === activityId && styles.targetRow]}>
              <FriendActiveCard activity={activity} stale={stale} onResponded={reload} />
            </View>
          ))}
          <PresenceList
            presence={quietPresence}
            myPresence={dashboard?.myActiveActivity ? null : (dashboard?.myPresence ?? null)}
            stale={stale}
            sharedCacheKey={dashboard?.myPresence?.cacheKey ?? null}
            onOpenProfile={(id) => router.push(`/parta/${id}` as Href)}
            onChanged={reload}
          />
          {!hasPresence ? (
            <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.friends.presenceEmpty}
            </Text>
          ) : null}
          </View>

          <View onLayout={(event) => { plansYRef.current = event.nativeEvent.layout.y; }}>
          <SectionBreak />
          <Text style={styles.sectionTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.friends.plansHeader}
          </Text>
          {plans.map(({ activity, mine }) => (
            <View
              key={`${mine ? 'mine' : 'friend'}:${activity.id}`}
              style={[styles.cardGap, activity.id === activityId && styles.targetRow]}
            >
              <PlanCard activity={activity} mine={mine} onResponded={reload} onCanceled={reload} />
            </View>
          ))}
          {plans.length === 0 ? (
            <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.friends.plansEmpty}
            </Text>
          ) : null}
          {isSignedIn && !needsNickname && (dashboard?.friends.length ?? 0) > 0 ? (
            <Pressable
              onPress={() => setComposeIntent('plan')}
              accessibilityRole="button"
              accessibilityLabel={cs.friends.planComposeTitle}
              style={({ pressed }) => [styles.planAction, pressed && styles.pressed]}
            >
              <ClockIcon size={19} color={Colors.foamMuted} />
              <Text style={styles.planActionText} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.friends.planComposeTitle}
              </Text>
              <ChevronRightIcon size={18} color={Colors.mutedText} />
            </Pressable>
          ) : null}
          </View>

        </ScrollView>
      )}

      {composeIntent ? (
        <ComposeSheet
          friends={dashboard?.friends ?? []}
          intent={composeIntent}
          onSubmitted={reload}
          onClose={() => setComposeIntent(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.stout, paddingHorizontal: MockLayout.screenPad },
  content: { paddingTop: Spacing.sm },
  headerAction: { width: HitArea.min, height: HitArea.min, alignItems: 'center', justifyContent: 'center' },
  headerBadge: {
    position: 'absolute', top: 1, right: 0, minWidth: 18, height: 18, paddingHorizontal: 4,
    borderRadius: 9, backgroundColor: Colors.amber, borderWidth: 2, borderColor: Colors.stout,
    alignItems: 'center', justifyContent: 'center',
  },
  headerBadgeText: { color: Colors.stout, fontSize: 11, lineHeight: 13, fontWeight: '800' },
  requestsRow: {
    minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: withAlpha(Colors.foam, 0.12),
  },
  requestsText: { flex: 1, color: Colors.foam, fontSize: 15, fontWeight: '700' },
  sectionBreak: { height: 10, marginHorizontal: -MockLayout.screenPad, marginTop: Spacing.lg, backgroundColor: '#0F0A05' },
  sectionTitle: { color: Colors.foam, fontSize: 20, fontWeight: '800', marginTop: Spacing.lg, marginBottom: Spacing.md },
  cardGap: { marginTop: Spacing.md },
  empty: { color: Colors.mutedText, fontSize: 14, lineHeight: 20, paddingVertical: Spacing.md },
  planAction: {
    minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(Colors.foam, 0.12),
  },
  planActionText: { flex: 1, color: Colors.foamMuted, fontSize: 15, fontWeight: '700' },
  primary: {
    minHeight: 54, marginTop: Spacing.lg, borderRadius: Radius.medium,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.amber,
  },
  primaryText: { color: Colors.stout, fontSize: 16, fontWeight: '800' },
  primaryPressed: { opacity: 0.82 },
  targetRow: { borderLeftWidth: 2, borderLeftColor: Colors.amber, paddingLeft: Spacing.sm },
  pressed: { opacity: 0.62 },
});
