/**
 * AddFriendTools — the shared "SEŽEŇ PARTU" growth block (Parta 3.0 §3).
 *
 * Extracted from FriendsScreen (`renderGrowthActions` + `renderSearch`) so the
 * add-friend surface can live in two places: the Parta cold-start hook and the
 * Profile "Správa party" screen. It owns its own search state (query / results /
 * searching + a seq guard) and the send/share/identity flows; the parent owns the
 * CodeSheet mount (via `onOpenCode`) and reloads its dashboard on `onChanged`.
 *
 * `hasIdentity === false` renders the identity gate instead of the code/invite
 * actions — a nickname is required before a QR/invite makes sense.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter, type Href } from 'expo-router';

import {
  fetchFriendInviteCode,
  searchFriends,
  sendFriendRequest,
  type FriendProfile,
} from '@/data/friendsClient';
import {
  enqueueFriendOp,
  isRetriableFriendError,
  type FriendQueueItem,
} from '@/data/friendsQueue';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { GlowButton } from '@/components/shared/GlowButton';
import {
  LinkIcon,
  PlusIcon,
  QrCodeIcon,
  SearchIcon,
  UserPlusIcon,
  UsersIcon,
  XIcon,
} from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { useToastStore } from '@/stores/toastStore';

import { FriendMini } from './FriendMini';
import HairlineRow from './HairlineRow';

const ROUND_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 } as const;

interface AddFriendToolsProps {
  hasIdentity: boolean;
  needsNickname: boolean;
  /** Parent mounts the CodeSheet (Modal state lives above the ScrollView). */
  onOpenCode: () => void;
  /** After a successful request → reload the parent dashboard. */
  onChanged: () => void;
  /** Show the @nickname search row (default true). */
  showSearch?: boolean;
}

export function AddFriendTools({
  hasIdentity,
  needsNickname,
  onOpenCode,
  onChanged,
  showSearch = true,
}: AddFriendToolsProps) {
  const router = useRouter();
  const showToast = useToastStore((s) => s.show);

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<FriendProfile[]>([]);
  const [requestingKey, setRequestingKey] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // Search seq guard + AbortSignal: a double-tap or fast retype can't let a stale
  // response clobber a newer one (parity with FriendsScreen §A1).
  const searchSeqRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const doSearch = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) return;
    const seq = ++searchSeqRef.current;
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearching(true);
    const found = await searchFriends(q, controller.signal);
    if (!mountedRef.current || seq !== searchSeqRef.current) return;
    setSearching(false);
    setResults(found ?? []);
    if (found === null) {
      showToast(cs.friends.offline, {
        icon: <UsersIcon size={20} color={Colors.amber} />,
      });
    }
  }, [query, showToast]);

  const requestFriend = useCallback(
    async (profile?: FriendProfile) => {
      const nickname = query.trim().replace(/^@/, '');
      if (!profile && nickname.length < 2) return;
      const requestKey = profile?.id ?? `nickname:${nickname.toLocaleLowerCase('cs-CZ')}`;
      if (requestingKey) return;
      trackUiInteraction('friend_request_send', 'submit');
      setRequestingKey(requestKey);
      const queuedRequest: FriendQueueItem =
        profile
          ? { op: 'request', key: `account:${profile.id}`, accountId: profile.id }
          : { op: 'request', key: `nickname:${nickname.toLocaleLowerCase('cs-CZ')}`, nickname };
      const result = profile
        ? await sendFriendRequest({ accountId: profile.id })
        : await sendFriendRequest({ nickname });
      if (!mountedRef.current) return;
      setRequestingKey(null);
      if (result.ok || isRetriableFriendError(result)) {
        trackUiInteraction('friend_request_send', 'success');
        if (!result.ok) {
          await enqueueFriendOp(queuedRequest);
          if (!mountedRef.current) return;
        }
        showToast(cs.friends.requestSent, {
          icon: <UserPlusIcon size={20} color={Colors.amber} />,
        });
        setQuery('');
        setResults([]);
        onChanged();
      } else {
        trackUiInteraction('friend_request_send', 'failure');
        showToast(result.detail, { icon: <XIcon size={20} color={Colors.amber} /> });
      }
    },
    [onChanged, query, requestingKey, showToast],
  );

  const openIdentity = useCallback(() => {
    router.push((needsNickname ? '/profile/edit' : '/auth') as Href);
  }, [needsNickname, router]);

  const shareInvite = useCallback(async () => {
    trackUiInteraction('friend_invite_share', 'share');
    const invite = await fetchFriendInviteCode();
    if (!mountedRef.current) return;
    const link = invite?.webUrl || invite?.url || '';
    if (!link) {
      showToast(cs.friends.codeOffline, { icon: <LinkIcon size={20} color={Colors.amber} /> });
      return;
    }
    await Share.share({ message: cs.friends.shareMessage(link) });
  }, [showToast]);

  if (!hasIdentity) {
    return (
      <View style={styles.identityGate}>
        <Text style={styles.gateTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
          {needsNickname
            ? cs.friends.coldStartSetupTitle
            : cs.friends.coldStartAnonTitle}
        </Text>
        <Text style={styles.gateBody} maxFontSizeMultiplier={FontScaleCap.body}>
          {needsNickname ? cs.friends.coldStartSetupBody : cs.friends.coldStartAnonBody}
        </Text>
        <GlowButton
          label={needsNickname ? cs.friends.coldStartSetupCta : cs.friends.coldStartAnonCta}
          onPress={openIdentity}
          variant="primary"
          glow="soft"
        />
      </View>
    );
  }

  return (
    <>
      <View style={styles.growthActions}>
        <GlowButton
          label={cs.friends.myCodeCta}
          onPress={onOpenCode}
          variant="primary"
          glow="soft"
          icon={<QrCodeIcon size={20} color={Colors.stout} />}
        />
        <GlowButton
          label={cs.friends.inviteShareCta}
          onPress={() => void shareInvite()}
          variant="secondary"
          glow="none"
          height={52}
          icon={<LinkIcon size={18} color={Colors.foam} />}
        />
      </View>

      {showSearch ? (
        <View style={styles.searchGap}>
          <View style={styles.searchRow}>
            <SearchIcon size={19} color={Colors.mutedText} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={cs.friends.searchPlaceholder}
              placeholderTextColor={Colors.mutedText}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.searchInput}
              returnKeyType="search"
              onSubmitEditing={() => void doSearch()}
              maxFontSizeMultiplier={FontScaleCap.body}
            />
            <Pressable
              onPress={() => void doSearch()}
              accessibilityRole="button"
              accessibilityLabel={cs.friends.searchCta}
              style={({ pressed }) => [styles.searchButton, pressed && styles.dim]}
            >
              {searching ? (
                <ActivityIndicator color={Colors.stout} size="small" />
              ) : (
                <Text
                  style={styles.searchButtonText}
                  maxFontSizeMultiplier={FontScaleCap.heading}
                >
                  {cs.friends.searchCta}
                </Text>
              )}
            </Pressable>
          </View>

          {results.length > 0 ? (
            <View style={styles.searchResults}>
              {results.map((profile, i) => (
                <HairlineRow key={profile.id} first={i === 0}>
                  <View style={styles.searchResultRow}>
                    <FriendMini profile={profile} />
                    <Pressable
                      onPress={() => void requestFriend(profile)}
                      disabled={requestingKey != null}
                      hitSlop={ROUND_HIT_SLOP}
                      accessibilityRole="button"
                      accessibilityLabel={cs.friends.addByNickname}
                      style={({ pressed }) => [styles.addBtn, pressed && styles.dim]}
                    >
                      {requestingKey === profile.id ? (
                        <ActivityIndicator color={Colors.stout} size="small" />
                      ) : (
                        <PlusIcon size={18} color={Colors.stout} />
                      )}
                    </Pressable>
                  </View>
                </HairlineRow>
              ))}
            </View>
          ) : null}

          {query.trim().length >= 2 && results.length === 0 && !searching ? (
            <>
              <Text style={styles.noResults} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.friends.noResults}
              </Text>
              <HairlineRow
                first
                onPress={requestingKey == null ? () => void requestFriend() : undefined}
              >
                <View style={styles.nicknameInvite}>
                  {requestingKey?.startsWith('nickname:') ? (
                    <ActivityIndicator color={Colors.amber} size="small" />
                  ) : (
                    <UserPlusIcon size={18} color={Colors.amber} />
                  )}
                  <Text
                    style={styles.nicknameInviteText}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {cs.friends.addByNickname}
                  </Text>
                </View>
              </HairlineRow>
            </>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  growthActions: {
    gap: Spacing.sm,
  },
  searchGap: {
    marginTop: Spacing.md,
  },
  dim: {
    opacity: 0.6,
  },

  // — Identity gate —
  identityGate: {
    gap: Spacing.sm,
  },
  gateTitle: {
    fontWeight: '800',
    fontSize: 18,
    color: Colors.foam,
  },
  gateBody: {
    fontWeight: '500',
    fontSize: 14,
    lineHeight: 20,
    color: Colors.foamMuted,
    marginBottom: Spacing.xs,
  },

  // — Search / add —
  searchRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingLeft: Spacing.md,
    paddingRight: 6,
  },
  searchInput: {
    flex: 1,
    fontWeight: '600',
    color: Colors.foam,
    fontSize: 16,
    paddingVertical: 12,
  },
  searchButton: {
    minWidth: 76,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  searchButtonText: {
    fontWeight: '800',
    color: Colors.stout,
    fontSize: 15,
  },
  searchResults: {
    marginTop: Spacing.sm,
  },
  searchResultRow: {
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
  noResults: {
    marginTop: Spacing.md,
    fontWeight: '500',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
  },
  nicknameInvite: {
    minHeight: HitArea.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  nicknameInviteText: {
    flex: 1,
    fontWeight: '600',
    color: Colors.amber,
    fontSize: 14,
  },
});

export default AddFriendTools;
