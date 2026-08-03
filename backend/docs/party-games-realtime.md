# Sdílené hry — kontrakt a provoz

## Co to je

Hra u stolu, kterou vidí všichni členové party evening. Skóre se přenáší jako
**události**, ne jako stav.

## Proč události a ne stav

Dva lidi u stolu ťuknou bod ve stejnou chvíli. S uloženým součtem druhý zápis
tiše přepíše první a jeden bod zmizí. Jako události prostě obě dorazí a skóre je
jejich **součet**.

Vedlejší efekt, který je stejně důležitý: telefon, který byl offline, pošle
všechno, co si zapsal, jakmile chytí signál, v libovolném pořadí, a nic se
nemusí slučovat.

## Kontrakt

Jeden tvar pro dva transporty. Klient pošle kurzor, který má; server pošle
všechno po něm. **Reconnect je `since`**, ne zvláštní případ.

| endpoint | co dělá |
|---|---|
| `POST /v1/party-evenings/<code>/games` | hodí hru na stůl, idempotentní přes `client_id` |
| `GET /v1/party-evenings/<code>/games?since=<cursor>` | dohnání, funguje bez streamu |
| `POST /v1/party-evenings/<code>/games/<game_id>/events` | dávka událostí, idempotentní přes `client_id` |
| `GET /v1/party-evenings/<code>/games/stream?since=<cursor>` | totéž, jak se to děje (SSE) |

Kurzor je `id` řádku `PartyGameEvent`. Klient si drží největší, který viděl.

### Vrstvy parametrů

- **definice hry** (`key`, pravidla, cover) — nikdy neputuje, žije v appce;
- **instance** — `game_id`, `catalog_key`, `name`, `scoring`, `started_by`;
- **výsledek** — součet událostí, `winner` **jen** u `scoring: points`.

`catalog_key` se proti seznamu **nevaliduje**. Katalog roste s vydáním appky;
odmítat klíč, který server nezná, by znamenalo, že každá nová hra potřebuje
deploy backendu, a rozbilo by to novější telefon proti staršímu API. Jméno hry
cestuje s ní, takže telefon o verzi pozadu ukáže aspoň jméno a výsledkovku
místo prázdna.

`winner` u her na pití neexistuje. Korunovat vítěze by znamenalo korunovat toho,
kdo nejvíc pil — jediná výsledková listina, kterou tenhle produkt nesmí vést.

## Provoz — co se musí stát před nasazením

**Backend přešel z WSGI na ASGI.** `docker-entrypoint.sh` teď spouští
`gunicorn config.asgi:application --worker-class uvicorn.workers.UvicornWorker
--timeout 0`.

Bez toho SSE **shodí produkci**: pod sync workery drží otevřený stream jednoho ze
dvou workerů natrvalo, takže dva lidi u stolu zaberou celý API server — a
`--timeout 120` by ten stream stejně po dvou minutách zabil.

Ruční kroky u deploye:

1. **Caddy nesmí bufferovat.** Odpověď nese `X-Accel-Buffering: no`, ale Caddy
   se řídí `flush_interval`. Pro tenhle upstream nastav `flush_interval -1`,
   jinak je ze streamu jedno dlouhé ticho a pak všechno naráz.
2. **Ověř po deploy**, že běžné endpointy odpovídají — přechod na ASGI se týká
   celé aplikace, ne jen streamu. Sync views běží dál v threadpoolu.
3. **Rollback** je návrat na `config.wsgi` v entrypointu. Stream tím přestane
   fungovat, ale klient má `GET .../games?since=` jako plnohodnotnou náhradu —
   proto ten endpoint existuje.

## Cena

Stream se ptá databáze každou vteřinu na jeden indexovaný `id > cursor` dotaz.
U stolu pro pět to je 5 dotazů za vteřinu; u padesáti současných stolů 250/s,
což je strop, kde tohle přestane stačit.

Až ten strop nastane, mění se **jedna funkce** (`game_events_since` za pub/sub) —
ne kontrakt a ne klient. To je záměrně ten šev.

Každý stream má **strop 10 minut** a pak řekne klientovi, ať se vrátí. Ohraničený
stream je důvod, proč se tohle dá nechat běžet bez hlídání: nic neteče donekonečna
a deploy se vyprázdní místo toho, aby visel.
