/**
 * Flaška — a real bottle, spun on a real table.
 *
 * Same shape as the dice (`../dice/main.ts`): three.js for the object, a small
 * fixed-step angular simulation for the spin, and the SDK for everything that
 * crosses to the app. Players are
 * seats around the table: each torn beer slip paints only a player-colour
 * hairline, while the game logic uses stable ids and points at one of them.
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
import bottleTextureUrl from './bottle-top-down.webp';
import slipCleanUrl from './assets/slip-clean.webp';
import slipStainedUrl from './assets/slip-stained.webp';
import slipWornUrl from './assets/slip-worn.webp';

/** Where the seats sit. The table is a circle and the bottle is at its centre. */
const SEAT_RADIUS = 3.4;
const BOTTLE_WIDTH = 0.76;
const BOTTLE_LENGTH = 3.15;
const SLIP_WIDTH = 0.52;
const SLIP_HEIGHT = 0.7;
const SLIP_URLS = [slipCleanUrl, slipWornUrl, slipStainedUrl] as const;

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
 * A torn paper beer slip with one thin player-colour mark. The canvas may only
 * know a player's colour, so the slip never paints names or initials.
 */
function slipMarker(
  playerColour: string,
  index: number,
  textures: readonly THREE.Texture[],
): THREE.Group {
  const group = new THREE.Group();
  const slip = new THREE.Mesh(
    new THREE.PlaneGeometry(SLIP_WIDTH, SLIP_HEIGHT),
    new THREE.MeshBasicMaterial({
      map: textures[index % textures.length],
      transparent: true,
      alphaTest: 0.03,
      side: THREE.DoubleSide,
    }),
  );
  slip.geometry.rotateX(Math.PI / 2);
  slip.position.y = 0.012;
  group.add(slip);

  const accent = new THREE.Mesh(
    new THREE.PlaneGeometry(SLIP_WIDTH * 0.62, 0.026),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(playerColour),
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    }),
  );
  accent.geometry.rotateX(Math.PI / 2);
  accent.position.z = SLIP_HEIGHT * 0.28;
  accent.position.y = 0.024;
  group.add(accent);

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
    theme: { bg: string; ink: string; accent: string },
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

    const felt = new THREE.Mesh(
      new THREE.CircleGeometry(SEAT_RADIUS + 1.1, 64),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.bg), roughness: 1 }),
    );
    felt.rotation.x = -Math.PI / 2;
    felt.receiveShadow = true;
    this.scene.add(felt);

    const loader = new THREE.TextureLoader();
    const slipTextures = SLIP_URLS.map((url) => {
      const texture = loader.load(url, () => this.renderer.render(this.scene, this.camera));
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    });
    colours.forEach((colour, index) => {
      const seat = slipMarker(colour, index, slipTextures);
      this.scene.add(seat);
      this.seats.push(seat);
    });

    const texture = new THREE.TextureLoader().load(bottleTextureUrl, () => {
      this.renderer.render(this.scene, this.camera);
    });
    texture.colorSpace = THREE.SRGBColorSpace;
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
    const table = new BottleTable(
      session.players.map((player) => player.colour),
      {
        bg: session.theme.bg,
        ink: session.theme.ink,
        accent: session.theme.accent,
      },
    );
    document.body.style.background = session.theme.bg;

    table.onStopped = (seat) => {
      const player = session.players[seat];
      if (player) session.emit('picked', { playerId: player.id });
    };

    return (name) => {
      if (name === 'spin') table.spin();
    };
  },
});
