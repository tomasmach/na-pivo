import React, { memo, useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { FlagIcon } from '@/components/shared/IconGlyph';
import { showAppDialog } from '@/components/shared/AppDialog';
import { t } from '@/i18n';
import { useAccountStore } from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius } from '@/theme/layout';
import type { ContentReportReason } from '@/data/auth';

interface ReportProfileButtonProps {
  targetAccountId: string;
  targetLabel?: string;
  reason?: ContentReportReason;
}

export const ReportProfileButton = memo(function ReportProfileButton({
  targetAccountId,
  targetLabel,
  reason = 'other',
}: ReportProfileButtonProps) {
  const reportProfileContent = useAccountStore((s) => s.reportProfileContent);
  const showToast = useToastStore((s) => s.show);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await reportProfileContent({
        targetAccountId,
        reason,
        comment: targetLabel ?? '',
      });
      showToast(result.ok ? t.profile.report.sentToast : result.detail || t.profile.edit.errorGeneric);
    } finally {
      setBusy(false);
    }
  }, [busy, reason, reportProfileContent, showToast, targetAccountId, targetLabel]);

  const handlePress = useCallback(() => {
    showAppDialog({
      title: t.profile.report.confirmTitle,
      message: t.profile.report.confirmBody(targetLabel ?? t.profile.report.profileFallback),
      buttons: [
        { text: t.common.cancel, style: 'cancel' },
        { text: t.profile.report.confirmSubmit, style: 'destructive', onPress: submit },
      ],
      cancelable: true,
    });
  }, [submit, targetLabel]);

  return (
    <Pressable
      onPress={handlePress}
      disabled={busy}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={t.a11y.accountReportProfile}
      hitSlop={6}
    >
      <FlagIcon size={15} color={Colors.amber} />
      <Text style={styles.label} maxFontSizeMultiplier={FontScaleCap.body}>
        {t.profile.report.button}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.35),
  },
  label: {
    fontWeight: '600',
    fontSize: 13,
    color: Colors.amber,
  },
  pressed: {
    opacity: 0.7,
  },
});
