// Home, price, beer and invite pages. Long lists get a search, sorting and a fold. Without this script
// the page still shows every number and every row.

// The store matching the visitor's phone goes first; desktop defaults to iPhone.
const android = /Android/i.test(navigator.userAgent);
document.querySelectorAll('[data-stores]').forEach((group) => {
  group.prepend(group.querySelector(android ? '[data-store="android"]' : '[data-store="ios"]'));
});

// "Plzen" finds Plzeň, "ceske" finds České Budějovice.
function plain(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

// Whichever way a list is sorted, a pub not confirmed for three months comes after the current ones and a row
// without a price goes last.
const unpriced = (a, b) => a.old - b.old || Number.isNaN(a.median) - Number.isNaN(b.median);
const ORDERS = {
  default: (a, b) => a.old - b.old || a.order - b.order,
  cheap: (a, b) => unpriced(a, b) || a.median - b.median || a.low - b.low || a.order - b.order,
  dear: (a, b) => unpriced(a, b) || b.median - a.median || b.high - a.high || a.order - b.order,
};
const number = (value) => (value ? Number(value) : NaN);

function setUpList(section) {
  const tools = section.querySelector('[data-tools]');
  if (!tools) return;
  const list = section.querySelector('[data-rows]');
  const search = section.querySelector('[data-search]');
  const sortButtons = [...section.querySelectorAll('[data-sort]')];
  const more = section.querySelector('[data-more]');
  const oldHead = list.querySelector('[data-old-head]');
  const empty = section.querySelector('[data-empty]');
  const folded = Number(section.dataset.folded);
  const moreLabel = more.textContent;
  const rows = [...list.children].map((element, order) => ({
    element,
    order,
    // A pub is found by its name or its city, a beer by its name or its brand.
    name: plain(element.dataset.find || element.querySelector('.name').textContent),
    old: element.hasAttribute('data-old'),
    median: number(element.dataset.median),
    low: number(element.dataset.low),
    high: number(element.dataset.high),
  }));
  let order = 'default';
  let expanded = false;

  function render() {
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
    // The heading over the old pubs moves to whichever of them now shows first.
    if (oldHead) {
      const first = sorted.find((row) => row.old && !row.element.hidden);
      for (const row of rows) row.element.classList.toggle('has-head', row === first);
      if (first) first.element.prepend(oldHead);
    }
    more.hidden = Boolean(query);
  }

  for (const button of sortButtons) {
    button.addEventListener('click', () => {
      order = button.dataset.sort;
      for (const other of sortButtons) other.setAttribute('aria-pressed', String(other === button));
      render();
    });
  }
  search.addEventListener('input', render);
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && search.value) {
      search.value = '';
      render();
    }
  });
  section.querySelector('[data-clear]').addEventListener('click', () => {
    search.value = '';
    render();
    search.focus();
  });
  more.addEventListener('click', () => {
    expanded = !expanded;
    more.textContent = expanded ? more.dataset.less : moreLabel;
    more.setAttribute('aria-expanded', String(expanded));
    render();
    // Folding a long list would leave the reader far below it.
    if (!expanded && section.getBoundingClientRect().top < 0) section.scrollIntoView({ block: 'start' });
  });

  section.classList.add('is-live');
  render();
}

document.querySelectorAll('[data-areas]').forEach(setUpList);
