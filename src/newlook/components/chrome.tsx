import React, { useRef, useState } from 'react';
import {
  findNodeHandle,
  Image,
  TextInput,
  UIManager,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useRouter } from 'expo-router';
import { nvBack } from '@/newlook/navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { t } from '@/i18n';
import { useKeyboardHeight } from '@/utils/useKeyboardHeight';

import { useMe, useUnopenedBadges } from '../screens/profil/profilModel';
import { useProfilWatchers } from '../screens/profil/useProfilWatchers';
import { C, SCREEN_X, TAB_BAR_HEIGHT, s, shadow } from '../theme';
import { Icon, type IconName } from './Icon';
import { D, IconButton, Press, ProgressRing, T } from './ui';

const glassAvailable = isLiquidGlassAvailable();

/** Liquid Glass on iOS 26, a dark translucent plate elsewhere. */
export function Glass({
  style,
  children,
  tint,
}: {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  tint?: string;
}) {
  if (glassAvailable) {
    return (
      <GlassView style={[style, shadow.glass]} glassEffectStyle="regular" tintColor={tint ?? '#1A1A1A80'} isInteractive>
        {children}
      </GlassView>
    );
  }
  return (
    <View
      style={[
        style,
        { backgroundColor: tint ?? C.glassFallback, borderWidth: 1, borderColor: '#FFFFFF26' },
        shadow.glass,
      ]}
    >
      {children}
    </View>
  );
}

export function GlassButton({ icon, onPress, size = 46, label }: { icon: IconName; onPress?: () => void; size?: number; label?: string }) {
  return (
    <Press haptic onPress={onPress} accessibilityRole="button" accessibilityLabel={label ?? icon}>
      <Glass style={[{ width: size, height: size, borderRadius: size / 2 }, s.center]}>
        <Icon name={icon} size={20} color={C.white} />
      </Glass>
    </Press>
  );
}

/** The profile entry on every tab: avatar with the level ring and a new-badge dot. */
export function LevelAvatar({ size = 44, onPress }: { size?: number; onPress?: () => void }) {
  const router = useRouter();
  const me = useMe();
  const dot = useUnopenedBadges().length > 0;
  useProfilWatchers();
  const inner = Math.round(size * 0.727);
  return (
    <Press
      haptic
      onPress={onPress ?? (() => router.push('/nv/profil'))}
      accessibilityRole="button"
      accessibilityLabel={t.nv.profil.chrome.avatarA11y(me.xp?.level ?? null)}
      style={{ width: size, height: size }}
    >
      <View style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: C.avatarBase }} />
      <ProgressRing size={size} progress={me.progress} stroke={size * 0.075} />
      <View
        style={[
          {
            position: 'absolute',
            left: (size - inner) / 2,
            top: (size - inner) / 2,
            width: inner,
            height: inner,
            borderRadius: inner / 2,
            backgroundColor: C.control,
          },
          s.center,
        ]}
      >
        {me.avatarUrl ? (
          <Image source={{ uri: me.avatarUrl }} style={{ width: inner, height: inner, borderRadius: inner / 2 }} accessibilityIgnoresInvertColors />
        ) : (
          <T s={Math.round(size * 0.34)} w={800} c={C.yellow}>
            {me.initial}
          </T>
        )}
      </View>
      {dot ? (
        <View
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: C.yellow,
            borderWidth: 2.5,
            borderColor: C.bg,
          }}
        />
      ) : null}
    </Press>
  );
}

/** Big tab title row: title, optional actions, avatar. */
export function TabHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <View style={[s.row, { justifyContent: 'space-between', minHeight: 46 }]}>
      <D s={44} accessibilityRole="header">
        {title}
      </D>
      <View style={[s.row, { gap: 10 }]}>
        {children}
        <LevelAvatar />
      </View>
    </View>
  );
}

/** Header of a pushed screen: back button, optional centered title, right actions. */
export function BackHeader({
  title,
  right,
  onBack,
  icon = 'chevron-left',
  style,
}: {
  title?: string;
  right?: React.ReactNode;
  onBack?: () => void;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const router = useRouter();
  return (
    <View style={[s.row, { justifyContent: 'space-between', height: 44 }, style]}>
      <IconButton icon={icon} label={t.nv.profil.chrome.back} onPress={onBack ?? (() => nvBack(router))} iconSize={20} />
      {title ? (
        <View style={{ position: 'absolute', left: 56, right: 56, alignItems: 'center' }} pointerEvents="none">
          <T s={16} w={700} numberOfLines={1}>
            {title}
          </T>
        </View>
      ) : null}
      <View style={[s.row, { gap: 10 }]}>{right}</View>
    </View>
  );
}

/** Space the floating tab bar takes at the bottom of a tab screen. */
export function useTabBarSpace() {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + tabBarBottom(insets.bottom) + 12;
}

export function tabBarBottom(insetBottom: number) {
  return Math.max(insetBottom - 16, 12);
}

/**
 * A scrolling screen on the app ground. `tab` leaves room for the floating
 * tab bar; `footer` pins content (usually the main action) above it.
 */
export function Screen({
  children,
  tab,
  footer,
  header,
  gap = 20,
  scroll = true,
  contentStyle,
  scrollProps,
  padTop = 8,
}: {
  children: React.ReactNode;
  tab?: boolean;
  footer?: React.ReactNode;
  header?: React.ReactNode;
  gap?: number;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  scrollProps?: ScrollViewProps;
  padTop?: number;
}) {
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const bottomBase = tab ? tabSpace : Math.max(insets.bottom, 16);
  const [footerH, setFooterH] = useState(52);
  const keyboard = useKeyboardHeight();
  // With the keyboard up the footer sits in the layout above it, so a focused field scrolls clear of both.
  const lifted = !!footer && keyboard > 0;
  const { ref: revealRef, onLayout: revealLayout, onScroll: revealScroll } = useRevealFocusedInput(lifted);
  const footerSpace = footer && !lifted ? footerH + 32 : 0;
  const content = (
    <View style={[{ paddingHorizontal: SCREEN_X, gap, paddingTop: padTop }, contentStyle]}>{children}</View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingBottom: lifted ? keyboard : 0 }}>
      <View style={{ paddingTop: insets.top + 8 }}>
        {header ? <View style={{ paddingHorizontal: SCREEN_X, paddingBottom: 4 }}>{header}</View> : null}
      </View>
      {scroll ? (
        <KeyboardAwareScrollView
          {...scrollProps}
          ref={revealRef}
          onLayout={(e) => {
            scrollProps?.onLayout?.(e);
            revealLayout(e);
          }}
          onScroll={(e) => {
            revealScroll(e);
            scrollProps?.onScroll?.(e);
          }}
          keyboardAvoidedExternally={!!footer}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: lifted ? 16 : bottomBase + footerSpace + 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {content}
        </KeyboardAwareScrollView>
      ) : (
        <View style={{ flex: 1, paddingBottom: bottomBase + footerSpace }}>{content}</View>
      )}
      {lifted ? null : <BottomFade height={(tab ? tabSpace : 0) + (footer ? footerH + 68 : 40)} />}
      {footer ? (
        <View
          onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}
          style={
            lifted
              ? { marginHorizontal: SCREEN_X, marginTop: 8, marginBottom: 12 }
              : { position: 'absolute', left: SCREEN_X, right: SCREEN_X, bottom: bottomBase + (tab ? 14 : 0) }
          }
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}

export function BottomFade({ height }: { height: number }) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height,
        experimental_backgroundImage: `linear-gradient(180deg, ${C.bg}00 0%, ${C.bg}F2 40%, ${C.bg} 100%)`,
      }}
    />
  );
}

/**
 * A scroll view that shrinks once the keyboard is up reveals the focused field
 * after its new size is known; the focus-time scroll still saw the old size.
 */
export function useRevealFocusedInput(active: boolean) {
  const ref = useRef<ScrollViewInstance>(null);
  const scrollY = useRef(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const viewport = e.nativeEvent.layout.height;
    const input = TextInput.State.currentlyFocusedInput();
    const field = input ? findNodeHandle(input) : null;
    const scroll = ref.current ? findNodeHandle(ref.current) : null;
    if (!active || !field || !scroll) return;
    UIManager.measureLayout(field, scroll, () => undefined, (_x, y, _w, h) => {
      if (y + h > viewport - 16) ref.current?.scrollTo({ y: scrollY.current + y + h - viewport + 16, animated: true });
    });
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  };
  return { ref, onLayout, onScroll };
}
