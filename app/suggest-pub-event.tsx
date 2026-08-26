import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { ChevronLeftIcon, ClockIcon } from '@/components/shared/IconGlyph';
import { generateUuidV4 } from '@/data/account';
import { submitPubEventSuggestion } from '@/data/pubEventsClient';
import { useToastStore } from '@/stores/toastStore';
import { leaveRoute } from '@/navigation/leaveRoute';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

function stringParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function numberParam(value: string | string[] | undefined): number | null {
  const parsed = Number(stringParam(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatCzechDateTime(date: Date): string {
  return `${date.getDate()}. ${date.getMonth() + 1}. ${date.getFullYear()} ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
}

export function parseCzechDateTime(value: string): Date | null {
  const match = value.trim().match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const [, dayRaw, monthRaw, yearRaw, hourRaw, minuteRaw] = match;
  const day = Number(dayRaw);
  const month = Number(monthRaw) - 1;
  const year = Number(yearRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const date = new Date(year, month, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }
  return date;
}

function defaultTimes(): { starts: string; ends: string } {
  const startsAt = new Date();
  startsAt.setSeconds(0, 0);
  startsAt.setMinutes(Math.ceil(startsAt.getMinutes() / 15) * 15);
  const endsAt = new Date(startsAt.getTime() + 3 * 60 * 60 * 1000);
  return { starts: formatCzechDateTime(startsAt), ends: formatCzechDateTime(endsAt) };
}

export default function SuggestPubEventScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const showToast = useToastStore((state) => state.show);
  const [defaults] = useState(() => defaultTimes());
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [starts, setStarts] = useState(defaults.starts);
  const [ends, setEnds] = useState(defaults.ends);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [draftClientId] = useState(() => generateUuidV4());

  const name = stringParam(params.name);
  const lat = numberParam(params.lat);
  const lng = numberParam(params.lng);
  const startsAt = parseCzechDateTime(starts);
  const endsAt = parseCzechDateTime(ends);
  const canSubmit =
    !submitting &&
    title.trim().length >= 3 &&
    lat != null &&
    lng != null &&
    startsAt != null &&
    endsAt != null &&
    endsAt.getTime() > startsAt.getTime();

  const handleSubmit = async () => {
    if (
      !canSubmit ||
      lat == null ||
      lng == null ||
      !startsAt ||
      !endsAt ||
      endsAt.getTime() <= Date.now()
    ) {
      setError('Mrkni na název a časy. Konec musí být po začátku.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await submitPubEventSuggestion({
      clientId: draftClientId,
      name,
      lat,
      lng,
      city: stringParam(params.city),
      externalId: stringParam(params.externalId),
      title: title.trim(),
      details: details.trim(),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    });
    setSubmitting(false);
    if (result === 'ok') {
      showToast('Návrh je u výčepu na kontrole.');
      leaveRoute(router);
      return;
    }
    if (result === 'auth-required') {
      setError('Přihlášení vypršelo. Přihlas se a zkus to znovu.');
      return;
    }
    if (result === 'permanent-error') {
      setError('Tenhle návrh server nevzal. Zkontroluj časy a délku akce.');
      return;
    }
    setError('Server se teď neozývá. Návrh zůstal ve formuláři, zkus to za chvíli.');
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => leaveRoute(router)}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Zpět"
        >
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>
        <Text style={styles.headerTitle}>Navrhnout akci</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior="padding" enabled={Platform.OS === 'android'}>
        <KeyboardAwareScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 24, 32) }]}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.introRow}>
            <View style={styles.iconWell}>
              <ClockIcon size={20} color={Colors.amber} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.pubName} maxFontSizeMultiplier={FontScaleCap.heading}>{name}</Text>
              <Text style={styles.intro} maxFontSizeMultiplier={FontScaleCap.body}>
                Napiš, co se v hospodě děje.
              </Text>
            </View>
          </View>

          <Field label="Název akce">
            <TextInput
              value={title}
              onChangeText={setTitle}
              style={styles.input}
              placeholder="Třeba hospodský kvíz"
              placeholderTextColor={Colors.mutedText}
              maxLength={120}
              autoFocus
            />
          </Field>

          <View style={styles.timeRow}>
            <View style={styles.timeField}>
              <Field label="Začátek">
                <TextInput
                  value={starts}
                  onChangeText={setStarts}
                  style={styles.input}
                  placeholder="19. 7. 2026 19:00"
                  placeholderTextColor={Colors.mutedText}
                  keyboardType="numbers-and-punctuation"
                />
              </Field>
            </View>
            <View style={styles.timeField}>
              <Field label="Konec">
                <TextInput
                  value={ends}
                  onChangeText={setEnds}
                  style={styles.input}
                  placeholder="19. 7. 2026 22:00"
                  placeholderTextColor={Colors.mutedText}
                  keyboardType="numbers-and-punctuation"
                />
              </Field>
            </View>
          </View>

          <Field label="Podrobnosti (nepovinné)">
            <TextInput
              value={details}
              onChangeText={setDetails}
              style={[styles.input, styles.multiline]}
              placeholder="Vstupné, rezervace nebo co čekat"
              placeholderTextColor={Colors.mutedText}
              maxLength={500}
              multiline
              textAlignVertical="top"
            />
          </Field>

          <Text style={styles.moderation} maxFontSizeMultiplier={FontScaleCap.body}>
            Návrh nejdřív zkontroluju. Až projde, ukáže se v detailu hospody. Neověřené a skončené akce ostatní neuvidí.
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            onPress={() => void handleSubmit()}
            disabled={!canSubmit}
            style={({ pressed }) => [
              styles.submitButton,
              !canSubmit && styles.submitDisabled,
              pressed && canSubmit && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Poslat návrh ke kontrole"
            accessibilityState={{ disabled: !canSubmit }}
          >
            <Text style={styles.submitText}>{submitting ? 'Posílám…' : 'Poslat ke kontrole'}</Text>
          </Pressable>
        </KeyboardAwareScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label} maxFontSizeMultiplier={FontScaleCap.body}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.stout },
  flex: { flex: 1 },
  header: {
    height: 52,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  backButton: { width: HitArea.min, height: HitArea.min, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: Colors.foam, fontWeight: '700', fontSize: 20 },
  headerSpacer: { width: HitArea.min },
  content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.xl, gap: Spacing.lg },
  introRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  iconWell: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.medium,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pubName: { color: Colors.foam, fontWeight: '700', fontSize: 22, lineHeight: 27 },
  intro: { marginTop: 3, color: Colors.foamMuted, fontWeight: '400', fontSize: 14, lineHeight: 20 },
  field: { gap: Spacing.sm },
  label: { color: Colors.foamMuted, fontWeight: '600', fontSize: 13 },
  input: {
    minHeight: 50,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    color: Colors.foam,
    fontWeight: '400',
    fontSize: 15,
  },
  multiline: { minHeight: 106 },
  timeRow: { flexDirection: 'row', gap: Spacing.md },
  timeField: { flex: 1 },
  moderation: { color: Colors.mutedText, fontWeight: '400', fontSize: 13, lineHeight: 19 },
  error: { color: Colors.amberLight, fontWeight: '500', fontSize: 13, lineHeight: 19 },
  submitButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.medium,
    backgroundColor: Colors.amber,
  },
  submitDisabled: { opacity: 0.42 },
  submitText: { color: Colors.stout, fontWeight: '700', fontSize: 17 },
  pressed: { opacity: 0.72 },
});
