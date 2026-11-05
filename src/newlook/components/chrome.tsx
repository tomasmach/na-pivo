import React, { useState } from 'react';
import { Image, Platform, View, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useRouter } from 'expo-router';
import { nvBack } from '@/newlook/navigation';
import Animated, { interpolate, makeMutable, useAnimatedScrollHandler, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { t } from '@/i18n';
import { useKeyboardHeight } from '@/utils/useKeyboardHeight';

import { useKeyboardLift } from '../motion';
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
      <GlassView style={[style, shadow.glass]} glassEffectStyle="regular" tintColor={tint ?? '#1A1A1A80'}>
        {children}
      </GlassView>
    );
  }
  return (
    <View
      style={[
        style,
        { backgroundColor: tint ?? C.glassFallback, borderWidth: 1, borderColor: C.lineStrong },
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

const AVATAR = 44;

/** The profile entry on every tab: avatar with the level ring and a new-badge dot. */
export function LevelAvatar({ size = AVATAR, onPress }: { size?: number; onPress?: () => void }) {
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
        ) : me.initial ? (
          <T s={Math.round(size * 0.34)} w={800} c={C.yellow}>
            {me.initial}
          </T>
        ) : (
          <Icon name="user" size={Math.round(size * 0.34)} color={C.yellow} />
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

const headerScroll: Record<string, SharedValue<number>> = {};
const scrollOf = (tab: string) => (headerScroll[tab] ??= makeMutable(0));

/** For a tab whose header scrolls with its content, so the shared avatar scrolls along. */
export function useTabHeaderScroll(tab: string) {
  const y = scrollOf(tab);
  return useAnimatedScrollHandler({
    onScroll: (e) => {
      y.value = e.contentOffset.y;
    },
  });
}

/** Where a tab header keeps room for the avatar that `TabAvatar` draws above all tabs. */
export function AvatarSlot() {
  return <View style={{ width: AVATAR, height: AVATAR }} />;
}

/**
 * The avatar of every tab, drawn once above them so switching tabs neither moves nor fades it.
 * It sits where each tab header has its `AvatarSlot`. Drawn above the screen's `TopFade`, it fades
 * itself out while its middle passes through that fade.
 */
export function TabAvatar({ tab }: { tab: string }) {
  const insets = useSafeAreaInsets();
  const y = scrollOf(tab);
  const follow = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [AVATAR / 2, AVATAR / 2 + 16], [1, 0], 'clamp'),
    // Pulling down past the top stretches only the content; the header row stays put.
    transform: [{ translateY: -Math.max(0, y.value) }],
  }));
  return (
    <Animated.View style={[{ position: 'absolute', top: insets.top + 8, right: SCREEN_X }, follow]}>
      <LevelAvatar />
    </Animated.View>
  );
}

/** Big tab title row: title, optional actions, avatar. Stays put while its tab is pulled down past the top. */
export function TabHeader({ tab, title, children }: { tab: string; title: string; children?: React.ReactNode }) {
  const y = scrollOf(tab);
  const hold = useAnimatedStyle(() => ({ transform: [{ translateY: Math.min(0, y.value) }] }));
  return (
    <Animated.View style={[s.row, { justifyContent: 'space-between', minHeight: 46 }, hold]}>
      <D s={44} accessibilityRole="header" numberOfLines={1} style={{ flexShrink: 1 }}>
        {title}
      </D>
      <View style={[s.row, { gap: 10, alignSelf: 'flex-start' }]}>
        {children}
        <AvatarSlot />
      </View>
    </Animated.View>
  );
}

/** Header of a pushed screen: back button, optional centered title, right actions. */
export function BackHeader({
  title,
  heading,
  right,
  onBack,
  icon = 'chevron-left',
  style,
}: {
  title?: string;
  /** Big page title right next to the back button. */
  heading?: string;
  right?: React.ReactNode;
  onBack?: () => void;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const router = useRouter();
  return (
    <View style={[s.row, { justifyContent: 'space-between', height: 44 }, style]}>
      <View style={[s.row, s.fill, { gap: 14 }]}>
        <IconButton icon={icon} label={t.nv.profil.chrome.back} onPress={onBack ?? (() => nvBack(router))} iconSize={20} />
        {heading ? (
          <D s={44} accessibilityRole="header" numberOfLines={1} style={{ flexShrink: 1 }}>
            {heading}
          </D>
        ) : null}
      </View>
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
// Roughly one label and input of the next field, so moving through a form never ends on a cut-off field.
const NEXT_FIELD_REVEAL = 96;

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
  const [headerH, setHeaderH] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const keyboard = useKeyboardLift();
  const footerBottom = bottomBase + (tab ? 14 : 0);
  const footerLift = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, keyboard.value + 12 - footerBottom) }],
  }));
  // With the keyboard up the scroll area ends where the lifted footer starts, so no field
  // sits hidden under the footer where a tap would hit its button instead.
  // React Native on Android leaves the navigation bar out of the keyboard height.
  const keyboardHeight = useKeyboardHeight();
  const keyboardTop = keyboardHeight > 0 ? keyboardHeight + (Platform.OS === 'android' ? insets.bottom : 0) : 0;
  const footerRoom = footer && keyboardTop > 0 ? Math.max(footerBottom, keyboardTop + 12) + footerH + 8 : 0;
  const footerSpace = footer ? footerH + 32 : 0;
  const content = (
    <View style={[{ paddingHorizontal: SCREEN_X, gap, paddingTop: padTop }, contentStyle]}>{children}</View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingBottom: footerRoom }}>
      <View style={{ paddingTop: insets.top + 8 }} onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}>
        {header ? <View style={{ paddingHorizontal: SCREEN_X, paddingBottom: 4 }}>{header}</View> : null}
      </View>
      {scroll ? (
        <KeyboardAwareScrollView
          scrollEventThrottle={16}
          {...scrollProps}
          onScroll={(e) => {
            const under = e.nativeEvent.contentOffset.y > 0;
            if (under !== scrolled) setScrolled(under);
            scrollProps?.onScroll?.(e);
          }}
          keyboardAvoidedExternally={!!footer}
          revealBelow={NEXT_FIELD_REVEAL}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: bottomBase + footerSpace + 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {content}
        </KeyboardAwareScrollView>
      ) : (
        <View style={{ flex: 1, paddingBottom: bottomBase + footerSpace }}>{content}</View>
      )}
      {scroll && scrolled && headerH > 0 ? <TopFade below={headerH} /> : null}
      <BottomFade height={(tab ? tabSpace : 0) + (footer ? footerH + 68 : 40)} />
      {footer ? (
        <Animated.View
          onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}
          style={[{ position: 'absolute', left: SCREEN_X, right: SCREEN_X, bottom: footerBottom }, footerLift]}
        >
          {footer}
        </Animated.View>
      ) : null}
    </View>
  );
}

/**
 * Keeps scrolled content from running under the clock. Without `below` it covers the status bar and
 * fades out where content starts, so resting content stays untouched. With `below` it is a short
 * fade under a fixed header; show it only once the content has scrolled under that header.
 */
export function TopFade({ below }: { below?: number }) {
  const insets = useSafeAreaInsets();
  const fade = 16;
  const top = below ?? 0;
  const height = below === undefined ? insets.top + 8 : fade;
  const solidUntil = below === undefined ? Math.round(((insets.top - 8) / height) * 100) : 0;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top,
        height,
        experimental_backgroundImage: `linear-gradient(180deg, ${C.bg} 0%, ${C.bg} ${solidUntil}%, ${C.bg}00 100%)`,
      }}
    />
  );
}

/** `tabBar` leaves the bar alone where Liquid Glass shows the content under it. */
export function BottomFade({ height, tabBar = false }: { height: number; tabBar?: boolean }) {
  if (tabBar && glassAvailable) return null;
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
