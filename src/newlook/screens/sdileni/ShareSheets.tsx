import React, { useState } from 'react';
import { Image, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/overlays';
import { Button, Card, Chip, ChipWrap, Press, Row, T, Tile, Toggle } from '../../components/ui';
import { photo, pubById } from '../../mock/data';
import { toast, useMock, useTonight } from '../../mock/store';
import { C, s } from '../../theme';
import { StickerCedule, StickerJduNaPivo, StickerKdoJde, StickerTacek, StickerUctenka, StickerVelkeCislo } from './Stickers';

function Stage({ children, bg }: { children: React.ReactNode; bg?: number }) {
  return (
    <View style={[{ height: 260, borderRadius: 22, overflow: 'hidden', backgroundColor: '#2A2622' }, s.center]}>
      {bg ? (
        <Image source={photo(bg)} style={{ position: 'absolute', width: '100%', height: '100%' }} blurRadius={6} />
      ) : (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, experimental_backgroundImage: 'radial-gradient(circle at 50% 40%, #4A4036 0%, #1E1B18 80%)' }} />
      )}
      {children}
    </View>
  );
}

const shared = (what: string) => toast({ kind: 'saved', title: what, icon: 'send' });

export function SdiletHospoduSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pub = pubById(id) ?? pubById('tygr')!;
  const [time, setTime] = useState('19:30');
  return (
    <Sheet title="Sdílet" top={150} scroll={false}>
      <Stage>
        <View style={{ transform: [{ rotate: '-4deg' }] }}>
          <StickerJduNaPivo when={`${time === 'Teď' ? 'teď' : time} · ${pub.name}`} />
        </View>
      </Stage>
      <View style={{ gap: 10 }}>
        <T s={14} w={600} c={C.muted}>
          Kdy tam budeš
        </T>
        <ChipWrap>
          {['Teď', '19:30', '20:00'].map((t) => (
            <Chip key={t} label={t} active={time === t} onPress={() => setTime(t)} />
          ))}
          <Chip label="Jiný čas" icon="clock-4" onPress={() => setTime('21:00')} />
        </ChipWrap>
      </View>
      <Button label="Vložit do Instagramu" icon="send" onPress={() => shared('Nálepka je v Instagramu.')} />
      <View style={[s.row, { gap: 10 }]}>
        <Button label="Poslat odkaz" icon="link" kind="raised" flex onPress={() => shared('Odkaz zkopírovaný.')} />
        <Button label="Uložit nálepku" icon="download" kind="raised" flex onPress={() => shared('Nálepka je ve fotkách.')} />
      </View>
    </Sheet>
  );
}

export function TourPozvatSheet() {
  const router = useRouter();
  return (
    <Sheet title="Pozvat partu" top={290} scroll={false}>
      <Stage>
        <StickerKdoJde where="Žižkovský tah · so 20:00" />
      </Stage>
      <Button label="Nálepka do Instagramu" icon="send" onPress={() => shared('Nálepka je v Instagramu.')} />
      <Card>
        <Row leading={<Tile icon="user-plus" />} title="Poslat pozvánku" titleWeight={700} sub="Kámoši dostanou pozvánku v appce" chevron onPress={() => router.replace('/nv/tour-cinknout')} />
        <Row last leading={<Tile icon="link" />} title="Sdílet veřejný odkaz" titleWeight={700} sub="Pro kohokoli, i bez appky" chevron onPress={() => shared('Odkaz zkopírovaný.')} />
      </Card>
    </Sheet>
  );
}

type Kind = 'tacek' | 'cedule' | 'cislo' | 'uctenka';

export function NalepkySheet() {
  const { kind: initial } = useLocalSearchParams<{ kind?: string }>();
  const { count, tonight } = useTonight();
  const pubId = useMock((st) => st.pubId);
  const pub = pubById(pubId)?.name ?? 'U Zlatého tygra';
  const since = tonight[tonight.length - 1]?.time ?? '19:40';
  const n = Math.max(count, 3);
  const [kind, setKind] = useState<Kind>((initial as Kind) ?? 'tacek');
  const kinds: [Kind, string][] = [
    ['tacek', 'Tácek'],
    ['cedule', 'Cedule'],
    ['cislo', 'Velké číslo'],
  ];
  return (
    <Sheet title="Nálepka na story" top={130} scroll={false}>
      <Stage bg={17}>
        {kind === 'tacek' ? (
          <StickerTacek pub={pub} count={n} since={since} />
        ) : kind === 'cedule' ? (
          <StickerCedule pub={pub} count={n} since={since} />
        ) : kind === 'uctenka' ? (
          <StickerUctenka />
        ) : (
          <StickerVelkeCislo count={n} label="DNES" route={pub} />
        )}
      </Stage>
      <View style={[s.row, { gap: 8 }]}>
        {kinds.map(([k, label]) => {
          const on = kind === k;
          return (
            <Press key={k} haptic onPress={() => setKind(k)} style={[s.fill, s.center, { height: 46, borderRadius: 16, backgroundColor: on ? '#FFFFFF14' : C.card, borderWidth: on ? 1.5 : 1, borderColor: on ? C.white : C.hairline }]}>
              <T s={14} w={on ? 800 : 600}>
                {label}
              </T>
            </Press>
          );
        })}
      </View>
      <Button label="Vložit do Instagramu" icon="send" onPress={() => shared('Nálepka je v Instagramu.')} />
      <View style={[s.row, { gap: 10 }]}>
        <Button label="Uložit do fotek" icon="download" kind="raised" flex onPress={() => shared('Nálepka je ve fotkách.')} />
        <Button label="Sdílet jinam" icon="share" kind="raised" flex onPress={() => shared('Sdíleno.')} />
      </View>
    </Sheet>
  );
}

/** One permission for nights, ratings and photos (redesign decision "Sdílení"). */
export function SdileniSouhlasSheet() {
  const router = useRouter();
  const [all, setAll] = useState(true);
  return (
    <Sheet title="Kdo co vidí" top={330} scroll={false}>
      <T s={15} c={C.text2} lh={1.45} style={{ marginTop: -8 }}>
        Jedno nastavení pro vyvěšené noci, hodnocení i fotky. Změníš ho kdykoli tady.
      </T>
      <Card>
        <Row last title="Sdílet všem" sub={all ? 'Uvidí to každý v Na pivo' : 'Uvidí to jen tvoje parta'} trailing={<Toggle value={all} onChange={setAll} />} />
      </Card>
      <View style={{ gap: 10 }}>
        {[
          ['calendar', 'U piva je jen den, ne hodina.'],
          ['eye-off', 'Útrata, poloha a jednotlivá piva zůstávají jen tobě.'],
          ['flag', 'Každou recenzi jde nahlásit.'],
        ].map(([icon, text]) => (
          <View key={text} style={[s.row, { gap: 10 }]}>
            <Icon name={icon as 'calendar'} size={16} color={C.muted} />
            <T s={14} c={C.text2} style={s.fill}>
              {text}
            </T>
          </View>
        ))}
      </View>
      <Button
        label="Hotovo"
        onPress={() => {
          useMock.getState().set({ shareMode: all ? 'all' : 'parta' });
          router.back();
        }}
      />
    </Sheet>
  );
}
