# Handoff: dokončení Google Places matchingu (na 2026-07-19 ráno)

## Kontext

Matchujeme hospody na Google Place IDs (deep link na place card v Google Mapách).
Stav k večeru 2026-07-18:

- Backend `api-2026.07.18.3` je nasazený v produkci, migrace `0081_pubgoogleplace` aplikovaná.
- V produkci je naimportováno 53 942 place IDs (tabulka `pubs_pubgoogleplace`), API je ověřené.
- Full matching narazil na denní kvótu Googlu (75 000 SearchText requestů/den). Zpracováno 72 958 z 97 864 identit v `universe.jsonl`; zbývá ~24 900.
- Kvóta se resetuje v 09:00 CEST. Ve včerejší session je na 09:10 naplánovaný background task, který matching automaticky doběhne — pokud session přežila, možná už běží nebo doběhl.

## Kroky

1. Zjisti, jestli matching běží nebo doběhl:
   - `pgrep -af match_places.py`
   - `wc -l /home/tomasmach/Code/na-pivo/.pubmatch/matches.jsonl` (cíl: ~97 400 řádků; 442 gave_up z prvního dne bylo odfiltrováno, universe má 97 864)
2. Pokud neběží a řádků je míň než ~97 000, spusť ho (je resumovatelný, naváže sám):
   - tunel: `pkill -f "ssh -o ExitOnForwardFailure=yes -D 1080"; ssh -o ExitOnForwardFailure=yes -D 1080 -N -f mach-projects`
   - `uv run /home/tomasmach/Code/na-pivo/.pubmatch/match_places.py` (běh ~1 h; API klíč čte z `.pubmatch/.apikey`, je IP-restricted, proto tunel)
3. Po doběhnutí zkontroluj: `grep -o '"status": "[a-z_0-9]*"' .pubmatch/matches.jsonl | sort | uniq -c` — případné `gave_up` řádky vyfiltruj a přežeň znovu (`grep -v gave_up matches.jsonl > tmp && mv tmp matches.jsonl`, pak znovu krok 2).
4. Import do produkce (idempotentní, už naimportované řádky skončí jako `unchanged`):
   ```bash
   cd /home/tomasmach/Code/na-pivo/.pubmatch
   grep '"status": "matched"' matches.jsonl > matched_only.jsonl
   scp -q matched_only.jsonl mach-projects:/tmp/
   ssh mach-projects 'docker cp /tmp/matched_only.jsonl napivo-web:/tmp/ && docker exec napivo-web python manage.py import_google_place_ids /tmp/matched_only.jsonl'
   ```
5. Ověř produkci:
   ```bash
   ssh mach-projects 'docker exec napivo-db psql -U napivo -d napivo -c "SELECT count(*) FROM pubs_pubgoogleplace;"'
   curl -s "https://api.na-pivo.cz/v1/pubs/near?lat=49.1951&lng=16.6068&radius_km=2" | python3 -c "import json,sys; items=json.load(sys.stdin)['items']; print(len([i for i in items if i.get('googlePlaceId')]), '/', len(items))"
   ```
6. Aktualizuj paměť `google-places-matching` (matching dokončen, finální počty) a ukliď: `ssh mach-projects 'rm /tmp/matched_only.jsonl'`.

## Poznámky

- Mobilní část (buildMapsUrl s `query_place_id`) je v `dev` commitnutá, ale projeví se až s novým mobilním buildem/OTA z `main` — samostatné rozhodnutí, neděj bez pokynu.
- Nic z tohohle nestojí peníze: matching jede na free „IDs Only" masce, jen denní limit 75k requestů.
