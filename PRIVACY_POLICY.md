# Zásady ochrany osobních údajů – Na pivo

*Poslední aktualizace: 13. června 2026*

## Kdo jsme

Aplikaci **Na pivo** provozuje fyzická osoba (samostatný vývojář), dále jen „my" nebo „provozovatel". Tyto zásady vysvětlují, jaká data aplikace zpracovává, k čemu je používá a jaká práva v souvislosti s ochranou soukromí máte. Snažíme se sbírat co nejméně dat – a jak uvidíte níže, aplikace nesbírá prakticky nic, co by opouštělo váš telefon.

## Jaká data zpracováváme

### Poloha
Aplikace používá vaši aktuální polohu k tomu, aby vám ukázala směrovou šipku k vybrané hospodě (funguje jako kompas). **Vaše poloha nikdy neopouští váš telefon** – zpracovává se výhradně lokálně na zařízení a nikam ji neodesíláme ani neukládáme. Polohu na pozadí nevyužíváme.

### Pohybové senzory
Aplikace čte data z pohybových senzorů (kompas/akcelerometr), aby správně otáčela směrovou šipku podle natočení telefonu. Tato data se rovněž zpracovávají pouze lokálně a nikam se neodesílají.

### Vyhledávací dotazy
Když v aplikaci vyhledáváte hospodu podle názvu, odešle se zadaný text (a přibližná oblast mapy) na službu **Mapy.cz**, která vrátí návrhy míst. Bez tohoto dotazu by vyhledávání nefungovalo. Více v sekci „Služby třetích stran".

### Otevírací doba
Když je vybraná hospoda zobrazena, aplikace pošle její název a polohu (zeměpisné souřadnice) na náš vlastní server, který k danému místu dohledá otevírací dobu a vrátí ji zpět. Odesílá se pouze údaj o vybrané hospodě, nikoli o vás ani o vaší poloze. Tato funkce je nepovinná – pokud server není dostupný nebo dotaz selže, aplikace funguje dál bez zobrazení otevírací doby. Více v sekci „Služby třetích stran".

### Anonymní identifikátor zařízení
Aplikace při prvním spuštění vytvoří anonymní náhodný identifikátor zařízení (náhodné UUID) a odešle ho na náš vlastní server, aby každému zařízení patřil dočasný anonymní účet. Tento identifikátor neobsahuje žádné osobní údaje – nevzniká z e-mailu, jména, telefonního čísla ani z hardwarového identifikátoru telefonu – a slouží výhradně k odlišení jednotlivých zařízení. Registrace je nepovinná funkce; pokud server není dostupný nebo dotaz selže, aplikace funguje dál bez vytvořeného účtu. Server v odpovědi vrátí náhodný přístupový token, který aplikace ukládá pouze lokálně na zařízení a nikam jinam ho neodesílá; slouží k ověření zařízení u budoucích funkcí. Více v sekci „Služby třetích stran".

### Provozní statistiky a technické chyby
Aplikace posílá na náš vlastní server omezené provozní údaje, abychom poznali, jestli aplikace funguje: otevření aplikace, návrat do popředí, typ technické chyby, verzi aplikace, platformu a stavové kódy vybraných požadavků. K anonymnímu účtu ukládáme také součet nachozených metrů v aplikaci. **Součet metrů se počítá přímo v telefonu a na server se odesílají pouze přírůstky v metrech – neposíláme GPS body, trasu ani historii polohy.** Tyto údaje nepoužíváme k reklamě ani profilování.

### Údaje doplněné uživatelem (otevírací doba a piva na čepu)
Aplikace umožňuje dobrovolně doplnit otevírací dobu vybrané hospody a seznam piv na čepu (název, případně cenu a objem). Pokud tyto údaje vyplníte a odešlete, aplikace je pošle na náš vlastní server pod anonymním identifikátorem zařízení. **Tyto údaje se následně veřejně zobrazují ostatním uživatelům aplikace**, aby věděli, co která hospoda nabízí a kdy má otevřeno. Údaje se týkají hospody, nikoli vás – neobsahují žádné osobní informace o vaší osobě. Doplňování je zcela dobrovolné; pokud nic nevyplníte, nic se neodesílá. Pokud server není dostupný, aplikace odeslání zopakuje, jakmile budete znovu online.

### Co NEsbíráme
- Nepoužíváme přihlašování ani osobní uživatelské účty (anonymní identifikátor zařízení neobsahuje žádné osobní údaje a nevyžaduje registraci).
- Nepoužíváme reklamní SDK ani sledování napříč aplikacemi.
- Nesbíráme e-mailovou adresu, jméno ani žádné kontaktní údaje.
- Nesledujeme vás napříč aplikacemi ani webovými stránkami.
- Neukládáme historii vaší polohy, GPS body ani trasu.

## Jak data používáme

Zpracovávaná data slouží výhradně k fungování aplikace:
- **Poloha a pohybové senzory** – zobrazení směrové šipky k vybrané hospodě.
- **Vyhledávací dotazy** – získání návrhů míst z Mapy.cz.
- **Název a poloha vybrané hospody** – dohledání otevírací doby na našem serveru.
- **Anonymní identifikátor zařízení** – odlišení jednotlivých zařízení a vytvoření dočasného anonymního účtu na našem serveru.
- **Provozní statistiky a technické chyby** – zjištění, kolik zařízení aplikaci používá, kolikrát byla otevřena, kde padá nebo kde selhávají backendové funkce.
- **Součet nachozených metrů** – anonymní souhrnné statistiky a žebříčky bez ukládání polohové historie.
- **Údaje doplněné uživatelem (otevírací doba, piva na čepu)** – uložení a veřejné zobrazení ostatním uživatelům, aby aplikace ukazovala aktuální informace o hospodách.

Data nepoužíváme k profilování, cílení reklamy ani k žádnému dalšímu účelu.

## Služby třetích stran

### Mapy.cz (Seznam.cz, a.s.)
Pro vyhledávání hospod podle názvu odesíláme váš textový dotaz a přibližnou oblast mapy na API služby Mapy.cz. Tato služba zpracovává dotaz podle vlastních zásad ochrany osobních údajů. Více informací: [https://o.seznam.cz/ochrana-udaju/](https://o.seznam.cz/ochrana-udaju/)

### Server pro otevírací dobu (provozovatel aplikace)
Pro zobrazení otevírací doby vybrané hospody pošleme její název a polohu na náš vlastní server, který otevírací dobu dohledá z veřejně dostupných zdrojů a vrátí ji aplikaci. Server přijímá pouze údaje o vybraném místě – neodesíláme vaši polohu ani jiné osobní údaje a dotaz na otevírací dobu nespojujeme s vaším identifikátorem zařízení. Jde o nepovinnou funkci; když není dostupná, aplikace funguje dál bez otevírací doby.

### Anonymní účet zařízení (provozovatel aplikace)
Při prvním spuštění aplikace odešle na náš vlastní server anonymní náhodný identifikátor zařízení (náhodné UUID) a server pro toto zařízení vytvoří dočasný anonymní účet. Identifikátor neobsahuje žádné osobní údaje a slouží jen k odlišení zařízení; nepoužíváme ho ke sledování ani k profilování. Jde o nepovinnou funkci – pokud server není dostupný, aplikace funguje dál bez vytvořeného účtu.

### Provozní statistiky a technické chyby (provozovatel aplikace)
Provozní statistiky a technické chyby zpracováváme na vlastním serveru. Slouží pouze k údržbě a zlepšování aplikace. Neposíláme je žádné reklamní síti ani externímu analytickému nástroji.

### Doplněné údaje o hospodách (provozovatel aplikace)
Když dobrovolně doplníte otevírací dobu nebo piva na čepu, aplikace tyto údaje odešle na náš vlastní server pod anonymním účtem zařízení. Server je uloží a veřejně je zobrazí ostatním uživatelům aplikace. Údaje popisují danou hospodu, nikoli vaši osobu, a neobsahují žádné osobní informace. Jde o dobrovolnou funkci; pokud nic nevyplníte, nic se neodesílá.

## Doba uchování dat

Na našich serverech uchováváme anonymní identifikátor zařízení a k němu vázaný dočasný účet, provozní statistiky, technické chyby a dobrovolně odeslané údaje o hospodách. Poloha a data senzorů existují pouze dočasně v paměti zařízení po dobu používání aplikace; na server se neposílají GPS body ani trasa. Služby třetích stran (Mapy.cz) uchovávají případná data podle vlastních zásad.

## Vaše práva

Podle nařízení GDPR (Obecné nařízení o ochraně osobních údajů) máte právo na:
- **přístup** k osobním údajům, které o vás zpracováváme,
- **opravu** nepřesných údajů,
- **výmaz** („právo být zapomenut"),
- **omezení zpracování**,
- **přenositelnost** údajů,
- **vznést námitku** proti zpracování.

Protože pracujeme hlavně s anonymními technickými údaji, ve většině případů nemáme data, která by šla přímo spojit s vaší osobou. Pokud máte přesto jakýkoli dotaz nebo požadavek, ozvěte se nám na kontakt uvedený níže.

## Děti

Aplikace není určena dětem. Vzhledem k tématu (vyhledávání hospod) je určena dospělým uživatelům a vědomě nesbíráme žádné údaje o dětech.

## Změny těchto zásad

Tyto zásady můžeme čas od času aktualizovat. O podstatných změnách budeme informovat aktualizací této stránky a změnou data „Poslední aktualizace" v záhlaví. Doporučujeme zásady občas zkontrolovat.

## Kontaktujte nás

Máte-li jakýkoli dotaz k ochraně soukromí nebo k těmto zásadám, napište nám na:

**tomades1@gmail.com**
