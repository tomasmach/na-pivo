/**
 * Fetches pub/bar/biergarten data from Overpass API for Czechia and Slovakia.
 * Run with: npm run fetch-pubs
 *
 * NOTE: If both Overpass endpoints are unavailable or time out, re-run this
 * script later. A stub pubs.json with empty pubs array will be written so the
 * app can build, but findNearestPub / findRandomPubInRadius will always return null.
 */

import fs from "fs";
import path from "path";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const OUTPUT_DIR = path.resolve(__dirname, "../assets/data");
const OUTPUT_JSON = path.join(OUTPUT_DIR, "pubs.json");
const OUTPUT_ATTRIBUTION = path.join(OUTPUT_DIR, "ATTRIBUTION.md");

const OVERPASS_QUERY = `
[out:json][timeout:120];
(
  area["ISO3166-1"="CZ"]->.cz;
  area["ISO3166-1"="SK"]->.sk;
  (
    node["amenity"="pub"](area.cz);     node["amenity"="pub"](area.sk);
    node["amenity"="bar"](area.cz);     node["amenity"="bar"](area.sk);
    node["amenity"="biergarten"](area.cz); node["amenity"="biergarten"](area.sk);
    node["amenity"="restaurant"]["microbrewery"="yes"](area.cz);
    node["amenity"="restaurant"]["microbrewery"="yes"](area.sk);
  );
);
out body;
`.trim();

interface OverpassElement {
  type: string;
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

interface Pub {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  city?: string;
}

interface PubsJson {
  version: string;
  generated: string;
  count: number;
  pubs: Pub[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOverpass(endpoint: string, retried = false): Promise<OverpassResponse | null> {
  console.log(`Querying ${endpoint}...`);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "na-pivo-app/1.0 (https://github.com/tomasmach/na-pivo; iOS pub compass app)",
      },
      body: `data=${encodeURIComponent(OVERPASS_QUERY)}`,
    });
  } catch (err) {
    console.error(`Network error from ${endpoint}: ${err}`);
    return null;
  }

  if (response.status === 429 || response.status === 503) {
    if (!retried) {
      console.log(`Got ${response.status} from ${endpoint}, retrying after 30s...`);
      await sleep(30_000);
      return fetchOverpass(endpoint, true);
    }
    console.error(`Got ${response.status} from ${endpoint} on retry, giving up.`);
    return null;
  }

  if (!response.ok) {
    console.error(`HTTP ${response.status} from ${endpoint}`);
    return null;
  }

  try {
    const data = (await response.json()) as OverpassResponse;
    return data;
  } catch (err) {
    console.error(`Failed to parse JSON from ${endpoint}: ${err}`);
    return null;
  }
}

function isValidName(name: string | undefined): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (trimmed.length === 0) return false;
  // Drop garbage names: pure numbers, very short (1 char), or just punctuation/symbols
  if (/^\d+$/.test(trimmed)) return false;
  if (trimmed.length < 2) return false;
  // Must contain at least one letter (handles Unicode via regex)
  if (!/\p{L}/u.test(trimmed)) return false;
  return true;
}

function buildAddress(tags: Record<string, string>): string | undefined {
  const street = tags["addr:street"];
  const housenumber = tags["addr:housenumber"];
  if (street && housenumber) return `${street} ${housenumber}`;
  if (street) return street;
  return undefined;
}

function buildCity(tags: Record<string, string>): string | undefined {
  return tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || undefined;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function processElements(elements: OverpassElement[]): {
  pubs: Pub[];
  droppedNoName: number;
  droppedWrongAmenity: number;
} {
  const validAmenities = new Set(["pub", "bar", "biergarten", "restaurant"]);
  let droppedNoName = 0;
  let droppedWrongAmenity = 0;
  const seen = new Set<number>();
  const pubs: Pub[] = [];

  for (const el of elements) {
    if (el.type !== "node") continue;

    const tags = el.tags ?? {};
    const amenity = tags["amenity"];

    // Validate amenity
    if (!amenity || !validAmenities.has(amenity)) {
      droppedWrongAmenity++;
      continue;
    }

    // For restaurant, must have microbrewery=yes (double-check even though QL filters)
    if (amenity === "restaurant" && tags["microbrewery"] !== "yes") {
      droppedWrongAmenity++;
      continue;
    }

    // Dedupe by id
    if (seen.has(el.id)) continue;
    seen.add(el.id);

    // Validate name
    if (!isValidName(tags["name"])) {
      droppedNoName++;
      continue;
    }

    const pub: Pub = {
      id: `osm:${el.id}`,
      name: tags["name"]!.trim(),
      lat: el.lat,
      lng: el.lon,
    };

    const address = buildAddress(tags);
    if (address) pub.address = address;

    const city = buildCity(tags);
    if (city) pub.city = city;

    pubs.push(pub);
  }

  // Sort by id for determinism
  pubs.sort((a, b) => {
    const aNum = parseInt(a.id.replace("osm:", ""), 10);
    const bNum = parseInt(b.id.replace("osm:", ""), 10);
    return aNum - bNum;
  });

  return { pubs, droppedNoName, droppedWrongAmenity };
}

function writeAttribution(): void {
  const content = `# OpenStreetMap Data Attribution

The pub/bar data bundled in this application is derived from **OpenStreetMap** data.

© OpenStreetMap contributors

This data is made available under the **Open Database License (ODbL)**:
https://opendatacommons.org/licenses/odbl/1-0/

You are free to copy, distribute, transmit and adapt our data, as long as you credit OpenStreetMap and its contributors. If you alter or build upon our data, you may distribute the result only under the same licence. The full legal code explains your rights and responsibilities:
https://opendatacommons.org/licenses/odbl/1-0/

For more information, visit https://www.openstreetmap.org/copyright
`;
  fs.writeFileSync(OUTPUT_ATTRIBUTION, content, "utf-8");
  console.log(`Wrote ${OUTPUT_ATTRIBUTION}`);
}

function writeStub(): void {
  const stub: PubsJson = {
    version: "1",
    generated: formatDate(new Date()),
    count: 0,
    pubs: [],
  };
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(stub, null, 2), "utf-8");
  console.log("Wrote stub pubs.json (empty). Re-run fetch-pubs when Overpass is available.");
}

async function main(): Promise<void> {
  console.log("Starting pub data fetch...");
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let data: OverpassResponse | null = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    data = await fetchOverpass(endpoint);
    if (data !== null) break;
    console.log(`Endpoint ${endpoint} failed, trying next...`);
  }

  if (data === null) {
    console.error("All Overpass endpoints failed. Writing stub pubs.json.");
    writeStub();
    writeAttribution();
    return;
  }

  const totalFetched = data.elements.filter((e) => e.type === "node").length;
  console.log(`Fetched ${totalFetched} elements from Overpass.`);

  const { pubs, droppedNoName, droppedWrongAmenity } = processElements(data.elements);

  console.log(`\nSummary:`);
  console.log(`  Total fetched (nodes):    ${totalFetched}`);
  console.log(`  Dropped (no name):        ${droppedNoName}`);
  console.log(`  Dropped (wrong amenity):  ${droppedWrongAmenity}`);
  console.log(`  Final count:              ${pubs.length}`);

  const output: PubsJson = {
    version: "1",
    generated: formatDate(new Date()),
    count: pubs.length,
    pubs,
  };

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2), "utf-8");

  const stats = fs.statSync(OUTPUT_JSON);
  const sizeMb = (stats.size / 1024 / 1024).toFixed(2);
  console.log(`\nWrote ${OUTPUT_JSON} (${sizeMb} MB)`);

  writeAttribution();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
