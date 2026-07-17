/**
 * "Zmapuj hospodu" — the community pub-amenities bottom sheet (spec §3).
 *
 * Uses the same scaffold as PubFilterSheet: a transparent fade Modal with
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
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing, HitArea } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { cs, formatVolume } from '@/i18n/cs';
import {
  XIcon,
  CompassIcon,
  SproutIcon,
  ClockIcon,
  BeerIcon,
  Trash2Icon,
  ChevronRightIcon,
  PencilIcon,
} from '@/components/shared/IconGlyph';
import { CompletenessRing } from '@/components/amenities/CompletenessRing';
import { Toast } from '@/components/shared/Toast';
import { renderAmenityIcon } from '@/components/amenities/amenityIcons';
import {
  AMENITY_DISPLAY_SECTIONS,
  sectionForGroup,
  type AmenitySection,
  type AmenityKey,
} from '@/data/amenities';
import {
  buildAmenityRows,
  selectCompleteness,
  selectPersonalProgress,
  selectPubInfoCompleteness,
  type AmenityRow,
} from '@/data/pubAmenitiesView';
import { usePubInfoFacts, type PubInfoContext } from '@/components/amenities/pubInfoContext';
import { parseOsmOpeningHoursToWeeklyHours } from '@/data/communityHours';
import { renameLocalPub, clearPubsSnapshot, type Pub } from '@/data/pubs';
import { buildPubNameCorrectionEntry } from '@/data/pubNameCorrectionsClient';
import { enqueuePubNameCorrection } from '@/data/pubNameCorrectionsQueue';
import type { PubReportReason } from '@/data/pubReportsClient';
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
import { usePubStore } from '@/stores/pubStore';
import { useAccountStore } from '@/stores/accountStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { fireLightImpactHaptic } from '@/utils/haptics';
import { useReduceMotion } from '@/utils/useReduceMotion';
import { FALLBACK_XP_RULES } from '@/data/mapperXp';
import { pubIdentityKey } from '@/data/pubIdentity';
import { formatPrice, type PriceCurrency } from '@/utils/currency';
import { isPriceApproximate, isPriceFresh, priceAgeLabel } from '@/utils/priceAge';

const SECTION_LABEL: Record<AmenitySection, string> = {
  seating: cs.mapPub.sectionSeating,
  fun: cs.mapPub.sectionFun,
  practical: cs.mapPub.sectionPractical,
};

/** How long after the last tap the coalesced XP summary toast fires (spec §3.5). */
const XP_COALESCE_MS = 600;

interface MapPubSheetProps {
  visible: boolean;
  pubKey: string;
  pubName: string;
  onClose: () => void;
  /** When set, the sheet also shows the otevíračka + piva fact rows and the ring
   *  spans all three info groups. Without it the sheet is amenities-only. */
  info?: PubInfoContext;
  /** Fired after a successful rename so the host can update its own Pub state
   *  (the sheet's optimistic override dies with the sheet). */
  onRenamed?: (newName: string) => void;
  /** When set, the sheet also offers the compass report actions ("Už nefunguje" /
   *  "Nečepují pivo"); the host owns hiding the pub + queueing the report. */
  onReport?: (reason: PubReportReason) => void;
}

function haptic() {
  if (useSettingsStore.getState().hapticEnabled) fireLightImpactHaptic();
}

function formatReferencePrice(
  price: NonNullable<PubInfoContext['price']>,
  currency: PriceCurrency,
): string | null {
  if (!isPriceFresh(price.observedAt)) return null;
  const amount = formatPrice(price.czk, currency);
  const approximateAmount = isPriceApproximate(price.observedAt)
    ? cs.compass.priceApprox(amount)
    : amount;
  const volume =
    price.volumeMl != null && price.volumeMl !== 500
      ? ` / ${formatVolume(price.volumeMl)}`
      : '';
  const age = priceAgeLabel(price.observedAt);
  return age ? `${approximateAmount}${volume} · ${age}` : null;
}

export function MapPubSheet({
  visible,
  pubKey,
  pubName,
  onClose,
  info,
  onRenamed,
  onReport,
}: MapPubSheetProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const router = useRouter();
  const facts = usePubInfoFacts(info);
  const priceCurrency = useSettingsStore((s) => s.priceCurrency);
  const referencePrice = info?.price
    ? formatReferencePrice(info.price, priceCurrency)
    : null;

  // The sheet is an RN Modal (a native window above everything), so opening the
  // contribute editor needs it to step aside — otherwise it would cover the
  // editor. Tie its visibility to screen focus instead of hard-closing it:
  // pushing /contribute blurs this screen → the Modal hides → the editor shows;
  // popping back refocuses → the Modal returns. The host's `visible` flag never
  // changes, so the user lands back ON the hub (not the bare tab) after editing.
  const [screenFocused, setScreenFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => setScreenFocused(false);
    }, []),
  );
  const showSheet = visible && screenFocused;

  // The user's own votes — reactive; buildAmenityRows merges these over the
  // cached aggregate so the pill state always reflects the freshest local tap.
  const identityKey = useMemo(() => pubIdentityKey(pubKey, pubName), [pubKey, pubName]);
  const myVotes = usePubAmenitiesStore(selectPubVotes(identityKey));
  const setVote = usePubAmenitiesStore((s) => s.setVote);
  const showToast = useToastStore((s) => s.show);
  const applyMapperSnapshot = useAccountStore((s) => s.applyMapperSnapshot);

  // The cached + refreshed public aggregate. `undefined` until resolved so rows
  // render the "loading" signal rather than a fabricated "0× ano".
  const [aggregates, setAggregates] = useState<WireAmenityAggregate[] | undefined>(undefined);
  const [serverCompleteness, setServerCompleteness] = useState<WireAmenityCompleteness | null>(null);

  // Local name override so a rename reflects in the sheet instantly (the parent
  // still passes the old pubName until its own detection catches up).
  const [renamedName, setRenamedName] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const bodyRef = useRef<ScrollView>(null);

  // Reset to "loading" during render when the pub changes, so a previous pub's
  // data never bleeds into a new open (the React-recommended alternative to a
  // setState-in-effect; mirrors PubRatingControl's draft reset).
  const [loadedPubKey, setLoadedPubKey] = useState(identityKey);
  if (identityKey !== loadedPubKey) {
    setLoadedPubKey(identityKey);
    setAggregates(undefined);
    setServerCompleteness(null);
    setRenamedName(null);
  }

  const displayName = renamedName ?? pubName;

  // The Modal keeps this component mounted between openings, which also keeps
  // the native ScrollView's last offset. A previously scrolled detail could
  // therefore reopen beyond its content and show only the brown card surface.
  // Always start a newly shown pub detail at its first row. The body itself has
  // no editable fields, so it intentionally stays independent of keyboard
  // insets; the rename editor handles the keyboard in its own overlay below.
  useEffect(() => {
    if (!showSheet) return;
    const frame = requestAnimationFrame(() => {
      bodyRef.current?.scrollTo({ y: 0, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [showSheet, identityKey]);

  // A configured backend endpoint = the votes endpoint resolves to a URL. The
  // submit itself still degrades gracefully (returns 'retry' when truly offline /
  // dormant), so this only decides whether to bother attempting the live XP read.
  const backendConfigured = getBackendEndpoint('/v1/pub-amenities/votes') != null;

  // ── Aggregate load: instant from the short-TTL snapshot, then refresh. ──
  useEffect(() => {
    if (!visible || !pubKey) return;
    let cancelled = false;
    const controller = new AbortController();

    void readPubAmenitiesSnapshot(identityKey).then((cached) => {
      if (cancelled || !cached) return;
      setAggregates(cached.amenities);
      setServerCompleteness(cached.completeness);
    });

    void fetchPubAmenities([pubKey], controller.signal, pubName).then((pubs) => {
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
      void writePubAmenitiesSnapshot(identityKey, {
        amenities: pub.amenities,
        completeness: pub.completeness,
        mapperCount: pub.mapper_count,
      });
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [visible, pubKey, pubName, identityKey]);

  const rows = useMemo(() => buildAmenityRows({ aggregates, myVotes }), [aggregates, myVotes]);
  const completeness = useMemo(() => {
    const snap = serverCompleteness
      ? {
          mappedCount: serverCompleteness.mapped_count,
          totalKinds: serverCompleteness.total_kinds,
          pct: serverCompleteness.pct,
        }
      : null;
    // With a pub-info context the ring spans all three groups (otevíračka + piva
    // + vybavení); otherwise it is the amenities-only community meter.
    return facts
      ? selectPubInfoCompleteness(rows, facts, snap)
      : selectCompleteness(rows, snap);
  }, [rows, serverCompleteness, facts]);
  const personal = useMemo(() => selectPersonalProgress(rows), [rows]);

  const aggregatesResolved = aggregates !== undefined;

  // Header progress mirrors the ring so they can never disagree: with a pub-info
  // context it spans all three groups (otevíračka + piva + vybavení), so it can't
  // claim "máš to celé" while hours are still missing. Without it, it's the
  // amenities-only personal progress.
  const headerProgress = facts
    ? { answered: completeness.mappedCount, total: completeness.totalKinds }
    : { answered: personal.answered, total: personal.total };

  const subtitle =
    headerProgress.answered === 0
      ? cs.mapPub.subtitleEmpty
      : headerProgress.answered >= headerProgress.total
        ? cs.mapPub.subtitleDone
        : cs.mapPub.subtitleSome;

  // ── XP coalescing (spec §3.5) ──
  const xpAccum = useRef({ count: 0, xp: 0 });
  const xpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setVote(identityKey, row.amenityKey as AmenityKey, next);

      // Retraction never touches XP/counters (lifetime-achievement model), but a
      // silent removal feels like a bug — confirm the vote left the public map.
      if (next == null && !wasUnanswered) {
        showToast(cs.mapPub.retracted, {
          icon: <XIcon size={18} color={Colors.mutedText} />,
        });
      }

      // A local best-effort XP estimate for a newly-set vote, used only when no
      // backend is configured. If the online PUT merely retries, stay silent:
      // a retract→revote can legitimately be worth 0 XP server-side, and showing
      // a local estimate there creates a fake +XP toast.
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
          return;
        }
        const result = res.body.results[0];
        if (result) {
          // Refresh the row's aggregate from the recomputed server truth.
          const aggregate = result.aggregate;
          if (aggregate) {
            setAggregates((prev) => mergeAggregate(prev, aggregate));
          }
          consumeVoteEnvelope(result.xp_awarded, result.was_first_map);
        }
        // Feed the mapping component into the one combined account level.
        const snap = res.body.mapper;
        if (snap) {
          applyMapperSnapshot({
            xp: snap.xp,
            level: snap.level,
            title: snap.title,
            xpIntoLevel: snap.xp_into_level,
            xpForNextLevel: snap.xp_for_next_level,
            distinctMappedPubs: snap.distinct_mapped_pubs,
            amenityVotesCount: snap.amenity_votes_count,
            firstMapperCount: snap.first_mapper_count,
            completedPubsCount: snap.completed_pubs_count,
          });
        }
      });
    },
    [
      backendConfigured,
      identityKey,
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

  // ── Shared sheet slide-up animation. ──
  const progress = useSharedValue(0);
  useEffect(() => {
    if (showSheet) {
      progress.value = 0;
      progress.value = reduceMotion
        ? withTiming(1, { duration: 0 })
        : withSpring(1, { damping: 18, stiffness: 180, mass: 0.9 });
    } else {
      progress.value = withTiming(0, { duration: reduceMotion ? 0 : 140 });
    }
  }, [showSheet, reduceMotion, progress]);

  const cardAnim = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 48 }],
  }));

  // Group rows by section for rendering, preserving catalogue order.
  const grouped = useMemo(() => groupRows(rows), [rows]);

  // ── Otevíračka / piva: deep-link into the contribute editor ──
  // Don't close the sheet — focus-gated visibility (showSheet) hides the Modal
  // while the editor is up and restores it on return, so the user comes back to
  // the hub. Route with the current data pre-filled + a `focus` so the editor
  // lands on the tapped section.
  const openContribute = useCallback(
    (focus: 'hours' | 'beers') => {
      if (!info) return;
      const prefillHours = info.prefillHours ?? parseOsmOpeningHoursToWeeklyHours(info.openingHours);
      router.push({
        pathname: '/contribute',
        params: {
          focus,
          ...(info.externalId ? { id: info.externalId } : {}),
          name: info.name,
          lat: String(info.lat),
          lng: String(info.lng),
          ...(info.city ? { city: info.city } : {}),
          ...(prefillHours ? { hours: JSON.stringify(prefillHours) } : {}),
          ...(info.prefillBeers && info.prefillBeers.length > 0
            ? { beers: JSON.stringify(info.prefillBeers) }
            : {}),
          ...(info.historicalBeers && info.historicalBeers.length > 0
            ? { historicalBeers: JSON.stringify(info.historicalBeers) }
            : {}),
        },
      });
    },
    [info, router],
  );

  // ── Rename: local in-memory rename + queued public correction ──
  // Mirrors the compass ReportPubModal rename flow (renameLocalPub +
  // enqueuePubNameCorrection); this is the counter's discoverable entry point
  // for fixing a manually-added pub's name (PIV-27).
  const handleRenamePress = useCallback(() => {
    if (!info) return;
    setRenameDraft(displayName);
    setRenameOpen(true);
  }, [info, displayName, setRenameDraft, setRenameOpen]);

  const handleRenameCancel = useCallback(() => {
    if (renameSubmitting) return;
    setRenameOpen(false);
  }, [renameSubmitting]);

  const handleRenameSubmit = useCallback(() => {
    if (!info || renameSubmitting) return;
    const trimmed = renameDraft.trim().slice(0, 200);
    if (!trimmed || trimmed === displayName.trim()) return;

    setRenameSubmitting(true);
    // A pub with a known external id renames locally too (in-memory index +
    // snapshot clear, so the new name survives a reload); otherwise only the
    // public correction queues. The catalog bump makes index readers (compass
    // selection, beer map) re-read the renamed entry — the same propagation the
    // compass rename flow uses.
    if (info.externalId) {
      renameLocalPub(info.externalId, trimmed);
      usePubStore.getState().bumpCatalogRevision();
    }
    void clearPubsSnapshot();
    setRenamedName(trimmed);
    onRenamed?.(trimmed);

    const pubForCorrection: Pub = {
      id: info.externalId ?? '',
      name: displayName,
      lat: info.lat,
      lng: info.lng,
      ...(info.city ? { city: info.city } : {}),
    };
    const entry = buildPubNameCorrectionEntry(pubForCorrection, trimmed);
    enqueuePubNameCorrection(entry)
      .then((synced) => {
        setRenameOpen(false);
        showToast(synced ? cs.compass.renameSavedToast : cs.compass.renameQueuedToast);
      })
      .finally(() => setRenameSubmitting(false));
  }, [info, renameSubmitting, renameDraft, displayName, showToast, onRenamed]);

  const renameTrimmed = renameDraft.trim();
  const canRename = renameTrimmed.length > 0 && renameTrimmed !== displayName.trim() && !renameSubmitting;

  return (
    <Modal
      visible={showSheet}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={renameOpen ? handleRenameCancel : onClose}
    >
      <View style={styles.backdrop}>
        {/* Backdrop sits BEHIND the card as an absolute-fill sibling, so tapping
            outside dismisses while taps on the card are absorbed by its own views.
            The card must NOT be wrapped in a Pressable — a Pressable ancestor would
            steal the vertical pan gesture and the amenity ScrollView could not scroll. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={cs.mapPub.closeA11y}
        />
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
                  {displayName}
                </Text>
                <Text style={styles.subtitle} maxFontSizeMultiplier={FontScaleCap.body}>
                  {subtitle}
                </Text>
                <Text style={styles.personal} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.mapPub.personal(headerProgress.answered, headerProgress.total)}
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
              ref={bodyRef}
              style={styles.body}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
              overScrollMode="never"
              automaticallyAdjustContentInsets={false}
              contentInsetAdjustmentBehavior="never"
            >
              {facts && (
                <View>
                  <Text style={styles.sectionLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.mapPub.infoSection}
                  </Text>
                  <InfoFactRow
                    icon={<ClockIcon size={24} color={facts.hasHours ? Colors.amber : Colors.mutedText} />}
                    label={cs.mapPub.factHoursLabel}
                    value={facts.hasHours ? cs.mapPub.factHoursFilled : cs.mapPub.factHoursMissing}
                    filled={facts.hasHours}
                    onPress={() => openContribute('hours')}
                  />
                  <InfoFactRow
                    icon={<BeerIcon size={24} color={facts.hasBeers ? Colors.amber : Colors.mutedText} />}
                    label={cs.mapPub.factBeersLabel}
                    value={
                      referencePrice
                        ? facts.beerCount > 0
                          ? cs.mapPub.factBeersWithPrice(facts.beerCount, referencePrice)
                          : cs.mapPub.factReferencePrice(referencePrice)
                        : facts.hasBeers
                          ? cs.mapPub.factBeersCount(facts.beerCount)
                          : cs.mapPub.factBeersMissing
                    }
                    filled={facts.hasBeers}
                    onPress={() => openContribute('beers')}
                  />
                  <InfoFactRow
                    icon={<PencilIcon size={24} color={Colors.mutedText} />}
                    label={cs.mapPub.renameRowLabel}
                    value={cs.mapPub.renameRowHint}
                    filled
                    onPress={handleRenamePress}
                  />
                </View>
              )}

              {grouped.map(({ section, items }) => (
                <View key={section}>
                  <Text style={styles.sectionLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                    {SECTION_LABEL[section]}
                  </Text>
                  {items.map((row) => (
                    <AmenityRowView
                      key={row.amenityKey}
                      row={row}
                      aggregatesResolved={aggregatesResolved}
                      onVote={onVote}
                    />
                  ))}
                </View>
              ))}

              {onReport && (
                <View>
                  <Text style={styles.sectionLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.compass.reportTitle}
                  </Text>
                  <ReportRow
                    icon={<XIcon size={24} color={Colors.mutedText} />}
                    label={cs.compass.reportClosed}
                    onPress={() => onReport('closed')}
                  />
                  <ReportRow
                    icon={<Trash2Icon size={24} color={Colors.amberLight} />}
                    label={cs.compass.reportNotPub}
                    onPress={() => onReport('not_pub')}
                  />
                </View>
              )}

              <Text style={styles.footerHint} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.mapPub.footerHint}
              </Text>
            </ScrollView>
          </Animated.View>

        {/* Rename editor as an in-modal overlay, NOT a second sibling <Modal>:
            iOS can only present one modal view controller at a time, so a second
            Modal opened while this one is up never appears (the tap on "Název
            hospody" looked like a no-op). */}
        {renameOpen && (
          <KeyboardAvoidingView
            behavior="padding"
            style={styles.renameOverlay}
          >
            <Pressable style={styles.renameScrim} onPress={handleRenameCancel} />
            <View style={styles.renamePanel}>
              <View style={styles.renameIconWell}>
                <PencilIcon size={19} color={Colors.amber} />
              </View>
              <Text style={styles.renameTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                {cs.compass.renameTitle}
              </Text>
              <Text style={styles.renameBody} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.compass.renameBody(displayName)}
              </Text>
              <TextInput
                value={renameDraft}
                onChangeText={setRenameDraft}
                style={styles.renameInput}
                placeholder={cs.compass.renamePlaceholder}
                placeholderTextColor={Colors.mutedText}
                maxLength={200}
                autoFocus
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (canRename) handleRenameSubmit();
                }}
              />
              <View style={styles.renameActions}>
                <Pressable
                  onPress={handleRenameCancel}
                  style={({ pressed }) => [styles.renameSecondaryButton, pressed && { opacity: 0.72 }]}
                  accessibilityRole="button"
                  accessibilityLabel={cs.common.cancel}
                >
                  <Text style={styles.renameSecondaryText} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.common.cancel}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleRenameSubmit}
                  disabled={!canRename}
                  style={({ pressed }) => [
                    styles.renamePrimaryButton,
                    !canRename && styles.renamePrimaryDisabled,
                    pressed && canRename && { opacity: 0.86, transform: [{ scale: 0.98 }] },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={cs.compass.renameSave}
                >
                  <Text style={styles.renamePrimaryText} maxFontSizeMultiplier={FontScaleCap.body}>
                    {renameSubmitting ? cs.compass.renameSaving : cs.compass.renameSave}
                  </Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
            )}

        {/* Toast host INSIDE the modal. The root <Toast> in _layout sits below
            this Modal's native window on iOS, so XP/level-up toasts fired from
            the sheet would surface behind it; this in-sheet instance reads the
            same store and renders above the card (box-none, so it never blocks
            taps). The root instance keeps serving every other screen. */}
        <Toast />
      </View>
    </Modal>
  );
}

// ─── Amenity row ─────────────────────────────────────────────────────────────

interface AmenityRowViewProps {
  row: AmenityRow;
  aggregatesResolved: boolean;
  onVote: (row: AmenityRow, half: AmenityVote) => void;
}

const AmenityRowView = React.memo(function AmenityRowView({
  row,
  aggregatesResolved,
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
      <SegmentedVote row={row} onVote={onVote} isYes={isYes} isNo={isNo} />
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
  onVote,
  isYes,
  isNo,
}: {
  row: AmenityRow;
  onVote: (row: AmenityRow, half: AmenityVote) => void;
  isYes: boolean;
  isNo: boolean;
}) {
  return (
    <View style={styles.segment}>
      <VoteHalf
        side="yes"
        active={isYes}
        label={cs.mapPub.yes}
        a11yLabel={cs.mapPub.yesA11y(row.label)}
        onPress={() => onVote(row, 'yes')}
      />
      <VoteHalf
        side="no"
        active={isNo}
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
  label,
  a11yLabel,
  onPress,
}: {
  side: 'yes' | 'no';
  active: boolean;
  label: string;
  a11yLabel: string;
  onPress: () => void;
}) {
  // No scale animation — the control must hold its exact size on tap. The only
  // press feedback is the opacity dip below; the active state flips the amber
  // fill immediately (<100ms).
  const isYes = side === 'yes';
  // Both halves highlight the SAME amber when selected (Ano and Ne alike). Only
  // one can be active at a time; the Ano/Ne label alone keeps them distinct.
  const activeStyle = active ? styles.halfActive : null;
  const textActiveStyle = active ? styles.halfTextActive : null;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={a11yLabel}
      // The retract hint only applies to the currently-selected half — the one
      // tap that actually clears the vote. An unselected half just sets it.
      accessibilityHint={active ? cs.mapPub.clearHint : undefined}
    >
      <View
        style={[
          styles.half,
          // Only the right half carries the single centre divider.
          !isYes && styles.halfRight,
          activeStyle,
        ]}
      >
        <Text
          style={[styles.halfText, textActiveStyle]}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

// ─── Info fact row (otevíračka / piva) ───────────────────────────────────────

/** A navigation row for the two non-amenity info groups. Unlike an amenity row
 *  it has no ANO|NE control — tapping it routes to the contribute editor. */
function InfoFactRow({
  icon,
  label,
  value,
  filled,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  filled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={`${cs.mapPub.factEditA11y(label, filled)}. ${value}`}
    >
      {icon}
      <View style={styles.rowTextWrap}>
        <Text style={styles.rowLabel} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {label}
        </Text>
        <Text
          style={[styles.signal, !filled && styles.signalMuted, filled && styles.signalFilled]}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {value}
        </Text>
      </View>
      <ChevronRightIcon size={20} color={Colors.mutedText} />
    </Pressable>
  );
}

// ─── Report row (map detail only) ────────────────────────────────────────────

/** One report action ("Už nefunguje" / "Nečepují pivo"). A plain action row —
 *  no chevron, it doesn't navigate; the host hides the pub + queues the report. */
function ReportRow({
  icon,
  label,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {icon}
      <View style={styles.rowTextWrap}>
        <Text style={styles.rowLabel} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function groupRows(rows: AmenityRow[]): { section: AmenitySection; items: AmenityRow[] }[] {
  return AMENITY_DISPLAY_SECTIONS.map((section) => ({
    section,
    // rows keep catalogue order, so within "fun" games precede atmosphere.
    items: rows.filter((r) => sectionForGroup(r.group) === section),
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

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: withAlpha(Colors.black, 0.6),
    justifyContent: 'flex-end',
  },
  card: {
    maxHeight: '90%',
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
    flexShrink: 1,
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
  signalFilled: {
    color: Colors.foamMuted,
  },
  // ── Segmented ANO|NE control ──
  // ONE bordered pill with a single inner divider. Two separately-bordered halves
  // butting together rendered a faint glowy seam at the centre (sub-pixel border
  // overlap); a single border + overflow:hidden clips the amber fill to the pill.
  segment: {
    flexDirection: 'row',
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout3,
    overflow: 'hidden',
  },
  half: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 44,
    minHeight: HitArea.min,
    paddingHorizontal: Spacing.sm,
  },
  // The single centre divider lives on the right half's leading edge.
  halfRight: {
    borderLeftWidth: 1,
    borderLeftColor: Colors.border,
  },
  // Either half turns the SAME amber when selected (Ano and Ne alike).
  halfActive: {
    backgroundColor: Colors.amber,
  },
  halfText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 13,
    color: Colors.foamMuted,
  },
  halfTextActive: {
    color: Colors.stout,
  },
  footerHint: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    fontFamily: Fonts.ui.regular,
    fontSize: 12,
    color: Colors.mutedText,
  },

  // ── Rename overlay (mirrors the compass ReportPubModal rename) ──
  renameOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
  },
  renameScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: withAlpha(Colors.black, 0.58),
  },
  renamePanel: {
    marginHorizontal: 14,
    marginBottom: 14,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.32),
    backgroundColor: Colors.stout2,
    padding: 20,
    gap: 14,
  },
  renameIconWell: {
    width: 42,
    height: 42,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.28),
  },
  renameTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    lineHeight: 30,
    color: Colors.foam,
  },
  renameBody: {
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.foamMuted,
  },
  renameInput: {
    minHeight: 54,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.38),
    backgroundColor: Colors.stout3,
    paddingHorizontal: 14,
    fontFamily: Fonts.ui.medium,
    fontSize: 17,
    color: Colors.foam,
  },
  renameActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },
  renameSecondaryButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: withAlpha(Colors.stout, 0.42),
  },
  renameSecondaryText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 15,
    color: Colors.foamMuted,
  },
  renamePrimaryButton: {
    flex: 1.35,
    minHeight: 50,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  renamePrimaryDisabled: {
    opacity: 0.42,
  },
  renamePrimaryText: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 16,
    color: Colors.stout,
  },
});
