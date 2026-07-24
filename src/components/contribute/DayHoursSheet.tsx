import React from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CopyIcon, PlusIcon, Trash2Icon, XIcon } from '@/components/shared/IconGlyph';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { GlowButton } from '@/components/shared/GlowButton';
import {
  normalizeEditableHhMm,
  type DayKey,
  type HoursInterval,
} from '@/data/communityHours';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';

const MAX_INTERVALS = 3;

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

function SplitTimeInput({
  value,
  onChange,
  hourPlaceholder,
  minutePlaceholder,
  accessibilityLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  hourPlaceholder: string;
  minutePlaceholder: string;
  accessibilityLabel: string;
}) {
  const [hours, minutes] = splitTimeInput(value);
  const normalize = () => {
    const normalized = normalizeEditableHhMm(value);
    if (normalized && normalized !== value) onChange(normalized);
  };

  return (
    <View style={styles.splitTimeInput}>
      <TextInput
        style={styles.timePartInput}
        value={hours}
        onChangeText={(part) => onChange(withTimePart(value, 0, part))}
        onBlur={normalize}
        placeholder={hourPlaceholder}
        placeholderTextColor={Colors.mutedText}
        keyboardType="number-pad"
        maxLength={2}
        selectTextOnFocus
        accessibilityLabel={`${accessibilityLabel} hodiny`}
      />
      <Text style={styles.timeColon} maxFontSizeMultiplier={FontScaleCap.body}>
        :
      </Text>
      <TextInput
        style={styles.timePartInput}
        value={minutes}
        onChangeText={(part) => onChange(withTimePart(value, 1, part))}
        onBlur={normalize}
        placeholder={minutePlaceholder}
        placeholderTextColor={Colors.mutedText}
        keyboardType="number-pad"
        maxLength={2}
        selectTextOnFocus
        accessibilityLabel={`${accessibilityLabel} minuty`}
      />
    </View>
  );
}

interface DayHoursSheetProps {
  visible: boolean;
  day: DayKey;
  intervals: HoursInterval[];
  onChange: (intervals: HoursInterval[]) => void;
  onCopyToAll: () => void;
  onClose: () => void;
}

export function DayHoursSheet({
  visible,
  day,
  intervals,
  onChange,
  onCopyToAll,
  onClose,
}: DayHoursSheetProps) {
  const insets = useSafeAreaInsets();
  const dayName = cs.contribute.days[day];
  const isClosed = intervals.length === 0;

  const setIntervalValue = (index: number, which: 0 | 1, value: string) => {
    onChange(
      intervals.map((interval, intervalIndex) => {
        if (intervalIndex !== index) return interval;
        const next: HoursInterval = [interval[0], interval[1]];
        next[which] = value;
        return next;
      }),
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      presentationStyle="overFullScreen"
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
          <Pressable
            style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}
            onPress={() => undefined}
          >
            <View style={styles.grabber} />

            <View style={styles.header}>
              <Text
                style={styles.title}
                numberOfLines={2}
                maxFontSizeMultiplier={FontScaleCap.heading}
              >
                {cs.contribute.daySheetTitle(cs.contribute.daysIn[day])}
              </Text>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={cs.contribute.closeSheet}
              >
                <XIcon size={20} color={Colors.foamMuted} />
              </Pressable>
            </View>

            <KeyboardAwareScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Pressable
                onPress={() => onChange(isClosed ? [['11:00', '23:00']] : [])}
                style={({ pressed }) => [styles.closedRow, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityState={{ selected: isClosed }}
                accessibilityLabel={cs.a11y.contributeDayClosedToggle(dayName)}
              >
                <Text style={styles.closedLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.contribute.closedToggle}
                </Text>
                <View style={[styles.switchTrack, isClosed && styles.switchTrackSelected]}>
                  <View style={[styles.switchThumb, isClosed && styles.switchThumbSelected]} />
                </View>
              </Pressable>

              {!isClosed
                ? intervals.map((interval, index) => (
                    <View
                      key={index}
                      style={[styles.intervalRow, index > 0 && styles.rowDivider]}
                    >
                      <View style={styles.intervalFields}>
                        <SplitTimeInput
                          value={interval[0]}
                          onChange={(value) => setIntervalValue(index, 0, value)}
                          hourPlaceholder="11"
                          minutePlaceholder="00"
                          accessibilityLabel={`${dayName} ${cs.contribute.from}`}
                        />
                        <Text style={styles.timeDash} maxFontSizeMultiplier={FontScaleCap.body}>
                          –
                        </Text>
                        <SplitTimeInput
                          value={interval[1]}
                          onChange={(value) => setIntervalValue(index, 1, value)}
                          hourPlaceholder="23"
                          minutePlaceholder="00"
                          accessibilityLabel={`${dayName} ${cs.contribute.to}`}
                        />
                      </View>
                      <Pressable
                        onPress={() =>
                          onChange(intervals.filter((_, intervalIndex) => intervalIndex !== index))
                        }
                        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel={cs.a11y.contributeRemoveInterval(dayName)}
                      >
                        <Trash2Icon size={17} color={Colors.mutedText} />
                      </Pressable>
                    </View>
                  ))
                : null}

              {!isClosed && intervals.length < MAX_INTERVALS ? (
                <Pressable
                  onPress={() => onChange([...intervals, ['11:00', '23:00']])}
                  style={({ pressed }) => [styles.quietAction, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={cs.a11y.contributeAddInterval(dayName)}
                >
                  <PlusIcon size={16} color={Colors.amber} />
                  <Text style={styles.quietActionLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.contribute.addInterval}
                  </Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={onCopyToAll}
                style={({ pressed }) => [styles.copyRow, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={cs.a11y.contributeCopyToAll}
              >
                <CopyIcon size={16} color={Colors.foamMuted} />
                <Text style={styles.copyLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.contribute.copyCurrentDayToAll}
                </Text>
              </Pressable>
            </KeyboardAwareScrollView>

            <View style={styles.actions}>
              <GlowButton
                label={cs.contribute.done}
                onPress={onClose}
                accessibilityLabel={cs.contribute.done}
              />
            </View>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: withAlpha(Colors.black, 0.6),
    justifyContent: 'flex-end',
  },
  cardWrap: {
    width: '100%',
    minHeight: '56%',
    maxHeight: '92%',
  },
  card: {
    flex: 1,
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    ...softDrop(),
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: Spacing.sm,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
    includeFontPadding: false,
  },
  closeButton: {
    width: HitArea.min,
    height: HitArea.min,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flex: 1,
    marginTop: Spacing.sm,
  },
  listContent: {
    paddingBottom: Spacing.sm,
  },
  closedRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  closedLabel: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
  },
  switchTrack: {
    width: 48,
    height: 28,
    borderRadius: Radius.pill,
    padding: 3,
    justifyContent: 'center',
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  switchTrackSelected: {
    backgroundColor: withAlpha(Colors.amber, 0.18),
    borderColor: withAlpha(Colors.amber, 0.42),
  },
  switchThumb: {
    width: 20,
    height: 20,
    borderRadius: Radius.pill,
    backgroundColor: Colors.foamMuted,
  },
  switchThumbSelected: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.amber,
  },
  intervalRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: Spacing.sm,
  },
  intervalFields: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.border, 0.4),
  },
  splitTimeInput: {
    flex: 1,
    minWidth: 80,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.small,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 8,
  },
  timePartInput: {
    width: 28,
    color: Colors.foam,
    fontFamily: Fonts.ui.medium,
    fontSize: 15,
    paddingVertical: 8,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  timeColon: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  timeDash: {
    fontFamily: Fonts.ui.regular,
    fontSize: 16,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  iconButton: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quietAction: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  quietActionLabel: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.amber,
    includeFontPadding: false,
  },
  copyRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.border, 0.4),
  },
  copyLabel: {
    flexShrink: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  actions: {
    paddingTop: Spacing.md,
    marginTop: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  pressed: {
    opacity: 0.6,
  },
});
