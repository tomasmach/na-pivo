/** A printed bottle and static pub table; only the bottle layer rotates. */
import { connect, type GameSession } from '@/games/web/sdk';
import {
  advanceBottleSpin,
  BOTTLE_FIXED_STEP_SECONDS,
  BOTTLE_SPIN_SECONDS,
  plannedBottleSpeed,
  randomTableHeading,
  seatForHeading,
  startBottleSpin,
} from './physics';
import { bottleTableSvg } from '@/party/bottleTableArtwork';

const bottleTextureUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="960" viewBox="0 0 320 960">
  <!-- The glass has an actual crown lip, long neck and broad Czech beer shoulders. -->
  <path d="M124 29 Q160 21 196 29 L201 64 193 82 198 260 Q199 305 231 331 Q278 368 279 427 L278 877 Q278 928 239 937 L82 937 Q42 927 42 877 L41 428 Q42 374 87 337 Q121 310 123 260 L128 83 118 66Z" fill="#A76C19" stroke="#15120F" stroke-width="11" stroke-linejoin="round"/>
  <path d="M150 87 171 86 173 270 Q175 313 203 347 Q246 389 247 438 L246 869 Q245 897 222 907 L94 907 Q71 897 72 869 L70 438 Q70 392 107 352 Q139 318 140 269Z" fill="#E8A317"/>
  <path d="M193 95 198 270 Q201 308 233 339 Q271 375 269 431 L268 875 Q265 916 233 923 L99 923 80 909 227 904 Q247 891 246 869 L246 427 Q245 384 211 348 Q181 314 179 266 L177 95Z" fill="#613C15"/>
  <path d="M133 110 144 106 141 264 Q140 315 111 348 Q77 383 76 422 L72 464 62 458 64 421 Q66 375 99 338 Q127 309 129 262Z" fill="#FBF6EA"/>
  <path d="M76 758 84 762 84 865 Q83 886 99 891 L95 899 Q72 891 73 864Z" fill="#FBF6EA"/>
  <path d="M118 42 Q160 34 202 42 L201 68 Q160 76 120 68Z" fill="#E8A317" stroke="#15120F" stroke-width="7"/>
  <path d="M128 49 128 62 M142 46 142 65 M158 46 158 65 M176 46 176 65 M190 48 191 62" stroke="#613C15" stroke-width="4"/>
  <!-- Neck foil and the paper label wrap around the glass, with a dark return edge. -->
  <path d="M126 164 Q160 173 195 164 L196 233 Q160 243 124 232Z" fill="#FBF6EA" stroke="#15120F" stroke-width="6"/>
  <path d="M133 180 Q161 186 188 180 M132 217 Q159 224 188 217" fill="none" stroke="#15120F" stroke-width="3"/>
  <path d="m151 194 9-8 10 9-10 10Z" fill="#E8A317" stroke="#15120F" stroke-width="3"/>
  <path d="M47 476 Q159 495 273 477 L271 734 Q161 754 47 735Z" fill="#BBA07A" stroke="#15120F" stroke-width="7"/>
  <path d="M49 477 Q145 493 253 480 L252 738 Q147 751 48 735Z" fill="#FBF6EA"/>
  <path d="M59 492 Q154 507 246 494 M59 719 Q151 733 246 721" fill="none" stroke="#15120F" stroke-width="4"/>
  <!-- A brewer's hop seal, cut in two inks; no tiny simulated typography. -->
  <ellipse cx="157" cy="608" rx="71" ry="90" fill="#E8A317" stroke="#15120F" stroke-width="5"/>
  <path d="M157 535 C132 550 119 570 120 600 Q115 635 157 674 Q199 635 194 600 C195 570 180 550 157 535Z" fill="#FBF6EA" stroke="#15120F" stroke-width="6"/>
  <path d="M157 542 157 663 M134 557 Q141 578 157 584 Q174 576 181 558 M123 582 Q134 604 157 612 Q181 603 191 582 M122 610 Q137 630 157 639 Q180 628 192 610 M134 640 157 662 180 639" fill="none" stroke="#15120F" stroke-width="5" stroke-linejoin="round"/>
  <path d="m71 553 9 5m-9 17 8 4m151 74 8 5m-10 12 8 5 M106 777l-2 87m115-91-1 95 M121 889l76 1 M108 402l-9 33m123-45 12 38" fill="none" stroke="#613C15" stroke-width="4" stroke-linecap="square"/>
</svg>` )}`;

class BottleTable {
  private readonly bottle: HTMLImageElement;
  private heading = randomTableHeading(Math.random());
  private spinning = false;
  onStopped: ((seat: number) => void) | null = null;

  constructor(private readonly colours: string[]) {
    const table = document.createElement('div');
    table.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#452B1A';
    const timber = new Image();
    timber.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(bottleTableSvg)}`;
    timber.alt = '';
    timber.style.cssText = 'position:absolute;width:100%;height:100%;object-fit:cover';
    table.appendChild(timber);

    // Coasters and player names are native overlays, outside this decorative WebView.
    this.bottle = new Image();
    this.bottle.src = bottleTextureUrl;
    this.bottle.alt = '';
    this.bottle.style.cssText = 'position:absolute;left:50%;top:50%;object-fit:contain;will-change:transform';
    this.bottle.style.transform = this.rotation(this.heading);
    table.appendChild(this.bottle);
    document.body.appendChild(table);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private rotation(heading: number): string {
    return `translate(-50%,-50%) rotate(${heading}rad)`;
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const length = Math.min(width * 0.58, height * 0.52);
    this.bottle.style.width = `${length / 3}px`;
    this.bottle.style.height = `${length}px`;
  }

  spin(): void {
    if (this.spinning || this.colours.length === 0) return;
    this.spinning = true;
    let state = startBottleSpin(this.heading, plannedBottleSpeed(
      this.heading, this.colours.length, Math.random(), Math.random(),
    ));
    const frames: Keyframe[] = [{ transform: this.rotation(state.heading), offset: 0 }];
    // Sample the same fixed-step physics once. WebKit composites the rotation
    // without running a WebGL render or waiting for JavaScript every frame.
    while (!state.done) {
      state = advanceBottleSpin(state, BOTTLE_FIXED_STEP_SECONDS);
      frames.push({ transform: this.rotation(state.heading), offset: state.elapsed / BOTTLE_SPIN_SECONDS });
    }
    const landedHeading = state.heading;
    const animation = this.bottle.animate(frames, {
      duration: BOTTLE_SPIN_SECONDS * 1000,
      easing: 'linear',
      fill: 'forwards',
    });
    animation.onfinish = () => {
      this.heading = landedHeading % (Math.PI * 2);
      this.bottle.style.transform = this.rotation(this.heading);
      animation.cancel();
      this.spinning = false;
      this.onStopped?.(seatForHeading(this.heading, this.colours.length));
    };
  }
}

connect({
  commands: [{ name: 'spin', label: 'Roztoč' }],
  start(session: GameSession) {
    const table = new BottleTable(session.players.map((player) => player.colour));
    table.onStopped = (seat) => {
      const player = session.players[seat];
      if (player) session.emit('picked', { playerId: player.id });
    };
    return (name) => {
      if (name === 'spin') table.spin();
    };
  },
});
