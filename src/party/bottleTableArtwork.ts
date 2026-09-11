/** Shared oak print for the spinning bottle and reduced-motion table. */
export const bottleTableSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 520" width="400" height="520">
  <path d="M0 0H98V520H0Z" fill="#4E3320"/>
  <path d="M98 0H203V520H98Z" fill="#452B1A"/>
  <path d="M203 0H297V520H203Z" fill="#3F2718"/>
  <path d="M297 0H400V520H297Z" fill="#4B301D"/>
  <!-- Tapered gouges follow the grain. Uncut areas let the bottle read. -->
  <g fill="#25180F" fill-opacity=".48">
    <path d="M18 0Q9 58 22 125T22 254Q13 300 19 372L22 421Q9 367 13 318T15 235Q28 179 16 121T18 0Z"/>
    <path d="M73 0Q61 64 72 118T83 219Q71 165 66 135T62 60Z"/>
    <path d="M36 213Q27 274 43 339T50 478L44 520H39Q56 424 35 344T36 213Z"/>
    <path d="M79 278Q69 341 78 397T82 520H77Q86 448 72 400T79 278Z"/>
    <path d="M117 0Q112 92 120 166T118 309Q115 358 121 392Q110 349 114 302T113 161Q106 80 117 0Z"/>
    <path d="M176 0Q184 55 173 113T169 219Q160 170 170 115T176 0Z"/>
    <path d="M189 319Q175 375 183 435L191 520H186L177 437Q170 371 189 319Z"/>
    <path d="M223 0Q234 64 222 126T220 253Q211 188 217 143T223 0Z"/>
    <path d="M272 161Q283 223 271 285T270 408Q260 349 266 290T272 161Z"/>
    <path d="M229 382Q218 445 232 520H226Q214 444 229 382Z"/>
    <path d="M320 0Q309 81 322 149T324 279Q317 214 315 183T311 71Z"/>
    <path d="M375 0Q387 105 368 179T371 344Q355 279 363 219T375 0Z"/>
    <path d="M313 323Q322 367 313 406T318 520H313Q302 452 308 414T313 323Z"/>
    <path d="M381 380Q371 442 385 520H379Q365 449 381 380Z"/>
  </g>
  <!-- Flat-sawn oak cathedrals, nested and asymmetric. -->
  <g fill="none" stroke="#25180F" stroke-opacity=".45" stroke-linecap="square">
    <path d="M28 146Q22 92 43 62Q61 92 58 139 M33 135Q30 99 43 78Q53 100 53 129 M38 119Q35 105 43 92Q48 107 45 119" stroke-width="2"/>
    <path d="M130 520Q124 460 150 423Q173 456 166 501 M135 513Q130 466 150 438Q165 465 160 493 M141 493Q137 470 150 451Q158 471 152 489" stroke-width="2"/>
    <path d="M236 128Q227 60 250 20Q279 53 267 118 M241 113Q237 67 251 37Q270 65 261 105 M246 93Q242 66 252 53Q262 69 254 91" stroke-width="1.8"/>
    <path d="M330 446Q321 372 349 331Q378 381 364 450 M336 433Q330 381 349 348Q368 382 359 429 M341 414Q338 389 349 367Q359 390 350 412" stroke-width="2"/>
  </g>
  <g fill="#785333" fill-opacity=".30">
    <path d="M30 0 33 0Q24 47 31 71L29 100Q22 63 30 0Z M58 189Q66 252 61 294L58 281Q62 244 58 189Z M23 428 26 440 24 500 21 510Z"/>
    <path d="M136 40 139 22 136 164 133 179Z M157 274Q149 329 158 375L156 391Q144 342 157 274Z"/>
    <path d="M287 0 290 0 287 122 285 140Z M248 369 252 355 249 454 246 467Z"/>
    <path d="M345 17 349 8 344 112 342 123Z M392 269 394 253 391 365 388 378Z"/>
  </g>
  <!-- Joints wander like worn boards, without bevelled framing. -->
  <g fill="none" stroke="#1B120C" stroke-width="3">
    <path d="M98 0 97 111 99 242 97 394 98 520 M203 0 202 157 204 303 202 520 M297 0 296 186 298 317 297 520"/>
  </g>
  <g fill="none" stroke="#785333" stroke-opacity=".42" stroke-width="1">
    <path d="M95 0 94 111 96 242 94 394 95 520 M200 0 199 157 201 303 199 520 M294 0 293 186 295 317 294 520"/>
  </g>
  <!-- Incomplete glass impressions, kept away from the playing area. -->
  <g fill="none" stroke="#BBA07A" stroke-linecap="butt">
    <path d="M-12 73C-25 41 1 9 36 15C71 22 88 58 67 88M58 98Q17 119-7 83" stroke-width="5" stroke-opacity=".17"/>
    <path d="M-5 68C-15 40 7 19 35 23Q75 34 67 68M61 84Q31 109 3 82" stroke-width="1.6" stroke-opacity=".20"/>
    <path d="M317 456C326 424 375 416 397 450Q419 488 380 510M367 514Q326 511 317 473" stroke-width="4" stroke-opacity=".17"/>
    <path d="M325 456Q352 416 387 448Q416 482 378 502M363 506Q336 504 325 479" stroke-width="1.5" stroke-opacity=".20"/>
  </g>
  <g fill="#BBA07A" fill-opacity=".15">
    <path d="m76 99 5-1 2 3-5 2Z m-2-9 3-3 2 4-3 2Z M305 457l4-3 2 6-4 1Z"/>
  </g>
</svg>`;
