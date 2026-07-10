/**
 * PhotoDiarySection — the "PIVNÍ FOTKY" block on the profile tab.
 *
 * A horizontal strip whose first tile adds a photo (dashed amber affordance)
 * followed by the newest diary photos — the lead photo is deliberately larger
 * than the rest so the strip reads as a living album, not a uniform grid.
 * Pending/failed uploads carry a small sync chip. The header links to the
 * FotoPivař contest.
 *
 * This section OWNS the whole capture flow (source sheet → picker → compose
 * sheet) and the diary bootstrap (loadBeerPhotos: hydrate + server reconcile),
 * so ProfileScreen only mounts it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { showAppDialog } from '@/components/shared/AppDialog';
import { GlowButton } from '@/components/shared/GlowButton';
import {
  CameraIcon,
  ChevronRightIcon,
  InfoIcon,
  RefreshCwIcon,
  TrophyIcon,
} from '@/components/shared/IconGlyph';
import { openSystemSettings } from '@/compass/permissions';
import { pickAndPrepareBeerPhoto, type BeerPhotoSource } from '@/data/beerPhotoPicker';
import { cs } from '@/i18n/cs';
import { BeerPhotoComposeSheet } from '@/photos/BeerPhotoComposeSheet';
import { BeerPhotoSourceSheet } from '@/photos/BeerPhotoSourceSheet';
import { ScalePressable } from '@/photos/ScalePressable';
import { loadBeerPhotos, useBeerPhotosStore, type BeerPhotoLocal } from '@/stores/beerPhotosStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
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

export function PhotoDiarySection() {
  const router = useRouter();
  const showToast = useToastStore((s) => s.show);
  const photos = useBeerPhotosStore((s) => s.photos);

  const [sourceVisible, setSourceVisible] = useState(false);
  const [composeUri, setComposeUri] = useState<string | null>(null);
  // Synchronous double-fire guard — the sheet rows stay tappable through the
  // fade-out (ScanMenuSheet caller idiom).
  const pickInFlightRef = useRef(false);

  // Diary bootstrap: hydrate the persisted view, then reconcile with the server.
  useEffect(() => {
    const controller = new AbortController();
    void loadBeerPhotos(controller.signal);
    return () => controller.abort();
  }, []);

  const handlePick = useCallback(
    async (source: BeerPhotoSource) => {
      if (pickInFlightRef.current) return;
      pickInFlightRef.current = true;
      try {
        const picked = await pickAndPrepareBeerPhoto(source);
        if (picked.status === 'cancelled') return;
        if (picked.status === 'denied') {
          showToast(
            source === 'camera'
              ? cs.photoDiary.permissionCameraBody
              : cs.photoDiary.permissionLibraryBody,
            { icon: <CameraIcon size={18} color={Colors.amber} /> },
          );
          return;
        }
        if (picked.status === 'denied-permanent') {
          showAppDialog({
            title: cs.photoDiary.title,
            message: cs.photoDiary.permissionBlockedBody,
            buttons: [
              { text: cs.common.cancel, style: 'cancel' },
              { text: cs.photoDiary.openSettings, onPress: () => void openSystemSettings() },
            ],
          });
          return;
        }
        if (picked.status === 'error') {
          showToast(cs.photoDiary.errorPick, {
            icon: <InfoIcon size={18} color={Colors.foamMuted} />,
          });
          return;
        }
        setComposeUri(picked.uri);
      } finally {
        pickInFlightRef.current = false;
      }
    },
    [showToast],
  );

  const openCapture = useCallback(() => setSourceVisible(true), []);

  const strip = useMemo<StripItem[]>(
    () => [
      { kind: 'add' },
      ...photos.slice(0, STRIP_LIMIT).map((photo) => ({ kind: 'photo', photo }) as StripItem),
    ],
    [photos],
  );

  return (
    <>
      {/* Section header: title + count · FotoPivař contest link */}
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

      {photos.length === 0 ? (
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

      <BeerPhotoSourceSheet
        visible={sourceVisible}
        onClose={() => setSourceVisible(false)}
        onPick={(source) => {
          setSourceVisible(false);
          void handlePick(source);
        }}
      />

      {composeUri ? (
        <BeerPhotoComposeSheet
          pickedUri={composeUri}
          onClose={() => setComposeUri(null)}
          onSaved={() => {
            setComposeUri(null);
            showToast(cs.photoDiary.saved, {
              icon: <CameraIcon size={18} color={Colors.amber} />,
            });
          }}
        />
      ) : null}
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
    fontFamily: Fonts.ui.bold,
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
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    color: Colors.amber,
  },

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
    fontFamily: Fonts.ui.semibold,
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
    fontFamily: Fonts.ui.bold,
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
    fontFamily: Fonts.display.extrabold,
    fontSize: 19,
    color: Colors.foam,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  emptyBody: {
    fontFamily: Fonts.ui.regular,
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
