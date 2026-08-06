import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { CheckIcon, UserPlusIcon } from '@/components/shared/IconGlyph';
import {
  fetchFriendSuggestions,
  sendFriendRequest,
  type FriendProfile,
} from '@/data/friendsClient';
import SkeletonBlock from '@/friends/SkeletonBlock';
import { Avatar } from '@/profile/Avatar';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

function label(person: FriendProfile): string {
  return person.nickname ? `@${person.nickname}` : person.displayName;
}

export function PeopleSuggestions() {
  const reduceMotion = useReducedMotion();
  const showToast = useToastStore((state) => state.show);
  const [people, setPeople] = useState<FriendProfile[] | null>(null);
  const [sent, setSent] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const controller = new AbortController();
    void fetchFriendSuggestions(controller.signal).then((result) => {
      if (!controller.signal.aborted) setPeople(result ?? []);
    });
    return () => controller.abort();
  }, []);

  const add = (person: FriendProfile) => {
    if (busy.has(person.id) || sent.has(person.id)) return;
    setBusy((current) => new Set(current).add(person.id));
    void sendFriendRequest({ accountId: person.id }).then((result) => {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(person.id);
        return next;
      });
      if (result.ok) {
        setSent((current) => new Set(current).add(person.id));
        showToast('Žádost je na cestě.');
      } else {
        showToast(result.detail);
      }
    });
  };

  if (people === null) {
    return (
      <View style={styles.loading} accessibilityLabel="Načítám doporučené pivaře">
        <SkeletonBlock width="100%" height={52} reduceMotion={reduceMotion} />
        <SkeletonBlock width="100%" height={52} reduceMotion={reduceMotion} />
      </View>
    );
  }
  if (people.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {people.map((person, index) => {
        const added = sent.has(person.id);
        const personLabel = label(person);
        return (
          <Pressable
            key={person.id}
            onPress={() => add(person)}
            disabled={busy.has(person.id) || added}
            style={({ pressed }) => [
              styles.row,
              index === 0 && styles.rowFirst,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy.has(person.id) || added }}
            accessibilityLabel={added ? `Žádost odeslána ${personLabel}` : `Přidat ${personLabel}`}
          >
            <Avatar
              uri={person.avatarUrl}
              nickname={person.nickname}
              displayName={person.displayName}
              size={40}
              border="quiet"
            />
            <Text style={styles.handle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
              {personLabel}
            </Text>
            {added ? (
              <CheckIcon size={18} color={Colors.mutedText} />
            ) : (
              <UserPlusIcon size={18} color={Colors.amber} />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: Spacing.lg },
  loading: { gap: Spacing.sm, marginBottom: Spacing.lg },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  rowFirst: { borderTopWidth: 0 },
  handle: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.foam },
  pressed: { opacity: 0.65 },
});
