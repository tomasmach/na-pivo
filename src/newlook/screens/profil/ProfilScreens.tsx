import React, { useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackHeader, Screen } from '../../components/chrome';
import { Field, Input, PageTitle } from '../../components/forms';
import { Icon, type IconName } from '../../components/Icon';
import { Sheet } from '../../components/overlays';
import { Button, Card, Chip, ChipWrap, D, IconButton, Kicker, Person, Press, ProgressRing, Row, Segmented, T, Tile, Toggle } from '../../components/ui';
import { ME, PUBS } from '../../mock/data';
import { dialog, toast, useMock } from '../../mock/store';
import { C, SCREEN_X, s } from '../../theme';
import { Dial } from '../kompas/Dial';

type BadgeView = { id: string; name: string; icon: IconName; got: boolean; sub: string; secret?: boolean };

const BADGE_GROUPS: { title: string; items: BadgeView[] }[] = [
  {
    title: 'Pivo',
    items: [
      { id: 'carkar', name: 'Čárkař II', icon: 'beer', got: true, sub: '142 / 250' },
      { id: 'ochutnavac', name: 'Ochutnávač I', icon: 'flask-conical', got: false, sub: '18 / 25 piv' },
      { id: 'tyden', name: 'Týden co týden', icon: 'calendar-check', got: true, sub: '6 týdnů' },
    ],
  },
  {
    title: 'Hospody',
    items: [
      { id: 'poutnik', name: 'Poutník I', icon: 'map', got: true, sub: 'hotovo' },
      { id: 'stamgast', name: 'Štamgast I', icon: 'landmark', got: true, sub: '5× na jednom místě' },
      { id: 'cestovatel', name: 'Cestovatel', icon: 'globe', got: false, sub: '2 / 5 měst' },
    ],
  },
  {
    title: 'Parta a fotky',
    items: [
      { id: 'parta', name: 'Parta I', icon: 'users', got: true, sub: 'hotovo' },
      { id: 'fotopivar', name: 'FotoPivař', icon: 'camera', got: false, sub: '0 / 1 fotka' },
      { id: 'vecer', name: 'Večer s partou', icon: 'party-popper', got: false, sub: '3 / 5' },
    ],
  },
  {
    title: 'Speciální',
    items: [
      { id: 'celytyden', name: 'Celý týden', icon: 'calendar-days', got: false, sub: '5 ze 7 dní' },
      { id: 'sova', name: 'Noční sova', icon: 'moon', got: true, sub: 'hotovo' },
      { id: 'tajne', name: 'Tajné', icon: 'lock', got: false, sub: 'přijde samo', secret: true },
    ],
  },
];

export function BadgeCircle({ icon, got, size = 76 }: { icon: IconName; got: boolean; size?: number }) {
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: got ? '#FFC4001A' : C.card, borderWidth: got ? 2.5 : 1, borderColor: got ? C.yellow : C.hairline },
        s.center,
      ]}
    >
      <Icon name={icon} size={size * 0.38} color={got ? C.yellow : C.muted} />
    </View>
  );
}

export function ProfilScreen() {
  const router = useRouter();
  const addedPubs = useMock((st) => st.addedPubs);
  const set = useMock((st) => st.set);
  return (
    <Screen header={<BackHeader />} gap={20}>
      <View style={[s.row, { gap: 16 }]}>
        <View style={{ width: 84, height: 84 }}>
          <ProgressRing size={84} progress={ME.xp / ME.xpNext} stroke={4} />
          <View style={[{ position: 'absolute', left: 8, top: 8, width: 68, height: 68, borderRadius: 34, backgroundColor: C.control }, s.center]}>
            <T s={28} w={800} c={C.yellow}>
              {ME.initial}
            </T>
          </View>
        </View>
        <View style={[s.fill, { gap: 2 }]}>
          <D s={34}>{`@${ME.nick}`}</D>
          <T s={14} c={C.muted}>{`Level ${ME.level} · ${ME.title} · veřejný profil`}</T>
        </View>
        <IconButton icon="pencil" size={40} iconSize={18} onPress={() => router.push('/nv/upravit-profil')} label="Upravit profil" />
        <IconButton icon="settings" size={40} iconSize={18} onPress={() => router.push('/nv/nastaveni')} label="Nastavení" />
      </View>
      <View style={[s.row, { gap: 14 }]}>
        <D s={96} lh={0.9} c={C.yellow}>
          {String(ME.lifetime)}
        </D>
        <View style={{ gap: 2 }}>
          <T s={19} w={700}>
            piv za život
          </T>
          <T s={13} c={C.muted}>{`od ${ME.since}`}</T>
        </View>
      </View>
      <Press onPress={() => router.push('/nv/novy-level')} style={{ gap: 10 }}>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <T s={14} w={600}>{`Do levelu ${ME.level + 1}`}</T>
          <T s={14} c={C.muted}>{`${ME.xp} / ${ME.xpNext} XP`}</T>
        </View>
        <View style={{ height: 10, borderRadius: 5, backgroundColor: C.control }}>
          <View style={{ width: `${(ME.xp / ME.xpNext) * 100}%`, height: 10, borderRadius: 5, backgroundColor: C.yellow }} />
        </View>
      </Press>
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        {[
          [String(ME.pubs), 'hospod'],
          [String(ME.evenings), 'večerů'],
          [ME.avg, 'piva na večer'],
          [ME.spent, 'utraceno'],
        ].map(([v, l]) => (
          <View key={l} style={{ gap: 2 }}>
            <D s={24} lh={1}>
              {v}
            </D>
            <T s={12} c={C.muted}>
              {l}
            </T>
          </View>
        ))}
      </View>
      <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 16, gap: 14 }}>
        <Press
          onPress={() => {
            set({ badgeDot: false });
            router.push('/nv/odznaky');
          }}
          style={[s.row, { justifyContent: 'space-between' }]}
        >
          <T s={17} w={700}>
            Odznaky
          </T>
          <T s={14} w={700} c={C.yellow}>
            9 z 26 ›
          </T>
        </Press>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14 }}>
          {[
            ['carkar', 'Čárkař II', 'beer'],
            ['poutnik', 'Poutník I', 'map'],
            ['parta', 'Parta I', 'users'],
            ['chatar', 'Chatař', 'house'],
            ['ochutnavac', 'Ochutnávač II', 'medal'],
          ].map(([id, name, icon]) => (
            <Press key={id} onPress={() => router.push({ pathname: '/nv/odznak', params: { id } })} style={{ alignItems: 'center', gap: 6 }}>
              <BadgeCircle icon={icon as IconName} got size={54} />
              <T s={11} w={600} c={C.text2}>
                {name}
              </T>
            </Press>
          ))}
        </ScrollView>
      </View>
      <Card>
        <Row leading={<Tile icon="image" />} title="Pivní fotky" trailing={<T s={15} w={600}>24</T>} chevron onPress={() => router.push('/nv/pivni-fotky')} />
        <Row leading={<Tile icon="heart" />} title="Srdcovky" trailing={<T s={15} w={600}>3</T>} chevron onPress={() => router.push('/nv/hledani')} />
        <Row leading={<Tile icon="map-pin-plus" />} title="Moje přidané hospody" trailing={<T s={15} w={600}>{addedPubs ? '4' : '0'}</T>} chevron onPress={() => router.push('/nv/moje-hospody')} />
        <Row leading={<Tile icon="route" />} title="Tour de pub" chevron onPress={() => router.push('/nv/tour')} />
        <Row last leading={<Tile icon="bell" />} title="Hlídaná piva" chevron onPress={() => router.push('/nv/hlidana-piva')} />
      </Card>
    </Screen>
  );
}

export function OdznakyScreen() {
  const router = useRouter();
  return (
    <Screen header={<BackHeader />} gap={18}>
      <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-end' }]}>
        <D s={44}>Odznaky</D>
        <T s={16} w={700} c={C.muted} style={{ marginBottom: 6 }}>
          9 z 26
        </T>
      </View>
      <Press onPress={() => router.push({ pathname: '/nv/odznak', params: { id: 'poutnik' } })} style={{ padding: 16, gap: 14, borderRadius: 22, backgroundColor: '#FFC4000D', borderWidth: 1, borderColor: '#FFC40059' }}>
        <View style={[s.row, { gap: 12 }]}>
          <View style={[{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.control }, s.center]}>
            <Icon name="signpost" size={18} color={C.yellow} />
          </View>
          <View style={{ gap: 2 }}>
            <T s={16} w={700}>
              Na řadě: Poutník II
            </T>
            <T s={13} c={C.muted}>
              Ještě 2 nové hospody
            </T>
          </View>
        </View>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: C.control }}>
          <View style={{ width: '60%', height: 8, borderRadius: 4, backgroundColor: C.yellow }} />
        </View>
      </Press>
      {BADGE_GROUPS.map((g) => (
        <View key={g.title} style={{ gap: 14 }}>
          <T s={17} w={700}>
            {g.title}
          </T>
          <View style={s.row}>
            {g.items.map((b) => (
              <Press key={b.id} onPress={() => router.push({ pathname: '/nv/odznak', params: { id: b.id } })} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
                <BadgeCircle icon={b.secret ? 'circle-question-mark' : b.icon} got={b.got} />
                <T s={13} w={700} c={b.got ? C.white : C.muted} style={{ textAlign: 'center' }}>
                  {b.name}
                </T>
                <T s={11} c={C.muted}>
                  {b.sub}
                </T>
              </Press>
            ))}
          </View>
        </View>
      ))}
    </Screen>
  );
}

export function OdznakSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (id === 'tajne') {
    return (
      <Sheet top={560} scroll={false} contentStyle={{ alignItems: 'center' }}>
        <View style={[{ width: 128, height: 128, borderRadius: 26, borderWidth: 2, borderStyle: 'dashed', borderColor: '#FFFFFF4D', marginTop: -20 }, s.center]}>
          <D s={64} c={C.text2}>
            ?
          </D>
        </View>
        <D s={34}>Tajné</D>
        <T s={15} c={C.text2} style={{ marginTop: -10 }}>
          Co to je, zjistíš, až ho získáš.
        </T>
        <View style={[s.row, { height: 38, borderRadius: 19, paddingHorizontal: 14, gap: 6, backgroundColor: C.control }]}>
          <Icon name="sparkles" size={15} color={C.text2} />
          <T s={14} w={700}>
            Přijde samo
          </T>
        </View>
      </Sheet>
    );
  }
  if (id === 'celytyden') {
    const days = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
    const got = [true, true, false, true, true, true, false];
    return (
      <Sheet top={490} scroll={false} contentStyle={{ alignItems: 'center' }}>
        <View style={[{ width: 130, height: 130, marginTop: -20 }, s.center]}>
          <ProgressRing size={130} progress={5 / 7} stroke={14} />
          <Icon name="calendar-days" size={40} color={C.text2} />
        </View>
        <D s={34}>Celý týden</D>
        <T s={14} c={C.muted} style={{ marginTop: -14 }}>
          5 ze 7 dní
        </T>
        <T s={15} c={C.text2} style={{ textAlign: 'center' }}>
          Dny se sbírají napořád, klidně s odstupem měsíců.
        </T>
        <View style={[s.row, { gap: 8 }]}>
          {days.map((d, i) => (
            <View key={d} style={[{ width: 40, height: 40, borderRadius: 20, borderWidth: got[i] ? 2 : 1, borderColor: got[i] ? C.yellow : C.hairline, backgroundColor: got[i] ? '#FFC4001A' : 'transparent' }, s.center]}>
              <T s={13} w={700} c={got[i] ? C.yellow : C.muted}>
                {d}
              </T>
            </View>
          ))}
        </View>
        <T s={16} w={700}>
          Chybí ti ještě 2 dny.
        </T>
      </Sheet>
    );
  }
  const levels = ['I', 'II', 'III', 'IV', 'V'];
  return (
    <Sheet top={310} scroll={false}>
      <View style={{ alignItems: 'center', gap: 6, marginTop: -20 }}>
        <View style={[{ width: 132, height: 132, borderRadius: 66, borderWidth: 3, borderColor: C.yellow, backgroundColor: '#FFC4001A' }, s.center]}>
          <View style={[{ width: 92, height: 92, borderRadius: 46, borderWidth: 1.5, borderColor: '#FFC40080' }, s.center]}>
            <Icon name="map" size={40} color={C.yellow} />
          </View>
        </View>
        <D s={38} style={{ marginTop: 10 }}>
          Poutník II
        </D>
        <T s={14} c={C.muted}>
          Úroveň 2 ze 5
        </T>
        <T s={16} c={C.text2} lh={1.4} style={{ textAlign: 'center', marginTop: 8 }}>
          Hospody, kde máš zapsané pivo nebo návštěvu. Každá se počítá jednou.
        </T>
      </View>
      <View style={{ padding: 14, borderRadius: 16, backgroundColor: C.card }}>
        <T s={14} c={C.text2} style={{ textAlign: 'center', fontStyle: 'italic' }}>
          „Hospoda za každým rohem a ty víš, za kterým.“
        </T>
      </View>
      <View style={{ gap: 10 }}>
        <T s={15} w={700}>
          Do úrovně 3 · Ještě 4 hospody
        </T>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: C.control }}>
          <View style={{ width: '60%', height: 8, borderRadius: 4, backgroundColor: C.yellow }} />
        </View>
      </View>
      <View style={{ gap: 10 }}>
        <T s={15} w={700} c={C.muted}>
          Úrovně
        </T>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          {levels.map((l, i) => (
            <View key={l} style={{ alignItems: 'center', gap: 6 }}>
              <View style={[{ width: 44, height: 44, borderRadius: 22, borderWidth: i < 2 ? 2 : 1, borderColor: i < 2 ? C.yellow : C.muted, backgroundColor: i < 2 ? '#FFC4001A' : 'transparent' }, s.center]}>
                <T s={14} w={800} c={i < 2 ? C.yellow : C.muted}>
                  {l}
                </T>
              </View>
              <T s={11} c={i < 2 ? C.white : C.muted}>
                {i < 2 ? 'Získáno' : 'Ještě ne'}
              </T>
            </View>
          ))}
        </View>
      </View>
      <View style={[s.row, { justifyContent: 'center', gap: 8 }]}>
        <Icon name="users" size={14} color={C.muted} />
        <T s={13} c={C.muted}>
          Tenhle odznak vidí i tvoje parta.
        </T>
      </View>
    </Sheet>
  );
}

export function NovyLevelSheet() {
  const router = useRouter();
  return (
    <Sheet closeIcon={false} top={400} scroll={false}>
      <View style={{ alignItems: 'center', gap: 16 }}>
        <View style={{ width: 124, height: 124 }}>
          <ProgressRing size={124} progress={0.999} stroke={8} />
          <View style={[{ position: 'absolute', left: 16, top: 16, width: 92, height: 92, borderRadius: 46, backgroundColor: C.control }, s.center]}>
            <T s={36} w={800} c={C.yellow}>
              T
            </T>
          </View>
        </View>
        <D s={36}>Level 6 · Pivní tovaryš</D>
      </View>
      <View style={{ gap: 10 }}>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <T s={14} w={700}>
            Do levelu 7
          </T>
          <T s={14} c={C.muted}>
            ještě 640 XP
          </T>
        </View>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: C.control }}>
          <View style={{ width: 10, height: 8, borderRadius: 4, backgroundColor: C.yellow }} />
        </View>
      </View>
      <T s={15} w={700} c={C.muted}>
        Co tě posunulo
      </T>
      <Row last leading={<Tile icon="map" color={C.white} />} title="Díky za zmapování" titleWeight={700} sub="U Zlatého tygra" trailing={<D s={24} c={C.yellow}>+20 XP</D>} />
      <Button label="Na zdraví" onPress={() => router.back()} />
    </Sheet>
  );
}

export function NastaveniScreen() {
  const router = useRouter();
  const st = useMock();
  const [rated, setRated] = useState(false);
  const [nav, setNav] = useState<'google' | 'mapy'>('google');
  const [reminders, setReminders] = useState({ pivo: true, spoj: false, voda: true });
  return (
    <Screen header={<BackHeader />} gap={14}>
      <PageTitle title="Nastavení" />
      <Card>
        <Row last leading={<Tile icon="user" />} title={`@${ME.nick}`} titleWeight={700} sub="Přihlášený přes Apple · účet a soukromí" chevron onPress={() => router.push('/nv/ucet')} />
      </Card>
      <T s={15} w={700} c={C.muted}>
        Výčep
      </T>
      <Card>
        <Row last title="Vyvěšovat noci" trailing={<T s={15} w={600}>{st.shareMode === 'all' ? 'Samo světu' : st.shareMode === 'parta' ? 'Samo partě' : 'Ručně'}</T>} chevron onPress={() => router.push('/nv/prvni-vyveseni')} />
      </Card>
      <T s={15} w={700} c={C.muted}>
        Kompas
      </T>
      <Card>
        <Row title="Jak daleko hledat" trailing={<T s={15} w={600}>Bez limitu</T>} chevron />
        <Row title="Radši dobře hodnocené" sub="Přeskočím podniky pod 4 hvězdy" trailing={<Toggle value={rated} onChange={setRated} />} />
        <Row
          title="Navigovat přes"
          trailing={
            <Segmented
              height={36}
              style={{ width: 180 }}
              options={[
                { key: 'google', label: 'Google' },
                { key: 'mapy', label: 'Mapy.com' },
              ]}
              value={nav}
              onChange={setNav}
            />
          }
        />
        <Row last title="Domovský bod" trailing={<T s={15} w={600}>{st.homeSet ? 'Korunní 12' : 'Nenastavený'}</T>} chevron onPress={() => router.push('/nv/domovsky-bod')} />
      </Card>
      <T s={15} w={700} c={C.muted}>
        Připomínky
      </T>
      <Card>
        <Row title="Připomenout další pivo" sub="Za 20 minut po každém pivu" trailing={<Toggle value={reminders.pivo} onChange={(v) => setReminders({ ...reminders, pivo: v })} />} />
        <Row
          title="Připomenout poslední spoj"
          sub="Jen Praha a okolí, potřebuju domovský bod"
          trailing={
            <Toggle
              value={reminders.spoj && st.homeSet}
              onChange={(v) => {
                if (!st.homeSet) router.push('/nv/domovsky-bod');
                else setReminders({ ...reminders, spoj: v });
              }}
            />
          }
        />
        <Row title="Připomenout vodu" sub="Po čtyřech pivech" trailing={<Toggle value={reminders.voda} onChange={(v) => setReminders({ ...reminders, voda: v })} />} />
        <Row last title="Cinknout, když sednu do hospody" chevron onPress={() => router.push('/nv/pripominky')} />
      </Card>
      <T s={15} w={700} c={C.muted}>
        Ostatní
      </T>
      <Card>
        <Row title="Sdílení a soukromí" chevron onPress={() => router.push('/nv/sdileni-souhlas')} />
        <Row title="Napiš mi" chevron onPress={() => router.push('/nv/napis-mi')} />
        <Row last title="O appce" chevron onPress={() => router.push('/nv/o-appce')} />
      </Card>
      <T s={15} w={700} c={C.muted}>
        Mock
      </T>
      <Card>
        <Row last leading={<Tile icon="layers" />} title="Všechny obrazovky a stavy" sub="Přepínače pro prázdné a chybové stavy" chevron onPress={() => router.push('/nv/mock')} />
      </Card>
    </Screen>
  );
}

export function UpravitProfilScreen() {
  const router = useRouter();
  const [name, setName] = useState('Tomáš');
  const [nick, setNick] = useState('tomas');
  const [pub, setPub] = useState(true);
  return (
    <Screen
      header={<BackHeader />}
      footer={
        <Button
          label="Uložit"
          onPress={() => {
            router.back();
            toast({ kind: 'saved', title: 'Profil uložený.', icon: 'check' });
          }}
        />
      }
      gap={16}
    >
      <PageTitle title="Upravit profil" />
      <View style={{ alignItems: 'center', gap: 10 }}>
        <Person initial="T" size={96} />
        <T s={15} w={700} c={C.yellow}>
          Změnit fotku
        </T>
      </View>
      <Field label="Jméno (nepovinné)">
        <Input value={name} onChangeText={setName} />
      </Field>
      <View style={{ gap: 8 }}>
        <Field label="Přezdívka">
          <Input value={`@ ${nick}`} onChangeText={(v) => setNick(v.replace(/^@\s?/, ''))} autoCapitalize="none" />
        </Field>
        <T s={13} c={C.muted}>
          Pod @přezdívkou tě najdou kamarádi.
        </T>
      </View>
      <Card>
        <Row last title="Veřejný profil" trailing={<Toggle value={pub} onChange={setPub} />} />
      </Card>
      <T s={13} c={C.muted} lh={1.45}>
        Veřejný profil tě zviditelní v žebříčcích a vyhledávání podle přezdívky a fotky. Poloha ani jednotlivá piva se nikdy nezveřejňují.
      </T>
    </Screen>
  );
}

export function DokonciUcetSheet() {
  const router = useRouter();
  const [nick, setNick] = useState('');
  return (
    <Sheet closeIcon={false} top={480} scroll={false}>
      <View style={{ gap: 6 }}>
        <Kicker color={C.yellow}>Dokonči si účet</Kicker>
        <D s={34}>Chybí ti @přezdívka</D>
      </View>
      <T s={15} c={C.text2} lh={1.45} style={{ marginTop: -6 }}>
        Účet máš, ale bez přezdívky tě parta nenajde. Vyber si ji a profil, kamarádi i žebříčky pojedou naplno.
      </T>
      <View style={{ gap: 8 }}>
        <T s={13} w={600} c={C.muted}>
          Přezdívka
        </T>
        <Input value={nick} onChangeText={setNick} placeholder="@ tvoje přezdívka" autoFocus autoCapitalize="none" />
        <T s={12} c={C.muted}>
          Pod @přezdívkou tě najdou kamarádi.
        </T>
      </View>
      <Button
        label="Uložit přezdívku"
        disabled={nick.trim().length < 3}
        onPress={() => {
          router.back();
          toast({ kind: 'saved', title: `Jsi @${nick.trim()}.`, icon: 'check' });
        }}
      />
      <Press onPress={() => router.back()} style={{ alignItems: 'center', paddingBottom: 6 }}>
        <T s={15} w={700} c={C.text2}>
          Teď ne
        </T>
      </Press>
    </Sheet>
  );
}

export function UcetScreen() {
  const router = useRouter();
  const st = useMock();
  const verified = !st.emailUnverified;
  return (
    <Screen header={<BackHeader />} gap={16}>
      <PageTitle title="Účet" />
      <View style={{ backgroundColor: C.card, borderRadius: 24, paddingHorizontal: 16, paddingTop: 14 }}>
        <View style={[s.row, { gap: 12, paddingBottom: 14 }]}>
          <Tile icon="mail" />
          <View style={{ gap: 3 }}>
            <T s={16} w={600}>
              tomas@napivo.cz
            </T>
            {verified ? (
              <View style={[s.row, { gap: 5 }]}>
                <Icon name="badge-check" size={14} color={C.yellow} />
                <T s={13} c={C.text2}>
                  E-mail ověřen
                </T>
              </View>
            ) : null}
          </View>
        </View>
        {!verified ? (
          <View style={[s.row, { gap: 10, padding: 12, marginBottom: 12, borderRadius: 14, backgroundColor: '#FFC40014', borderWidth: 1, borderColor: '#FFC40059' }]}>
            <Icon name="mail-warning" size={18} color={C.yellow} />
            <T s={13} c={C.text2} style={s.fill}>
              E-mail ještě není ověřený.
            </T>
            <Press onPress={() => toast({ kind: 'saved', title: 'Poslal jsem nový odkaz.', icon: 'mail' })}>
              <T s={13} w={700} c={C.yellow}>
                Poslat znovu
              </T>
            </Press>
          </View>
        ) : null}
        <Row last title="Jak se přihlašuješ" trailing={<T s={14} c={C.text2}>{st.singleLogin ? 'Apple' : 'Apple, e-mail'}</T>} chevron onPress={() => router.push('/nv/prihlasovani')} />
      </View>
      <T s={15} w={700} c={C.muted}>
        Co ještě?
      </T>
      <Card>
        <Row title="Poslat moje data e-mailem" chevron onPress={() => toast({ kind: 'saved', title: 'Data letí e-mailem.', sub: 'Do hodiny je máš ve schránce.', icon: 'mail' })} />
        <Row title="Odhlásit se" chevron onPress={() => router.push('/nv/prihlaseni')} />
        <Row
          last
          title="Smazat účet"
          titleColor={C.danger}
          chevron
          onPress={() =>
            dialog({
              title: 'Smazat účet?',
              body: 'Tvůj účet a data se po krátké lhůtě nevratně smažou. Vrátit to nejde.',
              actions: [{ label: 'Zrušit' }, { label: 'Smazat', kind: 'danger', onPress: () => router.push('/nv/onboarding') }],
            })
          }
        />
      </Card>
    </Screen>
  );
}

export function PrihlasovaniSheet() {
  const single = useMock((st) => st.singleLogin);
  const set = useMock((st) => st.set);
  const rows: [IconName, string, string, 'off' | 'on' | 'set' | 'lock'][] = single
    ? [
        ['mail', 'E-mail a heslo', 'Není propojeno', 'set'],
        ['globe', 'Google', 'Není propojeno', 'on'],
        ['apple', 'Apple', 'Jediné přihlášení, odpojit nejde', 'lock'],
      ]
    : [
        ['mail', 'E-mail a heslo', 'Propojeno', 'off'],
        ['globe', 'Google', 'Není propojeno', 'on'],
        ['apple', 'Apple', 'Propojeno', 'off'],
      ];
  return (
    <Sheet title="Jak se přihlašuješ" top={single ? 560 : 600} scroll={false}>
      {single ? (
        <T s={15} c={C.text2} style={{ marginTop: -8 }}>
          Přihlásíš se jen přes Apple.
        </T>
      ) : null}
      <Card>
        {rows.map(([icon, title, sub, action], i) => (
          <Row
            key={title}
            last={i === rows.length - 1}
            leading={<Tile icon={icon} color={C.white} />}
            title={title}
            sub={sub}
            trailing={
              action === 'lock' ? (
                <Icon name="lock" size={16} color={C.muted} />
              ) : (
                <Chip
                  label={action === 'off' ? 'Odpojit' : action === 'set' ? 'Nastavit heslo' : 'Propojit'}
                  plain
                  active={action !== 'off'}
                  height={34}
                  onPress={() => {
                    if (action === 'off') set({ singleLogin: true });
                    else toast({ kind: 'saved', title: `${title} propojeno.`, icon: 'link' });
                  }}
                />
              )
            }
          />
        ))}
      </Card>
    </Sheet>
  );
}

export function PrihlaseniScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('tomas@napivo.cz');
  const done = () => {
    router.dismissAll();
    router.replace('/nv/kompas');
  };
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: SCREEN_X, gap: 16, paddingBottom: 160 }}>
        <Press onPress={done} style={{ alignSelf: 'flex-end' }}>
          <T s={15} w={600} c={C.muted}>
            Zatím bez účtu
          </T>
        </Press>
        <PageTitle title="Ať o piva nepřijdeš" intro="Přihlas se a deník, parta i odznaky ti naskočí na každém telefonu." />
        <Segmented
          height={40}
          options={[
            { key: 'login', label: 'Přihlásit se' },
            { key: 'register', label: 'Registrovat' },
          ]}
          value={mode}
          onChange={setMode}
        />
        <Button label="Pokračovat přes Apple" icon="apple" kind="white" height={52} onPress={done} />
        <Button label="G  Pokračovat přes Google" kind="raised" height={52} onPress={done} />
        <View style={[s.row, { gap: 12 }]}>
          <View style={[s.fill, { height: 1, backgroundColor: C.hairline }]} />
          <T s={13} c={C.muted}>
            nebo e-mailem
          </T>
          <View style={[s.fill, { height: 1, backgroundColor: C.hairline }]} />
        </View>
        <Field label="E-mail">
          <Input value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
        </Field>
        <Field label="Heslo">
          <Input placeholder="Alespoň 8 znaků" secureTextEntry />
        </Field>
      </ScrollView>
      <View style={{ position: 'absolute', left: SCREEN_X, right: SCREEN_X, bottom: Math.max(insets.bottom, 16) + 4, gap: 14 }}>
        <Button label={mode === 'login' ? 'Přihlásit se' : 'Registrovat'} onPress={done} />
        <Press onPress={() => router.push('/nv/obnova-hesla')} style={{ alignItems: 'center' }}>
          <T s={14} w={600} c={C.yellow}>
            Zapomenuté heslo?
          </T>
        </Press>
      </View>
    </View>
  );
}

export function ObnovaHeslaScreen() {
  const router = useRouter();
  return (
    <Screen header={<BackHeader icon="x" />} footer={<Button label="Změnit heslo" onPress={() => router.replace({ pathname: '/nv/vysledek', params: { kind: 'neplatny' } })} />} gap={16}>
      <PageTitle title="Obnova hesla" />
      <Field label="Kód z e-mailu">
        <Input placeholder="Vlož sem celý kód" />
      </Field>
      <Field label="Nové heslo">
        <Input placeholder="Alespoň 8 znaků" secureTextEntry />
      </Field>
    </Screen>
  );
}

const RESULTS: Record<string, { icon: IconName; title: string; body: string; button: string; raised?: boolean }> = {
  neplatny: { icon: 'link-2-off', title: 'Neplatný odkaz', body: 'Tento odkaz na obnovu hesla už neplatí. Vyžádej si nový.', button: 'Zpět do aplikace' },
  overen: { icon: 'badge-check', title: 'E-mail ověřen', body: 'Díky! Tvůj e-mail je teď ověřený.', button: 'Zpět do aplikace' },
  neovereno: { icon: 'mail-x', title: 'Ověření se nezdařilo', body: 'Odkaz už vypršel nebo byl použitý. Pošlu ti nový z obrazovky Účet.', button: 'Zpět do aplikace' },
  diky: { icon: 'send', title: 'Díky!', body: 'Zpráva dorazí, i kdyby teď zrovna nebylo připojení. Odešlu ji, jakmile budeš online.', button: 'Zavřít', raised: true },
};

/** One-message screens: verified e-mail, broken link, thanks. */
export function VysledekScreen() {
  const router = useRouter();
  const { kind } = useLocalSearchParams<{ kind: string }>();
  const r = RESULTS[kind ?? 'overen'] ?? RESULTS.overen;
  return (
    <Screen footer={<Button label={r.button} kind={r.raised ? 'raised' : 'primary'} onPress={() => (router.canGoBack() ? router.back() : router.replace('/nv/kompas'))} />}>
      <View style={{ marginTop: 130, gap: 18 }}>
        <Tile icon={r.icon} size={64} radius={32} />
        <D s={44}>{r.title}</D>
        <T s={16} c={C.text2} lh={1.45} style={{ marginTop: -6 }}>
          {r.body}
        </T>
      </View>
    </Screen>
  );
}

export function SpravaPartyScreen() {
  const router = useRouter();
  const [blocked, setBlocked] = useState(true);
  return (
    <Screen header={<BackHeader />} gap={16}>
      <PageTitle title="Správa party" />
      <T s={17} w={700}>
        Můj kód
      </T>
      <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 20, gap: 16, alignItems: 'center' }}>
        <View style={{ padding: 14, borderRadius: 22, backgroundColor: C.white }}>
          <QRCode value="https://na-pivo.cz/p/tomas" size={200} color={C.black} backgroundColor={C.white} />
        </View>
        <T s={14} c={C.text2} style={{ textAlign: 'center' }}>
          Ukaž kámošovi QR kód nebo mu pošli pozvánku odkazem.
        </T>
        <Button label="Sdílet pozvánku" icon="share" style={{ alignSelf: 'stretch' }} onPress={() => router.push('/nv/pozvanka-do-party')} />
        <Button label="Poslat odkaz" icon="link" kind="raised" style={{ alignSelf: 'stretch' }} onPress={() => toast({ kind: 'saved', title: 'Odkaz zkopírovaný.', icon: 'copy' })} />
      </View>
      <T s={17} w={700}>
        Přidat do party
      </T>
      <View style={[s.row, { gap: 10 }]}>
        <View style={s.fill}>
          <Input placeholder="@ Přezdívka kámoše" autoCapitalize="none" />
        </View>
        <Button label="Najít" kind="raised" height={48} style={{ paddingHorizontal: 16 }} onPress={() => router.push('/nv/pozvanka-do-party')} />
      </View>
      <T s={17} w={700}>
        Kámoši
      </T>
      <Card>
        {[
          ['K', '@KlaraNaCepu', 'Klára na čepu · level 7', 'klara'],
          ['J', '@jirka', 'Jirka · level 4', 'jirka'],
          ['M', '@majda', 'Magda · level 3', 'petra'],
        ].map(([i, n, sub, id], idx) => (
          <Row key={n} last={idx === 2} leading={<Person initial={i} />} title={n} sub={sub} chevron onPress={() => router.push({ pathname: '/nv/kamos/[id]', params: { id } })} />
        ))}
      </Card>
      {blocked ? (
        <>
          <T s={17} w={700}>
            Zablokovaní
          </T>
          <Card>
            <Row
              last
              leading={<Person initial="P" ring={false} />}
              title="@pivni_troll"
              trailing={<Chip label="Odblokovat" plain height={34} onPress={() => setBlocked(false)} />}
            />
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

export function PozvankaDoPartySheet() {
  const router = useRouter();
  return (
    <Sheet closeIcon={false} top={360} scroll={false}>
      <View style={{ alignItems: 'center', gap: 10, marginTop: -6 }}>
        <Kicker>Pozvánka do party</Kicker>
        <Person initial="K" size={84} />
        <D s={34}>Klára na čepu</D>
        <T s={14} c={C.muted} style={{ marginTop: -6 }}>
          @KlaraNaCepu · Štamgastka, level 7
        </T>
      </View>
      <View style={[s.row, { padding: 14, borderRadius: 18, backgroundColor: C.card }]}>
        {[
          ['211', 'piv'],
          ['38', 'hospod'],
          ['12', 'odznaků'],
        ].map(([v, l]) => (
          <View key={l} style={{ flex: 1, alignItems: 'center' }}>
            <D s={26}>{v}</D>
            <T s={12} c={C.muted}>
              {l}
            </T>
          </View>
        ))}
      </View>
      <T s={15} c={C.text2} style={{ textAlign: 'center' }}>
        V partě uvidíte, kdo z vás je zrovna na pivu, a můžete si cinknout.
      </T>
      <View style={[s.row, { justifyContent: 'center', gap: 8 }]}>
        <View style={s.row}>
          {['J', 'M'].map((x, i) => (
            <View key={x} style={{ marginLeft: i ? -8 : 0 }}>
              <Person initial={x} size={26} ring={false} />
            </View>
          ))}
        </View>
        <T s={13} c={C.muted}>
          Jirka a Marek už s ní v partě jsou
        </T>
      </View>
      <Button
        label="Přidat Kláru do party"
        icon="user-plus"
        onPress={() => {
          router.back();
          toast({ kind: 'saved', title: 'Klára je v partě.', icon: 'user-plus' });
        }}
      />
      <Press onPress={() => router.back()} style={{ alignItems: 'center', paddingBottom: 6 }}>
        <T s={15} w={700} c={C.text2}>
          Teď ne
        </T>
      </Press>
    </Sheet>
  );
}

export function NapisMiScreen() {
  const router = useRouter();
  const [kind, setKind] = useState('Chyba');
  const [via, setVia] = useState<'ig' | 'mail'>('ig');
  return (
    <Screen header={<BackHeader />} footer={
      <View style={{ gap: 12 }}>
        <Button label="Odeslat" onPress={() => router.replace({ pathname: '/nv/vysledek', params: { kind: 'diky' } })} />
        <T s={12} c={C.muted} style={{ textAlign: 'center' }}>
          Odesílám i verzi aplikace: 2.3.0
        </T>
      </View>
    } gap={14}>
      <PageTitle title="Napiš mi" />
      <T s={16} c={C.text2} lh={1.45} style={{ marginTop: -6 }}>
        Něco nefunguje nebo ti něco chybí? Napiš mi pár slov, pomůže to.
      </T>
      <ChipWrap>
        {['Chyba', 'Nápad', 'Jiné'].map((k) => (
          <Chip key={k} label={k} active={kind === k} onPress={() => setKind(k)} />
        ))}
      </ChipWrap>
      <Input multiline placeholder="Popiš, co se stalo nebo co ti chybí…" style={{ minHeight: 124 }} />
      <T s={13} c={C.text2}>
        Fotka nebo screenshot (nepovinné)
      </T>
      <Button label="Přidat přílohu" icon="image-plus" kind="raised" height={46} style={{ alignSelf: 'flex-start' }} />
      <T s={13} c={C.text2}>
        Kam ti můžu odepsat? (nepovinné)
      </T>
      <Segmented
        height={38}
        options={[
          { key: 'ig', label: 'Instagram' },
          { key: 'mail', label: 'E-mail' },
        ]}
        value={via}
        onChange={setVia}
      />
      <Input placeholder={via === 'ig' ? '@tvujprofil' : 'tvuj@email.cz'} autoCapitalize="none" />
    </Screen>
  );
}

export function OAppceScreen() {
  return (
    <Screen header={<BackHeader />} gap={16}>
      <View style={[s.row, { gap: 16 }]}>
        <Image source={require('../../../../assets/images/icon.png')} style={{ width: 84, height: 84, borderRadius: 20 }} />
        <View>
          <D s={38}>Na pivo</D>
          <T s={14} c={C.muted}>
            Verze 2.3.0
          </T>
        </View>
      </View>
      <T s={16} c={C.text2}>
        Tvůj kompas k nejbližšímu pivu.
      </T>
      <Kicker>Co je nového</Kicker>
      <Card>
        {[
          'Ze zapsaného pití ti na počítadle odhadnu promile a kdy budeš na nule. Je to jen odhad, za volant podle něj nesedej.',
          'Na lístku hospody ťukni na pivo a vyber Hlídat pivo. Až ho začnou čepovat poblíž, dám ti vědět.',
          'Medaile s každou úrovní roste a ukáže ti, kolik do další chybí. Přibyly nové, třeba Silvestr, a některé jsou tajné.',
        ].map((x, i) => (
          <Row
            key={i}
            last={i === 2}
            leading={
              <View style={[{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFC40026', alignSelf: 'flex-start' }, s.center]}>
                <T s={12} w={800} c={C.yellow}>
                  {String(i + 1)}
                </T>
              </View>
            }
            title={<T s={14} c={C.text2} lh={1.45}>{x}</T>}
          />
        ))}
      </Card>
      <Card>
        <Row last title="Zásady soukromí" trailing={<Icon name="arrow-up-right" size={16} color={C.muted} />} />
      </Card>
      <T s={13} c={C.muted} style={{ textAlign: 'center', marginTop: 60 }}>
        Bez reklam · Bez placení
      </T>
    </Screen>
  );
}

const ONBOARDING = [
  { title: 'Nejkratší cesta na pivo.', body: 'Šipka tě dovede do nejbližší otevřené hospody. Piva si čárkuješ jako na tácku a parta uvidí, kde sedíš.' },
  { title: 'Čárka za každé pivo.', body: 'Jedno klepnutí a pivo je v deníku. Na konci večera dostaneš účtenku a vidíš, kolik padlo.' },
  { title: 'Parta ví, kde sedíš.', body: 'Pozvi kámoše do hospody nebo k sobě. Kdo jde, uvidíš na lístku.' },
];

export function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState(0);
  const p = ONBOARDING[page];
  const finish = () => router.replace('/nv/prihlaseni');
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 8, paddingHorizontal: SCREEN_X, paddingBottom: Math.max(insets.bottom, 16) + 4 }}>
      <View style={[s.row, { justifyContent: 'space-between', height: 32 }]}>
        <View style={[s.row, { gap: 6 }]}>
          {ONBOARDING.map((_, i) => (
            <View key={i} style={{ width: i === page ? 28 : 10, height: 6, borderRadius: 3, backgroundColor: i === page ? C.yellow : C.control }} />
          ))}
        </View>
        <Press onPress={finish}>
          <T s={15} w={600} c={C.muted}>
            Přeskočit
          </T>
        </Press>
      </View>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        {page === 0 ? (
          <Dial target={PUBS[0]} others={PUBS.slice(1, 6)} />
        ) : page === 1 ? (
          <View style={{ alignItems: 'center', gap: 4 }}>
            <D s={180} lh={1} c={C.yellow}>
              3
            </D>
            <T s={18} w={600} c={C.text2}>
              piva dnes večer
            </T>
          </View>
        ) : (
          <View style={{ alignItems: 'center', gap: 16 }}>
            <View style={s.row}>
              {['K', 'M', 'J', 'T'].map((x, i) => (
                <View key={x} style={{ marginLeft: i ? -14 : 0 }}>
                  <Person initial={x} size={70} filled={x === 'T'} />
                </View>
              ))}
            </View>
            <T s={16} w={600} c={C.text2}>
              Klára a Marek jsou U Pinkasů
            </T>
          </View>
        )}
      </View>
      <View style={{ gap: 14, paddingBottom: 40 }}>
        <D s={48} lh={1}>
          {p.title}
        </D>
        <T s={16} c={C.text2} lh={1.45}>
          {p.body}
        </T>
      </View>
      <Button label={page < 2 ? 'Co dál?' : 'Jdeme na to'} onPress={() => (page < 2 ? setPage(page + 1) : finish())} />
    </View>
  );
}
