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

  // A new order is dealt out again row by row: most of the visible rows change on a sort, so sliding them would
  // only show rows crossing each other.
  function render(deal) {
    const query = plain(search.value);
    const sorted = rows.slice().sort(ORDERS[order]);
    let shown = 0;
    let matches = 0;
    for (const row of sorted) {
      list.append(row.element);
      const match = !query || row.name.includes(query);
      if (match) matches += 1;
      const show = match && (query || expanded || shown < folded);
      // Bars still waiting to grow in follow the order on screen.
      if (show) row.element.style.setProperty('--n', shown++);
      row.element.hidden = !show;
    }
    empty.hidden = matches > 0;
    more.hidden = Boolean(query);
    if (!deal || reduced) return;
    let index = 0;
    for (const row of sorted) {
      if (row.element.hidden) continue;
      row.element.animate(
        [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
        { duration: 220, delay: Math.min(index, 12) * 18, easing: 'ease-out', fill: 'backwards' },
      );
      index += 1;
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
    if (!expanded && section.getBoundingClientRect().top < 0) section.scrollIntoView({ block: 'start' });
  });

  section.classList.add('is-live');
  render(false);
}

document.querySelectorAll('[data-areas]').forEach(setUpList);
