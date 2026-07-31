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
 * The strip carries the live colour rather than the app's amber: a running
 * session is the one state worth recolouring for, and it is what makes the bar
 * legible as "still going" out of the corner of your eye.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { usePathname, useRouter, type Href } from 'expo-router';

import { BeerIcon, ChevronDownIcon } from '@/components/shared/IconGlyph';
import { useLivePartyStore } from '@/mocks/livePartyStore';
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
  const elapsed = useLivePartyStore((s) => s.elapsed);
  const pathname = usePathname();

  // Nothing to minimise into while you are already standing in it.
  if (!live || pathname === '/beer') return null;

  return (
    <Pressable
      onPress={() => router.navigate('/beer' as Href)}
      style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Večer běží, ${pubName}, ${beers} piv. Otevřít.`}
    >
      {GLASS ? (
        <GlassView
          style={StyleSheet.absoluteFill}
          glassEffectStyle="regular"
          tintColor={withAlpha(MockColors.live, 0.14)}
          colorScheme="dark"
          pointerEvents="none"
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.solid]} pointerEvents="none" />
      )}

      <View style={styles.dot} />
      <View style={styles.text}>
        <Text style={styles.pub} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {pubName}
        </Text>
        <Text style={styles.meta} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {beers} piv · {elapsed}
        </Text>
      </View>
      <BeerIcon size={18} color={MockColors.live} />
      <View style={styles.chevronUp}>
        <ChevronDownIcon size={18} color={withAlpha(Colors.foam, 0.7)} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: Spacing.md,
    height: 56,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: withAlpha(MockColors.live, 0.3),
  },
  solid: { backgroundColor: MockColors.surfaceHigh },
  pressed: { opacity: 0.85 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: MockColors.live },
  text: { flex: 1 },
  pub: { fontSize: 15, fontWeight: '700', color: Colors.foam },
  meta: { fontSize: 12, fontWeight: '500', color: withAlpha(Colors.foam, 0.7), marginTop: 1 },
  /** The glyph set has no up chevron; flipping the down one beats adding an
   *  icon to the shared set for a single mock. */
  chevronUp: { transform: [{ rotate: '180deg' }] },
});
