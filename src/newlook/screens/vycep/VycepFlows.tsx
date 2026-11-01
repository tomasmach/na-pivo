import React, { useState } from 'react';
import { Image, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';

import { BackHeader, Screen } from '../../components/chrome';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/overlays';
import { Button, D, Kicker, Press, Segmented, T } from '../../components/ui';
import { photo } from '../../mock/data';
import { toast, useMock } from '../../mock/store';
import { C, SCREEN_X, s } from '../../theme';

function PreviewCard({ withPhoto, onPhoto, compact }: { withPhoto?: boolean; onPhoto?: () => void; compact?: boolean }) {
  return (
    <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 16, gap: 12, borderWidth: 1, borderColor: C.hairline }}>
      <View style={[s.row, { gap: 12 }]}>
        <View style={[{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.control }, s.center]}>
          <T s={13} w={800} c={C.yellow}>
            T
          </T>
        </View>
        <View style={s.fill}>
          <T s={15} w={700}>
            @tomas
          </T>
          <T s={12} c={C.muted}>
            Praha · So 24. 10.
          </T>
        </View>
        {!compact ? (
          <T s={12} w={700} c={C.muted}>
            náhled
          </T>
        ) : null}
      </View>
      {compact ? null : withPhoto ? (
        <Image source={photo(8)} style={{ height: 120, borderRadius: 16, width: '100%' }} />
      ) : (
        <Press onPress={onPhoto} style={[{ height: 92, borderRadius: 16, borderWidth: 1.5, borderColor: '#FFFFFF33', gap: 4 }, s.center]}>
          <Icon name="camera" size={20} color={C.yellow} />
          <T s={14} w={700}>
            Přidat fotku z večera
          </T>
          <T s={12} c={C.muted}>
            nepovinné
          </T>
        </Press>
      )}
      <View style={{ gap: 4 }}>
        <D s={compact ? 30 : 34} lh={1}>
          5 piv
        </D>
        <T s={13} c={C.text2}>
          Lokál Dlouhááá → U Pinkasů · 4 h 10 min
        </T>
      </View>
      {compact ? (
        <View style={[s.row, { alignSelf: 'flex-start', height: 30, borderRadius: 15, paddingHorizontal: 10, gap: 6, backgroundColor: C.control }]}>
          <Icon name="hand-platter" size={14} color={C.yellow} />
          <T s={12} w={700}>
            Runda
          </T>
        </View>
      ) : null}
    </View>
  );
}

function Choice({ title, sub, on, icon, onPress }: { title: string; sub: string; on: boolean; icon?: 'globe' | 'users'; onPress: () => void }) {
  return (
    <Press
      haptic
      onPress={onPress}
      accessibilityState={{ selected: on }}
      style={{ flex: icon ? 1 : undefined, padding: 14, gap: 6, borderRadius: 18, backgroundColor: on ? '#FFFFFF14' : C.card, borderWidth: on ? 1.5 : 1, borderColor: on ? C.white : C.hairline }}
    >
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        {icon ? <Icon name={icon} size={22} color={on ? C.yellow : C.text2} /> : <T s={16} w={700}>{title}</T>}
        <View style={[{ width: 24, height: 24, borderRadius: 12, borderWidth: on ? 0 : 1.5, borderColor: C.muted, backgroundColor: on ? C.white : 'transparent' }, s.center]}>
          {on ? <Icon name="check" size={14} color={C.black} /> : null}
        </View>
      </View>
      {icon ? (
        <T s={16} w={700}>
          {title}
        </T>
      ) : null}
      <T s={13} c={C.muted}>
        {sub}
      </T>
    </Press>
  );
}

export function VyvesitSheet() {
  const router = useRouter();
  const st = useMock();
  const [scope, setScope] = useState<'all' | 'parta'>(st.shareMode === 'parta' ? 'parta' : 'all');
  const [withPhoto, setWithPhoto] = useState(false);
  return (
    <Sheet
      title="Vyvěsit noc"
      top={150}
      footer={
        <Button
          label={scope === 'all' ? 'Vyvěsit celému světu' : 'Vyvěsit partě'}
          onPress={() => {
            router.dismissTo('/nv/vycep');
            toast({ kind: 'xp', title: 'Noc visí na Výčepu!', icon: 'megaphone', xp: 15 });
          }}
        />
      }
    >
      <PreviewCard withPhoto={withPhoto} onPhoto={() => setWithPhoto(true)} />
      <View style={[s.row, { gap: 10 }]}>
        <Choice icon="globe" title="Celý svět" sub="Uvidí každý ve Výčepu" on={scope === 'all'} onPress={() => setScope('all')} />
        <Choice icon="users" title="Jen parta" sub="Uvidí tvoje parta" on={scope === 'parta'} onPress={() => setScope('parta')} />
      </View>
      <View style={[s.row, { gap: 10, alignItems: 'flex-start' }]}>
        <Icon name="lock" size={15} color={C.muted} />
        <T s={13} c={C.muted} lh={1.4} style={s.fill}>
          Vyvěsí se počet piv, hospody, datum a délka noci. Útrata a jednotlivá piva zůstávají jen tobě.
        </T>
      </View>
    </Sheet>
  );
}

export function PrvniVyveseniScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<'manual' | 'all' | 'parta'>('manual');
  return (
    <Screen
      footer={
        <Button
          label="Vyvěsit noc"
          icon="megaphone"
          onPress={() => {
            useMock.getState().set({ shareMode: mode === 'parta' ? 'parta' : 'all' });
            router.replace('/nv/vyvesit');
          }}
        />
      }
      gap={16}
    >
      <View style={{ height: 210, justifyContent: 'flex-end' }}>
        {['@Hospodsky', '@PivniVlk'].map((u, i) => (
          <View key={u} style={{ position: 'absolute', top: i * 26, left: 34 - i * 16, right: 34 - i * 16, height: 80, borderRadius: 22, backgroundColor: i ? '#1A1A1A' : '#121212', borderWidth: 1, borderColor: C.hairline, padding: 14 }}>
            <T s={13} w={700} c={C.muted}>
              {u}
            </T>
          </View>
        ))}
        <PreviewCard compact />
      </View>
      <View style={{ gap: 10, marginTop: 12 }}>
        <T s={14} w={700} c={C.yellow}>
          Poprvé vyvěšuješ
        </T>
        <D s={44}>Jak chceš vyvěšovat?</D>
        <T s={16} c={C.text2} lh={1.45}>
          Vyvěsí se počet piv, hospody, datum a délka noci. Útrata a jednotlivá piva zůstávají jen tobě. Změníš to v Nastavení.
        </T>
      </View>
      <View style={{ gap: 8, marginTop: 8 }}>
        <Choice title="Ručně" sub="Vyvěsím jen noc, kterou vybereš" on={mode === 'manual'} onPress={() => setMode('manual')} />
        <Choice title="Samo celému světu" sub="Po Dopito. Stáhneš kdykoli" on={mode === 'all'} onPress={() => setMode('all')} />
        <Choice title="Samo partě" sub="Po Dopito uvidí jen tvoje parta" on={mode === 'parta'} onPress={() => setMode('parta')} />
      </View>
    </Screen>
  );
}

const ENTRIES = [
  { n: 4, user: 'KlaraNaCepu', beer: 'Pilsner Urquell 12° · U Pinkasů', rounds: 18 },
  { n: 6, user: 'PivniVlk', beer: 'Last Lager · Lokál U Caipla', rounds: 15 },
  { n: 5, user: 'Hospodsky', beer: 'Únětické 12° · Na Slamníku', rounds: 9 },
  { n: 7, user: 'marek_stamgast', beer: 'Kozel 11° · Lokál Dlouhááá', rounds: 7 },
];

export function FotoPivarScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const st = useMock();
  const [tab, setTab] = useState<'nove' | 'vedou'>('nove');
  const [given, setGiven] = useState<number[]>([]);
  const [ended, setEnded] = useState(false);
  const parta = st.shareMode === 'parta';
  const col = (width - SCREEN_X * 2 - 10) / 2;
  const entries = tab === 'vedou' ? [...ENTRIES].sort((a, b) => b.rounds - a.rounds) : ENTRIES;

  if (ended) {
    return (
      <Screen header={<BackHeader onBack={() => setEnded(false)} />} footer={<Button label="Do nového kola" onPress={() => setEnded(false)} />} gap={16}>
        <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-end' }]}>
          <D s={44}>FotoPivař</D>
          <T s={15} w={700} c={C.muted} style={{ marginBottom: 6 }}>
            Kolo skončilo
          </T>
        </View>
        <View style={[s.row, { gap: 14 }]}>
          <D s={80} lh={0.9} c={C.yellow}>
            3.
          </D>
          <View style={[s.fill, { gap: 2 }]}>
            <T s={18} w={700}>
              Bronz na bedně
            </T>
            <T s={13} c={C.muted}>
              14 rund · +25 XP. Příště to může být výš.
            </T>
          </View>
        </View>
        <View>
          <Image source={photo(4)} style={{ width: '100%', height: 250, borderRadius: 22 }} />
          <View style={[s.row, { position: 'absolute', left: 10, top: 10, height: 30, borderRadius: 15, paddingHorizontal: 10, gap: 6, backgroundColor: '#0A0A0AB3' }]}>
            <Icon name="trophy" size={14} color={C.yellow} />
            <T s={12} w={700}>
              Zlatý tácek
            </T>
          </View>
        </View>
        <View style={[s.row, { justifyContent: 'space-between', marginTop: -6 }]}>
          <View>
            <T s={15} w={700}>
              1. @KlaraNaCepu
            </T>
            <T s={12} c={C.muted}>
              Pilsner Urquell 12° · U Pinkasů
            </T>
          </View>
          <T s={15} w={800}>
            26 rund
          </T>
        </View>
        <View style={[s.row, { gap: 10 }]}>
          {[
            [6, '2. @PivniVlk', '19 rund', false],
            [3, '3. Ty', '14 rund', true],
          ].map(([n, who, r, me]) => (
            <View key={String(who)} style={{ flex: 1, gap: 6 }}>
              <Image source={photo(n as number)} style={{ width: '100%', height: 110, borderRadius: 18, borderWidth: me ? 2 : 0, borderColor: C.yellow }} />
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <T s={13} w={700} c={C.text2}>
                  {who as string}
                </T>
                <T s={12} c={C.muted}>
                  {r as string}
                </T>
              </View>
            </View>
          ))}
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      header={<BackHeader />}
      footer={parta ? <Button label="Přihlásit fotku" icon="plus" onPress={() => router.push('/nv/prihlasit-fotku')} /> : <Button label="Vyfotit pivo" icon="camera" onPress={() => router.push('/nv/do-denicku')} />}
      gap={16}
    >
      <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-end' }]}>
        <D s={44}>FotoPivař</D>
        <Press onPress={() => setEnded(true)} style={[s.row, { gap: 6, marginBottom: 6 }]}>
          <Icon name="trophy" size={16} color={C.yellow} />
          <T s={15} w={600}>
            Minulé kolo
          </T>
        </Press>
      </View>
      <View style={[s.row, { gap: 14 }]}>
        <D s={80} lh={0.9} c={C.yellow}>
          5
        </D>
        <View style={[s.fill, { gap: 2 }]}>
          <T s={18} w={700}>
            dní do konce kola
          </T>
          <T s={13} c={C.muted}>
            Runda u fotky je hlas. Rozdat jich můžeš kolik chceš.
          </T>
        </View>
      </View>
      <Press onPress={() => (parta ? router.push('/nv/sdileni-souhlas') : router.push('/nv/pivni-fotky'))} style={[s.row, { gap: 12, padding: 10, paddingRight: 14, borderRadius: 20, backgroundColor: C.card }]}>
        {parta ? (
          <View style={[{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.control }, s.center]}>
            <Icon name="users" size={20} color={C.yellow} />
          </View>
        ) : (
          <View style={s.row}>
            {[3, 1, 12].map((n, i) => (
              <Image key={n} source={photo(n)} style={{ width: 40, height: 44, borderRadius: 10, marginLeft: i ? -12 : 0, borderWidth: 2, borderColor: C.card }} />
            ))}
          </View>
        )}
        <View style={[s.fill, { gap: 2 }]}>
          <T s={16} w={700}>
            {parta ? 'Sdílíš jen partě' : 'Tvoje 3 fotky v kole'}
          </T>
          <T s={12} c={C.muted}>
            {parta ? 'Do soutěže pošleš fotku sám. Tu pak uvidí každý.' : 'Nejlepší má 11 rund · 4. místo'}
          </T>
        </View>
        <Icon name="chevron-right" size={16} color={C.muted} />
      </Press>
      <Segmented
        height={38}
        options={[
          { key: 'nove', label: 'Nové' },
          { key: 'vedou', label: 'Vedou' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <View style={[s.row, { gap: 10, alignItems: 'flex-start' }]}>
        {[0, 1].map((c) => (
          <View key={c} style={{ width: col, gap: 14, marginTop: c ? 0 : 0 }}>
            {entries
              .filter((_, i) => i % 2 === c)
              .map((e, i) => {
                const on = given.includes(e.n);
                const h = (c + i) % 2 ? 170 : 210;
                return (
                  <View key={e.n} style={{ gap: 6 }}>
                    <View>
                      <Image source={photo(e.n)} style={{ width: col, height: h, borderRadius: 20 }} />
                      <View style={[{ position: 'absolute', right: 10, top: 10, width: 28, height: 28, borderRadius: 14, backgroundColor: '#0A0A0AB3' }, s.center]}>
                        <Icon name="ellipsis" size={14} />
                      </View>
                      <Press
                        haptic
                        onPress={() => setGiven(on ? given.filter((x) => x !== e.n) : [...given, e.n])}
                        style={[s.row, { position: 'absolute', left: 10, bottom: 10, height: 32, borderRadius: 16, paddingHorizontal: 10, gap: 6, backgroundColor: on ? C.yellow : '#0A0A0AB3' }]}
                      >
                        <Icon name="hand-platter" size={15} color={on ? C.black : C.yellow} />
                        <T s={14} w={800} c={on ? C.black : C.white}>
                          {e.rounds + (on ? 1 : 0)}
                        </T>
                      </Press>
                    </View>
                    <T s={14} w={700}>{`@${e.user}`}</T>
                    <T s={12} c={C.muted} style={{ marginTop: -4 }}>
                      {e.beer}
                    </T>
                  </View>
                );
              })}
          </View>
        ))}
      </View>
    </Screen>
  );
}

export function PrihlasitFotkuSheet() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [sel, setSel] = useState(3);
  const size = (width - SCREEN_X * 2 - 12) / 3;
  return (
    <Sheet
      title="Přihlásit fotku"
      top={350}
      footer={
        <Button
          label="Přihlásit tuhle fotku"
          onPress={() => {
            router.back();
            toast({ kind: 'saved', title: 'Fotka soutěží.', sub: 'Uvidí ji každý ve FotoPivaři.', icon: 'trophy' });
          }}
        />
      }
    >
      <T s={14} c={C.text2} lh={1.4} style={{ marginTop: -14 }}>
        Tuhle fotku uvidí každý, i když jinak sdílíš jen partě. Přihlásit jich můžeš víc.
      </T>
      <Button label="Vyfotit novou" icon="camera" kind="raised" height={48} onPress={() => router.replace('/nv/do-denicku')} />
      <Kicker>Nebo z deníčku</Kicker>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {[3, 1, 2, 9, 10, 11].map((n) => (
          <Press key={n} onPress={() => setSel(n)}>
            <Image source={photo(n)} style={{ width: size, height: size, borderRadius: 12, borderWidth: sel === n ? 3 : 0, borderColor: C.yellow }} />
            {sel === n ? (
              <View style={[{ position: 'absolute', right: 6, top: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: C.yellow }, s.center]}>
                <Icon name="check" size={13} color={C.black} />
              </View>
            ) : null}
            {n === 10 ? (
              <View style={[s.row, { position: 'absolute', left: 6, bottom: 6, height: 24, borderRadius: 12, paddingHorizontal: 8, gap: 4, backgroundColor: '#0A0A0AB3' }]}>
                <Icon name="cloud-upload" size={11} />
                <T s={10} w={700}>
                  Nahrává se
                </T>
              </View>
            ) : null}
          </Press>
        ))}
      </View>
    </Sheet>
  );
}

