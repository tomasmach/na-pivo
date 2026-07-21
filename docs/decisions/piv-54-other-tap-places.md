# PIV-54: Další místa s výčepem

## Rozhodnutí

Kompas a mapa dál ve výchozím stavu zobrazují jen stávající hospodský katalog.
Stánky, kempy a sportovní areály jsou jedna společná, explicitně zapínaná volba
`Další místa s výčepem`.

Podporovaný rozsah je úmyslně úzký:

- sezónní stánek nebo kiosk s občerstvením;
- kemp nebo autokemp;
- sportovní areál, sportovní centrum, klub nebo stadion.

Sekundární místo se do výsledků dostane jen tehdy, když zkontrolovaná zdrojová
data zároveň obsahují jasný signál `točené pivo`, `pivo`, `beer`, `bar`, `pub`,
`hospoda`, `pivnice`, `pivovar` nebo `výčep`. Samotná kategorie kempu, stánku či
sportoviště nestačí.

## Pořadí a hlavní flow

- Výchozí API parametr je vypnutý a existující klienti dostanou stejný katalog.
- Potvrzená hospoda má při výběru kompasu přednost před sekundárním místem.
- Sekundární místa nejsou kandidáty pro automatický výběr hospody v počítadle
  ani pro geofence připomínky.
- Mapa je při zapnuté volbě může ukázat společně s hospodami.
- Při výpadku sítě zůstává použitelný poslední offline snapshot skutečných
  hospod. Rozšíření nikdy nesmí vyprázdnit nebo přepsat primární snapshot.

## Datový kontrakt

`PubDirectory.discovery_kind` má hodnoty `pub`, `seasonal_stand`, `campsite`
a `sports_venue`. `PubDirectory.has_beer_signal` zachycuje výsledek kontrolované
importní klasifikace. Mobil dostává pouze aditivní `discoveryKind`; starší verze
pole ignorují.

Import odvozuje obě pole z kategorií a tagů zdroje. Sekundární záznam bez
pivního signálu se do exportu vůbec nezařadí. Produkční nearby endpoint navíc
stejnou podmínku kontroluje při každém opt-in dotazu, aby chybně importovaný řádek
neunikl do discovery.

## Mimo rozsah

Festivaly, jednorázové akce, obchody s pivem, vinárny, kavárny, bistra,
restaurace bez pivního signálu, koupaliště bez samostatného výčepního signálu
a obecné body zájmu nejsou součástí PIV-54.
