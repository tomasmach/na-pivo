/**
 * PartaPeopleScreen — "S kým chodíš na pivo".
 *
 * This screen used to open with two sections about the *paperwork* of a
 * friendship — "Čekají na tebe" and "Odeslané pozvánky" — so a fresh install
 * read as three headings and three apologies, and a person had to find a
 * nickname, send an invite and wait for a stranger to confirm before seeing a
 * single friend. All of that to record a bond the app can work out on its own:
 * a friendship now comes from sitting at the same table (the backend promotes
 * it when someone joins an evening), not from a form.
 *
 * What is left is two lists. People you actually drink with, ordered by how
 * often — the numeral on the right is the count, so the list is scanned rather
 * than read. And people you follow, which is one-way, carries no location, and
 * only shows up once you follow someone.
 *
 * Incoming/outgoing requests still exist in the API for versions in the store
 * (§ additive API), they just have no surface here any more.
 */

import { useCallback, useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlusIcon } from '@/components/shared/IconGlyph';
import { TAB_CHROME } from '@/components/shared/TabBar';
import { cs } from '@/i18n/cs';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { SectionBreak } from '@/mocks/SectionBreak';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

import { FollowingRow } from './FollowingRow';
import { FriendListRow } from './FriendListRow';
import FriendsSkeleton from './FriendsSkeleton';
import OfflineBanner from './OfflineBanner';
import { PartaScreenHeader } from './PartaScreenHeader';
import { useFriendSafety } from './friendSafety';
import { sortByEveningsTogether } from './peopleOrder';
import { usePartaDashboard } from './usePartaDashboard';

export default function PartaPeopleScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { dashboard, loading, refreshing, stale, reload, refresh } = usePartaDashboard({ markRead: true });
  const openSafety = useFriendSafety(reload);

  const openProfile = useCallback((id: string) => router.push(`/parta/${id}` as Href), [router]);

  const friends = useMemo(
    () => sortByEveningsTogether(dashboard?.friends ?? [], dashboard?.friendStats ?? {}),
    [dashboard?.friends, dashboard?.friendStats],
  );

  const following = dashboard?.following ?? [];

  return (
    <View style={[styles.root, { paddingTop: insets.top + Spacing.sm }]}>
      <PartaScreenHeader title={cs.friends.peopleTitle} />
      {loading && !dashboard ? <FriendsSkeleton /> : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + TAB_CHROME }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.amber} />}
          showsVerticalScrollIndicator={false}
        >
          {stale ? <OfflineBanner onRetry={refresh} /> : null}

          <Text style={styles.sectionTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.friends.togetherHeader}
          </Text>
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

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: MockLayout.screenPad, backgroundColor: Colors.stout },
  content: { paddingTop: Spacing.sm },
  sectionTitle: {
    ...MockType.titleS,
    color: Colors.foam,
    marginBottom: MockLayout.controlGap,
  },
  empty: { color: Colors.mutedText, fontSize: 14, lineHeight: 20, paddingVertical: Spacing.sm },
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
