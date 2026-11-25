import React, { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { BackHeader, Screen } from '../../components/chrome';
import { PageTitle } from '../../components/forms';
import { StatusCard } from '../../components/StatusCard';
import { Card, Row, Tile } from '../../components/ui';
import { useNvRouter } from '../../duo/details';
import { t } from '@/i18n';

import { loadMyRatedBeers, type MyRatedBeer } from './model';
import { Stars } from './PivaScreen';
import { Loading, type Load } from './states';

export function OhodnocenaPivaScreen() {
  const router = useNvRouter();
  const r = t.nv.piva.rated;
  const [state, setState] = useState<Load<MyRatedBeer[]>>({ status: 'loading' });

  const load = useCallback(() => {
    const controller = new AbortController();
    void loadMyRatedBeers(controller.signal).then((beers) => {
      if (controller.signal.aborted) return;
      setState((prev) => (beers ? { status: 'ready', data: beers } : prev.status === 'ready' ? prev : { status: 'error' }));
    });
    return () => controller.abort();
  }, []);
  useFocusEffect(load);

  const retry = () => {
    setState({ status: 'loading' });
    load();
  };

  return (
    <Screen header={<BackHeader />} gap={16}>
      <PageTitle title={r.title} />
      {state.status === 'loading' ? (
        <Loading />
      ) : state.status === 'error' ? (
        <StatusCard text={r.failed} action={t.nv.piva.retry} onAction={retry} />
      ) : state.data.length ? (
        <Card>
          {state.data.map((beer, i) => (
            <Row
              key={`${beer.beerName}|${beer.breweryName}`}
              last={i === state.data.length - 1}
              leading={<Tile icon="beer" />}
              title={beer.beerName}
              titleWeight={700}
              sub={beer.breweryName || undefined}
              trailing={<Stars n={Math.round(beer.rating)} size={14} />}
              onPress={() => router.push({ pathname: '/nv/pivo/[id]', params: { id: beer.productKey ?? '-', name: beer.beerName, brewery: beer.breweryName } })}
            />
          ))}
        </Card>
      ) : (
        <StatusCard text={r.empty} action={t.nv.piva.findBeer} actionIcon="search" onAction={() => router.push('/nv/hledat-pivo')} />
      )}
    </Screen>
  );
}
