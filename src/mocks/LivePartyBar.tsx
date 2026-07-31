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
 * band welded to the tab bar. Only the live dot keeps the running-session
 * colour: that is the one pixel that has to say "still counting" from the
 * corner of your eye, and it does not need the whole bar to say it.
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
import { formatElapsed, useLivePartyStore } from '@/mocks/livePartyStore';
import { MockColors } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

const GLASS = isLiquidGlassAvailable();

export function LivePartyBar() {
  const router = useRouter();
  const live = useLivePartyStore((s) => s.live);
  const pubName = useLivePartyStore((s) => s.pubName);
  const beers = useLivePartyStore((s) => s.beers);
  const minutes = useLivePartyStore((s) => s.minutes);
  const addBeer = useLivePartyStore((s) => s.addBeer);
  const houseBeer = useLivePartyStore((s) => s.houseBeer);
  const pathname = usePathname();

  // Nothing to minimise into while you are already standing in it.
  if (!live || pathname === '/beer') return null;

  const count = beers.length;

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
        accessibilityLabel={`Večer běží, ${pubName}, ${count} piv. Otevřít.`}
      >
        <View style={styles.dot} />
        <View style={styles.text}>
          <Text style={styles.pub} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {pubName}
          </Text>
          <Text style={styles.meta} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {count} piv · {formatElapsed(minutes)}
          </Text>
        </View>
      </Pressable>

      <Pressable
        onPress={() => addBeer(houseBeer)}
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
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: MockColors.live },
  text: { flex: 1 },
  pub: { fontSize: 15, fontWeight: '700', color: Colors.foam },
  meta: { fontSize: 12, fontWeight: '500', color: withAlpha(Colors.foam, 0.7), marginTop: 1 },

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
