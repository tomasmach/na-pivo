import React, { memo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Colors } from '@/theme/colors';
import { RadialBackdrop } from './Gradient';

// A subtle roasted-malt grain laid over the gradients at very low opacity. The
// asset is opaque (no alpha), so it reads as fine material "tooth" — the kind
// of matte surface texture pure SVG gradients can't fake — rather than a
// visible image. Kept tiny (1024² JPG) and tiled.
const MALT_GRAIN = require('../../../assets/images/malt-grain.jpg');

/**
 * The "Brass Taproom" screen backdrop: one warm overhead key light pooling on
 * the upper-center of the screen (where the compass sits), plus a corner
 * vignette that sinks the edges into roasted-malt shadow. This single light
 * source is what replaces the old flat `Colors.stout` fill and the omnipresent
 * amber glow — depth now comes from one believable light, not neon halos.
 *
 * Render as the FIRST child of a full-bleed `position:'relative'` root that
 * still carries `backgroundColor: Colors.stout` as the solid base (so there is
 * never a transparent flash); these two layers sit above that base, below
 * content. Both are `pointerEvents:'none'`.
 */
export const ScreenBackground = memo(function ScreenBackground() {
  return (
    <>
      {/* Warm overhead key light — pools over the dial (cy 34%), fades to roast */}
      <RadialBackdrop
        cx="50%"
        cy="34%"
        r="85%"
        stops={[
          { offset: 0, color: Colors.stout3, opacity: 0.9 },
          { offset: 0.38, color: Colors.stout2, opacity: 0.85 },
          { offset: 0.72, color: Colors.stout, opacity: 1 },
          { offset: 1, color: Colors.roast, opacity: 1 },
        ]}
      />
      {/* Corner vignette — darkens only the edges */}
      <RadialBackdrop
        cx="50%"
        cy="50%"
        r="75%"
        stops={[
          { offset: 0, color: Colors.black, opacity: 0 },
          { offset: 0.6, color: Colors.black, opacity: 0 },
          { offset: 1, color: Colors.black, opacity: 0.28 },
        ]}
      />
      {/* Fine roasted-malt grain — material tooth, barely there. Wrapped so the
          layer never intercepts touches (pointerEvents lives on the View). */}
      <View style={styles.grainLayer}>
        <Image
          source={MALT_GRAIN}
          style={[StyleSheet.absoluteFill, styles.grain]}
          resizeMode="repeat"
          // Decorative only — keep it out of the accessibility tree.
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          fadeDuration={0}
        />
      </View>
    </>
  );
});

const styles = StyleSheet.create({
  grainLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'none',
  },
  grain: {
    opacity: 0.07,
  },
});
