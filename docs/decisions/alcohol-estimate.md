# Rozhodnutí: odhad promile jen jako odhad, nikdy jako rada k řízení

Status: přijato 18. 10. 2026, nahrazuje červencové „bez odhadu promile“ (PIV-70)

## Rozhodnutí

Lidé si o „alkohol tester“ říkají opakovaně, proto ho Na pivo nabízí jako odhad. Uživatel si ho sám zapne v počítadle přes „Co ještě?“ → „Odhad promile“ a vyplní pohlaví, věk, výšku a váhu. Appka pak na kartě počítadla ukazuje odhad teď a čas, kdy bude podle opatrného výpočtu na nule. Výpočet počítá i s nocí, kdy člověk spí a nic nezapisuje.

## Pravidla, která platí dál

- Každý výsledek se jmenuje odhad. Vyplnění údajů i detail odhadu nesou upozornění, že skutečnost se může lišit a že se podle toho nemá řídit.
- Appka nikdy netvrdí, že člověk může řídit, a nepoužívá formulace jako „Můžeš řídit.“ nebo „Cesta autem je bezpečná.“
- Čas „na nule“ se počítá z opatrného konce (pomalé odbourávání, o 20 % víc alkoholu, zaokrouhleno nahoru). Dokud opatrný výpočet není na nule, appka ráno neukáže „0,0 ‰“.
- Údaje o těle zůstávají v telefonu, neposílají se na server a mažou se s ostatními soukromými daty při odhlášení nebo smazání účtu. Vypnutí odhadu je smaže taky.
- Připomínka vody zůstává samostatná a nespojuje se s rychlejším vystřízlivěním.

## Jak se počítá

`src/drinks/alcoholEstimate.ts`: Watsonova tělesná voda, Widmarkovo rozložení, vstřebání 45 minut na každé pití, lineární odbourávání. Procenta alkoholu se odvozují z typu pití a ze stupňů v názvu piva. Model a jeho čísla hlídá `src/drinks/__tests__/alcoholEstimate.test.ts`.
