import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Linking from 'expo-linking';

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
  const line = departure.line ? t.homeTransit.vehicleLine(departure.routeType, departure.line) : '';

  return (
    <View style={styles.card} testID="evening-home-transit">
      <View style={styles.top}>
        <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
          {t.homeTransit.title}
        </Text>
        <View style={styles.when}>
          <Text
            style={styles.time}
            numberOfLines={1}
            allowFontScaling={false}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {formatDepartureTime(departure.departsAtMs)}
          </Text>
          <Text style={styles.leavesIn} maxFontSizeMultiplier={FontScaleCap.body}>
            {t.homeTransit.leavesIn(minutes)}
          </Text>
        </View>
      </View>
      <Text style={styles.route} maxFontSizeMultiplier={FontScaleCap.body}>
        {t.homeTransit.route(line, departure.fromStopName, departure.toStopName)}
      </Text>
      <Pressable
        onPress={() => void Linking.openURL(idosConnectionUrl(departure)).catch(() => undefined)}
        testID="evening-home-transit-idos"
        accessibilityRole="link"
        accessibilityLabel={t.homeTransit.openIdosA11y}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Text style={styles.buttonText} maxFontSizeMultiplier={FontScaleCap.heading}>
          {t.homeTransit.openIdos}
        </Text>
      </Pressable>
      <Text style={styles.footnote} maxFontSizeMultiplier={FontScaleCap.body}>
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
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  title: {
    flex: 1,
    paddingTop: 3,
    fontFamily: Fonts.ui.semibold,
    fontSize: 16,
    color: Colors.foam,
  },
  when: {
    alignItems: 'flex-end',
  },
  time: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    lineHeight: 27,
    letterSpacing: -0.5,
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },
  leavesIn: {
    fontFamily: Fonts.ui.bold,
    fontSize: 13,
    color: Colors.amber,
  },
  route: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.foamMuted,
  },
  button: {
    marginTop: 14,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    paddingHorizontal: 16,
  },
  buttonText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 14,
    color: Colors.foam,
  },
  pressed: {
    opacity: 0.65,
  },
  footnote: {
    marginTop: 12,
    fontFamily: Fonts.ui.medium,
    fontSize: 11.5,
    color: Colors.mutedText,
  },
});
