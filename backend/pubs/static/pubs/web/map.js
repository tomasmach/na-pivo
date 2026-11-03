// Street map of web/components/map.html. MapLibre loads only once a map scrolls
// near the screen; until the map has drawn, and whenever it cannot, the server's
// fallback drawing stays.
const STYLE = "https://tiles.openfreemap.org/styles/dark";
const ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> ' +
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>';
// The dark style a notch lighter, so streets read on the --np-* greys.
const PAINT = {
  background: { "background-color": "#161616" },
  water: { "fill-color": "#0d0e10" },
  waterway: { "line-color": "#0d0e10" },
  building: { "fill-color": "#131313", "fill-outline-color": "#1f1f1f" },
  highway_path: { "line-color": "#222222" },
  highway_minor: { "line-color": "#2b2b2b" },
  highway_major_subtle: { "line-color": "#3a3a3a" },
  highway_name_other: { "text-color": "#7a7a75" },
  place_other: { "text-color": "#8f8f8a" },
  place_suburb: { "text-color": "#8f8f8a" },
  place_village: { "text-color": "#8f8f8a" },
  place_town: { "text-color": "#8f8f8a" },
  place_city: { "text-color": "#8f8f8a" },
};
const GIVE_UP_MS = 12000;
let library;

function loadLibrary(frame) {
  if (!library) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = frame.dataset.css;
    document.head.append(link);
    library = import(frame.dataset.lib).then((lib) => {
      lib.setWorkerUrl(frame.dataset.worker);
      return lib;
    });
  }
  return library;
}

// The style names places in English; a Czech page keeps the Czech names of OpenStreetMap.
const LOCAL_NAMES = document.documentElement.lang !== "en";

function restyle(_previous, next) {
  for (const layer of next.layers) {
    if (PAINT[layer.id]) layer.paint = { ...layer.paint, ...PAINT[layer.id] };
    const field = layer.layout && layer.layout["text-field"];
    if (LOCAL_NAMES && field && JSON.stringify(field).includes("name_en")) {
      layer.layout["text-field"] = ["coalesce", ["get", "name:cs"], ["get", "name"]];
    }
  }
  if (next.sources.openmaptiles) next.sources.openmaptiles.attribution = ATTRIBUTION;
  return next;
}

function icon(frame, name) {
  return frame.querySelector(`template[data-icon="${name}"]`).content.cloneNode(true);
}

function text(className, value) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = value;
  return span;
}

function pinElement(frame, kind, point, index, inert) {
  const link = point.url && !inert;
  const el = document.createElement(link ? "a" : "span");
  if (link) {
    el.href = point.url;
    el.setAttribute("aria-label", [point.name, point.label].filter(Boolean).join(", "));
  } else {
    el.setAttribute("aria-hidden", "true");
  }
  el.className = "np-pin" + (point.selected ? " is-selected" : "");
  if (kind === "focus") {
    el.classList.add("np-pin--focus");
    el.append(icon(frame, "beer"));
  } else if (kind === "route") {
    el.classList.add("np-pin--stop");
    el.append(text("np-pin__n", String(index + 1)));
    if (point.label) el.append(text("np-pin__label", point.label));
  } else {
    el.append(icon(frame, "beer"));
    if (point.label) el.append(text("np-pin__label", point.label));
  }
  return el;
}

// Pins come in priority order (the selected one first). A pin that would overlap
// one already placed shrinks to a dot; a route stop only drops its name.
function declutter(box, pins) {
  const edge = box.getBoundingClientRect();
  const placed = [];
  for (const el of pins) {
    el.classList.remove("is-tight");
    const r = el.getBoundingClientRect();
    const outside = r.left < edge.left || r.right > edge.right || r.top < edge.top || r.bottom > edge.bottom;
    const overlaps = placed.some((p) => r.left < p.right + 4 && r.right + 4 > p.left && r.top < p.bottom + 4 && r.bottom + 4 > p.top);
    if (overlaps || (outside && el.classList.contains("np-pin--stop"))) {
      el.classList.add("is-tight");
      placed.push(el.getBoundingClientRect());
    } else {
      placed.push(r);
    }
  }
}

function zoomButtons(frame, box, map) {
  const bar = document.createElement("div");
  bar.className = "np-map__zoom";
  for (const [label, name, delta] of [[frame.dataset.zoomIn, "plus", 1], [frame.dataset.zoomOut, "minus", -1]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.append(icon(frame, name));
    button.addEventListener("click", () => map.zoomTo(map.getZoom() + delta));
    bar.append(button);
  }
  box.append(bar);
}

// Scrolling the page never gets stuck in the map: the wheel zooms, and on a touch
// screen one finger pans, only after a click or tap into the map.
function gateGestures(box, map) {
  const touch = matchMedia("(pointer: coarse)").matches;
  if (touch) map.dragPan.disable();
  map.touchZoomRotate.disableRotation();
  box.addEventListener("click", () => {
    map.scrollZoom.enable();
    map.dragPan.enable();
  });
  box.addEventListener("mouseleave", () => map.scrollZoom.disable());
  if (touch) {
    document.addEventListener("touchstart", (event) => {
      if (!box.contains(event.target)) map.dragPan.disable();
    }, { passive: true });
  }
}

function initialView(lib, data, box) {
  const points = data.points;
  if (points.length === 0) return { center: data.centre, zoom: 13 };
  if (points.length === 1) return { center: [points[0].lng, points[0].lat], zoom: data.kind === "focus" ? 15.5 : 15 };
  const bounds = new lib.LngLatBounds();
  for (const p of points) bounds.extend([p.lng, p.lat]);
  const pad = Math.round(Math.min(64, box.clientWidth * 0.14, box.clientHeight * 0.16));
  // Stop names sit right of their numbers, so a route keeps more room on that side.
  const right = data.kind === "route" && box.clientWidth > 480 ? pad + 110 : pad;
  // The credit line sits along the bottom edge; keep pins off it.
  return { bounds, fitBoundsOptions: { padding: { top: pad, bottom: pad + 20, left: pad, right }, maxZoom: 16 } };
}

async function start(frame) {
  const data = JSON.parse(frame.dataset.map);
  // A map inside a link (a whole card is one) takes no clicks of its own.
  const inert = data.kind === "decor" || Boolean(frame.closest("a"));
  const box = document.createElement("div");
  box.className = "np-map__live";
  frame.append(box);
  let lib;
  try {
    lib = await loadLibrary(frame);
  } catch {
    box.remove();
    return;
  }
  const map = new lib.Map({
    container: box,
    style: STYLE,
    transformStyle: restyle,
    attributionControl: false,
    interactive: !inert,
    scrollZoom: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    maxZoom: 18,
    fadeDuration: 0,
    locale: { "Map.Title": frame.dataset.label },
    ...initialView(lib, data, box),
  });
  map.addControl(new lib.AttributionControl({ compact: false }), "bottom-right");
  // The OpenFreeMap sprite lacks a few icons its style names; draw nothing for them.
  map.setMissingStyleImageResolver((id) => {
    if (!map.hasImage(id)) map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
  });
  const giveUp = () => {
    map.remove();
    box.remove();
  };
  const timer = setTimeout(giveUp, GIVE_UP_MS);
  map.on("error", () => {
    if (!frame.classList.contains("is-live") && !map.isStyleLoaded()) {
      clearTimeout(timer);
      giveUp();
    }
  });

  const pins = data.points.map((point, index) => {
    const el = pinElement(frame, data.kind, point, index, inert);
    const options = data.kind === "route" ? { element: el, anchor: "left", offset: [-15, 0] } : { element: el };
    new lib.Marker(options).setLngLat([point.lng, point.lat]).addTo(map);
    return el;
  });
  const order = [...pins.filter((el) => el.classList.contains("is-selected")), ...pins.filter((el) => !el.classList.contains("is-selected"))];

  map.on("load", () => {
    clearTimeout(timer);
    if (data.kind === "route" && data.points.length > 1) {
      map.addSource("route", {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: data.points.map((p) => [p.lng, p.lat]) } },
      });
      map.addLayer({
        id: "route",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#d4d4ce", "line-width": 3, "line-opacity": 0.75 },
      });
    }
    frame.classList.add("is-live");
    declutter(box, order);
  });
  map.on("moveend", () => declutter(box, order));
  // MapLibre resizes the canvas at once but draws on the next frame, so a frame
  // painted in between (a rotated phone, a page capture) shows the old drawing in a
  // corner of the cleared canvas. Drawing right away leaves no such frame.
  map.on("resize", () => {
    map.redraw();
    declutter(box, order);
  });
  if (!inert) {
    zoomButtons(frame, box, map);
    gateGestures(box, map);
  }
}

const watcher = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    watcher.unobserve(entry.target);
    start(entry.target);
  }
}, { rootMargin: "300px" });
for (const frame of document.querySelectorAll("[data-map]")) watcher.observe(frame);
