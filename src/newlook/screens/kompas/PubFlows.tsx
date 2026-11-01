import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackHeader, Glass, GlassButton, Screen } from '../../components/chrome';
import { Field, FieldLabel, Input, PageTitle, Stepper, Ticket } from '../../components/forms';
import { Icon } from '../../components/Icon';
import { ButtonPair, Sheet } from '../../components/overlays';
import { Button, Card, Chip, ChipWrap, D, Dot, IconButton, Kicker, Person, Press, Row, Segmented, T, Tile, Toggle } from '../../components/ui';
import { ME_COORD, beerById, pubById } from '../../mock/data';
import { toast, useMock } from '../../mock/store';
import { C, SCREEN_X, s } from '../../theme';
import { GRAY_MAP } from './NvMap';

const FOUND = [
  { name: 'Hospoda U Komunity', address: 'Jičínská 12, Praha 3', distance: '350 m' },
  { name: 'Komunitní centrum Žižkov', address: 'Husitská 24, Praha 3', distance: '800 m' },
  { name: 'Bistro U Komety', address: 'Seifertova 8, Praha 3', distance: '1,2 km' },
];

export function PridatHospoduScreen() {
  const router = useRouter();
  const [manual, setManual] = useState(false);
  const [q, setQ] = useState('U Komu');
  const [name, setName] = useState('Hospoda U Komunity');
  const [city, setCity] = useState('Praha');
  const [address, setAddress] = useState('Jičínská 12');
  const add = () => {
    useMock.getState().set({ addedPubs: true });
    router.replace('/nv/moje-hospody');
    toast({ kind: 'xp', title: 'Díky za zmapování!', xp: 20 });
  };

  if (!manual) {
    const results = q.trim().length > 1 ? FOUND : [];
    return (
      <Screen header={<BackHeader />}>
        <PageTitle title="Přidat hospodu" intro="Napiš, jak se jmenuje. Najdu ji mezi podniky kolem tebe a adresu doplním sám." />
        <Input icon="search" value={q} onChangeText={setQ} autoFocus height={52} />
        {results.length ? (
          <View style={{ gap: 12 }}>
            <Kicker>Podniky kolem tebe</Kicker>
            <Card>
              {results.map((r, i) => (
                <Row
                  key={r.name}
                  last={i === results.length - 1}
                  leading={<Tile icon="map-pin" color={C.white} />}
                  title={r.name}
                  sub={r.address}
                  trailing={<T s={14} w={600}>{r.distance}</T>}
                  onPress={() => {
                    setName(r.name);
                    setAddress(r.address.split(',')[0]);
                    setManual(true);
                  }}
                />
              ))}
            </Card>
          </View>
        ) : null}
        <Press onPress={() => setManual(true)} style={[s.row, { gap: 12, padding: 16, borderRadius: 20, backgroundColor: C.control }]}>
          <Icon name="pencil-line" size={22} color={C.white} />
          <View style={[s.fill, { gap: 2 }]}>
            <T s={16} w={700}>
              Nemůžu svoji hospodu najít
            </T>
            <T s={13} c={C.muted}>
              Vyplním ji ručně, polohu potvrdíš sám
            </T>
          </View>
          <Icon name="chevron-right" size={18} color={C.muted} />
        </Press>
      </Screen>
    );
  }

  return (
    <Screen header={<BackHeader onBack={() => setManual(false)} />} footer={<Button label="Přidat hospodu" icon="plus" onPress={add} disabled={!name.trim()} />}>
      <PageTitle title="Přidat hospodu" intro="Vyplň název a adresu. Kde hospoda stojí, zjistím z adresy sám." />
      <View style={{ gap: 14 }}>
        <Field label="Název">
          <Input value={name} onChangeText={setName} />
        </Field>
        <View style={[s.row, { gap: 10, alignItems: 'flex-start' }]}>
          <Field label="Město" style={{ width: 120 }}>
            <Input value={city} onChangeText={setCity} />
          </Field>
          <Field label="Adresa" style={s.fill}>
            <Input value={address} onChangeText={setAddress} />
          </Field>
        </View>
        <View style={[s.row, { gap: 12, padding: 10, borderRadius: 20, backgroundColor: C.card }]}>
          <View style={{ width: 72, height: 72, borderRadius: 14, overflow: 'hidden' }}>
            <MapView
              provider={PROVIDER_GOOGLE}
              style={{ flex: 1 }}
              customMapStyle={GRAY_MAP}
              initialRegion={{ latitude: 50.0838, longitude: 14.4497, latitudeDelta: 0.004, longitudeDelta: 0.004 }}
              pointerEvents="none"
              userInterfaceStyle="dark"
            />
            <View style={[{ position: 'absolute', left: 24, top: 24, width: 24, height: 24, borderRadius: 12, backgroundColor: C.yellow, borderWidth: 2, borderColor: C.black }, s.center]}>
              <Icon name="beer" size={12} color={C.black} />
            </View>
          </View>
          <View style={[s.fill, { gap: 3 }]}>
            <View style={[s.row, { gap: 6 }]}>
              <Icon name="circle-check" size={16} color={C.open} />
              <T s={15} w={700}>
                Našel jsem ji na mapě
              </T>
            </View>
            <T s={13} w={500} c={C.muted}>{`${address}, ${city} 3`}</T>
          </View>
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <Kicker>Když adresa nesedí</Kicker>
        <Card>
          <Row
            leading={<Tile icon="locate-fixed" color={C.black} bg={C.yellow} size={36} radius={18} />}
            title="Stojím přímo v ní"
            titleWeight={700}
            sub="Vezmu polohu, kde právě jsi."
            chevron
            onPress={() => toast({ kind: 'saved', title: 'Beru polohu, kde stojíš.', icon: 'locate-fixed' })}
          />
          <Row last leading={<Tile icon="map-pin" bg="#FFFFFF0F" size={36} radius={18} />} title="Zapíchnout špendlík do mapy" titleWeight={700} chevron onPress={() => router.push('/nv/spendlik')} />
        </Card>
      </View>
    </Screen>
  );
}

export function SpendlikScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <MapView
        provider={PROVIDER_GOOGLE}
        style={{ flex: 1 }}
        customMapStyle={GRAY_MAP}
        initialRegion={{ ...ME_COORD, latitudeDelta: 0.012, longitudeDelta: 0.012 }}
        userInterfaceStyle="dark"
        showsPointsOfInterests={false}
      />
      <View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }, s.center]}>
        <View style={{ alignItems: 'center', marginTop: -40 }}>
          <View style={[{ width: 46, height: 46, borderRadius: 23, backgroundColor: C.yellow, borderWidth: 2, borderColor: C.black }, s.center]}>
            <Icon name="beer" size={22} color={C.black} />
          </View>
          <View style={{ width: 3, height: 26, backgroundColor: C.black }} />
          <View style={{ width: 14, height: 5, borderRadius: 3, backgroundColor: '#00000080' }} />
        </View>
      </View>
      <View style={[s.row, { position: 'absolute', top: insets.top + 4, left: SCREEN_X, right: SCREEN_X, gap: 10 }]}>
        <GlassButton icon="chevron-left" size={54} label="Zpět" onPress={() => router.back()} />
        <Glass style={[s.fill, s.row, { height: 54, borderRadius: 27, paddingHorizontal: 18, gap: 10 }]}>
          <Icon name="map-pin" size={18} color={C.yellow} />
          <T s={15} w={600}>
            Zamiř ho přesně na hospodu.
          </T>
        </Glass>
      </View>
      <View style={{ position: 'absolute', right: SCREEN_X - 4, bottom: insets.bottom + 88 }}>
        <GlassButton icon="locate-fixed" label="Moje poloha" />
      </View>
      <View style={{ position: 'absolute', left: SCREEN_X, right: SCREEN_X, bottom: Math.max(insets.bottom, 16) + 4 }}>
        <ButtonPair
          left="Zrušit"
          right="Použít"
          rightIcon="check"
          onLeft={() => router.back()}
          onRight={() => {
            router.back();
            toast({ kind: 'saved', title: 'Poloha sedí.', icon: 'map-pin' });
          }}
        />
      </View>
    </View>
  );
}

const MY_PUBS: { name: string; where: string; state: 'waiting' | 'failed' | 'ok' }[] = [
  { name: 'Výčep Na Stojáka', where: 'Brno · Jakubské nám. 1', state: 'waiting' },
  { name: 'Hostinec U Kocoura', where: 'Plzeň · Pražská 14', state: 'failed' },
  { name: 'U Komunity', where: 'Praha · Školská 28', state: 'ok' },
  { name: 'Pivnice U Rudolfa', where: 'Praha · Mezibranská 3', state: 'ok' },
  { name: 'Lokál Na Hradbách', where: 'Brno · Dominikánská 9', state: 'ok' },
  { name: 'Hospoda Na Růžku', where: 'Olomouc · Ztracená 2', state: 'ok' },
];

export function MojeHospodyScreen() {
  const router = useRouter();
  const has = useMock((st) => st.addedPubs);
  const [retried, setRetried] = useState(false);
  return (
    <Screen header={<BackHeader />} footer={<Button label="Přidat hospodu" icon="plus" onPress={() => router.push('/nv/pridat-hospodu')} />}>
      <D s={44} accessibilityRole="header">
        Moje přidané hospody
      </D>
      {has ? (
        <>
          <View style={[s.row, { gap: 16, padding: 18, borderRadius: 24, backgroundColor: C.card }]}>
            <D s={64} lh={0.9} c={C.yellow}>
              4
            </D>
            <View style={{ gap: 4 }}>
              <Kicker>V kompasu</Kicker>
              <T s={16} w={700}>
                Naposled: U Komunity
              </T>
            </View>
          </View>
          <View style={{ gap: 12 }}>
            <Kicker>Tvoje hospody</Kicker>
            <Card>
              {MY_PUBS.map((p, i) => {
                const state = p.state === 'failed' && retried ? 'waiting' : p.state;
                return (
                  <Row
                    key={p.name}
                    last={i === MY_PUBS.length - 1}
                    title={p.name}
                    titleWeight={700}
                    sub={
                      state === 'failed' ? (
                        <View style={{ gap: 6 }}>
                          <T s={13} c={C.muted}>
                            {p.where}
                          </T>
                          <View style={[s.row, { gap: 5 }]}>
                            <Icon name="circle-alert" size={14} color={C.white} />
                            <T s={13} w={700}>
                              Neprošla
                            </T>
                          </View>
                        </View>
                      ) : (
                        p.where
                      )
                    }
                    trailing={
                      state === 'waiting' ? (
                        <View style={[s.row, { gap: 6 }]}>
                          <Icon name="cloud-upload" size={15} color={C.muted} />
                          <T s={14} c={C.muted}>
                            Čeká na odeslání
                          </T>
                        </View>
                      ) : state === 'failed' ? (
                        <Chip label="Zkusit znovu" icon="rotate-cw" onPress={() => setRetried(true)} />
                      ) : (
                        <View style={[s.row, { gap: 6 }]}>
                          <Dot color={C.yellow} />
                          <T s={14} w={600} c={C.yellow}>
                            V kompasu
                          </T>
                        </View>
                      )
                    }
                  />
                );
              })}
            </Card>
          </View>
        </>
      ) : (
        <View style={{ marginTop: 120, gap: 18, paddingHorizontal: 8 }}>
          <Tile icon="map-pin-plus" size={64} radius={32} />
          <D s={30}>Zatím tu žádná není.</D>
          <T s={15} c={C.muted} lh={1.4} style={{ marginTop: -8 }}>
            Když v kompasu chybí hospoda, doplň ji. Přidám ji do mapy i ostatním.
          </T>
        </View>
      )}
    </Screen>
  );
}

const DAYS: [string, string][] = [
  ['Pondělí', '11:00–23:00'],
  ['Úterý', '11:00–23:00'],
  ['Středa', '11:00–23:00'],
  ['Čtvrtek', '11:00–23:00'],
  ['Pátek', '11:00–01:00'],
  ['Sobota', '16:00–01:00'],
  ['Neděle', 'Zavřeno'],
];

export function DoplnitInfoScreen() {
  const router = useRouter();
  const { id, tab: initialTab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const pub = pubById(id) ?? pubById('tygr')!;
  const [tab, setTab] = useState<'oteviracka' | 'piva'>(initialTab === 'piva' ? 'piva' : 'oteviracka');
  const [rotating, setRotating] = useState(false);
  const [taps, setTaps] = useState(pub.taps.length ? pub.taps.map((t) => ({ name: beerById(t.beerId)?.name ?? '', size: t.size, price: `${t.price} Kč` })) : []);
  const [extra, setExtra] = useState<string[]>(['Bernard 11°']);
  const save = () => {
    router.back();
    toast({ kind: 'xp', title: 'Díky za zmapování!', xp: 20 });
  };
  return (
    <Screen
      header={<BackHeader />}
      footer={
        <View style={{ gap: 14 }}>
          <View style={[s.row, { justifyContent: 'center', gap: 6 }]}>
            <Icon name="users" size={14} color={C.muted} />
            <T s={13} c={C.muted}>
              Uvidí to ostatní pivaři
            </T>
          </View>
          <Button label="Uložit" onPress={save} />
        </View>
      }
      gap={16}
    >
      <PageTitle kicker={pub.name} title="Doplnit info" />
      <Segmented
        height={38}
        options={[
          { key: 'oteviracka', label: 'Otevíračka' },
          { key: 'piva', label: 'Piva' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'oteviracka' ? (
        <>
          <View style={[s.row, { gap: 6 }]}>
            <Dot color={C.open} />
            <T s={15} w={600} c={C.open}>{`Teď otevřeno · do ${pub.openUntil}`}</T>
          </View>
          <Card>
            {DAYS.map(([day, hours], i) => (
              <Press key={day} onPress={() => router.push({ pathname: '/nv/oteviracka-den', params: { day } })}>
                <View style={[s.row, { height: 48, gap: 10 }, i < DAYS.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.hairline }]}>
                  <T s={16} w={day === 'Čtvrtek' ? 800 : 500} style={s.fill}>
                    {day}
                  </T>
                  <T s={15} w={hours === 'Zavřeno' ? 500 : 700} c={hours === 'Zavřeno' ? C.muted : C.white}>
                    {hours}
                  </T>
                  <Icon name="chevron-right" size={16} color={C.muted} />
                </View>
              </Press>
            ))}
          </Card>
          <View style={s.row}>
            <Chip label="Stejně celý týden" icon="copy" onPress={() => toast({ kind: 'saved', title: 'Pondělí jsem dal na celý týden.', icon: 'copy' })} />
          </View>
        </>
      ) : (
        <>
          <FieldLabel>Jak to tu s čepy chodí?</FieldLabel>
          <View style={[s.row, { gap: 10 }]}>
            <Chip label="Stálá nabídka" active={!rotating} onPress={() => setRotating(false)} style={{ flex: 1, justifyContent: 'center', height: 42, borderRadius: 21 }} />
            <Chip label="Rotující nabídka" icon="refresh-cw" active={rotating} onPress={() => setRotating(true)} style={{ flex: 1, justifyContent: 'center', height: 42, borderRadius: 21 }} />
          </View>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <T s={19} w={700}>
              Piva na čepu
            </T>
            <Press onPress={() => router.push('/nv/vyfot?mode=tabule')} style={[s.row, { gap: 6 }]}>
              <Icon name="camera" size={16} color={C.yellow} />
              <T s={15} w={600} c={C.yellow}>
                Vyfoť lístek
              </T>
            </Press>
          </View>
          <Card>
            {[...taps, ...extra.map((name) => ({ name, size: '0,5 l', price: '' }))].map((t) => (
              <Row
                key={t.name + t.size}
                title={t.name}
                sub={t.size}
                trailing={
                  t.price ? (
                    <T s={15} w={700}>
                      {t.price}
                    </T>
                  ) : (
                    <T s={15} c={C.muted}>
                      cena chybí
                    </T>
                  )
                }
              />
            ))}
            <Press onPress={() => router.push('/nv/pridat-pivo')} style={[s.row, { height: 56, gap: 12 }]}>
              <View style={[{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.yellow }, s.center]}>
                <Icon name="plus" size={18} color={C.black} />
              </View>
              <T s={16} w={700} c={C.yellow}>
                Přidat pivo
              </T>
            </Press>
          </Card>
          <T s={13} c={C.muted} style={{ marginTop: -6 }}>
            Nech tu jen to, co se čepuje teď.
          </T>
          <FieldLabel>Dříve tu bylo</FieldLabel>
          <ChipWrap>
            {['Matuška Raptor', 'Únětické 12°'].filter((x) => !extra.includes(x)).map((x) => (
              <Chip key={x} label={x} icon="plus" onPress={() => setExtra([...extra, x])} />
            ))}
          </ChipWrap>
        </>
      )}
      {tab === 'piva' && !taps.length ? <Button label="Zapsat první pivo" kind="raised" onPress={() => setTaps([{ name: 'Pilsner Urquell 12°', size: '0,5 l', price: '59 Kč' }])} /> : null}
    </Screen>
  );
}

export function OtevirackaDenSheet() {
  const router = useRouter();
  const { day } = useLocalSearchParams<{ day: string }>();
  const [closed, setClosed] = useState(false);
  const [from, setFrom] = useState('11:00');
  const [to, setTo] = useState('01:00');
  const label = (day ?? 'Pátek').toLowerCase();
  return (
    <Sheet title={`Kdy má ${label} otevřeno?`} top={470} scroll={false}>
      {!closed ? (
        <>
          <View style={[s.row, { gap: 10, alignItems: 'flex-end' }]}>
            <Field label="Od" style={s.fill}>
              <Input value={from} onChangeText={setFrom} keyboardType="numbers-and-punctuation" />
            </Field>
            <Field label="Do" style={s.fill}>
              <Input value={to} onChangeText={setTo} keyboardType="numbers-and-punctuation" />
            </Field>
            <IconButton icon="trash-2" size={48} iconSize={18} color={C.muted} bg="transparent" style={{ borderWidth: 1, borderColor: C.hairline }} label="Smazat čas" onPress={() => setClosed(true)} />
          </View>
          <View style={s.row}>
            <Chip label="Přidat čas" icon="plus" />
          </View>
        </>
      ) : null}
      <Card>
        <Row last title="Zavřeno" titleWeight={500} trailing={<Toggle value={closed} onChange={setClosed} />} />
      </Card>
      <Button label="Hotovo" onPress={() => router.back()} />
    </Sheet>
  );
}

export function NavrhnoutAkciScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pub = pubById(id) ?? pubById('tygr')!;
  const [name, setName] = useState('');
  return (
    <Screen
      header={<BackHeader />}
      footer={
        <Button
          label="Poslat ke kontrole"
          icon="send"
          disabled={!name.trim()}
          onPress={() => {
            router.back();
            toast({ kind: 'saved', title: 'Návrh mám.', sub: 'Až ho zkontroluju, objeví se u hospody.', icon: 'send' });
          }}
        />
      }
      gap={16}
    >
      <PageTitle kicker={pub.name} title="Navrhnout akci" intro="Napiš, co se v hospodě děje." />
      <Field label="Název akce">
        <Input value={name} onChangeText={setName} placeholder="Třeba hospodský kvíz" autoFocus />
      </Field>
      <View style={[s.row, { gap: 10 }]}>
        <Field label="Začátek" style={s.fill}>
          <Input icon="calendar" value="Čt 6. 11. · 19:00" editable={false} />
        </Field>
        <Field label="Konec" style={s.fill}>
          <Input icon="clock-4" value="22:00" editable={false} />
        </Field>
      </View>
      <Field label="Podrobnosti (nepovinné)">
        <Input multiline placeholder="Vstupné, rezervace nebo co čekat" />
      </Field>
      <View style={[s.row, { gap: 10, alignItems: 'flex-start', paddingHorizontal: 4 }]}>
        <Icon name="shield-check" size={16} color={C.muted} />
        <T s={13} c={C.muted} lh={1.4} style={s.fill}>
          Návrh nejdřív zkontroluju. Až projde, ukáže se v detailu hospody. Neověřené a skončené akce ostatní neuvidí.
        </T>
      </View>
    </Screen>
  );
}

export function ZalozitSetkaniScreen() {
  const router = useRouter();
  const [title, setTitle] = useState('Deskovky a ležák');
  const [desc, setDesc] = useState('Carcassonne a Duna, ležák z Únětic. Nás je pět, vejdou se ještě dva.');
  const [day, setDay] = useState<'dnes' | 'zitra'>('zitra');
  const [seats, setSeats] = useState(6);
  return (
    <Screen
      header={<BackHeader icon="x" />}
      footer={<Button label="Otevřít stůl" icon="house" onPress={() => router.replace('/nv/moje-setkani')} />}
      gap={16}
    >
      <PageTitle kicker="Pivo u tebe doma" title="Pozvi lidi k sobě" />
      <Field label="Název setkání">
        <Input value={title} onChangeText={setTitle} />
      </Field>
      <Field label="Co se bude dít">
        <Input value={desc} onChangeText={setDesc} multiline />
      </Field>
      <Field label="Kdy">
        <View style={[s.row, { gap: 10 }]}>
          <Segmented
            style={{ flex: 1 }}
            height={48}
            options={[
              { key: 'dnes', label: 'Dnes' },
              { key: 'zitra', label: 'Zítra' },
            ]}
            value={day}
            onChange={setDay}
          />
          <Input icon="clock-4" value="18:00" style={{ width: 120 }} editable={false} />
        </View>
      </Field>
      <View style={[s.row, { padding: 16, borderRadius: 20, backgroundColor: C.card }]}>
        <View style={[s.fill, { gap: 2 }]}>
          <T s={16} w={600}>
            Kolik se vás vejde
          </T>
          <T s={13} c={C.muted}>
            i s tebou, ukážu volná místa
          </T>
        </View>
        <Stepper value={seats} onChange={setSeats} min={2} />
      </View>
      <Field label="Tvoje adresa">
        <Input icon="lock" value="Slezská 48, 2. patro, zvonek Dvořák" />
      </Field>
      <T s={13} c={C.muted} lh={1.4} style={{ marginTop: -6 }}>
        Ostatní uvidí jen čtvrť, tady Vinohrady. Celou adresu pošlu až lidem, které pustíš.
      </T>
    </Screen>
  );
}

const REQUESTS = [
  { name: 'Petra', handle: '@petrapije', initial: 'P', note: '„Hraju Carcassonne od dětství, přinesu chipsy a dobrou náladu.“' },
  { name: 'Marek', handle: '@marek_z_vinohrad', initial: 'M', note: '„Bydlím za rohem, deskovky miluju.“' },
];

export function MojeSetkaniScreen() {
  const router = useRouter();
  const [decided, setDecided] = useState<Record<string, 'ok' | 'no'>>({});
  const waiting = REQUESTS.filter((r) => !decided[r.name]);
  const approved = Object.values(decided).filter((v) => v === 'ok').length;
  return (
    <Screen
      header={<BackHeader right={<IconButton icon="share" size={40} iconSize={18} label="Sdílet" onPress={() => router.push('/nv/nalepky')} />} />}
      footer={
        <Button
          label="Zrušit setkání"
          icon="x"
          kind="raised"
          onPress={() =>
            useMock.getState().showDialog({
              title: 'Zrušit setkání?',
              body: 'Všem pozvaným dám vědět, že se nekoná.',
              actions: [{ label: 'Nechat' }, { label: 'Zrušit', kind: 'danger', onPress: () => router.back() }],
            })
          }
        />
      }
      gap={18}
    >
      <Ticket
        big
        kicker="Pořádáš ty"
        kickerIcon="house"
        dayNum="31"
        dayName="Zítra, sobota"
        time="18:00"
        title="Deskovky a ležák"
        stub={
          <View style={[s.row, { gap: 8, paddingHorizontal: 4, height: 40 }]}>
            <Icon name="lock-open" size={16} color={C.muted} />
            <T s={14} w={600} c={C.text2} style={s.fill}>
              Slezská 48, Vinohrady
            </T>
            <T s={14} w={700}>{`${Math.max(0, 2 - approved)} volná místa`}</T>
          </View>
        }
      />
      <View style={{ gap: 8 }}>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <Kicker>Žádosti o místo</Kicker>
          {waiting.length ? (
            <T s={13} w={700} c={C.yellow}>{`${waiting.length} čekají`}</T>
          ) : null}
        </View>
        <Card>
          {REQUESTS.map((r, i) => (
            <View key={r.name} style={[{ paddingVertical: 14, gap: 10 }, i < REQUESTS.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.hairline }]}>
              <View style={[s.row, { gap: 12 }]}>
                <Person initial={r.initial} size={44} />
                <View style={{ gap: 2 }}>
                  <T s={16} w={700}>
                    {r.name}
                  </T>
                  <T s={13} w={500} c={C.muted}>
                    {r.handle}
                  </T>
                </View>
              </View>
              <T s={14} w={500} c={C.text2} lh={1.35}>
                {r.note}
              </T>
              {decided[r.name] ? (
                <T s={14} w={700} c={decided[r.name] === 'ok' ? C.yellow : C.muted}>
                  {decided[r.name] === 'ok' ? 'Schváleno, adresu jsem poslal.' : 'Odmítnuto.'}
                </T>
              ) : (
                <View style={[s.row, { gap: 8 }]}>
                  <Button label="Odmítnout" kind="raised" height={40} flex onPress={() => setDecided({ ...decided, [r.name]: 'no' })} />
                  <Button label="Schválit" icon="check" height={40} flex onPress={() => setDecided({ ...decided, [r.name]: 'ok' })} />
                </View>
              )}
            </View>
          ))}
        </Card>
      </View>
    </Screen>
  );
}

export function PrichodScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pub = pubById(id) ?? pubById('tygr')!;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) + 4, paddingHorizontal: 12, gap: 20 }}>
      <Animated.View
        entering={ZoomIn.springify().damping(16)}
        style={{ flex: 1, backgroundColor: C.yellow, borderRadius: 32, paddingTop: 24, paddingHorizontal: 24, paddingBottom: 28, justifyContent: 'space-between' }}
      >
        <View style={{ gap: 6 }}>
          <T s={12} w={800} c="#0A0A0AA6" style={{ letterSpacing: 1 }}>
            VÍTEJ V
          </T>
          <D s={34} c={C.black}>
            {pub.name}
          </D>
        </View>
        <View style={{ gap: 14 }}>
          <View style={[{ width: 72, height: 72, borderRadius: 36, backgroundColor: C.black }, s.center]}>
            <Icon name="beer" size={34} color={C.yellow} />
          </View>
          <D s={132} lh={0.85} c={C.black}>
            {'Na\nzdraví!'}
          </D>
          <T s={20} w={700} c={C.black}>
            Dej si jedno za mě
          </T>
        </View>
      </Animated.View>
      <View style={[s.row, { gap: 10, paddingHorizontal: 8 }]}>
        <Button label="Zpět na kompas" icon="compass" flex onPress={() => router.navigate('/nv/kompas')} />
        <Button
          label="Otevřít v mapách"
          icon="map"
          kind="raised"
          flex
          onPress={() => Linking.openURL(`http://maps.apple.com/?daddr=${pub.coord.latitude},${pub.coord.longitude}&dirflg=w`)}
        />
      </View>
    </View>
  );
}

