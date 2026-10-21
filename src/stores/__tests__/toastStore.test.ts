import { useToastStore, whenToastIsFree } from '@/stores/toastStore';

describe('whenToastIsFree', () => {
  beforeEach(() => useToastStore.getState().hide());

  it('shows right away when nothing is on screen', () => {
    const show = jest.fn();

    whenToastIsFree(show);

    expect(show).toHaveBeenCalledTimes(1);
  });

  it('waits for the toast on screen to leave instead of replacing it', () => {
    useToastStore.getState().show('Dvě piva server nepřijal.');
    const show = jest.fn();

    whenToastIsFree(show);
    expect(show).not.toHaveBeenCalled();
    useToastStore.getState().hide();

    expect(show).toHaveBeenCalledTimes(1);
  });
});
