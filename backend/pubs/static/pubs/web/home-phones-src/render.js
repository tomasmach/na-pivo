// Playwright: renders phones.html at 720 x 740 CSS px in 1x and 2x into r1.png and r2.png next to it.
// Put the absolute path of this folder in DIR before running it.
async (page) => {
  const DIR = '/absolute/path/to/backend/pubs/static/pubs/web/home-phones-src';
  const browser = page.context().browser();
  for (const scale of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 720, height: 740 }, deviceScaleFactor: scale });
    const tab = await context.newPage();
    await tab.goto(`file://${DIR}/phones.html`);
    await tab.evaluate(() => document.fonts.ready);
    await tab.screenshot({ path: `${DIR}/r${scale}.png` });
    await context.close();
  }
  return 'ok';
}
