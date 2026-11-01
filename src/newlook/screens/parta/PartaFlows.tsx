import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { BackHeader, Screen } from '../../components/chrome';
import { Input, PageTitle, Ticket } from '../../components/forms';
import { Icon } from '../../components/Icon';
import { Button, Card, Chip, D, Dot, IconButton, Kicker, Person, Row, Segmented, T } from '../../components/ui';
import { FRIENDS, friendById, pubById, type Plan } from '../../mock/data';
import { dialog, toast, useMock } from '../../mock/store';
import { C, s } from '../../theme';
import { PlanTicket } from './PartaScreen';

export function KamosScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const f = friendById(id) ?? FRIENDS[0];
  const pub = pubById(f.live?.pubId);
  const name = f.id === 'klara' ? 'Klára na čepu' : f.name;
  const theirs = f.id === 'klara' ? 23 : 12;
  return (
    <Screen
      header={<BackHeader right={<IconButton icon="share" size={40} iconSize={18} label="Sdílet" />} />}
      footer={<Button label="Cinknout" icon="bell-ring" onPress={() => toast({ kind: 'saved', title: 'Cinknuto!', sub: `${f.name} ví, že na ni myslíš.`, icon: 'beer' })} />}
    >
      <View style={[s.row, { gap: 16 }]}>
        <Person initial={f.initial} size={84} />
        <View style={[s.fill, { gap: 4 }]}>
          <D s={34}>{name}</D>
          <T s={14} c={C.muted}>{`@${f.id === 'klara' ? 'KlaraNaCepu' : f.nick} · ${f.id === 'klara' ? 'Štamgastka' : 'Pivař'}, level ${f.level}`}</T>
        </View>
      </View>
      {pub ? (
        <View style={[s.row, { gap: 10, height: 46, borderRadius: 16, paddingHorizontal: 16, backgroundColor: '#FFC40014', borderWidth: 1, borderColor: '#FFC40026' }]}>
          <Dot />
          <T s={15} w={600}>{`Teď sedí ${pub.name} · ${f.live?.beers} piva`}</T>
        </View>
      ) : null}
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        {[
          [f.id === 'klara' ? '211' : '96', 'piv celkem'],
          ['38', 'hospod'],
          ['12', 'odznaků'],
        ].map(([v, l], i) => (
          <View key={l} style={{ gap: 2, alignItems: i === 2 ? 'flex-end' : i === 1 ? 'center' : 'flex-start' }}>
            <D s={34} lh={1}>
              {v}
            </D>
            <T s={12} c={C.muted}>
              {l}
            </T>
          </View>
        ))}
      </View>
      <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 16, gap: 14 }}>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <T s={16} w={700}>
            Piva v říjnu
          </T>
          <T s={13} c={C.muted}>{theirs > 22 ? `${f.name} vede o 5` : 'Vedeš o 10'}</T>
        </View>
        {[
          ['Ty', 22, C.yellow],
          [f.name, theirs, C.white],
        ].map(([l, n, c]) => (
          <View key={String(l)} style={[s.row, { gap: 12 }]}>
            <T s={14} w={600} style={{ width: 48 }}>
              {String(l)}
            </T>
            <View style={[s.fill, { height: 8, borderRadius: 4, backgroundColor: C.control }]}>
              <View style={{ width: `${(Number(n) / 25) * 100}%`, height: 8, borderRadius: 4, backgroundColor: String(c) }} />
            </View>
            <D s={22} c={String(c)} style={{ width: 28, textAlign: 'right' }}>
              {String(n)}
            </D>
          </View>
        ))}
      </View>
      <T s={19} w={700}>
        Naposledy spolu
      </T>
      <Card>
        <Row title="Pá 23. 10." sub="U Černého vola" trailing={<D s={24}>4</D>} />
        <Row last title="So 17. 10." sub="Lokál Dlouhááá → U Pinkasů" trailing={<D s={24}>6</D>} />
      </Card>
      <Card>
        <Row
          leading={<Icon name="user-minus" size={18} color={C.text2} />}
          title="Odebrat z party"
          titleColor={C.text2}
          onPress={() =>
            dialog({
              title: `Odebrat ${f.name}?`,
              body: 'Přestanete se vidět v partě. Pozvat ji můžeš zase kdykoli.',
              actions: [{ label: 'Nechat' }, { label: 'Odebrat', kind: 'danger', onPress: () => router.back() }],
            })
          }
        />
        <Row
          last
          leading={<Icon name="ban" size={18} color={C.text2} />}
          title="Zablokovat"
          titleColor={C.text2}
          onPress={() => {
            router.back();
            toast({ kind: 'info', title: 'Zablokováno.', sub: 'Odblokuješ ve Správě party.', icon: 'ban' });
          }}
        />
      </Card>
    </Screen>
  );
}

const BOARDS: Record<string, { rank: string; title: string; sub: string; rows: [string, string, string, string][] }> = {
  piva: {
    rank: '4.',
    title: 'místo v Česku',
    sub: '18 piv · nový závod v pondělí',
    rows: [
      ['P', '@PivniVlk', 'Brno', '41'],
      ['K', '@KlaraNaCepu', 'v partě', '23'],
      ['H', '@Hospodsky', 'Plzeň', '22'],
      ['T', 'Ty', '', '18'],
      ['M', '@MarekStamgast', 'v partě', '17'],
    ],
  },
  objevitele: {
    rank: '12.',
    title: 'v objevování',
    sub: '6 nových hospod · nový závod v pondělí',
    rows: [
      ['O', '@Ostravak', 'Ostrava', '14'],
      ['P', '@PivniVlk', 'Brno', '11'],
      ['J', '@jirka', 'v partě', '9'],
      ['K', '@KlaraNaCepu', 'v partě', '7'],
      ['T', 'Ty', '', '6'],
    ],
  },
  maperi: {
    rank: '7.',
    title: 'mezi mapéry',
    sub: '4 zmapované hospody tento týden',
    rows: [
      ['M', '@MapaPiv', 'Praha', '31'],
      ['S', '@SonaPivniMapa', 'Praha', '22'],
      ['H', '@Hospodsky', 'Plzeň', '12'],
      ['P', '@petra', 'v partě', '6'],
      ['T', 'Ty', '', '4'],
    ],
  },
  hospody: {
    rank: '1.',
    title: 'Lokál Dlouhááá',
    sub: '142 piv od lidí z Na pivo za týden',
    rows: [
      ['L', 'Lokál Dlouhááá', 'Praha', '142'],
      ['U', 'U Vystřelenýho oka', 'Praha', '120'],
      ['Z', 'U Zlatého tygra', 'Praha', '86'],
      ['P', 'U Pinkasů', 'Praha', '64'],
      ['M', 'U Medvídků', 'Praha', '51'],
    ],
  },
};

export function ZebrickyScreen() {
  const [tab, setTab] = useState<'piva' | 'objevitele' | 'maperi' | 'hospody'>('piva');
  const [period, setPeriod] = useState('Tenhle týden');
  const b = BOARDS[tab];
  return (
    <Screen header={<BackHeader />} gap={16}>
      <PageTitle title="Žebříčky" />
      <Segmented
        height={38}
        options={[
          { key: 'piva', label: 'Piva' },
          { key: 'objevitele', label: 'Objevitelé' },
          { key: 'maperi', label: 'Mapéři' },
          { key: 'hospody', label: 'Hospody' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <View style={[s.row, { gap: 8 }]}>
        {['Tenhle týden', 'Měsíc', 'Odjakživa'].map((p) => (
          <Chip key={p} label={p} active={period === p} plain onPress={() => setPeriod(p)} />
        ))}
      </View>
      <View style={[s.row, { gap: 16, padding: 18, borderRadius: 24, backgroundColor: '#FFC4000D', borderWidth: 1, borderColor: '#FFC40059' }]}>
        <D s={64} lh={0.9} c={C.yellow}>
          {b.rank}
        </D>
        <View style={[s.fill, { gap: 2 }]}>
          <T s={17} w={700}>
            {b.title}
          </T>
          <T s={13} c={C.muted}>
            {b.sub}
          </T>
        </View>
      </View>
      <Card>
        {b.rows.map(([i, name, sub, n], idx) => {
          const me = name === 'Ty';
          return (
            <Row
              key={name}
              last={idx === b.rows.length - 1}
              leading={
                <View style={[s.row, { gap: 14 }]}>
                  <D s={22} c={me ? C.yellow : C.muted} style={{ width: 16 }}>
                    {String(idx + 1)}
                  </D>
                  <Person initial={i} size={36} ring={me} />
                </View>
              }
              title={name}
              titleColor={me ? C.yellow : C.white}
              titleWeight={700}
              sub={sub || undefined}
              trailing={
                <D s={24} c={me ? C.yellow : C.white}>
                  {n}
                </D>
              }
            />
          );
        })}
      </Card>
    </Screen>
  );
}

export function PlanScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const plans = useMock((st) => st.plans);
  const plan = plans.find((p) => p.id === id) ?? plans[0];
  const host = friendById(plan.fromId);
  const going = [
    ...plan.going.map((i) => (FRIENDS.find((f) => f.initial === i)?.name ?? 'Petra').split(' ')[0]).filter((n) => n !== host?.name),
    ...(plan.my === 'jdu' ? ['Ty'] : []),
  ];

  if (plan.mine) {
    return (
      <Screen header={<BackHeader right={<IconButton icon="share" size={40} iconSize={18} label="Sdílet" onPress={() => router.push('/nv/nalepky')} />} />} gap={18}>
        <PlanTicket plan={plan} big />
        <Card>
          <Row title={<T s={15} c={C.muted}>Jdou</T>} trailing={<T s={15} w={700}>Ty, Jirka</T>} />
          <Row title={<T s={15} c={C.muted}>Možná</T>} trailing={<T s={15} w={700}>Petra</T>} />
          <Row
            last
            title={<T s={15} c={C.muted}>Mlčí</T>}
            trailing={
              <View style={[s.row, { gap: 12 }]}>
                <T s={15} w={700}>
                  Marek, Ondra
                </T>
                <Chip label="Připomenout" icon="bell" height={34} onPress={() => toast({ kind: 'saved', title: 'Připomenuto.', sub: 'Markovi a Ondrovi jsem pípnul.', icon: 'bell' })} />
              </View>
            }
          />
        </Card>
        <Card>
          <Row leading={<Icon name="pencil-line" size={18} color={C.text2} />} title="Upravit plán" onPress={() => router.push('/nv/nova-pozvanka')} />
          <Row leading={<Icon name="sticker" size={18} color={C.text2} />} title="Poslat i jako nálepku" onPress={() => router.push('/nv/nalepky')} />
          <Row
            last
            leading={<Icon name="circle-x" size={18} color={C.text2} />}
            title="Zrušit plán"
            onPress={() =>
              dialog({
                title: 'Zrušit plán?',
                body: 'Všem pozvaným dám vědět, že se nekoná.',
                actions: [
                  { label: 'Nechat' },
                  {
                    label: 'Zrušit',
                    kind: 'danger',
                    onPress: () => {
                      useMock.getState().set({ plans: useMock.getState().plans.filter((p) => p.id !== plan.id) });
                      router.back();
                    },
                  },
                ],
              })
            }
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen header={<BackHeader right={<IconButton icon="share" size={40} iconSize={18} label="Sdílet" onPress={() => router.push('/nv/nalepky')} />} />} gap={18}>
      <PlanTicket plan={plan} big />
      <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 16, gap: 14 }}>
        <View style={[s.row, { gap: 12, alignItems: 'flex-start' }]}>
          <Icon name="map-pin" size={20} color={C.yellow} />
          <View style={{ gap: 2 }}>
            <T s={16} w={700}>
              {plan.home ? 'Slezská 48, Vinohrady' : pubById(plan.pubId)?.name}
            </T>
            <T s={13} c={C.muted}>
              {plan.home ? '2. patro, zvonek Dvořáková' : `${pubById(plan.pubId)?.area} · 650 m`}
            </T>
          </View>
        </View>
        <View style={[s.row, { gap: 10 }]}>
          <Button label="Navigovat" icon="navigation" kind="raised" height={40} flex onPress={() => Linking.openURL('http://maps.apple.com/?daddr=Slezsk%C3%A1%2048%2C%20Praha')} />
          <Button label="Do kalendáře" icon="calendar-plus" kind="raised" height={40} flex onPress={() => toast({ kind: 'saved', title: 'V kalendáři.', icon: 'calendar-check' })} />
        </View>
      </View>
      <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-end' }]}>
        <View style={[s.row, { alignItems: 'flex-end', gap: 6 }]}>
          <D s={30} lh={1}>
            {String(going.length + 1)}
          </D>
          <T s={17} w={700}>
            jdou
          </T>
        </View>
        <T s={13} c={C.muted}>
          1 možná
        </T>
      </View>
      <View style={[s.row, { gap: 18 }]}>
        {[host?.name ?? 'Klára', ...going.filter((g) => g !== host?.name)].slice(0, 5).map((n, i) => (
          <View key={n} style={{ alignItems: 'center', gap: 6 }}>
            <Person initial={n === 'Ty' ? 'T' : n[0]} size={46} ring={n === 'Ty'} filled={false} />
            <T s={12} w={600} c={i === 0 ? C.yellow : C.text2}>
              {n}
            </T>
          </View>
        ))}
      </View>
      {plan.home && plan.my === 'jdu' ? (
        <Button
          label={`Jsem u ${host?.name === 'Klára' ? 'Kláry' : host?.name}`}
          icon="house"
          kind="raised"
          onPress={() => {
            useMock.getState().set({ atFriend: plan.fromId, atHome: false });
            router.navigate('/nv/stamgast');
          }}
        />
      ) : null}
    </Screen>
  );
}

export function NovaPozvankaScreen() {
  const router = useRouter();
  const addPlan = useMock((st) => st.addPlan);
  const [note, setNote] = useState('Derby u mě. Pivo mám, chipsy noste.');
  const plan: Plan = {
    id: 'muj-nedele',
    from: 'tebe',
    fromId: 'me',
    dayNum: '1',
    dayName: 'Neděle',
    time: '17:00',
    place: 'U Tomáše doma',
    home: true,
    note,
    going: ['J'],
    my: 'jdu',
    mine: true,
  };
  const send = (sticker?: boolean) => {
    addPlan(plan);
    if (sticker) router.replace('/nv/nalepky');
    else {
      router.back();
      toast({ kind: 'saved', title: 'Pozvánka letí.', sub: 'Celá parta ji má v Partě.', icon: 'send' });
    }
  };
  return (
    <Screen
      header={
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <D s={30}>Nová pozvánka</D>
          <IconButton icon="x" size={40} iconSize={18} onPress={() => router.back()} label="Zavřít" />
        </View>
      }
      footer={
        <View style={{ gap: 10 }}>
          <Button label="Poslat i jako nálepku" icon="sticker" kind="raised" onPress={() => send(true)} />
          <Button label="Poslat partě" icon="send" onPress={() => send()} />
        </View>
      }
      gap={14}
    >
      <Kicker>Takhle ji uvidí parta</Kicker>
      <Ticket
        kicker="Pozvánka od tebe"
        kickerIcon="house"
        dayNum="1"
        dayName="Neděle"
        time="17:00"
        title="U Tomáše doma"
        quote={note}
        stub={
          <View style={[s.row, { gap: 6 }]}>
            {['Jdu', 'Možná', 'Nemůžu'].map((l, i) => (
              <View key={l} style={[s.fill, s.row, { height: 40, borderRadius: 20, justifyContent: 'center', gap: 6, backgroundColor: C.control }]}>
                <Icon name={i === 0 ? 'check' : i === 1 ? 'circle-question-mark' : 'x'} size={16} />
                <T s={15} w={700}>
                  {l}
                </T>
              </View>
            ))}
          </View>
        }
      />
      <Card>
        <Row leading={<Icon name="map-pin" size={18} color={C.muted} />} title={<T s={15} c={C.muted}>Kde</T>} trailing={<T s={15} w={700}>U mě · Korunní 12</T>} chevron />
        <Row leading={<Icon name="calendar" size={18} color={C.muted} />} title={<T s={15} c={C.muted}>Kdy</T>} trailing={<T s={15} w={700}>Ne 1. 11. v 17:00</T>} chevron />
        <Row leading={<Icon name="users" size={18} color={C.muted} />} title={<T s={15} c={C.muted}>Komu</T>} trailing={<T s={15} w={700}>Celá parta · 5</T>} chevron />
        <Row
          last
          leading={<Icon name="message-circle" size={18} color={C.muted} />}
          title={<T s={15} c={C.muted}>Vzkaz</T>}
          trailing={<Input value={note} onChangeText={setNote} height={36} focusRing={false} style={{ width: 190, backgroundColor: 'transparent', borderWidth: 0, paddingHorizontal: 0 }} />}
        />
      </Card>
      <View style={[s.row, { gap: 8 }]}>
        <Icon name="lock" size={14} color={C.muted} />
        <T s={13} c={C.muted}>
          Adresu uvidí všichni pozvaní. Nálepka ji nikdy neobsahuje.
        </T>
      </View>
    </Screen>
  );
}

const MEETUPS = [
  { id: 'deskovky', day: 'SO', num: '31', title: 'Deskovky a ležák', meta: '18:00 · Vinohrady · 1 až 3 km', sub: '2 volná místa · pořádá @HonzaKaktus' },
  { id: 'grilovacka', day: 'NE', num: '1', title: 'Grilovačka na dvorku', meta: '15:00 · Karlín · 3 až 8 km', sub: 'poslední místo · pořádá @BaraZKarlina' },
  { id: 'varka', day: 'ČT', num: '5', title: 'Domácí várka, ochutnávka', meta: '19:00 · Žižkov · do 1 km', waiting: true },
];

export function PivoUNekohoScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<'okoli' | 'moje'>('okoli');
  return (
    <Screen header={<BackHeader />} footer={<Button label="Založit setkání" icon="house" onPress={() => router.push('/nv/zalozit-setkani')} />} gap={16}>
      <PageTitle kicker="Komorní setkání" title="Pivo u někoho" />
      <Segmented
        height={38}
        options={[
          { key: 'okoli', label: 'V okolí' },
          { key: 'moje', label: 'Moje' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <View style={[s.row, { gap: 10, alignItems: 'flex-start', paddingHorizontal: 4 }]}>
        <Icon name="shield-check" size={16} color={C.muted} />
        <T s={13} c={C.muted} lh={1.4} style={s.fill}>
          Jdeš k někomu domů. Řekni blízkému, kam jdeš, a kdykoli odejdi, když ti něco nesedí.
        </T>
      </View>
      {tab === 'okoli' ? (
        <Card>
          {MEETUPS.map((m, i) => (
            <Row
              key={m.id}
              last={i === MEETUPS.length - 1}
              height={84}
              leading={
                <View style={[{ width: 46, height: 50, borderRadius: 14, backgroundColor: C.control }, s.center]}>
                  <T s={10} w={800} c={C.muted}>
                    {m.day}
                  </T>
                  <D s={22} lh={1}>
                    {m.num}
                  </D>
                </View>
              }
              title={m.title}
              titleWeight={700}
              sub={
                <View style={{ gap: 2 }}>
                  <T s={13} c={C.text2}>
                    {m.meta}
                  </T>
                  {m.waiting ? (
                    <View style={[s.row, { gap: 6 }]}>
                      <Dot />
                      <T s={13} w={700}>
                        Čeká na schválení
                      </T>
                    </View>
                  ) : (
                    <T s={13} c={C.muted}>
                      {m.sub}
                    </T>
                  )}
                </View>
              }
              chevron
              onPress={() => router.push('/nv/setkani')}
            />
          ))}
        </Card>
      ) : (
        <Card>
          <Row
            last
            height={84}
            leading={
              <View style={[{ width: 46, height: 50, borderRadius: 14, backgroundColor: '#FFC40026' }, s.center]}>
                <T s={10} w={800} c={C.yellow}>
                  SO
                </T>
                <D s={22} lh={1} c={C.yellow}>
                  31
                </D>
              </View>
            }
            title="Deskovky a ležák"
            titleWeight={700}
            sub="Pořádáš ty · 2 žádosti čekají"
            chevron
            onPress={() => router.push('/nv/moje-setkani')}
          />
        </Card>
      )}
    </Screen>
  );
}

export function SetkaniScreen() {
  const [sent, setSent] = useState(false);
  return (
    <Screen
      header={
        <BackHeader
          right={
            <IconButton
              icon="flag"
              size={40}
              iconSize={18}
              label="Nahlásit"
              onPress={() =>
                dialog({
                  title: 'Nahlásit setkání?',
                  body: 'Mrknu na něj. Když nesedí s pravidly, zmizí z okolí.',
                  actions: [{ label: 'Zpátky' }, { label: 'Nahlásit', kind: 'danger', onPress: () => toast({ kind: 'saved', title: 'Nahlášeno.', sub: 'Mrknu na to.', icon: 'flag' }) }],
                })
              }
            />
          }
        />
      }
      footer={
        sent ? (
          <Button label="Žádost odeslaná" icon="check" kind="raised" onPress={() => setSent(false)} />
        ) : (
          <Button
            label="Požádat o místo"
            icon="hand"
            onPress={() => {
              setSent(true);
              toast({ kind: 'saved', title: 'Žádost letí.', sub: 'Pořadatel ti dá vědět.', icon: 'hand' });
            }}
          />
        )
      }
      gap={16}
    >
      <Ticket
        big
        kicker="Pořádá @HonzaKaktus"
        kickerIcon="house"
        dayNum="31"
        dayName="Zítra, sobota"
        time="18:00"
        title="Deskovky a ležák"
        quote="Carcassonne a Duna, ležák z Únětic. Nás je pět, vejdou se ještě dva."
        stub={
          <View style={[s.row, { gap: 8, height: 40, paddingHorizontal: 4 }]}>
            <Icon name="map-pin" size={16} color={C.muted} />
            <T s={14} w={600} c={C.text2} style={s.fill}>
              Vinohrady · 1 až 3 km
            </T>
            <T s={14} w={700}>
              2 volná místa
            </T>
          </View>
        }
      />
      <View style={[s.row, { gap: 12, padding: 16, borderRadius: 20, backgroundColor: C.card }]}>
        <Icon name="lock" size={22} color={C.text2} />
        <View style={[s.fill, { gap: 2 }]}>
          <T s={16} w={700}>
            Přesná adresa až po schválení
          </T>
          <T s={13} c={C.muted}>
            Pořadatel ji pošle jen lidem, které pustí.
          </T>
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <Kicker>Vzkaz pro pořadatele</Kicker>
        <Input placeholder="Kdo jsi a proč chceš dorazit? (nepovinné)" />
      </View>
      <View style={[s.row, { gap: 10, alignItems: 'flex-start', paddingHorizontal: 4 }]}>
        <Icon name="shield-check" size={16} color={C.muted} />
        <T s={13} c={C.muted} lh={1.4} style={s.fill}>
          Jdeš k někomu domů. Řekni blízkému, kam jdeš, doraz střízlivý a kdykoli odejdi, když ti něco nesedí.
        </T>
      </View>
    </Screen>
  );
}
