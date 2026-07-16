# Na pivo

Moderní mobilní pivní deníček pro české a slovenské hospody, piva, večery a party kamarádů.

Na pivo začalo jako jednoduchá iOS appka s kompasem do nejbližší hospody. Kompas je pořád důležitá a rozpoznatelná část produktu, ale aplikace se posouvá směrem k plnohodnotnému pivnímu deníčku: záznamy večerů, vypitá piva, navštívené hospody, profily, statistiky, komunita, hodnocení a objevování nových míst.

Produktový tón je český, hospodský, hravý a lidský. UI copy uživateli tyká. Kód, komentáře a internals jsou anglicky.

## What is in this repo

This repository contains the Expo / React Native mobile app.

The backend lives next to it in `../na-pivo-backend` and powers accounts, profiles, community data, pub hours, ratings, visits, drink logs, telemetry, feedback and other synced features.

The app should degrade gracefully without internet: local state and queued changes matter. Server-backed features still require sync, but the mobile experience should not collapse just because the network is unavailable.

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Expo, React Native, React 19 |
| Navigation | Expo Router |
| State | Zustand + local queues where needed |
| Native builds | EAS / Expo prebuild |
| Tests | Jest + React Native Testing Library |
| Language | TypeScript |

## Run locally

```bash
npm install
npm run start
```

Useful checks:

```bash
npm run typecheck
npm test
npm run lint
```

## Run against the local backend

One command does everything — applies backend migrations, starts the Django backend, and launches the iOS simulator build. Ctrl+C stops the backend it started and shuts down the simulator:

```bash
npm run dev
```

`npm run dev` runs the backend on its own dedicated port `8012` (the dvanáctka of ports — clear of 8000, 8080 and Metro's 8081) so it never fights with other dev servers; override it with `EXPO_PUBLIC_BACKEND_PORT`. If the backend is already running on that port, `npm run dev` reuses it and leaves it running on exit. The manual way still works too:

Start the Django backend on the LAN interface:

```bash
cd ../na-pivo-backend
uv run python manage.py runserver 0.0.0.0:8000
```

Then build and run the local iOS app with backend mode enabled:

```bash
cd ../na-pivo
npm run ios:local
```

`ios:local` passes the Mac's LAN IP into the app so the simulator or device talks to the local Django server instead of `https://api.na-pivo.cz`.

Override the backend port when needed:

```bash
EXPO_PUBLIC_BACKEND_PORT=8765 npm run ios:local
```

Mapová obrazovka používá Google Maps SDK na Androidu i iOS. Pro lokální i EAS
build nastav oddělené klíče `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY` a
`EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY`. Android klíč omez na package + signing
certificate, iOS klíč na bundle ID. Serverový Google Places klíč do aplikace
nikdy nepatří.

Use `npm run start:local` only when you want to start Metro in local-backend mode without rebuilding the native iOS app.

## Native app commands

```bash
npm run ios
npm run ios:local
npm run android
npm run android:local
```

## Build with EAS

```bash
# development build (custom dev client, physical device)
eas build -p ios --profile development

# internal preview build (Release config, TestFlight)
eas build -p ios --profile preview

# production build (auto-increment build number)
eas build -p ios --profile production
```

## Data and privacy notes

Na pivo works with sensitive data: location, pubs, alcohol history, profiles and social activity.

The app should prefer user-confirmed visits, local calculations, queued sync and coarse or aggregated location data where possible. Do not introduce raw GPS history or route storage without an explicit product decision.

Never log bearer tokens, raw GPS, contact details, cookies, proxy credentials or request bodies containing personal data.

## Agent instructions

Agent-facing product and engineering guidance lives in `AGENTS.md`. Claude-compatible instructions live in `CLAUDE.md` and point to the same source.

## License

MIT - see [LICENSE](LICENSE).

## Data attribution

Pub data includes OpenStreetMap-derived data where applicable.

OpenStreetMap data is © [OpenStreetMap](https://www.openstreetmap.org/) contributors and available under the [Open Database Licence (ODbL)](https://opendatacommons.org/licenses/odbl/).
