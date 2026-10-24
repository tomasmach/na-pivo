import { OUTSIDE_TABS, selectAnySheetOpen, useBookStore, type PageEntry } from '@/stores/bookStore';

const pub: PageEntry = {
  kind: 'pub',
  params: { key: 'u2fkbnpq', ref: 'u2fkbnpq|osm:1', name: 'U Tygra', lat: '50.08', lng: '14.42' },
};
const evening: PageEntry = { kind: 'evening', startedAt: '2026-10-22T19:40:00.000Z' };
const friend: PageEntry = { kind: 'friend', id: 'acc-1' };

const reset = () => useBookStore.setState(useBookStore.getInitialState(), true);

describe('bookStore', () => {
  beforeEach(reset);

  it('keeps a separate right-half stack per tab', () => {
    const book = useBookStore.getState();
    book.show('kompas', pub);
    book.show('stamgast', evening);
    book.push('stamgast', pub);

    expect(useBookStore.getState().pages).toEqual({
      kompas: [pub],
      stamgast: [evening, pub],
      parta: [],
      profil: [],
    });
  });

  it('show replaces the stack, push stacks, replace swaps the top, back pops', () => {
    const book = useBookStore.getState();
    book.push('parta', friend);
    book.push('parta', pub);
    book.show('parta', evening);
    expect(useBookStore.getState().pages.parta).toEqual([evening]);

    book.push('parta', friend);
    book.replace('parta', pub);
    expect(useBookStore.getState().pages.parta).toEqual([evening, pub]);

    book.back('parta');
    expect(useBookStore.getState().pages.parta).toEqual([evening]);
    book.back('parta');
    book.back('parta');
    expect(useBookStore.getState().pages.parta).toEqual([]);
  });

  it('clear empties one tab, clearAll every tab, setPages restores routes', () => {
    const book = useBookStore.getState();
    book.show('kompas', pub);
    book.show('profil', friend);
    book.clear('kompas');
    expect(useBookStore.getState().pages.kompas).toEqual([]);
    expect(useBookStore.getState().pages.profil).toEqual([friend]);

    book.setPages('kompas', [pub, friend]);
    expect(useBookStore.getState().pages.kompas).toEqual([pub, friend]);

    book.modalOpened('profil:secondary');
    book.clearAll();
    expect(useBookStore.getState().pages).toEqual(useBookStore.getInitialState().pages);
    // An open sheet is still open: its count belongs to the component, not to the account.
    expect(useBookStore.getState().openModals['profil:secondary']).toBe(1);
  });

  it('counts open sheets per half and never below zero', () => {
    const book = useBookStore.getState();
    book.modalOpened('stamgast:secondary');
    book.modalOpened('stamgast:secondary');
    book.modalOpened('kompas:primary');
    book.modalClosed('stamgast:secondary');
    expect(useBookStore.getState().openModals).toEqual({ 'stamgast:secondary': 1, 'kompas:primary': 1 });

    book.modalClosed('stamgast:secondary');
    book.modalClosed('stamgast:secondary');
    expect(useBookStore.getState().openModals['stamgast:secondary']).toBe(0);
  });

  it('knows when any sheet is open, in a tab or outside the tabs', () => {
    const book = useBookStore.getState();
    expect(selectAnySheetOpen(useBookStore.getState())).toBe(false);
    book.modalOpened(OUTSIDE_TABS);
    expect(selectAnySheetOpen(useBookStore.getState())).toBe(true);
    book.modalClosed(OUTSIDE_TABS);
    book.modalOpened('kompas:primary');
    expect(selectAnySheetOpen(useBookStore.getState())).toBe(true);
    book.modalClosed('kompas:primary');
    expect(selectAnySheetOpen(useBookStore.getState())).toBe(false);
  });
});
