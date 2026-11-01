import React, { useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomFade, TabHeader, useTabBarSpace } from '../../components/chrome';
import { Ticket } from '../../components/forms';
import { Icon, type IconName } from '../../components/Icon';
import { Button, Card, IconButton, Person, Press, Row, SectionTitle, Stack, T, Tile, Toggle } from '../../components/ui';
import { FRIENDS, friendById, pubById, type Plan, type PlanResponse } from '../../mock/data';
import { dialog, toast, useMock } from '../../mock/store';
import { C, SCREEN_X, s } from '../../theme';

const RSVP: { key: Exclude<PlanResponse, null>; label: string; icon: IconName }[] = [
  { key: 'jdu', label: 'Jdu', icon: 'check' },
  { key: 'mozna', label: 'Možná', icon: 'circle-question-mark' },
  { key: 'nemuzu', label: 'Nemůžu', icon: 'x' },
];

export function RsvpRow({ plan, dark }: { plan: Plan; dark?: boolean }) {
  const respond = useMock((st) => st.respond);
  return (
    <View style={[s.row, { gap: 6 }]}>
      {RSVP.map((r) => (
        <Press
          key={r.key}
          haptic
          onPress={() => {
            respond(plan.id, r.key);
            if (r.key === 'jdu') toast({ kind: 'saved', title: `Jdeš. ${friendById(plan.fromId)?.name} o tom ví.`, icon: 'check' });
          }}
          style={[s.fill, s.row, { height: 40, borderRadius: 20, justifyContent: 'center', gap: 6, backgroundColor: dark ? C.control : '#0A0A0A1A' }]}
        >
          <Icon name={r.icon} size={16} color={dark ? C.white : C.black} />
          <T s={15} w={700} c={dark ? C.white : C.black}>
            {r.label}
          </T>
        </Press>
      ))}
    </View>
  );
}

export function PlanStub({ plan }: { plan: Plan }) {
  const router = useRouter();
  const respond = useMock((st) => st.respond);
  if (plan.mine) {
    return (
      <View style={[s.row, { gap: 8, height: 40, paddingHorizontal: 4 }]}>
        <Icon name="users" size={16} color={C.muted} />
        <T s={14} w={600} c={C.text2}>
          Pozvaná celá parta, 5 lidí
        </T>
      </View>
    );
  }
  if (!plan.my) return <RsvpRow plan={plan} />;
  if (plan.my === 'jdu') {
    return (
      <View style={[s.row, { height: 40, gap: 10, paddingHorizontal: 4 }]}>
        <Icon name="circle-check" size={18} color={C.yellow} />
        <T s={15} w={700} style={s.fill}>{`Jdeš. ${friendById(plan.fromId)?.name} o tom ví.`}</T>
        <Press onPress={() => respond(plan.id, null)} hitSlop={8}>
          <T s={14} w={600} c={C.text2}>
            Změnit
          </T>
        </Press>
      </View>
    );
  }
  return (
    <Press onPress={() => router.push({ pathname: '/nv/plan/[id]', params: { id: plan.id } })} style={[s.row, { height: 40, gap: 10, paddingHorizontal: 4 }]}>
      <Icon name={plan.my === 'mozna' ? 'circle-question-mark' : 'circle-x'} size={18} color={C.muted} />
      <T s={15} w={700} c={C.text2} style={s.fill}>
        {plan.my === 'mozna' ? 'Možná dorazíš.' : 'Tentokrát ne.'}
      </T>
      <T s={14} w={600} c={C.text2}>
        Změnit
      </T>
    </Press>
  );
}

function GoingStub({ plan }: { plan: Plan }) {
  return (
    <View style={[s.row, { gap: 10, height: 40 }]}>
      <Stack initials={plan.going} />
      <T s={14} w={600} c={C.text2} style={s.fill}>{`${plan.going.length} jdou`}</T>
      {plan.my === 'jdu' ? (
        <View style={[s.row, { height: 30, borderRadius: 15, paddingHorizontal: 12, gap: 6, backgroundColor: C.white }]}>
          <Icon name="check" size={15} color={C.black} />
          <T s={14} w={800} c={C.black}>
            Jdu
          </T>
        </View>
      ) : null}
    </View>
  );
}

export function PlanTicket({ plan, width, big }: { plan: Plan; width?: number; big?: boolean }) {
  const yellow = !plan.my && !plan.mine;
  return (
    <Ticket
      width={width}
      big={big}
      yellow={yellow}
      kicker={plan.mine ? 'Tvůj plán' : `Pozvánka od ${plan.from}`}
      kickerIcon={plan.home ? 'house' : 'beer'}
      dayNum={plan.dayNum}
      dayName={plan.dayName}
      time={plan.time}
      title={plan.place}
      quote={plan.note}
      stub={yellow || big || plan.mine ? <PlanStub plan={plan} /> : <GoingStub plan={plan} />}
    />
  );
}

function LiveRow({ name, sub, initial, last, onCinkni }: { name: string; sub: string; initial: string; last?: boolean; onCinkni: () => void }) {
  const [done, setDone] = useState(false);
  return (
    <Row
      last={last}
      height={66}
      leading={<Person initial={initial} />}
      title={name}
      titleWeight={700}
      sub={sub}
      trailing={
        <Press
          haptic
          onPress={() => {
            setDone(true);
            onCinkni();
          }}
          style={[s.row, { height: 34, borderRadius: 18, paddingHorizontal: 14, gap: 6, backgroundColor: done ? '#FFC40029' : C.card, borderWidth: 1, borderColor: done ? '#FFC40080' : C.hairline }]}
        >
          <Icon name="beer" size={16} color={C.yellow} />
          <T s={14} w={600} c={done ? C.yellow : C.white}>
            {done ? 'Cinknuto' : 'Cinknout'}
          </T>
        </Press>
      }
    />
  );
}

export function PartaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const { width } = useWindowDimensions();
  const st = useMock();
  const [page, setPage] = useState(0);
  const plans = st.plans;
  const ticketW = Math.min(300, width - SCREEN_X * 2 - 50);
  const live = FRIENDS.filter((f) => f.live);
  const cinkni = (name: string) => toast({ kind: 'saved', title: `Cinknuto!`, sub: `${name} ví, že ti chybí u stolu.`, icon: 'beer' });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: SCREEN_X, gap: 20, paddingBottom: tabSpace + 30 }}>
        <TabHeader title="Parta">
          <IconButton icon="qr-code" iconSize={20} onPress={() => router.push('/nv/pozvanka-do-party')} label="QR kód party" />
          <Button label="Přidat" icon="user-plus" kind="raised" height={44} style={{ paddingHorizontal: 16 }} onPress={() => router.push('/nv/pozvanka-do-party')} />
        </TabHeader>
        <SectionTitle title="Pozvánky" action={plans.length ? 'Naplánovat' : undefined} onAction={() => router.push('/nv/nova-pozvanka')} />
        {plans.length ? (
          <View style={{ gap: 12 }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={ticketW + 12}
              decelerationRate="fast"
              style={{ marginHorizontal: -SCREEN_X }}
              contentContainerStyle={{ paddingHorizontal: SCREEN_X, gap: 12 }}
              onScroll={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / (ticketW + 12)))}
              scrollEventThrottle={32}
            >
              {plans.map((p) => (
                <Press key={p.id} onPress={() => router.push({ pathname: '/nv/plan/[id]', params: { id: p.id } })}>
                  <PlanTicket plan={p} width={ticketW} />
                </Press>
              ))}
              <Press onPress={() => router.push('/nv/nova-pozvanka')} style={[{ width: ticketW, minHeight: 242, borderRadius: 24, borderWidth: 1.5, borderColor: '#FFFFFF26', gap: 10 }, s.center]}>
                <View style={[{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.control }, s.center]}>
                  <Icon name="plus" size={20} />
                </View>
                <T s={16} w={700}>
                  Nová pozvánka
                </T>
              </Press>
            </ScrollView>
            <View style={[s.row, { justifyContent: 'center', gap: 6 }]}>
              {[...plans, null].map((_, i) => (
                <View key={i} style={{ width: i === page ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i === page ? C.white : '#FFFFFF40' }} />
              ))}
            </View>
          </View>
        ) : (
          <View style={{ padding: 20, gap: 8, borderRadius: 24, borderWidth: 1.5, borderColor: '#FFFFFF26' }}>
            <T s={18} w={700}>
              Nic v plánu
            </T>
            <T s={14} c={C.muted} lh={1.4}>
              Pozvi partu do hospody nebo k sobě. Pozvánka může být klidně na příští pátek.
            </T>
            <Button label="Nová pozvánka" icon="plus" kind="raised" height={42} style={{ alignSelf: 'flex-start', marginTop: 8 }} onPress={() => router.push('/nv/nova-pozvanka')} />
          </View>
        )}
        <SectionTitle title="Teď venku" action={`${live.length + (st.visibleToParta ? 1 : 0)} z 5`} />
        <Card>
          <Row
            height={66}
            leading={<Person initial="T" />}
            title="Ty"
            titleWeight={700}
            sub={st.visibleToParta ? `${pubById(st.pubId)?.name} · parta tě vidí` : 'Jsi neviditelný'}
            onPress={() =>
              dialog({
                title: 'Svolat partu?',
                body: `Všem šesti pípne, že sedíš ${pubById(st.pubId)?.name} a máš volné místo u stolu.`,
                actions: [{ label: 'Zpátky' }, { label: 'Svolat', kind: 'primary', onPress: () => toast({ kind: 'saved', title: 'Parta svolaná.', sub: 'Pípnul jsem všem šesti.', icon: 'megaphone' }) }],
              })
            }
            trailing={<Toggle value={st.visibleToParta} onChange={st.setVisible} />}
          />
          {live.map((f, i) => (
            <LiveRow
              key={f.id}
              last={i === live.length - 1}
              initial={f.initial}
              name={f.id === 'klara' ? 'Klára na čepu' : 'Marek štamgast'}
              sub={`${pubById(f.live?.pubId)?.name} · ${f.live?.beers} ${f.live?.beers === 1 ? 'pivo' : 'piva'}`}
              onCinkni={() => cinkni(f.name)}
            />
          ))}
        </Card>
        {st.partaRequest ? (
          <View style={{ paddingHorizontal: 16, borderRadius: 24, borderWidth: 1, borderColor: C.hairline }}>
            <Row
              last
              leading={<Person initial="S" ring={false} />}
              title="Soňa chce do party"
              titleWeight={700}
              sub="@SonaPivniMapa"
              trailing={
                <View style={[s.row, { gap: 8 }]}>
                  <IconButton icon="x" size={36} iconSize={16} label="Odmítnout" onPress={() => st.set({ partaRequest: false })} />
                  <IconButton
                    icon="check"
                    size={36}
                    iconSize={16}
                    bg={C.white}
                    color={C.black}
                    label="Přijmout"
                    onPress={() => {
                      st.set({ partaRequest: false });
                      toast({ kind: 'saved', title: 'Soňa je v partě.', icon: 'user-plus' });
                    }}
                  />
                </View>
              }
            />
          </View>
        ) : null}
        <SectionTitle title="Celá parta" action="5" onAction={() => router.push('/nv/sprava-party')} />
        <Card>
          {FRIENDS.filter((f) => !f.live).map((f, i, arr) => (
            <Row
              key={f.id}
              last={i === arr.length - 1}
              leading={<Person initial={f.initial} />}
              title={f.name}
              sub={f.lastSeen}
              chevron
              onPress={() => router.push({ pathname: '/nv/kamos/[id]', params: { id: f.id } })}
            />
          ))}
        </Card>
        <Card>
          <Row
            last
            height={72}
            leading={<Tile icon="house" size={46} radius={14} />}
            title="Pivo u někoho v okolí"
            titleWeight={700}
            sub="Komorní setkání s cizími lidmi"
            chevron
            onPress={() => router.push('/nv/pivo-u-nekoho')}
          />
        </Card>
      </ScrollView>
      <BottomFade height={tabSpace + 40} />
    </View>
  );
}
