import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_CHROME } from '@/components/shared/TabBar';
import { leaveRoute } from '@/navigation/leaveRoute';
import { getAllLoadedPubs, hydratePubsSnapshot, type Pub } from '@/data/pubs';
import { useCompass } from '@/hooks/useCompass';
import { NightRoute } from '@/mocks/NightRoute';
import { PubDetailBody } from '@/pubs/PubDetailBody';
import { presentPub } from '@/pubs/pubPresentation';
import { usePubVisits } from '@/pubs/usePubVisits';
import { usePubStore } from '@/stores/pubStore';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

function mergeCurrentPub(pubs: Pub[], current: Pub | null): Pub[] {
  if (!current) return pubs;
  const index = pubs.findIndex((pub) => pub.id === current.id);
  if (index === -1) return [current, ...pubs];
  const next = pubs.slice();
  next[index] = current;
  return next;
}

export default function PubDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [snapshotReady, setSnapshotReady] = React.useState(false);
  const compass = useCompass(null, [], null, null, true, false);
  const visits = usePubVisits();
  const revealedPub = usePubStore((state) => state.revealedPub);

  React.useEffect(() => {
    let active = true;
    void hydratePubsSnapshot().finally(() => {
      if (active) setSnapshotReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const pubs = mergeCurrentPub(getAllLoadedPubs(), compass.pub);
  const routeId = typeof id === 'string' ? id : null;
  const pub =
    (routeId ? pubs.find((candidate) => candidate.id === routeId) : null) ??
    (routeId && revealedPub?.id === routeId ? revealedPub : null);

  if (!pub) {
    const loading =
      !snapshotReady ||
      (compass.isLoading && compass.permissionState !== 'denied');
    return (
      <View style={styles.stateScreen}>
        {loading ? <ActivityIndicator color={Colors.amber} /> : null}
        <Text style={styles.stateText} maxFontSizeMultiplier={FontScaleCap.body}>
          {loading ? 'Načítám hospodu…' : 'Hospodu se nepodařilo načíst.'}
        </Text>
        {!loading ? (
          <Pressable
            onPress={compass.retrySearch}
            style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>Zkusit znovu</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const presentation = presentPub(pub, compass.currentPosition, visits);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + TAB_CHROME }}
        showsVerticalScrollIndicator={false}
      >
        <NightRoute stops={[{ name: pub.name, lat: pub.lat, lng: pub.lng }]} height={260} />
        <PubDetailBody
          key={pub.id}
          pub={presentation}
          position={compass.currentPosition}
          visits={visits}
          onClose={() => leaveRoute(router)}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  stateScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
    backgroundColor: Colors.stout,
  },
  stateText: { fontSize: 15, fontWeight: '600', color: Colors.mutedText },
  retry: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
  },
  retryText: { fontSize: 15, fontWeight: '700', color: Colors.foam },
  pressed: { opacity: 0.65 },
});
