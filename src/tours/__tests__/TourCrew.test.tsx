import { act, fireEvent, render } from '@testing-library/react-native';
import { t } from '@/i18n';
import { TourCrewRow, TourCrewSheet, type CrewPingState } from '../TourCrew';
import { friendActivityState } from '@/data/friendsQueue';
import { sendPing } from '../crewPing';
import type { CrewMember, TourCrew, TourRun } from '../model';

jest.mock('react-native-qrcode-svg', () => () => null);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('@/stores/toursStore', () => ({ useToursStore: { getState: () => ({ refreshCrew: jest.fn() }) } }));
jest.mock('@/components/shared/IconGlyph', () => ({ CheckIcon: () => null, XIcon: () => null }));
jest.mock('../crewPing', () => ({ ...jest.requireActual('../crewPing'), sendPing: jest.fn() }));
jest.mock('@/data/friendsQueue', () => ({ friendActivityState: jest.fn(async () => 'queued') }));
jest.mock('@/profile/Avatar', () => ({ Avatar: ({ nickname }: { nickname: string }) => {
  const { Text } = jest.requireActual('react-native');
  return <Text>{`avatar:${nickname}`}</Text>;
} }));

beforeEach(() => jest.clearAllMocks());

const crew: TourCrew = { runId: '6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab', publicId: '33333333-3333-4333-8333-333333333333', token: 'publicTokenForTests12', organizer: true };
const person = (nickname: string, left = false): CrewMember => ({ id: nickname, nickname, displayName: '', avatarUrl: null, left, completed: false });

it('shows the walker before the server answers and opens the code from the whole row', () => {
  const onInvite = jest.fn();
  const screen = render(<TourCrewRow crew={crew} self={person('vojta')} ping={false} onOpen={onInvite} />);
  expect(screen.getByText('avatar:vojta', { includeHiddenElements: true })).toBeTruthy();
  fireEvent.press(screen.getByText(t.tours.crewAlone));
  expect(onInvite).toHaveBeenCalled();
});

it('names everyone who left and says plainly when joining did not work', () => {
  const screen = render(<TourCrewRow crew={{ ...crew, members: [person('vojta'), person('pepa', true), person('eva', true)] }} self={null} ping={false} onOpen={jest.fn()} />);
  expect(screen.getByText(t.tours.crewNone)).toBeTruthy();
  expect(screen.getByText(t.tours.crewLeftMember(['pepa', 'eva']))).toBeTruthy();
  expect(t.tours.crewLeftMember(['pepa', 'eva'])).toContain('nejdou');

  screen.rerender(<TourCrewRow crew={{ ...crew, organizer: false, refused: true }} self={person('vojta')} ping={false} onOpen={jest.fn()} />);
  expect(screen.getByText(t.tours.crewRefused)).toBeTruthy();
  expect(screen.queryByText(t.tours.crewInvite)).toBeNull();
});

const stop = (id: string, name: string) => ({ id, pubId: `canonical-${id}`, cacheKey: null, name, address: '', lat: 50.08, lon: 14.42 });
const tourRun = (extra: Partial<TourRun> = {}): TourRun => ({
  id: 'run-1', planId: 'plan-1', startedAt: '2026-09-26T18:00:00.000Z', endedAt: null, statuses: { a: 'visited' },
  snapshot: { id: 'plan-1', title: 'Pivní okruh', scheduledDate: null, scheduledTime: null, timezone: 'Europe/Prague', stops: [stop('a', 'U Pinkasů'), stop('b', 'U Medvídků')], revision: 1, updatedAt: '' },
  ...extra,
});

it('offers the ping where there is no crew to invite, next to a refusal too', () => {
  const onOpen = jest.fn();
  const screen = render(<TourCrewRow self={person('vojta')} ping onOpen={onOpen} />);
  // A private tour can never get a crew, so the row talks about friends instead of "not yet".
  expect(screen.getByText(t.tours.crewPingFriends)).toBeTruthy();
  expect(screen.queryByText(t.tours.crewAlone)).toBeNull();
  fireEvent.press(screen.getByText(t.tours.crewPingShort));
  expect(onOpen).toHaveBeenCalled();
  screen.rerender(<TourCrewRow crew={{ ...crew, organizer: false, refused: true }} self={person('vojta')} ping onOpen={onOpen} />);
  expect(screen.getByText(t.tours.crewRefused)).toBeTruthy();
  expect(screen.getByText(t.tours.crewPingShort)).toBeTruthy();
  // A closed run takes no one new, but friends can still be told where it sits.
  screen.rerender(<TourCrewRow crew={{ ...crew, closed: true, members: [person('vojta'), person('pepa')] }} self={null} ping onOpen={onOpen} />);
  expect(screen.queryByText(t.tours.crewInviteMore)).toBeNull();
  expect(screen.getByText(t.tours.crewPing)).toBeTruthy();
});

it('pings friends who are not at the table from under the QR and then says so', async () => {
  jest.mocked(sendPing).mockResolvedValue({ status: 'sent', clientId: 'c1' });
  const onPinged = jest.fn();
  const run = tourRun({ crew: { ...crew, members: [person('vojta'), person('pepa')] } });
  const friends = { ghost: false, ids: ['pepa', 'eva'] };
  const screen = render(<TourCrewSheet run={run} friends={friends} ping={null} onPinged={onPinged} onClose={jest.fn()} />);
  expect(screen.getByText(t.tours.crewSheetNote)).toBeTruthy();
  expect(screen.getByText(t.tours.crewPingAway)).toBeTruthy();
  expect(screen.getByText(t.tours.crewPingNote('U Pinkasů', false, true))).toBeTruthy();
  expect(t.tours.crewPingNote('U Pinkasů', false, true)).toContain('sedíte v hospodě U Pinkasů');
  await act(async () => { fireEvent.press(screen.getByText(t.tours.crewPingThem)); });
  // Pepa walks along, so only Eva hears about it.
  expect(sendPing).toHaveBeenCalledWith('Pivní okruh', { stop: run.snapshot.stops[0], heading: false }, ['eva']);
  const state: CrewPingState = { runId: 'run-1', stopId: 'a', status: 'sent', clientId: 'c1' };
  expect(onPinged).toHaveBeenCalledWith(state);
  screen.rerender(<TourCrewSheet run={run} friends={friends} ping={state} onPinged={onPinged} onClose={jest.fn()} />);
  expect(screen.getByText(t.tours.crewPingSent)).toBeTruthy();
  // At the next pub the button comes back and names the new pub.
  screen.rerender(<TourCrewSheet run={{ ...run, statuses: { a: 'visited', b: 'visited' } }} friends={friends} ping={state} onPinged={onPinged} onClose={jest.fn()} />);
  expect(screen.getByText(t.tours.crewPingNote('U Medvídků', false, true))).toBeTruthy();
  expect(screen.getByText(t.tours.crewPingThem)).toBeTruthy();
});

it('drops the QR without a crew and explains when a ping would go nowhere', () => {
  const screen = render(<TourCrewSheet run={tourRun({ statuses: {} })} friends={{ ghost: false, ids: ['eva'] }} ping={null} onPinged={jest.fn()} onClose={jest.fn()} />);
  expect(screen.queryByText(t.tours.crewSheetNote)).toBeNull();
  expect(screen.getByText(t.tours.crewPingNote('U Pinkasů', true, false))).toBeTruthy();
  expect(t.tours.crewPingNote('U Pinkasů', true, false)).toContain('míříš do hospody U Pinkasů');
  expect(screen.getByText(t.tours.crewPingShort)).toBeTruthy();
  screen.rerender(<TourCrewSheet run={tourRun()} friends={{ ghost: true, ids: ['eva'] }} ping={null} onPinged={jest.fn()} onClose={jest.fn()} />);
  expect(screen.getByText(t.tours.crewPingGhost)).toBeTruthy();
  screen.rerender(<TourCrewSheet run={tourRun({ crew: { ...crew, members: [person('vojta'), person('eva')] } })} friends={{ ghost: false, ids: ['eva'] }} ping={null} onPinged={jest.fn()} onClose={jest.fn()} />);
  expect(screen.getByText(t.tours.crewPingAllHere)).toBeTruthy();
});

it('says sent only when the waiting ping really went out', async () => {
  const onPinged = jest.fn();
  const queued: CrewPingState = { runId: 'run-1', stopId: 'a', status: 'queued', clientId: 'c1' };
  const sheet = () => <TourCrewSheet run={tourRun()} friends={{ ghost: false, ids: ['eva'] }} ping={{ ...queued }} onPinged={onPinged} onClose={jest.fn()} />;
  const screen = render(sheet());
  expect(screen.getByText(t.tours.crewPingQueued)).toBeTruthy();
  await act(async () => undefined);
  expect(onPinged).not.toHaveBeenCalled();
  jest.mocked(friendActivityState).mockResolvedValueOnce('sent');
  render(sheet());
  await act(async () => undefined);
  expect(onPinged).toHaveBeenLastCalledWith({ ...queued, status: 'sent' });
  // Rejected or cancelled while waiting: back to the button, never a false "sent".
  jest.mocked(friendActivityState).mockResolvedValueOnce('gone');
  render(sheet());
  await act(async () => undefined);
  expect(onPinged).toHaveBeenLastCalledWith(null);
});
