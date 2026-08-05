/**
 * Kdo platí rundu — a wheel, spun for real.
 *
 * One wedge per player, in their colour and carrying their name, and a pointer
 * at the near edge. The wheel is given a shove and slows under damping; whatever
 * is under the pointer when it stops is who is buying.
 *
 * The names are painted ON the wheel, which is the one place words are allowed
 * to cross into a canvas — a label on a wedge is part of the object, like the
 * number in a roulette pocket, and watching your own name go past is most of why
 * this is fun. The sentence that says who was chosen is still React Native.
 *
 * As with the dice and the bottle, nothing picks first: the spin is the
 * decision, which is the only version of this that survives being watched
 * closely.
 *
 * Unlike the bottle, this one ENDS: a round has exactly one payer, so the game
 * reports a `result` and the evening moves on. That difference is the whole
 * reason `result` is in the protocol and `event` is not enough.
 */

import * as THREE from 'three';

import { connect, type GameSession } from '@/games/web/sdk';

const RADIUS = 3.2;
const REST_SPIN = 0.05;
const REST_FRAMES = 10;
const MAX_FRAMES = 60 * 12;

/**
 * A name, drawn along its wedge.
 *
 * A texture on the top face rather than 3D text: `TextGeometry` needs a font
 * file, which is another asset to ship and another thing to get wrong at small
 * sizes. A canvas draws it at whatever resolution the screen has.
 */
function faceTexture(labels: string[], ink: string): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const middle = size / 2;
  const sweep = (Math.PI * 2) / labels.length;

  ctx.font = '700 46px -apple-system, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink;

  labels.forEach((label, index) => {
    ctx.save();
    ctx.translate(middle, middle);
    // Centre of the wedge, and far enough out that a long name still fits.
    ctx.rotate(index * sweep + sweep / 2);
    ctx.fillText(label.slice(0, 12), middle - 46, 0);
    ctx.restore();
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

/**
 * One wedge of the wheel.
 *
 * A cylinder segment rather than a flat circle: the wheel has thickness, catches
 * the light on its rim and throws a shadow, which is the difference between a
 * disc lying on a table and a pie chart.
 */
function wedge(colour: string, start: number, sweep: number): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(RADIUS, RADIUS, 0.34, 48, 1, false, start, sweep);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colour),
    roughness: 0.55,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

class Wheel {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly disc = new THREE.Group();
  private velocity = 0;
  private heading = 0;
  private still = 0;
  private frames = 0;
  private spinning = false;

  onStopped: ((index: number) => void) | null = null;

  constructor(
    private readonly colours: string[],
    labels: string[],
    theme: { bg: string; ink: string; accent: string },
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 8.2, 4.6);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.3);
    key.position.set(-3.5, 9, 5.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.ShadowMaterial({ opacity: 0.4 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.18;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const sweep = (Math.PI * 2) / colours.length;
    colours.forEach((colour, index) => {
      this.disc.add(wedge(colour, index * sweep, sweep));
    });

    // The names ride on a disc just above the wedges, so one texture serves the
    // whole wheel and the labels cannot drift out of their colours.
    const labelDisc = new THREE.Mesh(
      new THREE.CircleGeometry(RADIUS - 0.02, 64),
      new THREE.MeshBasicMaterial({
        map: faceTexture(labels, theme.ink),
        transparent: true,
      }),
    );
    labelDisc.rotation.x = -Math.PI / 2;
    labelDisc.position.y = 0.18;
    this.disc.add(labelDisc);
    this.scene.add(this.disc);

    // The pointer, at the near edge where the phone's owner is sitting.
    const pointer = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 0.7, 16),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.ink), roughness: 0.4 }),
    );
    pointer.rotation.x = Math.PI;
    pointer.position.set(0, 0.5, RADIUS + 0.25);
    pointer.castShadow = true;
    this.scene.add(pointer);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.tick();
  }

  private resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  spin(): void {
    if (this.spinning) return;
    this.spinning = true;
    this.still = 0;
    this.frames = 0;
    this.velocity = 11 + Math.random() * 9;
  }

  /** Which wedge is under the pointer. */
  private underPointer(): number {
    const sweep = (Math.PI * 2) / this.colours.length;
    // The pointer sits at +Z; a wedge starting at angle `a` covers `a..a+sweep`
    // measured from +X, so the reading is offset by a quarter turn.
    const at = (((Math.PI / 2 - this.heading) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return Math.floor(at / sweep) % this.colours.length;
  }

  private tick = (): void => {
    requestAnimationFrame(this.tick);

    if (this.spinning) {
      // Damping by hand: cannon would do this too, but a wheel on a spindle has
      // no collisions to resolve, and a whole physics world for one number is
      // weight nobody gets anything for.
      this.velocity *= 0.985;
      this.heading += this.velocity / 60;
      this.frames += 1;
      this.still = Math.abs(this.velocity) > REST_SPIN ? 0 : this.still + 1;
      if (this.still >= REST_FRAMES || this.frames > MAX_FRAMES) {
        this.spinning = false;
        this.onStopped?.(this.underPointer());
      }
    }

    this.disc.rotation.y = this.heading;
    this.renderer.render(this.scene, this.camera);
  };
}

connect({
  commands: [{ name: 'spin', label: 'Roztoč' }],
  start(session: GameSession) {
    const wheel = new Wheel(
      session.players.map((player) => player.colour),
      session.players.map((player) => player.label ?? ''),
      { bg: session.theme.bg, ink: session.theme.ink, accent: session.theme.accent },
    );
    document.body.style.background = session.theme.bg;

    wheel.onStopped = (index) => {
      const player = session.players[index];
      if (!player) return;
      session.emit('picked', { playerId: player.id });
      // A round has exactly one payer, so this game is over the moment the wheel
      // stops. Scores stay empty: there is nothing here worth ranking.
      session.finish({ scores: [], winnerId: null, payingId: player.id });
    };

    return (name) => {
      if (name === 'spin') wheel.spin();
    };
  },
});
