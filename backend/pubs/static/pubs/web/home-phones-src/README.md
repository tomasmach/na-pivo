# Phones on the home page

`phones.html` draws the two phones of the home page hero on a 720 × 740 canvas, with the web's own
fonts (`../sofia-sans*.woff2`) and the `np.css` colours. Positions and sizes are measured from the
landing mock (`docs/plans/2026-11-03-web-v-djangu/landing.webp`); its Pencil source is not in the repo,
so this page is the source of the picture now.

The page serves `home-phones-720.*` (720 × 740) for 1x screens and `home-phones.*` (1440 × 1480) for 2x.

To change the picture:

1. Edit `phones.html` (coordinates in 1x CSS px).
2. Render it in 1x and 2x with the Playwright snippet in `render.js` (set `DIR` first). Headless Chrome
   from the command line hung on this Mac, the Playwright MCP tool `browser_run_code_unsafe` worked.
3. Run `./build.sh`. It writes the four images into `..`; delete `r1.png` and `r2.png` afterwards.
4. Look at the home page at 1440 px with device pixel ratio 2 and at 390 px before committing.
