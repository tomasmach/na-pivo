# Slovakia Google Maps scraper verification

Verified on 2026-07-18 from the machine's normal residential connection. No
proxy, SOCKS tunnel, paid Places API, API key, or Google account was used. The
full-country sweep was **not** run.

## Technique that worked

Headless Playwright Chromium 149 worked. `scrape_sk.py` navigated normal Google
Maps search pages, scrolled the results feed, and decoded the rich place arrays
from intercepted map-search responses. Both sample tasks completed without a
captcha, HTTP 429, or DOM fallback:

| Tile | Keyword | Places | Rich responses | All browser responses | Time |
| --- | --- | ---: | ---: | ---: | ---: |
| Bratislava center | `krčma` | 20 | 6 | 1,663 | 28.47 s |
| Rural central Slovakia | `krčma` | 20 | 6 | 1,403 | 26.71 s |

The current anonymous Google Maps result cap was 20, not the older roughly-120
cap. The scraper therefore defaults to splitting a tile at 20 results. The
final viewport fitter uses zoom 14 for the Bratislava sample tile and zoom 13
for the rural sample tile. The verification requests were made with the earlier,
wider zooms 12 and 11; changing the fitter afterward avoids sweeping far outside
each nominal 0.1-degree tile.

Playwright downloaded its Ubuntu 24.04-compatible Chromium fallback build
successfully. Headless mode was not blocked during this sample. The scraper also
detects common captcha/unusual-traffic text and 429 responses, records a
retryable checkpoint, and backs off rather than crashing.

## Confirmed intercepted JSON positions

Paths below are relative to one decoded Google place record array. The saved
diagnostic record is `sample_intercept_record.json`; it is a 260-slot record for
Forest Pub.

| Field | Current payload path | Notes |
| --- | --- | --- |
| Feature ID | `[10]` | Full `0x…:0x…`; also searched defensively anywhere in the record. |
| Name | `[11]` | Non-empty string. |
| Latitude | `[9][2]` | Numeric. |
| Longitude | `[9][3]` | Numeric. |
| Formatted address | `[18]` | `[2]` is retained as an older-schema fallback. |
| Rating value | `[4][7]` | Float, for example `4.6`. |
| Review count | `[37][1]` | Integer, for example `51`; `[4][8]` is an older-schema fallback. |
| Categories | `[13]` | Array of localized category strings. |
| Google place ID | `[78]` | `ChIJ…`; feature ID remains the dedup key. |
| Structured address | `[183]` | `[183][1]` contains street, locality, postal code, and country. |
| Opening-hours block | `[203]` | Current anonymous payload contains the current day's localized row and interval. `[34]` is retained as an older-schema fallback. |

The two sample tiles produced 40 unique raw records. All 40 had name, feature
ID, coordinates, rating value, and review count. Thirty-eight had a non-null
opening-hours block, and 37 of those normalized to an OSM-format interval; the
remaining raw shape was left unnormalized rather than guessed.

### Opening-hours limitation

On this residential IP Google renders an anonymous "limited view". The `[203]`
block contains only the current day. Expanding the UI control labelled as weekly
hours also showed only that day, including for a normally daily venue. Therefore
this run verifies that an intercepted record contains name + rating + an opening
hours interval, but it does **not** verify retrieval of a complete seven-day
schedule.

`normalize_sk.py` supports full localized seven-day arrays, closed days,
multiple intervals, consecutive-day merging, and 24/7. A synthetic full-week
check produced:

```text
Mo-Fr 10:00-22:00; Sa 11:00-23:00; Su off
```

The sample `sk_import.jsonl` necessarily contains partial `Sa …` rules from the
Saturday verification payload. These should not be imported as authoritative
weekly hours until the limited-view issue is resolved or the behavior is
explicitly accepted. Unknown/unparseable hours are omitted.

## Sample normalized records

```json
{"name":"Krčma Gurmánov Bratislavy | KGB","lat":48.1480586,"lng":17.1117081,"city":"Staré Mesto","country":"sk","venue_kind":"unknown","opening_hours_raw":"Sa 16:00-02:00","rating_value":4.1,"rating_count":1686}
{"name":"Dobrá Krčma","lat":48.1420376,"lng":17.2128257,"city":"Bratislava","country":"sk","venue_kind":"unknown","opening_hours_raw":"Sa 17:00-00:00","rating_value":4.7,"rating_count":17}
{"name":"KRČMA garden/bar/restaurant","lat":48.2204062,"lng":17.182062,"city":"Vajnory","country":"sk","venue_kind":"unknown","opening_hours_raw":"Sa 16:00-23:00","rating_value":5.0,"rating_count":23}
{"name":"Bystrička","lat":48.7369134,"lng":19.1410177,"city":"Banská Bystrica","country":"sk","venue_kind":"unknown","opening_hours_raw":"Sa 10:00-22:00","rating_value":4.4,"rating_count":29}
{"name":"Pohostinstvo u Babky","lat":48.7628944,"lng":19.2030299,"city":"Selce","country":"sk","venue_kind":"unknown","opening_hours_raw":"Sa 10:00-22:00","rating_value":4.4,"rating_count":7}
```

## Full Slovakia estimate

The 0.1-degree grid has 657 root tiles whose centers are inside the supplied SK
polygon. With eight keywords that is 5,256 tile-keyword searches before adaptive
splits.

Based on the sample's average 27.6-second page time plus the default randomized
2.5–5.5-second inter-search delay:

- minimum, with no splits: about 46 browser-hours;
- likely with the observed 20-result cap and city/restaurant subdivisions:
  roughly 6,000–10,000 searches and 53–88 browser-hours;
- rich map-feed responses: about 31,500 minimum, plausibly 36,000–60,000 after
  subdivision;
- total browser responses: the sample saw 3,066 for two searches. A naive linear
  projection is about 8 million at the minimum search count, although shared
  browser caching should reduce later static-resource traffic. A practical
  planning range is roughly 3–8 million browser requests/responses.

These estimates exclude any future per-place detail navigation needed to obtain
complete seven-day hours. That would materially increase both runtime and bot
risk.

## Resumability and output notes

- `sk_places_raw.jsonl` is append-only and deduplicated by full feature ID.
- `sk_scrape_checkpoint.jsonl` records each completed tile/keyword task. Captcha
  and 429 tasks are intentionally left retryable on restart.
- Saturated tasks split into four children up to the configured maximum depth.
- `sk_import.jsonl` deduplicates by `(geohash8, casefolded/collapsed name)` and
  keeps the duplicate with more reviews.
- No bearer tokens, cookies, proxy credentials, GPS history, or request bodies
  are logged.

The current importer requires `row["cache_key"]` and does not derive it.
`normalize_sk.py` therefore intentionally emits geohash8 as `cache_key`, despite
the older contract in `SPEC.md` saying to omit it. The generated JSONL is
compatible with the importer.

## Weekly hours follow-up

Investigated on 2026-07-18 from the same residential connection. The full
country sweep was not run.

### Consent and limited view

A fresh Chromium context was first sent through Google's consent page. Clicking
`Prijať všetko` completed the flow and created the expected consent state,
including a `SOCS` cookie. Starting a new Maps navigation with that state still
showed `Na Mapy Google sa pozeráte v obmedzenom zobrazení`, and the search-feed
place record still contained only `sobota` in slot `[203]`. Adding a legacy
`CONSENT=YES+...` cookie and reloading did not change either the banner or the
payload.

The restriction also remained with `hl=en&gl=us`, through `google.co.nz` after
completing that domain's consent flow, with desktop/mobile user agents, and with
a Playwright virtual clock advanced to another weekday. Google selected the
venue's actual local date server-side. Consent is therefore not the missing
unlock on this IP.

### Place-detail interception

Clicking a result card does issue the expected request:

```text
GET /maps/preview/place?...feature id...
```

The decoded response root contains the 260-slot place record at `[6]`. Confirmed
detail paths for the Bratislava KGB sample are:

| Field | Detail response path |
| --- | --- |
| Feature ID | `[6][10]` |
| Name | `[6][11]` |
| Rating value | `[6][4][7]` |
| Review count | `[6][37][1]` |
| Google place ID | `[6][78]` |
| Opening-hours block | `[6][203]` |

The detail response was about 21 KB and contained two occurrences of `sobota`
(the duplicated current-day presentation) and no other weekday. Navigating
directly by `?ftid=0x...:0x...` produced the same record in
`APP_INITIALIZATION_STATE`, again with only the current day. Expanding the
weekly-hours control rendered only Saturday. The hours-edit route was also
checked, but it requires Google sign-in before showing an edit form.

The place-bound Google Search URL embedded in the detail record was not a usable
fallback: the residential IP received HTTP 429 for both the free-text and
`ludocid` variants, while Maps detail requests continued returning HTTP 200.

### Fifteen-place timing sample

Each timing includes direct `ftid` navigation, initialization-state retrieval,
and a 650 ms settle wait. It excludes the randomized 0.35-0.65 second delay
between places. All 15 responses were HTTP 200 and all rendered titles matched
the raw record name.

| # | Place | Days in detail | Time |
| ---: | --- | --- | ---: |
| 1 | Krčma Gurmánov Bratislavy \| KGB | `sobota` | 2.42 s |
| 2 | Dobrá Krčma | `sobota` | 1.25 s |
| 3 | KRČMA garden/bar/restaurant | `sobota` | 1.23 s |
| 4 | SALU - krčma , bar | `sobota` | 1.28 s |
| 5 | Krčma | none | 1.22 s |
| 6 | Krčma na Zelenej | `sobota` | 1.28 s |
| 7 | Dungeon Pub | `sobota` | 1.25 s |
| 8 | Centrálna Klubovňa | `sobota` | 1.83 s |
| 9 | Espresso Max | `sobota` | 1.27 s |
| 10 | Remíza-Jelínkova krčma | `sobota` | 1.26 s |
| 11 | Šenk | `sobota` | 1.23 s |
| 12 | U Haasa | `sobota` | 1.25 s |
| 13 | Dolnozemská | `sobota` | 1.29 s |
| 14 | Hostinec Opapa | none | 1.25 s |
| 15 | Hostinec Patkoš | `sobota` | 1.27 s |

Mean detail time was 1.37 seconds per place (median 1.26, range 1.22-2.42).
Thirteen records had one day, two had no hours, and zero had two or more days.

If this endpoint starts returning full weeks in an authorized context, the
measured browser work plus a polite 1-2 second inter-place delay would add about
39-56 minutes per 1,000 unique places. Scenario totals are 13-19 hours for
20,000 places, 26-37 hours for 40,000, or 40-56 hours for 60,000. Added to the
existing 53-88 browser-hour search estimate, those examples become roughly
66-144 browser-hours. The true total depends on the unique-place count after
cross-keyword deduplication.

### Result and blocker

No `sk_place_details.jsonl` stage was added because the prerequisite did not
hold: anonymous place detail is just as partial as search. Persisting it as a
weekly-hours source would incorrectly promote a single Saturday rule to an
authoritative schedule. For the same reason, `normalize_sk.py` was not changed
to prefer detail data that is not actually weekly. It continues to preserve the
required `cache_key` field.

The current 40-row `sk_import.jsonl` therefore still has only single-day or
missing hours; the requested real multi-day verification could not be produced
anonymously. Completing it now requires a product choice outside the requested
anonymous flow: an explicitly authorized signed-in Google context (with account
and bot-risk implications), a different licensed data source, or a seven-day
accumulation strategy that revisits every place on each weekday. The paid Places
API would also solve the data gap but remains explicitly out of scope.

## 7-day accumulation build

Implemented on 2026-07-18 after the product owner selected the anonymous
seven-day accumulation strategy. The full-country discover was **not** run
locally.

### Changes and file formats

`scrape_sk.py` now has two explicit modes:

- `--mode discover` retains the tiled, adaptive, resumable search. Every newly
  discovered raw place includes `scraped_weekday` (`0` Monday through `6`
  Sunday), a timezone-aware ISO `scraped_at`, and `google_place_id` when the
  `[78]` value is a `ChIJ…` ID.
- `--mode hours` reads the unique feature IDs from `sk_places_raw.jsonl` and
  navigates directly to `?ftid=…`. It decodes the XSSI-prefixed detail document
  embedded in `APP_INITIALIZATION_STATE`, extracts only the current Bratislava
  weekday, and appends to `sk_hours_by_day.jsonl`. HTTP 429, captcha, navigation,
  and missing-detail failures remain retryable and receive the same randomized
  pacing/backoff as discovery.

New discover records keep the existing raw shape plus the two capture fields and
Google ID:

```json
{"feature_id":"0x…:0x…","google_place_id":"ChIJ…","name":"…","lat":48.1,"lng":17.1,"address":"…","city":"…","rating_value":4.3,"rating_count":128,"categories":["Krčma"],"hours_periods":[…],"keyword":"krčma","scraped_weekday":5,"scraped_at":"2026-07-18T23:00:00+02:00"}
```

The daily append-only file has one successful capture per feature, weekday, and
local date. `null` means Google returned the place but did not expose a usable
interval; it is distinct from the explicit closed value `"off"`:

```json
{"feature_id":"0x…:0x…","weekday":5,"date":"2026-07-18","hours_interval":"11:00-23:00"}
{"feature_id":"0x…:0x…","weekday":5,"date":"2026-07-18","hours_interval":"off"}
{"feature_id":"0x…:0x…","weekday":5,"date":"2026-07-18","hours_interval":null}
```

`normalize_sk.py` merges raw day-one hours and daily rows by feature ID, then
uses the existing consecutive-day OSM merger. Missing weekdays are omitted,
`off` is preserved, and seven identical all-day values collapse to `24/7`.
Later usable daily rows replace earlier values for that weekday; `null` does not
erase an earlier usable observation. The output still contains required
geohash8 `cache_key`, rating, review count, city, `country="sk"`, and
`venue_kind="unknown"`, and now additively carries `google_place_id` from new
discover rows.

`pi_bootstrap.sh`, `run_discover.sh`, and `run_hours.sh` are POSIX `sh`, resolve
their own directory, and are safe to invoke repeatedly. The run wrappers write
timestamped logs under `logs/`. `DEPLOY.md` contains the same deployment runbook
as below.

### Local verification

The daily pass was run against all 40 existing unique feature IDs. Google
returned HTTP 200 details without a captcha or 429. The append result was:

```text
Finished hours run: appended=40 failed=0
daily_rows=40 daily_intervals=37 daily_nulls=3
```

The same command was immediately run again. It did not launch Chromium or append
anything:

```text
Mode=hours date=2026-07-18 weekday=5 discovered=40 already_completed=40 pending=0
Nothing to do; every discovered place is already recorded today
rows_before=40 rows_after=40
```

Normalization and assertions produced:

```text
normalized 40 unique identities -> sk_import.jsonl
{"raw_places":40,"daily_rows":40,"daily_intervals":37,"daily_nulls":3,"normalized_rows":40,"rows_with_hours":37,"rows_with_cache_key":40,"synthetic_week":"Mo-Fr 10:00-22:00; Sa 11:00-23:00; Su off"}
```

Five real normalized samples after the merge:

```json
{"name":"Krčma Gurmánov Bratislavy | KGB","lat":48.1480586,"lng":17.111708099999998,"cache_key":"u2s1vmh6","city":"Staré Mesto","country":"sk","venue_kind":"unknown","opening_hours_raw":"Sa 16:00-02:00","rating_value":4.1,"rating_count":1686}
{"name":"Dobrá Krčma","lat":48.142037599999995,"lng":17.2128257,"cache_key":"u2s1zevz","city":"Bratislava","country":"sk","venue_kind":"unknown","opening_hours_raw":"Sa 17:00-00:00","rating_value":4.7,"rating_count":17}
{"name":"KRČMA garden/bar/restaurant","lat":48.2204062,"lng":17.182062,"cache_key":"u2s4qfr8","city":"Vajnory","country":"sk","venue_kind":"unknown","opening_hours_raw":"Sa 16:00-23:00","rating_value":5.0,"rating_count":23}
{"name":"SALU - krčma , bar","lat":48.136547,"lng":17.198085,"cache_key":"u2s1z6gr","city":"Bratislava","country":"sk","venue_kind":"unknown","opening_hours_raw":"Sa 17:00-20:00","rating_value":4.5,"rating_count":18}
{"name":"Krčma","lat":48.1286006,"lng":17.2092907,"cache_key":"u2s1z9e3","city":"Bratislava","country":"sk","venue_kind":"unknown","rating_value":5.0,"rating_count":2}
```

The local 40-place raw file predates the addendum, so those normalized samples
cannot yet show `google_place_id`. A parser assertion against the saved
260-slot diagnostic record confirmed that new discover rows extract a `ChIJ…`
value and that the normalizer carries it unchanged.

### Exact Raspberry Pi deploy steps

From this directory on the development machine:

```sh
ssh tomas-pi 'mkdir -p "$HOME/na-pivo-sk-scrape"'
rsync -av \
  SPEC.md SPEC_ADDENDUM.md REPORT.md DEPLOY.md \
  scrape_sk.py normalize_sk.py \
  pi_bootstrap.sh run_discover.sh run_hours.sh \
  tomas-pi:~/na-pivo-sk-scrape/
ssh tomas-pi 'cd "$HOME/na-pivo-sk-scrape" && chmod +x ./*.sh && ./pi_bootstrap.sh'
```

Run the isolated two-tile smoke test:

```sh
ssh tomas-pi 'cd "$HOME/na-pivo-sk-scrape" && uv run scrape_sk.py --mode discover --sample --limit-tasks 2 --keywords krčma --output smoke_places_raw.jsonl --checkpoint smoke_checkpoint.jsonl --sample-record smoke_sample_record.json'
ssh tomas-pi 'cd "$HOME/na-pivo-sk-scrape" && wc -l smoke_places_raw.jsonl smoke_checkpoint.jsonl && sed -n "1,2p" smoke_places_raw.jsonl'
```

Start the resumable full-country discovery once:

```sh
ssh tomas-pi 'cd "$HOME/na-pivo-sk-scrape" && nohup ./run_discover.sh >/dev/null 2>&1 &'
ssh tomas-pi 'cd "$HOME/na-pivo-sk-scrape" && ls -1t logs/discover-*.log | head -1 | xargs tail -f'
```

After discovery has written `sk_places_raw.jsonl`, install the idempotent daily
cron and optionally capture the first weekday immediately:

```sh
ssh tomas-pi '(crontab -l 2>/dev/null | sed "/# na-pivo-sk-hours$/d"; printf "%s\n" "20 03 * * * \"\$HOME/na-pivo-sk-scrape/run_hours.sh\" # na-pivo-sk-hours") | crontab -'
ssh tomas-pi 'crontab -l'
ssh tomas-pi 'cd "$HOME/na-pivo-sk-scrape" && ./run_hours.sh'
```

After seven distinct weekdays, normalize, inspect, and copy the results back:

```sh
ssh tomas-pi 'cd "$HOME/na-pivo-sk-scrape" && uv run normalize_sk.py && sed -n "1,5p" sk_import.jsonl'
rsync -av tomas-pi:~/na-pivo-sk-scrape/sk_places_raw.jsonl .
rsync -av tomas-pi:~/na-pivo-sk-scrape/sk_hours_by_day.jsonl .
rsync -av tomas-pi:~/na-pivo-sk-scrape/sk_scrape_checkpoint.jsonl .
rsync -av tomas-pi:~/na-pivo-sk-scrape/sk_import.jsonl .
```
