/**
 * CompassScreen — main screen combining Pencil designs:
 *   Screen 01 (nDTP2)  — active compass, hidden pub
 *   Screen 02 (t7lhE)  — active compass, revealed pub
 *   Screen 04 (b45goy) — nothing nearby
 *   + Permission gate and loading state
 */

import React, { useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  useAnimatedReaction,
  useSharedValue,
} from 'react-native-reanimated';

import { useCompass } from '@/hooks/useCompass';
import { usePubStore } from '@/stores/pubStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { shortestRotationTarget } from '@/compass/rotation';
import { openPubInMaps } from '@/utils/maps';

import { CompassContainer } from '@/components/compass/CompassContainer';
import { TitleBar } from '@/components/shared/TitleBar';
import { GlowButton } from '@/components/shared/GlowButton';
import {
  BeerIcon,
  BeerOffIcon,
  LockKeyholeIcon,
  EyeIcon,
  MapPinIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  SettingsIcon,
} from '@/components/shared/IconGlyph';

import { Colors } from '@/theme/colors';
import { Fonts } from '@/theme/fonts';
import { Radius, Spacing, CompassSize } from '@/theme/layout';
import { amberGlow, amberGlowStrong } from '@/theme/shadows';
import { cs } from '@/i18n/cs';

// ─── Permission screen ────────────────────────────────────────────────────────

interface PermissionScreenProps {
  permissionState: 'denied' | 'undetermined';
  requestPermission: () => Promise<void>;
}

function PermissionScreen({ permissionState, requestPermission }: PermissionScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.permCard}>
        {/* Beer decoration */}
        <View style={styles.permIconWrap}>
          <BeerIcon size={56} color={Colors.amber} />
        </View>

        <Text style={styles.permTitle}>{cs.permissions.title}</Text>
        <Text style={styles.permBody}>{cs.permissions.body}</Text>

        <GlowButton
          label={cs.permissions.cta}
          onPress={requestPermission}
          glow="soft"
          accessibilityLabel={cs.permissions.cta}
        />

        {permissionState === 'denied' && (
          <View style={styles.permSecondaryWrap}>
            <GlowButton
              label={cs.permissions.openSettings}
              onPress={() => Linking.openSettings()}
              variant="secondary"
              glow="none"
              height={50}
              accessibilityLabel={cs.permissions.openSettings}
            />
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Loading screen ────────────────────────────────────────────────────────────

interface LoadingScreenProps {
  rotation: ReturnType<typeof useSharedValue<number>>;
}

function LoadingScreen({ rotation }: LoadingScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.loadingCompassWrap}>
        <CompassContainer rotation={rotation} size={CompassSize} />
      </View>
      <Text style={styles.loadingText}>Hledáme hospodu…</Text>
    </View>
  );
}

// ─── Empty screen (Screen 04) ────────────────────────────────────────────────

interface EmptyScreenProps {
  onSettings: () => void;
  onRetry: () => void;
}

function EmptyScreen({ onSettings, onRetry }: EmptyScreenProps) {
  return (
    <View style={styles.emptyContainer}>
      {/* Top group — icon, headline, body, centered vertically */}
      <View style={styles.emptyTopGroup}>
        <View style={[styles.emptyIconWrap, amberGlowStrong(36)]}>
          <BeerOffIcon size={120} color={Colors.amber} />
        </View>

        <View style={styles.emptyHeadlineWrap}>
          <Text style={styles.emptyHeadlineFoam}>{cs.empty.headlineLine1}</Text>
          <Text style={styles.emptyHeadlineAmber}>{cs.empty.headlineLine2}</Text>
        </View>

        <Text style={styles.emptyBody}>{cs.empty.body}</Text>
      </View>

      {/* Bottom group — primary CTA and retry pinned to bottom */}
      <View style={styles.emptyBottomGroup}>
        <View style={styles.emptyButtonWrap}>
          <GlowButton
            label={cs.empty.openSettings}
            onPress={onSettings}
            icon={<SettingsIcon size={20} color={Colors.stout} />}
            glow="soft"
            accessibilityLabel={cs.empty.openSettings}
          />
        </View>

        <Pressable
          onPress={onRetry}
          style={styles.emptyRetry}
          hitSlop={12}
          accessibilityLabel={cs.empty.retry}
          accessibilityRole="button"
        >
          <RefreshCwIcon size={16} color={Colors.mutedText} />
          <Text style={styles.emptyRetryText}>{cs.empty.retry}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Hidden pub pill ─────────────────────────────────────────────────────────

interface HiddenPubPillProps {
  onReveal: () => void;
}

// Pencil design uses fixed pixel widths for the skeleton bars
const SKELETON_BAR_WIDTHS = [26, 46, 16, 36, 52] as const;

function HiddenPubPill({ onReveal }: HiddenPubPillProps) {
  return (
    <Pressable
      onPress={onReveal}
      hitSlop={8}
      style={({ pressed }) => [styles.pubPill, styles.pubPillHidden, pressed && { opacity: 0.8 }]}
      accessibilityLabel={cs.a11y.pubPillHidden}
      accessibilityRole="button"
    >
      {/* Top row: lock icon + skeleton bars */}
      <View style={styles.pubPillRow}>
        <LockKeyholeIcon size={22} color={Colors.amber} />
        <View style={styles.skeletonGroup}>
          {SKELETON_BAR_WIDTHS.map((w, i) => (
            <View key={i} style={[styles.skeletonBar, { width: w }]} />
          ))}
        </View>
      </View>

      {/* Bottom row: reveal hint */}
      <View style={styles.pubPillHintRow}>
        <EyeIcon size={14} color={Colors.amber} />
        <Text style={styles.pubPillHint}>{cs.compass.hiddenPubHint}</Text>
      </View>
    </Pressable>
  );
}

// ─── Revealed pub pill ────────────────────────────────────────────────────────

interface RevealedPubPillProps {
  pubName: string;
  onOpenMaps: () => void;
}

function RevealedPubPill({ pubName, onOpenMaps }: RevealedPubPillProps) {
  return (
    <Pressable
      onPress={onOpenMaps}
      hitSlop={8}
      style={({ pressed }) => [
        styles.pubPill,
        styles.pubPillRevealed,
        amberGlow(14),
        pressed && { opacity: 0.85 },
      ]}
      accessibilityLabel={cs.a11y.pubPillRevealed(pubName)}
      accessibilityRole="button"
    >
      {/* Top row: pub name */}
      <View style={styles.pubPillRow}>
        <BeerIcon size={18} color={Colors.amber} />
        <Text style={styles.pubName} numberOfLines={1}>
          {pubName}
        </Text>
      </View>

      {/* Bottom row: open in maps */}
      <View style={styles.pubPillHintRow}>
        <MapPinIcon size={14} color={Colors.amber} />
        <Text style={styles.pubPillMapsHint}>{cs.compass.openInMaps}</Text>
        <ExternalLinkIcon size={12} color={Colors.amber} />
      </View>
    </Pressable>
  );
}

// ─── Mode toggle ──────────────────────────────────────────────────────────────

interface ModeToggleProps {
  mode: 'nearest' | 'surprise';
  onNearest: () => void;
  onSurprise: () => void;
}

function ModeToggle({ mode, onNearest, onSurprise }: ModeToggleProps) {
  return (
    <View style={styles.modeTogglePill}>
      {/* Nejbližší segment */}
      <Pressable
        onPress={onNearest}
        style={[
          styles.modeSegment,
          mode === 'nearest' && styles.modeSegmentActive,
          mode === 'nearest' && amberGlow(8),
        ]}
        accessibilityLabel={cs.a11y.modeNearestButton}
        accessibilityRole="button"
      >
        <Text
          style={[
            styles.modeSegmentText,
            mode === 'nearest' ? styles.modeSegmentTextActive : styles.modeSegmentTextInactive,
          ]}
        >
          {cs.compass.modeNearest}
        </Text>
      </Pressable>

      {/* Překvap mě segment */}
      <Pressable
        onPress={onSurprise}
        style={[
          styles.modeSegment,
          mode === 'surprise' && styles.modeSegmentActive,
          mode === 'surprise' && amberGlow(8),
        ]}
        accessibilityLabel={cs.a11y.modeSurpriseButton}
        accessibilityRole="button"
      >
        <Text
          style={[
            styles.modeSegmentText,
            mode === 'surprise' ? styles.modeSegmentTextActive : styles.modeSegmentTextInactive,
          ]}
        >
          {cs.compass.modeSurprise}
        </Text>
      </Pressable>
    </View>
  );
}

// ─── Distance display ─────────────────────────────────────────────────────────

interface DistanceDisplayProps {
  distanceFormatted: string | null;
  mode: 'nearest' | 'surprise';
}

function DistanceDisplay({ distanceFormatted, mode }: DistanceDisplayProps) {
  // Split "320 m" or "2,5 km" into number and unit parts
  let numberPart = '—';
  let unitPart = '';

  if (distanceFormatted) {
    const spaceIdx = distanceFormatted.lastIndexOf(' ');
    if (spaceIdx !== -1) {
      numberPart = distanceFormatted.slice(0, spaceIdx);
      unitPart = distanceFormatted.slice(spaceIdx + 1);
    } else {
      numberPart = distanceFormatted;
    }
  }

  const caption =
    mode === 'nearest' ? cs.compass.distanceCaption.nearest : cs.compass.distanceCaption.surprise;

  return (
    <View style={styles.distanceWrap}>
      <View style={styles.distanceRow}>
        <Text style={styles.distanceNumber}>{numberPart}</Text>
        {unitPart !== '' && <Text style={styles.distanceUnit}>{unitPart}</Text>}
      </View>
      <Text style={styles.distanceCaption}>{caption}</Text>
    </View>
  );
}

// ─── Main CompassScreen ───────────────────────────────────────────────────────

export default function CompassScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const {
    arrowRotation,
    distanceFormatted,
    pub,
    revealed,
    reveal,
    mode,
    setMode,
    reroll,
    arrived,
    dismissArrival,
    headingAccuracy,
    hasMagnetometer,
    permissionState,
    requestPermission,
    isLoading,
  } = useCompass();

  const maxDistanceKm = useSettingsStore((s) => s.maxDistanceKm);

  // Reanimated shared value for compass rotation
  const rotation = useSharedValue(0);
  const lastRotationTarget = useSharedValue(0);
  const hasRotationTarget = useSharedValue(false);

  // Keep the hot heading -> arrow path inside Reanimated instead of React
  // state/effects. The native heading stream is already high-frequency, so the
  // shared value is assigned directly instead of restarting an animation.
  useAnimatedReaction(
    () => arrowRotation.value,
    (target, previousTarget) => {
      if (target === null || target === previousTarget) return;

      const current = hasRotationTarget.value ? lastRotationTarget.value : rotation.value;
      const nextTarget = shortestRotationTarget(current, target);

      hasRotationTarget.value = true;
      lastRotationTarget.value = nextTarget;
      rotation.value = nextTarget;
    },
  );

  // Arrival handling: persist revealed pub, push to celebration, dismiss
  useEffect(() => {
    if (!arrived) return;
    if (pub) {
      usePubStore.getState().setRevealedPub(pub);
    }
    router.push('/celebration');
    dismissArrival();
  }, [arrived, pub, router, dismissArrival]);

  const handleSettings = useCallback(() => {
    router.push('/settings');
  }, [router]);

  // Dev-only shortcut: long-press the settings gear to simulate arrival at the
  // current pub. Compiled out of release builds since `__DEV__` is false there.
  const handleDevArrival = useCallback(() => {
    if (!__DEV__) return;
    if (pub) usePubStore.getState().setRevealedPub(pub);
    router.push('/celebration');
  }, [pub, router]);

  const handleOpenMaps = useCallback(() => {
    if (pub) openPubInMaps(pub);
  }, [pub]);

  // ── State A: permission not granted ──────────────────────────────────────
  if (permissionState === 'denied' || permissionState === 'undetermined') {
    return (
      <PermissionScreen
        permissionState={permissionState}
        requestPermission={requestPermission}
      />
    );
  }

  // ── State B: loading ──────────────────────────────────────────────────────
  if (isLoading) {
    return <LoadingScreen rotation={rotation} />;
  }

  // ── State D: nothing nearby (pub is null when maxDistanceKm is set) ───────
  // "Nic poblíž" only triggers when maxDistanceKm is non-null (user set a limit)
  // and the query returned null.
  if (pub === null && maxDistanceKm !== null) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <TitleBar showGear onSettings={handleSettings} />
        <EmptyScreen
          onSettings={handleSettings}
          onRetry={reroll}
        />
      </View>
    );
  }

  // ── State C: active compass ───────────────────────────────────────────────
  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) }]}>
      {/* Header */}
      <TitleBar showGear onSettings={handleSettings} onSettingsLongPress={handleDevArrival} />

      {/* Calibration hint (optional, subtle) */}
      {headingAccuracy !== null && headingAccuracy > 20 && (
        <View style={styles.calibrationRow}>
          <Text style={styles.calibrationText}>{cs.compass.calibrationHint}</Text>
        </View>
      )}

      {/* Compass area */}
      <View style={styles.compassArea}>
        <CompassContainer rotation={rotation} size={CompassSize} />
      </View>

      {/* Distance */}
      <DistanceDisplay distanceFormatted={distanceFormatted} mode={mode} />

      {/* No magnetometer note */}
      {hasMagnetometer === false && (
        <Text style={styles.noMagText}>
          Tvůj telefon nemá kompas, šipka se nebude otáčet.
        </Text>
      )}

      {/* Flex spacer — mirrors the iBYAN spacer in the Pencil design */}
      <View style={styles.flexSpacer} />

      {/* Pub pill */}
      <View style={styles.pubPillWrap}>
        {revealed && pub !== null ? (
          <RevealedPubPill pubName={pub.name} onOpenMaps={handleOpenMaps} />
        ) : (
          <HiddenPubPill onReveal={reveal} />
        )}
      </View>

      {/* Bottom controls: mode toggle pill + reroll button, side by side */}
      <View style={styles.bottomControls}>
        <View style={styles.modeToggleFlex}>
          <ModeToggle
            mode={mode}
            onNearest={() => setMode('nearest')}
            onSurprise={() => setMode('surprise')}
          />
        </View>
        <Pressable
          onPress={mode === 'surprise' ? reroll : undefined}
          disabled={mode !== 'surprise'}
          style={[
            styles.rerollButton,
            mode !== 'surprise' && styles.rerollButtonInactive,
          ]}
          hitSlop={12}
          accessibilityLabel={cs.a11y.rerollButton}
          accessibilityRole="button"
        >
          <RefreshCwIcon size={18} color={Colors.foamMuted} />
        </Pressable>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
  },

  // ── Permission ──
  permCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: Spacing.lg,
  },
  permIconWrap: {
    marginBottom: 4,
  },
  permTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 28,
    color: Colors.foam,
    textAlign: 'center',
    lineHeight: 36,
  },
  permBody: {
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    color: Colors.mutedText,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 8,
  },
  permSecondaryWrap: {
    width: '100%',
    marginTop: -8,
  },

  // ── Loading ──
  loadingCompassWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  loadingText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 15,
    color: Colors.mutedText,
    textAlign: 'center',
  },

  // ── Compass area (State C) ──
  calibrationRow: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xs,
    alignItems: 'center',
  },
  calibrationText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: Colors.mutedText,
    textAlign: 'center',
    lineHeight: 16,
  },
  compassArea: {
    alignItems: 'center',
    justifyContent: 'center',
    height: CompassSize,
    marginTop: Spacing.sm,
  },
  flexSpacer: {
    flex: 1,
    minHeight: Spacing.md,
  },

  // ── Distance ──
  distanceWrap: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.sm,
  },
  distanceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  distanceNumber: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 78,
    color: Colors.foam,
    lineHeight: 96,
    includeFontPadding: false,
  },
  distanceUnit: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 34,
    color: Colors.amber,
    lineHeight: 44,
    includeFontPadding: false,
  },
  distanceCaption: {
    fontFamily: Fonts.ui.bold,
    fontStyle: 'italic',
    fontSize: 14,
    color: Colors.mutedText,
    marginTop: 2,
    textAlign: 'center',
  },

  // ── No magnetometer ──
  noMagText: {
    fontFamily: Fonts.ui.regular,
    fontSize: 12,
    color: Colors.mutedText,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.xs,
  },

  // ── Pub pill (shared) ──
  pubPillWrap: {
    paddingHorizontal: 24,
    paddingBottom: Spacing.md,
  },
  pubPill: {
    borderRadius: Radius.card,
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pubPillHidden: {
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pubPillRevealed: {
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.amber,
  },
  pubPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 38,
  },
  pubPillHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  // ── Hidden pill internals ──
  skeletonGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  skeletonBar: {
    height: 14,
    borderRadius: Radius.pill,
    backgroundColor: Colors.foamMuted,
    opacity: 0.6,
  },
  pubPillHint: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.amber,
  },

  // ── Revealed pill internals ──
  pubName: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    color: Colors.foam,
    flex: 1,
  },
  pubPillMapsHint: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.amber,
    flex: 1,
  },

  // ── Mode toggle ──
  bottomControls: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 12,
    gap: 10,
  },
  modeToggleFlex: {
    flex: 1,
  },
  modeTogglePill: {
    flexDirection: 'row',
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.pill,
    padding: 5,
    gap: 4,
  },
  modeSegment: {
    flex: 1,
    borderRadius: Radius.pill,
    paddingVertical: 10,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeSegmentActive: {
    backgroundColor: Colors.amber,
  },
  modeSegmentText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 14,
    letterSpacing: 0.1,
  },
  modeSegmentTextActive: {
    color: Colors.stout,
    fontFamily: Fonts.ui.bold,
  },
  modeSegmentTextInactive: {
    color: Colors.foamMuted,
    fontFamily: Fonts.ui.semibold,
    opacity: 0.7,
  },

  // ── Reroll button ──
  rerollButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rerollButtonInactive: {
    opacity: 0.4,
  },

  // ── Empty state (State D) ──
  emptyContainer: {
    flex: 1,
    alignItems: 'stretch',
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.lg,
  },
  emptyTopGroup: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
  },
  emptyBottomGroup: {
    alignItems: 'center',
    gap: Spacing.lg,
  },
  emptyIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyHeadlineWrap: {
    alignItems: 'center',
    gap: 0,
  },
  emptyHeadlineFoam: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 38,
    color: Colors.foam,
    letterSpacing: -0.5,
    lineHeight: 44,
  },
  emptyHeadlineAmber: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 38,
    color: Colors.amber,
    letterSpacing: -0.5,
    lineHeight: 44,
  },
  emptyBody: {
    fontFamily: Fonts.ui.medium,
    fontSize: 15,
    color: Colors.mutedText,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 300,
  },
  emptyButtonWrap: {
    alignSelf: 'stretch',
    marginTop: 4,
  },
  emptyRetry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  emptyRetryText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.mutedText,
  },
});
