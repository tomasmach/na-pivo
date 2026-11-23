# Rozhodnutí: odhad promile jen jako odhad, nikdy jako rada k řízení

Status: přijato 18. 10. 2026, nahrazuje červencové „bez odhadu promile“ (PIV-70)

## Rozhodnutí

Lidé si o „alkohol tester“ říkají opakovaně, proto ho Na pivo nabízí jako odhad. Uživatel si ho sám zapne v počítadle přes „Co ještě?“ → „Odhad promile“ a vyplní pohlaví, věk, výšku a váhu. Appka pak na kartě počítadla ukazuje odhad teď a čas, kdy bude na nule průměrný člověk se stejnými údaji. Výpočet počítá i s nocí, kdy člověk spí a nic nezapisuje.

## Pravidla, která platí dál

- Každý výsledek se jmenuje odhad. Vyplnění údajů i detail odhadu nesou upozornění, že skutečnost se může lišit a že se podle toho nemá řídit.
- Appka nikdy netvrdí, že člověk může řídit, a nepoužívá formulace jako „Můžeš řídit.“ nebo „Cesta autem je bezpečná.“
- Čas „na nule“ se počítá pro průměrného člověka (odbourávání 0,15 ‰ za hodinu, zaokrouhleno nahoru na půlhodinu). Od 7. 11. 2026 nahrazuje opatrný konec s pomalým odbouráváním a o 20 % víc alkoholu, protože ten po běžném večeru sliboval nulu až další odpoledne. Opatrný konec zůstává jen jako horní hranice rozpětí „spíš X až Y ‰“.
- Jakmile průměrný výpočet dojde na nulu, další pití začíná nový večer. Starší pití od té chvíle není v seznamu „Počítám s“ ani v rozpětí, i kdyby opatrný konec ještě nulu neměl.
- Údaje o těle zůstávají v telefonu, neposílají se na server a mažou se s ostatními soukromými daty při odhlášení nebo smazání účtu. Vypnutí odhadu je smaže taky.
- Připomínka vody zůstává samostatná a nespojuje se s rychlejším vystřízlivěním.

## Jak se počítá

`src/drinks/alcoholEstimate.ts`: Watsonova tělesná voda, Widmarkovo rozložení, vstřebání 45 minut na každé pití, lineární odbourávání. Od 23. 11. 2026 se do krve započítá 90 % alkoholu z každého pití. Klasický Widmarkův a Watsonův výpočet počítá se vším alkoholem a skutečně naměřené hladiny přestřeluje, soudní praxe proto odečítá 10 až 30 % ([Blutalkoholkonzentration, Resorptionsdefizit](https://de.wikipedia.org/wiki/Blutalkoholkonzentration#Resorptionsdefizit)). Odhad bere nejmenší odpočet, 10 %, se kterým se počítá i nejvyšší možná hladina. Procenta alkoholu se odvozují z typu pití a ze stupňů v názvu piva, i bez znaku stupňů („Klášter 10“). Pivo bez stupňů v názvu se od 23. 11. 2026 počítá jako dvanáctka (5 %), ne jako silné 6% pivo. Takhle se zapisuje hlavně Pilsner Urquell a další běžné ležáky a 6 % u nich odhad zbytečně nafukovalo. Model a jeho čísla hlídá `src/drinks/__tests__/alcoholEstimate.test.ts`.
