import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckIcon, XIcon } from '@/components/shared/IconGlyph';
import { loadPartyFriends, type FriendProfile, type PartyFriends } from '@/data/friendsClient';
import type { TourInviteRow } from '@/data/tourInvitesClient';
import { queuedTourInvitees } from '@/data/tourInvitesQueue';
import { friendDisplayName } from '@/friends/FriendMini';
import { Avatar } from '@/profile/Avatar';
import { intlLocale, t } from '@/i18n';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { TourButton } from './TourChrome';
import { inviteFriends, shareTourLink } from './tourInvites';
import type { TourPlan } from './model';

/** "pá 2. 10. · 19:00 · Vinohradský pivovar": when and where the tour starts. */
export function inviteDetail(plan: Pick<TourPlan, 'scheduledDate' | 'scheduledTime' | 'stops'>): string {
  const day = plan.scheduledDate
    ? new Date(`${plan.scheduledDate}T12:00:00Z`).toLocaleDateString(intlLocale, { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' })
    : null;
  return [day, plan.scheduledDate ? plan.scheduledTime?.slice(0, 5) : null, plan.stops[0]?.name].filter(Boolean).join(' · ');
}

function Sheet({ title, onClose, children, footer, closeDisabled }: {
  title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; closeDisabled?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const close = () => { if (!closeDisabled) onClose(); };
  return <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessible={false} accessibilityElementsHidden importantForAccessibility="no" />
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
        <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text accessibilityRole="header" maxFontSizeMultiplier={FontScaleCap.heading} style={styles.title}>{title}</Text>
            <Pressable onPress={close} style={styles.close} accessibilityRole="button" accessibilityLabel={t.tours.close}>
              <XIcon size={20} color={Colors.foamMuted} />
            </Pressable>
          </View>
          {children}
          {footer}
        </View>
      </View>
    </View>
  </Modal>;
}

function FriendRow({ friend, checked, invited, onToggle }: { friend: FriendProfile; checked: boolean; invited: boolean; onToggle: () => void }) {
  const name = friendDisplayName(friend);
  const sub = invited ? t.tourInvites.alreadyInvited : friend.nickname && friend.displayName ? friend.displayName : null;
  return <Pressable onPress={onToggle} disabled={invited} style={({ pressed }) => [styles.row, checked && styles.rowChecked, pressed && styles.pressed]}
    accessibilityRole="checkbox" accessibilityState={{ checked: checked || invited, disabled: invited }} accessibilityLabel={sub ? `${name}. ${sub}` : name}>
    <Avatar uri={friend.avatarUrl} nickname={friend.nickname} displayName={friend.displayName} size={36} border="quiet" />
    <View style={styles.rowText}>
      <Text maxFontSizeMultiplier={FontScaleCap.body} numberOfLines={1} style={[styles.rowName, invited && styles.muted]}>{name}</Text>
      {sub && <Text maxFontSizeMultiplier={FontScaleCap.body} numberOfLines={1} style={styles.rowMeta}>{sub}</Text>}
    </View>
    <View style={[styles.check, checked && styles.checkOn, invited && styles.checkInvited]}>
      {(checked || invited) && <CheckIcon size={14} color={invited ? Colors.foamMuted : Colors.stout} />}
    </View>
  </Pressable>;
}

export type InviteSent = { status: 'sent'; roster: TourInviteRow[] } | { status: 'queued' };

/** Pick friends from Parta and invite them; the link goes elsewhere with one tap. The host only hears the outcome. */
export function TourInviteSheet({ plan, invitedIds, onClose, onSent }: {
  plan: TourPlan; invitedIds: string[]; onClose: () => void; onSent: (sent: InviteSent) => void;
}) {
  // undefined while the party loads, null when there is no party to show (offline with nothing saved).
  const [party, setParty] = useState<PartyFriends | null | undefined>(undefined);
  const [queued, setQueued] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState<'invite' | 'link' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A double tap lands before `busy` re-renders; two sends would be harmless but show two outcomes.
  const working = useRef(false);
  useEffect(() => {
    let alive = true;
    const show = (next: PartyFriends | null) => { if (alive) setParty(next); };
    void loadPartyFriends(undefined, show).then(show);
    void queuedTourInvitees(plan.id).then((ids) => { if (alive) setQueued(ids); });
    return () => { alive = false; };
  }, [plan.id]);
  const invited = new Set([...invitedIds, ...queued]);
  const friends = party?.friends ?? [];
  const chosen = picked.filter((id) => friends.some((friend) => friend.id === id) && !invited.has(id));
  const ghost = !!party?.ghost;

  async function run(kind: 'invite' | 'link', task: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(kind); setError(null);
    try { await task(); } finally { working.current = false; setBusy(null); }
  }
  const invite = () => run('invite', async () => {
    const outcome = await inviteFriends(plan.id, chosen);
    if ('error' in outcome) setError(outcome.error);
    else onSent(outcome);
  });
  const share = () => run('link', async () => { setError(await shareTourLink(plan.id)); });

  const note = ghost ? t.tourInvites.ghost : party === null ? t.tourInvites.friendsOffline : party && !friends.length ? t.tourInvites.noFriends : null;
  return <Sheet title={t.tourInvites.sheetTitle} onClose={onClose} closeDisabled={!!busy} footer={<View style={styles.actions}>
    {error && <Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.error} accessibilityLiveRegion="polite">{error}</Text>}
    <TourButton label={t.tourInvites.send(chosen.length)} busy={busy === 'invite'} disabled={!chosen.length || ghost || !!busy} onPress={() => { void invite(); }} />
    <Pressable onPress={() => { void share(); }} disabled={!!busy} style={({ pressed }) => [styles.link, (pressed || busy === 'link') && styles.pressed]}
      accessibilityRole="button" accessibilityLabel={t.tourInvites.shareElsewhere} accessibilityState={{ disabled: !!busy, busy: busy === 'link' }}>
      <Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.linkText}>{t.tourInvites.shareElsewhere}</Text>
    </Pressable>
  </View>}>
    <Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.detail}>{inviteDetail(plan)}</Text>
    {note ? <Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.note}>{note}</Text>
      : <ScrollView style={[styles.list, styles.pickList]} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        {friends.map((friend) => <FriendRow key={friend.id} friend={friend} invited={invited.has(friend.id)} checked={chosen.includes(friend.id)}
          onToggle={() => setPicked((current) => current.includes(friend.id) ? current.filter((id) => id !== friend.id) : [...current, friend.id])} />)}
      </ScrollView>}
  </Sheet>;
}

const byStatus = (roster: TourInviteRow[], status: TourInviteRow['status']) => roster.filter((row) => row.status === status);

function Coins({ friends }: { friends: FriendProfile[] }) {
  return <View style={styles.coins} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    {friends.slice(0, 4).map((friend, index) => <View key={friend.id} style={[styles.coin, index > 0 && styles.coinOverlap]}>
      <Avatar uri={friend.avatarUrl} nickname={friend.nickname} displayName={friend.displayName} size={28} />
    </View>)}
  </View>;
}

/** Under the title once anyone was invited: how many, how many go, and who. */
export function TourInviteRosterRow({ roster, onPress }: { roster: TourInviteRow[]; onPress: () => void }) {
  const going = byStatus(roster, 'going').map((row) => row.friend);
  const label = t.tourInvites.rosterSummary(roster.length, going.length);
  const names = going.map(friendDisplayName).join(', ');
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.rosterRow, pressed && styles.pressed]} accessibilityRole="button"
    accessibilityLabel={[label, names].filter(Boolean).join('. ')} accessibilityHint={t.tourInvites.rosterHint}>
    <View style={styles.rosterLine}>
      {going.length > 0 && <Coins friends={going} />}
      <Text maxFontSizeMultiplier={FontScaleCap.heading} style={styles.rosterLabel}>{label}</Text>
      <Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.linkText}>{t.tourInvites.rosterOpen}</Text>
    </View>
    {!!names && <Text maxFontSizeMultiplier={FontScaleCap.body} numberOfLines={2} style={styles.rosterNames}>{names}</Text>}
  </Pressable>;
}

/** Who goes, who does not, and who has not answered yet. Read only; inviting more is the footer's job. */
export function TourInviteRosterSheet({ roster, onClose }: { roster: TourInviteRow[]; onClose: () => void }) {
  const groups = ([['going', t.tourInvites.rosterGoing], ['declined', t.tourInvites.rosterDeclined], ['invited', t.tourInvites.rosterWaiting]] as const)
    .map(([status, title]) => ({ status, title, rows: byStatus(roster, status) })).filter((group) => group.rows.length > 0);
  return <Sheet title={t.tourInvites.rosterOpen} onClose={onClose}>
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
      {groups.map((group, index) => <View key={group.status} style={index > 0 && styles.group}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={FontScaleCap.heading} style={styles.groupTitle}>{`${group.title} · ${group.rows.length}`}</Text>
        {group.rows.map((row) => <View key={row.friend.id} style={styles.rosterItem}>
          <Avatar uri={row.friend.avatarUrl} nickname={row.friend.nickname} displayName={row.friend.displayName} size={36} border="quiet" />
          <View style={styles.rowText}>
            <Text maxFontSizeMultiplier={FontScaleCap.body} numberOfLines={1} style={styles.rowName}>{friendDisplayName(row.friend)}</Text>
            {!!row.friend.nickname && !!row.friend.displayName && <Text maxFontSizeMultiplier={FontScaleCap.body} numberOfLines={1} style={styles.rowMeta}>{row.friend.displayName}</Text>}
          </View>
        </View>)}
      </View>)}
    </ScrollView>
  </Sheet>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: withAlpha(Colors.black, 0.6) },
  cardWrap: { width: '100%', maxHeight: '92%' },
  card: { flexShrink: 1, backgroundColor: Colors.stout, borderTopLeftRadius: Radius.cardLarge, borderTopRightRadius: Radius.cardLarge,
    paddingTop: Spacing.sm, paddingHorizontal: 20, ...softDrop() },
  grabber: { width: 44, height: 4, borderRadius: Radius.pill, backgroundColor: withAlpha(Colors.foam, 0.22), alignSelf: 'center', marginBottom: Spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flexShrink: 1, fontSize: 18, lineHeight: 24, fontWeight: '700', letterSpacing: -0.2, color: Colors.foam },
  close: { width: HitArea.min, height: HitArea.min, alignItems: 'center', justifyContent: 'center', marginRight: -Spacing.sm },
  detail: { fontSize: 14, lineHeight: 20, color: Colors.foamMuted },
  note: { fontSize: 14, lineHeight: 20, color: Colors.mutedText, paddingVertical: Spacing.md },
  list: { flexGrow: 0, flexShrink: 1, marginTop: Spacing.md },
  listContent: { paddingBottom: Spacing.sm },
  // The highlight of a picked row reaches past the text column, like the rows in the ping sheet; the scroll view would clip a negative margin on the row.
  pickList: { marginHorizontal: -Spacing.md },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
    borderRadius: Radius.medium },
  rowChecked: { backgroundColor: withAlpha(Colors.amber, 0.08) },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 16, lineHeight: 21, fontWeight: '600', color: Colors.foam },
  rowMeta: { marginTop: 1, fontSize: 14, lineHeight: 19, color: Colors.mutedText },
  muted: { color: Colors.foamMuted },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: withAlpha(Colors.border, 0.8), alignItems: 'center', justifyContent: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.04) },
  checkOn: { borderColor: Colors.amber, backgroundColor: Colors.amber },
  checkInvited: { borderColor: withAlpha(Colors.foam, 0.2), backgroundColor: withAlpha(Colors.foam, 0.1) },
  pressed: { opacity: 0.65 },
  actions: { gap: Spacing.xs, paddingTop: Spacing.md, marginTop: Spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(Colors.foam, 0.1) },
  error: { fontSize: 13, lineHeight: 18, color: Colors.amberLight, marginBottom: Spacing.xs },
  link: { minHeight: HitArea.min, alignItems: 'center', justifyContent: 'center' },
  linkText: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: Colors.amber },
  coins: { flexDirection: 'row' },
  coin: { borderWidth: 2, borderColor: Colors.stout, borderRadius: Radius.pill },
  coinOverlap: { marginLeft: -8 },
  rosterRow: { marginTop: Spacing.sm, minHeight: HitArea.min, justifyContent: 'center' },
  rosterLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: HitArea.min },
  rosterLabel: { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: '600', color: Colors.foam },
  rosterNames: { fontSize: 12, lineHeight: 18, color: Colors.foamMuted },
  group: { marginTop: Spacing.lg },
  groupTitle: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: Colors.foam, marginBottom: Spacing.xs },
  rosterItem: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
});
