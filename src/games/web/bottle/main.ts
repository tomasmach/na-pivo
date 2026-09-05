/**
 * Flaška — a real bottle, spun on a real table.
 *
 * Same shape as the dice (`../dice/main.ts`): three.js for the object, a small
 * fixed-step angular simulation for the spin, and the SDK for everything that
 * crosses to the app. Players are
 * seats around the table: each seat is a disc in the player's own colour, while
 * the game logic uses stable ids and points at one of them.
 *
 * The bottle gets one random shove and then slows under angular damping. There
 * is no steering, snap or result reveal during the spin; the app only learns
 * who it points at after the physical simulation has stopped.
 */

import * as THREE from 'three';

import { connect, type GameSession } from '@/games/web/sdk';
import {
  advanceBottleSpin,
  plannedBottleSpeed,
  randomTableHeading,
  seatForHeading,
  startBottleSpin,
  type BottleSpinState,
} from './physics';
// Inline SVG keeps the print crisp and the bundled game entirely offline.
// The neck points towards the SVG top, mapped to +Z by the plane rotation.
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

/** Where the seats sit. The table is a circle and the bottle is at its centre. */
const SEAT_RADIUS = 3.4;
const BOTTLE_WIDTH = 1.05;
const BOTTLE_LENGTH = 3.15;
/** Seat discs, sized like the app's 34pt avatar next to a 3.15 long bottle. */
const SEAT_RADIUS_UNITS = 0.34;

/** A real bottle cutout, lying down and pointing along +Z. */
function bottleMesh(texture: THREE.Texture): THREE.Mesh {
  // Portrait phones still have to contain the full prop when it stops sideways.
  const geometry = new THREE.PlaneGeometry(BOTTLE_WIDTH, BOTTLE_LENGTH);
  geometry.rotateX(Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.03,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geometry, material);
}

/**
 * A seat at the table: the app's avatar disc, in the player's own colour.
 *
 * It used to be a torn paper beer slip with a colour hairline, which at this
 * scale read as a small grey placeholder square rather than as a person. A
 * filled disc with a quiet rim is the shape people already are everywhere else
 * in the app — and per DESIGN §21.4.2 the canvas still knows nothing but the
 * colour, so no initial or name is drawn here.
 */
function seatMarker(playerColour: string): THREE.Group {
  const group = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(SEAT_RADIUS_UNITS, 32),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(playerColour),
      side: THREE.DoubleSide,
    }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.02;
  group.add(disc);

  const rim = new THREE.Mesh(
    new THREE.RingGeometry(SEAT_RADIUS_UNITS * 1.08, SEAT_RADIUS_UNITS * 1.24, 32),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(playerColour),
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
    }),
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.014;
  group.add(rim);

  return group;
}

class BottleTable {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly bottle: THREE.Mesh;
  private readonly seats: THREE.Group[] = [];
  private spinning = false;
  private frame: number | null = null;
  private lastFrameTimestamp: number | null = null;
  private spinState: BottleSpinState;

  onStopped: ((seat: number) => void) | null = null;

  constructor(
    private readonly colours: string[],
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    document.body.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(0, 8.5, 4.2);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(-4, 9, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);

    // Shadow-catcher only, exactly like the dice table. A lit disc in the app's
    // own background colour still reads as a hard-edged black shape with an
    // arched top; the host owns the surface, the page draws the props.
    const felt = new THREE.Mesh(
      new THREE.CircleGeometry(SEAT_RADIUS + 1.1, 64),
      new THREE.ShadowMaterial({ opacity: 0.4 }),
    );
    felt.rotation.x = -Math.PI / 2;
    felt.receiveShadow = true;
    this.scene.add(felt);

    colours.forEach((colour) => {
      const seat = seatMarker(colour);
      this.scene.add(seat);
      this.seats.push(seat);
    });

    // WKWebView can decode SVG while failing to upload that SVG image directly
    // to WebGL. Rasterize explicitly, then upload the same pixels as the dice.
    const bottleCanvas = document.createElement('canvas');
    bottleCanvas.width = 320;
    bottleCanvas.height = 960;
    const texture = new THREE.CanvasTexture(bottleCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const bottleImage = new Image();
    bottleImage.onload = () => {
      const context = bottleCanvas.getContext('2d');
      if (!context) return;
      context.drawImage(bottleImage, 0, 0, bottleCanvas.width, bottleCanvas.height);
      texture.needsUpdate = true;
      this.renderer.render(this.scene, this.camera);
    };
    bottleImage.src = bottleTextureUrl;
    this.bottle = bottleMesh(texture);
    this.bottle.castShadow = true;
    this.bottle.position.y = 0.08;
    // Start at a natural random angle instead of always presenting a staged
    // upright bottle before anybody has touched it.
    const initialHeading = randomTableHeading(Math.random());
    this.spinState = startBottleSpin(initialHeading, 0);
    this.bottle.rotation.y = initialHeading;
    this.scene.add(this.bottle);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.layoutSeats();
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Keep every seat visible on a portrait phone without shrinking the bottle.
   *
   * The table stays circular in the world, but its visible perimeter becomes a
   * portrait ellipse: each marker remains on its real radial heading, so the
   * bottle still points exactly at the selected seat. On a wide canvas the
   * horizontal radius naturally expands back to the full circle.
   */
  private layoutSeats(): void {
    if (this.seats.length === 0) return;
    const horizontalRadius = Math.min(
      SEAT_RADIUS,
      Math.max(1.1, SEAT_RADIUS * this.camera.aspect * 0.72),
    );
    this.seats.forEach((seat, index) => {
      const angle = (index / this.seats.length) * Math.PI * 2;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      const radius =
        1 /
        Math.sqrt(
          (sin * sin) / (horizontalRadius * horizontalRadius) +
            (cos * cos) / (SEAT_RADIUS * SEAT_RADIUS),
        );
      // Perspective makes the near half of the table reach lower on portrait
      // screens. Pull only that half inward so its marker stays fully visible;
      // its heading is unchanged, therefore the neck still selects it exactly.
      const perspectiveFit = this.camera.aspect < 0.8 && cos > 0 ? 0.86 : 1;
      seat.position.x = sin * radius * perspectiveFit;
      seat.position.z = cos * radius * perspectiveFit;
      seat.rotation.y = angle;
      seat.scale.setScalar(this.camera.aspect < 0.8 && cos > 0 ? 0.72 : 1);
    });
  }

  spin(): void {
    if (this.spinning) return;
    this.spinning = true;
    this.lastFrameTimestamp = null;
    // Choose an independent fair seat and landing point, then solve one initial
    // shove. The simulation gets no target and never steers or snaps afterward.
    this.spinState = startBottleSpin(
      this.spinState.heading,
      plannedBottleSpeed(
        this.spinState.heading,
        this.colours.length,
        Math.random(),
        Math.random(),
      ),
    );
    this.requestTick();
  }

  /** Which seat the neck ended up aimed at. */
  private seatUnderNeck(): number {
    return seatForHeading(this.spinState.heading, this.colours.length);
  }

  private tick = (timestamp: number): void => {
    this.frame = null;
    const deltaSeconds = this.lastFrameTimestamp === null
      ? 0
      : (timestamp - this.lastFrameTimestamp) / 1_000;
    this.lastFrameTimestamp = timestamp;
    this.spinState = advanceBottleSpin(this.spinState, deltaSeconds);
    this.bottle.rotation.y = this.spinState.heading;

    if (this.spinState.done) {
      this.spinning = false;
      this.lastFrameTimestamp = null;
      this.onStopped?.(this.seatUnderNeck());
    }

    this.renderer.render(this.scene, this.camera);
    if (this.spinning) this.requestTick();
  };

  private requestTick(): void {
    if (this.frame === null) this.frame = requestAnimationFrame(this.tick);
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
