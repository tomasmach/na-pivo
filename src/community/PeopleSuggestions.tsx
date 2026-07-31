/**
 * DESIGN MOCK — who to follow, on the Community tab.
 *
 * Ranked the way we agreed: ACTIVE first, then friends of friends. Each row
 * says WHY it is there, because a suggestion without a reason is just a stranger
 * — and this app is asking you to link your drinking history to someone.
 *
 * The gates are not negotiable and are taken straight from `FriendSearchView`
 * (`backend/pubs/api/views.py:3797`): `is_public=True`, `status=ACTIVE`, not
 * ghost, not blocked in either direction, not already friends, not you.
 *
 * NOTE FOR SHIPPING: "follow" does not exist in the model. There is
 * `Friendship` (mutual, confirmed) and `FriendBlock`. Asymmetric following is a
 * migration, so the real version of this sends a friend REQUEST — which is also
 * why the button says "Přidat" and not "Sledovat". And it stays a suggestion
 * with a tap, never an automatic link: sitting in the same pub as someone is not
 * consent to a permanent social edge.
 */

import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { CheckIcon, UserPlusIcon } from '@/components/shared/IconGlyph';
import { MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

const AVATARS = 'https://i.pravatar.cc/160?img=';

interface Suggestion {
  id: string;
  handle: string;
  /** Why this person is being suggested — shown, never implied. */
  reason: string;
  avatar: string;
}

const SUGGESTIONS: Suggestion[] = [
  { id: 's1', handle: '@ležák', reason: 'Byl dnes ve třech hospodách', avatar: `${AVATARS}12` },
  { id: 's2', handle: '@kvasnice', reason: 'Pije tam, kde ty', avatar: `${AVATARS}33` },
  { id: 's3', handle: '@sládek', reason: 'Kamarád @sudíka', avatar: `${AVATARS}68` },
  { id: 's4', handle: '@pípa', reason: 'Kamarád @pěny a @klárky', avatar: `${AVATARS}15` },
  { id: 's5', handle: '@tuplák', reason: 'Kamarád @chmeláka', avatar: `${AVATARS}52` },
];

/**
 * A row, not a card. Cards for five people turned a supporting section into the
 * loudest block on the screen, and the "Přidat" button on each one made it five
 * competing amber surfaces. The row IS the action — tapping it sends the
 * request — and the reason sits where a subtitle goes.
 */
function SuggestionRow({ person, first }: { person: Suggestion; first: boolean }) {
  const [added, setAdded] = useState(false);

  return (
    <Pressable
      onPress={() => setAdded((current) => !current)}
      style={({ pressed }) => [styles.row, first && styles.rowFirst, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ selected: added }}
      accessibilityLabel={added ? `Žádost odeslána ${person.handle}` : `Přidat ${person.handle}`}
    >
      <Image source={{ uri: person.avatar }} style={styles.avatar} />
      <View style={styles.body}>
        <Text style={styles.handle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {person.handle}
        </Text>
        <Text style={styles.reason} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {person.reason}
        </Text>
      </View>
      {added ? (
        <CheckIcon size={18} color={Colors.mutedText} />
      ) : (
        <UserPlusIcon size={18} color={Colors.amber} />
      )}
    </Pressable>
  );
}

export function PeopleSuggestions() {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
        Koho přidat
      </Text>
      {SUGGESTIONS.map((person, index) => (
        <SuggestionRow key={person.id} person={person} first={index === 0} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: Spacing.lg },
  title: { ...MockType.titleS, color: Colors.foam, marginBottom: Spacing.xs },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  rowFirst: { borderTopWidth: 0 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  body: { flex: 1 },
  handle: { ...MockType.bodySemibold, color: Colors.foam },
  reason: { fontSize: 13, fontWeight: '400', color: Colors.mutedText, marginTop: 1 },
  pressed: { opacity: 0.65 },
});
