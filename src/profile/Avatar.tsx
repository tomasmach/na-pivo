/**
 * Profile avatar disk. Renders the remote image when `uri` is set, otherwise an
 * amber-tinted fallback disk showing either the user's initials (derived from
 * nickname / display name) or a generic user glyph. Sized via `size`; the amber
 * ring scales with it. Uses RN `Image` (expo-image is not a dependency on this
 * branch — swap in later for caching if it lands).
 */

import React, { memo, useEffect, useMemo, useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';

import { UserIcon } from '@/components/shared/IconGlyph';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';

interface AvatarProps {
  /** Absolute, loadable avatar URL, or null for the fallback. */
  uri?: string | null;
  /** Source for initials when there is no image. */
  nickname?: string | null;
  displayName?: string | null;
  size?: number;
  /** Quiet profile-row border; the default keeps the existing amber ring. */
  border?: 'amber' | 'quiet';
}

/** First letter of nickname (preferred) or display name, uppercased — or null. */
function initialOf(nickname?: string | null, displayName?: string | null): string | null {
  const source = (nickname && nickname.trim()) || (displayName && displayName.trim()) || '';
  const first = source.charAt(0);
  return first ? first.toUpperCase() : null;
}

export const Avatar = memo(function Avatar({
  uri,
  nickname,
  displayName,
  size = 72,
  border = 'amber',
}: AvatarProps) {
  const initial = useMemo(() => initialOf(nickname, displayName), [nickname, displayName]);

  // Track image load failure (404, expired/purged asset, offline) so we fall
  // through to the initials/glyph instead of showing a blank amber-ringed disk.
  // Reset whenever the URL changes (e.g. a `?v=` cache-bust mints a new asset).
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);

  const diskStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };
  const borderStyle = border === 'quiet' ? styles.quietBorder : styles.amberBorder;

  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        style={[styles.image, borderStyle, diskStyle]}
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
      />
    );
  }

  return (
    <View style={[styles.fallback, borderStyle, diskStyle]}>
      {initial ? (
        <Text
          style={[styles.initial, { fontSize: Math.round(size * 0.42) }]}
          maxFontSizeMultiplier={FontScaleCap.display}
          allowFontScaling={false}
        >
          {initial}
        </Text>
      ) : (
        <UserIcon size={Math.round(size * 0.42)} color={Colors.amber} />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  image: {
    backgroundColor: Colors.stout3,
  },
  amberBorder: {
    borderWidth: 2,
    borderColor: withAlpha(Colors.amber, 0.5),
  },
  quietBorder: {
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.1),
  },
  fallback: {
    backgroundColor: withAlpha(Colors.amber, 0.16),
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    fontWeight: '800',
    color: Colors.amber,
    textAlign: 'center',
    includeFontPadding: false,
  },
});
