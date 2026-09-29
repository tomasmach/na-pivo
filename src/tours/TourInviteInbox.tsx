import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useIsFocused, useRouter, type Href } from 'expo-router';
import { ChevronRightIcon } from '@/components/shared/IconGlyph';
import { fetchOpenTourInvites, type OpenTourInvite } from '@/data/tourInvitesClient';
import { friendDisplayName } from '@/friends/FriendMini';
import { Avatar } from '@/profile/Avatar';
import { useAccountStore } from '@/stores/accountStore';
import { t } from '@/i18n';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';
import { TourText, ui } from './TourChrome';
import { inviteDetail } from './TourInviteSheet';
import type { TourPlan } from './model';

/** Friends' tours this account is invited to, read from the server so a missed push never hides one. Nothing on an older server. */
export function TourInviteInbox({ saved }: { saved: TourPlan[] }) {
  const router = useRouter();
  const focused = useIsFocused();
  // Kept with the account it was read for: after a logout or switch the previous account's invites never show.
  const accountId = useAccountStore((s) => s.session?.accountId ?? null);
  const [found, setFound] = useState<{ accountId: string; invites: OpenTourInvite[] } | null>(null);
  useEffect(() => {
    if (!focused || !accountId) return;
    let alive = true;
    void fetchOpenTourInvites().then((result) => { if (alive) setFound({ accountId, invites: result.ok ? result.value : [] }); });
    return () => { alive = false; };
  }, [focused, accountId]);
  const invites = found && found.accountId === accountId ? found.invites : [];
  // Someone going who already saved the tour finds it among their own tours, unless the link changed since and the copy can no longer update.
  const shown = invites.filter((invite) => !(invite.status === 'going' && saved.some((plan) => plan.source?.tourId === invite.planId && plan.source.token === invite.token)));
  if (!shown.length) return null;
  return <View>
    <TourText style={styles.section}>{t.tourInvites.inboxTitle}</TourText>
    {shown.map((invite, index) => {
      const meta = [t.tourInvites.invitedBy(friendDisplayName(invite.inviter)), inviteDetail({ ...invite, stops: [] }) || null, invite.firstPub || null,
        invite.status === 'going' ? t.tourInvites.inboxGoing : invite.status === 'declined' ? t.tourInvites.inboxDeclined : null].filter(Boolean).join(' · ');
      return <Pressable key={invite.planId} onPress={() => router.push(`/t/${invite.token}` as Href)} accessibilityRole="button" accessibilityLabel={`${invite.title}. ${meta}`}
        style={({ pressed }) => [styles.row, index === 0 && styles.first, pressed && styles.pressed]}>
        <Avatar uri={invite.inviter.avatarUrl} nickname={invite.inviter.nickname} displayName={invite.inviter.displayName} size={36} border="quiet" />
        <View style={ui.grow}>
          <TourText maxFontSizeMultiplier={FontScaleCap.heading} numberOfLines={2} style={ui.stopName}>{invite.title}</TourText>
          <TourText style={ui.meta}>{meta}</TourText>
        </View>
        <ChevronRightIcon color={Colors.mutedText} size={18} />
      </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  section: { fontFamily: undefined, fontSize: 14, lineHeight: 20, fontWeight: '600', color: Colors.foam, marginBottom: Spacing.xs },
  row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm + 2, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(Colors.foam, 0.1) },
  first: { borderTopWidth: 0 },
  pressed: { opacity: 0.65 },
});
