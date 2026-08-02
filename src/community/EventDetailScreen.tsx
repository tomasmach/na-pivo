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
import { EventCover } from '@/community/EventCover';
import type { CommunityEvent } from '@/community/mockEvents';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

export function EventDetailScreen({ event }: { event: CommunityEvent }) {
  const insets = useSafeAreaInsets();
  const [going, setGoing] = React.useState(Boolean(event.mine));

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 52, paddingBottom: insets.bottom + TAB_CHROME },
      ]}
    >
      <EventCover event={event} height={160} />

      <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
        {event.title}
      </Text>
      <Text style={styles.when} maxFontSizeMultiplier={FontScaleCap.body}>
        {event.when} {event.time}
      </Text>

      <View style={styles.whereRow}>
        <MapPinIcon size={16} color={Colors.amber} />
        <Text style={styles.where} maxFontSizeMultiplier={FontScaleCap.body}>
          {event.where}
        </Text>
      </View>

      <Text style={styles.blurb} maxFontSizeMultiplier={FontScaleCap.body}>
        {event.blurb}
      </Text>

      {/* A number, not a guest list. */}
      <View style={styles.goingRow}>
        <UsersIcon size={16} color={Colors.mutedText} />
        <Text style={styles.goingText} maxFontSizeMultiplier={FontScaleCap.body}>
          Jde {event.going + (going && !event.mine ? 1 : 0)} pivařů
        </Text>
      </View>

      <Pressable
        onPress={() => setGoing((current) => !current)}
        style={({ pressed }) => [styles.cta, going && styles.ctaOn, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityState={{ selected: going }}
        accessibilityLabel={going ? 'Přece jen nejdu' : 'Půjdu'}
      >
        {going ? <CheckIcon size={18} color={Colors.amber} /> : null}
        <Text
          style={[styles.ctaText, going && styles.ctaTextOn]}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {going ? 'Jdeš' : 'Půjdu'}
        </Text>
      </Pressable>

      <Text style={styles.mockNote} maxFontSizeMultiplier={FontScaleCap.body}>
        Design mock — data jsou napevno.
      </Text>
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

  mockNote: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.mutedText,
    textAlign: 'center',
    marginTop: MockLayout.sectionGap,
  },
});
