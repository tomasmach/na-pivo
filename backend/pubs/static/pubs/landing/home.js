// Home page behaviour. The coaster in the hero print is a button: every tap carves one more tally mark into it.
// Further down, the map dot walks its route as the page scrolls and sections reveal once they come into view.

const svg = document.querySelector('[data-table]');
const marksLayer = svg.querySelector('[data-marks]');
const coasterArea = svg.querySelector('[data-coaster]');
const hero = svg.closest('.hero');
const hitButton = document.querySelector('[data-hit]');
const tally = document.querySelector('[data-tally]');
const undoButton = tally.querySelector('[data-undo]');
const readout = tally.querySelector('output');
const hint = tally.querySelector('[data-hint]');
const copy = JSON.parse(document.getElementById('landing-copy').textContent);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Same query as the stacked layout in home.html.
const stacked = matchMedia('(max-width: 1180px), (max-aspect-ratio: 23/20)');

const CX = Number(coasterArea.getAttribute('cx'));
const CY = Number(coasterArea.getAttribute('cy'));
const MAX_MARKS = 20;
const SVG_NS = 'http://www.w3.org/2000/svg';
let marks = 0;

// Deterministic noise, so a mark looks hand cut but never changes shape.
function wobble(i, k) {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}

// Start and end of mark i, relative to the coaster centre: two rows of two groups of five.
function segment(i) {
  const group = Math.floor(i / 5);
  const inGroup = i % 5;
  const gx = -142 + (group % 2) * 175;
  const gy = -38 + Math.floor(group / 2) * 150;
  if (inGroup < 4) {
    const x = gx + inGroup * 30 + wobble(i, 1) * 5;
    return [x + wobble(i, 2) * 7, gy - 58 + wobble(i, 3) * 6, x + wobble(i, 4) * 7, gy + 58 + wobble(i, 5) * 6];
  }
  return [gx - 18, gy + 46 + wobble(i, 6) * 6, gx + 112, gy - 40 + wobble(i, 7) * 6];
}

// A carved stroke: thick in the middle, tapering to points, with a slightly chewed edge.
function carvedPath(i, length) {
  const steps = 12;
  const top = [];
  const bottom = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const w = 7.5 * Math.sin(Math.PI * t) ** 0.45 + 1;
    const x = t * length;
    top.push(`${x.toFixed(1)},${(-w + wobble(i * 31 + s, 8) * 2).toFixed(1)}`);
    bottom.unshift(`${x.toFixed(1)},${(w + wobble(i * 31 + s, 9) * 2).toFixed(1)}`);
  }
  return `M${top.join('L')}L${bottom.join('L')}Z`;
}

function addMarkShape(i, animate) {
  const [x1, y1, x2, y2] = segment(i);
  const length = Math.hypot(x2 - x1, y2 - y1);
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('transform', `translate(${CX + x1} ${CY + y1}) rotate(${angle.toFixed(2)})`);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', carvedPath(i, length));
  if (animate) path.classList.add('is-new');
  g.appendChild(path);
  marksLayer.appendChild(g);
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

// Phones and tablets get a crop around the coaster; wide screens get the whole table.
function layout() {
  if (stacked.matches) {
    // A crop around the coaster, as wide as the box allows but never past the edge of the print.
    const box = svg.getBoundingClientRect();
    const ratio = box.width / box.height || 1;
    // Tall enough for the coaster at any ratio, but never taller or wider than the print.
    const h = Math.min(1024, 1536 / ratio, Math.max(740, 720 / ratio));
    const w = h * ratio;
    const x = Math.min(Math.max(CX - w / 2, 0), 1536 - w);
    const y = Math.min(Math.max(CY - h * (310 / 740), 0), 1024 - h);
    svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  } else {
    svg.setAttribute('viewBox', '0 0 1536 1024');
  }
  const c = coasterArea.getBoundingClientRect();
  const h = hero.getBoundingClientRect();
  Object.assign(hitButton.style, {
    left: `${c.left - h.left}px`,
    top: `${c.top - h.top}px`,
    width: `${c.width}px`,
    height: `${c.height}px`,
  });
}

hitButton.addEventListener('click', () => {
  if (marks >= MAX_MARKS) return;
  hero.classList.add('is-tallied');
  addMarkShape(marks, !reduced);
  marks += 1;
  sync();
});

undoButton.addEventListener('click', () => {
  if (marks === 0) return;
  marks -= 1;
  marksLayer.lastElementChild?.remove();
  sync();
});

stacked.addEventListener('change', layout);
new ResizeObserver(layout).observe(hero);
sync();
layout();
hitButton.hidden = false;
tally.hidden = false;

// Sections with data-reveal play their entrance once, when a third of them is on screen.
const revealer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('is-in');
    revealer.unobserve(entry.target);
  });
}, { threshold: 0.3 });
document.querySelectorAll('[data-reveal]').forEach((el) => revealer.observe(el));

// The map holds still while scrolling walks the "you are here" dot along the printed route to the pub;
// once the dot arrives the page scrolls on. Reduced motion leaves the map static with the dot at the start.
const mapRun = document.querySelector('[data-map-run]');
const walk = document.querySelector('[data-walk]');
if (mapRun && walk && !reduced) {
  mapRun.classList.add('is-live');
  const route = walk.querySelector('[data-route]');
  const walker = walk.querySelector('[data-walker]');
  const pan = mapRun.querySelector('[data-map-pan]');
  const total = route.getTotalLength();
  let queued = false;
  const step = () => {
    queued = false;
    const r = mapRun.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) return;
    const held = Math.min(Math.max(-r.top / (r.height - innerHeight), 0), 1);
    // A short pause at both ends, so the start and the arrival both register.
    const progress = Math.min(Math.max((held - 0.08) / 0.8, 0), 1);
    const p = route.getPointAtLength(total * progress);
    walker.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
    walk.classList.toggle('is-there', progress >= 1);
    // When the map is wider than the screen, pan it so the dot stays near the middle.
    const frameW = pan.parentElement.clientWidth;
    const panW = pan.offsetWidth;
    const dotX = (p.x / 1536) * panW;
    const shift = panW > frameW ? Math.min(Math.max(frameW / 2 - dotX, frameW - panW), 0) : 0;
    pan.style.transform = `translateX(${shift.toFixed(1)}px)`;
  };
  addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(step);
  }, { passive: true });
  step();
}

// The bill spike. Slips start pinned on the bar wall. Scrolling through the section takes them down one by one:
// each slip leaves the wall, tips over flat in 3D, spins over the spike and slides down the nail onto the pile.
// Reduced motion keeps the static layout from the CSS.
const spikeSection = document.querySelector('[data-spike]');
if (spikeSection && !reduced) {
  const stage = spikeSection.querySelector('.spike-stage');
  const nail = spikeSection.querySelector('[data-spike-nail]');
  const base = spikeSection.querySelector('[data-spike-base]');
  const slips = [...spikeSection.querySelectorAll('.slip')];
  const n = slips.length;
  spikeSection.style.setProperty('--slips', n);
  spikeSection.classList.add('is-live');

  const FLAT = 62; // degrees a spiked slip is tipped back towards lying flat, seen from above
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  const noise = (i, k) => {
    const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
    return x - Math.floor(x) - 0.5;
  };
  let geo = null;

  function measure() {
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    // Where the counter of the cover-fitted print lands on screen (object-position 55 % 60 %).
    const scale = Math.max(W / 1536, H / 1024);
    const imgH = 1024 * scale;
    const counterY = (H - imgH) * 0.6 + 0.705 * imgH;
    const wide = W >= 1100;
    const cols = wide ? 3 : 2;
    const rows = Math.ceil(n / cols);
    // Wall area between the taps and the darts board on wide screens; the middle of the wall on narrow ones.
    const x0 = wide ? W * 0.17 : W * 0.04;
    const x1 = wide ? W * 0.72 : W * 0.96;
    const y0 = Math.max(70, counterY * 0.12);
    const y1 = counterY - (wide ? 40 : 170);
    const cellW = (x1 - x0) / cols;
    const cellH = (y1 - y0) / rows;
    const width = Math.min(cellW * 0.92, 320);
    slips.forEach((slip) => { slip.style.width = `${width}px`; });
    const heights = slips.map((slip) => slip.offsetHeight);
    const spikeX = wide ? W * 0.79 : W * 0.5;
    const baseY = counterY + (wide ? 6 : 40);
    const tipY = baseY - 18 - n * 8 - (wide ? 190 : 150);

    const wall = slips.map((slip, i) => {
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, n - row * cols);
      const col = (i % cols) + (cols - inRow) / 2; // a short last row is centred
      return { x: x0 + cellW * (col + 0.5) + noise(i, 1) * 10, y: y0 + cellH * (row + 0.5), rot: noise(i, 2) * 7 };
    });
    const spiked = slips.map((slip, i) => ({ y: baseY - 18 - i * 8, spin: 40 + i * 67 + noise(i, 3) * 30 }));
    geo = { W, H, width, heights, spikeX, baseY, tipY, wall, spiked };

    // Camera above the counter, looking down on the pile.
    stage.style.perspectiveOrigin = `${spikeX}px ${tipY - H * 0.15}px`;
    Object.assign(nail.style, { left: `${spikeX - 5}px`, top: `${tipY}px`, height: `${baseY - tipY}px` });
    base.style.transform = `translate3d(${spikeX - 70}px, ${baseY - 70}px, 0) rotateX(${FLAT}deg)`;
  }

  function render() {
    if (!geo) return;
    const r = spikeSection.getBoundingClientRect();
    const raw = Math.min(Math.max(-r.top / (r.height - geo.H), 0), 1) * (n + 0.5) - 0.2;
    slips.forEach((slip, i) => {
      const t = Math.min(Math.max(raw - i, 0), 1);
      const from = geo.wall[i];
      const to = geo.spiked[i];
      const half = geo.heights[i] / 2;
      const above = geo.tipY - 36;
      let x;
      let y;
      let z;
      let tilt;
      let spin;
      if (t < 0.6) {
        // Off the wall, towards the viewer and over the spike, tipping flat and turning as it goes.
        const k = ease(t / 0.6);
        x = lerp(from.x, geo.spikeX, k);
        y = lerp(from.y, above, k) - Math.sin(Math.PI * k) * 90;
        z = lerp(-30, 0, k) + Math.sin(Math.PI * k) * 160;
        tilt = lerp(0, FLAT, Math.min(k * 1.3, 1));
        spin = lerp(from.rot, to.spin - 110, k);
      } else {
        // Straight down the nail, still turning a little, with a small bounce as it lands.
        const k = ease((t - 0.6) / 0.4);
        x = geo.spikeX;
        y = lerp(above, to.y, k);
        z = 0;
        tilt = FLAT + Math.sin(Math.PI * k) * 6;
        spin = lerp(to.spin - 110, to.spin, k);
      }
      slip.style.transform = `translate3d(${(x - geo.width / 2).toFixed(1)}px, ${(y - half).toFixed(1)}px, ${z.toFixed(1)}px) rotateX(${tilt.toFixed(2)}deg) rotateZ(${spin.toFixed(2)}deg)`;
      // Paper lying flat under the lamp catches less light.
      slip.style.filter = `brightness(${(1 - (tilt / FLAT) * 0.14).toFixed(3)})`;
      slip.classList.toggle('is-down', t > 0);
      slip.classList.toggle('is-spiked', t >= 0.6);
    });
  }

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; render(); });
  };
  addEventListener('scroll', schedule, { passive: true });
  new ResizeObserver(() => { measure(); render(); }).observe(stage);
  document.fonts.ready.then(() => { measure(); render(); });
  measure();
  render();
}
