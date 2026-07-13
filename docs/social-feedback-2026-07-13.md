# Social feedback pro Na pivo

Průběžný audit zahájený 13. 7. 2026 z veřejných komentářů k Reels/TikTokům účtu a z relevantních zpráv v Instagram **General**. Záměrně neuvádí jména, handly ani citlivé detaily o lidech.

## Rozsah a stav průchodu

- Instagram: profil obsahuje přibližně 115 Reels; audit je veden přes celý profil, ne jen přes původně zadaný Reel.
- TikTok: profil obsahuje 83 videí. Bylo identifikováno pět zjevných Na pivo / update kandidátů, ale po úplném načtení prvního 79komentářového vlákna TikTok zablokoval další přímé čtení ochranou WAF. Blokaci neobcházíme; bez obnoveného přístupu proto nelze tvrdit, že jsou komentáře u zbylých TikToků kompletní.
- Instagram General: zahrnuté jsou výhradně konverzace s explicitním feedbackem k Na pivo; nerelevantní soukromé konverzace se nečtou ani nereportují.

### Instagram: zjištěné Na pivo zdroje

Z kompletního inventáře 115 Reels vycházejí z popisků a kontextu jako Na pivo / update zdroje tyto příspěvky:

- [DaDf9d1o_jg](https://www.instagram.com/jsem_mach/reel/DaDf9d1o_jg/) — update aplikace.
- [DZp1auNIFep](https://www.instagram.com/jsem_mach/reel/DZp1auNIFep/) — pravděpodobný „big updates“ příspěvek.
- [DZnJXZ8Ivu8](https://www.instagram.com/jsem_mach/reel/DZnJXZ8Ivu8/) — pravděpodobný „update zítra“ příspěvek.
- [DZiExGgIxWk](https://www.instagram.com/jsem_mach/reel/DZiExGgIxWk/) — aplikace už neukazuje cestu domů.
- [DZfeD83I9O-](https://www.instagram.com/jsem_mach/reel/DZfeD83I9O-/) — download / Android.
- [DZdK30FoIAE](https://www.instagram.com/jsem_mach/reel/DZdK30FoIAE/) — explicitní Na pivo update.
- [DZSmRGBgbr8](https://www.instagram.com/jsem_mach/reel/DZSmRGBgbr8/) — původně zadaný Reel (153 komentářů).
- [DZIeN-vIbc0](https://www.instagram.com/jsem_mach/reel/DZIeN-vIbc0/) — možný starší dev kontext, nutné ověřit z komentářů.

## Jasně opakované požadavky

| Priorita | Požadavek | Signál |
| --- | --- | --- |
| P0 | Android / Google Play verze | Velmi časté na TikToku i Instagramu. |
| P0 | Zohlednit a filtrovat právě otevřené hospody | Opakovaně, včetně scénáře hledání o půlnoci. |
| P0 | U hospody ukázat, co se právě čepuje; ideálně podle piva filtrovat | Opakovaně a konkrétně: uživatel raději půjde dál za preferovanou značkou. |
| P1 | Umožnit dopsat piva a návštěvu zpětně, mimo místo / až následující den | Přímá žádost z General; jeden večer může uživatel vyplňovat až doma. |
| P1 | Přesnější kvalita databáze hospod | Aplikace občas vede do míst bez točeného piva, k večerkám nebo nečekaně vzdáleného místa. |
| P1 | Nahlásit špatné / nevhodné místo | Přímý návrh z TikToku; přirozený doplněk k čištění databáze. |
| P1 | Zapsat pivo mimo registrovanou hospodu | General: doma nebo u kamaráda. |
| P2 | Evidovat i ne-pivní nápoje | General: konkrétně cola a panáky. |
| P2 | Zobrazit i stánky a kempy | General: návrh rozšířit discovery mimo klasické hospody. |
| P1 | Pivní deníček a roční „beer wrapped“ | Instagram update Reel: ukládat každé pivo včetně značky a země a ukázat roční rekapitulaci. |
| P2 | Detailní osobní statistiky | Instagram update Reel: ranní souhrn, průměrný čas na pivo, rekord, statistiky po hospodách, měsíční a roční součty. |
| P2 | Najít parťáka na pivo v konkrétní hospodě | Instagram update Reel: lehký sociální signál a možnost se přidat. |

## Další konkrétní podněty

- U hospody zobrazit otevírací dobu vedle toho, co se čepuje.
- Zobrazit cenovou dostupnost piva nebo levné pivo; není jasné, zda je to požadavek na filtr, nebo jen nápad k vizuálu kompasu.
- Rozlišit hospodu od večerky a míst, kde se pivo reálně nedá dát.
- Podpořit širší geografii: Brno, Slovensko a dotaz na fungování mimo ČR. To je spíš očekávání pokrytí než samostatná nová funkce.
- Možnost doplnit chybějící podnik je důležitá: uživatelé hlásí jak chybějící místa, tak alespoň jeden případ, kdy přidání místa nefungovalo.
- V jednom Instagram vlákně byly vyjmenované tři chybějící hospody v Českých Budějovicích. Jména podniků sem kvůli čistému produktovému backlogu neukládám; doplnění míst je ale ověřený konkrétní request.
- Kompas ve směru domů / navigace domů se objevil jako samostatný návrh.
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
7. Postavit pivní deníček na jednoduchém logování, pak přidat užitečné statistiky a až následně opt-in sociální „jdu na pivo“ signál.

## Poznámka k metodě a soukromí

TikTok měl 79 rodičovských komentářů a Instagram Reel 153 komentářů. Předchozí tabulka slučuje duplicitní žádosti do produktových témat; reakce, meme odpovědi a žádosti bez návrhu funkce jsou vynechané. V General byly zahrnuté pouze konverzace, jejichž náhled nebo otevřená zpráva explicitně mluvily o Na pivo; report neobsahuje osobní konverzace ani identifikátory.
