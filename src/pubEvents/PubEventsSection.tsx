import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import type { PubInfoContext } from '@/components/amenities/pubInfoContext';
import { BadgeCheckIcon, ChevronRightIcon, ClockIcon } from '@/components/shared/IconGlyph';
import { fetchActivePubEvents, isPubEventActive, type PubEvent } from '@/data/pubEventsClient';
import { cs } from '@/i18n/cs';
import { SectionBreak } from '@/mocks/SectionBreak';
import { selectIsSignedIn, useAccountStore } from '@/stores/accountStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

interface PubEventsSectionProps {
  visible: boolean;
  pubKey: string;
  pubName: string;
  info?: PubInfoContext;
  showSuggestion?: boolean;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

function formatEventValidity(event: PubEvent, now = new Date()): string {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  const startsToday =
    start.getFullYear() === now.getFullYear() &&
    start.getMonth() === now.getMonth() &&
    start.getDate() === now.getDate();
  const time = (date: Date) => `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
  if (startsToday && sameDay) return `Dnes ${time(start)}-${time(end)}`;
  const date = (value: Date) => `${value.getDate()}. ${value.getMonth() + 1}.`;
  return sameDay
    ? `${date(start)} ${time(start)}-${time(end)}`
    : `${date(start)} ${time(start)} - ${date(end)} ${time(end)}`;
}

export function PubEventsSection({
  visible,
  pubKey,
  pubName,
  info,
  showSuggestion = true,
}: PubEventsSectionProps) {
  const router = useRouter();
  const isSignedIn = useAccountStore(selectIsSignedIn);
  const [eventState, setEventState] = useState<{
    pubKey: string;
    events: PubEvent[];
    checkedAt: number;
  }>({
    pubKey: '',
    events: [],
    checkedAt: 0,
  });

  useEffect(() => {
    if (!visible || !pubKey) return;
    const controller = new AbortController();
    let cancelled = false;
    void fetchActivePubEvents(pubKey, controller.signal).then((result) => {
      if (!cancelled) setEventState({ pubKey, events: result ?? [], checkedAt: Date.now() });
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [pubKey, visible]);

  const activeEvents = useMemo(
    () =>
      eventState.pubKey === pubKey
        ? eventState.events.filter((event) => isPubEventActive(event, eventState.checkedAt))
        : [],
    [eventState, pubKey],
  );

  // Re-evaluate exactly when the first shown event ends. The server remains the
  // source of truth, but a detail left open must not keep a stale event visible.
  useEffect(() => {
    if (!visible || activeEvents.length === 0) return;
    const nextEnd = Math.min(...activeEvents.map((event) => Date.parse(event.endsAt)));
    const delay = Math.max(0, Math.min(nextEnd - eventState.checkedAt + 50, 2_147_483_647));
    const timeout = setTimeout(() => {
      setEventState((current) => ({ ...current, checkedAt: Date.now() }));
    }, delay);
    return () => clearTimeout(timeout);
  }, [activeEvents, eventState.checkedAt, visible]);
  if (!info || (!showSuggestion && activeEvents.length === 0)) return null;

  const handleSuggest = () => {
    if (!isSignedIn) {
      router.push('/auth' as Href);
      return;
    }
    router.push({
      pathname: '/suggest-pub-event',
      params: {
        pubKey,
        name: pubName,
        lat: String(info.lat),
        lng: String(info.lng),
        city: info.city ?? '',
        externalId: info.externalId ?? '',
      },
    } as unknown as Href);
  };

  return (
    <View>
      {showSuggestion ? (
        <Text style={styles.sectionLabel} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.pubDetail.eventsTitle}
        </Text>
      ) : (
        <SectionBreak title={cs.pubDetail.eventsTitle} />
      )}
      {activeEvents.map((event) => (
        <View key={event.id} style={styles.eventRow} accessibilityLabel={`${event.title}. ${formatEventValidity(event)}`}>
          <ClockIcon size={24} color={Colors.amber} />
          <View style={styles.eventCopy}>
            <Text style={styles.eventTitle} maxFontSizeMultiplier={FontScaleCap.body}>
              {event.title}
            </Text>
            <Text style={styles.validity} maxFontSizeMultiplier={FontScaleCap.body}>
              {formatEventValidity(event)}
            </Text>
            {event.details ? (
              <Text style={styles.details} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
                {event.details}
              </Text>
            ) : null}
            <View style={styles.verifiedRow}>
              <BadgeCheckIcon size={14} color={Colors.success} />
              <Text style={styles.verified} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.pubDetail.eventVerified}
              </Text>
            </View>
          </View>
        </View>
      ))}
      {showSuggestion ? (
        <Pressable
          onPress={handleSuggest}
          style={({ pressed }) => [styles.suggestRow, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={
            isSignedIn ? cs.pubDetail.eventSuggest : cs.pubDetail.eventSuggestSignedOut
          }
        >
          <View style={styles.suggestIcon}>
            <ClockIcon size={19} color={Colors.amber} />
          </View>
          <View style={styles.eventCopy}>
            <Text style={styles.suggestTitle} maxFontSizeMultiplier={FontScaleCap.body}>
              {isSignedIn ? cs.pubDetail.eventSuggest : cs.pubDetail.eventSuggestSignedOut}
            </Text>
            <Text style={styles.details} maxFontSizeMultiplier={FontScaleCap.body}>
              Po kontrole ji ukážeme ostatním.
            </Text>
          </View>
          <ChevronRightIcon size={20} color={Colors.mutedText} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    marginTop: Spacing.xl,
    marginBottom: Spacing.sm,
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: Colors.amberLight,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: withAlpha(Colors.foam, 0.1),
  },
  eventCopy: { flex: 1 },
  eventTitle: {
    color: Colors.foam,
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 20,
  },
  validity: {
    marginTop: 2,
    color: Colors.amberLight,
    fontWeight: '500',
    fontSize: 13,
    lineHeight: 18,
  },
  details: {
    marginTop: 3,
    color: Colors.mutedText,
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
  },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: Spacing.sm },
  verified: { color: Colors.success, fontWeight: '500', fontSize: 12 },
  suggestRow: {
    minHeight: HitArea.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  suggestIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.small,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.stout3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  suggestTitle: { color: Colors.foam, fontWeight: '600', fontSize: 14 },
  pressed: { opacity: 0.7 },
});
