/**
 * Kostky — real dice, real physics, inside a WebView.
 *
 * This file is NOT part of the React Native bundle. It is built by
 * `scripts/build-games.mjs` into a single self-contained `assets/games/dice.html`
 * with three.js and cannon-es inlined, and that file is what the app loads. No
 * network at runtime: a pub is exactly where there is none.
 *
 * Why a WebView at all — the app tried a CSS-transform cube first, which spins
 * convincingly but cannot fall, bounce off anything, or come to rest crooked.
 * Getting that natively meant `expo-gl` + three + a physics engine: three native
 * dependencies and megabytes in the binary. Here three.js and cannon-es cost
 * nothing native, because they are just JavaScript in a page, and every future
 * game is a new HTML file that ships over the air.
 *
 * The simulation IS the randomness. Nothing decides the numbers up front and
 * animates towards them: the dice are thrown with a random impulse and whatever
 * lands on top is the result, read off the resting orientation and reported back.
 * That is the one thing a fake roll can never be — actually fair.
 *
 * It also runs in a plain browser. Open `assets/games/dice.html` in Safari and
 * the page notices there is no bridge and gives itself a throw button and a
 * readout — so tuning the feel of a roll costs a reload, not a native rebuild,
 * a simulator and a tap through four screens. That loop is the difference
 * between a game that gets tuned and one that ships as it first landed.
 */

import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// Talks to the app only through the SDK — see `src/games/protocol.ts`. Nothing
// here knows about `ReactNativeWebView`, query strings or message shapes, which
// is what makes the next game a copy of this file's STRUCTURE rather than a
// copy of its plumbing.
import { connect, type GameSession } from '@/games/web/sdk';
import {
  isOver,
  recordRoll,
  settleRound,
  standings,
  startDice,
  whoseTurn,
  type DiceState,
} from '@/games/web/dice/rules';

/**
 * Whose dice these are, right now.
 *
 * The page knows no names — it takes a colour, nothing more. The dice on the
 * table still belong to somebody: at a passed-around phone, "those are Honza's"
 * is read from the colour long before anyone reads a label.
 */
let pipColour = '#15120F';
let faceColour = '#FBF6EA';

const DIE_SIZE = 1;
const HALF = DIE_SIZE / 2;
/** How still a die has to be before we call it landed. */
const REST_SPEED = 0.12;
const REST_FRAMES = 12;
/** Retry a stuck throw physically instead of accepting an unreadable face. */
const MAX_FRAMES = 60 * 8;

/**
 * Which value faces which way, in the die's own space.
 *
 * Opposite faces sum to seven, like a real die. The normals are in the order
 * `BoxGeometry` builds its materials: +x, -x, +y, -y, +z, -z.
 */
const FACE_VALUES = [3, 4, 2, 5, 1, 6];
const FACE_NORMALS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];


/**
 * A die face, drawn to a canvas.
 *
 * Textures rather than geometry for the pips: six little spheres per die is
 * twelve more bodies for the renderer to sort, and at this size nobody can tell.
 */
function faceTexture(value: number, face: string): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Warm paper, a player's stamped border and cut ink pips. Material colours
  // stay legible in both app themes; only the player's stamp changes each turn.
  ctx.fillStyle = '#FBF6EA';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = face;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(37, 17);
  ctx.lineTo(219, 17);
  ctx.quadraticCurveTo(239, 17, 239, 37);
  ctx.lineTo(239, 219);
  ctx.quadraticCurveTo(239, 239, 219, 239);
  ctx.lineTo(37, 239);
  ctx.quadraticCurveTo(17, 239, 17, 219);
  ctx.lineTo(17, 37);
  ctx.quadraticCurveTo(17, 17, 37, 17);
  ctx.stroke();
  // Short, deterministic cuts sit near the edges, clear of all six pip layouts.
  ctx.strokeStyle = '#B5A58B';
  ctx.lineWidth = 1.4;
  for (let cut = 0; cut < 15; cut += 1) {
    const x = 36 + ((cut * 37 + value * 11) % 181);
    ctx.beginPath();
    ctx.moveTo(x, 29 + cut % 3);
    ctx.lineTo(x + 5 + cut % 7, 31 + cut % 3);
    ctx.stroke();
  }

  const layouts: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]],
    2: [
      [0.28, 0.28],
      [0.72, 0.72],
    ],
    3: [
      [0.26, 0.26],
      [0.5, 0.5],
      [0.74, 0.74],
    ],
    4: [
      [0.28, 0.28],
      [0.72, 0.28],
      [0.28, 0.72],
      [0.72, 0.72],
    ],
    5: [
      [0.26, 0.26],
      [0.74, 0.26],
      [0.5, 0.5],
      [0.26, 0.74],
      [0.74, 0.74],
    ],
    6: [
      [0.28, 0.24],
      [0.72, 0.24],
      [0.28, 0.5],
      [0.72, 0.5],
      [0.28, 0.76],
      [0.72, 0.76],
    ],
  };

  ctx.fillStyle = '#15120F';
  for (const [x, y] of layouts[value] ?? []) {
    ctx.beginPath();
    // Slightly irregular silhouette, as if carved into the printing block.
    for (let step = 0; step <= 24; step += 1) {
      const angle = step / 24 * Math.PI * 2;
      const radius = size * (0.081 + Math.sin(step * 2.1 + value) * 0.002);
      const px = x * size + Math.cos(angle) * radius;
      const py = y * size + Math.sin(angle) * radius;
      if (step === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

class DiceTable {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly world = new CANNON.World({ gravity: new CANNON.Vec3(0, -32, 0) });
  private readonly meshes: THREE.Mesh[] = [];
  private readonly bodies: CANNON.Body[] = [];
  private readonly sideWalls: CANNON.Body[] = [];
  private readonly ownedMaterials = new Set<THREE.Material>();
  private readonly materialCache = new Map<string, THREE.MeshStandardMaterial[]>();
  private readonly resizeHandler = () => this.resize();
  private still = 0;
  private frames = 0;
  private rolling = false;
  private frame: number | null = null;
  /** Set by the game once the app has said who is playing. */
  onSettled: ((dice: number[]) => void) | null = null;

  constructor(face: string, pip: string, count: number) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.camera.position.set(0, 9.5, 5.5);
    this.camera.lookAt(0, 0, 0);

    // Light from one side and slightly in front, so the pips have an edge and
    // the dice throw a real shadow. A flat ambient scene reads as a render.
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-4, 10, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -8;
    this.scene.add(key);

    // The table. It only exists to catch shadows — the felt colour comes from
    // the app so the canvas does not read as a foreign web page.
    const tableMaterial = new THREE.ShadowMaterial({ opacity: 0.45 });
    this.ownedMaterials.add(tableMaterial);
    const table = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), tableMaterial);
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    this.scene.add(table);

    this.world.defaultContactMaterial.restitution = 0.28;
    this.world.defaultContactMaterial.friction = 0.42;
    const ground = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(ground);

    // Walls, invisible, so a hard throw stays on the table.
    const wall = (x: number, z: number, ry: number) => {
      const body = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
      body.position.set(x, 0, z);
      body.quaternion.setFromEuler(0, ry, 0);
      this.world.addBody(body);
      return body;
    };
    // Keep the physical table inside the camera, including each die's edges.
    // A smaller table preserves large dice instead of zooming the camera out.
    wall(0, -2.8, 0);
    wall(0, 2.8, Math.PI);
    this.sideWalls.push(wall(-2.8, 0, Math.PI / 2), wall(2.8, 0, -Math.PI / 2));

    faceColour = face;
    pipColour = pip;
    const materials = this.buildMaterials(face, pip);

    for (let index = 0; index < count; index += 1) {
      const mesh = new THREE.Mesh(new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 3, 0.075), materials);
      mesh.castShadow = true;
      mesh.position.set((index - (count - 1) / 2) * 1.45, HALF, 0);
      mesh.rotation.set(0, index % 2 === 0 ? -0.22 : 0.19, 0);
      this.scene.add(mesh);
      this.meshes.push(mesh);

      const body = new CANNON.Body({
        mass: 0.32,
        shape: new CANNON.Box(new CANNON.Vec3(HALF, HALF, HALF)),
      });
      body.sleepSpeedLimit = REST_SPEED;
      this.world.addBody(body);
      this.bodies.push(body);
    }

    this.resize();
    window.addEventListener('resize', this.resizeHandler);
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const halfWidth = Math.min(3.2, 2.65 * this.camera.aspect);
    this.sideWalls.forEach((wall, index) => {
      wall.position.x = index === 0 ? -halfWidth : halfWidth;
      wall.aabbNeedsUpdate = true;
    });
    this.renderer.render(this.scene, this.camera);
  }

  private buildMaterials(face: string, pip: string): THREE.MeshStandardMaterial[] {
    const key = `${face}\u0000${pip}`;
    const cached = this.materialCache.get(key);
    if (cached) return cached;
    const materials = FACE_VALUES.map((value) => {
      const material = new THREE.MeshStandardMaterial({
        map: faceTexture(value, face),
        roughness: 0.86,
        metalness: 0,
      });
      this.ownedMaterials.add(material);
      return material;
    });
    this.materialCache.set(key, materials);
    return materials;
  }

  /**
   * Recolour the dice for whoever is throwing.
   *
   * Textures are rebuilt rather than tinted: a tint over an ivory face muddies
   * the pips, and the pips are the only thing on a die that has to stay legible
   * across a table.
   */
  setTint(face: string, pip: string): void {
    if (face === faceColour && pip === pipColour) return;
    faceColour = face;
    pipColour = pip;
    const materials = this.buildMaterials(face, pip);
    for (const mesh of this.meshes) {
      mesh.material = materials;
    }
  }

  private disposeMaterial(material: THREE.Material): void {
    if (!this.ownedMaterials.delete(material)) return;
    const mapped = material as THREE.Material & { map?: THREE.Texture | null };
    mapped.map?.dispose();
    material.dispose();
  }

  dispose(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.rolling = false;
    window.removeEventListener('resize', this.resizeHandler);
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) this.disposeMaterial(material);
    });
    for (const material of [...this.ownedMaterials]) this.disposeMaterial(material);
    this.materialCache.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  /** Throw them. The physics decides what comes up. */
  roll(): void {
    if (this.rolling) return;
    this.rolling = true;
    this.still = 0;
    this.frames = 0;

    this.bodies.forEach((body, index) => {
      const lane = index - (this.bodies.length - 1) / 2;
      body.wakeUp();
      body.position.set(lane * 1.6, 2.6 + index * 0.3, 1.2);
      body.quaternion.setFromEuler(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI,
      );
      // Thrown away from the camera and down the table, with spin. The numbers
      // are small enough that dice never fly off, big enough that they tumble.
      body.velocity.set((Math.random() - 0.5) * 4, -3, -4 - Math.random());
      body.angularVelocity.set(
        (Math.random() - 0.5) * 22,
        (Math.random() - 0.5) * 22,
        (Math.random() - 0.5) * 22,
      );
    });
    this.requestTick();
  }

  /** Which value is pointing up, for a die that has come to rest. */
  private valueOf(mesh: THREE.Mesh): number {
    let best = 0;
    let bestDot = -Infinity;
    FACE_NORMALS.forEach((normal, index) => {
      const world = normal.clone().applyQuaternion(mesh.quaternion);
      if (world.y > bestDot) {
        bestDot = world.y;
        best = index;
      }
    });
    return FACE_VALUES[best];
  }

  private hasLanded(body: CANNON.Body): boolean {
    const rotation = new THREE.Quaternion(
      body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w,
    );
    const faceUp = FACE_NORMALS.some((normal) =>
      normal.clone().applyQuaternion(rotation).y >= 0.999,
    );
    return faceUp && body.position.y <= HALF + 0.05;
  }

  private unstick(body: CANNON.Body): void {
    // A die can stop against a wall or another die while balanced on an edge.
    // Give it a physical shove towards the table; never choose or snap a face.
    body.wakeUp();
    body.applyImpulse(new CANNON.Vec3(-body.position.x * 0.45, 1.2, -body.position.z * 0.45));
    body.angularVelocity.set(
      (Math.random() - 0.5) * 8,
      (Math.random() - 0.5) * 8,
      (Math.random() - 0.5) * 8,
    );
  }

  private tick = (): void => {
    this.frame = null;
    this.world.step(1 / 60);

    this.bodies.forEach((body, index) => {
      const mesh = this.meshes[index];
      mesh.position.set(body.position.x, body.position.y, body.position.z);
      mesh.quaternion.set(
        body.quaternion.x,
        body.quaternion.y,
        body.quaternion.z,
        body.quaternion.w,
      );
    });

    if (this.rolling) {
      this.frames += 1;
      const moving = this.bodies.some(
        (body) => body.velocity.length() > REST_SPEED || body.angularVelocity.length() > REST_SPEED,
      );
      this.still = moving ? 0 : this.still + 1;

      if (this.still >= REST_FRAMES || this.frames > MAX_FRAMES) {
        const unlanded = this.bodies.filter((body) => !this.hasLanded(body));
        if (unlanded.length === 0 && !moving) {
          this.rolling = false;
          this.onSettled?.(this.meshes.map((mesh) => this.valueOf(mesh)));
        } else {
          unlanded.forEach((body) => this.unstick(body));
          this.still = 0;
          this.frames = 0;
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
    if (this.rolling) this.requestTick();
  };

  private requestTick(): void {
    if (this.frame === null) this.frame = requestAnimationFrame(this.tick);
  }
}

/**
 * Kostky, as the platform sees it: one command, one event.
 *
 * The app owns the rounds, the ladder and who ends up paying — see
 * `src/party/diceDuel.ts`, which has the rules and their tests. This page owns
 * a table and two cubes, and reports what they landed on. That split is why the
 * scoreboard survives a phone being passed around and why the rules can be
 * tested without rendering anything.
 */
connect({
  commands: [
    { name: 'roll', label: 'Hoď' },
    { name: 'next', label: 'Další kolo' },
  ],
  start(session: GameSession) {
    const count = Number(session.options.count ?? 2);
    const table = new DiceTable(session.theme.ink, session.theme.bg, count);

    // The game owns its own progression. The app draws the words from the
    // snapshots below and never recomputes any of this — one set of rules,
    // in one place, next to the thing it governs.
    const suppliedState = session.options.state;
    let state: DiceState =
      suppliedState && typeof suppliedState === 'object'
        ? (suppliedState as DiceState)
        : startDice(
            session.players.map((player) => ({
              id: player.id,
              tint: player.colour,
            })),
          );

    const colourOf = (id: string | null) =>
      session.players.find((player) => player.id === id)?.colour ?? session.theme.accent;
    let rollingPlayerId: string | null = null;
    let finished = false;

    const publish = () => {
      session.push(state);
      // The dice wear whoever is up next, so the table already belongs to them
      // while they are picking the phone up.
      table.setTint(colourOf(whoseTurn(state)), session.theme.bg);
      if (isOver(state) && !finished) {
        finished = true;
        session.finish({
          scores: standings(state).map((row) => ({ playerId: row.playerId, score: row.score })),
          // This is a drinking game: the payer is the ending, never a crowned
          // winner based on who accumulated the most round wins.
          winnerId: null,
          payingId: state.payingId,
        });
      }
    };

    table.onSettled = (dice) => {
      // Freeze the thrower when the command starts. A remote roll may hydrate
      // the canonical fold while these dice are still in the air; attributing
      // them to the newly-current player would turn two simultaneous throws
      // into two different turns instead of letting the reducer ignore one.
      const thrower = rollingPlayerId ?? whoseTurn(state);
      rollingPlayerId = null;
      if (!thrower) return;
      if (whoseTurn(state) === thrower) {
        state = recordRoll(state, thrower, [dice[0] ?? 1, dice[1] ?? 1]);
      }
      session.emit('settled', { dice, playerId: thrower });
      publish();
    };

    publish();

    window.addEventListener('pagehide', () => table.dispose(), { once: true });

    return (name, payload) => {
      if (finished) return;
      if (name === 'roll' && whoseTurn(state)) {
        rollingPlayerId = whoseTurn(state);
        table.roll();
      }
      else if (name === 'next') {
        state = settleRound(state);
        publish();
      } else if (name === 'sync') {
        // A shared phone folds the canonical append-only log in React Native.
        // Keep the physics host on that exact turn before its next throw; do
        // not publish this back or a hydration command would echo forever.
        if (payload && typeof payload === 'object') {
          state = payload as DiceState;
          table.setTint(colourOf(whoseTurn(state)), session.theme.bg);
        }
      }
    };
  },
});
