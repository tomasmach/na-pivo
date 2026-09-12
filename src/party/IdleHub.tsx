/**
 * What sits UNDER the counter before the first beer.
 *
 * The hub used to open on a headline saying nothing had happened yet and three
 * rows about the table, the games and a code. People came to the tab to count a
 * beer and had to read a page first — the 2.0 complaint in one screen. The pub,
 * the number and the button now live in the hub header and the control row
 * (`LivePartyMockScreen`), exactly where they are once the night runs, and what
 * is left here is what may quietly follow them:
 *
 *   naposledy   the last evening that is not tonight, so the tab has a memory
 *   stůl        one quiet pill to the two table doors, a tap deeper
 *
 * Both are local, so the screen is whole with no signal. The parta's presence
 * ("Kdo už sedí") used to sit between them and is gone from here: three server
 * rows pushed the last night off a 402×874 screen, they arrive late enough to
 * shove the layout when they do, and Kocoviny already lists every one of them.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { ChevronRightIcon } from '@/components/shared/IconGlyph';
import { useNowTick } from '@/friends/useNowTick';
import { t } from '@/i18n';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { SectionBreak } from '@/mocks/SectionBreak';
import { eveningDateLabel, sessionDrinkSummary } from '@/myBeers/eveningModel';
import type { TallySession } from '@/stores/tallyStore';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

export function IdleHub({
  lastSession,
  onOpenTable,
}: {
  lastSession: TallySession | null;
  onOpenTable: () => void;
}) {
  const router = useRouter();
  // Ticks, so a hub left open past the 04:00 cutoff stops saying "Včera".
  const now = useNowTick();
  // "Včera · U Kotvy" — the same day label and drink summary the evening
  // detail opens with, so the row and the screen behind it agree.
  const lastTitle = lastSession
    ? [eveningDateLabel(lastSession.startedAt, new Date(now)), lastSession.pubName]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <View style={styles.root}>
      {lastSession ? (
        <>
          <SectionBreak title={t.liveParty.idleLastTitle} />
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/evening',
                params: { startedAt: lastSession.startedAt },
              } as Href)
            }
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t.liveParty.a11yLastNight(lastTitle)}
          >
            <View style={styles.rowText}>
              <Text
                style={styles.rowTitle}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {lastTitle}
              </Text>
              <Text
                style={styles.rowMeta}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {sessionDrinkSummary(lastSession)}
              </Text>
            </View>
            <ChevronRightIcon size={18} color={Colors.mutedText} />
          </Pressable>
        </>
      ) : null}

      {/* The table, as one quiet pill (§6.2) rather than two amber words under
          the number: amber is the button's, and two accented links beside it
          were three things competing for the same tap. Behind it the two doors
          are a named sheet, one tap deeper (§6.3). */}
      <Pressable
        onPress={onOpenTable}
        style={({ pressed }) => [styles.tableRow, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={t.liveParty.a11yOpenTable}
      >
        <Text style={styles.tableLabel} maxFontSizeMultiplier={FontScaleCap.heading}>
          {t.liveParty.idleTable}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // Air under the last row so it does not sit on the control row.
  root: { paddingBottom: Spacing.lg },
  // The canonical quiet pill (§6.2): stout3, no border, self-sized.
  tableRow: {
    alignSelf: 'flex-start',
    minHeight: HitArea.min,
    justifyContent: 'center',
    marginTop: MockLayout.controlGap,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
  },
  tableLabel: { fontSize: 14, fontWeight: '700', color: Colors.foam },
  // The canonical row (§5.1); 68 because it is a two-line row (§4.1). It is the
  // only one here, so it never draws the hairline a list needs.
  row: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm + 2,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { ...MockType.bodySemibold, color: Colors.foam },
  rowMeta: { ...MockType.bodySmall, color: Colors.mutedText, marginTop: 2 },
  pressed: { opacity: 0.65 },
});
