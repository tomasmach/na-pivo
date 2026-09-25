describe('bundled release pagers', () => {
  async function noteIn(locale: 'cs' | 'en', version: string) {
    jest.resetModules();
    jest.doMock('@/i18n', () => ({
      locale,
      t: {
        whatsNew: {
          defaultTitle: locale === 'cs' ? 'Co je nového' : "What's new",
          fixed211: {
            slide1Title: locale === 'cs' ? 'Mapa na Androidu je opravená' : 'The Android map is fixed',
            slide2Title: locale === 'cs' ? 'Vyhledávání hospod je zpátky' : 'Pub search is back',
            slide3Title: locale === 'cs' ? 'Pár oprav navíc' : 'A few more fixes',
          },
        },
      },
    }));
    const { localReleaseNote } = await import('../localReleaseNote');
    return localReleaseNote(version);
  }

  afterEach(() => jest.dontMock('@/i18n'));

  it.each(['cs', 'en'] as const)('bundles 2.1.1 for %s with a readable summary', async (locale) => {
    const note = await noteIn(locale, '2.1.1');
    expect(note).toMatchObject({ version: '2.1.1', pager: true });
    if (!note) throw new Error('Missing bundled 2.1.1 note');
    expect(note.items.map((item: { text: string }) => item.text)).toHaveLength(3);
    expect(note.items.every((item: { text: string }) => item.text.length > 0)).toBe(true);
  });

  it('keeps the 2.1.0 apology Czech-only', async () => {
    expect(await noteIn('cs', '2.1.0')).toMatchObject({ version: '2.1.0', pager: true });
    expect(await noteIn('en', '2.1.0')).toBeNull();
  });
});
