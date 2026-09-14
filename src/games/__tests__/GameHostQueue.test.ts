import { createGameCommandQueue } from '@/games/commandQueue';
import type { ToGame } from '@/games/protocol';

const command: ToGame = { v: 1, type: 'command', name: 'spin' };

describe('GameHost pre-ready command queue', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('holds a rapid first command until init has been delivered', () => {
    const post = jest.fn();
    const timeout = jest.fn();
    const queue = createGameCommandQueue(post, timeout, 1000);

    queue.send(command);
    expect(post).not.toHaveBeenCalled();
    queue.ready();

    expect(post).toHaveBeenCalledWith(command);
    expect(timeout).not.toHaveBeenCalled();
  });

  it('clears a dead command and reports a load timeout', () => {
    const post = jest.fn();
    const timeout = jest.fn();
    const queue = createGameCommandQueue(post, timeout, 1000);

    queue.send(command);
    jest.advanceTimersByTime(1000);
    queue.ready();

    expect(timeout).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });
});
