/**
 * "Kdo kde sedí" — the block the feedback asked for first.
 *
 * Until now Parta could only tell you about a friend who had explicitly
 * broadcast. Ordinary people just drink; they do not file a status update
 * first. So this list is derived from the pub visits the counter already syncs,
 * and a "cinknutí" is demoted to what it actually is: the same fact, plus a
 * push. A row whose friend also broadcast carries the amber "Jdu" door; the
 * rest are simply true.
 *
 * That is also what finally makes the invisible mode mean something. Before, if
 * you wanted to sit somewhere unseen you just… didn't tap the button. Now the
 * switch is the thing that hides you, which is why the last row of this block
 * says out loud whether the party can see you right now.
 *
 * Row anatomy is the counter's list idiom: avatar, one loud line, one quiet
 * one, and a single door on the right. No card per person — five friends in
 * five bordered boxes is frames inside frames (§14.10).
 */

import React, { memo, useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { CompassIcon } from '@/components/shared/IconGlyph';
import type { FriendPresence, MyPresence } from '@/data/friendsClient';
import { t } from '@/i18n';
import { Avatar } from '@/profile/Avatar';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

import HairlineRow from './HairlineRow';
import { friendDisplayName } from './FriendMini';
import { LiveDot } from './LiveDot';
import { focusPubFromActivity } from './focusPubHandoff';
import { useFriendSafety } from './friendSafety';
import { formatRelative, useNowTick } from './useNowTick';

interface PresenceRowProps {
  presence: FriendPresence;
  /** Dims the live dot while the dashboard is stale — "live" must not lie. */
  stale: boolean;
  mine: boolean;
  /** They are sitting where I am — the row says so instead of me having to
   *  compare two pub names three rows apart. */
  sameTable?: boolean;
  onOpenProfile: (accountId: string) => void;
  onLongPress?: (presence: FriendPresence) => void;
}

/** "4 piva · Pilsner Urquell · před 12 min", skipping whatever we don't know. */
function metaLine(presence: FriendPresence, now: number): string {
  return [
    presence.beers > 0 ? t.friends.presenceBeers(presence.beers) : '',
    presence.lastDrinkName,
    formatRelative(presence.lastSeenAt, now),
  ]
    .filter(Boolean)
    .join(' · ');
}

const PresenceRow = memo(function PresenceRow({
  presence,
  stale,
  mine,
  sameTable = false,
  onOpenProfile,
  onLongPress,
}: PresenceRowProps) {
  const now = useNowTick();
  const router = useRouter();
  const { account } = presence;

  const openProfile = useCallback(() => {
    if (mine) router.push('/profile' as Href);
    else if (account.id) onOpenProfile(account.id);
  }, [account.id, mine, onOpenProfile, router]);

  const handleLongPress = useCallback(() => {
    if (!mine) onLongPress?.(presence);
  }, [mine, onLongPress, presence]);

  const showOnCompass = useCallback(() => {
    if (focusPubFromActivity({ cacheKey: presence.cacheKey, name: presence.pubName })) {
      router.push('/' as Href);
    }
  }, [presence.cacheKey, presence.pubName, router]);

  const meta = metaLine(presence, now);
  const name = mine ? t.friends.presenceMe : friendDisplayName(account);

  return (
    <HairlineRow>
      <View style={styles.row}>
        <Pressable
          onPress={openProfile}
          onLongPress={handleLongPress}
          accessibilityRole="button"
          accessibilityLabel={
            mine
              ? t.a11y.presenceRowMine(presence.pubName || t.friends.presenceSomewhere)
              : t.a11y.presenceRow(name, presence.pubName || t.friends.presenceSomewhere)
          }
          style={({ pressed }) => [styles.identity, pressed && styles.dim]}
        >
          <Avatar
            uri={account.avatarUrl}
            nickname={account.nickname}
            displayName={account.displayName}
            size={34}
          />
          <View style={styles.textCol}>
            <View style={styles.nameRow}>
              <Text
                style={styles.name}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {name}
              </Text>
              <LiveDot size={7} stale={stale} />
            </View>
            <Text
              style={styles.pub}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.heading}
            >
              {presence.pubName || t.friends.presenceSomewhere}
            </Text>
            {sameTable ? (
              <Text
                style={styles.sameTable}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {t.friends.presenceSameTable}
              </Text>
            ) : null}
            {meta ? (
              <Text
                style={styles.meta}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {meta}
              </Text>
            ) : null}
          </View>
        </Pressable>

        {presence.cacheKey ? (
          <Pressable
            onPress={showOnCompass}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t.a11y.presenceCompass(presence.pubName || t.friends.presenceSomewhere)}
            style={({ pressed }) => [styles.compassButton, pressed && styles.dim]}
          >
            <CompassIcon size={18} color={Colors.mutedText} />
          </Pressable>
        ) : null}
      </View>
    </HairlineRow>
  );
});

export interface PresenceListProps {
  presence: FriendPresence[];
  myPresence: MyPresence | null;
  stale: boolean;
  /** The pub I am sitting in, when somebody from the party is sitting there
   *  too. Those rows rise to the top, right under mine. */
  sharedCacheKey?: string | null;
  onOpenProfile: (accountId: string) => void;
  /** Called after a block/report so the screen can reload the graph. */
  onChanged: () => void;
}

export function PresenceList({
  presence,
  myPresence,
  stale,
  sharedCacheKey = null,
  onOpenProfile,
  onChanged,
}: PresenceListProps) {
  const openSafetyMenu = useFriendSafety(onChanged);
  const handleLongPress = useCallback(
    (row: FriendPresence) => openSafetyMenu(row.account),
    [openSafetyMenu],
  );

  // Stable sort: the table I am at first, everyone else in the order the server
  // sent. Nobody is dropped — this list still answers "kdo kde sedí".
  const rows = useMemo(() => {
    if (!sharedCacheKey) return presence;
    return [
      ...presence.filter((row) => row.cacheKey === sharedCacheKey),
      ...presence.filter((row) => row.cacheKey !== sharedCacheKey),
    ];
  }, [presence, sharedCacheKey]);

  if (presence.length === 0 && !myPresence) return null;

  return (
    <View style={styles.card}>
      {myPresence ? (
        <PresenceRow
          presence={myPresence}
          stale={stale}
          mine
          onOpenProfile={onOpenProfile}
        />
      ) : null}
      {rows.map((row) => (
        <PresenceRow
          key={row.account.id}
          presence={row}
          stale={stale}
          mine={false}
          sameTable={sharedCacheKey != null && row.cacheKey === sharedCacheKey}
          onOpenProfile={onOpenProfile}
          onLongPress={handleLongPress}
        />
      ))}
      {/* The one line that makes the invisible mode legible: whether the party
          can see me sitting here at all. Only shown when I am the one sitting —
          nobody needs a privacy status while they are at home. */}
      {myPresence && !myPresence.visibleToParta ? (
        <Text style={styles.hiddenNote} maxFontSizeMultiplier={FontScaleCap.body}>
          {t.friends.presenceHiddenNote}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.07),
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: HitArea.min,
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    flexShrink: 1,
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  // The pub is the loud half of the row: the question is "where", and the
  // avatar has already answered "who".
  pub: {
    marginTop: 1,
    fontWeight: '700',
    fontSize: 16,
    color: Colors.foam,
    includeFontPadding: false,
  },
  meta: {
    marginTop: 1,
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  // Amber, because it is the one fact on this row that is about me. Type only,
  // no pill: a badge per row would put frames inside the card (§14.10).
  sameTable: {
    marginTop: 1,
    fontWeight: '500',
    fontSize: 13,
    color: Colors.amber,
    includeFontPadding: false,
  },
  // Quiet by design, and the same affordance FriendActiveCard already uses: a
  // pill per row would put four amber frames inside one framed card (§14.10),
  // and "show me where" is not the loud thing on this screen.
  compassButton: {
    flexShrink: 0,
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hiddenNote: {
    paddingBottom: Spacing.md,
    fontWeight: '500',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  dim: {
    opacity: 0.6,
  },
});

export default PresenceList;
