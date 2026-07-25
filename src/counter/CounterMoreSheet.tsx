/**
 * "Co ještě?" — the counter's overflow sheet.
 *
 * The counter screen itself holds exactly four things now: where you are, how
 * many you've had, one nudge, and one CTA — plus one glyph in the header for
 * "cvakni pivo", which earned its way back out of this list because a camera two
 * taps deep is a camera nobody uses. Everything else that used to sit on that
 * screen as a competing row of pills (story sticker, parta ping, backdating,
 * menu scan) lives here, one tap deeper, as a plain labelled list. Mapping the
 * pub left too, for the same reason: it is a chip in the card now.
 *
 * One intent per sheet: adds live in "Co si dáš?", closing the night in "Tvůj
 * účet" — this sheet only carries the rest, plus a "Dopito" shortcut pinned first
 * because leaving is the one thing people hunt for.
 *
 * Rows are declarative: the host passes only the handlers that apply (outside a
 * pub there is no menu to scan), and a missing handler drops
 * its row. Every row closes the sheet before running its action — several of
 * them open another modal, and iOS refuses to present one while a sheet is
 * still on screen, so the host defers via `runAfterSheetClose`.
 */

import React from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { cs } from '@/i18n/cs';
import {
  BellRingIcon,
  CameraIcon,
  CheckIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  HistoryIcon,
  Share2Icon,
  XIcon,
} from '@/components/shared/IconGlyph';

interface SheetRow {
  key: string;
  label: string;
  Icon: typeof CameraIcon;
  onPress: () => void;
  /** Muted + non-interactive (already broadcast, scan in flight). */
  disabled?: boolean;
  /** Overrides the visible label for screen readers when the two differ. */
  a11yLabel?: string;
}

export interface CounterMoreSheetProps {
  visible: boolean;
  onClose: () => void;
  /** "Dopito" — ends the night. Pinned first when present. */
  onDone?: () => void;
  /** Story sticker; omitted outside a pub (there's no pub to invite anyone to). */
  onSticker?: () => void;
  /** One-tap "I'm here" broadcast to the parta. Pub only. */
  onPingFriends?: () => void;
  /** Already broadcast at this pub — the row stays visible but goes calm. */
  broadcasted?: boolean;
  onBackdate: () => void;
  /** AI menu scan. Pub only. */
  onScanMenu?: () => void;
  scanning?: boolean;
}

export function CounterMoreSheet({
  visible,
  onClose,
  onDone,
  onSticker,
  onPingFriends,
  broadcasted = false,
  onBackdate,
  onScanMenu,
  scanning = false,
}: CounterMoreSheetProps) {
  const insets = useSafeAreaInsets();

  const rows: SheetRow[] = [
    ...(onDone
      ? [
          {
            key: 'done',
            label: cs.counter.doneDrinking,
            Icon: CheckIcon,
            onPress: onDone,
            a11yLabel: cs.a11y.counterDone,
          },
        ]
      : []),
    ...(onSticker
      ? [{ key: 'sticker', label: cs.counter.moreStory, Icon: Share2Icon, onPress: onSticker }]
      : []),
    ...(onPingFriends
      ? [
          {
            key: 'ping',
            label: broadcasted ? cs.friends.counterAlreadyLive : cs.friends.shareHereShort,
            Icon: broadcasted ? CheckIcon : BellRingIcon,
            onPress: onPingFriends,
            disabled: broadcasted,
          },
        ]
      : []),
    { key: 'backdate', label: cs.counter.backdateLink, Icon: HistoryIcon, onPress: onBackdate },
    ...(onScanMenu
      ? [
          {
            key: 'scan',
            label: scanning ? cs.counter.scanDrinksLoading : cs.counter.scanDrinks,
            Icon: ClipboardListIcon,
            onPress: onScanMenu,
            disabled: scanning,
          },
        ]
      : []),
  ];

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      presentationStyle="overFullScreen"
      animationType="fade"
      onRequestClose={onClose}
    >
      {/* The backdrop is a dismiss target, not an announced control: the real
          close button carries the label so VoiceOver hears "Zavřít" once. */}
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityElementsHidden importantForAccessibility="no">
        {/* The card swallows backdrop taps so a row press never dismisses twice. */}
        <Pressable
          style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}
          onPress={() => undefined}
        >
          <View style={styles.grabber} />

          <View style={styles.header}>
            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.counter.moreTitle}
            </Text>
            <Pressable
              onPress={onClose}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel={cs.a11y.counterCloseModal}
            >
              <XIcon size={20} color={Colors.foamMuted} />
            </Pressable>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
            {rows.map(({ key, label, Icon, onPress, disabled, a11yLabel }) => (
              <Pressable
                key={key}
                onPress={onPress}
                disabled={disabled}
                style={({ pressed }) => [styles.row, (pressed || disabled) && styles.rowPressed]}
                accessibilityRole="button"
                accessibilityLabel={a11yLabel ?? label}
              >
                <View style={styles.rowIcon}>
                  <Icon size={18} color={disabled ? Colors.mutedText : Colors.amber} />
                </View>
                <Text
                  style={[styles.rowLabel, disabled && styles.rowLabelDisabled]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {label}
                </Text>
                {disabled ? null : <ChevronRightIcon size={16} color={Colors.mutedText} />}
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
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
  },
  card: {
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    maxHeight: '92%',
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
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  title: {
    flexShrink: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
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
  list: { flexGrow: 0 },
  listContent: { gap: 8, paddingBottom: Spacing.sm },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    borderRadius: Radius.medium,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rowPressed: { opacity: 0.75 },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  rowLabel: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
  },
  rowLabelDisabled: { color: Colors.mutedText },
});
