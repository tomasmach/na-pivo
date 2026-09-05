/** Shared static linocut table for the WebView and reduced-motion fallback. */
export const bottleTableSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 520" width="400" height="520">
  <!-- Oak pub table, top-down. Four flat-sawn planks, linocut B voice: stout ink cuts, amber second plate. -->

  <!-- Planks -->
  <rect x="0" y="0" width="98" height="520" fill="#4E3320"/>
  <rect x="98" y="0" width="105" height="520" fill="#452B1A"/>
  <rect x="203" y="0" width="94" height="520" fill="#3F2718"/>
  <rect x="297" y="0" width="103" height="520" fill="#4B301D"/>

  <!-- Elbow-worn patches near the long edges (two flat layers, no gradient) -->
  <g fill="#6A4628">
    <path d="M0 150 C30 140 52 168 40 210 C30 245 46 280 22 300 C10 310 0 300 0 300Z" fill-opacity="0.10"/>
    <path d="M0 170 C18 166 30 186 24 214 C18 240 28 268 12 284 C6 290 0 286 0 286Z" fill-opacity="0.08"/>
    <path d="M400 230 C372 224 350 256 364 296 C374 326 356 356 380 380 C390 390 400 384 400 384Z" fill-opacity="0.10"/>
    <path d="M400 250 C382 248 372 270 378 296 C382 320 372 344 388 362 C394 368 400 364 400 364Z" fill-opacity="0.08"/>
  </g>

  <!-- Plank 1 grain (x 0–98) -->
  <g fill="none" stroke-linecap="round">
    <path d="M22 0 C18 60 30 110 24 170 S10 300 20 380 S30 470 26 520" stroke="#2C1A0F" stroke-opacity="0.55" stroke-width="2"/>
    <path d="M62 130 C68 190 52 250 60 320 S72 430 64 520" stroke="#5B3B23" stroke-opacity="0.45" stroke-width="1.5"/>
    <path d="M78 0 C82 50 76 100 84 150 S80 260 86 340 S82 460 84 520" stroke="#2C1A0F" stroke-opacity="0.35" stroke-width="1.5"/>
    <!-- cathedral arches under the knot -->
    <path d="M36 182 C42 150 68 140 78 176" stroke="#2C1A0F" stroke-opacity="0.5" stroke-width="2"/>
    <path d="M30 206 C38 162 74 152 86 200" stroke="#2C1A0F" stroke-opacity="0.35" stroke-width="1.5"/>
    <!-- grain bending around the knot -->
    <path d="M40 30 C34 55 32 80 36 108 C38 118 44 126 50 132" stroke="#2C1A0F" stroke-opacity="0.45" stroke-width="1.5"/>
    <path d="M66 26 C72 52 74 80 70 108 C68 118 62 126 56 132" stroke="#2C1A0F" stroke-opacity="0.45" stroke-width="1.5"/>
  </g>
  <!-- Knot, plank 1 -->
  <ellipse cx="52" cy="84" rx="10" ry="15" fill="#2F1C10" stroke="#1F130B" stroke-width="2"/>
  <ellipse cx="53" cy="86" rx="4.5" ry="7" fill="#1F130B"/>
  <path d="M44 74 C48 80 48 92 45 98" fill="none" stroke="#5B3B23" stroke-opacity="0.5" stroke-width="1.2" stroke-linecap="round"/>

  <!-- Plank 2 grain (x 98–203), kept quiet toward the center -->
  <g fill="none" stroke-linecap="round">
    <path d="M112 0 C108 80 118 160 110 260 S116 420 112 520" stroke="#2E1B10" stroke-opacity="0.5" stroke-width="2"/>
    <path d="M190 0 C186 90 194 190 188 300 S192 450 190 520" stroke="#5A3A23" stroke-opacity="0.4" stroke-width="1.5"/>
    <path d="M150 0 C154 90 146 190 152 300 S148 450 150 520" stroke="#3A2314" stroke-opacity="0.45" stroke-width="1.5"/>
    <path d="M128 400 C136 380 166 376 176 402" stroke="#2E1B10" stroke-opacity="0.35" stroke-width="1.5"/>
    <path d="M122 428 C132 396 172 392 184 426" stroke="#2E1B10" stroke-opacity="0.25" stroke-width="1.5"/>
  </g>

  <!-- Plank 3 grain (x 203–297) -->
  <g fill="none" stroke-linecap="round">
    <path d="M216 0 C220 100 212 220 218 330 S214 470 216 520" stroke="#2A180E" stroke-opacity="0.5" stroke-width="2"/>
    <path d="M282 0 C278 60 288 150 280 250 S286 400 284 520" stroke="#573722" stroke-opacity="0.4" stroke-width="1.5"/>
    <path d="M250 0 C246 60 254 120 248 180" stroke="#2A180E" stroke-opacity="0.3" stroke-width="1.5"/>
    <path d="M232 92 C240 62 266 56 274 88" stroke="#2A180E" stroke-opacity="0.45" stroke-width="2"/>
    <path d="M226 116 C236 74 270 66 282 110" stroke="#2A180E" stroke-opacity="0.3" stroke-width="1.5"/>
    <path d="M234 470 C240 440 264 432 274 462" stroke="#2A180E" stroke-opacity="0.45" stroke-width="2"/>
    <path d="M228 492 C236 450 270 442 282 484" stroke="#2A180E" stroke-opacity="0.3" stroke-width="1.5"/>
  </g>

  <!-- Plank 4 grain (x 297–400) -->
  <g fill="none" stroke-linecap="round">
    <path d="M318 0 C314 90 326 180 320 280 S312 360 318 380" stroke="#2E1B10" stroke-opacity="0.5" stroke-width="2"/>
    <path d="M376 0 C382 60 370 150 378 250 S372 340 376 380" stroke="#5C3B24" stroke-opacity="0.45" stroke-width="1.5"/>
    <path d="M346 140 C350 200 342 260 348 320" stroke="#2E1B10" stroke-opacity="0.3" stroke-width="1.5"/>
    <path d="M322 62 C332 32 362 26 372 58" stroke="#2E1B10" stroke-opacity="0.5" stroke-width="2"/>
    <path d="M316 82 C328 42 366 34 380 74" stroke="#2E1B10" stroke-opacity="0.35" stroke-width="1.5"/>
    <!-- grain bending around the lower knot -->
    <path d="M334 380 C330 410 328 450 336 486 C338 496 344 506 348 520" stroke="#2E1B10" stroke-opacity="0.45" stroke-width="1.5"/>
    <path d="M370 380 C376 410 378 450 368 486 C366 496 360 506 356 520" stroke="#2E1B10" stroke-opacity="0.45" stroke-width="1.5"/>
  </g>
  <!-- Knot, plank 4 -->
  <ellipse cx="352" cy="432" rx="11" ry="16" fill="#2F1C10" stroke="#1F130B" stroke-width="2"/>
  <ellipse cx="351" cy="434" rx="5" ry="7.5" fill="#1F130B"/>
  <path d="M360 422 C356 428 356 440 359 446" fill="none" stroke="#5C3B24" stroke-opacity="0.5" stroke-width="1.2" stroke-linecap="round"/>

  <!-- Seams between planks: dark gap, one worn highlight edge -->
  <g>
    <rect x="96" y="0" width="4" height="520" fill="#1B120C"/>
    <rect x="201" y="0" width="4" height="520" fill="#1B120C"/>
    <rect x="295" y="0" width="4" height="520" fill="#1B120C"/>
    <path d="M94.5 0 V520 M199.5 0 V520 M293.5 0 V520" stroke="#6A4628" stroke-opacity="0.35" stroke-width="1.5"/>
    <path d="M101 0 V520 M206 0 V520 M300 0 V520" stroke="#2A180E" stroke-opacity="0.5" stroke-width="1"/>
  </g>

  <!-- Dowel plugs at plank ends -->
  <g fill="#2F1C10" stroke="#1F130B" stroke-width="1.5">
    <circle cx="49" cy="18" r="4"/>
    <circle cx="150" cy="16" r="4"/>
    <circle cx="250" cy="18" r="4"/>
    <circle cx="349" cy="16" r="4"/>
    <circle cx="49" cy="504" r="4"/>
    <circle cx="150" cy="502" r="4"/>
    <circle cx="250" cy="504" r="4"/>
    <circle cx="349" cy="502" r="4"/>
  </g>

  <!-- Carving marks: a few square-capped cuts, kept off the center -->
  <g fill="none" stroke="#5E3D25" stroke-opacity="0.35" stroke-width="2" stroke-linecap="square">
    <path d="M30 300 l4 -22 M46 336 l3 -18 M14 440 l5 -20"/>
    <path d="M124 60 l3 -18 M176 88 l-3 20"/>
    <path d="M262 30 l4 -20 M240 500 l3 -16"/>
    <path d="M380 130 l4 -18 M334 250 l-3 20 M392 470 l3 -18"/>
  </g>

  <!-- Beer-ring traces near the edges, amber second plate -->
  <g fill="none" stroke="#E8A317" stroke-linecap="round">
    <circle cx="58" cy="44" r="36" stroke-opacity="0.16" stroke-width="5" stroke-dasharray="150 34 40 20"/>
    <circle cx="58" cy="44" r="30" stroke-opacity="0.09" stroke-width="1.5" stroke-dasharray="90 60"/>
    <circle cx="342" cy="468" r="40" stroke-opacity="0.14" stroke-width="5" stroke-dasharray="120 40 70 22"/>
    <circle cx="342" cy="468" r="34" stroke-opacity="0.08" stroke-width="1.5"/>
    <circle cx="392" cy="232" r="30" stroke-opacity="0.12" stroke-width="4.5" stroke-dasharray="110 30 40 10"/>
    <circle cx="44" cy="482" r="26" stroke-opacity="0.10" stroke-width="4" stroke-dasharray="80 30 40 14"/>
  </g>
  <g fill="#E8A317">
    <circle cx="92" cy="76" r="3" fill-opacity="0.12"/>
    <circle cx="300" cy="446" r="2.4" fill-opacity="0.10"/>
    <circle cx="370" cy="268" r="2" fill-opacity="0.10"/>
  </g>
</svg>
`;
