/**
 * DESIGN MOCK — the "now playing" bar for a running night.
 *
 * Same object as the media mini player: while a session is live and you have
 * minimised it, a glass strip rides directly above the tab bar carrying just
 * enough to prove the night is still counting — the pub, the tally, the clock —
 * and one tap puts you back in the fullscreen mode.
 *
 * Liquid glass where the OS has it (§15.1), the solid fallback everywhere else
 * (§15.2). It is chrome, so glass is exactly where it belongs; nothing you have
 * to read sits behind it.
 *
 * Brown glass, not a green plate. The strip floats — there is no solid surface
 * under it and none behind it; it borrows whatever is on screen and tints it
 * warm, which is what makes it read as chrome sitting ON the app rather than a
 * band welded to the tab bar.
 *
 * No green dot. A dot is a status light that has to be learned; the ticking
 * stopwatch beside the pub name says the same thing and says it in words you
 * already read. That also makes the strip explain ITSELF — "U Fleků / 12:04 ·
 * 3 piva" is obviously a running evening, where a name and a dot could have
 * been anything.
 *
 * It also carries the counter, not just a link to it. The one thing you do
 * during a night is add a beer, and making that cost a screen transition is
 * what turns a fast ritual into an errand.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { usePathname, useRouter, type Href } from 'expo-router';

import { BeerIcon } from '@/components/shared/IconGlyph';
import { formatStopwatch, useLivePartyStore, useNightSeconds } from '@/mocks/livePartyStore';
import { beersOf, nightMe } from '@/party/nightRecord';
import { useNightRecord } from '@/party/useNightRecord';
import { usePartyBeer } from '@/party/usePartyBeer';
import { MockColors } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap, Fonts } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

const GLASS = isLiquidGlassAvailable();

/** "1 pivo / 3 piva / 7 piv" — the strip is small enough that a wrong plural is
 *  the first thing you notice on it. */
function beersLabel(count: number): string {
  if (count === 1) return '1 pivo';
  if (count >= 2 && count <= 4) return `${count} piva`;
  return `${count} piv`;
}

/**
 * The clock, ticking, on its own — the same trick the hub uses: only this line
 * re-renders every second, not the whole bar and everything under it.
 *
 * It also sits in its OWN slot at the end of the row rather than in front of
 * the beer count. Sharing a line, every rollover past the hour ("59:04" →
 * "1:00:04") grew the clock by a character and shoved the count sideways, which
 * on a strip that redraws every second reads as a twitch.
 */
function BarClock({ startedAt }: { startedAt: number }) {
  const seconds = useNightSeconds(startedAt);
  return (
    <Text style={styles.clock} allowFontScaling={false} numberOfLines={1}>
      {formatStopwatch(seconds)}
    </Text>
  );
}

export function LivePartyBar() {
  const router = useRouter();
  const live = useLivePartyStore((s) => s.live);
  const pubName = useLivePartyStore((s) => s.pubName);
  const startedAt = useLivePartyStore((s) => s.startedAt);
  const houseBeer = useLivePartyStore((s) => s.houseBeer);
  const pathname = usePathname();
  // Before the early return: the same night the hub shows, from the same
  // record, and hooks do not survive being skipped.
  const night = useNightRecord();
  const beer = usePartyBeer();
  const count = beersOf(night, nightMe(night)?.id);

  // Nothing to minimise into while you are already standing in it.
  if (!live || pathname === '/beer') return null;

  return (
    <View style={styles.wrap}>
      {GLASS ? (
        <GlassView
          style={StyleSheet.absoluteFill}
          glassEffectStyle="regular"
          tintColor={withAlpha(MockColors.accent, 0.1)}
          colorScheme="dark"
          pointerEvents="none"
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.solid]} pointerEvents="none" />
      )}

      {/* The body opens the hub; the counter stays where your thumb already is. */}
      <Pressable
        onPress={() => router.navigate('/beer' as Href)}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Večer běží, ${pubName}, ${beersLabel(count)}. Otevřít.`}
      >
        <View style={styles.text}>
          <Text style={styles.pub} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {pubName}
          </Text>
          <Text style={styles.meta} numberOfLines={1} allowFontScaling={false}>
            {beersLabel(count)}
          </Text>
        </View>

        {/* The width the strip was wasting: the clock takes the middle, big
            enough to read without stopping, and grows leftwards into empty
            space instead of pushing anything. */}
        {startedAt === null ? null : <BarClock startedAt={startedAt} />}
      </Pressable>

      <Pressable
        onPress={() => beer.add(houseBeer)}
        style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
        accessibilityRole="button"
        accessibilityLabel="Přidat pivo"
        hitSlop={6}
      >
        <BeerIcon size={17} color={Colors.stout} />
        <Text style={styles.ctaText} allowFontScaling={false}>
          +1
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingLeft: Spacing.md,
    paddingRight: 6,
    height: 58,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.14),
  },
  /** Only below iOS 26. Above it the bar has no fill of its own at all. */
  solid: { backgroundColor: withAlpha(Colors.stout2, 0.96) },
  pressed: { opacity: 0.85 },
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  text: { flex: 1 },
  pub: { fontSize: 16, fontWeight: '700', color: Colors.foam },
  meta: {
    fontSize: 13,
    fontWeight: '600',
    color: withAlpha(Colors.foam, 0.72),
    marginTop: 1,
  },
  clock: {
    fontFamily: Fonts.numeral,
    fontSize: 20,
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
    marginRight: Spacing.xs,
  },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  ctaPressed: { opacity: 0.9, transform: [{ scale: 0.97 }] },
  ctaText: { fontSize: 16, fontWeight: '800', color: Colors.stout },
});
