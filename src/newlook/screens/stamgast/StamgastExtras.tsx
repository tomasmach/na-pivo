import React, { useState } from 'react';
import { View } from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackHeader, Screen } from '../../components/chrome';
import { Input, PageTitle } from '../../components/forms';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/overlays';
import { Button, Card, D, Dot, IconButton, Kicker, Press, Row, T, Tile } from '../../components/ui';
import { ME_COORD } from '../../mock/data';
import { toast, useMock } from '../../mock/store';
import { C, s } from '../../theme';
import { GRAY_MAP } from '../kompas/NvMap';

export function DomovskyBodScreen() {
  const router = useRouter();
  const [address, setAddress] = useState('Korunní 12, Praha');
  return (
    <Screen
      header={<BackHeader />}
      footer={
        <Button
          label="Uložit domov"
          onPress={() => {
            useMock.getState().set({ homeSet: true });
            router.back();
            toast({ kind: 'saved', title: 'Domov mám.', sub: 'Večer ti pohlídám poslední spoj.', icon: 'house' });
          }}
        />
      }
      gap={16}
    >
      <PageTitle title="Domovský bod" />
      <T s={16} w={500} c={C.text2} style={{ marginTop: -8 }}>
        Kde je tvoje domácí základna?
      </T>
      <View style={[s.row, { minHeight: 58, borderRadius: 18, paddingHorizontal: 14, gap: 12, backgroundColor: C.card, borderWidth: 1, borderColor: '#FFFFFF14' }]}>
        <Icon name="house" size={18} color={C.muted} />
        <View style={s.fill}>
          <T s={12} c={C.muted}>
            Adresa nebo město
          </T>
          <Input value={address} onChangeText={setAddress} height={24} focusRing={false} style={{ backgroundColor: 'transparent', borderWidth: 0, paddingHorizontal: 0, minHeight: 24 }} />
        </View>
      </View>
      <View style={[s.row, { gap: 10 }]}>
        <Button label="Najít na mapě" icon="search" kind="raised" flex height={48} />
        <Button label="Moje poloha" icon="locate-fixed" kind="raised" flex height={48} />
      </View>
      <View style={{ height: 300, borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: C.hairline }}>
        <MapView provider={PROVIDER_GOOGLE} style={{ flex: 1 }} customMapStyle={GRAY_MAP} initialRegion={{ ...ME_COORD, latitudeDelta: 0.014, longitudeDelta: 0.014 }} userInterfaceStyle="dark" />
        <View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }, s.center]}>
          <View style={[{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFC40033' }, s.center]}>
            <View style={[{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.yellow, borderWidth: 2, borderColor: C.black }, s.center]}>
              <Icon name="house" size={18} color={C.black} />
            </View>
          </View>
        </View>
      </View>
      <T s={15} w={600}>
        Sedí bod přesně? Když ne, ťukni na správné místo v mapě.
      </T>
      <T s={13} c={C.muted} lh={1.45}>
        Adresu jednou pošlu geokódovací službě, ať ji najdu na mapě. V telefonu zůstane jen ten potvrzený bod, žádná historie polohy ani trasy.
      </T>
    </Screen>
  );
}

const WATCH_INFO: Record<string, { name: string; where?: string }> = {
  unetice: { name: 'Únětické 12°', where: 'na čepu U Pinkasů · 1,8 km' },
  raptor: { name: 'Matuška Raptor 15°', where: 'na čepu Pivovarský klub · 3,4 km' },
  samuraj: { name: 'Kocour Samuraj 12°' },
  bernard: { name: 'Bernard Černý 12°' },
};

export function HlidanaPivaScreen() {
  const st = useMock();
  const [radius, setRadius] = useState(5);
  const list = Object.keys(WATCH_INFO).filter((id) => st.watched.includes(id) || id === 'samuraj' || id === 'bernard');
  const shown = st.watched.length ? list : [];
  return (
    <Screen header={<BackHeader />} gap={16}>
      <PageTitle title="Hlídaná piva" />
      {!st.watchAlerts ? (
        <View style={[s.row, { gap: 12, padding: 16, borderRadius: 20, backgroundColor: C.card, alignItems: 'flex-start' }]}>
          <Icon name="bell-off" size={20} color={C.yellow} />
          <View style={[s.fill, { gap: 10 }]}>
            <T s={15} w={700}>
              Upozornění máš vypnutá, takže ti nedám vědět.
            </T>
            <Press onPress={() => st.set({ watchAlerts: true })} style={{ alignSelf: 'flex-start', height: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: 'center', backgroundColor: C.control }}>
              <T s={13} w={700}>
                Otevřít nastavení
              </T>
            </Press>
          </View>
        </View>
      ) : null}
      <T s={15} w={700} c={C.muted}>
        Jak daleko
      </T>
      <View style={[s.row, { height: 46, borderRadius: 23, padding: 3, backgroundColor: '#FFFFFF12' }]}>
        {[1, 3, 5, 10].map((km) => (
          <Press key={km} haptic onPress={() => setRadius(km)} style={[s.fill, s.center, { alignSelf: 'stretch', borderRadius: 20 }, radius === km && { backgroundColor: C.white }]}>
            <T s={15} w={radius === km ? 800 : 600} c={radius === km ? C.black : C.text2}>{`${km} km`}</T>
          </Press>
        ))}
      </View>
      {shown.length ? (
        <>
          <T s={15} w={700} c={C.muted}>{`Hlídáš · ${shown.length}`}</T>
          <Card>
            {shown.map((id, i) => {
              const w = WATCH_INFO[id];
              return (
                <Row
                  key={id}
                  last={i === shown.length - 1}
                  leading={<Tile icon="beer" color={C.white} />}
                  title={w.name}
                  titleWeight={700}
                  sub={
                    w.where ? (
                      <View style={[s.row, { gap: 6 }]}>
                        <Dot color={C.yellow} />
                        <T s={13} w={500} c={C.text2}>
                          {w.where}
                        </T>
                      </View>
                    ) : (
                      `do ${radius} km zatím nikde`
                    )
                  }
                  trailing={
                    <IconButton
                      icon="bell-ring"
                      size={36}
                      iconSize={16}
                      label="Přestat hlídat"
                      onPress={() => {
                        st.set({ watched: st.watched.filter((x) => x !== id) });
                        toast({ kind: 'info', title: `${w.name} už nehlídám.`, icon: 'bell-off' });
                      }}
                    />
                  }
                />
              );
            })}
          </Card>
          <T s={13} c={C.muted} lh={1.4}>
            Dám vědět, až ho začnou čepovat poblíž. Zvoneček hlídání vypne.
          </T>
        </>
      ) : (
        <View style={{ alignItems: 'center', gap: 12, paddingTop: 50 }}>
          <View style={[{ width: 64, height: 64, borderRadius: 32, backgroundColor: C.control }, s.center]}>
            <Icon name="bell-ring" size={26} color={C.text2} />
          </View>
          <D s={30}>Zatím nic nehlídáš</D>
          <T s={15} c={C.text2} style={{ textAlign: 'center' }}>
            Ťukni na pivo na lístku hospody a vyber Hlídat pivo.
          </T>
        </View>
      )}
    </Screen>
  );
}

/** "Až sedneš do hospody, cinknu ti." The offer, then what the phone will ask for. */
export function PripominkySheet() {
  const router = useRouter();
  const [step, setStep] = useState<'offer' | 'perms'>('offer');
  if (step === 'offer') {
    return (
      <Sheet closeIcon={false} top={470} scroll={false}>
        <View style={[{ width: 64, height: 64, borderRadius: 18, backgroundColor: C.control }, s.center]}>
          <Icon name="bell-ring" size={28} color={C.yellow} />
        </View>
        <View style={{ gap: 10 }}>
          <Kicker>Novinka pro večery</Kicker>
          <D s={38}>Až sedneš do hospody, cinknu ti.</D>
          <T s={15} c={C.text2} lh={1.45}>
            Počítadlo ti večer připomene, když dorazíš k hospodě. Stačí zapnout notifikace a polohu na pozadí.
          </T>
        </View>
        <Button label="Ukázat, co povoluju" onPress={() => setStep('perms')} />
        <Press onPress={() => router.back()} style={{ alignItems: 'center', paddingBottom: 6 }}>
          <T s={15} w={700} c={C.text2}>
            Teď ne, nech mě pít v klidu
          </T>
        </Press>
      </Sheet>
    );
  }
  return (
    <Sheet closeIcon={false} top={340} scroll={false}>
      <View style={{ gap: 10 }}>
        <D s={30}>Co bude telefon chtít povolit</D>
        <T s={15} c={C.text2} lh={1.45}>
          Kompasu stačí poloha při používání. Připomínka navíc potřebuje polohu „vždy“.
        </T>
      </View>
      <View>
        <Row leading={<Tile icon="bell" color={C.white} size={36} />} title="Notifikace" titleWeight={700} sub="Pošlu jen krátké připomenutí, ať večer nezmizí bez zápisu." />
        <Row leading={<Tile icon="map-pin" color={C.white} size={36} />} title="Poloha „vždy“" titleWeight={700} sub="Sbírám ji jen kvůli hospodskému okruhu, i když je appka zavřená nebo ji zrovna nepoužíváš." />
        <Row last leading={<Tile icon="shield-check" color={C.white} size={36} />} title="Bez GPS deníčku" titleWeight={700} sub="Trasy neukládám. Hlídám jen, jestli nejsi kousek od hospody." />
      </View>
      <Button
        label="Zapnout připomínky"
        onPress={() => {
          router.back();
          toast({ kind: 'saved', title: 'Připomínky jedou.', sub: 'Cinknu, až sedneš do hospody.', icon: 'bell-ring' });
        }}
      />
      <Press onPress={() => setStep('offer')} style={{ alignItems: 'center', paddingBottom: 6 }}>
        <T s={15} w={700} c={C.text2}>
          Zpět
        </T>
      </Press>
    </Sheet>
  );
}

type Notif = { day: string; time: string; title: string; body: string; live?: boolean };

const NOTIFS: Record<string, Notif> = {
  spoj: { day: 'středa 28. října', time: '23:32', title: 'Za 20 minut ti jede poslední přímý spoj domů', body: 'Linka 22 odjíždí ve 23:52 ze zastávky Národní třída.', live: true },
  cep: { day: 'čtvrtek 29. října', time: '17:45', title: 'Na čepu poblíž', body: 'Únětické 12° je na čepu U Pinkasů, 1,8 km, doplnil někdo z komunity před chvílí.' },
  hospoda: { day: 'pátek 30. října', time: '19:24', title: 'Sedíš v U Pinkasů?', body: 'Otevři počítadlo a připiš si čárku.' },
};

/** What the app shows outside itself: lock screen, Live Activity and notifications. */
export function NotifPreviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const n = NOTIFS[kind ?? 'spoj'] ?? NOTIFS.spoj;
  return (
    <Press
      onPress={() => router.replace(kind === 'cep' ? '/nv/hlidana-piva' : '/nv/stamgast')}
      style={{ flex: 1, paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: insets.bottom + 10, experimental_backgroundImage: 'linear-gradient(180deg, #33405F 0%, #1A1F33 100%)' }}
    >
      <View style={{ alignItems: 'center' }}>
        <T s={20} w={700} c="#F2F2F7">
          {n.day}
        </T>
        <T s={96} w={800} c="#F2F2F7" style={{ fontFamily: undefined, fontWeight: '700', lineHeight: 104 }}>
          {n.time}
        </T>
      </View>
      <View style={{ flex: 1 }} />
      {n.live ? (
        <View style={[s.row, { padding: 14, gap: 14, borderRadius: 26, backgroundColor: '#0A0A0AF2', marginBottom: 14 }]}>
          <View style={{ alignItems: 'center', width: 60 }}>
            <D s={84} lh={0.95} c={C.yellow}>
              3
            </D>
            <T s={13} w={700}>
              piva
            </T>
          </View>
          <View style={[s.fill, { gap: 8 }]}>
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              <T s={17} w={700}>
                U Zlatého tygra
              </T>
              <T s={15} w={700}>
                177 Kč
              </T>
            </View>
            <T s={12} c={C.muted}>
              Pilsner Urquell 12° · zapsáno v 22:52
            </T>
            <View style={[s.row, { height: 38, borderRadius: 19, justifyContent: 'center', gap: 6, backgroundColor: C.yellow }]}>
              <Icon name="plus" size={16} color={C.black} />
              <T s={15} w={800} c={C.black}>
                Ještě jedno
              </T>
            </View>
            <View style={[s.row, { gap: 6 }]}>
              <Icon name="tram-front" size={12} color={C.muted} />
              <T s={11} c={C.muted} style={s.fill}>
                Domů 23:52 · Národní třída
              </T>
              <T s={11} c={C.muted}>
                za
              </T>
              <T s={12} w={800}>
                20:00
              </T>
            </View>
          </View>
        </View>
      ) : null}
      <View style={[s.row, { padding: 14, gap: 12, borderRadius: 24, backgroundColor: '#5A5F6E99', alignItems: 'flex-start' }]}>
        <View style={[{ width: 38, height: 38, borderRadius: 9, backgroundColor: C.black }, s.center]}>
          <Icon name="beer" size={20} color={C.yellow} />
        </View>
        <View style={[s.fill, { gap: 2 }]}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <T s={12} w={500} c="#FFFFFFB3">
              Na pivo
            </T>
            <T s={12} c="#FFFFFF99">
              teď
            </T>
          </View>
          <T s={15} w={700} c="#FFFFFF">
            {n.title}
          </T>
          <T s={14} c="#FFFFFFE6" lh={1.35}>
            {n.body}
          </T>
        </View>
      </View>
    </Press>
  );
}
