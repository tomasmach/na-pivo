import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassIconButton } from '@/components/shared/GlassIconButton';
import { ChevronLeftIcon, MenuIcon, Trash2Icon } from '@/components/shared/IconGlyph';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { generateUuidV4 } from '@/data/account';
import {
  createNightComment,
  deleteNightComment,
  fetchNightComments,
  fetchNightDetail,
  type NightComment,
  type PublishedNight,
} from '@/data/nightsClient';
import { FeedCard } from '@/feed/FeedScreen';
import {
  filterNightFeedForSafety,
  isNightFeedAccountBlocked,
  subscribeNightFeedSafety,
} from '@/feed/feedSafetySignal';
import { useNightActions } from '@/feed/useNightActions';
import { useNightReaction } from '@/feed/useNightReaction';
import SkeletonBlock from '@/friends/SkeletonBlock';
import { Avatar } from '@/profile/Avatar';
import { useAccountStore } from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { useReduceMotion } from '@/utils/useReduceMotion';

function commentWhen(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function labelOf(person: PublishedNight['author']): string {
  return person.nickname ? `@${person.nickname}` : person.displayName;
}

function PeopleSection({ night }: { night: PublishedNight }) {
  const people = [night.author, ...night.participants].filter(
    (person, index, all) => person.id && all.findIndex((row) => row.id === person.id) === index,
  );
  if (people.length < 2) return null;
  const podium = people.slice(0, 3);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
        Kdo tam byl
      </Text>
      <View style={styles.podium}>
        {podium.map((person, index) => (
          <View key={person.id} style={[styles.podiumPerson, index === 0 && styles.podiumFirst]}>
            <Avatar
              uri={person.avatarUrl}
              nickname={person.nickname}
              displayName={person.displayName}
              size={index === 0 ? 52 : 44}
              border="quiet"
            />
            <Text style={styles.podiumName} numberOfLines={1}>
              {labelOf(person)}
            </Text>
          </View>
        ))}
      </View>
      {people.slice(3).map((person) => (
        <View key={person.id} style={styles.personRow}>
          <Avatar
            uri={person.avatarUrl}
            nickname={person.nickname}
            displayName={person.displayName}
            size={36}
            border="quiet"
          />
          <Text style={styles.personName} numberOfLines={1}>
            {labelOf(person)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function CommentRow({
  comment,
  onDelete,
}: {
  comment: NightComment;
  onDelete: (comment: NightComment) => void;
}) {
  return (
    <View style={styles.commentRow}>
      <Avatar
        uri={comment.author.avatarUrl}
        nickname={comment.author.nickname}
        displayName={comment.author.displayName}
        size={36}
        border="quiet"
      />
      <View style={styles.commentBody}>
        <View style={styles.commentMeta}>
          <Text style={styles.commentAuthor} numberOfLines={1}>
            {labelOf(comment.author)}
          </Text>
          <Text style={styles.commentWhen}>{commentWhen(comment.createdAt)}</Text>
        </View>
        <Text style={styles.commentText} maxFontSizeMultiplier={FontScaleCap.body}>
          {comment.body}
        </Text>
      </View>
      {comment.canDelete ? (
        <Pressable
          onPress={() => onDelete(comment)}
          hitSlop={8}
          style={({ pressed }) => [styles.deleteComment, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Smazat komentář"
        >
          <Trash2Icon size={16} color={Colors.mutedText} />
        </Pressable>
      ) : null}
    </View>
  );
}

function NightDetailContent({ viewerAccountId }: { viewerAccountId: string | null }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const showToast = useToastStore((state) => state.show);
  const [night, setNight] = React.useState<PublishedNight | null>(null);
  const [comments, setComments] = React.useState<NightComment[] | null>(null);
  const [loadError, setLoadError] = React.useState(false);
  const [body, setBody] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [reloadNonce, setReloadNonce] = React.useState(0);
  const pendingCommentRef = React.useRef<{ body: string; clientId: string } | null>(null);

  const applyReaction = React.useCallback((nightId: string, rounds: number, myRound: boolean) => {
    setNight((current) => current?.id === nightId
      ? { ...current, rounds, myRound }
      : current);
  }, []);
  const { reactingIds, toggleReaction } = useNightReaction(applyReaction, showToast);
  const leaveRemovedNight = React.useCallback(() => router.back(), [router]);
  const openNightActions = useNightActions(leaveRemovedNight);

  React.useEffect(() => {
    if (!id) return undefined;
    const controller = new AbortController();
    void Promise.all([
      fetchNightDetail(id, controller.signal),
      fetchNightComments(id, controller.signal),
    ]).then(([nightResult, commentResult]) => {
      if (controller.signal.aborted) return;
      if (!nightResult.ok) {
        setLoadError(true);
        return;
      }
      const visibleNight = viewerAccountId
        ? filterNightFeedForSafety(viewerAccountId, [nightResult.night])[0]
        : nightResult.night;
      if (!visibleNight) {
        setLoadError(true);
        return;
      }
      setNight(visibleNight);
      setComments(
        commentResult.ok
          ? commentResult.comments.filter(
              (comment) =>
                !viewerAccountId ||
                !isNightFeedAccountBlocked(viewerAccountId, comment.author.id),
            )
          : [],
      );
    });
    return () => controller.abort();
  }, [id, reloadNonce, viewerAccountId]);

  React.useEffect(
    () =>
      subscribeNightFeedSafety((change) => {
        if (
          change.viewerAccountId &&
          change.viewerAccountId !== viewerAccountId
        ) return;

        if (!change.blocked) {
          setNight(null);
          setComments(null);
          setLoadError(false);
          setReloadNonce((value) => value + 1);
          return;
        }

        if (night?.author.id === change.targetAccountId) {
          setNight(null);
          setComments(null);
          router.back();
          return;
        }

        setNight((current) => {
          if (!current || !viewerAccountId) return current;
          return filterNightFeedForSafety(viewerAccountId, [current])[0] ?? null;
        });
        setComments((current) =>
          current?.filter((comment) => comment.author.id !== change.targetAccountId) ?? current,
        );
      }),
    [night?.author.id, router, viewerAccountId],
  );

  const openAuthor = (value: PublishedNight) => {
    if (!value.author.id || value.isMine) return;
    router.push(`/user?accountId=${encodeURIComponent(value.author.id)}` as Href);
  };

  const submit = () => {
    const trimmed = body.trim();
    if (!id || !trimmed || sending) return;
    const clientId = pendingCommentRef.current?.body === trimmed
      ? pendingCommentRef.current.clientId
      : generateUuidV4();
    pendingCommentRef.current = { body: trimmed, clientId };
    setSending(true);
    void createNightComment(id, trimmed, clientId).then((result) => {
      setSending(false);
      if (!result.ok) {
        showToast(result.detail);
        return;
      }
      setComments((current) => [...(current ?? []), result.comment]);
      setNight((current) => current ? { ...current, commentCount: current.commentCount + 1 } : current);
      pendingCommentRef.current = null;
      setBody('');
    });
  };

  const remove = (comment: NightComment) => {
    if (!id) return;
    void deleteNightComment(id, comment.id).then((result) => {
      if (!result.ok) {
        showToast(result.detail);
        return;
      }
      setComments((current) => current?.filter((row) => row.id !== comment.id) ?? []);
      setNight((current) => current
        ? { ...current, commentCount: Math.max(0, current.commentCount - 1) }
        : current);
    });
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
        <GlassIconButton size={40} accessibilityLabel="Zpátky" onPress={() => router.back()}>
          <ChevronLeftIcon size={20} color={Colors.foam} />
        </GlassIconButton>
        <Text style={styles.topTitle}>Večer</Text>
        {night ? (
          <GlassIconButton
            size={40}
            accessibilityLabel="Možnosti večera"
            onPress={() => openNightActions(night)}
          >
            <MenuIcon size={19} color={Colors.foam} />
          </GlassIconButton>
        ) : (
          <View style={styles.topSpacer} />
        )}
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xxl }]}
        showsVerticalScrollIndicator={false}
      >
        {night ? (
          <>
            <FeedCard
              night={night}
              first
              reacting={reactingIds.has(night.id)}
              onToggleReaction={!night.isMine ? toggleReaction : undefined}
              onOpenAuthor={!night.isMine ? openAuthor : undefined}
            />
            <PeopleSection night={night} />
            <View style={styles.section}>
              <Text style={styles.sectionTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                Komentáře
              </Text>
              {comments === null ? (
                <View style={styles.commentSkeletons}>
                  <SkeletonBlock width="100%" height={56} reduceMotion={reduceMotion} />
                  <SkeletonBlock width="82%" height={56} reduceMotion={reduceMotion} />
                </View>
              ) : comments.length > 0 ? (
                comments.map((comment) => (
                  <CommentRow key={comment.id} comment={comment} onDelete={remove} />
                ))
              ) : (
                <Text style={styles.emptyComments}>Zatím ticho. Cinkni první poznámku.</Text>
              )}
              <View style={styles.composer}>
                <TextInput
                  value={body}
                  onChangeText={setBody}
                  placeholder="Napiš něco k večeru"
                  placeholderTextColor={Colors.mutedText}
                  maxLength={500}
                  multiline
                  style={styles.input}
                  accessibilityLabel="Komentář k večeru"
                />
                <Pressable
                  onPress={submit}
                  disabled={!body.trim() || sending}
                  style={({ pressed }) => [
                    styles.send,
                    (!body.trim() || sending) && styles.sendDisabled,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Poslat komentář"
                >
                  <Text style={styles.sendText}>{sending ? 'Posílám…' : 'Poslat'}</Text>
                </Pressable>
              </View>
            </View>
          </>
        ) : loadError ? (
          <View style={styles.state}>
            <Text style={styles.stateTitle}>Tenhle večer se schoval</Text>
            <Pressable
              onPress={() => {
                setLoadError(false);
                setComments(null);
                setReloadNonce((value) => value + 1);
              }}
              style={styles.retry}
              accessibilityRole="button"
            >
              <Text style={styles.retryText}>Zkusit znovu</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.loading}>
            <SkeletonBlock width="52%" height={20} reduceMotion={reduceMotion} />
            <SkeletonBlock width="100%" height={180} reduceMotion={reduceMotion} />
            <SkeletonBlock width="100%" height={120} reduceMotion={reduceMotion} />
          </View>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

/**
 * Native-stack details remain mounted underneath profile/auth routes. Remount
 * the account-owned payload synchronously at an account boundary so an offline
 * replacement account can never inherit the previous viewer's night/comments.
 */
export default function NightDetailScreen() {
  const accountId = useAccountStore((state) => state.session?.accountId ?? null);
  return (
    <NightDetailContent
      key={accountId ?? 'account-pending'}
      viewerAccountId={accountId}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  pressed: { opacity: 0.65 },
  topBar: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  topTitle: { fontSize: 17, fontWeight: '800', color: Colors.foam },
  topSpacer: { width: 40 },
  content: { paddingHorizontal: 20 },
  section: {
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.12),
  },
  sectionTitle: { fontSize: 22, fontWeight: '800', color: Colors.foam, marginBottom: Spacing.md },
  podium: { minHeight: 112, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: Spacing.md },
  podiumPerson: { width: 84, alignItems: 'center', gap: Spacing.xs },
  podiumFirst: { alignSelf: 'flex-start' },
  podiumName: { width: '100%', textAlign: 'center', fontSize: 12, fontWeight: '700', color: Colors.foam },
  personRow: { minHeight: HitArea.min, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  personName: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.foam },
  commentSkeletons: { gap: Spacing.sm },
  commentRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  commentBody: { flex: 1, gap: 3 },
  commentMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  commentAuthor: { flexShrink: 1, fontSize: 13, fontWeight: '800', color: Colors.foam },
  commentWhen: { fontSize: 11, fontWeight: '500', color: Colors.mutedText },
  commentText: { fontSize: 15, lineHeight: 21, fontWeight: '400', color: Colors.foam },
  deleteComment: { width: HitArea.min, height: HitArea.min, alignItems: 'center', justifyContent: 'center' },
  emptyComments: { fontSize: 14, fontWeight: '500', color: Colors.mutedText, marginBottom: Spacing.md },
  composer: { gap: Spacing.sm, marginTop: Spacing.md },
  input: {
    minHeight: 84,
    maxHeight: 160,
    padding: Spacing.md,
    borderRadius: Radius.medium,
    color: Colors.foam,
    backgroundColor: withAlpha(Colors.foam, 0.07),
    fontSize: 15,
    lineHeight: 21,
    textAlignVertical: 'top',
  },
  send: {
    minHeight: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  sendDisabled: { opacity: 0.42 },
  sendText: { fontSize: 15, fontWeight: '800', color: Colors.stout },
  state: { minHeight: 360, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  stateTitle: { fontSize: 20, fontWeight: '800', color: Colors.foam },
  retry: { minHeight: HitArea.min, paddingHorizontal: Spacing.lg, justifyContent: 'center' },
  retryText: { fontSize: 14, fontWeight: '800', color: Colors.amber },
  loading: { gap: Spacing.lg, paddingTop: Spacing.xl },
});
