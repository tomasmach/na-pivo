/**
 * The hub before the first beer.
 *
 * It used to be the running hub with the numbers switched off: a pub picker, an
 * invite pill, one line about a code and six hundred points of nothing down to
 * the button. A screen you open to START an evening said nothing about the
 * evening. Now it says what the night is going to collect — where, who, what
 * to play — each as the row it will be once the night runs, with its one
 * action sitting on it; then who from the parta is already sitting somewhere,
 * only when somebody is; then the last night, so the hub has a memory.
 *
 * Everything above the parta section is local, so the screen is whole with no
 * signal. The parta section is the one thing that needs the server and it
 * simply is not there until the server answers.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { ChevronRightIcon } from '@/components/shared/IconGlyph';
import { PresenceList } from '@/friends/PresenceList';
import { useNowTick } from '@/friends/useNowTick';
import { usePartaDashboard } from '@/friends/usePartaDashboard';
import { t } from '@/i18n';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { SectionBreak } from '@/mocks/SectionBreak';
import { eveningDateLabel, sessionDrinkSummary } from '@/myBeers/eveningModel';
import { GAME_CATALOG, GAMES_COMING_SOON } from '@/party/gameCatalog';
import { gamesLine } from '@/party/idleHubModel';
import { useAccountStore } from '@/stores/accountStore';
import type { TallySession } from '@/stores/tallyStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Spacing } from '@/theme/layout';

/** Friends shown seated; the full list lives in Kocoviny. */
const SEATED_LIMIT = 3;

function IdleRow({
  label,
  title,
  meta,
  link,
  first = false,
  onOpen,
  accessibilityLabel,
}: {
  /** What the row is about, in the gutter: "Hospoda", "U stolu". Optional. */
  label?: string;
  title: string;
  meta?: string;
  /**
   * Amber word at the end instead of a chevron. With a link the ROW is inert
   * and only the word presses: "U stolu · Ty" reads as information, and a tap
   * on it that quietly opens a table on the server is a trap, not a shortcut.
   */
  link?: string;
  first?: boolean;
  onOpen: () => void;
  accessibilityLabel: string;
}) {
  const body = (
    <>
      {label ? (
        <Text style={styles.rowLabel} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {label}
        </Text>
      ) : null}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {title}
        </Text>
        {meta ? (
          // Two lines: "2 m · Otevírací doba neznámá · Pilsner Urquell 12°" is
          // the whole point of the pub row and one line cut it at the beer.
          <Text style={styles.rowMeta} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
            {meta}
          </Text>
        ) : null}
      </View>
    </>
  );
  if (link) {
    return (
      <View style={[styles.row, first && styles.rowFirst]}>
        {body}
        <Pressable
          onPress={onOpen}
          style={({ pressed }) => [styles.rowLinkHit, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
        >
          <Text style={styles.rowLink} maxFontSizeMultiplier={FontScaleCap.body}>
            {link}
          </Text>
        </Pressable>
      </View>
    );
  }
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [styles.row, first && styles.rowFirst, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {body}
      <ChevronRightIcon size={18} color={Colors.mutedText} />
    </Pressable>
  );
}

/**
 * Who from the parta is sitting somewhere right now. Its own component so the
 * dashboard hook mounts only for someone with an account — anonymous has no
 * parta, and the request would only fail — and only while the hub is idle, so
 * the running night never pays for the poll.
 */
function SeatedFriends() {
  const router = useRouter();
  const { dashboard, stale, reload } = usePartaDashboard();
  const seated = React.useMemo(
    () => (dashboard?.presence ?? []).slice(0, SEATED_LIMIT),
    [dashboard?.presence],
  );
  if (seated.length === 0) return null;
  return (
    <>
      <SectionBreak title={t.liveParty.idleSeatedTitle} />
      <PresenceList
        flat
        presence={seated}
        myPresence={null}
        stale={stale}
        onOpenProfile={(id) => router.push(`/parta/${id}` as Href)}
        onChanged={reload}
      />
    </>
  );
}

export function IdleHub({
  pubName,
  pubMeta,
  lastSession,
  onPickPub,
  onInvite,
  onOpenGames,
  onJoinByCode,
}: {
  /** The chosen or detected pub, or the placeholder asking for one. */
  pubName: string;
  /** Distance, opening state, first tap — whatever is known. */
  pubMeta: string[];
  lastSession: TallySession | null;
  onPickPub: () => void;
  onInvite: () => void;
  onOpenGames: () => void;
  onJoinByCode: () => void;
}) {
  const router = useRouter();
  const hasAccount = useAccountStore((state) => state.session != null);
  // Ticks, so a hub left open past the 04:00 cutoff stops saying "Včera".
  const now = useNowTick();
  // "Včera · U Kotvy" — the same day label and drink summary the evening
  // detail opens with, so the row and the screen behind it agree.
  const lastTitle = lastSession
    ? [eveningDateLabel(lastSession.startedAt, new Date(now)), lastSession.pubName]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <View style={styles.root}>
      <View style={styles.lead}>
        <Text style={styles.leadTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
          {t.liveParty.pulseIdle}
        </Text>
        <Text style={styles.leadSub} maxFontSizeMultiplier={FontScaleCap.body}>
          {t.liveParty.pulseIdleBasis}
        </Text>
      </View>

      <View style={styles.rows}>
        <IdleRow
          first
          label={t.liveParty.idlePubLabel}
          title={pubName}
          meta={pubMeta.join(' · ')}
          onOpen={onPickPub}
          accessibilityLabel={t.liveParty.a11yChangePub(pubName)}
        />
        <IdleRow
          label={t.liveParty.idleTableLabel}
          title={t.liveParty.you}
          link={t.liveParty.invitePill}
          onOpen={onInvite}
          accessibilityLabel={t.liveParty.a11yInvite}
        />
        {/* The dice disc in the control row is the running night's door to the
            games; before the night this row is the only one. The catalogue is
            locked until the next version and the row says so rather than
            hiding the fact behind a tap. */}
        <IdleRow
          label={t.liveParty.idleGamesLabel}
          title={gamesLine(GAME_CATALOG)}
          meta={GAMES_COMING_SOON ? t.liveParty.idleGamesSoon : undefined}
          onOpen={onOpenGames}
          accessibilityLabel={t.liveParty.a11yOpenGames}
        />
      </View>

      {/* The other door. You can start a table here, but somebody may have
          started one already. */}
      <Pressable
        onPress={onJoinByCode}
        style={({ pressed }) => [styles.joinRow, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={t.liveParty.a11yJoinWithCode}
      >
        <Text style={styles.joinText} maxFontSizeMultiplier={FontScaleCap.body}>
          {t.liveParty.joinPrompt}{' '}
          <Text style={styles.joinLink} maxFontSizeMultiplier={FontScaleCap.body}>
            {t.liveParty.joinLink}
          </Text>
        </Text>
      </Pressable>

      {hasAccount ? <SeatedFriends /> : null}

      {lastSession ? (
        <>
          <SectionBreak title={t.liveParty.idleLastTitle} />
          <IdleRow
            first
            title={lastTitle}
            meta={sessionDrinkSummary(lastSession)}
            onOpen={() =>
              router.push({
                pathname: '/evening',
                params: { startedAt: lastSession.startedAt },
              } as Href)
            }
            accessibilityLabel={t.liveParty.a11yLastNight(lastTitle)}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Air under the last row so it does not sit on the control row.
  root: { paddingBottom: Spacing.lg },
  lead: { marginTop: Spacing.xs },
  leadTitle: { ...MockType.titleXL, color: Colors.foam },
  leadSub: { ...MockType.bodySmall, color: Colors.foamMuted, marginTop: 2 },
  rows: { marginTop: MockLayout.controlGap },
  // The canonical sheet row (§7.3); 68 because these are two-line rows (§4.1).
  row: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  rowFirst: { borderTopWidth: 0 },
  rowLabel: { ...MockType.bodySmall, color: Colors.mutedText, width: 84 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { ...MockType.bodySemibold, color: Colors.foam },
  rowMeta: { ...MockType.bodySmall, color: Colors.mutedText, marginTop: 2 },
  rowLinkHit: { minHeight: HitArea.min, justifyContent: 'center', paddingLeft: Spacing.sm },
  rowLink: { fontSize: 14, fontWeight: '800', color: Colors.amber },
  joinRow: {
    minHeight: HitArea.min,
    marginTop: Spacing.md,
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  joinText: { ...MockType.body, color: Colors.mutedText },
  joinLink: { color: Colors.amber, fontWeight: '800' },
  pressed: { opacity: 0.65 },
});
