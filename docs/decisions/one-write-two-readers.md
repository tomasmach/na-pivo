# Rozhodnutí: pivo se zapisuje jednou, večer je nad ním čočka

Status: přijato pro Na pivo 3.0

## Rozhodnutí

Pivo se zapisuje **jedním** zápisem — do deníčku (`DrinkLog`), tam kde se
zapisovalo vždycky. Když u toho běží sdílený večer, řádek se jen **označí**
kódem toho večera (`DrinkLog.party_evening`).

Sdílený stůl je čtenář těchto řádků, ne druhé místo na zápis.

- `POST /v1/drinks` přijímá volitelný `party_code`.
- Kód se **nikdy** nevaliduje tak, aby mohl zápis odmítnout. Neznámý, cizí nebo
  už ukončený večer se tiše ignoruje a pivo se uloží.
- `PartyEveningDrink` a `POST /party-evenings/<code>/drinks` zůstávají
  nedotčené. Vydané appky je volají a nejde je updatnout.
- Večer skládá časovou osu ze **dvou zdrojů**: `PartyEveningDrink` (staré
  appky) a `DrinkLog.party_evening` (současná). Duplicity nevznikají, protože
  žádný klient nepíše do obou.

## Proč

Explicitní party už jednou existovala a **29. 7. 2026 byla smazána**
(`3c5ef73`, −2161 řádků). Důvod je v `src/friends/sharedTable.ts`: každé pivo se
zapisovalo dvakrát — jednou do deníčku, který počítá, a jednou do tabulky, která
nepočítala nic. Lidé to dělat přestali a stůl zůstal prázdný.

Dvě tabulky znamenají dvě pravdy. Jakmile se rozejdou — a rozejdou se, protože
jedna z nich jde přes offline frontu — není jak rozhodnout, která má pravdu.

Tichý fallback je taky rozhodnutí: fronta se vyprazdňuje, až se chytí signál, což
může být po zavíračce. Kdyby jeden ukončený večer dokázal zápis odmítnout, zasekl
by za sebou všechna piva ve frontě.

## Soukromí

Přisednutí ke stolu sdílí, **že tam jsi**, ne co máš ve sklenici.

Když má účet vypnuté `share_drinks_with_parta` („kamarádi vidí můj automatický
pivní feed"), pivo se do večera **nenaváže**. Zapíše se normálně do deníčku,
jen se v cizí časové ose neobjeví. Přepínač dělá přesně to, co slibuje.

## Co to nemění

- Deníček, XP a statistiky se počítají ze stejných řádků jako dřív.
- Uživatel ťuká `+1` tam, kde ho ťukal vždycky.
- `on_delete=SET_NULL`: smazání večera nikdy nesmaže nikomu pivo.
