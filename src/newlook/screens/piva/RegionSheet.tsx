import React from 'react';
import { useRouter } from 'expo-router';
import { create } from 'zustand';

import { CZ_REGIONS, type CzRegion } from '@/data/beersClient';
import { t } from '@/i18n';
import { nvBack } from '@/newlook/navigation';

import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/overlays';
import { Card, Row, T } from '../../components/ui';
import { C } from '../../theme';

/** The region the Piva ranking is filtered to; null is the whole country. */
export const useRankingRegion = create<{ region: CzRegion | null; set: (region: CzRegion | null) => void }>((set) => ({
  region: null,
  set: (region) => set({ region }),
}));

export function regionLabel(region: CzRegion | null): string {
  return region ? t.nv.piva.regions[region] : t.nv.piva.region;
}

export function RegionSheet() {
  const router = useRouter();
  const p = t.nv.piva;
  const current = useRankingRegion((st) => st.region);
  const options: (CzRegion | null)[] = [null, ...CZ_REGIONS];
  const pick = (region: CzRegion | null) => {
    useRankingRegion.getState().set(region);
    nvBack(router);
  };
  return (
    <Sheet title={p.regionTitle} top={110}>
      <T s={15} c={C.text2} lh={1.4} style={{ marginTop: -8 }}>
        {p.regionSub}
      </T>
      <Card>
        {options.map((region, i) => (
          <Row
            key={region ?? 'all'}
            last={i === options.length - 1}
            title={regionLabel(region)}
            titleColor={region === current ? C.yellow : C.white}
            trailing={region === current ? <Icon name="check" size={18} color={C.yellow} /> : null}
            onPress={() => pick(region)}
          />
        ))}
      </Card>
    </Sheet>
  );
}
