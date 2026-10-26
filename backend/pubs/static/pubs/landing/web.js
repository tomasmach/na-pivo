// Store links point at the store of the visitor's phone. On Android, "Doveď mě tam" opens
// the pub in the app and falls back to Google Play; iOS does the same through the Safari banner.
(() => {
  document.documentElement.classList.remove("no-js");
  const ua = navigator.userAgent;
  const android = /Android/i.test(ua);
  const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  for (const link of document.querySelectorAll("[data-ios][data-android]")) {
    if (android) link.href = link.dataset.android;
    else if (ios) link.href = link.dataset.ios;
  }
  if (!android) return;
  for (const link of document.querySelectorAll("[data-open-app]")) {
    const app = new URL(link.dataset.openApp);
    const fallback = encodeURIComponent(link.dataset.android);
    link.href = `intent://${app.host}${app.search}#Intent;scheme=napivo;package=com.tomasmach.na_pivo;S.browser_fallback_url=${fallback};end`;
  }
})();
