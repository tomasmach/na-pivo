import React, { useEffect, useRef, useState } from 'react';
import { Pressable, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { router, usePreventRemove, useRoute, useRouter, type Href } from 'expo-router';
import { nvBack } from '@/newlook/navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { t } from '@/i18n';

import { fireSuccessHaptic } from '@/utils/haptics';

import { DURATION, enter, exit, fadeIn, fadeInTiming, fadeOut, fadeOutTiming, riseIn, sinkOut, useKeyboardLift } from '../motion';
import { useNvUi, type Toast } from '../ui/store';
import { C, SCREEN_X, s, shadow } from '../theme';
import { useTabBarSpace } from './chrome';
import { Icon, type IconName } from './Icon';
import { Button, D, IconButton, T } from './ui';

const TOAST_LOOK: Record<Toast['kind'], { icon: IconName; bg: string; fg: string; border: string }> = {
  saved: { icon: 'check', bg: C.yellow, fg: C.black, border: C.line },
  xp: { icon: 'map', bg: C.yellow, fg: C.black, border: C.line },
  offline: { icon: 'cloud-off', bg: C.control, fg: C.text2, border: C.line },
  error: { icon: 'circle-alert', bg: C.control, fg: C.yellow, border: '#FFC40038' },
  info: { icon: 'info', bg: C.control, fg: C.text2, border: C.line },
  medal: { icon: 'medal', bg: C.yellowSoft, fg: C.yellow, border: C.yellowLine },
};

const TOAST_IN = enter(-16, DURATION.sheet);
const TOAST_OUT = exit(-16, DURATION.base);

export function ToastHost() {
  const t = useNvUi((st) => st.toast);
  const hide = useNvUi((st) => st.hideToast);
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();

  useEffect(() => {
    if (!t) return;
    if (t.kind === 'saved' || t.kind === 'xp') fireSuccessHaptic();
    const timer = setTimeout(hide, 2800);
    return () => clearTimeout(timer);
  }, [t, hide]);

  if (!t) return null;
  const look = TOAST_LOOK[t.kind];
  return (
    <Animated.View
      key={t.id}
      entering={t.at === 'bottom' ? riseIn : TOAST_IN}
      exiting={t.at === 'bottom' ? sinkOut : TOAST_OUT}
      style={[
        { position: 'absolute', left: SCREEN_X, right: SCREEN_X, zIndex: 100 },
        t.at === 'bottom' ? { bottom: tabSpace + 156 } : { top: insets.top - 6 },
      ]}
    >
      <Pressable
        onPress={() => {
          hide();
          if (t.onPress) t.onPress();
          else if (t.href) router.push(t.href as Href);
        }}
        accessibilityRole="alert"
        style={[
          s.row,
          {
            gap: 12,
            padding: 14,
            borderRadius: 22,
            backgroundColor: C.toast,
            borderWidth: 1,
            borderColor: look.border,
          },
          shadow.raised,
        ]}
      >
        <View style={[{ width: 36, height: 36, borderRadius: t.kind === 'medal' ? 10 : 18, backgroundColor: look.bg, borderWidth: t.kind === 'medal' ? 1.5 : 0, borderColor: C.yellow }, s.center]}>
          <Icon name={t.icon ?? look.icon} size={18} color={look.fg} />
        </View>
        <View style={[s.fill, { gap: 2 }]}>
          <T s={15} w={700} lh={1.3}>
            {t.title}
          </T>
          {t.sub ? (
            <T s={13} w={500} c={C.text2} lh={1.3}>
              {t.sub}
            </T>
          ) : null}
        </View>
        {t.href ? <Icon name="chevron-right" size={16} color={C.muted} /> : null}
        {t.xp ? (
          <D s={24} c={C.yellow} lh={1}>
            {`+${t.xp} XP`}
          </D>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

export function DialogHost() {
  const d = useNvUi((st) => st.dialog);
  const hide = useNvUi((st) => st.hideDialog);
  if (!d) return null;
  return (
    <Animated.View
      entering={fadeIn}
      exiting={fadeOut}
      style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.scrim, zIndex: 90 }, s.center]}
    >
      <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onPress={hide} accessibilityLabel={t.nv.common.close} />
      <View
        accessibilityViewIsModal
        style={{
          width: 330,
          maxWidth: '86%',
          gap: 12,
          paddingTop: 26,
          paddingHorizontal: 22,
          paddingBottom: 22,
          borderRadius: 28,
          backgroundColor: C.dialog,
          borderWidth: 1,
          borderColor: C.tint,
        }}
      >
        <D s={30}>{d.title}</D>
        {d.body ? (
          <T s={16} c={C.text2} lh={1.4}>
            {d.body}
          </T>
        ) : null}
        <View style={[s.row, { gap: 10, paddingTop: 10 }]}>
          {d.actions.map((a) => (
            <Button
              key={a.label}
              label={a.label}
              kind={a.kind ?? 'raised'}
              flex
              onPress={() => {
                hide();
                a.onPress?.();
              }}
            />
          ))}
        </View>
      </View>
    </Animated.View>
  );
}

// Routes whose sheet has already slid in; a sheet that re-mounts on the same route
// (loading, then content) fades in place instead of sliding up a second time.
const enteredRoutes = new Set<string>();

/**
 * Bottom sheet rendered by a transparent modal route that animates nothing
 * itself. The sheet slides up over a fading scrim, and every way of leaving
 * the route (close button, scrim, back gesture, replace) plays the same
 * motion backwards before the route goes. Above the keyboard it rides up with
 * it, so a field or the footer is never hidden behind it.
 */
export function Sheet({
  title,
  children,
  footer,
  onClose,
  top = 120,
  closeIcon = true,
  scroll = true,
  contentStyle,
  kicker,
}: {
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose?: () => void;
  top?: number;
  closeIcon?: boolean;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  kicker?: React.ReactNode;
}) {
  const router = useRouter();
  const routeKey = useRoute().key;
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const close = onClose ?? (() => nvBack(router));
  const [footerH, setFooterH] = useState(52);
  const keyboard = useKeyboardLift();
  const [remount] = useState(() => enteredRoutes.has(routeKey));
  const shown = useSharedValue(remount ? 1 : 0);
  const cardFade = useSharedValue(remount ? 0 : 1);
  const cardH = useSharedValue(height);
  const [guard, setGuard] = useState(true);
  const leaving = useRef(false);
  const started = useRef(remount);

  useEffect(() => {
    enteredRoutes.add(routeKey);
    if (remount) cardFade.value = withTiming(1, fadeInTiming());
  }, [cardFade, remount, routeKey]);

  usePreventRemove(guard, ({ repeat }) => {
    if (leaving.current) return;
    leaving.current = true;
    const leave = () => {
      enteredRoutes.delete(routeKey);
      setGuard(false);
      repeat();
    };
    shown.value = withTiming(0, fadeOutTiming(DURATION.base), () => runOnJS(leave)());
  });

  const footerBottom = Math.max(insets.bottom - 6, 16);
  // With the keyboard up the footer floats above it, and the scroll area ends above the
  // footer, so the focused field scrolls into the part that is really visible.
  const footerRoom = footer ? footerH + 24 : 0;
  const scrimStyle = useAnimatedStyle(() => ({ opacity: shown.value }));
  const cardStyle = useAnimatedStyle(() => {
    const paddingBottom = keyboard.value + Math.min(keyboard.value, footerRoom);
    return reduced
      ? { opacity: shown.value * cardFade.value, paddingBottom }
      : {
          opacity: cardFade.value,
          paddingBottom,
          transform: [{ translateY: (1 - shown.value) * (cardH.value + keyboard.value) }],
        };
  });
  const footerStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -Math.max(0, keyboard.value + 12 - footerBottom) }] }));

  const body = (
    <View style={[{ gap: 20, paddingTop: 14, paddingHorizontal: SCREEN_X, paddingBottom: footer ? footerH + 40 : insets.bottom + 24 }, contentStyle]}>
      {children}
    </View>
  );
  return (
    <View style={{ flex: 1 }}>
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.scrim }, scrimStyle]}>
        <Pressable style={{ flex: 1 }} onPress={close} accessibilityLabel={t.nv.common.close} />
      </Animated.View>
      <Animated.View
        onLayout={(e) => {
          cardH.set(e.nativeEvent.layout.height);
          if (started.current) return;
          started.current = true;
          shown.set(withTiming(1, fadeInTiming(DURATION.sheet)));
        }}
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            maxHeight: height - Math.max(top, insets.top + 40),
            backgroundColor: C.dialog,
            borderTopLeftRadius: 34,
            borderTopRightRadius: 34,
            borderTopWidth: 1,
            borderColor: C.tint,
            paddingTop: 22,
          },
          cardStyle,
        ]}
      >
        <View style={{ position: 'absolute', top: 8, alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: '#FFFFFF40' }} />
        {title || closeIcon ? (
          <View style={[s.row, { justifyContent: 'space-between', paddingHorizontal: SCREEN_X, marginBottom: 6, minHeight: 40 }]}>
            <View style={[s.fill, { gap: 4 }]}>
              {kicker}
              {title ? <D s={30}>{title}</D> : null}
            </View>
            {closeIcon ? <IconButton icon="x" size={40} iconSize={18} onPress={close} label={t.nv.common.close} /> : null}
          </View>
        ) : null}
        {scroll ? (
          <KeyboardAwareScrollView showsVerticalScrollIndicator={false} bounces={false} keyboardShouldPersistTaps="handled" keyboardAvoidedExternally>
            {body}
          </KeyboardAwareScrollView>
        ) : (
          body
        )}
        {footer ? (
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: footerH + footerBottom + 28,
                experimental_backgroundImage: `linear-gradient(180deg, ${C.dialog}00 0%, ${C.dialog} 35%)`,
              },
              footerStyle,
            ]}
          />
        ) : null}
        {footer ? (
          <Animated.View
            onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}
            style={[{ position: 'absolute', left: SCREEN_X, right: SCREEN_X, bottom: footerBottom }, footerStyle]}
          >
            {footer}
          </Animated.View>
        ) : null}
      </Animated.View>
    </View>
  );
}

/** Two buttons side by side, the common sheet and dialog footer. */
export function ButtonPair({
  left,
  right,
  leftKind = 'raised',
  onLeft,
  onRight,
  rightIcon,
}: {
  left: string;
  right: string;
  leftKind?: 'raised' | 'danger';
  onLeft?: () => void;
  onRight?: () => void;
  rightIcon?: IconName;
}) {
  return (
    <View style={[s.row, { gap: 10 }]}>
      <Button label={left} kind={leftKind} onPress={onLeft} style={{ paddingHorizontal: 24 }} />
      <Button label={right} icon={rightIcon} onPress={onRight} flex />
    </View>
  );
}
