# Na pivo 🍺

**Namíříme tě na nejbližší hospodu.** Kompas ukazuje přímo k pivu — žádné mapy, žádné reklamy.

---

Na pivo is a novelty iOS app that points a compass arrow toward the nearest (or a randomly
chosen) pub in your area. All pub data is bundled on-device — no internet connection required
after install. The optional "Podpoř autora" link opens Safari to a Stripe-hosted donation
page where the user can type any amount (suggested 50 Kč). Nothing inside the app is purchased
or unlocked — it's purely a voluntary tip to the developer, outside the App Store.

## Run locally

```bash
npm install
npm run start        # Expo dev server (scan QR with Expo Go or custom dev client)
```

## Refresh pub dataset

```bash
npm run fetch-pubs   # downloads pubs from Overpass API and writes src/data/pubs.json
```

## Build (EAS)

```bash
# development build (custom dev client, physical device)
eas build -p ios --profile development

# internal preview build (Release config, TestFlight)
eas build -p ios --profile preview

# production build (auto-increment build number)
eas build -p ios --profile production
```

## Required environment variables

| Variable | Description |
|---|---|
| `STRIPE_DONATE_URL` | Stripe Payment Link URL for the donate button. Defaults to the production link baked into `app.config.ts` if unset. |

Set via `.env` locally or as an EAS secret:

```bash
eas secret:create --scope project --name STRIPE_DONATE_URL --value "https://donate.stripe.com/..."
```

## License

MIT — see [LICENSE](LICENSE).

## Data attribution

Pub data © [OpenStreetMap](https://www.openstreetmap.org/) contributors, available under the
[Open Database Licence (ODbL)](https://opendatacommons.org/licenses/odbl/).
