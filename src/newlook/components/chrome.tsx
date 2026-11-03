import React, { useState } from 'react';
import { Image, View, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useRouter } from 'expo-router';
import { nvBack } from '@/newlook/navigation';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
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

/** Big tab title row: title, optional actions, avatar. */
export function TabHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <View style={[s.row, { justifyContent: 'space-between', minHeight: 46 }]}>
      <D s={44} accessibilityRole="header" numberOfLines={1} style={{ flexShrink: 1 }}>
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
  const keyboard = useKeyboardLift();
  const footerBottom = bottomBase + (tab ? 14 : 0);
  const footerLift = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, keyboard.value + 12 - footerBottom) }],
  }));
  // With the keyboard up the scroll area stops where the lifted footer starts, so the
  // focused field scrolls above the footer, not under it. The strip it gives up sits
  // under the resting footer and its fade, so the switch is never visible.
  const keyboardUp = useKeyboardHeight() > 0;
  const footerRoom = footer && keyboardUp ? footerH + 24 : 0;
  const footerSpace = footer ? footerH + 32 : 0;
  const content = (
    <View style={[{ paddingHorizontal: SCREEN_X, gap, paddingTop: padTop }, contentStyle]}>{children}</View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingBottom: footerRoom }}>
      <View style={{ paddingTop: insets.top + 8 }}>
        {header ? <View style={{ paddingHorizontal: SCREEN_X, paddingBottom: 4 }}>{header}</View> : null}
      </View>
      {scroll ? (
        <KeyboardAwareScrollView
          {...scrollProps}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: bottomBase + footerSpace + 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {content}
        </KeyboardAwareScrollView>
      ) : (
        <View style={{ flex: 1, paddingBottom: bottomBase + footerSpace }}>{content}</View>
      )}
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
