/**
 * Přisednout ke stolu — the other end of the invite.
 *
 * Somebody read six characters across the table, or sent a link. This is where
 * they go in. Six boxes rather than one field, because that is the difference
 * between "did I type five or six" and knowing at a glance, and because it
 * makes the keyboard numeric-ish and the caps automatic without a hint line.
 *
 * The code is upper-cased and filtered as you type: the server's alphabet has no
 * O, I, L, S or Z, so somebody typing what they heard as "O" gets nothing rather
 * than a code that fails on submit. Deleting is by the whole field — a backspace
 * dance across six boxes is a thing to design only once you have watched
 * somebody fail at it.
 */

import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import { cleanJoinCode, JOIN_CODE_LENGTH } from '@/data/joinCode';
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap, Fonts } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

const LENGTH = JOIN_CODE_LENGTH;

export function JoinTableSheet({
  visible,
  busy,
  error,
  onJoin,
  onClose,
}: {
  visible: boolean;
  busy: boolean;
  /** Whatever the server said, in Czech. Shown under the boxes. */
  error: string | null;
  onJoin: (code: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [code, setCode] = React.useState('');
  const input = React.useRef<TextInput>(null);
  const complete = code.length === LENGTH;

  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      <KeyboardAvoidingView
        style={styles.keyboardWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        pointerEvents="box-none"
      >
        <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.header}>
            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              Přisednout ke stolu
            </Text>
            <CloseButton onPress={onClose} />
          </View>

          <Text style={styles.hint} maxFontSizeMultiplier={FontScaleCap.body}>
            Kód máš od toho, kdo večer založil.
          </Text>

          {/* One real field, six drawn boxes. Six separate inputs would mean six
              focus states to keep in step and a paste that lands in one of them. */}
          <Pressable
            onPress={() => input.current?.focus()}
            style={styles.boxes}
            accessibilityRole="button"
            accessibilityLabel="Zadat kód stolu"
          >
            {Array.from({ length: LENGTH }).map((_, index) => (
              <View
                key={index}
                style={[styles.box, index === code.length && styles.boxActive]}
              >
                <Text style={styles.boxText} allowFontScaling={false}>
                  {code[index] ?? ''}
                </Text>
              </View>
            ))}
            <TextInput
              ref={input}
              value={code}
              onChangeText={(value) => setCode(cleanJoinCode(value))}
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus={visible}
              maxLength={LENGTH}
              style={styles.field}
              onSubmitEditing={() => complete && onJoin(code)}
              returnKeyType="go"
              accessibilityLabel="Kód stolu"
            />
          </Pressable>

          {error ? (
            <Text style={styles.error} maxFontSizeMultiplier={FontScaleCap.body}>
              {error}
            </Text>
          ) : null}

          <Pressable
            onPress={() => onJoin(code)}
            disabled={!complete || busy}
            style={({ pressed }) => [
              styles.action,
              (!complete || busy) && styles.actionOff,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !complete || busy }}
            accessibilityLabel="Přisednout"
          >
            <Text style={styles.actionText} maxFontSizeMultiplier={FontScaleCap.heading}>
              {busy ? 'Připojuju…' : 'Přisednout'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  keyboardWrap: { flex: 1, justifyContent: 'flex-end' },
  pressed: { opacity: 0.8 },
  card: {
    backgroundColor: MockColors.surface,
    borderTopLeftRadius: MockLayout.cardRadius,
    borderTopRightRadius: MockLayout.cardRadius,
    paddingHorizontal: MockLayout.screenPad,
    paddingTop: Spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { ...MockType.titleS, color: Colors.foam },
  hint: { fontSize: 14, fontWeight: '500', color: Colors.mutedText, marginTop: Spacing.xs },

  boxes: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginTop: Spacing.lg,
  },
  box: {
    flex: 1,
    height: 58,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: MockColors.surfaceHigh,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  boxActive: { borderColor: withAlpha(Colors.amber, 0.7) },
  boxText: { fontFamily: Fonts.numeral, fontSize: 24, color: Colors.foam },
  // The field itself is invisible and covers the boxes, so a tap anywhere on
  // them focuses it and the caret never shows up in the wrong place.
  field: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    color: 'transparent',
  },

  error: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.amber,
    marginTop: Spacing.sm,
  },

  action: {
    height: MockLayout.sheetButtonHeight,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.lg,
    backgroundColor: Colors.amber,
  },
  actionOff: { opacity: 0.4 },
  actionText: { ...MockType.buttonLabel, color: Colors.stout },
});
