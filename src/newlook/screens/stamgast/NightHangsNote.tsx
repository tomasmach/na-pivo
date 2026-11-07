import React from 'react';
import { View } from 'react-native';

import { t } from '@/i18n';
import { useVycepStore } from '@/stores/vycepStore';
import { nightClientKey } from '@/vycep/nightModel';

import { Icon } from '../../components/Icon';
import { T } from '../../components/ui';
import { C, s } from '../../theme';

/** Set once the night hangs on the Výčep, also when Dopito posted it on its own. */
export function useNightHangs(day: string) {
  return useVycepStore((st) => st.published[nightClientKey(day)]);
}

/** Stands in for the post button, which would only say the night already hangs. */
export function NightHangsNote({ visibility, align = 'center' }: { visibility: 'public' | 'friends'; align?: 'center' | 'flex-start' }) {
  return (
    <View style={[s.row, { gap: 8, justifyContent: align, paddingVertical: 6 }]}>
      <Icon name="circle-check" size={16} color={C.yellow} />
      <T s={14} w={600} c={C.text2}>
        {visibility === 'public' ? t.nv.stamgast.hangsWorld : t.nv.stamgast.hangsParta}
      </T>
    </View>
  );
}
