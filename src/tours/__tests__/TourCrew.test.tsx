import { fireEvent, render } from '@testing-library/react-native';
import { t } from '@/i18n';
import { TourCrewRow, TourCrewSheet, type CrewPingView } from '../TourCrew';
import type { CrewMember, TourCrew, TourRun } from '../model';

jest.mock('react-native-qrcode-svg', () => () => null);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('@/stores/toursStore', () => ({ useToursStore: { getState: () => ({ refreshCrew: jest.fn() }) } }));
jest.mock('@/components/shared/IconGlyph', () => ({ CheckIcon: () => null, XIcon: () => null }));
jest.mock('@/profile/Avatar', () => ({ Avatar: ({ nickname }: { nickname: string }) => {
  const { Text } = jest.requireActual('react-native');
  return <Text>{`avatar:${nickname}`}</Text>;
} }));

beforeEach(() => jest.clearAllMocks());

const crew: TourCrew = { runId: '6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab', publicId: '33333333-3333-4333-8333-333333333333', token: 'publicTokenForTests12', organizer: true };
const person = (nickname: string, left = false): CrewMember => ({ id: nickname, nickname, displayName: '', avatarUrl: null, left, completed: false });

it('shows the walker before the server answers and opens the code from the whole row', () => {
  const onInvite = jest.fn();
  const screen = render(<TourCrewRow crew={crew} self={person('vojta')} ping={false} onInvite={onInvite} onPing={jest.fn()} />);
  expect(screen.getByText('avatar:vojta', { includeHiddenElements: true })).toBeTruthy();
  fireEvent.press(screen.getByText(t.tours.crewAlone));
  expect(onInvite).toHaveBeenCalled();
});

it('names everyone who left and says plainly when joining did not work', () => {
  const screen = render(<TourCrewRow crew={{ ...crew, members: [person('vojta'), person('pepa', true), person('eva', true)] }} self={null} ping={false} onInvite={jest.fn()} onPing={jest.fn()} />);
  expect(screen.getByText(t.tours.crewNone)).toBeTruthy();
  expect(screen.getByText(t.tours.crewLeftMember(['pepa', 'eva']))).toBeTruthy();
  expect(t.tours.crewLeftMember(['pepa', 'eva'])).toContain('nejdou');

  screen.rerender(<TourCrewRow crew={{ ...crew, organizer: false, refused: true }} self={person('vojta')} ping={false} onInvite={jest.fn()} onPing={jest.fn()} />);
  expect(screen.getByText(t.tours.crewRefused)).toBeTruthy();
  expect(screen.queryByText(t.tours.crewInvite)).toBeNull();
});

const tourRun = (extra: Partial<TourRun> = {}): TourRun => ({
  id: 'run-1', planId: 'plan-1', startedAt: '2026-09-26T18:00:00.000Z', endedAt: null, statuses: { a: 'visited' },
  snapshot: { id: 'plan-1', title: 'Pivní okruh', scheduledDate: null, scheduledTime: null, timezone: 'Europe/Prague', stops: [], revision: 1, updatedAt: '' },
  ...extra,
});

it('offers the ping where there is no crew to invite, next to a refusal too, and says how it went', () => {
  const onPing = jest.fn();
  const onInvite = jest.fn();
  const screen = render(<TourCrewRow self={person('vojta')} ping pingStatus={t.tours.crewPingQueued} onInvite={onInvite} onPing={onPing} />);
  // A private tour can never get a crew, so the row talks about friends instead of "not yet".
  expect(screen.getByText(t.tours.crewPingFriends)).toBeTruthy();
  expect(screen.queryByText(t.tours.crewAlone)).toBeNull();
  expect(screen.getByText(t.tours.crewPingQueued)).toBeTruthy();
  fireEvent.press(screen.getByText(t.tours.crewPingShort));
  expect(onPing).toHaveBeenCalled();
  expect(onInvite).not.toHaveBeenCalled();
  screen.rerender(<TourCrewRow crew={{ ...crew, organizer: false, refused: true }} self={person('vojta')} ping onInvite={onInvite} onPing={onPing} />);
  expect(screen.getByText(t.tours.crewRefused)).toBeTruthy();
  expect(screen.getByText(t.tours.crewPingShort)).toBeTruthy();
  // A closed run takes no one new, but friends can still be told where it sits.
  screen.rerender(<TourCrewRow crew={{ ...crew, closed: true, members: [person('vojta'), person('pepa')] }} self={null} ping onInvite={onInvite} onPing={onPing} />);
  expect(screen.queryByText(t.tours.crewInviteMore)).toBeNull();
  expect(screen.getByText(t.tours.crewPing)).toBeTruthy();
  // While the QR still takes people, the row invites and leaves pinging to the sheet.
  screen.rerender(<TourCrewRow crew={crew} self={person('vojta')} ping pingStatus={t.tours.crewPingQueued} onInvite={onInvite} onPing={onPing} />);
  fireEvent.press(screen.getByText(t.tours.crewInvite));
  expect(onInvite).toHaveBeenCalled();
  expect(screen.queryByText(t.tours.crewPingQueued)).toBeNull();
});

it('lets friends who are not at the table be pinged from under the QR, or says why not', () => {
  const onPing = jest.fn();
  const run = tourRun({ crew: { ...crew, members: [person('vojta'), person('pepa')] } });
  const view = (state: CrewPingView['state']): CrewPingView => ({ note: t.tours.crewPingNote('U Pinkasů', false, true), state });
  const screen = render(<TourCrewSheet run={run} pingView={view(null)} onPing={onPing} onClose={jest.fn()} />);
  expect(screen.getByText(t.tours.crewSheetNote)).toBeTruthy();
  expect(screen.getByText(t.tours.crewPingAway)).toBeTruthy();
  expect(screen.getByText(t.tours.crewPingNote('U Pinkasů', false, true))).toBe(screen.getByText('Dám vědět, kde sedíte: U Pinkasů.'));
  fireEvent.press(screen.getByText(t.tours.crewPingThem));
  expect(onPing).toHaveBeenCalled();
  for (const [state, text] of [['sent', t.tours.crewPingSent], ['queued', t.tours.crewPingQueued], ['ghost', t.tours.crewPingGhost], ['allHere', t.tours.crewPingAllHere]] as const) {
    screen.rerender(<TourCrewSheet run={run} pingView={view(state)} onPing={onPing} onClose={jest.fn()} />);
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText(t.tours.crewPingThem)).toBeNull();
  }
  // Without anyone to ping the section stays out of the way.
  screen.rerender(<TourCrewSheet run={run} pingView={null} onPing={onPing} onClose={jest.fn()} />);
  expect(screen.queryByText(t.tours.crewPingAway)).toBeNull();
});
