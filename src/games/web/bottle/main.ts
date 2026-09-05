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
  <path d="M119 27 201 25 204 248 215 294 275 357 282 402 280 878 270 918 245 935 73 937 43 915 37 882 39 405 48 364 107 295 118 249Z" fill="#E8A317" stroke="#15120F" stroke-width="12" stroke-linejoin="round"/>
  <path d="M202 82 201 270 217 309 265 363 270 416 267 875 252 912 220 919 235 874 238 404 184 321 177 266 177 82Z" fill="#A76C19"/>
  <path d="M119 95 143 94 140 265 126 308 70 375 63 419 61 857" fill="none" stroke="#FBF6EA" stroke-width="10" stroke-linecap="square"/>
  <path d="M115 24 203 24 208 62 112 66Z" fill="#BBA07A" stroke="#15120F" stroke-width="10"/>
  <path d="m125 30 1 24m17-25 1 22m17-22 1 22m18-22 1 23m15-22 1 20" stroke="#15120F" stroke-width="3"/>
  <path d="m42 482 238-5 0 239-240 7Z" fill="#FBF6EA" stroke="#15120F" stroke-width="8"/>
  <path d="m57 497 207-4M54 706l211-5" stroke="#15120F" stroke-width="4"/>
  <path d="m112 554 77 0 0 96-80 0Z" fill="#E8A317" stroke="#15120F" stroke-width="9" stroke-linejoin="round"/>
  <path d="M190 565h30v63h-30" fill="none" stroke="#15120F" stroke-width="9"/>
  <path d="M105 560c-17-16-4-38 13-35 6-21 34-19 42-6 20-13 42 3 37 21 18 9 6 29-8 24-14 8-25-2-35-1-17 8-26-5-35-1Z" fill="#FBF6EA" stroke="#15120F" stroke-width="7"/>
  <path d="m128 582-1 48m20-45 0 45m20-47 0 45" stroke="#15120F" stroke-width="4"/>
  <g fill="none" stroke="#15120F" stroke-width="4" stroke-linecap="square">
    <path d="m80 376-11 46m23-35-8 37m156-42 13 39M65 748l-1 126m15-121-1 123m156-125-1 134m14-128-1 102m-62 42-92 2m93-14-94 2M128 112l-1 108m68-104 1 121"/>
    <path d="m65 458 13-3m9 4 22-4m108-7 26-2m-29 295 22-2m-129 34 13-3m77 97 16-4"/>
  </g>
</svg>` )}`;

class BottleTable {
  private readonly bottle: HTMLImageElement;
  private readonly seats: SVGSVGElement[] = [];
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

    for (const colour of colours) {
      const seat = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      seat.setAttribute('viewBox', '0 0 64 64');
      seat.setAttribute('aria-hidden', 'true');
      seat.style.cssText = 'position:absolute;transform:translate(-50%,-50%)';
      seat.innerHTML = `<path d="M10 9 29 3 48 7 59 23 58 43 44 58 23 60 7 47 3 27Z" fill="#FBF6EA" stroke="#251A12" stroke-width="2"/>
        <circle cx="32" cy="32" r="23" fill="none" stroke="#251A12" stroke-width="1.2"/>
        <circle cx="32" cy="32" r="18" stroke="#251A12" stroke-width="1.5"/>
        <path d="m21 11 7-2m25 23-1 7M19 51l9 3" fill="none" stroke="#A8896A" stroke-width="1.5"/>`;
      seat.querySelectorAll('circle')[1].style.fill = colour;
      table.appendChild(seat);
      this.seats.push(seat);
    }

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
    const coaster = Math.min(54, width * 0.14);
    const radiusX = width / 2 - coaster * 0.72;
    const radiusY = height / 2 - coaster * 0.85;
    const length = Math.min(width * 0.58, height * 0.52);
    this.bottle.style.width = `${length / 3}px`;
    this.bottle.style.height = `${length}px`;
    this.seats.forEach((seat, index) => {
      const angle = index / this.seats.length * Math.PI * 2;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      // Every coaster stays on the neck's radial line, even on a tall table.
      const radius = 1 / Math.sqrt((sin / radiusX) ** 2 + (cos / radiusY) ** 2);
      seat.style.left = `${width / 2 + sin * radius}px`;
      seat.style.top = `${height / 2 - cos * radius}px`;
      seat.style.width = `${coaster}px`;
      seat.style.height = `${coaster}px`;
    });
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
