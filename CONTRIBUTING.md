# Contributing to Na pivo

Thanks for helping make Na pivo better. Small, focused fixes are especially welcome.

Na pivo is maintained by a solo developer and already has released mobile clients. Please open an issue before investing in a large feature, backend contract change, new dependency, or architectural rewrite. That gives us a chance to align on product fit and operating cost first.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Where contributions go

- Open pull requests against `dev`, the default development branch.
- Do not target `main`. It mirrors the mobile version released in the App Store and Google Play.
- Security vulnerabilities belong in a [private security report](https://github.com/tomasmach/na-pivo/security/advisories/new), not a public issue.
- Questions and feature ideas can start as a GitHub issue.

Only the maintainer merges pull requests. Passing checks or receiving feedback does not guarantee that a change will be merged.

## Development setup

### Prerequisites

- Node.js 24 and npm (the repository includes `.nvmrc`)
- Python 3.14 and [uv](https://docs.astral.sh/uv/)
- For native iOS work: macOS, Xcode and CocoaPods
- For native Android work: Android Studio and the Android SDK

Clone your fork and install both dependency sets:

```bash
git clone git@github.com:YOUR-USERNAME/na-pivo.git
cd na-pivo
nvm use
npm ci
cd backend
uv sync --locked
cd ..
```

Static checks and tests do not need any environment variables or cloud credentials:

```bash
npm run typecheck
npm run lint
npm test -- --runInBand
npm audit --omit=dev --audit-level=high

cd backend
uv run ruff check .
uv run pip-audit
uv run pytest
```

### Run the backend only

The Django backend uses SQLite and safe development defaults when no `.env` exists:

```bash
cd backend
uv run python manage.py migrate
uv run python manage.py runserver
```

To customize its configuration, copy the documented template:

```bash
cp .env.example .env
```

External integrations such as Google geocoding, OpenRouter, email, social login and the Firmy.cz proxy are optional in development. Features backed by an unset integration degrade gracefully. Never ask for or reuse production credentials.

### Run the full mobile app

Copy the public mobile configuration template:

```bash
cp .env.example .env.local
```

Native builds require your own iOS or Android Google Maps SDK key. Put it in `.env.local`. Restrict the iOS key to the bundle ID and the Android key to the package plus your signing certificate; the identifiers live in `app.config.ts`. The OAuth values are optional; Google Sign-In stays unavailable when they are blank.

On macOS, the standard command applies backend migrations, starts Django, generates the iOS project and opens the simulator:

```bash
npm run dev
```

For Android, start Django on the LAN first and then run `npm run android:local`. See [README.md](README.md) for the individual commands and ports.

`.env`, `.env.local`, generated `ios/` and `android/` projects, build output and credentials are ignored. Do not force-add them.

## Pull request workflow

1. Sync your fork with `dev`.
2. Create a short branch such as `fix/preserve-offline-drinks` or `feat/add-pub-filter`.
3. Keep the change focused and include tests for behavior that can regress.
4. Run the relevant mobile and backend checks.
5. Open a pull request into `dev` and complete the template.
6. Address review feedback without resolving conversations you did not start.

The maintainer must approve the final commit. Pushing new changes after approval requires another review. CI must pass before merge.

## Product and engineering guidelines

- User-facing copy is Czech, informal and concise. Code, identifiers and comments are English.
- Preserve API compatibility with released mobile versions. Prefer additive changes.
- Keep core local behavior useful offline and preserve queued user work when sync fails.
- Treat location, alcohol history, profiles and social data as sensitive.
- Never log or commit bearer tokens, raw GPS, emails, cookies, proxy credentials or personal request bodies.
- Do not add raw GPS history or route storage without an explicit product decision.
- Consider caching, throttling, abuse and operating cost before adding backend integrations.
- Follow the existing Expo Router, Zustand, queue and theme patterns.
- Scrollable forms with `TextInput` use `src/components/shared/KeyboardAwareScrollView`.
- Mock external services in tests; the normal test suite must not spend API credits or call production.

## Commits

Use a concise, one-line conventional commit without a scope:

```text
feat: add profile badges
fix: preserve queued drinks offline
docs: explain local setup
```

## License

By submitting a contribution, you agree that it is licensed under the repository's [MIT License](LICENSE).
