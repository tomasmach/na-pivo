/**
 * The pushed pub detail: the map, then the shared body.
 *
 * Everything below the map lives in `PubDetailBody`, because the places sheet on
 * the map screen shows exactly the same thing and two copies would drift.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';

import { TAB_CHROME } from '@/components/shared/TabBar';
import { NightRoute } from '@/mocks/NightRoute';
import { PubDetailBody } from '@/pubs/PubDetailBody';
import { EMPTY_NEARBY_PUB_FILTERS, useNearbyPubs } from '@/pubs/useNearbyPubs';
import { Colors } from '@/theme/colors';
import { Spacing } from '@/theme/layout';

export default function PubDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const nearby = useNearbyPubs(EMPTY_NEARBY_PUB_FILTERS);
  const pub = nearby.pubs.find((candidate) => candidate.id === id) ?? null;

  if (!pub) {
    return (
      <View style={styles.loading}>
        <View style={styles.mapSkeleton} />
        <Text style={styles.loadingText}>
          {nearby.loading ? 'Načítám hospodu…' : 'Tuhle hospodu teď nemám v okolí.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + TAB_CHROME }}
        showsVerticalScrollIndicator={false}
      >
        {/* Full-bleed map, the way the reference opens on a route. No back
            button of our own: the native header draws it on iOS 26's own glass
            capsule. Ours would be a flat copy. */}
        <NightRoute stops={[{ name: pub.name, lat: pub.lat, lng: pub.lng }]} height={260} />
        <PubDetailBody pub={pub} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  loading: { flex: 1, backgroundColor: Colors.stout, paddingBottom: Spacing.xl },
  mapSkeleton: { height: 260, backgroundColor: Colors.stout3 },
  loadingText: { color: Colors.mutedText, fontSize: 15, textAlign: 'center', marginTop: Spacing.xl },
});
