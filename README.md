# Na pivo

[![CI](https://github.com/tomasmach/na-pivo/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/tomasmach/na-pivo/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Moderní mobilní pivní deníček pro české a slovenské hospody, piva, večery a party kamarádů.

Na pivo začalo jako jednoduchá iOS appka s kompasem do nejbližší hospody. Kompas je pořád důležitá a rozpoznatelná část produktu, ale aplikace se posouvá směrem k plnohodnotnému pivnímu deníčku: záznamy večerů, vypitá piva, navštívené hospody, profily, statistiky, komunita, hodnocení a objevování nových míst.

Produktový tón je český, hospodský, hravý a lidský. UI copy uživateli tyká. Kód, komentáře a internals jsou anglicky.

## What is in this repo

This monorepo contains the Expo / React Native mobile app at the repository root.

The Django backend lives in `backend/` and powers accounts, profiles, community data, pub hours, ratings, visits, drink logs, telemetry, feedback and other synced features.

The app should degrade gracefully without internet: local state and queued changes matter. Server-backed features still require sync, but the mobile experience should not collapse just because the network is unavailable.

## Tech stack

| Layer | Technology |
|---|---|
| Mobile | Expo, React Native, React 19, TypeScript |
| Navigation | Expo Router |
| State | Zustand + local queues where needed |
| Backend | Python 3.14, Django 6, Django REST Framework |
| Data | SQLite locally, PostgreSQL in production |
| Native builds | EAS / Expo prebuild |
| Tests | Jest, React Native Testing Library, pytest |

## Quick start for contributors

You need Node.js 24, npm, Python 3.14 and [uv](https://docs.astral.sh/uv/). Native app work also needs Xcode or Android Studio. The full setup and pull request workflow live in [CONTRIBUTING.md](CONTRIBUTING.md).

Install dependencies and run every check without cloud credentials or environment variables:

```bash
nvm use
npm ci
npm run typecheck
npm run lint
npm test -- --runInBand
npm audit --omit=dev --audit-level=high

cd backend
uv sync --locked
uv run ruff check .
uv run pip-audit
uv run pytest
```

## Run the full app locally

Copy the mobile environment template:

```bash
cp .env.example .env.local
```

Native builds require your own restricted Google Maps SDK key for the platform you run. Put it in `.env.local`; Google Sign-In values are optional. See the comments in [.env.example](.env.example) for every mobile setting.

On macOS, one command installs missing Python packages through uv, applies backend migrations, starts the Django backend, generates the native iOS project and opens the simulator. Ctrl+C stops the backend it started and shuts down the simulator:

```bash
npm run dev
```

`npm run dev` uses port `8012` (the dvanáctka of ports — clear of 8000, 8080 and Metro's 8081); override it with `EXPO_PUBLIC_BACKEND_PORT`. If the backend is already running there, the command reuses it and leaves it running on exit.

The backend works locally with SQLite and safe development defaults even without `backend/.env`. To customize integrations or backend behavior, copy `backend/.env.example` to `backend/.env`. Production-only credentials are never needed for ordinary development.

The manual flow works too. Start Django on the LAN interface:

```bash
cd backend
uv run python manage.py runserver 0.0.0.0:8000
```

Then build and run the local iOS app with backend mode enabled:

```bash
cd ..
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

## Contributing

Issues and pull requests are welcome. Start feature branches from `dev` and open pull requests back into `dev`; `main` is reserved for released mobile builds. Every change requires maintainer review and passing CI before merge.

Read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) before contributing. Please report vulnerabilities privately through [GitHub Security Advisories](https://github.com/tomasmach/na-pivo/security/advisories/new).

## License

MIT - see [LICENSE](LICENSE).

## Data attribution

Pub data includes OpenStreetMap-derived data where applicable.

OpenStreetMap data is © [OpenStreetMap](https://www.openstreetmap.org/) contributors and available under the [Open Database Licence (ODbL)](https://opendatacommons.org/licenses/odbl/).
