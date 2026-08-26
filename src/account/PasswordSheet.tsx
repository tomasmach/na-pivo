import React from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlowButton } from '@/components/shared/GlowButton';
import { CloseButton } from '@/components/shared/CloseButton';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { t } from '@/i18n';
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';

interface PasswordSheetProps {
  visible: boolean;
  hasProfileEmail: boolean;
  email: string;
  password: string;
  error: string;
  busy: boolean;
  onChangeEmail: (value: string) => void;
  onChangePassword: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export function PasswordSheet({
  visible,
  hasProfileEmail,
  email,
  password,
  error,
  busy,
  onChangeEmail,
  onChangePassword,
  onSave,
  onClose,
}: PasswordSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <BottomSheetModal visible={visible} onClose={onClose} keyboardLift>
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
        <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grabber} />

          <View style={styles.header}>
            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              {t.account.setPasswordHeader}
            </Text>
            <CloseButton onPress={onClose} label={t.a11y.counterCloseModal} />
          </View>

          <KeyboardAwareScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardAvoidedExternally
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {!hasProfileEmail ? (
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={onChangeEmail}
                placeholder={t.account.emailPlaceholder}
                placeholderTextColor={MockColors.fieldHint}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
                accessibilityLabel={t.a11y.authEmailInput}
                maxFontSizeMultiplier={FontScaleCap.body}
              />
            ) : null}

            <TextInput
              style={styles.input}
              value={password}
              onChangeText={onChangePassword}
              placeholder={t.account.passwordPlaceholder}
              placeholderTextColor={MockColors.fieldHint}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              accessibilityLabel={t.a11y.authNewPasswordInput}
              maxFontSizeMultiplier={FontScaleCap.body}
            />

            {error ? (
              <Text style={styles.error} maxFontSizeMultiplier={FontScaleCap.body}>
                {error}
              </Text>
            ) : null}
          </KeyboardAwareScrollView>

          <View style={styles.footer}>
            <GlowButton
              label={busy ? t.account.loading : t.account.setPasswordSave}
              onPress={onSave}
              glow="none"
              height={52}
              loading={busy}
              accessibilityLabel={t.a11y.accountSetPassword}
            />
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
    marginBottom: Spacing.lg,
  },
  title: {
    flexShrink: 1,
    ...MockType.titleS,
    color: Colors.foam,
    includeFontPadding: false,
  },
  body: {
    flexGrow: 0,
    flexShrink: 1,
  },
  bodyContent: {
    gap: 12,
  },
  input: {
    minHeight: 52,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: MockColors.field,
    paddingHorizontal: 14,
    fontWeight: '500',
    fontSize: 16,
    color: Colors.foam,
    includeFontPadding: false,
  },
  error: {
    fontWeight: '500',
    fontSize: 13,
    color: Colors.amberLight,
    includeFontPadding: false,
  },
  footer: {
    paddingTop: Spacing.md,
    marginTop: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
});
