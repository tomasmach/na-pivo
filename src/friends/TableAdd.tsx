/**
 * "Kdo tu sedí s tebou": add people sitting in the same pub without a QR code.
 *
 * Location is otherwise for friends only, so this is an explicit, short opt-in:
 * tapping "Přidej lidi od stolu" (here or under my own presence row)
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
} from '@/data/friendsClient';
import { CheckIcon, PlusIcon, UsersIcon } from '@/components/shared/IconGlyph';
import { t } from '@/i18n';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

import { FriendMini, friendDisplayName } from './FriendMini';
import HairlineRow from './HairlineRow';
import { useNowTick } from './useNowTick';

export const TABLE_POLL_MS = 5_000;

const ROUND_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 } as const;

/** Whole minutes left until `iso`, at least 1 while it is still ahead. */
function minutesUntil(iso: string, now: number): number {
  return Math.max(1, Math.ceil((Date.parse(iso) - now) / 60_000));
}

function reasonLine(table: FriendTable, now: number): string | null {
  switch (table.reason) {
    case 'no_visit':
      return t.friends.tableNoVisit;
    case 'too_soon':
      return table.availableAt
        ? t.friends.tableTooSoonIn(minutesUntil(table.availableAt, now))
        : t.friends.tableTooSoon;
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
}

export function TableAdd({ autoStart = false, requestingKey, onRequest }: TableAddProps) {
  // The shared tick moves once a minute and can be up to a minute old, which
  // would show "11 min" of a 10-minute window. Every server answer (a poll each
  // 5 s while visible) also stamps the clock, and the later of the two wins.
  const tick = useNowTick();
  const [answeredAt, setAnsweredAt] = useState(() => Date.now());
  const now = Math.max(tick, answeredAt);
  const [opening, setOpening] = useState(false);
  /** The server's last answer; null until the first one arrives. */
  const [table, setTable] = useState<FriendTable | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<ReadonlySet<string>>(new Set());

  const mountedRef = useRef(true);
  const openingRef = useRef(false);
  const shownRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef(false);
  /** End of my window from the server's last answer. */
  const untilRef = useRef<string | null>(null);

  const apply = useCallback((next: FriendTable | null, reportOffline: boolean) => {
    if (!mountedRef.current) return;
    if (next === null) {
      // A failed poll keeps the last list and the next tick tries again, but
      // only while my window lasts; after that the list would claim too much.
      const expired = untilRef.current !== null && Date.parse(untilRef.current) <= Date.now();
      if (expired) {
        activeRef.current = false;
        untilRef.current = null;
        setTable((current) => current && { ...current, visibleUntil: null, people: [] });
      }
      if (reportOffline || expired) setNotice(t.friends.tableOffline);
      return;
    }
    setAnsweredAt(Date.now());
    untilRef.current = next.visibleUntil;
    const active = next.eligible && next.visibleUntil !== null;
    if (active) shownRef.current = true;
    // The server ended my window: say so instead of silently resetting.
    setNotice(activeRef.current && !active ? t.friends.tableHiddenAgain : null);
    activeRef.current = active;
    setTable(next);
  }, []);

  const start = useCallback(async () => {
    if (openingRef.current) return;
    openingRef.current = true;
    shownRef.current = true;
    setOpening(true);
    setNotice(null);
    const controller = new AbortController();
    abortRef.current = controller;
    // Closing the sheet fires this; the client then hides the opt-in again.
    const next = await openFriendTable(controller.signal);
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
    } else {
      // Read-only probe so a refusal shows before the tap, not after it. A tap
      // that lands first wins: this older answer would hide the open table.
      void fetchFriendTable().then((next) => {
        if (!shownRef.current) apply(next, true);
      });
    }
    return () => {
      mountedRef.current = false;
      // Closing the sheet hides me at once instead of after the full window.
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null;
        abortRef.current?.abort();
        if (shownRef.current) void closeFriendTable();
      }, 0);
    };
    // Mount-only: autoStart is read once when the section appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = table !== null && table.eligible && table.visibleUntil !== null;
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
    if (person.friendshipStatus === 'outgoing' || sentIds.has(person.id)) {
      return (
        <Text style={styles.sent} maxFontSizeMultiplier={FontScaleCap.body}>
          {t.friends.tableSent}
        </Text>
      );
    }
    const incoming = person.friendshipStatus === 'incoming';
    const name = friendDisplayName(person);
    return (
      <Pressable
        onPress={() => void tap(person)}
        disabled={requestingKey != null}
        hitSlop={ROUND_HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel={incoming ? t.friends.tableAcceptA11y(name) : t.friends.tableAddA11y(name)}
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

  if (active && table?.visibleUntil) {
    return (
      <View style={styles.section}>
        <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={FontScaleCap.heading}>
          {t.friends.tableTitle}
        </Text>
        <Text style={styles.status} maxFontSizeMultiplier={FontScaleCap.body}>
          {t.friends.tableVisibleFor(minutesUntil(table.visibleUntil, now))}
        </Text>
        {table.people.length === 0 ? (
          <Text style={styles.line} maxFontSizeMultiplier={FontScaleCap.body}>
            {t.friends.tableWaiting}
          </Text>
        ) : (
          // Rows are not pressable: opening a profile would close the sheet and hide me.
          table.people.map((person, index) => (
            <HairlineRow key={person.id} first={index === 0}>
              <View style={styles.personRow}>
                <FriendMini profile={person} />
                {renderAction(person)}
              </View>
            </HairlineRow>
          ))
        )}
      </View>
    );
  }

  // Refused until the reason goes away; too_soon unlocks itself when its time comes.
  const refusal = table !== null && !table.eligible ? table : null;
  const blocked =
    refusal !== null &&
    !(refusal.reason === 'too_soon' && refusal.availableAt !== null && Date.parse(refusal.availableAt) <= now);
  const line = notice ?? (blocked && refusal ? reasonLine(refusal, now) : null) ?? t.friends.tableExplainer;

  return (
    <View style={styles.section}>
      <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={FontScaleCap.heading}>
        {t.friends.tableTitle}
      </Text>
      <Pressable
        onPress={() => void start()}
        disabled={opening || blocked}
        accessibilityRole="button"
        accessibilityLabel={t.friends.tableEntry}
        accessibilityState={{ disabled: opening || blocked }}
        style={({ pressed }) => [styles.actionRow, blocked && styles.disabled, pressed && styles.dim]}
      >
        <View style={styles.actionIcon}>
          {opening ? (
            <ActivityIndicator color={Colors.amber} size="small" />
          ) : (
            <UsersIcon size={18} color={blocked ? Colors.mutedText : Colors.amber} />
          )}
        </View>
        <Text
          style={[styles.actionLabel, blocked && styles.actionLabelDisabled]}
          numberOfLines={2}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {t.friends.tableEntry}
        </Text>
      </Pressable>
      <Text style={styles.line} maxFontSizeMultiplier={FontScaleCap.body}>
        {line}
      </Text>
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
    backgroundColor: withAlpha(Colors.foam, 0.07),
  },
  actionLabel: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
  },
  status: {
    marginTop: -Spacing.xs,
    marginBottom: Spacing.sm,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
  },
  disabled: {
    backgroundColor: Colors.stout2,
  },
  actionLabelDisabled: {
    color: Colors.mutedText,
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
