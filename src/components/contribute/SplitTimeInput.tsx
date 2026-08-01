/**
 * A compact HH:MM time field — two number inputs with a fixed colon between —
 * shared by the inline opening-hours editor. Normalizes on blur (e.g. "9:5"
 * becomes "09:05") so the stored value is always a clean HH:MM string.
 */

import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { normalizeEditableHhMm } from '@/data/communityHours';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius } from '@/theme/layout';

function sanitizeTimePart(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 2);
}

function splitTimeInput(value: string): [string, string] {
  const [hours = '', minutes = ''] = value.split(':');
  return [sanitizeTimePart(hours), sanitizeTimePart(minutes)];
}

function withTimePart(value: string, which: 0 | 1, part: string): string {
  const next = splitTimeInput(value);
  next[which] = sanitizeTimePart(part);
  return `${next[0]}:${next[1]}`;
}

export function SplitTimeInput({
  value,
  onChange,
  accessibilityLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  accessibilityLabel: string;
}) {
  const [hours, minutes] = splitTimeInput(value);
  const normalize = () => {
    const normalized = normalizeEditableHhMm(value);
    if (normalized && normalized !== value) onChange(normalized);
  };

  return (
    <View style={styles.field}>
      <TextInput
        style={styles.part}
        value={hours}
        onChangeText={(part) => onChange(withTimePart(value, 0, part))}
        onBlur={normalize}
        placeholder="11"
        placeholderTextColor={Colors.mutedText}
        keyboardType="number-pad"
        maxLength={2}
        selectTextOnFocus
        maxFontSizeMultiplier={FontScaleCap.body}
        accessibilityLabel={`${accessibilityLabel} hodiny`}
      />
      <Text style={styles.colon} maxFontSizeMultiplier={FontScaleCap.body}>
        :
      </Text>
      <TextInput
        style={styles.part}
        value={minutes}
        onChangeText={(part) => onChange(withTimePart(value, 1, part))}
        onBlur={normalize}
        placeholder="00"
        placeholderTextColor={Colors.mutedText}
        keyboardType="number-pad"
        maxLength={2}
        selectTextOnFocus
        maxFontSizeMultiplier={FontScaleCap.body}
        accessibilityLabel={`${accessibilityLabel} minuty`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // A compact HH:MM chip — two tight number fields with a colon, ~56×34.
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 34,
    borderRadius: Radius.small,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 5,
  },
  part: {
    width: 19,
    color: Colors.foam,
    fontWeight: '600',
    fontSize: 14.5,
    paddingVertical: 0,
    textAlign: 'center',
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  colon: {
    fontWeight: '600',
    fontSize: 14.5,
    color: Colors.foamMuted,
    includeFontPadding: false,
    marginHorizontal: -1,
  },
});
