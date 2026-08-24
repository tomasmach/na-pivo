/**
 * ShareNightModal — preview + hand-off of the transparent night sticker.
 *
 * The sticker renders once at its full logical size, is measured via
 * onLayout, and scaled down with a transform for the on-screen preview, so
 * what the user sees is pixel-identical to the export. Primary flow is the
 * Spotify model: copy the transparent PNG to the clipboard, open Instagram,
 * shoot your own story and paste the sticker on top. Secondary flow hands the
 * same PNG to the system share sheet (messengers, photo library).
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type View as RNView,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Svg, {
  Defs,
  LinearGradient as SvgLinearGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { CloseButton } from '@/components/shared/CloseButton';
import { CopyIcon, Share2Icon } from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { formatEveningDate } from '@/myBeers/eveningModel';
import { useToastStore } from '@/stores/toastStore';
import { useModalPresentation } from '@/stores/launchModalMutex';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { MockLayout } from '@/mocks/mockTheme';
import {
  NightStoryCard,
  STICKER_WIDTH,
  stickerHeight,
  type StickerMode,
} from '@/vycep/NightStoryCard';
import type { NightSummary } from '@/vycep/nightModel';

/** Export scale: 330 logical → 990px wide PNG, plenty for a story sticker. */
const EXPORT_SCALE = 3;

interface ShareNightModalProps {
  visible: boolean;
  night: NightSummary;
  onClose: () => void;
  /** 'recap' (default) brags about a finished night; 'live' invites people. */
  mode?: StickerMode;
}

function ShareNightModalBase({
  visible,
  night,
  onClose,
  mode = 'recap',
}: ShareNightModalProps) {
  const showToast = useToastStore((s) => s.show);
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const cardRef = useRef<RNView>(null);
  const exportBusyRef = useRef(false);
  const exportGenerationRef = useRef(0);
  const requestedVisibleRef = useRef(visible);
  const [exportState, setExportState] = useState<{
    action: 'copy' | 'share' | null;
    visible: boolean;
  }>(() => ({ action: null, visible }));
  let exportAction = exportState.action;
  if (exportState.visible !== visible) {
    const next = { action: null, visible };
    setExportState(next);
    exportAction = next.action;
  }
  const presentation = useModalPresentation(visible);
  const busy = exportAction !== null;

  useEffect(() => {
    requestedVisibleRef.current = visible;
    exportGenerationRef.current += 1;
    exportBusyRef.current = false;
  }, [visible]);

  useEffect(
    () => () => {
      exportGenerationRef.current += 1;
      exportBusyRef.current = false;
    },
    [],
  );

  const dateLabel = useMemo(
    () => formatEveningDate(night.startedAt, new Date()),
    [night.startedAt],
  );

  // The sticker's height is deterministic (pure function of the night), so
  // preview scaling and capture size need no onLayout measuring round-trip.
  const cardHeight = stickerHeight(night, mode);

  // The preview sits inside a 9:16 "your story photo" frame so the sticker
  // reads as an overlay, not as lost floating text. Fit the frame into the
  // chrome, then fit the sticker into the frame.
  const frameHeight = Math.min(windowHeight * 0.52, (windowWidth - Spacing.xl * 2) * (16 / 9));
  const frameWidth = frameHeight * (9 / 16);
  const scale = Math.min(
    (frameWidth * 0.92) / STICKER_WIDTH,
    (frameHeight * 0.88) / cardHeight,
  );

  const capture = useCallback(
    (result: 'tmpfile' | 'base64') =>
      captureRef(cardRef, {
        format: 'png',
        quality: 1,
        result,
        width: STICKER_WIDTH * EXPORT_SCALE,
        height: cardHeight * EXPORT_SCALE,
      }),
    [cardHeight],
  );

  const handleCopy = useCallback(() => {
    if (exportBusyRef.current) return;
    exportBusyRef.current = true;
    const generation = ++exportGenerationRef.current;
    setExportState((current) => ({ ...current, action: 'copy' }));
    void (async () => {
      try {
        const base64 = await capture('base64');
        if (
          generation !== exportGenerationRef.current ||
          !requestedVisibleRef.current
        ) return;
        await Clipboard.setImageAsync(base64);
        if (
          generation === exportGenerationRef.current &&
          requestedVisibleRef.current
        ) showToast(cs.vycep.storyCopied);
      } catch {
        if (
          generation === exportGenerationRef.current &&
          requestedVisibleRef.current
        ) showToast(cs.vycep.storyShareError);
      } finally {
        if (generation === exportGenerationRef.current) {
          exportBusyRef.current = false;
          setExportState((current) => ({ ...current, action: null }));
        }
      }
    })();
  }, [capture, showToast]);

  const handleShare = useCallback(() => {
    if (exportBusyRef.current) return;
    exportBusyRef.current = true;
    const generation = ++exportGenerationRef.current;
    setExportState((current) => ({ ...current, action: 'share' }));
    void (async () => {
      try {
        const uri = await capture('tmpfile');
        if (
          generation !== exportGenerationRef.current ||
          !requestedVisibleRef.current
        ) return;
        const fileUri = uri.startsWith('file://') ? uri : `file://${uri}`;
        const sharingAvailable = await Sharing.isAvailableAsync();
        if (
          generation !== exportGenerationRef.current ||
          !requestedVisibleRef.current
        ) return;
        if (sharingAvailable) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'image/png',
            UTI: 'public.png',
            dialogTitle: cs.vycep.storyModalTitle,
          });
        } else {
          await Share.share({ url: fileUri, message: '' });
        }
      } catch {
        if (
          generation === exportGenerationRef.current &&
          requestedVisibleRef.current
        ) showToast(cs.vycep.storyShareError);
      } finally {
        if (generation === exportGenerationRef.current) {
          exportBusyRef.current = false;
          setExportState((current) => ({ ...current, action: null }));
        }
      }
    })();
  }, [capture, showToast]);

  const handleClose = useCallback(() => {
    // Closing always wins, even over a hung capture or share sheet: bumping
    // the generation invalidates every late side effect of the in-flight
    // export, so a slow capture can neither toast nor unblock after close.
    exportGenerationRef.current += 1;
    exportBusyRef.current = false;
    setExportState((current) => ({ ...current, action: null }));
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={presentation.visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleClose}
      onDismiss={presentation.onDismiss}
    >
      <View
        style={[
          styles.backdrop,
          {
            paddingTop: insets.top + Spacing.md,
            paddingBottom: insets.bottom + Spacing.md,
          },
        ]}
      >
        <View style={styles.topRow}>
          <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.vycep.storyModalTitle}
          </Text>
          <CloseButton onPress={handleClose} label={cs.common.cancel} />
        </View>

        <View style={styles.previewArea}>
          <View style={[styles.photoFrame, { width: frameWidth, height: frameHeight }]}>
            {/* Warm stand-in for the user's own story photo. */}
            <Svg width={frameWidth} height={frameHeight} style={StyleSheet.absoluteFill}>
              <Defs>
                <SvgLinearGradient id="frameBg" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#2B1A0E" />
                  <Stop offset="1" stopColor="#120A04" />
                </SvgLinearGradient>
              </Defs>
              <Rect width={frameWidth} height={frameHeight} fill="url(#frameBg)" />
            </Svg>
            <View
              style={{
                width: STICKER_WIDTH * scale,
                height: cardHeight * scale,
              }}
            >
              <View
                style={[
                  styles.cardHost,
                  {
                    transform: [
                      { translateX: (STICKER_WIDTH * (scale - 1)) / 2 },
                      { translateY: (cardHeight * (scale - 1)) / 2 },
                      { scale },
                    ],
                  },
                ]}
              >
                <NightStoryCard
                  ref={cardRef}
                  night={night}
                  dateLabel={dateLabel}
                  mode={mode}
                />
              </View>
            </View>
          </View>
        </View>

        <View style={styles.bottom}>
          <Pressable
            onPress={handleCopy}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={cs.vycep.storyCopyCta}
            accessibilityState={{ disabled: busy, busy: exportAction === 'copy' }}
            style={({ pressed }) => [
              styles.primaryButton,
              (pressed || busy) && styles.buttonPressed,
            ]}
          >
            {exportAction === 'copy' ? (
              <ActivityIndicator size="small" color={Colors.stout} />
            ) : (
              <CopyIcon size={18} color={Colors.stout} />
            )}
            <Text style={styles.primaryText} maxFontSizeMultiplier={FontScaleCap.display}>
              {exportAction === 'copy' ? cs.vycep.storyPreparing : cs.vycep.storyCopyCta}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleShare}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={cs.a11y.shareNightButton}
            accessibilityState={{ disabled: busy, busy: exportAction === 'share' }}
            style={({ pressed }) => [
              styles.secondaryButton,
              (pressed || busy) && styles.buttonPressed,
            ]}
          >
            {exportAction === 'share' ? (
              <ActivityIndicator size="small" color={Colors.foam} />
            ) : (
              <Share2Icon size={17} color={Colors.foam} />
            )}
            <Text style={styles.secondaryText} maxFontSizeMultiplier={FontScaleCap.heading}>
              {exportAction === 'share' ? cs.vycep.storyPreparing : cs.vycep.storyShareCta}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    // Fully opaque: the screen behind showing through made the transparent
    // sticker preview read as broken layout instead of an overlay.
    backgroundColor: Colors.stout,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: MockLayout.screenPad,
    gap: Spacing.sm,
  },
  title: {
    flex: 1,
    fontWeight: '800',
    fontSize: 22,
    color: Colors.foam,
  },
  previewArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
  },
  photoFrame: {
    borderRadius: Radius.card,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.12),
  },
  cardHost: {
    width: STICKER_WIDTH,
  },
  bottom: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: MockLayout.screenPad,
  },
  primaryButton: {
    minHeight: 52,
    minWidth: 230,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  secondaryButton: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  primaryText: {
    fontWeight: '700',
    fontSize: 17,
    color: Colors.stout,
  },
  secondaryText: {
    fontWeight: '700',
    fontSize: 15,
    color: Colors.foam,
  },
});

export const ShareNightModal = memo(ShareNightModalBase);
