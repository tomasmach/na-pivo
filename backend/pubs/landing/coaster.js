// Home page hero: a paper beer coaster on an oak pub table. Tap it (or press Enter on it) to add a
// tally mark. A frame is drawn only when the visitor does something; nothing moves on its own.
//
// Source for pubs/static/pubs/landing/coaster.min.js. Rebuild with scripts/build_landing.sh.
import {
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  SpotLight,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from 'three';

const host = document.querySelector('[data-scene]');
const hero = host.parentElement;
const hitButton = document.querySelector('[data-hit]');
const tally = document.querySelector('[data-tally]');
const undoButton = tally.querySelector('[data-undo]');
const readout = tally.querySelector('output');
const hint = tally.querySelector('[data-hint]');
const copy = JSON.parse(document.getElementById('landing-copy').textContent);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const MAX_MARKS = 20;
let marks = 0;

// Without WebGL the pre-rendered still stays and the tally controls remain hidden.
let renderer;
try {
  renderer = new WebGLRenderer({ antialias: true });
} catch {
  throw new Error('WebGL unavailable, keeping the still');
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;

const scene = new Scene();
scene.background = new Color(0x1a0f07);
const camera = new PerspectiveCamera(34, 1, 0.1, 100);

// Table.
const wood = new TextureLoader().load(host.dataset.wood, () => {
  woodReady = true;
  reveal();
});
let woodReady = false;
wood.colorSpace = SRGBColorSpace;
wood.wrapS = wood.wrapT = RepeatWrapping;
wood.repeat.set(2.4, 1.6);
wood.anisotropy = 8;
const table = new Mesh(new PlaneGeometry(26, 17), new MeshStandardMaterial({ map: wood, roughness: 0.72 }));
table.rotation.x = -Math.PI / 2;
table.receiveShadow = true;
scene.add(table);

// A warm lamp over the table and a dim fill; the falloff darkens the edges on its own.
scene.add(new HemisphereLight(0xffeedd, 0x1a0f07, 0.22));
const lamp = new SpotLight(0xfff0dc, 150, 0, 0.62, 1, 2);
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
const faceTex = new CanvasTexture(face);
faceTex.colorSpace = SRGBColorSpace;
faceTex.anisotropy = 8;

const logo = new Image();
logo.src = host.dataset.logo;

// Deterministic noise so marks and paper look hand made but never change on redraw.
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

// A pencil line is a few thin passes, not one clean stroke.
function pencilLine(i, x1, y1, x2, y2) {
  for (let pass = 0; pass < 4; pass++) {
    const ox = wobble(i * 7 + pass, 21) * 5;
    const oy = wobble(i * 7 + pass, 22) * 5;
    g.globalAlpha = 0.5 + pass * 0.12;
    g.lineWidth = pass === 3 ? 9 : 5;
    g.beginPath();
    g.moveTo(x1 + ox, y1 + oy);
    g.lineTo(x2 + ox * 0.6, y2 + oy * 0.6);
    g.stroke();
  }
  g.globalAlpha = 1;
}

function drawFace(progress = 1) {
  const c = 512;
  g.fillStyle = '#fbf3e0';
  g.fillRect(0, 0, 1024, 1024);

  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(90,60,30,${0.04 + (wobble(i, 13) + 0.5) * 0.05})`;
    g.fillRect((wobble(i, 11) + 0.5) * 1024, (wobble(i, 12) + 0.5) * 1024, 2, 2);
  }

  // The ring a wet mug leaves behind, off centre, like on every coaster that has seen a night.
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(196,132,26,0.1)';
  g.beginPath();
  g.arc(c + 235, c + 250, 175, Math.PI * 0.9, Math.PI * 1.9);
  g.stroke();

  g.lineWidth = 30;
  g.strokeStyle = '#e8a317';
  g.beginPath(); g.arc(c, c, 470, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 5;
  g.strokeStyle = '#1f1308';
  g.beginPath(); g.arc(c, c, 432, 0, Math.PI * 2); g.stroke();

  if (logo.complete && logo.naturalWidth) g.drawImage(logo, c - 44, 128, 88, 88);
  g.fillStyle = '#1f1308';
  g.font = '800 64px "Baloo 2"';
  g.textAlign = 'center';
  g.fillText('Na pivo', c, 290);

  g.lineCap = 'round';
  g.strokeStyle = '#342e28';
  for (let i = 0; i < marks; i++) {
    const [x1, y1, x2, y2] = markSegment(i);
    const t = i === marks - 1 ? progress : 1;
    pencilLine(i, x1, y1, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
  }
  faceTex.needsUpdate = true;
}

const R = 1.55;
const cardboard = new MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.95 });
const coaster = new Mesh(new CylinderGeometry(R, R, 0.08, 128), [
  cardboard,
  new MeshStandardMaterial({ map: faceTex, roughness: 0.9 }),
  cardboard,
]);
coaster.castShadow = true;
coaster.receiveShadow = true;
coaster.position.y = 0.04;
// Turn the printed face so the wordmark reads toward the viewer.
coaster.rotation.y = Math.PI / 2;
const coasterRig = new Group();
coasterRig.add(coaster);
coasterRig.rotation.y = -0.18;
scene.add(coasterRig);

// A yellow hexagonal pencil, the kind every Czech pub keeps behind the bar.
const pencil = new Group();
const part = (geometry, color, y, extra = {}) => {
  const m = new Mesh(geometry, new MeshStandardMaterial({ color, roughness: 0.5, ...extra }));
  m.position.y = y;
  m.castShadow = true;
  pencil.add(m);
};
part(new CylinderGeometry(0.08, 0.08, 2.5, 6), 0xe8a317, 0, { roughness: 0.45 });
part(new ConeGeometry(0.08, 0.3, 6), 0xe8c99a, 1.4, { roughness: 0.8 });
part(new ConeGeometry(0.028, 0.1, 12), 0x2a2622, 1.52, { roughness: 0.4, metalness: 0.3 });
part(new CylinderGeometry(0.081, 0.081, 0.12, 6), 0x1f1308, -1.3, { roughness: 0.4 });
pencil.rotation.set(0, 0, Math.PI / 2);
const pencilRig = new Group();
pencilRig.add(pencil);
pencilRig.rotation.y = 0.62;
scene.add(pencilRig);

// On wide screens the coaster sits right of the headline; on phones it is centred.
const view = { cam: new Vector3(), look: new Vector3(), px: 0, py: 0, tx: 0, ty: 0 };

function layout() {
  const { width, height } = host.getBoundingClientRect();
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  if (width / height > 1.15) {
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

// Keep the hit button exactly over the coaster, so a tap and a keypress do the same thing.
const tmp = new Vector3();
function project(x, z) {
  tmp.set(x, 0.08, z).project(camera);
  const r = renderer.domElement.getBoundingClientRect();
  const hr = hero.getBoundingClientRect();
  return [r.left - hr.left + (tmp.x * 0.5 + 0.5) * r.width, r.top - hr.top + (-tmp.y * 0.5 + 0.5) * r.height];
}
function placeHit() {
  const p = coasterRig.position;
  const pts = [project(p.x - R, p.z), project(p.x + R, p.z), project(p.x, p.z - R), project(p.x, p.z + R)];
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  Object.assign(hitButton.style, {
    left: `${Math.min(...xs)}px`,
    top: `${Math.min(...ys)}px`,
    width: `${Math.max(...xs) - Math.min(...xs)}px`,
    height: `${Math.max(...ys) - Math.min(...ys)}px`,
  });
}

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

  // One pop per new mark (DESIGN.md §10): up in 130 ms, back in 180 ms.
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

function beers(n) {
  const form = n === 1 ? copy.one : n >= 2 && n <= 4 ? copy.few : copy.many;
  return `${n} ${form}`;
}

function sync() {
  undoButton.disabled = marks === 0;
  hitButton.setAttribute('aria-disabled', String(marks >= MAX_MARKS));
  readout.textContent = marks === 0 ? copy.empty : beers(marks);
  if (marks === 0) hint.textContent = copy.tap;
  else if (marks >= MAX_MARKS) hint.textContent = copy.full;
  else hint.textContent = marks % 5 === 4 ? copy.fifth : copy.more;
}

hitButton.addEventListener('click', () => {
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
});

undoButton.addEventListener('click', () => {
  if (marks === 0) return;
  marks -= 1;
  drawFace();
  sync();
  requestRender();
});

// The camera leans a little toward the mouse, only while the hero is on screen.
let heroVisible = true;
new IntersectionObserver(([entry]) => { heroVisible = entry.isIntersecting; }).observe(hero);
addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || reduced || !heroVisible) return;
  view.tx = (e.clientX / innerWidth) * 2 - 1;
  view.ty = (e.clientY / innerHeight) * 2 - 1;
  requestRender();
}, { passive: true });

// Swap the still for the live scene only once the table texture and the face are ready.
let faceReady = false;
function reveal() {
  if (!woodReady || !faceReady) return;
  host.appendChild(renderer.domElement);
  new ResizeObserver(layout).observe(host);
  layout();
  requestAnimationFrame(() => {
    host.querySelector('.still')?.remove();
    hitButton.hidden = false;
    tally.hidden = false;
  });
}

Promise.all([
  document.fonts.load('800 64px "Baloo 2"'),
  logo.decode().catch(() => {}),
]).finally(() => {
  drawFace();
  sync();
  faceReady = true;
  reveal();
});
