# Profiles feature — BACKEND contract (locked)

Branch `feat/user-accounts`. Beer-social profiles: unique nickname handle, avatar on Hetzner local disk, public-default visibility, stats feed. This file is the authoritative backend contract; the mobile repo has the mirror at `na-pivo/docs/profiles-spec.md`.

## Locked product decisions
- `nickname` = UNIQUE handle, case-insensitive unique, 3–20 chars, charset `[a-zA-Z0-9_.]`, user picks it. Reserved-name list. Nullable (existing accounts keep NULL).
- `display_name` = existing field, repurposed as OPTIONAL real name (free text). Only help_text changes.
- `avatar` = uploaded image on LOCAL DISK (MEDIA_ROOT + docker volume + Caddy `/media/`). Pillow → 256px square webp, EXIF stripped. Google `picture` captured server-side once when avatar empty. Apple has none. No avatar → `avatar_url: null`, mobile renders initials fallback.
- `is_public` = BooleanField default **True** (public, opt-out). Gates global search + leaderboards later; friends always see you.

## Model (`pubs/models.py`, Account @212)
| field | type | notes |
|-------|------|-------|
| `nickname` | `CharField(max_length=20, null=True, blank=True, db_index=True)` | verbatim casing; uniqueness on `Lower(nickname)` |
| `display_name` | unchanged `CharField(120, blank, default='')` | only help_text → "Optional real name (free text)" |
| `avatar` | `ImageField(upload_to=account_avatar_path, max_length=255, blank=True, default='')` | needs Pillow |
| `is_public` | `BooleanField(default=True, db_index=True)` | |

- Module-level `account_avatar_path(instance, filename)` → `f"avatars/{instance.public_id}.webp"` (one stable path per account; re-upload overwrites).
- `Meta.constraints += UniqueConstraint(Lower('nickname'), name='uniq_account_nickname_ci', condition=~Q(nickname='') & Q(nickname__isnull=False))` — functional PARTIAL unique index, works on **sqlite AND postgres** (Django ≥4.0). **Do NOT** use `unique=True` on the column / `unique_together` / CITEXT / DB CHECK.

## Migration `0026_account_profile_fields` (depends 0025)
AddField nickname/avatar/is_public, AlterField display_name help_text, AddConstraint `uniq_account_nickname_ci`. All non-destructive, identical on both engines. **varchar_pattern_ops footgun** (broke 0004): nickname gets `db_index=True` via a single AddField (plain btree, fine); uniqueness comes ONLY from the functional UniqueConstraint via AddConstraint. **Gate release** on a fresh Postgres `migrate` + `makemigrations --check`.

## Validation (`pubs/accounts.py`, single source of truth)
- `RESERVED_NICKNAMES` frozenset (lowercase compare): admin, administrator, root, superuser, mod, moderator, support, help, staff, team, official, napivo, na-pivo, na_pivo, system, api, www, me, null, none, undefined, anonymous, user, account, settings, auth, login, register, privacy, terms, about, contact, pivo, beer.
- `validate_nickname(value, *, account=None) -> str`: order charset/length → reserved → taken. Regex `^[a-zA-Z0-9_.]{3,20}$`; reject `..`, leading/trailing `.`. Uniqueness `Account.objects.exclude(pk=account.pk).filter(nickname__iexact=value).exists()`. Raises `AccountError(code=...)`: `nickname_invalid|nickname_reserved|nickname_too_short|nickname_too_long|nickname_taken`.
- `check_nickname(value, account=None) -> (available: bool, reason: str|None)` — non-raising, for the availability endpoint. reason ∈ `invalid|reserved|taken|too_short|too_long`.
- DB UniqueConstraint is the race backstop: catch `IntegrityError` on save → 409 `nickname_taken`. Coerce `nickname == ''` → `None` before save.

## Avatar pipeline (`pubs/accounts.py`)
- `process_avatar(file_or_bytes) -> ContentFile`: `ImageOps.exif_transpose` → `convert('RGB')` → `ImageOps.fit((256,256), LANCZOS, centering=(0.5,0.5))` → save webp `quality=82, method=6`, no exif.
- Guards BEFORE decode: reject `file.size > AVATAR_MAX_UPLOAD_BYTES (5 MB)` → `avatar_too_large`; set `Image.MAX_IMAGE_PIXELS`; catch `DecompressionBombError`/`UnidentifiedImageError` → `avatar_invalid`. Never trust client content-type/extension; always re-encode to webp.
- `set_avatar(account, file)`, `clear_avatar(account)` (`account.avatar.delete(save=False)` then `avatar=''`).
- `_maybe_capture_social_avatar(account, claims, provider)`: only when `account.avatar == '' and provider == 'google' and claims.get('picture')`. GET picture (requests, https only, 10s timeout, 5 MB stream cap, content-type `image/*`, optionally allow-list googleusercontent.com) → `process_avatar` → save. Best-effort: swallow ALL errors with a warning, never break sign-in. Apple = no-op.

## Endpoints (canonical, post-reconcile)
- `GET /v1/account/me` → full body (below). MUST build serializer with `context={'request': request}` so `avatar_url` is absolute.
- `PATCH /v1/account/me` — JSON subset `{nickname?: str|null, display_name?: str, is_public?: bool, hide_pub_names?: bool}`. Uses new `AccountUpdateSerializer` (replaces `AccountPreferencesSerializer` in `AccountMeView.patch`; keep hide_pub_names working here). Errors 400 `{detail, code}` (nickname_*), 409 `nickname_taken`.
- `GET /v1/account/nickname-available?nickname=<candidate>` — AllowAny + optional auth (own current nickname → available:true). `200 {nickname, available, reason}`; 400 if param missing; throttle scope `nickname_check` ~60/min.
- `PUT /v1/account/me/avatar` (ALSO accept `POST` as mobile alias) — multipart, field `avatar` (jpeg|png|webp|heic, ≤5 MB), `parser_classes=[MultiPartParser]` (local only, do NOT change global default). → 200 full body. Errors `avatar_missing|avatar_too_large|avatar_invalid`. Throttle `avatar` ~10/min.
- `DELETE /v1/account/me/avatar` — reset to fallback, idempotent (200 even if none). Same `AccountAvatarView`.

## `AccountMeSerializer` response shape (every auth endpoint via `_account_state`)
```json
{
  "id": "<public_id>", "device_id": "<uuid>",
  "nickname": "BeerFan_42" | null,
  "display_name": "Tomáš",
  "avatar_url": "https://api.na-pivo.cz/media/avatars/<public_id>.webp?v=<last_seen_epoch>" | null,
  "has_avatar": true,
  "is_public": true,
  "email": "a@b.cz" | "", "email_verified": true,
  "providers": ["email","google"], "is_anonymous": false, "status": "active",
  "hide_pub_names": false,
  "usage": { "walked_distance_m": 4213 },
  "created_at": "<iso8601>", "last_seen_at": "<iso8601>"
}
```
- `avatar_url` = `SerializerMethodField`: `None` if no avatar, else `request.build_absolute_uri(obj.avatar.url)` + `?v=<last_seen_at epoch>` cache-bust (null-guard context → relative fallback, never crash).
- `has_avatar` = `bool(obj.avatar)`. `usage` nested = `{walked_distance_m}` from `AccountUsageStats` (feeds mobile distance tile).
- **Context fix (highest-leverage bug)**: pass `context={'request': request}` at ALL 3 sites — `auth_views.py:_account_state`, `views.py:AccountMeView.get`, `.patch`. Otherwise avatar_url degrades to relative `/media/` which mobile `<Image>` can't load.

## Google name+picture (bug fix)
Today `resolve_social` reads only sub+email; `GoogleAuthView` passes no full_name → Google name AND picture lost. Fix: forward `full_name=claims.get('name','')` for Google, and call `_maybe_capture_social_avatar(account, claims, 'google')` + `_maybe_set_display_name(account, claims.get('name',''))` inside `resolve_social`/`link_social`. Mobile unchanged.

## Media / deps / infra
- `config/settings.py`: `MEDIA_URL='/media/'`, `MEDIA_ROOT=os.environ.get('MEDIA_ROOT', BASE_DIR/'media')`, `AVATAR_MAX_UPLOAD_BYTES=5*1024*1024`, `AVATAR_SIZE_PX=256`, `AVATAR_WEBP_QUALITY=82`, throttle rates `nickname_check`/`avatar`.
- `config/urls.py`: in DEBUG append `static(MEDIA_URL, document_root=MEDIA_ROOT)` (dev + tests serve /media/).
- `pyproject.toml`: `Pillow>=11.4.0` via `uv add pillow`.
- `docker-compose.yml`: named volume `napivo_media` mounted `napivo_media:/data/media` on web+worker; `MEDIA_ROOT=/data/media` in env examples. **Deploy step (out-of-repo)**: Caddy `handle /media/* { root * /data/media; file_server; header Cache-Control "public,max-age=604800,immutable" }`. Django does NOT serve MEDIA in prod.

## Build order
1. deps + media config (no blockers). 2. model fields + constraint. 3. migration (verify on fresh Postgres). 4. accounts.py validators + avatar pipeline + social capture. 5. serializers (AccountMeSerializer + AccountUpdateSerializer). 6. views + urls + auth_views context threading + Google fix. 7. tests. 8. docker volume + env examples.

## Test plan (`pubs/api/tests/test_profile.py`) — run on sqlite AND postgres
CI-uniqueness (case-insensitive 409), own-nickname idempotent, DB-constraint backstop (direct create dup → IntegrityError, both engines), charset/length/reserved rejection, clear→NULL frees handle, nickname-available all reasons + missing-param 400, migration backfill (existing rows nickname NULL / is_public True / two NULL-nick coexist), avatar happy (stored 256 webp no exif), avatar EXIF orientation, avatar validation (too_large/invalid/missing), avatar delete idempotent, Google picture capture once + display_name + not-overwritten + Apple no-op, **avatar_url absolute** in GET /me AND a login response, is_public round-trip, hide_pub_names regression through new serializer.

Do NOT git commit/push — leave changes in the working tree.
