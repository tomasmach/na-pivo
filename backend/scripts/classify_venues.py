#!/usr/bin/env python3
"""
classify_venues.py — decide, from a venue's NAME, whether it is a beer pub.

The Mapy.cz sweep that builds the pub catalogue is fuzzy: querying
"hospoda/bar/pivnice/pivovar" also drags in sushi bars, pizzerias, cafés and
the like (they sit under Mapy's generic "Restaurace a pohostinství" label).
The Firmy.cz category classifier (pubs.enrichment.venue) catches the obvious
non-pubs, but leaves a large 'maybe'/'unknown' bucket — places with no Firmy
match or inconclusive categories. This script mops up that bucket by judging
the *name* with a cheap LLM.

Two backends, pick with --backend:

  codex   (default) — drives the local `codex exec` CLI with GPT-5.x Mini using
                      your ChatGPT/Codex subscription (no per-token cost). Uses
                      --output-schema so the final message is strict JSON.
  gemini            — calls the Gemini API (google-genai) with a Flash-Lite
                      model. Needs GEMINI_API_KEY in the env. Cheap per token,
                      good throughput; use as a fallback if the subscription
                      rate-limits the codex backend.

Verdicts (deliberately precision-biased toward NOT excluding real pubs):

  pub      — clearly a place that pours beer (hospoda, hostinec, pivnice,
             pivovar, nálevna, výčep, bar, pub, beer-led restaurace).
  not_pub  — clearly a non-beer food/drink venue (sushi, asijská/čínská/
             vietnamská restaurace, pizzerie, kavárna, cukrárna, čajovna,
             vinárna, fast food, zmrzlina, pekárna, …).
  unsure   — a generic/ambiguous Czech name with no decisive food signal.
             We DO NOT exclude these — better to keep a real pub than to drop
             one on a guess.

Output: a JSON map keyed by "name|city" -> {verdict, reason}, written
incrementally to --out (default scripts/venue_verdicts.json) so the run is
resumable — re-run it and already-judged venues are skipped.

Examples
--------
    # Classify the Prague catalogue via the Codex subscription:
    python scripts/classify_venues.py --catalogue scripts/pub_catalogue.json

    # Whole-CR catalogue, Gemini fallback, bigger batches:
    GEMINI_API_KEY=... python scripts/classify_venues.py \
        --catalogue scripts/pub_catalogue_cz.json \
        --backend gemini --batch-size 50

    # Dry run on the first 200 names, no LLM calls (prints the plan):
    python scripts/classify_venues.py --limit 200 --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# --------------------------------------------------------------------------
# Verdict vocabulary + the shared prompt
# --------------------------------------------------------------------------

VERDICTS = ("pub", "not_pub", "unsure")

# JSON Schema for the model's final response (codex --output-schema, and the
# gemini response_schema is derived from the same shape).
RESPONSE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "i": {"type": "integer", "description": "0-based index of the venue in the batch"},
                    "verdict": {"type": "string", "enum": list(VERDICTS)},
                    "reason": {"type": "string", "description": "short justification, <=12 words"},
                },
                "required": ["i", "verdict", "reason"],
            },
        }
    },
    "required": ["results"],
}

PROMPT_HEAD = """\
You classify Czech and Slovak venues by NAME for an app that finds places \
serving DRAFT BEER (točené pivo / čapované pivo). For each venue decide one \
verdict:

- "pub": clearly pours beer — hospoda, hostinec, hospůdka, pivnice, pivovar, \
minipivovar, nálevna, výčep, šenk, tankovna, pivotéka, bar, pub, sport bar, \
krčma, piváreň, pohostinstvo, výčap, or a Czech/Slovak-style restaurace/\
reštaurácia that would serve beer.
- "not_pub": clearly NOT a place to drink beer. Two families: (a) a non-beer \
food/drink venue — sushi, asijská/čínská/vietnamská/thajská/japonská/korejská/\
indická restaurace, pizzerie, kebab, kavárna/café, cukrárna, čajovna, vinárna/\
vinotéka, fast food/občerstvení, zmrzlina, pekárna, bistro that is clearly \
food-only; (b) NOT A VENUE AT ALL — a shop (barvy, květiny, potraviny, \
drogerie), service (kadeřnictví, masáže, poradna, autoservis), office or \
institution (úřad, komora, škola, muzeum, galerie, hospodářství), monument / \
nature / religion (socha, pomník, kaple, kostel, studánka, vyhlídka, strom), \
street or address, or a BARE person name with no venue word (e.g. "Romana \
Kočendová", "Ing. Petr Novák").
- "unsure": an ambiguous name that still PLAUSIBLY names a drinking/eating \
venue (e.g. "U Karla", "Na Růžku", "Beseda") but with no decisive signal.

Rules:
- Bias toward NOT excluding real pubs — but only among plausible venue names. \
"unsure" is reserved for venue-ish names; a statue, shop, office or bare \
person name is "not_pub", never "unsure".
- Judge the NAME only (city is context for disambiguation, not a signal).
- Return one result per input venue, by its index "i". Reason <=12 words.

Venues (JSON array of {i, name, city}):
"""


def build_prompt(batch: list[dict]) -> str:
    payload = [
        {"i": idx, "name": item["name"], "city": item.get("city") or ""}
        for idx, item in enumerate(batch)
    ]
    return PROMPT_HEAD + json.dumps(payload, ensure_ascii=False)


# --------------------------------------------------------------------------
# Input loading
# --------------------------------------------------------------------------

def _key(item: dict) -> str:
    return f"{item['name'].strip()}|{(item.get('city') or '').strip()}"


def load_catalogue(paths: list[Path]) -> list[dict]:
    """Load + dedupe venues (name, city) from one or more catalogue JSON files."""
    seen: set[str] = set()
    out: list[dict] = []
    for path in paths:
        if not path.exists():
            print(f"warning: catalogue {path} not found — skipping", file=sys.stderr)
            continue
        for item in json.loads(path.read_text()):
            name = (item.get("name") or "").strip()
            if not name:
                continue
            rec = {"name": name, "city": (item.get("city") or "").strip()}
            k = _key(rec)
            if k in seen:
                continue
            seen.add(k)
            out.append(rec)
    return out


# --------------------------------------------------------------------------
# Backends
# --------------------------------------------------------------------------

class CodexBackend:
    """Classify a batch by shelling out to `codex exec` with a strict schema."""

    def __init__(self, model: str, timeout: int) -> None:
        self.model = model
        self.timeout = timeout
        # The response schema is constant; write it once to a temp file reused
        # across all calls.
        self._schema_file = Path(tempfile.mkdtemp(prefix="venue-clf-")) / "schema.json"
        self._schema_file.write_text(json.dumps(RESPONSE_SCHEMA))

    def classify(self, batch: list[dict]) -> list[dict]:
        prompt = build_prompt(batch)
        with tempfile.NamedTemporaryFile(
            "r", suffix=".json", delete=False, encoding="utf-8"
        ) as out_f:
            out_path = Path(out_f.name)
        try:
            cmd = [
                "codex", "exec",
                "-m", self.model,
                # Classification needs no deep reasoning — override the user's
                # global config (e.g. xhigh) so each call stays fast and cheap.
                "-c", "model_reasoning_effort=\"low\"",
                "--sandbox", "read-only",
                "--skip-git-repo-check",
                "--ephemeral",
                "--color", "never",
                "--output-schema", str(self._schema_file),
                "-o", str(out_path),
                "-",  # read the prompt from stdin
            ]
            proc = subprocess.run(
                cmd,
                input=prompt,
                text=True,
                capture_output=True,
                timeout=self.timeout,
            )
            if proc.returncode != 0:
                raise RuntimeError(
                    f"codex exec failed (rc={proc.returncode}): {proc.stderr.strip()[:400]}"
                )
            raw = out_path.read_text().strip()
            return _parse_results(raw, len(batch))
        finally:
            out_path.unlink(missing_ok=True)


class GeminiBackend:
    """Classify a batch via the Gemini API (google-genai) with a JSON schema."""

    def __init__(self, model: str, timeout: int) -> None:
        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            raise SystemExit("GEMINI_API_KEY (or GOOGLE_API_KEY) is not set.")
        from google import genai  # imported lazily so the codex path needs no dep

        self._genai = genai
        self.client = genai.Client(api_key=api_key)
        self.model = model
        self.timeout = timeout

    def classify(self, batch: list[dict]) -> list[dict]:
        from google.genai import types

        resp = self.client.models.generate_content(
            model=self.model,
            contents=build_prompt(batch),
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=RESPONSE_SCHEMA,
                temperature=0.0,
            ),
        )
        return _parse_results(resp.text or "", len(batch))


def _parse_results(raw: str, batch_len: int) -> list[dict]:
    """Extract the {results:[...]} payload from a model response string."""
    text = raw.strip()
    # Tolerate accidental markdown code fences around the JSON.
    if text.startswith("```"):
        text = text.split("```", 2)[1] if "```" in text[3:] else text
        text = text.lstrip("json").strip().strip("`").strip()
    # Fall back to slicing the outermost object if there is leading/trailing prose.
    if not text.startswith("{"):
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end != -1:
            text = text[start : end + 1]
    data = json.loads(text)
    results = data.get("results", [])
    by_index: dict[int, dict] = {}
    for r in results:
        try:
            i = int(r["i"])
        except (KeyError, ValueError, TypeError):
            continue
        verdict = r.get("verdict")
        if verdict not in VERDICTS:
            verdict = "unsure"
        if 0 <= i < batch_len:
            by_index[i] = {"verdict": verdict, "reason": (r.get("reason") or "").strip()}
    # Any index the model skipped defaults to 'unsure' (never silently dropped).
    return [by_index.get(i, {"verdict": "unsure", "reason": "no verdict returned"})
            for i in range(batch_len)]


# --------------------------------------------------------------------------
# Driver
# --------------------------------------------------------------------------

def chunked(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--catalogue", action="append", default=None,
                    help="Catalogue JSON (repeatable). Default: scripts/pub_catalogue.json")
    ap.add_argument("--out", default="scripts/venue_verdicts.json",
                    help="Verdict map output (resumable). Default scripts/venue_verdicts.json")
    ap.add_argument("--backend", choices=("codex", "gemini"), default="codex")
    ap.add_argument("--model", default=None,
                    help="Model id. Default: gpt-5.4-mini (codex) / gemini-flash-lite-latest (gemini).")
    ap.add_argument("--batch-size", type=int, default=40,
                    help="Venues per LLM call (default 40).")
    ap.add_argument("--concurrency", type=int, default=3,
                    help="Parallel LLM calls (default 3; keep modest for subscription limits).")
    ap.add_argument("--timeout", type=int, default=180,
                    help="Per-call timeout in seconds (default 180).")
    ap.add_argument("--limit", type=int, default=0,
                    help="Max venues to classify this run (0 = all).")
    ap.add_argument("--dry-run", action="store_true",
                    help="Load + plan only; make no LLM calls.")
    args = ap.parse_args()

    catalogue_paths = [Path(p) for p in (args.catalogue or ["scripts/pub_catalogue.json"])]
    out_path = Path(args.out)

    venues = load_catalogue(catalogue_paths)
    if not venues:
        print("No venues loaded — check --catalogue path(s).", file=sys.stderr)
        return 1

    verdicts: dict[str, dict] = {}
    if out_path.exists():
        verdicts = json.loads(out_path.read_text())

    todo = [v for v in venues if _key(v) not in verdicts]
    if args.limit:
        todo = todo[: args.limit]

    print(f"Catalogue: {len(venues)} venues | already judged: {len(verdicts)} | "
          f"to classify: {len(todo)} (backend={args.backend}, batch={args.batch_size}, "
          f"concurrency={args.concurrency})")

    if args.dry_run:
        for v in todo[:10]:
            print(f"  would classify: {v['name']!r} ({v['city']})")
        if len(todo) > 10:
            print(f"  … and {len(todo) - 10} more")
        return 0

    if not todo:
        print("Nothing to do — all venues already classified.")
        return 0

    model = args.model or ("gpt-5.4-mini" if args.backend == "codex" else "gemini-flash-lite-latest")
    backend = CodexBackend(model, args.timeout) if args.backend == "codex" else GeminiBackend(model, args.timeout)

    batches = list(chunked(todo, args.batch_size))
    lock = threading.Lock()
    done = {"n": 0, "pub": 0, "not_pub": 0, "unsure": 0, "errors": 0}
    started = time.monotonic()

    def flush() -> None:
        tmp = out_path.with_suffix(out_path.suffix + ".tmp")
        tmp.write_text(json.dumps(verdicts, ensure_ascii=False, indent=2))
        tmp.replace(out_path)

    def run_batch(batch: list[dict]) -> tuple[list[dict], list[dict] | None]:
        try:
            return batch, backend.classify(batch)
        except Exception as exc:  # noqa: BLE001 — surface, keep going
            print(f"\nbatch failed ({len(batch)} venues): {exc}", file=sys.stderr)
            return batch, None

    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = [pool.submit(run_batch, b) for b in batches]
        for fut in as_completed(futures):
            batch, results = fut.result()
            with lock:
                if results is None:
                    done["errors"] += len(batch)
                else:
                    for v, r in zip(batch, results):
                        verdicts[_key(v)] = {"name": v["name"], "city": v["city"], **r}
                        done["n"] += 1
                        done[r["verdict"]] += 1
                flush()
                elapsed = time.monotonic() - started
                rate = done["n"] / elapsed if elapsed else 0
                remaining = len(todo) - done["n"] - done["errors"]
                eta = remaining / rate if rate else 0
                print(
                    f"\r{done['n']}/{len(todo)}  "
                    f"pub {done['pub']} | not_pub {done['not_pub']} | unsure {done['unsure']} "
                    f"| err {done['errors']}  {rate:.1f}/s  ETA {eta/60:.0f}m",
                    end="", flush=True,
                )

    flush()
    print(f"\nDone. Wrote {len(verdicts)} verdicts -> {out_path}")
    print(f"  not_pub flagged this run: {done['not_pub']} "
          f"(these are the venues to drop from the app)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
