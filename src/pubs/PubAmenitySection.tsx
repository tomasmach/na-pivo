import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { usePubAmenityMapping } from '@/components/amenities/usePubAmenityMapping';
import { TriangleAlertIcon } from '@/components/shared/IconGlyph';
import type { AmenityRow } from '@/data/pubAmenitiesView';
import { t } from '@/i18n';
import { SectionBreak } from '@/mocks/SectionBreak';
import type { AmenityVote } from '@/stores/pubAmenitiesStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

function confidenceText(row: AmenityRow, resolved: boolean): string | null {
  if (resolved && row.yesCount === 0 && row.noCount === 0 && row.myValue != null) {
    return t.mapPub.confFirst;
  }
  if (row.signalState !== 'known') return null;
  if (row.status === 'disputed') return t.mapPub.confDisputed;
  const isNo = row.status === 'no' || (row.status === 'unknown' && row.noCount > row.yesCount);
  const count = isNo ? row.noCount : row.yesCount;
  return isNo ? t.mapPub.confNo(count) : t.mapPub.confHas(count);
}

function VoteButton({
  row,
  value,
  onVote,
}: {
  row: AmenityRow;
  value: AmenityVote;
  onVote: (row: AmenityRow, value: AmenityVote) => void;
}) {
  const active = row.myValue === value;
  const label = value === 'yes' ? t.mapPub.yes : t.mapPub.no;
  return (
    <Pressable
      onPress={() => onVote(row, value)}
      style={({ pressed }) => [
        styles.voteButton,
        value === 'no' && styles.voteButtonRight,
        active && styles.voteButtonActive,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={
        value === 'yes' ? t.mapPub.yesA11y(row.label) : t.mapPub.noA11y(row.label)
      }
      accessibilityHint={active ? t.mapPub.clearHint : undefined}
    >
      <Text style={[styles.voteText, active && styles.voteTextActive]} allowFontScaling={false}>
        {label}
      </Text>
    </Pressable>
  );
}

export function PubAmenitySection({
  visible,
  pubKey,
  pubName,
}: {
  visible: boolean;
  pubKey: string;
  pubName: string;
}) {
  const { rows, aggregatesResolved, onVote } = usePubAmenityMapping({
    visible,
    pubKey,
    pubName,
  });

  return (
    <View>
      <SectionBreak title={t.pubDetail.amenitiesTitle} />
      {rows.map((row, index) => {
        const confidence = confidenceText(row, aggregatesResolved);
        return (
          <View key={row.amenityKey} style={[styles.row, index > 0 && styles.rowDivider]}>
            <View style={styles.copy}>
              <Text style={styles.label} maxFontSizeMultiplier={FontScaleCap.body}>
                {row.label}
              </Text>
              {confidence ? (
                <View style={styles.confidenceRow}>
                  {row.status === 'disputed' ? (
                    <TriangleAlertIcon size={12} color={Colors.amberLight} />
                  ) : null}
                  <Text
                    style={styles.confidence}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {confidence}
                  </Text>
                </View>
              ) : null}
            </View>
            <View style={styles.voteGroup}>
              <VoteButton row={row} value="yes" onVote={onVote} />
              <VoteButton row={row} value="no" onVote={onVote} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  copy: { flex: 1, minWidth: 0 },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: Colors.foam },
  confidenceRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  confidence: { flexShrink: 1, fontSize: 12, lineHeight: 16, color: Colors.mutedText },
  voteGroup: {
    flexDirection: 'row',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.18),
    borderRadius: Radius.small,
  },
  voteButton: {
    width: 48,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.stout3,
  },
  voteButtonRight: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: withAlpha(Colors.foam, 0.18),
  },
  voteButtonActive: { backgroundColor: Colors.amber },
  voteText: { fontSize: 12, fontWeight: '800', color: Colors.foamMuted },
  voteTextActive: { color: Colors.stout },
  pressed: { opacity: 0.7 },
});
