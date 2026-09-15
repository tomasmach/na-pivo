/**
 * PublishNightSheet — the explicit consent moment of the Výčep. Publishing a
 * night is never automatic: this sheet shows exactly what will hang on the
 * feed (tally, pubs, date, length), states what never leaves the diary
 * (money, location, individual beers) and lets the user pick the audience.
 *
 * Publishing goes through the durable nights queue, so tapping "Vyvěsit" in a
 * cellar pub with no signal still lands honestly once the phone comes back
 * online (the toast says which of the two happened).
 */

import { memo, useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { showAppDialog } from '@/components/shared/AppDialog';
import { HandPlatterIcon, MapPinIcon, XIcon } from '@/components/shared/IconGlyph';
import {
  isRetriableNightError,
  publishNight,
  type NightVisibility,
} from '@/data/nightsClient';
import { enqueueNightOp } from '@/data/nightsQueue';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { cs } from '@/i18n/cs';
import { beerCountLabel } from '@/i18n/plural';
import { formatEveningDate } from '@/myBeers/eveningModel';
import SegmentedControl from '@/friends/SegmentedControl';
import { useAccountStore } from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';
import { useVycepStore } from '@/stores/vycepStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { TallyMarks } from '@/vycep/TallyMarks';
import type { NightSummary } from '@/vycep/nightModel';

interface PublishNightSheetProps {
  visible: boolean;
  night: NightSummary;
  onClose: () => void;
  onPublished?: () => void;
}

const VISIBILITIES: readonly [NightVisibility, NightVisibility] = ['friends', 'public'];

function PublishNightSheetBase({
  visible,
  night,
  onClose,
  onPublished,
}: PublishNightSheetProps) {
  const showToast = useToastStore((s) => s.show);
  const profile = useAccountStore((s) => s.profile);
  const publishedRecord = useVycepStore((s) => s.published[night.clientKey]);
  const markPublished = useVycepStore((s) => s.markPublished);

  const [visibilityIndex, setVisibilityIndex] = useState<0 | 1>(
    publishedRecord?.visibility === 'public' ? 1 : 0,
  );
  const [busy, setBusy] = useState(false);
  const visibility = VISIBILITIES[visibilityIndex];

  // Re-sync the preselected audience each time the sheet opens (the modal
  // stays mounted with the screen). Derived-state-during-render idiom, so no
  // effect and no extra committed render with stale state.
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) setVisibilityIndex(publishedRecord?.visibility === 'public' ? 1 : 0);
  }

  const now = useMemo(() => new Date(), []);

  const handlePublish = useCallback(() => {
    if (busy) return;
    if (visibility === 'public' && !profile?.nickname) {
      showAppDialog({
        title: cs.vycep.nicknameNeededTitle,
        message: cs.vycep.nicknameNeededBody,
      });
      return;
    }

    trackUiInteraction('night_publish', 'submit');
    setBusy(true);
    const payload = {
      clientId: night.clientKey,
      drinkingDay: night.drinkingDay,
      startedAt: night.startedAt,
      endedAt: night.endedAt,
      beerCount: night.beerCount,
      wineCount: night.wineCount,
      softDrinkCount: night.softDrinkCount,
      shotCount: night.shotCount,
      pubNames: night.pubNames,
      ...(night.city ? { city: night.city } : {}),
      ...(night.durationMinutes !== undefined
        ? { durationMinutes: night.durationMinutes }
        : {}),
      visibility,
      updatedAt: new Date().toISOString(),
    };

    void publishNight(payload).then((res) => {
      setBusy(false);
      if (res.ok) {
        trackUiInteraction('night_publish', 'success');
        markPublished(night.clientKey, visibility);
        showToast(cs.vycep.publishedToast, {
          icon: <HandPlatterIcon size={20} color={Colors.amber} />,
        });
        onPublished?.();
        onClose();
        return;
      }
      if (isRetriableNightError(res)) {
        trackUiInteraction('night_publish', 'success');
        // Offline / transient: hand the publish to the durable queue and keep
        // the optimistic published state (it WILL land).
        void enqueueNightOp({ op: 'publish', payload });
        markPublished(night.clientKey, visibility);
        showToast(cs.vycep.publishQueuedToast, {
          icon: <HandPlatterIcon size={20} color={Colors.amber} />,
        });
        onPublished?.();
        onClose();
        return;
      }
      trackUiInteraction('night_publish', 'failure');
      showToast(res.detail);
    });
  }, [
    busy,
    markPublished,
    night,
    onClose,
    onPublished,
    profile?.nickname,
    showToast,
    visibility,
  ]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.vycep.publishTitle}
            </Text>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={cs.common.cancel}
            >
              <XIcon size={18} color={Colors.mutedText} />
            </Pressable>
          </View>

          {/* Preview of exactly what the feed will show. */}
          <View style={styles.preview}>
            <Text style={styles.previewDate} maxFontSizeMultiplier={FontScaleCap.body}>
              {formatEveningDate(night.startedAt, now)}
            </Text>
            {night.beerCount > 0 ? (
              <>
                <TallyMarks count={night.beerCount} color={Colors.amber} markHeight={22} />
                <Text style={styles.previewCount} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {beerCountLabel(night.beerCount)}
                </Text>
              </>
            ) : null}
            {night.pubNames.length > 0 ? (
              <View style={styles.previewPubs}>
                <MapPinIcon size={13} color={Colors.mutedText} />
                <Text
                  style={styles.previewPubsText}
                  numberOfLines={2}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {night.pubNames.join('  →  ')}
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.vycep.publishBody}
          </Text>

          <Text style={styles.visibilityLabel} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.vycep.visibilityLabel}
          </Text>
          <SegmentedControl
            options={[cs.vycep.scopeParta, cs.vycep.scopeWorld]}
            value={visibilityIndex}
            onChange={setVisibilityIndex}
            accessibilityLabel={cs.vycep.visibilityLabel}
          />
          <Text style={styles.visibilityHint} maxFontSizeMultiplier={FontScaleCap.body}>
            {visibility === 'public'
              ? cs.vycep.visibilityWorldHint
              : cs.vycep.visibilityFriendsHint}
          </Text>

          <Pressable
            onPress={handlePublish}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={cs.a11y.publishNightButton}
            style={({ pressed }) => [
              styles.publishButton,
              (pressed || busy) && styles.publishButtonPressed,
            ]}
          >
            <HandPlatterIcon size={18} color={Colors.stout} />
            <Text style={styles.publishText} maxFontSizeMultiplier={FontScaleCap.heading}>
              {publishedRecord ? cs.vycep.updateCta : cs.vycep.publishCta}
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
    justifyContent: 'center',
    padding: Spacing.lg,
    backgroundColor: 'rgba(12, 8, 5, 0.72)',
  },
  sheet: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  title: {
    flex: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
  },
  close: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  preview: {
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.7),
    backgroundColor: Colors.stout,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  previewDate: {
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: Colors.mutedText,
  },
  previewCount: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 20,
    color: Colors.foam,
  },
  previewPubs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + 2,
  },
  previewPubsText: {
    flex: 1,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.foamMuted,
  },
  body: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.foamMuted,
  },
  visibilityLabel: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: Colors.amber,
  },
  visibilityHint: {
    fontFamily: Fonts.ui.medium,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.mutedText,
  },
  publishButton: {
    marginTop: Spacing.xs,
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  publishButtonPressed: {
    opacity: 0.8,
  },
  publishText: {
    fontFamily: Fonts.display.bold,
    fontSize: 16,
    color: Colors.stout,
  },
});

export const PublishNightSheet = memo(PublishNightSheetBase);
