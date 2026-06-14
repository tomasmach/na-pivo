/**
 * A tiny read-only indicator of the user's personal verdict on a pub, shown on
 * past-evening rows where the full rating control would be too heavy. Renders
 * nothing when the pub is unrated.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';

import { Colors } from '@/theme/colors';
import { ThumbsUpIcon, ThumbsDownIcon } from '@/components/shared/IconGlyph';
import type { PubVerdict } from '@/stores/pubRatingsStore';

export function VerdictBadge({ verdict }: { verdict?: PubVerdict }) {
  if (!verdict) return null;
  const like = verdict === 'like';
  return (
    <View style={[styles.badge, like ? styles.badgeLike : styles.badgeDislike]}>
      {like ? (
        <ThumbsUpIcon size={14} color={Colors.stout} />
      ) : (
        <ThumbsDownIcon size={14} color={Colors.foam} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLike: {
    backgroundColor: Colors.success,
  },
  badgeDislike: {
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.mutedText,
  },
});
