## Summary

<!-- What changed, and what user or contributor problem does it solve? -->

## Verification

<!-- List the commands and manual flows you ran. -->

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test -- --runInBand`
- [ ] `npm audit --omit=dev --audit-level=high`
- [ ] `cd backend && uv run ruff check . && uv run pip-audit && uv run pytest`
- [ ] Not applicable checks are explained below

## Checklist

- [ ] This pull request targets `dev`, not `main`
- [ ] The change is focused and contains no credentials or personal data
- [ ] User-facing copy is Czech; code and comments are English
- [ ] Released API clients remain compatible, or the migration path is documented
- [ ] Offline, privacy and operating-cost impact was considered where relevant

## Screenshots or notes

<!-- Add UI screenshots or anything reviewers need. Remove this section if empty. -->
