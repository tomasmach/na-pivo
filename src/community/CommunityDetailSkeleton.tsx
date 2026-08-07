import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_CHROME } from '@/components/shared/TabBar';
import SkeletonBlock from '@/friends/SkeletonBlock';
import { MockLayout } from '@/mocks/mockTheme';
import { Colors } from '@/theme/colors';
import { Radius, Spacing } from '@/theme/layout';
import { useReduceMotion } from '@/utils/useReduceMotion';

export function CommunityDetailSkeleton({ poster = false }: { poster?: boolean }) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  return (
    <View
      style={[
        styles.screen,
        { paddingTop: insets.top + 68, paddingBottom: insets.bottom + TAB_CHROME },
      ]}
    >
      {poster ? (
        <SkeletonBlock width={160} height={160} radius={0} reduceMotion={reduceMotion} />
      ) : null}
      <SkeletonBlock width="78%" height={30} reduceMotion={reduceMotion} />
      <SkeletonBlock width="100%" height={18} reduceMotion={reduceMotion} />
      <SkeletonBlock width="88%" height={18} reduceMotion={reduceMotion} />
      <View style={styles.section}>
        <SkeletonBlock width="42%" height={42} reduceMotion={reduceMotion} />
        <SkeletonBlock width="100%" height={8} radius={Radius.pill} reduceMotion={reduceMotion} />
      </View>
      <SkeletonBlock width="48%" height={20} reduceMotion={reduceMotion} />
      <SkeletonBlock width="100%" height={56} reduceMotion={reduceMotion} />
      <SkeletonBlock width="100%" height={56} reduceMotion={reduceMotion} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    gap: Spacing.md,
    paddingHorizontal: MockLayout.screenPad,
    backgroundColor: Colors.stout,
  },
  section: { gap: Spacing.sm, marginTop: Spacing.lg },
});
