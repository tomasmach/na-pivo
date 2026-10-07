import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Linking from 'expo-linking';

import { ExternalLinkIcon } from '@/components/shared/IconGlyph';
import { t } from '@/i18n';
import { useHomeTransitStore } from '@/stores/homeTransitStore';
import type { TallySession } from '@/stores/tallyStore';
import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius } from '@/theme/layout';
import {
  formatDepartureTime,
  idosConnectionUrl,
  isUpcomingDeparture,
} from '@/transit/homeTransit';

/**
 * Tonight's last direct connection home, shown only in the evening that is
 * still running. Nothing renders without a home point, outside PID, offline
 * before the first answer, or once the connection left.
 */
export function HomeTransitCard({ session }: { session: TallySession }) {
  const departure = useHomeTransitStore((state) =>
    state.lookupKey?.startsWith(`${session.clientId}|`) ? state.departure : null,
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!departure) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [departure]);

  if (!isUpcomingDeparture(departure, now)) return null;

  const minutes = Math.ceil((departure.departsAtMs - now) / 60_000);
  const route = t.homeTransit.route(departure.line, departure.fromStopName, departure.toStopName);

  return (
    <View style={styles.card} testID="evening-home-transit">
      <Text style={styles.headerText} maxFontSizeMultiplier={FontScaleCap.body}>
        {t.homeTransit.sectionHeader}
      </Text>
      <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
        {t.homeTransit.title(formatDepartureTime(departure.departsAtMs))}
      </Text>
      <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
        {`${route} · ${t.homeTransit.leavesIn(minutes)}`}
      </Text>
      <Pressable
        onPress={() => void Linking.openURL(idosConnectionUrl(departure)).catch(() => undefined)}
        testID="evening-home-transit-idos"
        accessibilityRole="link"
        accessibilityLabel={t.homeTransit.openIdosA11y}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <ExternalLinkIcon size={15} color={Colors.foamMuted} />
        <Text style={styles.buttonText} maxFontSizeMultiplier={FontScaleCap.heading}>
          {t.homeTransit.openIdos}
        </Text>
      </Pressable>
      <Text style={styles.attribution} maxFontSizeMultiplier={FontScaleCap.body}>
        {t.homeTransit.footnote}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 18,
  },
  headerText: {
    marginBottom: 6,
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: Colors.amber,
  },
  title: {
    fontFamily: Fonts.display.bold,
    fontSize: 17,
    color: Colors.foam,
  },
  body: {
    marginTop: 4,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.foamMuted,
  },
  button: {
    marginTop: 12,
    alignSelf: 'flex-start',
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
  },
  buttonText: {
    fontFamily: Fonts.display.semibold,
    fontSize: 14,
    color: Colors.foamMuted,
  },
  pressed: {
    opacity: 0.75,
  },
  attribution: {
    marginTop: 10,
    fontFamily: Fonts.ui.medium,
    fontSize: 11,
    color: Colors.mutedText,
  },
});
