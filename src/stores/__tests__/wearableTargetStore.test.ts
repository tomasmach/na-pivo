import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  selectedWearableTarget,
  useWearableTargetStore,
} from '../wearableTargetStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const NEAREST = {
  pubKey: 'u2fkbn2c',
  name: 'U Zlatého tygra',
  latitude: 50.08706,
  longitude: 14.41786,
};
const MANUAL = {
  pubKey: 'u2fkbn8k',
  name: 'Lokál Dlouhááá',
  latitude: 50.09016,
  longitude: 14.42537,
};

beforeEach(async () => {
  await AsyncStorage.clear();
  useWearableTargetStore.getState().reset();
});

it('keeps the explicit phone/watch target ahead of automatic nearest', () => {
  useWearableTargetStore.getState().setNearbySnapshot(NEAREST, [NEAREST]);
  expect(selectedWearableTarget()).toEqual({ selection: 'nearest', pub: NEAREST });

  useWearableTargetStore.getState().setManualTarget(MANUAL);
  expect(selectedWearableTarget()).toEqual({ selection: 'manual', pub: MANUAL });

  useWearableTargetStore.getState().clearManualTarget();
  expect(selectedWearableTarget()).toEqual({ selection: 'nearest', pub: NEAREST });
});

it('stores only unique public pub candidates', () => {
  useWearableTargetStore
    .getState()
    .setNearbySnapshot(NEAREST, [NEAREST, MANUAL, MANUAL]);

  expect(useWearableTargetStore.getState().nearbyPubs).toEqual([NEAREST, MANUAL]);
});
