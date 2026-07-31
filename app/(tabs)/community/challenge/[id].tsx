import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { ChallengeDetailScreen } from '@/community/ChallengeDetailScreen';
import { findChallenge } from '@/community/mockChallenges';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';

/**
 * Declared INSIDE the community stack so the tab bar stays put on the detail.
 * An unknown id can only come from a stale deep link, so it gets a sentence
 * rather than a spinner or a retry.
 */
export default function ChallengeRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const challenge = findChallenge(id);

  if (!challenge) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText} maxFontSizeMultiplier={FontScaleCap.body}>
          Tuhle výzvu už nenajdeme.
        </Text>
      </View>
    );
  }

  return <ChallengeDetailScreen challenge={challenge} />;
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
