import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { nvBack } from '@/newlook/navigation';

import { pubInfoFromPub } from '@/components/amenities/pubInfoContext';
import { submitPubRename } from '@/components/amenities/pubRename';
import { enqueuePubReport } from '@/data/pubReportQueue';
import type { PubReportReason } from '@/data/pubReportsClient';
import type { Pub } from '@/data/pubs';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { t } from '@/i18n';
import { usePubStore } from '@/stores/pubStore';

import { Input } from '../../components/forms';
import { Sheet } from '../../components/overlays';
import { Button, Row, T, Tile } from '../../components/ui';
import { dialog, toast } from '../../ui/store';
import { C } from '../../theme';
import { nvPubParams, useKompasState } from './state';
import { useParamPub } from './usePubPage';

function report(pub: Pub, key: string, reason: PubReportReason) {
  const L = t.nv.kompas;
  // A pub without a provider id is hidden by its cell alone; an empty id would match other id-less results.
  if (pub.id) usePubStore.getState().addReportedPub(pub.id, key);
  else if (!usePubStore.getState().reportedCacheKeys.includes(key)) {
    usePubStore.setState((state) => ({ reportedCacheKeys: [...state.reportedCacheKeys, key] }));
  }
  const picked = useKompasState.getState().picked;
  if (picked && picked.lat === pub.lat && picked.lng === pub.lng) useKompasState.getState().pick(null);
  void enqueuePubReport(pub, reason).then((sent) =>
    toast(
      sent
        ? { kind: 'saved', title: L.reported, sub: L.reportedSub, icon: 'flag', at: 'bottom' }
        : { kind: 'offline', title: L.reportQueued, sub: L.reportQueuedSub, icon: 'eye-off', at: 'bottom' },
    ),
  );
}

export function NesediSheet() {
  const router = useRouter();
  const L = t.nv.kompas;
  const { key, pub } = useParamPub();
  if (!pub) return null;
  const ask = (reason: PubReportReason) => {
    nvBack(router);
    dialog({
      title: L.reportConfirmTitle(pub.name),
      body: L.reportConfirmBody,
      actions: [{ label: L.reportBack }, { label: L.report, kind: 'danger', onPress: () => report(pub, key, reason) }],
    });
  };
  return (
    <Sheet title={L.wrongTitle} top={480} scroll={false}>
      <T s={16} c={C.text2} lh={1.4} style={{ marginTop: -8 }}>
        {L.wrongBody(pub.name)}
      </T>
      <View style={{ gap: 0 }}>
        <Row
          leading={<Tile icon="pencil" color={C.white} size={36} radius={18} />}
          title={L.rename}
          chevron
          onPress={() => {
            trackUiInteraction('compass_rename_open');
            router.replace({ pathname: '/nv/opravit-nazev', params: nvPubParams(pub) });
          }}
        />
        <Row leading={<Tile icon="door-closed" color={C.white} size={36} radius={18} />} title={L.reportClosed} chevron onPress={() => ask('closed')} />
        <Row leading={<Tile icon="ban" color={C.white} size={36} radius={18} />} title={L.reportNotPub} chevron onPress={() => ask('not_pub')} />
        <Row
          last
          leading={<Tile icon="plus" color={C.black} bg={C.yellow} size={36} radius={18} />}
          title={L.addOtherPub}
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
  const L = t.nv.kompas;
  const { pub } = useParamPub();
  const [name, setName] = useState(pub?.name ?? '');
  if (!pub) return null;
  const next = name.trim().slice(0, 200);
  return (
    <Sheet title={L.renameTitle} top={560} scroll={false}>
      <T s={16} c={C.text2} lh={1.4} style={{ marginTop: -8 }}>
        {L.renameBody(pub.name)}
      </T>
      <View style={{ gap: 8 }}>
        <T s={13} w={600} c={C.muted}>
          {L.renameLabel}
        </T>
        <Input value={name} onChangeText={setName} autoFocus />
      </View>
      <Button
        label={L.renameSave}
        disabled={!next || next === pub.name.trim()}
        onPress={() => {
          nvBack(router);
          void submitPubRename(pubInfoFromPub(pub), pub.name, next).then((sent) =>
            toast(sent ? { kind: 'saved', title: L.renameThanks, icon: 'pencil' } : { kind: 'offline', title: L.renameThanks, sub: L.renameQueuedSub, icon: 'pencil' }),
          );
        }}
      />
    </Sheet>
  );
}
