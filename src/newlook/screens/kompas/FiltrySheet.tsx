import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { ButtonPair, Sheet } from '../../components/overlays';
import { Card, Chip, ChipWrap, Row, T, Toggle } from '../../components/ui';
import type { IconName } from '../../components/Icon';
import { matchingPubs, useMock } from '../../mock/store';
import { C } from '../../theme';

const BEER_CHIPS: [string, string][] = [
  ['pilsner', 'Pilsner Urquell'],
  ['kozel', 'Kozel'],
  ['gambrinus', 'Gambrinus'],
  ['radegast', 'Radegast'],
  ['budvar', 'Budvar'],
  ['staropramen', 'Staropramen'],
];

const FUN: [string, string, IconName][] = [
  ['sipky', 'Šipky', 'target'],
  ['kulecnik', 'Kulečník', 'circle-dot'],
  ['fotbalek', 'Fotbálek', 'goal'],
  ['tv', 'Sport v TV', 'tv'],
];

const PLACES: [string, string, IconName][] = [
  ['zahradka', 'Zahrádka', 'trees'],
  ['stanky', 'Stánky a kempy', 'tent'],
];

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 12 }}>
      <T s={15} w={700} c={C.muted}>
        {title}
      </T>
      <ChipWrap>{children}</ChipWrap>
    </View>
  );
}

export function FiltrySheet() {
  const router = useRouter();
  const st = useMock();
  const count = matchingPubs(st).length;
  return (
    <Sheet
      title="Kam dneska?"
      footer={
        <ButtonPair
          left="Zrušit"
          right={count ? `Ukázat ${count} ${count === 1 ? 'hospodu' : count < 5 ? 'hospody' : 'hospod'}` : 'Nic nesedí'}
          onLeft={() => router.back()}
          onRight={() => router.back()}
        />
      }
    >
      <Card>
        <Row
          title="Jen otevřené"
          sub="a ty s neznámou dobou"
          trailing={<Toggle value={st.openNow} onChange={(v) => st.set({ openNow: v })} />}
        />
        <Row
          last
          title="Překvap mě"
          sub="místo nejbližší vyberu náhodnou"
          trailing={<Toggle value={st.surprise} onChange={(v) => st.set({ surprise: v })} />}
        />
      </Card>
      <Group title="Pivo">
        {BEER_CHIPS.map(([id, label]) => (
          <Chip key={id} label={label} active={st.beerFilter === id} onPress={() => st.set({ beerFilter: st.beerFilter === id ? null : id })} />
        ))}
        <Chip label="Jiné pivo…" icon="search" onPress={() => router.push('/nv/hledani')} />
      </Group>
      <Group title="Cena piva">
        {[50, 60, 70].map((p) => (
          <Chip key={p} label={`Do ${p} Kč`} active={st.maxPrice === p} onPress={() => st.set({ maxPrice: st.maxPrice === p ? null : p })} />
        ))}
      </Group>
      <Group title="Zábava">
        {FUN.map(([k, label, icon]) => (
          <Chip key={k} label={label} icon={st.tags.includes(k) ? 'check' : icon} active={st.tags.includes(k)} onPress={() => st.toggleTag(k)} />
        ))}
      </Group>
      <Group title="Místa">
        {PLACES.map(([k, label, icon]) => (
          <Chip key={k} label={label} icon={st.tags.includes(k) ? 'check' : icon} active={st.tags.includes(k)} onPress={() => st.toggleTag(k)} />
        ))}
      </Group>
    </Sheet>
  );
}
