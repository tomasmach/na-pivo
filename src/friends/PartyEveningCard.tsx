import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CardSheen, CardSurface } from '@/components/shared/CardSurface';
import { CopyIcon } from '@/components/shared/IconGlyph';
import { PartyTable } from '@/friends/PartyTable';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea } from '@/theme/layout';

function countFontSize(count: number): number {
  if (count < 10) return 88;
  if (count < 100) return 72;
  return 56;
}

export interface PartyEveningCardProps {
  count: number;
  pubName: string;
  pubCity: string;
  code: string;
  hostLabel: string;
  pending: boolean;
  loading?: boolean;
  onCopyCode: () => void;
}

export function PartyEveningCard({
  count,
  pubName,
  pubCity,
  code,
  hostLabel,
  pending,
  loading = false,
  onCopyCode,
}: PartyEveningCardProps) {
  const [bodyHeight, setBodyHeight] = useState(0);
  const tableWidth = bodyHeight > 0 ? Math.max(72, Math.min(140, (bodyHeight - 16) * 0.72)) : 96;
  const numeralSize = countFontSize(count);
  const headline = [pubName, pubCity].filter(Boolean).join(' · ');

  return (
    <View style={styles.card}>
      <CardSheen />

      <View
        style={styles.content}
        accessibilityRole="text"
        accessibilityLabel={
          loading ? cs.partyEvening.loading : cs.partyEvening.cardA11y(count, headline, code)
        }
      >
        <View
          style={styles.body}
          onLayout={(event) => setBodyHeight(event.nativeEvent.layout.height)}
        >
          {!loading ? (
            <View style={styles.countColumn}>
              <Text
                style={[styles.count, { fontSize: numeralSize, lineHeight: numeralSize * 1.24 }]}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.display}
              >
                {count}
              </Text>
              <Text
                style={styles.countLabel}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {cs.partyEvening.tableCountLabel}
              </Text>
            </View>
          ) : (
            <View style={styles.countColumn} />
          )}
          <PartyTable going={loading ? 0 : count} maybe={0} mine={!loading} width={tableWidth} />
        </View>

        {loading ? (
          <View style={styles.headlinePlaceholder} />
        ) : (
          <Text
            style={styles.headline}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {headline}
          </Text>
        )}
      </View>

      <View style={styles.footer}>
        {loading ? (
          <View style={styles.factsPlaceholder} />
        ) : (
          <View style={styles.facts}>
            <Text
              style={styles.code}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {code}
            </Text>
            <Text
              style={styles.host}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {pending ? cs.partyEvening.pendingShort : hostLabel}
            </Text>
          </View>
        )}

        {!loading ? (
          <Pressable
            onPress={onCopyCode}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={cs.partyEvening.copyCodeA11y(code)}
            style={({ pressed }) => [styles.copyLink, pressed && styles.pressed]}
          >
            <CopyIcon size={15} color={Colors.amber} />
            <Text style={styles.copyLabel} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.partyEvening.copyCode}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...CardSurface.card,
    flex: 1,
  },
  content: {
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
  countLabel: {
    marginTop: -8,
    fontFamily: Fonts.display.bold,
    fontSize: 13,
    letterSpacing: 3,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  headline: {
    marginTop: 12,
    flexShrink: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
  },
  headlinePlaceholder: {
    marginTop: 12,
    height: 19,
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
    gap: 12,
  },
  facts: {
    flexShrink: 1,
    minWidth: 0,
  },
  factsPlaceholder: {
    minHeight: 35,
  },
  code: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    letterSpacing: 2,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  host: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  copyLink: {
    minHeight: HitArea.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 8,
  },
  copyLabel: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.amber,
    includeFontPadding: false,
  },
  pressed: {
    opacity: 0.7,
  },
});
