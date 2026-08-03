import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlowButton } from '@/components/shared/GlowButton';
import { XIcon } from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { MockColors } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
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

        <KeyboardAvoidingView
          style={styles.keyboardWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          pointerEvents="box-none"
        >
          <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
            <Pressable
              style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}
              onPress={() => undefined}
            >
              <View style={styles.grabber} />

              <View style={styles.header}>
                <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {cs.account.setPasswordHeader}
                </Text>
                <Pressable
                  onPress={onClose}
                  style={({ pressed }) => [
                    styles.closeButton,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={cs.a11y.counterCloseModal}
                >
                  <XIcon size={20} color={Colors.foamMuted} />
                </Pressable>
              </View>

              <View style={styles.body}>
                {!hasProfileEmail ? (
                  <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={onChangeEmail}
                    placeholder={cs.account.emailPlaceholder}
                    placeholderTextColor={MockColors.fieldHint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    autoComplete="email"
                    textContentType="emailAddress"
                    accessibilityLabel={cs.a11y.authEmailInput}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  />
                ) : null}

                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={onChangePassword}
                  placeholder={cs.account.passwordPlaceholder}
                  placeholderTextColor={MockColors.fieldHint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                  accessibilityLabel={cs.a11y.authNewPasswordInput}
                  maxFontSizeMultiplier={FontScaleCap.body}
                />

                {error ? (
                  <Text style={styles.error} maxFontSizeMultiplier={FontScaleCap.body}>
                    {error}
                  </Text>
                ) : null}
              </View>

              <View style={styles.footer}>
                <GlowButton
                  label={busy ? cs.account.loading : cs.account.setPasswordSave}
                  onPress={onSave}
                  glow="none"
                  height={52}
                  accessibilityLabel={cs.a11y.accountSetPassword}
                />
              </View>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: withAlpha(Colors.black, 0.6),
  },
  keyboardWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  cardWrap: {
    width: '100%',
    minHeight: '44%',
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
    justifyContent: 'space-between',
    marginBottom: Spacing.lg,
  },
  title: {
    flexShrink: 1,
    fontWeight: '800',
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
  body: {
    flex: 1,
    gap: 12,
  },
  input: {
    minHeight: 52,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
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
  pressed: {
    opacity: 0.6,
  },
});
