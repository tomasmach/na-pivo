import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackHeader, Glass, GlassButton, Screen } from '../../components/chrome';
import { Input, PageTitle, Ticket } from '../../components/forms';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/overlays';
import { Button, Card, Chip, D, IconButton, Kicker, Person, Press, Row, Segmented, Stack, T, Tile } from '../../components/ui';
import { toast, useMock } from '../../mock/store';
import { TOUR, nextStopIndex } from '../../mock/tour';
import { C, SCREEN_X, s } from '../../theme';
import { StopRail, StopSquare, TourMap } from './TourParts';

const ORD = ['jedničce', 'dvojce', 'trojce', 'čtyřce', 'pětce'];

function navigateTo(i: number) {
  const st = TOUR.stops[i];
  Linking.openURL(`http://maps.apple.com/?daddr=${st.coord.latitude},${st.coord.longitude}&dirflg=w`);
}

export function TourListScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<'moje' | 'verejne'>('moje');
  const [filter, setFilter] = useState('Kolem mě');
  const done = useMock((st) => st.tourDone);
  const PUBLIC = [
    ['350 m', 'Vinohradská jízda', 'Praha · 6 hospod, asi 2,8 km pěšky', '@Hospodsky · prošlo ji 21 lidí · s výzvami'],
    ['1,1 km', 'Karlínem na jedno', 'Praha · 3 hospody, asi 900 m pěšky', '@KlaraNaCepu · prošlo ji 12 lidí'],
    ['1,8 km', 'Holešovický okruh', 'Praha · 5 hospod, asi 2,4 km pěšky', '@PivniVlk · prošlo ji 38 lidí · s výzvami'],
    ['2,4 km', 'Letná a zpátky', 'Praha · 4 hospody, asi 1,9 km pěšky', '@MarekStamgast · s výzvami'],
    ['3,2 km', 'Smíchovské sklepy', 'Praha · 3 hospody, asi 1,2 km pěšky', '@SonaPivniMapa · prošli ji 4 lidé'],
  ];
  return (
    <Screen
      header={<BackHeader right={<IconButton icon="ellipsis" size={40} iconSize={18} label="Další" onPress={() => router.push('/nv/tour-zverejnit')} />} />}
      footer={tab === 'moje' ? <Button label="Naplánovat tour" icon="plus" onPress={() => router.push('/nv/tour-editor')} /> : undefined}
      gap={16}
    >
      <PageTitle title="Tour de pub" />
      <Segmented
        height={38}
        options={[
          { key: 'moje', label: 'Moje' },
          { key: 'verejne', label: 'Veřejné' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'moje' ? (
        <>
          <Press onPress={() => router.push('/nv/tour-pruchod')}>
            <Ticket
              big
              kicker="Nejbližší"
              kickerIcon="route"
              dayNum={TOUR.dayNum}
              dayName={TOUR.day}
              time={TOUR.time}
              title={TOUR.name}
              quote="5 hospod, asi 2,1 km pěšky · Veřejná"
              stub={
                <View style={[s.row, { gap: 10, height: 40, paddingHorizontal: 4 }]}>
                  <Stack initials={['K', 'J']} />
                  <T s={14} w={600} c={C.text2} style={s.fill}>
                    Pozváno 4 · jdou 2
                  </T>
                  <T s={14} w={700}>
                    Kdo jde
                  </T>
                  <Icon name="chevron-right" size={14} />
                </View>
              }
            />
          </Press>
          <T s={17} w={700}>
            Další tour
          </T>
          <Card>
            <Row leading={<Tile icon="route" color={C.white} />} title="Karlínská klasika" sub="Bez termínu · 4 hospody" chevron onPress={() => router.push('/nv/tour-editor')} />
            <Row last leading={<Tile icon="route" color={C.white} />} title="Vinohradská jízda" sub="Pá 6. 11. · 6 hospod · Z veřejných" chevron onPress={() => router.push('/nv/tour-verejna')} />
          </Card>
          <T s={17} w={700} c={C.muted}>
            Prošlé
          </T>
          <Card>
            <Row
              last
              leading={<Tile icon="flag" color={C.text2} />}
              title={done ? 'Žižkovský tah' : 'Letenský okruh'}
              sub={done ? '31. 10. 2026 · 4 / 5 navštíveno' : '12. 9. 2026 · 4 / 4 navštíveno'}
              chevron
              onPress={() => router.push('/nv/tour-historie')}
            />
          </Card>
        </>
      ) : (
        <>
          <Input icon="search" placeholder="Město, hospoda nebo název tour" />
          <View style={[s.row, { gap: 8 }]}>
            <Chip label="Kolem mě" icon="navigation" active={filter === 'Kolem mě'} onPress={() => setFilter('Kolem mě')} />
            <Chip label="Počet hospod" trailing="chevron-down" />
            <Chip label="S výzvami" icon="flag" active={filter === 'S výzvami'} onPress={() => setFilter(filter === 'S výzvami' ? 'Kolem mě' : 'S výzvami')} />
          </View>
          <Card>
            {PUBLIC.filter((p) => filter !== 'S výzvami' || p[3].includes('výzvami')).map(([d, name, meta, by], i, arr) => (
              <Row
                key={name}
                last={i === arr.length - 1}
                height={80}
                leading={
                  <View style={[{ width: 56, height: 44, borderRadius: 12, backgroundColor: C.control }, s.center]}>
                    <T s={13} w={800}>
                      {d}
                    </T>
                  </View>
                }
                title={name}
                titleWeight={700}
                sub={
                  <View>
                    <T s={13} c={C.text2}>
                      {meta}
                    </T>
                    <T s={13} c={C.muted}>
                      {by}
                    </T>
                  </View>
                }
                chevron
                onPress={() => router.push('/nv/tour-verejna')}
              />
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

export function TourEditorScreen() {
  const router = useRouter();
  return (
    <Screen
      header={
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <Kicker>Nová tour</Kicker>
          <IconButton icon="x" size={40} iconSize={18} onPress={() => router.back()} label="Zavřít" />
        </View>
      }
      footer={
        <View style={{ gap: 10 }}>
          <Button label="Přidat hospody" icon="plus" kind="raised" onPress={() => router.push('/nv/tour-vyber')} />
          <Button
            label="Uložit tour"
            icon="check"
            onPress={() => {
              router.back();
              toast({ kind: 'saved', title: 'Tour uložená.', sub: 'Pozvi partu, ať ví, kdy vyrážíte.', icon: 'route' });
            }}
          />
        </View>
      }
      gap={14}
    >
      <View style={[s.row, { gap: 10, marginTop: -6 }]}>
        <D s={40}>{TOUR.name}</D>
        <Icon name="pencil" size={18} color={C.muted} />
      </View>
      <Press onPress={() => router.push('/nv/tour-kdy')} style={[s.row, { height: 56, borderRadius: 18, paddingHorizontal: 16, gap: 10, backgroundColor: C.card }]}>
        <Icon name="calendar" size={18} color={C.muted} />
        <T s={15} c={C.muted} style={s.fill}>
          Kdy
        </T>
        <T s={15} w={700}>
          So 31. 10. v 20:00
        </T>
        <Icon name="chevron-right" size={16} color={C.muted} />
      </Press>
      <TourMap planning height={90} onExpand={() => router.push('/nv/tour-mapa')} />
      <View style={[s.row, { justifyContent: 'space-between', paddingHorizontal: 4 }]}>
        <T s={17} w={700}>
          Zastávky 5/8
        </T>
        <T s={15} w={600} c={C.yellow}>
          Změnit pořadí
        </T>
      </View>
      <Card>
        {TOUR.stops.map((st, i) => (
          <Row
            key={st.name}
            last={i === TOUR.stops.length - 1}
            leading={
              <View style={[{ width: 40, height: 40, borderRadius: 12, backgroundColor: C.control }, s.center]}>
                <D s={20} c={C.yellow}>
                  {String(i + 1)}
                </D>
              </View>
            }
            title={st.name}
            sub={
              <View style={{ gap: 4 }}>
                <T s={13} c={C.muted}>
                  {i === 0 ? `Místo srazu 20:00 · ${st.address.replace(' 33', ' 33')}` : st.address}
                </T>
                {st.challenge ? (
                  <View style={[s.row, { gap: 6 }]}>
                    <Icon name="flag" size={13} color={C.text2} />
                    <T s={13} c={C.text2}>
                      {st.challenge}
                    </T>
                  </View>
                ) : null}
              </View>
            }
            trailing={<Icon name="grip-vertical" size={18} color={C.muted} />}
            onPress={() => router.push({ pathname: '/nv/tour-akce', params: { i: String(i) } })}
          />
        ))}
      </Card>
    </Screen>
  );
}

const NEARBY = [
  ['U Sadu', '2 min pěšky · Kozel 11°, Svijany 11°', true],
  ['U Kurelů', '5 min pěšky · Bernard 12°', false],
  ['U Slovanské lípy', '6 min pěšky · Pilsner Urquell 12°', false],
  ['Na Parukářce', '9 min pěšky · Únětické 10°', false],
] as const;

export function TourVyberScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [picked, setPicked] = useState<string[]>(['U Sadu']);
  const chosen = ['Lokál Dlouhááá', 'U Vystřelenýho oka', "Bukowski's", ...picked];
  return (
    <Screen
      header={
        <View style={[s.row, { gap: 10 }]}>
          <IconButton icon="chevron-left" size={44} iconSize={18} onPress={() => router.back()} label="Zpět" />
          <View style={s.fill}>
            <Input icon="search" placeholder="Město nebo název hospody" height={46} />
          </View>
        </View>
      }
      footer={
        <View style={{ gap: 12, marginBottom: insets.bottom ? 0 : 0 }}>
          <View style={[s.row, { gap: 8 }]}>
            {chosen.slice(-3).map((name, i) => (
              <View key={name} style={[s.row, { height: 36, borderRadius: 18, paddingLeft: 6, paddingRight: 10, gap: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.hairline }]}>
                <View style={[{ width: 24, height: 24, borderRadius: 12, backgroundColor: C.control }, s.center]}>
                  <T s={12} w={800} c={C.yellow}>
                    {String(chosen.length - 2 + i)}
                  </T>
                </View>
                <T s={13} w={600} numberOfLines={1} style={{ maxWidth: 90 }}>
                  {name}
                </T>
                <Icon name="x" size={13} color={C.muted} />
              </View>
            ))}
          </View>
          <Button label={`Hotovo · ${chosen.length} hospody`} onPress={() => router.back()} />
        </View>
      }
      gap={16}
    >
      <TourMap height={200} />
      <Kicker>Kousek od 3. zastávky</Kicker>
      <Card>
        {NEARBY.map(([name, sub], i) => {
          const on = picked.includes(name);
          return (
            <Row
              key={name}
              last={i === NEARBY.length - 1}
              leading={
                on ? (
                  <View style={[{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.yellow }, s.center]}>
                    <T s={14} w={800} c={C.black}>
                      {String(4 + picked.indexOf(name))}
                    </T>
                  </View>
                ) : (
                  <View style={[{ width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: C.text2 }, s.center]}>
                    <Icon name="plus" size={16} />
                  </View>
                )
              }
              title={name}
              titleWeight={700}
              sub={sub}
              chevron
              onPress={() => setPicked(on ? picked.filter((p) => p !== name) : [...picked, name])}
            />
          );
        })}
      </Card>
    </Screen>
  );
}

const DAYS = [
  [26, 27, 28, 29, 30, 31, 1],
  [2, 3, 4, 5, 6, 7, 8],
  [9, 10, 11, 12, 13, 14, 15],
  [16, 17, 18, 19, 20, 21, 22],
  [23, 24, 25, 26, 27, 28, 29],
];

export function TourKdySheet() {
  const router = useRouter();
  const [day, setDay] = useState('0-5');
  const [time, setTime] = useState('20:00');
  return (
    <Sheet title="Kdy jdete?" top={270} scroll={false}>
      <View style={[s.row, { justifyContent: 'space-between', marginTop: -6 }]}>
        <T s={16} w={700}>
          Říjen—listopad
        </T>
        <View style={[s.row, { gap: 8 }]}>
          <IconButton icon="chevron-up" size={32} iconSize={16} color={C.muted} label="Dřív" />
          <IconButton icon="chevron-down" size={32} iconSize={16} label="Později" />
        </View>
      </View>
      <View style={{ gap: 4 }}>
        <View style={s.row}>
          {['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'].map((d) => (
            <T key={d} s={12} w={600} c={C.muted} style={{ flex: 1, textAlign: 'center' }}>
              {d}
            </T>
          ))}
        </View>
        {DAYS.map((w, wi) => (
          <View key={wi} style={s.row}>
            {w.map((d, di) => {
              const key = `${wi}-${di}`;
              const past = wi === 0 && di < 3;
              const today = wi === 0 && di === 3;
              const on = day === key;
              return (
                <Press key={key} disabled={past} onPress={() => setDay(key)} style={[{ flex: 1, height: 46 }, s.center]}>
                  <View style={[{ width: 40, height: 40, borderRadius: 20 }, s.center, on && { backgroundColor: C.yellow }]}>
                    <T s={16} w={on || today ? 800 : 500} c={on ? C.black : past ? '#FFFFFF4D' : today ? C.yellow : C.white}>
                      {String(d)}
                    </T>
                  </View>
                </Press>
              );
            })}
          </View>
        ))}
      </View>
      <View style={{ height: 1, backgroundColor: C.hairline }} />
      <T s={16} w={700}>
        Čas
      </T>
      <View style={[s.row, { gap: 8 }]}>
        {['18:00', '19:00', '20:00', '21:00', 'Jiný čas'].map((t) => (
          <Chip key={t} label={t} plain active={time === t} onPress={() => setTime(t)} height={38} style={{ paddingHorizontal: 12 }} />
        ))}
      </View>
      <Button label="Hotovo" onPress={() => router.back()} />
      <Press onPress={() => router.back()} style={{ alignItems: 'center', paddingBottom: 4 }}>
        <T s={15} w={700} c={C.text2}>
          Bez termínu
        </T>
      </Press>
    </Sheet>
  );
}

export function TourAkceSheet() {
  const router = useRouter();
  const { i } = useLocalSearchParams<{ i: string }>();
  const idx = Number(i ?? 2);
  const st = TOUR.stops[idx];
  return (
    <Sheet title={st.name} top={560} scroll={false}>
      <T s={15} c={C.text2} style={{ marginTop: -10 }}>{`${idx + 1}. zastávka · ${st.address}`}</T>
      <Card>
        <Row leading={<Icon name="flag" size={18} />} title="Upravit výzvu" chevron onPress={() => router.replace({ pathname: '/nv/tour-vyzva', params: { i: String(idx) } })} />
        <Row leading={<Icon name="repeat" size={18} />} title="Vyměnit zastávku" chevron onPress={() => router.replace('/nv/tour-vyber')} />
        <Row
          last
          leading={<Icon name="trash-2" size={18} />}
          title="Odebrat zastávku"
          onPress={() => {
            router.back();
            toast({ kind: 'info', title: `${st.name} je z tour pryč.`, icon: 'trash-2' });
          }}
        />
      </Card>
      <Press onPress={() => router.back()} style={{ alignItems: 'center', paddingBottom: 6 }}>
        <T s={15} w={700} c={C.text2}>
          Zrušit
        </T>
      </Press>
    </Sheet>
  );
}

export function TourVyzvaSheet() {
  const router = useRouter();
  const { i } = useLocalSearchParams<{ i: string }>();
  const idx = Number(i ?? 2);
  const st = TOUR.stops[idx];
  const [text, setText] = useState(st.challenge ?? '');
  return (
    <Sheet title="Výzva" top={520} scroll={false}>
      <View style={[s.row, { gap: 12, marginTop: -6 }]}>
        <View style={[{ width: 40, height: 40, borderRadius: 12, backgroundColor: C.control }, s.center]}>
          <D s={20} c={C.yellow}>
            {String(idx + 1)}
          </D>
        </View>
        <View>
          <T s={16} w={600}>
            {st.name}
          </T>
          <T s={13} c={C.muted}>{`${idx + 1}. zastávka · ${st.address}`}</T>
        </View>
      </View>
      <Input multiline value={text} onChangeText={setText} autoFocus placeholder="Co mají u stolu udělat?" />
      <View style={[s.row, { gap: 8 }]}>
        <Icon name="lightbulb" size={14} color={C.muted} />
        <T s={13} c={C.muted}>
          Něco, co zvládne každý u stolu.
        </T>
      </View>
      <Button
        label="Uložit výzvu"
        onPress={() => {
          router.back();
          toast({ kind: 'saved', title: 'Výzva sedí.', icon: 'flag' });
        }}
      />
    </Sheet>
  );
}

export function TourPublicScreen() {
  const router = useRouter();
  const { joined } = useLocalSearchParams<{ joined?: string }>();
  const startTour = useMock((st) => st.startTour);
  const set = useMock((st) => st.set);
  const isJoin = joined === '1';
  return (
    <Screen
      header={
        <BackHeader
          right={
            <>
              <IconButton icon="flag" size={40} iconSize={18} label="Nahlásit" onPress={() => toast({ kind: 'saved', title: 'Nahlášeno.', sub: 'Mrknu na to.', icon: 'flag' })} />
              <IconButton icon="share" size={40} iconSize={18} label="Sdílet" onPress={() => router.push('/nv/nalepky')} />
            </>
          }
        />
      }
      footer={
        isJoin ? (
          <View style={{ gap: 12 }}>
            <View style={[s.row, { gap: 8, alignItems: 'flex-start' }]}>
              <Icon name="lock" size={14} color={C.muted} />
              <T s={13} c={C.muted} style={s.fill}>
                Parta uvidí jen, že jdeš s ní. Hospody a piva zůstanou v tvém telefonu.
              </T>
            </View>
            <Button
              label="Jdu s vámi"
              icon="footprints"
              onPress={() => {
                startTour();
                set({ tourParty: ['K', 'J'], tourStops: ['visited', 'todo', 'todo', 'todo', 'todo'] });
                router.replace('/nv/tour-pruchod');
              }}
            />
          </View>
        ) : (
          <Button label="Uložit tour" icon="bookmark" onPress={() => toast({ kind: 'saved', title: 'Mezi tvými tour.', icon: 'bookmark' })} />
        )
      }
      gap={16}
    >
      <PageTitle kicker="Veřejná tour" title={isJoin ? TOUR.name : 'Vinohradská jízda'} />
      <T s={15} c={C.text2} style={{ marginTop: -8 }}>
        {isJoin ? 'Praha · 5 hospod, asi 2,1 km pěšky' : 'Praha · 6 hospod, asi 2,8 km pěšky'}
      </T>
      <View style={[s.row, { gap: 8 }]}>
        {isJoin ? <Stack initials={['T', 'K', 'M']} /> : <Icon name="users" size={16} color={C.text2} />}
        <T s={14} w={600}>
          {isJoin ? '@tomas a 2 další už jdou' : 'Prošlo ji 21 lidí'}
        </T>
      </View>
      <Card>
        <Row last leading={<Person initial={isJoin ? 'T' : 'H'} />} title={isJoin ? '@tomas' : '@Hospodsky'} sub={isJoin ? 'Tomáš' : 'Hospodský'} chevron />
      </Card>
      <TourMap height={130} planning />
      <T s={17} w={700}>
        Zastávky
      </T>
      <StopRail next={-1} dimFrom={isJoin ? 1 : 3} />
    </Screen>
  );
}

export function TourZverejnitScreen() {
  const router = useRouter();
  return (
    <Screen
      header={<BackHeader />}
      footer={
        <View style={{ gap: 14 }}>
          <T s={13} c={C.muted} style={{ textAlign: 'center' }}>
            Zveřejněním souhlasíš s <T s={13} w={700} c={C.yellow}>pravidly pro veřejné tour</T>.
          </T>
          <Button
            label="Zveřejnit"
            icon="globe"
            onPress={() => {
              router.back();
              toast({ kind: 'xp', title: 'Tour je venku!', icon: 'globe', xp: 30 });
            }}
          />
        </View>
      }
      gap={14}
    >
      <PageTitle title="Zveřejnit pro všechny" />
      <Kicker>Tohle uvidí všichni</Kicker>
      <Card>
        <Row leading={<Icon name="type" size={18} color={C.yellow} />} title="Název „Žižkovský tah“" />
        <Row leading={<Icon name="route" size={18} color={C.yellow} />} title="5 hospod v tomhle pořadí, asi 2,1 km pěšky" />
        <Row leading={<Icon name="flag" size={18} color={C.yellow} />} title="Výzvy u 3 hospod" />
        <Row last leading={<Icon name="circle-user" size={18} color={C.yellow} />} title="Tvoje přezdívka a profil" />
      </Card>
      <Kicker>Tohle ostatní neuvidí</Kicker>
      <Card>
        <Row leading={<Icon name="eye-off" size={18} color={C.muted} />} title="Datum a čas srazu" />
        <Row last leading={<Icon name="eye-off" size={18} color={C.muted} />} title="Tvoje piva a poloha" />
      </Card>
      <View style={[s.row, { gap: 10, alignItems: 'flex-start' }]}>
        <Icon name="info" size={15} color={C.muted} />
        <T s={13} c={C.muted} lh={1.4} style={s.fill}>
          Když je v názvu něčí jméno, radši ho změň. Název uvidí každý.
        </T>
      </View>
      <View style={[s.row, { gap: 10, alignItems: 'flex-start' }]}>
        <Icon name="undo-2" size={15} color={C.muted} />
        <T s={13} c={C.muted} lh={1.4} style={s.fill}>
          Z veřejných ji můžeš kdykoli stáhnout. Kdo si ji mezitím uložil, tomu zůstane.
        </T>
      </View>
    </Screen>
  );
}

/** Party row in a run: who is in, and the QR invite. */
function PartyBar({ note }: { note?: string }) {
  const router = useRouter();
  const party = useMock((st) => st.tourParty);
  return (
    <View style={{ padding: 14, gap: 8, borderRadius: 22, backgroundColor: C.card }}>
      <View style={[s.row, { gap: 12 }]}>
        {party.length ? <Stack initials={['T', ...party]} /> : <Person initial="T" size={32} ring={false} />}
        <T s={16} w={700} style={s.fill}>
          {party.length ? `${party.length + 1} v partě` : 'Zatím bez party'}
        </T>
        <Press onPress={() => router.push('/nv/tour-prizvat')} style={[s.row, { height: 36, borderRadius: 18, paddingHorizontal: 12, gap: 6, backgroundColor: C.control }]}>
          <Icon name="qr-code" size={15} color={C.yellow} />
          <T s={14} w={700}>
            {party.length ? 'Přizvat další' : 'Přizvat partu'}
          </T>
        </Press>
      </View>
      {note ? (
        <T s={13} c={C.muted}>
          {note}
        </T>
      ) : null}
    </View>
  );
}

/** The whole run on one screen; Štamgast's Tour segment shows the same content. */
export function TourRunContent({ embedded }: { embedded?: boolean }) {
  const router = useRouter();
  const st = useMock();
  const next = nextStopIndex(st.tourStops);
  const done = st.tourStops.filter((x) => x !== 'todo').length;
  const allDone = next < 0;
  const visited = st.tourStops.filter((x) => x === 'visited').length;
  const beers = [2, 1, 1, 1, 1];
  return (
    <View style={{ gap: 16 }}>
      {embedded ? (
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <D s={30}>{TOUR.name}</D>
          <View style={[s.row, { gap: 8 }]}>
            <IconButton icon="map" size={40} iconSize={18} onPress={() => router.push('/nv/tour-mapa')} label="Mapa trasy" />
            <IconButton icon="ellipsis" size={40} iconSize={18} onPress={() => router.push('/nv/tour-ukoncit')} label="Další" />
          </View>
        </View>
      ) : null}
      <View style={[s.row, { gap: 12 }]}>
        <D s={64} lh={0.9} c={C.yellow}>
          {String(allDone ? visited : Math.max(done, 1))}
        </D>
        <View style={{ gap: 2 }}>
          <T s={17} w={800}>{`z ${TOUR.stops.length} hospod`}</T>
          <T s={14} c={C.text2}>
            {allDone ? 'Všechny zastávky máš za sebou.' : `Na cestě od ${st.tourStarted ?? '20:04'}`}
          </T>
        </View>
      </View>
      <PartyBar note={allDone ? undefined : st.tourParty.length > 1 ? 'Marek už s vámi nejde' : undefined} />
      {allDone ? (
        <View style={[s.row, { gap: 8, marginTop: -8, paddingHorizontal: 4 }]}>
          <Icon name="circle-check" size={14} color={C.muted} />
          <T s={13} c={C.muted}>
            Přidal jsem tě k lidem, co ji prošli.
          </T>
        </View>
      ) : (
        <Press onPress={() => router.push('/nv/sdileni-souhlas')} style={[s.row, { gap: 6, marginTop: -6, paddingHorizontal: 4 }]}>
          <Icon name="lock" size={13} color={C.muted} />
          <T s={13} c={C.muted}>
            Kdo co vidí
          </T>
        </Press>
      )}
      <StopRail states={st.tourStops} next={next} beers={beers} onStop={(i) => router.push({ pathname: '/nv/tour-zastavka', params: { i: String(i) } })} />
    </View>
  );
}

export function TourRunScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const st = useMock();
  const next = nextStopIndex(st.tourStops);
  const lastVisited = st.tourStops.lastIndexOf('visited');
  const [undo, setUndo] = useState(true);

  if (!st.tourActive) {
    return (
      <Screen
        header={<BackHeader right={<IconButton icon="ellipsis" size={40} iconSize={18} label="Další" onPress={() => router.push('/nv/tour-zverejnit')} />} />}
        footer={
          <View style={{ gap: 10 }}>
            <Button
              label="Vyrazit"
              icon="footprints"
              height={56}
              onPress={() => {
                st.startTour();
                toast({ kind: 'saved', title: 'Jdete na to!', sub: 'Štamgast má teď záložku Tour.', icon: 'footprints' });
              }}
            />
            <Button label="Pozvat partu" icon="user-plus" kind="raised" onPress={() => router.push('/nv/tour-pozvat')} />
          </View>
        }
        gap={14}
      >
        <D s={44}>{TOUR.name}</D>
        <T s={15} c={C.text2} style={{ marginTop: -6 }}>{`${TOUR.date} · ${TOUR.time} · 5 hospod, ${TOUR.length}`}</T>
        <View style={[s.row, { gap: 8 }]}>
          <Icon name="globe" size={15} color={C.text2} />
          <T s={14} c={C.text2}>
            Veřejná · zatím ji nikdo neprošel
          </T>
        </View>
        <Card>
          <Row last leading={<Stack initials={['K', 'J']} />} title="Pozváno 4 · jdou 2" trailing={<T s={15} w={700}>Kdo jde</T>} chevron />
        </Card>
        <TourMap height={100} planning onExpand={() => router.push('/nv/tour-mapa')} />
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <T s={17} w={700}>
            Zastávky
          </T>
          <Press onPress={() => router.push('/nv/tour-editor')}>
            <T s={15} w={600} c={C.yellow}>
              Upravit
            </T>
          </Press>
        </View>
        <StopRail planning onStop={(i) => router.push({ pathname: '/nv/tour-akce', params: { i: String(i) } })} />
      </Screen>
    );
  }

  const allDone = next < 0;
  return (
    <Screen
      header={
        <BackHeader
          right={
            <>
              <IconButton icon="map" size={40} iconSize={18} label="Mapa trasy" onPress={() => router.push('/nv/tour-mapa')} />
              <IconButton icon="ellipsis" size={40} iconSize={18} label="Další" onPress={() => router.push('/nv/tour-cinknout')} />
            </>
          }
        />
      }
      footer={
        allDone ? (
          <Button label="Ukončit tour" icon="flag" onPress={() => router.push('/nv/tour-ukoncit')} />
        ) : (
          <View style={{ gap: 10 }}>
            {undo && lastVisited >= 0 ? (
              <View style={[s.row, { padding: 12, paddingHorizontal: 16, borderRadius: 18, backgroundColor: C.toast, borderWidth: 1, borderColor: '#FFFFFF1F', gap: 10 }]}>
                <Icon name="circle-check" size={18} />
                <View style={s.fill}>
                  <T s={14} w={700}>
                    {TOUR.stops[lastVisited].name}
                  </T>
                  <T s={12} c={C.muted}>
                    Navštíveno
                  </T>
                </View>
                <Press
                  onPress={() => {
                    st.markStop(lastVisited, 'todo');
                    setUndo(false);
                  }}
                >
                  <T s={15} w={700} c={C.yellow}>
                    Vrátit
                  </T>
                </Press>
              </View>
            ) : null}
            <Button label={`Navigovat · ${TOUR.stops[next].walkShort.replace('asi ', '')}`} icon="navigation" onPress={() => navigateTo(next)} />
            <Button
              label={`Zapsat pivo na ${ORD[next]}`}
              icon="beer"
              kind="raised"
              onPress={() => {
                st.addDrink();
                setUndo(true);
                if (nextStopIndex(useMock.getState().tourStops) < 0) toast({ kind: 'xp', title: 'Poslední zastávka!', icon: 'flag', xp: 25 });
              }}
            />
          </View>
        )
      }
      gap={6}
    >
      <Kicker>{allDone ? 'Právě jdete' : 'Právě jdete'}</Kicker>
      <D s={36}>{TOUR.name}</D>
      <View style={{ height: 10 }} />
      <TourRunContent />
      <View style={{ height: insets.bottom }} />
    </Screen>
  );
}

export function TourStopSheet() {
  const router = useRouter();
  const { i } = useLocalSearchParams<{ i: string }>();
  const idx = Number(i ?? 1);
  const stop = TOUR.stops[idx];
  const st = useMock();
  return (
    <Sheet title={stop.name} top={340} scroll={false}>
      <View style={{ gap: 4, marginTop: -12 }}>
        <T s={15} c={C.text2}>{`${idx + 1}. zastávka · ${stop.address}`}</T>
        <View style={[s.row, { gap: 6 }]}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.open }} />
          <T s={13} w={600} c={C.open}>
            {stop.hours}
          </T>
          <T s={13} c={C.muted}>{`· ${stop.beer}`}</T>
        </View>
      </View>
      <TourMap height={110} states={st.tourStops} next={idx} />
      {stop.challenge ? (
        <View style={{ padding: 16, gap: 6, borderRadius: 18, backgroundColor: C.card }}>
          <View style={[s.row, { gap: 6 }]}>
            <Icon name="flag" size={14} color={C.yellow} />
            <Kicker color={C.yellow}>Výzva</Kicker>
          </View>
          <T s={18} w={600}>
            {stop.challenge}
          </T>
        </View>
      ) : null}
      <View style={[s.row, { gap: 8 }]}>
        <Icon name="lock" size={13} color={C.muted} />
        <T s={12} c={C.muted}>
          Označení vidíš jen ty. Pivo ani návštěvu do deníku nepřidá.
        </T>
      </View>
      <Button
        label="Označit jako navštívenou"
        icon="check"
        onPress={() => {
          st.markStop(idx, 'visited');
          router.back();
        }}
      />
      <View style={[s.row, { gap: 10 }]}>
        <Button
          label="Přeskočit"
          icon="skip-forward"
          kind="raised"
          flex
          onPress={() => {
            st.markStop(idx, 'skipped');
            router.back();
          }}
        />
        <Button label="Navigovat" icon="navigation" kind="raised" flex onPress={() => navigateTo(idx)} />
      </View>
      <Press onPress={() => router.replace({ pathname: '/nv/hospoda/[id]', params: { id: 'oko' } })} style={[s.row, { justifyContent: 'center', gap: 4, paddingBottom: 4 }]}>
        <T s={15} w={700} c={C.text2}>
          Detail hospody
        </T>
        <Icon name="chevron-right" size={14} color={C.text2} />
      </Press>
    </Sheet>
  );
}

export function TourMapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const st = useMock();
  const next = Math.max(0, nextStopIndex(st.tourStops));
  const stop = TOUR.stops[next];
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TourMap height="100%" interactive states={st.tourStops} next={st.tourActive ? next : undefined} planning={!st.tourActive} />
      <View style={[s.row, { position: 'absolute', top: insets.top + 4, left: SCREEN_X, right: SCREEN_X, gap: 10 }]}>
        <GlassButton icon="chevron-left" size={54} label="Zpět" onPress={() => router.back()} />
        <Glass style={[s.fill, { height: 54, borderRadius: 27, paddingHorizontal: 18, justifyContent: 'center' }]}>
          <T s={15} w={700}>
            {TOUR.name}
          </T>
          <T s={12} c={C.muted}>{`${next + 1} z 5 · Čára ukazuje pořadí zastávek`}</T>
        </Glass>
      </View>
      <View style={{ position: 'absolute', left: 12, right: 12, bottom: Math.max(insets.bottom, 12), backgroundColor: C.yellow, borderRadius: 26, padding: 16, paddingTop: 20, gap: 14 }}>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <View style={{ gap: 3 }}>
            <T s={18} w={600} c={C.black}>{`${next + 1}. ${stop.name}`}</T>
            <T s={13} c={C.onYellowMuted}>{`do ${stop.hours.split('–')[1]} · Další zastávka · ${stop.walkShort}`}</T>
          </View>
          <View style={[s.row, { alignItems: 'flex-end', gap: 3 }]}>
            <D s={24} c={C.black}>
              {String(stop.distance)}
            </D>
            <T s={14} w={600} c={C.onYellowMuted}>
              m
            </T>
          </View>
        </View>
        <View style={[s.row, { gap: 10 }]}>
          <Button label="Navigovat" icon="navigation" kind="onYellow" height={46} flex onPress={() => navigateTo(next)} />
          <Button
            label="Označit"
            icon="check"
            kind="onYellowGhost"
            height={46}
            onPress={() => {
              st.markStop(next, 'visited');
              router.back();
            }}
          />
        </View>
      </View>
    </View>
  );
}

export function TourPrizvatSheet() {
  const router = useRouter();
  return (
    <Sheet title="Přizvat partu" top={310} scroll={false}>
      <View style={{ alignSelf: 'center', padding: 16, borderRadius: 24, backgroundColor: C.white }}>
        <QRCode value="https://na-pivo.cz/t/zizkovsky-tah" size={200} color={C.black} backgroundColor={C.white} />
      </View>
      <T s={14} c={C.text2} lh={1.4} style={{ textAlign: 'center' }}>
        Kdo to naskenuje, přidá se k vám. Uvidí tvoji přezdívku a kdo další jde.
      </T>
      <View style={[s.row, { justifyContent: 'center', gap: 8 }]}>
        <Stack initials={['T', 'K']} />
        <T s={14} w={600}>
          @tomas, @KlaraNaCepu
        </T>
      </View>
      <View style={{ height: 1, backgroundColor: C.hairline }} />
      <T s={17} w={700}>
        Kámoši, co tu nejsou
      </T>
      <T s={14} c={C.muted} style={{ marginTop: -10 }}>
        Dám vědět, že jdete tour „Žižkovský tah“ a kde sedíte: Lokál Dlouhááá.
      </T>
      <Button label="Cinknout jim" icon="bell" kind="raised" onPress={() => router.replace('/nv/tour-cinknout')} />
      <Press onPress={() => router.replace({ pathname: '/nv/tour-verejna', params: { joined: '1' } })} style={{ alignItems: 'center' }}>
        <T s={13} w={600} c={C.muted}>
          Co uvidí Jirka po naskenování
        </T>
      </Press>
    </Sheet>
  );
}

export function TourCinknoutSheet() {
  const router = useRouter();
  const [on, setOn] = useState(['Ondra', 'Petra']);
  const people = [
    ['Ondra', '@OndraZLibne', 'O'],
    ['Petra', 'U Pinkasů · 2 piva', 'P'],
    ['Soňa', '@SonaPivniMapa', 'S'],
  ];
  return (
    <Sheet title="Cinknout kámošům" top={470} scroll={false}>
      <T s={14} c={C.text2} lh={1.4} style={{ marginTop: -10 }}>
        Dám vědět, že jdete tour „Žižkovský tah“ a kde sedíte: U Vystřelenýho oka.
      </T>
      <Card>
        {people.map(([n, sub, i], idx) => {
          const sel = on.includes(n);
          return (
            <Row
              key={n}
              last={idx === people.length - 1}
              leading={<Person initial={i} size={36} ring={false} />}
              title={n}
              titleWeight={700}
              sub={sub}
              trailing={
                <View style={[{ width: 26, height: 26, borderRadius: 13, borderWidth: sel ? 0 : 1.5, borderColor: C.muted, backgroundColor: sel ? C.white : 'transparent' }, s.center]}>
                  {sel ? <Icon name="check" size={15} color={C.black} /> : null}
                </View>
              }
              onPress={() => setOn(sel ? on.filter((x) => x !== n) : [...on, n])}
            />
          );
        })}
      </Card>
      <Button
        label="Cinknout"
        icon="bell"
        disabled={!on.length}
        onPress={() => {
          router.back();
          toast({ kind: 'saved', title: 'Cinknuto!', sub: `${on.join(' a ')} ví, kde jste.`, icon: 'bell-ring' });
        }}
      />
    </Sheet>
  );
}

export function TourUkoncitSheet() {
  const router = useRouter();
  const endTour = useMock((st) => st.endTour);
  return (
    <Sheet title="Ukončit průchod?" top={630} scroll={false}>
      <T s={16} c={C.text2} style={{ marginTop: -8 }}>
        Dosavadní zastávky zůstanou v tvém přehledu.
      </T>
      <View style={[s.row, { gap: 8 }]}>
        <Icon name="users" size={14} color={C.muted} />
        <T s={13} c={C.muted}>
          Parta jde dál po svém. Nikdo další se už nepřidá.
        </T>
      </View>
      <Button
        label="Ukončit tour"
        icon="flag"
        onPress={() => {
          endTour();
          router.dismissAll();
          router.push('/nv/tour-historie');
        }}
      />
      <Press onPress={() => router.back()} style={{ alignItems: 'center', paddingBottom: 4 }}>
        <T s={15} w={700} c={C.text2}>
          Zrušit
        </T>
      </Press>
    </Sheet>
  );
}

export function TourHistoryScreen() {
  const router = useRouter();
  const stops = useMock((st) => st.tourStops);
  const history = stops.some((x) => x !== 'todo') ? stops : (['visited', 'visited', 'skipped', 'visited', 'visited'] as const);
  return (
    <Screen
      header={<BackHeader right={<IconButton icon="ellipsis" size={40} iconSize={18} label="Další" />} />}
      footer={
        <Button
          label="Vytvořit kopii"
          icon="copy"
          onPress={() => {
            router.replace('/nv/tour-editor');
            toast({ kind: 'saved', title: 'Kopie je připravená.', icon: 'copy' });
          }}
        />
      }
      gap={12}
    >
      <PageTitle kicker="Tvůj průchod" title={TOUR.name} />
      <T s={15} c={C.text2}>{`31. 10. 2026 · ${history.filter((x) => x === 'visited').length} / 5 navštíveno`}</T>
      <View style={[s.row, { gap: 8 }]}>
        <Stack initials={['K', 'J']} />
        <T s={14} c={C.text2}>
          3 v partě · započítáno
        </T>
      </View>
      <View style={[s.row, { justifyContent: 'space-between', marginTop: 10, paddingHorizontal: 4 }]}>
        <T s={17} w={700}>
          Zastávky
        </T>
        <T s={14} c={C.muted}>
          Ukončeno
        </T>
      </View>
      <Card>
        {TOUR.stops.map((stop, i) => {
          const state = history[i];
          return (
            <Row
              key={stop.name}
              last={i === TOUR.stops.length - 1}
              leading={<StopSquare i={i} state={state === 'todo' ? 'skipped' : state} next={false} />}
              title={stop.name}
              titleColor={state === 'visited' ? C.white : C.muted}
              sub={state === 'visited' ? `Navštíveno · ${i === 0 ? 2 : 1} ${i === 0 ? 'piva' : 'pivo'}` : 'Přeskočeno'}
              chevron
            />
          );
        })}
      </Card>
      <View style={[s.row, { justifyContent: 'center', gap: 6 }]}>
        <Icon name="lock" size={13} color={C.muted} />
        <T s={13} c={C.muted}>
          Kdo co vidí
        </T>
      </View>
    </Screen>
  );
}
