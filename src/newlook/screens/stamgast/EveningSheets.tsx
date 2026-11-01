import React, { useState } from 'react';
import { Image, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { BackHeader, Screen } from '../../components/chrome';
import { Field, FieldLabel, Input } from '../../components/forms';
import { Icon, type IconName } from '../../components/Icon';
import { Sheet } from '../../components/overlays';
import { Button, Card, Chip, ChipWrap, D, IconButton, Press, Row, Segmented, T } from '../../components/ui';
import { EVENINGS, beerById, photo, pubById } from '../../mock/data';
import { toast, useMock } from '../../mock/store';
import { C, font, s } from '../../theme';

const DAYNAMES = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];

function dayLabel(day: number, month = 10) {
  const d = new Date(2026, month - 1, day);
  return `${DAYNAMES[d.getDay()]} ${day}. ${month}.`;
}

function Counter({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <View style={[s.row, { gap: 10 }]}>
      <IconButton icon="minus" size={30} iconSize={14} onPress={() => onChange(Math.max(0, value - 1))} label="Ubrat" />
      <D s={24} lh={1} style={{ minWidth: 14, textAlign: 'center' }}>
        {String(value)}
      </D>
      <IconButton icon="plus" size={30} iconSize={14} onPress={() => onChange(value + 1)} label="Přidat" />
    </View>
  );
}

export function DopsatSheet() {
  const router = useRouter();
  const { day } = useLocalSearchParams<{ day?: string }>();
  const fromDiary = !!day;
  const st = useMock();
  const [date, setDate] = useState(day ? Number(day) : 31);
  const [month, setMonth] = useState(10);
  const [from, setFrom] = useState(fromDiary ? '18:30' : '19:00');
  const [to, setTo] = useState(fromDiary ? '23:00' : '');
  const [place, setPlace] = useState<string | null>(fromDiary ? 'tygr' : null);
  const [rows, setRows] = useState([
    { id: 'pilsner', n: 2, price: '59' },
    { id: 'kozel', n: 1, price: fromDiary ? '52' : '' },
  ]);
  const [scope, setScope] = useState<'me' | 'parta'>('me');
  const future = month > 11 || (month === 11 && date > 1);
  const err = future;

  const save = () => {
    if (err) return;
    const beers = rows.reduce((a, r) => a + r.n, 0);
    st.addEvening({
      id: `e-${month}${date}`,
      date: `2026-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`,
      dayLabel: dayLabel(date, month),
      pubIds: [place ?? 'tygr'],
      beers,
      spent: rows.reduce((a, r) => a + r.n * (Number(r.price) || 0), 0),
      from,
      to: to || '22:00',
    });
    router.back();
    toast({ kind: 'saved', title: 'Uloženo do deníku', sub: `${dayLabel(date, month)} · ${beers} piva · ${pubById(place)?.name ?? 'bez hospody'}`, at: 'bottom' });
  };

  const places: { id: string; label: string; icon?: IconName }[] = [
    { id: 'tygr', label: 'U Zlatého tygra', icon: 'navigation' },
    { id: 'dlouha', label: 'Lokál Dlouhá', icon: 'history' },
    { id: 'pinkas', label: 'U Pinkasů', icon: 'history' },
    { id: 'none', label: 'Bez hospody' },
    { id: 'jina', label: 'Jiná', icon: 'search' },
  ];

  return (
    <Sheet title="Dopsat piva" top={150} footer={<Button label="Uložit vzpomínku" onPress={save} />}>
      <T s={16} c={C.text2} style={{ marginTop: -12 }}>
        Stejný zápis, jen zpětně.
      </T>
      <View style={{ gap: 8 }}>
        <View style={[s.row, { gap: 10, alignItems: 'flex-end' }]}>
          <View style={{ flex: 1.6, gap: 8 }}>
            <T s={12} w={800} c={err ? C.danger : C.muted} style={{ letterSpacing: 1 }}>
              DATUM
            </T>
            <Press
              onPress={() => {
                if (month === 10 && date < 31) setDate(date + 1);
                else if (month === 10) {
                  setMonth(11);
                  setDate(2);
                } else {
                  setMonth(10);
                  setDate(17);
                }
              }}
              style={[s.row, { height: 48, borderRadius: 16, paddingHorizontal: 14, gap: 10, backgroundColor: err ? '#FF6B5E14' : C.card, borderWidth: 1, borderColor: err ? C.danger : '#FFFFFF14' }]}
            >
              <Icon name="calendar" size={16} color={err ? C.danger : C.text2} />
              <T s={15} w={600}>
                {dayLabel(date, month)}
              </T>
            </Press>
          </View>
          <Field label="Od" style={s.fill}>
            <Input value={from} onChangeText={setFrom} />
          </Field>
          <Field label="Do" style={s.fill}>
            <Input value={to} onChangeText={setTo} placeholder="volitelně" />
          </Field>
        </View>
        {err ? (
          <View style={[s.row, { gap: 6 }]}>
            <Icon name="circle-alert" size={15} color={C.danger} />
            <T s={14} w={500} c={C.danger}>
              Zkontroluj datum a časy. Budoucnost zatím nečepuju.
            </T>
          </View>
        ) : null}
      </View>
      <View style={{ gap: 12 }}>
        <T s={15} w={700} c={C.muted}>
          Kde to bylo?
        </T>
        <ChipWrap>
          {places.map((p) => (
            <Chip key={p.id} label={p.label} icon={place === p.id ? undefined : p.icon} active={place === p.id} onPress={() => setPlace(p.id)} />
          ))}
        </ChipWrap>
      </View>
      <View style={{ gap: 12 }}>
        <T s={15} w={700} c={C.muted}>
          Piva
        </T>
        <View style={{ backgroundColor: C.card, borderRadius: 24, paddingHorizontal: 16, paddingBottom: 8 }}>
          <View style={[s.row, { height: 40, borderBottomWidth: 1, borderBottomColor: C.hairline }]}>
            <T s={11} w={800} c={C.muted} style={[s.fill, { letterSpacing: 1 }]}>
              PIVO
            </T>
            <T s={11} w={800} c={C.muted} style={{ width: 100, textAlign: 'center', letterSpacing: 1 }}>
              POČET
            </T>
            <T s={11} w={800} c={C.muted} style={{ width: 80, textAlign: 'right', letterSpacing: 1 }}>
              CENA / KS
            </T>
          </View>
          {rows.map((r, i) => (
            <View key={r.id} style={[s.row, { height: 62, borderBottomWidth: 1, borderBottomColor: C.hairline }]}>
              <View style={[s.fill, { gap: 2 }]}>
                <T s={15} w={700} numberOfLines={1}>
                  {beerById(r.id)?.name}
                </T>
                <T s={12} c={C.muted}>
                  čepované 0,5 l
                </T>
              </View>
              <View style={{ width: 106, alignItems: 'center' }}>
                <Counter value={r.n} onChange={(n) => setRows(rows.map((x, j) => (j === i ? { ...x, n } : x)))} />
              </View>
              <View style={[s.row, { width: 76, height: 40, borderRadius: 12, paddingHorizontal: 10, backgroundColor: C.control, borderWidth: 1, borderColor: '#FFFFFF14' }]}>
                <TextInput
                  value={r.price}
                  onChangeText={(price) => setRows(rows.map((x, j) => (j === i ? { ...x, price } : x)))}
                  keyboardType="number-pad"
                  keyboardAppearance="dark"
                  style={[font(14, 600), { flex: 1, textAlign: 'right', padding: 0 }]}
                />
                <T s={14} w={600} c={r.price ? C.white : C.muted}>
                  {' Kč'}
                </T>
              </View>
            </View>
          ))}
          <Press onPress={() => setRows([...rows, { id: 'bernard', n: 1, price: '' }])} style={[s.row, { height: 56, gap: 12 }]}>
            <View style={[{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.yellow }, s.center]}>
              <Icon name="plus" size={18} color={C.black} />
            </View>
            <T s={16} w={700} c={C.yellow}>
              Přidat pivo
            </T>
          </Press>
        </View>
      </View>
      <View style={{ gap: 10 }}>
        <T s={14} c={C.muted}>
          Starší zápisy jsou nejdřív jen pro tebe.
        </T>
        <View style={[s.row, { height: 42, borderRadius: 21, padding: 3, backgroundColor: '#FFFFFF12' }]}>
          {(
            [
              ['me', 'Jen pro mě', 'lock'],
              ['parta', 'Parta', 'users'],
            ] as const
          ).map(([k, label, icon]) => (
            <Press key={k} onPress={() => setScope(k)} style={[s.fill, s.row, { alignSelf: 'stretch', justifyContent: 'center', gap: 6, borderRadius: 18 }, scope === k && { backgroundColor: C.white }]}>
              <Icon name={icon} size={15} color={scope === k ? C.black : C.text2} />
              <T s={15} w={scope === k ? 800 : 600} c={scope === k ? C.black : C.text2}>
                {label}
              </T>
            </Press>
          ))}
        </View>
      </View>
    </Sheet>
  );
}

const DETAIL_DRINKS = [
  ['19:10', 'Pilsner Urquell 12°', 'Lokál Dlouhááá · čepované 0,5 l', '59 Kč'],
  ['20:05', 'Pilsner Urquell 12°', 'Lokál Dlouhááá · čepované 0,5 l', '59 Kč'],
  ['21:20', 'Pilsner Urquell 12°', 'Lokál Dlouhááá · čepované 0,5 l', '52 Kč'],
  ['22:15', 'Kozel 11°', 'U Pinkasů · čepované 0,5 l', '52 Kč'],
  ['22:40', 'Kozel 11°', 'U Pinkasů · čepované 0,5 l', '52 Kč'],
];

export function EveningDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const evenings = useMock((st) => st.evenings);
  const e = evenings.find((x) => x.id === id) ?? EVENINGS[0];
  const day = Number(e.date.slice(8));
  const d = new Date(2026, Number(e.date.slice(5, 7)) - 1, day);
  const long = ['Neděle', 'Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota'][d.getDay()];
  const hours = [
    ['19:00', 1],
    ['20:00', 1],
    ['21:00', 0],
    ['22:00', 2],
    ['23:00', 1],
  ] as const;
  return (
    <Screen
      header={<BackHeader right={<IconButton icon="share" size={40} iconSize={18} label="Sdílet" onPress={() => router.push('/nv/vyvesit')} />} />}
      footer={
        <View style={[s.row, { gap: 10 }]}>
          <Button label="Vyvěsit na Výčep" icon="megaphone" flex onPress={() => router.push('/nv/vyvesit')} />
          <Button label="Upravit" icon="pencil" kind="raised" style={{ paddingHorizontal: 18 }} onPress={() => router.push({ pathname: '/nv/dopsat', params: { day: String(day) } })} />
        </View>
      }
    >
      <View style={{ gap: 8 }}>
        <D s={44}>{`${long} ${day}. ${Number(e.date.slice(5, 7))}.`}</D>
        <T s={15} w={500} c={C.text2}>
          {e.pubIds.map((p) => pubById(p)?.name).join(' → ')}
        </T>
      </View>
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        {(
          [
            [String(e.beers), 'piv', C.yellow],
            [`${e.spent} Kč`, 'útrata', C.white],
            ['4 h 10 m', 'u stolu', C.white],
          ] as const
        ).map(([v, l, c]) => (
          <View key={l} style={{ gap: 2 }}>
            <D s={36} lh={1} c={c}>
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
          <T s={15} w={700}>
            Tempo po hodinách
          </T>
          <T s={13} c={C.muted}>
            2 piva ve 22:00
          </T>
        </View>
        <View style={[s.row, { gap: 8, height: 76, alignItems: 'flex-end' }]}>
          {hours.map(([h, n]) => (
            <View key={h} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
              <View style={{ width: '100%', height: n ? 26 * n : 4, borderRadius: 6, backgroundColor: n === 2 ? C.white : n ? '#FFFFFF4D' : C.control }} />
              <T s={11} c={C.muted}>
                {h}
              </T>
            </View>
          ))}
        </View>
      </View>
      <T s={19} w={700}>
        Co padlo
      </T>
      <Card>
        {DETAIL_DRINKS.slice(0, e.beers).map(([time, name, sub, price], i, arr) => (
          <Row
            key={time}
            last={i === arr.length - 1}
            leading={
              <T s={13} c={C.muted} style={{ width: 38 }}>
                {time}
              </T>
            }
            title={name}
            titleWeight={700}
            sub={sub}
            trailing={
              <T s={15} w={700}>
                {price}
              </T>
            }
          />
        ))}
      </Card>
    </Screen>
  );
}

type OdhadStep = 'setup' | 'live' | 'morning';

export function OdhadSheet() {
  const router = useRouter();
  const st = useMock();
  const [sex, setSex] = useState<'muz' | 'zena'>('muz');
  const step: OdhadStep = !st.promileEnabled ? 'setup' : st.tonight.length ? 'live' : 'morning';
  const drinks = st.tonight.length ? st.tonight : [];
  const pils = drinks.filter((d) => d.beerId === 'pilsner').length;
  const other = drinks.length - pils;

  if (step === 'setup') {
    return (
      <Sheet title="Odhad promile" top={190} footer={<Button label="Rozumím, počítej" onPress={() => st.set({ promileEnabled: true })} />}>
        <T s={16} c={C.text2} lh={1.4} style={{ marginTop: -6 }}>
          Ze zapsaného pití ti odhadnu promile a kdy budeš na nule. Potřebuju k tomu pár čísel o tobě.
        </T>
        <View style={{ gap: 12 }}>
          <T s={15} w={700} c={C.muted}>
            Pohlaví
          </T>
          <Segmented
            height={44}
            options={[
              { key: 'muz', label: 'Muž' },
              { key: 'zena', label: 'Žena' },
            ]}
            value={sex}
            onChange={setSex}
          />
        </View>
        <Card>
          {(
            [
              ['Věk', '34', 'let'],
              ['Výška', '182', 'cm'],
              ['Váha', '85', 'kg'],
            ] as const
          ).map(([l, v, u], i) => (
            <Row
              key={l}
              last={i === 2}
              title={l}
              titleWeight={500}
              trailing={
                <View style={[s.row, { height: 36, borderRadius: 12, paddingHorizontal: 12, gap: 4, backgroundColor: C.control }]}>
                  <D s={22}>{v}</D>
                  <T s={13} c={C.muted}>
                    {u}
                  </T>
                </View>
              }
            />
          ))}
        </Card>
        <View style={[s.row, { gap: 8 }]}>
          <Icon name="lock" size={15} color={C.muted} />
          <T s={14} c={C.muted}>
            Na server to neposílám.
          </T>
        </View>
        <View style={[s.row, { gap: 12, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: C.hairline, alignItems: 'flex-start' }]}>
          <Icon name="triangle-alert" size={18} color={C.text2} />
          <T s={14} c={C.text2} lh={1.4} style={s.fill}>
            Je to jen odhad. Skutečnost se může lišit o dost: jídlo, léky, únava i pivo, které nezapíšeš. Za volant podle toho nesedej.
          </T>
        </View>
      </Sheet>
    );
  }

  const live = step === 'live';
  return (
    <Sheet
      title="Odhad promile"
      top={live ? 130 : 330}
      footer={
        live ? (
          <Button
            label="Vypnout odhad"
            kind="raised"
            onPress={() => {
              st.set({ promileEnabled: false });
              router.back();
            }}
          />
        ) : undefined
      }
    >
      <View style={[s.row, { alignItems: 'flex-end', gap: 8, marginTop: -6 }]}>
        <D s={96} lh={0.95} c={C.yellow}>
          {live ? '0,6' : '7:20'}
        </D>
        {live ? (
          <T s={34} w={700} style={{ marginBottom: 6 }}>
            ‰
          </T>
        ) : null}
      </View>
      <T s={15} c={C.text2} style={{ marginTop: -10 }}>
        {live ? 'Odhad teď. Spíš 0,4 až 0,8 ‰.' : 'Podle odhadu budeš na nule dnes kolem 7:20.'}
      </T>
      <Card>
        {live ? (
          <>
            <Row
              leading={<Icon name="trending-up" size={20} />}
              title="Stoupne až na 0,8 ‰ kolem 22:40"
              titleWeight={700}
              sub="Alkohol se do krve dostává postupně, u každého pití zhruba 45 minut. Proto je číslo teď nižší."
            />
            <Row last leading={<Icon name="moon" size={20} />} title="Na nule zítra kolem 4:50" titleWeight={700} sub="Když už nic nepřibude a vyspíš se. Počítám s pomalým odbouráváním." />
          </>
        ) : (
          <Row last leading={<Icon name="sunrise" size={20} />} title="Teď můžeš mít ještě až 0,3 ‰" titleWeight={700} sub="Spíš méně, ale radši počítám s horším koncem." />
        )}
      </Card>
      <T s={15} w={700} c={C.muted}>
        S čím počítám
      </T>
      <View>
        {live ? (
          <>
            {pils ? <Row title={`${pils}× Pilsner Urquell 12°`} titleWeight={700} sub="4,4 % alkoholu" /> : null}
            {other ? <Row title={`${other}× Kozel 11°`} titleWeight={700} sub="4,6 % alkoholu" /> : null}
          </>
        ) : (
          <Row title="5× Pilsner Urquell 12°" titleWeight={700} sub="4,4 % alkoholu · včera 19:10 až 23:30" />
        )}
        <Row
          last
          title="Muž · 34 let · 182 cm · 85 kg"
          titleWeight={700}
          sub="tvoje údaje, jen v telefonu"
          trailing={
            <Press onPress={() => st.set({ promileEnabled: false })} style={[s.row, { gap: 4 }]}>
              <T s={14} w={700}>
                Upravit
              </T>
              <Icon name="chevron-right" size={14} color={C.text2} />
            </Press>
          }
        />
      </View>
      <T s={13} c={C.muted} lh={1.4}>
        Je to jen odhad ze zapsaného pití. Skutečnost se může lišit o dost. Za volant podle toho nesedej.
      </T>
    </Sheet>
  );
}

const TAGS = ['Má říz', 'Pěna jak smetana', 'Jde samo', 'Vodový', 'Zvětralý', 'Předražený', 'Ještě jedno', 'Už nikdy'];
const VERDICT = ['', 'Nic moc', 'Ujde', 'Dobrý', 'Moc dobrý', 'Pecka'];

export function HodnoceniSheet() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const beer = beerById(id) ?? beerById('bernard')!;
  const rate = useMock((st) => st.rate);
  const existing = useMock((st) => st.ratings[beer.id]);
  const [stars, setStars] = useState(existing ?? 4);
  const [tags, setTags] = useState<string[]>(['Má říz', 'Pěna jak smetana']);
  const [text, setText] = useState('Tmavý, sladový, na konci kafe. V Kolkovně ho čepujou fakt dobře.');
  const [hasPhoto, setHasPhoto] = useState(true);
  return (
    <Sheet
      title={beer.name}
      top={130}
      footer={
        <Button
          height={60}
          label="Uložit hodnocení"
          sub={existing ? undefined : '+10 XP za první recenzi tohohle piva'}
          onPress={() => {
            rate(beer.id, stars);
            router.back();
            toast({ kind: 'xp', title: 'Hodnocení uložené', icon: 'star', xp: existing ? undefined : 10 });
          }}
        />
      }
    >
      <T s={14} c={C.muted} style={{ marginTop: -16 }}>
        Kolkovna Celnice · dnes 21:40
      </T>
      <View style={{ alignItems: 'center', gap: 8 }}>
        <View style={[s.row, { gap: 8 }]}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Press key={n} haptic onPress={() => setStars(n)} accessibilityLabel={`${n} hvězd`}>
              <Icon name="star" size={46} color={n <= stars ? C.yellow : C.muted} fill={n <= stars ? C.yellow : 'none'} strokeWidth={1.5} />
            </Press>
          ))}
        </View>
        <T s={16} w={700}>
          {VERDICT[stars]}
        </T>
      </View>
      <View style={{ gap: 12 }}>
        <FieldLabel>Štítky</FieldLabel>
        <ChipWrap>
          {TAGS.map((t) => (
            <Chip key={t} label={t} active={tags.includes(t)} plain onPress={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])} />
          ))}
        </ChipWrap>
      </View>
      <Input multiline value={text} onChangeText={setText} placeholder="Pár slov, když chceš" />
      <View style={[s.row, { gap: 10 }]}>
        {hasPhoto ? (
          <View style={{ width: 72, height: 72, borderRadius: 14, overflow: 'hidden' }}>
            <Image source={photo(12)} style={{ width: '100%', height: '100%' }} />
            <Press onPress={() => setHasPhoto(false)} style={[{ position: 'absolute', right: 4, top: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: '#0A0A0AB3' }, s.center]}>
              <Icon name="x" size={12} />
            </Press>
          </View>
        ) : null}
        <Press onPress={() => setHasPhoto(true)} style={[{ width: 72, height: 72, borderRadius: 14, borderWidth: 1.5, borderColor: '#FFFFFF26', gap: 4 }, s.center]}>
          <Icon name="camera" size={18} color={C.yellow} />
          <T s={12} w={600}>
            Fotka
          </T>
        </Press>
      </View>
      <Press onPress={() => router.push('/nv/sdileni-souhlas')} style={[s.row, { height: 48, borderRadius: 16, paddingHorizontal: 14, gap: 10, backgroundColor: C.card }]}>
        <Icon name="globe" size={18} color={C.yellow} />
        <T s={15} w={600} style={s.fill}>
          Uvidí všichni u piva
        </T>
        <T s={14} c={C.muted}>
          změnit
        </T>
        <Icon name="chevron-right" size={14} color={C.muted} />
      </Press>
    </Sheet>
  );
}

