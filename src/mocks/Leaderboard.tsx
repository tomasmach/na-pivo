/**
 * DESIGN MOCK — the standings, drawn one way everywhere.
 *
 * Komunita had a podium and ranked rows; the party recap had its own flat table
 * of names with bars. Same object, two designs, and the recap's was the weaker
 * one — a list where first place looks like fifth is a table, not a ranking.
 *
 * So this is Komunita's, extracted: a podium for the top three, then rows. Both
 * screens now render the same component, which is the only way the two stay in
 * agreement as either changes.
 *
 * The podium only appears when there ARE three — with two people it is a
 * ceremony for a coin toss.
 */

import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { TrophyIcon } from '@/components/shared/IconGlyph';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

export interface BoardEntry {
  id: string;
  name: string;
  score: number;
  avatar?: string;
  /** Colour seed behind the initial when there is no photo. */
  tint?: string;
  /** Draws this row as yours. */
  me?: boolean;
}

function Avatar({ entry, size }: { entry: BoardEntry; size: number }) {
  const shape = { width: size, height: size, borderRadius: size / 2 };
  if (entry.avatar) {
    return <Image source={{ uri: entry.avatar }} style={shape} />;
  }
  return (
    <View
      style={[
        styles.initials,
        shape,
        {
          backgroundColor: withAlpha(entry.tint ?? Colors.amber, 0.22),
          borderColor: withAlpha(entry.tint ?? Colors.amber, 0.5),
        },
      ]}
    >
      <Text style={[styles.initialsText, { fontSize: size * 0.4 }]} allowFontScaling={false}>
        {entry.name.replace('@', '').slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

/** First place has to look like first place. */
function Podium({ rows, unit }: { rows: BoardEntry[]; unit?: string }) {
  const order = [rows[1], rows[0], rows[2]].filter(Boolean);
  const heights = [64, 84, 56];
  const ranks = [2, 1, 3];

  return (
    <View style={styles.podium}>
      {order.map((row, index) => (
        <View key={row.id} style={styles.podiumCol}>
          <View style={index === 1 ? styles.podiumCrown : undefined}>
            <Avatar entry={row} size={index === 1 ? 62 : 46} />
          </View>
          <Text
            style={[styles.podiumName, index === 1 && styles.podiumNameFirst]}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {row.name}
          </Text>
          <Text style={styles.podiumScore} allowFontScaling={false}>
            {row.score}
            {unit ? <Text style={styles.podiumUnit}> {unit}</Text> : null}
          </Text>
          <View
            style={[
              styles.podiumBlock,
              { height: heights[index] },
              index === 1 && styles.podiumBlockFirst,
            ]}
          >
            <Text style={styles.podiumRank} allowFontScaling={false}>
              {ranks[index]}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export function Leaderboard({
  rows,
  unit,
  /** Marks the top scorer. The recap calls them the MVP of the night. */
  topBadge,
}: {
  rows: BoardEntry[];
  unit?: string;
  topBadge?: string;
}) {
  if (rows.length === 0) return null;

  const podium = rows.length >= 3;
  const rest = podium ? rows.slice(3) : rows;
  const peak = rows.reduce((max, row) => Math.max(max, row.score), 0) || 1;

  return (
    <View>
      {podium ? <Podium rows={rows} unit={unit} /> : null}

      {rest.map((row, index) => (
        <View key={row.id} style={[styles.row, row.me && styles.rowMe]}>
          <Text style={styles.rank} allowFontScaling={false}>
            {(podium ? 4 : 1) + index}
          </Text>
          <Avatar entry={row} size={34} />
          <View style={styles.body}>
            <View style={styles.nameRow}>
              <Text
                style={[styles.name, row.me && styles.nameMe]}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {row.name}
              </Text>
              {topBadge && index === 0 && !podium ? (
                <View style={styles.badge}>
                  <TrophyIcon size={11} color={Colors.amber} />
                  <Text style={styles.badgeText} allowFontScaling={false}>
                    {topBadge}
                  </Text>
                </View>
              ) : null}
            </View>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  {
                    width: `${Math.max(6, Math.round((row.score / peak) * 100))}%`,
                    backgroundColor: row.me ? Colors.amber : withAlpha(Colors.amber, 0.35),
                  },
                ]}
              />
            </View>
          </View>
          <Text style={styles.score} allowFontScaling={false}>
            {row.score}
            {unit ? <Text style={styles.scoreUnit}> {unit}</Text> : null}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  initials: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  initialsText: { fontWeight: '700', color: Colors.foam },

  podium: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    marginBottom: Spacing.md,
  },
  podiumCol: { flex: 1, alignItems: 'center', gap: 3 },
  podiumCrown: { borderWidth: 2, borderColor: Colors.amber, borderRadius: 33, padding: 1 },
  podiumName: { fontSize: 13, fontWeight: '600', color: Colors.mutedText },
  podiumNameFirst: { fontSize: 15, fontWeight: '700', color: Colors.foam },
  podiumScore: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },
  podiumUnit: { fontSize: 11, fontWeight: '600', color: Colors.mutedText },
  podiumBlock: {
    alignSelf: 'stretch',
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    alignItems: 'center',
    paddingTop: 6,
    marginTop: 4,
    backgroundColor: withAlpha(Colors.amber, 0.16),
  },
  podiumBlockFirst: { backgroundColor: withAlpha(Colors.amber, 0.34) },
  podiumRank: { fontSize: 16, fontWeight: '800', color: Colors.foam },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  rowMe: { },
  rank: {
    width: 18,
    fontSize: 13,
    fontWeight: '700',
    color: Colors.mutedText,
    fontVariant: ['tabular-nums'],
  },
  body: { flex: 1, gap: 5 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 15, fontWeight: '600', color: Colors.foam },
  nameMe: { fontWeight: '800' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: withAlpha(Colors.amber, 0.16),
  },
  badgeText: { fontSize: 10, fontWeight: '800', color: Colors.amber },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: withAlpha(Colors.foam, 0.08),
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 3 },
  score: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },
  scoreUnit: { fontSize: 12, fontWeight: '600', color: Colors.mutedText },
});
