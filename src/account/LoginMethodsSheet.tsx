import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppleIcon, GoogleIcon } from '@/components/shared/BrandIcon';
import { CheckIcon, KeyRoundIcon, XIcon } from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import type { AuthProvider } from '@/data/auth';

interface LoginMethodsSheetProps {
  visible: boolean;
  providers: AuthProvider[];
  appleSupported: boolean;
  busy: string | null;
  onClose: () => void;
  onSetPassword: () => void;
  onLink: (provider: 'google' | 'apple') => void;
  onUnlink: (provider: AuthProvider) => void;
}

interface MethodRowProps {
  provider: AuthProvider;
  name: string;
  icon: React.ComponentType<{ size?: number; color: string }>;
  linked: boolean;
  canUnlink: boolean;
  busy: boolean;
  blocked: boolean;
  onPress: () => void;
}

function MethodRow({
  provider,
  name,
  icon: Icon,
  linked,
  canUnlink,
  busy,
  blocked,
  onPress,
}: MethodRowProps) {
  const disabled = blocked || (linked && !canUnlink);
  const actionLabel =
    provider === 'email' ? cs.account.setPasswordCta : cs.account.linkCta;
  const accessibilityLabel = linked
    ? cs.a11y.accountUnlinkProvider(name)
    : provider === 'email'
      ? cs.a11y.accountSetPassword
      : cs.a11y.accountLinkProvider(name);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
    >
      <View style={styles.iconWell}>
        <Icon size={18} color={Colors.foamMuted} />
      </View>

      <View style={styles.rowText}>
        <Text
          style={styles.rowName}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {name}
        </Text>
        <Text
          style={styles.rowMeta}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {linked
            ? canUnlink
              ? cs.account.linkedLabel
              : cs.account.methodOnly
            : cs.account.methodNotLinked}
        </Text>
      </View>

      {busy ? (
        <View style={styles.rightSlot}>
          <ActivityIndicator size="small" color={Colors.amber} />
        </View>
      ) : linked ? (
        <View style={styles.rightSlot}>
          <CheckIcon size={16} color={Colors.success} />
        </View>
      ) : (
        <View style={styles.actionPill}>
          <Text
            style={styles.actionLabel}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {actionLabel}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export function LoginMethodsSheet({
  visible,
  providers,
  appleSupported,
  busy,
  onClose,
  onSetPassword,
  onLink,
  onUnlink,
}: LoginMethodsSheetProps) {
  const insets = useSafeAreaInsets();
  const canUnlink = providers.length > 1;
  const hasEmail = providers.includes('email');
  const hasGoogle = providers.includes('google');
  const hasApple = providers.includes('apple');

  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
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
              <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                {cs.account.ctaMethods}
              </Text>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [
                  styles.closeButton,
                  pressed && styles.rowPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={cs.a11y.counterCloseModal}
              >
                <XIcon size={20} color={Colors.foamMuted} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            >
              <MethodRow
                provider="email"
                name={cs.account.methodEmail}
                icon={KeyRoundIcon}
                linked={hasEmail}
                canUnlink={canUnlink}
                busy={busy === 'unlink_email' || busy === 'setPassword'}
                blocked={busy !== null}
                onPress={hasEmail ? () => onUnlink('email') : onSetPassword}
              />
              <View style={styles.divider} />
              <MethodRow
                provider="google"
                name={cs.account.methodGoogle}
                icon={GoogleIcon}
                linked={hasGoogle}
                canUnlink={canUnlink}
                busy={busy === 'link_google' || busy === 'unlink_google'}
                blocked={busy !== null}
                onPress={
                  hasGoogle ? () => onUnlink('google') : () => onLink('google')
                }
              />
              {appleSupported ? (
                <>
                  <View style={styles.divider} />
                  <MethodRow
                    provider="apple"
                    name={cs.account.methodApple}
                    icon={AppleIcon}
                    linked={hasApple}
                    canUnlink={canUnlink}
                    busy={busy === 'link_apple' || busy === 'unlink_apple'}
                    blocked={busy !== null}
                    onPress={
                      hasApple ? () => onUnlink('apple') : () => onLink('apple')
                    }
                  />
                </>
              ) : null}
            </ScrollView>
          </Pressable>
        </View>
    </BottomSheetModal>
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
    marginBottom: Spacing.sm,
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
  list: {
    flex: 1,
    marginTop: Spacing.sm,
  },
  listContent: {
    paddingBottom: Spacing.sm,
  },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: Spacing.sm,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.border, 0.4),
  },
  rowPressed: {
    opacity: 0.6,
  },
  iconWell: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontWeight: '600',
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
  },
  rowMeta: {
    marginTop: 2,
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  rightSlot: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPill: {
    minHeight: 34,
    maxWidth: 128,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    flexShrink: 1,
    fontWeight: '600',
    fontSize: 13,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
});
