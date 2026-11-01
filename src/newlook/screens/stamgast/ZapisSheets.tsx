import React, { useState } from 'react';
import { Image, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/overlays';
import { Button, D, IconButton, Kicker, Press, Row, Segmented, T, Tile } from '../../components/ui';
import { PUBS, beerById, formatDistance, pubById } from '../../mock/data';
import { toast, useMock } from '../../mock/store';
import { C, HAND_FONT, SCREEN_X, font, s } from '../../theme';

type Kind = 'pivo' | 'vino' | 'nealko' | 'panak';

type Option = { id: string; name: string; rating?: number; meta: string; badge?: string; fresh?: boolean };

const OTHER: Record<Exclude<Kind, 'pivo'>, Option[]> = {
  vino: [
    { id: 'vino-bile', name: 'Bílé víno', meta: '0,2 l · 65 Kč' },
    { id: 'vino-cervene', name: 'Červené víno', meta: '0,2 l · 70 Kč' },
  ],
  nealko: [
    { id: 'birell', name: 'Birell', meta: '0,5 l · 45 Kč' },
    { id: 'kofola', name: 'Kofola', meta: '0,5 l · 42 Kč' },
  ],
  panak: [
    { id: 'fernet', name: 'Fernet', meta: '4 cl · 60 Kč' },
    { id: 'slivovice', name: 'Slivovice', meta: '4 cl · 70 Kč' },
  ],
};

function BeerTile({ o, on, onPress }: { o: Option; on: boolean; onPress: () => void }) {
  return (
    <Press
      haptic
      onPress={onPress}
      accessibilityState={{ selected: on }}
      style={{
        flex: 1,
        height: 104,
        padding: 14,
        borderRadius: 20,
        justifyContent: 'space-between',
        backgroundColor: on ? C.white : C.card,
        borderWidth: 1,
        borderColor: on ? C.white : C.hairline,
      }}
    >
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <Icon name="beer" size={20} color={on ? C.black : C.yellow} />
        <View style={[s.row, { gap: 6 }]}>
          {o.badge ? (
            <View style={{ paddingHorizontal: 8, height: 22, borderRadius: 11, justifyContent: 'center', backgroundColor: on ? '#0A0A0A14' : C.control }}>
              <T s={11} w={700} c={on ? C.black : C.text2}>
                {o.badge}
              </T>
            </View>
          ) : null}
          {on ? (
            <View style={[{ width: 24, height: 24, borderRadius: 12, backgroundColor: C.black }, s.center]}>
              <Icon name="check" size={14} color={C.white} />
            </View>
          ) : null}
        </View>
      </View>
      <View style={{ gap: 4 }}>
        <T s={16} w={700} c={on ? C.black : C.white} numberOfLines={1}>
          {o.name}
        </T>
        <View style={[s.row, { gap: 6 }]}>
          {o.rating ? (
            <View style={[s.row, { height: 22, borderRadius: 11, paddingHorizontal: 7, gap: 3, backgroundColor: on ? '#0A0A0A14' : '#FFFFFF14' }]}>
              <Icon name="star" size={11} color={on ? C.black : C.yellow} fill={on ? C.black : C.yellow} />
              <T s={12} w={800} c={on ? C.black : C.white}>
                {o.rating.toFixed(1).replace('.', ',')}
              </T>
              <Icon name="chevron-right" size={10} color={on ? '#0A0A0A80' : C.muted} />
            </View>
          ) : null}
          <T s={12} w={500} c={on ? '#0A0A0A99' : C.muted} numberOfLines={1}>
            {o.meta}
          </T>
        </View>
      </View>
    </Press>
  );
}

function AddTile({ sub, onPress }: { sub: string; onPress: () => void }) {
  return (
    <Press haptic onPress={onPress} style={{ flex: 1, height: 104, padding: 14, borderRadius: 20, justifyContent: 'space-between', borderWidth: 1.5, borderColor: '#FFFFFF26' }}>
      <View style={[{ width: 26, height: 26, borderRadius: 13, backgroundColor: C.yellow }, s.center]}>
        <Icon name="plus" size={16} color={C.black} />
      </View>
      <View style={{ gap: 2 }}>
        <T s={16} w={700}>
          Přidat pivo
        </T>
        <T s={12} c={C.muted}>
          {sub}
        </T>
      </View>
    </Press>
  );
}

function SizeCard({ title, sub, on, onPress, icon }: { title: string; sub: string; on: boolean; onPress: () => void; icon?: boolean }) {
  return (
    <Press haptic onPress={onPress} style={[{ flex: 1, height: 56, borderRadius: 16, backgroundColor: on ? C.white : C.card, borderWidth: 1, borderColor: on ? C.white : C.hairline }, s.center]}>
      <T s={16} w={800} c={on ? C.black : C.white}>
        {title}
      </T>
      <View style={[s.row, { gap: 4 }]}>
        <T s={12} c={on ? '#0A0A0A99' : C.muted}>
          {sub}
        </T>
        {icon ? <Icon name="pencil" size={11} color={on ? '#0A0A0A99' : C.muted} /> : null}
      </View>
    </Press>
  );
}

export function ZapisSheet() {
  const router = useRouter();
  const { added } = useLocalSearchParams<{ added?: string }>();
  const st = useMock();
  const pub = pubById(st.pubId);
  const home = st.atHome;
  const [kind, setKind] = useState<Kind>('pivo');
  const [size, setSize] = useState(home ? 'lahvac' : '0,5 l');

  const beers: Option[] = home
    ? [
        { id: 'pilsner', name: 'Pilsner Urquell 12°', rating: 4.4, meta: 'lahváč · 2×' },
        { id: 'kozel', name: 'Kozel 11°', rating: 3.6, meta: 'plechovka' },
        { id: 'bernard', name: 'Bernard 11°', rating: 4.2, meta: 'lahváč · 2×' },
      ]
    : [
        { id: 'pilsner', name: 'Pilsner Urquell 12°', rating: added ? undefined : 4.4, meta: added ? 'na čepu · od 42 Kč' : 'od 42 Kč' },
        { id: 'kozel', name: 'Kozel 11°', rating: added ? undefined : 3.6, meta: added ? 'na čepu · 52 Kč' : '52 Kč', badge: 'minule tady' },
        { id: 'kozel-cerny', name: 'Kozel Černý', rating: added ? undefined : 3.9, meta: added ? 'na čepu · od 36 Kč' : 'od 36 Kč' },
        ...(added ? [{ id: 'bernard', name: 'Bernard 11°', meta: 'na čepu · 55 Kč', badge: 'nové', fresh: true }] : []),
      ];
  const list = kind === 'pivo' ? beers : OTHER[kind];
  const [sel, setSel] = useState(added ? 'bernard' : list[0].id);
  const selected = list.find((o) => o.id === sel) ?? list[0];

  const rows: Option[][] = [];
  const withAdd = [...list, { id: '__add', name: '', meta: '' }];
  for (let i = 0; i < withAdd.length; i += 2) rows.push(withAdd.slice(i, i + 2));

  const price = selected.id === 'bernard' ? 55 : size === '0,3 l' ? 42 : 59;
  const sizeLabel = home ? (size === 'lahvac' ? 'lahváč 0,5 l' : size === 'plech' ? 'plechovka 0,5 l' : 'PETka 0,33 l') : `čepované ${size}`;

  const save = () => {
    const beerKnown = !!beerById(selected.id);
    st.addDrink(beerKnown ? selected.id : 'pilsner', { size: home ? '0,5 l' : size, kind: home ? (size === 'plech' ? 'plechovka' : 'lahváč') : 'čepované', price: home ? 0 : price });
    if (selected.fresh || selected.id === 'bernard') st.set({ newBeerNudge: selected.id });
    router.back();
  };

  return (
    <Sheet
      title="Co si dáváš?"
      top={140}
      footer={<Button height={60} label="Zapsat pivo" sub={home ? `${selected.name} · ${sizeLabel}` : `${selected.name} · ${sizeLabel} · ${price} Kč`} onPress={save} />}
    >
      <Press onPress={() => router.push('/nv/zmenit-misto')} style={[s.row, { gap: 6, marginTop: -8 }]}>
        <Icon name={home ? 'house' : 'map-pin'} size={16} color={C.yellow} />
        <T s={15} w={700}>
          {home ? 'Doma / na chatě' : pub?.name}
        </T>
        <T s={15} c={C.muted}>
          · změnit
        </T>
      </Press>
      <Segmented
        height={40}
        options={[
          { key: 'pivo', label: 'Pivo' },
          { key: 'vino', label: 'Víno' },
          { key: 'nealko', label: 'Nealko' },
          { key: 'panak', label: 'Panák' },
        ]}
        value={kind}
        onChange={(k) => {
          setKind(k);
          setSel((k === 'pivo' ? beers : OTHER[k])[0].id);
        }}
      />
      <View style={{ gap: 10 }}>
        {rows.map((r, i) => (
          <View key={i} style={[s.row, { gap: 10 }]}>
            {r.map((o) =>
              o.id === '__add' ? (
                <AddTile key={o.id} sub={home ? 'lahváč, plechovka' : 'co tu chybí'} onPress={() => router.push('/nv/pridat-pivo')} />
              ) : (
                <BeerTile key={o.id} o={o} on={o.id === selected.id} onPress={() => setSel(o.id)} />
              ),
            )}
            {r.length === 1 ? <View style={s.fill} /> : null}
          </View>
        ))}
      </View>
      <View style={{ gap: 12 }}>
        <Kicker>{home ? 'Jak' : 'Kolik'}</Kicker>
        <View style={[s.row, { gap: 10 }]}>
          {home ? (
            <>
              <SizeCard title="Lahváč" sub="0,5 l" on={size === 'lahvac'} onPress={() => setSize('lahvac')} />
              <SizeCard title="Plechovka" sub="0,5 l" on={size === 'plech'} onPress={() => setSize('plech')} />
              <SizeCard title="Jinak" sub="PETka, 0,33 l" on={size === 'jinak'} onPress={() => setSize('jinak')} />
            </>
          ) : (
            <>
              <SizeCard title="0,3 l" sub={added ? 'cena?' : '42 Kč'} on={size === '0,3 l'} onPress={() => setSize('0,3 l')} />
              <SizeCard title="0,5 l" sub={`${price} Kč`} icon={!!added} on={size === '0,5 l'} onPress={() => setSize('0,5 l')} />
            </>
          )}
        </View>
      </View>
      {added && selected.fresh ? (
        <View style={[s.row, { gap: 10 }]}>
          <Icon name="list-plus" size={18} color={C.yellow} />
          <T s={14} c={C.text2}>{`${selected.name} přidám na lístek ${pub?.name}.`}</T>
        </View>
      ) : null}
    </Sheet>
  );
}

export function PridatPivoSheet() {
  const router = useRouter();
  const home = useMock((st) => st.atHome);
  const [q, setQ] = useState('');
  const near = [
    ['bernard', 'Bernard 11°', 'Rodinný pivovar Bernard'],
    ['svijany', 'Svijany Máz 11°', 'Pivovar Svijany'],
    ['raptor', 'Matuška Raptor IPA 15°', 'Pivovar Matuška'],
  ];
  const often = home
    ? [
        ['budvar', 'Budvar 33', 'lahváč 0,5 l · v deníku 6×'],
        ['gambrinus', 'Gambrinus 10°', 'plechovka 0,5 l · v deníku 5×'],
        ['svijany', 'Svijany Máz 11°', 'PETka 1,5 l · v deníku 4×'],
        ['unetice', 'Únětické pivo 12°', 'lahváč 0,5 l · v deníku 3×'],
      ]
    : [
        ['unetice', 'Únětické pivo 12°', 'v deníku 14×'],
        ['budvar', 'Budvar 33', 'v deníku 6×'],
      ];
  const pick = (id: string) => router.replace({ pathname: '/nv/zapis', params: { added: id } });
  const match = (x: string[]) => !q || x[1].toLowerCase().includes(q.toLowerCase());
  return (
    <Sheet top={140} closeIcon={false} scroll>
      <View style={[s.row, { gap: 12, marginTop: -4 }]}>
        <IconButton icon="chevron-left" size={40} iconSize={18} onPress={() => router.back()} label="Zpět" />
        <D s={30}>Přidat pivo</D>
      </View>
      <View style={[s.row, { height: 52, borderRadius: 18, paddingHorizontal: 16, gap: 10, backgroundColor: C.control, borderWidth: 1, borderColor: '#FFFFFF14' }]}>
        <Icon name="search" size={18} color={C.text2} />
        <TextInput value={q} onChangeText={setQ} placeholder="Hledat pivo..." placeholderTextColor={C.muted} keyboardAppearance="dark" selectionColor={C.yellow} style={[font(16, 500), { flex: 1, padding: 0 }]} />
      </View>
      <Press onPress={() => router.push({ pathname: '/nv/vyfot', params: { mode: home ? 'etiketa' : 'tabule' } })} style={[s.row, { gap: 12, padding: 14, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.hairline }]}>
        <Tile icon="camera" color={C.black} bg={C.yellow} size={36} radius={18} />
        <View style={[s.fill, { gap: 2 }]}>
          <T s={16} w={700}>
            {home ? 'Vyfoť etiketu' : 'Vyfoť tabuli nebo lístek'}
          </T>
          <T s={13} c={C.muted}>
            {home ? 'poznám pivo i lahváč, nebo plechovku' : 'přečtu, co tu chybí'}
          </T>
        </View>
        <Icon name="chevron-right" size={18} color={C.muted} />
      </Press>
      {!home ? (
        <View style={{ gap: 4 }}>
          <Kicker>Čepují v okolí</Kicker>
          {near.filter(match).map((b, i, arr) => (
            <Row key={b[0]} last={i === arr.length - 1} leading={<Tile icon="beer" bg={C.control} radius={18} size={36} />} title={b[1]} titleWeight={700} sub={b[2]} trailing={<Icon name="plus" size={20} color={C.text2} />} onPress={() => pick(b[0])} />
          ))}
        </View>
      ) : null}
      <View style={{ gap: 4 }}>
        <Kicker>{home ? 'Tvoje lahváče a plechovky' : 'Piješ nejčastěji'}</Kicker>
        {often.filter(match).map((b, i, arr) => (
          <Row key={b[0]} last={i === arr.length - 1} leading={<Tile icon="beer" bg={C.control} radius={18} size={36} />} title={b[1]} titleWeight={700} sub={b[2]} trailing={<Icon name="plus" size={20} color={C.text2} />} onPress={() => pick(b[0])} />
        ))}
      </View>
    </Sheet>
  );
}

const BOARD = [
  ['Pilsner Urquell 12°', '59,-', false],
  ['Kozel 11°', '52,-', false],
  ['Kozel Černý', '48,-', false],
  ['Bernard 11°', '55,-', true],
  ['Svijany Máz 11°', '49,-', true],
] as const;

/** Mocked camera: the board or label is already recognized. */
export function VyfotScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const label = mode === 'etiketa';
  const [checked, setChecked] = useState([true, true]);
  const [kind, setKind] = useState<'lahvac' | 'plech'>('lahvac');
  const n = checked.filter(Boolean).length;
  return (
    <View style={{ flex: 1, backgroundColor: '#1A120B' }}>
      {label ? (
        <Image source={require('../../../../assets/newlook/bottle.jpg')} style={{ position: 'absolute', width: '100%', height: '100%' }} resizeMode="cover" />
      ) : (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, experimental_backgroundImage: 'radial-gradient(circle at 50% 35%, #3B2A18 0%, #140D07 70%)' }} />
      )}
      <View style={[s.row, { position: 'absolute', top: insets.top + 6, left: SCREEN_X, right: SCREEN_X, justifyContent: 'space-between' }]}>
        <IconButton icon="x" bg="#0A0A0A99" onPress={() => router.back()} label="Zavřít" />
        <View style={{ paddingHorizontal: 14, height: 32, borderRadius: 16, justifyContent: 'center', backgroundColor: '#0A0A0A99' }}>
          <T s={13} w={700}>
            {label ? 'Vyfoť etiketu' : 'Vyfoť tabuli nebo lístek'}
          </T>
        </View>
        <View style={{ width: 44 }} />
      </View>
      {label ? (
        <View style={{ position: 'absolute', left: '32%', width: '38%', top: '42%', height: '27%', borderRadius: 18, borderWidth: 3, borderColor: C.yellow }} />
      ) : (
        <Animated.View entering={FadeIn.duration(500)} style={{ position: 'absolute', top: insets.top + 120, left: 14, right: 22, transform: [{ rotate: '-3deg' }] }}>
          <View style={{ backgroundColor: '#1D2A22', borderRadius: 10, borderWidth: 10, borderColor: '#6B4A2B', paddingVertical: 18, paddingHorizontal: 18, gap: 10 }}>
            <T style={{ fontFamily: HAND_FONT, fontSize: 32, color: '#F1EEE4', textAlign: 'center' }}>Na čepu</T>
            {BOARD.map(([name, price, missing]) => (
              <View key={name} style={[s.row, { justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }, missing && { borderWidth: 2, borderColor: C.yellow, backgroundColor: '#FFC40026' }]}>
                <T style={{ fontFamily: HAND_FONT, fontSize: 24, color: '#F1EEE4' }}>{name}</T>
                <T style={{ fontFamily: HAND_FONT, fontSize: 24, color: '#F1EEE4' }}>{price}</T>
              </View>
            ))}
          </View>
        </Animated.View>
      )}
      <View style={{ position: 'absolute', left: 10, right: 10, bottom: Math.max(insets.bottom, 12), backgroundColor: C.dialog, borderRadius: 28, padding: 20, gap: 14, borderWidth: 1, borderColor: '#FFFFFF14' }}>
        {label ? (
          <>
            <View style={{ gap: 4 }}>
              <Kicker>Poznal jsem</Kicker>
              <D s={28}>Bernard 11°</D>
            </View>
            <View style={[s.row, { gap: 10 }]}>
              <SizeCard title="Lahváč" sub="0,5 l" on={kind === 'lahvac'} onPress={() => setKind('lahvac')} />
              <SizeCard title="Plechovka" sub="0,5 l" on={kind === 'plech'} onPress={() => setKind('plech')} />
            </View>
            <Button
              height={58}
              label="Zapsat pivo"
              sub={`Bernard 11° · ${kind === 'lahvac' ? 'lahváč' : 'plechovka'} 0,5 l`}
              onPress={() => {
                useMock.getState().addDrink('bernard', { kind: kind === 'lahvac' ? 'lahváč' : 'plechovka', price: 0 });
                useMock.getState().set({ newBeerNudge: 'bernard' });
                router.dismissTo('/nv/stamgast');
              }}
            />
            <Press onPress={() => router.back()} style={{ alignItems: 'center' }}>
              <T s={14} w={700} c={C.text2}>
                Není to ono? Napiš ho
              </T>
            </Press>
          </>
        ) : (
          <>
            <View style={{ gap: 2 }}>
              <D s={26}>Na lístku tu chybí</D>
              <T s={13} c={C.muted}>
                Ostatní z tabule už tu mají.
              </T>
            </View>
            {[
              ['Bernard 11°', '0,5 l · 55 Kč'],
              ['Svijany Máz 11°', '0,5 l · 49 Kč'],
            ].map(([name, meta], i) => (
              <Press key={name} onPress={() => setChecked(checked.map((c, j) => (j === i ? !c : c)))} style={[s.row, { gap: 12, paddingVertical: 4 }]}>
                <View style={[{ width: 24, height: 24, borderRadius: 6, backgroundColor: checked[i] ? C.yellow : 'transparent', borderWidth: checked[i] ? 0 : 2, borderColor: C.muted }, s.center]}>
                  {checked[i] ? <Icon name="check" size={16} color={C.black} /> : null}
                </View>
                <View style={{ gap: 2 }}>
                  <T s={15} w={700}>
                    {name}
                  </T>
                  <T s={12} c={C.muted}>
                    {meta}
                  </T>
                </View>
              </Press>
            ))}
            <Button
              label={n ? `Přidat ${n} ${n === 1 ? 'pivo' : 'piva'} na lístek` : 'Nic nepřidávat'}
              onPress={() => {
                toast({ kind: 'xp', title: 'Lístek doplněný!', icon: 'list-plus', xp: 10 });
                router.replace({ pathname: '/nv/zapis', params: { added: 'bernard' } });
              }}
            />
            <Press style={{ alignItems: 'center' }} onPress={() => setChecked([true, true])}>
              <T s={14} w={700} c={C.text2}>
                Vyfotit znovu
              </T>
            </Press>
          </>
        )}
      </View>
    </View>
  );
}

export function ZmenitMistoSheet() {
  const router = useRouter();
  const st = useMock();
  const near = [...PUBS].sort((a, b) => a.distance - b.distance).slice(0, 4);
  return (
    <Sheet title="Kde sedíš?" top={360}>
      <View>
        {near.map((p, i) => {
          const d = formatDistance(p.distance);
          const on = !st.atHome && st.pubId === p.id;
          return (
            <Row
              key={p.id}
              last={i === near.length - 1}
              leading={<Tile icon="map-pin" color={on ? C.black : C.yellow} bg={on ? C.yellow : C.control} />}
              title={p.name}
              sub={`${p.area} · ${d.value} ${d.unit}`}
              trailing={on ? <Icon name="check" size={18} color={C.yellow} /> : null}
              onPress={() => {
                st.set({ pubId: p.id, atHome: false, atFriend: null });
                router.back();
              }}
            />
          );
        })}
      </View>
      <Press
        onPress={() => {
          st.set({ atHome: true, atFriend: null });
          router.back();
        }}
        style={[s.row, { gap: 12, padding: 14, borderRadius: 20, backgroundColor: C.card }]}
      >
        <Tile icon="house" color={st.atHome ? C.black : C.yellow} bg={st.atHome ? C.yellow : C.control} />
        <View style={[s.fill, { gap: 2 }]}>
          <T s={16} w={700}>
            Doma / na chatě
          </T>
          <T s={13} c={C.muted}>
            lahváče, plechovky, bez hospody
          </T>
        </View>
      </Press>
    </Sheet>
  );
}
