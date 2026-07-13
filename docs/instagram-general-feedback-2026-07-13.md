# Instagram General — feedback k Na Pivo

Audit provedený 13. 7. 2026 ručním průchodem záložky **General** na Instagramu až na konec seznamu. Bez vyhledávání: konverzace byly otevírány jednotlivě a jejich historie byla odscrollována. Zprávy ze záložky Primary nejsou zahrnuté. Výstup je anonymizovaný a neobsahuje jména, účty ani e-maily.

## Nejčastější a nejdůležitější signály

1. **Zápis piva zpětně a mimo aktuální polohu** — možnost doplnit včerejší večer, zapsat více piv po návratu domů nebo vybrat jinou než nejbližší hospodu.
2. **Společná návštěva party** — cinknutí dnes vytváří oddělené záznamy. Lidé chtějí jeden společný večer, přehled kdo je kde a co pije a chronologickou aktivitu party.
3. **Statistiky piv** — celkové, týdenní a měsíční počty, rozpad podle značek a stejné statistiky na profilech kamarádů.
4. **Kvalita dat o hospodách** — zavřené podniky, chybné otevírací doby či hodnocení, špatně přiřazená adresa a neúčinné hlášení chyby.
5. **Více možností výběru podniku** — zobrazit několik nejbližších hospod, umět preferovat skutečné hospody před restauracemi a přidávat netradiční místa.

## Funkční requesty

### Zápis večera a nápojů

- Zapsat piva zpětně s volbou data a času, typicky ráno po večeru.
- Zapsat více piv najednou, i když už je uživatel desítky kilometrů od hospody.
- Vybrat při zpětném zápisu libovolnou hospodu na mapě, ne pouze nejbližší podnik.
- Zapsat pivo bez registrované provozovny — doma, u kamaráda nebo na jiné soukromé akci.
- Přidat i nealko a tvrdý alkohol, zejména colu a panáky, včetně běžných objemů panáků.
- Jednoduché počítadlo vypitých piv.
- Týdenní a měsíční souhrny počtu piv.
- Statistiky podle značky piva a celkový počet piv.
- Zobrazit pivní statistiky také na profilech kamarádů.

### Parta a sociální funkce

- Sloučit cinknutí kamarádů u jednoho stolu do jedné společné návštěvy/party místo duplicitních samostatných záznamů.
- Po stisknutí „Jdu“ dát partě jasně vědět, kde uživatel je.
- Pasivně zobrazit, ve které hospodě kamarádi právě sedí, bez nutnosti vzájemného cinknutí.
- Chronologický feed společného večera: kdo přišel, kde sedí, kolik a jaká piva si zapsal.
- Jednodušší a lépe objevitelný způsob přidávání kamarádů.

### Hospody a mapa

- Zobrazit například pět nejbližších hospod namísto jediné.
- Umožnit preferovat hospody a craft beer bary před restauracemi, pokud jsou podobně daleko.
- U podniku zobrazit, zda má jídlo nebo něco k zakousnutí.
- U podniku zobrazit, zda právě probíhá událost nebo akce.
- Podpora hospod mimo Česko a Slovensko; konkrétní signál byl z dovolené na Tenerife.
- Mapa navštívených míst.
- Přidávání netradičních míst s výčepem, například sportovního areálu.
- Možnost opravit nebo změnit adresu nově přidané hospody.
- Lepší dohledatelnost nově přidaných podniků.
- Důvěryhodnější řazení výsledků podle typu podniku, relevance a aktuálního provozu.

### Lokalizace, nastavení a dostupnost

- Přepnutí měny na euro pro Slovensko má být snadno dohledatelné; ideálně automatická detekce nebo volba v onboardingu.
- Přímý a funkční odkaz na Google Play.
- Srozumitelnější vysvětlení požadavků Google účtu a věkového ověření na Androidu.

### Gamifikace a personalizace

- Kosmetické rámečky profilu.
- Barevné varianty ikony/sklenice piva.
- Odznaky a XP.
- Barevné motivy nebo layout podle oblíbené značky piva.
- „Pivní týmy“ ve stylu Pokémon Go, které podle vypitého objemu symbolicky ovládají hospody.
- Ochrana proti autoclickeru a nereálnému spamování piv; případně rozumný denní limit nebo detekce anomálií.

### Odpovědné pití

- Volitelná jemná připomínka vody například po čtyřech pivech.
- Orientační odhad alkoholu/promile podle zadaných údajů a vypitých nápojů.
- Režim pro řidiče s orientačním odhadem vystřízlivění. Tento request má vysoké bezpečnostní a právní riziko a nesmí slibovat způsobilost k řízení.

## Bugy a problémy

- Opakované odhlašování Google účtu přibližně po třech dnech; pravděpodobně tím přestávají chodit i notifikace.
- Po aktualizaci se jednomu uživateli zobrazoval chybný počet navštívených podniků a piv.
- „Jdu“ podle uživatele nepředává partě očekávanou informaci o poloze.
- Cinknutí stejné party vytváří duplicitní záznamy.
- Doporučení podniku, který je několik let zavřený; hlášení zavřeného podniku zřejmě nezafungovalo.
- Nesprávné nebo vzájemně pomíchané hodnocení a otevírací doby podniků kvůli párování datových zdrojů.
- Při přidání podniku se uložila aktuální/domácí adresa místo zadané adresy a nešla opravit.
- Hlášení chyby v aplikaci bylo v jednom případě nedostupné.
- Chybějící podnik nešel přidat nebo se po přidání nezobrazil.
- Odkaz na Google Play se některým uživatelům neotevřel.

## Copy feedback

- Změnit formulaci „Nemají točené“ na přirozenější „Nemají čepované“.

## Poznámky k interpretaci

- Request na odhad promile přišel nezávisle nejméně ve dvou konverzacích, takže nejde o osamocený nápad.
- Zpětný zápis a volba jiné než nejbližší hospody se opakovaly v několika vláknech a patří mezi nejsilnější signály.
- V General bylo také velké množství zpráv týkajících se náboru Android testerů, pochval, AI/programování a osobních témat. Ty byly zkontrolované, ale protože neobsahovaly produktový feedback k Na Pivo, nejsou v seznamu requestů.
- Stav „už je / není v aplikaci“ není v tomto dokumentu posuzovaný; jde o čistý výpis uživatelského feedbacku.
