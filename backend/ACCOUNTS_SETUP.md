# Uživatelské účty — setup guide

Tenhle dokument popisuje, co je potřeba **nakonfigurovat zvenčí**, aby uživatelské
účty (e-mail+heslo, Google, Apple) a transakční e-maily fungovaly v produkci.
Kód je hotový a všechno čte z proměnných prostředí — bez těchto credentials appka
běží dál anonymně, jen sociální přihlášení a e-maily nefungují.

## Architektura v kostce

- Appka startuje **anonymně** (device účet + bearer token, jako dosud).
- Registrace / přihlášení **„převezme" (claim)** anonymní účet → nasbíraná data
  (piva, hodnocení, návštěvy) zůstanou.
- Tokeny žijí v tabulce `AuthToken` (víc zařízení, revokace = smazání řádku).
- Providery (`EmailCredential`, `AuthIdentity` pro Google/Apple) se připínají ke
  stejnému `Account`. Jeden účet může mít heslo i Google i Apple zároveň.
- Mazání účtu = soft-delete s 14denní lhůtou, pak `purge_deleted_accounts` tvrdě
  smaže. Apple token se při mazání odvolá (Apple to vyžaduje).

Endpointy: `POST /v1/auth/{register,login,google,apple,link,unlink,set-password,
logout,request-password-reset,reset-password,request-email-verify,verify-email}`
a `DELETE /v1/account/me`.

---

## 1. Google Sign-In

V [Google Cloud Console](https://console.cloud.google.com/) → projekt `na-pivo`
(GCP `na-pivo-499010`) → **APIs & Services → Credentials → Create OAuth client ID**.
Vytvoř **tři** klienty:

| Typ | K čemu | Kam patří |
|---|---|---|
| **Web application** | appka jím mintuje ID token; stane se `aud` na obou platformách | `GOOGLE_WEB_CLIENT_ID` (backend) + `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (mobil) |
| **iOS** (bundle `com.tomasmach.na-pivo`) | nativní iOS klient | `GOOGLE_IOS_CLIENT_ID` (backend) + `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` (mobil); reverz → `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME` |
| **Android** (package `com.tomasmach.na_pivo` + SHA-1) | nativní Android klient | `GOOGLE_ANDROID_CLIENT_ID` (backend) |

- `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME` = iOS client id **pozpátku**, např.
  `com.googleusercontent.apps.1234567890-abcdef`.
- SHA-1 pro Android vezmi z keystore, kterým appku podepisuješ (EAS / Play).

## 2. Sign in with Apple

V [Apple Developer](https://developer.apple.com/account) → **Certificates,
Identifiers & Profiles**:

1. U App ID `com.tomasmach.na-pivo` zapni capability **Sign In with Apple**.
2. Vytvoř **Sign in with Apple Key** (Keys → +, zaškrtni Sign In with Apple).
   Stáhni `.p8`, poznač si **Key ID** a svoje **Team ID**.
3. Vyplň na serveru (potřeba jen pro **odvolání tokenu při mazání účtu**):
   - `APPLE_TEAM_ID`, `APPLE_KEY_ID`
   - `APPLE_PRIVATE_KEY` = obsah `.p8` (řádky odděl `\n`)
   - `APPLE_BUNDLE_ID=com.tomasmach.na-pivo` (default, native iOS `aud`)
   - `APPLE_SERVICES_ID` nech prázdné, pokud neděláš web/Android Apple login.

> Pozn.: v mobilním repu už leží `AuthKey.p8`. Ověř, jestli je to klíč
> **Sign in with Apple** (ne APNs / App Store Connect). Pokud ne, vytvoř nový dle
> bodu 2.

## 3. Resend (e-maily)

1. Na [resend.com](https://resend.com) vytvoř API klíč → `RESEND_API_KEY`.
2. Ověř odesílací doménu (DNS) a nastav `EMAIL_FROM`, např.
   `Na Pivo <noreply@napivo.cz>`.
3. Zapni odesílání: `EMAIL_ENABLED=True`. Bez toho (nebo bez klíče) se e-maily
   jen logují (dev no-op) — flows fungují, ale nic se neodešle.

## 4. Mobilní rebuild (nutné po přidání nativních modulů)

Přibyly nativní moduly `expo-apple-authentication` a
`@react-native-google-signin/google-signin` (config pluginy v `app.config.ts`).
Je potřeba nový dev client / build:

```bash
cd na-pivo
npx expo prebuild --clean
npx expo run:ios      # a/nebo run:android
```

Mobilní `.env` (nebo EAS secrets) musí mít `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`,
`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` a `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME`.

## 5. Cron na purge smazaných účtů

Na serveru (Hetzner, `/opt/na-pivo`) přidej denní cron:

```bash
docker compose exec -T web python manage.py purge_deleted_accounts
```

(`--dry-run` na náhled, `--grace-days N` na změnu lhůty.)

## 6. Migrace

Nové tabulky se nasadí standardně přes migrace (běží v `docker-entrypoint.sh`):
`0024_*` (modely) + `0025_backfill_auth_tokens` (přesype existující device tokeny
do `AuthToken`, aby už nainstalované appky nepřišly o účet). **Otestuj na Postgresu**
(SQLite v devu některé PG migrační bugy skrývá).

## Checklist

- [ ] Google: 3 OAuth klienti, vyplněné `GOOGLE_*` (backend) + `EXPO_PUBLIC_GOOGLE_*` (mobil)
- [ ] Apple: capability zapnutá, `.p8` klíč, `APPLE_TEAM_ID/KEY_ID/PRIVATE_KEY`
- [ ] Resend: klíč + ověřená doména + `EMAIL_ENABLED=True`
- [ ] `WEB_BASE_URL` ukazuje na GitHub Pages (kde je i `delete-account.html`)
- [ ] Mobilní `expo prebuild` + rebuild dev clientu
- [ ] Cron na `purge_deleted_accounts`
- [ ] Migrace ověřené na Postgresu
- [ ] V App Store / Play doplnit odkaz na `…/na-pivo/delete-account.html`
