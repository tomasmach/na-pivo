/**
 * Flaška — a real bottle, spun on a real table.
 *
 * Same shape as the dice (`../dice/main.ts`): three.js for the object, cannon-es
 * for the spin, and the SDK for everything that crosses to the app. Nothing here
 * knows a name — players are seats around the table, each in their own colour,
 * and the bottle points at one of them.
 *
 * The physics is the pick. The bottle is given a shove with a random impulse and
 * slows under angular damping; whoever it happens to be aimed at when it stops
 * is the answer. Nothing chooses first and animates towards it, which is the one
 * thing that makes a spin worth watching rather than a countdown to a result
 * somebody already computed.
 */

import * as CANNON from 'cannon-es';
import * as THREE from 'three';

import { connect, type GameSession } from '@/games/web/sdk';
import bottleTextureUrl from './bottle-top-down.webp';

/** Where the seats sit. The table is a circle and the bottle is at its centre. */
const SEAT_RADIUS = 3.4;
const REST_SPIN = 0.06;
const REST_FRAMES = 10;
const MAX_FRAMES = 60 * 10;

/** A real bottle cutout, lying down and pointing along +Z. */
function bottleMesh(texture: THREE.Texture): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(0.85, 3.5);
  geometry.rotateX(Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.03,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geometry, material);
}

class BottleTable {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) });
  private readonly body: CANNON.Body;
  private readonly bottle: THREE.Mesh;
  private readonly seats: THREE.Mesh[] = [];
  private still = 0;
  private frames = 0;
  private spinning = false;
  private frame: number | null = null;
  /** Accumulated heading in radians, so whole turns are never lost. */
  private spinHeading = 0;

  onStopped: ((seat: number) => void) | null = null;

  constructor(
    private readonly colours: string[],
    theme: { bg: string; ink: string; accent: string },
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

    // One disc per seat, in that player's colour. This is the whole of what the
    // page knows about the people around the table.
    colours.forEach((colour, index) => {
      const angle = (index / colours.length) * Math.PI * 2;
      const seat = new THREE.Mesh(
        new THREE.CircleGeometry(0.52, 32),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(colour), roughness: 0.8 }),
      );
      seat.rotation.x = -Math.PI / 2;
      seat.position.set(Math.sin(angle) * SEAT_RADIUS, 0.01, Math.cos(angle) * SEAT_RADIUS);
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
    this.scene.add(this.bottle);

    // A body that only spins: no gravity, heavy angular damping, so it slows the
    // way something dragging on a table does rather than stopping dead.
    this.body = new CANNON.Body({ mass: 1, shape: new CANNON.Cylinder(0.42, 0.42, 3, 12) });
    this.body.angularDamping = 0.38;
    this.world.addBody(this.body);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }

  spin(): void {
    if (this.spinning) return;
    this.spinning = true;
    this.still = 0;
    this.frames = 0;
    // Enough turns that nobody can follow it round, random enough that nobody
    // can learn the shove.
    this.body.angularVelocity.set(0, 9 + Math.random() * 11, 0);
    this.requestTick();
  }

  /** Which seat the neck ended up aimed at. */
  private seatUnderNeck(): number {
    const heading = this.spinHeading;
    const step = (Math.PI * 2) / this.colours.length;
    const normalised = ((heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return Math.round(normalised / step) % this.colours.length;
  }

  private tick = (): void => {
    this.frame = null;
    this.world.step(1 / 60);

    // Heading is integrated by hand rather than read back off the quaternion:
    // a quaternion cannot tell four turns from none, and the whole turns are
    // exactly what makes this look like a spin instead of a nudge.
    this.spinHeading += this.body.angularVelocity.y / 60;
    this.bottle.rotation.y = this.spinHeading;

    if (this.spinning) {
      this.frames += 1;
      const moving = Math.abs(this.body.angularVelocity.y) > REST_SPIN;
      this.still = moving ? 0 : this.still + 1;
      if (this.still >= REST_FRAMES || this.frames > MAX_FRAMES) {
        this.spinning = false;
        this.onStopped?.(this.seatUnderNeck());
      }
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
    const colours = session.players.map((player) => player.colour);
    const table = new BottleTable(colours, {
      bg: session.theme.bg,
      ink: session.theme.ink,
      accent: session.theme.accent,
    });
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
