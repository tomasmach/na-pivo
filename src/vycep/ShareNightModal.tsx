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

import { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
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

import Svg, {
  Defs,
  LinearGradient as SvgLinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { CopyIcon, Share2Icon, XIcon } from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { formatEveningDate } from '@/myBeers/eveningModel';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { amberGlow } from '@/theme/shadows';
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
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const cardRef = useRef<RNView>(null);
  const [busy, setBusy] = useState(false);

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
    if (busy) return;
    setBusy(true);
    void (async () => {
      try {
        const base64 = await capture('base64');
        await Clipboard.setImageAsync(base64);
        showToast(cs.vycep.storyCopied);
      } catch {
        showToast(cs.vycep.storyShareError);
      } finally {
        setBusy(false);
      }
    })();
  }, [busy, capture, showToast]);

  const handleShare = useCallback(() => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      try {
        const uri = await capture('tmpfile');
        const fileUri = uri.startsWith('file://') ? uri : `file://${uri}`;
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'image/png',
            UTI: 'public.png',
            dialogTitle: cs.vycep.storyModalTitle,
          });
        } else {
          await Share.share({ url: fileUri, message: '' });
        }
      } catch {
        showToast(cs.vycep.storyShareError);
      } finally {
        setBusy(false);
      }
    })();
  }, [busy, capture, showToast]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.topRow}>
          <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.vycep.storyModalTitle}
          </Text>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={cs.common.cancel}
            hitSlop={6}
          >
            <XIcon size={20} color={Colors.foam} />
          </Pressable>
        </View>
        <Text style={styles.subtitle} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.vycep.storyStickerHint}
        </Text>

        <View style={styles.previewArea}>
          <View style={[styles.photoFrame, { width: frameWidth, height: frameHeight }]}>
            {/* Warm stand-in for the user's own story photo. */}
            <Svg width={frameWidth} height={frameHeight} style={StyleSheet.absoluteFill}>
              <Defs>
                <SvgLinearGradient id="frameBg" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#2B1A0E" />
                  <Stop offset="1" stopColor="#120A04" />
                </SvgLinearGradient>
                <RadialGradient id="frameGlow" cx="50%" cy="42%" r="62%">
                  <Stop offset="0" stopColor={Colors.glow} stopOpacity={0.22} />
                  <Stop offset="1" stopColor={Colors.glow} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Rect width={frameWidth} height={frameHeight} fill="url(#frameBg)" />
              <Rect width={frameWidth} height={frameHeight} fill="url(#frameGlow)" />
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
            style={({ pressed }) => [
              styles.primaryButton,
              (pressed || busy) && styles.buttonPressed,
            ]}
          >
            <CopyIcon size={18} color={Colors.stout} />
            <Text style={styles.primaryText} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.vycep.storyCopyCta}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleShare}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={cs.a11y.shareNightButton}
            style={({ pressed }) => [
              styles.secondaryButton,
              (pressed || busy) && styles.buttonPressed,
            ]}
          >
            <Share2Icon size={17} color={Colors.foam} />
            <Text style={styles.secondaryText} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.vycep.storyShareCta}
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
    backgroundColor: '#0E0803',
    paddingTop: 64,
    paddingBottom: 40,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  title: {
    flex: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
  },
  subtitle: {
    marginTop: 2,
    paddingHorizontal: Spacing.lg,
    fontFamily: Fonts.ui.medium,
    fontSize: 13.5,
    lineHeight: 19,
    color: Colors.mutedText,
  },
  close: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.08),
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
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
    borderColor: withAlpha(Colors.border, 0.6),
  },
  cardHost: {
    width: STICKER_WIDTH,
  },
  bottom: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
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
    ...amberGlow(16),
  },
  secondaryButton: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.25),
  },
  buttonPressed: {
    opacity: 0.8,
  },
  primaryText: {
    fontFamily: Fonts.display.bold,
    fontSize: 17,
    color: Colors.stout,
  },
  secondaryText: {
    fontFamily: Fonts.display.bold,
    fontSize: 15,
    color: Colors.foam,
  },
});

export const ShareNightModal = memo(ShareNightModalBase);
