# Social feedback pro Na pivo

Sepsáno 13. 7. 2026 z veřejných komentářů k zadanému TikToku a Instagram Reelu a z relevantních zpráv v Instagram **General**. Záměrně neuvádí jména, handly ani citlivé detaily o lidech.

## Jasně opakované požadavky

| Priorita | Požadavek | Signál |
| --- | --- | --- |
| P0 | Android / Google Play verze | Velmi časté na TikToku i Instagramu. |
| P0 | Zohlednit a filtrovat právě otevřené hospody | Opakovaně, včetně scénáře hledání o půlnoci. |
| P0 | U hospody ukázat, co se právě čepuje; ideálně podle piva filtrovat | Opakovaně a konkrétně: uživatel raději půjde dál za preferovanou značkou. |
| P1 | Umožnit dopsat piva a návštěvu zpětně, mimo místo / až následující den | Přímá žádost z General; jeden večer může uživatel vyplňovat až doma. |
| P1 | Přesnější kvalita databáze hospod | Aplikace občas vede do míst bez točeného piva, k večerkám nebo nečekaně vzdáleného místa. |
| P1 | Nahlásit špatné / nevhodné místo | Přímý návrh z TikToku; přirozený doplněk k čištění databáze. |

## Další konkrétní podněty

- U hospody zobrazit otevírací dobu vedle toho, co se čepuje.
- Zobrazit cenovou dostupnost piva nebo levné pivo; není jasné, zda je to požadavek na filtr, nebo jen nápad k vizuálu kompasu.
- Rozlišit hospodu od večerky a míst, kde se pivo reálně nedá dát.
- Podpořit širší geografii: Brno, Slovensko a dotaz na fungování mimo ČR. To je spíš očekávání pokrytí než samostatná nová funkce.
- Jeden Instagram komentář navrhoval podobný koncept pro posilovny; mimo aktuální produktový scope.

## Závady a regresní feedback

- Po updatu s kamarády se jeden uživatel opakovaně odhlašuje i při běhu aplikace na pozadí.
- Po opětovném přihlášení se mu rozcházel počet navštívených podniků a počet piv.

Tohle je přednostně incident pro sync / autentizaci, ne backlogový feature request. Ověřit zejména obnovu session a konzistenci lokálních statistik po resyncu.

## Doporučené pořadí malých kroků

1. Android vydání / tester onboarding dokončit odděleně od produktového backlogu.
2. Opravit session + resync regresi po friends updatu.
3. Přidat `otevřeno teď` jako jednoduchý filtr a signál v kompasu.
4. Přidat u hospody čepovaná piva; teprve potom filtr podle značky/stylu.
5. Přidat zpětný zápis piva s jasným datem a hospodou, bez ukládání GPS historie.
6. Přidat jednoduché nahlášení místa a interní frontu k revizi dat.

## Poznámka k metodě a soukromí

TikTok měl 79 rodičovských komentářů a Instagram Reel 153 komentářů. Předchozí tabulka slučuje duplicitní žádosti do produktových témat; reakce, meme odpovědi a žádosti bez návrhu funkce jsou vynechané. V General byly zahrnuté pouze konverzace, jejichž náhled nebo otevřená zpráva explicitně mluvily o Na pivo; report neobsahuje osobní konverzace ani identifikátory.
