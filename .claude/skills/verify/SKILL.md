# Verify Na pivo on iOS

1. Spusť `npm run dev` na cold start backendu, buildu, Metra a iOS simulátoru.
2. Sleduj společný výstup: readiness probe má volat `/v1/health`; runtime warningy jsou viditelné po řádku `iOS Bundled`.
3. Pro druhý cold start použij:
   `xcrun simctl terminate booted com.tomasmach.na-pivo && xcrun simctl launch booted com.tomasmach.na-pivo`
4. Screenshot aktuálního simulátoru pořiď přes:
   `xcrun simctl io booted screenshot /tmp/na-pivo-verification.png`
5. U kompasu ověř vykreslení šipky, záře, rotaci a bootstrap requesty. CocoaPods deployment-target warningy během buildu jsou známý transitivní šum.
