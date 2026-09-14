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
  followAccount,
  searchFriends,
  type FriendProfile,
} from '@/data/friendsClient';
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
import { t } from '@/i18n';
import { MockColors } from '@/mocks/mockTheme';
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
  /** Show the legacy code/share actions above search (default true). */
  showInviteActions?: boolean;
  /** Parent-owned draft survives the native Modal host being torn down. */
  queryValue?: string;
  resultsValue?: FriendProfile[];
  onQueryChange?: (query: string) => void;
  onResultsChange?: (results: FriendProfile[]) => void;
}

export function AddFriendTools({
  hasIdentity,
  needsNickname,
  onOpenCode,
  onChanged,
  showSearch = true,
  showInviteActions = true,
  queryValue,
  resultsValue,
  onQueryChange,
  onResultsChange,
}: AddFriendToolsProps) {
  const router = useRouter();
  const showToast = useToastStore((s) => s.show);

  const [ownQuery, setOwnQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [ownResults, setOwnResults] = useState<FriendProfile[]>([]);
  const [requestingKey, setRequestingKey] = useState<string | null>(null);
  const query = queryValue ?? ownQuery;
  const results = resultsValue ?? ownResults;
  const setQuery = onQueryChange ?? setOwnQuery;
  const setResults = onResultsChange ?? setOwnResults;

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
      showToast(t.friends.offline, {
        icon: <UsersIcon size={20} color={Colors.amber} />,
      });
    }
  }, [query, setResults, showToast]);

  /**
   * Search now ends in a follow, not an invite. Sending a stranger a request
   * and waiting for them to confirm was the ceremony this rebuild removed —
   * being in someone's party is something you earn by sitting down with them,
   * and the QR/link above is how you get them to the table. Following is the
   * light thing you can do from a search result, so that is what the row does.
   */
  const followProfile = useCallback(
    async (profile: FriendProfile) => {
      if (requestingKey) return;
      trackUiInteraction('friend_follow', 'submit');
      setRequestingKey(profile.id);
      const result = await followAccount(profile.id);
      if (!mountedRef.current) return;
      setRequestingKey(null);
      if (result.ok) {
        trackUiInteraction('friend_follow', 'success');
        showToast(t.friends.followed, {
          icon: <UserPlusIcon size={20} color={Colors.amber} />,
        });
        setQuery('');
        setResults([]);
        onChanged();
      } else {
        trackUiInteraction('friend_follow', 'failure');
        showToast(result.detail, { icon: <XIcon size={20} color={Colors.amber} /> });
      }
    },
    [onChanged, requestingKey, setQuery, setResults, showToast],
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
      showToast(t.friends.codeOffline, { icon: <LinkIcon size={20} color={Colors.amber} /> });
      return;
    }
    await Share.share({ message: t.friends.shareMessage(link) });
  }, [showToast]);

  if (!hasIdentity) {
    return (
      <View style={styles.identityGate}>
        <Text style={styles.gateTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
          {needsNickname
            ? t.friends.coldStartSetupTitle
            : t.friends.coldStartAnonTitle}
        </Text>
        <GlowButton
          label={needsNickname ? t.friends.coldStartSetupCta : t.friends.coldStartAnonCta}
          onPress={openIdentity}
          variant="primary"
          glow="none"
        />
      </View>
    );
  }

  return (
    <>
      {showInviteActions ? <View style={styles.growthActions}>
        <GlowButton
          label={t.friends.myCodeCta}
          onPress={onOpenCode}
          variant="primary"
          glow="none"
          icon={<QrCodeIcon size={20} color={Colors.stout} />}
        />
        <GlowButton
          label={t.friends.inviteShareCta}
          onPress={() => void shareInvite()}
          variant="secondary"
          glow="none"
          height={52}
          icon={<LinkIcon size={18} color={Colors.foam} />}
        />
      </View> : null}

      {showSearch ? (
        <View style={styles.searchGap}>
          <View style={styles.searchRow}>
            <SearchIcon size={19} color={Colors.mutedText} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t.friends.searchPlaceholder}
              placeholderTextColor={MockColors.fieldHint}
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
              accessibilityLabel={t.friends.searchCta}
              style={({ pressed }) => [styles.searchButton, pressed && styles.dim]}
            >
              {searching ? (
                <ActivityIndicator color={Colors.foam} size="small" />
              ) : (
                <Text
                  style={styles.searchButtonText}
                  maxFontSizeMultiplier={FontScaleCap.heading}
                >
                  {t.friends.searchCta}
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
                      onPress={() => void followProfile(profile)}
                      disabled={requestingKey != null}
                      hitSlop={ROUND_HIT_SLOP}
                      accessibilityRole="button"
                      accessibilityLabel={`${t.friends.follow}: ${profile.nickname ?? profile.displayName}`}
                      style={({ pressed }) => [styles.addBtn, pressed && styles.dim]}
                    >
                      {requestingKey === profile.id ? (
                      <ActivityIndicator color={Colors.foam} size="small" />
                    ) : (
                        <PlusIcon size={18} color={Colors.foam} />
                      )}
                    </Pressable>
                  </View>
                </HairlineRow>
              ))}
            </View>
          ) : null}

          {query.trim().length >= 2 && results.length === 0 && !searching ? (
            <Text style={styles.noResults} maxFontSizeMultiplier={FontScaleCap.body}>
              {t.friends.noResults}
            </Text>
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
    backgroundColor: Colors.stout3,
  },
  searchButtonText: {
    fontWeight: '800',
    color: Colors.foam,
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
    backgroundColor: Colors.stout3,
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
