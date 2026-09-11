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
 *   table       one line, two words: start one, or sit down at somebody's
 *   naposledy   the last evening, so the tab has a memory
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
import { MockType } from '@/mocks/mockTheme';
import { SectionBreak } from '@/mocks/SectionBreak';
import { eveningDateLabel, sessionDrinkSummary } from '@/myBeers/eveningModel';
import type { TallySession } from '@/stores/tallyStore';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Spacing } from '@/theme/layout';

export function IdleHub({
  lastSession,
  onInvite,
  onJoinByCode,
}: {
  lastSession: TallySession | null;
  onInvite: () => void;
  onJoinByCode: () => void;
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
      {/* Two text links, not two pills: the table is the evening's second
          question and the screen already has its one amber button (§6.3). */}
      <View style={styles.tableRow}>
        <Pressable
          onPress={onInvite}
          style={({ pressed }) => [styles.linkHit, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t.liveParty.a11yInvite}
        >
          <Text style={styles.link} maxFontSizeMultiplier={FontScaleCap.body}>
            {t.liveParty.idleInviteLink}
          </Text>
        </Pressable>
        <Text style={styles.linkDot} maxFontSizeMultiplier={FontScaleCap.body}>
          ·
        </Text>
        <Pressable
          onPress={onJoinByCode}
          style={({ pressed }) => [styles.linkHit, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t.liveParty.a11yJoinWithCode}
        >
          <Text style={styles.link} maxFontSizeMultiplier={FontScaleCap.body}>
            {t.liveParty.joinLink}
          </Text>
        </Pressable>
      </View>

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
    </View>
  );
}

const styles = StyleSheet.create({
  // Air under the last row so it does not sit on the control row.
  root: { paddingBottom: Spacing.lg },
  // Its own block, not a caption to the number above it (§4).
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  linkHit: { minHeight: HitArea.min, justifyContent: 'center' },
  link: { fontSize: 14, fontWeight: '800', color: Colors.amber },
  linkDot: { fontSize: 14, fontWeight: '800', color: Colors.mutedText },
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
