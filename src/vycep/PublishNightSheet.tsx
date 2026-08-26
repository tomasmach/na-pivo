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

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showAppDialog } from '@/components/shared/AppDialog';
import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import { HandPlatterIcon, MapPinIcon } from '@/components/shared/IconGlyph';
import { isRetriableNightError, publishNight, type NightVisibility } from '@/data/nightsClient';
import { enqueueNightOp } from '@/data/nightsQueue';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { t , beerCountLabel } from '@/i18n';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { formatEveningDate } from '@/myBeers/eveningModel';
import SegmentedControl from '@/friends/SegmentedControl';
import { useAccountStore } from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';
import { useVycepStore } from '@/stores/vycepStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { TallyMarks } from '@/vycep/TallyMarks';
import type { NightSummary } from '@/vycep/nightModel';

interface PublishNightSheetProps {
  visible: boolean;
  night: NightSummary;
  onClose: () => void;
  onPublished?: () => void;
}

const VISIBILITIES: readonly [NightVisibility, NightVisibility] = ['friends', 'public'];
const SHEET_DISMISS_MS = 260;

function PublishNightSheetBase({ visible, night, onClose, onPublished }: PublishNightSheetProps) {
  const showToast = useToastStore((s) => s.show);
  const insets = useSafeAreaInsets();
  const profile = useAccountStore((s) => s.profile);
  const publishedRecord = useVycepStore((s) => s.published[night.clientKey]);
  const markPublished = useVycepStore((s) => s.markPublished);

  const [visibilityIndex, setVisibilityIndex] = useState<0 | 1>(
    publishedRecord?.visibility === 'public' ? 1 : 0,
  );
  const [busy, setBusy] = useState(false);
  const dialogTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  useEffect(
    () => () => {
      if (dialogTimer.current) clearTimeout(dialogTimer.current);
    },
    [],
  );

  const handlePublish = useCallback(() => {
    if (busy) return;
    if (visibility === 'public' && !profile?.nickname) {
      onClose();
      if (dialogTimer.current) clearTimeout(dialogTimer.current);
      dialogTimer.current = setTimeout(() => {
        dialogTimer.current = null;
        showAppDialog({
          title: t.vycep.nicknameNeededTitle,
          message: t.vycep.nicknameNeededBody,
        });
      }, SHEET_DISMISS_MS);
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
      ...(night.durationMinutes !== undefined ? { durationMinutes: night.durationMinutes } : {}),
      visibility,
      updatedAt: new Date().toISOString(),
    };

    void publishNight(payload).then(async (res) => {
      if (res.ok) {
        setBusy(false);
        trackUiInteraction('night_publish', 'success');
        markPublished(night.clientKey, visibility);
        showToast(t.vycep.publishedToast, {
          icon: <HandPlatterIcon size={20} color={Colors.amber} />,
        });
        onPublished?.();
        onClose();
        return;
      }
      if (isRetriableNightError(res)) {
        // Only promise a later publish after the payload is durably on disk.
        const queued = await enqueueNightOp({ op: 'publish', payload }).catch(() => false);
        setBusy(false);
        if (!queued) {
          trackUiInteraction('night_publish', 'failure');
          showToast(t.vycep.publishErrorToast);
          return;
        }
        trackUiInteraction('night_publish', 'success');
        markPublished(night.clientKey, visibility);
        showToast(t.vycep.publishQueuedToast, {
          icon: <HandPlatterIcon size={20} color={Colors.amber} />,
        });
        onPublished?.();
        onClose();
        return;
      }
      setBusy(false);
      trackUiInteraction('night_publish', 'failure');
      showToast(res.detail);
    });
  }, [busy, markPublished, night, onClose, onPublished, profile?.nickname, showToast, visibility]);

  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              {t.vycep.publishTitle}
            </Text>
            <CloseButton onPress={onClose} label={t.common.cancel} />
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
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
              {t.vycep.publishBody}
            </Text>

            <Text style={styles.visibilityLabel} maxFontSizeMultiplier={FontScaleCap.body}>
              {t.vycep.visibilityLabel}
            </Text>
            <SegmentedControl
              options={[t.vycep.scopeParta, t.vycep.scopeWorld]}
              value={visibilityIndex}
              onChange={setVisibilityIndex}
              accessibilityLabel={t.vycep.visibilityLabel}
            />
            <Text style={styles.visibilityHint} maxFontSizeMultiplier={FontScaleCap.body}>
              {visibility === 'public'
                ? t.vycep.visibilityWorldHint
                : t.vycep.visibilityFriendsHint}
            </Text>
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              onPress={handlePublish}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t.a11y.publishNightButton}
              style={({ pressed }) => [
                styles.publishButton,
                (pressed || busy) && styles.publishButtonPressed,
              ]}
            >
              <HandPlatterIcon size={18} color={Colors.stout} />
              <Text style={styles.publishText} maxFontSizeMultiplier={FontScaleCap.heading}>
                {publishedRecord ? t.vycep.updateCta : t.vycep.publishCta}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  cardWrap: { width: '100%', maxHeight: '92%' },
  sheet: {
    flexShrink: 1,
    backgroundColor: Colors.stout,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    paddingTop: Spacing.sm,
    paddingHorizontal: MockLayout.screenPad,
    ...softDrop(),
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.22),
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  title: {
    flex: 1,
    ...MockType.titleS,
    color: Colors.foam,
  },
  list: { flexGrow: 0, flexShrink: 1, marginTop: Spacing.sm },
  listContent: { gap: Spacing.md, paddingBottom: Spacing.sm },
  preview: {
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.7),
    backgroundColor: Colors.stout,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  previewDate: {
    fontWeight: '500',
    fontSize: 12,
    color: Colors.mutedText,
  },
  previewCount: {
    fontWeight: '800',
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
    fontWeight: '500',
    fontSize: 13,
    color: Colors.foamMuted,
  },
  body: {
    fontWeight: '500',
    fontSize: 13,
    lineHeight: 19,
    color: Colors.foamMuted,
  },
  visibilityLabel: {
    ...MockType.bodySemibold,
    color: Colors.foam,
  },
  visibilityHint: {
    fontWeight: '500',
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.mutedText,
  },
  publishButton: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  publishButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.97 }],
  },
  publishText: {
    ...MockType.buttonLabel,
    color: Colors.stout,
  },
  actions: {
    paddingTop: Spacing.md,
    marginTop: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
});

export const PublishNightSheet = memo(PublishNightSheetBase);
