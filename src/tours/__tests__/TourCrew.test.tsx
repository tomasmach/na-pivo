import { fireEvent, render } from '@testing-library/react-native';
import { t } from '@/i18n';
import { TourCrewRow } from '../TourCrew';
import type { CrewMember, TourCrew } from '../model';

jest.mock('react-native-qrcode-svg', () => () => null);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('@/stores/toursStore', () => ({ useToursStore: { getState: () => ({ refreshCrew: jest.fn() }) } }));
jest.mock('@/components/shared/IconGlyph', () => ({ XIcon: () => null }));
jest.mock('@/profile/Avatar', () => ({ Avatar: ({ nickname }: { nickname: string }) => {
  const { Text } = jest.requireActual('react-native');
  return <Text>{`avatar:${nickname}`}</Text>;
} }));

const crew: TourCrew = { runId: '6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab', publicId: '33333333-3333-4333-8333-333333333333', token: 'publicTokenForTests12', organizer: true };
const person = (nickname: string, left = false): CrewMember => ({ id: nickname, nickname, displayName: '', avatarUrl: null, left, completed: false });

it('shows the walker before the server answers and opens the code from the whole row', () => {
  const onInvite = jest.fn();
  const screen = render(<TourCrewRow crew={crew} self={person('vojta')} onInvite={onInvite} />);
  expect(screen.getByText('avatar:vojta', { includeHiddenElements: true })).toBeTruthy();
  fireEvent.press(screen.getByText(t.tours.crewAlone));
  expect(onInvite).toHaveBeenCalled();
});

it('names everyone who left and says plainly when joining did not work', () => {
  const screen = render(<TourCrewRow crew={{ ...crew, members: [person('vojta'), person('pepa', true), person('eva', true)] }} self={null} onInvite={jest.fn()} />);
  expect(screen.getByText(t.tours.crewNone)).toBeTruthy();
  expect(screen.getByText(t.tours.crewLeftMember(['pepa', 'eva']))).toBeTruthy();
  expect(t.tours.crewLeftMember(['pepa', 'eva'])).toContain('nejdou');

  screen.rerender(<TourCrewRow crew={{ ...crew, organizer: false, refused: true }} self={person('vojta')} onInvite={jest.fn()} />);
  expect(screen.getByText(t.tours.crewRefused)).toBeTruthy();
  expect(screen.queryByText(t.tours.crewInvite)).toBeNull();
});
