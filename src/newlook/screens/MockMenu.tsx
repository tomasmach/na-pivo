import React from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { Sheet } from '../components/overlays';
import { Card, Row, Segmented, T, Toggle } from '../components/ui';
import { PLANS, TONIGHT } from '../mock/data';
import { dialog, toast, useMock, type KompasScenario } from '../mock/store';
import { C } from '../theme';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <T s={15} w={700} c={C.muted}>
        {title}
      </T>
      <Card>{children}</Card>
    </View>
  );
}

type Link = [string, Href | (() => void)];

/** Index of every screen and switch for the states the mock cannot reach naturally. */
export function MockMenuSheet() {
  const router = useRouter();
  const st = useMock();
  const go = (target: Href | (() => void)) => () => {
    if (typeof target === 'function') {
      router.back();
      setTimeout(target, 300);
    } else {
      router.back();
      setTimeout(() => router.push(target), 250);
    }
  };
  const links = (items: Link[]) =>
    items.map(([label, target], i) => <Row key={label} last={i === items.length - 1} title={label} chevron onPress={go(target)} />);
  const toggle = (label: string, value: boolean, onChange: (v: boolean) => void, sub?: string, last?: boolean) => (
    <Row title={label} sub={sub} last={last} trailing={<Toggle value={value} onChange={onChange} />} />
  );

  return (
    <Sheet title="Mock: obrazovky a stavy" top={80}>
      <Section title="Stavy">
        <Row
          title="Kompas"
          sub="Hledání v okolí"
          trailing={
            <Segmented<KompasScenario>
              style={{ width: 190 }}
              height={34}
              options={[
                { key: 'normal', label: 'OK' },
                { key: 'empty', label: 'Nic' },
                { key: 'error', label: 'Chyba' },
              ]}
              value={st.kompas === 'noresults' ? 'normal' : st.kompas}
              onChange={(k) => st.set({ kompas: k })}
            />
          }
        />
        {toggle('Bez signálu', st.offline, (v) => st.set({ offline: v }), 'Nahlášení a zápisy čekají ve frontě')}
        {toggle('Žebříček piv se teprve plní', st.pivaEarly, (v) => st.set({ pivaEarly: v }))}
        {toggle('Moje přidané hospody', st.addedPubs, (v) => st.set({ addedPubs: v }), 'Vypnuto = prázdný stav')}
        {toggle('Upozornění na hlídaná piva', st.watchAlerts, (v) => st.set({ watchAlerts: v, watched: v ? ['raptor', 'unetice'] : [] }), 'Vypnuto = prázdný stav s varováním')}
        {toggle('Parta má plány', st.plans.length > 0, (v) => st.set({ plans: v ? PLANS : [] }))}
        {toggle('E-mail neověřený', st.emailUnverified, (v) => st.set({ emailUnverified: v }))}
        {toggle('Jediné přihlášení (Apple)', st.singleLogin, (v) => st.set({ singleLogin: v }))}
        {toggle('Domovský bod nastavený', st.homeSet, (v) => st.set({ homeSet: v }), 'Zapne kartu posledního spoje')}
        {toggle('Večer u Kláry', st.atFriend === 'klara', (v) => st.set({ atFriend: v ? 'klara' : null }), 'Štamgast u někoho doma')}
        {toggle(
          'Tour běží',
          st.tourActive,
          (v) => (v ? st.startTour() : st.set({ tourActive: false, tourStops: ['todo', 'todo', 'todo', 'todo', 'todo'] })),
          'Segment Tour, lišta nad taby, kompas na zastávku',
        )}
        {toggle('Vyvěšování už nastavené', st.shareMode !== null, (v) => st.set({ shareMode: v ? 'all' : null }), 'Vypnuto = obrazovka prvního vyvěšení', true)}
      </Section>
      <Section title="Toasty a dialogy">
        {links([
          ['Toast · uloženo', () => toast({ kind: 'saved', title: 'Mám ji, díky!' })],
          ['Toast · offline', () => toast({ kind: 'offline', title: 'Hospoda čeká na připojení.', sub: 'Uložil jsem ji v telefonu.' })],
          ['Toast · chyba', () => toast({ kind: 'error', title: 'Teď to nešlo uložit.', sub: 'Zkus to za chvíli.' })],
          ['Toast · XP', () => toast({ kind: 'xp', title: 'Díky za zmapování!', xp: 20 })],
          ['Toast · informace', () => toast({ kind: 'info', title: 'Zablokováno.', sub: 'Odblokuješ ve Správě party.', icon: 'ban' })],
          ['Nová medaile', () => toast({ kind: 'medal', title: 'Nová medaile: Noční sova', sub: 'Večer se protáhl přes půlnoc.', icon: 'moon', href: '/nv/odznaky' })],
          [
            'Dialog · potvrzení',
            () =>
              dialog({
                title: 'Svolat partu?',
                body: 'Všem šesti pípne, že sedíš U Zlatého tygra a máš volné místo u stolu.',
                actions: [{ label: 'Zpátky' }, { label: 'Svolat', kind: 'primary' }],
              }),
          ],
          [
            'Dialog · destruktivní',
            () =>
              dialog({
                title: 'Smazat fotku?',
                body: 'Zmizí z alba i ze soutěže. Tohle vrátit neumím.',
                actions: [{ label: 'Nechat' }, { label: 'Smazat', kind: 'danger' }],
              }),
          ],
        ])}
      </Section>
      <Section title="Účet">
        {links([
          ['Onboarding', '/nv/onboarding'],
          ['Přihlášení', '/nv/prihlaseni'],
          ['Dokonči si účet', '/nv/dokoncit-ucet'],
          ['Nový level', '/nv/novy-level'],
          ['Obnova hesla', '/nv/obnova-hesla'],
          ['Neplatný odkaz', { pathname: '/nv/vysledek', params: { kind: 'neplatny' } }],
          ['E-mail ověřen', { pathname: '/nv/vysledek', params: { kind: 'overen' } }],
          ['Ověření se nezdařilo', { pathname: '/nv/vysledek', params: { kind: 'neovereno' } }],
          ['Pozvánka do party z odkazu', '/nv/pozvanka-do-party'],
        ])}
      </Section>
      <Section title="Mimo appku">
        {links([
          ['Zamčená obrazovka · poslední spoj', { pathname: '/nv/notifikace', params: { kind: 'spoj' } }],
          ['Notifikace · na čepu poblíž', { pathname: '/nv/notifikace', params: { kind: 'cep' } }],
          ['Notifikace · u hospody', { pathname: '/nv/notifikace', params: { kind: 'hospoda' } }],
          ['Nabídka připomínek', '/nv/pripominky'],
          ['Jirka naskenoval QR tour', { pathname: '/nv/tour-verejna', params: { joined: '1' } }],
        ])}
      </Section>
      <Section title="Data">
        {links([
          [
            'Vrátit dnešní večer na začátek',
            () => {
              useMock.getState().set({ tonight: TONIGHT, newBeerNudge: null, stickerNudge: false, tourBanner: null });
              toast({ kind: 'info', title: 'Večer je zpátky na třech pivech.', icon: 'rotate-cw' });
            },
          ],
        ])}
      </Section>
    </Sheet>
  );
}
