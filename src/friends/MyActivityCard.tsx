/**
 * MyActivityCard — "CINKL JSI PARTĚ", the one surface on the whole screen that
 * earns a glow (Parta 2.0 §3).
 *
 * This is *my* live broadcast: the table I started, filling up as friends tap
 * Jdu. It is rendered first when `myActiveActivity` exists and is the loudest
 * card — the ONLY one carrying the lone `amberGlow` plus the hottest border
 * (`withAlpha(amber, 0.45)`) and the biggest radius (`cardLarge`), so "the loop
 * you started" reads as the primary thing on screen.
 *
 * The card is a read-only roster (the owner never RSVPs to their own activity),
 * so the single rationed foam-bubble burst (§9) fires here whenever the going
 * count actually increments — a friend's net-new Jdu landing on a refresh — and
 * only when motion is allowed.
 *
 * The expiry countdown and the "expired → don't render" gate are driven by the
 * one shared 1-minute ticker (no per-card timer).
 *
 * "Ukončit" is deliberately the low-emphasis move (ending should never be the
 * bright action): a ghost pill, never red. It confirms via an app-styled dialog,
 * then optimistically hides the card and fires the real DELETE; on failure the
 * card comes back and a toast explains why.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { BeerBubbles } from '@/components/celebration/BeerBubbles';
import { showAppDialog } from '@/components/shared/AppDialog';
import {
  BellRingIcon,
  ClockIcon,
  MapPinIcon,
  Undo2Icon,
  XIcon,
} from '@/components/shared/IconGlyph';
import { endFriendPubActivity, type FriendPubActivity } from '@/data/friendsClient';
import { enqueueFriendOp, isRetriableFriendError } from '@/data/friendsQueue';
import { cs } from '@/i18n/cs';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { amberGlow, softDrop } from '@/theme/shadows';
import { useReduceMotion } from '@/utils/useReduceMotion';

import { GoingRoster } from './GoingRoster';
import { LiveDot } from './LiveDot';
import { formatExpiry, useNowTick } from './useNowTick';

/** How long the one-shot foam-bubble burst stays mounted after a net-new Jdu. */
const BURST_MS = 1200;
/** Lifts the 44pt-tall ghost pill's tap area a touch past its visual edges. */
const PILL_HIT_SLOP = { top: 6, bottom: 6, left: 6, right: 6 } as const;

interface MyActivityCardProps {
  /** My own active, non-expired broadcast (with the live responses roster). */
  activity: FriendPubActivity;
  /** Fired once the activity is successfully ended so the parent can drop it. */
  onEnded: () => void;
  /** Dim the live dot to a static 0.4 while the dashboard is stale (§2C). */
  stale?: boolean;
}

function MyActivityCardImpl({ activity, onEnded, stale = false }: MyActivityCardProps) {
  const now = useNowTick();
  const reduceMotion = useReduceMotion();
  const showToast = useToastStore((s) => s.show);

  // Optimistic local hide: while ending, the card renders null instantly. A
  // failed DELETE flips this back so the card returns (the revert).
  const [ending, setEnding] = useState(false);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // Roster size + one-shot bubble burst on a net-new Jdu (going count up).
  const [rosterSize, setRosterSize] = useState({ width: 0, height: 0 });
  const [bursting, setBursting] = useState(false);
  const prevGoing = useRef(activity.responses.going);
  const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const going = activity.responses.going;
    if (going > prevGoing.current && !reduceMotion) {
      setBursting(true);
      if (burstTimer.current) clearTimeout(burstTimer.current);
      burstTimer.current = setTimeout(() => {
        if (mountedRef.current) setBursting(false);
      }, BURST_MS);
    }
    prevGoing.current = going;
  }, [activity.responses.going, reduceMotion]);

  useEffect(
    () => () => {
      if (burstTimer.current) clearTimeout(burstTimer.current);
    },
    [],
  );

  const onRosterLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setRosterSize((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height },
    );
  }, []);

  const confirmEnd = useCallback(() => {
    // Optimistically hide the card, but hold the "ukončené" toast until the DELETE
    // actually resolves (§H4 — kills the "hotovo… vlastně ne" sequence).
    setEnding(true);
    void endFriendPubActivity(activity.id).then((res) => {
      if (!mountedRef.current) return;
      if (res.ok) {
        showToast(cs.friends.endedToast, {
          icon: <Undo2Icon size={20} color={Colors.amber} />,
        });
        onEnded();
        return;
      }
      if (isRetriableFriendError(res)) {
        // Offline / transient: queue the end so it lands on the next flush and
        // keep the card hidden (honest — it WILL end).
        void enqueueFriendOp({ op: 'end', clientId: activity.id, activityId: activity.id });
        showToast(cs.friends.endQueued, {
          icon: <Undo2Icon size={20} color={Colors.amber} />,
        });
        onEnded();
        return;
      }
      // Hard reject: bring the card back and explain.
      setEnding(false);
      showToast(res.detail);
    });
  }, [activity.id, onEnded, showToast]);

  const handleEndPress = useCallback(() => {
    showAppDialog({
      title: cs.friends.endActivityConfirmTitle,
      message: cs.friends.endActivityConfirmBody,
      buttons: [
        { text: cs.common.cancel, style: 'cancel' },
        {
          text: cs.friends.endActivityConfirmConfirm,
          style: 'destructive',
          onPress: confirmEnd,
        },
      ],
    });
  }, [confirmEnd]);

  // Expiry: hide a genuinely-passed activity outright; an unparseable timestamp
  // keeps the card but simply drops the countdown label.
  const expiryLabel = formatExpiry(activity.expiresAt, now);
  const expiresMs = Date.parse(activity.expiresAt);
  const isExpired = Number.isFinite(expiresMs) && expiresMs <= now;

  if (ending || isExpired) return null;

  const showBurst =
    bursting && !reduceMotion && rosterSize.width > 0 && rosterSize.height > 0;

  return (
    // Two stacked layers so the card carries BOTH the universal soft drop AND the
    // screen's single amber glow (RN renders one shadow per view): the outer layer
    // casts the amber halo, the inner card casts the tight soft drop.
    <View style={styles.glowLayer}>
      <View style={styles.card}>
        <View style={styles.kicker}>
          <View style={styles.kickerLeft}>
            <LiveDot stale={stale} />
            <View style={styles.bellDisk}>
              <BellRingIcon size={16} color={Colors.amber} />
            </View>
            <Text
              style={styles.kickerLabel}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.heading}
            >
              {cs.friends.myActiveTitle}
            </Text>
          </View>

          {expiryLabel ? (
            <View style={styles.expiry}>
              <ClockIcon size={13} color={Colors.mutedText} />
              <Text
                style={styles.expiryText}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {expiryLabel}
              </Text>
            </View>
          ) : null}
        </View>

        <Text
          style={styles.pubName}
          numberOfLines={2}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {activity.name}
        </Text>

        {activity.city ? (
          <View style={styles.cityRow}>
            <MapPinIcon size={14} color={Colors.mutedText} />
            <Text
              style={styles.cityText}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {activity.city}
            </Text>
          </View>
        ) : null}

        <View style={styles.roster} onLayout={onRosterLayout}>
          {showBurst ? (
            <BeerBubbles
              width={rosterSize.width}
              height={rosterSize.height}
              bubbleCount={14}
              overflowVisible
            />
          ) : null}
          <GoingRoster
            profiles={activity.responses.goingProfiles}
            goingCount={activity.responses.going}
            maybeCount={activity.responses.maybe}
            cantCount={activity.responses.cant}
            size="large"
            surfaceColor={Colors.stout2}
            iAmGoing={false}
            isMyCard
          />
        </View>

        {/* Incoming "Na zdraví" — a quiet, action-less line on my own card (§C2). */}
        {activity.reactions.cheers > 0 ? (
          <Text
            style={styles.cheersLine}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {cs.friends.cheersCount(activity.reactions.cheers)}
          </Text>
        ) : null}

        <View style={styles.footer}>
          <Pressable
            onPress={handleEndPress}
            hitSlop={PILL_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={cs.friends.endActivityA11y}
            style={({ pressed }) => [styles.endPill, pressed && styles.endPillPressed]}
          >
            <XIcon size={16} color={Colors.foamMuted} />
            <Text
              style={styles.endLabel}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.heading}
            >
              {cs.friends.endActivity}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  glowLayer: {
    borderRadius: Radius.cardLarge,
    backgroundColor: Colors.stout2,
    // The lone halo on the whole screen — spread it wide enough to actually read
    // as warmth bleeding off my live table, not a tight 8pt shadow nobody sees.
    ...amberGlow(22),
  },
  card: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.6),
    padding: Spacing.lg,
    ...softDrop(),
  },
  kicker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  kickerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexShrink: 1,
  },
  bellDisk: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: withAlpha(Colors.amber, 0.12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  kickerLabel: {
    flexShrink: 1,
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 1,
    color: Colors.amber,
  },
  expiry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  expiryText: {
    fontWeight: '500',
    fontSize: 12,
    color: Colors.mutedText,
  },
  pubName: {
    marginTop: Spacing.md,
    fontWeight: '800',
    fontSize: 22,
    lineHeight: 26,
    color: Colors.foam,
  },
  cityRow: {
    marginTop: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  cityText: {
    flexShrink: 1,
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
  },
  roster: {
    marginTop: Spacing.md,
    overflow: 'visible',
  },
  cheersLine: {
    marginTop: Spacing.sm,
    fontWeight: '500',
    fontSize: 12,
    color: Colors.mutedText,
  },
  footer: {
    marginTop: Spacing.md,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  endPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: HitArea.min,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.06),
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.6),
  },
  endPillPressed: {
    opacity: 0.6,
  },
  endLabel: {
    fontWeight: '600',
    fontSize: 14,
    color: Colors.foamMuted,
  },
});

export default memo(MyActivityCardImpl);
