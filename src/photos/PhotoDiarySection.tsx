/**
 * PhotoDiarySection — the "PIVNÍ FOTKY" block on the profile tab.
 *
 * A horizontal strip whose first tile adds a photo (dashed amber affordance)
 * followed by the newest diary photos — the lead photo is deliberately larger
 * than the rest so the strip reads as a living album, not a uniform grid.
 * Pending/failed uploads carry a small sync chip. The header links to the
 * FotoPivař contest.
 *
 * The capture flow itself lives in BeerPhotoCaptureFlow (shared with the
 * counter); this section owns the trigger and the diary bootstrap
 * (loadBeerPhotos: hydrate + server reconcile), so ProfileScreen only mounts it.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { GlowButton } from '@/components/shared/GlowButton';
import {
  CameraIcon,
  ChevronRightIcon,
  InfoIcon,
  RefreshCwIcon,
  TrophyIcon,
} from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { MockType } from '@/mocks/mockTheme';
import { BeerPhotoCaptureFlow } from '@/photos/BeerPhotoCaptureFlow';
import { ScalePressable } from '@/photos/ScalePressable';
import { loadBeerPhotos, useBeerPhotosStore, type BeerPhotoLocal } from '@/stores/beerPhotosStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

/** How many photos the strip shows (the full album lives per-photo for now). */
const STRIP_LIMIT = 12;

const LEAD_WIDTH = 148;
const LEAD_HEIGHT = 186;
const TILE_WIDTH = 108;
const TILE_HEIGHT = 136;

/** Short caption/date line for the tile a11y label. */
function tileLabel(photo: BeerPhotoLocal): string {
  return photo.caption || photo.pubName || '';
}

function SyncChip({ state }: { state: 'pending' | 'failed' }) {
  const pending = state === 'pending';
  return (
    <View style={[styles.syncChip, pending ? styles.syncChipPending : styles.syncChipFailed]}>
      {pending ? (
        <RefreshCwIcon size={10} color={Colors.foamMuted} />
      ) : (
        <InfoIcon size={10} color={Colors.stout} />
      )}
      <Text
        style={[styles.syncChipText, !pending && styles.syncChipTextFailed]}
        allowFontScaling={false}
      >
        {pending ? cs.photoDiary.syncPendingShort : cs.photoDiary.syncFailedShort}
      </Text>
    </View>
  );
}

function PhotoTile({
  photo,
  lead,
  onPress,
}: {
  photo: BeerPhotoLocal;
  lead: boolean;
  onPress: () => void;
}) {
  const uri = photo.imageUrl ?? photo.localUri;
  return (
    <ScalePressable
      onPress={onPress}
      style={[styles.tile, lead ? styles.tileLead : styles.tileSmall]}
      accessibilityRole="button"
      accessibilityLabel={cs.a11y.photoTile(tileLabel(photo))}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : null}
      {photo.syncState !== 'synced' ? (
        <SyncChip state={photo.syncState === 'pending' ? 'pending' : 'failed'} />
      ) : null}
    </ScalePressable>
  );
}

function AddTile({ onPress, lead }: { onPress: () => void; lead: boolean }) {
  return (
    <ScalePressable
      onPress={onPress}
      style={[styles.addTile, lead ? styles.tileLead : styles.tileSmall]}
      accessibilityRole="button"
      accessibilityLabel={cs.a11y.photoAddTile}
    >
      <View style={styles.addIconWell}>
        <CameraIcon size={22} color={Colors.amber} />
      </View>
      <Text style={styles.addLabel} maxFontSizeMultiplier={FontScaleCap.body}>
        {cs.photoDiary.addPhoto}
      </Text>
    </ScalePressable>
  );
}

type StripItem = { kind: 'add' } | { kind: 'photo'; photo: BeerPhotoLocal };

/**
 * `full` is the standalone album screen (2.x header pill, composed empty card).
 * `profile` is the same strip inside the 3.0 profile: a section heading with an
 * amber text link (the Odznaky idiom) and a flat empty state — one sentence and
 * one quiet action, because the profile already spends its primary elsewhere.
 */
export type PhotoDiaryVariant = 'full' | 'profile';

export function PhotoDiarySection({ variant = 'full' }: { variant?: PhotoDiaryVariant } = {}) {
  const router = useRouter();
  const photos = useBeerPhotosStore((s) => s.photos);

  const [sourceVisible, setSourceVisible] = useState(false);

  // Diary bootstrap: hydrate the persisted view, then reconcile with the server.
  useEffect(() => {
    const controller = new AbortController();
    void loadBeerPhotos(controller.signal);
    return () => controller.abort();
  }, []);

  const openCapture = useCallback(() => setSourceVisible(true), []);

  const strip = useMemo<StripItem[]>(
    () => [
      { kind: 'add' },
      ...photos.slice(0, STRIP_LIMIT).map((photo) => ({ kind: 'photo', photo }) as StripItem),
    ],
    [photos],
  );

  const profile = variant === 'profile';

  return (
    <>
      {/* Section header: title + count · FotoPivař contest link */}
      {profile ? (
        <View style={styles.profileHeaderRow}>
          <Text style={styles.profileTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.photoDiary.title}
          </Text>
          <Pressable
            onPress={() => router.push('/photo-contest' as Href)}
            style={({ pressed }) => [styles.profileLink, pressed && styles.pressed]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={cs.a11y.photoContestLink}
          >
            <Text style={styles.profileLinkText} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.photoDiary.contestLink}
            </Text>
            <ChevronRightIcon size={16} color={Colors.amber} />
          </Pressable>
        </View>
      ) : (
      <View style={styles.headerRow}>
        <Text style={styles.sectionHeader}>
          {cs.photoDiary.header}
          {photos.length > 0 ? (
            <Text style={styles.sectionCount}>{`  ·  ${cs.photoDiary.photoCount(photos.length)}`}</Text>
          ) : null}
        </Text>
        <Pressable
          onPress={() => router.push('/photo-contest' as Href)}
          style={({ pressed }) => [styles.contestLink, pressed && styles.pressed]}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.photoContestLink}
        >
          <TrophyIcon size={14} color={Colors.amber} />
          <Text style={styles.contestLinkText} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.photoDiary.contestLink}
          </Text>
          <ChevronRightIcon size={14} color={Colors.amber} />
        </Pressable>
      </View>
      )}

      {photos.length === 0 && profile ? (
        /* Flat empty state: one sentence, one quiet action (§20.12, §6.2). */
        <View style={styles.profileEmpty}>
          <Text style={styles.profileEmptyLine} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.photoDiary.emptyProfile}
          </Text>
          <Pressable
            onPress={openCapture}
            style={({ pressed }) => [styles.profileEmptyAction, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={cs.a11y.photoAddTile}
          >
            <Text
              style={styles.profileEmptyActionText}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {cs.photoDiary.addPhoto}
            </Text>
          </Pressable>
        </View>
      ) : photos.length === 0 ? (
        /* Composed empty state — one photo away from an album. */
        <View style={styles.emptyCard}>
          <View style={styles.emptyIconWell}>
            <CameraIcon size={24} color={Colors.amber} />
          </View>
          <Text style={styles.emptyTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.photoDiary.emptyTitle}
          </Text>
          <Text style={styles.emptyBody} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.photoDiary.empty}
          </Text>
          <View style={styles.emptyCta}>
            <GlowButton
              label={cs.photoDiary.addPhoto}
              onPress={openCapture}
              glow="soft"
              height={52}
              icon={<CameraIcon size={18} color={Colors.stout} />}
              accessibilityLabel={cs.a11y.photoAddTile}
            />
          </View>
        </View>
      ) : (
        <FlatList
          horizontal
          data={strip}
          keyExtractor={(item) => (item.kind === 'add' ? 'add' : item.photo.clientId)}
          renderItem={({ item, index }) =>
            item.kind === 'add' ? (
              <AddTile onPress={openCapture} lead={false} />
            ) : (
              <PhotoTile
                photo={item.photo}
                // The newest photo (right after the add tile) leads the strip.
                lead={index === 1}
                onPress={() =>
                  router.push({
                    pathname: '/photo/[key]',
                    params: { key: item.photo.clientId },
                  } as Href)
                }
              />
            )
          }
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.stripContent}
          style={styles.strip}
        />
      )}

      <BeerPhotoCaptureFlow open={sourceVisible} onClose={() => setSourceVisible(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.sm,
    gap: Spacing.sm,
  },
  // Mirrors ProfileScreen's sectionHeader idiom.
  sectionHeader: {
    flex: 1,
    fontWeight: '700',
    fontSize: 11,
    letterSpacing: 1.5,
    color: Colors.amber,
    marginLeft: 4,
  },
  sectionCount: {
    color: Colors.mutedText,
    letterSpacing: 0.5,
  },
  contestLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 32,
    paddingHorizontal: Spacing.sm + 2,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.14),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.4),
  },
  contestLinkText: {
    fontWeight: '600',
    fontSize: 12,
    color: Colors.amber,
  },

  // — Profile (3.0) header: mirrors the Odznaky row in ProfileMockScreen —
  profileHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
  },
  profileTitle: { ...MockType.titleS, flex: 1, color: Colors.foam },
  profileLink: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 32 },
  profileLinkText: { fontSize: 14, fontWeight: '700', color: Colors.amber },

  // — Profile empty state: flat on the ground, no card, no primary —
  profileEmpty: {
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  profileEmptyLine: {
    ...MockType.bodySmall,
    color: Colors.mutedText,
    lineHeight: 20,
  },
  profileEmptyAction: {
    minHeight: 48,
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    paddingHorizontal: Spacing.lg,
  },
  profileEmptyActionText: { fontSize: 14, fontWeight: '700', color: Colors.foam },

  // — Strip —
  strip: {
    // Bleed to the screen edge so the strip scrolls under the content padding.
    marginHorizontal: -Spacing.lg,
  },
  stripContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm + 2,
    alignItems: 'center',
  },
  tile: {
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout3,
    overflow: 'hidden',
  },
  tileLead: {
    width: LEAD_WIDTH,
    height: LEAD_HEIGHT,
  },
  tileSmall: {
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
  },
  addTile: {
    borderRadius: Radius.card,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: withAlpha(Colors.amber, 0.55),
    backgroundColor: withAlpha(Colors.amber, 0.07),
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  addIconWell: {
    width: 44,
    height: 44,
    borderRadius: Radius.medium,
    backgroundColor: withAlpha(Colors.amber, 0.14),
    alignItems: 'center',
    justifyContent: 'center',
  },
  addLabel: {
    fontWeight: '600',
    fontSize: 12,
    color: Colors.amber,
    textAlign: 'center',
    paddingHorizontal: Spacing.xs,
  },

  // — Sync chip —
  syncChip: {
    position: 'absolute',
    top: 6,
    left: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: Radius.pill,
  },
  syncChipPending: {
    backgroundColor: withAlpha(Colors.stout, 0.82),
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.18),
  },
  syncChipFailed: {
    backgroundColor: Colors.glow,
  },
  syncChipText: {
    fontWeight: '700',
    fontSize: 9,
    letterSpacing: 0.4,
    color: Colors.foamMuted,
    textTransform: 'uppercase',
  },
  syncChipTextFailed: {
    color: Colors.stout,
  },

  // — Empty state —
  emptyCard: {
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  emptyIconWell: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: withAlpha(Colors.amber, 0.16),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.4),
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontWeight: '800',
    fontSize: 19,
    color: Colors.foam,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  emptyBody: {
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 19,
    color: Colors.mutedText,
    textAlign: 'center',
    maxWidth: 280,
  },
  emptyCta: {
    alignSelf: 'stretch',
    marginTop: Spacing.sm,
  },

  pressed: {
    opacity: 0.7,
  },
});
