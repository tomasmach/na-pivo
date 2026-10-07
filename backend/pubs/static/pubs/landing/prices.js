// Price page behaviour. Long lists get a search, sorting and a fold; bars grow and the bill lands as they scroll in.
// Without this script the page still shows every number and every row.

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// The store matching the visitor's phone goes first; desktop defaults to iPhone.
const android = /Android/i.test(navigator.userAgent);
document.querySelectorAll('.stores').forEach((group) => {
  group.prepend(group.querySelector(android ? '[data-store="android"]' : '[data-store="ios"]'));
});

// Armed sections hide their final state until they scroll into view, so nothing animates off screen.
if ('IntersectionObserver' in window && !reduced) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      }
    }
  }, { rootMargin: '0px 0px -12% 0px' });
  document.querySelectorAll('[data-reveal]').forEach((section) => {
    section.classList.add('is-armed');
    observer.observe(section);
  });
}

// "Plzen" finds Plzeň, "ceske" finds České Budějovice.
function plain(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

const ORDERS = {
  default: (a, b) => a.order - b.order,
  cheap: (a, b) => a.median - b.median || a.low - b.low || a.order - b.order,
  dear: (a, b) => b.median - a.median || b.high - a.high || a.order - b.order,
};

function setUpList(section) {
  const tools = section.querySelector('[data-tools]');
  if (!tools) return;
  const list = section.querySelector('[data-rows]');
  const search = section.querySelector('[data-search]');
  const sortButtons = [...section.querySelectorAll('[data-sort]')];
  const more = section.querySelector('[data-more]');
  const empty = section.querySelector('[data-empty]');
  const folded = Number(section.dataset.folded);
  const moreLabel = more.textContent;
  const rows = [...list.children].map((element, order) => ({
    element,
    order,
    name: plain(element.querySelector('.name').textContent),
    median: Number(element.dataset.median),
    low: Number(element.dataset.low),
    high: Number(element.dataset.high),
  }));
  let order = 'default';
  let expanded = false;

  // Rows that stay visible slide from their old place to the new one; rows that appear just appear.
  function render(slide) {
    const before = new Map();
    if (slide && !reduced) {
      for (const row of rows) {
        if (!row.element.hidden) before.set(row, row.element.getBoundingClientRect().top);
      }
    }
    const query = plain(search.value);
    const sorted = rows.slice().sort(ORDERS[order]);
    let shown = 0;
    let matches = 0;
    for (const row of sorted) {
      list.append(row.element);
      const match = !query || row.name.includes(query);
      if (match) matches += 1;
      const show = match && (query || expanded || shown < folded);
      if (show) shown += 1;
      row.element.hidden = !show;
    }
    empty.hidden = matches > 0;
    more.hidden = Boolean(query);
    for (const [row, top] of before) {
      if (row.element.hidden) continue;
      const shift = top - row.element.getBoundingClientRect().top;
      if (shift) {
        row.element.animate(
          // Faded while moving, so rows passing each other stay readable.
          [{ transform: `translateY(${shift}px)`, opacity: 0.35 }, { transform: 'none', opacity: 1 }],
          { duration: 320, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
        );
      }
    }
  }

  for (const button of sortButtons) {
    button.addEventListener('click', () => {
      order = button.dataset.sort;
      for (const other of sortButtons) other.setAttribute('aria-pressed', String(other === button));
      render(true);
    });
  }
  search.addEventListener('input', () => render(false));
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && search.value) {
      search.value = '';
      render(false);
    }
  });
  section.querySelector('[data-clear]').addEventListener('click', () => {
    search.value = '';
    render(false);
    search.focus();
  });
  more.addEventListener('click', () => {
    expanded = !expanded;
    more.textContent = expanded ? more.dataset.less : moreLabel;
    more.setAttribute('aria-expanded', String(expanded));
    render(false);
    // Folding a long list would leave the reader far below it.
    if (!expanded) more.scrollIntoView({ block: 'nearest' });
  });

  for (const row of rows) row.element.classList.remove('is-extra');
  section.classList.add('is-live');
  render(false);
}

document.querySelectorAll('[data-areas]').forEach(setUpList);
