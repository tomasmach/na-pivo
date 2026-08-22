# Na pivo

[![CI](https://github.com/tomasmach/na-pivo/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/tomasmach/na-pivo/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Na pivo is a mobile beer diary for Czech and Slovak beer drinkers.

It started as a simple iOS app with a compass pointing to the nearest pub. The compass is still there, but the app is growing into a diary for beers, pubs and nights out with friends. It also has profiles, stats, ratings, community features and tools for finding new places.

The app speaks Czech, uses informal language and does not take itself too seriously. Code and comments are in English.

## What is in this repo

The Expo / React Native app is in the repository root. The Django backend lives in `backend/`.

The backend handles accounts, profiles, community data, pub hours, ratings, visits, drink logs, telemetry, feedback and the other features that sync across devices.

A bad connection should not lose local work. Features that need the server can wait for sync, while the rest of the app should keep working.

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

## Quick start

You need Node.js 24, npm, Python 3.14 and [uv](https://docs.astral.sh/uv/). To work on native builds, install Xcode or Android Studio too. [CONTRIBUTING.md](CONTRIBUTING.md) covers the full setup and pull request flow.

These checks run without cloud credentials or environment variables:

```bash
nvm use
npm ci
npm run typecheck
npm run lint
npm test -- --runInBand
npm run audit:ci

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

Native builds need a Google Maps SDK key for the platform you use. Put your own restricted key in `.env.local`. Google Sign-In is optional. [.env.example](.env.example) documents every mobile setting.

On macOS, the following command installs the Python packages, runs migrations, starts Django, generates the native iOS project and opens the simulator. Ctrl+C stops Django and closes the simulator it started.

```bash
npm run dev
```

`npm run dev` uses port `8012`, a small nod to a Czech 12-degree lager. It stays out of the way of 8000, 8080 and Metro's 8081. Set `EXPO_PUBLIC_BACKEND_PORT` to use a different one. If Django is already running there, the command reuses it and leaves it running when you quit.

The backend uses SQLite and safe development defaults when `backend/.env` is missing. Copy `backend/.env.example` to `backend/.env` only when you need to change an integration or backend setting. Regular development never needs production credentials.

On exit it also shuts the simulator down, which is what you want after Ctrl+C and
not what you want when something else supervises the process — an agent's
background shell, a detached terminal, tmux. There the runner exits for reasons
unrelated to you being finished, and the simulator vanishing mid-session looks
exactly like the app crashing. Set `NAPIVO_KEEP_SIM=1` to leave it running:

```bash
NAPIVO_KEEP_SIM=1 npm run dev
```

That keeps the simulator, but **Metro and the backend still die** with the
runner, because they are its children and the shell's teardown signals the whole
process group. The app then sits on a booted simulator with no bundler, which
looks exactly like "Metro stopped working". To survive that, run it in its own
session:

```bash
npm run dev:detached   # logs to /tmp/napivo-dev.log
npm run dev:stop
```

Interactively, prefer plain `npm run dev` — you want Ctrl+C to tidy up.


Start the Django ASGI backend on the LAN interface:

```bash
cd backend
uv run --extra prod uvicorn config.asgi:application --reload --host 0.0.0.0 --port 8000
```

Then build the iOS app in local backend mode:

```bash
cd ..
npm run ios:local
```

`ios:local` gives the app your Mac's LAN IP, so the simulator or device connects to local Django instead of `https://api.na-pivo.cz`.

Override the backend port when needed:

```bash
EXPO_PUBLIC_BACKEND_PORT=8765 npm run ios:local
```

The map uses the Google Maps SDK on both Android and iOS. Set separate
`EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY` and
`EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY` values for local and EAS builds. Restrict
the Android key to the package and signing certificate, and the iOS key to the
bundle ID. Never put a server-side Google Places key in the app.

Use `npm run start:local` to start Metro in local backend mode without rebuilding the native iOS app.

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

Na pivo handles sensitive data such as location, pub visits, alcohol history, profiles and social activity.

Prefer visits confirmed by the user, calculations on the phone, queued sync and coarse or aggregated location data. Do not store raw GPS history or routes without an explicit product decision.

Never log bearer tokens, raw GPS, contact details, cookies, proxy credentials or request bodies containing personal data.

## Agent instructions

Product and engineering instructions for coding agents are in `AGENTS.md`. `CLAUDE.md` points to the same instructions.

## Contributing

Open feature branches from `dev` and send pull requests back to `dev`. The `main` branch tracks mobile builds released through the App Store and Google Play. [@tomasmach](https://github.com/tomasmach) reviews every change, and CI must pass before it can be merged.

Before contributing, read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

MIT - see [LICENSE](LICENSE).

## Data attribution

Pub data includes OpenStreetMap-derived data where applicable.

OpenStreetMap data is © [OpenStreetMap](https://www.openstreetmap.org/) contributors and available under the [Open Database Licence (ODbL)](https://opendatacommons.org/licenses/odbl/).
