import React from 'react';
import { View } from 'react-native';

import { t } from '@/i18n';

import { GlassButton } from '../components/chrome';
import { useBook, useWindowInsets, type RailSide } from './layout';

const SIZE = 52;
// Where the status bar ends in the column, measured on the iPhone Duo simulator (iOS 27.1):
// folded the camera sits above the clock, open as a book the clock starts at the top.
const BELOW_STATUS_FOLDED = 168;
const BELOW_STATUS_BOOK = 116;

/** Back at the top of the iPhone Duo's side column, first after the clock, like the system's toolbar. */
export function ColumnBack({ side, onPress }: { side: RailSide; onPress: () => void }) {
  const insets = useWindowInsets();
  const { book } = useBook();
  const column = side === 'right' ? insets.right : insets.left;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: book ? BELOW_STATUS_BOOK : BELOW_STATUS_FOLDED, [side]: (column - SIZE) / 2 }}>
      <GlassButton icon="chevron-left" size={SIZE} label={t.nv.profil.chrome.back} onPress={onPress} />
    </View>
  );
}
