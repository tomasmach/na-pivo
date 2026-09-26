import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { XIcon } from '@/components/shared/IconGlyph';
import { Avatar } from '@/profile/Avatar';
import { useToursStore } from '@/stores/toursStore';
import { t } from '@/i18n';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { TourButton } from './TourChrome';
import { isFriendActivityQueued } from '@/data/friendsQueue';
import { pingRecipients, pingStop, sendPing, type PingFriends } from './crewPing';
import type { CrewMember, TourCrew, TourRun } from './model';

const QR_SIZE = 184;

/** The last cinknutí from this run, so reopening the sheet does not offer the same pub again. */
export type CrewPingState = { runId: string; stopId: string; status: 'sent' | 'queued'; clientId: string };

export const crewLink = (crew: Pick<TourCrew, 'token' | 'runId'>) => `https://na-pivo.cz/t/${crew.token}?r=${crew.runId}`;
const going = (crew: TourCrew) => (crew.members ?? []).filter((member) => !member.left);
/** The QR only while the run still takes new walkers. */
const inviting = (crew?: TourCrew) => !!crew && !crew.closed && !crew.refused;

function Coins({ members, ground }: { members: CrewMember[]; ground: string }) {
  return <View style={styles.coins} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    {members.slice(0, 4).map((member, index) => <View key={member.id} style={[styles.coin, { borderColor: ground, marginLeft: index ? -8 : 0 }]}>
      <Avatar uri={member.avatarUrl} nickname={member.nickname} displayName={member.displayName} size={28} />
    </View>)}
  </View>;
}

/** Who walks together, inside the title block so the stops stay above the fold. Without a crew it is where friends get pinged. */
export function TourCrewRow({ crew, self, ping, onOpen }: { crew?: TourCrew; self: CrewMember | null; ping: boolean; onOpen: () => void }) {
  const joined = !!crew && !crew.refused;
  const members = joined ? going(crew) : [];
  const left = joined ? (crew.members ?? []).filter((member) => member.left) : [];
  // Before the server answers, the walker still sees their own face, so the row does not jump.
  const coins = members.length ? members : self ? [self] : [];
  const label = members.length > 1 ? t.tours.crewGoing(members.length) : left.length ? t.tours.crewNone : t.tours.crewAlone;
  const status = crew?.completion === 'sent' && crew.counted ? t.tours.crewCounted : crew?.completion === 'pending' ? t.tours.crewPending : null;
  const link = inviting(crew) ? members.length > 1 ? t.tours.crewInviteMore : t.tours.crewInvite : ping ? t.tours.crewPing : null;
  const row = <>
    {coins.length > 0 && <Coins members={coins} ground={Colors.stout} />}
    <Text maxFontSizeMultiplier={FontScaleCap.heading} style={styles.label}>{label}</Text>
    {link && <Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.linkText}>{link}</Text>}
  </>;
  return <View style={styles.rowWrap}>
    {(joined || ping) && (link ? <Pressable onPress={onOpen} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole="button"
      accessibilityLabel={`${label}. ${link}`} accessibilityHint={inviting(crew) ? t.tours.crewInviteHint : t.tours.crewPingHint}>{row}</Pressable>
      : <View style={styles.row}>{row}</View>)}
    {crew?.refused && <Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.caption}>{t.tours.crewRefused}</Text>}
    {left.length > 0 && <Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.caption}>{t.tours.crewLeftMember(left.map((member) => member.nickname))}</Text>}
    {crew?.closed && !crew.organizer && !crew.refused && <Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.caption}>{t.tours.crewClosed}</Text>}
    {status && <Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.caption} accessibilityLiveRegion="polite">{status}</Text>}
  </View>;
}

/** Friends who are not at the table hear where the crew sits; joining still takes the QR in person. */
function CrewPing({ run, friends, crewIds, solo, ping, onPinged }: {
  run: TourRun; friends: PingFriends; crewIds: string[]; solo: boolean; ping: CrewPingState | null; onPinged: (state: CrewPingState) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = pingStop(run);
  if (!target) return null;
  const recipients = pingRecipients(friends.ids, crewIds);
  const done = ping?.runId === run.id && ping.stopId === target.stop.id ? ping.status : null;
  const name = target.stop.name;
  async function press() {
    if (!target) return;
    setBusy(true); setError(null);
    const result = await sendPing(run.snapshot.title, target, recipients);
    setBusy(false);
    if ('error' in result) setError(result.error);
    else onPinged({ runId: run.id, stopId: target.stop.id, ...result });
  }
  const state = friends.ghost ? t.tours.crewPingGhost : recipients?.length === 0 ? t.tours.crewPingAllHere
    : done === 'sent' ? t.tours.crewPingSent(name) : done === 'queued' ? t.tours.crewPingQueued : null;
  return <>
    <Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.pingNote}>{solo ? t.tours.crewPingNoteSolo : t.tours.crewPingNote}</Text>
    {state ? <View style={styles.pingState}><Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.pingStateText} accessibilityLiveRegion="polite">{state}</Text></View>
      : <TourButton secondary busy={busy} label={target.heading ? t.tours.crewPingTo(name) : t.tours.crewPingFrom(name)} onPress={() => { void press(); }} />}
    {error && <Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.caption} accessibilityLiveRegion="polite">{error}</Text>}
  </>;
}

/** The QR carries the tour link plus this run's id; the phone made the id, so it works offline.
 * There is deliberately no share button: a crew joins at the table, the walk is not an open event. */
export function TourCrewSheet({ run, friends, ping, onPinged, onClose }: {
  run: TourRun; friends: PingFriends | null; ping: CrewPingState | null; onPinged: (state: CrewPingState) => void; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const crew = run.crew;
  const qr = inviting(crew) ? crew : undefined;
  const joined = !!crew && !crew.refused;
  // The roster refreshes when the sheet opens, not every few seconds.
  useEffect(() => { if (joined) void useToursStore.getState().refreshCrew(); }, [joined]);
  // A ping that waited for signal may have gone out since.
  const waiting = ping?.status === 'queued' ? ping : null;
  useEffect(() => {
    if (waiting) void isFriendActivityQueued(waiting.clientId).then((queued) => { if (!queued) onPinged({ ...waiting, status: 'sent' }); });
  }, [waiting, onPinged]);
  const members = joined ? going(crew) : [];
  return <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} accessibilityElementsHidden importantForAccessibility="no" />
      <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, Spacing.md) + Spacing.sm }]}>
        <View style={styles.grabber} />
        <View style={styles.header}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={FontScaleCap.heading} style={styles.title}>{qr ? t.tours.crewInvite : t.tours.crewPing}</Text>
          <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel={t.tours.close}>
            <XIcon size={20} color={Colors.foamMuted} />
          </Pressable>
        </View>
        {qr && <>
          <View style={styles.qr} accessible accessibilityRole="image" accessibilityLabel={t.tours.crewQrA11y}>
            <QRCode value={crewLink(qr)} size={QR_SIZE} color={Colors.stout} backgroundColor={Colors.foam} />
          </View>
          <Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.note}>{t.tours.crewSheetNote}</Text>
        </>}
        {members.length > 0 && <View style={[styles.row, styles.roster]}>
          <Coins members={members} ground={Colors.stout} />
          <Text maxFontSizeMultiplier={FontScaleCap.body} numberOfLines={2} style={styles.names}>{members.map((member) => member.nickname).join(', ')}</Text>
        </View>}
        {!!friends?.ids.length && <>
          {qr && <View style={styles.divider}>
            <Text accessibilityRole="header" maxFontSizeMultiplier={FontScaleCap.heading} style={styles.sub}>{t.tours.crewPingAway}</Text>
          </View>}
          <CrewPing run={run} friends={friends} crewIds={members.map((member) => member.id)} solo={!qr} ping={ping} onPinged={onPinged} />
        </>}
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  rowWrap: { marginTop: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: HitArea.min },
  coins: { flexDirection: 'row' },
  coin: { borderWidth: 2, borderRadius: Radius.pill },
  label: { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: '600', color: Colors.foam },
  linkText: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: Colors.amber },
  caption: { fontSize: 12, lineHeight: 18, color: Colors.foamMuted },
  pressed: { opacity: 0.65 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: withAlpha(Colors.black, 0.6) },
  card: { backgroundColor: Colors.stout, borderTopLeftRadius: Radius.cardLarge, borderTopRightRadius: Radius.cardLarge, paddingTop: Spacing.sm, paddingHorizontal: Spacing.lg, gap: Spacing.md },
  grabber: { alignSelf: 'center', width: 44, height: 4, borderRadius: Radius.pill, backgroundColor: withAlpha(Colors.foam, 0.22) },
  header: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1, fontSize: 21, lineHeight: 27, fontWeight: '700', letterSpacing: -0.4, color: Colors.foam },
  close: { width: HitArea.min, height: HitArea.min, alignItems: 'center', justifyContent: 'center', marginRight: -Spacing.sm },
  qr: { alignSelf: 'center', padding: Spacing.md, borderRadius: Radius.medium, backgroundColor: Colors.foam },
  note: { fontSize: 14, lineHeight: 20, color: Colors.foamMuted, textAlign: 'center' },
  roster: { gap: Spacing.sm + 2 },
  names: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '600', color: Colors.foam },
  divider: { borderTopWidth: 1, borderTopColor: withAlpha(Colors.foam, 0.1), paddingTop: Spacing.md },
  sub: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: Colors.foam },
  pingNote: { fontSize: 14, lineHeight: 20, color: Colors.foamMuted },
  pingState: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  pingStateText: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: Colors.foam, textAlign: 'center' },
});
