import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { EventDetailScreen } from '@/community/EventDetailScreen';
import { CommunityDetailSkeleton } from '@/community/CommunityDetailSkeleton';
import { fetchCommunityEvent, type CommunityEvent } from '@/data/communityEventsClient';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';

export default function EventRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [result, setResult] = React.useState<{ id: string; event: CommunityEvent | null } | null>(null);

  React.useEffect(() => {
    const abort = new AbortController();
    void fetchCommunityEvent(id, abort.signal).then((event) => {
      if (abort.signal.aborted) return;
      setResult({ id, event });
    });
    return () => abort.abort();
  }, [id]);

  if (result?.id !== id) return <CommunityDetailSkeleton poster />;
  const event = result.event;

  if (!event) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText} maxFontSizeMultiplier={FontScaleCap.body}>
          Tuhle akci už nenajdeme.
        </Text>
      </View>
    );
  }

  return <EventDetailScreen event={event} />;
}

const styles = StyleSheet.create({
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.stout,
  },
  missingText: { fontSize: 16, fontWeight: '500', color: Colors.mutedText },
});
