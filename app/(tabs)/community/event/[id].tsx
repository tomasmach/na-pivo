import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { EventDetailScreen } from '@/community/EventDetailScreen';
import { findEvent } from '@/community/mockEvents';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';

export default function EventRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const event = findEvent(id);

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
