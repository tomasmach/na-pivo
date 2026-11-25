(function () {
  "use strict";
  // Every page counts its view and taps on store links; only the address, the referrer's origin and the link's campaign go out.
  if (navigator.webdriver) return;
  var referrer = "";
  // Scheme and host only; the Google app on Android refers as android-app://com.google..., whose origin is "null".
  try { var from = new URL(document.referrer); referrer = from.protocol + "//" + from.host; } catch (e) { referrer = ""; }
  var params = new URLSearchParams(location.search);
  var campaign = params.get("utm_campaign") || params.get("utm_source") || "";
  var missing = document.body.hasAttribute("data-stats-missing");
  var send = function (type) {
    var body = JSON.stringify({ path: location.pathname, type: type, ref: referrer, utm: campaign, missing: missing });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon("/web/stats", new Blob([body], { type: "application/json" }))) return;
      fetch("/web/stats", { method: "POST", body: body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(function () {});
    } catch (e) {
      // Counting must never break the page.
    }
  };
  var viewed = function () { send("view"); };
  // A page the browser prerenders counts once somebody actually opens it.
  if (document.prerendering) document.addEventListener("prerenderingchange", viewed, { once: true });
  else viewed();
  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest("a[href]");
    if (!link) return;
    if (link.hostname === "apps.apple.com") send("store_ios");
    else if (link.hostname === "play.google.com") send("store_android");
  });
})();
