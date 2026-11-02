import React from 'react';
import { View } from 'react-native';

import { BEER_DEGREES, type BeerDegree, type StyleAnswer } from '@/data/beersClient';
import { t } from '@/i18n';

import { Press, T } from '../../components/ui';
import { C, s } from '../../theme';

const KINDS = ['pale', 'amber', 'dark', 'craft', 'other'] as const;

/** "Co je to za pivo?" as five tiles with a plain hint each, so nobody has to know beer jargon. */
export function KindPicker({ value, onPick, onUnknown }: { value?: StyleAnswer | null; onPick: (kind: StyleAnswer) => void; onUnknown?: () => void }) {
  const p = t.nv.piva.stylePick;
  return (
    <View style={{ gap: 8 }}>
      <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>
        {KINDS.map((kind) => {
          const on = value === kind;
          return (
            <Press
              key={kind}
              haptic
              onPress={() => onPick(kind)}
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
                {p.options[kind]}
              </T>
              <T s={12} c={C.muted} numberOfLines={1}>
                {p.hints[kind]}
              </T>
            </Press>
          );
        })}
      </View>
      {onUnknown ? <UnknownButton onPress={onUnknown} /> : null}
    </View>
  );
}

/** do 9° … 13°+ as one row of equal tiles. */
export function DegreePicker({ value, onPick, onUnknown }: { value?: BeerDegree | null; onPick: (degree: BeerDegree) => void; onUnknown?: () => void }) {
  return (
    <View style={{ gap: 8 }}>
      <View style={[s.row, { gap: 6 }]}>
        {BEER_DEGREES.map((degree) => {
          const on = value === degree;
          return (
            <Press
              key={degree}
              haptic
              onPress={() => onPick(degree)}
              accessibilityRole="button"
              accessibilityLabel={t.nv.piva.degrees[degree]}
              accessibilityState={{ selected: on }}
              style={[
                s.center,
                {
                  flex: 1,
                  height: 48,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: on ? C.yellowEdge : C.line,
                  backgroundColor: on ? C.yellowTint : C.card,
                },
              ]}
            >
              <T s={15} w={700} c={on ? C.yellow : C.white} numberOfLines={1}>
                {t.nv.piva.degreesShort[degree]}
              </T>
            </Press>
          );
        })}
      </View>
      {onUnknown ? <UnknownButton onPress={onUnknown} /> : null}
    </View>
  );
}

function UnknownButton({ onPress }: { onPress: () => void }) {
  return (
    <Press
      haptic
      onPress={onPress}
      accessibilityRole="button"
      style={[s.center, { height: 44, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.control }]}
    >
      <T s={15} w={700} c={C.text2}>
        {t.nv.piva.stylePick.unknown}
      </T>
    </Press>
  );
}
