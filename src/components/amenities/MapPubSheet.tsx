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
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing, HitArea } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { cs } from '@/i18n/cs';
import {
  XIcon,
  CompassIcon,
  SproutIcon,
  ClockIcon,
  BeerIcon,
  ChevronRightIcon,
  PencilIcon,
  MapPinIcon,
  GlobeIcon,
  TriangleAlertIcon,
  MenuIcon,
  CheckIcon,
  PlusIcon,
  FlagIcon,
} from '@/components/shared/IconGlyph';
import { CompletenessRing } from '@/components/amenities/CompletenessRing';
import { Toast } from '@/components/shared/Toast';
import { renderAmenityIcon } from '@/components/amenities/amenityIcons';
import { type AmenityKey } from '@/data/amenities';
import {
  buildAmenityRows,
  selectCompleteness,
  selectPubInfoCompleteness,
  type AmenityRow,
} from '@/data/pubAmenitiesView';
import {
  contributeParamsFromPubInfo,
  usePubInfoFacts,
  type PubInfoContext,
} from '@/components/amenities/pubInfoContext';
import {
  parseOsmOpeningHoursToWeeklyHours,
  DAY_KEYS,
  type WeeklyHours,
} from '@/data/communityHours';
import { geohash8 } from '@/data/geohash';
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
import { useCommunityStore } from '@/stores/communityStore';
import { useAccountStore } from '@/stores/accountStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { fireLightImpactHaptic } from '@/utils/haptics';
import { useReduceMotion } from '@/utils/useReduceMotion';
import { FALLBACK_XP_RULES } from '@/data/mapperXp';
import { pubIdentityKey } from '@/data/pubIdentity';
import { formatPrice } from '@/utils/currency';
import { isPriceFresh, priceAgeLabel } from '@/utils/priceAge';
import { PubEventsSection } from '@/pubEvents/PubEventsSection';

/** How long after the last tap the coalesced XP summary toast fires (spec §3.5). */
const XP_COALESCE_MS = 600;

/** Confidence tier (1..3 filled bars) from how many people confirmed the fact. */
function confidenceTier(count: number): number {
  if (count >= 5) return 3;
  if (count >= 2) return 2;
  return 1;
}

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
  /** When set, the sheet also offers the shared pub-report flow. */
  onReport?: (reason: PubReportReason) => void;
  /**
   * What the pub IS, for the header: today's hours and the beer on tap, already
   * formatted by the host (it owns the live open/closed lookup). Optional — a
   * host that has neither gets the bare name, exactly as before.
   */
  hoursLabel?: string | null;
  hoursTone?: 'open' | 'closed' | 'unknown';
  beerLine?: string | null;
}

/** Same tones as the compass card. Never red — a closed pub is not an error. */
function hoursColor(tone: 'open' | 'closed' | 'unknown'): string {
  if (tone === 'open') return Colors.open;
  if (tone === 'closed') return Colors.closed;
  return Colors.mutedText;
}

function haptic() {
  if (useSettingsStore.getState().hapticEnabled) fireLightImpactHaptic();
}

export function MapPubSheet({
  visible,
  pubKey,
  pubName,
  onClose,
  info,
  onRenamed,
  onReport,
  hoursLabel,
  hoursTone = 'unknown',
  beerLine,
}: MapPubSheetProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const router = useRouter();
  const facts = usePubInfoFacts(info);
  const priceCurrency = useSettingsStore((s) => s.priceCurrency);

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
  const aggregatesResolved = aggregates !== undefined;

  // Fact-tile data. The mini-week reads the freshest weekly hours (local override
  // wins, then enrichment, then the OSM fallback); the beers tile shows how fresh
  // the reference price is so a stale number reads as stale.
  const cell = info ? geohash8(info.lat, info.lng) : '';
  const overrideHours = useCommunityStore((s) => (info ? s.overrides[cell]?.hours : undefined));
  const weeklyHours = useMemo<WeeklyHours | null>(() => {
    if (!info) return null;
    return (
      overrideHours ??
      info.prefillHours ??
      parseOsmOpeningHoursToWeeklyHours(info.openingHours) ??
      null
    );
  }, [info, overrideHours]);

  const priceObservedAt =
    info?.price && isPriceFresh(info.price.observedAt) ? info.price.observedAt : null;
  const tilePriceAmount =
    priceObservedAt && info?.price ? formatPrice(info.price.czk, priceCurrency) : null;
  // "naposledy zmapováno" recency for each tile, from the community contribution
  // timestamps. Hours recency needs the additive backend field, so it stays null
  // until that ships; beers recency flows today.
  const hoursMappedAge = info?.hoursUpdatedAt ? priceAgeLabel(info.hoursUpdatedAt) : null;
  const beersMappedAge = info?.beersUpdatedAt ? priceAgeLabel(info.beersUpdatedAt) : null;

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

  // ── Otevíračka / piva: deep-link into the contribute editor ──
  // Don't close the sheet — focus-gated visibility (showSheet) hides the Modal
  // while the editor is up and restores it on return, so the user comes back to
  // the hub. Route with the current data pre-filled + a `focus` so the editor
  // lands on the tapped section.
  const openContribute = useCallback(
    (focus: 'hours' | 'beers') => {
      if (!info) return;
      router.push({
        pathname: '/contribute',
        params: contributeParamsFromPubInfo(info, focus, facts?.beerMenuRotates),
      });
    },
    [facts?.beerMenuRotates, info, router],
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

  const handleEditAddedPub = useCallback(() => {
    if (!info?.userAddedClientId) return;
    router.push({
      pathname: '/add-pub',
      params: {
        clientId: info.userAddedClientId,
        name: displayName,
        city: info.city ?? '',
        address: info.address ?? '',
        lat: String(info.lat),
        lng: String(info.lng),
      },
    });
  }, [displayName, info, router]);

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
                {/* The header answers "what is this pub?", not "fill it in":
                    you open this from two kilometres away, where today's hours
                    and what they pour are the only facts that matter. The
                    mapping pitch moved down to the mapping section. */}
                {hoursLabel ? (
                  <View style={styles.hoursRow}>
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
                {beerLine ? (
                  <Text
                    style={styles.subtitle}
                    numberOfLines={2}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {beerLine}
                  </Text>
                ) : null}
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
              {/* Two editable facts as tiles: state is read from the icon
                  (amber + check when filled, muted + plus when empty) and the
                  mini-week / recency line, not from a sentence. */}
              {facts && (
                <View style={styles.tiles}>
                  <FactTile
                    icon={
                      <ClockIcon
                        size={22}
                        color={facts.hasHours ? Colors.amber : Colors.mutedText}
                      />
                    }
                    label={cs.mapPub.tileHours}
                    filled={facts.hasHours}
                    weekly={weeklyHours}
                    value={null}
                    recency={hoursMappedAge ? cs.mapPub.tileMapped(hoursMappedAge) : null}
                    emptyLabel={cs.mapPub.tileHoursEmpty}
                    onPress={() => openContribute('hours')}
                  />
                  <FactTile
                    icon={
                      <BeerIcon
                        size={22}
                        color={facts.hasBeers ? Colors.amber : Colors.mutedText}
                      />
                    }
                    label={cs.mapPub.tileBeers}
                    filled={facts.hasBeers}
                    weekly={null}
                    value={
                      facts.hasBeers
                        ? facts.beerMenuRotates
                          ? cs.mapPub.factBeersRotating(
                              facts.beerCount > 0
                                ? cs.mapPub.tileBeersValue(facts.beerCount, tilePriceAmount)
                                : null,
                            )
                          : cs.mapPub.tileBeersValue(facts.beerCount, tilePriceAmount)
                        : null
                    }
                    recency={beersMappedAge ? cs.mapPub.tileMapped(beersMappedAge) : null}
                    emptyLabel={cs.mapPub.tileBeersEmpty}
                    onPress={() => openContribute('beers')}
                  />
                </View>
              )}

              <PubEventsSection
                visible={showSheet}
                pubKey={pubKey}
                pubName={displayName}
                info={info}
              />

              {/* Amenities: one flat list under a single header. The four-line
                  mapping intro collapsed into the ring (progress) + one public
                  chip; each row carries its own confidence, not a poll ratio. */}
              <View style={styles.sectionHead}>
                <Text style={styles.sectionLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.mapPub.amenitiesSection}
                </Text>
                <View style={styles.publicPill}>
                  <GlobeIcon size={12} color={Colors.amberLight} />
                  <Text
                    style={styles.publicPillText}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {backendConfigured ? cs.mapPub.publicChip : cs.mapPub.offlineChip}
                  </Text>
                </View>
              </View>

              {rows.map((row) => (
                <AmenityRowView
                  key={row.amenityKey}
                  row={row}
                  aggregatesResolved={aggregatesResolved}
                  onVote={onVote}
                />
              ))}

              {(info || onReport) && (
                <MoreActions
                  showRename={Boolean(info)}
                  showEditAdded={Boolean(info?.userAddedClientId)}
                  showReport={Boolean(onReport)}
                  onRename={handleRenamePress}
                  onEditAdded={handleEditAddedPub}
                  onReport={() => onReport?.('not_pub')}
                />
              )}
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
        <ConfidenceMeter row={row} aggregatesResolved={aggregatesResolved} />
      </View>
      <SegmentedVote row={row} onVote={onVote} isYes={isYes} isNo={isNo} />
    </View>
  );
});

/** Three tiny bars that fill by confidence tier. Amber = the crowd says it's
 *  here; muted-brown = the crowd says it isn't (never red — a missing amenity is
 *  not an error). */
function ConfidenceBars({ tier, tone }: { tier: number; tone: 'has' | 'no' }) {
  const onColor = tone === 'has' ? Colors.amber : Colors.mutedText;
  return (
    <View style={styles.bars}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={[
            styles.bar,
            i === 0 && styles.bar1,
            i === 1 && styles.bar2,
            i === 2 && styles.bar3,
            i < tier && { backgroundColor: onColor },
          ]}
        />
      ))}
    </View>
  );
}

/** The community signal as CONFIDENCE, not a poll. How many people confirmed the
 *  fact drives the bar tier + count; a recent conflict reads "sporné · ověř to";
 *  an unmapped amenity shows nothing (the empty control already says "ask me"). */
function ConfidenceMeter({
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
      <View style={styles.conf}>
        <ConfidenceBars tier={1} tone="has" />
        <Text
          style={[styles.confText, styles.confFirst]}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {cs.mapPub.confFirst}
        </Text>
      </View>
    );
  }

  // Loading or genuinely unmapped: no line at all.
  if (row.signalState !== 'known') return null;

  if (row.status === 'disputed') {
    return (
      <View style={styles.conf}>
        <TriangleAlertIcon size={12} color={Colors.amberLight} />
        <Text
          style={[styles.confText, styles.confDisputed]}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {cs.mapPub.confDisputed}
        </Text>
      </View>
    );
  }

  // "no" wins only when the crowd genuinely leans absent; otherwise show "has".
  const isNo = row.status === 'no' || (row.status === 'unknown' && row.noCount > row.yesCount);
  const count = isNo ? row.noCount : row.yesCount;
  return (
    <View style={styles.conf}>
      <ConfidenceBars tier={confidenceTier(count)} tone={isNo ? 'no' : 'has'} />
      <Text style={styles.confText} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
        {isNo ? cs.mapPub.confNo(count) : cs.mapPub.confHas(count)}
      </Text>
    </View>
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

// ─── Fact tiles (otevíračka / piva) ──────────────────────────────────────────

/** Seven bars for the week; the open days light amber, closed days stay muted.
 *  A glance says "how much of the week is filled" without reading any hours. */
function MiniWeek({ weekly }: { weekly: WeeklyHours | null }) {
  return (
    <View style={styles.miniWeek}>
      {DAY_KEYS.map((day) => {
        const open = (weekly?.[day]?.length ?? 0) > 0;
        return <View key={day} style={[styles.miniDay, open && styles.miniDayOpen]} />;
      })}
    </View>
  );
}

/** One editable info group as a tile. Filled state is carried by the amber icon
 *  + a check badge (or a plus when empty), plus the mini-week / value / recency
 *  line — never a "Vyplněno · uprav" sentence. Tapping routes to the editor. */
function FactTile({
  icon,
  label,
  filled,
  weekly,
  value,
  recency,
  emptyLabel,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  filled: boolean;
  weekly: WeeklyHours | null;
  value: string | null;
  recency: string | null;
  emptyLabel: string;
  onPress: () => void;
}) {
  const detail = filled ? (value ?? '') : emptyLabel;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={cs.mapPub.tileA11y(label, detail || label)}
    >
      <View style={styles.tileTop}>
        <View style={[styles.tileIcon, !filled && styles.tileIconEmpty]}>{icon}</View>
        {filled ? (
          <CheckIcon size={16} color={Colors.success} />
        ) : (
          <PlusIcon size={16} color={Colors.amber} />
        )}
      </View>
      <Text style={styles.tileLabel} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
        {label}
      </Text>
      {weekly ? (
        <MiniWeek weekly={weekly} />
      ) : value ? (
        <Text
          style={styles.tileValue}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {value}
        </Text>
      ) : (
        <Text
          style={[styles.tileValue, styles.tileValueEmpty]}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {emptyLabel}
        </Text>
      )}
      {recency ? (
        <Text
          style={styles.tileRecency}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {recency}
        </Text>
      ) : null}
    </Pressable>
  );
}

// ─── Overflow (rename / report) ──────────────────────────────────────────────

/** Edge actions tucked behind one quiet "···" row. Tapping reveals rename /
 *  edit-added-pub / report inline — none of them earns a permanent row in the
 *  main scroll (§0.4). */
function MoreActions({
  showRename,
  showEditAdded,
  showReport,
  onRename,
  onEditAdded,
  onReport,
}: {
  showRename: boolean;
  showEditAdded: boolean;
  showReport: boolean;
  onRename: () => void;
  onEditAdded: () => void;
  onReport: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.more}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [styles.moreToggle, pressed && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={cs.mapPub.moreA11y}
      >
        <MenuIcon size={18} color={Colors.mutedText} />
        <Text style={styles.moreLabel} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.mapPub.moreLabel}
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.moreList}>
          {showRename ? (
            <MoreRow
              icon={<PencilIcon size={20} color={Colors.foamMuted} />}
              label={cs.mapPub.renameRowLabel}
              onPress={onRename}
            />
          ) : null}
          {showEditAdded ? (
            <MoreRow
              icon={<MapPinIcon size={20} color={Colors.amber} />}
              label={cs.addPub.edit}
              onPress={onEditAdded}
            />
          ) : null}
          {showReport ? (
            <MoreRow
              icon={<FlagIcon size={20} color={Colors.mutedText} />}
              label={cs.compass.reportRemove}
              onPress={onReport}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function MoreRow({
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
      style={({ pressed }) => [styles.moreRow, pressed && { opacity: 0.6 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {icon}
      <Text style={styles.moreRowLabel} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
        {label}
      </Text>
      <ChevronRightIcon size={18} color={Colors.mutedText} />
    </Pressable>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

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
    fontWeight: '800',
    fontSize: 22,
    color: Colors.foam,
  },
  hoursRow: {
    marginTop: 4,
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
    fontWeight: '600',
    fontSize: 13,
  },
  subtitle: {
    marginTop: 2,
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
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
  body: {
    flexShrink: 1,
    marginTop: Spacing.xs,
  },
  sectionHead: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    fontWeight: '600',
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Colors.mutedText,
  },
  publicPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amberLight, 0.09),
  },
  publicPillText: {
    fontWeight: '600',
    fontSize: 11,
    color: Colors.amberLight,
  },

  // ── Fact tiles (otevíračka / piva) ──
  tiles: {
    marginTop: Spacing.md,
    flexDirection: 'row',
    gap: 12,
  },
  tile: {
    flex: 1,
    minWidth: 0,
    backgroundColor: Colors.stout3,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 15,
    paddingTop: 14,
    paddingBottom: 14,
  },
  tileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  tileIconEmpty: {
    backgroundColor: withAlpha(Colors.mutedText, 0.14),
  },
  tileLabel: {
    fontWeight: '800',
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
  },
  tileValue: {
    marginTop: 3,
    fontWeight: '500',
    fontSize: 12.5,
    color: Colors.foamMuted,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  tileValueEmpty: {
    color: Colors.mutedText,
  },
  tileRecency: {
    marginTop: 9,
    fontWeight: '500',
    fontSize: 11,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  miniWeek: {
    marginTop: 11,
    flexDirection: 'row',
    gap: 3,
  },
  miniDay: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: withAlpha(Colors.mutedText, 0.28),
  },
  miniDayOpen: {
    backgroundColor: withAlpha(Colors.amber, 0.55),
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
    fontWeight: '600',
    fontSize: 15,
    color: Colors.foam,
  },
  // ── Confidence meter (how many confirmed, not a poll) ──
  conf: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  confText: {
    flexShrink: 1,
    fontWeight: '500',
    fontSize: 11.5,
    color: Colors.mutedText,
  },
  confFirst: {
    color: Colors.amberLight,
    fontWeight: '600',
  },
  confDisputed: {
    color: Colors.amberLight,
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 11,
  },
  bar: {
    width: 3,
    borderRadius: 1,
    backgroundColor: withAlpha(Colors.mutedText, 0.32),
  },
  bar1: { height: 5 },
  bar2: { height: 8 },
  bar3: { height: 11 },

  // ── Overflow (rename / report) ──
  more: {
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  moreToggle: {
    minHeight: HitArea.min,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  moreLabel: {
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
  },
  moreList: {
    marginTop: Spacing.xs,
  },
  moreRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.border, 0.4),
  },
  moreRowLabel: {
    flex: 1,
    minWidth: 0,
    fontWeight: '600',
    fontSize: 15,
    color: Colors.foam,
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
    fontWeight: '700',
    fontSize: 13,
    color: Colors.foamMuted,
  },
  halfTextActive: {
    color: Colors.stout,
  },
  footerHint: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    fontWeight: '400',
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
    fontWeight: '800',
    fontSize: 24,
    lineHeight: 30,
    color: Colors.foam,
  },
  renameBody: {
    fontWeight: '400',
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
    fontWeight: '500',
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
    fontWeight: '700',
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
    fontWeight: '800',
    fontSize: 16,
    color: Colors.stout,
  },
});
