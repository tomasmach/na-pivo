/**
 * The pushed pub detail: the map, then the shared body.
 *
 * Everything below the map lives in `PubDetailBody`, because the places sheet on
 * the map screen shows exactly the same thing and two copies would drift.
 */

import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';

import { TAB_CHROME } from '@/components/shared/TabBar';
import { NightRoute } from '@/mocks/NightRoute';
import { PubDetailBody } from '@/pubs/PubDetailBody';
import { MOCK_PUBS } from '@/pubs/mockPubs';
import { Colors } from '@/theme/colors';

export default function PubDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const pub = MOCK_PUBS.find((p) => p.id === id) ?? MOCK_PUBS[0];

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
});
