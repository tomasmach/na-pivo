# Na pivo 3.0 — produktová specifikace

Stav k 6. 8. 2026. Větev `feat/napivo-3-0`.

Tenhle dokument popisuje, **co 3.0 je a podle jakých pravidel se chová**. Vizuál
je v `docs/design-system.md`, zadání pro designéra v `docs/design-brief-3-0.md`,
jednotlivá rozhodnutí v `docs/decisions/`.

---

## 1. Co se mění

2.x byl **pivní deníček s kompasem**. 3.0 je **companion celého večera**:

```
PŘED          BĚHEM                     PO
kam jít   →   večer u stolu s lidmi  →  recap a příspěvek
kompas        piva, hry, fotky          statistiky, rekordy, feed
```

Kompas nezmizel — je první buňkou seznamu hospod a pořád je to nejrozpoznatelnější
věc produktu. Přestal ale být celou appkou.

## 2. Navigace

Pět tabů, Party uprostřed:

| tab | co tam je |
|---|---|
| **Kocoviny** | feed — večery, které lidi zveřejnili |
| **Hospody** | kompas v hlavě seznamu, hledání, filtry, detail hospody |
| **Party** | běžící večer: piva, lidi, hry, fotky, vlákno |
| **Komunita** | žebříčky, výzvy, akce |
| **Profil** | statistiky, rekordy, aktivita, účet a nastavení |

## 3. Večer — jádro produktu

### 3.1 Jeden zápis, dva čtenáři

**Nejdůležitější pravidlo celé 3.0.** Pivo se zapisuje **jednou**, do deníčku
(`DrinkLog`), tam kde vždycky. Když u toho běží sdílený večer, řádek se jen
**označí** jeho kódem. Sdílený stůl je čtenář těch řádků, ne druhé místo zápisu.

Předchozí party se v červenci 2026 mazala právě proto, že chtěla každé pivo
podruhé. Detail v `docs/decisions/one-write-two-readers.md`.

Důsledek: „+1 pivo" v hubu, v minimalizované liště i během hry je **to samé +1**
jako v počítadle — stejný store, stejná offline fronta, stejný řádek.

### 3.2 Sdílený stůl

Jeden člověk večer založí a přečte přes stůl **šestimístný kód**; ostatní
přisednou. Kód nemá O, I, L, S, Z ani 0, 1, 5 — znaky, které si hospoda mezi
sebou plete. Od té chvíle na kódu visí všechno sdílené: členové, hry, kvíz.

- Přisednutí je souhlas se sdílením. Kdo má vypnuté „kamarádi vidí můj
  automatický pivní feed", tomu se pivo k večeru **nenaváže** — zapíše se do
  deníčku a v cizí časové ose se neobjeví.
- Odejít ≠ ukončit. Stůl hraje dál, jen ten telefon je venku.
- Neúspěšné načtení večera **nezavře stůl**. Projít sklepem není odchod.

### 3.3 Večer jako data

Jeden tvar (`NightRecord`), ze kterého čte hub, recap i příspěvek. Všechna čísla
jsou **čisté funkce** nad ním — nic se neukládá ani neinkrementuje, takže když se
pivo vezme zpátky, změní se všude.

Pravidla, která jsou produktová, ne matematická:

1. **Pivo je pivo.** Nealko, panák a víno se počítají, ale nikdy jako piva.
2. **Remíza je remíza.** MVP je `null`, když se o špičku dělí dva.
3. **Prázdná hodina dostane sloupec.** Jinak se večer nakreslí klidnější, než byl.
4. **Vyrovnat rekord není překonat rekord.**
5. Ceny, útrata, promile a čas do řízení se v datech večera **neobjevují nikdy**
   (`docs/decisions/no-bac-or-driving-estimates.md`).

Zdroje jsou řádky, které už existují: `DrinkLog`, `PartyEveningMember`,
`PubVisit`, `PartyGame`, `BeerPhoto`. Pro party se neukládá nic nového.

### 3.4 Vlákno

Log večera je **odvozený**, ne ukládaný: pivo, fotka, hra, přisednutí, přesun —
seřazené v čase a podepsané. U stolu pro čtyři je nepodepsaný řádek appka, která
mluví sama se sebou. Když se pivo vezme zpátky, zmizí i z vlákna.

## 4. Hry

Devět her v katalogu. Hra je **obsah plus skořápka**, ne vlastní obrazovka —
desátá hra má být řádek v `gameCatalog.ts`, ne nová složka.

| hra | jak se hraje | skóre |
|---|---|---|
| Pub kvíz | každý na svém telefonu | body |
| Kostky | 3D, fyzika, telefon koluje | body → kdo platí |
| Kdo platí rundu | 3D kolo se jmény | doušky |
| Flaška | 3D láhev | doušky |
| Nikdy jsem…, Kategorie, Palec, Pravidlo večera | balíček karet | doušky |
| King's Cup | tažení karty | doušky |

### 4.1 Platforma a hra

Fyzické hry běží v **WebView** (three.js + cannon-es), textové v React Native.
Mezi nimi je pevný protokol (`src/games/protocol.ts`) a tři pravidla:

1. Plátno smí **zdobit, ne vyprávět** — text je vždycky nativní.
2. **Hra je zdroj náhody.**
3. **Každá hra končí tím, že to řekne** — `result`, ne domněnka platformy.

Konec kreslí platforma (`GameResult`) a **tvar se odvozuje z dat**, ne z příznaku:
je tam `payingId` → někdo platí; je tam `winnerId` → někdo vyhrál; víc skóre →
žebříček. Hra na pití nikdy nekorunuje vítěze — jediná tabulka, kterou by mohla
vyrobit, je kdo nejvíc pil.

### 4.2 Sdílení

Hra položená na stůl je řádek `PartyGame`, všechno v ní je **append-only
událost**. Každý telefon skládá stejný seznam do stejného obrazu — žádný merge,
žádné last-writer-wins. Dva lidi, kteří odpoví ve stejnou vteřinu, oba dorazí.

Kvíz: odpovědi jdou frontou ven a streamem dovnitř. **Odpověď týmu je ta první**,
takže tvoje vlastní odpověď vrácená serverem složí na stejný výsledek jako
lokální kopie — idempotence padá z pravidel hry, ne z infrastruktury. Kvíz je
**samospádem**: každý telefon má svůj index otázky a odhalení je po otázce,
jakmile odpověděly všechny týmy.

## 5. Po večeru

**Recap** — velká čísla, kdo tam byl a co vypil, štace, tempo po hodinách, hry,
a „Padlo tenhle večer" jen tehdy, když opravdu něco padlo. Rekordy se měří proti
**tvé vlastní** historii, nikdy proti ostatním; pijácký den (04:00) je jeden
večer, i když jsi prošel tři hospody.

**Příspěvek** jde na `POST /v1/nights` — endpoint, který už má feed, reakce i
offline frontu. Klíčem je **pijácký den**, takže večer publikovaný z hubu a ten
samý z Výčepu je jeden příspěvek, který se aktualizuje. Ven jdou počty a jména
hospod. **Nikdy ceny, souřadnice telefonu ani konkrétní piva.**

## 6. Provozní pravidla

- **Offline first.** Počítadlo, vlákno a hry fungují bez signálu; sdílení je
  best-effort navrch. Kód, který se nepodařilo doručit, nikdy nesmí zablokovat
  zápis piva.
- **Fronty jsou idempotentní** přes `client_id`. Retry nezdvojí nic.
- **API zůstává kompatibilní** s vydanými appkami — nová pole jen aditivně.
- **SSE má strop 10 minut** a pak řekne klientovi, ať se vrátí. Klient umí spadnout
  na polling, takže rollback backendu appku nerozbije.

## 7. Stav — co je hotové a co ne

| oblast | stav |
|---|---|
| Navigace, pět tabů | hotové |
| Večer: založit, přisednout, odejít, ukončit | hotové |
| Piva jedním zápisem, s kódem večera | hotové |
| `NightRecord` + statistiky + vlákno | hotové |
| Devět her | hratelné |
| Sdílené hry (řádek, události, výsledek) | hotové, klient i backend |
| Kvíz na víc telefonů | hotové |
| Recap na reálných datech | hotové, včetně fotek |
| Příspěvek na `/v1/nights` | hotové |
| Fotky večera | hotové — reálný picker → offline fronta → upload |
| Cizí příspěvky ve feedu | hotové — `GET /v1/nights/feed` + reakce |
| Hospody: seznam, kompas, mapy, detail, hledání | hotové na reálných datech |
| Komunita: žebříčky, výzvy (`GET /v1/challenges`), akce | hotové; texty seedovaných výzev čekají na schválení |
| Profil: statistiky, rekordy, odznaky, aktivita (`scope=mine`) | hotové |
| Skeleton loadingy | hotové i v nové půlce appky |
| Placeholder fotky (`pravatar`, `picsum`) | odstraněné z appky (zbývají jen v docs) |
| **Týmy pro komunitní eventy** | pravidla hotová, model a obrazovka ne — mock je neukazuje, odloženo |
| **ASGI/SSE na produkci** | zacommitované, **nenasazené** — nutný api-* deploy (migrace 0094–0097) před releasem |

## 8. Otevřená rozhodnutí

- **Auto-friendship.** Doporučení: auto-**návrh**, ne automatická vazba. Sedět
  s někým v hospodě není souhlas s trvalou sociální vazbou.
- **Verze bez přihlášení** — co se stane s lokálními záznamy, když se člověk
  přihlásí do účtu, který už data má (`docs/no-account-mode.md`).
- **Názvosloví** pro sledování: „Sledovat" vs „Parťák".
- **Monetizace.** Free/pro hranice není daná. Sdílený večer a hry jsou levné;
  drahé jsou datové a proxy části.
- **Cover artwork her** — dnes gradient s glyfem. Viz design brief.
