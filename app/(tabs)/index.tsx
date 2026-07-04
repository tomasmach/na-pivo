/**
 * CompassScreen — main screen combining Pencil designs:
 *   Screen 01 (nDTP2)  — active compass, hidden pub
 *   Screen 02 (t7lhE)  — active compass, revealed pub
 *   Screen 04 (b45goy) — nothing nearby
 *   + Permission gate and loading state
 */

import React, { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Linking,
  KeyboardAvoidingView,
  Modal,
  Platform,
  TextInput,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  useAnimatedReaction,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { useCompass } from '@/hooks/useCompass';
import type { HoursStatus } from '@/data/pubs';
import type { CommunityBeer } from '@/data/communityClient';
import { parseOsmOpeningHoursToWeeklyHours } from '@/data/communityHours';
import type { PubReportReason } from '@/data/pubReportsClient';
import { updateAccountPreferences } from '@/data/account';
import {
  BeerBrandFilterSheet,
  type BeerBrandFilterValue,
} from '@/components/compass/BeerBrandFilterSheet';
import { usePubStore } from '@/stores/pubStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { shortestRotationTarget } from '@/compass/rotation';
import { isHeadingAccuracyLow } from '@/compass/headingAccuracy';
import { openPubInMaps } from '@/utils/maps';
import { formatPrice, type PriceCurrency } from '@/utils/currency';

import { CompassContainer } from '@/components/compass/CompassContainer';
import { OpenStatusChip } from '@/components/compass/OpenStatusChip';
import { TitleBar } from '@/components/shared/TitleBar';
import { GlowButton } from '@/components/shared/GlowButton';
import {
  BeerIcon,
  BeerOffIcon,
  LockKeyholeIcon,
  EyeIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  SettingsIcon,
  FlagIcon,
  MapPinnedIcon,
  MapPinPlusIcon,
  PencilIcon,
  StarIcon,
  MapPinIcon,
  TreePineIcon,
  UsersIcon,
  ChevronLeftIcon,
  XIcon,
} from '@/components/shared/IconGlyph';
import { MapPubSheet } from '@/components/amenities/MapPubSheet';
import { pubInfoFromPub, type PubInfoContext } from '@/components/amenities/pubInfoContext';
import { geohash8 } from '@/data/geohash';
import { useToastStore } from '@/stores/toastStore';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing, CompassSize } from '@/theme/layout';
import { amberGlowStrong } from '@/theme/shadows';
import { cs } from '@/i18n/cs';

// Android's heading samples arrive as discrete jumps (see the rotation
// reaction in CompassScreen); animate between them. The spring is essentially
// critically damped (damping ≈ 2·√stiffness) so the needle settles without
// overshooting — overshoot would read as more wobble, not less.
const ANIMATE_ARROW = Platform.OS === 'android';
const ARROW_SPRING_CONFIG = {
  damping: 26,
  stiffness: 180,
  mass: 1,
  overshootClamping: true,
} as const;

// Keep the hidden and revealed pub cards occupying the same slot. Without this,
// revealing the pub makes the card taller and pushes the bottom controls into
// the Android navigation area on shorter devices.
const PUB_PILL_MIN_HEIGHT = 166;
const ACTIVE_CHROME_HEIGHT = 430;

interface RenamePubModalProps {
  visible: boolean;
  currentName: string;
  value: string;
  submitting: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

function RenamePubModal({
  visible,
  currentName,
  value,
  submitting,
  onChange,
  onCancel,
  onSubmit,
}: RenamePubModalProps) {
  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== currentName.trim() && !submitting;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.renameOverlay}
      >
        <Pressable style={styles.renameScrim} onPress={onCancel} />
        <View style={styles.renamePanel}>
          <View style={styles.renameIconWell}>
            <PencilIcon size={19} color={Colors.amber} />
          </View>
          <Text style={styles.renameTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.compass.renameTitle}
          </Text>
          <Text style={styles.renameBody} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.compass.renameBody(currentName)}
          </Text>
          <TextInput
            value={value}
            onChangeText={onChange}
            style={styles.renameInput}
            placeholder={cs.compass.renamePlaceholder}
            placeholderTextColor={Colors.mutedText}
            maxLength={200}
            autoFocus
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (canSubmit) onSubmit();
            }}
            accessibilityLabel={cs.a11y.renamePubInput}
          />
          <View style={styles.renameActions}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [styles.renameSecondaryButton, pressed && { opacity: 0.72 }]}
              accessibilityRole="button"
              accessibilityLabel={cs.common.cancel}
            >
              <Text style={styles.renameSecondaryText} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.common.cancel}
              </Text>
            </Pressable>
            <Pressable
              onPress={onSubmit}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.renamePrimaryButton,
                !canSubmit && styles.renamePrimaryDisabled,
                pressed && canSubmit && { opacity: 0.86, transform: [{ scale: 0.98 }] },
              ]}
              accessibilityRole="button"
              accessibilityLabel={cs.a11y.renamePubSaveButton}
            >
              <Text style={styles.renamePrimaryText} maxFontSizeMultiplier={FontScaleCap.body}>
                {submitting ? cs.compass.renameSaving : cs.compass.renameSave}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface ReportPubModalProps {
  visible: boolean;
  pubName: string;
  onClose: () => void;
  onRename: () => void;
  onReportReason: (reason: PubReportReason) => void;
}

function ReportPubModal({
  visible,
  pubName,
  onClose,
  onRename,
  onReportReason,
}: ReportPubModalProps) {
  const handleRename = useCallback(() => {
    onClose();
    onRename();
  }, [onClose, onRename]);

  const handleReportClosed = useCallback(() => {
    onClose();
    onReportReason('closed');
  }, [onClose, onReportReason]);

  const handleReportNotPub = useCallback(() => {
    onClose();
    onReportReason('not_pub');
  }, [onClose, onReportReason]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.reportOverlay}>
        <Pressable
          style={styles.reportScrim}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={cs.common.cancel}
        />
        <View style={styles.reportPanel}>
          <View style={styles.reportHeader}>
            <View style={styles.reportIconWell}>
              <FlagIcon size={18} color={Colors.amber} />
            </View>
            <View style={styles.reportTitleWrap}>
              <Text style={styles.reportTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                {cs.compass.reportTitle}
              </Text>
              <Text style={styles.reportBody} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.compass.reportBody(pubName)}
              </Text>
            </View>
          </View>

          <View style={styles.reportActions}>
            <ReportActionButton
              label={cs.compass.reportRename}
              icon={<PencilIcon size={18} color={Colors.foam} />}
              onPress={handleRename}
            />
            <ReportActionButton
              label={cs.compass.reportClosed}
              icon={<XIcon size={18} color={Colors.foamMuted} />}
              onPress={handleReportClosed}
              tone="muted"
            />
            <ReportActionButton
              label={cs.compass.reportNotPub}
              icon={<BeerOffIcon size={18} color={Colors.amberLight} />}
              onPress={handleReportNotPub}
              tone="danger"
            />
            <ReportActionButton
              label={cs.common.cancel}
              icon={<XIcon size={18} color={Colors.mutedText} />}
              onPress={onClose}
              tone="ghost"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

interface ReportActionButtonProps {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  tone?: 'default' | 'muted' | 'danger' | 'ghost';
}

function ReportActionButton({
  label,
  icon,
  onPress,
  tone = 'default',
}: ReportActionButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.reportAction,
        tone === 'muted' && styles.reportActionMuted,
        tone === 'danger' && styles.reportActionDanger,
        tone === 'ghost' && styles.reportActionGhost,
        pressed && styles.reportActionPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.reportActionIcon}>{icon}</View>
      <Text
        style={[
          styles.reportActionText,
          tone === 'danger' && styles.reportActionTextDanger,
          tone === 'ghost' && styles.reportActionTextGhost,
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.82}
        maxFontSizeMultiplier={FontScaleCap.heading}
      >
        {label}
      </Text>
      <View style={styles.reportActionIconSpacer} />
    </Pressable>
  );
}

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

        <Text style={styles.permTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
          {cs.permissions.title}
        </Text>
        <Text style={styles.permBody} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.permissions.body}
        </Text>

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
      <Text style={styles.loadingText} maxFontSizeMultiplier={FontScaleCap.body}>
        Hledáme hospodu…
      </Text>
    </View>
  );
}

// ─── Empty screen (Screen 04) ────────────────────────────────────────────────

interface EmptyScreenProps {
  onSettings: () => void;
  onRetry: () => void;
  onAddPub: () => void;
  searchFailed: boolean;
}

function EmptyScreen({ onSettings, onRetry, onAddPub, searchFailed }: EmptyScreenProps) {
  const headlineLine1 = searchFailed
    ? cs.empty.searchFailedHeadlineLine1
    : cs.empty.headlineLine1;
  const headlineLine2 = searchFailed
    ? cs.empty.searchFailedHeadlineLine2
    : cs.empty.headlineLine2;
  const body = searchFailed ? cs.empty.searchFailedBody : cs.empty.body;

  return (
    <View style={styles.emptyContainer}>
      {/* Top group — icon, headline, body, centered vertically */}
      <View style={styles.emptyTopGroup}>
        <View style={[styles.emptyIconWrap, amberGlowStrong(36)]}>
          <BeerOffIcon size={120} color={Colors.amber} />
        </View>

        <View style={styles.emptyHeadlineWrap}>
          <Text style={styles.emptyHeadlineFoam} maxFontSizeMultiplier={FontScaleCap.display}>
            {headlineLine1}
          </Text>
          <Text style={styles.emptyHeadlineAmber} maxFontSizeMultiplier={FontScaleCap.display}>
            {headlineLine2}
          </Text>
        </View>

        <Text style={styles.emptyBody} maxFontSizeMultiplier={FontScaleCap.body}>
          {body}
        </Text>
      </View>

      {/* Bottom group — primary CTA and retry pinned to bottom */}
      <View style={styles.emptyBottomGroup}>
        <View style={styles.emptyButtonWrap}>
          <GlowButton
            label={cs.empty.addPub}
            onPress={onAddPub}
            icon={<MapPinIcon size={20} color={Colors.stout} />}
            glow="soft"
            accessibilityLabel={cs.a11y.addPubButton}
          />
        </View>

        <View style={styles.emptySecondaryActions}>
          <Pressable
            onPress={onSettings}
            style={styles.emptyRetry}
            hitSlop={12}
            accessibilityLabel={cs.empty.openSettings}
            accessibilityRole="button"
          >
            <SettingsIcon size={16} color={Colors.mutedText} />
            <Text style={styles.emptyRetryText} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.empty.openSettings}
            </Text>
          </Pressable>

          <Pressable
            onPress={onRetry}
            style={styles.emptyRetry}
            hitSlop={12}
            accessibilityLabel={cs.empty.retry}
            accessibilityRole="button"
          >
            <RefreshCwIcon size={16} color={Colors.mutedText} />
            <Text style={styles.emptyRetryText} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.empty.retry}
            </Text>
          </Pressable>
        </View>
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

type ActiveCompassLayout = {
  bottomControlsPaddingBottom: number;
  bottomControlsPaddingTop: number;
  compassMarginTop: number;
  compassSize: number;
  distanceNumberFontSize: number;
  distanceNumberLineHeight: number;
  distancePaddingBottom: number;
  distancePaddingTop: number;
  distanceUnitFontSize: number;
  distanceUnitLineHeight: number;
  pubPillPaddingBottom: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// The compass takes whatever vertical room is left after the surrounding chrome
// (title bar, distance block, pub pill, bottom controls, minimum spacers), but
// never exceeds the design size or the screen width. Everything else scales in
// proportion to how much the compass shrank, so layouts degrade smoothly on
// small screens / iPhone-compatibility windows instead of jumping between
// hard-coded buckets. On every normal phone there is enough room for the full
// 320pt compass (t === 1), so the layout matches the original design.
function getActiveCompassLayout(
  width: number,
  height: number,
  topInset: number,
  bottomInset: number,
  fontScale: number,
  extraChromeHeight = 0,
): ActiveCompassLayout {
  const usableHeight = height - topInset - bottomInset;

  // The chrome reserve is mostly text, which the OS multiplies by its font
  // scale. Texts on this screen cap their growth via FontScaleCap (≤ 1.3), so
  // the reserve grows by the same capped factor — without this, large system
  // font sizes (Samsung goes up to ~2.0) push the bottom controls off-screen.
  const effectiveFontScale = clamp(fontScale, 1, FontScaleCap.body);
  const VERTICAL_CHROME = Math.round((ACTIVE_CHROME_HEIGHT + extraChromeHeight) * effectiveFontScale);
  const widthBudget = width - 48; // 24pt side padding on each edge
  const heightBudget = usableHeight - VERTICAL_CHROME;

  const compassSize = Math.round(
    clamp(Math.min(widthBudget, heightBudget), 200, CompassSize),
  );

  const t = compassSize / CompassSize; // 0.625 .. 1

  return {
    bottomControlsPaddingBottom: 12,
    bottomControlsPaddingTop: Math.round(12 * t),
    compassMarginTop: 0,
    compassSize,
    distanceNumberFontSize: Math.round(64 * t),
    distanceNumberLineHeight: Math.round(78 * t),
    distancePaddingBottom: 0,
    distancePaddingTop: Math.round(20 * t),
    distanceUnitFontSize: Math.round(28 * t),
    distanceUnitLineHeight: Math.round(36 * t),
    pubPillPaddingBottom: 12,
  };
}

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
        <Text style={styles.pubPillHint} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.compass.hiddenPubHint}
        </Text>
      </View>
    </Pressable>
  );
}

// ─── Revealed pub pill ────────────────────────────────────────────────────────

interface RevealedPubPillProps {
  pubName: string;
  pubKey: string;
  mapInfo: PubInfoContext;
  onOpenMaps: () => void;
  onReport: () => void;
  onContribute: () => void;
  onAddPub: () => void;
  isOpenNow: boolean | null;
  hoursStatus?: HoursStatus;
  nextChange?: string | null;
  beers?: CommunityBeer[];
  rating?: number | null;
  ratingCount?: number | null;
  hasGarden?: boolean | null;
}

/** A compact one-liner for the cheapest/first beer, with "a další" when more. */
function formatBeerLine(beers: CommunityBeer[], priceCurrency: PriceCurrency): string | null {
  if (beers.length === 0) return null;
  // Prefer the cheapest priced beer; fall back to the first when none priced.
  const priced = beers.filter((b) => typeof b.priceCzk === 'number');
  const lead = priced.length
    ? priced.reduce((a, b) => ((b.priceCzk ?? 0) < (a.priceCzk ?? 0) ? b : a))
    : beers[0];
  const base =
    typeof lead.priceCzk === 'number'
      ? cs.compass.beerWithPrice(lead.name, formatPrice(lead.priceCzk, priceCurrency))
      : cs.compass.beerNoPrice(lead.name);
  return beers.length > 1 ? `${base} · ${cs.compass.beerAndMore}` : base;
}

function formatRatingValue(rating: number): string {
  return rating.toLocaleString('cs-CZ', {
    minimumFractionDigits: Number.isInteger(rating) ? 0 : 1,
    maximumFractionDigits: 1,
  });
}

function RevealedPubPill({
  pubName,
  pubKey,
  mapInfo,
  onOpenMaps,
  onReport,
  onContribute,
  onAddPub,
  isOpenNow,
  hoursStatus,
  nextChange,
  beers,
  rating,
  ratingCount,
  hasGarden,
}: RevealedPubPillProps) {
  const [mapOpen, setMapOpen] = useState(false);
  const priceCurrency = useSettingsStore((s) => s.priceCurrency);
  const hasRating = typeof rating === 'number' && Number.isFinite(rating);
  const ratingValue = hasRating ? formatRatingValue(rating) : null;
  const ratingCountText =
    typeof ratingCount === 'number' && Number.isFinite(ratingCount) && ratingCount > 0
      ? ratingCount.toLocaleString('cs-CZ')
      : null;
  // Compact form for the meta row: the star icon already reads as "rating", so
  // the "/ 5" and "hodnocení" words are dropped to fit beside the open-status.
  // The verbose version still goes to the accessibility label below.
  const ratingLine =
    ratingValue === null
      ? null
      : ratingCountText
        ? `${ratingValue} · ${ratingCountText}`
        : ratingValue;
  // Fold the open/closed status into the pill's OWN a11y label: the Pressable
  // collapses its children into a single VoiceOver element, so the chip's label
  // would otherwise never be announced. Stay silent while the lookup is in flight.
  const statusWord =
    isOpenNow === true
      ? cs.compass.openNow
      : isOpenNow === false
        ? cs.compass.closedNow
        : hoursStatus === 'loading' || hoursStatus === 'pending'
          ? null
          : cs.compass.hoursUnknown;
  const accessibilityParts = [cs.a11y.pubPillRevealed(pubName)];
  if (statusWord) accessibilityParts.push(cs.a11y.openStatus(statusWord));
  if (ratingValue) accessibilityParts.push(cs.a11y.pubRating(ratingValue, ratingCountText ?? undefined));
  if (hasGarden === true) accessibilityParts.push(cs.a11y.pubGarden);
  const accessibilityLabel = accessibilityParts.join('. ');

  const beerLine = beers && beers.length > 0 ? formatBeerLine(beers, priceCurrency) : null;

  return (
    <View style={[styles.pubPill, styles.pubPillRevealed]}>
      <Pressable
        onPress={onOpenMaps}
        hitSlop={8}
        style={({ pressed }) => [styles.pubPillTapArea, pressed && { opacity: 0.85 }]}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
      >
        {/* Name row — the trailing ↗ is the maps cue; the whole tap area below
            opens maps, so there's no separate "Otevřít v mapách" line anymore. */}
        <View style={styles.revealedNameRow}>
          <BeerIcon size={18} color={Colors.amber} />
          <Text style={styles.pubName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
            {pubName}
          </Text>
          <ExternalLinkIcon size={16} color={Colors.amber} />
        </View>

        {/* Meta row — open-status on the left, rating on the right. Pairing the
            two shortest facts on one line is what reclaims the vertical space.
            The status shrinks/ellipsizes first so the rating stays pinned right;
            the chip renders nothing while hours are still loading. */}
        <View style={styles.metaRow}>
          <View style={styles.metaStatus}>
            <OpenStatusChip isOpenNow={isOpenNow} status={hoursStatus} nextChange={nextChange} />
          </View>
          {ratingLine && (
            <View style={styles.ratingRow}>
              <StarIcon size={13} color={Colors.amber} />
              <Text
                style={styles.ratingText}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {ratingLine}
              </Text>
            </View>
          )}
          {hasGarden === true && (
            <View style={styles.gardenBadge}>
              <TreePineIcon size={13} color={Colors.success} />
              <Text
                style={styles.gardenBadgeText}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {cs.compass.gardenBadge}
              </Text>
            </View>
          )}
        </View>

        {/* Beers on tap — a compact line for the cheapest/first beer. Tapping it
            opens the contribute screen (where the full list lives + is editable). */}
        {beerLine && (
          <Pressable
            onPress={onContribute}
            hitSlop={6}
            style={({ pressed }) => [styles.beerLineRow, pressed && { opacity: 0.75 }]}
            accessibilityRole="button"
            accessibilityLabel={cs.a11y.contributeBeersLine(beerLine)}
          >
            <BeerIcon size={14} color={Colors.mutedText} />
            <Text
              style={styles.beerLineText}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {beerLine}
            </Text>
          </Pressable>
        )}
      </Pressable>

      {/* Footer actions stay in one compact row, but the two support actions are
          now named. Users were missing the icon-only affordances, while the
          compass screen still cannot afford a tall secondary menu here. */}
      <View style={styles.pubPillFooter}>
        <Pressable
          onPress={onAddPub}
          hitSlop={8}
          style={({ pressed }) => [styles.footerAction, pressed && styles.footerActionPressed]}
          accessibilityLabel={cs.compass.addMissingPubLink}
          accessibilityRole="button"
        >
          <MapPinPlusIcon size={15} color={Colors.foamMuted} />
          <Text
            style={styles.footerActionText}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.78}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {cs.compass.addMissingPubShort}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setMapOpen(true)}
          hitSlop={8}
          style={({ pressed }) => [
            styles.footerAction,
            styles.footerActionPrimary,
            pressed && styles.footerActionPressed,
          ]}
          accessibilityLabel={cs.mapPub.triggerDefault}
          accessibilityRole="button"
        >
          <MapPinnedIcon size={15} color={Colors.stout} />
          <Text
            style={styles.footerActionTextPrimary}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {cs.mapPub.triggerDefault}
          </Text>
        </Pressable>

        <Pressable
          onPress={onReport}
          hitSlop={8}
          style={({ pressed }) => [styles.footerAction, pressed && styles.footerActionPressed]}
          accessibilityLabel={cs.a11y.reportPubButton}
          accessibilityRole="button"
        >
          <BeerOffIcon size={15} color={Colors.foamMuted} />
          <Text
            style={styles.footerActionText}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.78}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {cs.compass.reportPubShort}
          </Text>
        </Pressable>
      </View>

      <MapPubSheet
        visible={mapOpen}
        pubKey={pubKey}
        pubName={pubName}
        info={mapInfo}
        onClose={() => setMapOpen(false)}
      />
    </View>
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
        ]}
        accessibilityLabel={cs.a11y.modeNearestButton}
        accessibilityRole="button"
      >
        <Text
          style={[
            styles.modeSegmentText,
            mode === 'nearest' ? styles.modeSegmentTextActive : styles.modeSegmentTextInactive,
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
          maxFontSizeMultiplier={FontScaleCap.heading}
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
        ]}
        accessibilityLabel={cs.a11y.modeSurpriseButton}
        accessibilityRole="button"
      >
        <Text
          style={[
            styles.modeSegmentText,
            mode === 'surprise' ? styles.modeSegmentTextActive : styles.modeSegmentTextInactive,
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {cs.compass.modeSurprise}
        </Text>
      </Pressable>
    </View>
  );
}

interface BeerFilterButtonProps {
  value: BeerBrandFilterValue | null;
  onOpen: () => void;
  onClear: () => void;
}

// Compact labeled control that lives in the header (the dead space between the
// logo and the gear). Idle it reads "Filtruj piva" and opens the picker sheet;
// once a brand is chosen it turns amber and shows the brand with an X to clear.
// Keeping it in the header means the compass keeps its full row below.
function BeerFilterButton({ value, onOpen, onClear }: BeerFilterButtonProps) {
  const active = value !== null;
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [
        styles.filterButton,
        active && styles.filterButtonActive,
        pressed && { opacity: 0.8 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={
        active ? cs.a11y.beerBrandFilterActive(value!.label) : cs.a11y.openBeerBrandFilter
      }
    >
      <BeerIcon size={15} color={active ? Colors.amber : Colors.foamMuted} />
      <Text
        style={[styles.filterButtonText, active && styles.filterButtonTextActive]}
        numberOfLines={1}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {active ? value!.label : cs.compass.beerFilterButton}
      </Text>
      {active && (
        <Pressable
          onPress={onClear}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.clearBeerBrandFilter}
          style={({ pressed }) => [styles.filterButtonClear, pressed && { opacity: 0.6 }]}
        >
          <XIcon size={14} color={Colors.amberLight} />
        </Pressable>
      )}
    </Pressable>
  );
}

// ─── Distance display ─────────────────────────────────────────────────────────

interface DistanceDisplayProps {
  distanceFormatted: string | null;
  mode: 'nearest' | 'surprise';
  layout: ActiveCompassLayout;
}

function DistanceDisplay({ distanceFormatted, mode, layout }: DistanceDisplayProps) {
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
    <View
      style={[
        styles.distanceWrap,
        {
          paddingTop: layout.distancePaddingTop,
          paddingBottom: layout.distancePaddingBottom,
        },
      ]}
    >
      <View style={styles.distanceRow}>
        <Text
          style={[
            styles.distanceNumber,
            {
              fontSize: layout.distanceNumberFontSize,
              lineHeight: layout.distanceNumberLineHeight,
            },
          ]}
          maxFontSizeMultiplier={FontScaleCap.display}
        >
          {numberPart}
        </Text>
        {unitPart !== '' && (
          <Text
            style={[
              styles.distanceUnit,
              {
                fontSize: layout.distanceUnitFontSize,
                lineHeight: layout.distanceUnitLineHeight,
              },
            ]}
            maxFontSizeMultiplier={FontScaleCap.display}
          >
            {unitPart}
          </Text>
        )}
      </View>
      <Text style={styles.distanceCaption} maxFontSizeMultiplier={FontScaleCap.body}>
        {caption}
      </Text>
    </View>
  );
}

// ─── Focused compass (friend handoff, §F2) ───────────────────────────────────

interface FocusedCompassViewProps {
  rotation: ReturnType<typeof useSharedValue<number>>;
  pubName: string;
  distanceFormatted: string | null;
  compassSize: number;
  onBack: () => void;
}

/**
 * The compass in "Ukaž na kompasu" mode: the needle already points at the
 * friend's coarse pub (the bearing target was swapped inside useCompass). A slim
 * banner names who/where and a single escape hatch drops back to the nearest pub.
 */
function FocusedCompassView({
  rotation,
  pubName,
  distanceFormatted,
  compassSize,
  onBack,
}: FocusedCompassViewProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) }]}>
      <View style={styles.focusHeader}>
        <Pressable
          onPress={onBack}
          hitSlop={10}
          style={({ pressed }) => [styles.focusBackButton, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel={cs.friends.friendCompassBack}
        >
          <ChevronLeftIcon size={24} color={Colors.foam} />
        </Pressable>
        <View style={styles.focusKickerWrap}>
          <UsersIcon size={14} color={Colors.amber} />
          <Text style={styles.focusKicker} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.friends.friendCompassKicker}
          </Text>
        </View>
        <View style={styles.focusBackButton} />
      </View>

      <View style={styles.focusCompassArea}>
        <CompassContainer rotation={rotation} size={compassSize} />
      </View>

      <View style={styles.focusInfo}>
        <Text style={styles.focusPubName} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.heading}>
          {pubName}
        </Text>
        {distanceFormatted ? (
          <Text style={styles.focusDistance} maxFontSizeMultiplier={FontScaleCap.display}>
            {distanceFormatted}
          </Text>
        ) : null}
      </View>

      <View style={styles.flexSpacer} />

      <View style={styles.focusBackWrap}>
        <GlowButton
          label={cs.friends.friendCompassBack}
          onPress={onBack}
          variant="secondary"
          glow="none"
          height={52}
          icon={<RefreshCwIcon size={18} color={Colors.foam} />}
        />
      </View>
    </View>
  );
}

// ─── Main CompassScreen ───────────────────────────────────────────────────────

export default function CompassScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight, fontScale } = useWindowDimensions();
  const [sceneSize, setSceneSize] = useState<{ width: number; height: number } | null>(null);
  const [beerBrandFilter, setBeerBrandFilter] = useState<BeerBrandFilterValue | null>(null);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const showToast = useToastStore((s) => s.show);

  const {
    arrowRotation,
    distanceFormatted,
    pub,
    revealed,
    reveal,
    mode,
    setMode,
    reroll,
    skip,
    reportCurrentPub,
    renameCurrentPub,
    retrySearch,
    arrived,
    dismissArrival,
    headingAccuracy,
    hasMagnetometer,
    permissionState,
    requestPermission,
    isLoading,
    searchFailed,
    currentPosition,
    focusedPub,
    clearFocusedPub,
  } = useCompass(beerBrandFilter?.key ?? null);
  const hidePubNames = useSettingsStore((s) => s.hidePubNames);
  const showPubDetails = !hidePubNames || revealed;
  const handleModeChange = useCallback(
    (next: 'nearest' | 'surprise') => {
      setMode(next);
      void updateAccountPreferences({ mode: next });
    },
    [setMode],
  );
  const activeLayout = getActiveCompassLayout(
    sceneSize?.width ?? screenWidth,
    sceneSize?.height ?? screenHeight,
    insets.top,
    Math.max(insets.bottom, 16),
    fontScale,
  );

  const handleSceneLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    const next = { width: Math.round(width), height: Math.round(height) };
    if (next.width <= 0 || next.height <= 0) return;

    setSceneSize((current) => {
      if (current?.width === next.width && current.height === next.height) {
        return current;
      }
      return next;
    });
  }, []);

  // Reanimated shared value for compass rotation
  const rotation = useSharedValue(0);
  const lastRotationTarget = useSharedValue(0);
  const hasRotationTarget = useSharedValue(false);

  // Keep the hot heading -> arrow path inside Reanimated instead of React
  // state/effects. iOS delivers a dense, pre-fused heading stream, so the
  // shared value is assigned directly instead of restarting an animation.
  // Android's stream is sparse and quantized (raw sensors + a native ~2°
  // deadband), so direct assignment reads as visible twitching there — a
  // near-critically-damped spring turns those discrete jumps into continuous
  // motion instead.
  useAnimatedReaction(
    () => arrowRotation.value,
    (target, previousTarget) => {
      if (target === null || target === previousTarget) return;

      const current = hasRotationTarget.value ? lastRotationTarget.value : rotation.value;
      const nextTarget = shortestRotationTarget(current, target);

      hasRotationTarget.value = true;
      lastRotationTarget.value = nextTarget;
      rotation.value = ANIMATE_ARROW
        ? withSpring(nextTarget, ARROW_SPRING_CONFIG)
        : nextTarget;
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

  const handleOpenFilter = useCallback(() => setFilterSheetOpen(true), []);
  const handleCloseFilter = useCallback(() => setFilterSheetOpen(false), []);
  const handleClearFilter = useCallback(() => setBeerBrandFilter(null), []);

  const handleAddPub = useCallback(() => {
    router.push({
      pathname: '/add-pub' as never,
      params: {
        ...(currentPosition ? { lat: String(currentPosition.lat), lng: String(currentPosition.lng) } : {}),
      },
    });
  }, [currentPosition, router]);

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

  const handleContribute = useCallback(() => {
    if (!pub) return;
    const prefillHours =
      pub.communityHours ?? parseOsmOpeningHoursToWeeklyHours(pub.openingHours);
    // Params are strings; JSON-encode the structured prefill fields so the
    // contribute screen can hydrate the form from the current enrichment.
    router.push({
      pathname: '/contribute',
      params: {
        focus: 'beers',
        id: pub.id,
        name: pub.name,
        lat: String(pub.lat),
        lng: String(pub.lng),
        ...(pub.city ? { city: pub.city } : {}),
        ...(prefillHours ? { hours: JSON.stringify(prefillHours) } : {}),
        ...(pub.beers && pub.beers.length > 0 ? { beers: JSON.stringify(pub.beers) } : {}),
      },
    });
  }, [pub, router]);

  const handleReportReason = useCallback((reason: PubReportReason) => {
    reportCurrentPub(reason).catch(() => undefined);
  }, [reportCurrentPub]);

  const handleReportClose = useCallback(() => {
    setReportOpen(false);
  }, []);

  const handleRenamePress = useCallback(() => {
    if (!pub) return;
    setRenameDraft(pub.name);
    setRenameOpen(true);
  }, [pub]);

  const handleRenameCancel = useCallback(() => {
    if (renameSubmitting) return;
    setRenameOpen(false);
  }, [renameSubmitting]);

  const handleRenameSubmit = useCallback(() => {
    if (!pub || renameSubmitting) return;
    const trimmedName = renameDraft.trim();
    if (!trimmedName || trimmedName === pub.name.trim()) return;

    setRenameSubmitting(true);
    renameCurrentPub(trimmedName)
      .then((synced) => {
        setRenameOpen(false);
        showToast(synced ? cs.compass.renameSavedToast : cs.compass.renameQueuedToast);
      })
      .finally(() => setRenameSubmitting(false));
  }, [pub, renameCurrentPub, renameDraft, renameSubmitting, showToast]);

  const handleReport = useCallback(() => {
    if (!pub) return;
    setReportOpen(true);
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

  // ── State F: pointing at a friend's pub (§F2) ─────────────────────────────
  // Takes precedence over the nearby/empty states — a handoff should always
  // show the needle to the friend even where the local search found nothing.
  if (focusedPub) {
    return (
      <FocusedCompassView
        rotation={rotation}
        pubName={focusedPub.name}
        distanceFormatted={distanceFormatted}
        compassSize={activeLayout.compassSize}
        onBack={clearFocusedPub}
      />
    );
  }

  // ── State D: nothing nearby / pub lookup failed ───────────────────────────
  if (pub === null) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <TitleBar
          align="left"
          showGear={false}
          filterSlot={
            <BeerFilterButton
              value={beerBrandFilter}
              onOpen={handleOpenFilter}
              onClear={handleClearFilter}
            />
          }
        />
        <EmptyScreen
          onSettings={handleSettings}
          onRetry={retrySearch}
          onAddPub={handleAddPub}
          searchFailed={searchFailed}
        />
        <BeerBrandFilterSheet
          visible={filterSheetOpen}
          value={beerBrandFilter}
          onClose={handleCloseFilter}
          onSelect={setBeerBrandFilter}
        />
      </View>
    );
  }

  // ── State C: active compass ───────────────────────────────────────────────
  return (
    <View
      onLayout={handleSceneLayout}
      style={[styles.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) }]}
    >
      {/* Header — settings now lives in the Profile tab; the gear is gone so the
          filter pill sits right-aligned, mirroring the logo on the left. Dev
          arrival shortcut moved to the logo. */}
      <TitleBar
        align="left"
        showGear={false}
        onLogoLongPress={handleDevArrival}
        filterSlot={
          <BeerFilterButton
            value={beerBrandFilter}
            onOpen={handleOpenFilter}
            onClear={handleClearFilter}
          />
        }
      />

      {/* Calibration hint (optional, subtle) */}
      {isHeadingAccuracyLow(headingAccuracy, Platform.OS) && (
        <View style={styles.calibrationRow}>
          <Text style={styles.calibrationText} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.compass.calibrationHint}
          </Text>
        </View>
      )}

      {/* Compass area */}
      <View
        style={[
          styles.compassArea,
          {
            height: activeLayout.compassSize,
            marginTop: activeLayout.compassMarginTop,
          },
        ]}
      >
        <CompassContainer rotation={rotation} size={activeLayout.compassSize} />
      </View>

      {/* Distance */}
      <DistanceDisplay distanceFormatted={distanceFormatted} mode={mode} layout={activeLayout} />

      {/* No magnetometer note */}
      {hasMagnetometer === false && (
        <Text style={styles.noMagText} maxFontSizeMultiplier={FontScaleCap.body}>
          Tvůj telefon nemá kompas, šipka se nebude otáčet.
        </Text>
      )}

      {/* Flex spacer — mirrors the iBYAN spacer in the Pencil design */}
      <View style={styles.flexSpacer} />

      {/* Pub pill */}
      <View style={[styles.pubPillWrap, { paddingBottom: activeLayout.pubPillPaddingBottom }]}>
        {showPubDetails && pub !== null ? (
          <RevealedPubPill
            pubName={pub.name}
            pubKey={geohash8(pub.lat, pub.lng)}
            mapInfo={pubInfoFromPub(pub)}
            onOpenMaps={handleOpenMaps}
            onReport={handleReport}
            onContribute={handleContribute}
            onAddPub={handleAddPub}
            isOpenNow={pub.isOpenNow ?? null}
            hoursStatus={pub.hoursStatus}
            nextChange={pub.nextChange}
            beers={pub.beers}
            rating={pub.rating}
            ratingCount={pub.ratingCount}
            hasGarden={pub.hasGarden}
          />
        ) : (
          <HiddenPubPill onReveal={reveal} />
        )}
      </View>

      {/* Bottom controls: mode toggle pill + reroll button, side by side */}
      <View
        style={[
          styles.bottomControls,
          {
            paddingTop: activeLayout.bottomControlsPaddingTop,
            paddingBottom: activeLayout.bottomControlsPaddingBottom,
          },
        ]}
      >
        <View style={styles.modeToggleFlex}>
          <ModeToggle
            mode={mode}
            onNearest={() => handleModeChange('nearest')}
            onSurprise={() => handleModeChange('surprise')}
          />
        </View>
        <Pressable
          onPress={mode === 'surprise' ? reroll : skip}
          style={styles.rerollButton}
          hitSlop={12}
          accessibilityLabel={mode === 'surprise' ? cs.a11y.rerollButton : cs.a11y.skipButton}
          accessibilityHint={mode === 'surprise' ? undefined : cs.a11y.skipButtonHint}
          accessibilityRole="button"
        >
          <RefreshCwIcon size={18} color={Colors.foamMuted} />
        </Pressable>
      </View>

      <BeerBrandFilterSheet
        visible={filterSheetOpen}
        value={beerBrandFilter}
        onClose={handleCloseFilter}
        onSelect={setBeerBrandFilter}
      />
      <ReportPubModal
        visible={reportOpen}
        pubName={pub.name}
        onClose={handleReportClose}
        onRename={handleRenamePress}
        onReportReason={handleReportReason}
      />
      <RenamePubModal
        visible={renameOpen}
        currentName={pub.name}
        value={renameDraft}
        submitting={renameSubmitting}
        onChange={setRenameDraft}
        onCancel={handleRenameCancel}
        onSubmit={handleRenameSubmit}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
  },
  reportOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  reportScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: withAlpha(Colors.black, 0.68),
  },
  reportPanel: {
    marginHorizontal: 14,
    marginBottom: 18,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.34),
    backgroundColor: Colors.stout2,
    padding: 18,
    gap: 16,
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.36,
    shadowRadius: 24,
    elevation: 16,
  },
  reportHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  reportIconWell: {
    width: 42,
    height: 42,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.28),
  },
  reportTitleWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  reportTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 25,
    lineHeight: 30,
    color: Colors.foam,
  },
  reportBody: {
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.foamMuted,
  },
  reportActions: {
    gap: 10,
  },
  reportAction: {
    minHeight: 54,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.28),
    backgroundColor: Colors.stout3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    gap: 10,
  },
  reportActionMuted: {
    borderColor: Colors.border,
    backgroundColor: withAlpha(Colors.stout3, 0.86),
  },
  reportActionDanger: {
    borderColor: withAlpha(Colors.amber, 0.42),
    backgroundColor: withAlpha(Colors.glow, 0.13),
  },
  reportActionGhost: {
    borderColor: Colors.border,
    backgroundColor: withAlpha(Colors.stout, 0.45),
  },
  reportActionPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.985 }],
  },
  reportActionIcon: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportActionIconSpacer: {
    width: 24,
  },
  reportActionText: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
    fontFamily: Fonts.ui.bold,
    fontSize: 16,
    color: Colors.foam,
  },
  reportActionTextDanger: {
    color: Colors.amberLight,
  },
  reportActionTextGhost: {
    color: Colors.foamMuted,
  },
  renameOverlay: {
    flex: 1,
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
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
    maxWidth: 200,
    paddingLeft: 12,
    paddingRight: 12,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
  },
  filterButtonActive: {
    borderColor: Colors.amber,
    backgroundColor: withAlpha(Colors.amber, 0.12),
    paddingRight: 4,
  },
  filterButtonText: {
    flexShrink: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.foamMuted,
  },
  filterButtonTextActive: {
    color: Colors.amberLight,
  },
  filterButtonClear: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  },
  flexSpacer: {
    flex: 1,
    minHeight: Spacing.xs,
  },

  // ── Focused compass (friend handoff) ──
  focusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  focusBackButton: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusKickerWrap: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  focusKicker: {
    flexShrink: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 12,
    letterSpacing: 1.5,
    color: Colors.amber,
  },
  focusCompassArea: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.lg,
  },
  focusInfo: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    marginTop: Spacing.xl,
    gap: Spacing.sm,
  },
  focusPubName: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 26,
    lineHeight: 32,
    color: Colors.foam,
    textAlign: 'center',
  },
  focusDistance: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 40,
    lineHeight: 46,
    color: Colors.amber,
  },
  focusBackWrap: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },

  // ── Distance ──
  distanceWrap: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
  },
  distanceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  distanceNumber: {
    fontFamily: Fonts.display.extrabold,
    color: Colors.foam,
    includeFontPadding: false,
  },
  distanceUnit: {
    fontFamily: Fonts.display.extrabold,
    color: Colors.amber,
    includeFontPadding: false,
  },
  distanceCaption: {
    fontFamily: Fonts.ui.bold,
    fontStyle: 'italic',
    fontSize: 14,
    color: Colors.mutedText,
    // The big numeral's line box leaves slack beneath the baseline; pull the
    // caption up into it so it reads as one tight unit with the distance.
    marginTop: -8,
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
  },
  pubPill: {
    minHeight: PUB_PILL_MIN_HEIGHT,
    borderRadius: Radius.card,
    paddingHorizontal: 18,
    paddingVertical: 14,
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
    alignSelf: 'stretch',
    justifyContent: 'center',
    gap: 10,
    height: 38,
  },
  pubPillHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
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
  pubPillTapArea: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: 8,
  },
  revealedNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: 10,
    height: 38,
  },
  // Open-status (shrinks first) on the left, rating pinned to the right.
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: 18,
  },
  metaStatus: {
    flexShrink: 1,
    minWidth: 0,
  },
  beerLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    // Bound the row to the card width so a long "Pilsner Urquell 12° · 50 Kč ·
    // a další" line ellipsizes instead of overflowing. A pub with several beers
    // collapses to one lead-beer line via formatBeerLine, but that single line
    // itself can be long, so the cap matters even though the row never wraps.
    maxWidth: '100%',
  },
  beerLineText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.foamMuted,
    letterSpacing: 0.2,
    // Shrink past the fixed icon so numberOfLines={1} can ellipsize the text.
    flexShrink: 1,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    minHeight: 18,
  },
  ratingText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.foam,
  },
  gardenBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    minHeight: 18,
  },
  gardenBadgeText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.foamMuted,
  },
  pubPillFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginTop: 2,
    paddingTop: 8,
    paddingHorizontal: 4,
    paddingBottom: 4,
    borderRadius: Radius.medium,
    backgroundColor: withAlpha(Colors.stout, 0.34),
  },
  footerAction: {
    flex: 1,
    flexDirection: 'row',
    minWidth: 0,
    minHeight: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 6,
  },
  footerActionPrimary: {
    flex: 1.28,
    borderRadius: 12,
    backgroundColor: Colors.amber,
    shadowColor: Colors.glow,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  footerActionPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },
  footerActionText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 10.8,
    lineHeight: 13,
    color: Colors.foamMuted,
    textAlign: 'center',
    flexShrink: 1,
  },
  footerActionTextPrimary: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 11.5,
    lineHeight: 14,
    color: Colors.stout,
    textAlign: 'center',
    flexShrink: 1,
  },

  // ── Mode toggle ──
  bottomControls: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  modeToggleFlex: {
    flex: 1,
    minWidth: 0,
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
    // Keep horizontal padding small: the segments already split the pill 50/50
    // via flex, and a larger value leaves "Překvap mě" too little room at big
    // system font sizes, wrapping it onto two lines.
    paddingHorizontal: 10,
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
    includeFontPadding: false,
    textAlign: 'center',
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
    paddingHorizontal: 4,
  },
  emptySecondaryActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: Spacing.lg,
  },
  emptyRetryText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.mutedText,
  },
});
