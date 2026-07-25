/**
 * CompassCard — the hero of the "Kompas" screen: the dial, the distance and
 * the pub, in one card.
 *
 * It is the direct sibling of `CoasterCard` and `NightCard`: same card surface
 * (`CardSurface.card`), same four-step type scale, same hairline footer with one
 * amber text door.
 *
 * The rule this file enforces: the distance numeral is the only lit thing here.
 * No amber frame, no glow, no halo — the screen's one glow belongs to its one
 * button. The numeral keeps a 1.24x line box because Baloo 2 ExtraBold
 * overshoots and iOS otherwise shaves the tops off the digits, and the unit
 * caption is pulled back up into that headroom so the pair reads as one object.
 *
 * The footer carries the pub, then its opening hours on their own line with a
 * status dot, then the beer and its price. The hours used to be the first clause
 * of a single 13pt sentence that also held the beer, which meant the one fact
 * you want while standing on the street ("is it even open?") was the thing that
 * got truncated first. It now has its own line and its own colour, and when the
 * lookup comes back empty it says so — with the "Zmapuj" door right beside it.
 *
 * The card also owns the dial's SIZE but not the dial itself: the parent hands
 * in a ready-made node (it owns the sensors and the animation) and gets the
 * size back through `onDialSize`, measured from the card. Contents are always
 * dimensioned from the card, never the other way round — on an iPhone SE the
 * dial shrinks instead of spilling over the rounded corner.
 *
 * Purely presentational: props in, callbacks out. The parent has already
 * formatted the distance, declined the unit, decided what the meta line says
 * and whether pub names are hidden.
 */

import React, { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { CardSheen, CardSurface } from '@/components/shared/CardSurface';
import { ChevronRightIcon } from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius } from '@/theme/layout';

/**
 * How much of the card's body the distance readout gets. A share, not a fixed
 * number: a fixed 96 left the dial 40pt too tall and clipped its top off on an
 * iPhone SE, and a fixed 140 then dropped "METRŮ" on top of the pub name. The
 * dial takes what is left, so the pair always fits whatever card it is in.
 */
function readoutReserve(bodyHeight: number): number {
  return Math.max(64, Math.min(140, Math.round(bodyHeight * 0.38)));
}

/** Room inside the reserve for the letterspaced unit caption under the numeral. */
const CAPTION_ROOM = 20;

/**
 * A floor, not a target. It must stay well under what a short phone can give,
 * or the clamp itself becomes the overflow: `Math.max` happily hands back a
 * size the card has no room for.
 */
const DIAL_MIN = 110;
const DIAL_MAX = 300;

/** The numeral shrinks with its digit count so "1000" never crowds the card. */
function distanceFontSize(value: string): number {
  if (value.length <= 2) return 88;
  if (value.length <= 3) return 72;
  return 56;
}

/** Opening-hours tone. Never red — we don't shout at people about a closed pub. */
function hoursColor(tone: CompassCardProps['hoursTone']): string {
  if (tone === 'open') return Colors.open;
  if (tone === 'closed') return Colors.closed;
  return Colors.mutedText;
}

export interface CompassCardProps {
  /**
   * The ready-made dial. The parent owns the sensor stream and the rotation, so
   * this card only places it and tells the parent how big it may be.
   */
  dial: React.ReactNode;
  /** Fires when the measured dial size changes — never on every layout pass. */
  onDialSize: (size: number) => void;
  /** The bare formatted number ("80", "1,2"), or null when the distance is unknown. */
  distanceValue: string | null;
  /** Already declined and uppercased by the parent ("METRŮ" / "KILOMETRŮ"). */
  distanceUnit: string;
  /** The target pub, or null when there is none to point at. */
  pubName: string | null;
  /**
   * The opening hours, on their own line with a status dot: "Otevřeno do 23:00",
   * "Zavřeno · otevře v 11:00", "Otevírací dobu neznám". Null only while the
   * lookup is still in flight — nobody reads "Načítám".
   */
  hoursLabel: string | null;
  /** Colors the dot and the hours line. */
  hoursTone: 'open' | 'closed' | 'unknown';
  /** The quiet line under the hours: "Pilsner Urquell · 95 Kč", or null. */
  beerLine: string | null;
  /** Hidden-pub-names mode: the footer teases instead of telling. */
  hidden: boolean;
  /** Show the amber "Zmapuj ›" door on the right of the footer. */
  showMapLink: boolean;
  /** Footer tap: opens the pub info, or reveals the name while hidden. */
  onPressFooter: () => void;
  accessibilityLabel: string;
}

export function CompassCard({
  dial,
  onDialSize,
  distanceValue,
  distanceUnit,
  pubName,
  hoursLabel,
  hoursTone,
  beerLine,
  hidden,
  showMapLink,
  onPressFooter,
  accessibilityLabel,
}: CompassCardProps) {
  // Last size handed to the parent. A ref, not state: re-reporting the same
  // number would bounce layout -> setState -> layout forever.
  const lastDialSizeRef = useRef(0);
  // The body's measured height also drives the numeral, so it has to be state.
  const [bodyHeight, setBodyHeight] = useState(0);

  const handleBodyLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      setBodyHeight(height);
      const available = Math.min(width, height - readoutReserve(height));
      const next = Math.round(Math.max(DIAL_MIN, Math.min(DIAL_MAX, available)));
      if (next === lastDialSizeRef.current) return;
      lastDialSizeRef.current = next;
      onDialSize(next);
    },
    [onDialSize],
  );

  // Both the dial and the numeral are sized FROM the card (§5.3). Fixed sizes
  // were what pushed "METRŮ" on top of the pub name on an iPhone SE: the dial
  // and an 88pt numeral together simply do not fit a 667pt screen, so the
  // readout takes a share of the card and the numeral fits that share.
  const numeralSize =
    distanceValue === null
      ? 0
      : bodyHeight > 0
        ? Math.min(
            distanceFontSize(distanceValue),
            Math.max(32, Math.floor((readoutReserve(bodyHeight) - CAPTION_ROOM) / 1.24)),
          )
        : distanceFontSize(distanceValue);
  const hasFooter = pubName !== null || hidden;

  return (
    <View style={styles.card}>
      <CardSheen />

      <View style={styles.body} onLayout={handleBodyLayout}>
        {dial}

        {distanceValue !== null ? (
          <View style={styles.readout}>
            <Text
              style={[
                styles.distance,
                // The line box must clear the extrabold glyph's overshoot, or
                // iOS shaves the top off the digits. 1.24 leaves real headroom;
                // the unit's negative margin closes the gap it creates below.
                { fontSize: numeralSize, lineHeight: numeralSize * 1.24 },
              ]}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.display}
            >
              {distanceValue}
            </Text>
            <Text
              style={styles.unit}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {distanceUnit}
            </Text>
          </View>
        ) : null}
      </View>

      {hasFooter ? (
        <Pressable
          onPress={onPressFooter}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          style={({ pressed }) => [styles.footer, pressed && styles.pressed]}
        >
          {hidden ? (
            <Text
              style={styles.revealHint}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {cs.compass.revealHint}
            </Text>
          ) : (
            <>
              {/* Without minWidth/flexShrink a long name pushes the door off the
                  card instead of truncating. Test case: "Restaurace U Zlatého
                  Tygra na Starém Městě". */}
              <View style={styles.footerText}>
                <Text
                  style={styles.pubName}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.heading}
                >
                  {pubName}
                </Text>
                {/* Fixed-height slot: the hours arrive from the network a moment
                    after the name, and the dial must not resize when they land. */}
                <View style={styles.metaSlot}>
                  {hoursLabel !== null ? (
                    <View style={styles.hoursRow}>
                      {/* The one dot in the app that is allowed to be decoration-
                          shaped, because it carries real state: open, closed or
                          unknown. */}
                      <View
                        style={[styles.hoursDot, { backgroundColor: hoursColor(hoursTone) }]}
                      />
                      <Text
                        style={[styles.hours, { color: hoursColor(hoursTone) }]}
                        numberOfLines={1}
                        maxFontSizeMultiplier={FontScaleCap.body}
                      >
                        {hoursLabel}
                      </Text>
                    </View>
                  ) : null}
                  {beerLine !== null ? (
                    <Text
                      style={styles.meta}
                      numberOfLines={1}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {beerLine}
                    </Text>
                  ) : null}
                </View>
              </View>

              {showMapLink ? (
                <View style={styles.mapLink}>
                  <Text style={styles.mapLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.compass.mapPubLink}
                  </Text>
                  <ChevronRightIcon size={15} color={Colors.amber} />
                </View>
              ) : null}
            </>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The card eats the space between the header and the button, so the screen
  // has no dead middle and the dial gets room to be the hero. It clips its own
  // contents: the dial is sized from the card, never the other way.
  card: {
    ...CardSurface.card,
    flex: 1,
  },
  pressed: {
    opacity: 0.85,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Stretched so the centered unit caption can shrink against the card's real
  // width instead of against its own content box.
  readout: {
    alignSelf: 'stretch',
    marginTop: 12,
  },
  distance: {
    fontFamily: Fonts.display.extrabold,
    color: Colors.amber,
    includeFontPadding: false,
    textAlign: 'center',
    // Tabular figures so the number never shifts sideways as you walk.
    fontVariant: ['tabular-nums'],
  },
  // Small, wide, unlit: a caption for the numeral, not a headline of its own.
  // Pulled up into the numeral's line-box headroom so the pair reads as one
  // object instead of two stacked labels.
  unit: {
    marginTop: -8,
    fontFamily: Fonts.display.bold,
    fontSize: 13,
    letterSpacing: 3,
    color: Colors.foamMuted,
    includeFontPadding: false,
    textAlign: 'center',
  },
  footer: {
    ...CardSurface.footer,
    minHeight: HitArea.min,
  },
  footerText: {
    flex: 1,
    minWidth: 0,
  },
  pubName: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
    includeFontPadding: false,
  },
  // Holds both lines at a fixed height so the card never resizes around them.
  metaSlot: {
    minHeight: 38,
    justifyContent: 'center',
    gap: 2,
  },
  hoursRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hoursDot: {
    width: 6,
    height: 6,
    borderRadius: Radius.pill,
  },
  hours: {
    flexShrink: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    includeFontPadding: false,
  },
  meta: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  revealHint: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.amber,
    includeFontPadding: false,
  },
  mapLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  mapLabel: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.amber,
    includeFontPadding: false,
  },
});
