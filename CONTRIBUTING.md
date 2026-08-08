# Contributing to Na pivo

Please keep pull requests small and focused. They are much easier to review in a solo-maintained repo.

Na pivo already has released mobile clients in use. Before spending time on a large feature, API contract change, new dependency or architectural rewrite, open an issue. It is the quickest way to check whether the idea fits the product and what it would cost to run.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Where contributions go

- Send pull requests to `dev`, the default development branch.
- Do not target `main`. It tracks the mobile version released through the App Store and Google Play.
- Report security vulnerabilities [privately](https://github.com/tomasmach/na-pivo/security/advisories/new), never in a public issue.
- Use GitHub issues for questions and feature ideas.

Only [@tomasmach](https://github.com/tomasmach) merges pull requests. A green build or a review does not guarantee a merge.

## Development setup

### Prerequisites

- Node.js 24 and npm (the repository includes `.nvmrc`)
- Python 3.14 and [uv](https://docs.astral.sh/uv/)
- For native iOS work: macOS, Xcode and CocoaPods
- For native Android work: Android Studio and the Android SDK

Clone your fork, then install the mobile and backend dependencies:

```bash
git clone git@github.com:YOUR-USERNAME/na-pivo.git
cd na-pivo
nvm use
npm ci
cd backend
uv sync --locked
cd ..
```

You can run the checks without environment variables or cloud credentials:

```bash
npm run typecheck
npm run lint
npm test -- --runInBand
npm run audit:ci

cd backend
uv run ruff check .
uv run pip-audit
uv run pytest
```

### Run the backend only

Django uses SQLite and safe development defaults when `.env` is missing:

```bash
cd backend
uv run python manage.py migrate
uv run python manage.py runserver
```

To change the local configuration, copy the template:

```bash
cp .env.example .env
```

Google geocoding, OpenRouter, email, social login and the Firmy.cz proxy are optional in development. If you leave one unset, only the feature that needs it will be unavailable. Do not ask for or reuse production credentials.

### Run the full mobile app

Copy the mobile configuration template:

```bash
cp .env.example .env.local
```

Native builds need your own Google Maps SDK key for iOS or Android. Put it in `.env.local`. Restrict the iOS key to the bundle ID and the Android key to the package and signing certificate. You can find those identifiers in `app.config.ts`. OAuth is optional, and Google Sign-In stays off when its values are blank.

On macOS, this command runs the backend migrations, starts Django, generates the iOS project and opens the simulator:

```bash
npm run dev
```

For Android, start Django on the LAN and then run `npm run android:local`. [README.md](README.md) lists the separate commands and ports.

Git ignores `.env`, `.env.local`, generated `ios/` and `android/` projects, build output and credentials. Do not force-add any of them.

## Pull request workflow

1. Sync your fork with `dev`.
2. Create a short branch such as `fix/preserve-offline-drinks` or `feat/add-pub-filter`.
3. Keep the change focused. Add tests for behavior that could regress.
4. Run the relevant mobile and backend checks.
5. Open a pull request into `dev` and complete the template.
6. Address the review comments. Leave conversations open for the reviewer to resolve.

[@tomasmach](https://github.com/tomasmach) must approve the latest commit. If you push again after approval, GitHub will require another review. CI must also pass.

## Product and engineering guidelines

- User-facing copy is Czech, informal and concise. Code, identifiers and comments are English.
- Keep the API compatible with released mobile versions. Add fields instead of changing or removing existing ones.
- Keep the core app useful offline. A failed sync should not lose queued user work.
- Treat location, alcohol history, profiles and social data as sensitive.
- Never log or commit bearer tokens, raw GPS, emails, cookies, proxy credentials or personal request bodies.
- Do not add raw GPS history or route storage without an explicit product decision.
- Check caching, throttling, abuse risk and operating cost before adding a backend integration.
- Follow the existing Expo Router, Zustand, queue and theme patterns.
- Scrollable forms with `TextInput` use `src/components/shared/KeyboardAwareScrollView`.
- Mock external services in tests. The regular test suite must not spend API credits or call production.

## Commits

Use a concise, one-line conventional commit without a scope:

```text
feat: add profile badges
fix: preserve queued drinks offline
docs: explain local setup
```

## License

By submitting a contribution, you agree that it is licensed under the repository's [MIT License](LICENSE).
