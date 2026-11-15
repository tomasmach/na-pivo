import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { REDESIGN_LETTER_VERSION } from '@/data/localReleaseNote';
import { t } from '@/i18n';
import { nvBack } from '@/newlook/navigation';
import { useReleaseStore } from '@/stores/releaseStore';

import { Screen } from '../../components/chrome';
import { Button, D, T } from '../../components/ui';
import { C, HAND_FONT, s } from '../../theme';

const majorMinor = (version: string | null) => version?.split('.').slice(0, 2).join('.') ?? null;

/** The author's letter about the 2.5.0 redesign, shown once after the update. */
export function VzkazScreen() {
  const router = useRouter();
  const left = useRef(false);
  const [previous] = useState(() => majorMinor(useReleaseStore.getState().lastSeenVersion));
  const current = majorMinor(REDESIGN_LETTER_VERSION);
  const copy = t.nv.profil.letter;

  useEffect(() => () => useReleaseStore.getState().dismissNote(), []);

  const leave = () => {
    if (left.current) return;
    left.current = true;
    nvBack(router);
  };

  return (
    <Screen footer={<Button label={copy.done} onPress={leave} />} gap={14} padTop={12} contentStyle={{ flexGrow: 1, justifyContent: 'center' }}>
      <View style={[s.row, { gap: 12, alignItems: 'baseline' }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {previous && previous !== current ? (
          <D s={44} c={C.lineBright} style={{ textDecorationLine: 'line-through' }}>
            {previous}
          </D>
        ) : null}
        <D s={72} c={C.yellow}>
          {current}
        </D>
      </View>
      <D s={44}>{copy.title}</D>
      {copy.paragraphs.map((paragraph) => (
        <T key={paragraph} s={16} c={C.text2} lh={1.45}>
          {paragraph}
        </T>
      ))}
      <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: HAND_FONT, fontSize: 32, color: C.yellow, marginTop: 4 }}>
        {copy.signature}
      </Text>
    </Screen>
  );
}
