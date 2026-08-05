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

/** The RN side listens for these. Keep in step with `WebGame.tsx`. */
type OutMessage =
  | { type: 'ready' }
  | { type: 'settled'; dice: number[] }
  | { type: 'error'; message: string };

interface Theme {
  bg: string;
  felt: string;
  face: string;
  pip: string;
}

const DIE_SIZE = 1;
const HALF = DIE_SIZE / 2;
/** How still a die has to be before we call it landed. */
const REST_SPEED = 0.12;
const REST_FRAMES = 12;
/** A throw that somehow never settles must not hang the game. */
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

function post(message: OutMessage): void {
  const bridge = (window as unknown as { ReactNativeWebView?: { postMessage(s: string): void } })
    .ReactNativeWebView;
  if (bridge) {
    bridge.postMessage(JSON.stringify(message));
    return;
  }
  // No app on the other end: hand it to the browser harness instead, so the
  // page behaves identically in both places.
  (window as unknown as { __napivoOnMessage?: (m: OutMessage) => void }).__napivoOnMessage?.(
    message,
  );
}

/**
 * A die face, drawn to a canvas.
 *
 * Textures rather than geometry for the pips: six little spheres per die is
 * twelve more bodies for the renderer to sort, and at this size nobody can tell.
 */
function faceTexture(value: number, theme: Theme): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = theme.face;
  ctx.fillRect(0, 0, size, size);

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

  ctx.fillStyle = theme.pip;
  for (const [x, y] of layouts[value] ?? []) {
    ctx.beginPath();
    ctx.arc(x * size, y * size, size * 0.085, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
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
  private still = 0;
  private frames = 0;
  private rolling = false;

  constructor(private readonly theme: Theme, count: number) {
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
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.ShadowMaterial({ opacity: 0.45 }),
    );
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
    };
    wall(0, -5, 0);
    wall(0, 5, Math.PI);
    wall(-4.2, 0, Math.PI / 2);
    wall(4.2, 0, -Math.PI / 2);

    const materials = FACE_VALUES.map(
      (value) =>
        new THREE.MeshStandardMaterial({
          map: faceTexture(value, theme),
          roughness: 0.42,
          metalness: 0.02,
        }),
    );

    for (let index = 0; index < count; index += 1) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE), materials);
      mesh.castShadow = true;
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
    window.addEventListener('resize', () => this.resize());
    this.tick();
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Throw them. The physics decides what comes up. */
  roll(): void {
    this.rolling = true;
    this.still = 0;
    this.frames = 0;

    this.bodies.forEach((body, index) => {
      const lane = index - (this.bodies.length - 1) / 2;
      body.wakeUp();
      body.position.set(lane * 1.6, 4.2 + index * 0.6, 2.4);
      body.quaternion.setFromEuler(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI,
      );
      // Thrown away from the camera and down the table, with spin. The numbers
      // are small enough that dice never fly off, big enough that they tumble.
      body.velocity.set((Math.random() - 0.5) * 4, -3, -6 - Math.random() * 2);
      body.angularVelocity.set(
        (Math.random() - 0.5) * 22,
        (Math.random() - 0.5) * 22,
        (Math.random() - 0.5) * 22,
      );
    });
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

  private tick = (): void => {
    requestAnimationFrame(this.tick);
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

      // Settled, or gave up waiting. Either way the table has an answer, and a
      // game that hangs on a stuck die is worse than one that reads it early.
      if (this.still >= REST_FRAMES || this.frames > MAX_FRAMES) {
        this.rolling = false;
        post({ type: 'settled', dice: this.meshes.map((mesh) => this.valueOf(mesh)) });
      }
    }

    this.renderer.render(this.scene, this.camera);
  };
}

/**
 * The browser harness: a throw button and a readout, only when nothing is
 * listening on the bridge.
 *
 * Guarded on `ReactNativeWebView` rather than a build flag, so there is exactly
 * one build and no way for the harness to reach the app.
 */
function attachDevHarness(table: DiceTable): void {
  const bar = document.createElement('div');
  bar.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;display:flex;gap:12px;align-items:center;' +
    'justify-content:center;padding:16px;font:600 15px -apple-system,system-ui,sans-serif;';

  const button = document.createElement('button');
  button.textContent = 'Hoď';
  button.style.cssText =
    'padding:14px 44px;border:0;border-radius:999px;background:#E8A317;color:#15120F;' +
    'font:800 17px -apple-system,system-ui,sans-serif;';
  button.onclick = () => table.roll();

  const readout = document.createElement('span');
  readout.style.cssText = 'color:#FBF6EA;opacity:.75;min-width:90px;';
  readout.textContent = '—';

  bar.append(button, readout);
  document.body.appendChild(bar);

  // Same channel the app listens on, so the harness proves the real contract
  // rather than a parallel one that can quietly diverge.
  (window as unknown as { __napivoOnMessage?: (m: OutMessage) => void }).__napivoOnMessage = (
    message,
  ) => {
    if (message.type === 'settled') {
      const sum = message.dice.reduce((a, b) => a + b, 0);
      readout.textContent = `${message.dice.join(' + ')} = ${sum}`;
    }
  };
}

function boot(): void {
  const params = new URLSearchParams(window.location.search);
  const theme: Theme = {
    bg: params.get('bg') ?? '#15120F',
    felt: params.get('felt') ?? '#1C1815',
    face: params.get('face') ?? '#FBF6EA',
    pip: params.get('pip') ?? '#15120F',
  };
  document.body.style.background = theme.bg;

  const table = new DiceTable(theme, Number(params.get('count') ?? 2));
  (window as unknown as { napivoRoll(): void }).napivoRoll = () => table.roll();

  const inApp = Boolean(
    (window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView,
  );
  if (!inApp) attachDevHarness(table);

  post({ type: 'ready' });
}

try {
  boot();
} catch (error) {
  post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
}
