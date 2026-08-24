import { parseFromGame, parseToGame } from '@/games/protocol';

describe('parseFromGame', () => {
  it('accepts only complete protocol frames', () => {
    expect(parseFromGame('{"v":1,"type":"ready"}')).toEqual({ v: 1, type: 'ready' });
    expect(parseFromGame('{"v":1,"type":"error"}')).toBeNull();
    expect(parseFromGame('{"v":1,"type":"result","scores":{},"winnerId":7}')).toBeNull();
    expect(parseFromGame('{"v":1,"type":"event","name":9}')).toBeNull();
    expect(parseFromGame('{"v":1,"type":"state"}')).toBeNull();
  });

  it('rejects result frames with empty identity strings but keeps null and empty scores valid', () => {
    expect(
      parseFromGame('{"v":1,"type":"result","scores":[{"playerId":"a","score":1}],"winnerId":""}'),
    ).toBeNull();
    expect(
      parseFromGame(
        '{"v":1,"type":"result","scores":[{"playerId":"a","score":1}],"winnerId":null,"payingId":""}',
      ),
    ).toBeNull();
    expect(
      parseFromGame('{"v":1,"type":"result","scores":[{"playerId":"","score":1}],"winnerId":null}'),
    ).toBeNull();
    expect(
      parseFromGame(
        '{"v":1,"type":"result","scores":[],"winnerId":null,"payingId":null}',
      ),
    ).toEqual({ v: 1, type: 'result', scores: [], winnerId: null, payingId: null });
  });
});

describe('parseToGame', () => {
  it('rejects commands and init frames with malformed required fields', () => {
    expect(parseToGame('{"v":1,"type":"command","name":"spin"}')).toEqual({
      v: 1, type: 'command', name: 'spin', payload: undefined,
    });
    expect(parseToGame('{"v":1,"type":"command","name":3}')).toBeNull();
    expect(parseToGame('{"v":1,"type":"turn","playerId":""}')).toBeNull();
    expect(parseToGame('{"v":1,"type":"init","players":[],"theme":{}}')).toBeNull();
  });
});
