/**
 * ShareNightModal — preview + share of the 9:16 night story image.
 *
 * The story card renders once at its full logical size and is scaled down
 * with a transform for the on-screen preview, so what the user sees is
 * pixel-identical to what gets captured. "Sdílet" rasterizes the very same
 * view via react-native-view-shot at 1080x1920 and hands the PNG to the
 * system share sheet (expo-sharing), where Instagram Stories, messengers and
 * the photo library all live; there is no Instagram-specific SDK dependency.
 */

import { memo, useCallback, useRef, useState } from 'react';
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
import * as Sharing from 'expo-sharing';

import { Share2Icon, XIcon } from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { amberGlow } from '@/theme/shadows';
import {
  NightStoryCard,
  STORY_HEIGHT,
  STORY_WIDTH,
} from '@/vycep/NightStoryCard';
import type { NightSummary } from '@/vycep/nightModel';

/** Export size for Instagram Stories. */
const EXPORT_WIDTH = 1080;
const EXPORT_HEIGHT = 1920;

interface ShareNightModalProps {
  visible: boolean;
  night: NightSummary;
  onClose: () => void;
}

function ShareNightModalBase({ visible, night, onClose }: ShareNightModalProps) {
  const showToast = useToastStore((s) => s.show);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const cardRef = useRef<RNView>(null);
  const [sharing, setSharing] = useState(false);

  // Fit the fixed-size card into the modal with comfortable chrome space.
  const scale = Math.min(
    (windowWidth - Spacing.xl * 2) / STORY_WIDTH,
    (windowHeight * 0.68) / STORY_HEIGHT,
  );

  const handleShare = useCallback(() => {
    if (sharing) return;
    setSharing(true);
    void (async () => {
      try {
        const uri = await captureRef(cardRef, {
          format: 'png',
          quality: 1,
          result: 'tmpfile',
          width: EXPORT_WIDTH,
          height: EXPORT_HEIGHT,
        });
        const fileUri = uri.startsWith('file://') ? uri : `file://${uri}`;
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'image/png',
            UTI: 'public.png',
            dialogTitle: cs.vycep.storyModalTitle,
          });
        } else {
          // Sharing unavailable (rare, e.g. restricted profiles): fall back to
          // the RN share sheet with the file URL.
          await Share.share({ url: fileUri, message: '' });
        }
      } catch {
        showToast(cs.vycep.storyShareError);
      } finally {
        setSharing(false);
      }
    })();
  }, [sharing, showToast]);

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

        <View style={styles.previewArea}>
          <View
            style={{
              width: STORY_WIDTH * scale,
              height: STORY_HEIGHT * scale,
            }}
          >
            <View
              style={[
                styles.cardHost,
                {
                  transform: [
                    { translateX: (STORY_WIDTH * (scale - 1)) / 2 },
                    { translateY: (STORY_HEIGHT * (scale - 1)) / 2 },
                    { scale },
                  ],
                },
              ]}
            >
              <NightStoryCard ref={cardRef} night={night} />
            </View>
          </View>
        </View>

        <View style={styles.bottom}>
          <Pressable
            onPress={handleShare}
            disabled={sharing}
            accessibilityRole="button"
            accessibilityLabel={cs.a11y.shareNightButton}
            style={({ pressed }) => [
              styles.shareButton,
              (pressed || sharing) && styles.shareButtonPressed,
            ]}
          >
            <Share2Icon size={18} color={Colors.stout} />
            <Text style={styles.shareText} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.vycep.storyShareCta}
            </Text>
          </Pressable>
          <Text style={styles.hint} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.vycep.storyShareHint}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(12, 8, 5, 0.94)',
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
  cardHost: {
    width: STORY_WIDTH,
    height: STORY_HEIGHT,
    borderRadius: Radius.medium,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.8),
  },
  bottom: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
  },
  shareButton: {
    minHeight: 52,
    minWidth: 200,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    ...amberGlow(16),
  },
  shareButtonPressed: {
    opacity: 0.8,
  },
  shareText: {
    fontFamily: Fonts.display.bold,
    fontSize: 17,
    color: Colors.stout,
  },
  hint: {
    fontFamily: Fonts.ui.medium,
    fontSize: 12.5,
    color: Colors.mutedText,
  },
});

export const ShareNightModal = memo(ShareNightModalBase);
