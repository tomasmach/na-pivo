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

export interface PartyDrinkSheetProps {
  visible: boolean;
  beerName: string;
  lastBeerName: string | null;
  busy: boolean;
  onChangeBeerName: (value: string) => void;
  onRepeatLast: () => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function PartyDrinkSheet({
  visible,
  beerName,
  lastBeerName,
  busy,
  onChangeBeerName,
  onRepeatLast,
  onSubmit,
  onClose,
}: PartyDrinkSheetProps) {
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
                {cs.partyEvening.drinkSheetTitle}
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
              {lastBeerName ? (
                <Pressable
                  onPress={onRepeatLast}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={cs.partyEvening.repeatLastA11y(lastBeerName)}
                  style={({ pressed }) => [
                    styles.lastRow,
                    (pressed || busy) && styles.pressed,
                  ]}
                >
                  <Text
                    style={styles.lastName}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {lastBeerName}
                  </Text>
                  <Text style={styles.lastMeta} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.partyEvening.lastDrink}
                  </Text>
                </Pressable>
              ) : null}

              <TextInput
                value={beerName}
                onChangeText={onChangeBeerName}
                placeholder={cs.partyEvening.drinkPlaceholder}
                placeholderTextColor={Colors.mutedText}
                style={styles.input}
                maxLength={120}
                returnKeyType="send"
                onSubmitEditing={onSubmit}
                autoFocus
                maxFontSizeMultiplier={FontScaleCap.body}
                accessibilityLabel={cs.partyEvening.drinkPlaceholder}
              />
              <Text style={styles.privacy} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.partyEvening.drinkPrivacy}
              </Text>
            </KeyboardAwareScrollView>

            <View style={styles.actions}>
              <GlowButton
                label={cs.partyEvening.shareDrink}
                onPress={onSubmit}
                disabled={!beerName.trim() || busy}
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
    gap: 12,
    paddingBottom: Spacing.sm,
  },
  lastRow: {
    minHeight: 56,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: Radius.medium,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  lastName: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
  },
  lastMeta: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
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
  privacy: {
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.mutedText,
    includeFontPadding: false,
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
