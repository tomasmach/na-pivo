// Mock C: a dimpled Czech mug that fills as you scroll through the evening.
// The beer only moves when the page scrolls; dragging turns the mug. Nothing loops on its own.
import * as THREE from 'three';

const host = document.querySelector('[data-mug]');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Opaque canvas in the page colour: transmission needs a real background to refract.
const BG = 0x15120f;
// Without WebGL the pre-rendered still in the HTML stays in place.
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch {
  throw new Error('WebGL unavailable, keeping the still');
}
renderer.setClearColor(BG);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
const pmrem = new THREE.PMREMGenerator(renderer);

// A small photo studio for reflections: two tall softboxes and a top panel. Glass on a dark page
// reads through its highlights, so these do most of the work.
function studio() {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x0a0806);
  const panel = (w, h, color, power, x, y, z) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide }),
    );
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(2.4, 10, 0xfff1d6, 7, -6, 1, 4);
  panel(1.4, 10, 0xffd48a, 5, 6.5, 1, -1.5);
  panel(9, 2.5, 0xfff1d6, 1.6, 0, 8, 0);
  // Two narrow strips behind the camera: the dimples show up where they bend these reflections.
  panel(0.8, 10, 0xfff1d6, 3, -2.5, 1, 7);
  panel(0.8, 10, 0xfff1d6, 3, 3, 1, 6.5);
  return pmrem.fromScene(env, 0.02).texture;
}
scene.environment = studio();

const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);

const key = new THREE.DirectionalLight(0xfff0dc, 2.2);
key.position.set(-4, 6, 5);
const rim = new THREE.DirectionalLight(0xffc56b, 3);
rim.position.set(5, 3, -4);
scene.add(key, rim);

// Dimples: a height map of rounded ovals around the mug, turned into a normal map.
function dimpleNormalMap() {
  const W = 1024;
  const H = 512;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  const cols = 9;
  const rows = [0.3, 0.55, 0.8];
  const cw = W / cols;
  rows.forEach((v, ri) => {
    for (let i = 0; i < cols; i++) {
      const x = cw * (i + 0.5 + (ri % 2) * 0.5);
      const y = H * (1 - v);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      grad.addColorStop(0, '#222');
      grad.addColorStop(0.8, '#444');
      grad.addColorStop(1, '#fff');
      for (const dx of [0, -W, W]) {
        g.save();
        g.translate(x + dx, y);
        g.scale(cw * 0.4, H * 0.105);
        g.fillStyle = grad;
        g.beginPath();
        g.arc(0, 0, 1, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }
  });
  const src = g.getImageData(0, 0, W, H).data;
  const out = g.createImageData(W, H);
  const h = (x, y) => src[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  const s = 5;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * s;
      const dy = (h(x, y + 1) - h(x, y - 1)) * s;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * W + x) * 4;
      out.data[o] = ((-dx / len) * 0.5 + 0.5) * 255;
      out.data[o + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out.data[o + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out.data[o + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

// Clear glass: no diffuse colour, only reflections, lightly tinting whatever is behind it.
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0x000000,
  roughness: 0.03,
  metalness: 0,
  transparent: true,
  opacity: 0.24,
  depthWrite: false,
  clearcoat: 1,
  clearcoatRoughness: 0.03,
  envMapIntensity: 2.4,
});
const dimpledGlass = glassMat.clone();
dimpledGlass.normalMap = dimpleNormalMap();
dimpledGlass.normalScale = new THREE.Vector2(2.4, 2.4);

const mug = new THREE.Group();
scene.add(mug);

// Contact shadow, so the mug stands on something instead of floating.
{
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(0,0,0,0.75)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 3.6),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.01;
  scene.add(shadow);
}

const v2 = (pts) => pts.map(([r, y]) => new THREE.Vector2(r, y));
const INNER_R = 0.94;
const FLOOR = 0.3;
const RIM = 2.6;

const outer = new THREE.Mesh(new THREE.LatheGeometry(v2([
  [0.001, 0], [0.9, 0], [0.99, 0.05], [1.02, 0.18], [1.08, 0.7], [1.1, 1.3], [1.08, 1.95], [1.03, 2.5], [1.01, RIM], [0.97, RIM + 0.03],
]), 96), dimpledGlass);
const inner = new THREE.Mesh(new THREE.LatheGeometry(v2([
  [0.97, RIM + 0.03], [INNER_R, RIM - 0.02], [INNER_R, FLOOR + 0.12], [INNER_R - 0.08, FLOOR], [0.001, FLOOR],
]), 96), glassMat);
inner.renderOrder = 1;
outer.renderOrder = 2;
mug.add(outer, inner);

// Glass edges catch light: a fresnel sheen on top of the transmission keeps an empty mug readable on a dark page.
const sheen = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: { color: { value: new THREE.Color(0xfff1d6) } },
  vertexShader: `
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform vec3 color;
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.8);
      gl_FragColor = vec4(color * f * 0.7, 1.0);
    }`,
});
const outerSheen = new THREE.Mesh(outer.geometry, sheen);
outerSheen.renderOrder = 3;
mug.add(outerSheen);

const handle = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.13, 24, 64, Math.PI), glassMat);
handle.rotation.z = -Math.PI / 2;
handle.position.set(0.97, 1.36, 0);
handle.scale.set(1, 1.05, 1);
handle.renderOrder = 2;
mug.add(handle);
const handleSheen = new THREE.Mesh(handle.geometry, sheen);
handleSheen.position.copy(handle.position);
handleSheen.rotation.copy(handle.rotation);
handleSheen.scale.copy(handle.scale);
handleSheen.renderOrder = 3;
mug.add(handleSheen);

// Beer: a vertical gradient so it reads as liquid, lit from within a little.
function beerTexture() {
  const cv = document.createElement('canvas');
  cv.width = 4;
  cv.height = 256;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#f5b642');
  grad.addColorStop(0.35, '#e8a317');
  grad.addColorStop(1, '#8a5207');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const beerTex = beerTexture();
const beerMat = new THREE.MeshStandardMaterial({
  map: beerTex, emissiveMap: beerTex, emissive: 0xffffff, emissiveIntensity: 0.22, roughness: 0.35, envMapIntensity: 0.3,
});
const beer = new THREE.Mesh(new THREE.CylinderGeometry(INNER_R - 0.012, INNER_R - 0.06, 1, 64, 1), beerMat);
mug.add(beer);

// Foam: a short collar plus a lumpy cap that only rises near the top.
const foamMat = new THREE.MeshStandardMaterial({ color: 0xfbf3e0, roughness: 0.95 });
const collar = new THREE.Mesh(new THREE.CylinderGeometry(INNER_R - 0.01, INNER_R - 0.012, 1, 64, 1), foamMat);
const capGeo = new THREE.SphereGeometry(INNER_R + 0.02, 64, 20, 0, Math.PI * 2, 0, Math.PI / 2);
const pos = capGeo.attributes.position;
for (let i = 0; i < pos.count; i++) {
  const x = pos.getX(i);
  const y = pos.getY(i);
  const z = pos.getZ(i);
  const n = Math.sin(x * 7.1) * Math.cos(z * 6.3) * 0.05 + Math.sin((x + z) * 13) * 0.02;
  pos.setY(i, y + n * (y / (INNER_R + 0.02)));
}
capGeo.computeVertexNormals();
const cap = new THREE.Mesh(capGeo, foamMat);
mug.add(collar, cap);

// The tap stream shows only while the level is actually rising.
const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.028, 1, 20, 1, true), beerMat);
mug.add(stream);

const state = {
  level: 0.16, target: 0.16, streamW: 0, rotY: -0.55, rotV: 0,
};

function applyLevel() {
  const top = FLOOR + state.level * (RIM - 0.12 - FLOOR);
  const foamH = 0.06 + Math.max(0, state.level - 0.55) * 0.5;
  const beerTop = top - foamH;
  beer.scale.y = Math.max(beerTop - FLOOR, 0.001);
  beer.position.y = FLOOR + beer.scale.y / 2;
  beer.visible = state.level > 0.015;
  collar.scale.y = foamH;
  collar.position.y = beerTop + foamH / 2;
  collar.visible = beer.visible;
  const dome = Math.max(0, state.level - 0.9) * 3.2;
  cap.scale.set(1, 0.14 + dome, 1);
  cap.position.y = top;
  cap.visible = beer.visible;

  stream.visible = state.streamW > 0.01;
  stream.scale.set(state.streamW, 7, state.streamW);
  stream.position.set(0.18, top + 3.5, 0.1);
}

function layout() {
  const { width, height } = host.getBoundingClientRect();
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  const narrow = width / height < 0.75;
  camera.position.set(0, 2.3, narrow ? 14 : 12);
  camera.lookAt(0, 1.3, 0);
  camera.updateProjectionMatrix();
  requestRender();
}

// Scroll decides the target level: interpolate between the chapter whose middle is nearest the viewport middle.
const chapters = [...document.querySelectorAll('[data-fill]')];
function readTarget() {
  const mid = innerHeight / 2;
  const pts = chapters.map((el) => {
    const r = el.getBoundingClientRect();
    return { y: r.top + r.height / 2, fill: parseFloat(el.dataset.fill) };
  });
  if (mid <= pts[0].y) return pts[0].fill;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (mid >= a.y && mid <= b.y) return a.fill + ((mid - a.y) / (b.y - a.y)) * (b.fill - a.fill);
  }
  return pts[pts.length - 1].fill;
}

let pending = false;
let last = performance.now();
function requestRender() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(frame);
}

function frame(now) {
  pending = false;
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  let busy = false;

  state.target = readTarget();
  const rising = state.target - state.level > 0.004;
  if (reduced) {
    state.level = state.target;
  } else {
    state.level += (state.target - state.level) * (1 - Math.exp(-dt * 4));
    if (Math.abs(state.target - state.level) > 0.0005) busy = true;
  }
  const streamGoal = rising && !reduced ? 1 : 0;
  state.streamW += (streamGoal - state.streamW) * (1 - Math.exp(-dt * 14));
  if (Math.abs(streamGoal - state.streamW) > 0.01) busy = true; else state.streamW = streamGoal;

  state.rotY += state.rotV * dt;
  state.rotV *= Math.exp(-dt * 4);
  if (Math.abs(state.rotV) > 0.01) busy = true; else state.rotV = 0;
  mug.rotation.set(0.06, state.rotY, 0);

  applyLevel();
  renderer.render(scene, camera);
  host.querySelector('.still')?.remove();
  if (busy || dragging) requestRender();
}

// Drag to turn the mug and look at the dimples.
let dragging = false;
let lastX = 0;
host.addEventListener('pointerdown', (e) => {
  dragging = true;
  lastX = e.clientX;
  host.setPointerCapture(e.pointerId);
  requestRender();
});
host.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  lastX = e.clientX;
  state.rotY += dx * 0.01;
  state.rotV = dx * 0.6;
});
const release = () => { dragging = false; requestRender(); };
host.addEventListener('pointerup', release);
host.addEventListener('pointercancel', release);

addEventListener('scroll', requestRender, { passive: true });
new ResizeObserver(layout).observe(host);
layout();
