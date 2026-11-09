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

import { useDetailStore, useNvRouter } from '../duo/details';
import { useBook, useRailSide, useWindowInsets } from '../duo/layout';
import { useColumnActions, useColumnBack, usePane, type ColumnAction } from '../duo/paneContext';
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
      <GlassView style={[style, shadow.glass]} glassEffectStyle="regular" tintColor={tint ?? '#2A2A2A80'}>
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

export function GlassButton({
  icon,
  onPress,
  size = 46,
  label,
  color = C.white,
}: {
  icon: IconName;
  onPress?: () => void;
  size?: number;
  label?: string;
  color?: string;
}) {
  return (
    <Press haptic onPress={onPress} accessibilityRole="button" accessibilityLabel={label ?? icon}>
      <Glass style={[{ width: size, height: size, borderRadius: size / 2 }, s.center]}>
        <Icon name={icon} size={20} color={color} />
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
  const insets = useWindowInsets();
  const { book, foldX, width } = useBook();
  const y = scrollOf(tab);
  const follow = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [AVATAR / 2, AVATAR / 2 + 16], [1, 0], 'clamp'),
    // Pulling down past the top stretches only the content; the header row stays put.
    transform: [{ translateY: -Math.max(0, y.value) }],
  }));
  const rail = useRailSide();
  const duo = book || rail !== null;
  const covered = useDetailStore((st) => (st.pages[tab]?.length ?? 0) > 0);
  // Folded, a page covers the whole tab and its header with the avatar.
  if (covered && !book) return null;
  // On the open book the avatar belongs to the left half's header. On the Duo your profile is a page of the tab.
  const right = SCREEN_X + (book ? width - foldX : insets.right);
  return (
    <Animated.View style={[{ position: 'absolute', top: insets.top + 8, right }, follow]}>
      <LevelAvatar
        onPress={
          duo
            ? () => {
                // On the book the avatar sits in the left half, so your profile replaces the right half.
                const store = useDetailStore.getState();
                if (book) store.show(tab, { route: 'profil', params: {} });
                else store.push(tab, { route: 'profil', params: {} });
              }
            : undefined
        }
      />
    </Animated.View>
  );
}

/** Big tab title row: title, optional actions, avatar. Stays put while its tab is pulled down past the top. */
export function TabHeader({ tab, title, children }: { tab: string; title: string; children?: React.ReactNode }) {
  const y = scrollOf(tab);
  // The right half of the open book has no avatar; it sits in the left half's header.
  const avatar = usePane()?.side !== 'right';
  const hold = useAnimatedStyle(() => ({ transform: [{ translateY: Math.min(0, y.value) }] }));
  return (
    <Animated.View style={[s.row, { justifyContent: 'space-between', minHeight: 46 }, hold]}>
      <D s={44} accessibilityRole="header" numberOfLines={1} style={{ flexShrink: 1 }}>
        {title}
      </D>
      <View style={[s.row, { gap: 10, alignSelf: 'flex-start' }]}>
        {children}
        {avatar ? <AvatarSlot /> : null}
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
  actions,
}: {
  title?: string;
  /** Big page title right next to the back button. */
  heading?: string;
  right?: React.ReactNode;
  onBack?: () => void;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  /** Icon actions of the page; on the iPhone Duo they stand in the side column under Back. */
  actions?: ColumnAction[];
}) {
  const router = useNvRouter();
  const back = onBack ?? (() => nvBack(router));
  // On the iPhone Duo Back stands at the top of the side column instead.
  const inColumn = useColumnBack(back, icon === 'chevron-left');
  const actionsInColumn = useColumnActions(actions ?? []);
  const shownActions = actionsInColumn ? [] : (actions ?? []);
  if (inColumn && !title && !heading && !right && !shownActions.length) return null;
  return (
    <View pointerEvents="box-none" style={[s.row, { justifyContent: 'space-between', height: 44 }, style]}>
      <View pointerEvents="box-none" style={[s.row, s.fill, { gap: 14 }]}>
        {inColumn ? null : <IconButton icon={icon} label={t.nv.profil.chrome.back} onPress={back} iconSize={20} />}
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
      <View pointerEvents="box-none" style={[s.row, { gap: 10 }]}>
        {right}
        {shownActions.map((a) => (
          <IconButton key={`${a.icon}-${a.label}`} icon={a.icon} size={40} iconSize={18} color={a.color} label={a.label} onPress={a.onPress} />
        ))}
      </View>
    </View>
  );
}

/** A page's icon actions in its own header row; on the iPhone Duo they stand in the side column under Back. */
export function PageActions({ actions }: { actions: ColumnAction[] }) {
  const inColumn = useColumnActions(actions);
  if (inColumn) return null;
  return (
    <View pointerEvents="box-none" style={[s.row, { gap: 10, marginLeft: 'auto' }]}>
      {actions.map((a) => (
        <IconButton key={`${a.icon}-${a.label}`} icon={a.icon} size={40} iconSize={18} color={a.color} label={a.label} onPress={a.onPress} />
      ))}
    </View>
  );
}

/** Back for a screen with its own header row; on the iPhone Duo it stands at the top of the side column instead. */
export function BackButton({ label, onPress, size = 40, iconSize = 18 }: { label: string; onPress: () => void; size?: number; iconSize?: number }) {
  const inColumn = useColumnBack(onPress);
  if (inColumn) return null;
  return <IconButton icon="chevron-left" size={size} iconSize={iconSize} onPress={onPress} label={label} />;
}

/** Close for a screen that came up as a task; on the iPhone Duo it stands at the top of the side column instead. */
export function CloseButton({ label, onPress }: { label: string; onPress: () => void }) {
  const inColumn = useColumnBack(onPress, true, 'x');
  if (inColumn) return null;
  return <IconButton icon="x" size={40} iconSize={18} onPress={onPress} label={label} />;
}

/** Space the floating tab bar takes at the bottom of a tab screen. Standing in the Duo's side column it takes none. */
export function useTabBarSpace() {
  const insets = useSafeAreaInsets();
  const rail = useRailSide();
  return rail ? tabBarBottom(insets.bottom) + 12 : TAB_BAR_HEIGHT + tabBarBottom(insets.bottom) + 12;
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
  modal = false,
  fixedHeader = false,
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
  /** Shown with `presentation: 'modal'`. On iOS that is a sheet that already starts below the status bar. */
  modal?: boolean;
  /** Keeps a header with text in place; a header of round buttons floats and content scrolls under it. */
  fixedHeader?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const headerTop = modal && Platform.OS === 'ios' ? 16 : insets.top + 8;
  const floatHeader = !!header && scroll && !modal && !fixedHeader;
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
  // Before the first layout, assume the 44-point BackHeader so the content does not jump.
  const floatingHeaderH = headerH || headerTop + 48;
  const content = (
    <View style={[{ paddingHorizontal: SCREEN_X, gap, paddingTop: padTop + (floatHeader ? floatingHeaderH : 0) }, contentStyle]}>{children}</View>
  );
  const headerView = (
    <View
      pointerEvents="box-none"
      style={[{ paddingTop: headerTop }, floatHeader && { position: 'absolute', top: 0, left: 0, right: 0 }]}
      onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}
    >
      {header ? (
        <View pointerEvents="box-none" style={{ paddingHorizontal: SCREEN_X, paddingBottom: 4 }}>
          {header}
        </View>
      ) : null}
    </View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingBottom: footerRoom }}>
      {floatHeader ? null : headerView}
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
          revealAbove={floatHeader ? floatingHeaderH : 0}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: footerRoom > 0 ? 24 : bottomBase + footerSpace + 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {content}
        </KeyboardAwareScrollView>
      ) : (
        <View style={{ flex: 1, paddingBottom: bottomBase + footerSpace }}>{content}</View>
      )}
      {floatHeader ? <TopFade /> : scroll && scrolled && headerH > 0 ? <TopFade below={headerH} /> : null}
      {floatHeader ? headerView : null}
      <BottomFade height={(tab ? tabSpace : 0) + (footer ? footerH + 68 : 40)} denseFrom={footer ? footerBottom + footerH : undefined} />
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

/**
 * `tabBar` leaves the bar alone where Liquid Glass shows the content under it. `denseFrom` is the
 * distance from the bottom where the fade must already hide content, so none shows between buttons.
 */
export function BottomFade({ height, tabBar = false, denseFrom }: { height: number; tabBar?: boolean; denseFrom?: number }) {
  if (tabBar && glassAvailable) return null;
  const dense = denseFrom === undefined ? 40 : Math.min(40, Math.max(0, Math.round(((height - denseFrom) / height) * 100)));
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height,
        experimental_backgroundImage: `linear-gradient(180deg, ${C.bg}00 0%, ${C.bg}F2 ${dense}%, ${C.bg} 100%)`,
      }}
    />
  );
}
