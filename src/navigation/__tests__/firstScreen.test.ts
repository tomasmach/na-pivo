import { afterFirstScreen, markFirstScreenShown, resetFirstScreenForTests } from '../firstScreen';

describe('afterFirstScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetFirstScreenForTests();
  });
  afterEach(() => jest.useRealTimers());

  it('waits for the first screen, then runs once', () => {
    const run = jest.fn();
    afterFirstScreen(run);
    expect(run).not.toHaveBeenCalled();

    markFirstScreenShown();
    markFirstScreenShown();
    jest.advanceTimersByTime(5000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs right away once the first screen has shown', () => {
    markFirstScreenShown();
    const run = jest.fn();
    afterFirstScreen(run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs after three seconds when no tab ever renders', () => {
    const run = jest.fn();
    afterFirstScreen(run);
    jest.advanceTimersByTime(2999);
    expect(run).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);

    markFirstScreenShown();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not run work cancelled before the first screen', () => {
    const run = jest.fn();
    const cancel = afterFirstScreen(run);
    cancel();
    markFirstScreenShown();
    jest.advanceTimersByTime(5000);
    expect(run).not.toHaveBeenCalled();
  });
});
