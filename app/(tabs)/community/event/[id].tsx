import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';

import { EventDetailScreen } from '@/community/EventDetailScreen';
import { fetchCommunityEvent, type CommunityEvent } from '@/data/communityEventsClient';
import SkeletonBlock from '@/friends/SkeletonBlock';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';

export default function EventRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const reduceMotion = useReducedMotion();
  const [event, setEvent] = React.useState<CommunityEvent | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [revision, setRevision] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const kickoff = setTimeout(() => {
      setLoading(true);
      setError(null);
      void fetchCommunityEvent(id, controller.signal).then((result) => {
        if (!active) return;
        setEvent(result.ok ? result.event : null);
        setError(result.ok ? null : result.detail);
        setLoading(false);
      });
    }, 0);
    return () => {
      active = false;
      clearTimeout(kickoff);
      controller.abort();
    };
  }, [id, revision]);

  if (loading) {
    return (
      <View style={styles.loading} accessibilityLabel="Načítám akci">
        <SkeletonBlock width="100%" height={160} reduceMotion={reduceMotion} />
        <SkeletonBlock width="72%" height={32} reduceMotion={reduceMotion} />
        <SkeletonBlock width="90%" height={68} reduceMotion={reduceMotion} />
      </View>
    );
  }

  if (!event) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText} maxFontSizeMultiplier={FontScaleCap.body}>
          {error ?? 'Tuhle akci už nenajdeme.'}
        </Text>
        <Pressable
          onPress={() => setRevision((value) => value + 1)}
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Zkusit načíst akci znovu"
        >
          <Text style={styles.retryText}>Zkusit znovu</Text>
        </Pressable>
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
  loading: {
    flex: 1,
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 24,
    backgroundColor: Colors.stout,
  },
  missingText: {
    maxWidth: 300,
    fontSize: 16,
    fontWeight: '500',
    color: Colors.mutedText,
    textAlign: 'center',
  },
  retry: { marginTop: 12, paddingHorizontal: 18, paddingVertical: 12 },
  retryText: { fontSize: 15, fontWeight: '700', color: Colors.amber },
  pressed: { opacity: 0.65 },
});
