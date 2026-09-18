import React, { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type TextProps } from 'react-native';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/shared/IconGlyph';
import { t, intlLocale, plural } from '@/i18n';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import type { TourPlan, TourStop } from './model';

export function TourText(props: TextProps) {
  return <Text maxFontSizeMultiplier={FontScaleCap.body} {...props} style={[ui.text, props.style]} />;
}
export function TourButton({ label, onPress, secondary, quiet, icon, disabled, busy, testID }: {
  label: string; onPress: () => void; secondary?: boolean; quiet?: boolean; icon?: ReactNode; disabled?: boolean; busy?: boolean; testID?: string;
}) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }} disabled={disabled || busy}
    onPress={onPress} style={({ pressed }) => [ui.button, secondary && ui.secondary, quiet && ui.quiet, (pressed || disabled || busy) && ui.dim]}>
    {busy ? <ActivityIndicator color={secondary || quiet ? Colors.foam : Colors.stout} /> : <>
      {icon}<TourText maxFontSizeMultiplier={FontScaleCap.heading} style={[ui.buttonText, (secondary || quiet) && ui.secondaryText, quiet && ui.quietText]}>{label}</TourText>
    </>}
  </Pressable>;
}
export function TourHeader({ title, onBack, right }: { title: string; onBack: () => void; right?: ReactNode }) {
  return <View style={ui.header}>
    <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={t.tours.back} style={ui.iconButton}>
      <ChevronLeftIcon color={Colors.foam} size={22} />
    </Pressable>
    <TourText style={ui.headerTitle} numberOfLines={1}>{title}</TourText>
    <View style={ui.headerRight}>{right}</View>
  </View>;
}
export function tourDate(plan: Pick<TourPlan, 'scheduledDate' | 'scheduledTime' | 'timezone'>) {
  if (!plan.scheduledDate) return t.tours.optional;
  const day = new Date(`${plan.scheduledDate}T12:00:00Z`).toLocaleDateString(intlLocale, { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const zone = new Intl.DateTimeFormat(intlLocale, { timeZone: plan.timezone, timeZoneName: 'short' }).formatToParts(new Date(`${plan.scheduledDate}T12:00:00Z`)).find((part) => part.type === 'timeZoneName')?.value;
  return [day, plan.scheduledTime ? `${plan.scheduledTime.slice(0, 5)} ${zone ?? plan.timezone}` : null].filter(Boolean).join('  ');
}
export function stopCount(n: number) {
  return `${n} ${plural(n, { cs: { one: 'zastávka', few: 'zastávky', many: 'zastávek' }, en: { one: 'stop', other: 'stops' } })}`;
}
export function tourError(code: string | null | undefined) {
  if (!code) return null;
  const e = t.tours.errors;
  if (/storage|persist|corrupt/.test(code)) return e.storage;
  if (/date|time/.test(code)) return e.date;
  if (/duplicate/.test(code)) return e.duplicate;
  if (/stop.*limit|max_stops/.test(code)) return e.stopLimit;
  if (/limit/.test(code)) return e.limit;
  if (/session|owner|account_changed/.test(code)) return e.session;
  if (/auth|401/.test(code)) return e.auth;
  if (/invalid|validation|title|stops/.test(code)) return e.invalid;
  if (/not_found|unavailable/.test(code)) return e.unavailable;
  if (/conflict/.test(code)) return t.tours.conflict;
  return e.network;
}
export function TourError({ code, message }: { code?: string | null; message?: string | null }) {
  const text = message || tourError(code);
  return text ? <TourText accessibilityRole="alert" style={ui.error}>{text}</TourText> : null;
}
export function TourStopRow({ stop, index, selected, status, onPress, children }: {
  stop: TourStop; index: number; selected?: boolean; status?: string; onPress: () => void; children?: ReactNode;
}) {
  return <View style={[ui.stopRow, selected && ui.selectedRow]}>
    <Pressable style={ui.stopPress} onPress={onPress} accessibilityRole="button"
      accessibilityLabel={`${index + 1}. ${stop.name}. ${status || stop.address}`} accessibilityState={{ selected: !!selected }}>
      <View style={[ui.number, selected && ui.selectedNumber]}><Text allowFontScaling={false} style={ui.numberText}>{index + 1}</Text></View>
      <View style={ui.grow}><TourText numberOfLines={2} style={ui.stopName}>{stop.name}</TourText>
        <TourText numberOfLines={2} style={ui.meta}>{status || stop.address || t.tours.openingHoursUnknown}</TourText></View>
      {!children && <ChevronRightIcon size={18} color={Colors.foamMuted} />}
    </Pressable>
    {children}
  </View>;
}
export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xl, gap: Spacing.lg },
  text: { fontFamily: Fonts.ui.regular, color: Colors.foamMuted, fontSize: 14, lineHeight: 21 },
  heading: { fontFamily: Fonts.display.extrabold, fontSize: 29, lineHeight: 36, color: Colors.foam },
  section: { fontFamily: Fonts.ui.semibold, fontSize: 15, color: Colors.foam },
  meta: { fontSize: 12, lineHeight: 18, color: Colors.foamMuted, marginTop: Spacing.xs },
  muted: { color: Colors.mutedText },
  grow: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: Spacing.sm, marginBottom: Spacing.sm },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: Fonts.ui.semibold, fontSize: 16, color: Colors.foam },
  headerRight: { minWidth: HitArea.min },
  iconButton: { width: HitArea.min, minHeight: HitArea.min, alignItems: 'center', justifyContent: 'center' },
  button: { minHeight: 48, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg, borderRadius: Radius.pill, backgroundColor: Colors.amber, flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: Colors.stout, fontFamily: undefined, fontWeight: '700', fontSize: 16, lineHeight: 22, includeFontPadding: false, textAlign: 'center', flexShrink: 1 },
  secondary: { backgroundColor: Colors.stout3 },
  quiet: { backgroundColor: 'transparent', minHeight: HitArea.min },
  quietText: { fontSize: 14, lineHeight: 20 },
  secondaryText: { color: Colors.foam },
  dim: { opacity: .55 },
  footer: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(Colors.foam, .1), backgroundColor: Colors.stout },
  link: { minHeight: HitArea.min, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.sm },
  linkText: { color: Colors.amber, fontFamily: Fonts.ui.semibold },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  stopRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: withAlpha(Colors.foam, .14), minHeight: 68 },
  stopPress: { flex: 1, flexDirection: 'row', gap: Spacing.md, alignItems: 'center', paddingVertical: Spacing.md, minHeight: 68 },
  stopName: { fontFamily: Fonts.ui.semibold, fontSize: 15, lineHeight: 21, color: Colors.foam },
  number: { width: 30, height: 30, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.stout3, borderWidth: 1, borderColor: withAlpha(Colors.foam, .18) },
  numberText: { fontWeight: '700', fontSize: 16, lineHeight: 22, includeFontPadding: false, textAlign: 'center', fontVariant: ['tabular-nums'], color: Colors.foam },
  selectedRow: { backgroundColor: withAlpha(Colors.amber, .07) },
  selectedNumber: { borderColor: Colors.amber },
  input: { backgroundColor: Colors.stout3, borderWidth: 1, borderColor: withAlpha(Colors.foam, .14), borderRadius: Radius.medium, color: Colors.foam, fontFamily: Fonts.ui.medium, fontSize: 16, paddingHorizontal: Spacing.md, minHeight: 48, paddingVertical: Spacing.sm },
  field: { gap: Spacing.sm },
  error: { padding: Spacing.md, backgroundColor: Colors.stout3, borderRadius: Radius.small, color: Colors.foam },
  notice: { fontSize: 13, lineHeight: 20, color: Colors.foamMuted },
});
