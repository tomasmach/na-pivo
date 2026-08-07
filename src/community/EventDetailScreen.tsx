/**
 * DESIGN MOCK — one event, opened from the Komunita card.
 *
 * The order is the order you ask: what is it, when and where, what it actually
 * is, who else is going. The poster leads because that is what you tapped.
 *
 * "Kdo jde" is a COUNT, never a list of names. Who is going to a pub event is
 * exactly the sort of thing this product does not publish (AGENTS.md).
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CheckIcon, MapPinIcon, UsersIcon } from '@/components/shared/IconGlyph';
import { TAB_CHROME } from '@/components/shared/TabBar';
import {
  EventCover,
  eventDateLabel,
  eventPlaceLabel,
  eventTimeLabel,
} from '@/community/EventCover';
import {
  leaveCommunityEvent,
  rememberCommunityEvent,
  requestCommunityEventJoin,
  type CommunityEvent,
} from '@/data/communityEventsClient';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

export function EventDetailScreen({ event }: { event: CommunityEvent }) {
  const insets = useSafeAreaInsets();
  const showToast = useToastStore((state) => state.show);
  const [current, setCurrent] = React.useState(event);
  const [busy, setBusy] = React.useState(false);
  const going = current.membershipStatus === 'approved';
  const pending = current.membershipStatus === 'pending';
  const closed = current.status === 'ended' || current.status === 'cancelled';
  const attendeeCount = Math.max(1, current.capacity - current.availableSpots);

  const toggleMembership = React.useCallback(async () => {
    if (busy || current.isHost || closed) return;
    setBusy(true);
    const result = going || pending
      ? await leaveCommunityEvent(current.id)
      : await requestCommunityEventJoin(current.id);
    if (result.ok) {
      const next: CommunityEvent = {
        ...current,
        membershipStatus: going || pending ? 'left' : 'pending',
        availableSpots: going
          ? Math.min(current.capacity - 1, current.availableSpots + 1)
          : current.availableSpots,
      };
      setCurrent(next);
      rememberCommunityEvent(next);
      showToast(
        going || pending
          ? 'Místo je zase volné.'
          : 'Žádost letí pořadateli. Teď už jen držet palce.',
      );
    } else {
      showToast(result.detail);
    }
    setBusy(false);
  }, [busy, closed, current, going, pending, showToast]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 52, paddingBottom: insets.bottom + TAB_CHROME },
      ]}
    >
      <EventCover event={current} height={160} />

      <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
        {current.title}
      </Text>
      <Text style={styles.when} maxFontSizeMultiplier={FontScaleCap.body}>
        {eventDateLabel(current)} {eventTimeLabel(current)}
      </Text>

      <View style={styles.whereRow}>
        <MapPinIcon size={16} color={Colors.amber} />
        <Text style={styles.where} maxFontSizeMultiplier={FontScaleCap.body}>
          {current.exactAddress || eventPlaceLabel(current)}
        </Text>
      </View>

      <Text style={styles.blurb} maxFontSizeMultiplier={FontScaleCap.body}>
        {current.description}
      </Text>

      {/* A number, not a guest list. */}
      <View style={styles.goingRow}>
        <UsersIcon size={16} color={Colors.mutedText} />
        <Text style={styles.goingText} maxFontSizeMultiplier={FontScaleCap.body}>
          Jde {attendeeCount} pivařů
        </Text>
      </View>

      <Pressable
        onPress={() => void toggleMembership()}
        disabled={busy || current.isHost || closed}
        style={({ pressed }) => [
          styles.cta,
          (going || pending || current.isHost || closed) && styles.ctaOn,
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected: going, disabled: busy || current.isHost || closed }}
        accessibilityLabel={
          closed
            ? 'Akce už není otevřená'
            : current.isHost
            ? 'Pořádáš tuhle akci'
            : going || pending
              ? 'Přece jen nejdu'
              : 'Požádat o místo'
        }
      >
        {going || current.isHost ? <CheckIcon size={18} color={Colors.amber} /> : null}
        <Text
          style={[
            styles.ctaText,
            (going || pending || current.isHost || closed) && styles.ctaTextOn,
          ]}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {closed
            ? current.status === 'cancelled'
              ? 'Akce je zrušená'
              : 'Akce skončila'
            : busy
            ? 'Chvilku…'
            : current.isHost
              ? 'Pořádáš'
              : going
                ? 'Jdeš'
                : pending
                  ? 'Čekáš na potvrzení'
                  : 'Požádat o místo'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  content: { paddingHorizontal: MockLayout.screenPad },
  pressed: { opacity: 0.7 },

  title: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.foam,
    letterSpacing: -0.5,
    marginTop: Spacing.lg,
  },
  when: { fontSize: 16, fontWeight: '600', color: Colors.amber, marginTop: 4 },
  whereRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.md },
  where: { fontSize: 15, fontWeight: '500', color: Colors.foam },
  blurb: {
    fontSize: 16,
    fontWeight: '400',
    color: Colors.mutedText,
    lineHeight: 23,
    marginTop: Spacing.lg,
  },
  goingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.lg },
  goingText: { fontSize: 14, fontWeight: '600', color: Colors.mutedText },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: MockLayout.sheetButtonHeight,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    marginTop: MockLayout.sectionGap,
  },
  ctaOn: {
    backgroundColor: withAlpha(Colors.amber, 0.14),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.5),
  },
  ctaText: { ...MockType.buttonLabel, color: Colors.stout },
  ctaTextOn: { color: Colors.amber },
});
