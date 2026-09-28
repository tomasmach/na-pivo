/**
 * "Kdo tu sedí s tebou": add people sitting in the same pub without a QR code.
 *
 * Location is otherwise for friends only, so this is an explicit, short opt-in:
 * tapping "Ukázat se u stolu" (or the entry line under my own presence row)
 * makes me visible for a few minutes to people who did the same in the same pub.
 * The server picks the pub and applies every rule; this only shows profiles.
 * Leaving the screen hides me again right away.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  closeFriendTable,
  fetchFriendTable,
  openFriendTable,
  type FriendTable,
  type FriendTablePerson,
  type FriendTableReason,
} from '@/data/friendsClient';
import { CheckIcon, PlusIcon, UsersIcon } from '@/components/shared/IconGlyph';
import { t } from '@/i18n';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

import { FriendMini } from './FriendMini';
import HairlineRow from './HairlineRow';

export const TABLE_POLL_MS = 10_000;

const ROUND_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 } as const;

function reasonLine(reason: FriendTableReason | null): string | null {
  switch (reason) {
    case 'no_visit':
      return t.friends.tableNoVisit;
    case 'too_soon':
      return t.friends.tableTooSoon;
    case 'ghost':
      return t.friends.tableGhost;
    case 'private':
      return t.friends.tablePrivate;
    case 'no_nickname':
      return t.friends.coldStartSetupBody;
    default:
      return null;
  }
}

export interface TableAddProps {
  /** Opened from "Přidej lidi od stolu": that tap already was the explicit intent. */
  autoStart?: boolean;
  /** Profile id of the request in flight (shared with the search rows). */
  requestingKey: string | null;
  /** Sends the normal friend request; resolves true when it was sent or queued. */
  onRequest: (person: FriendTablePerson) => Promise<boolean>;
  onOpenProfile: (accountId: string) => void;
}

export function TableAdd({ autoStart = false, requestingKey, onRequest, onOpenProfile }: TableAddProps) {
  const [opening, setOpening] = useState(false);
  const [table, setTable] = useState<FriendTable | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<ReadonlySet<string>>(new Set());

  const mountedRef = useRef(true);
  const openingRef = useRef(false);
  const shownRef = useRef(false);

  const apply = useCallback((next: FriendTable | null, fromOpen: boolean) => {
    if (!mountedRef.current) return;
    if (next === null) {
      // A failed poll keeps the last list and the next tick tries again.
      if (fromOpen) setNotice(t.friends.tableOffline);
      return;
    }
    if (!next.eligible || next.visibleUntil === null) {
      setTable(null);
      setNotice(reasonLine(next.reason));
      return;
    }
    setTable(next);
    setNotice(null);
  }, []);

  const start = useCallback(async () => {
    if (openingRef.current) return;
    openingRef.current = true;
    shownRef.current = true;
    setOpening(true);
    setNotice(null);
    const next = await openFriendTable();
    openingRef.current = false;
    if (!mountedRef.current) return;
    setOpening(false);
    apply(next, true);
  }, [apply]);

  const refresh = useCallback(() => {
    void fetchFriendTable().then((next) => apply(next, false));
  }, [apply]);

  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    if (closeTimerRef.current) {
      // A StrictMode remount of the same section: keep the table open.
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    } else if (autoStart) {
      void start();
    }
    return () => {
      mountedRef.current = false;
      // Closing the sheet hides me at once instead of after the full window.
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null;
        if (shownRef.current) void closeFriendTable();
      }, 0);
    };
    // Mount-only: autoStart is read once when the section appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = table !== null;
  useEffect(() => {
    if (!active) return;
    // The server says when my window is over (visible_until turns null), so a
    // phone with a wrong clock cannot keep me listed or hide the table early.
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') refresh();
    }, TABLE_POLL_MS);
    return () => clearInterval(interval);
  }, [active, refresh]);

  const tap = useCallback(
    async (person: FriendTablePerson) => {
      const sent = await onRequest(person);
      if (!mountedRef.current || !sent) return;
      setSentIds((current) => new Set(current).add(person.id));
      refresh();
    },
    [onRequest, refresh],
  );

  const renderAction = (person: FriendTablePerson) => {
    const incoming = person.friendshipStatus === 'incoming';
    if (person.friendshipStatus === 'outgoing' || sentIds.has(person.id)) {
      return (
        <Text style={styles.sent} maxFontSizeMultiplier={FontScaleCap.body}>
          {t.friends.tableSent}
        </Text>
      );
    }
    return (
      <Pressable
        onPress={() => void tap(person)}
        disabled={requestingKey != null}
        hitSlop={ROUND_HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel={incoming ? t.friends.accept : t.friends.addByNickname}
        style={({ pressed }) => [styles.addBtn, pressed && styles.dim]}
      >
        {requestingKey === person.id ? (
          <ActivityIndicator color={Colors.stout} size="small" />
        ) : incoming ? (
          <CheckIcon size={18} color={Colors.stout} />
        ) : (
          <PlusIcon size={18} color={Colors.stout} />
        )}
      </Pressable>
    );
  };

  return (
    <View style={styles.section}>
      <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={FontScaleCap.heading}>
        {t.friends.tableTitle}
      </Text>
      {table ? (
        table.people.length === 0 ? (
          <Text style={styles.line} maxFontSizeMultiplier={FontScaleCap.body}>
            {t.friends.tableWaiting}
          </Text>
        ) : (
          table.people.map((person, index) => (
            <HairlineRow key={person.id} first={index === 0} onPress={() => onOpenProfile(person.id)}>
              <View style={styles.personRow}>
                <FriendMini profile={person} />
                {renderAction(person)}
              </View>
            </HairlineRow>
          ))
        )
      ) : (
        <>
          <Pressable
            onPress={() => void start()}
            disabled={opening}
            accessibilityRole="button"
            accessibilityLabel={t.friends.tableShowCta}
            style={({ pressed }) => [styles.actionRow, pressed && styles.dim]}
          >
            <View style={styles.actionIcon}>
              {opening ? (
                <ActivityIndicator color={Colors.amber} size="small" />
              ) : (
                <UsersIcon size={18} color={Colors.amber} />
              )}
            </View>
            <Text style={styles.actionLabel} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
              {t.friends.tableShowCta}
            </Text>
          </Pressable>
          <Text style={styles.line} maxFontSizeMultiplier={FontScaleCap.body}>
            {notice ?? t.friends.tableExplainer}
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: Spacing.lg,
  },
  title: {
    marginBottom: Spacing.sm,
    fontFamily: Fonts.display.bold,
    fontSize: 16,
    color: Colors.foam,
  },
  // DESIGN.md §7.3 action row: "do something new" gets its own quiet surface.
  actionRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.medium,
    backgroundColor: Colors.stout3,
  },
  actionIcon: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  actionLabel: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
  },
  line: {
    marginTop: Spacing.sm,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  addBtn: {
    width: HitArea.min,
    height: HitArea.min,
    borderRadius: HitArea.min / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  sent: {
    minHeight: HitArea.min,
    textAlignVertical: 'center',
    lineHeight: HitArea.min,
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.mutedText,
  },
  dim: {
    opacity: 0.65,
  },
});

export default TableAdd;
