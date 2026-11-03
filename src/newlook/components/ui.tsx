import React, { useEffect } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ActivityIndicatorProps,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { useSettingsStore } from '@/stores/settingsStore';
import { fireSelectionHaptic } from '@/utils/haptics';

import { DURATION, enterTiming, fadeInTiming } from '../motion';
import { C, display, font, s, shadow, type Weight } from '../theme';
import { Icon, type IconName } from './Icon';

type TProps = TextProps & { s?: number; w?: Weight; c?: string; lh?: number; style?: StyleProp<TextStyle> };

/** Sofia Sans text. */
export function T({ s: size = 15, w = 400, c = C.white, lh, style, ...rest }: TProps) {
  return (
    <Text
      maxFontSizeMultiplier={1.3}
      {...rest}
      style={[font(size, w, c), lh ? { lineHeight: Math.round(size * lh) } : null, style]}
    />
  );
}

/** Sofia Sans Extra Condensed: big numbers and headlines. */
export function D({ s: size = 44, c = C.white, lh = 1.05, style, ...rest }: TProps) {
  return <Text maxFontSizeMultiplier={1.1} {...rest} style={[display(size, c, lh), style]} />;
}

/** The one spinner color of the new look; dark only on yellow or white buttons. */
export function Spinner({ color = C.muted, ...rest }: ActivityIndicatorProps) {
  return <ActivityIndicator color={color} {...rest} />;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const PRESS_IN = fadeInTiming(DURATION.press);
const PRESS_OUT = fadeInTiming(DURATION.base);

/** Dims and shrinks a touch on the UI thread while held; scale never moves layout. */
export function Press({
  style,
  haptic = false,
  onPress,
  onPressIn,
  onPressOut,
  ...rest
}: Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle>; haptic?: boolean }) {
  const pressed = useSharedValue(0);
  const reduced = useReducedMotion();
  const flatOpacity = StyleSheet.flatten(style)?.opacity;
  const restOpacity = typeof flatOpacity === 'number' ? flatOpacity : 1;
  const pressStyle = useAnimatedStyle(() => ({
    opacity: restOpacity * (1 - 0.15 * pressed.value),
    transform: [{ scale: reduced ? 1 : 1 - 0.03 * pressed.value }],
  }));
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        pressed.value = withTiming(1, PRESS_IN);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.value = withTiming(0, PRESS_OUT);
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic && useSettingsStore.getState().hapticEnabled) fireSelectionHaptic();
        onPress?.(e);
      }}
      style={[style, pressStyle]}
    />
  );
}

type ButtonKind = 'primary' | 'raised' | 'onYellow' | 'onYellowGhost' | 'outline' | 'white' | 'danger';

const BUTTON: Record<ButtonKind, { bg: string; fg: string; extra?: ViewStyle }> = {
  primary: { bg: C.yellow, fg: C.black, extra: shadow.primary },
  raised: { bg: C.control, fg: C.white, extra: shadow.raised },
  onYellow: { bg: C.black, fg: C.yellow },
  onYellowGhost: { bg: '#0000001F', fg: C.black },
  outline: { bg: 'transparent', fg: C.white, extra: { borderWidth: 1, borderColor: C.hairline } },
  white: { bg: C.white, fg: C.black },
  danger: { bg: C.control, fg: C.danger, extra: shadow.raised },
};

export function Button({
  label,
  sub,
  icon,
  kind = 'primary',
  height = 52,
  onPress,
  style,
  disabled,
  flex,
}: {
  label: string;
  sub?: string;
  icon?: IconName;
  kind?: ButtonKind;
  height?: number;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  flex?: boolean;
}) {
  const k = BUTTON[kind];
  const labelSize = height >= 56 ? 17 : height >= 50 ? 16 : 15;
  return (
    <Press
      haptic
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        {
          height,
          borderRadius: height / 2,
          backgroundColor: k.bg,
          paddingHorizontal: 20,
          alignItems: 'center',
          justifyContent: 'center',
        },
        k.extra,
        flex && { flex: 1 },
        disabled && { opacity: 0.4 },
        style,
      ]}
    >
      <View style={[s.row, { gap: 8 }]}>
        {icon ? <Icon name={icon} size={labelSize + 1} color={k.fg} /> : null}
        <T s={labelSize} w={700} c={k.fg} style={{ flexShrink: 1, textAlign: 'center' }}>
          {label}
        </T>
      </View>
      {sub ? (
        <T s={12} w={600} c={kind === 'primary' ? C.onYellowMuted : C.muted}>
          {sub}
        </T>
      ) : null}
    </Press>
  );
}

/** Round control button, 44 by default. */
export function IconButton({
  icon,
  onPress,
  size = 44,
  iconSize,
  color = C.white,
  bg = C.control,
  label,
  style,
  badge,
}: {
  icon: IconName;
  onPress?: () => void;
  size?: number;
  iconSize?: number;
  color?: string;
  bg?: string;
  label?: string;
  style?: StyleProp<ViewStyle>;
  badge?: number | boolean;
}) {
  return (
    <Press
      haptic
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label ?? icon}
      hitSlop={6}
      style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg }, s.center, style]}
    >
      <Icon name={icon} size={iconSize ?? Math.round(size * 0.45)} color={color} />
      {badge ? (
        <View
          style={{
            position: 'absolute',
            top: -2,
            right: -2,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: C.yellow,
            paddingHorizontal: 4,
            ...s.center,
          }}
        >
          {typeof badge === 'number' ? (
            <T s={11} w={800} c={C.black}>
              {badge}
            </T>
          ) : null}
        </View>
      ) : null}
    </Press>
  );
}

/** Pill chip used for filters and categories. Active chips get a check unless they carry an icon. */
export function Chip({
  label,
  icon,
  active,
  onPress,
  trailing,
  style,
  height = 36,
  plain,
}: {
  label: string;
  icon?: IconName;
  plain?: boolean;
  active?: boolean;
  onPress?: () => void;
  trailing?: IconName;
  style?: StyleProp<ViewStyle>;
  height?: number;
}) {
  const lead = icon ?? (active && !plain ? 'check' : undefined);
  return (
    <Press
      haptic
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={[
        s.row,
        {
          height,
          borderRadius: height / 2,
          paddingHorizontal: 14,
          gap: 6,
          backgroundColor: active ? C.yellowTint : C.card,
          borderWidth: 1,
          borderColor: active ? C.yellowLine : C.hairline,
        },
        style,
      ]}
    >
      {lead ? <Icon name={lead} size={16} color={C.yellow} /> : null}
      <T s={14} w={600} c={active ? C.yellow : C.white}>
        {label}
      </T>
      {trailing ? <Icon name={trailing} size={14} color={C.text2} /> : null}
    </Press>
  );
}

/** Chips that wrap onto more lines. */
export function ChipWrap({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, style]}>{children}</View>;
}

export function Segmented<K extends string>({
  options,
  value,
  onChange,
  style,
  height = 36,
}: {
  options: { key: K; label: string; dot?: boolean }[];
  value: K;
  onChange: (k: K) => void;
  style?: StyleProp<ViewStyle>;
  height?: number;
}) {
  return (
    <View
      style={[
        s.row,
        {
          height,
          borderRadius: height / 2,
          padding: 3,
          backgroundColor: C.tintSoft,
          borderWidth: 1,
          borderColor: C.line,
        },
        style,
      ]}
    >
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Press
            key={o.key}
            haptic
            onPress={() => onChange(o.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[
              s.fill,
              s.center,
              { alignSelf: 'stretch', borderRadius: (height - 6) / 2 },
              on && { backgroundColor: C.white, ...shadow.soft },
            ]}
          >
            <View style={[s.row, { gap: 5 }]}>
              {o.dot ? <Dot color={on ? C.black : C.text2} size={5} /> : null}
              <T s={14} w={on ? 800 : 600} c={on ? C.black : C.text2}>
                {o.label}
              </T>
            </View>
          </Press>
        );
      })}
    </View>
  );
}

export function Card({ children, style, pad = 16 }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; pad?: number }) {
  return (
    <View style={[{ backgroundColor: C.card, borderRadius: 24, paddingHorizontal: pad, paddingVertical: 4 }, style]}>
      {children}
    </View>
  );
}

export function Tile({ icon, color = C.yellow, size = 40, bg = C.control, radius = 12 }: { icon: IconName; color?: string; size?: number; bg?: string; radius?: number }) {
  return (
    <View style={[{ width: size, height: size, borderRadius: radius, backgroundColor: bg }, s.center]}>
      <Icon name={icon} size={Math.round(size * 0.48)} color={color} />
    </View>
  );
}

/** List row inside a card: optional leading element, title + sub, trailing slot. */
export function Row({
  title,
  sub,
  leading,
  trailing,
  onPress,
  last,
  height = 62,
  titleColor = C.white,
  subColor = C.muted,
  titleWeight = 600,
  chevron,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
  height?: number;
  titleColor?: string;
  subColor?: string;
  titleWeight?: Weight;
  chevron?: boolean;
}) {
  const body = (
    <View
      style={[
        s.row,
        { minHeight: height, gap: 12, paddingVertical: 10 },
        !last && { borderBottomWidth: 1, borderBottomColor: C.hairline },
      ]}
    >
      {leading}
      <View style={[s.fill, { gap: 2 }]}>
        {typeof title === 'string' ? (
          <T s={16} w={titleWeight} c={titleColor}>
            {title}
          </T>
        ) : (
          title
        )}
        {sub ? (
          typeof sub === 'string' ? (
            <T s={13} w={500} c={subColor}>
              {sub}
            </T>
          ) : (
            sub
          )
        ) : null}
      </View>
      {trailing}
      {chevron ? <Icon name="chevron-right" size={16} color={C.muted} /> : null}
    </View>
  );
  return onPress ? (
    <Press onPress={onPress} accessibilityRole="button">
      {body}
    </Press>
  ) : (
    body
  );
}

const TOGGLE_TRAVEL = 20;
const TOGGLE_OFF_TRACK = '#39393D';
const TOGGLE_OFF_KNOB = '#FFFFFF';

/** The knob slides and both colors blend over the same stretch; the switch never shrinks under the finger. */
export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const move = useSharedValue(value ? 1 : 0);
  const tone = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    move.value = withTiming(value ? 1 : 0, enterTiming());
    tone.value = withTiming(value ? 1 : 0, fadeInTiming());
  }, [value, move, tone]);
  const track = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(tone.value, [0, 1], [TOGGLE_OFF_TRACK, C.yellow]) }));
  const knob = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(tone.value, [0, 1], [TOGGLE_OFF_KNOB, C.black]),
    transform: [{ translateX: move.value * TOGGLE_TRAVEL }],
  }));
  return (
    <Pressable
      onPress={() => {
        if (useSettingsStore.getState().hapticEnabled) fireSelectionHaptic();
        onChange(!value);
      }}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
    >
      <Animated.View style={[{ width: 51, height: 31, borderRadius: 16, padding: 2 }, track]}>
        <Animated.View style={[{ width: 27, height: 27, borderRadius: 14 }, knob]} />
      </Animated.View>
    </Pressable>
  );
}

export function SectionTitle({
  title,
  action,
  onAction,
  style,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[s.row, { justifyContent: 'space-between', paddingHorizontal: 4, paddingTop: 4, alignItems: 'flex-end' }, style]}>
      <T s={19} w={700}>
        {title}
      </T>
      {action && onAction ? (
        <Press onPress={onAction} hitSlop={10} accessibilityRole="button">
          <T s={15} w={600} c={C.yellow}>
            {action}
          </T>
        </Press>
      ) : action ? (
        <T s={15} w={600} c={C.muted}>
          {action}
        </T>
      ) : null}
    </View>
  );
}

export function Kicker({ children, color = C.muted }: { children: string; color?: string }) {
  return (
    <T s={11} w={800} c={color} style={{ letterSpacing: 1 }}>
      {children.toUpperCase()}
    </T>
  );
}

export function Dot({ color = C.yellow, size = 6 }: { color?: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

/** Letter avatar with a yellow ring, the way people appear in lists. */
export function Person({ initial, size = 40, ring = true, filled }: { initial: string; size?: number; ring?: boolean; filled?: boolean }) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: filled ? C.yellow : C.avatarBase,
          borderWidth: ring && !filled ? 2 : 0,
          borderColor: C.yellow,
        },
        s.center,
      ]}
    >
      <T s={Math.round(size * 0.4)} w={800} c={filled ? C.black : C.yellow}>
        {initial}
      </T>
    </View>
  );
}

export function Stack({ initials, size = 26 }: { initials: string[]; size?: number }) {
  return (
    <View style={s.row}>
      {initials.map((i, idx) => (
        <View key={idx} style={{ marginLeft: idx ? -8 : 0, borderRadius: size, borderWidth: 2, borderColor: C.card }}>
          <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.control }, s.center]}>
            <T s={11} w={800} c={C.yellow}>
              {i}
            </T>
          </View>
        </View>
      ))}
    </View>
  );
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const x1 = cx + r * Math.cos(rad(startDeg));
  const y1 = cy - r * Math.sin(rad(startDeg));
  const end = startDeg + sweepDeg;
  const x2 = cx + r * Math.cos(rad(end));
  const y2 = cy - r * Math.sin(rad(end));
  const large = Math.abs(sweepDeg) > 180 ? 1 : 0;
  const sweepFlag = sweepDeg < 0 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} ${sweepFlag} ${x2} ${y2}`;
}

/** Ring that fills clockwise from the top, as on the level avatar and progress rings. */
export function ProgressRing({
  size,
  progress,
  stroke,
  color = C.yellow,
  track = C.ring,
}: {
  size: number;
  progress: number;
  stroke: number;
  color?: string;
  track?: string;
}) {
  const r = (size - stroke) / 2;
  const p = Math.max(0, Math.min(0.999, progress));
  return (
    <Svg width={size} height={size} style={{ position: 'absolute' }}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
      {p > 0 ? (
        <Path d={arcPath(size / 2, size / 2, r, 90, -360 * p)} stroke={color} strokeWidth={stroke} fill="none" />
      ) : null}
    </Svg>
  );
}

export { arcPath };
