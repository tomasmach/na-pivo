// Mock A: a 3D pocket compass whose needle points at the download button.
// Motion only answers the visitor: pointer tilt and dragging the case.
// The loop stops once everything settles.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const host = document.querySelector('[data-compass]');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const C = {
  amber: 0xe8a317,
  brass: 0xa8740f,
  foam: 0xfbf3e0,
  foamMuted: 0xe8dcc0,
  stout: 0x1f1308,
  stout3: 0x3a2515,
};

// Without WebGL the pre-rendered still in the HTML stays in place.
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
} catch {
  throw new Error('WebGL unavailable, keeping the still');
}

renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
camera.position.set(0, 0, 11);

const key = new THREE.DirectionalLight(0xfff1d6, 1.4);
key.position.set(-4, 5, 6);
scene.add(key);

// The whole instrument. Local +Z faces the camera, +Y is north on the dial.
const compass = new THREE.Group();
scene.add(compass);

// Case: a lathed brass bezel, rotated so its axis faces the camera.
const profile = [
  [0, -0.32], [2.02, -0.32], [2.24, -0.24], [2.36, -0.04], [2.34, 0.18],
  [2.22, 0.32], [2.06, 0.34], [1.98, 0.26], [1.96, 0.14], [0, 0.14],
].map(([r, y]) => new THREE.Vector2(r, y));
const caseMesh = new THREE.Mesh(
  new THREE.LatheGeometry(profile, 128),
  new THREE.MeshStandardMaterial({ color: C.brass, metalness: 1, roughness: 0.38 }),
);
caseMesh.rotation.x = Math.PI / 2;
compass.add(caseMesh);

// Dial face drawn like the in-app compass: dark ring with ticks, foam disc, S V J Z.
function dialTexture() {
  const size = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const c = size / 2;
  g.fillStyle = '#2b1a0e';
  g.beginPath(); g.arc(c, c, c, 0, Math.PI * 2); g.fill();

  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const cardinal = i % 12 === 0;
    const r = c * 0.9;
    g.fillStyle = cardinal ? '#e8a317' : 'rgba(251,243,224,0.45)';
    g.beginPath();
    g.arc(c + Math.sin(a) * r, c - Math.cos(a) * r, cardinal ? 11 : 5, 0, Math.PI * 2);
    g.fill();
  }

  g.strokeStyle = '#e8a317';
  g.lineWidth = 6;
  g.beginPath(); g.arc(c, c, c * 0.8, 0, Math.PI * 2); g.stroke();

  g.fillStyle = '#fbf3e0';
  g.beginPath(); g.arc(c, c, c * 0.74, 0, Math.PI * 2); g.fill();

  g.strokeStyle = 'rgba(232,163,23,0.55)';
  g.lineWidth = 3;
  g.beginPath(); g.arc(c, c, c * 0.62, 0, Math.PI * 2); g.stroke();

  g.fillStyle = '#1f1308';
  g.font = '800 96px "Baloo 2"';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const r = c * 0.5;
  [['S', 0], ['V', 90], ['J', 180], ['Z', 270]].forEach(([l, deg]) => {
    const a = (deg * Math.PI) / 180;
    g.fillText(l, c + Math.sin(a) * r, c - Math.cos(a) * r + 6);
  });

  // Soft light from top-left, baked in because the dial is unlit.
  const shade = g.createLinearGradient(0, 0, size, size);
  shade.addColorStop(0, 'rgba(255,255,255,0.06)');
  shade.addColorStop(1, 'rgba(0,0,0,0.22)');
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = shade;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const dial = new THREE.Mesh(
  new THREE.CircleGeometry(1.97, 128),
  new THREE.MeshBasicMaterial({ toneMapped: false }),
);
dial.position.z = 0.141;
compass.add(dial);

// Needle: amber north half, foam south half, both extruded with a soft bevel.
function half(tip) {
  const s = new THREE.Shape();
  s.moveTo(0, tip);
  s.lineTo(0.24, 0);
  s.lineTo(-0.24, 0);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 3 });
}
const needle = new THREE.Group();
needle.position.z = 0.2;
// The amber half is flat paint in the exact brand colour, like the needle in the app.
needle.add(new THREE.Mesh(half(1.5), new THREE.MeshBasicMaterial({ color: C.amber, toneMapped: false })));
needle.add(new THREE.Mesh(half(-1.5), new THREE.MeshStandardMaterial({ color: C.foamMuted, metalness: 0.1, roughness: 0.55 })));
const hub = new THREE.Mesh(
  new THREE.CylinderGeometry(0.2, 0.2, 0.14, 48),
  new THREE.MeshStandardMaterial({ color: C.stout, roughness: 0.5 }),
);
hub.rotation.x = Math.PI / 2;
hub.position.z = 0.05;
needle.add(hub);
const cap = new THREE.Mesh(
  new THREE.CylinderGeometry(0.09, 0.09, 0.16, 32),
  new THREE.MeshStandardMaterial({ color: C.amber, metalness: 0.8, roughness: 0.25 }),
);
cap.rotation.x = Math.PI / 2;
cap.position.z = 0.06;
needle.add(cap);
compass.add(needle);

// Glass: barely there, it only catches reflections.
const glass = new THREE.Mesh(
  new THREE.CylinderGeometry(1.99, 1.99, 0.03, 128),
  new THREE.MeshPhysicalMaterial({
    color: 0xffffff, transparent: true, opacity: 0.1, roughness: 0.02, metalness: 0, clearcoat: 1, envMapIntensity: 2,
  }),
);
glass.rotation.x = Math.PI / 2;
glass.position.z = 0.3;
compass.add(glass);

// State. Base pose leans back a little, like a compass lying in a palm.
const BASE = { x: -0.42, y: 0.12 };
const tilt = { x: BASE.x, y: BASE.y, tx: BASE.x, ty: BASE.y };
const spin = { z: 0.35, v: 0 };
const needleState = { a: 0, v: 0, target: 0 };

const primary = () => document.querySelector('.hero .store.is-primary') || document.querySelector('.hero .store');

function resize() {
  const { width, height } = host.getBoundingClientRect();
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  // Keep the whole case in view on narrow layouts.
  camera.position.z = width < 600 ? 9.6 : width / height < 1 ? 12.5 / (width / height) ** 0.6 : 12.5;
  camera.updateProjectionMatrix();
  kick();
}

const ray = new THREE.Raycaster();
const plane = new THREE.Plane();
const hit = new THREE.Vector3();
const normal = new THREE.Vector3();

// Angle, in the dial's own plane, from the centre to the target element on screen.
function targetAngle() {
  const el = primary();
  if (!el) return needleState.target;
  const r = el.getBoundingClientRect();
  const c = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((r.left + r.width / 2 - c.left) / c.width) * 2 - 1,
    -(((r.top + r.height / 2 - c.top) / c.height) * 2 - 1),
  );
  compass.updateMatrixWorld();
  normal.set(0, 0, 1).applyQuaternion(compass.quaternion);
  plane.setFromNormalAndCoplanarPoint(normal, compass.position);
  ray.setFromCamera(ndc, camera);
  if (!ray.ray.intersectPlane(plane, hit)) return needleState.target;
  const local = compass.worldToLocal(hit.clone());
  return Math.atan2(local.y, local.x) - Math.PI / 2;
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

let running = false;
let last = 0;
function kick() {
  if (running) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(frame);
}

function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;

  tilt.x += (tilt.tx - tilt.x) * (reduced ? 1 : 1 - Math.exp(-dt * 6));
  tilt.y += (tilt.ty - tilt.y) * (reduced ? 1 : 1 - Math.exp(-dt * 6));
  compass.rotation.set(tilt.x, tilt.y, spin.z);

  spin.z += spin.v * dt;
  spin.v = reduced ? 0 : spin.v * Math.exp(-dt * 3);
  if (Math.abs(spin.v) < 0.01) spin.v = 0;

  needleState.target = targetAngle();
  // The needle hangs on a damped spring, like the real thing: a small overshoot, then rest.
  if (reduced) {
    needleState.a = needleState.target;
    needleState.v = 0;
  } else {
    const d = wrap(needleState.target - needleState.a);
    needleState.v += (d * 38 - needleState.v * 4.2) * dt;
    needleState.a += needleState.v * dt;
  }
  needle.rotation.z = needleState.a;

  renderer.render(scene, camera);

  const settled =
    Math.abs(tilt.tx - tilt.x) < 1e-4 &&
    Math.abs(tilt.ty - tilt.y) < 1e-4 &&
    spin.v === 0 &&
    Math.abs(wrap(needleState.target - needleState.a)) < 1e-3 &&
    Math.abs(needleState.v) < 1e-3;
  if (settled && !dragging) {
    running = false;
    return;
  }
  requestAnimationFrame(frame);
}

// Pointer tilt: the compass leans slightly toward the cursor. Skipped with reduced motion.
addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || reduced) return;
  const nx = (e.clientX / innerWidth) * 2 - 1;
  const ny = (e.clientY / innerHeight) * 2 - 1;
  tilt.ty = BASE.y + nx * 0.28;
  tilt.tx = BASE.x + ny * 0.18;
  kick();
}, { passive: true });

// Drag the case around. The needle keeps pointing at the same spot, as a compass should.
let dragging = false;
let lastX = 0;
host.addEventListener('pointerdown', (e) => {
  dragging = true;
  lastX = e.clientX;
  host.setPointerCapture(e.pointerId);
  kick();
});
host.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  lastX = e.clientX;
  spin.z -= dx * 0.008;
  if (!reduced) spin.v = -dx * 0.5;
});
const release = () => { dragging = false; kick(); };
host.addEventListener('pointerup', release);
host.addEventListener('pointercancel', release);

addEventListener('scroll', kick, { passive: true });
new ResizeObserver(resize).observe(host);

// One load moment: the needle starts at north and swings to the button.
document.fonts.load('800 96px "Baloo 2"').finally(() => {
  dial.material.map = dialTexture();
  dial.material.needsUpdate = true;
  host.querySelector('.still')?.remove();
  resize();
  setTimeout(kick, reduced ? 0 : 350);
});
