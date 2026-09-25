// Mock B: a paper beer coaster on an oak pub table. Tap it (or press Enter on it) to add a tally mark.
// Rendering is on demand: a frame is drawn only when the visitor does something.
import * as THREE from 'three';

const host = document.querySelector('[data-scene]');
const hitButton = document.querySelector('[data-hit]');
const undoButton = document.querySelector('[data-undo]');
const readout = document.getElementById('tally-state');
const hint = document.querySelector('.tally .hint');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const MAX_MARKS = 20;
let marks = 0;

// Without WebGL the still stays and the tally controls remain hidden.
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch {
  throw new Error('WebGL unavailable, keeping the still');
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a0f07);
const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);

// Table.
const loader = new THREE.TextureLoader();
const wood = loader.load('assets/gen/oak-table.webp', () => requestRender());
wood.colorSpace = THREE.SRGBColorSpace;
wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
wood.repeat.set(2.4, 1.6);
wood.anisotropy = 8;
const table = new THREE.Mesh(
  new THREE.PlaneGeometry(26, 17),
  new THREE.MeshStandardMaterial({ map: wood, roughness: 0.72, metalness: 0 }),
);
table.rotation.x = -Math.PI / 2;
table.receiveShadow = true;
scene.add(table);

// A warm lamp over the table and a dim fill; the falloff darkens the edges on its own.
scene.add(new THREE.HemisphereLight(0xffeedd, 0x1a0f07, 0.22));
const lamp = new THREE.SpotLight(0xfff0dc, 150, 0, 0.62, 1, 2);
lamp.position.set(-1.2, 8.5, 2.2);
lamp.castShadow = true;
lamp.shadow.mapSize.set(2048, 2048);
lamp.shadow.radius = 6;
lamp.shadow.bias = -0.0004;
scene.add(lamp, lamp.target);

// Coaster face, drawn on a canvas so marks can be added.
const face = document.createElement('canvas');
face.width = face.height = 1024;
const g = face.getContext('2d');
const faceTex = new THREE.CanvasTexture(face);
faceTex.colorSpace = THREE.SRGBColorSpace;
faceTex.anisotropy = 8;

const logo = new Image();
logo.src = 'assets/icon-512.png';

// Deterministic wobble so each mark looks hand drawn but never changes on redraw.
function wobble(i, k) {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}

function markSegment(i) {
  const group = Math.floor(i / 5);
  const inGroup = i % 5;
  const row = Math.floor(group / 2);
  const col = group % 2;
  const gx = 512 - 205 + col * 250;
  const gy = 468 + row * 215;
  if (inGroup < 4) {
    const x = gx + inGroup * 42 + wobble(i, 1) * 8;
    return [x + wobble(i, 2) * 12, gy - 85 + wobble(i, 3) * 10, x + wobble(i, 4) * 12, gy + 85 + wobble(i, 5) * 10];
  }
  return [gx - 26, gy + 70 + wobble(i, 6) * 10, gx + 156, gy - 62 + wobble(i, 7) * 10];
}

function drawFace(progress = 1) {
  const c = 512;
  g.clearRect(0, 0, 1024, 1024);
  g.fillStyle = '#fbf3e0';
  g.fillRect(0, 0, 1024, 1024);

  // Paper grain.
  for (let i = 0; i < 2600; i++) {
    const x = (wobble(i, 11) + 0.5) * 1024;
    const y = (wobble(i, 12) + 0.5) * 1024;
    g.fillStyle = `rgba(90,60,30,${0.04 + (wobble(i, 13) + 0.5) * 0.05})`;
    g.fillRect(x, y, 2, 2);
  }

  g.lineWidth = 30;
  g.strokeStyle = '#e8a317';
  g.beginPath(); g.arc(c, c, 470, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 5;
  g.strokeStyle = '#1f1308';
  g.beginPath(); g.arc(c, c, 432, 0, Math.PI * 2); g.stroke();

  if (logo.complete) g.drawImage(logo, c - 44, 128, 88, 88);
  g.fillStyle = '#1f1308';
  g.font = '800 64px "Baloo 2"';
  g.textAlign = 'center';
  g.fillText('Na pivo', c, 290);

  g.lineCap = 'round';
  g.lineWidth = 14;
  g.strokeStyle = 'rgba(52,46,40,0.9)';
  for (let i = 0; i < marks; i++) {
    const [x1, y1, x2, y2] = markSegment(i);
    const t = i === marks - 1 ? progress : 1;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
    g.stroke();
  }
  faceTex.needsUpdate = true;
}

const R = 1.55;
const cardboard = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.95 });
const coaster = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.08, 128), [
  cardboard,
  new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.9 }),
  cardboard,
]);
coaster.castShadow = true;
coaster.receiveShadow = true;
coaster.position.y = 0.04;
// Turn the printed face so the wordmark reads toward the viewer.
coaster.rotation.y = Math.PI / 2;
const coasterRig = new THREE.Group();
coasterRig.add(coaster);
coasterRig.rotation.y = -0.18;
scene.add(coasterRig);

// A yellow hexagonal pencil, the kind every Czech pub has behind the bar.
const pencil = new THREE.Group();
const body = new THREE.Mesh(
  new THREE.CylinderGeometry(0.08, 0.08, 2.5, 6),
  new THREE.MeshStandardMaterial({ color: 0xe8a317, roughness: 0.45 }),
);
const woodTip = new THREE.Mesh(
  new THREE.ConeGeometry(0.08, 0.3, 6),
  new THREE.MeshStandardMaterial({ color: 0xe8c99a, roughness: 0.8 }),
);
woodTip.position.y = 1.4;
const lead = new THREE.Mesh(
  new THREE.ConeGeometry(0.028, 0.1, 12),
  new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.4, metalness: 0.3 }),
);
lead.position.y = 1.52;
const endCap = new THREE.Mesh(
  new THREE.CylinderGeometry(0.081, 0.081, 0.12, 6),
  new THREE.MeshStandardMaterial({ color: 0x1f1308, roughness: 0.4 }),
);
endCap.position.y = -1.3;
[body, woodTip, lead, endCap].forEach((m) => { m.castShadow = true; pencil.add(m); });
pencil.rotation.set(0, 0, Math.PI / 2);
const pencilRig = new THREE.Group();
pencilRig.add(pencil);
pencilRig.position.y = 0.08;
pencilRig.rotation.y = 0.62;
scene.add(pencilRig);

// Layout: on wide screens the coaster sits right of the headline; on phones it is centred.
const view = { wide: true, cam: new THREE.Vector3(), look: new THREE.Vector3(), px: 0, py: 0, tx: 0, ty: 0 };

function layout() {
  const { width, height } = host.getBoundingClientRect();
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  view.wide = width / height > 1.15;
  if (view.wide) {
    coasterRig.position.set(2.65, 0, 0.35);
    pencilRig.position.set(4.95, 0.08, 1.2);
    view.cam.set(0.4, 6.9, 5.6);
    view.look.set(0.9, 0, 0.1);
  } else {
    coasterRig.position.set(0, 0, 0);
    pencilRig.position.set(1.9, 0.08, 1.5);
    view.cam.set(0, 7.2, 4.6);
    view.look.set(0.1, 0, 0.35);
  }
  lamp.target.position.copy(coasterRig.position);
  camera.updateProjectionMatrix();
  requestRender();
}

// Keep the invisible button exactly over the coaster, so a tap and a keypress do the same thing.
const tmp = new THREE.Vector3();
function project(v) {
  tmp.copy(v).project(camera);
  const r = renderer.domElement.getBoundingClientRect();
  const hr = host.parentElement.getBoundingClientRect();
  return { x: r.left - hr.left + (tmp.x * 0.5 + 0.5) * r.width, y: r.top - hr.top + (-tmp.y * 0.5 + 0.5) * r.height };
}
function placeHit() {
  const p = coasterRig.position;
  const pts = [
    new THREE.Vector3(p.x - R, 0.08, p.z), new THREE.Vector3(p.x + R, 0.08, p.z),
    new THREE.Vector3(p.x, 0.08, p.z - R), new THREE.Vector3(p.x, 0.08, p.z + R),
  ].map(project);
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  Object.assign(hitButton.style, {
    left: `${Math.min(...xs)}px`,
    top: `${Math.min(...ys)}px`,
    width: `${Math.max(...xs) - Math.min(...xs)}px`,
    height: `${Math.max(...ys) - Math.min(...ys)}px`,
  });
}

// Animation state: stroke drawing, coaster pop, camera parallax.
let strokeStart = -1;
let popStart = -1;
let pending = false;

function requestRender() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(frame);
}

function frame(now) {
  pending = false;
  let busy = false;

  if (strokeStart >= 0) {
    const t = Math.min((now - strokeStart) / 170, 1);
    drawFace(1 - (1 - t) ** 2);
    if (t < 1) busy = true; else strokeStart = -1;
  }

  if (popStart >= 0) {
    const t = now - popStart;
    let s = 1;
    if (t < 130) s = 1 + 0.035 * (t / 130);
    else if (t < 310) s = 1 + 0.035 * (1 - (t - 130) / 180);
    else popStart = -1;
    coaster.scale.setScalar(s);
    if (popStart >= 0) busy = true;
  }

  view.px += (view.tx - view.px) * 0.12;
  view.py += (view.ty - view.py) * 0.12;
  if (Math.abs(view.tx - view.px) > 1e-4 || Math.abs(view.ty - view.py) > 1e-4) busy = true;
  camera.position.set(view.cam.x + view.px * 0.5, view.cam.y, view.cam.z + view.py * 0.35);
  camera.lookAt(view.look);

  renderer.render(scene, camera);
  placeHit();
  if (busy) requestRender();
}

const plural = (n) => (n === 1 ? 'pivo' : n >= 2 && n <= 4 ? 'piva' : 'piv');

function sync() {
  undoButton.disabled = marks === 0;
  hitButton.setAttribute('aria-disabled', String(marks >= MAX_MARKS));
  if (marks === 0) {
    readout.textContent = 'Čistej tácek.';
    hint.textContent = 'Ťukni na tácek.';
  } else if (marks >= MAX_MARKS) {
    readout.textContent = `${marks} piv`;
    hint.textContent = 'Víc se jich sem nevejde. Do appky jo.';
  } else {
    readout.textContent = `${marks} ${plural(marks)}`;
    hint.textContent = marks % 5 === 4 ? 'Pátá čárka se škrtá.' : 'Ještě jedno?';
  }
}

function addMark() {
  if (marks >= MAX_MARKS) return;
  marks += 1;
  sync();
  if (reduced) {
    drawFace();
  } else {
    strokeStart = performance.now();
    popStart = performance.now();
  }
  requestRender();
}

function removeMark() {
  if (marks === 0) return;
  marks -= 1;
  drawFace();
  sync();
  requestRender();
}

hitButton.addEventListener('click', addMark);
undoButton.addEventListener('click', removeMark);

addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || reduced) return;
  view.tx = (e.clientX / innerWidth) * 2 - 1;
  view.ty = (e.clientY / innerHeight) * 2 - 1;
  requestRender();
}, { passive: true });

new ResizeObserver(layout).observe(host);

Promise.all([
  document.fonts.load('800 64px "Baloo 2"'),
  logo.decode().catch(() => {}),
]).finally(() => {
  drawFace();
  sync();
  host.querySelector('.still')?.remove();
  hitButton.hidden = false;
  document.querySelector('.tally').hidden = false;
  layout();
});
