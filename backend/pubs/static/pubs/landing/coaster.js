// Home page hero: the coaster in the linocut is a button. Every tap carves one more tally mark into it.
// Marks live in an SVG layer on top of the print, in the print's own coordinates.

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
