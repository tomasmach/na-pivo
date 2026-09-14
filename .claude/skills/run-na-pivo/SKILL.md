---
name: run-na-pivo
description: Vyber a spusť lokální prostředí Na pivo pro macOS/iOS nebo Linux/backend a dostupný Android.
---

# Lokální Na pivo podle platformy

Nejdřív ověř OS, checkout, obsazené porty a vlastníky procesů. Zkontroluj efektivní API URL a DB před migrací, seedem i prvním zápisem. Používej vlastní lokální data; produkční API není testovací backend. Existující server použij až po ověření checkoutu a konfigurace.

## macOS a iOS

Standardní cesta je `npm run dev` z kořene repa: [scripts/dev-local.sh](../../../scripts/dev-local.sh) migruje backend, spustí ASGI na portu 8012 a provede iOS prebuild. Skript regeneruje nativní projekt; nejdřív ověř, že v něm není cizí rozdělaná práce. Pokud už běží simulátor, použij `NAPIVO_KEEP_SIM=1 npm run dev`, aby ho cleanup runneru nevypnul; nejdřív ověř, že spuštění appky nenaruší cizí práci. Background běh nabízí `npm run dev:detached`. Před `dev:stop` ověř vlastnictví PID z `/tmp/napivo-dev.pid`, který je společný pro worktrees.

Pro screenshot použij konkrétní simulátor z `xcrun simctl list devices booted`, pak `xcrun simctl io <UDID> screenshot <path>`. Cold start dotčeného flow má bundle ID `com.tomasmach.na-pivo`. Neukončuj cizí session.

## Linux, backend a Android

`npm run dev` a `dev:detached` obsahují iOS kroky a na Linux nepatří. Backend spusť podle lokálního Quick start v [backend/README.md](../../../backend/README.md), nikoli podle jeho produkční deploy sekce. Použij ASGI, protože party hry používají SSE. Dokumentovaný příkaz z `backend/` je `uv run --extra prod uvicorn config.asgi:application --reload --no-access-log --port 8000`; vyber volný port a stejný nastav klientovi. Připravenost ověř přes lokální `/v1/health`. Migrace a seed nejdřív vyžadují ověřenou vlastní lokální DB.

Pro Android nejdřív ověř SDK, `adb` a dostupný emulátor či zařízení. `npm run android` existuje v package.json; před spuštěním explicitně nastav lokální backend podle `src/data/backendConfig.ts` a zkontroluj výslednou base URL. Skripty `*:local` používají macOS `ipconfig`, na Linuxu z nich nepřebírej detekci hosta. Samotná existence příkazu není důkaz funkčního linuxového buildu. Chybějící Android prostředí uveď a ověř dostupnou backendovou část; iOS flow předej na Mac.

## Dokončení

Proveď dotčený flow, zkontroluj reálnou odpověď či screenshot a runtime chyby. Nativní chování nevydávej za ověřené jen z webu nebo testů. Zastav jen vlastní procesy; pokud appku necháváš Machovi, napiš port, checkout a bezpečný stop příkaz. EAS build spouští člověk, release a produkce vyžadují aktuální explicitní pokyn.
