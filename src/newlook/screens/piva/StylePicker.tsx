import React from 'react';
import { View } from 'react-native';

import { BEER_DEGREES, type BeerDegree, type StyleAnswer } from '@/data/beersClient';
import { t } from '@/i18n';

import { Chip, ChipWrap, Press, T } from '../../components/ui';
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

/** 10°, 11°, 12°, 13° a víc as one row of chips. */
export function DegreePicker({ value, onPick, onUnknown }: { value?: BeerDegree | null; onPick: (degree: BeerDegree) => void; onUnknown?: () => void }) {
  return (
    <View style={{ gap: 8 }}>
      <ChipWrap>
        {BEER_DEGREES.map((degree) => (
          <Chip key={degree} label={t.nv.piva.degrees[degree]} active={value === degree} plain onPress={() => onPick(degree)} />
        ))}
      </ChipWrap>
      {onUnknown ? <UnknownButton onPress={onUnknown} /> : null}
    </View>
  );
}

function UnknownButton({ onPress }: { onPress: () => void }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" style={{ alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 12 }}>
      <T s={14} w={600} c={C.muted}>
        {t.nv.piva.stylePick.unknown}
      </T>
    </Press>
  );
}
