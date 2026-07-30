# Zásady ochrany osobních údajů – Na pivo

*Poslední aktualizace: 30. července 2026*

## Kdo jsme

Aplikaci **Na pivo** provozuje fyzická osoba (samostatný vývojář), dále jen „my" nebo „provozovatel". Tyto zásady vysvětlují, jaká data aplikace zpracovává, k čemu je používá a jaká práva v souvislosti s ochranou soukromí máte. Snažíme se sbírat co nejméně dat a neukládat průběžnou GPS historii ani trasu pohybu.

## Jaká data zpracováváme

### Poloha
Aplikace používá vaši aktuální polohu k tomu, aby našla hospody v okolí a ukázala směrovou šipku k vybrané hospodě (funguje jako kompas). Aktuální nebo přibližná poloha se může odeslat na náš vlastní server, který vyhledává v lokálním adresáři hospod. **Neukládáme průběžnou GPS historii, jednotlivé GPS body ani trasu pohybu.** Polohu na pozadí nevyužíváme.

### Pohybové senzory
Aplikace čte data z pohybových senzorů (kompas/akcelerometr), aby správně otáčela směrovou šipku podle natočení telefonu. Tato data se rovněž zpracovávají pouze lokálně a nikam se neodesílají.

### Přidání nové hospody
Když dobrovolně přidáte chybějící hospodu, odešle se na náš server její zadaný název, vámi potvrzený bod polohy a případně ručně doplněné město a adresa. Hospoda se následně veřejně zobrazí ostatním uživatelům. Neposíláme trasu ani průběžnou historii polohy a pro přidání hospody nepoužíváme externí službu pro vyhledávání míst.

### Otevírací doba
Když je vybraná hospoda zobrazena, aplikace pošle její název a polohu (zeměpisné souřadnice) na náš vlastní server, který k danému místu dohledá otevírací dobu a vrátí ji zpět. Odesílá se pouze údaj o vybrané hospodě, nikoli o vás ani o vaší poloze. Tato funkce je nepovinná – pokud server není dostupný nebo dotaz selže, aplikace funguje dál bez zobrazení otevírací doby. Více v sekci „Služby třetích stran".

### Anonymní identifikátor zařízení
Aplikace při prvním spuštění vytvoří anonymní náhodný identifikátor zařízení (náhodné UUID) a odešle ho na náš vlastní server, aby každému zařízení patřil dočasný anonymní účet. Tento identifikátor neobsahuje žádné osobní údaje – nevzniká z e-mailu, jména, telefonního čísla ani z hardwarového identifikátoru telefonu – a slouží výhradně k odlišení jednotlivých zařízení. Registrace je nepovinná funkce; pokud server není dostupný nebo dotaz selže, aplikace funguje dál bez vytvořeného účtu. Server v odpovědi vrátí náhodný přístupový token, který aplikace ukládá pouze lokálně na zařízení a nikam jinam ho neodesílá; slouží k ověření zařízení u budoucích funkcí. Více v sekci „Služby třetích stran".

### Uživatelský účet (volitelné přihlášení)
Přihlášení je **nepovinné** – aplikaci lze plně používat anonymně. Pokud si dobrovolně vytvoříte účet, abyste si svá data (např. Pivní deník) přenesli mezi zařízeními, zpracováváme podle zvoleného způsobu: u **e-mailu a hesla** ukládáme e-mailovou adresu a heslo pouze v nečitelné (zahashované) podobě; u přihlášení přes **Google / Apple** dostaneme od poskytovatele stabilní identifikátor účtu a e-mail (u Applu může jít o skrytý přeposílací e-mail), případně jméno – heslo poskytovatele nikdy nevidíme. Při přihlášení se k účtu připojí dosavadní anonymní data zařízení. Jeden účet lze propojit s více způsoby přihlášení a kdykoli je v nastavení odpojit. Účet i všechna data můžete kdykoli smazat (Nastavení → Účet → Smazat účet); po 14denní ochranné lhůtě se trvale odstraní.

### Veřejný profil (přezdívka a profilová fotka)
Když si vytvoříte účet, můžete si zvolit **přezdívku** a nahrát **profilovou fotku (avatar)**. Ukládáme je na našem serveru a tvoří váš profil v aplikaci. Profil s přezdívkou a fotkou je **viditelný pro ostatní uživatele** – je součástí komunitní a objevovací části aplikace. Vaše konkrétní záznamy v Pivním deníku přitom zůstávají soukromé; veřejné je jen to, co sami zveřejníte. Přezdívku i profilovou fotku můžete kdykoli změnit nebo úplně odstranit.

### Provozní a produktové statistiky a technické chyby
Aplikace posílá na náš vlastní server omezené události, abychom poznali, jestli funguje a které části lidé používají. Patří sem otevření aplikace, návrat do popředí, zobrazení hlavních obrazovek, použití vybraných funkcí, typ technické chyby, verze aplikace, platforma a stavové kódy vybraných požadavků. Událost můžeme přiřadit k anonymnímu nebo přihlášenému účtu. Díky tomu vidíme počet různých účtů a to, mezi kterými obrazovkami uživatelé přecházejí. Používáme pouze pevně povolené názvy událostí a hrubé kategorie. **Do produktových událostí neposíláme názvy hospod ani piv, texty zadané uživatelem, identifikátory prohlížených profilů či příspěvků, vyhledávací dotazy, GPS body, trasu ani přesnou polohu.**

K anonymnímu účtu ukládáme také součet nachozených metrů v aplikaci. **Součet metrů se počítá přímo v telefonu a na server se odesílají pouze přírůstky v metrech – neposíláme GPS body, trasu ani historii polohy.** Tyto údaje nepoužíváme k reklamě, sledování napříč aplikacemi ani automatizovanému rozhodování o uživateli.

### Údaje doplněné uživatelem (otevírací doba a piva na čepu)
Aplikace umožňuje dobrovolně doplnit otevírací dobu vybrané hospody a seznam piv na čepu (název, případně cenu a objem). Pokud tyto údaje vyplníte a odešlete, aplikace je pošle na náš vlastní server pod anonymním identifikátorem zařízení. **Tyto údaje se následně veřejně zobrazují ostatním uživatelům aplikace**, aby věděli, co která hospoda nabízí a kdy má otevřeno. Údaje se týkají hospody, nikoli vás – neobsahují žádné osobní informace o vaší osobě. Doplňování je zcela dobrovolné; pokud nic nevyplníte, nic se neodesílá. Pokud server není dostupný, aplikace odeslání zopakuje, jakmile budete znovu online.

### Soukromá historie návštěv a poznámky k hospodám
Aplikace ukládá počítadlo piv, historii večerů a vaše soukromé hodnocení hospod (například palec nahoru/dolů, rychlý štítek nebo vlastní poznámku). Aby se tyto údaje po reinstalaci nebo na stejném anonymním účtu obnovily, aplikace je synchronizuje na náš vlastní server pod anonymním účtem zařízení. Tyto údaje jsou **soukromé pro daný anonymní účet**, veřejně se nezobrazují ostatním uživatelům a nepoužíváme je k reklamě ani profilování. U návštěvy hospody ukládáme identifikátor večera, název hospody, přibližnou polohu hospody, čas začátku a případně čas posledního započítaného piva; neukládáme průběžné GPS body ani trasu pohybu.

### Co NEsbíráme
- Přihlášení je nepovinné; e-mail ani jméno nesbíráme, dokud si dobrovolně nevytvoříte účet.
- Nepoužíváme reklamní SDK ani sledování napříč aplikacemi.
- Nesledujeme vás napříč aplikacemi ani webovými stránkami.
- Neukládáme průběžnou historii vaší polohy, GPS body ani trasu.

## Jak data používáme

Zpracovávaná data slouží výhradně k fungování aplikace:
- **Poloha a pohybové senzory** – nalezení hospod v okolí a zobrazení směrové šipky k vybrané hospodě.
- **Údaje o přidané hospodě** – uložení a veřejné zobrazení názvu, potvrzené polohy a volitelně doplněného města nebo adresy.
- **Název a poloha vybrané hospody** – dohledání otevírací doby na našem serveru.
- **Anonymní identifikátor zařízení** – odlišení jednotlivých zařízení a vytvoření dočasného anonymního účtu na našem serveru.
- **Provozní a produktové statistiky a technické chyby** – zjištění, kolik účtů aplikaci používá, které obrazovky a funkce jsou užitečné a kde aplikace nebo backendové funkce selhávají.
- **Součet nachozených metrů** – anonymní souhrnné statistiky a žebříčky bez ukládání polohové historie.
- **Údaje doplněné uživatelem (otevírací doba, piva na čepu)** – uložení a veřejné zobrazení ostatním uživatelům, aby aplikace ukazovala aktuální informace o hospodách.
- **Veřejný profil (přezdívka a profilová fotka)** – zobrazení vašeho profilu ostatním uživatelům v komunitní a objevovací části aplikace.

Data nepoužíváme k cílení reklamy, sledování napříč službami ani automatizovanému rozhodování o uživateli.

## Služby třetích stran

### Server pro otevírací dobu (provozovatel aplikace)
Pro zobrazení otevírací doby vybrané hospody pošleme její název a polohu na náš vlastní server, který otevírací dobu dohledá z veřejně dostupných zdrojů a vrátí ji aplikaci. Server přijímá pouze údaje o vybraném místě – neodesíláme vaši polohu ani jiné osobní údaje a dotaz na otevírací dobu nespojujeme s vaším identifikátorem zařízení. Jde o nepovinnou funkci; když není dostupná, aplikace funguje dál bez otevírací doby.

### Anonymní účet zařízení (provozovatel aplikace)
Při prvním spuštění aplikace odešle na náš vlastní server anonymní náhodný identifikátor zařízení (náhodné UUID) a server pro toto zařízení vytvoří dočasný anonymní účet. Identifikátor neobsahuje žádné osobní údaje a slouží jen k odlišení zařízení; nepoužíváme ho ke sledování ani k profilování. Jde o nepovinnou funkci – pokud server není dostupný, aplikace funguje dál bez vytvořeného účtu.

### Provozní a produktové statistiky a technické chyby (provozovatel aplikace)
Provozní a produktové statistiky a technické chyby zpracováváme na vlastním serveru. Slouží pouze k údržbě, měření používání a zlepšování aplikace. Neposíláme je žádné reklamní síti ani externímu analytickému nástroji.

### Odesílání e-mailů (Resend)
Pokud máte účet s e-mailem, posíláme transakční e-maily (ověření adresy, obnova hesla, export vašich dat, potvrzení smazání účtu) přes službu **Resend**, které k tomu předáme vaši e-mailovou adresu. Zásady: [https://resend.com/legal/privacy-policy](https://resend.com/legal/privacy-policy)

### Doplněné údaje o hospodách (provozovatel aplikace)
Když dobrovolně doplníte otevírací dobu nebo piva na čepu, aplikace tyto údaje odešle na náš vlastní server pod anonymním účtem zařízení. Server je uloží a veřejně je zobrazí ostatním uživatelům aplikace. Údaje popisují danou hospodu, nikoli vaši osobu, a neobsahují žádné osobní informace. Jde o dobrovolnou funkci; pokud nic nevyplníte, nic se neodesílá.

## Doba uchování dat

Jednotlivé provozní, produktové a chybové události uchováváme nejvýše **90 dní**. Potom je automaticky mažeme. Po dobu existence účtu mohou zůstat souhrnné čítače, například počet otevření aplikace. Události přiřazené k účtu zahrnujeme do exportu dat. Po smazání účtu zůstanou případné zbývající události bez odkazu na účet a nejpozději po uplynutí retenční doby je smažeme.

Na našich serverech dále uchováváme anonymní identifikátor zařízení a k němu vázaný dočasný účet, případný uživatelský účet včetně profilu (přezdívka a profilová fotka) a dobrovolně odeslané údaje o hospodách. Aktuální nebo přibližná poloha se může použít pro jednorázové vyhledání hospod v okolí; při dobrovolném přidání nové hospody uložíme pouze vámi potvrzený bod daného podniku. Neukládáme průběžnou GPS historii ani trasu. Služba Resend uchovává případná data podle vlastních zásad.

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
