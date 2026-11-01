import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, SlideInDown, SlideInUp, SlideOutUp } from 'react-native-reanimated';
import { router, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fireSuccessHaptic } from '@/utils/haptics';

import { useMock, type Toast } from '../mock/store';
import { C, SCREEN_X, s, shadow } from '../theme';
import { useTabBarSpace } from './chrome';
import { Icon, type IconName } from './Icon';
import { Button, D, IconButton, T } from './ui';

const TOAST_LOOK: Record<Toast['kind'], { icon: IconName; bg: string; fg: string; border: string }> = {
  saved: { icon: 'check', bg: C.yellow, fg: C.black, border: '#FFFFFF1F' },
  xp: { icon: 'map', bg: C.yellow, fg: C.black, border: '#FFFFFF1F' },
  offline: { icon: 'cloud-off', bg: C.control, fg: C.text2, border: '#FFFFFF1F' },
  error: { icon: 'circle-alert', bg: C.control, fg: C.yellow, border: '#FFC40038' },
  info: { icon: 'info', bg: C.control, fg: C.text2, border: '#FFFFFF1F' },
  medal: { icon: 'medal', bg: '#FFC4001A', fg: C.yellow, border: '#FFC40080' },
};

export function ToastHost() {
  const t = useMock((st) => st.toast);
  const hide = useMock((st) => st.hideToast);
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
      entering={t.at === 'bottom' ? FadeInDown.duration(220) : SlideInUp.springify().damping(18)}
      exiting={t.at === 'bottom' ? FadeOut.duration(160) : SlideOutUp.duration(200)}
      style={[
        { position: 'absolute', left: SCREEN_X, right: SCREEN_X, zIndex: 100 },
        t.at === 'bottom' ? { bottom: tabSpace + 156 } : { top: insets.top - 6 },
      ]}
    >
      <Pressable
        onPress={() => {
          hide();
          if (t.href) router.push(t.href as Href);
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
  const d = useMock((st) => st.dialog);
  const hide = useMock((st) => st.hideDialog);
  if (!d) return null;
  return (
    <Animated.View
      entering={FadeIn.duration(160)}
      exiting={FadeOut.duration(120)}
      style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.scrim, zIndex: 90 }, s.center]}
    >
      <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onPress={hide} accessibilityLabel="Zavřít" />
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
          borderColor: '#FFFFFF14',
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

/**
 * Bottom sheet rendered by a transparent modal route. The route itself fades
 * in; the sheet slides up from the bottom.
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
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const close = onClose ?? (() => router.back());
  const [footerH, setFooterH] = useState(52);
  const body = (
    <View style={[{ gap: 20, paddingTop: 14, paddingHorizontal: SCREEN_X, paddingBottom: footer ? footerH + 40 : insets.bottom + 24 }, contentStyle]}>
      {children}
    </View>
  );
  return (
    <View style={{ flex: 1 }}>
      <Animated.View entering={FadeIn.duration(180)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.scrim }}>
        <Pressable style={{ flex: 1 }} onPress={close} accessibilityLabel="Zavřít" />
      </Animated.View>
      <Animated.View
        entering={SlideInDown.springify().damping(22).stiffness(180)}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: height - Math.max(top, insets.top + 40),
          backgroundColor: C.dialog,
          borderTopLeftRadius: 34,
          borderTopRightRadius: 34,
          borderTopWidth: 1,
          borderColor: '#FFFFFF14',
          paddingTop: 22,
        }}
      >
        <View style={{ position: 'absolute', top: 8, alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: '#FFFFFF40' }} />
        {title || closeIcon ? (
          <View style={[s.row, { justifyContent: 'space-between', paddingHorizontal: SCREEN_X, marginBottom: 6, minHeight: 40 }]}>
            <View style={[s.fill, { gap: 4 }]}>
              {kicker}
              {title ? <D s={30}>{title}</D> : null}
            </View>
            {closeIcon ? <IconButton icon="x" size={40} iconSize={18} onPress={close} label="Zavřít" /> : null}
          </View>
        ) : null}
        {scroll ? (
          <ScrollView showsVerticalScrollIndicator={false} bounces={false} keyboardShouldPersistTaps="handled">
            {body}
          </ScrollView>
        ) : (
          body
        )}
        {footer ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: footerH + Math.max(insets.bottom - 6, 16) + 28,
              experimental_backgroundImage: `linear-gradient(180deg, ${C.dialog}00 0%, ${C.dialog} 35%)`,
            }}
          />
        ) : null}
        {footer ? (
          <View
            onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}
            style={{ position: 'absolute', left: SCREEN_X, right: SCREEN_X, bottom: Math.max(insets.bottom - 6, 16) }}
          >
            {footer}
          </View>
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
