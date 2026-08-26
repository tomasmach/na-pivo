import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';

import { ChallengeDetailScreen } from '@/community/ChallengeDetailScreen';
import { fetchChallenge, type Challenge } from '@/data/challengesClient';
import SkeletonBlock from '@/friends/SkeletonBlock';
import { useAccountStore } from '@/stores/accountStore';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';

/**
 * Declared INSIDE the community stack so the tab bar stays put on the detail.
 * An unknown id can only come from a stale deep link, so it gets a sentence
 * rather than a spinner or a retry.
 */
export default function ChallengeRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const reduceMotion = useReducedMotion();
  const viewerAccountId = useAccountStore((state) => state.session?.accountId ?? null);
  const [resource, setResource] = React.useState<{
    viewerAccountId: string;
    challenge: Challenge | null;
    state: 'loading' | 'ready' | 'missing';
  } | null>(null);
  const [retry, setRetry] = React.useState(0);

  const visibleResource =
    resource?.viewerAccountId === viewerAccountId ? resource : null;
  const challenge = visibleResource?.challenge ?? null;
  const state = !viewerAccountId || !visibleResource ? 'loading' : visibleResource.state;

  React.useEffect(() => {
    if (!viewerAccountId || !id) return;
    let active = true;
    const controller = new AbortController();
    const requestedViewer = viewerAccountId;
    const kickoff = setTimeout(() => {
      setResource({ viewerAccountId: requestedViewer, challenge: null, state: 'loading' });
      void fetchChallenge(id, controller.signal).then((result) => {
        if (
          !active ||
          useAccountStore.getState().session?.accountId !== requestedViewer
        ) return;
        setResource({
          viewerAccountId: requestedViewer,
          challenge: result,
          state: result ? 'ready' : 'missing',
        });
      });
    }, 0);
    return () => {
      active = false;
      clearTimeout(kickoff);
      controller.abort();
    };
  }, [id, retry, viewerAccountId]);

  if (state === 'loading') {
    return (
      <View style={styles.loading} accessibilityLabel="Načítám výzvu">
        <SkeletonBlock width="72%" height={32} reduceMotion={reduceMotion} />
        <SkeletonBlock width="100%" height={92} reduceMotion={reduceMotion} />
        <SkeletonBlock width="88%" height={54} reduceMotion={reduceMotion} />
      </View>
    );
  }

  if (!challenge) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText} maxFontSizeMultiplier={FontScaleCap.body}>
          Výzvu se teď nepovedlo načíst.
        </Text>
        <Pressable
          onPress={() => setRetry((value) => value + 1)}
          accessibilityRole="button"
          style={styles.retry}
        >
          <Text style={styles.retryText}>Zkusit znovu</Text>
        </Pressable>
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
  loading: {
    flex: 1,
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 24,
    backgroundColor: Colors.stout,
  },
  missingText: { fontSize: 16, fontWeight: '500', color: Colors.mutedText },
  retry: { marginTop: 16, paddingHorizontal: 18, paddingVertical: 10 },
  retryText: { fontSize: 15, fontWeight: '700', color: Colors.amber },
});
