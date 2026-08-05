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
 * One name, on its own little plate.
 *
 * A plane per wedge inside a group rotated to that wedge's mid-angle, rather
 * than one texture stretched over the whole disc: the wedges and the labels then
 * share one definition of "where wedge i is", so they cannot drift apart. The
 * first build mapped a single texture by hand and the names sat between colours.
 */
function labelPlate(text: string, ink: string, angle: number, radius: number): THREE.Group {
  const width = 512;
  const height = 128;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '800 74px -apple-system, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink;
  ctx.fillText(text.slice(0, 12), width / 2, height / 2 + 4);

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(2.0, 0.5),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthWrite: false,
    }),
  );
  // Flat on the wheel, reading outwards from the hub.
  plane.rotation.x = -Math.PI / 2;
  plane.rotation.z = Math.PI / 2;
  plane.position.set(0, 0.19, radius);

  const group = new THREE.Group();
  group.rotation.y = angle;
  group.add(plane);
  return group;
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
    this.camera.position.set(0, 11.5, 6.4);
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

    labels.forEach((label, index) => {
      if (label) this.disc.add(labelPlate(label, theme.bg, index * sweep + sweep / 2, RADIUS * 0.62));
    });
    this.scene.add(this.disc);

    // The pointer sits at the FAR edge. The bottom of the screen belongs to the
    // app's own button, and a marker down there is a marker nobody can see.
    const pointer = new THREE.Mesh(
      new THREE.ConeGeometry(0.34, 0.95, 20),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(theme.ink),
        roughness: 0.35,
        emissive: new THREE.Color(theme.ink),
        emissiveIntensity: 0.18,
      }),
    );
    // Tip down, aimed at the rim it is reading.
    pointer.rotation.x = Math.PI;
    pointer.position.set(0, 0.62, -(RADIUS + 0.34));
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

  /**
   * Which wedge is under the pointer.
   *
   * `CylinderGeometry` measures theta from +Z towards +X, and rotating the disc
   * by `heading` puts a local theta at world `theta + heading`. The pointer is
   * at -Z, world angle π, so the wedge under it is at local `π - heading`.
   */
  private underPointer(): number {
    const sweep = (Math.PI * 2) / this.colours.length;
    const local = (((Math.PI - this.heading) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return Math.floor(local / sweep) % this.colours.length;
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
