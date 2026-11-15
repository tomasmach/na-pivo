import React from 'react';
import { act, create } from 'react-test-renderer';

import { NvMap, type MapPin } from '../NvMap';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MapProps = Record<string, (...args: unknown[]) => void>;
const mockMap: { props: MapProps | null } = { props: null };
jest.mock('react-native-maps', () => {
  const ReactLib = jest.requireActual('react');
  const MapView = ReactLib.forwardRef((props: MapProps, ref: unknown) => {
    mockMap.props = props;
    ReactLib.useImperativeHandle(ref, () => ({ setCamera: () => undefined, animateToRegion: () => undefined }));
    return null;
  });
  return { __esModule: true, default: MapView, Marker: () => null, Polyline: () => null, PROVIDER_GOOGLE: 'google' };
});
jest.mock('@/newlook/motion', () => ({ DURATION: { base: 220 }, EASE_ENTER: { factory: () => (x: number) => x } }));
jest.mock('@/newlook/components/ui', () => ({ Person: () => null, T: () => null }));
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('@/newlook/components/Icon', () => ({ Icon: () => null }));
const mockSeen = jest.fn();
jest.mock('@/data/pubReachClient', () => ({ trackPinsSeen: (keys: string[]) => mockSeen(keys) }));

const pin = (id: string, lat: number, lng: number): MapPin => ({ key: id, id, lat, lng, label: null, beers: 0 });
const PINS = [pin('a', 50.08, 14.42), pin('b', 50.0802, 14.4202)];
const region = (delta: number) => ({ latitude: 50.0801, longitude: 14.4201, latitudeDelta: delta, longitudeDelta: delta });

describe('NvMap pins seen', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('counts pubs that a quick zoom leaves as their own pins once the map stops', () => {
    act(() => {
      create(<NvMap pins={PINS} me={null} target={null} friends={[]} cities={[]} view="okoli" />);
    });
    act(() => {
      mockMap.props?.onLayout({ nativeEvent: { layout: { width: 390, height: 800 } } });
      mockMap.props?.onMapReady();
    });
    act(() => mockMap.props?.onRegionChange(region(0.2)));
    mockSeen.mockClear();
    act(() => mockMap.props?.onRegionChangeComplete(region(0.001), { isGesture: true }));
    act(() => jest.advanceTimersByTime(300));
    expect(mockSeen.mock.calls.flat(2)).toEqual(expect.arrayContaining(['a', 'b']));
  });
});
