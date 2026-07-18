import { useCallback } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  FlagIcon,
  MapPinPlusIcon,
  PencilIcon,
  Trash2Icon,
  XIcon,
} from '@/components/shared/IconGlyph';
import type { PubReportReason } from '@/data/pubReportsClient';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius } from '@/theme/layout';

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
  const runAfterClose = useCallback((action: () => void) => {
    onClose();
    action();
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable
          style={styles.scrim}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={cs.common.cancel}
        />
        <View style={styles.panel}>
          <View style={styles.header}>
            <View style={styles.iconWell}>
              <FlagIcon size={18} color={Colors.amber} />
            </View>
            <View style={styles.titleWrap}>
              <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                {cs.compass.reportTitle}
              </Text>
              <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.compass.reportBody(pubName)}
              </Text>
            </View>
          </View>

          <View style={styles.actions}>
            <ActionButton
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
              label={cs.compass.reportRemove}
              icon={<Trash2Icon size={18} color={Colors.amberLight} />}
              onPress={() => runAfterClose(() => onReportReason('not_pub'))}
              tone="danger"
            />
            <ActionButton
              label={cs.common.cancel}
              icon={<XIcon size={18} color={Colors.mutedText} />}
              onPress={onClose}
              tone="ghost"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ActionButton({
  label,
  icon,
  onPress,
  tone = 'default',
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  tone?: 'default' | 'danger' | 'ghost';
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        tone === 'danger' && styles.actionDanger,
        tone === 'ghost' && styles.actionGhost,
        pressed && styles.actionPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.actionIcon}>{icon}</View>
      <Text
        style={[
          styles.actionText,
          tone === 'danger' && styles.actionTextDanger,
          tone === 'ghost' && styles.actionTextGhost,
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.82}
        maxFontSizeMultiplier={FontScaleCap.heading}
      >
        {label}
      </Text>
      <View style={styles.actionIcon} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: withAlpha(Colors.black, 0.68) },
  panel: {
    marginHorizontal: 14,
    marginBottom: 18,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.34),
    backgroundColor: Colors.stout2,
    padding: 18,
    gap: 16,
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.36,
    shadowRadius: 24,
    elevation: 16,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWell: {
    width: 42,
    height: 42,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.28),
  },
  titleWrap: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontFamily: Fonts.display.extrabold, fontSize: 25, lineHeight: 30, color: Colors.foam },
  body: { fontFamily: Fonts.ui.regular, fontSize: 14, lineHeight: 20, color: Colors.foamMuted },
  actions: { gap: 10 },
  action: {
    minHeight: 54,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.28),
    backgroundColor: Colors.stout3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    gap: 10,
  },
  actionDanger: {
    borderColor: withAlpha(Colors.amber, 0.42),
    backgroundColor: withAlpha(Colors.glow, 0.13),
  },
  actionGhost: { borderColor: Colors.border, backgroundColor: withAlpha(Colors.stout, 0.45) },
  actionPressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  actionIcon: { width: 24, alignItems: 'center', justifyContent: 'center' },
  actionText: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
    fontFamily: Fonts.ui.bold,
    fontSize: 16,
    color: Colors.foam,
  },
  actionTextDanger: { color: Colors.amberLight },
  actionTextGhost: { color: Colors.foamMuted },
});
