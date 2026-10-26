// Pub search: filters reload only the results, the address keeps the search, the map follows.
const root = document.querySelector("[data-finder-root]");
const form = document.querySelector("[data-finder]");

for (const button of document.querySelectorAll("[data-locate]")) {
  if (!navigator.geolocation) continue;
  button.hidden = false;
  button.addEventListener("click", () => {
    // On the home page the button sits next to the form, not in it.
    const scope = button.closest("form, section") ?? document;
    const error = scope.querySelector("[data-geo-error]");
    button.setAttribute("aria-busy", "true");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        // Three decimals are about a hundred metres; the exact spot never leaves the browser.
        const params = new URLSearchParams({ lat: coords.latitude.toFixed(3), lng: coords.longitude.toFixed(3) });
        window.location.assign(`${button.dataset.url}?${params}`);
      },
      () => {
        button.removeAttribute("aria-busy");
        error.hidden = false;
        scope.querySelector("input[type=search]")?.focus();
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  });
}

if (root && form) {
  const mapHost = root.querySelector("[data-search]");
  const areaField = form.querySelector("[data-area]");
  const here = root.querySelector("[data-here]");
  let results = root.querySelector("#vysledky");
  let request = 0;

  const address = () => {
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form)) if (value) params.append(key, value);
    const query = params.toString();
    return `${form.action}${query ? `?${query}` : ""}`;
  };

  async function load(url, { push = true, fit = true } = {}) {
    const mine = ++request;
    results.setAttribute("aria-busy", "true");
    try {
      const response = await fetch(url, { headers: { "X-Partial": "1" } });
      if (!response.ok) throw new Error(String(response.status));
      const html = await response.text();
      if (mine !== request) return;
      const next = new DOMParser().parseFromString(html, "text/html").querySelector("#vysledky");
      results.replaceWith(next);
      results = next;
      if (push) history.pushState({}, "", url);
      for (const select of form.querySelectorAll(".filters select")) select.classList.toggle("set", Boolean(select.value));
      mapHost?.setPins?.(JSON.parse(results.dataset.pins || "[]"), { fit });
      if (card) card.hidden = true;
      bindRows();
    } catch {
      // The full page always works: fall back to it.
      window.location.assign(url);
    }
  }

  // The sort sits by the count, outside the form element but in the form.
  root.addEventListener("change", (event) => {
    if (event.target.form !== form || event.target.name === "q") return;
    load(address(), { fit: !areaField.value && event.target.name !== "razeni" });
  });
  form.addEventListener("submit", (event) => {
    // Typing a city opens its own page; a pub name searches on this one.
    if (form.querySelector("input[name=q]").value.trim() && !form.action.match(/\/hospody\/[^/]+/)) return;
    event.preventDefault();
    load(address());
  });
  root.addEventListener("click", (event) => {
    const more = event.target.closest("[data-more]");
    if (!more) return;
    event.preventDefault();
    load(more.href, { fit: false });
  });
  window.addEventListener("popstate", () => window.location.reload());

  const toggle = root.querySelector("[data-toggle]");
  toggle?.addEventListener("click", () => {
    const showing = document.body.classList.toggle("show-map");
    document.body.style.setProperty("--bar", `${document.querySelector(".topbar").getBoundingClientRect().height}px`);
    toggle.querySelector("[data-label]").textContent = showing ? toggle.dataset.list : toggle.dataset.mapLabel;
    if (!showing && card) card.hidden = true;
    // The map was hidden at zero size; it measures again and frames the results.
    if (mapHost) mapHost.placing = true;
    mapHost?.map?.resize();
    if (showing) mapHost?.fit?.();
    else if (mapHost) mapHost.placing = false;
  });

  // On a phone the list is hidden behind the map, so a tapped pin shows its pub in a card.
  const card = root.querySelector("[data-pincard]");
  function showCard(row) {
    const link = row.querySelector(".name");
    card.replaceChildren();
    const name = Object.assign(document.createElement("a"), { className: "name", href: link.href, textContent: link.textContent });
    const price = row.querySelector(".price")?.cloneNode(true);
    const meta = Object.assign(document.createElement("span"), { className: "meta", textContent: row.querySelector(".meta").textContent });
    const open = Object.assign(document.createElement("a"), { className: "btn open-pub", href: link.href, textContent: card.dataset.open });
    card.append(name, ...(price ? [price] : []), meta, open);
    card.hidden = false;
  }

  function markerFor(key) {
    return mapHost?.querySelector(`.pin[data-key="${key}"]`);
  }

  function bindRows() {
    for (const row of results.querySelectorAll(".row[data-key]")) {
      row.addEventListener("mouseenter", () => markerFor(row.dataset.key)?.classList.add("on"));
      row.addEventListener("mouseleave", () => markerFor(row.dataset.key)?.classList.remove("on"));
    }
  }
  bindRows();

  const ready = (map) => {
    map.on("moveend", () => { if (!mapHost.placing) here.classList.add("shown"); });
    here.addEventListener("click", () => {
      const bounds = map.getBounds();
      areaField.value = [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()].map((value) => value.toFixed(4)).join(",");
      for (const field of form.querySelectorAll("input[name=lat], input[name=lng]")) field.remove();
      here.classList.remove("shown");
      load(address(), { fit: false });
    });
    // On the map, a first click on a pin shows its row; the next one opens the pub.
    mapHost.addEventListener("click", (event) => {
      const pin = event.target.closest(".pin[data-key]");
      if (!pin) return;
      const row = results.querySelector(`.row[data-key="${pin.dataset.key}"]`);
      if (!row || row.classList.contains("is-active")) return;
      event.preventDefault();
      for (const active of results.querySelectorAll(".row.is-active")) active.classList.remove("is-active");
      for (const active of mapHost.querySelectorAll(".pin.on")) active.classList.remove("on");
      row.classList.add("is-active");
      pin.classList.add("on");
      if (document.body.classList.contains("show-map")) showCard(row);
      else row.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };
  if (mapHost?.map) ready(mapHost.map);
  else mapHost?.addEventListener("map:ready", (event) => ready(event.detail), { once: true });
}
