/**
 * A compact HH:MM time field — two number inputs with a fixed colon between —
 * shared by the inline opening-hours editor. Normalizes on blur (e.g. "9:5"
 * becomes "09:05") so the stored value is always a clean HH:MM string.
 */

import React from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { normalizeEditableHhMm } from '@/data/communityHours';
import { MockColors } from '@/mocks/mockTheme';
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

  // Size the chip from the effective font scale so two digits always fit —
  // Android renders slightly wider glyphs and clips fixed-width inputs.
  const { fontScale } = useWindowDimensions();
  const scale = Math.min(Math.max(fontScale, 1), FontScaleCap.body);
  const partStyle = [styles.part, { width: Math.ceil(23 * scale) }];
  const fieldStyle = [styles.field, { height: Math.ceil(36 * scale) }];

  return (
    <View style={fieldStyle}>
      <TextInput
        style={partStyle}
        value={hours}
        onChangeText={(part) => onChange(withTimePart(value, 0, part))}
        onBlur={normalize}
        placeholder="11"
        placeholderTextColor={MockColors.fieldHint}
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
        style={partStyle}
        value={minutes}
        onChangeText={(part) => onChange(withTimePart(value, 1, part))}
        onBlur={normalize}
        placeholder="00"
        placeholderTextColor={MockColors.fieldHint}
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
  // A compact HH:MM chip — two tight number fields with a colon; width and
  // height are finished inline from the effective font scale.
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.small,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 5,
  },
  part: {
    height: '100%',
    color: Colors.foam,
    fontWeight: '600',
    fontSize: 14.5,
    // Android TextInput ships default internal padding that eats the tight
    // width and clips digits — zero it explicitly on every side.
    padding: 0,
    margin: 0,
    textAlign: 'center',
    textAlignVertical: 'center',
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
