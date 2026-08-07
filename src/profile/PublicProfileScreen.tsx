import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { ChevronLeftIcon } from '@/components/shared/IconGlyph';
import { fetchFriendProfile, searchFriends, type FriendProfileDetail } from '@/data/friendsClient';
import { Face } from '@/feed/FeedMockScreen';
import SkeletonBlock from '@/friends/SkeletonBlock';
import { cs } from '@/i18n/cs';
import { SectionBreak } from '@/mocks/SectionBreak';
import { StatGrid } from '@/mocks/StatGrid';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { AchievementGrid } from '@/profile/AchievementGrid';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { useReduceMotion } from '@/utils/useReduceMotion';

async function resolveProfile(
  params: { accountId: string; handle: string },
  signal: AbortSignal,
): Promise<FriendProfileDetail | null> {
  let accountId = params.accountId;
  if (!accountId && params.handle) {
    const candidates = await searchFriends(params.handle, signal);
    const normalized = params.handle.replace(/^@/, '').toLocaleLowerCase('cs-CZ');
    accountId =
      candidates?.find((candidate) => candidate.nickname?.toLocaleLowerCase('cs-CZ') === normalized)
        ?.id ?? '';
  }
  return accountId ? fetchFriendProfile(accountId, signal) : null;
}

function ProfileSkeleton({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <View style={styles.skeleton}>
      <View style={styles.identity}>
        <SkeletonBlock width={72} height={72} radius={Radius.pill} reduceMotion={reduceMotion} />
        <View style={styles.grow}>
          <SkeletonBlock width="55%" height={28} reduceMotion={reduceMotion} />
          <View style={styles.skeletonGap} />
          <SkeletonBlock width="70%" height={14} reduceMotion={reduceMotion} />
        </View>
      </View>
      <SkeletonBlock width="100%" height={62} radius={Radius.card} reduceMotion={reduceMotion} />
      <SkeletonBlock width="100%" height={180} radius={Radius.card} reduceMotion={reduceMotion} />
    </View>
  );
}

export default function PublicProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const params = useLocalSearchParams<{ accountId?: string; id?: string; handle?: string }>();
  const accountId = params.accountId || params.id || '';
  const handleParam = params.handle || '';
  const requestKey = accountId ? `id:${accountId}` : `handle:${handleParam}`;
  const [snapshot, setSnapshot] = useState<{
    key: string;
    detail: FriendProfileDetail | null;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void resolveProfile({ accountId, handle: handleParam }, controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setSnapshot({ key: requestKey, detail: result });
      }
    });
    return () => controller.abort();
  }, [accountId, handleParam, requestKey]);

  const loaded = snapshot?.key === requestKey;
  const detail = loaded ? snapshot.detail : null;
  const profile = detail?.profile;
  const handle = profile?.nickname
    ? `@${profile.nickname}`
    : profile?.displayName || cs.profile.noDisplayName;
  const together = detail?.stats.nightsTogether ?? 0;

  return (
    <View style={styles.screen}>
      <View style={[styles.top, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Zpět"
          hitSlop={8}
        >
          <ChevronLeftIcon size={20} color={Colors.foam} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xxl }]}
        showsVerticalScrollIndicator={false}
      >
        {!loaded ? (
          <ProfileSkeleton reduceMotion={reduceMotion} />
        ) : !detail || !profile ? (
          <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>
            Tenhle profil se nepodařilo načíst.
          </Text>
        ) : (
          <>
            <View style={styles.identity}>
              <Face
                name={handle}
                tint={Colors.amber}
                avatar={profile.avatarUrl ?? undefined}
                size={72}
              />
              <View style={styles.grow}>
                <Text
                  style={styles.handle}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.heading}
                >
                  {handle}
                </Text>
                <Text style={styles.since} maxFontSizeMultiplier={FontScaleCap.body}>
                  {together > 0
                    ? `Byli jste spolu ${together}× na pivu`
                    : 'Ještě jste spolu nebyli'}
                </Text>
              </View>
            </View>

            {detail.publicStats ? (
              <View style={styles.totals}>
                <StatGrid
                  columns={4}
                  compact
                  stats={[
                    { label: 'Piv', value: String(detail.publicStats.totalBeers) },
                    { label: 'Hospod', value: String(detail.publicStats.distinctPubs) },
                    { label: 'Úroveň', value: String(detail.publicStats.mapperLevel) },
                    { label: 'XP', value: String(detail.publicStats.mapperXp) },
                  ]}
                />
              </View>
            ) : null}

            {detail.achievements ? (
              <>
                <SectionBreak title="Odznaky" />
                <AchievementGrid mapper={undefined} achievements={detail.achievements} />
              </>
            ) : null}

            {!detail.publicStats && !detail.achievements ? (
              <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>
                Tenhle profil zatím nemá veřejné statistiky.
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  grow: { flex: 1 },
  pressed: { opacity: 0.65 },
  content: { paddingHorizontal: MockLayout.screenPad },
  top: { paddingHorizontal: MockLayout.screenPad, paddingBottom: Spacing.sm },
  back: {
    width: HitArea.min,
    height: HitArea.min,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.1),
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  handle: { ...MockType.titleXL, fontSize: 26, color: Colors.foam },
  since: { fontSize: 14, fontWeight: '500', color: Colors.mutedText, marginTop: 2 },
  totals: { marginTop: Spacing.xl },
  empty: {
    marginTop: Spacing.xl,
    fontSize: 14,
    fontWeight: '500',
    color: Colors.mutedText,
    textAlign: 'center',
  },
  skeleton: { gap: Spacing.xl },
  skeletonGap: { height: Spacing.sm },
});
