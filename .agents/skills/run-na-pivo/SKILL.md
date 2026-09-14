---
name: run-na-pivo
description: Vyber a spusť lokální prostředí Na pivo pro macOS/iOS nebo Linux/backend a dostupný Android.
---

# Lokální Na pivo podle platformy

Nejdřív ověř OS, checkout, obsazené porty a vlastníky procesů. Zkontroluj efektivní API URL a DB před migrací, seedem i prvním zápisem. Používej vlastní lokální data; produkční API není testovací backend. Existující server použij až po ověření checkoutu a konfigurace.

## macOS a iOS

Standardní cesta je `npm run dev` z kořene repa. [Runner](../../../scripts/dev-local.js) migruje vlastní lokální SQLite, spustí ASGI a Metro tohoto checkoutu a podle Expo fingerprintu znovu použije kompatibilního iOS klienta. Čistý prebuild a build proběhnou při nativní změně nebo chybějícím či dosud neověřeném klientu; `--rebuild` je vynutí. Před rebuildem zkontroluj ruční změny v generovaném `ios/`. Při více bootovaných iPhonech vyber `EXPO_IOS_DEVICE` (UDID).

Runner nikdy nevypíná simulátory. Běžící backend a Metro znovu použije jen při shodě checkoutu, konfigurace a vlastnictví procesů; cizí port odmítne bez zásahu. Background běh nabízí `npm run dev:detached`; `npm run dev:stop` kontroluje proces podle stavu v `.expo/` tohoto worktree.

Pro screenshot použij konkrétní simulátor z `xcrun simctl list devices booted`, pak `xcrun simctl io <UDID> screenshot <path>`. Cold start dotčeného flow má bundle ID `com.tomasmach.na-pivo`. Neukončuj cizí session.

## Linux, backend a Android

`npm run dev -- --metro` spustí lokální ASGI a Metro bez iOS kroků. Background varianta je `npm run dev:detached -- --metro`. Neověřuje kompatibilitu ani obrazovku nativního klienta. Vyber volné `EXPO_PUBLIC_BACKEND_PORT` a `EXPO_METRO_PORT`; připravenost ověř přes `/v1/health` a Metro `/status`. Runner používá vlastní `backend/db.sqlite3`. Pro diagnostiku backendu čti lokální Quick start v [backend/README.md](../../../backend/README.md), nikoli produkční deploy sekci. Zachovej ASGI kvůli SSE a před samostatnou migrací nebo seedem ověř DB.

Pro Android nejdřív ověř SDK, `adb` a dostupný emulátor či zařízení. `npm run android` existuje v package.json; před spuštěním explicitně nastav lokální backend podle `src/data/backendConfig.ts` a zkontroluj výslednou base URL. Skripty `*:local` používají macOS `ipconfig`, na Linuxu z nich nepřebírej detekci hosta. Samotná existence příkazu není důkaz funkčního linuxového buildu. Chybějící Android prostředí uveď a ověř dostupnou backendovou část; iOS flow předej na Mac.

## Dokončení

Proveď dotčený flow, zkontroluj reálnou odpověď či screenshot a runtime chyby. Nativní chování nevydávej za ověřené jen z webu nebo testů. Zastav jen vlastní procesy; pokud appku necháváš Machovi, napiš port, checkout a bezpečný stop příkaz. EAS build spouští člověk, release a produkce vyžadují aktuální explicitní pokyn.
