/**
 * BeerPhotoDetailScreen — one diary photo, fullscreen (/photo/<key>).
 *
 * The route key is the CLIENT id (stable from the moment a photo is queued,
 * long before the server mints an id), with the server id accepted as a
 * defensive alias. The photo itself is read live from the diary store, so sync
 * state flips (pending → synced) re-render in place.
 *
 * Actions: enter the FotoPivař contest (synced photos only — the backend needs
 * a server id), retry a failed upload (re-enqueue the durable local file), and
 * delete (server delete for synced photos; queue-cancel + local cleanup for
 * pending/failed ones).
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';

import { showAppDialog } from '@/components/shared/AppDialog';
import { GlowButton } from '@/components/shared/GlowButton';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  EyeOffIcon,
  InfoIcon,
  MapPinIcon,
  RefreshCwIcon,
  Trash2Icon,
  TrophyIcon,
  UsersIcon,
} from '@/components/shared/IconGlyph';
import { deleteBeerPhoto } from '@/data/beerPhotosClient';
import {
  deleteBeerPhotoLocalFile,
  enqueueBeerPhoto,
  removeQueuedBeerPhoto,
} from '@/data/beerPhotosQueue';
import { enterPhotoContest } from '@/data/photoContestClient';
import { cs } from '@/i18n/cs';
import { loadBeerPhotos, useBeerPhotosStore } from '@/stores/beerPhotosStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

/** "9. července 2026" — the long Czech date for the meta row. */
function longDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * The specific Czech line for a permanently-failed upload (backend code
 * persisted by the queue). Unknown/absent codes fall back to the generic badge.
 */
function failureMessage(code?: string): string {
  switch (code) {
    case 'photo_limit_reached':
      return cs.photoDiary.errorLimitReached;
    case 'photo_too_large':
      return cs.photoDiary.errorTooLarge;
    case 'photo_invalid':
      return cs.photoDiary.errorInvalid;
    default:
      return cs.photoDiary.failedBadge;
  }
}

function MetaRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={styles.metaRow}>
      {icon}
      <Text style={styles.metaText} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
        {text}
      </Text>
    </View>
  );
}

export default function BeerPhotoDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const showToast = useToastStore((s) => s.show);
  const removePhoto = useBeerPhotosStore((s) => s.removePhoto);

  const params = useLocalSearchParams<{ key?: string | string[] }>();
  const key = useMemo(() => {
    const raw = params.key;
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === 'string' ? value : '';
  }, [params.key]);

  const photo = useBeerPhotosStore((s) =>
    s.photos.find((p) => p.clientId === key || p.id === key),
  );

  const [busy, setBusy] = useState(false);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/profile' as Href);
  }, [router]);

  const doDelete = useCallback(async () => {
    if (!photo || busy) return;
    setBusy(true);
    try {
      if (photo.syncState === 'synced' && photo.id) {
        const res = await deleteBeerPhoto(photo.id);
        if (!res.ok) {
          showToast(cs.photoDiary.deleteError);
          return;
        }
        removePhoto(photo.id);
      } else {
        // Never uploaded (or permanently rejected): cancel the queued op and
        // clean up the durable local JPEG — nothing lives server-side.
        await removeQueuedBeerPhoto(photo.clientId);
        deleteBeerPhotoLocalFile(photo.clientId);
        removePhoto(photo.clientId);
      }
      showToast(cs.photoDiary.deletedToast);
      goBack();
    } finally {
      setBusy(false);
    }
  }, [photo, busy, removePhoto, showToast, goBack]);

  const confirmDelete = useCallback(() => {
    showAppDialog({
      title: cs.photoDiary.deleteConfirmTitle,
      message: cs.photoDiary.deleteConfirmBody,
      buttons: [
        { text: cs.photoDiary.deleteCancel, style: 'cancel' },
        { text: cs.photoDiary.deleteConfirm, style: 'destructive', onPress: () => void doDelete() },
      ],
    });
  }, [doDelete]);

  const retryUpload = useCallback(() => {
    if (!photo?.localUri) return;
    void enqueueBeerPhoto({
      clientId: photo.clientId,
      localUri: photo.localUri,
      caption: photo.caption,
      pubCacheKey: photo.pubCacheKey || undefined,
      pubName: photo.pubName || undefined,
      pubCity: photo.pubCity || undefined,
      visibility: photo.visibility,
      takenAt: photo.takenAt,
    });
    showToast(cs.photoDiary.retryQueuedToast, {
      icon: <RefreshCwIcon size={18} color={Colors.amber} />,
    });
  }, [photo, showToast]);

  const enterContest = useCallback(async () => {
    if (!photo?.id || busy) return;
    setBusy(true);
    try {
      const res = await enterPhotoContest(photo.id);
      if (res.ok) {
        showToast(cs.photoContest.enteredToast, {
          icon: <TrophyIcon size={18} color={Colors.amber} />,
        });
        // Reconcile inContest on the stored photo, then show the arena.
        void loadBeerPhotos();
        router.push('/photo-contest' as Href);
        return;
      }
      if (res.code === 'nickname_required') {
        showToast(cs.photoContest.errorNicknameRequired);
        return;
      }
      showToast(res.detail || cs.photoContest.errorEnter);
    } finally {
      setBusy(false);
    }
  }, [photo, busy, showToast, router]);

  // Entering makes the photo visible to EVERY contest viewer — even a "Jen pro
  // mě" one — so this always goes through the same exposure confirm dialog as
  // the contest screen's enter strip.
  const confirmEnterContest = useCallback(() => {
    showAppDialog({
      title: cs.photoContest.enterConfirmTitle,
      message: cs.photoContest.enterConfirmBody,
      buttons: [
        { text: cs.common.cancel, style: 'cancel' },
        { text: cs.photoContest.enterCta, onPress: () => void enterContest() },
      ],
    });
  }, [enterContest]);

  const uri = photo ? photo.imageUrl ?? photo.localUri : undefined;

  return (
    <View style={[styles.root, { paddingTop: insets.top + Spacing.sm }]}>
      {/* Header — back · title · delete */}
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.backButton}
          style={({ pressed }) => [styles.headerBtn, pressed && styles.dim]}
        >
          <ChevronLeftIcon size={26} color={Colors.foam} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
          {cs.photoDiary.detailTitle}
        </Text>
        {photo ? (
          <Pressable
            onPress={confirmDelete}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={cs.a11y.photoDelete}
            style={({ pressed }) => [styles.headerBtn, pressed && styles.dim]}
          >
            <Trash2Icon size={20} color={Colors.foamMuted} />
          </Pressable>
        ) : (
          <View style={styles.headerBtn} />
        )}
      </View>

      {!photo ? (
        <View style={styles.missingWrap}>
          <Text style={styles.missingText} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.photoDiary.detailMissing}
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xl }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.photoCard}>
            {uri ? (
              <Image
                source={{ uri }}
                style={styles.photo}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
              />
            ) : (
              <View style={styles.photo} />
            )}
          </View>

          {/* Sync state (pending / failed + retry) */}
          {photo.syncState === 'pending' ? (
            <View style={styles.syncRow}>
              <RefreshCwIcon size={15} color={Colors.foamMuted} />
              <Text style={styles.syncText} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.photoDiary.pendingBadge}
              </Text>
            </View>
          ) : null}
          {photo.syncState === 'failed' ? (
            <View style={styles.syncRow}>
              <InfoIcon size={15} color={Colors.glow} />
              <Text style={[styles.syncText, styles.syncTextFailed]} maxFontSizeMultiplier={FontScaleCap.body}>
                {failureMessage(photo.failureCode)}
              </Text>
              {/* A full album can never succeed on retry — the message above
                  already says what to do (delete an older photo first). */}
              {photo.failureCode !== 'photo_limit_reached' && photo.localUri ? (
                <Pressable
                  onPress={retryUpload}
                  style={({ pressed }) => [styles.retryPill, pressed && styles.dim]}
                  accessibilityRole="button"
                  accessibilityLabel={cs.a11y.photoRetry}
                  hitSlop={6}
                >
                  <Text style={styles.retryPillText} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.photoDiary.retryUpload}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {photo.caption ? (
            <Text style={styles.caption} maxFontSizeMultiplier={FontScaleCap.body}>
              {photo.caption}
            </Text>
          ) : null}

          <View style={styles.metaCard}>
            {photo.pubName ? (
              <MetaRow
                icon={<MapPinIcon size={16} color={Colors.amber} />}
                text={[photo.pubName, photo.pubCity].filter(Boolean).join(' · ')}
              />
            ) : null}
            {longDate(photo.takenAt) ? (
              <MetaRow
                icon={<ClockIcon size={16} color={Colors.mutedText} />}
                text={longDate(photo.takenAt)}
              />
            ) : null}
            <MetaRow
              icon={
                photo.visibility === 'friends' ? (
                  <UsersIcon size={16} color={Colors.mutedText} />
                ) : (
                  <EyeOffIcon size={16} color={Colors.mutedText} />
                )
              }
              text={
                photo.visibility === 'friends'
                  ? cs.photoDiary.visibilityFriends
                  : cs.photoDiary.visibilityPrivate
              }
            />
          </View>

          {/* — FotoPivař — */}
          {photo.inContest ? (
            <Pressable
              onPress={() => router.push('/photo-contest' as Href)}
              style={({ pressed }) => [styles.contestNote, pressed && styles.dim]}
              accessibilityRole="button"
              accessibilityLabel={cs.a11y.photoContestLink}
            >
              <TrophyIcon size={18} color={Colors.amber} />
              <View style={styles.contestNoteText}>
                <Text style={styles.contestNoteTitle} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.photoDiary.inContestNote}
                </Text>
                <Text style={styles.contestNoteLink} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.photoDiary.openContest}
                </Text>
              </View>
              <ChevronRightIcon size={16} color={Colors.mutedText} />
            </Pressable>
          ) : photo.syncState === 'synced' && photo.id ? (
            <View style={styles.contestCta}>
              <GlowButton
                label={cs.photoDiary.enterContestCta}
                onPress={confirmEnterContest}
                glow="soft"
                height={56}
                icon={<TrophyIcon size={18} color={Colors.stout} />}
              />
              <Text style={styles.contestHint} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.photoDiary.enterContestHint}
              </Text>
            </View>
          ) : (
            <Text style={styles.contestHint} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.photoDiary.syncBeforeContest}
            </Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
    paddingHorizontal: Spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  headerBtn: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
  },
  dim: {
    opacity: 0.6,
  },

  missingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: Spacing.xxl,
  },
  missingText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 15,
    color: Colors.mutedText,
    textAlign: 'center',
  },

  content: {
    paddingTop: Spacing.md,
    gap: Spacing.md,
  },
  photoCard: {
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout3,
    overflow: 'hidden',
  },
  photo: {
    width: '100%',
    aspectRatio: 4 / 5,
    backgroundColor: Colors.stout3,
  },

  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  syncText: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.foamMuted,
  },
  syncTextFailed: {
    color: Colors.glow,
  },
  retryPill: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.14),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.4),
  },
  retryPillText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.amber,
  },

  caption: {
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.foam,
  },

  metaCard: {
    gap: Spacing.sm + 2,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  metaText: {
    flex: 1,
    fontFamily: Fonts.ui.medium,
    fontSize: 14,
    color: Colors.foamMuted,
  },

  contestNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.35),
    padding: Spacing.md,
  },
  contestNoteText: {
    flex: 1,
    gap: 2,
  },
  contestNoteTitle: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.foam,
  },
  contestNoteLink: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.amber,
  },
  contestCta: {
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  contestHint: {
    fontFamily: Fonts.ui.regular,
    fontSize: 12,
    lineHeight: 17,
    color: Colors.mutedText,
    textAlign: 'center',
  },
});
