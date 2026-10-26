// Draws the maps of a page: [data-map] holds the pins as JSON, <html data-lib> the map library.
// Without JavaScript or when the tiles fail, the page still has everything but the map.
const hosts = [...document.querySelectorAll("[data-map]")];
if (hosts.length) {
  const { lib, css, style } = document.documentElement.dataset;
  // The map measures its box on start, so its stylesheet has to be in first.
  const styled = new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = css;
    link.onload = link.onerror = resolve;
    document.head.append(link);
  });
  const [maplibre] = await Promise.all([import(lib), styled]);
  for (const host of hosts) setUp(maplibre, host, style);
}

function setUp(maplibre, host, style) {
  const pins = JSON.parse(host.dataset.map || "[]");
  const interactive = host.dataset.interactive === "1";
  const center = host.dataset.center ? JSON.parse(host.dataset.center) : null;
  const map = new maplibre.Map({
    container: host,
    style,
    center: pins.length ? [pins[0].lng, pins[0].lat] : center ?? [15.47, 49.8],
    zoom: pins.length || center ? Number(host.dataset.zoom || 14) : 6.4,
    interactive,
    attributionControl: false,
    fadeDuration: 0,
    locale: document.documentElement.lang === "cs" ? {
      "NavigationControl.ZoomIn": "Přiblížit",
      "NavigationControl.ZoomOut": "Oddálit",
      "AttributionControl.ToggleAttribution": "Zdroje mapy",
      "Map.Title": "Mapa",
    } : {},
  });
  map.addControl(new maplibre.AttributionControl({ compact: true }), "bottom-left");
  if (interactive) map.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");
  // MapLibre unfolds the credits on wide maps; they start folded, the "i" opens them.
  map.once("load", () => host.querySelector(".maplibregl-compact-show")?.classList.remove("maplibregl-compact-show"));
  if (host.dataset.line === "1") {
    map.once("load", () => {
      map.addSource("route", {
        type: "geojson",
        data: { type: "Feature", geometry: { type: "LineString", coordinates: pins.map((pin) => [pin.lng, pin.lat]) } },
      });
      map.addLayer({
        id: "route",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#E8DCC0", "line-opacity": 0.55, "line-width": 3, "line-dasharray": [0.5, 2] },
      });
    });
  }

  let markers = [];
  let shown = pins;
  // Many pins zoomed out would pile their prices up; they shrink to dots until there is room.
  const spread = () => host.classList.toggle("is-far", markers.length > 40 && map.getZoom() < 13.4);
  map.on("zoomend", spread);
  // Moves the page makes itself are marked, so only the visitor's own moves offer a new search.
  host.fit = () => {
    host.placing = true;
    map.once("moveend", () => { host.placing = false; });
    if (shown.length > 1) {
      const bounds = new maplibre.LngLatBounds();
      for (const pin of shown) bounds.extend([pin.lng, pin.lat]);
      map.fitBounds(bounds, { padding: 56, maxZoom: 16, duration: 0 });
    } else if (shown.length === 1) {
      map.jumpTo({ center: [shown[0].lng, shown[0].lat], zoom: Math.max(map.getZoom(), 15) });
    } else {
      host.placing = false;
    }
    spread();
  };
  host.setPins = (next, { fit = true } = {}) => {
    shown = next;
    for (const marker of markers) marker.remove();
    markers = next.map((pin) => {
      const element = document.createElement(pin.url ? "a" : "span");
      element.className = `pin${pin.on ? " on" : ""}${pin.label ? "" : " dot"}`;
      element.textContent = pin.label || "";
      if (pin.key) element.dataset.key = pin.key;
      if (pin.url) {
        element.href = pin.url;
        element.setAttribute("aria-label", pin.name);
      } else {
        element.setAttribute("aria-hidden", "true");
      }
      return new maplibre.Marker({ element, anchor: "bottom" }).setLngLat([pin.lng, pin.lat]).addTo(map);
    });
    if (fit) host.fit();
    else spread();
  };
  host.setPins(pins);
  host.map = map;
  host.dispatchEvent(new CustomEvent("map:ready", { detail: map }));
}
