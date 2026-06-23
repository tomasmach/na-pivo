/**
 * "Zmapuj hospodu" — the community pub-amenities bottom sheet (spec §3).
 *
 * A near-clone of BeerBrandFilterSheet's scaffold: a transparent fade Modal with
 * a Reanimated spring slide-up over a dimmed scrim, a drag handle, safe-area
 * bottom pad, and reduce-motion gating. On top of that scaffold it renders the
 * amenity taxonomy grouped under the five section labels; each row is an
 * icon + label + the live community signal + a SEGMENTED two-button ANO|NE
 * control (explicit buttons, not a blind 3-state cycle — tapping the active half
 * again retracts the vote).
 *
 * Every tap is its own optimistic commit: setVote writes the store immediately
 * (the pubAmenitiesSync subscriber enqueues + debounce-flushes it for durability,
 * fully offline-safe), and — when a backend is configured — the sheet ALSO PUTs
 * the vote via submitAmenityVotesDetailed to read the authoritative XP envelope
 * for the instant toast and to feed the fresh Mapér snapshot to Profile. The
 * server is idempotent per (account, cache_key, amenity_key), so the queue's
 * later duplicate flush is a 0-XP no-op.
 *
 * The community truth shown is a server-owned aggregate read on open (instant
 * from a short-TTL snapshot, then refreshed in the background); the user's own
 * answer overlays it exactly via buildAmenityRows (no ±1 heuristic). XP is a
 * transient local estimate reconciled from the server.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing, HitArea } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { cs } from '@/i18n/cs';
import {
  XIcon,
  CheckIcon,
  CompassIcon,
  SproutIcon,
} from '@/components/shared/IconGlyph';
import { CompletenessRing } from '@/components/amenities/CompletenessRing';
import { renderAmenityIcon } from '@/components/amenities/amenityIcons';
import {
  AMENITY_SECTIONS,
  type AmenityGroup,
  type AmenityKey,
} from '@/data/amenities';
import {
  buildAmenityRows,
  selectCompleteness,
  selectPersonalProgress,
  type AmenityRow,
} from '@/data/pubAmenitiesView';
import {
  usePubAmenitiesStore,
  selectPubVotes,
  type AmenityVote,
} from '@/stores/pubAmenitiesStore';
import { buildAmenityVoteWire } from '@/data/pubAmenitiesSync';
import {
  submitAmenityVotesDetailed,
  type WireAmenityAggregate,
  type WireAmenityCompleteness,
} from '@/data/pubAmenitiesClient';
import {
  readPubAmenitiesSnapshot,
  writePubAmenitiesSnapshot,
} from '@/data/pubAmenitiesSnapshot';
import { fetchPubAmenities } from '@/data/pubAmenitiesClient';
import { getBackendEndpoint } from '@/data/backendConfig';
import { useToastStore } from '@/stores/toastStore';
import { useAccountStore } from '@/stores/accountStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { fireLightImpactHaptic } from '@/utils/haptics';
import { useReduceMotion } from '@/utils/useReduceMotion';
import { FALLBACK_LEVELS, FALLBACK_XP_RULES, levelForXp } from '@/data/mapperXp';

const SECTION_LABEL: Record<AmenityGroup, string> = {
  payment: cs.mapPub.sectionPayment,
  seating: cs.mapPub.sectionSeating,
  games: cs.mapPub.sectionGames,
  atmosphere: cs.mapPub.sectionAtmosphere,
  practical: cs.mapPub.sectionPractical,
};

/** How long after the last tap the coalesced XP summary toast fires (spec §3.5). */
const XP_COALESCE_MS = 600;

interface MapPubSheetProps {
  visible: boolean;
  pubKey: string;
  pubName: string;
  onClose: () => void;
}

function haptic() {
  if (useSettingsStore.getState().hapticEnabled) fireLightImpactHaptic();
}

export function MapPubSheet({ visible, pubKey, pubName, onClose }: MapPubSheetProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();

  // The user's own votes — reactive; buildAmenityRows merges these over the
  // cached aggregate so the pill state always reflects the freshest local tap.
  const myVotes = usePubAmenitiesStore(selectPubVotes(pubKey));
  const setVote = usePubAmenitiesStore((s) => s.setVote);
  const showToast = useToastStore((s) => s.show);
  const applyMapperSnapshot = useAccountStore((s) => s.applyMapperSnapshot);

  // The cached + refreshed public aggregate. `undefined` until resolved so rows
  // render the "loading" signal rather than a fabricated "0× ano".
  const [aggregates, setAggregates] = useState<WireAmenityAggregate[] | undefined>(undefined);
  const [serverCompleteness, setServerCompleteness] = useState<WireAmenityCompleteness | null>(null);

  // Reset to "loading" during render when the pub changes, so a previous pub's
  // data never bleeds into a new open (the React-recommended alternative to a
  // setState-in-effect; mirrors PubRatingControl's draft reset).
  const [loadedPubKey, setLoadedPubKey] = useState(pubKey);
  if (pubKey !== loadedPubKey) {
    setLoadedPubKey(pubKey);
    setAggregates(undefined);
    setServerCompleteness(null);
  }

  // A configured backend endpoint = the votes endpoint resolves to a URL. The
  // submit itself still degrades gracefully (returns 'retry' when truly offline /
  // dormant), so this only decides whether to bother attempting the live XP read.
  const backendConfigured = getBackendEndpoint('/v1/pub-amenities/votes') != null;

  // ── Aggregate load: instant from the short-TTL snapshot, then refresh. ──
  useEffect(() => {
    if (!visible || !pubKey) return;
    let cancelled = false;
    const controller = new AbortController();

    void readPubAmenitiesSnapshot(pubKey).then((cached) => {
      if (cancelled || !cached) return;
      setAggregates(cached.amenities);
      setServerCompleteness(cached.completeness);
    });

    void fetchPubAmenities([pubKey], controller.signal).then((pubs) => {
      if (cancelled || !pubs) return;
      const pub = pubs.find((p) => p.cache_key === pubKey) ?? pubs[0];
      if (!pub) {
        // A successful fetch that returned nothing for this pub = confirmed
        // empty → an empty array resolves rows to "unmapped" (not "loading").
        setAggregates([]);
        return;
      }
      setAggregates(pub.amenities);
      setServerCompleteness(pub.completeness ?? null);
      void writePubAmenitiesSnapshot(pubKey, {
        amenities: pub.amenities,
        completeness: pub.completeness,
        mapperCount: pub.mapper_count,
      });
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [visible, pubKey]);

  const rows = useMemo(() => buildAmenityRows({ aggregates, myVotes }), [aggregates, myVotes]);
  const completeness = useMemo(
    () =>
      selectCompleteness(
        rows,
        serverCompleteness
          ? {
              mappedCount: serverCompleteness.mapped_count,
              totalKinds: serverCompleteness.total_kinds,
              pct: serverCompleteness.pct,
            }
          : null,
      ),
    [rows, serverCompleteness],
  );
  const personal = useMemo(() => selectPersonalProgress(rows), [rows]);

  const aggregatesResolved = aggregates !== undefined;

  // Header subtitle reflects the user's personal progress (the honest "how am I
  // doing here" line). Done = the user answered every active amenity.
  const subtitle =
    personal.answered === 0
      ? cs.mapPub.subtitleEmpty
      : personal.answered >= personal.total
        ? cs.mapPub.subtitleDone
        : cs.mapPub.subtitleSome;

  // ── XP coalescing (spec §3.5) ──
  const xpAccum = useRef({ count: 0, xp: 0 });
  const xpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLevel = useRef<number | null>(null);

  const flushXpToast = useCallback(() => {
    const { count, xp } = xpAccum.current;
    xpAccum.current = { count: 0, xp: 0 };
    if (count === 0 || xp <= 0) return;
    showToast(cs.mapPub.xpSession(count, xp), {
      icon: <CompassIcon size={18} color={Colors.amber} />,
    });
  }, [showToast]);

  const scheduleXpToast = useCallback(() => {
    if (xpTimer.current) clearTimeout(xpTimer.current);
    xpTimer.current = setTimeout(() => {
      xpTimer.current = null;
      flushXpToast();
    }, XP_COALESCE_MS);
  }, [flushXpToast]);

  // Flush any pending coalesced XP when the sheet closes.
  useEffect(() => {
    if (visible) return;
    if (xpTimer.current) {
      clearTimeout(xpTimer.current);
      xpTimer.current = null;
    }
    flushXpToast();
    lastLevel.current = null;
  }, [visible, flushXpToast]);

  useEffect(
    () => () => {
      if (xpTimer.current) clearTimeout(xpTimer.current);
    },
    [],
  );

  /** Consume one online PUT envelope: fire the strong toasts immediately
   *  (first-mapper, level-up) and coalesce the routine awards. */
  const consumeVoteEnvelope = useCallback(
    (xpAwarded: number, wasFirstMap: boolean) => {
      // First-mapper gets its own stronger toast, not coalesced.
      if (wasFirstMap && xpAwarded > 0) {
        showToast(cs.mapPub.xpFirstMapper(xpAwarded), {
          icon: <SproutIcon size={18} color={Colors.amber} />,
        });
        return;
      }
      if (xpAwarded > 0) {
        xpAccum.current.count += 1;
        xpAccum.current.xp += xpAwarded;
        scheduleXpToast();
      }
    },
    [showToast, scheduleXpToast],
  );

  /** Optimistic local XP estimate (used only when offline / no envelope). */
  const estimateLocalXp = useCallback(
    (row: AmenityRow): number => {
      const rules = useAccountStore.getState().profile?.mapper?.xpRules ?? FALLBACK_XP_RULES;
      // First answer on a fresh (unmapped) amenity pays the most; confirming a
      // known fact pays the small confirm reward. A flip/re-vote/retract → 0.
      if (row.signalState === 'unmapped' || row.signalState === 'loading') return rules.firstFact;
      return rules.confirm;
    },
    [],
  );

  // ── Vote handler ──
  const onVote = useCallback(
    (row: AmenityRow, half: AmenityVote) => {
      haptic();
      // Tapping the already-selected half clears it (retract). Otherwise set/flip.
      const next: AmenityVote | null = row.myValue === half ? null : half;
      const wasUnanswered = row.myValue == null;
      const clientUpdatedAt = new Date().toISOString();

      // Optimistic local commit — the sync subscriber enqueues + flushes this for
      // durability (fully offline-safe).
      setVote(pubKey as string, row.amenityKey as AmenityKey, next);

      // A local best-effort XP estimate for a newly-set vote, used when there is
      // no live envelope (no backend, or offline). The server truth reconciles
      // on Profile later; the estimate is only the transient toast.
      const addLocalEstimate = () => {
        if (next != null && wasUnanswered) {
          xpAccum.current.count += 1;
          xpAccum.current.xp += estimateLocalXp(row);
          scheduleXpToast();
        }
      };

      if (!backendConfigured) {
        addLocalEstimate();
        return;
      }

      // Online: PUT this single vote to read the authoritative XP envelope. The
      // queue's later duplicate flush is a server-idempotent 0-XP no-op.
      const wire = buildAmenityVoteWire({
        pubKey,
        pubName,
        amenityKey: row.amenityKey as AmenityKey,
        value: next,
        clientUpdatedAt,
      });
      void submitAmenityVotesDetailed([wire]).then((res) => {
        if (res.status !== 'ok' || !res.body) {
          // Offline / dormant / rejected: fall back to the local estimate so the
          // user still gets feel-good feedback; the queue retries the durable PUT.
          addLocalEstimate();
          return;
        }
        const result = res.body.results[0];
        if (result) {
          // Refresh the row's aggregate from the recomputed server truth.
          setAggregates((prev) => mergeAggregate(prev, result.aggregate));
          consumeVoteEnvelope(result.xp_awarded, result.was_first_map);
        }
        // Feed the fresh Mapér snapshot to Profile + name an optimistic level-up.
        const snap = res.body.mapper;
        if (snap) {
          applyMapperSnapshot({
            xp: snap.xp,
            level: snap.level,
            title: snap.title,
            xpIntoLevel: snap.xp_into_level,
            xpForNextLevel: snap.xp_for_next_level,
          });
          maybeLevelUpToast(snap.level, snap.title, lastLevel, showToast);
        }
      });
    },
    [
      backendConfigured,
      pubKey,
      pubName,
      setVote,
      estimateLocalXp,
      scheduleXpToast,
      consumeVoteEnvelope,
      applyMapperSnapshot,
      showToast,
    ],
  );

  // ── Sheet slide-up animation (clone of BeerBrandFilterSheet). ──
  const progress = useSharedValue(0);
  useEffect(() => {
    if (visible) {
      progress.value = 0;
      progress.value = reduceMotion
        ? withTiming(1, { duration: 0 })
        : withSpring(1, { damping: 18, stiffness: 180, mass: 0.9 });
    } else {
      progress.value = withTiming(0, { duration: reduceMotion ? 0 : 140 });
    }
  }, [visible, reduceMotion, progress]);

  const cardAnim = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 48 }],
  }));

  // Group rows by section for rendering, preserving catalogue order.
  const grouped = useMemo(() => groupRows(rows), [rows]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button">
        {/* Stop backdrop dismissal when tapping inside the card. */}
        <Pressable onPress={() => undefined} style={styles.cardPress}>
          <Animated.View
            style={[
              styles.card,
              softDrop(),
              { paddingBottom: Math.max(insets.bottom, Spacing.md) },
              cardAnim,
            ]}
          >
            <View style={styles.handle} />

            {/* Header: title block + completeness ring + absolute close. */}
            <View style={styles.headerRow}>
              <View style={styles.titleWrap}>
                <Text
                  style={styles.title}
                  numberOfLines={2}
                  maxFontSizeMultiplier={FontScaleCap.heading}
                >
                  {pubName}
                </Text>
                <Text style={styles.subtitle} maxFontSizeMultiplier={FontScaleCap.body}>
                  {subtitle}
                </Text>
                <Text style={styles.personal} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.mapPub.personal(personal.answered, personal.total)}
                </Text>
              </View>
              <CompletenessRing pct={completeness.pct} reduceMotion={reduceMotion} />
            </View>

            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel={cs.mapPub.closeA11y}
            >
              <XIcon size={18} color={Colors.foamMuted} />
            </Pressable>

            {/* Public-data note — makes the public/community nature explicit. */}
            <Text style={styles.publicNote} maxFontSizeMultiplier={FontScaleCap.body}>
              {!backendConfigured ? cs.mapPub.offline : cs.mapPub.publicNote}
            </Text>

            <ScrollView
              style={styles.body}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {grouped.map(({ group, items }) => (
                <View key={group}>
                  <Text style={styles.sectionLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                    {SECTION_LABEL[group]}
                  </Text>
                  {items.map((row) => (
                    <AmenityRowView
                      key={row.amenityKey}
                      row={row}
                      aggregatesResolved={aggregatesResolved}
                      reduceMotion={reduceMotion}
                      onVote={onVote}
                    />
                  ))}
                </View>
              ))}

              <Text style={styles.footerHint} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.mapPub.footerHint}
              </Text>
            </ScrollView>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Amenity row ─────────────────────────────────────────────────────────────

interface AmenityRowViewProps {
  row: AmenityRow;
  aggregatesResolved: boolean;
  reduceMotion: boolean;
  onVote: (row: AmenityRow, half: AmenityVote) => void;
}

const AmenityRowView = React.memo(function AmenityRowView({
  row,
  aggregatesResolved,
  reduceMotion,
  onVote,
}: AmenityRowViewProps) {
  const isYes = row.myValue === 'yes';
  const isNo = row.myValue === 'no';
  // The leading icon turns amber once the user voted ano; muted otherwise.
  const iconColor = isYes ? Colors.amber : Colors.mutedText;

  return (
    <View style={styles.row}>
      {renderAmenityIcon(row.icon, { size: 24, color: iconColor })}
      <View style={styles.rowTextWrap}>
        <Text style={styles.rowLabel} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {row.label}
        </Text>
        <CommunitySignal row={row} aggregatesResolved={aggregatesResolved} />
      </View>
      <SegmentedVote row={row} reduceMotion={reduceMotion} onVote={onVote} isYes={isYes} isNo={isNo} />
    </View>
  );
});

/** The live community signal: loading (no badge) / known counts / unmapped /
 *  first-mapper / disputed (spec §3.3). */
function CommunitySignal({
  row,
  aggregatesResolved,
}: {
  row: AmenityRow;
  aggregatesResolved: boolean;
}) {
  // First-mapper celebration: both counts were zero and the user just voted.
  const isFirstMapper =
    aggregatesResolved && row.yesCount === 0 && row.noCount === 0 && row.myValue != null;

  if (isFirstMapper) {
    return (
      <Text style={[styles.signal, styles.signalFirst]} maxFontSizeMultiplier={FontScaleCap.body}>
        {cs.mapPub.firstMapped}
      </Text>
    );
  }
  if (row.signalState === 'loading') {
    return null;
  }
  if (row.signalState === 'unmapped') {
    return (
      <Text style={[styles.signal, styles.signalMuted]} maxFontSizeMultiplier={FontScaleCap.body}>
        {cs.mapPub.unmapped}
      </Text>
    );
  }
  // known
  const text = row.status === 'disputed' ? cs.mapPub.disputed : cs.mapPub.signal(row.yesCount, row.noCount);
  return (
    <Text style={styles.signal} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
      {text}
    </Text>
  );
}

/** The segmented two-button ANO|NE control. Two independent ≥44pt targets. */
function SegmentedVote({
  row,
  reduceMotion,
  onVote,
  isYes,
  isNo,
}: {
  row: AmenityRow;
  reduceMotion: boolean;
  onVote: (row: AmenityRow, half: AmenityVote) => void;
  isYes: boolean;
  isNo: boolean;
}) {
  return (
    <View style={styles.segment}>
      <VoteHalf
        side="yes"
        active={isYes}
        reduceMotion={reduceMotion}
        label={cs.mapPub.yes}
        a11yLabel={cs.mapPub.yesA11y(row.label)}
        onPress={() => onVote(row, 'yes')}
      />
      <VoteHalf
        side="no"
        active={isNo}
        reduceMotion={reduceMotion}
        label={cs.mapPub.no}
        a11yLabel={cs.mapPub.noA11y(row.label)}
        onPress={() => onVote(row, 'no')}
      />
    </View>
  );
}

function VoteHalf({
  side,
  active,
  reduceMotion,
  label,
  a11yLabel,
  onPress,
}: {
  side: 'yes' | 'no';
  active: boolean;
  reduceMotion: boolean;
  label: string;
  a11yLabel: string;
  onPress: () => void;
}) {
  // Press-pop scale 0.95 → 1.05 → 1.0, gated by reduce-motion. Color flips
  // immediately via the `active` style (<100ms), independent of the scale.
  // Plain handler (not memoized): the immutability rule forbids mutating a shared
  // value inside a hook callback that captured it, so `scale` stays out of every
  // deps list and is driven from here directly (mirrors Toast.tsx).
  const scale = useSharedValue(1);
  const handlePress = () => {
    if (!reduceMotion) {
      scale.value = withSequence(
        withTiming(0.95, { duration: 60 }),
        withSpring(1, { damping: 12, stiffness: 260 }),
      );
    }
    onPress();
  };

  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const isYes = side === 'yes';
  const activeStyle = active ? (isYes ? styles.halfYesActive : styles.halfNoActive) : null;
  const textActiveStyle = active ? (isYes ? styles.halfTextYesActive : styles.halfTextNoActive) : null;
  const iconColor = isYes ? Colors.stout : Colors.foam;

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={a11yLabel}
      // The retract hint only applies to the currently-selected half — the one
      // tap that actually clears the vote. An unselected half just sets it.
      accessibilityHint={active ? cs.mapPub.clearHint : undefined}
    >
      <Animated.View
        style={[
          styles.half,
          isYes ? styles.halfLeft : styles.halfRight,
          activeStyle,
          animStyle,
        ]}
      >
        {active && (isYes ? <CheckIcon size={14} color={iconColor} /> : <XIcon size={14} color={iconColor} />)}
        <Text
          style={[styles.halfText, textActiveStyle]}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function groupRows(rows: AmenityRow[]): { group: AmenityGroup; items: AmenityRow[] }[] {
  return AMENITY_SECTIONS.map((group) => ({
    group,
    items: rows.filter((r) => r.group === group),
  })).filter((g) => g.items.length > 0);
}

/** Replace one amenity's aggregate in the cached array (recomputed by the PUT). */
function mergeAggregate(
  prev: WireAmenityAggregate[] | undefined,
  fresh: WireAmenityAggregate,
): WireAmenityAggregate[] {
  const base = prev ?? [];
  const idx = base.findIndex((a) => a.amenity_key === fresh.amenity_key);
  if (idx === -1) return [...base, fresh];
  const next = base.slice();
  next[idx] = fresh;
  return next;
}

/** Fire a level-up toast once when the server level crosses upward. */
function maybeLevelUpToast(
  level: number,
  title: string,
  lastLevel: React.MutableRefObject<number | null>,
  showToast: (message: string, options?: { icon?: React.ReactNode }) => void,
) {
  const prev = lastLevel.current;
  lastLevel.current = level;
  // Name the level from the server title (or the bundled ladder as a fallback).
  const named = title || levelForXp(0, FALLBACK_LEVELS).title;
  if (prev != null && level > prev) {
    showToast(cs.mapPub.xpLevelUp(named), {
      icon: <SproutIcon size={18} color={Colors.amber} />,
    });
  }
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: withAlpha(Colors.black, 0.6),
    justifyContent: 'flex-end',
  },
  cardPress: {
    width: '100%',
  },
  card: {
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.border,
    marginBottom: Spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingRight: HitArea.min, // leave room for the absolute close button
  },
  titleWrap: {
    flex: 1,
  },
  title: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
  },
  subtitle: {
    marginTop: 2,
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
  },
  personal: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: Colors.mutedText,
  },
  closeBtn: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  publicNote: {
    marginTop: Spacing.sm,
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: withAlpha(Colors.amberLight, 0.85),
  },
  body: {
    maxHeight: 460,
    marginTop: Spacing.xs,
  },
  sectionLabel: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.xs,
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Colors.mutedText,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 56,
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: withAlpha(Colors.border, 0.5),
  },
  rowTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
  },
  signal: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: Colors.mutedText,
  },
  signalMuted: {
    fontStyle: 'italic',
  },
  signalFirst: {
    color: Colors.amberLight,
  },
  // ── Segmented ANO|NE control ──
  // No overflow:'hidden' here — it would crop the press-pop 1.05 overshoot
  // (spec §3.2). The halfLeft/halfRight radii already round the pill ends.
  segment: {
    flexDirection: 'row',
    borderRadius: Radius.pill,
  },
  half: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minWidth: 52,
    minHeight: HitArea.min,
    paddingHorizontal: 12,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  halfLeft: {
    borderTopLeftRadius: Radius.pill,
    borderBottomLeftRadius: Radius.pill,
    borderRightWidth: 0,
  },
  halfRight: {
    borderTopRightRadius: Radius.pill,
    borderBottomRightRadius: Radius.pill,
  },
  halfYesActive: {
    backgroundColor: Colors.amber,
    borderColor: Colors.amber,
  },
  // "Ne" is deliberately calm — a muted fill, never red.
  halfNoActive: {
    backgroundColor: withAlpha(Colors.mutedText, 0.25),
    borderColor: withAlpha(Colors.mutedText, 0.4),
  },
  halfText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 13,
    color: Colors.foamMuted,
  },
  halfTextYesActive: {
    color: Colors.stout,
  },
  halfTextNoActive: {
    color: Colors.foam,
  },
  footerHint: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    fontFamily: Fonts.ui.regular,
    fontSize: 12,
    color: Colors.mutedText,
  },
});
