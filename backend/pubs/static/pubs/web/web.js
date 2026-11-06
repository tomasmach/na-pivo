// Small helpers of the Na pivo web. No framework, no third-party code.
(function () {
  "use strict";

  // Call a /v1/ endpoint as the signed-in web user: the session cookie goes along,
  // unsafe methods carry the CSRF token from <meta name="csrf-token">. Never throws.
  // Returns {ok, status, data}; status 0 means the network failed.
  window.npApi = async function npApi(path, options) {
    var opts = options || {};
    var method = (opts.method || "GET").toUpperCase();
    var headers = { Accept: "application/json", "Accept-Language": document.documentElement.lang || "cs" };
    if (method !== "GET" && method !== "HEAD") {
      var meta = document.querySelector('meta[name="csrf-token"]');
      if (meta) headers["X-CSRFToken"] = meta.content;
    }
    var init = { method: method, headers: headers, credentials: "same-origin" };
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    try {
      var response = await fetch(path, init);
      var data = null;
      try { data = await response.json(); } catch (e) { data = null; }
      return { ok: response.ok, status: response.status, data: data };
    } catch (e) {
      return { ok: false, status: 0, data: null };
    }
  };

  // The mobile menu opens as #menu (works without this script); Escape closes it and returns to the button.
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" || location.hash !== "#menu") return;
    var close = document.querySelector("[data-menu-close]");
    if (!close) return;
    close.click();
    var open = document.querySelector("[data-menu-open]");
    if (open) open.focus();
  });

  // A pub page counts its view and navigation taps; only the pub, the action and the referrer's origin go out.
  var reachPub = document.querySelector("[data-reach-pub]");
  if (reachPub && !navigator.webdriver) {
    var referrer = "";
    try { referrer = document.referrer ? new URL(document.referrer).origin : ""; } catch (e) { referrer = ""; }
    var reach = function (type) {
      var body = JSON.stringify({ pub: reachPub.getAttribute("data-reach-pub"), type: type, ref: referrer });
      try {
        if (navigator.sendBeacon && navigator.sendBeacon("/web/reach", new Blob([body], { type: "application/json" }))) return;
        fetch("/web/reach", { method: "POST", body: body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(function () {});
      } catch (e) {
        // Counting must never break the page.
      }
    };
    var viewed = function () { reach("detail_view"); };
    // A page the browser prerenders counts once somebody actually opens it.
    if (document.prerendering) document.addEventListener("prerenderingchange", viewed, { once: true });
    else viewed();
    document.querySelectorAll('[data-reach="navigation"]').forEach(function (link) {
      link.addEventListener("click", function () { reach("navigation"); });
    });
  }

  // The return page of Google and Apple sign-in posts itself on.
  var form = document.querySelector("form[data-autosubmit]");
  if (form) form.submit();
})();
