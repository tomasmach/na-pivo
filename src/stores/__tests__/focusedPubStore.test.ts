import AsyncStorage from '@react-native-async-storage/async-storage';

import { useFocusedPubStore } from '../focusedPubStore';
import { useWearableTargetStore } from '../wearableTargetStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

beforeEach(async () => {
  await AsyncStorage.clear();
  useFocusedPubStore.setState({ pub: null });
  useWearableTargetStore.getState().reset();
});

it('mirrors an explicit compass handoff to watches and clears it together', () => {
  const focused = {
    cacheKey: 'u2fkbn2c',
    name: 'U Zlatého tygra',
    lat: 50.08706,
    lng: 14.41786,
  };

  useFocusedPubStore.getState().setFocusedPub(focused);
  expect(useWearableTargetStore.getState().manualTarget).toEqual({
    pubKey: focused.cacheKey,
    name: focused.name,
    latitude: focused.lat,
    longitude: focused.lng,
  });

  useFocusedPubStore.getState().clear();
  expect(useWearableTargetStore.getState().manualTarget).toBeNull();
});
