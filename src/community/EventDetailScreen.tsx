import React from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EventCover } from '@/community/EventCover';
import { CheckIcon, MapPinIcon, UsersIcon, XIcon } from '@/components/shared/IconGlyph';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { TAB_CHROME } from '@/components/shared/TabBar';
import { generateUuidV4 } from '@/data/account';
import {
  createCommunityEventTeam,
  decideCommunityJoinRequest,
  fetchCommunityEvent,
  fetchCommunityEventTeams,
  joinCommunityEventTeam,
  leaveCommunityEvent,
  leaveCommunityEventTeam,
  requestCommunityEventJoin,
  type CommunityEvent,
  type CommunityEventTeam,
  type CommunityEventTeamRoster,
  type CommunityJoinRequest,
} from '@/data/communityEventsClient';
import { intlLocale, t } from '@/i18n';
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import { Avatar } from '@/profile/Avatar';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

function displayName(request: CommunityJoinRequest): string {
  return request.account.nickname ? `@${request.account.nickname}` : request.account.displayName;
}

const attendingLabel = t.communityEvents.attendingCount;
const spotsLabel = t.communityEvents.spotsLeft;

function statusLabel(event: CommunityEvent): string {
  if (event.status === 'cancelled') return t.communityEvents.statusCancelled;
  if (event.status === 'ended') return t.communityEvents.statusEnded;
  if (event.status === 'live') return t.communityEvents.statusLive;
  return t.communityEvents.statusAdults;
}

function TeamCard({
  team,
  roster,
  closed,
  busy,
  locked,
  onToggle,
}: {
  team: CommunityEventTeam;
  roster: CommunityEventTeamRoster;
  closed: boolean;
  busy: boolean;
  locked: boolean;
  onToggle: (team: CommunityEventTeam) => void;
}) {
  const onAnotherTeam = roster.myTeamId !== null && !team.isMine;
  const full = team.availableSpots === 0;
  const disabled = locked || closed || onAnotherTeam || (!team.isMine && full);
  const actionLabel = team.isMine
    ? t.communityEvents.teamLeave
    : onAnotherTeam
      ? t.communityEvents.teamAlreadyIn
      : full
        ? t.communityEvents.teamFull
        : t.communityEvents.teamJoin;

  return (
    <View style={[styles.teamCard, team.isMine && styles.teamCardMine]}>
      <View style={styles.teamHead}>
        <View style={styles.grow}>
          <Text style={styles.teamName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
            {team.name}
          </Text>
          <Text style={styles.teamCapacity} maxFontSizeMultiplier={FontScaleCap.body}>
            {t.communityEvents.teamOf(team.memberCount, team.capacity)}
          </Text>
        </View>
        {team.isMine ? (
          <View style={styles.mineBadge}>
            <CheckIcon size={14} color={Colors.amber} />
            <Text style={styles.mineBadgeText} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.teamMine}</Text>
          </View>
        ) : null}
      </View>

      {team.members.length ? (
        <View style={styles.memberList}>
          {team.members.map(({ account }) => (
            <View key={account.id} style={styles.memberRow}>
              <Avatar
                uri={account.avatarUrl}
                nickname={account.nickname}
                displayName={account.displayName}
                size={32}
                border="quiet"
              />
              <Text style={styles.memberName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                {account.nickname ? `@${account.nickname}` : account.displayName}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.teamEmpty} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.teamEmpty}</Text>
      )}

      <Pressable
        onPress={() => onToggle(team)}
        disabled={disabled}
        style={({ pressed }) => [
          styles.teamAction,
          team.isMine && styles.teamActionLeave,
          disabled && styles.disabled,
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        accessibilityState={{ disabled, selected: team.isMine }}
      >
        {busy ? <ActivityIndicator size="small" color={Colors.amber} /> : null}
        <Text
          style={[styles.teamActionText, team.isMine && styles.teamActionLeaveText]}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {busy ? t.communityEvents.busy : actionLabel}
        </Text>
      </Pressable>
    </View>
  );
}

export function EventDetailScreen({ event }: { event: CommunityEvent }) {
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = React.useState(event);
  const [membershipBusy, setMembershipBusy] = React.useState(false);
  const [membershipError, setMembershipError] = React.useState<string | null>(null);
  const [moderationBusy, setModerationBusy] = React.useState<string | null>(null);
  const [moderationError, setModerationError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [roster, setRoster] = React.useState<CommunityEventTeamRoster | null>(event.teamRoster);
  const [rosterLoading, setRosterLoading] = React.useState(
    (event.isHost || event.membershipStatus === 'approved') && event.teamRoster === null,
  );
  const [rosterError, setRosterError] = React.useState<string | null>(null);
  const [teamBusy, setTeamBusy] = React.useState<string | null>(null);
  const membershipBusyRef = React.useRef(false);
  const moderationBusyRef = React.useRef<string | null>(null);
  const teamBusyRef = React.useRef<string | null>(null);
  const [newTeamName, setNewTeamName] = React.useState('');
  const createAttemptRef = React.useRef<{ name: string; clientId: string } | null>(null);

  const membership = detail.membershipStatus;
  const canSeeTeams = detail.isHost || membership === 'approved';
  const attending = Math.max(1, detail.capacity - detail.availableSpots);
  const startsAt = new Date(detail.startsAt);
  const when = Number.isFinite(startsAt.getTime())
    ? new Intl.DateTimeFormat(intlLocale, {
        weekday: 'short',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      }).format(startsAt)
    : detail.startsAt;
  const joined = membership === 'approved' || membership === 'pending';
  const closed = detail.status === 'ended' || detail.status === 'cancelled';
  const pendingRequests = detail.joinRequests.filter((request) => request.status === 'pending');
  const membershipActionLabel = detail.isHost
    ? closed
      ? t.communityEvents.hostEnded
      : t.communityEvents.hosting
    : closed
      ? t.communityEvents.eventEnded
      : membershipBusy
        ? t.communityEvents.busy
        : membership === 'approved'
          ? t.communityEvents.going
          : membership === 'pending'
            ? t.communityEvents.pending
            : t.communityEvents.wantToGo;

  React.useEffect(() => {
    if (!canSeeTeams || roster !== null) return;
    let active = true;
    const controller = new AbortController();
    void fetchCommunityEventTeams(detail.id, controller.signal).then((result) => {
      if (!active) return;
      if (result.ok) {
        setRoster(result.roster);
        setRosterError(null);
      } else {
        setRosterError(result.detail);
      }
      setRosterLoading(false);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [canSeeTeams, detail.id, roster]);

  const refreshRoster = async () => {
    if (rosterLoading) return;
    setRosterLoading(true);
    setRosterError(null);
    const result = await fetchCommunityEventTeams(detail.id);
    if (result.ok) setRoster(result.roster);
    else setRosterError(result.detail);
    setRosterLoading(false);
  };

  const toggleMembership = async () => {
    if (membershipBusyRef.current || detail.isHost || closed) return;
    membershipBusyRef.current = true;
    setMembershipBusy(true);
    setMembershipError(null);
    setNotice(null);
    try {
      const result = joined
        ? await leaveCommunityEvent(detail.id)
        : await requestCommunityEventJoin(detail.id);
      if (!result.ok) {
        setMembershipError(result.detail);
        return;
      }
      if (joined) {
        setDetail((current) => ({
          ...current,
          membershipStatus: current.membershipStatus === 'approved' ? 'left' : 'cancelled',
          exactAddress: null,
          teamRoster: null,
        }));
        setRoster(null);
        setNotice(t.communityEvents.leftToast);
      } else {
        setDetail((current) => ({ ...current, membershipStatus: 'pending' }));
        setNotice(t.communityEvents.joinSent);
      }
    } catch {
      setMembershipError(t.communityEvents.actionError);
    } finally {
      membershipBusyRef.current = false;
      setMembershipBusy(false);
    }
  };

  const decideRequest = async (request: CommunityJoinRequest, action: 'approve' | 'reject') => {
    if (moderationBusyRef.current) return;
    moderationBusyRef.current = request.id;
    setModerationBusy(request.id);
    setModerationError(null);
    setNotice(null);
    try {
      const result = await decideCommunityJoinRequest(detail.id, request.id, action);
      if (!result.ok) {
        setModerationError(result.detail);
        return;
      }
      setDetail((current) => ({
      ...current,
      availableSpots:
        action === 'approve' ? Math.max(0, current.availableSpots - 1) : current.availableSpots,
      joinRequests: current.joinRequests.map((row) =>
        row.id === request.id ? { ...row, status: action === 'approve' ? 'approved' : 'rejected' } : row,
      ),
      }));
      if (action === 'approve' && roster) {
        setRoster({
          ...roster,
          participantCount: roster.participantCount + 1,
          unassignedCount: roster.unassignedCount + 1,
        });
      }
      setNotice(
        action === 'approve'
          ? t.communityEvents.approvedToast(displayName(request))
          : t.communityEvents.rejectedToast,
      );

      const refreshed = await fetchCommunityEvent(detail.id);
      if (refreshed.ok) {
        setDetail(refreshed.event);
        setRoster(refreshed.event.teamRoster);
      }
    } catch {
      setModerationError(t.communityEvents.actionError);
    } finally {
      moderationBusyRef.current = null;
      setModerationBusy(null);
    }
  };

  const createTeam = async () => {
    const name = newTeamName.trim();
    if (!name || teamBusyRef.current || closed) return;
    const attempt = createAttemptRef.current?.name === name
      ? createAttemptRef.current
      : { name, clientId: generateUuidV4() };
    createAttemptRef.current = attempt;
    teamBusyRef.current = 'create';
    setTeamBusy('create');
    setRosterError(null);
    setNotice(null);
    try {
      const result = await createCommunityEventTeam(detail.id, attempt);
      if (!result.ok) {
        setRosterError(result.detail);
        return;
      }
      setRoster(result.roster);
      setNewTeamName('');
      createAttemptRef.current = null;
      Keyboard.dismiss();
      setNotice(
        result.created
          ? t.communityEvents.teamCreated(result.team?.name ?? name)
          : t.communityEvents.teamExists,
      );
    } catch {
      setRosterError(t.communityEvents.actionError);
    } finally {
      teamBusyRef.current = null;
      setTeamBusy(null);
    }
  };

  const toggleTeam = async (team: CommunityEventTeam) => {
    if (teamBusyRef.current || closed) return;
    teamBusyRef.current = team.id;
    setTeamBusy(team.id);
    setRosterError(null);
    setNotice(null);
    try {
      const result = team.isMine
        ? await leaveCommunityEventTeam(detail.id, team.id)
        : await joinCommunityEventTeam(detail.id, team.id);
      if (!result.ok) {
        setRosterError(result.detail);
        return;
      }
      setRoster(result.roster);
      setNotice(team.isMine ? t.communityEvents.teamLeft : t.communityEvents.teamJoined(team.name));
    } catch {
      setRosterError(t.communityEvents.actionError);
    } finally {
      teamBusyRef.current = null;
      setTeamBusy(null);
    }
  };

  return (
    <KeyboardAwareScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 52, paddingBottom: insets.bottom + TAB_CHROME },
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <EventCover event={detail} height={160} />

      <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
        {detail.title}
      </Text>
      <Text style={styles.when} maxFontSizeMultiplier={FontScaleCap.body}>
        {when}
      </Text>
      <Text style={styles.status} maxFontSizeMultiplier={FontScaleCap.heading}>
        {statusLabel(detail)}
      </Text>

      <View style={styles.whereRow}>
        <MapPinIcon size={16} color={Colors.amber} />
        <Text style={styles.where} maxFontSizeMultiplier={FontScaleCap.body}>
          {detail.exactAddress ?? [detail.areaLabel, detail.city].filter(Boolean).join(', ')}
        </Text>
      </View>

      <Text style={styles.blurb} maxFontSizeMultiplier={FontScaleCap.body}>
        {detail.description}
      </Text>

      <View style={styles.goingRow}>
        <UsersIcon size={16} color={Colors.mutedText} />
        <Text style={styles.goingText} maxFontSizeMultiplier={FontScaleCap.body}>
          {t.communityEvents.goingLine(attendingLabel(attending), spotsLabel(detail.availableSpots))}
        </Text>
      </View>

      <Pressable
        onPress={() => void toggleMembership()}
        disabled={membershipBusy || detail.isHost || closed}
        style={({ pressed }) => [styles.cta, joined && styles.ctaOn, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityState={{ selected: joined, disabled: membershipBusy || detail.isHost || closed }}
        accessibilityLabel={
          detail.isHost
            ? membershipActionLabel
            : joined
              ? t.communityEvents.cancelAttendanceA11y
              : t.communityEvents.requestJoinA11y
        }
      >
        {joined || detail.isHost ? <CheckIcon size={18} color={Colors.amber} /> : null}
        <Text
          style={[styles.ctaText, (joined || detail.isHost) && styles.ctaTextOn]}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {membershipActionLabel}
        </Text>
      </Pressable>
      {membership === 'pending' ? <Text style={styles.pendingHint} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.pendingHint}</Text> : null}
      {membershipError ? <Text style={styles.error} maxFontSizeMultiplier={FontScaleCap.body}>{membershipError}</Text> : null}
      {notice ? <Text style={styles.notice} maxFontSizeMultiplier={FontScaleCap.body}>{notice}</Text> : null}

      {detail.isHost ? (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
              {t.communityEvents.requestsHeading}
            </Text>
            <Text style={styles.sectionCount} allowFontScaling={false}>{pendingRequests.length}</Text>
          </View>
          {pendingRequests.length ? pendingRequests.map((request) => {
            const busy = moderationBusy === request.id;
            return (
              <View key={request.id} style={styles.requestCard}>
                <View style={styles.requestPerson}>
                  <Avatar
                    uri={request.account.avatarUrl}
                    nickname={request.account.nickname}
                    displayName={request.account.displayName}
                    size={40}
                    border="quiet"
                  />
                  <View style={styles.grow}>
                    <Text style={styles.requestName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>{displayName(request)}</Text>
                    {request.message ? <Text style={styles.requestMessage} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>{request.message}</Text> : null}
                  </View>
                </View>
                <View style={styles.requestActions}>
                  <Pressable
                    onPress={() => void decideRequest(request, 'reject')}
                    disabled={moderationBusy !== null}
                    style={({ pressed }) => [styles.rejectButton, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={t.communityEvents.rejectRequestA11y(displayName(request))}
                    accessibilityState={{ disabled: moderationBusy !== null }}
                  >
                    <XIcon size={16} color={Colors.mutedText} />
                    <Text style={styles.rejectButtonText} maxFontSizeMultiplier={FontScaleCap.heading}>{t.communityEvents.rejectShort}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void decideRequest(request, 'approve')}
                    disabled={moderationBusy !== null || detail.availableSpots === 0}
                    style={({ pressed }) => [
                      styles.approveButton,
                      detail.availableSpots === 0 && styles.disabled,
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={t.communityEvents.approveRequestA11y(displayName(request))}
                    accessibilityState={{ disabled: moderationBusy !== null || detail.availableSpots === 0 }}
                  >
                    {busy ? <ActivityIndicator size="small" color={Colors.stout} /> : <CheckIcon size={16} color={Colors.stout} />}
                    <Text style={styles.approveButtonText} maxFontSizeMultiplier={FontScaleCap.heading}>{busy ? t.communityEvents.busy : t.communityEvents.approveShort}</Text>
                  </Pressable>
                </View>
              </View>
            );
          }) : (
            <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.noRequests}</Text>
          )}
          {detail.availableSpots === 0 && pendingRequests.length ? (
            <Text style={styles.capacityError} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.capacityFull}</Text>
          ) : null}
          {moderationError ? <Text style={styles.errorLeft} maxFontSizeMultiplier={FontScaleCap.body}>{moderationError}</Text> : null}
        </View>
      ) : null}

      {canSeeTeams ? (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
              {t.communityEvents.teamsTitle}
            </Text>
            {roster ? (
              <Text style={styles.sectionMeta} maxFontSizeMultiplier={FontScaleCap.body}>
                {t.communityEvents.teamsAssigned(roster.assignedCount, roster.participantCount)}
              </Text>
            ) : null}
          </View>

          {rosterLoading ? (
            <View style={styles.loadingRow} accessibilityLabel={t.communityEvents.teamsLoadingA11y}>
              <ActivityIndicator color={Colors.amber} />
              <Text style={styles.loadingText} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.teamsLoading}</Text>
            </View>
          ) : rosterError && !roster ? (
            <View style={styles.loadError}>
              <Text style={styles.errorLeft} maxFontSizeMultiplier={FontScaleCap.body}>{rosterError}</Text>
              <Pressable
                onPress={() => void refreshRoster()}
                style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={t.communityEvents.retry}
              >
                <Text style={styles.retryText} maxFontSizeMultiplier={FontScaleCap.heading}>{t.communityEvents.retry}</Text>
              </Pressable>
            </View>
          ) : roster ? (
            <>
              {roster.unassignedCount > 0 ? (
                <Text style={styles.unassigned} maxFontSizeMultiplier={FontScaleCap.body}>
                  {t.communityEvents.unassigned(attendingLabel(roster.unassignedCount))}
                </Text>
              ) : null}
              {roster.teams.length ? roster.teams.map((team) => (
                <TeamCard
                  key={team.id}
                  team={team}
                  roster={roster}
                  closed={closed}
                  busy={teamBusy === team.id}
                  locked={teamBusy !== null}
                  onToggle={(row) => void toggleTeam(row)}
                />
              )) : (
                <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.teamsEmpty}</Text>
              )}

              {!roster.myTeamId && !closed ? (
                <View style={styles.createTeam}>
                  <TextInput
                    value={newTeamName}
                    onChangeText={(value) => {
                      setNewTeamName(value);
                      if (createAttemptRef.current?.name !== value.trim()) createAttemptRef.current = null;
                    }}
                    placeholder={t.communityEvents.teamNamePlaceholder}
                    placeholderTextColor={MockColors.fieldHint}
                    maxLength={40}
                    returnKeyType="done"
                    onSubmitEditing={() => void createTeam()}
                    editable={teamBusy === null}
                    style={styles.teamInput}
                    accessibilityLabel={t.communityEvents.teamNameA11y}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  />
                  <Pressable
                    onPress={() => void createTeam()}
                    disabled={!newTeamName.trim() || teamBusy !== null}
                    style={({ pressed }) => [
                      styles.createTeamButton,
                      (!newTeamName.trim() || teamBusy !== null) && styles.disabled,
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={t.communityEvents.teamCreateA11y}
                    accessibilityState={{ disabled: !newTeamName.trim() || teamBusy !== null }}
                  >
                    {teamBusy === 'create' ? <ActivityIndicator size="small" color={Colors.stout} /> : null}
                    <Text style={styles.createTeamButtonText} maxFontSizeMultiplier={FontScaleCap.heading}>{teamBusy === 'create' ? t.communityEvents.teamCreating : t.communityEvents.teamCreate}</Text>
                  </Pressable>
                </View>
              ) : null}
              {rosterError ? <Text style={styles.errorLeft} maxFontSizeMultiplier={FontScaleCap.body}>{rosterError}</Text> : null}
            </>
          ) : null}
        </View>
      ) : null}
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  content: { paddingHorizontal: MockLayout.screenPad },
  grow: { flex: 1 },
  pressed: { opacity: 0.68 },
  disabled: { opacity: 0.45 },

  title: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.foam,
    letterSpacing: -0.5,
    marginTop: Spacing.lg,
  },
  when: { fontSize: 16, fontWeight: '600', color: Colors.amber, marginTop: 4 },
  status: {
    alignSelf: 'flex-start',
    marginTop: Spacing.sm,
    fontSize: 13,
    fontWeight: '700',
    color: Colors.foamMuted,
  },
  whereRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  where: { flex: 1, fontSize: 15, fontWeight: '500', color: Colors.foam },
  blurb: {
    fontSize: 16,
    fontWeight: '400',
    color: Colors.mutedText,
    lineHeight: 24,
    marginTop: Spacing.lg,
  },
  goingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: Spacing.lg },
  goingText: { fontSize: 14, fontWeight: '600', color: Colors.mutedText },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: MockLayout.sheetButtonHeight,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    marginTop: MockLayout.sectionGap,
  },
  ctaOn: {
    backgroundColor: withAlpha(Colors.amber, 0.14),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.5),
  },
  ctaText: { ...MockType.buttonLabel, color: Colors.stout },
  ctaTextOn: { color: Colors.amber },
  pendingHint: { marginTop: 8, textAlign: 'center', fontSize: 13, fontWeight: '500', color: Colors.mutedText },
  notice: { marginTop: 8, textAlign: 'center', fontSize: 13, fontWeight: '600', color: Colors.success },
  error: { fontSize: 13, fontWeight: '500', color: Colors.glow, marginTop: 8, textAlign: 'center' },
  errorLeft: { fontSize: 13, fontWeight: '500', color: Colors.glow, lineHeight: 18 },
  capacityError: { fontSize: 13, fontWeight: '500', color: Colors.glow, lineHeight: 18 },

  section: { marginTop: 40, gap: 12 },
  sectionHead: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { ...MockType.titleS, color: Colors.foam, flex: 1 },
  sectionCount: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: withAlpha(Colors.amber, 0.16),
    color: Colors.amber,
    textAlign: 'center',
    lineHeight: 28,
    fontSize: 13,
    fontWeight: '800',
  },
  sectionMeta: { fontSize: 13, fontWeight: '600', color: Colors.mutedText },
  empty: { fontSize: 14, fontWeight: '500', color: Colors.mutedText, lineHeight: 20 },

  requestCard: {
    padding: 16,
    borderRadius: Radius.medium,
    backgroundColor: Colors.stout2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.1),
    gap: 12,
  },
  requestPerson: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  requestName: { fontSize: 15, fontWeight: '700', color: Colors.foam },
  requestMessage: { marginTop: 4, fontSize: 13, fontWeight: '500', color: Colors.mutedText, lineHeight: 18 },
  requestActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  rejectButton: {
    minWidth: 72,
    minHeight: HitArea.min,
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  rejectButtonText: { fontSize: 14, fontWeight: '700', color: Colors.mutedText },
  approveButton: {
    minWidth: 80,
    minHeight: HitArea.min,
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  approveButtonText: { fontSize: 14, fontWeight: '800', color: Colors.stout },

  loadingRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14, fontWeight: '500', color: Colors.mutedText },
  loadError: { gap: 12, alignItems: 'flex-start' },
  retryButton: {
    minHeight: HitArea.min,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.14),
  },
  retryText: { fontSize: 14, fontWeight: '700', color: Colors.amber },
  unassigned: { fontSize: 13, fontWeight: '500', color: Colors.mutedText },

  teamCard: {
    padding: 16,
    borderRadius: Radius.medium,
    backgroundColor: Colors.stout2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.1),
    gap: 12,
  },
  teamCardMine: { borderColor: withAlpha(Colors.amber, 0.5) },
  teamHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  teamName: { fontSize: 16, fontWeight: '700', color: Colors.foam },
  teamCapacity: { marginTop: 4, fontSize: 13, fontWeight: '600', color: Colors.mutedText },
  mineBadge: {
    height: 28,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    backgroundColor: withAlpha(Colors.amber, 0.14),
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  mineBadgeText: { fontSize: 12, fontWeight: '700', color: Colors.amber },
  memberList: { gap: 8 },
  memberRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 10 },
  memberName: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.foamMuted },
  teamEmpty: { fontSize: 13, fontWeight: '500', color: Colors.mutedText },
  teamAction: {
    minHeight: HitArea.min,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.14),
    flexDirection: 'row',
    gap: 8,
  },
  teamActionLeave: { backgroundColor: Colors.stout3 },
  teamActionText: { fontSize: 14, fontWeight: '700', color: Colors.amber },
  teamActionLeaveText: { color: Colors.mutedText },

  createTeam: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  teamInput: {
    flex: 1,
    minHeight: 48,
    borderRadius: Radius.pill,
    paddingHorizontal: 16,
    backgroundColor: MockColors.field,
    borderWidth: 1,
    borderColor: MockColors.fieldBorder,
    color: Colors.foam,
    fontSize: 15,
    fontWeight: '500',
  },
  createTeamButton: {
    minWidth: 92,
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  createTeamButtonText: { fontSize: 14, fontWeight: '800', color: Colors.stout },
});
