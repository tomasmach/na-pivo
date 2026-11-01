import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Input } from '../../components/forms';
import { Sheet } from '../../components/overlays';
import { Button, Row, T, Tile } from '../../components/ui';
import { pubById } from '../../mock/data';
import { dialog, toast, useMock } from '../../mock/store';
import { C } from '../../theme';

function reportDone() {
  const offline = useMock.getState().offline;
  toast(
    offline
      ? { kind: 'offline', title: 'Nahlášení je uložené.', sub: 'Pošlu ho, až bude signál.', icon: 'eye-off', at: 'bottom' }
      : { kind: 'saved', title: 'Nahlášeno.', sub: 'Mrknu na to.', icon: 'flag', at: 'bottom' },
  );
}

export function NesediSheet() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pub = pubById(id) ?? pubById('tygr')!;
  const report = () => {
    router.back();
    dialog({
      title: `Nahlásit „${pub.name}“?`,
      body: 'Nahlášení může hospodu skrýt i ostatním.',
      actions: [{ label: 'Zpátky' }, { label: 'Nahlásit', kind: 'danger', onPress: reportDone }],
    });
  };
  return (
    <Sheet title="Chybí nebo nesedí?" top={480} scroll={false}>
      <T s={16} c={C.text2} lh={1.4} style={{ marginTop: -8 }}>{`Přidej jinou hospodu, oprav „${pub.name}“, nebo nahlas problém.`}</T>
      <View style={{ gap: 0 }}>
        <Row leading={<Tile icon="pencil" color={C.white} size={36} radius={18} />} title="Opravit název" chevron onPress={() => router.replace({ pathname: '/nv/opravit-nazev', params: { id: pub.id } })} />
        <Row leading={<Tile icon="door-closed" color={C.white} size={36} radius={18} />} title="Hospoda už nefunguje" chevron onPress={report} />
        <Row leading={<Tile icon="ban" color={C.white} size={36} radius={18} />} title="Není to hospoda" chevron onPress={report} />
        <Row
          last
          leading={<Tile icon="plus" color={C.black} bg={C.yellow} size={36} radius={18} />}
          title="Přidat jinou hospodu"
          titleColor={C.yellow}
          titleWeight={700}
          chevron
          onPress={() => router.replace('/nv/pridat-hospodu')}
        />
      </View>
    </Sheet>
  );
}

export function OpravitNazevSheet() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pub = pubById(id) ?? pubById('tygr')!;
  const [name, setName] = useState(`Pivnice ${pub.name}`);
  return (
    <Sheet title="Jak se jmenuje?" top={560} scroll={false}>
      <T s={16} c={C.text2} lh={1.4} style={{ marginTop: -8 }}>{`Přejmenuju „${pub.name}“ i pro ostatní pivaře, když se oprava odešle.`}</T>
      <View style={{ gap: 8 }}>
        <T s={13} w={600} c={C.muted}>
          Nový název hospody
        </T>
        <Input value={name} onChangeText={setName} autoFocus />
      </View>
      <Button
        label="Uložit název"
        disabled={!name.trim()}
        onPress={() => {
          router.back();
          toast({ kind: 'xp', title: 'Díky za opravu!', icon: 'pencil', xp: 5 });
        }}
      />
    </Sheet>
  );
}
