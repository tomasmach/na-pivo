import { useEffect } from 'react';
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
import type { CrewMember, TourCrew } from './model';

const QR_SIZE = 184;

export const crewLink = (crew: Pick<TourCrew, 'token' | 'runId'>) => `https://na-pivo.cz/t/${crew.token}?r=${crew.runId}`;
const going = (crew: TourCrew) => (crew.members ?? []).filter((member) => !member.left);

function Coins({ members, ground }: { members: CrewMember[]; ground: string }) {
  return <View style={styles.coins} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    {members.slice(0, 4).map((member, index) => <View key={member.id} style={[styles.coin, { borderColor: ground, marginLeft: index ? -8 : 0 }]}>
      <Avatar uri={member.avatarUrl} nickname={member.nickname} displayName={member.displayName} size={28} />
    </View>)}
  </View>;
}

/** Who walks together, inside the title block so the stops stay above the fold. */
export function TourCrewRow({ crew, self, onInvite }: { crew: TourCrew; self: CrewMember | null; onInvite: () => void }) {
  if (crew.refused)
    return <View style={styles.rowWrap}><Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.caption}>{t.tours.crewRefused}</Text></View>;
  const members = going(crew);
  const left = (crew.members ?? []).filter((member) => member.left);
  // Before the server answers, the walker still sees their own face, so the row does not jump.
  const coins = members.length ? members : self ? [self] : [];
  const label = members.length > 1 ? t.tours.crewGoing(members.length) : left.length ? t.tours.crewNone : t.tours.crewAlone;
  const status = crew.completion === 'sent' && crew.counted ? t.tours.crewCounted : crew.completion === 'pending' ? t.tours.crewPending : null;
  const invite = members.length > 1 ? t.tours.crewInviteMore : t.tours.crewInvite;
  const row = <>
    {coins.length > 0 && <Coins members={coins} ground={Colors.stout} />}
    <Text maxFontSizeMultiplier={FontScaleCap.heading} style={styles.label}>{label}</Text>
    {!crew.closed && <Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.linkText}>{invite}</Text>}
  </>;
  return <View style={styles.rowWrap}>
    {crew.closed ? <View style={styles.row}>{row}</View>
      : <Pressable onPress={onInvite} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole="button"
        accessibilityLabel={`${label}. ${invite}`} accessibilityHint={t.tours.crewInviteHint}>{row}</Pressable>}
    {left.length > 0 && <Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.caption}>{t.tours.crewLeftMember(left.map((member) => member.nickname))}</Text>}
    {crew.closed && !crew.organizer && <Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.caption}>{t.tours.crewClosed}</Text>}
    {status && <Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.caption} accessibilityLiveRegion="polite">{status}</Text>}
  </View>;
}

/** The QR carries the tour link plus this run's id; the phone made the id, so it works offline.
 * There is deliberately no share button: a crew joins at the table, the walk is not an open event. */
export function TourCrewSheet({ crew, onClose }: { crew: TourCrew; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  // The roster refreshes when the sheet opens, not every few seconds.
  useEffect(() => { void useToursStore.getState().refreshCrew(); }, []);
  const members = going(crew);
  const link = crewLink(crew);
  return <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} accessibilityElementsHidden importantForAccessibility="no" />
      <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, Spacing.md) + Spacing.sm }]}>
        <View style={styles.grabber} />
        <View style={styles.header}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={FontScaleCap.heading} style={styles.title}>{t.tours.crewInvite}</Text>
          <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel={t.tours.close}>
            <XIcon size={20} color={Colors.foamMuted} />
          </Pressable>
        </View>
        <View style={styles.qr} accessible accessibilityRole="image" accessibilityLabel={t.tours.crewQrA11y}>
          <QRCode value={link} size={QR_SIZE} color={Colors.stout} backgroundColor={Colors.foam} />
        </View>
        <Text maxFontSizeMultiplier={FontScaleCap.body} style={styles.note}>{t.tours.crewSheetNote}</Text>
        {members.length > 0 && <View style={[styles.row, styles.roster]}>
          <Coins members={members} ground={Colors.stout} />
          <Text maxFontSizeMultiplier={FontScaleCap.body} numberOfLines={2} style={styles.names}>{members.map((member) => member.nickname).join(', ')}</Text>
        </View>}
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
});
