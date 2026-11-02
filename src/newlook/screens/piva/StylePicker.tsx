import React from 'react';
import { View } from 'react-native';

import type { StyleAnswer } from '@/data/beersClient';
import { t } from '@/i18n';

import { Press, T } from '../../components/ui';
import { C, s } from '../../theme';

const CHOICES = ['lager', 'ten', 'dark', 'craft', 'other'] as const;

/** "Jaký je to styl?" as five tiles with a plain hint each, so nobody has to know beer jargon. */
export function StylePicker({ value, onPick, onUnknown }: { value?: StyleAnswer | null; onPick: (style: StyleAnswer) => void; onUnknown?: () => void }) {
  const p = t.nv.piva.stylePick;
  return (
    <View style={{ gap: 8 }}>
      <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>
        {CHOICES.map((style) => {
          const on = value === style;
          return (
            <Press
              key={style}
              haptic
              onPress={() => onPick(style)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={{
                width: '48%',
                flexGrow: 1,
                paddingVertical: 9,
                paddingHorizontal: 12,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: on ? C.yellowEdge : C.line,
                backgroundColor: on ? C.yellowTint : C.card,
                gap: 2,
              }}
            >
              <T s={14} w={700} c={on ? C.yellow : C.white}>
                {p.options[style]}
              </T>
              <T s={12} c={C.muted} numberOfLines={1}>
                {p.hints[style]}
              </T>
            </Press>
          );
        })}
      </View>
      {onUnknown ? (
        <Press onPress={onUnknown} accessibilityRole="button" style={{ alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 12 }}>
          <T s={14} w={600} c={C.muted}>
            {p.unknown}
          </T>
        </Press>
      ) : null}
    </View>
  );
}
