# Workflow kvality katalogu hospod

Katalog se kontroluje příkazem:

```bash
uv run python manage.py audit_pub_catalog
```

Příkaz nic nemění. Vypíše jeden JSON snapshot s časem měření, agregovanými metrikami a omezenou review frontou. Výstup je vhodný pro denní job a dlouhodobé porovnání v logovacím systému bez ukládání polohy uživatelů.

## Pravidelná kontrola

1. Denně ulož JSON výstup a sleduj `usable_venue_share`, počty aktivních reportů, staré řádky a podezřelé lokace.
2. Aktivní `not_pub` a `closed` reporty řeš před starými řádky. Ověřený report deaktivuje nebo opraví odpovídající katalogový záznam; zamítnutý report se ponechá pro audit jako neaktivní.
3. U starých řádků obnov zdroj dávkovým importem. Nezvyšuj frekvenci scrapování ani limity kvůli jedné položce.
4. U podezřelé lokace ověř adresu a zemi. Jednotlivé potvrzené chyby oprav auditovaným idempotentním fixem, například `apply_missing_pub_fixes`.
5. Po změně spusť report znovu. Denní snapshot musí ukázat pokles příslušné fronty bez zhoršení `usable_venue_share`.

Nearby API řadí výsledky primárně po krátkých vzdálenostních pásmech. U míst ve stejném 250m pásmu dostane potvrzená hospoda přednost před nejasnou restaurací; napříč pásmy zůstává rozhodující vzdálenost. Tohle pravidlo je pokryté API testy.

## Smoke test pokrytí

Po každém importu a alespoň jednou denně spusť:

```bash
uv run python manage.py check_pub_coverage --strict
```

Výchozí sada kontroluje Brno, Bratislavu, Košice a transparentně hlásí Tenerife jako komunitní oblast mimo CZ/SK adresář. Kontrola nikdy nevolá externí mapový zdroj, takže nepřidává proxy ani API náklady. Vlastní produkční vzorek lze přidat opakovaným parametrem `--sample "Město,lat,lng,radius_km,minimum"`.

Když podporované město klesne pod minimum, nejdřív ověř poslední import a `audit_pub_catalog`. Jednotlivé mezery oprav přes komunitní přidání nebo auditovaný fix. Rozšíření placeného/licencovaného datového zdroje mimo CZ/SK je samostatné produktové rozhodnutí; do té doby tam nearby API bezpečně vrací uživatelsky přidané podniky.
