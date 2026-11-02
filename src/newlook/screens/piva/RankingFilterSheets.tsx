import React from 'react';
import { useRouter } from 'expo-router';
import { create } from 'zustand';

import { BEER_DEGREES, CZ_REGIONS, type BeerDegree, type CzRegion } from '@/data/beersClient';
import { t } from '@/i18n';
import { nvBack } from '@/newlook/navigation';

import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/overlays';
import { Card, Row, T } from '../../components/ui';
import { C } from '../../theme';

/** The region and degrees the Piva ranking is filtered to; null is everything. */
export const useRankingRegion = create<{
  region: CzRegion | null;
  degree: BeerDegree | null;
  set: (region: CzRegion | null) => void;
  setDegree: (degree: BeerDegree | null) => void;
}>((set) => ({
  region: null,
  degree: null,
  set: (region) => set({ region }),
  setDegree: (degree) => set({ degree }),
}));

export function degreeLabel(degree: BeerDegree | null): string {
  return degree ? t.nv.piva.degrees[degree] : t.nv.piva.degreeAll;
}

export function DegreeSheet() {
  const router = useRouter();
  const p = t.nv.piva;
  const current = useRankingRegion((st) => st.degree);
  const options: (BeerDegree | null)[] = [null, ...BEER_DEGREES];
  return (
    <Sheet title={p.degreeTitle} scroll={false}>
      <Card>
        {options.map((degree, i) => (
          <Row
            key={degree ?? 'all'}
            last={i === options.length - 1}
            title={degree ? p.degrees[degree] : p.degreeAllOption}
            titleColor={degree === current ? C.yellow : C.white}
            trailing={degree === current ? <Icon name="check" size={18} color={C.yellow} /> : null}
            onPress={() => {
              useRankingRegion.getState().setDegree(degree);
              nvBack(router);
            }}
          />
        ))}
      </Card>
    </Sheet>
  );
}

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
