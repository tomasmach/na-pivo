import { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { showAppDialog } from '@/components/shared/AppDialog';
import { CloseButton } from '@/components/shared/CloseButton';
import { FlagIcon, MapPinPlusIcon, PencilIcon, Trash2Icon } from '@/components/shared/IconGlyph';
import type { PubReportReason } from '@/data/pubReportsClient';
import { cs } from '@/i18n/cs';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';

const SHEET_DISMISS_MS = 260;

interface ReportPubModalProps {
  visible: boolean;
  pubName: string;
  onClose: () => void;
  onAddPub: () => void;
  onRename: () => void;
  onReportReason: (reason: PubReportReason) => void;
}

export function ReportPubModal({
  visible,
  pubName,
  onClose,
  onAddPub,
  onRename,
  onReportReason,
}: ReportPubModalProps) {
  const insets = useSafeAreaInsets();
  const actionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (actionTimer.current) clearTimeout(actionTimer.current);
    },
    [],
  );
  const runAfterClose = useCallback(
    (action: () => void) => {
      onClose();
      if (actionTimer.current) clearTimeout(actionTimer.current);
      actionTimer.current = setTimeout(() => {
        actionTimer.current = null;
        action();
      }, SHEET_DISMISS_MS);
    },
    [onClose],
  );

  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
        <View style={[styles.panel, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <View style={styles.iconWell}>
              <FlagIcon size={18} color={Colors.amber} />
            </View>
            <View style={styles.titleWrap}>
              <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                {cs.compass.reportTitle}
              </Text>
            </View>
            <CloseButton onPress={onClose} label={cs.common.cancel} />
          </View>

          <View style={styles.actions}>
            <ActionButton
              first
              label={cs.compass.reportAddMissing}
              icon={<MapPinPlusIcon size={18} color={Colors.foam} />}
              onPress={() => runAfterClose(onAddPub)}
            />
            <ActionButton
              label={cs.compass.reportRename}
              icon={<PencilIcon size={18} color={Colors.foam} />}
              onPress={() => runAfterClose(onRename)}
            />
            <ActionButton
              label={cs.compass.reportNotPub}
              icon={<Trash2Icon size={18} color={Colors.amberLight} />}
              onPress={() =>
                runAfterClose(() =>
                  showAppDialog({
                    title: cs.compass.reportConfirmTitle(pubName),
                    message: cs.compass.reportConfirmBody,
                    buttons: [
                      { text: cs.compass.reportConfirmCancel, style: 'cancel' },
                      {
                        text: cs.compass.reportConfirmAction,
                        style: 'destructive',
                        onPress: () => onReportReason('not_pub'),
                      },
                    ],
                  }),
                )
              }
              tone="danger"
            />

          </View>
        </View>
      </View>
    </BottomSheetModal>
  );
}

function ActionButton({
  first = false,
  label,
  icon,
  onPress,
  tone = 'default',
}: {
  first?: boolean;
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  tone?: 'default' | 'danger';
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        first && styles.actionFirst,
        pressed && styles.actionPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.actionIcon}>{icon}</View>
      <Text
        style={[styles.actionText, tone === 'danger' && styles.actionTextDanger]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.82}
        maxFontSizeMultiplier={FontScaleCap.heading}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cardWrap: { width: '100%', maxHeight: '92%' },
  panel: {
    flexShrink: 1,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    backgroundColor: Colors.stout,
    paddingTop: Spacing.sm,
    paddingHorizontal: MockLayout.screenPad,
    gap: Spacing.md,
    ...softDrop(),
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.22),
    alignSelf: 'center',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWell: {
    width: 42,
    height: 42,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  titleWrap: { flex: 1, minWidth: 0 },
  title: { ...MockType.titleS, color: Colors.foam },
  actions: { marginTop: Spacing.sm },
  action: {
    minHeight: 60,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  actionFirst: { borderTopWidth: 0 },
  actionPressed: { opacity: 0.65 },
  actionIcon: { width: 24, alignItems: 'center', justifyContent: 'center' },
  actionText: {
    flex: 1,
    minWidth: 0,
    fontWeight: '700',
    fontSize: 16,
    color: Colors.foam,
  },
  actionTextDanger: { color: Colors.amberLight },
});
