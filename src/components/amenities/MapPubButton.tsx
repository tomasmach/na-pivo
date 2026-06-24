/**
 * The "Zmapuj hospodu" entry trigger (spec §3.6). A single pill, styled like a
 * GlowButton secondary (no glow), that opens the MapPubSheet for one pub. Three
 * states driven by the pub's mapping completeness:
 *   - not mapped  → "Zmapuj hospodu", MapPinned glyph, no dot.
 *   - partial     → "Doplň mapu hospody · {pct} %", amber suffix + a 6×6 dot.
 *   - fully mapped → "Hospoda je zmapovaná", BadgeCheck glyph (success), no dot.
 *
 * Extracted as its own component (the locked decision) so a future second host
 * (compass / discovery pub rows) is a one-line mount and the partial-% logic
 * never drifts. The sheet itself is rendered by the host (so a list of buttons
 * doesn't each mount a Modal); this component is purely the trigger + its label.
 *
 * Completeness is the COMMUNITY meter (the number the future map cares about),
 * read from the short-TTL amenities snapshot, with the user's own answered count
 * as the offline fallback so the dot/% never sits blank before a fetch.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, HitArea } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import { MapPinnedIcon, BadgeCheckIcon } from '@/components/shared/IconGlyph';
import { usePubAmenitiesStore, selectPubVotes } from '@/stores/pubAmenitiesStore';
import {
  buildAmenityRows,
  selectCompleteness,
  selectPersonalProgress,
  selectPubInfoCompleteness,
} from '@/data/pubAmenitiesView';
import { readPubAmenitiesSnapshot } from '@/data/pubAmenitiesSnapshot';
import type { WireAmenityAggregate } from '@/data/pubAmenitiesClient';
import { pubIdentityKey } from '@/data/pubIdentity';
import { usePubInfoFacts, type PubInfoContext } from '@/components/amenities/pubInfoContext';

interface MapPubButtonProps {
  pubKey: string;
  pubName: string;
  onPress: () => void;
  /** When set, the % spans all three groups (otevíračka + piva + vybavení). */
  info?: PubInfoContext;
}

export function MapPubButton({ pubKey, pubName, onPress, info }: MapPubButtonProps) {
  const identityKey = useMemo(() => pubIdentityKey(pubKey, pubName), [pubKey, pubName]);
  const myVotes = usePubAmenitiesStore(selectPubVotes(identityKey));
  const [aggregates, setAggregates] = useState<WireAmenityAggregate[] | undefined>(undefined);
  const [loadedIdentityKey, setLoadedIdentityKey] = useState(identityKey);
  if (identityKey !== loadedIdentityKey) {
    setLoadedIdentityKey(identityKey);
    setAggregates(undefined);
  }

  // Read the cached community aggregate for the label %; the snapshot is the same
  // cheap source the sheet uses, so opening the sheet won't disagree.
  useEffect(() => {
    let cancelled = false;
    void readPubAmenitiesSnapshot(identityKey).then((cached) => {
      if (!cancelled && cached) setAggregates(cached.amenities);
    });
    return () => {
      cancelled = true;
    };
  }, [identityKey]);

  const facts = usePubInfoFacts(info);
  const rows = useMemo(() => buildAmenityRows({ aggregates, myVotes }), [aggregates, myVotes]);
  const community = useMemo(() => selectCompleteness(rows), [rows]);
  const personal = useMemo(() => selectPersonalProgress(rows), [rows]);

  // With a pub-info context the headline % spans all three groups; hours/beers
  // are known locally so they fold in immediately. Without it (legacy amenities-
  // only mounts) keep the community meter with the personal-answered fallback.
  const fraction = facts
    ? selectPubInfoCompleteness(rows, facts).pct
    : community.mappedCount > 0
      ? community.pct
      : personal.total > 0
        ? personal.answered / personal.total
        : 0;
  const pct = Math.round(fraction * 100);

  const isDone = pct >= 100;
  const isPartial = !isDone && pct > 0;

  const label = isDone
    ? cs.mapPub.triggerDone
    : isPartial
      ? cs.mapPub.triggerPartial
      : cs.mapPub.triggerDefault;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={cs.mapPub.triggerA11y(pubName, pct)}
      accessibilityHint={cs.mapPub.entryA11yPublic}
    >
      {isDone ? (
        <BadgeCheckIcon size={16} color={Colors.success} />
      ) : (
        <MapPinnedIcon size={16} color={Colors.amber} />
      )}
      <Text style={styles.label} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
        {label}
        {isPartial && <Text style={styles.suffix}>{cs.mapPub.triggerPartialSuffix(pct)}</Text>}
      </Text>
      {isPartial && <View style={styles.dot} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: HitArea.min,
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pressed: {
    opacity: 0.85,
  },
  label: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.foamMuted,
  },
  suffix: {
    fontFamily: Fonts.ui.bold,
    color: Colors.amber,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.amber,
  },
});
