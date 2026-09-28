import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeftIcon, ChevronRightIcon, MinusIcon, PlusIcon, XIcon } from '@/components/shared/IconGlyph';
import { intlLocale, t } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { fireLightImpactHaptic } from '@/utils/haptics';
import { TourButton, TourText, ui } from './TourChrome';
import { validSchedule, type TourPlan } from './model';
import { addDays, earliestMinutes, lastDay, minutesOf, timeOf, todayIn, weekday } from './when';

type Schedule = Pick<TourPlan, 'scheduledDate' | 'scheduledTime'>;
const WEEKS = 5;
const PRESETS = ['17:00', '18:00', '19:00', '20:00'];
const LAST_MINUTE = 23 * 60 + 45;

function haptic() {
  if (useSettingsStore.getState().hapticEnabled) fireLightImpactHaptic();
}
const utc = (iso: string) => new Date(`${iso}T12:00:00Z`);
const daysBetween = (from: string, to: string) => Math.round((utc(to).getTime() - utc(from).getTime()) / 86400000);

/**
 * The meetup picker: weeks in a row instead of months, so this Friday is one tap even at the end of a month.
 * The system date picker cannot show "no day chosen yet", which an optional meetup needs (DESIGN §9).
 */
export function TourWhenSheet({ plan, visible, onChange, onClose }: {
  plan: TourPlan; visible: boolean; onChange: (patch: Schedule) => Promise<boolean>; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const today = todayIn(plan.timezone);
  const last = lastDay(plan.timezone);
  const firstMonday = addDays(today, -weekday(today));
  const lastPage = Math.floor(daysBetween(firstMonday, last) / (WEEKS * 7));
  const date = plan.scheduledDate && plan.scheduledDate >= today && plan.scheduledDate <= last ? plan.scheduledDate : null;
  const time = date ? plan.scheduledTime : null;
  const [page, setPage] = useState(() => date ? Math.min(lastPage, Math.floor(daysBetween(firstMonday, date) / (WEEKS * 7))) : 0);
  const [custom, setCustom] = useState(() => !!time && !PRESETS.includes(time));
  const [dst, setDst] = useState(false);
  // Percent widths round up past a full row, so the seventh day would wrap; cells get whole points instead.
  const [cellWidth, setCellWidth] = useState(() => Math.floor((width - Spacing.lg * 2) / 7));
  const earliest = date ? earliestMinutes(date, plan.timezone) : null;

  async function apply(next: Schedule) {
    if (next.scheduledTime && !validSchedule({ ...plan, ...next })) { setDst(true); return; }
    setDst(false);
    haptic();
    await onChange(next);
  }
  function pickDay(day: string) {
    const first = earliestMinutes(day, plan.timezone);
    // A time that is already over on the new day would be a meetup in the past.
    const keep = time && first !== null && minutesOf(time) >= first ? time : null;
    void apply({ scheduledDate: day, scheduledTime: keep });
  }
  function pickTime(value: string | null) {
    if (!date) return;
    void apply({ scheduledDate: date, scheduledTime: value });
  }
  function openCustom() {
    if (!date || earliest === null) return;
    setCustom(true);
    if (!time) pickTime(timeOf(Math.max(earliest, 21 * 60)));
  }
  function closeCustom() {
    setCustom(false);
    // Only a quick time stays picked; the chips cannot show any other.
    if (time && !PRESETS.includes(time)) pickTime(null);
  }
  function step(delta: number) {
    if (!time || earliest === null) return;
    pickTime(timeOf(Math.min(LAST_MINUTE, Math.max(earliest, minutesOf(time) + delta))));
  }

  const pageStart = addDays(firstMonday, page * WEEKS * 7);
  const days = Array.from({ length: WEEKS * 7 }, (_, i) => addDays(pageStart, i));
  const shown = days.filter((day) => day >= today && day <= last);
  const monthFormat = new Intl.DateTimeFormat(intlLocale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const months = [...new Set(shown.map((day) => monthFormat.format(utc(day))))];
  const monthLabel = months.length > 1
    ? `${new Intl.DateTimeFormat(intlLocale, { month: 'long', timeZone: 'UTC' }).format(utc(shown[0]))} – ${months[months.length - 1]}`
    : months[0];
  const weekdays = days.slice(0, 7).map((day) => new Intl.DateTimeFormat(intlLocale, { weekday: 'short', timeZone: 'UTC' }).format(utc(day)));
  const shortMonth = new Intl.DateTimeFormat(intlLocale, { month: 'short', timeZone: 'UTC' });
  const longDay = new Intl.DateTimeFormat(intlLocale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const timeOff = (value: string) => earliest === null || minutesOf(value) < earliest;

  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} accessibilityElementsHidden importantForAccessibility="no" />
      <View style={[styles.card, { maxHeight: height - insets.top - Spacing.lg, paddingBottom: Math.max(insets.bottom, Spacing.md) + Spacing.sm }]}>
        <View style={styles.grabber} />
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>{t.tours.whenTitle}</Text>
          <Pressable onPress={onClose} style={({ pressed }) => [styles.icon, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={t.tours.close}>
            <XIcon size={20} color={Colors.foamMuted} />
          </Pressable>
        </View>
        <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
          <View style={styles.monthRow}>
            <Text style={styles.month} maxFontSizeMultiplier={FontScaleCap.heading} accessibilityLiveRegion="polite">{monthLabel}</Text>
            <Pressable disabled={page === 0} onPress={() => setPage(Math.max(0, page - 1))} style={[styles.icon, page === 0 && styles.off]} accessibilityRole="button" accessibilityLabel={t.tours.whenEarlierWeeks} accessibilityState={{ disabled: page === 0 }}>
              <ChevronLeftIcon size={22} color={Colors.amber} />
            </Pressable>
            <Pressable disabled={page === lastPage} onPress={() => setPage(Math.min(lastPage, page + 1))} style={[styles.icon, page === lastPage && styles.off]} accessibilityRole="button" accessibilityLabel={t.tours.whenLaterWeeks} accessibilityState={{ disabled: page === lastPage }}>
              <ChevronRightIcon size={22} color={Colors.amber} />
            </Pressable>
          </View>
          <View style={styles.grid} onLayout={(event) => setCellWidth(Math.floor(event.nativeEvent.layout.width / 7))} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            {weekdays.map((label) => <Text key={label} allowFontScaling={false} style={[styles.weekday, { width: cellWidth }]}>{label}</Text>)}
          </View>
          <View style={styles.grid}>
            {days.map((day) => {
              const off = day < today || day > last;
              const selected = day === date;
              const isToday = day === today;
              const monthStart = day.endsWith('-01');
              return <Pressable key={day} disabled={off} onPress={() => pickDay(day)} style={[styles.cell, { width: cellWidth }]}
                accessibilityRole="button" accessibilityState={{ selected, disabled: off }}
                accessibilityLabel={[longDay.format(utc(day)), isToday ? t.tours.whenToday : null, off ? t.tours.whenUnavailable : null].filter(Boolean).join(', ')}>
                <View style={[styles.day, selected && styles.daySelected]}>
                  {monthStart && <Text allowFontScaling={false} style={[styles.monthTag, selected && styles.onAmber, off && styles.offText]}>{shortMonth.format(utc(day))}</Text>}
                  <Text allowFontScaling={false} style={[styles.dayText, isToday && styles.today, selected && styles.onAmber, off && styles.offText]}>{Number(day.slice(8))}</Text>
                </View>
              </Pressable>;
            })}
          </View>
          <View style={styles.timeHead}>
            <TourText style={ui.section}>{t.tours.whenTime}</TourText>
            {!!date && earliest !== null && <Pressable onPress={custom ? closeCustom : openCustom} style={ui.link} accessibilityRole="button" accessibilityLabel={custom ? t.tours.whenQuickTimes : t.tours.whenOtherTime}>
              <TourText style={ui.linkText}>{custom ? t.tours.whenQuickTimes : t.tours.whenOtherTime}</TourText>
            </Pressable>}
          </View>
          {!date && <TourText style={styles.hint}>{t.tours.whenPickDay}</TourText>}
          {custom && time
            ? <View style={styles.stepper}>
              <Pressable onPress={() => step(-15)} disabled={earliest === null || minutesOf(time) <= earliest} style={({ pressed }) => [styles.stepButton, pressed && styles.pressed, (earliest === null || minutesOf(time) <= earliest) && styles.off]} accessibilityRole="button" accessibilityLabel={t.tours.whenTimeDown}>
                <MinusIcon size={20} color={Colors.foamMuted} />
              </Pressable>
              <Text allowFontScaling={false} style={styles.stepValue} accessibilityLiveRegion="polite">{time}</Text>
              <Pressable onPress={() => step(15)} disabled={minutesOf(time) >= LAST_MINUTE} style={({ pressed }) => [styles.stepButton, pressed && styles.pressed, minutesOf(time) >= LAST_MINUTE && styles.off]} accessibilityRole="button" accessibilityLabel={t.tours.whenTimeUp}>
                <PlusIcon size={20} color={Colors.foamMuted} />
              </Pressable>
            </View>
            : <View style={styles.chips}>
              {PRESETS.map((value) => {
                const off = !date || timeOff(value);
                const active = value === time;
                return <Pressable key={value} disabled={off} onPress={() => pickTime(active ? null : value)}
                  style={({ pressed }) => [styles.chip, active && styles.chipActive, off && styles.off, pressed && styles.pressed]}
                  accessibilityRole="button" accessibilityState={{ selected: active, disabled: off }} accessibilityLabel={value}>
                  <Text allowFontScaling={false} style={[styles.chipText, active && styles.chipTextActive]}>{value}</Text>
                </Pressable>;
              })}
            </View>}
          {dst && <TourText accessibilityRole="alert" style={styles.hint}>{t.tours.whenDst}</TourText>}
        </ScrollView>
        <View style={styles.footer}>
          <TourButton testID="tour-when-done" label={t.tours.whenDone} onPress={onClose} />
          {!!plan.scheduledDate && <TourButton label={t.tours.whenClear} quiet onPress={() => { setCustom(false); void onChange({ scheduledDate: null, scheduledTime: null }).then(onClose); }} />}
        </View>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: withAlpha(Colors.black, 0.6) },
  card: { backgroundColor: Colors.stout, borderTopLeftRadius: Radius.cardLarge, borderTopRightRadius: Radius.cardLarge, paddingTop: Spacing.sm, paddingHorizontal: Spacing.lg },
  grabber: { alignSelf: 'center', width: 44, height: 4, borderRadius: Radius.pill, backgroundColor: withAlpha(Colors.foam, 0.22), marginBottom: Spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  title: { flex: 1, fontSize: 21, lineHeight: 27, fontWeight: '700', letterSpacing: -0.4, color: Colors.foam },
  icon: { width: HitArea.min, height: HitArea.min, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.65 },
  off: { opacity: 0.35 },
  monthRow: { flexDirection: 'row', alignItems: 'center', marginRight: -Spacing.sm },
  month: { flex: 1, fontFamily: Fonts.ui.semibold, fontSize: 15, color: Colors.foam },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  weekday: { textAlign: 'center', fontFamily: Fonts.ui.medium, fontSize: 12, lineHeight: 18, color: Colors.mutedText, paddingVertical: Spacing.xs },
  cell: { height: 46, alignItems: 'center', justifyContent: 'center' },
  day: { width: 42, height: 42, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  daySelected: { backgroundColor: Colors.amber },
  dayText: { fontFamily: Fonts.ui.semibold, fontSize: 16, lineHeight: 20, color: Colors.foam, fontVariant: ['tabular-nums'] },
  monthTag: { fontFamily: Fonts.ui.semibold, fontSize: 9, lineHeight: 10, color: Colors.amber, marginBottom: -1 },
  today: { color: Colors.amber },
  onAmber: { color: Colors.stout },
  offText: { color: withAlpha(Colors.foam, 0.28) },
  timeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.md, marginRight: -Spacing.sm, minHeight: HitArea.min },
  hint: { fontSize: 13, lineHeight: 20, color: Colors.mutedText, marginBottom: Spacing.sm },
  chips: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  chip: { flex: 1, minHeight: HitArea.min, borderRadius: Radius.pill, borderWidth: 1, borderColor: withAlpha(Colors.border, 0.6), backgroundColor: withAlpha(Colors.foam, 0.06), alignItems: 'center', justifyContent: 'center' },
  chipActive: { borderColor: withAlpha(Colors.amber, 0.32), backgroundColor: withAlpha(Colors.amber, 0.12) },
  chipText: { fontFamily: Fonts.display.semibold, fontSize: 16, color: Colors.foamMuted, fontVariant: ['tabular-nums'] },
  chipTextActive: { color: Colors.amber },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.lg, marginBottom: Spacing.sm },
  stepButton: { width: HitArea.min + 4, height: HitArea.min, borderRadius: Radius.pill, backgroundColor: withAlpha(Colors.foam, 0.06), borderWidth: 1, borderColor: withAlpha(Colors.border, 0.6), alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 96, textAlign: 'center', fontFamily: Fonts.display.bold, fontSize: 30, lineHeight: 36, color: Colors.amber, fontVariant: ['tabular-nums'] },
  footer: { gap: Spacing.xs, paddingTop: Spacing.sm },
});
