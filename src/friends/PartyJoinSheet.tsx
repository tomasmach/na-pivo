import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlowButton } from '@/components/shared/GlowButton';
import { XIcon } from '@/components/shared/IconGlyph';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { useKeyboardHeight } from '@/utils/useKeyboardHeight';

export interface PartyJoinSheetProps {
  visible: boolean;
  code: string;
  busy: boolean;
  onChangeCode: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function PartyJoinSheet({
  visible,
  code,
  busy,
  onChangeCode,
  onSubmit,
  onClose,
}: PartyJoinSheetProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight();
  const sheetBottomOffset = keyboardHeight > 0 ? keyboardHeight : -insets.bottom;
  const bottomPad = keyboardHeight > 0 ? Spacing.lg : insets.bottom + Spacing.lg;
  const maxHeight = windowHeight - insets.top - Math.max(keyboardHeight, 0) - Spacing.lg;

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
        <View style={[styles.cardWrap, { marginBottom: sheetBottomOffset, maxHeight }]}>
          <Pressable
            style={[styles.card, { paddingBottom: bottomPad }]}
            onPress={() => undefined}
          >
            <View style={styles.grabber} />
            <View style={styles.header}>
              <Text
                style={styles.title}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.heading}
              >
                {cs.partyEvening.joinSheetTitle}
              </Text>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={cs.a11y.counterCloseModal}
              >
                <XIcon size={20} color={Colors.foamMuted} />
              </Pressable>
            </View>

            <KeyboardAwareScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <TextInput
                value={code}
                onChangeText={(value) =>
                  onChangeCode(value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6))
                }
                placeholder={cs.partyEvening.joinPlaceholder}
                placeholderTextColor={Colors.mutedText}
                style={[styles.input, styles.codeInput]}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={6}
                returnKeyType="go"
                onSubmitEditing={onSubmit}
                autoFocus
                maxFontSizeMultiplier={FontScaleCap.body}
                accessibilityLabel={cs.partyEvening.joinCodeA11y}
              />
            </KeyboardAwareScrollView>

            <View style={styles.actions}>
              <GlowButton
                label={cs.partyEvening.join}
                onPress={onSubmit}
                disabled={code.length !== 6 || busy}
                loading={busy}
                variant="primary"
                glow="soft"
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
    gap: Spacing.sm,
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
  input: {
    minHeight: 50,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
    paddingHorizontal: Spacing.md,
    fontFamily: Fonts.ui.medium,
    fontSize: 16,
    color: Colors.foam,
    includeFontPadding: false,
  },
  codeInput: {
    fontFamily: Fonts.display.bold,
    letterSpacing: 4,
    textAlign: 'center',
  },
  actions: {
    paddingTop: Spacing.md,
    marginTop: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  pressed: {
    opacity: 0.7,
  },
});
