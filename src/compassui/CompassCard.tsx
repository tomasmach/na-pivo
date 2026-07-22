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
 * The dial is the icon of the whole product, so it gets the leftovers, not a
 * budget: the readout takes its own intrinsic height and the dial's slot flexes
 * into everything else. Reserving a share of the card for the numeral first is
 * what left the dial small with dead brown space under it.
 *
 * Purely presentational: props in, callbacks out. The parent has already
 * formatted the distance, declined the unit, decided what the meta line says
 * and whether pub names are hidden.
 */

import React, { useCallback, useRef } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { CardSheen, CardSurface } from '@/components/shared/CardSurface';
import { ChevronRightIcon, RefreshCwIcon } from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius } from '@/theme/layout';

/**
 * A floor, not a target. It must stay well under what a short phone can give,
 * or the clamp itself becomes the overflow: `Math.max` happily hands back a
 * size the card has no room for.
 *
 * The ceiling exists only so the dial cannot outgrow its 320pt design space on
 * a tablet-sized card; on every phone the card's own width is the real limit.
 */
const DIAL_MIN = 110;
const DIAL_MAX = 380;

/**
 * The dial's SVG ring stops at r=151.5 (r=150 plus half its 3pt stroke) inside a
 * 320 box, so ~5 % of the measured slot is transparent margin. Scaling up by that
 * much lets the ring touch the edge of the room it was given instead of floating
 * inside it — any more and the stroke gets shaved off.
 */
const DIAL_BLEED = 320 / 303;

/**
 * The numeral shrinks with its digit count so "1000" never crowds the card.
 *
 * These are deliberately far below the 88pt this used to be. Every point here is
 * a point the dial does not get, and measured on an iPhone 17 the old readout ate
 * 130pt of a 298pt card body — half the hero's room for four glyphs. "2" at 44pt
 * is still by far the largest thing on the screen.
 */
function distanceFontSize(value: string): number {
  if (value.length <= 2) return 44;
  if (value.length <= 3) return 40;
  return 34;
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
  /** The displayed tap list changes regularly and is only a current snapshot. */
  beerMenuRotates: boolean;
  /** Hidden-pub-names mode: the footer teases instead of telling. */
  hidden: boolean;
  /** Show the amber chevron door beside the pub name. */
  showDetailLink: boolean;
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
  beerMenuRotates,
  hidden,
  showDetailLink,
  onPressFooter,
  accessibilityLabel,
}: CompassCardProps) {
  // Last size handed to the parent. A ref, not state: re-reporting the same
  // number would bounce layout -> setState -> layout forever.
  const lastDialSizeRef = useRef(0);

  // The dial slot is measured, not budgeted. The readout below it takes its own
  // intrinsic height (one numeral line plus the caption), the slot flexes into
  // whatever is left, and the dial is simply as big as that square — no share,
  // no reserve, no arithmetic that can leave the dial floating in dead space.
  const handleDialSlotLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      const available = Math.min(width, height) * DIAL_BLEED;
      const next = Math.round(Math.max(DIAL_MIN, Math.min(DIAL_MAX, available)));
      if (next === lastDialSizeRef.current) return;
      lastDialSizeRef.current = next;
      onDialSize(next);
    },
    [onDialSize],
  );

  const numeralSize = distanceValue === null ? 0 : distanceFontSize(distanceValue);
  const hasFooter = pubName !== null || hidden;

  return (
    <View style={styles.card}>
      <CardSheen />

      <View style={styles.body}>
        {/* The dial hangs in an absolute layer inside the slot. In the flow it
            would feed its own height back into the slot it was measured from:
            slot -> bigger dial -> bigger slot -> bigger dial, until the clamp
            stopped it with the ring hanging over the card's edge. Out of the
            flow, the slot's height depends only on what is left over. */}
        <View style={styles.dialSlot} onLayout={handleDialSlotLayout}>
          <View style={styles.dialLayer} pointerEvents="none">
            {dial}
          </View>
        </View>

        {distanceValue !== null ? (
          <View style={styles.readout}>
            <Text
              style={[
                styles.distance,
                // The line box must clear the extrabold glyph's overshoot, or
                // iOS shaves the top off the digits. 1.14 is the least that still
                // does at this size; the unit's negative margin closes the rest.
                { fontSize: numeralSize, lineHeight: numeralSize * 1.14 },
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
              {/* The door shares a row with the NAME only, so the hours and the
                  beer get the card's full width. They used to end at the door's
                  left edge, which is what truncated "Velkopopovický Kozel Černý"
                  with half the footer sitting empty beside it. Without
                  minWidth/flexShrink a long name pushes the door off the card
                  instead of truncating. Test case: "Restaurace U Zlatého Tygra
                  na Starém Městě". */}
              <View style={styles.footerText}>
                <View style={styles.nameRow}>
                  <Text
                    style={styles.pubName}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.heading}
                  >
                    {pubName}
                  </Text>
                  {showDetailLink ? (
                    <View style={styles.detailDoor}>
                      <ChevronRightIcon size={16} color={Colors.amber} />
                    </View>
                  ) : null}
                </View>
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
                    <View style={styles.beerRow}>
                      {beerMenuRotates ? (
                        <RefreshCwIcon size={12} color={Colors.amber} />
                      ) : null}
                      <Text
                        style={[styles.meta, beerMenuRotates && styles.rotatingMeta]}
                        numberOfLines={1}
                        maxFontSizeMultiplier={FontScaleCap.body}
                      >
                        {beerMenuRotates ? `${cs.counter.rotatingMenuBadge} · ${beerLine}` : beerLine}
                      </Text>
                    </View>
                  ) : beerMenuRotates ? (
                    <View style={styles.beerRow}>
                      <RefreshCwIcon size={12} color={Colors.amber} />
                      <Text
                        style={[styles.meta, styles.rotatingMeta]}
                        numberOfLines={1}
                        maxFontSizeMultiplier={FontScaleCap.body}
                      >
                        {cs.counter.rotatingMenuBadge}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
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
  // Eats everything the readout does not need. `overflow: hidden` keeps the one
  // frame between the layout pass and the new dial size from spilling.
  dialSlot: {
    flex: 1,
    alignSelf: 'stretch',
    minHeight: DIAL_MIN,
    overflow: 'hidden',
  },
  dialLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Stretched so the centered unit caption can shrink against the card's real
  // width instead of against its own content box.
  // The dial's ring now reaches the edge of its slot, so the numeral needs a
  // real gap under it — at marginTop 2 the "2" sat on the ring's tick dots.
  readout: {
    alignSelf: 'stretch',
    marginTop: 10,
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
    marginTop: -2,
    fontFamily: Fonts.display.bold,
    fontSize: 14,
    letterSpacing: 3.2,
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
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pubName: {
    flexShrink: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
    includeFontPadding: false,
  },
  // A chevron, not a verb: the footer opens what the pub IS, and mapping it is
  // one of the things you can do in there. "Zmapuj" as the default door asked
  // people to fill in a pub they are still two kilometres away from.
  detailDoor: {
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
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
  beerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  meta: {
    flexShrink: 1,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  rotatingMeta: {
    color: Colors.amber,
  },
  revealHint: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.amber,
    includeFontPadding: false,
  },
});
