import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CardSheen, CardSurface } from '@/components/shared/CardSurface';
import { PinMat } from '@/addedPubs/PinMat';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';

function countFontSize(count: number): number {
  if (count < 10) return 88;
  if (count < 100) return 72;
  return 56;
}

export interface AddedPubsCardProps {
  syncedCount: number;
  totalCount: number;
  caption: string;
  headline: string | null;
  factStrong: string;
  factMuted: string;
}

export function AddedPubsCard({
  syncedCount,
  totalCount,
  caption,
  headline,
  factStrong,
  factMuted,
}: AddedPubsCardProps) {
  const [bodyHeight, setBodyHeight] = useState(0);
  const matWidth =
    bodyHeight > 0 ? Math.max(64, Math.min(112, (bodyHeight - 16) * 0.66)) : 88;
  const numeralSize = countFontSize(syncedCount);

  return (
    <View style={styles.card} accessibilityRole="text">
      <CardSheen />

      <View style={styles.body} onLayout={(event) => setBodyHeight(event.nativeEvent.layout.height)}>
        <View style={styles.countColumn}>
          <Text
            style={[
              styles.count,
              { fontSize: numeralSize, lineHeight: numeralSize * 1.24 },
            ]}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.display}
          >
            {syncedCount}
          </Text>
          <Text style={styles.caption} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {caption}
          </Text>
        </View>
        <PinMat count={totalCount} width={matWidth} />
      </View>

      {headline !== null ? (
        <Text
          style={styles.headline}
          numberOfLines={2}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {headline}
        </Text>
      ) : null}

      <View style={styles.footer}>
        <View style={styles.facts}>
          <Text
            style={styles.factStrong}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {factStrong}
          </Text>
          <Text
            style={styles.factMuted}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {factMuted}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...CardSurface.card,
    flex: 1,
  },
  body: {
    flex: 1,
    minHeight: 132,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  countColumn: {
    flexShrink: 1,
    minWidth: 0,
  },
  count: {
    fontFamily: Fonts.display.extrabold,
    color: Colors.amber,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  caption: {
    marginTop: -8,
    fontFamily: Fonts.display.bold,
    fontSize: 13,
    letterSpacing: 3,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  headline: {
    marginTop: 12,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
  },
  footer: {
    marginTop: 20,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  facts: {
    flexShrink: 1,
    minWidth: 0,
  },
  factStrong: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  factMuted: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
});
