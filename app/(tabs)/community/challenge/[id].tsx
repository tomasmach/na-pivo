import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { ChallengeDetailScreen } from '@/community/ChallengeDetailScreen';
import { CommunityDetailSkeleton } from '@/community/CommunityDetailSkeleton';
import { fetchChallenge, type Challenge } from '@/data/challengesClient';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';

/**
 * Declared INSIDE the community stack so the tab bar stays put on the detail.
 * An unknown id can only come from a stale deep link, so it gets a sentence
 * rather than a spinner or a retry.
 */
export default function ChallengeRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [result, setResult] = React.useState<{ id: string; challenge: Challenge | null } | null>(null);

  React.useEffect(() => {
    const abort = new AbortController();
    void fetchChallenge(id, { signal: abort.signal }).then((challenge) => {
      if (abort.signal.aborted) return;
      setResult({ id, challenge });
    });
    return () => abort.abort();
  }, [id]);

  if (result?.id !== id) return <CommunityDetailSkeleton />;
  const challenge = result.challenge;

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
