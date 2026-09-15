import React, { memo } from 'react';
import { ActivityIndicator, View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { cs } from '@/i18n/cs';

/**
 * Status of the opening-hours lookup for a pub.
 * Mirrors the backend `status` values plus a client-only `loading` state.
 *
 * Declared locally so this presentational chip stays self-contained; the data
 * layer declares the same union for `Pub.hoursStatus` and the two are
 * structurally identical.
 */
export type HoursStatus = 'ok' | 'unknown' | 'pending' | 'error' | 'loading';

export interface OpenStatusChipProps {
  /** Whether the pub is open right now. `null` means unknown. */
  isOpenNow: boolean | null;
  /** Lookup status; drives whether the chip renders at all. */
  status?: HoursStatus;
  /**
   * ISO timestamp of the next open/close transition, in Europe/Prague local
   * time (e.g. `2026-06-08T23:00:00+02:00`). When present, the chip surfaces
   * the actual HH:MM so the user can decide whether it's worth the walk.
   */
  nextChange?: string | null;
}

/**
 * Pull the local `HH:MM` straight out of a backend ISO timestamp.
 *
 * The backend already emits `nextChange` in Europe/Prague, so the time portion
 * is exactly the five characters after the `T` — no timezone math and no `Intl`
 * (Hermes' `Intl` timeZone support is unreliable). Anything malformed returns
 * `null` so the caller can fall back to a no-time label.
 */
function localTimeFromIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const tIndex = iso.indexOf('T');
  if (tIndex === -1) return null;
  const hhmm = iso.slice(tIndex + 1, tIndex + 6);
  // Validate the shape `HH:MM` (digits + colon) before trusting it.
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return null;
  return hhmm;
}

/**
 * A small, hours-forward label conveying whether the targeted pub is open —
 * and, when known, the actual time it next opens or closes.
 *
 * - open + nextChange    → "Otevřeno do HH:MM"   (warm amber-foam tone)
 * - open, no nextChange  → "Otevřeno"            (warm)
 * - closed + nextChange  → "Zavřeno · otevře v HH:MM"  (muted, never red)
 * - closed, no nextChange→ "Zavřeno"             (muted)
 * - unknown              → "Otevírací doba neznámá"    (subtle muted)
 *
 * While the lookup is still in flight (`loading`/`pending`) and we don't yet
 * have a usable `isOpenNow` value, the chip shows a compact loading state.
 */
export const OpenStatusChip = memo(function OpenStatusChip({
  isOpenNow,
  status,
  nextChange,
}: OpenStatusChipProps) {
  if ((status === 'loading' || status === 'pending') && isOpenNow == null) {
    return (
      <View
        style={styles.chip}
        accessibilityRole="text"
        accessibilityLabel={cs.compass.detailsLoading}
      >
        <ActivityIndicator size="small" color={Colors.mutedText} />
        <Text
          style={[styles.label, { color: Colors.mutedText }]}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {cs.compass.detailsLoading}
        </Text>
      </View>
    );
  }

  const time = localTimeFromIso(nextChange);

  let textColor: string;
  let label: string;

  if (isOpenNow === true) {
    // Warm, inviting — the pub is open right now.
    textColor = Colors.open;
    label = time ? cs.compass.openUntil(time) : cs.compass.openNow;
  } else if (isOpenNow === false) {
    // Calm and muted — closed, but we show when it opens so it's not a dead end.
    textColor = Colors.closed;
    label = time ? cs.compass.closedUntil(time) : cs.compass.closedNow;
  } else {
    // Hours genuinely unknown — keep it subtle.
    textColor = Colors.mutedText;
    label = cs.compass.hoursUnknown;
  }

  return (
    <View style={styles.chip} accessibilityRole="text" accessibilityLabel={label}>
      <Text
        style={[styles.label, { color: textColor }]}
        numberOfLines={1}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {label}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    // The pub pill centers its children; override so the status reads left,
    // aligned with the pub name and the "Otevřít v mapách" row.
    alignSelf: 'flex-start',
    gap: 6,
  },
  label: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    letterSpacing: 0.2,
  },
});
