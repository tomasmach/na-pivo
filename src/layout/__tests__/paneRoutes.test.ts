import { appRoutes, paneEntriesFromRoutes, type RouteLike } from '@/layout/paneRoutes';

const tabs = (active: string): RouteLike => ({
  name: '(tabs)',
  state: { index: ['index', 'beer', 'friends', 'profile'].indexOf(active), routes: [
    { name: 'index' },
    { name: 'beer' },
    { name: 'friends' },
    { name: 'profile' },
  ] },
});
const pubRoute: RouteLike = {
  name: 'pub',
  params: { key: 'u2fkbnh0', ref: 'u2fkbnh0|osm:1', name: 'U Tygra', lat: '50.08', lng: '14.42' },
};

describe('paneEntriesFromRoutes', () => {
  it('moves a pub, an evening and a friend above the tabs into the active tab', () => {
    expect(
      paneEntriesFromRoutes([
        tabs('beer'),
        { name: 'evening', params: { startedAt: 's1' } },
        pubRoute,
        { name: 'parta/[id]', params: { id: 'acc-1' } },
      ]),
    ).toEqual({
      tab: 'stamgast',
      underTabs: true,
      entries: [
        { kind: 'evening', startedAt: 's1' },
        {
          kind: 'pub',
          params: { key: 'u2fkbnh0', ref: 'u2fkbnh0|osm:1', name: 'U Tygra', lat: '50.08', lng: '14.42' },
        },
        { kind: 'friend', id: 'acc-1' },
      ],
    });
  });

  it.each([
    ['index', 'kompas'],
    ['friends', 'parta'],
    ['profile', 'profil'],
  ])('maps the %s tab to %s', (route, tab) => {
    expect(paneEntriesFromRoutes([tabs(route), pubRoute])?.tab).toBe(tab);
  });

  it('keeps a pub page without a hand-off ref, as a notification opens it', () => {
    const entries = paneEntriesFromRoutes([
      tabs('index'),
      { name: 'pub', params: { key: 'k', name: 'U Tygra', lat: '1', lng: '2' } },
    ])?.entries;
    expect(entries).toEqual([{ kind: 'pub', params: { key: 'k', name: 'U Tygra', lat: '1', lng: '2' } }]);
  });

  it('takes a cold-start stack without tabs underneath to the compass tab', () => {
    expect(paneEntriesFromRoutes([pubRoute])).toMatchObject({ tab: 'kompas', underTabs: false });
  });

  it('defaults to the compass while the tabs have no state yet', () => {
    expect(paneEntriesFromRoutes([{ name: '(tabs)' }, pubRoute])?.tab).toBe('kompas');
  });

  it.each([
    ['nothing above the tabs', [tabs('index')]],
    ['a full-window screen in front', [tabs('index'), { name: 'leaderboards' }, { name: 'parta/[id]', params: { id: 'a' } }]],
    ['a detail under a full-window screen', [tabs('index'), pubRoute, { name: 'settings' }]],
    ['a pub page without coordinates', [tabs('index'), { name: 'pub', params: { name: 'X' } }]],
    ['an evening without its start', [tabs('index'), { name: 'evening', params: {} }]],
    ['onboarding', [{ name: 'onboarding' }]],
  ] as [string, RouteLike[]][])('leaves the stack alone with %s', (_case, routes) => {
    expect(paneEntriesFromRoutes(routes)).toBeNull();
  });
});

describe('appRoutes', () => {
  it("unwraps Expo Router's root route to the app's stack", () => {
    const stack: RouteLike[] = [tabs('index'), pubRoute];
    expect(appRoutes([{ name: '__root', state: { routes: stack } }])).toBe(stack);
  });

  it('leaves a plain stack as it is', () => {
    const stack: RouteLike[] = [tabs('index'), pubRoute];
    expect(appRoutes(stack)).toBe(stack);
  });
});
