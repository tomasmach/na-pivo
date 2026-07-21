# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""LLM name-judge the ambiguous SK places with gpt-5.4-mini (via codex CLI).

The deterministic category pass (classify_sk.py) already labels clear pub /
not_pub cases. This refines only the residue where the *name* decides — the
`maybe` bucket (mostly "Reštaurácia …": a beer pub vs an Asian/ delivery place)
and `unknown` (no usable category). gpt-5.4-mini runs on the user's ChatGPT
plan through codex, so no OpenAI API key is needed.

Batches are dispatched to several parallel codex processes; each writes its own
verdict file, so there is no shared-file race. Resumable: batches whose output
already exists are skipped.

  uv run llm_classify_sk.py --smoke 5     # 1 tiny batch, to eyeball quality
  uv run llm_classify_sk.py               # full residue

Output: sk_llm_verdicts.jsonl -> {"feature_id":..., "verdict":"pub"|"not_pub"}
Then re-run normalize (it prefers the LLM verdict over the category label).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BASE = Path(__file__).resolve().parent
RAW = BASE / "sk_places_raw.jsonl"
KINDS = BASE / "sk_venue_kind.jsonl"
VERDICTS = BASE / "sk_llm_verdicts.jsonl"
WORK = BASE / "llm_work"
MODEL = "gpt-5.4-mini"
BATCH = 100
PARALLEL = 4

PROMPT = """\
You are labelling Slovak/Czech venues for a beer-pub app ("Na pivo"). For each
place decide if a beer drinker would treat it as a pub — i.e. it serves draft
beer and you can sit and drink (krčma, piváreň, hostinec, pub, bar, beer-serving
reštaurácia/bistro/pizzeria). Answer "pub" for those.

Answer "not_pub" for places that are NOT a place to go for a beer: cafés/
coffee (kaviareň), patisserie/ice-cream, bakeries, pure food delivery/takeaway,
hotels/pensions without a public pub, shops, wineries/wine shops, fast-food
counters, gas stations, playgrounds, attractions.

Judge from the name and the Google categories together. When genuinely unsure,
prefer "pub" (better to show a borderline beer place than hide it).

Input file: {infile} — a JSON array of {{"feature_id","name","categories","city"}}.
Write your answer to {outfile} as JSONL, ONE object per input place, exactly:
{{"feature_id": "<same id>", "verdict": "pub"}}  or  "not_pub".
Output only that file. No prose."""


def load_residue() -> list[dict]:
    raw: dict[str, dict] = {}
    with RAW.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                r = json.loads(line)
                fid = r.get("feature_id")
                if fid:
                    raw[fid] = r
    residue: list[dict] = []
    with KINDS.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            k = json.loads(line)
            if k["venue_kind"] in ("maybe", "unknown"):
                r = raw.get(k["feature_id"])
                if r:
                    residue.append({
                        "feature_id": k["feature_id"],
                        "name": r.get("name", ""),
                        "categories": r.get("categories") or [],
                        "city": r.get("city", ""),
                    })
    return residue


def run_batch(idx: int, places: list[dict]) -> tuple[int, bool]:
    infile = WORK / f"in_{idx:04d}.json"
    outfile = WORK / f"out_{idx:04d}.jsonl"
    if outfile.exists() and sum(1 for _ in outfile.open()) >= len(places):
        return idx, True
    infile.write_text(json.dumps(places, ensure_ascii=False), encoding="utf-8")
    prompt = PROMPT.format(infile=infile.name, outfile=outfile.name)
    proc = subprocess.run(
        ["codex", "exec", "-C", str(WORK), "-c", f"model={MODEL}",
         "--dangerously-bypass-approvals-and-sandbox", prompt],
        capture_output=True, text=True, timeout=600,
    )
    ok = outfile.exists() and sum(1 for _ in outfile.open()) >= len(places) * 0.9
    if not ok:
        (WORK / f"err_{idx:04d}.log").write_text(
            (proc.stdout or "") + "\n---STDERR---\n" + (proc.stderr or ""),
            encoding="utf-8",
        )
    return idx, ok


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--smoke", type=int, default=0, help="classify only N places, one batch")
    parser.add_argument("--parallel", type=int, default=PARALLEL)
    args = parser.parse_args()

    WORK.mkdir(exist_ok=True)
    residue = load_residue()
    if args.smoke:
        residue = residue[: args.smoke]
    batches = [residue[i:i + BATCH] for i in range(0, len(residue), BATCH)]
    print(f"residue={len(residue)} batches={len(batches)} model={MODEL} parallel={args.parallel}")

    results: dict[int, bool] = {}
    with ThreadPoolExecutor(max_workers=args.parallel) as pool:
        futs = [pool.submit(run_batch, i, b) for i, b in enumerate(batches)]
        for fut in futs:
            idx, ok = fut.result()
            results[idx] = ok
            print(f"batch {idx:04d}: {'ok' if ok else 'FAILED'}", flush=True)

    # Merge all batch outputs into the verdicts file.
    seen: set[str] = set()
    with VERDICTS.open("w", encoding="utf-8") as out:
        for idx in range(len(batches)):
            of = WORK / f"out_{idx:04d}.jsonl"
            if not of.exists():
                continue
            for line in of.open(encoding="utf-8"):
                line = line.strip()
                if not line:
                    continue
                try:
                    v = json.loads(line)
                except json.JSONDecodeError:
                    continue
                fid = v.get("feature_id")
                if fid and fid not in seen and v.get("verdict") in ("pub", "not_pub"):
                    seen.add(fid)
                    out.write(json.dumps({"feature_id": fid, "verdict": v["verdict"]}, ensure_ascii=False) + "\n")

    failed = [i for i, ok in results.items() if not ok]
    print(f"\nverdicts written: {len(seen)} -> {VERDICTS.name}")
    if failed:
        print(f"FAILED batches (see llm_work/err_*.log): {failed}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
