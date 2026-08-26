import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import { t } from '@/i18n';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { useReleaseStore } from '@/stores/releaseStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';

const SHEET_DISMISS_MS = 260;

/** Release notes stay first in the launch-modal sequence until the sheet has left. */
export function WhatsNewModal() {
  const note = useReleaseStore((s) => s.pendingNote);
  const dismissNote = useReleaseStore((s) => s.dismissNote);
  const insets = useSafeAreaInsets();
  const [closing, setClosing] = useState(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    },
    [],
  );

  const close = useCallback(() => {
    if (!note || dismissTimer.current) return;
    setClosing(true);
    dismissTimer.current = setTimeout(() => {
      dismissTimer.current = null;
      dismissNote();
      setClosing(false);
    }, SHEET_DISMISS_MS);
  }, [dismissNote, note]);

  return (
    <BottomSheetModal visible={note !== null && !closing} onClose={close}>
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
        <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              {note?.title ?? t.whatsNew.defaultTitle}
            </Text>
            <CloseButton onPress={close} label={t.a11y.counterCloseModal} />
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {note?.items.map((item, index) => (
              <View key={`${item.text}-${index}`} style={[styles.row, index === 0 && styles.rowFirst]}>
                <Text style={styles.itemText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {item.text}
                </Text>
              </View>
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel={t.whatsNew.cta}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryPressed]}
            >
              <Text style={styles.primaryText} maxFontSizeMultiplier={FontScaleCap.display}>
                {t.whatsNew.cta}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  cardWrap: {
    width: '100%',
    maxHeight: '92%',
  },
  card: {
    flexShrink: 1,
    backgroundColor: Colors.stout,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    paddingTop: Spacing.sm,
    paddingHorizontal: MockLayout.screenPad,
    ...softDrop(),
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.22),
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  title: {
    flexShrink: 1,
    ...MockType.titleS,
    color: Colors.foam,
  },
  list: {
    flexGrow: 0,
    flexShrink: 1,
    marginTop: Spacing.sm,
  },
  listContent: {
    paddingBottom: Spacing.sm,
  },
  row: {
    minHeight: 56,
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  rowFirst: {
    borderTopWidth: 0,
  },
  itemText: {
    ...MockType.body,
    lineHeight: 22,
    color: Colors.foam,
  },
  footer: {
    paddingTop: Spacing.md,
    marginTop: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  primaryButton: {
    height: 56,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  primaryPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.97 }],
  },
  primaryText: {
    ...MockType.buttonLabel,
    color: Colors.stout,
  },
});
