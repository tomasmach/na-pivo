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
          v220: {
            slide1Title: locale === 'cs' ? 'Naplánuj tah po hospodách' : 'Plan a pub crawl',
            slide2Title: locale === 'cs' ? 'Každá hospoda má svou stránku' : 'Every pub has its own page',
            slide3Title: locale === 'cs' ? 'Parta u stolu' : 'Your crew at the table',
            slide4Title: locale === 'cs' ? 'Poslední spoj domů' : 'Last ride home',
          },
        },
      },
    }));
    const { localReleaseNote } = await import('../localReleaseNote');
    return localReleaseNote(version);
  }

  afterEach(() => jest.dontMock('@/i18n'));

  it.each([
    ['cs', '2.1.1', 3],
    ['en', '2.1.1', 3],
    ['cs', '2.2.0', 4],
    ['en', '2.2.0', 4],
  ] as const)('bundles %s %s with a readable summary', async (locale, version, cards) => {
    const note = await noteIn(locale, version);
    expect(note).toMatchObject({ version, pager: true });
    if (!note) throw new Error(`Missing bundled ${version} note`);
    expect(note.items.map((item: { text: string }) => item.text)).toHaveLength(cards);
    expect(note.items.every((item: { text: string }) => item.text.length > 0)).toBe(true);
  });

  it('keeps the 2.1.0 apology Czech-only', async () => {
    expect(await noteIn('cs', '2.1.0')).toMatchObject({ version: '2.1.0', pager: true });
    expect(await noteIn('en', '2.1.0')).toBeNull();
  });

  it('leaves other versions to the backend', async () => {
    expect(await noteIn('cs', '2.2.1')).toBeNull();
  });
});
