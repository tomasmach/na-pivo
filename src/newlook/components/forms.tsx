import React, { useState } from 'react';
import { TextInput, View, type StyleProp, type TextInputInstance, type TextInputProps, type ViewStyle } from 'react-native';

import { C, font, s } from '../theme';
import { Icon, type IconName } from './Icon';
import { D, Kicker, Press, T } from './ui';

export function FieldLabel({ children }: { children: string }) {
  return (
    <T s={12} w={800} c={C.muted} style={{ letterSpacing: 1 }}>
      {children.toUpperCase()}
    </T>
  );
}

export function Input({
  icon,
  style,
  multiline,
  focusRing = true,
  height = 48,
  inputRef,
  ...rest
}: TextInputProps & { icon?: IconName; style?: StyleProp<ViewStyle>; focusRing?: boolean; height?: number; inputRef?: React.Ref<TextInputInstance> }) {
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={[
        s.row,
        {
          minHeight: multiline ? 96 : height,
          borderRadius: 16,
          paddingHorizontal: 14,
          gap: 10,
          backgroundColor: C.card,
          borderWidth: 1,
          borderColor: focused && focusRing ? '#FFC40099' : '#FFFFFF14',
          alignItems: multiline ? 'flex-start' : 'center',
          paddingVertical: multiline ? 12 : 0,
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={18} color={C.muted} /> : null}
      <TextInput
        ref={inputRef}
        placeholderTextColor={C.muted}
        selectionColor={C.yellow}
        cursorColor={C.yellow}
        keyboardAppearance="dark"
        multiline={multiline}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        {...rest}
        style={[font(15, 600), { flex: 1, padding: 0, textAlignVertical: multiline ? 'top' : 'center' }, multiline && { alignSelf: 'stretch' }]}
      />
    </View>
  );
}

export function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap: 8 }, style]}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </View>
  );
}

/** Screen title block: optional kicker, big condensed title, optional intro. */
export function PageTitle({ kicker, title, intro, size = 44 }: { kicker?: string; title: string; intro?: string; size?: number }) {
  return (
    <View style={{ gap: 8 }}>
      {kicker ? <Kicker>{kicker}</Kicker> : null}
      <D s={size} accessibilityRole="header">
        {title}
      </D>
      {intro ? (
        <T s={15} w={500} c={C.muted} lh={1.4}>
          {intro}
        </T>
      ) : null}
    </View>
  );
}

function Perforation({ color, ground }: { color: string; ground: string }) {
  return (
    <View style={{ height: 14, justifyContent: 'center' }}>
      <View style={{ marginHorizontal: 20, overflow: 'hidden' }}>
        <View style={[s.row, { gap: 5 }]}>
          {Array.from({ length: 40 }, (_, i) => (
            <View key={i} style={{ width: 5, height: 2, backgroundColor: color }} />
          ))}
        </View>
      </View>
      <View style={{ position: 'absolute', left: -10, top: -3, width: 20, height: 20, borderRadius: 10, backgroundColor: ground }} />
      <View style={{ position: 'absolute', right: -10, top: -3, width: 20, height: 20, borderRadius: 10, backgroundColor: ground }} />
    </View>
  );
}

/**
 * A plan or meeting as a ticket: date, place, perforation, stub. Yellow
 * waits for your answer, dark is settled.
 */
export function Ticket({
  yellow,
  kicker,
  kickerIcon,
  dayNum,
  dayName,
  time,
  title,
  quote,
  stub,
  width,
  big,
  ground = C.bg,
  style,
}: {
  yellow?: boolean;
  kicker: string;
  kickerIcon?: IconName;
  dayNum: string;
  dayName: string;
  time: string;
  title: string;
  quote?: string;
  stub?: React.ReactNode;
  width?: number;
  big?: boolean;
  ground?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const fg = yellow ? C.black : C.white;
  const sub = yellow ? C.onYellowMuted : C.muted;
  return (
    <View style={[{ width, backgroundColor: yellow ? C.yellow : C.card, borderRadius: 24 }, style]}>
      <View style={{ paddingTop: 16, paddingHorizontal: 18, paddingBottom: 12, gap: big ? 10 : 8 }}>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <T s={11} w={800} c={sub} style={{ letterSpacing: 1 }}>
            {kicker.toUpperCase()}
          </T>
          {kickerIcon ? <Icon name={kickerIcon} size={16} color={yellow ? C.black : C.yellow} /> : null}
        </View>
        <View style={[s.row, { gap: 10 }]}>
          <D s={big ? 80 : 56} lh={0.9} c={yellow ? C.black : C.yellow}>
            {dayNum}
          </D>
          <View>
            <T s={15} w={800} c={fg}>
              {dayName}
            </T>
            <T s={15} w={700} c={sub}>
              {time}
            </T>
          </View>
        </View>
        <D s={big ? 34 : 26} c={fg}>
          {title}
        </D>
        {quote ? (
          <T s={14} w={600} c={sub} lh={1.35} numberOfLines={2}>
            {quote}
          </T>
        ) : null}
      </View>
      <Perforation color={yellow ? '#0A0A0A40' : '#FFFFFF26'} ground={ground} />
      <View style={{ paddingTop: 10, paddingHorizontal: 14, paddingBottom: 14 }}>{stub}</View>
    </View>
  );
}

/** Stepper for small counts, as in "Kolik se vás vejde". */
export function Stepper({ value, onChange, min = 1, max = 20 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <View style={[s.row, { gap: 14 }]}>
      <StepBtn icon="minus" onPress={() => onChange(Math.max(min, value - 1))} />
      <D s={28} lh={1} style={{ minWidth: 20, textAlign: 'center' }}>
        {String(value)}
      </D>
      <StepBtn icon="plus" onPress={() => onChange(Math.min(max, value + 1))} />
    </View>
  );
}

function StepBtn({ icon, onPress }: { icon: IconName; onPress: () => void }) {
  return (
    <Press haptic onPress={onPress} accessibilityLabel={icon === 'plus' ? 'Přidat' : 'Ubrat'} style={[{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.control }, s.center]}>
      <Icon name={icon} size={18} color={C.white} />
    </Press>
  );
}
