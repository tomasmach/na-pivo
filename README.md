# Na pivo 🍺

**Namíříme tě na nejbližší hospodu.** Kompas ukazuje přímo k pivu — žádné mapy, žádné reklamy.

---

Na pivo is a novelty iOS app that points a compass arrow toward the nearest (or a randomly
chosen) pub in your area. All pub data is bundled on-device — no internet connection required
after install. Nothing inside the app is purchased or unlocked — it's free and ad-free.

## Run locally

```bash
npm install
npm run start        # Expo dev server (scan QR with Expo Go or custom dev client)
```

To test against the local backend instead of the deployed API:

```bash
# terminal 1 — backend
cd ../na-pivo-backend
uv run python manage.py runserver 0.0.0.0:8000

# terminal 2 — build and run the local iOS app
cd ../na-pivo
npm run ios:local
```

`ios:local` is the local-backend equivalent of `npx expo run:ios`. It passes the
Mac's LAN IP into the app so the simulator/device talks to the local Django
server instead of `https://api.na-pivo.cz`. Override the port with
`EXPO_PUBLIC_BACKEND_PORT=8765` if needed.

Raw command equivalent:

```bash
EXPO_PUBLIC_BACKEND_MODE=local \
EXPO_PUBLIC_BACKEND_HOST=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo localhost) \
npx expo run:ios
```

Use `npm run start:local` only when you want to start Metro without rebuilding
the native iOS app.

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

## License

MIT — see [LICENSE](LICENSE).

## Data attribution

Pub data © [OpenStreetMap](https://www.openstreetmap.org/) contributors, available under the
[Open Database Licence (ODbL)](https://opendatacommons.org/licenses/odbl/).
