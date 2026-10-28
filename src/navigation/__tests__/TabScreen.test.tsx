import React from 'react';
import { render as renderScreen } from '@testing-library/react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';
import { RouteScreen, TabScreen, TabsInsetsRoot, useBottomInset } from '@/navigation/TabScreen';

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('react-native-safe-area-context', () => {
  const { createContext, useContext } = jest.requireActual<typeof import('react')>('react');
  const SafeAreaInsetsContext = createContext(null);
  return {
    SafeAreaInsetsContext,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => useContext(SafeAreaInsetsContext),
  };
});

const edges = (top: number, right: number, bottom: number, left: number): EdgeInsets => ({ top, right, bottom, left });
const NONE = edges(0, 0, 0, 0);

const seen = jest.fn();

function Probe() {
  seen({ insets: useSafeAreaInsets(), bottomInset: useBottomInset() });
  return null;
}

async function render(element: React.ReactElement) {
  const { container, unmount } = await renderScreen(element);
  const { marginLeft, marginRight } = container.queryAll((node) => node.type === 'View')[0].props.style;
  await unmount();
  return { marginLeft, marginRight, ...seen.mock.lastCall?.[0] };
}

/** A tab under the tab navigator: the device insets above it, the tab's own around it. */
async function renderTab(device: EdgeInsets, tab: EdgeInsets) {
  return await render(
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
  it('leaves an iPhone tab full width and pads only for the tab bar', async () => {
    expect(await renderTab(edges(62, 0, 34, 0), edges(62, 0, 83, 0))).toEqual({
      marginLeft: 0,
      marginRight: 0,
      insets: edges(62, 0, 34, 0),
      bottomInset: 83,
    });
  });

  it('narrows the folded iPhone Duo tab by the column the rail shares with the camera', async () => {
    expect(await renderTab(edges(0, 84, 20, 0), edges(0, 84, 20, 0))).toMatchObject({
      marginLeft: 0,
      marginRight: 84,
      insets: edges(0, 0, 20, 0),
    });
  });

  it('takes the wider side when the rail reaches past the device inset', async () => {
    expect((await renderTab(edges(0, 84, 20, 0), edges(0, 88, 20, 0))).marginRight).toBe(88);
  });

  it('keeps the device side inset for a tab that has not been shown yet', async () => {
    expect(await renderTab(edges(0, 0, 20, 84), NONE)).toMatchObject({ marginLeft: 84, marginRight: 0 });
  });
});

describe('RouteScreen', () => {
  it('narrows a route by the side insets and hands the rest down', async () => {
    expect(
      await render(
        <SafeAreaInsetsContext.Provider value={edges(59, 84, 20, 0)}>
          <RouteScreen>
            <Probe />
          </RouteScreen>
        </SafeAreaInsetsContext.Provider>,
      ),
    ).toEqual({ marginLeft: 0, marginRight: 84, insets: edges(59, 0, 20, 0), bottomInset: 20 });
  });

  it('keeps a card header clear of the card edge, which has no top inset', async () => {
    expect(
      await render(
        <SafeAreaInsetsContext.Provider value={edges(0, 0, 34, 0)}>
          <RouteScreen>
            <Probe />
          </RouteScreen>
        </SafeAreaInsetsContext.Provider>,
      ),
    ).toEqual({ marginLeft: 0, marginRight: 0, insets: edges(12, 0, 34, 0), bottomInset: 34 });
  });
});
