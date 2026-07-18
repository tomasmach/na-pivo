import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BeerIcon } from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { amberGlow, softDrop } from '@/theme/shadows';

export type AppDialogButtonStyle = 'default' | 'cancel' | 'destructive';

export interface AppDialogButton {
  text: string;
  style?: AppDialogButtonStyle;
  onPress?: () => void;
}

export interface AppDialogOptions {
  title: string;
  message?: string;
  buttons?: AppDialogButton[];
  cancelable?: boolean;
}

type AppDialogPresenter = (options: AppDialogOptions) => void;

// Full-screen native routes live in their own presentation layer. They may
// mount a local host so dialogs appear above that layer; the newest mounted
// host wins, while the root host remains available after the route unmounts.
const presenters: AppDialogPresenter[] = [];
let pendingDialog: AppDialogOptions | null = null;

export function showAppDialog(options: AppDialogOptions): void {
  const presenter = presenters[presenters.length - 1];
  if (presenter) {
    presenter(options);
    return;
  }
  pendingDialog = options;
}

export function AppDialogHost() {
  const [dialog, setDialog] = useState<AppDialogOptions | null>(null);
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);

  useEffect(() => {
    const ownPresenter: AppDialogPresenter = (options) => setDialog(normalizeDialog(options));
    presenters.push(ownPresenter);
    if (pendingDialog) {
      const next = pendingDialog;
      pendingDialog = null;
      ownPresenter(next);
    }
    return () => {
      const index = presenters.lastIndexOf(ownPresenter);
      if (index >= 0) presenters.splice(index, 1);
    };
  }, []);

  useEffect(() => {
    if (dialog) {
      progress.value = 0;
      progress.value = withSpring(1, { damping: 16, stiffness: 160, mass: 0.9 });
    } else {
      progress.value = withTiming(0, { duration: 120 });
    }
  }, [dialog, progress]);

  const cardAnim = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { scale: 0.94 + progress.value * 0.06 },
      { translateY: (1 - progress.value) * 18 },
    ],
  }));

  const buttons = useMemo(() => dialog?.buttons ?? [], [dialog]);
  const cancelButton = useMemo(
    () => buttons.find((button) => button.style === 'cancel'),
    [buttons],
  );
  const actionButtons = useMemo(
    () => buttons.filter((button) => button.style !== 'cancel'),
    [buttons],
  );
  const isActionMenu = !!dialog && !dialog.message && buttons.length > 2;
  const canCancel = dialog?.cancelable ?? true;

  // A button's onPress often presents another Modal (e.g. the backdate flow
  // opens BeerFormModal). On iOS, presenting one while this dialog's Modal is
  // still dismissing silently fails — so hold the action and run it from
  // onDismiss, after the dismissal actually completed. onDismiss is iOS-only;
  // Android tolerates the immediate call.
  const pendingAction = useRef<(() => void) | null>(null);

  const close = useCallback(
    (button?: AppDialogButton) => {
      if (Platform.OS === 'ios') {
        pendingAction.current = button?.onPress ?? null;
        setDialog(null);
        return;
      }
      setDialog(null);
      button?.onPress?.();
    },
    [],
  );

  const runPendingAction = useCallback(() => {
    const action = pendingAction.current;
    pendingAction.current = null;
    action?.();
  }, []);

  const closeFromBackdrop = useCallback(() => {
    if (!canCancel) return;
    close(cancelButton);
  }, [canCancel, cancelButton, close]);

  const content = useMemo(() => {
    if (!dialog) return null;

    if (isActionMenu) {
      return (
        <>
          <View style={styles.menuHeader}>
            <Text style={styles.menuTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
              {dialog.title}
            </Text>
          </View>
          <View style={styles.menuList}>
            {actionButtons.map((button, index) => (
              <Pressable
                key={`${button.text}-${index}`}
                onPress={() => close(button)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.menuButton,
                  index < actionButtons.length - 1 && styles.menuButtonBorder,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.menuButtonText,
                    button.style === 'destructive' && styles.destructiveMenuText,
                  ]}
                  maxFontSizeMultiplier={FontScaleCap.heading}
                >
                  {button.text}
                </Text>
              </Pressable>
            ))}
          </View>
          {cancelButton ? (
            <Pressable
              onPress={() => close(cancelButton)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.cancelMenuButton, pressed && styles.pressed]}
            >
              <Text style={styles.cancelMenuText} maxFontSizeMultiplier={FontScaleCap.heading}>
                {cancelButton.text}
              </Text>
            </Pressable>
          ) : null}
        </>
      );
    }

    const primaryButton =
      actionButtons.find((button) => button.style === 'destructive') ??
      actionButtons[actionButtons.length - 1] ??
      cancelButton;
    const secondaryButtons = buttons.filter((button) => button !== primaryButton);

    return (
      <>
        <View style={styles.medallion}>
          <BeerIcon size={28} color={Colors.amberLight} />
        </View>
        <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
          {dialog.title}
        </Text>
        {dialog.message ? (
          <Text style={styles.message} maxFontSizeMultiplier={FontScaleCap.body}>
            {dialog.message}
          </Text>
        ) : null}
        <View style={styles.buttonStack}>
          {secondaryButtons.map((button, index) => (
            <Pressable
              key={`${button.text}-${index}`}
              onPress={() => close(button)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryText} maxFontSizeMultiplier={FontScaleCap.heading}>
                {button.text}
              </Text>
            </Pressable>
          ))}
          {primaryButton ? (
            <Pressable
              onPress={() => close(primaryButton)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.primaryButton,
                primaryButton.style === 'destructive' && styles.dangerButton,
                pressed && styles.primaryPressed,
              ]}
            >
              <Text style={styles.primaryText} maxFontSizeMultiplier={FontScaleCap.heading}>
                {primaryButton.text}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </>
    );
  }, [actionButtons, buttons, cancelButton, close, dialog, isActionMenu]);

  return (
    <Modal
      visible={dialog !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={closeFromBackdrop}
      onDismiss={runPendingAction}
    >
      <Pressable
        style={[styles.backdrop, !isActionMenu && styles.centerBackdrop]}
        onPress={closeFromBackdrop}
      >
        <Animated.View
          style={[
            styles.card,
            isActionMenu && styles.menuCard,
            softDrop(),
            !isActionMenu && amberGlow(22),
            cardAnim,
            { marginBottom: isActionMenu ? Math.max(insets.bottom, Spacing.lg) : 0 },
          ]}
        >
          <Pressable onPress={(event) => event.stopPropagation()}>{content}</Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

function normalizeDialog(options: AppDialogOptions): AppDialogOptions {
  return {
    ...options,
    buttons: options.buttons && options.buttons.length > 0 ? options.buttons : [{ text: cs.common.ok }],
    cancelable: options.cancelable ?? true,
  };
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: withAlpha(Colors.black, 0.78),
    paddingHorizontal: Spacing.lg,
  },
  centerBackdrop: {
    justifyContent: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 430,
    alignSelf: 'center',
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.42),
    backgroundColor: Colors.stout2,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.lg,
  },
  menuCard: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    overflow: 'hidden',
    borderColor: withAlpha(Colors.border, 0.9),
    backgroundColor: Colors.stout3,
  },
  medallion: {
    alignSelf: 'center',
    width: 58,
    height: 58,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.48),
    backgroundColor: withAlpha(Colors.amber, 0.14),
  },
  title: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 27,
    lineHeight: 32,
    color: Colors.foam,
    textAlign: 'center',
  },
  message: {
    marginTop: Spacing.sm,
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.foamMuted,
    textAlign: 'center',
  },
  buttonStack: {
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.amber,
  },
  dangerButton: {
    backgroundColor: Colors.amberLight,
  },
  primaryText: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    lineHeight: 22,
    color: Colors.stout,
    textAlign: 'center',
  },
  secondaryButton: {
    minHeight: 46,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foamMuted, 0.22),
    backgroundColor: withAlpha(Colors.foam, 0.05),
  },
  secondaryText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    lineHeight: 19,
    color: Colors.foam,
    textAlign: 'center',
  },
  primaryPressed: {
    transform: [{ scale: 0.985 }],
    opacity: 0.9,
  },
  pressed: {
    opacity: 0.72,
  },
  menuHeader: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
    backgroundColor: Colors.stout2,
    borderBottomWidth: 1,
    borderBottomColor: withAlpha(Colors.border, 0.75),
  },
  menuTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    lineHeight: 29,
    color: Colors.foam,
    textAlign: 'center',
  },
  menuList: {
    backgroundColor: Colors.stout3,
  },
  menuButton: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  menuButtonBorder: {
    borderBottomWidth: 1,
    borderBottomColor: withAlpha(Colors.border, 0.55),
  },
  menuButtonText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 16,
    lineHeight: 21,
    color: Colors.foam,
    textAlign: 'center',
  },
  destructiveMenuText: {
    color: Colors.amberLight,
  },
  cancelMenuButton: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: withAlpha(Colors.black, 0.35),
    backgroundColor: Colors.stout2,
  },
  cancelMenuText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 16,
    lineHeight: 21,
    color: Colors.foamMuted,
    textAlign: 'center',
  },
});
