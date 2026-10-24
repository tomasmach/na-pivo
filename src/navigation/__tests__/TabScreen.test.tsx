import React from 'react';
import { View } from 'react-native';
import { render as renderScreen } from '@testing-library/react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';
import { RouteScreen, TabScreen, TabsInsetsRoot, useBottomInset } from '@/navigation/TabScreen';

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('react-native-safe-area-context', () => {
  const { createContext, useContext } = jest.requireActual<typeof import('react')>('react');
  const SafeAreaInsetsContext = createContext(null);
  return { SafeAreaInsetsContext, useSafeAreaInsets: () => useContext(SafeAreaInsetsContext) };
});

const edges = (top: number, right: number, bottom: number, left: number): EdgeInsets => ({ top, right, bottom, left });
const NONE = edges(0, 0, 0, 0);

const seen = jest.fn();

function Probe() {
  seen({ insets: useSafeAreaInsets(), bottomInset: useBottomInset() });
  return null;
}

function render(element: React.ReactElement) {
  const { UNSAFE_root, unmount } = renderScreen(element);
  const { marginLeft, marginRight } = UNSAFE_root.findByType(View).props.style;
  unmount();
  return { marginLeft, marginRight, ...seen.mock.lastCall?.[0] };
}

/** A tab under the tab navigator: the device insets above it, the tab's own around it. */
function renderTab(device: EdgeInsets, tab: EdgeInsets) {
  return render(
    <SafeAreaInsetsContext.Provider value={device}>
      <TabsInsetsRoot>
        <SafeAreaInsetsContext.Provider value={tab}>
          <TabScreen>
            <Probe />
          </TabScreen>
        </SafeAreaInsetsContext.Provider>
      </TabsInsetsRoot>
    </SafeAreaInsetsContext.Provider>,
  );
}

describe('TabScreen', () => {
  it('leaves an iPhone tab full width and pads only for the tab bar', () => {
    expect(renderTab(edges(62, 0, 34, 0), edges(62, 0, 83, 0))).toEqual({
      marginLeft: 0,
      marginRight: 0,
      insets: edges(62, 0, 34, 0),
      bottomInset: 83,
    });
  });

  it('narrows the folded iPhone Duo tab by the column the rail shares with the camera', () => {
    expect(renderTab(edges(0, 84, 20, 0), edges(0, 84, 20, 0))).toMatchObject({
      marginLeft: 0,
      marginRight: 84,
      insets: edges(0, 0, 20, 0),
    });
  });

  it('takes the wider side when the rail reaches past the device inset', () => {
    expect(renderTab(edges(0, 84, 20, 0), edges(0, 88, 20, 0)).marginRight).toBe(88);
  });

  it('keeps the device side inset for a tab that has not been shown yet', () => {
    expect(renderTab(edges(0, 0, 20, 84), NONE)).toMatchObject({ marginLeft: 84, marginRight: 0 });
  });
});

describe('RouteScreen', () => {
  it('narrows a route by the side insets and hands the rest down', () => {
    expect(
      render(
        <SafeAreaInsetsContext.Provider value={edges(0, 84, 20, 0)}>
          <RouteScreen>
            <Probe />
          </RouteScreen>
        </SafeAreaInsetsContext.Provider>,
      ),
    ).toEqual({ marginLeft: 0, marginRight: 84, insets: edges(0, 0, 20, 0), bottomInset: 20 });
  });
});
