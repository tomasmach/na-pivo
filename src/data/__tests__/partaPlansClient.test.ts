import { requestJson } from '../friendsClient';
import { parsePartaPlan, parsePlanDetail, updatePartaPlan } from '../partaPlansClient';

jest.mock('../friendsClient', () => ({ ...jest.requireActual('../friendsClient'), requestJson: jest.fn() }));

const base = {
  id: 'a1',
  account: { id: 'k', nickname: 'klara', display_name: 'Klára', avatar_url: null, is_public: true },
  cache_key: '',
  name: 'U @klara doma',
  kind: 'plan',
  scheduled_for: '2026-11-07T18:00:00Z',
  started_at: '2026-11-07T18:00:00Z',
  responses: { going: 1, maybe: 0, cant: 0, going_profiles: [] },
  my_response: null,
};

describe('partaPlansClient parsing', () => {
  it('reads a released plan payload as a pub plan with no address', () => {
    const plan = parsePartaPlan({ ...base, name: 'Lokál', cache_key: 'u2fkbn1z' });
    expect(plan).toMatchObject({ placeKind: 'pub', address: '', lat: null, isMine: false, inviteeCount: null });
  });

  it('reads the home place, address and people', () => {
    const detail = parsePlanDetail({
      ...base,
      place_kind: 'home',
      address: 'Bořivojova 54',
      is_mine: true,
      invitee_count: 4,
      people: {
        going: [{ id: 'j', nickname: 'jirka', display_name: '' }],
        silent: [{ id: 'p', nickname: 'petra', display_name: '' }, { nickname: 'no id' }],
        maybe_count: 2,
      },
      home: { started: true, present: [base.account], coming: [], my_checkin: false, can_check_in: true },
    });
    expect(detail?.plan).toMatchObject({ placeKind: 'home', address: 'Bořivojova 54', isMine: true, inviteeCount: 4 });
    expect(detail?.people.going.map((p) => p.nickname)).toEqual(['jirka']);
    expect(detail?.people.silent.map((p) => p.nickname)).toEqual(['petra']);
    expect(detail?.people.maybeCount).toBe(2);
    expect(detail?.home).toMatchObject({ started: true, canCheckIn: true, myCheckin: false });
  });

  it('rejects a row without an id', () => {
    expect(parsePartaPlan({ name: 'x' })).toBeNull();
  });
});

describe('updatePartaPlan', () => {
  it('sends an explicit null time so the plan runs from now', async () => {
    (requestJson as jest.Mock).mockResolvedValue({ ok: true, data: { ...base, kind: 'live', scheduled_for: null } });
    const res = await updatePartaPlan('a1', { placeKind: 'home', name: 'U mě', scheduledFor: null });
    expect(requestJson).toHaveBeenCalledWith('/v1/friends/pub-activity/a1', {
      method: 'PATCH',
      body: { place_kind: 'home', name: 'U mě', scheduled_for: null },
    });
    expect(res.ok && res.detail?.plan).toMatchObject({ kind: 'live', scheduledFor: null });
  });
});
