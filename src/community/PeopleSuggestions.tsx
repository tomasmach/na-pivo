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
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CheckIcon, UserPlusIcon } from '@/components/shared/IconGlyph';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

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

function SuggestionCard({ person }: { person: Suggestion }) {
  const [added, setAdded] = useState(false);

  return (
    <View style={styles.card}>
      <Image source={{ uri: person.avatar }} style={styles.avatar} />
      <Text style={styles.handle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
        {person.handle}
      </Text>
      <Text style={styles.reason} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
        {person.reason}
      </Text>
      <Pressable
        onPress={() => setAdded((current) => !current)}
        style={({ pressed }) => [styles.button, added && styles.buttonOn, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityState={{ selected: added }}
        accessibilityLabel={added ? `Žádost odeslána ${person.handle}` : `Přidat ${person.handle}`}
      >
        {added ? (
          <CheckIcon size={14} color={Colors.mutedText} />
        ) : (
          <UserPlusIcon size={14} color={Colors.stout} />
        )}
        <Text style={[styles.buttonText, added && styles.buttonTextOn]} allowFontScaling={false}>
          {added ? 'Odesláno' : 'Přidat'}
        </Text>
      </Pressable>
    </View>
  );
}

export function PeopleSuggestions() {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
        Koho přidat
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {SUGGESTIONS.map((person) => (
          <SuggestionCard key={person.id} person={person} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm, marginBottom: Spacing.lg },
  title: { ...MockType.titleS, color: Colors.foam },
  row: { gap: Spacing.sm, paddingRight: Spacing.md },

  card: {
    width: 148,
    alignItems: 'center',
    gap: 4,
    padding: Spacing.md,
    borderRadius: MockLayout.cardRadius,
    backgroundColor: Colors.stout2,
  },
  avatar: { width: 54, height: 54, borderRadius: 27, marginBottom: 2 },
  handle: { ...MockType.bodySemibold, color: Colors.foam },
  reason: {
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 16,
    color: Colors.mutedText,
    textAlign: 'center',
    minHeight: 32,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 34,
    alignSelf: 'stretch',
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    marginTop: 4,
  },
  buttonOn: { backgroundColor: withAlpha(Colors.foam, 0.08) },
  buttonText: { fontSize: 13, fontWeight: '700', color: Colors.stout },
  buttonTextOn: { color: Colors.mutedText },
  pressed: { opacity: 0.7 },
});
