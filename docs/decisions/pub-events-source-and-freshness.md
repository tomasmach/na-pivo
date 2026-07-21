# PIV-59: zdroj a čerstvost akcí u hospod

## Rozhodnutí

Aktuální akce nevytěžujeme z webů ani sociálních sítí. Jediným zdrojem jsou návrhy přihlášených uživatelů, které před zveřejněním ručně ověří správce v Django adminu.

Veřejný endpoint vrací nejvýš tři akce, které splňují všechny podmínky podle času serveru: mají stav `verified`, mají uložený čas ověření a platí `starts_at <= now < ends_at`. Čekající, zamítnuté, budoucí a skončené návrhy nejsou ve veřejné odpovědi. Mobil navíc stejnou časovou podmínku kontroluje před vykreslením a při každém otevření detailu hospody načte čerstvý stav. Při chybě nic starého nezobrazuje.

## Moderace a náklady

Každý návrh začíná jako `pending`. Admin může návrhy označit jako ověřené, zamítnuté nebo je vrátit ke kontrole. Ověřená akce se po konci skryje automaticky bez další práce správce.

Čtení je jeden indexovaný databázový dotaz s krátkou minutovou HTTP cache a limitem tří položek. Zápis používá existující `community` rate limit a je idempotentní podle účtu a klientského UUID. Neběží crawler, proxy ani pravidelný import, takže funkce nevytváří nekontrolované externí náklady.

## Soukromí a kompatibilita

Veřejná odpověď neobsahuje autora návrhu ani jeho účet. Souřadnice v návrhu identifikují hospodu, ne pohyb nebo historii polohy uživatele. API je čistě aditivní na `/v1/pub-events`; existující mobilní verze se nemění.
