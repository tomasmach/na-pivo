/**
 * PartaPhotoStrip — "ČERSTVĚ CVAKNUTO" on the Parta tab.
 *
 * A horizontal strip of the parta's fresh beer photos (friends-visible, last
 * days) fetched from GET /v1/friends/beer-photos/feed, merged with the user's
 * own recent parta-visible photos from the local diary store — so a photo you
 * just took at the table shows up here immediately, exactly where the parta
 * will see it. Hides entirely when there is nothing fresh.
 *
 * Tiles carry the author's name; tapping opens a read-only fullscreen viewer
 * (same idiom as the friend-profile gallery — no actions apply here).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Image, Modal, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MapPinIcon, XIcon } from '@/components/shared/IconGlyph';
import { fetchPartaPhotoFeed, type PartaFeedPhoto } from '@/data/beerPhotosClient';
import { cs } from '@/i18n/cs';
import { Avatar } from '@/profile/Avatar';
import { ScalePressable } from '@/photos/ScalePressable';
import { selectAvatarUrl, selectNickname, useAccountStore } from '@/stores/accountStore';
import { useBeerPhotosStore } from '@/stores/beerPhotosStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

const TILE_WIDTH = 108;
const TILE_HEIGHT = 136;
const STRIP_LIMIT = 20;
/** Mirrors the server feed window — the strip is a night feed, not an archive. */
const FRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** One strip tile, own or friend's, normalized for rendering. */
interface StripPhoto {
  key: string;
  uri: string;
  name: string;
  avatarUri: string | null;
  avatarInitialSource: string | null;
  caption: string;
  pubName: string;
  pubCity: string;
  takenAt: string;
  mine: boolean;
}

function fromFeed(photo: PartaFeedPhoto): StripPhoto {
  const name = photo.account.nickname ?? photo.account.displayName;
  return {
    key: `feed-${photo.id}`,
    uri: photo.imageUrl,
    name,
    avatarUri: photo.account.avatarUrl,
    avatarInitialSource: name,
    caption: photo.caption,
    pubName: photo.pubName,
    pubCity: photo.pubCity,
    takenAt: photo.takenAt,
    mine: false,
  };
}

interface PartaPhotoStripProps {
  /** Bumped by the parent to refetch alongside the dashboard. */
  refreshKey: number;
  /** Section spacing applied only when the strip actually renders. */
  style?: StyleProp<ViewStyle>;
}

export function PartaPhotoStrip({ refreshKey, style }: PartaPhotoStripProps) {
  const insets = useSafeAreaInsets();
  const ownPhotos = useBeerPhotosStore((s) => s.photos);
  const myNickname = useAccountStore(selectNickname);
  const myAvatarUrl = useAccountStore(selectAvatarUrl);

  const [feed, setFeed] = useState<PartaFeedPhoto[]>([]);
  const [viewer, setViewer] = useState<StripPhoto | null>(null);
  // Snapshotted per fetch (not per render) so the memoized strip stays pure.
  const [freshCutoff, setFreshCutoff] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetchPartaPhotoFeed(controller.signal).then((photos) => {
      if (controller.signal.aborted) return;
      setFreshCutoff(Date.now() - FRESH_WINDOW_MS);
      // A failed fetch keeps the last-known strip rendered (offline idiom).
      if (photos) setFeed(photos);
    });
    return () => controller.abort();
  }, [refreshKey]);

  const strip = useMemo<StripPhoto[]>(() => {
    if (freshCutoff === 0) return [];
    const mine = ownPhotos
      .filter((photo) => {
        if (photo.visibility !== 'friends') return false;
        const taken = Date.parse(photo.takenAt);
        return Number.isFinite(taken) && taken >= freshCutoff;
      })
      .map<StripPhoto>((photo) => ({
        key: `mine-${photo.clientId}`,
        uri: photo.imageUrl ?? photo.localUri ?? '',
        name: cs.partaPhotos.you,
        avatarUri: myAvatarUrl,
        avatarInitialSource: myNickname,
        caption: photo.caption,
        pubName: photo.pubName,
        pubCity: photo.pubCity,
        takenAt: photo.takenAt,
        mine: true,
      }));
    return [...mine, ...feed.map(fromFeed)]
      .filter((photo) => photo.uri.length > 0)
      .sort((a, b) => (a.takenAt < b.takenAt ? 1 : -1))
      .slice(0, STRIP_LIMIT);
  }, [ownPhotos, feed, myAvatarUrl, myNickname, freshCutoff]);

  if (strip.length === 0) return null;

  return (
    <View style={style}>
      <Text style={styles.sectionHeader}>{cs.partaPhotos.header}</Text>
      <FlatList
        horizontal
        data={strip}
        keyExtractor={(photo) => photo.key}
        showsHorizontalScrollIndicator={false}
        style={styles.strip}
        contentContainerStyle={styles.stripContent}
        renderItem={({ item: photo }) => (
          <ScalePressable
            onPress={() => setViewer(photo)}
            style={styles.tile}
            accessibilityRole="button"
            accessibilityLabel={cs.a11y.partaPhotoTile(photo.name)}
          >
            <Image
              source={{ uri: photo.uri }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
            />
            <View style={styles.nameChip}>
              <Avatar
                uri={photo.avatarUri}
                nickname={photo.avatarInitialSource}
                size={16}
              />
              <Text style={styles.nameChipText} numberOfLines={1} allowFontScaling={false}>
                {photo.name}
              </Text>
            </View>
          </ScalePressable>
        )}
      />

      {/* Fullscreen read-only viewer (friend-profile gallery idiom). */}
      <Modal
        visible={viewer != null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setViewer(null)}
      >
        <View style={styles.viewerBackdrop}>
          <Pressable
            onPress={() => setViewer(null)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={cs.a11y.photoViewerClose}
            style={({ pressed }) => [
              styles.viewerClose,
              { top: insets.top + Spacing.sm },
              pressed && styles.dim,
            ]}
          >
            <XIcon size={22} color={Colors.foam} />
          </Pressable>
          {viewer ? (
            <>
              <Image
                source={{ uri: viewer.uri }}
                style={styles.viewerImage}
                resizeMode="contain"
                accessibilityIgnoresInvertColors
              />
              <View style={[styles.viewerMeta, { paddingBottom: insets.bottom + Spacing.lg }]}>
                <Text style={styles.viewerName} maxFontSizeMultiplier={FontScaleCap.body}>
                  {viewer.name}
                </Text>
                {viewer.caption ? (
                  <Text style={styles.viewerCaption} maxFontSizeMultiplier={FontScaleCap.body}>
                    {viewer.caption}
                  </Text>
                ) : null}
                {viewer.pubName ? (
                  <View style={styles.viewerPubRow}>
                    <MapPinIcon size={14} color={Colors.amber} />
                    <Text style={styles.viewerPub} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                      {[viewer.pubName, viewer.pubCity].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                ) : null}
              </View>
            </>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // Mirrors the FriendsScreen section-header idiom.
  sectionHeader: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: Colors.amber,
    marginLeft: 4,
    marginBottom: Spacing.sm,
  },
  strip: {
    // Bleed to the screen edge so the strip scrolls under the content padding.
    marginHorizontal: -Spacing.lg,
  },
  stripContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm + 2,
  },
  tile: {
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout3,
    overflow: 'hidden',
  },
  nameChip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 7,
    paddingVertical: 5,
    backgroundColor: withAlpha(Colors.stout, 0.78),
  },
  nameChipText: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 11,
    color: Colors.foam,
  },

  // — Viewer —
  viewerBackdrop: {
    flex: 1,
    backgroundColor: withAlpha(Colors.stout, 0.96),
    justifyContent: 'center',
  },
  viewerClose: {
    position: 'absolute',
    right: Spacing.lg,
    zIndex: 2,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: withAlpha(Colors.foam, 0.12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerImage: {
    width: '100%',
    flex: 1,
  },
  viewerMeta: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    gap: 6,
  },
  viewerName: {
    fontFamily: Fonts.ui.bold,
    fontSize: 14,
    color: Colors.foam,
  },
  viewerCaption: {
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.foamMuted,
  },
  viewerPubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  viewerPub: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.foamMuted,
  },
  dim: {
    opacity: 0.7,
  },
});
