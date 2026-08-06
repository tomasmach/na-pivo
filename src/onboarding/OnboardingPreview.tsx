/**
 * Co onboarding ukazuje místo obrázků — kus skutečné appky.
 *
 * The three slides used to open with generated brand art: nice, and a promise
 * about a product you cannot see yet. These are the real components with canned
 * props — the compass cell from Hospody, the night's stat row from the hub, the
 * board from Komunita. Somebody scrolling the pager is looking at the app they
 * are about to use, and the first screen after "Přeskočit" is the same object
 * again rather than a different-looking product.
 *
 * Canned props, real components. Nothing here reads a store, so an empty
 * install has something to show; and when the design of a cell changes, this
 * changes with it instead of drifting into a picture of an old version.
 *
 * Not interactive: it is a preview, and a button that does nothing is worse
 * than no button.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BeerIcon, CameraIcon, DicesIcon } from '@/components/shared/IconGlyph';
import { CompassCell } from '@/pubs/CompassCell';
import { Leaderboard } from '@/mocks/Leaderboard';
import { StatGrid } from '@/mocks/StatGrid';
import { MockColors, MockLayout } from '@/mocks/mockTheme';
import type { MockPub } from '@/pubs/mockPubs';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap, Fonts } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

/** The pub the compass points at in the preview. Real coordinates, so the
 *  needle behaves like the real one on a device. */
const PREVIEW_PUB: MockPub = {
  id: 'preview',
  name: 'U Fleků',
  lat: 50.0785,
  lng: 14.42,
  distance: '180 m',
  address: 'Křemencova 11, Nové Město',
  open: true,
  hours: 'do 23:00',
  beer: 'Flekovský ležák 13°',
  priceCzk: 62,
  rating: 4.6,
  lastParty: null,
};

/** One thread row, drawn the way the hub draws it. */
function LogRow({
  icon,
  text,
  by,
  at,
}: {
  icon: React.ReactNode;
  text: string;
  by: string;
  at: string;
}) {
  return (
    <View style={styles.logRow}>
      <View style={styles.logGlyph}>{icon}</View>
      <View style={styles.logText}>
        <Text style={styles.logTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {text}
        </Text>
        <Text style={styles.logMeta} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {by} · {at}
        </Text>
      </View>
    </View>
  );
}

export function OnboardingPreview({ slide }: { slide: 'compass' | 'diary' | 'account' }) {
  if (slide === 'compass') {
    return (
      <View style={styles.frame} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <CompassCell pub={PREVIEW_PUB} badge="Nejbližší" />
      </View>
    );
  }

  if (slide === 'diary') {
    return (
      <View style={styles.frame} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.card}>
          <StatGrid
            columns={3}
            stats={[
              { label: 'piv', value: '4' },
              { label: 'u stolu', value: '3' },
              { label: 'večer', value: '2:15' },
            ]}
          />
          <View style={styles.thread}>
            <LogRow
              icon={<BeerIcon size={15} color={Colors.amber} />}
              text="Flekovský ležák 13°"
              by="Ty"
              at="22:40"
            />
            <LogRow
              icon={<DicesIcon size={15} color={Colors.amber} />}
              text="Kostky"
              by="Honza"
              at="22:12"
            />
            <LogRow
              icon={<CameraIcon size={15} color={Colors.amber} />}
              text="Fotka"
              by="Klára"
              at="21:58"
            />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.frame} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.card}>
        <Text style={styles.boardTitle} maxFontSizeMultiplier={FontScaleCap.body}>
          Tenhle měsíc
        </Text>
        <Leaderboard
          rows={[
            { id: '1', name: 'Honza', score: 24, tint: '#7DD66B' },
            { id: '2', name: 'Ty', score: 21, tint: Colors.amber, me: true },
            { id: '3', name: 'Klára', score: 17, tint: '#A8896A' },
          ]}
          unit="piv"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignSelf: 'stretch', paddingHorizontal: Spacing.xs },
  card: {
    padding: Spacing.md,
    borderRadius: MockLayout.cardRadius,
    backgroundColor: MockColors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.1),
    gap: Spacing.md,
  },

  thread: { gap: Spacing.xs },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  logGlyph: {
    width: 30,
    height: 30,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  logText: { flex: 1 },
  logTitle: { fontSize: 14, fontWeight: '700', color: Colors.foam },
  logMeta: { fontSize: 12, fontWeight: '500', color: Colors.mutedText, marginTop: 1 },

  boardTitle: {
    fontFamily: Fonts.numeral,
    fontSize: 12,
    letterSpacing: 0.6,
    color: Colors.mutedText,
    textTransform: 'uppercase',
  },
});
